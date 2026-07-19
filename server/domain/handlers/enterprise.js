/**
 * server/domain/handlers/enterprise
 * 任務：HTTP：/api/enterprise/*
 * 透過 register(api) 掛載到共享 api 物件（跨域呼叫 api.fn）
 */
'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../../config');
const {
    PORT, API_KEY, DEEPSEEK_URL, RAG_SERVICE_URL, RAG_API_KEY, IS_PRODUCTION, REQUIRE_ENTERPRISE_AUTH, ALLOW_ANONYMOUS_AI, DATA_FILE, PIN_SALT, MAX_BODY_BYTES, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX, AUTH_RATE_LIMIT_MAX, PIN_MAX_ATTEMPTS, PIN_LOCK_MS, AI_RATE_LIMIT_MAX, AI_RATE_LIMIT_WINDOW_MS, DEFAULT_LLM_API_BASE, ALLOWED_LLM_API_BASES, MAX_UPLOAD_BYTES, ALLOWED_UPLOAD_EXT, WEAK_PINS, UPLOADS_DIR, ALLOWED_ORIGINS, RAG_INDEX_TIMEOUT_MS, RAG_INDEX_MAX_ATTEMPTS, RAG_INDEX_EVENT_LIMIT, serviceStartedAt, enforceProductionSecrets
} = config;
const { loadStore, saveStore } = require('../../../lib/enterprise-store');
const { withLock } = require('../../../lib/write-queue');

/** @param {Record<string, Function>} api */
function register(api) {
    async function handleEnterprise(req, res, urlPath, method) {
        const store = await api.prepareStore(await loadStore());

        if (method === 'POST' && urlPath === '/api/enterprise/group/create') {
            return api.readBody(req).then(async body => {
                const code = api.normalizeCode(body.code);
                const name = api.clampText(body.name, 80) || '未命名團隊';
                const managerName = api.clampText(body.managerName, 80);
                const managerPin = api.clampText(body.managerPin, 32);

                if (!code || code.length < 4) {
                    return api.sendJson(res, 400, { error: '群組代碼至少 4 個字元' });
                }
                if (!managerName) {
                    return api.sendJson(res, 400, { error: '請輸入主管名稱' });
                }
                if (!api.isValidManagerPin(managerPin)) {
                    return api.sendJson(res, 400, { error: '請設定 4–32 位主管 PIN，且不可使用常見弱密碼' });
                }
                if (store.groups[code]) {
                    return api.sendJson(res, 409, { error: '此群組代碼已存在' });
                }

                const authUser = await api.getOptionalAuth(req);
                const managerId = api.uid();
                store.groups[code] = {
                    code,
                    name,
                    managerPinHash: await api.hashPin(managerPin),
                    createdAt: new Date().toISOString(),
                    members: [{
                        id: managerId,
                        name: managerName,
                        role: 'manager',
                        userId: authUser?.id || null,
                        joinedAt: new Date().toISOString()
                    }],
                    tasks: [],
                    notifications: [],
                    documents: [],
                    knowledgeBases: {
                        general: api.createKbRecord('general', {
                            displayName: '一般預設',
                            description: '預設知識庫',
                            createdByMemberId: managerId,
                            createdByUserId: authUser?.id || null,
                            createdByName: managerName
                        })
                    }
                };
                await saveStore(store);

                api.sendJson(res, 200, {
                    ok: true,
                    group: { code, name },
                    member: { id: managerId, name: managerName, role: 'manager' }
                });
            });
        }

        if (method === 'POST' && urlPath === '/api/enterprise/group/join') {
            return api.readBody(req).then(async body => {
                const code = api.normalizeCode(body.code);
                const name = api.clampText(body.name, 80);
                const role = body.role === 'manager' ? 'manager' : 'member';
                const pin = api.clampText(body.pin, 32);
                const clientIp = api.getClientIp(req);

                const group = api.getGroup(store, code);
                if (!group) {
                    return api.sendJson(res, 404, { error: '找不到此群組代碼' });
                }
                if (!name) {
                    return api.sendJson(res, 400, { error: '請輸入你的名稱' });
                }
                if (role === 'manager') {
                    if (api.isPinLocked(code, clientIp)) {
                        return api.sendJson(res, 429, { error: '主管金鑰嘗試次數過多，請 15 分鐘後再試' });
                    }
                    if (!(await api.verifyManagerPin(group, pin))) {
                        api.recordPinFailure(code, clientIp);
                        return api.sendJson(res, 403, { error: '主管金鑰錯誤' });
                    }
                    api.clearPinFailures(code, clientIp);
                }

                await api.migrateGroupPin(group);

                const authUser = await api.getOptionalAuth(req);
                if (authUser) {
                    const byUser = group.members.find(m => m.userId === authUser.id);
                    if (byUser) {
                        await saveStore(store);
                        return api.sendJson(res, 200, {
                            ok: true,
                            group: { code: group.code, name: group.name },
                            member: byUser
                        });
                    }
                }

                const existing = group.members.find(m => m.name.toLowerCase() === name.toLowerCase());
                if (existing) {
                    if (existing.userId && authUser?.id && existing.userId !== authUser.id) {
                        return api.sendJson(res, 403, { error: '此名稱已綁定其他帳號，請使用已註冊帳號登入' });
                    }
                    if (authUser?.id && !existing.userId) {
                        existing.userId = authUser.id;
                    }
                    await saveStore(store);
                    return api.sendJson(res, 200, {
                        ok: true,
                        group: { code: group.code, name: group.name },
                        member: existing
                    });
                }

                const member = {
                    id: api.uid(),
                    name,
                    role,
                    userId: authUser?.id || null,
                    joinedAt: new Date().toISOString()
                };
                group.members.push(member);
                await saveStore(store);

                api.sendJson(res, 200, {
                    ok: true,
                    group: { code: group.code, name: group.name },
                    member
                });
            });
        }

        // ── Multi-group: list memberships for logged-in user ──
        if (method === 'GET' && urlPath === '/api/enterprise/memberships') {
            const authUser = await api.requireAuth(req);
            if (!authUser) {
                return api.sendJson(res, 401, { error: '請先登入' });
            }
            const memberships = api.listMembershipsForUser(store, authUser.id);
            return api.sendJson(res, 200, {
                ok: true,
                memberships,
                count: memberships.length
            });
        }

        // ── Leave group (self) ──
        if (method === 'POST' && urlPath === '/api/enterprise/group/leave') {
            return api.readBody(req).then(async (body) => {
                const code = api.normalizeCode(body.groupCode || body.code);
                const memberId = body.memberId;
                const group = api.getGroup(store, code);
                if (!group) {
                    return api.sendJson(res, 404, { error: '找不到群組', code: 'GROUP_NOT_FOUND' });
                }
                const authUser = await api.getOptionalAuth(req);
                // Resolve by JWT userId first; stale memberId is OK
                const memberCheck = await api.assertEnterpriseMember(group, memberId, authUser, { store });
                if (!memberCheck.ok) {
                    return api.sendJson(res, memberCheck.status || 403, {
                        error: memberCheck.error || '無權退出此群組',
                        code: memberCheck.code || 'GROUP_FORBIDDEN'
                    });
                }
                const member = memberCheck.member;
                // Leave always allowed (sole manager → auto-promote); kick still guarded elsewhere
                const can = api.assertCanRemoveMember(group, member, { isKick: false });
                if (!can.ok) {
                    return api.sendJson(res, can.status || 409, { error: can.error, code: can.code });
                }

                // Notify remaining managers
                const remainingManagers = group.members.filter(
                    (m) => m.role === 'manager' && m.id !== member.id
                );
                for (const mgr of remainingManagers) {
                    api.pushNotification(group, {
                        type: 'member_left',
                        recipientId: mgr.id,
                        title: '成員退出',
                        message: `${member.name} 已退出群組`,
                        actorId: member.id,
                        actorName: member.name
                    });
                }

                const result = api.removeMemberFromGroup(group, member.id);
                if (!result.ok) {
                    return api.sendJson(res, 404, { error: '找不到成員', code: 'MEMBER_NOT_FOUND' });
                }
                await saveStore(store);
                return api.sendJson(res, 200, {
                    ok: true,
                    left: {
                        groupCode: group.code,
                        groupName: group.name,
                        memberId: member.id
                    },
                    groupEmpty: !!result.groupEmpty,
                    promoted: result.promoted
                        ? { id: result.promoted.id, name: result.promoted.name, role: 'manager' }
                        : null
                });
            });
        }

        // ── Kick member (manager only) ──
        if (method === 'POST' && urlPath === '/api/enterprise/group/kick') {
            return api.readBody(req).then(async (body) => {
                const code = api.normalizeCode(body.groupCode || body.code);
                const managerId = body.managerId;
                const targetMemberId = body.targetMemberId || body.memberId;
                const group = api.getGroup(store, code);
                if (!group) {
                    return api.sendJson(res, 404, { error: '找不到群組', code: 'GROUP_NOT_FOUND' });
                }
                if (!targetMemberId) {
                    return api.sendJson(res, 400, { error: '請指定要移除的成員', code: 'VALIDATION_ERROR' });
                }
                if (managerId && targetMemberId === managerId) {
                    return api.sendJson(res, 400, {
                        error: '不能移除自己，請使用「退出群組」',
                        code: 'USE_LEAVE'
                    });
                }

                const authUser = await api.getOptionalAuth(req);
                const managerCheck = await api.assertEnterpriseMember(group, managerId, authUser, { store });
                if (!managerCheck.ok) {
                    return api.sendJson(res, managerCheck.status || 403, {
                        error: managerCheck.error || '無權操作',
                        code: managerCheck.code || 'GROUP_FORBIDDEN'
                    });
                }
                if (managerCheck.member.role !== 'manager') {
                    return api.sendJson(res, 403, { error: '僅主管可移除成員', code: 'ROLE_FORBIDDEN' });
                }

                const target = group.members.find((m) => m.id === targetMemberId);
                if (!target) {
                    return api.sendJson(res, 404, { error: '找不到該成員', code: 'MEMBER_NOT_FOUND' });
                }
                const can = api.assertCanRemoveMember(group, target, { isKick: true });
                if (!can.ok) {
                    return api.sendJson(res, can.status || 409, { error: can.error, code: can.code });
                }

                // Notify target (if still in list) and managers
                api.pushNotification(group, {
                    type: 'member_kicked',
                    recipientId: target.id,
                    title: '已移出群組',
                    message: `你已被移出群組「${group.name}」`,
                    actorId: managerCheck.member.id,
                    actorName: managerCheck.member.name
                });
                for (const mgr of group.members.filter((m) => m.role === 'manager' && m.id !== managerCheck.member.id)) {
                    api.pushNotification(group, {
                        type: 'member_kicked',
                        recipientId: mgr.id,
                        title: '成員被移除',
                        message: `${managerCheck.member.name} 已將 ${target.name} 移出群組`,
                        actorId: managerCheck.member.id,
                        actorName: managerCheck.member.name
                    });
                }

                const result = api.removeMemberFromGroup(group, target.id);
                if (!result.ok) {
                    return api.sendJson(res, 404, { error: '找不到成員', code: 'MEMBER_NOT_FOUND' });
                }
                await saveStore(store);
                return api.sendJson(res, 200, {
                    ok: true,
                    kicked: {
                        groupCode: group.code,
                        groupName: group.name,
                        memberId: target.id,
                        name: target.name
                    }
                });
            });
        }

        const groupMatch = urlPath.match(/^\/api\/enterprise\/group\/([A-Za-z0-9]+)$/);
        if (method === 'GET' && groupMatch) {
            const group = api.getGroup(store, groupMatch[1]);
            if (!group) {
                return api.sendJson(res, 404, { error: '找不到群組' });
            }
            api.ensureNotifications(group);
            const query = api.parseQuery(req);
            const memberId = query.get('memberId');
            if (!memberId) {
                return api.sendJson(res, 403, { error: '需要有效的 memberId 才能讀取群組資料' });
            }
            const authUser = await api.getOptionalAuth(req);
            const memberCheck = await api.assertEnterpriseMember(group, memberId, authUser, { store });
            if (!memberCheck.ok) {
                return api.sendJson(res, memberCheck.status, {
                    error: memberCheck.error,
                    code: memberCheck.code || 'GROUP_FORBIDDEN'
                });
            }
            // Use server-resolved member id (fixes stale localStorage memberId)
            const resolvedMemberId = memberCheck.member.id;
            const payload = {
                code: group.code,
                name: group.name,
                members: group.members,
                tasks: group.tasks,
                documents: (group.documents || []).filter(
                    (d) => (typeof api.isActiveDocument === 'function' ? api.isActiveDocument(d) : d && d.status !== 'deleted')
                ),
                notifications: group.notifications
                    .filter(n => n.recipientId === resolvedMemberId)
                    .slice(0, 50),
                unreadCount: group.notifications
                    .filter(n => n.recipientId === resolvedMemberId && !n.read).length
            };
            api.sendJson(res, 200, {
                ok: true,
                group: payload,
                member: {
                    id: memberCheck.member.id,
                    name: memberCheck.member.name,
                    role: memberCheck.member.role,
                    userId: memberCheck.member.userId || null
                }
            });
            return;
        }

        if (method === 'POST' && urlPath === '/api/enterprise/group/document/add') {
            return api.readBody(req).then(async body => {
                const code = api.normalizeCode(body.groupCode);
                const managerId = body.managerId;
                const title = api.clampText(body.title, 100) || body.filename || '未命名文件';
                const content = api.clampText(body.content, 10000);
                const docType = api.clampText(body.docType, 10) || 'text';

                const group = api.getGroup(store, code);
                if (!group) return api.sendJson(res, 404, { error: '找不到群組' });

                const authUser = await api.getOptionalAuth(req);
                const memberCheck = await api.assertEnterpriseMember(group, managerId, authUser, { store });
                if (!memberCheck.ok) {
                    return api.sendError(res, memberCheck.status || 403, memberCheck.error, memberCheck.code || 'GROUP_FORBIDDEN');
                }
                if (memberCheck.member.role !== 'manager') {
                    return api.sendError(res, 403, '僅主管可管理知識庫', 'ROLE_FORBIDDEN');
                }
                const manager = memberCheck.member;

                if (docType === 'text' && (!title || !content)) {
                    return api.sendJson(res, 400, { error: '請輸入標題與內容', code: 'VALIDATION_ERROR' });
                }
                if (!title) {
                    return api.sendJson(res, 400, { error: '請輸入標題', code: 'VALIDATION_ERROR' });
                }

                let fileUrl = null;
                if ((docType === 'pdf' || docType === 'image' || docType === 'excel') && body.fileData && body.filename) {
                    try {
                        const fileBuffer = Buffer.from(body.fileData, 'base64');
                        const ext = (path.extname(body.filename) || (docType === 'pdf' ? '.pdf' : docType === 'excel' ? '.xlsx' : '.png')).toLowerCase();
                        if (!ALLOWED_UPLOAD_EXT.has(ext)) {
                            return api.sendJson(res, 400, { error: '不支援的檔案類型', code: 'VALIDATION_ERROR' });
                        }
                        if (fileBuffer.length > MAX_UPLOAD_BYTES) {
                            return api.sendJson(res, 400, { error: '檔案過大（上限 5MB）', code: 'VALIDATION_ERROR' });
                        }
                        const safeBase = path.basename(body.filename, ext).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
                        const uniqueFilename = `${api.uid()}-${safeBase}${ext}`;
                        const filePath = path.join(UPLOADS_DIR, uniqueFilename);
                        fs.writeFileSync(filePath, fileBuffer);
                        fileUrl = `/uploads/${uniqueFilename}`;
                    } catch (e) {
                        return api.sendJson(res, 500, { error: '檔案儲存失敗: ' + e.message });
                    }
                }

                if (!group.documents) group.documents = [];
                const autoCreate = body.auto_create !== false && body.autoCreate !== false;
                const kbResolve = api.resolveKbForWrite(group, body.kbId || body.kb_id || 'general', {
                    autoCreate,
                    createdByMemberId: manager.id,
                    createdByUserId: manager.userId || authUser?.id || null,
                    createdByName: manager.name
                });
                if (!kbResolve.ok) {
                    return api.sendError(res, kbResolve.status, kbResolve.error, kbResolve.code);
                }
                const nowIso = new Date().toISOString();
                const doc = {
                    id: api.uid(),
                    title,
                    content, // represents extractedText or description for files
                    docType,
                    fileUrl,
                    filename: body.filename || null,
                    kbId: kbResolve.kb.id,
                    author: manager.name,
                    authorMemberId: manager.id,
                    createdAt: nowIso,
                    updatedAt: nowIso,
                    // W2-F: version history starts at v1
                    currentVersion: 1,
                    versions: [],
                    status: 'active',
                    deletedAt: null,
                    // D2: Enterprise success first; RAG index may lag
                    ragStatus: 'pending',
                    rag: {
                        status: 'pending',
                        lastIndexedAt: null,
                        lastError: null,
                        refDocId: null,
                        chunks: null
                    }
                };
                api.ensureDocumentVersions(doc, {
                    createdByMemberId: manager.id,
                    createdByName: manager.name,
                    changeNote: api.clampText(body.changeNote, 200) || 'initial'
                });
                group.documents.unshift(doc);
                api.ensureKnowledgeBases(group);
                await saveStore(store);

                // W2-C: server-side RAG orchestration after enterprise metadata is durable.
                // Sync await within RAG_INDEX_TIMEOUT_MS; timeout → pending + background finish.
                let fileBuffer = null;
                if (body.fileData && typeof body.fileData === 'string') {
                    try {
                        fileBuffer = Buffer.from(body.fileData, 'base64');
                    } catch (_) {
                        fileBuffer = null;
                    }
                }
                const ragOrchestration = await api.orchestrateDocumentRagIndex(code, doc, {
                    fileData: body.fileData || null,
                    fileBuffer,
                    kbId: doc.kbId
                });

                api.sendJson(res, 200, api.buildRagOrchestrationResponse(ragOrchestration, doc));
            });
        }

        // Wave 3: poll single document ragStatus (group members)
        if (
            (method === 'GET' && urlPath === '/api/enterprise/group/document/status')
            || (method === 'POST' && urlPath === '/api/enterprise/group/document/status')
        ) {
            return Promise.resolve().then(async () => {
                const q = api.parseQuery(req);
                let body = {};
                if (method === 'POST') {
                    try { body = await api.readBody(req); } catch (_) { body = {}; }
                }
                const code = api.normalizeCode(body.groupCode || q.get('groupCode') || q.get('group_code'));
                const memberId = body.memberId || q.get('memberId') || '';
                const docId = body.documentId || body.document_id || q.get('documentId') || q.get('document_id') || '';

                const group = api.getGroup(store, code);
                if (!group) return api.sendError(res, 404, '找不到群組', 'GROUP_NOT_FOUND');

                const authUser = await api.getOptionalAuth(req);
                const memberCheck = await api.assertEnterpriseMember(group, memberId, authUser, { store, bind: false });
                if (!memberCheck.ok) {
                    return api.sendError(res, memberCheck.status || 403, memberCheck.error, memberCheck.code || 'GROUP_FORBIDDEN');
                }
                if (!docId) return api.sendError(res, 400, '缺少 documentId', 'VALIDATION_ERROR');

                const doc = api.findGroupDocument(group, { documentId: docId });
                if (!doc) return api.sendError(res, 404, '找不到該文件', 'DOC_NOT_FOUND');

                const rag = doc.rag && typeof doc.rag === 'object' ? doc.rag : {};
                const status = doc.ragStatus || rag.status || 'pending';
                api.sendJson(res, 200, {
                    ok: true,
                    documentId: doc.id,
                    title: doc.title || null,
                    ragStatus: status,
                    currentVersion: doc.currentVersion || 1,
                    lastError: rag.lastError || null,
                    lastErrorCode: rag.lastErrorCode || null,
                    lastErrorCategory: rag.lastErrorCategory || null,
                    retryable: rag.retryable != null ? rag.retryable : null,
                    lastIndexedAt: rag.lastIndexedAt || null,
                    chunks: rag.chunks != null ? rag.chunks : null,
                    indexing: api.ragBackgroundIndexJobs.has(`${code}:${doc.id}`)
                });
            });
        }

        // 活的 SOP：文件 → 可執行步驟（成員皆可；contentHash 快取，發新版自動重編）
        if (method === 'POST' && urlPath === '/api/enterprise/group/document/plan') {
            return api.readBody(req).then(async body => {
                const code = api.normalizeCode(body.groupCode);
                const group = api.getGroup(store, code);
                if (!group) return api.sendError(res, 404, '找不到群組', 'GROUP_NOT_FOUND');
                const authUser = await api.getOptionalAuth(req);
                const memberCheck = await api.assertEnterpriseMember(group, body.memberId, authUser, { store, bind: false });
                if (!memberCheck.ok) {
                    return api.sendError(res, memberCheck.status || 403, memberCheck.error, memberCheck.code || 'GROUP_FORBIDDEN');
                }
                const doc = api.findGroupDocument(group, { documentId: body.documentId || body.document_id });
                if (!doc || !api.isActiveDocument(doc)) {
                    return api.sendError(res, 404, '找不到該文件', 'DOC_NOT_FOUND');
                }
                const result = await api.compileDocumentPlan(doc, {
                    apiKey: body.deepseek_api_key || body.deepseekApiKey || null
                });
                if (result.error) return api.sendError(res, 422, result.error, result.code);
                if (!result.cached) await saveStore(store);
                api.sendJson(res, 200, { ok: true, documentId: doc.id, cached: result.cached, plan: result.plan });
            });
        }

        // 活的 SOP：步驟事件（run/done/stuck）匿名累計到 doc.sopStats（按版本分桶）
        if (method === 'POST' && urlPath === '/api/enterprise/group/document/sop-event') {
            return api.readBody(req).then(async body => {
                const code = api.normalizeCode(body.groupCode);
                const group = api.getGroup(store, code);
                if (!group) return api.sendError(res, 404, '找不到群組', 'GROUP_NOT_FOUND');
                const authUser = await api.getOptionalAuth(req);
                const memberCheck = await api.assertEnterpriseMember(group, body.memberId, authUser, { store, bind: false });
                if (!memberCheck.ok) {
                    return api.sendError(res, memberCheck.status || 403, memberCheck.error, memberCheck.code || 'GROUP_FORBIDDEN');
                }
                const doc = api.findGroupDocument(group, { documentId: body.documentId || body.document_id });
                if (!doc || !api.isActiveDocument(doc)) {
                    return api.sendError(res, 404, '找不到該文件', 'DOC_NOT_FOUND');
                }
                const result = api.recordSopEvent(doc, { step: body.step, event: String(body.event || '') });
                if (result.error) return api.sendError(res, 400, result.error, result.code);
                await saveStore(store);
                api.sendJson(res, 200, { ok: true, documentId: doc.id, stats: result.stats });
            });
        }

        if (method === 'POST' && urlPath === '/api/enterprise/group/document/reindex') {
            return api.readBody(req).then(async body => {
                const code = api.normalizeCode(body.groupCode);
                const managerId = body.managerId;
                const docId = body.documentId || body.document_id;

                const group = api.getGroup(store, code);
                if (!group) return api.sendError(res, 404, '找不到群組', 'GROUP_NOT_FOUND');

                const authUser = await api.getOptionalAuth(req);
                const memberCheck = await api.assertEnterpriseMember(group, managerId, authUser, { store });
                if (!memberCheck.ok) {
                    return api.sendError(res, memberCheck.status || 403, memberCheck.error, memberCheck.code || 'GROUP_FORBIDDEN');
                }
                if (memberCheck.member.role !== 'manager') {
                    return api.sendError(res, 403, '僅主管可管理知識庫', 'ROLE_FORBIDDEN');
                }
                if (!docId) {
                    return api.sendError(res, 400, '缺少 documentId', 'VALIDATION_ERROR');
                }

                const doc = api.findGroupDocument(group, { documentId: docId });
                if (!doc || !api.isActiveDocument(doc)) {
                    return api.sendError(res, 404, '找不到該文件', 'DOC_NOT_FOUND');
                }

                api.setDocumentRagStatus(doc, 'pending', { lastError: null });
                await saveStore(store);

                const ragOrchestration = await api.orchestrateDocumentRagIndex(code, doc, {
                    kbId: doc.kbId
                });

                const payload = api.buildRagOrchestrationResponse(ragOrchestration, doc);
                payload.ok = ragOrchestration.ragOk !== false || !!ragOrchestration.ragPending;
                api.sendJson(res, 200, payload);
            });
        }

        if (method === 'POST' && urlPath === '/api/enterprise/group/document/delete') {
            return api.readBody(req).then(async body => {
                const code = api.normalizeCode(body.groupCode);
                const managerId = body.managerId;
                const docId = body.documentId;

                const group = api.getGroup(store, code);
                if (!group) return api.sendError(res, 404, '找不到群組', 'GROUP_NOT_FOUND');

                const authUser = await api.getOptionalAuth(req);
                const memberCheck = await api.assertEnterpriseMember(group, managerId, authUser, { store });
                if (!memberCheck.ok) {
                    return api.sendError(res, memberCheck.status || 403, memberCheck.error, memberCheck.code || 'GROUP_FORBIDDEN');
                }
                if (memberCheck.member.role !== 'manager') {
                    return api.sendError(res, 403, '僅主管可管理知識庫', 'ROLE_FORBIDDEN');
                }

                if (!group.documents) group.documents = [];
                const index = group.documents.findIndex(d => d.id === docId && api.isActiveDocument(d));
                if (index === -1) return api.sendError(res, 404, '找不到該文件', 'DOC_NOT_FOUND');

                const doc = group.documents[index];
                const kbId = doc.kbId || 'general';
                const ragFilename = api.getRagFilenameForDoc(doc);

                // Always attempt index cleanup before metadata soft-delete (D2 consistency).
                // If cleanup fails, do NOT soft-delete — keep doc list-visible so manager can retry.
                let ragDeleteOk = true;
                let ragDeleteError = null;
                if (ragFilename) {
                    const ragResult = await api.proxyRagDeleteIndex(code, kbId, ragFilename);
                    ragDeleteOk = ragResult.ok;
                    if (!ragDeleteOk) {
                        ragDeleteError = ragResult.text || 'RAG index delete failed';
                        console.warn('[Lumina Backend] RAG index delete failed:', ragDeleteError);
                        api.setDocumentRagStatus(doc, 'failed', {
                            lastError: ragDeleteError || '知識庫索引清除失敗，請重試刪除'
                        });
                        await saveStore(store);
                        return api.sendJson(res, 200, {
                            ok: false,
                            ragDeleteOk: false,
                            ragStatus: doc.ragStatus,
                            warning: '知識庫索引清除失敗，文件仍保留於列表，請重試刪除',
                            error: '知識庫索引清除失敗，請重試刪除'
                        });
                    }
                }

                if (doc.fileUrl) {
                    try {
                        const baseName = path.basename(doc.fileUrl);
                        const filePath = path.join(UPLOADS_DIR, baseName);
                        if (fs.existsSync(filePath)) {
                            fs.unlinkSync(filePath);
                        }
                    } catch (e) {
                        console.warn('[Lumina Backend] 檔案刪除失敗:', e.message);
                    }
                }

                // Soft-delete only after RAG index cleanup succeeded (or no filename to purge)
                doc.status = 'deleted';
                doc.deletedAt = new Date().toISOString();
                api.setDocumentRagStatus(doc, 'deleted', { lastError: null });

                await saveStore(store);

                api.sendJson(res, 200, {
                    ok: true,
                    ragDeleteOk: true,
                    ragStatus: doc.ragStatus
                });
            });
        }

        // ── W2-F: publish new document version (manager only) ──
        // RAG: overwrite single active index with latest content (no multi-version vectors).
        if (method === 'POST' && urlPath === '/api/enterprise/group/document/version') {
            return api.readBody(req).then(async body => {
                const code = api.normalizeCode(body.groupCode);
                const managerId = body.managerId;
                const docId = body.documentId || body.document_id;

                const group = api.getGroup(store, code);
                if (!group) return api.sendError(res, 404, '找不到群組', 'GROUP_NOT_FOUND');

                const authUser = await api.getOptionalAuth(req);
                const memberCheck = await api.assertEnterpriseMember(group, managerId, authUser, { store });
                if (!memberCheck.ok) {
                    return api.sendError(res, memberCheck.status || 403, memberCheck.error, memberCheck.code || 'GROUP_FORBIDDEN');
                }
                if (memberCheck.member.role !== 'manager') {
                    return api.sendError(res, 403, '僅主管可管理知識庫', 'ROLE_FORBIDDEN');
                }
                if (!docId) {
                    return api.sendError(res, 400, '缺少 documentId', 'VALIDATION_ERROR');
                }

                const doc = api.findGroupDocument(group, { documentId: docId });
                if (!doc || !api.isActiveDocument(doc)) {
                    return api.sendError(res, 404, '找不到該文件', 'DOC_NOT_FOUND');
                }

                api.ensureDocumentVersions(doc, {
                    createdByMemberId: doc.authorMemberId || null,
                    createdByName: doc.author || null
                });

                const manager = memberCheck.member;
                const prevRagFilename = api.getRagFilenameForDoc(doc);

                // Merge fields: omitted fields keep current document values
                const nextTitle = body.title != null
                    ? (api.clampText(body.title, 100) || doc.title)
                    : doc.title;
                const nextDocType = body.docType != null
                    ? (api.clampText(body.docType, 10) || doc.docType || 'text')
                    : (doc.docType || 'text');
                let nextContent = body.content != null
                    ? api.clampText(body.content, 10000)
                    : doc.content;
                const changeNote = api.clampText(body.changeNote, 200) || null;

                if (nextDocType === 'text' && body.content !== undefined && !String(nextContent || '').trim()) {
                    return api.sendError(res, 400, '請輸入文件內容', 'VALIDATION_ERROR');
                }
                if (body.title !== undefined && !String(nextTitle || '').trim()) {
                    return api.sendError(res, 400, '請輸入標題', 'VALIDATION_ERROR');
                }

                const upload = api.trySaveDocumentUpload(body, nextDocType);
                if (!upload.ok) {
                    return api.sendError(res, 400, upload.error || '檔案儲存失敗', upload.code || 'VALIDATION_ERROR');
                }

                let nextFileUrl = doc.fileUrl || null;
                let nextFilename = doc.filename || null;
                if (upload.fileUrl) {
                    nextFileUrl = upload.fileUrl;
                    nextFilename = upload.filename || body.filename || nextFilename;
                } else if (body.filename != null && body.filename !== '') {
                    nextFilename = api.clampText(body.filename, 200) || nextFilename;
                }

                const nextVersion = (Number(doc.currentVersion) || 1) + 1;
                const nowIso = new Date().toISOString();
                const snapshot = api.buildDocumentVersionSnapshot(doc, {
                    version: nextVersion,
                    title: nextTitle,
                    content: nextContent,
                    filename: nextFilename,
                    fileUrl: nextFileUrl,
                    docType: nextDocType,
                    createdAt: nowIso,
                    createdByMemberId: manager.id,
                    createdByName: manager.name,
                    changeNote
                });

                doc.versions.push(snapshot);
                doc.currentVersion = nextVersion;
                doc.title = nextTitle;
                doc.content = nextContent;
                doc.docType = nextDocType;
                doc.filename = nextFilename;
                doc.fileUrl = nextFileUrl;
                doc.updatedAt = nowIso;
                doc.author = manager.name;
                doc.authorMemberId = manager.id;
                api.setDocumentRagStatus(doc, 'pending', { lastError: null });

                await saveStore(store);

                // If RAG index key would change, best-effort purge old key before reindex
                const nextRagFilename = api.getRagFilenameForDoc(doc);
                if (prevRagFilename && nextRagFilename && prevRagFilename !== nextRagFilename) {
                    await api.proxyRagDeleteIndex(code, doc.kbId || 'general', prevRagFilename);
                }

                let fileBuffer = upload.fileBuffer || null;
                if (!fileBuffer && body.fileData && typeof body.fileData === 'string') {
                    try {
                        fileBuffer = Buffer.from(body.fileData, 'base64');
                    } catch (_) {
                        fileBuffer = null;
                    }
                }

                const ragOrchestration = await api.orchestrateDocumentRagIndex(code, doc, {
                    fileData: body.fileData || null,
                    fileBuffer,
                    kbId: doc.kbId
                });

                api.sendJson(res, 200, {
                    ...api.buildRagOrchestrationResponse(ragOrchestration, doc),
                    currentVersion: doc.currentVersion
                });
            });
        }

        // ── W2-F: list document versions (group members, no full content) ──
        if (
            (method === 'GET' && urlPath === '/api/enterprise/group/document/versions')
            || (method === 'POST' && urlPath === '/api/enterprise/group/document/versions')
        ) {
            const handleListVersions = async (body = {}) => {
                const query = method === 'GET' ? api.parseQuery(req) : null;
                const code = api.normalizeCode(
                    (query && (query.get('groupCode') || query.get('group_code'))) || body.groupCode || body.group_code
                );
                const docId = (query && (query.get('documentId') || query.get('document_id')))
                    || body.documentId || body.document_id;
                const memberId = (query && (query.get('memberId') || query.get('member_id')))
                    || body.memberId || body.member_id;

                if (!code) return api.sendError(res, 400, '缺少 groupCode', 'VALIDATION_ERROR');
                if (!docId) return api.sendError(res, 400, '缺少 documentId', 'VALIDATION_ERROR');

                const group = api.getGroup(store, code);
                if (!group) return api.sendError(res, 404, '找不到群組', 'GROUP_NOT_FOUND');

                const access = await api.assertDocumentReadAccess(req, store, group, { memberId, groupCode: code });
                if (!access.ok) {
                    return api.sendError(res, access.status, access.error, access.code);
                }

                // History is readable for soft-deleted docs too (audit); prefer active match
                let doc = api.findGroupDocument(group, { documentId: docId });
                if (!doc) {
                    doc = (group.documents || []).find(d => d.id === docId) || null;
                }
                if (!doc) return api.sendError(res, 404, '找不到該文件', 'DOC_NOT_FOUND');

                api.ensureDocumentVersions(doc, {
                    createdByMemberId: doc.authorMemberId || null,
                    createdByName: doc.author || null
                });
                // Persist lazy migration so subsequent reads are consistent
                await saveStore(store);

                const versions = (doc.versions || [])
                    .slice()
                    .sort((a, b) => (Number(b.version) || 0) - (Number(a.version) || 0))
                    .map(api.summarizeVersionMeta)
                    .filter(Boolean);

                api.sendJson(res, 200, {
                    ok: true,
                    documentId: doc.id,
                    currentVersion: doc.currentVersion || 1,
                    versions
                });
            };

            if (method === 'POST') {
                return api.readBody(req).then(body => handleListVersions(body || {}));
            }
            return handleListVersions({});
        }

        // ── W2-F: get one document version (full content, members) ──
        if (
            (method === 'GET' && urlPath === '/api/enterprise/group/document/version')
            || (method === 'POST' && urlPath === '/api/enterprise/group/document/version/get')
        ) {
            const handleGetVersion = async (body = {}) => {
                const query = method === 'GET' ? api.parseQuery(req) : null;
                const code = api.normalizeCode(
                    (query && (query.get('groupCode') || query.get('group_code'))) || body.groupCode || body.group_code
                );
                const docId = (query && (query.get('documentId') || query.get('document_id')))
                    || body.documentId || body.document_id;
                const versionRaw = (query && (query.get('version') || query.get('v')))
                    || body.version || body.v;
                const memberId = (query && (query.get('memberId') || query.get('member_id')))
                    || body.memberId || body.member_id;

                if (!code) return api.sendError(res, 400, '缺少 groupCode', 'VALIDATION_ERROR');
                if (!docId) return api.sendError(res, 400, '缺少 documentId', 'VALIDATION_ERROR');
                const versionNum = parseInt(versionRaw, 10);
                if (!Number.isFinite(versionNum) || versionNum < 1) {
                    return api.sendError(res, 400, '缺少或無效的 version', 'VALIDATION_ERROR');
                }

                const group = api.getGroup(store, code);
                if (!group) return api.sendError(res, 404, '找不到群組', 'GROUP_NOT_FOUND');

                const access = await api.assertDocumentReadAccess(req, store, group, { memberId, groupCode: code });
                if (!access.ok) {
                    return api.sendError(res, access.status, access.error, access.code);
                }

                let doc = api.findGroupDocument(group, { documentId: docId });
                if (!doc) {
                    doc = (group.documents || []).find(d => d.id === docId) || null;
                }
                if (!doc) return api.sendError(res, 404, '找不到該文件', 'DOC_NOT_FOUND');

                api.ensureDocumentVersions(doc, {
                    createdByMemberId: doc.authorMemberId || null,
                    createdByName: doc.author || null
                });

                const snap = (doc.versions || []).find(v => Number(v.version) === versionNum);
                if (!snap) {
                    return api.sendError(res, 404, '找不到該版本', 'DOC_VERSION_NOT_FOUND');
                }

                api.sendJson(res, 200, {
                    ok: true,
                    documentId: doc.id,
                    currentVersion: doc.currentVersion || 1,
                    version: {
                        version: snap.version,
                        title: snap.title,
                        content: snap.content,
                        contentHash: snap.contentHash || null,
                        filename: snap.filename || null,
                        fileUrl: snap.fileUrl || null,
                        docType: snap.docType || 'text',
                        createdAt: snap.createdAt,
                        createdByMemberId: snap.createdByMemberId || null,
                        createdByName: snap.createdByName || null,
                        changeNote: snap.changeNote || null,
                        ragRefHint: snap.ragRefHint || null
                    }
                });
            };

            if (method === 'POST') {
                return api.readBody(req).then(body => handleGetVersion(body || {}));
            }
            return handleGetVersion({});
        }

        // ── W2-F: restore soft-deleted document (manager only) ──
        if (method === 'POST' && urlPath === '/api/enterprise/group/document/restore') {
            return api.readBody(req).then(async body => {
                const code = api.normalizeCode(body.groupCode);
                const managerId = body.managerId;
                const docId = body.documentId || body.document_id;
                const reindex = body.reindex !== false && body.reIndex !== false;

                const group = api.getGroup(store, code);
                if (!group) return api.sendError(res, 404, '找不到群組', 'GROUP_NOT_FOUND');

                const authUser = await api.getOptionalAuth(req);
                const memberCheck = await api.assertEnterpriseMember(group, managerId, authUser, { store });
                if (!memberCheck.ok) {
                    return api.sendError(res, memberCheck.status || 403, memberCheck.error, memberCheck.code || 'GROUP_FORBIDDEN');
                }
                if (memberCheck.member.role !== 'manager') {
                    return api.sendError(res, 403, '僅主管可管理知識庫', 'ROLE_FORBIDDEN');
                }
                if (!docId) {
                    return api.sendError(res, 400, '缺少 documentId', 'VALIDATION_ERROR');
                }

                const doc = (group.documents || []).find(d => d.id === docId);
                if (!doc) return api.sendError(res, 404, '找不到該文件', 'DOC_NOT_FOUND');

                if (api.isActiveDocument(doc)) {
                    return api.sendJson(res, 200, {
                        ok: true,
                        document: doc,
                        currentVersion: doc.currentVersion || 1,
                        ragStatus: doc.ragStatus || doc.rag?.status || null,
                        alreadyActive: true
                    });
                }

                doc.status = 'active';
                doc.deletedAt = null;
                doc.updatedAt = new Date().toISOString();
                api.ensureDocumentVersions(doc, {
                    createdByMemberId: doc.authorMemberId || null,
                    createdByName: doc.author || null
                });

                if (reindex) {
                    api.setDocumentRagStatus(doc, 'pending', { lastError: null });
                    await saveStore(store);
                    const ragOrchestration = await api.orchestrateDocumentRagIndex(code, doc, {
                        kbId: doc.kbId
                    });
                    return api.sendJson(res, 200, {
                        ...api.buildRagOrchestrationResponse(ragOrchestration, doc),
                        currentVersion: doc.currentVersion || 1,
                        restored: true
                    });
                }

                api.setDocumentRagStatus(doc, 'pending', { lastError: null });
                await saveStore(store);
                api.sendJson(res, 200, {
                    ok: true,
                    document: doc,
                    currentVersion: doc.currentVersion || 1,
                    ragStatus: doc.ragStatus || 'pending',
                    restored: true
                });
            });
        }

        if (method === 'POST' && urlPath === '/api/enterprise/task/assign') {
            return api.readBody(req).then(async body => {
                const code = api.normalizeCode(body.groupCode);
                const managerId = body.managerId;
                const assigneeId = body.assigneeId;
                const title = api.clampText(body.title, 200);

                const group = api.getGroup(store, code);
                if (!group) return api.sendJson(res, 404, { error: '找不到群組' });

                const authUser = await api.getOptionalAuth(req);
                const memberCheck = await api.assertEnterpriseMember(group, managerId, authUser, { store });
                if (!memberCheck.ok || memberCheck.member.role !== 'manager') {
                    return api.sendJson(res, memberCheck.status || 403, { error: memberCheck.error || '僅主管可指派任務' });
                }
                const manager = memberCheck.member;

                const assignee = group.members.find(m => m.id === assigneeId);
                if (!assignee) return api.sendJson(res, 404, { error: '找不到成員' });
                if (!title) return api.sendJson(res, 400, { error: '請輸入任務名稱' });

                // Optional knowledge-base / document binding for coach RAG (task-scoped)
                const bound = api.normalizeTaskKnowledgeBinding(group, body.kbIds, body.docIds);

                const task = {
                    id: api.uid(),
                    title,
                    assigneeId: assignee.id,
                    assigneeName: assignee.name,
                    assignedBy: manager.name,
                    assignedById: manager.id,
                    duration: Math.min(480, Math.max(5, parseInt(body.duration, 10) || 30)),
                    energy: Math.min(5, Math.max(1, parseInt(body.energy, 10) || 3)),
                    category: ['deep', 'execution', 'meeting', 'learning', 'admin'].includes(body.category)
                        ? body.category : 'execution',
                    due: api.clampText(body.due, 12) || new Date().toISOString().split('T')[0],
                    kbIds: bound.kbIds,
                    docIds: bound.docIds,
                    completed: false,
                    completedAt: null,
                    createdAt: new Date().toISOString()
                };

                group.tasks.unshift(task);
                const notifications = [];
                if (assignee.id !== manager.id) {
                    notifications.push(api.pushNotification(group, {
                        type: 'task_assigned',
                        recipientId: assignee.id,
                        title: '新任務指派',
                        message: `${manager.name} 指派了「${title}」給你，截止 ${task.due}`,
                        taskId: task.id,
                        taskTitle: title,
                        actorId: manager.id,
                        actorName: manager.name
                    }));
                }
                notifications.push(api.pushNotification(group, {
                    type: 'task_assigned_confirm',
                    recipientId: manager.id,
                    title: '任務已指派',
                    message: `已將「${title}」指派給 ${assignee.name}，截止 ${task.due}`,
                    taskId: task.id,
                    taskTitle: title,
                    actorId: manager.id,
                    actorName: manager.name
                }));
                await saveStore(store);
                api.sendJson(res, 200, { ok: true, task, notifications });
            });
        }

        const taskMatch = urlPath.match(/^\/api\/enterprise\/task\/([a-f0-9]+)$/);
        if (method === 'PATCH' && taskMatch) {
            return api.readBody(req).then(async body => {
                const code = api.normalizeCode(body.groupCode);
                const memberId = body.memberId;
                const group = api.getGroup(store, code);
                if (!group) return api.sendJson(res, 404, { error: '找不到群組' });

                const task = group.tasks.find(t => t.id === taskMatch[1]);
                if (!task) return api.sendJson(res, 404, { error: '找不到任務' });

                const authUser = await api.getOptionalAuth(req);
                const memberCheck = await api.assertEnterpriseMember(group, memberId, authUser, { store });
                if (!memberCheck.ok) {
                    return api.sendJson(res, memberCheck.status, { error: memberCheck.error });
                }
                const member = memberCheck.member;

                const canEdit = member.role === 'manager' || task.assigneeId === memberId;
                if (!canEdit) return api.sendJson(res, 403, { error: '無權限更新此任務' });

                // Manager may rebind knowledge bases / documents for coach scope
                if (member.role === 'manager' && (Array.isArray(body.kbIds) || Array.isArray(body.docIds))) {
                    const bound = api.normalizeTaskKnowledgeBinding(
                        group,
                        Array.isArray(body.kbIds) ? body.kbIds : (task.kbIds || []),
                        Array.isArray(body.docIds) ? body.docIds : (task.docIds || [])
                    );
                    task.kbIds = bound.kbIds;
                    task.docIds = bound.docIds;
                }

                let notifications = [];
                if (typeof body.completed === 'boolean') {
                    const wasCompleted = !!task.completed;
                    task.completed = body.completed;
                    task.completedAt = body.completed ? new Date().toISOString() : null;
                    if (body.completed && !wasCompleted) {
                        if (task.assignedById && task.assignedById !== memberId) {
                            notifications.push(api.pushNotification(group, {
                                type: 'task_completed',
                                recipientId: task.assignedById,
                                title: '任務已完成',
                                message: `${member.name} 完成了「${task.title}」`,
                                taskId: task.id,
                                taskTitle: task.title,
                                actorId: member.id,
                                actorName: member.name
                            }));
                        }
                        if (task.assigneeId === memberId && task.assigneeId !== task.assignedById) {
                            notifications.push(api.pushNotification(group, {
                                type: 'task_completed_confirm',
                                recipientId: memberId,
                                title: '任務已標記完成',
                                message: `你已完成「${task.title}」，主管已收到通知`,
                                taskId: task.id,
                                taskTitle: task.title,
                                actorId: member.id,
                                actorName: member.name
                            }));
                        }
                    }
                }

                await saveStore(store);
                api.sendJson(res, 200, { ok: true, task, notifications });
            });
        }

        if (method === 'GET' && urlPath === '/api/enterprise/notifications') {
            const query = api.parseQuery(req);
            const code = api.normalizeCode(query.get('groupCode'));
            const memberId = query.get('memberId');
            const group = api.getGroup(store, code);
            if (!group) return api.sendJson(res, 404, { error: '找不到群組' });
            const authUser = await api.getOptionalAuth(req);
            const memberCheck = await api.assertEnterpriseMember(group, memberId, authUser, { store });
            if (!memberCheck.ok) {
                return api.sendJson(res, memberCheck.status, {
                    error: memberCheck.error,
                    code: memberCheck.code || 'GROUP_FORBIDDEN'
                });
            }
            api.ensureNotifications(group);
            const resolvedId = memberCheck.member.id;
            const notifications = group.notifications
                .filter(n => n.recipientId === resolvedId)
                .slice(0, 50);
            const unreadCount = notifications.filter(n => !n.read).length;
            api.sendJson(res, 200, {
                ok: true,
                notifications,
                unreadCount,
                member: { id: resolvedId, name: memberCheck.member.name, role: memberCheck.member.role }
            });
            return;
        }

        if (method === 'PATCH' && urlPath === '/api/enterprise/notifications/read') {
            return api.readBody(req).then(async body => {
                const code = api.normalizeCode(body.groupCode);
                const memberId = body.memberId;
                const group = api.getGroup(store, code);
                if (!group) return api.sendJson(res, 404, { error: '找不到群組' });
                const authUser = await api.getOptionalAuth(req);
                const memberCheck = await api.assertEnterpriseMember(group, memberId, authUser, { store });
                if (!memberCheck.ok) {
                    return api.sendJson(res, memberCheck.status, {
                        error: memberCheck.error,
                        code: memberCheck.code || 'GROUP_FORBIDDEN'
                    });
                }
                api.ensureNotifications(group);
                const resolvedId = memberCheck.member.id;
                const ids = Array.isArray(body.ids) ? body.ids : [];
                let updated = 0;
                for (const note of group.notifications) {
                    if (note.recipientId !== resolvedId) continue;
                    if (body.readAll || ids.includes(note.id)) {
                        if (!note.read) updated++;
                        note.read = true;
                    }
                }
                await saveStore(store);
                api.sendJson(res, 200, { ok: true, updated, memberId: resolvedId });
            });
        }

        api.sendJson(res, 404, { error: 'Enterprise route not found' });
    }

    Object.assign(api, {
        handleEnterprise
    });
}

module.exports = { register };
