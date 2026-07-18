/**
 * server/domain/rag/ops
 * 任務：RAG 代理、索引編排、就緒探測
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
const { loadStore, saveStore, getStoreBackend } = require('../../../lib/enterprise-store');
const { getAuthBackend } = require('../../../lib/auth-store');
const { getJwtConfig } = require('../../../lib/auth');
const { getUserDataBackend } = require('../../../lib/user-data-store');
const { getDatabaseStats } = require('../../../lib/db');
const { withLock } = require('../../../lib/write-queue');

/** @param {Record<string, Function>} api */
function register(api) {
    const ragIndexEvents = api.ragIndexEvents || (api.ragIndexEvents = []);
    const ragBackgroundIndexJobs = api.ragBackgroundIndexJobs || (api.ragBackgroundIndexJobs = new Set());
    // expose for health/ops
    api.ragIndexEvents = ragIndexEvents;
    api.ragBackgroundIndexJobs = ragBackgroundIndexJobs;
    async function proxyRagDeleteKb(groupCode, kbId) {
        try {
            const response = await fetch(`${RAG_SERVICE_URL}/api/rag/kb/delete`, {
                method: 'POST',
                headers: buildRagHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({
                    group_code: groupCode || '',
                    kb_id: kbId || 'general'
                })
            });
            const text = await response.text();
            const ok = response.ok || response.status === 404;
            return { ok, status: response.status, text };
        } catch (e) {
            return { ok: false, status: 0, text: e.message || 'RAG KB delete failed' };
        }
    }

    function classifyRagError(lastError, httpStatus) {
        const raw = String(lastError || '').trim();
        const msg = raw.slice(0, 500) || 'Unknown RAG error';
        const lower = msg.toLowerCase();
        const status = Number(httpStatus) || 0;

        if (!raw && !status) {
            return { code: 'RAG_UNREACHABLE', category: 'availability', message: 'RAG service unreachable', retryable: true };
        }
        if (status === 401 || /invalid or missing rag api key|unauthorized|api key/i.test(msg)) {
            return { code: 'RAG_AUTH', category: 'config', message: msg, retryable: false };
        }
        if (status === 400 || /empty|無效|invalid|validation|missing/i.test(msg)) {
            return { code: 'RAG_BAD_REQUEST', category: 'content', message: msg, retryable: false };
        }
        if (status === 413 || /too large|payload|body too large/i.test(msg)) {
            return { code: 'RAG_PAYLOAD_TOO_LARGE', category: 'content', message: msg, retryable: false };
        }
        if (status === 404 || /not found|找不到/i.test(msg)) {
            return { code: 'RAG_NOT_FOUND', category: 'content', message: msg, retryable: false };
        }
        if (status === 429 || /rate|頻繁|throttle/i.test(msg)) {
            return { code: 'RAG_RATE_LIMITED', category: 'availability', message: msg, retryable: true };
        }
        if (status >= 500 || /internal server error|econnrefused|fetch failed|socket|timeout|aborted|etimedout/i.test(lower)) {
            return { code: 'RAG_UPSTREAM', category: 'availability', message: msg, retryable: true };
        }
        if (/document missing|沒有可索引/i.test(msg)) {
            return { code: 'RAG_NO_CONTENT', category: 'content', message: msg, retryable: false };
        }
        if (/deleted during index|not active|group missing/i.test(msg)) {
            return { code: 'RAG_ABORTED', category: 'lifecycle', message: msg, retryable: false };
        }
        return { code: 'RAG_UNKNOWN', category: 'unknown', message: msg, retryable: true };
    }

    function pushRagIndexEvent(evt) {
        ragIndexEvents.unshift({
            ts: new Date().toISOString(),
            ...evt
        });
        if (ragIndexEvents.length > RAG_INDEX_EVENT_LIMIT) {
            ragIndexEvents.length = RAG_INDEX_EVENT_LIMIT;
        }
    }

    function setDocumentRagStatus(doc, status, extra = {}) {
        if (!doc) return;
        const now = new Date().toISOString();
        const lastError = extra.lastError != null
            ? extra.lastError
            : (status === 'failed' ? (extra.lastError || null) : null);
        let errorMeta = null;
        if (status === 'failed' && (lastError || extra.errorCode)) {
            errorMeta = classifyRagError(lastError, extra.httpStatus);
            if (extra.errorCode) errorMeta.code = extra.errorCode;
        }
        doc.ragStatus = status;
        doc.rag = {
            ...(doc.rag && typeof doc.rag === 'object' ? doc.rag : {}),
            status,
            lastIndexedAt: status === 'indexed' ? now : (doc.rag?.lastIndexedAt || null),
            lastError: status === 'failed' ? (lastError || errorMeta?.message || null) : (status === 'indexed' ? null : (doc.rag?.lastError || null)),
            lastErrorCode: status === 'failed' ? (errorMeta?.code || extra.errorCode || null) : null,
            lastErrorCategory: status === 'failed' ? (errorMeta?.category || null) : null,
            retryable: status === 'failed' ? (errorMeta ? errorMeta.retryable : true) : null,
            refDocId: extra.refDocId != null ? extra.refDocId : (doc.rag?.refDocId || null),
            chunks: extra.chunks != null ? extra.chunks : (doc.rag?.chunks || null)
        };
    }

    function findGroupDocument(group, { documentId, filename, title } = {}) {
        const docs = group?.documents || [];
        if (documentId) {
            const byId = docs.find(d => d.id === documentId);
            if (byId) return byId;
        }
        if (filename) {
            const byFile = docs.find(d => api.isActiveDocument(d) && (
                d.filename === filename || api.getRagFilenameForDoc(d) === filename
            ));
            if (byFile) return byFile;
        }
        if (title) {
            const byTitle = docs.find(d => api.isActiveDocument(d) && d.title === title);
            if (byTitle) return byTitle;
        }
        return null;
    }

    async function persistDocumentRagStatus(groupCode, lookup, status, extra = {}) {
        // Own load→mutate→save critical section — lock it. Callers never hold the
        // 'enterprise' lock themselves at this call site (verified: only reached from
        // the standalone /api/rag/* dispatch and the background RAG index job).
        return withLock('enterprise', async () => {
            const store = await api.prepareStore(await loadStore());
            const group = api.getGroup(store, api.normalizeCode(groupCode));
            if (!group) return false;
            const doc = findGroupDocument(group, lookup);
            if (!doc) return false;
            // Never mark soft-deleted documents as indexed (ghost-index race guard).
            if (status === 'indexed' && !api.isActiveDocument(doc)) {
                console.warn(
                    '[Lumina Backend] refuse to mark deleted doc as indexed:',
                    doc.id || lookup.documentId || lookup.filename
                );
                return false;
            }
            setDocumentRagStatus(doc, status, extra);
            await saveStore(store);
            return true;
        });
    }

    async function compensateRagIndexAfterDelete(groupCode, doc) {
        if (!doc) return { ok: false, text: 'document missing' };
        const kbId = doc.kbId || 'general';
        const ragFilename = api.getRagFilenameForDoc(doc);
        if (!ragFilename) return { ok: true, text: 'no filename' };
        console.warn(
            `[Lumina Backend] index completed after delete; compensating purge doc=${doc.id} file=${ragFilename}`
        );
        const purge = await proxyRagDeleteIndex(api.normalizeCode(groupCode), kbId, ragFilename);
        if (!purge.ok) {
            console.warn('[Lumina Backend] compensate index delete failed:', purge.text);
        }
        return purge;
    }

    async function proxyRagDeleteIndex(groupCode, kbId, filename) {
        const form = new URLSearchParams();
        form.set('group_code', groupCode || '');
        form.set('kb_id', kbId || 'general');
        form.set('filename', filename || '');
        try {
            const response = await fetch(`${RAG_SERVICE_URL}/api/rag/document/delete`, {
                method: 'POST',
                headers: buildRagHeaders({ 'Content-Type': 'application/x-www-form-urlencoded' }),
                body: form.toString()
            });
            const text = await response.text();
            // 404 = already absent — treat as success for consistency
            const ok = response.ok || response.status === 404;
            return { ok, status: response.status, text };
        } catch (e) {
            return { ok: false, status: 0, text: e.message || 'RAG delete failed' };
        }
    }

    function parseRagProxyResult(proxied) {
        const ok = proxied && proxied.status >= 200 && proxied.status < 300;
        let chunks = null;
        let lastError = null;
        if (ok) {
            try {
                const data = JSON.parse(proxied.text || '{}');
                chunks = data.chunks != null ? data.chunks : null;
            } catch (_) {}
        } else {
            try {
                const data = JSON.parse((proxied && proxied.text) || '{}');
                lastError = data.detail || data.error || (proxied && proxied.text) || 'RAG index failed';
            } catch (_) {
                lastError = (proxied && proxied.text) || 'RAG index failed';
            }
        }
        return { ok, status: proxied ? proxied.status : 0, chunks, lastError };
    }

    async function proxyRagUploadTextIndex({ groupCode, kbId, title, content, filename, documentId }) {
        try {
            const proxied = await proxyRagJson('/api/rag/document/upload-text', {
                group_code: groupCode || '',
                kb_id: kbId || 'general',
                title: title || '',
                content: content || '',
                filename: filename || `text::${title || 'doc'}.md`,
                document_id: documentId || null
            });
            return parseRagProxyResult(proxied);
        } catch (e) {
            return { ok: false, status: 0, chunks: null, lastError: e.message || 'RAG upload-text failed' };
        }
    }

    async function proxyRagUploadBinaryIndex({ groupCode, kbId, filename, fileBuffer, documentId, title }) {
        try {
            const boundary = 'lumina-rag-' + crypto.randomBytes(8).toString('hex');
            const parts = [
                `--${boundary}\r\nContent-Disposition: form-data; name="group_code"\r\n\r\n${groupCode || ''}\r\n`,
                `--${boundary}\r\nContent-Disposition: form-data; name="kb_id"\r\n\r\n${kbId || 'general'}\r\n`,
            ];
            if (documentId) {
                parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="document_id"\r\n\r\n${documentId}\r\n`);
            }
            if (title) {
                parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\n${title}\r\n`);
            }
            parts.push(
                `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename || 'file.bin'}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
                fileBuffer,
                `\r\n--${boundary}--\r\n`
            );
            const payload = Buffer.concat(parts.map(p => (Buffer.isBuffer(p) ? p : Buffer.from(p, 'utf8'))));
            const response = await fetch(`${RAG_SERVICE_URL}/api/rag/document/upload`, {
                method: 'POST',
                headers: buildRagHeaders({
                    'Content-Type': `multipart/form-data; boundary=${boundary}`,
                    'Content-Length': String(payload.length)
                }),
                body: payload
            });
            const text = await response.text();
            return parseRagProxyResult({ status: response.status, text });
        } catch (e) {
            return { ok: false, status: 0, chunks: null, lastError: e.message || 'RAG binary upload failed' };
        }
    }

    async function indexEnterpriseDocumentToRag(groupCode, doc, options = {}) {
        if (!doc) {
            return { ok: false, status: 0, chunks: null, lastError: 'document missing' };
        }
        const kbId = doc.kbId || options.kbId || 'general';
        const title = doc.title || 'untitled';
        const textContent = String(doc.content || '').trim();
        const ragFilename = api.getRagFilenameForDoc(doc);
        const documentId = doc.id || null;

        if (textContent) {
            const filename = doc.docType === 'text'
                ? `text::${title}.md`
                : (ragFilename || `text::${title}.md`);
            return proxyRagUploadTextIndex({
                groupCode,
                kbId,
                title,
                content: textContent,
                filename,
                documentId
            });
        }

        let fileBuffer = null;
        if (options.fileBuffer && Buffer.isBuffer(options.fileBuffer)) {
            fileBuffer = options.fileBuffer;
        } else if (options.fileData && typeof options.fileData === 'string') {
            try {
                fileBuffer = Buffer.from(options.fileData, 'base64');
            } catch (_) {}
        } else if (doc.fileUrl && String(doc.fileUrl).startsWith('/uploads/')) {
            try {
                const filePath = path.join(UPLOADS_DIR, path.basename(doc.fileUrl));
                if (fs.existsSync(filePath)) fileBuffer = fs.readFileSync(filePath);
            } catch (_) {}
        }

        if (fileBuffer && fileBuffer.length && ragFilename) {
            return proxyRagUploadBinaryIndex({
                groupCode,
                kbId,
                filename: ragFilename,
                fileBuffer,
                documentId,
                title
            });
        }

        return { ok: false, status: 0, chunks: null, lastError: '沒有可索引的文件內容' };
    }

    async function indexDocumentWithRetry(groupCode, doc, options = {}) {
        const maxAttempts = options.maxAttempts || RAG_INDEX_MAX_ATTEMPTS;
        const t0 = Date.now();
        let last = { ok: false, status: 0, chunks: null, lastError: 'RAG index not attempted' };
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            last = await indexEnterpriseDocumentToRag(groupCode, doc, options);
            if (last.ok) {
                return { ...last, durationMs: Date.now() - t0, attempts: attempt + 1 };
            }
            if (attempt + 1 < maxAttempts) {
                console.warn(
                    `[Lumina Backend] RAG index attempt ${attempt + 1} failed for doc ${doc?.id}:`,
                    last.lastError
                );
            }
        }
        return { ...last, durationMs: Date.now() - t0, attempts: maxAttempts };
    }

    function raceWithTimeout(promise, ms) {
        return new Promise(resolve => {
            let settled = false;
            const timer = setTimeout(() => {
                if (!settled) {
                    settled = true;
                    resolve({ timedOut: true, value: null });
                }
            }, ms);
            Promise.resolve(promise).then(
                value => {
                    if (!settled) {
                        settled = true;
                        clearTimeout(timer);
                        resolve({ timedOut: false, value });
                    }
                },
                err => {
                    if (!settled) {
                        settled = true;
                        clearTimeout(timer);
                        resolve({
                            timedOut: false,
                            value: { ok: false, status: 0, chunks: null, lastError: err.message || 'RAG index error' }
                        });
                    }
                }
            );
        });
    }

    async function runBackgroundRagIndex(groupCode, docId, options = {}) {
        const key = `${api.normalizeCode(groupCode)}:${docId}`;
        if (!docId || ragBackgroundIndexJobs.has(key)) return;
        ragBackgroundIndexJobs.add(key);
        try {
            const store = await api.prepareStore(await loadStore());
            const group = api.getGroup(store, api.normalizeCode(groupCode));
            if (!group) return;
            const doc = findGroupDocument(group, { documentId: docId });
            if (!doc || !api.isActiveDocument(doc)) return;
            // Skip if another path already finished
            if (doc.ragStatus === 'indexed') return;

            const result = await indexDocumentWithRetry(groupCode, doc, options);
            // applyDocumentRagIndexResult reloads + aborts/compensates if soft-deleted during index
            const applied = await applyDocumentRagIndexResult(groupCode, doc, result);
            if (applied && applied.aborted) {
                console.warn(`[Lumina Backend] background RAG index aborted (doc deleted): ${docId}`);
            } else if (result.ok) {
                console.log(`[Lumina Backend] background RAG index ok: ${docId}`);
            } else {
                console.warn(`[Lumina Backend] background RAG index failed: ${docId}`, result.lastError);
            }
        } catch (e) {
            console.warn('[Lumina Backend] background RAG index error:', e.message);
            try {
                // Only write failed if still active — avoid clobbering deleted status
                const store2 = await api.prepareStore(await loadStore());
                const group2 = api.getGroup(store2, api.normalizeCode(groupCode));
                const fresh = group2 ? findGroupDocument(group2, { documentId: docId }) : null;
                if (fresh && api.isActiveDocument(fresh)) {
                    await persistDocumentRagStatus(groupCode, { documentId: docId }, 'failed', {
                        lastError: String(e.message || 'RAG index failed').slice(0, 500)
                    });
                }
            } catch (_) {}
        } finally {
            ragBackgroundIndexJobs.delete(key);
        }
    }

    async function applyDocumentRagIndexResult(groupCode, doc, result) {
        if (!doc?.id) return result;

        // Own load→mutate→save critical section — lock it. This is only ever called
        // from a detached background continuation (timed-out RAG index tail) or from
        // runBackgroundRagIndex, never synchronously from within an already-locked
        // handleEnterprise request (see orchestrateDocumentRagIndex's fast path, which
        // mutates the caller's already-loaded+locked store directly instead of calling
        // this function, to avoid nested same-key locking).
        return withLock('enterprise', async () => {
            // Reload so concurrent soft-delete wins over index writeback
            const store = await api.prepareStore(await loadStore());
            const group = api.getGroup(store, api.normalizeCode(groupCode));
            if (!group) {
                if (result && result.ok) await compensateRagIndexAfterDelete(groupCode, doc);
                return { ...(result || {}), ok: false, aborted: true, lastError: 'group missing after index' };
            }
            const fresh = findGroupDocument(group, { documentId: doc.id });
            if (!fresh || !api.isActiveDocument(fresh)) {
                // Soft-deleted while indexing — abort metadata write + purge vectors that just landed
                if (result && result.ok) {
                    await compensateRagIndexAfterDelete(groupCode, fresh || doc);
                }
                console.warn(
                    `[Lumina Backend] skip index writeback — doc not active: ${doc.id}`
                );
                return {
                    ...(result || {}),
                    ok: false,
                    aborted: true,
                    lastError: 'document deleted during index'
                };
            }

            if (result && result.ok) {
                setDocumentRagStatus(fresh, 'indexed', { chunks: result.chunks, lastError: null });
                setDocumentRagStatus(doc, 'indexed', { chunks: result.chunks, lastError: null });
                await saveStore(store);
                pushRagIndexEvent({
                    groupCode: api.normalizeCode(groupCode),
                    documentId: doc.id,
                    title: doc.title || null,
                    outcome: 'indexed',
                    chunks: result.chunks,
                    httpStatus: result.status || 200,
                    durationMs: result.durationMs != null ? result.durationMs : null
                });
                return result;
            }
            const lastError = String((result && result.lastError) || 'RAG index failed').slice(0, 500);
            const classified = classifyRagError(lastError, result && result.status);
            setDocumentRagStatus(fresh, 'failed', { lastError, httpStatus: result && result.status });
            setDocumentRagStatus(doc, 'failed', { lastError, httpStatus: result && result.status });
            await saveStore(store);
            pushRagIndexEvent({
                groupCode: api.normalizeCode(groupCode),
                documentId: doc.id,
                title: doc.title || null,
                outcome: result && result.aborted ? 'aborted' : 'failed',
                errorCode: classified.code,
                errorCategory: classified.category,
                retryable: classified.retryable,
                lastError,
                httpStatus: result && result.status,
                durationMs: result && result.durationMs != null ? result.durationMs : null
            });
            return { ...result, lastError, errorCode: classified.code, errorCategory: classified.category, retryable: classified.retryable };
        });
    }

    async function orchestrateDocumentRagIndex(groupCode, doc, options = {}) {
        const key = `${api.normalizeCode(groupCode)}:${doc?.id || ''}`;
        if (doc?.id) ragBackgroundIndexJobs.add(key);

        const work = (async () => {
            try {
                const result = await indexDocumentWithRetry(groupCode, doc, options);
                await applyDocumentRagIndexResult(groupCode, doc, result);
                return result;
            } finally {
                if (doc?.id) ragBackgroundIndexJobs.delete(key);
            }
        })();

        const raced = await raceWithTimeout(work, options.timeoutMs || RAG_INDEX_TIMEOUT_MS);

        if (raced.timedOut) {
            // Same work continues; status will flip pending → indexed|failed when done.
            work.catch(err => {
                console.warn('[Lumina Backend] RAG index tail error:', err.message);
            });
            return {
                ragOk: null,
                ragStatus: 'pending',
                ragPending: true,
                warning: '文件已存檔，知識庫索引處理中',
                document: doc
            };
        }

        const result = raced.value || { ok: false, lastError: 'RAG index failed' };
        if (result.ok) {
            return {
                ragOk: true,
                ragStatus: 'indexed',
                ragPending: false,
                document: doc,
                errorCode: null,
                errorCategory: null,
                retryable: null
            };
        }

        const classified = classifyRagError(result.lastError, result.status);
        return {
            ragOk: false,
            ragStatus: 'failed',
            errorCode: result.errorCode || classified.code,
            errorCategory: result.errorCategory || classified.category,
            retryable: result.retryable != null ? result.retryable : classified.retryable,
            ragPending: false,
            warning: '文件已存檔，但知識庫索引失敗',
            document: doc
        };
    }

    function buildRagOrchestrationResponse(ragOrchestration, doc) {
        const d = (ragOrchestration && ragOrchestration.document) || doc;
        const rag = d && d.rag && typeof d.rag === 'object' ? d.rag : {};
        return {
            ok: true,
            document: d,
            ragStatus: (ragOrchestration && ragOrchestration.ragStatus) || d?.ragStatus || 'pending',
            ragOk: ragOrchestration ? ragOrchestration.ragOk : null,
            ragPending: !!(ragOrchestration && ragOrchestration.ragPending),
            warning: ragOrchestration ? ragOrchestration.warning : undefined,
            errorCode: (ragOrchestration && ragOrchestration.errorCode) || rag.lastErrorCode || null,
            errorCategory: (ragOrchestration && ragOrchestration.errorCategory) || rag.lastErrorCategory || null,
            retryable: ragOrchestration && ragOrchestration.retryable != null
                ? ragOrchestration.retryable
                : (rag.retryable != null ? rag.retryable : null),
            lastError: rag.lastError || null
        };
    }

    function normalizeRagCitations(sources, group) {
        const list = Array.isArray(sources) ? sources : [];
        const docs = (group?.documents || []).filter(isActiveDocument);
        return list.map((s, idx) => {
            const filename = s.filename || s.file_name || null;
            const kbId = s.kb_id || s.kbId || 'general';
            const match = docs.find(d => {
                if (s.document_id && d.id === s.document_id) return true;
                const ragName = api.getRagFilenameForDoc(d);
                if (filename && (d.filename === filename || ragName === filename)) return true;
                if (filename && d.title && filename.includes(d.title)) return true;
                return false;
            });
            return {
                ref_id: s.ref_id != null ? s.ref_id : idx + 1,
                document_id: match?.id || s.document_id || null,
                title: match?.title || s.title || null,
                filename: filename || match?.filename || null,
                kb_id: kbId || match?.kbId || 'general',
                score: typeof s.score === 'number' ? s.score : null,
                snippet: s.snippet || s.text || s.chunk_text || null,
                chunk_id: s.doc_id || s.chunk_id || null
            };
        });
    }

    async function canAccessUpload(authUser, filename) {
        if (!authUser?.id) return false;
        const store = await api.prepareStore(await loadStore());
        for (const group of Object.values(store.groups || {})) {
            const owned = (group.documents || []).some(d => {
                if (!d.fileUrl) return false;
                return path.basename(d.fileUrl) === filename;
            });
            if (owned) {
                return group.members.some(m => m.userId === authUser.id);
            }
        }
        return false;
    }

    function buildRagHeaders(extra = {}) {
        const headers = { ...extra };
        if (RAG_API_KEY) headers['X-RAG-API-Key'] = RAG_API_KEY;
        return headers;
    }

    async function proxyRagJson(path, body) {
        const response = await fetch(`${RAG_SERVICE_URL}${path}`, {
            method: 'POST',
            headers: buildRagHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(body)
        });
        const text = await response.text();
        return { status: response.status, text };
    }

    async function proxyRagGet(path) {
        const response = await fetch(`${RAG_SERVICE_URL}${path}`, {
            method: 'GET',
            headers: buildRagHeaders()
        });
        const text = await response.text();
        return { status: response.status, text };
    }

    async function serveUploadFile(req, res, urlPath) {
        const authUser = await api.getAuthFromRequest(req);
        if (!authUser) {
            api.sendJson(res, 401, { error: '請先登入才能存取檔案' });
            return true;
        }

        const baseName = path.basename(urlPath);
        if (!baseName || baseName.includes('..')) {
            api.sendJson(res, 400, { error: '無效的檔案路徑' });
            return true;
        }

        if (!(await canAccessUpload(authUser, baseName))) {
            api.sendJson(res, 403, { error: '無權存取此檔案' });
            return true;
        }

        const filePath = path.join(UPLOADS_DIR, baseName);
        if (!filePath.startsWith(UPLOADS_DIR) || !fs.existsSync(filePath)) {
            api.sendJson(res, 404, { error: '找不到檔案' });
            return true;
        }
        const ext = path.extname(baseName).toLowerCase();
        const mime = {
            '.pdf': 'application/pdf',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        }[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': mime });
        fs.createReadStream(filePath).pipe(res);
        return true;
    }

    // ---- P0-RAG信任：「已發布 vs 可被檢索」對帳 ----

    async function fetchRagKbDocuments(groupCode, kbId) {
        const qs = new URLSearchParams({ group_code: groupCode, kb_id: kbId || 'general' });
        const proxied = await proxyRagGet(`/api/rag/kb/documents?${qs.toString()}`);
        if (proxied.status < 200 || proxied.status >= 300) {
            throw new Error(`RAG list documents HTTP ${proxied.status}`);
        }
        const data = JSON.parse(proxied.text || '{}');
        return Array.isArray(data.documents) ? data.documents : [];
    }

    /**
     * 對帳企業文件庫（宣稱狀態）與 RAG 索引（實際可檢索）。
     * 雙寫無交易的補償機制：找出 ghost（標 indexed 但查不到）、卡住的 pending、
     * 可重試的 failed、以及已刪未清的殘留索引；fix=true 時重排索引／清除殘留。
     */
    async function reconcileRagIndexes(groupCode, options = {}) {
        const fix = options.fix === true;
        const code = api.normalizeCode(groupCode);
        const store = await api.prepareStore(await loadStore());
        const group = api.getGroup(store, code);
        if (!group) return { ok: false, status: 404, error: '找不到群組', code: 'GROUP_NOT_FOUND' };
        api.ensureKnowledgeBases(group);

        const activeDocs = (group.documents || []).filter(d => api.isActiveDocument(d));
        const kbIds = new Set(activeDocs.map(d => d.kbId || 'general'));
        try {
            const proxied = await proxyRagGet(`/api/rag/kb/list?group_code=${encodeURIComponent(code)}`);
            if (proxied.status >= 200 && proxied.status < 300) {
                const data = JSON.parse(proxied.text || '{}');
                (Array.isArray(data.kb_ids) ? data.kb_ids : []).forEach(k => kbIds.add(k));
            }
        } catch (_) { /* RAG 不可達時仍回報企業側狀態 */ }

        const report = {
            ok: true,
            groupCode: code,
            checkedDocs: activeDocs.length,
            kbs: [...kbIds],
            missingIndex: [],
            stuckPending: [],
            failed: [],
            strayIndex: [],
            unreachableKbs: [],
            fixed: { reindexQueued: [], strayPurged: [] }
        };

        const STUCK_PENDING_MS = 10 * 60 * 1000;
        const now = Date.now();

        for (const kbId of kbIds) {
            let indexed = null;
            try {
                indexed = await fetchRagKbDocuments(code, kbId);
            } catch (e) {
                report.unreachableKbs.push({ kbId, error: e.message });
                continue;
            }
            const indexedByFilename = new Map(indexed.map(x => [x.filename, x]));
            const indexedByDocId = new Map(indexed.filter(x => x.document_id).map(x => [x.document_id, x]));
            const kbDocs = activeDocs.filter(d => (d.kbId || 'general') === kbId);
            const activeFilenames = new Set();
            const activeDocIds = new Set(kbDocs.map(d => d.id));

            for (const doc of kbDocs) {
                const ragFilename = api.getRagFilenameForDoc(doc);
                if (ragFilename) activeFilenames.add(ragFilename);
                const status = doc.ragStatus || doc.rag?.status || null;
                const present = (doc.id && indexedByDocId.has(doc.id))
                    || (ragFilename && indexedByFilename.has(ragFilename));
                if (status === 'indexed' && !present) {
                    report.missingIndex.push({ documentId: doc.id, kbId, filename: ragFilename, title: doc.title || null });
                } else if (status === 'pending') {
                    const t = Date.parse(doc.updatedAt || doc.createdAt || '') || 0;
                    if (now - t > STUCK_PENDING_MS) {
                        report.stuckPending.push({ documentId: doc.id, kbId, title: doc.title || null });
                    }
                } else if (status === 'failed') {
                    report.failed.push({
                        documentId: doc.id,
                        kbId,
                        title: doc.title || null,
                        lastError: doc.rag?.lastError || null,
                        retryable: doc.rag?.retryable !== false
                    });
                }
            }

            for (const item of indexed) {
                const matchesActive = (item.document_id && activeDocIds.has(item.document_id))
                    || activeFilenames.has(item.filename);
                if (!matchesActive) {
                    report.strayIndex.push({
                        kbId,
                        filename: item.filename,
                        document_id: item.document_id || null,
                        chunks: item.chunks || null
                    });
                }
            }
        }

        if (fix) {
            const toReindex = [
                ...report.missingIndex,
                ...report.stuckPending,
                ...report.failed.filter(f => f.retryable !== false)
            ];
            for (const item of toReindex) {
                // runBackgroundRagIndex 會跳過 status=indexed 的文件，先降回 pending
                await persistDocumentRagStatus(code, { documentId: item.documentId }, 'pending', {});
                setImmediate(() => runBackgroundRagIndex(code, item.documentId));
                report.fixed.reindexQueued.push(item.documentId);
                pushRagIndexEvent({ type: 'reconcile-reindex', groupCode: code, documentId: item.documentId });
            }
            for (const stray of report.strayIndex) {
                const purge = await proxyRagDeleteIndex(code, stray.kbId, stray.filename);
                if (purge.ok) {
                    report.fixed.strayPurged.push(`${stray.kbId}/${stray.filename}`);
                    pushRagIndexEvent({ type: 'reconcile-purge', groupCode: code, kbId: stray.kbId, filename: stray.filename });
                }
            }
        }

        report.consistent = !report.missingIndex.length && !report.stuckPending.length
            && !report.failed.length && !report.strayIndex.length && !report.unreachableKbs.length;
        return report;
    }

    async function probeRagHealthDetail() {
        const detail = {
            ok: false,
            url: RAG_SERVICE_URL,
            latencyMs: null,
            embedding: null,
            retrieval: null,
            version: null,
            error: null,
            errorCode: null
        };
        const t0 = Date.now();
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 2000);
            const response = await fetch(`${RAG_SERVICE_URL}/health`, { signal: controller.signal });
            clearTimeout(timer);
            detail.latencyMs = Date.now() - t0;
            detail.ok = response.ok;
            if (response.ok) {
                try {
                    const data = await response.json();
                    detail.embedding = data.embedding || data.embed || null;
                    detail.retrieval = data.retrieval || null;
                    detail.version = data.version || null;
                } catch (_) {}
            } else {
                detail.error = `HTTP ${response.status}`;
                detail.errorCode = classifyRagError(detail.error, response.status).code;
            }
        } catch (e) {
            detail.latencyMs = Date.now() - t0;
            detail.error = e.name === 'AbortError' ? 'timeout' : (e.message || 'unreachable');
            detail.errorCode = classifyRagError(detail.error, 0).code;
        }
        return detail;
    }

    async function getReadiness() {
        const checks = { store: false, auth: false, rag: false };
        const details = {
            store: { backend: null, error: null },
            auth: { backend: null, error: null },
            rag: null
        };
        try {
            await loadStore();
            checks.store = true;
            details.store.backend = getStoreBackend();
        } catch (e) {
            details.store.error = e.message || 'store load failed';
        }
        try {
            details.auth.backend = getAuthBackend();
            checks.auth = !!details.auth.backend;
        } catch (e) {
            details.auth.error = e.message || 'auth backend failed';
        }
        details.rag = await probeRagHealthDetail();
        checks.rag = !!details.rag.ok;
        // 預設 secret 警告：生產模式下 bootstrap 已 exit(1)，這裡只會在 dev 出現
        details.secrets = {
            usingDefaultJwtSecret: getJwtConfig().usingDefaultSecret,
            usingDefaultPinSalt: PIN_SALT === 'lumina-pin-salt-change-in-production'
        };
        const ready = checks.store && checks.auth;
        return {
            ready,
            checks,
            details,
            uptimeSec: Math.floor((Date.now() - serviceStartedAt) / 1000),
            backgroundIndexJobs: ragBackgroundIndexJobs.size
        };
    }

    Object.assign(api, {
        proxyRagDeleteKb,
        classifyRagError,
        pushRagIndexEvent,
        setDocumentRagStatus,
        findGroupDocument,
        persistDocumentRagStatus,
        compensateRagIndexAfterDelete,
        proxyRagDeleteIndex,
        parseRagProxyResult,
        proxyRagUploadTextIndex,
        proxyRagUploadBinaryIndex,
        indexEnterpriseDocumentToRag,
        indexDocumentWithRetry,
        raceWithTimeout,
        runBackgroundRagIndex,
        applyDocumentRagIndexResult,
        orchestrateDocumentRagIndex,
        buildRagOrchestrationResponse,
        normalizeRagCitations,
        canAccessUpload,
        buildRagHeaders,
        proxyRagJson,
        proxyRagGet,
        serveUploadFile,
        probeRagHealthDetail,
        fetchRagKbDocuments,
        reconcileRagIndexes,
        getReadiness
    });
}

module.exports = { register };
