/**
 * server/domain/enterprise/kb
 * 任務：知識庫 CRUD 領域邏輯
 * 透過 register(api) 掛載到共享 api 物件（跨域呼叫 api.fn）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { UPLOADS_DIR } = require('../../config');
const { loadStore, saveStore } = require('../../../lib/enterprise-store');
const { withLock } = require('../../../lib/write-queue');

/** @param {Record<string, Function>} api */
function register(api) {
    function normalizeKbId(value) {
        const cleaned = String(value || 'general').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
        return cleaned.slice(0, 30) || 'general';
    }

    function isActiveKb(kb) {
        if (!kb) return false;
        if (kb.deletedAt) return false;
        if (kb.status === 'deleted') return false;
        return true;
    }

    function defaultKbDisplayName(id) {
        const labels = {
            general: '一般預設',
            onboarding: '新人培訓',
            specs: '規格文件',
            meetings: '會議紀錄'
        };
        return labels[id] || id;
    }

    function createKbRecord(id, fields = {}) {
        const now = new Date().toISOString();
        return {
            id,
            displayName: fields.displayName || defaultKbDisplayName(id),
            description: fields.description || '',
            status: 'active',
            createdAt: fields.createdAt || now,
            updatedAt: fields.updatedAt || now,
            createdByMemberId: fields.createdByMemberId || null,
            createdByUserId: fields.createdByUserId || null,
            createdByName: fields.createdByName || null,
            docCount: 0,
            deletedAt: null
        };
    }

    function ensureKnowledgeBases(group) {
        if (!group.knowledgeBases || typeof group.knowledgeBases !== 'object' || Array.isArray(group.knowledgeBases)) {
            group.knowledgeBases = {};
        }
        const now = new Date().toISOString();
        for (const doc of group.documents || []) {
            if (!api.isActiveDocument(doc)) continue;
            const id = normalizeKbId(doc.kbId || 'general');
            if (!group.knowledgeBases[id]) {
                group.knowledgeBases[id] = createKbRecord(id, { createdAt: doc.createdAt || now });
            }
        }
        if (!group.knowledgeBases.general) {
            group.knowledgeBases.general = createKbRecord('general', {
                displayName: '一般預設',
                description: '預設知識庫'
            });
        } else if (!isActiveKb(group.knowledgeBases.general)) {
            // general is system KB — always revive
            group.knowledgeBases.general.status = 'active';
            group.knowledgeBases.general.deletedAt = null;
            group.knowledgeBases.general.updatedAt = now;
        }
        for (const kb of Object.values(group.knowledgeBases)) {
            if (!isActiveKb(kb)) {
                kb.docCount = 0;
                continue;
            }
            kb.docCount = (group.documents || []).filter(
                d => api.isActiveDocument(d) && normalizeKbId(d.kbId || 'general') === kb.id
            ).length;
        }
        return group.knowledgeBases;
    }

    function serializeKbItem(kb) {
        return {
            id: kb.id,
            displayName: kb.displayName || defaultKbDisplayName(kb.id),
            description: kb.description || '',
            status: kb.status || 'active',
            docCount: typeof kb.docCount === 'number' ? kb.docCount : 0,
            createdAt: kb.createdAt || null,
            updatedAt: kb.updatedAt || null,
            createdByMemberId: kb.createdByMemberId || null,
            createdByUserId: kb.createdByUserId || null,
            createdByName: kb.createdByName || null
        };
    }

    function buildKbListResponse(group) {
        ensureKnowledgeBases(group);
        const items = Object.values(group.knowledgeBases)
            .filter(isActiveKb)
            .map(serializeKbItem)
            .sort((a, b) => String(a.id).localeCompare(String(b.id)));
        return {
            ok: true,
            group_code: group.code,
            kb_ids: items.map(i => i.id),
            items
        };
    }

    function resolveKbForWrite(group, kbIdRaw, options = {}) {
        ensureKnowledgeBases(group);
        const kbId = normalizeKbId(kbIdRaw);
        const autoCreate = options.autoCreate !== false;
        let kb = group.knowledgeBases[kbId];
        if (isActiveKb(kb)) {
            return { ok: true, kb, created: false };
        }
        if (!autoCreate) {
            return { ok: false, status: 400, error: '知識庫不存在或已刪除', code: 'KB_NOT_FOUND' };
        }
        // Soft-deleted or missing id: create/revive as new active record
        kb = createKbRecord(kbId, {
            displayName: options.displayName || defaultKbDisplayName(kbId),
            description: options.description || '',
            createdByMemberId: options.createdByMemberId || null,
            createdByUserId: options.createdByUserId || null,
            createdByName: options.createdByName || null
        });
        group.knowledgeBases[kbId] = kb;
        return { ok: true, kb, created: true };
    }

    async function softDeleteKnowledgeBase(group, kbIdRaw) {
        const kbId = normalizeKbId(kbIdRaw);
        if (!kbId) {
            return { ok: false, status: 400, error: '無效的知識庫 id', code: 'INVALID_KB_ID' };
        }
        if (kbId === 'general') {
            return { ok: false, status: 400, error: '不可刪除預設知識庫 general', code: 'KB_PROTECTED' };
        }
        ensureKnowledgeBases(group);
        const kb = group.knowledgeBases[kbId];
        if (!kb || !isActiveKb(kb)) {
            return { ok: false, status: 404, error: '知識庫不存在', code: 'KB_NOT_FOUND' };
        }

        // Active docs on this KB (before soft-delete)
        const activeOnKb = (group.documents || []).filter(
            d => api.isActiveDocument(d) && normalizeKbId(d.kbId || 'general') === kbId
        );

        // Wipe RAG index before metadata soft-delete when possible (D2 consistency).
        const ragResult = await api.proxyRagDeleteKb(api.normalizeCode(group.code), kbId);
        if (!ragResult.ok) {
            // Empty KB + RAG unreachable/missing: allow metadata-only soft-delete (no vectors to protect).
            // Non-empty KB still fail-closed so we never hide documents while index may remain.
            const unreachable = !ragResult.status || ragResult.status === 0 || ragResult.status >= 500;
            const missing = ragResult.status === 404;
            if (activeOnKb.length === 0 && (unreachable || missing)) {
                console.warn(
                    '[Lumina API] RAG KB wipe skipped for empty KB (unreachable/missing) — metadata soft-delete only:',
                    ragResult.text || ragResult.status
                );
                const nowEmpty = new Date().toISOString();
                kb.status = 'deleted';
                kb.deletedAt = nowEmpty;
                kb.updatedAt = nowEmpty;
                kb.docCount = 0;
                return {
                    ok: true,
                    kb_id: kbId,
                    documentsSoftDeleted: 0,
                    ragDeleteOk: false,
                    warning: '知識庫索引服務不可用；空知識庫已僅從列表移除（無文件需級聯）'
                };
            }
            console.warn('[Lumina API] RAG KB index delete failed — abort soft-delete:', ragResult.text);
            return {
                ok: false,
                status: 200,
                error: '知識庫索引清除失敗，知識庫仍保留，請重試刪除',
                code: 'RAG_DELETE_FAILED',
                kb_id: kbId,
                documentsSoftDeleted: 0,
                ragDeleteOk: false,
                warning: '知識庫索引清除失敗，知識庫與文件仍保留於列表，請重試刪除'
            };
        }

        const now = new Date().toISOString();
        let documentsSoftDeleted = 0;
        for (const doc of group.documents || []) {
            if (!api.isActiveDocument(doc)) continue;
            if (normalizeKbId(doc.kbId || 'general') !== kbId) continue;

            // Cascade unlink uploads when fileUrl points at local /uploads
            if (doc.fileUrl) {
                try {
                    const baseName = path.basename(doc.fileUrl);
                    const filePath = path.join(UPLOADS_DIR, baseName);
                    if (filePath.startsWith(UPLOADS_DIR) && fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                    }
                } catch (e) {
                    console.warn('[Lumina Backend] KB cascade 檔案刪除失敗:', e.message);
                }
            }

            doc.status = 'deleted';
            doc.deletedAt = now;
            api.setDocumentRagStatus(doc, 'deleted');
            documentsSoftDeleted++;
        }

        kb.status = 'deleted';
        kb.deletedAt = now;
        kb.updatedAt = now;
        kb.docCount = 0;

        return {
            ok: true,
            kb_id: kbId,
            documentsSoftDeleted,
            ragDeleteOk: true
        };
    }

    Object.assign(api, {
        normalizeKbId,
        isActiveKb,
        defaultKbDisplayName,
        createKbRecord,
        ensureKnowledgeBases,
        serializeKbItem,
        buildKbListResponse,
        resolveKbForWrite,
        softDeleteKnowledgeBase
    });
}

module.exports = { register };
