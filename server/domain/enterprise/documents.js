/**
 * server/domain/enterprise/documents
 * 任務：文件版本、上傳、綁定
 * 透過 register(api) 掛載到共享 api 物件（跨域呼叫 api.fn）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../../config');
const {
    PORT, API_KEY, DEEPSEEK_URL, RAG_SERVICE_URL, RAG_API_KEY, IS_PRODUCTION, REQUIRE_ENTERPRISE_AUTH, ALLOW_ANONYMOUS_AI, DATA_FILE, PIN_SALT, MAX_BODY_BYTES, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX, AUTH_RATE_LIMIT_MAX, PIN_MAX_ATTEMPTS, PIN_LOCK_MS, AI_RATE_LIMIT_MAX, AI_RATE_LIMIT_WINDOW_MS, DEFAULT_LLM_API_BASE, ALLOWED_LLM_API_BASES, MAX_UPLOAD_BYTES, ALLOWED_UPLOAD_EXT, WEAK_PINS, UPLOADS_DIR, ALLOWED_ORIGINS, RAG_INDEX_TIMEOUT_MS, RAG_INDEX_MAX_ATTEMPTS, RAG_INDEX_EVENT_LIMIT, serviceStartedAt, enforceProductionSecrets
} = config;

/** @param {Record<string, Function>} api */
function register(api) {
    function isActiveDocument(doc) {
        if (!doc) return false;
        if (doc.deletedAt) return false;
        if (doc.status === 'deleted') return false;
        return true;
    }

    function normalizeTaskKnowledgeBinding(group, kbIdsRaw, docIdsRaw) {
        api.ensureKnowledgeBases(group);
        const activeDocs = (group.documents || []).filter(isActiveDocument);
        const docById = new Map(activeDocs.map(d => [d.id, d]));

        let kbIds = [...new Set(
            (Array.isArray(kbIdsRaw) ? kbIdsRaw : [])
                .map(id => api.normalizeKbId(id))
                .filter(id => id && group.knowledgeBases[id] && api.isActiveKb(group.knowledgeBases[id]))
        )].slice(0, 12);

        let docIds = [...new Set(
            (Array.isArray(docIdsRaw) ? docIdsRaw : [])
                .map(id => String(id || '').trim())
                .filter(id => id && docById.has(id))
        )].slice(0, 20);

        if (kbIds.length && docIds.length) {
            const kbSet = new Set(kbIds);
            docIds = docIds.filter(id => {
                const d = docById.get(id);
                return d && kbSet.has(api.normalizeKbId(d.kbId || 'general'));
            });
        }

        if (!kbIds.length && docIds.length) {
            kbIds = [...new Set(
                docIds.map(id => api.normalizeKbId(docById.get(id)?.kbId || 'general'))
            )].slice(0, 12);
        }

        return { kbIds, docIds };
    }

    function getRagFilenameForDoc(doc) {
        if (!doc) return '';
        if (doc.filename) return doc.filename;
        if (doc.title) return `text::${doc.title}.md`;
        return '';
    }

    function computeContentHash(content) {
        return crypto.createHash('sha256').update(String(content || ''), 'utf8').digest('hex');
    }

    function buildDocumentVersionSnapshot(doc, fields = {}) {
        const title = fields.title != null ? fields.title : (doc?.title || '');
        const content = fields.content != null ? fields.content : (doc?.content || '');
        const filename = fields.filename !== undefined ? fields.filename : (doc?.filename || null);
        const fileUrl = fields.fileUrl !== undefined ? fields.fileUrl : (doc?.fileUrl || null);
        const docType = fields.docType || doc?.docType || 'text';
        const version = fields.version != null ? fields.version : (doc?.currentVersion || 1);
        return {
            version,
            title,
            content,
            contentHash: fields.contentHash || computeContentHash(content),
            filename,
            fileUrl,
            docType,
            createdAt: fields.createdAt || new Date().toISOString(),
            createdByMemberId: fields.createdByMemberId != null
                ? fields.createdByMemberId
                : (doc?.authorMemberId || null),
            createdByName: fields.createdByName != null
                ? fields.createdByName
                : (doc?.author || null),
            changeNote: fields.changeNote != null ? fields.changeNote : null,
            ragRefHint: fields.ragRefHint != null
                ? fields.ragRefHint
                : (doc?.rag?.refDocId || null)
        };
    }

    function ensureDocumentVersions(doc, authorMeta = {}) {
        if (!doc) return doc;
        if (!Array.isArray(doc.versions)) doc.versions = [];
        const ver = Number(doc.currentVersion);
        if (!Number.isFinite(ver) || ver < 1) {
            doc.currentVersion = doc.versions.length
                ? Math.max(...doc.versions.map(v => Number(v.version) || 0), 1)
                : 1;
        }
        if (doc.versions.length === 0) {
            doc.versions.push(buildDocumentVersionSnapshot(doc, {
                version: doc.currentVersion || 1,
                createdAt: doc.createdAt || new Date().toISOString(),
                createdByMemberId: authorMeta.createdByMemberId || doc.authorMemberId || null,
                createdByName: authorMeta.createdByName || doc.author || null,
                changeNote: authorMeta.changeNote || 'initial'
            }));
        }
        return doc;
    }

    function summarizeVersionMeta(v) {
        if (!v) return null;
        const hasContent = !!(String(v.content || '').trim()) || !!(v.fileUrl);
        return {
            version: v.version,
            title: v.title || '',
            createdAt: v.createdAt || null,
            createdByName: v.createdByName || null,
            changeNote: v.changeNote || null,
            hasContent,
            docType: v.docType || null,
            filename: v.filename || null
        };
    }

    async function assertDocumentReadAccess(req, store, group, { memberId, groupCode } = {}) {
        const authUser = await api.getOptionalAuth(req);
        if (memberId) {
            const memberCheck = await api.assertEnterpriseMember(group, memberId, authUser, { store, bind: false });
            if (!memberCheck.ok) {
                return {
                    ok: false,
                    status: memberCheck.status || 403,
                    error: memberCheck.error || '你不是此群組成員',
                    code: memberCheck.code || 'GROUP_FORBIDDEN'
                };
            }
            return { ok: true, member: memberCheck.member, authUser, store };
        }
        const access = await api.assertRagGroupAccess(groupCode || group.code, authUser, { requireManager: false });
        if (!access.ok) {
            return { ok: false, status: access.status, error: access.error, code: access.code };
        }
        return { ok: true, member: access.member, authUser, store: access.store || store };
    }

    function trySaveDocumentUpload(body, docType) {
        if (!(docType === 'pdf' || docType === 'image' || docType === 'excel')) {
            return { ok: true, fileUrl: null, filename: body.filename || null };
        }
        if (!body.fileData || !body.filename) {
            return { ok: true, fileUrl: null, filename: body.filename || null };
        }
        try {
            const fileBuffer = Buffer.from(body.fileData, 'base64');
            const ext = (path.extname(body.filename) || (docType === 'pdf' ? '.pdf' : docType === 'excel' ? '.xlsx' : '.png')).toLowerCase();
            if (!ALLOWED_UPLOAD_EXT.has(ext)) {
                return { ok: false, error: '不支援的檔案類型', code: 'VALIDATION_ERROR' };
            }
            if (fileBuffer.length > MAX_UPLOAD_BYTES) {
                return { ok: false, error: '檔案過大（上限 5MB）', code: 'VALIDATION_ERROR' };
            }
            const safeBase = path.basename(body.filename, ext).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
            const uniqueFilename = `${api.uid()}-${safeBase}${ext}`;
            const filePath = path.join(UPLOADS_DIR, uniqueFilename);
            fs.writeFileSync(filePath, fileBuffer);
            return {
                ok: true,
                fileUrl: `/uploads/${uniqueFilename}`,
                filename: body.filename,
                fileBuffer
            };
        } catch (e) {
            console.error('[Lumina API] 檔案儲存失敗:', e);
            return { ok: false, error: '檔案儲存失敗', code: 'INTERNAL_ERROR' };
        }
    }

    Object.assign(api, {
        isActiveDocument,
        normalizeTaskKnowledgeBinding,
        getRagFilenameForDoc,
        computeContentHash,
        buildDocumentVersionSnapshot,
        ensureDocumentVersions,
        summarizeVersionMeta,
        assertDocumentReadAccess,
        trySaveDocumentUpload
    });
}

module.exports = { register };
