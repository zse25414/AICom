/**
 * server/domain/handlers/dispatch
 * 任務：HTTP：總分派與 createServer
 * 透過 register(api) 掛載到共享 api 物件（跨域呼叫 api.fn）
 */
'use strict';

const http = require('http');
const config = require('../../config');
const {
    PORT, API_KEY, DEEPSEEK_URL, RAG_SERVICE_URL, RAG_API_KEY, IS_PRODUCTION, REQUIRE_ENTERPRISE_AUTH, ALLOW_ANONYMOUS_AI, DATA_FILE, PIN_SALT, MAX_BODY_BYTES, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX, AUTH_RATE_LIMIT_MAX, PIN_MAX_ATTEMPTS, PIN_LOCK_MS, AI_RATE_LIMIT_MAX, AI_RATE_LIMIT_WINDOW_MS, DEFAULT_LLM_API_BASE, ALLOWED_LLM_API_BASES, MAX_UPLOAD_BYTES, ALLOWED_UPLOAD_EXT, WEAK_PINS, UPLOADS_DIR, ALLOWED_ORIGINS, RAG_INDEX_TIMEOUT_MS, RAG_INDEX_MAX_ATTEMPTS, RAG_INDEX_EVENT_LIMIT, serviceStartedAt, enforceProductionSecrets
} = config;
const { loadStore, saveStore, getStoreBackend } = require('../../../lib/enterprise-store');
const { getAuthBackend } = require('../../../lib/auth-store');
const { getUserDataBackend } = require('../../../lib/user-data-store');
const { getDatabaseStats } = require('../../../lib/db');

/** @param {Record<string, Function>} api */
function register(api) {
    async function dispatchRequest(req, res) {
        res._req = req;
        const urlPath = (req.url || '').split('?')[0];
        api.attachRequestLogging(req, res, urlPath);
        api.setCors(req, res);

        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        // Auth / health must never be blocked by the global poll rate limit.
        // (Auth has its own checkAuthRateLimit inside handleAuth.)
        const skipGlobalRateLimit =
            urlPath === '/health'
            || urlPath === '/ready'
            || urlPath.startsWith('/api/auth');
        if (!skipGlobalRateLimit && !api.checkRateLimit(req)) {
            api.sendJson(res, 429, { error: '請求過於頻繁，請稍後再試' });
            return;
        }

        if (req.method === 'GET' && urlPath === '/health') {
            const dbStats = await getDatabaseStats();
            const ragDetail = await api.probeRagHealthDetail();
            api.sendJson(res, 200, {
                ok: true,
                service: 'lumina-api-proxy',
                enterprise: true,
                auth: true,
                userData: true,
                storage: getStoreBackend(),
                authStorage: getAuthBackend(),
                userDataStorage: getUserDataBackend(),
                database: dbStats,
                rag: ragDetail,
                uptimeSec: Math.floor((Date.now() - serviceStartedAt) / 1000),
                backgroundIndexJobs: api.ragBackgroundIndexJobs.size,
                observability: 'w3'
            });
            return;
        }

        if (req.method === 'GET' && urlPath === '/ready') {
            const readiness = await api.getReadiness();
            api.sendJson(res, readiness.ready ? 200 : 503, {
                ok: readiness.ready,
                service: 'lumina-api-proxy',
                checks: readiness.checks,
                details: readiness.details,
                uptimeSec: readiness.uptimeSec,
                backgroundIndexJobs: readiness.backgroundIndexJobs
            });
            return;
        }

        // Wave 3: operator snapshot (no secrets). Public — same surface as /health.
        if (req.method === 'GET' && urlPath === '/api/ops/status') {
            const readiness = await api.getReadiness();
            const limit = Math.min(40, Math.max(1, Number(api.parseQuery(req).get('limit')) || 20));
            api.sendJson(res, 200, {
                ok: true,
                service: 'lumina-api-proxy',
                ready: readiness.ready,
                checks: readiness.checks,
                details: readiness.details,
                uptimeSec: readiness.uptimeSec,
                backgroundIndexJobs: readiness.backgroundIndexJobs,
                recentIndexEvents: api.ragIndexEvents.slice(0, limit),
                aiRateLimit: {
                    max: AI_RATE_LIMIT_MAX,
                    windowMs: AI_RATE_LIMIT_WINDOW_MS
                },
                ragIndexTimeoutMs: RAG_INDEX_TIMEOUT_MS
            });
            return;
        }

        if (req.method === 'GET' && urlPath.startsWith('/uploads/')) {
            await api.serveUploadFile(req, res, urlPath);
            return;
        }

        if (urlPath.startsWith('/api/user')) {
            try {
                await api.handleUserData(req, res, urlPath, req.method);
            } catch (err) {
                api.handleRouteError(res, err);
            }
            return;
        }

        if (urlPath.startsWith('/api/auth')) {
            try {
                await api.handleAuth(req, res, urlPath, req.method);
            } catch (err) {
                api.handleRouteError(res, err);
            }
            return;
        }

        if (urlPath.startsWith('/api/enterprise')) {
            try {
                await api.handleEnterprise(req, res, urlPath, req.method);
            } catch (err) {
                api.handleRouteError(res, err);
            }
            return;
        }

        if (urlPath.startsWith('/api/rag/')) {
            try {
                const aiAuth = await api.requireAiAuth(req);
                if (!aiAuth.ok) {
                    api.sendError(res, aiAuth.status, aiAuth.error, aiAuth.code || 'UNAUTHORIZED');
                    return;
                }

                // GET /api/rag/kb | /api/rag/kb/list — member list (kb_ids + items)
                if (req.method === 'GET' && (urlPath === '/api/rag/kb/list' || urlPath === '/api/rag/kb')) {
                    const query = api.parseQuery(req);
                    const groupCode = query.get('group_code') || query.get('groupCode') || '';
                    const access = await api.assertRagGroupAccess(groupCode, aiAuth.user);
                    if (!access.ok) {
                        api.sendAccessResult(res, access);
                        return;
                    }
                    const store = await api.prepareStore(await loadStore());
                    const group = api.getGroup(store, groupCode);
                    if (!group) {
                        api.sendError(res, 404, '找不到群組', 'GROUP_NOT_FOUND');
                        return;
                    }
                    const hadKbMap = !!(group.knowledgeBases && typeof group.knowledgeBases === 'object'
                        && !Array.isArray(group.knowledgeBases) && Object.keys(group.knowledgeBases).length);
                    api.ensureKnowledgeBases(group);
                    // Persist lazy migration once so list survives restarts
                    if (!hadKbMap) await saveStore(store);
                    api.sendJson(res, 200, api.buildKbListResponse(group));
                    return;
                }

                // POST /api/rag/reconcile — manager：對帳「已發布 vs 可被檢索」，fix=true 修復
                if (req.method === 'POST' && urlPath === '/api/rag/reconcile') {
                    const body = await api.readBody(req);
                    const groupCode = body.group_code || body.groupCode || '';
                    const access = await api.assertRagGroupAccess(groupCode, aiAuth.user, { requireManager: true });
                    if (!access.ok) {
                        api.sendAccessResult(res, access);
                        return;
                    }
                    const report = await api.reconcileRagIndexes(groupCode, { fix: body.fix === true });
                    if (report && report.ok === false && report.status) {
                        api.sendError(res, report.status, report.error, report.code);
                        return;
                    }
                    api.sendJson(res, 200, report);
                    return;
                }

                // POST /api/rag/kb — manager create
                if (req.method === 'POST' && urlPath === '/api/rag/kb') {
                    const body = await api.readBody(req);
                    const groupCode = body.group_code || body.groupCode || '';
                    const access = await api.assertRagGroupAccess(groupCode, aiAuth.user, { requireManager: true });
                    if (!access.ok) {
                        api.sendAccessResult(res, access);
                        return;
                    }
                    const store = await api.prepareStore(await loadStore());
                    const group = api.getGroup(store, groupCode);
                    if (!group) {
                        api.sendError(res, 404, '找不到群組', 'GROUP_NOT_FOUND');
                        return;
                    }
                    api.ensureKnowledgeBases(group);

                    const displayName = api.clampText(body.displayName || body.display_name || body.name, 80);
                    if (!displayName) {
                        api.sendError(res, 400, '請提供 displayName', 'VALIDATION_ERROR');
                        return;
                    }
                    const explicitId = api.clampText(body.id || body.kb_id || body.kbId, 30);
                    let kbId;
                    if (explicitId) {
                        kbId = api.normalizeKbId(explicitId);
                    } else {
                        const slug = displayName
                            .toLowerCase()
                            .replace(/[\s]+/g, '-')
                            .replace(/[^a-z0-9_-]/g, '');
                        kbId = slug ? api.normalizeKbId(slug) : api.normalizeKbId('kb' + api.uid().slice(0, 10));
                        // Chinese-only names slug to empty → general; use random id instead
                        if (kbId === 'general') {
                            kbId = api.normalizeKbId('kb' + api.uid().slice(0, 10));
                        }
                    }
                    if (!kbId) {
                        api.sendError(res, 400, '無效的知識庫 id', 'INVALID_KB_ID');
                        return;
                    }

                    const existing = group.knowledgeBases[kbId];
                    if (existing && api.isActiveKb(existing)) {
                        api.sendError(res, 409, '知識庫 id 已存在', 'KB_EXISTS');
                        return;
                    }

                    const description = api.clampText(body.description, 500);
                    const kb = api.createKbRecord(kbId, {
                        displayName,
                        description,
                        createdByMemberId: access.member?.id || null,
                        createdByUserId: access.member?.userId || aiAuth.user?.id || null,
                        createdByName: access.member?.name || null
                    });
                    // Preserve createdAt if re-creating after soft-delete
                    if (existing && existing.createdAt) {
                        kb.createdAt = existing.createdAt;
                    }
                    group.knowledgeBases[kbId] = kb;
                    await saveStore(store);
                    api.sendJson(res, 200, { ok: true, knowledgeBase: api.serializeKbItem(kb) });
                    return;
                }

                // POST /api/rag/kb/delete — manager soft-delete (body: group_code, kb_id)
                // DELETE /api/rag/kb/:kbId — same (query/body: group_code)
                const kbDeletePathMatch = urlPath.match(/^\/api\/rag\/kb\/([^/]+)$/);
                const isPostKbDelete = req.method === 'POST' && urlPath === '/api/rag/kb/delete';
                const isDeleteKbPath = req.method === 'DELETE' && kbDeletePathMatch
                    && kbDeletePathMatch[1] !== 'list' && kbDeletePathMatch[1] !== 'delete';
                if (isPostKbDelete || isDeleteKbPath) {
                    let groupCode = '';
                    let kbIdRaw = isDeleteKbPath ? decodeURIComponent(kbDeletePathMatch[1]) : '';
                    const query = api.parseQuery(req);
                    groupCode = query.get('group_code') || query.get('groupCode') || '';
                    let body = {};
                    try {
                        body = await api.readBody(req);
                        if (!groupCode) groupCode = body.group_code || body.groupCode || '';
                        if (!kbIdRaw) kbIdRaw = body.kb_id || body.kbId || body.id || '';
                    } catch (_) {
                        body = {};
                    }
                    if (!kbIdRaw && query.get('kb_id')) kbIdRaw = query.get('kb_id');
                    if (!String(kbIdRaw || '').trim()) {
                        api.sendError(res, 400, '缺少 kb_id', 'VALIDATION_ERROR');
                        return;
                    }

                    const access = await api.assertRagGroupAccess(groupCode, aiAuth.user, { requireManager: true });
                    if (!access.ok) {
                        api.sendAccessResult(res, access);
                        return;
                    }

                    const store = await api.prepareStore(await loadStore());
                    const group = api.getGroup(store, groupCode);
                    if (!group) {
                        api.sendError(res, 404, '找不到群組', 'GROUP_NOT_FOUND');
                        return;
                    }

                    const result = await api.softDeleteKnowledgeBase(group, kbIdRaw);
                    // Fail-closed wipe (non-empty KB): no metadata mutation
                    if (!result.ok && result.ragDeleteOk === false) {
                        console.warn(
                            `[Lumina API] KB delete aborted (RAG wipe fail) group=${api.normalizeCode(groupCode)} kb=${result.kb_id}`
                        );
                        api.sendJson(res, 200, {
                            ok: false,
                            kb_id: result.kb_id,
                            documentsSoftDeleted: 0,
                            ragDeleteOk: false,
                            warning: result.warning,
                            error: result.error,
                            code: result.code || 'RAG_DELETE_FAILED'
                        });
                        return;
                    }
                    if (!result.ok) {
                        api.sendError(res, result.status, result.error, result.code);
                        return;
                    }
                    // ok:true may still have ragDeleteOk:false (empty KB, RAG unreachable — metadata-only)
                    await saveStore(store);
                    api.sendJson(res, 200, {
                        ok: true,
                        kb_id: result.kb_id,
                        documentsSoftDeleted: result.documentsSoftDeleted,
                        ragDeleteOk: result.ragDeleteOk !== false,
                        warning: result.warning
                    });
                    return;
                }

                if (req.method === 'POST' && urlPath === '/api/rag/query') {
                    const aiUserId = aiAuth.user?.id || api.getClientIp(req);
                    if (!api.checkAiRateLimit(aiUserId)) {
                        api.sendError(res, 429, 'AI 請求過於頻繁，請稍後再試', 'RATE_LIMITED');
                        return;
                    }
                    const body = await api.readBody(req);
                    const access = await api.assertRagGroupAccess(body.group_code, aiAuth.user);
                    if (!access.ok) {
                        api.sendAccessResult(res, access);
                        return;
                    }
                    // Prevent key exfiltration via attacker-controlled api_base:
                    // - server key path: always force allowlisted default base
                    // - client key path: still require allowlist (400 if not)
                    const hasClientLlmKey = !!(
                        (body.deepseek_api_key && String(body.deepseek_api_key).trim()) ||
                        (body.openai_api_key && String(body.openai_api_key).trim())
                    );
                    if (!hasClientLlmKey && API_KEY) {
                        body.deepseek_api_key = API_KEY;
                        body.api_base = api.resolveLlmApiBase(null, { forceDefault: true });
                    } else if (body.api_base != null && String(body.api_base).trim()) {
                        const resolved = api.resolveLlmApiBase(body.api_base);
                        if (!resolved) {
                            api.sendError(res, 400, 'api_base is not allowed', 'API_BASE_FORBIDDEN');
                            return;
                        }
                        body.api_base = resolved;
                    } else if (hasClientLlmKey) {
                        body.api_base = DEFAULT_LLM_API_BASE;
                    }
                    // Only search active KBs (soft-deleted KB ids are dropped)
                    api.ensureKnowledgeBases(access.group);
                    const activeKbIds = new Set(
                        Object.values(access.group.knowledgeBases || {})
                            .filter(api.isActiveKb)
                            .map(k => k.id)
                    );
                    if (Array.isArray(body.kb_ids) && body.kb_ids.length) {
                        body.kb_ids = body.kb_ids
                            .map(id => api.normalizeKbId(id))
                            .filter(id => activeKbIds.has(id));
                        if (!body.kb_ids.length) {
                            // Client asked only for deleted/unknown KBs — empty answer, no RAG fan-out
                            api.sendJson(res, 200, {
                                answer: '抱歉，根據目前的知識庫資料，我無法回答此問題。',
                                sources: [],
                                citations: [],
                                retrieval_mode: 'none',
                                embedding_mode: 'none'
                            });
                            return;
                        }
                    } else {
                        body.kb_ids = [...activeKbIds];
                    }
                    // Sanitize document_ids to active docs; also pass filenames for legacy indexes
                    if (Array.isArray(body.document_ids) && body.document_ids.length) {
                        const activeDocs = (access.group.documents || []).filter(isActiveDocument);
                        const byId = new Map(activeDocs.map(d => [d.id, d]));
                        body.document_ids = body.document_ids
                            .map(id => String(id || '').trim())
                            .filter(id => byId.has(id))
                            .slice(0, 50);
                        if (!body.document_ids.length) {
                            api.sendJson(res, 200, {
                                answer: '抱歉，根據目前的知識庫資料，我無法回答此問題。',
                                sources: [],
                                citations: [],
                                retrieval_mode: 'none',
                                embedding_mode: 'none'
                            });
                            return;
                        }
                        body.document_filenames = body.document_ids
                            .map(id => api.getRagFilenameForDoc(byId.get(id)))
                            .filter(Boolean)
                            .slice(0, 50);
                    } else {
                        delete body.document_ids;
                        delete body.document_filenames;
                    }
                    const proxied = await api.proxyRagJson('/api/rag/query', body);
                    // Attach citations[] while keeping sources for compatibility
                    if (proxied.status >= 200 && proxied.status < 300) {
                        try {
                            const data = JSON.parse(proxied.text || '{}');
                            if (data && typeof data === 'object') {
                                data.citations = api.normalizeRagCitations(data.sources || data.citations, access.group);
                                if (!Array.isArray(data.sources)) data.sources = data.sources || [];
                                const out = JSON.stringify(data);
                                res.writeHead(proxied.status, { 'Content-Type': 'application/json' });
                                res.end(out);
                                return;
                            }
                        } catch (_) {
                            // fall through to raw proxy body
                        }
                    }
                    res.writeHead(proxied.status, { 'Content-Type': 'application/json' });
                    res.end(proxied.text);
                    return;
                }

                if (req.method === 'POST' && urlPath === '/api/rag/document/upload-text') {
                    const body = await api.readBody(req);
                    const access = await api.assertRagGroupAccess(body.group_code, aiAuth.user, { requireManager: true });
                    if (!access.ok) {
                        api.sendAccessResult(res, access);
                        return;
                    }
                    // Require active KB (auto_create default true for migration)
                    const storeForKb = await api.prepareStore(await loadStore());
                    const groupForKb = api.getGroup(storeForKb, body.group_code);
                    if (!groupForKb) {
                        api.sendError(res, 404, '找不到群組', 'GROUP_NOT_FOUND');
                        return;
                    }
                    const autoCreate = body.auto_create !== false && body.autoCreate !== false;
                    const kbResolve = api.resolveKbForWrite(groupForKb, body.kb_id || body.kbId || 'general', {
                        autoCreate,
                        createdByMemberId: access.member?.id || null,
                        createdByUserId: access.member?.userId || aiAuth.user?.id || null,
                        createdByName: access.member?.name || null
                    });
                    if (!kbResolve.ok) {
                        api.sendError(res, kbResolve.status, kbResolve.error, kbResolve.code);
                        return;
                    }
                    body.kb_id = kbResolve.kb.id;
                    if (kbResolve.created) await saveStore(storeForKb);

                    const lookup = {
                        documentId: body.document_id || body.documentId || null,
                        filename: body.filename || null,
                        title: body.title || null
                    };
                    const proxied = await api.proxyRagJson('/api/rag/document/upload-text', body);
                    let chunks = null;
                    let lastError = null;
                    if (proxied.status >= 200 && proxied.status < 300) {
                        try {
                            const data = JSON.parse(proxied.text || '{}');
                            chunks = data.chunks != null ? data.chunks : null;
                        } catch (_) {}
                        await api.persistDocumentRagStatus(body.group_code, lookup, 'indexed', { chunks, lastError: null });
                    } else {
                        try {
                            const data = JSON.parse(proxied.text || '{}');
                            lastError = data.detail || data.error || proxied.text || 'RAG index failed';
                        } catch (_) {
                            lastError = proxied.text || 'RAG index failed';
                        }
                        await api.persistDocumentRagStatus(body.group_code, lookup, 'failed', { lastError: String(lastError).slice(0, 500) });
                    }
                    res.writeHead(proxied.status, { 'Content-Type': 'application/json' });
                    res.end(proxied.text);
                    return;
                }

                if (req.method === 'POST' && urlPath === '/api/rag/document/upload') {
                    const body = await api.readBody(req);
                    const access = await api.assertRagGroupAccess(body.group_code, aiAuth.user, { requireManager: true });
                    if (!access.ok) {
                        api.sendAccessResult(res, access);
                        return;
                    }
                    if (!body.file_base64 || !body.filename) {
                        api.sendError(res, 400, '缺少 file_base64 或 filename', 'VALIDATION_ERROR');
                        return;
                    }
                    const storeForKb = await api.prepareStore(await loadStore());
                    const groupForKb = api.getGroup(storeForKb, body.group_code);
                    if (!groupForKb) {
                        api.sendError(res, 404, '找不到群組', 'GROUP_NOT_FOUND');
                        return;
                    }
                    const autoCreate = body.auto_create !== false && body.autoCreate !== false;
                    const kbResolve = api.resolveKbForWrite(groupForKb, body.kb_id || body.kbId || 'general', {
                        autoCreate,
                        createdByMemberId: access.member?.id || null,
                        createdByUserId: access.member?.userId || aiAuth.user?.id || null,
                        createdByName: access.member?.name || null
                    });
                    if (!kbResolve.ok) {
                        api.sendError(res, kbResolve.status, kbResolve.error, kbResolve.code);
                        return;
                    }
                    body.kb_id = kbResolve.kb.id;
                    if (kbResolve.created) await saveStore(storeForKb);

                    const lookup = {
                        documentId: body.document_id || body.documentId || null,
                        filename: body.filename || null,
                        title: body.title || null
                    };
                    const fileBuffer = Buffer.from(body.file_base64, 'base64');
                    const documentId = body.document_id || body.documentId || null;
                    const title = body.title || null;
                    const binResult = await api.proxyRagUploadBinaryIndex({
                        groupCode: body.group_code,
                        kbId: body.kb_id || 'general',
                        filename: body.filename,
                        fileBuffer,
                        documentId,
                        title
                    });
                    if (binResult.ok) {
                        await api.persistDocumentRagStatus(body.group_code, lookup, 'indexed', {
                            chunks: binResult.chunks,
                            lastError: null
                        });
                        api.sendJson(res, binResult.status || 200, {
                            ok: true,
                            chunks: binResult.chunks,
                            document_id: documentId,
                            filename: body.filename
                        });
                    } else {
                        await api.persistDocumentRagStatus(body.group_code, lookup, 'failed', {
                            lastError: String(binResult.lastError || 'RAG index failed').slice(0, 500)
                        });
                        api.sendJson(res, binResult.status || 500, {
                            ok: false,
                            error: binResult.lastError || 'RAG index failed'
                        });
                    }
                    return;
                }

                if (req.method === 'POST' && urlPath === '/api/rag/document/delete') {
                    const body = await api.readBody(req);
                    const access = await api.assertRagGroupAccess(body.group_code, aiAuth.user, { requireManager: true });
                    if (!access.ok) {
                        api.sendAccessResult(res, access);
                        return;
                    }
                    const form = new URLSearchParams();
                    form.set('group_code', body.group_code || '');
                    form.set('kb_id', body.kb_id || 'general');
                    form.set('filename', body.filename || '');
                    const response = await fetch(`${RAG_SERVICE_URL}/api/rag/document/delete`, {
                        method: 'POST',
                        headers: api.buildRagHeaders({ 'Content-Type': 'application/x-www-form-urlencoded' }),
                        body: form.toString()
                    });
                    const text = await response.text();
                    const lookup = {
                        documentId: body.document_id || body.documentId || null,
                        filename: body.filename || null
                    };
                    if (response.ok || response.status === 404) {
                        const store = await api.prepareStore(await loadStore());
                        const group = api.getGroup(store, body.group_code);
                        const doc = api.findGroupDocument(group, lookup);
                        if (doc) {
                            doc.ragStatus = 'deleted';
                            doc.rag = {
                                ...(doc.rag && typeof doc.rag === 'object' ? doc.rag : {}),
                                status: 'deleted',
                                lastError: null
                            };
                            if (body.soft_delete || body.softDelete) {
                                doc.status = 'deleted';
                                doc.deletedAt = doc.deletedAt || new Date().toISOString();
                            }
                            await saveStore(store);
                        }
                    } else {
                        let lastError = text;
                        try {
                            const data = JSON.parse(text || '{}');
                            lastError = data.detail || data.error || text;
                        } catch (_) {}
                        await api.persistDocumentRagStatus(body.group_code, lookup, 'failed', {
                            lastError: String(lastError).slice(0, 500)
                        });
                    }
                    res.writeHead(response.status, { 'Content-Type': 'application/json' });
                    res.end(text);
                    return;
                }

                api.sendJson(res, 404, { error: 'RAG route not found' });
            } catch (err) {
                api.handleRouteError(res, err, 'RAG 代理失敗');
            }
            return;
        }

        if (req.method === 'POST' && urlPath === '/api/chat') {
            const aiAuth = await api.requireAiAuth(req);
            if (!aiAuth.ok) {
                api.sendJson(res, aiAuth.status, { error: aiAuth.error });
                return;
            }
            if (!API_KEY) {
                api.sendJson(res, 500, { error: 'Missing DEEPSEEK_API_KEY environment variable' });
                return;
            }
            const aiUserId = aiAuth.user?.id || api.getClientIp(req);
            if (!api.checkAiRateLimit(aiUserId)) {
                api.sendJson(res, 429, { error: 'AI 請求過於頻繁，請稍後再試' });
                return;
            }
            try {
                const rawBody = await api.readBody(req);
                const body = api.sanitizeChatBody(rawBody);
                if (!body) {
                    api.sendJson(res, 400, { error: '無效的 AI 請求格式' });
                    return;
                }
                const response = await fetch(DEEPSEEK_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${API_KEY}`
                    },
                    body: JSON.stringify(body)
                });
                const text = await response.text();
                res.writeHead(response.status, { 'Content-Type': 'application/json' });
                res.end(text);
            } catch (err) {
                api.handleRouteError(res, err, 'AI 請求失敗');
            }
            return;
        }

        api.sendJson(res, 404, { error: 'Not found' });
    }

    function createServer() {
        return http.createServer(async (req, res) => {
            try {
                await dispatchRequest(req, res);
            } catch (err) {
                api.handleRouteError(res, err);
            }
        });
    }

    Object.assign(api, {
        dispatchRequest,
        createServer
    });
}

module.exports = { register };
