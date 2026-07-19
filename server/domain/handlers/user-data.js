/**
 * server/domain/handlers/user-data
 * 任務：HTTP：/api/user/*
 * 透過 register(api) 掛載到共享 api 物件（跨域呼叫 api.fn）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { UPLOADS_DIR } = require('../../config');
const { getUserData, saveUserData, mergeUserData, getUserDataBackend, defaultUserData } = require('../../../lib/user-data-store');

// 個人（教練）附件：圖片／PDF／文字類，上限 2.5MB（前端壓縮後 2MB + base64 餘裕）
const PERSONAL_ATTACH_MAX_BYTES = 2.5 * 1024 * 1024;
const PERSONAL_ATTACH_EXT = new Set([
    '.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp',
    '.txt', '.md', '.markdown', '.csv', '.json', '.log'
]);

function safeUserIdSegment(userId) {
    // 僅 [a-zA-Z0-9_]：檔名以 user-<seg>- 開頭即可唯一歸屬（seg 不含 '-'）
    return String(userId || '').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 40);
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
            const seg = safeUserIdSegment(user.id);
            if (!seg) return api.sendJson(res, 400, { error: '帳號格式無法建立附件', code: 'VALIDATION_ERROR' });
            const safeBase = path.basename(rawName, ext).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 60) || 'file';
            const unique = `user-${seg}-${crypto.randomBytes(6).toString('hex')}-${safeBase}${ext}`;
            try {
                fs.writeFileSync(path.join(UPLOADS_DIR, unique), buffer);
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

    Object.assign(api, {
        handleUserData,
        safeUserIdSegment
    });
}

module.exports = { register };
