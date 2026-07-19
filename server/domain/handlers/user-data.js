/**
 * server/domain/handlers/user-data
 * 任務：HTTP：/api/user/*
 * 透過 register(api) 掛載到共享 api 物件（跨域呼叫 api.fn）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../../config');
const { UPLOADS_DIR, USER_ATTACH_GC_INTERVAL_MS } = config;
const { getUserData, saveUserData, mergeUserData, getUserDataBackend, defaultUserData, listAllUserData } = require('../../../lib/user-data-store');

// 個人（教練）附件：圖片／PDF／文字類，上限 2.5MB（前端壓縮後 2MB + base64 餘裕）
const PERSONAL_ATTACH_MAX_BYTES = 2.5 * 1024 * 1024;
const PERSONAL_ATTACH_EXT = new Set([
    '.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp',
    '.txt', '.md', '.markdown', '.csv', '.json', '.log'
]);
// 濫用防護：上傳頻率限制在 rate-limit 模組（checkAttachmentRateLimit）；此處為容量配額
const ATTACH_QUOTA_BYTES = 50 * 1024 * 1024;
const ATTACH_QUOTA_FILES = 200;
// GC：未被 user-data 引用且超過寬限期的 user-* 檔才刪（寬限涵蓋「上傳了還沒 sync」的窗口）
const ATTACH_GC_GRACE_MS = 24 * 60 * 60 * 1000;

// 二進位類型驗 magic bytes（文字類跳過）；副檔名可偽造，內容簽章不行
const MAGIC_CHECKS = {
    '.pdf': buf => buf.slice(0, 5).toString('latin1') === '%PDF-',
    '.png': buf => buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])),
    '.jpg': buf => buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF,
    '.jpeg': buf => buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF,
    '.gif': buf => buf.slice(0, 4).toString('latin1') === 'GIF8',
    '.webp': buf => buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP'
};

function safeUserIdSegment(userId) {
    // 僅 [a-zA-Z0-9_]：檔名以 user-<seg>- 開頭即可唯一歸屬（seg 不含 '-'）
    return String(userId || '').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 40);
}

// 配額要算使用者已用空間，但每次上傳都掃整個 uploads 目錄會隨總檔案數變慢。
// 以使用者為單位短期快取：新檔案寫入時增量補上，GC 刪檔後整份失效。
const attachListCache = new Map();
const ATTACH_LIST_TTL_MS = 60 * 1000;

function listUserAttachmentFiles(seg) {
    const hit = attachListCache.get(seg);
    if (hit && Date.now() - hit.ts < ATTACH_LIST_TTL_MS) return hit.files;
    const prefix = `user-${seg}-`;
    let files = [];
    try {
        files = fs.readdirSync(UPLOADS_DIR)
            .filter(name => name.startsWith(prefix))
            .map(name => {
                try {
                    const st = fs.statSync(path.join(UPLOADS_DIR, name));
                    return { name, size: st.size, mtimeMs: st.mtimeMs };
                } catch (_) { return null; }
            })
            .filter(Boolean);
    } catch (_) {
        files = [];
    }
    attachListCache.set(seg, { files, ts: Date.now() });
    return files;
}

function noteUserAttachmentWritten(seg, name, size) {
    const hit = attachListCache.get(seg);
    if (hit) hit.files.push({ name, size, mtimeMs: Date.now() });
}

/** @param {Record<string, Function>} api */
function register(api) {
    async function handleUserData(req, res, urlPath, method) {
        const user = await api.requireAuth(req);
        if (!user) return api.sendJson(res, 401, { error: '請先登入' });

        if (method === 'GET' && urlPath === '/api/user/data') {
            const data = await getUserData(user.id);
            return api.sendJson(res, 200, {
                ok: true,
                data: data || defaultUserData(user.id),
                storage: getUserDataBackend()
            });
        }

        if (method === 'PUT' && urlPath === '/api/user/data') {
            const body = await api.readBody(req);
            const saved = await saveUserData(user.id, body);
            return api.sendJson(res, 200, { ok: true, data: saved, storage: getUserDataBackend() });
        }

        if (method === 'PATCH' && urlPath === '/api/user/data') {
            const body = await api.readBody(req);
            const result = await mergeUserData(user.id, body);
            return api.sendJson(res, 200, {
                ok: true,
                data: result.data,
                merged: result.merged,
                storage: getUserDataBackend()
            });
        }

        // 個人附件上傳（教練附件雲端化）：回 /uploads/ 路徑，僅本人可讀（canAccessUpload）
        if (method === 'POST' && urlPath === '/api/user/attachment') {
            if (!api.checkAttachmentRateLimit(user.id)) {
                return api.sendJson(res, 429, { error: '附件上傳過於頻繁，請稍後再試', code: 'RATE_LIMITED' });
            }
            const body = await api.readBody(req);
            const rawName = String(body.filename || '').trim();
            const b64 = String(body.data_base64 || body.fileData || '').trim();
            if (!rawName || !b64) {
                return api.sendJson(res, 400, { error: '缺少 filename 或 data_base64', code: 'VALIDATION_ERROR' });
            }
            const ext = path.extname(rawName).toLowerCase();
            if (!PERSONAL_ATTACH_EXT.has(ext)) {
                return api.sendJson(res, 400, { error: '不支援的附件類型', code: 'VALIDATION_ERROR' });
            }
            let buffer;
            try {
                buffer = Buffer.from(b64, 'base64');
            } catch (_) {
                return api.sendJson(res, 400, { error: '附件內容解碼失敗', code: 'VALIDATION_ERROR' });
            }
            if (!buffer.length) {
                return api.sendJson(res, 400, { error: '附件內容為空', code: 'VALIDATION_ERROR' });
            }
            if (buffer.length > PERSONAL_ATTACH_MAX_BYTES) {
                return api.sendJson(res, 400, { error: '附件過大（上限 2.5MB）', code: 'VALIDATION_ERROR' });
            }
            const magic = MAGIC_CHECKS[ext];
            if (magic && !magic(buffer)) {
                return api.sendJson(res, 400, { error: '附件內容與類型不符', code: 'VALIDATION_ERROR' });
            }
            const seg = safeUserIdSegment(user.id);
            if (!seg) return api.sendJson(res, 400, { error: '帳號格式無法建立附件', code: 'VALIDATION_ERROR' });
            const existing = listUserAttachmentFiles(seg);
            const usedBytes = existing.reduce((s, f) => s + f.size, 0);
            if (existing.length >= ATTACH_QUOTA_FILES || usedBytes + buffer.length > ATTACH_QUOTA_BYTES) {
                return api.sendJson(res, 413, { error: '附件容量已滿（50MB／200 檔），請清理舊附件', code: 'QUOTA_EXCEEDED' });
            }
            const safeBase = path.basename(rawName, ext).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60) || 'file';
            const unique = `user-${seg}-${crypto.randomBytes(6).toString('hex')}-${safeBase}${ext}`;
            try {
                fs.writeFileSync(path.join(UPLOADS_DIR, unique), buffer);
                noteUserAttachmentWritten(seg, unique, buffer.length);
            } catch (e) {
                return api.sendJson(res, 500, { error: '附件儲存失敗: ' + e.message });
            }
            return api.sendJson(res, 200, {
                ok: true,
                fileUrl: `/uploads/${unique}`,
                size: buffer.length
            });
        }

        return api.sendJson(res, 404, { error: 'User data route not found' });
    }

    /**
     * 孤兒附件 GC：uploads/ 的 user-* 檔若未被任何 user-data 引用
     * （任務附件或 coachThread 附件），且超過寬限期，即刪除。
     * 寬限期避免「已上傳、user-data 還沒 sync 回來」的檔被誤殺。
     */
    async function runUserAttachmentGc(options = {}) {
        const graceMs = options.graceMs != null ? options.graceMs : ATTACH_GC_GRACE_MS;
        const referenced = new Set();
        const collect = att => {
            const u = att?.fileUrl;
            if (typeof u === 'string' && u.startsWith('/uploads/')) referenced.add(path.basename(u));
        };
        for (const data of await listAllUserData()) {
            (data.tasks || []).forEach(t => (t?.attachments || []).forEach(collect));
            (data.coachThread?.messages || []).forEach(m => (m?.attachments || []).forEach(collect));
        }
        const now = Date.now();
        const removed = [];
        let kept = 0;
        let files = [];
        try {
            files = fs.readdirSync(UPLOADS_DIR).filter(n => /^user-[a-zA-Z0-9_]+-/.test(n));
        } catch (_) {}
        for (const name of files) {
            if (referenced.has(name)) { kept++; continue; }
            try {
                const st = fs.statSync(path.join(UPLOADS_DIR, name));
                if (now - st.mtimeMs < graceMs) { kept++; continue; }
                fs.unlinkSync(path.join(UPLOADS_DIR, name));
                removed.push(name);
            } catch (_) {}
        }
        if (removed.length) {
            attachListCache.clear(); // 配額快取含已刪檔案，重算
            console.log(`[Lumina UserData] 附件 GC：清除 ${removed.length} 個孤兒檔（保留 ${kept}）`);
        }
        return { removed, kept, referenced: referenced.size };
    }

    let attachGcTimer = null;
    function startUserAttachmentGc() {
        if (!USER_ATTACH_GC_INTERVAL_MS) return null;
        if (attachGcTimer) return attachGcTimer;
        attachGcTimer = setInterval(() => {
            runUserAttachmentGc().catch(e => console.warn('[Lumina UserData] 附件 GC 失敗:', e.message));
        }, USER_ATTACH_GC_INTERVAL_MS);
        if (typeof attachGcTimer.unref === 'function') attachGcTimer.unref();
        return attachGcTimer;
    }

    Object.assign(api, {
        handleUserData,
        safeUserIdSegment,
        runUserAttachmentGc,
        startUserAttachmentGc
    });
}

module.exports = { register };
