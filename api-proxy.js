/**
 * Lumina AI — API 代理 + 企業團隊模式後端
 *
 * 用法：
 *   set DEEPSEEK_API_KEY=sk-your-key
 *   set ALLOWED_ORIGINS=http://localhost:3456,http://127.0.0.1:3456
 *   node api-proxy.js
 *
 * 企業 API：
 *   POST /api/enterprise/group/create
 *   POST /api/enterprise/group/join
 *   GET  /api/enterprise/group/:code
 *   POST /api/enterprise/task/assign
 *   PATCH /api/enterprise/task/:id
 *   GET  /api/enterprise/notifications?groupCode=&memberId=
 *   PATCH /api/enterprise/notifications/read
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const bcrypt = require('bcryptjs');
const { loadEnvFile } = require('./lib/env');
const { withLock } = require('./lib/write-queue');
const { initDb, ensureIndexes, getDatabaseStats } = require('./lib/db');
const {
    initStore,
    loadStore,
    saveStore,
    getStoreBackend
} = require('./lib/enterprise-store');
const {
    initAuthStore,
    findUserByEmail,
    findUserById,
    createUser,
    updateUser,
    getAuthBackend
} = require('./lib/auth-store');
const {
    initUserDataStore,
    getUserData,
    saveUserData,
    mergeUserData,
    ensureUserData,
    getUserDataBackend,
    defaultUserData
} = require('./lib/user-data-store');
const {
    normalizeEmail,
    isValidEmail,
    clampText: clampAuthText,
    signToken,
    verifyToken,
    parseBearerToken,
    hashPassword,
    verifyPassword,
    sanitizeUser,
    getJwtConfig
} = require('./lib/auth');

loadEnvFile();

const PORT = process.env.PORT || 3001;
const API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
const RAG_SERVICE_URL = process.env.RAG_SERVICE_URL || 'http://127.0.0.1:8000';
const RAG_API_KEY = (process.env.RAG_API_KEY || '').trim();
const IS_PRODUCTION = process.env.NODE_ENV === 'production' || process.env.LUMINA_ENFORCE_SECRETS === '1';
const REQUIRE_ENTERPRISE_AUTH = IS_PRODUCTION || process.env.REQUIRE_ENTERPRISE_AUTH === '1';
const ALLOW_ANONYMOUS_AI = !IS_PRODUCTION && process.env.ALLOW_ANONYMOUS_AI === '1';
const DATA_FILE = path.join(__dirname, 'enterprise-data.json');
const PIN_SALT = process.env.PIN_SALT || 'lumina-pin-salt-change-in-production';
const MAX_BODY_BYTES = 6 * 1024 * 1024; // 6 MB to support file uploads
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 120;
const AUTH_RATE_LIMIT_MAX = 20;
const PIN_MAX_ATTEMPTS = 5;
const PIN_LOCK_MS = 15 * 60 * 1000;
const AI_RATE_LIMIT_MAX = 30;
const AI_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour — must be passed into AI bucket checks
const DEFAULT_LLM_API_BASE = 'https://api.deepseek.com/v1';
const ALLOWED_LLM_API_BASES = new Set(
    (process.env.ALLOWED_LLM_API_BASES || 'https://api.deepseek.com,https://api.deepseek.com/v1')
        .split(',')
        .map(s => s.trim().replace(/\/+$/, ''))
        .filter(Boolean)
);
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED_UPLOAD_EXT = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.xlsx', '.xls', '.csv']);
const WEAK_PINS = new Set(['0000', '1234', '1111', '9999', '4321', '1212', 'password', 'admin']);
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:3456,http://127.0.0.1:3456,http://localhost:3000,http://127.0.0.1:3000')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

const rateBuckets = new Map();
const authRateBuckets = new Map();
const pinAttemptBuckets = new Map();
const aiRateBuckets = new Map();

function enforceProductionSecrets() {
    if (!IS_PRODUCTION) return;
    const missing = [];
    if (getJwtConfig().usingDefaultSecret) missing.push('JWT_SECRET');
    if (PIN_SALT === 'lumina-pin-salt-change-in-production') missing.push('PIN_SALT');
    if (!RAG_API_KEY) missing.push('RAG_API_KEY');
    if (!API_KEY) missing.push('DEEPSEEK_API_KEY');
    if (missing.length) {
        console.error('[Lumina API] 生產環境缺少必要密鑰設定:', missing.join(', '));
        process.exit(1);
    }
}

function isValidManagerPin(pin) {
    const p = String(pin || '').trim();
    if (p.length < 4 || p.length > 32) return false;
    if (WEAK_PINS.has(p.toLowerCase())) return false;
    return true;
}

async function hashPin(pin) {
    return await bcrypt.hash(String(pin), 10);
}

function verifyLegacyPinHash(pin, hash) {
    return crypto.createHash('sha256').update(PIN_SALT + ':' + String(pin)).digest('hex') === hash;
}

async function verifyPinHash(pin, hash) {
    if (!hash) return false;
    if (String(hash).startsWith('$2')) return await bcrypt.compare(String(pin), hash);
    return verifyLegacyPinHash(pin, hash);
}

async function verifyManagerPin(group, pin) {
    if (group.managerPinHash) {
        const ok = await verifyPinHash(pin, group.managerPinHash);
        if (ok && !String(group.managerPinHash).startsWith('$2')) {
            group.managerPinHash = await hashPin(pin);
        }
        return ok;
    }
    if (group.managerPin !== undefined) {
        return String(pin) === String(group.managerPin);
    }
    return false;
}

async function migrateGroupPin(group) {
    if (!group.managerPinHash && group.managerPin !== undefined) {
        group.managerPinHash = await hashPin(group.managerPin);
        delete group.managerPin;
    }
}

function clampText(value, max) {
    return String(value || '').trim().slice(0, max);
}

function getClientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) return String(forwarded).split(',')[0].trim();
    return req.socket.remoteAddress || 'unknown';
}

function checkRateLimitBucket(map, key, max, windowMs = RATE_LIMIT_WINDOW_MS) {
    const now = Date.now();
    let bucket = map.get(key);
    if (!bucket || now - bucket.start > windowMs) {
        bucket = { start: now, count: 0 };
        map.set(key, bucket);
    }
    bucket.count++;
    return bucket.count <= max;
}

function checkRateLimit(req) {
    return checkRateLimitBucket(rateBuckets, getClientIp(req), RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
}

function checkAuthRateLimit(req) {
    return checkRateLimitBucket(authRateBuckets, 'auth:' + getClientIp(req), AUTH_RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
}

/** Normalize LLM api_base for allowlist comparison (strip trailing slash). */
function normalizeLlmApiBase(url) {
    return String(url || '').trim().replace(/\/+$/, '');
}

/** True if url is on the LLM api_base allowlist (env-extensible). */
function isAllowedLlmApiBase(url) {
    const n = normalizeLlmApiBase(url);
    if (!n) return false;
    if (ALLOWED_LLM_API_BASES.has(n)) return true;
    // Accept host without /v1 if allowlist has either form
    if (ALLOWED_LLM_API_BASES.has(n + '/v1')) return true;
    if (n.endsWith('/v1') && ALLOWED_LLM_API_BASES.has(n.slice(0, -3))) return true;
    return false;
}

/**
 * Resolve a safe api_base. When using server key, always force default.
 * When client provides base outside allowlist, returns null (caller should 400).
 */
function resolveLlmApiBase(requested, { forceDefault = false } = {}) {
    if (forceDefault) return DEFAULT_LLM_API_BASE;
    const n = normalizeLlmApiBase(requested);
    if (!n) return DEFAULT_LLM_API_BASE;
    if (!isAllowedLlmApiBase(n)) return null;
    // Prefer canonical deepseek base with /v1 when matching deepseek host
    if (n === 'https://api.deepseek.com' || n === 'http://api.deepseek.com') {
        return DEFAULT_LLM_API_BASE;
    }
    return n;
}

function getPinAttemptKey(code, ip) {
    return `${normalizeCode(code)}:${ip}`;
}

function isPinLocked(code, ip) {
    const bucket = pinAttemptBuckets.get(getPinAttemptKey(code, ip));
    return bucket?.lockedUntil && bucket.lockedUntil > Date.now();
}

function recordPinFailure(code, ip) {
    const key = getPinAttemptKey(code, ip);
    const now = Date.now();
    let bucket = pinAttemptBuckets.get(key);
    if (!bucket || (bucket.lockedUntil && bucket.lockedUntil <= now)) {
        bucket = { count: 0, lockedUntil: 0 };
    }
    bucket.count++;
    bucket.updatedAt = now;
    if (bucket.count >= PIN_MAX_ATTEMPTS) {
        bucket.lockedUntil = now + PIN_LOCK_MS;
        bucket.count = 0;
    }
    pinAttemptBuckets.set(key, bucket);
}

function clearPinFailures(code, ip) {
    pinAttemptBuckets.delete(getPinAttemptKey(code, ip));
}

// 定期清掃已過期的 rate-limit / PIN 嘗試桶，避免長時間執行後 Map 無限增長（記憶體洩漏）。
const BUCKET_CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

function sweepRateLimitBucket(map, windowMs) {
    const now = Date.now();
    for (const [key, bucket] of map) {
        if (!bucket || now - bucket.start > windowMs) map.delete(key);
    }
}

function sweepPinAttemptBuckets() {
    const now = Date.now();
    for (const [key, bucket] of pinAttemptBuckets) {
        if (!bucket) {
            pinAttemptBuckets.delete(key);
            continue;
        }
        const locked = bucket.lockedUntil && bucket.lockedUntil > now;
        if (!locked && now - (bucket.updatedAt || 0) > PIN_LOCK_MS) {
            pinAttemptBuckets.delete(key);
        }
    }
}

const bucketCleanupInterval = setInterval(() => {
    sweepRateLimitBucket(rateBuckets, RATE_LIMIT_WINDOW_MS);
    sweepRateLimitBucket(authRateBuckets, RATE_LIMIT_WINDOW_MS);
    sweepRateLimitBucket(aiRateBuckets, AI_RATE_LIMIT_WINDOW_MS);
    sweepPinAttemptBuckets();
}, BUCKET_CLEANUP_INTERVAL_MS);
bucketCleanupInterval.unref();

function setCors(req, res) {
    const origin = req.headers.origin;
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
    } else if (!origin) {
        res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS[0] || 'http://localhost:3456');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        let size = 0;
        req.on('data', chunk => {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                reject(new Error('Request body too large'));
                req.destroy();
                return;
            }
            body += chunk;
        });
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (e) {
                reject(new Error('Invalid JSON'));
            }
        });
        req.on('error', reject);
    });
}

function securityHeaders() {
    return {
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
        ...(IS_PRODUCTION ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {})
    };
}

function sendJson(res, status, data) {
    const body = JSON.stringify(data);
    const baseHeaders = { 'Content-Type': 'application/json', ...securityHeaders() };
    const encoding = String(res._req?.headers['accept-encoding'] || '');
    if (body.length > 256 && encoding.includes('gzip')) {
        zlib.gzip(body, (err, compressed) => {
            if (err) {
                res.writeHead(status, baseHeaders);
                res.end(body);
                return;
            }
            res.writeHead(status, {
                ...baseHeaders,
                'Content-Encoding': 'gzip',
                'Vary': 'Accept-Encoding'
            });
            res.end(compressed);
        });
        return;
    }
    res.writeHead(status, baseHeaders);
    res.end(body);
}

/**
 * 統一處理路由未預期例外：body 過大回 413（保留原訊息），其餘一律回 500 並隱藏內部錯誤細節，
 * 完整錯誤只記錄於伺服器 log，避免將堆疊或內部訊息洩漏給前端。
 */
function handleRouteError(res, err, fallbackMsg = '伺服器錯誤') {
    if (err && err.message === 'Request body too large') {
        sendJson(res, 413, { error: err.message });
        return;
    }
    console.error('[Lumina API] 未預期錯誤:', err);
    sendJson(res, 500, { error: fallbackMsg });
}

function sanitizeChatBody(body) {
    if (!body || typeof body !== 'object') return null;
    if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > 50) return null;
    const messages = body.messages.map((m) => {
        if (!m || typeof m !== 'object') return null;
        const role = ['system', 'user', 'assistant'].includes(m.role) ? m.role : 'user';
        const content = clampText(m.content, 16000);
        if (!content) return null;
        return { role, content };
    }).filter(Boolean);
    if (!messages.length) return null;
    const out = {
        model: ['deepseek-chat', 'deepseek-reasoner'].includes(body.model) ? body.model : 'deepseek-chat',
        messages
    };
    if (typeof body.temperature === 'number') {
        out.temperature = Math.min(2, Math.max(0, body.temperature));
    }
    if (typeof body.max_tokens === 'number') {
        out.max_tokens = Math.min(8192, Math.max(1, Math.floor(body.max_tokens)));
    }
    return out;
}

function checkAiRateLimit(userId) {
    const key = userId || 'anonymous';
    return checkRateLimitBucket(aiRateBuckets, key, AI_RATE_LIMIT_MAX, AI_RATE_LIMIT_WINDOW_MS);
}

async function prepareStore(store) {
    for (const group of Object.values(store.groups || {})) {
        await migrateGroupPin(group);
        ensureNotifications(group);
    }
    return store;
}

function uid() {
    return crypto.randomBytes(8).toString('hex');
}

function normalizeCode(code) {
    return String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function getGroup(store, code) {
    const key = normalizeCode(code);
    return store.groups[key] || null;
}

function ensureNotifications(group) {
    if (!Array.isArray(group.notifications)) group.notifications = [];
}

function pushNotification(group, payload) {
    ensureNotifications(group);
    const note = {
        id: uid(),
        type: payload.type,
        recipientId: payload.recipientId,
        title: clampText(payload.title, 80) || '團隊通知',
        message: clampText(payload.message, 300),
        taskId: payload.taskId || null,
        taskTitle: clampText(payload.taskTitle, 120),
        actorId: payload.actorId || null,
        actorName: clampText(payload.actorName, 80),
        read: false,
        createdAt: new Date().toISOString()
    };
    group.notifications.unshift(note);
    if (group.notifications.length > 200) group.notifications.length = 200;
    return note;
}

function parseQuery(req) {
    const idx = (req.url || '').indexOf('?');
    if (idx < 0) return new URLSearchParams();
    return new URLSearchParams((req.url || '').slice(idx + 1));
}

async function getAuthFromRequest(req) {
    const token = parseBearerToken(req);
    if (!token) return null;
    const payload = verifyToken(token);
    if (!payload?.userId) return null;
    return findUserById(payload.userId);
}

async function getOptionalAuth(req) {
    return getAuthFromRequest(req);
}

async function requireAuth(req) {
    const user = await getAuthFromRequest(req);
    if (!user) return null;
    return user;
}

async function requireAiAuth(req) {
    if (ALLOW_ANONYMOUS_AI) return { ok: true, user: null };
    const user = await getAuthFromRequest(req);
    if (!user) {
        return { ok: false, status: 401, error: '請先登入才能使用 AI 功能', code: 'UNAUTHORIZED' };
    }
    return { ok: true, user };
}

/** Send JSON error with machine-readable `code` (keeps human `error` string). */
function sendError(res, status, error, code) {
    const body = { ok: false, error };
    if (code) body.code = code;
    sendJson(res, status, body);
}

function sendAccessResult(res, access) {
    sendError(res, access.status, access.error, access.code);
}

async function assertEnterpriseMember(group, memberId, authUser, options = {}) {
    const { bind = true, store = null } = options;
    if (!group || !memberId) {
        return { ok: false, status: 403, error: '無效的成員或身份驗證失敗', code: 'GROUP_FORBIDDEN' };
    }
    const member = group.members.find(m => m.id === memberId);
    if (!member) {
        return { ok: false, status: 403, error: '無效的成員或身份驗證失敗', code: 'GROUP_FORBIDDEN' };
    }

    if (REQUIRE_ENTERPRISE_AUTH) {
        if (!authUser?.id) {
            return { ok: false, status: 401, error: '請先登入才能使用團隊功能', code: 'UNAUTHORIZED' };
        }
        if (member.userId && member.userId !== authUser.id) {
            return { ok: false, status: 403, error: '此成員已綁定其他帳號', code: 'GROUP_FORBIDDEN' };
        }
        if (!member.userId && bind) {
            member.userId = authUser.id;
            if (store) await saveStore(store);
        }
        return { ok: true, member };
    }

    if (member.userId) {
        if (!authUser?.id || authUser.id !== member.userId) {
            return { ok: false, status: 403, error: '無效的成員或身份驗證失敗', code: 'GROUP_FORBIDDEN' };
        }
    } else if (authUser?.id && bind) {
        member.userId = authUser.id;
        if (store) await saveStore(store);
    }
    return { ok: true, member };
}

/**
 * Group membership for RAG routes.
 * @param {{ requireManager?: boolean }} options
 */
async function assertRagGroupAccess(groupCode, authUser, options = {}) {
    const { requireManager = false } = options;
    const code = normalizeCode(groupCode);
    if (!code) return { ok: false, status: 400, error: '缺少 group_code', code: 'VALIDATION_ERROR' };

    const store = await prepareStore(await loadStore());
    const group = getGroup(store, code);
    if (!group) return { ok: false, status: 404, error: '找不到群組', code: 'GROUP_NOT_FOUND' };

    // Dev anonymous: allow read paths only; write still needs a bound manager when requireManager.
    if (ALLOW_ANONYMOUS_AI && !REQUIRE_ENTERPRISE_AUTH && !requireManager) {
        return { ok: true, group, member: null, store };
    }

    if (!authUser?.id) {
        return { ok: false, status: 401, error: '請先登入才能使用知識庫', code: 'UNAUTHORIZED' };
    }

    const member = group.members.find(m => m.userId === authUser.id);
    if (!member) {
        return { ok: false, status: 403, error: '你不是此群組成員', code: 'GROUP_FORBIDDEN' };
    }
    if (requireManager && member.role !== 'manager') {
        return { ok: false, status: 403, error: '僅主管可管理知識庫', code: 'ROLE_FORBIDDEN' };
    }
    return { ok: true, group, member, store };
}

function isActiveDocument(doc) {
    if (!doc) return false;
    if (doc.deletedAt) return false;
    if (doc.status === 'deleted') return false;
    return true;
}

/**
 * Normalize task-scoped KB + document binding.
 * - docIds must be active documents in the group
 * - if kbIds set, docs must belong to those KBs
 * - if only docIds provided, derive kbIds from them
 */
function normalizeTaskKnowledgeBinding(group, kbIdsRaw, docIdsRaw) {
    ensureKnowledgeBases(group);
    const activeDocs = (group.documents || []).filter(isActiveDocument);
    const docById = new Map(activeDocs.map(d => [d.id, d]));

    let kbIds = [...new Set(
        (Array.isArray(kbIdsRaw) ? kbIdsRaw : [])
            .map(id => normalizeKbId(id))
            .filter(id => id && group.knowledgeBases[id] && isActiveKb(group.knowledgeBases[id]))
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
            return d && kbSet.has(normalizeKbId(d.kbId || 'general'));
        });
    }

    if (!kbIds.length && docIds.length) {
        kbIds = [...new Set(
            docIds.map(id => normalizeKbId(docById.get(id)?.kbId || 'general'))
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

// ── W2-F: Document version history (embedded on document) ──────────────────
// RAG keeps a single active index for the latest version only (no multi-version vectors).

function computeContentHash(content) {
    return crypto.createHash('sha256').update(String(content || ''), 'utf8').digest('hex');
}

/**
 * Snapshot of a document version for history (full content retained server-side).
 * @returns {{ version, title, content, contentHash, filename, fileUrl, docType, createdAt, createdByMemberId, createdByName, changeNote, ragRefHint }}
 */
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

/**
 * Ensure document has currentVersion + versions[] (lazy migrate legacy docs).
 * Mutates doc in place.
 */
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

/** List payload entry — no full content (hasContent flag only). */
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

/**
 * Resolve group membership for document read APIs (member-readable).
 * Accepts memberId (enterprise session) and/or JWT (assertRagGroupAccess fallback).
 */
async function assertDocumentReadAccess(req, store, group, { memberId, groupCode } = {}) {
    const authUser = await getOptionalAuth(req);
    if (memberId) {
        const memberCheck = await assertEnterpriseMember(group, memberId, authUser, { store, bind: false });
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
    const access = await assertRagGroupAccess(groupCode || group.code, authUser, { requireManager: false });
    if (!access.ok) {
        return { ok: false, status: access.status, error: access.error, code: access.code };
    }
    return { ok: true, member: access.member, authUser, store: access.store || store };
}

/**
 * Save optional base64 upload for a document version; returns { ok, fileUrl?, filename?, error?, code? }.
 */
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
        const uniqueFilename = `${uid()}-${safeBase}${ext}`;
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

/** Align with rag_service.normalize_kb_id: [a-z0-9_-], default general. */
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

/**
 * Ensure group.knowledgeBases map exists; migrate from document.kbId; always has general.
 * Returns the map (mutates group). Soft-deleted KBs are not auto-revived (except general).
 */
function ensureKnowledgeBases(group) {
    if (!group.knowledgeBases || typeof group.knowledgeBases !== 'object' || Array.isArray(group.knowledgeBases)) {
        group.knowledgeBases = {};
    }
    const now = new Date().toISOString();
    for (const doc of group.documents || []) {
        if (!isActiveDocument(doc)) continue;
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
            d => isActiveDocument(d) && normalizeKbId(d.kbId || 'general') === kb.id
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

/**
 * Resolve KB for upload/write.
 * - autoCreate defaults true (migration period: unknown kb_id is created on the fly).
 * - Pass auto_create=false / autoCreate=false to require a pre-created active KB.
 * - Unknown / soft-deleted with autoCreate=false → 400 KB_NOT_FOUND.
 * Returns { ok, kb, created } or { ok:false, status, error, code }.
 */
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

/**
 * Soft-delete a KB: wipe RAG index first, then cascade soft-delete docs + mark status=deleted.
 * Aligns with document/delete P0 — if RAG wipe fails, do NOT cascade soft-delete metadata.
 * Mutates group only on success; caller must saveStore when ok:true.
 * @returns {{ ok:true, kb_id, documentsSoftDeleted, ragDeleteOk:true }
 *         | { ok:false, status, error, code, ragDeleteOk?, warning?, kb_id?, documentsSoftDeleted? }}
 */
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
        d => isActiveDocument(d) && normalizeKbId(d.kbId || 'general') === kbId
    );

    // Wipe RAG index before metadata soft-delete when possible (D2 consistency).
    const ragResult = await proxyRagDeleteKb(normalizeCode(group.code), kbId);
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
        if (!isActiveDocument(doc)) continue;
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
        setDocumentRagStatus(doc, 'deleted');
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

/**
 * Wave 3: classify RAG index errors for operators and UI (stable codes, retryable flag).
 * @returns {{ code: string, category: string, message: string, retryable: boolean }}
 */
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

/** In-memory ring of recent index outcomes (Wave 3 ops). */
const RAG_INDEX_EVENT_LIMIT = 40;
/** @type {Array<object>} */
const ragIndexEvents = [];
const serviceStartedAt = Date.now();

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
        const byFile = docs.find(d => isActiveDocument(d) && (
            d.filename === filename || getRagFilenameForDoc(d) === filename
        ));
        if (byFile) return byFile;
    }
    if (title) {
        const byTitle = docs.find(d => isActiveDocument(d) && d.title === title);
        if (byTitle) return byTitle;
    }
    return null;
}

async function persistDocumentRagStatus(groupCode, lookup, status, extra = {}) {
    // Own load→mutate→save critical section — lock it. Callers never hold the
    // 'enterprise' lock themselves at this call site (verified: only reached from
    // the standalone /api/rag/* dispatch and the background RAG index job).
    return withLock('enterprise', async () => {
        const store = await prepareStore(await loadStore());
        const group = getGroup(store, normalizeCode(groupCode));
        if (!group) return false;
        const doc = findGroupDocument(group, lookup);
        if (!doc) return false;
        // Never mark soft-deleted documents as indexed (ghost-index race guard).
        if (status === 'indexed' && !isActiveDocument(doc)) {
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

/**
 * After a successful index that raced with soft-delete: purge the just-written vectors.
 * Best-effort; logs on failure for observability.
 */
async function compensateRagIndexAfterDelete(groupCode, doc) {
    if (!doc) return { ok: false, text: 'document missing' };
    const kbId = doc.kbId || 'general';
    const ragFilename = getRagFilenameForDoc(doc);
    if (!ragFilename) return { ok: true, text: 'no filename' };
    console.warn(
        `[Lumina Backend] index completed after delete; compensating purge doc=${doc.id} file=${ragFilename}`
    );
    const purge = await proxyRagDeleteIndex(normalizeCode(groupCode), kbId, ragFilename);
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

// ── W2-C: Server-side RAG index orchestration ──────────────────────────────
// Prefer sync await within RAG_INDEX_TIMEOUT_MS; on timeout respond pending and
// finish in-process (fire-and-forget) with 1 retry. See document/add response.
const RAG_INDEX_TIMEOUT_MS = Math.max(2000, Number(process.env.RAG_INDEX_TIMEOUT_MS) || 12000);
const RAG_INDEX_MAX_ATTEMPTS = 2; // initial + 1 retry
/** @type {Set<string>} */
const ragBackgroundIndexJobs = new Set();

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

/**
 * Index one enterprise document into rag_service.
 * Prefers non-empty text content (upload-text); else binary from buffer / uploads disk.
 */
async function indexEnterpriseDocumentToRag(groupCode, doc, options = {}) {
    if (!doc) {
        return { ok: false, status: 0, chunks: null, lastError: 'document missing' };
    }
    const kbId = doc.kbId || options.kbId || 'general';
    const title = doc.title || 'untitled';
    const textContent = String(doc.content || '').trim();
    const ragFilename = getRagFilenameForDoc(doc);
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

/** Resolve when promise settles or timeout elapses (does not cancel work). */
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

/**
 * Fire-and-forget completion after timed-out sync path.
 * Reloads store so concurrent writes are not clobbered by stale in-memory doc.
 * Index writeback goes through applyDocumentRagIndexResult (reload + isActiveDocument + compensate).
 */
async function runBackgroundRagIndex(groupCode, docId, options = {}) {
    const key = `${normalizeCode(groupCode)}:${docId}`;
    if (!docId || ragBackgroundIndexJobs.has(key)) return;
    ragBackgroundIndexJobs.add(key);
    try {
        const store = await prepareStore(await loadStore());
        const group = getGroup(store, normalizeCode(groupCode));
        if (!group) return;
        const doc = findGroupDocument(group, { documentId: docId });
        if (!doc || !isActiveDocument(doc)) return;
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
            const store2 = await prepareStore(await loadStore());
            const group2 = getGroup(store2, normalizeCode(groupCode));
            const fresh = group2 ? findGroupDocument(group2, { documentId: docId }) : null;
            if (fresh && isActiveDocument(fresh)) {
                await persistDocumentRagStatus(groupCode, { documentId: docId }, 'failed', {
                    lastError: String(e.message || 'RAG index failed').slice(0, 500)
                });
            }
        } catch (_) {}
    } finally {
        ragBackgroundIndexJobs.delete(key);
    }
}

/**
 * Persist index result after work completes (used by both sync response and timeout tail).
 * Reloads store so concurrent enterprise writes are not clobbered.
 * If doc was soft-deleted during index: never write indexed; compensate with proxyRagDeleteIndex.
 */
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
        const store = await prepareStore(await loadStore());
        const group = getGroup(store, normalizeCode(groupCode));
        if (!group) {
            if (result && result.ok) await compensateRagIndexAfterDelete(groupCode, doc);
            return { ...(result || {}), ok: false, aborted: true, lastError: 'group missing after index' };
        }
        const fresh = findGroupDocument(group, { documentId: doc.id });
        if (!fresh || !isActiveDocument(fresh)) {
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
                groupCode: normalizeCode(groupCode),
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
            groupCode: normalizeCode(groupCode),
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

/**
 * Orchestrate RAG index for a freshly saved (or reindex) document.
 * Sync await within timeout; on timeout leave pending and let the same promise finish
 * (no second index job — avoids double-write to rag_service).
 * @returns {{ ragOk: boolean|null, ragStatus: string, ragPending: boolean, warning?: string, document: object }}
 */
async function orchestrateDocumentRagIndex(groupCode, doc, options = {}) {
    const key = `${normalizeCode(groupCode)}:${doc?.id || ''}`;
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

/** Build client-facing RAG orchestration fields (Wave 3 observability). */
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

/** Normalize rag_service sources → citations[] (keep sources for compat). */
function normalizeRagCitations(sources, group) {
    const list = Array.isArray(sources) ? sources : [];
    const docs = (group?.documents || []).filter(isActiveDocument);
    return list.map((s, idx) => {
        const filename = s.filename || s.file_name || null;
        const kbId = s.kb_id || s.kbId || 'general';
        const match = docs.find(d => {
            if (s.document_id && d.id === s.document_id) return true;
            const ragName = getRagFilenameForDoc(d);
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
    const store = await prepareStore(await loadStore());
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
    const authUser = await getAuthFromRequest(req);
    if (!authUser) {
        sendJson(res, 401, { error: '請先登入才能存取檔案' });
        return true;
    }

    const baseName = path.basename(urlPath);
    if (!baseName || baseName.includes('..')) {
        sendJson(res, 400, { error: '無效的檔案路徑' });
        return true;
    }

    if (!(await canAccessUpload(authUser, baseName))) {
        sendJson(res, 403, { error: '無權存取此檔案' });
        return true;
    }

    const filePath = path.join(UPLOADS_DIR, baseName);
    if (!filePath.startsWith(UPLOADS_DIR) || !fs.existsSync(filePath)) {
        sendJson(res, 404, { error: '找不到檔案' });
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
    const ready = checks.store && checks.auth;
    return {
        ready,
        checks,
        details,
        uptimeSec: Math.floor((Date.now() - serviceStartedAt) / 1000),
        backgroundIndexJobs: ragBackgroundIndexJobs.size
    };
}

async function handleUserData(req, res, urlPath, method) {
    const user = await requireAuth(req);
    if (!user) return sendJson(res, 401, { error: '請先登入' });

    if (method === 'GET' && urlPath === '/api/user/data') {
        const data = await getUserData(user.id);
        return sendJson(res, 200, {
            ok: true,
            data: data || defaultUserData(user.id),
            storage: getUserDataBackend()
        });
    }

    if (method === 'PUT' && urlPath === '/api/user/data') {
        const body = await readBody(req);
        const saved = await saveUserData(user.id, body);
        return sendJson(res, 200, { ok: true, data: saved, storage: getUserDataBackend() });
    }

    if (method === 'PATCH' && urlPath === '/api/user/data') {
        const body = await readBody(req);
        const result = await mergeUserData(user.id, body);
        return sendJson(res, 200, {
            ok: true,
            data: result.data,
            merged: result.merged,
            storage: getUserDataBackend()
        });
    }

    return sendJson(res, 404, { error: 'User data route not found' });
}

async function handleEnterprise(req, res, urlPath, method) {
    const store = await prepareStore(await loadStore());

    if (method === 'POST' && urlPath === '/api/enterprise/group/create') {
        return readBody(req).then(async body => {
            const code = normalizeCode(body.code);
            const name = clampText(body.name, 80) || '未命名團隊';
            const managerName = clampText(body.managerName, 80);
            const managerPin = clampText(body.managerPin, 32);

            if (!code || code.length < 4) {
                return sendJson(res, 400, { error: '群組代碼至少 4 個字元' });
            }
            if (!managerName) {
                return sendJson(res, 400, { error: '請輸入主管名稱' });
            }
            if (!isValidManagerPin(managerPin)) {
                return sendJson(res, 400, { error: '請設定 4–32 位主管 PIN，且不可使用常見弱密碼' });
            }
            if (store.groups[code]) {
                return sendJson(res, 409, { error: '此群組代碼已存在' });
            }

            const authUser = await getOptionalAuth(req);
            const managerId = uid();
            store.groups[code] = {
                code,
                name,
                managerPinHash: await hashPin(managerPin),
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
                    general: createKbRecord('general', {
                        displayName: '一般預設',
                        description: '預設知識庫',
                        createdByMemberId: managerId,
                        createdByUserId: authUser?.id || null,
                        createdByName: managerName
                    })
                }
            };
            await saveStore(store);

            sendJson(res, 200, {
                ok: true,
                group: { code, name },
                member: { id: managerId, name: managerName, role: 'manager' }
            });
        });
    }

    if (method === 'POST' && urlPath === '/api/enterprise/group/join') {
        return readBody(req).then(async body => {
            const code = normalizeCode(body.code);
            const name = clampText(body.name, 80);
            const role = body.role === 'manager' ? 'manager' : 'member';
            const pin = clampText(body.pin, 32);
            const clientIp = getClientIp(req);

            const group = getGroup(store, code);
            if (!group) {
                return sendJson(res, 404, { error: '找不到此群組代碼' });
            }
            if (!name) {
                return sendJson(res, 400, { error: '請輸入你的名稱' });
            }
            if (role === 'manager') {
                if (isPinLocked(code, clientIp)) {
                    return sendJson(res, 429, { error: '主管金鑰嘗試次數過多，請 15 分鐘後再試' });
                }
                if (!(await verifyManagerPin(group, pin))) {
                    recordPinFailure(code, clientIp);
                    return sendJson(res, 403, { error: '主管金鑰錯誤' });
                }
                clearPinFailures(code, clientIp);
            }

            await migrateGroupPin(group);

            const authUser = await getOptionalAuth(req);
            if (authUser) {
                const byUser = group.members.find(m => m.userId === authUser.id);
                if (byUser) {
                    await saveStore(store);
                    return sendJson(res, 200, {
                        ok: true,
                        group: { code: group.code, name: group.name },
                        member: byUser
                    });
                }
            }

            const existing = group.members.find(m => m.name.toLowerCase() === name.toLowerCase());
            if (existing) {
                if (existing.userId && authUser?.id && existing.userId !== authUser.id) {
                    return sendJson(res, 403, { error: '此名稱已綁定其他帳號，請使用已註冊帳號登入' });
                }
                if (authUser?.id && !existing.userId) {
                    existing.userId = authUser.id;
                }
                await saveStore(store);
                return sendJson(res, 200, {
                    ok: true,
                    group: { code: group.code, name: group.name },
                    member: existing
                });
            }

            const member = {
                id: uid(),
                name,
                role,
                userId: authUser?.id || null,
                joinedAt: new Date().toISOString()
            };
            group.members.push(member);
            await saveStore(store);

            sendJson(res, 200, {
                ok: true,
                group: { code: group.code, name: group.name },
                member
            });
        });
    }

    const groupMatch = urlPath.match(/^\/api\/enterprise\/group\/([A-Za-z0-9]+)$/);
    if (method === 'GET' && groupMatch) {
        const group = getGroup(store, groupMatch[1]);
        if (!group) {
            return sendJson(res, 404, { error: '找不到群組' });
        }
        ensureNotifications(group);
        const query = parseQuery(req);
        const memberId = query.get('memberId');
        if (!memberId) {
            return sendJson(res, 403, { error: '需要有效的 memberId 才能讀取群組資料' });
        }
        const authUser = await getOptionalAuth(req);
        const memberCheck = await assertEnterpriseMember(group, memberId, authUser, { store });
        if (!memberCheck.ok) {
            return sendJson(res, memberCheck.status, { error: memberCheck.error });
        }
        const payload = {
            code: group.code,
            name: group.name,
            members: group.members,
            tasks: group.tasks,
            documents: (group.documents || []).filter(isActiveDocument),
            notifications: group.notifications
                .filter(n => n.recipientId === memberId)
                .slice(0, 50),
            unreadCount: group.notifications
                .filter(n => n.recipientId === memberId && !n.read).length
        };
        sendJson(res, 200, { ok: true, group: payload });
        return;
    }

    if (method === 'POST' && urlPath === '/api/enterprise/group/document/add') {
        return readBody(req).then(async body => {
            const code = normalizeCode(body.groupCode);
            const managerId = body.managerId;
            const title = clampText(body.title, 100) || body.filename || '未命名文件';
            const content = clampText(body.content, 10000);
            const docType = clampText(body.docType, 10) || 'text';

            const group = getGroup(store, code);
            if (!group) return sendJson(res, 404, { error: '找不到群組' });

            const authUser = await getOptionalAuth(req);
            const memberCheck = await assertEnterpriseMember(group, managerId, authUser, { store });
            if (!memberCheck.ok) {
                return sendError(res, memberCheck.status || 403, memberCheck.error, memberCheck.code || 'GROUP_FORBIDDEN');
            }
            if (memberCheck.member.role !== 'manager') {
                return sendError(res, 403, '僅主管可管理知識庫', 'ROLE_FORBIDDEN');
            }
            const manager = memberCheck.member;

            if (docType === 'text' && (!title || !content)) {
                return sendJson(res, 400, { error: '請輸入標題與內容', code: 'VALIDATION_ERROR' });
            }
            if (!title) {
                return sendJson(res, 400, { error: '請輸入標題', code: 'VALIDATION_ERROR' });
            }

            let fileUrl = null;
            if ((docType === 'pdf' || docType === 'image' || docType === 'excel') && body.fileData && body.filename) {
                try {
                    const fileBuffer = Buffer.from(body.fileData, 'base64');
                    const ext = (path.extname(body.filename) || (docType === 'pdf' ? '.pdf' : docType === 'excel' ? '.xlsx' : '.png')).toLowerCase();
                    if (!ALLOWED_UPLOAD_EXT.has(ext)) {
                        return sendJson(res, 400, { error: '不支援的檔案類型', code: 'VALIDATION_ERROR' });
                    }
                    if (fileBuffer.length > MAX_UPLOAD_BYTES) {
                        return sendJson(res, 400, { error: '檔案過大（上限 5MB）', code: 'VALIDATION_ERROR' });
                    }
                    const safeBase = path.basename(body.filename, ext).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
                    const uniqueFilename = `${uid()}-${safeBase}${ext}`;
                    const filePath = path.join(UPLOADS_DIR, uniqueFilename);
                    fs.writeFileSync(filePath, fileBuffer);
                    fileUrl = `/uploads/${uniqueFilename}`;
                } catch (e) {
                    return sendJson(res, 500, { error: '檔案儲存失敗: ' + e.message });
                }
            }

            if (!group.documents) group.documents = [];
            const autoCreate = body.auto_create !== false && body.autoCreate !== false;
            const kbResolve = resolveKbForWrite(group, body.kbId || body.kb_id || 'general', {
                autoCreate,
                createdByMemberId: manager.id,
                createdByUserId: manager.userId || authUser?.id || null,
                createdByName: manager.name
            });
            if (!kbResolve.ok) {
                return sendError(res, kbResolve.status, kbResolve.error, kbResolve.code);
            }
            const nowIso = new Date().toISOString();
            const doc = {
                id: uid(),
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
            ensureDocumentVersions(doc, {
                createdByMemberId: manager.id,
                createdByName: manager.name,
                changeNote: clampText(body.changeNote, 200) || 'initial'
            });
            group.documents.unshift(doc);
            ensureKnowledgeBases(group);
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
            const ragOrchestration = await orchestrateDocumentRagIndex(code, doc, {
                fileData: body.fileData || null,
                fileBuffer,
                kbId: doc.kbId
            });

            sendJson(res, 200, buildRagOrchestrationResponse(ragOrchestration, doc));
        });
    }

    // Wave 3: poll single document ragStatus (group members)
    if (
        (method === 'GET' && urlPath === '/api/enterprise/group/document/status')
        || (method === 'POST' && urlPath === '/api/enterprise/group/document/status')
    ) {
        return Promise.resolve().then(async () => {
            const q = parseQuery(req);
            let body = {};
            if (method === 'POST') {
                try { body = await readBody(req); } catch (_) { body = {}; }
            }
            const code = normalizeCode(body.groupCode || q.get('groupCode') || q.get('group_code'));
            const memberId = body.memberId || q.get('memberId') || '';
            const docId = body.documentId || body.document_id || q.get('documentId') || q.get('document_id') || '';

            const group = getGroup(store, code);
            if (!group) return sendError(res, 404, '找不到群組', 'GROUP_NOT_FOUND');

            const authUser = await getOptionalAuth(req);
            const memberCheck = await assertEnterpriseMember(group, memberId, authUser, { store, bind: false });
            if (!memberCheck.ok) {
                return sendError(res, memberCheck.status || 403, memberCheck.error, memberCheck.code || 'GROUP_FORBIDDEN');
            }
            if (!docId) return sendError(res, 400, '缺少 documentId', 'VALIDATION_ERROR');

            const doc = findGroupDocument(group, { documentId: docId });
            if (!doc) return sendError(res, 404, '找不到該文件', 'DOC_NOT_FOUND');

            const rag = doc.rag && typeof doc.rag === 'object' ? doc.rag : {};
            const status = doc.ragStatus || rag.status || 'pending';
            sendJson(res, 200, {
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
                indexing: ragBackgroundIndexJobs.has(`${code}:${doc.id}`)
            });
        });
    }

    if (method === 'POST' && urlPath === '/api/enterprise/group/document/reindex') {
        return readBody(req).then(async body => {
            const code = normalizeCode(body.groupCode);
            const managerId = body.managerId;
            const docId = body.documentId || body.document_id;

            const group = getGroup(store, code);
            if (!group) return sendError(res, 404, '找不到群組', 'GROUP_NOT_FOUND');

            const authUser = await getOptionalAuth(req);
            const memberCheck = await assertEnterpriseMember(group, managerId, authUser, { store });
            if (!memberCheck.ok) {
                return sendError(res, memberCheck.status || 403, memberCheck.error, memberCheck.code || 'GROUP_FORBIDDEN');
            }
            if (memberCheck.member.role !== 'manager') {
                return sendError(res, 403, '僅主管可管理知識庫', 'ROLE_FORBIDDEN');
            }
            if (!docId) {
                return sendError(res, 400, '缺少 documentId', 'VALIDATION_ERROR');
            }

            const doc = findGroupDocument(group, { documentId: docId });
            if (!doc || !isActiveDocument(doc)) {
                return sendError(res, 404, '找不到該文件', 'DOC_NOT_FOUND');
            }

            setDocumentRagStatus(doc, 'pending', { lastError: null });
            await saveStore(store);

            const ragOrchestration = await orchestrateDocumentRagIndex(code, doc, {
                kbId: doc.kbId
            });

            const payload = buildRagOrchestrationResponse(ragOrchestration, doc);
            payload.ok = ragOrchestration.ragOk !== false || !!ragOrchestration.ragPending;
            sendJson(res, 200, payload);
        });
    }

    if (method === 'POST' && urlPath === '/api/enterprise/group/document/delete') {
        return readBody(req).then(async body => {
            const code = normalizeCode(body.groupCode);
            const managerId = body.managerId;
            const docId = body.documentId;

            const group = getGroup(store, code);
            if (!group) return sendError(res, 404, '找不到群組', 'GROUP_NOT_FOUND');

            const authUser = await getOptionalAuth(req);
            const memberCheck = await assertEnterpriseMember(group, managerId, authUser, { store });
            if (!memberCheck.ok) {
                return sendError(res, memberCheck.status || 403, memberCheck.error, memberCheck.code || 'GROUP_FORBIDDEN');
            }
            if (memberCheck.member.role !== 'manager') {
                return sendError(res, 403, '僅主管可管理知識庫', 'ROLE_FORBIDDEN');
            }

            if (!group.documents) group.documents = [];
            const index = group.documents.findIndex(d => d.id === docId && isActiveDocument(d));
            if (index === -1) return sendError(res, 404, '找不到該文件', 'DOC_NOT_FOUND');

            const doc = group.documents[index];
            const kbId = doc.kbId || 'general';
            const ragFilename = getRagFilenameForDoc(doc);

            // Always attempt index cleanup before metadata soft-delete (D2 consistency).
            // If cleanup fails, do NOT soft-delete — keep doc list-visible so manager can retry.
            let ragDeleteOk = true;
            let ragDeleteError = null;
            if (ragFilename) {
                const ragResult = await proxyRagDeleteIndex(code, kbId, ragFilename);
                ragDeleteOk = ragResult.ok;
                if (!ragDeleteOk) {
                    ragDeleteError = ragResult.text || 'RAG index delete failed';
                    console.warn('[Lumina Backend] RAG index delete failed:', ragDeleteError);
                    setDocumentRagStatus(doc, 'failed', {
                        lastError: ragDeleteError || '知識庫索引清除失敗，請重試刪除'
                    });
                    await saveStore(store);
                    return sendJson(res, 200, {
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
            setDocumentRagStatus(doc, 'deleted', { lastError: null });

            await saveStore(store);

            sendJson(res, 200, {
                ok: true,
                ragDeleteOk: true,
                ragStatus: doc.ragStatus
            });
        });
    }

    // ── W2-F: publish new document version (manager only) ──
    // RAG: overwrite single active index with latest content (no multi-version vectors).
    if (method === 'POST' && urlPath === '/api/enterprise/group/document/version') {
        return readBody(req).then(async body => {
            const code = normalizeCode(body.groupCode);
            const managerId = body.managerId;
            const docId = body.documentId || body.document_id;

            const group = getGroup(store, code);
            if (!group) return sendError(res, 404, '找不到群組', 'GROUP_NOT_FOUND');

            const authUser = await getOptionalAuth(req);
            const memberCheck = await assertEnterpriseMember(group, managerId, authUser, { store });
            if (!memberCheck.ok) {
                return sendError(res, memberCheck.status || 403, memberCheck.error, memberCheck.code || 'GROUP_FORBIDDEN');
            }
            if (memberCheck.member.role !== 'manager') {
                return sendError(res, 403, '僅主管可管理知識庫', 'ROLE_FORBIDDEN');
            }
            if (!docId) {
                return sendError(res, 400, '缺少 documentId', 'VALIDATION_ERROR');
            }

            const doc = findGroupDocument(group, { documentId: docId });
            if (!doc || !isActiveDocument(doc)) {
                return sendError(res, 404, '找不到該文件', 'DOC_NOT_FOUND');
            }

            ensureDocumentVersions(doc, {
                createdByMemberId: doc.authorMemberId || null,
                createdByName: doc.author || null
            });

            const manager = memberCheck.member;
            const prevRagFilename = getRagFilenameForDoc(doc);

            // Merge fields: omitted fields keep current document values
            const nextTitle = body.title != null
                ? (clampText(body.title, 100) || doc.title)
                : doc.title;
            const nextDocType = body.docType != null
                ? (clampText(body.docType, 10) || doc.docType || 'text')
                : (doc.docType || 'text');
            let nextContent = body.content != null
                ? clampText(body.content, 10000)
                : doc.content;
            const changeNote = clampText(body.changeNote, 200) || null;

            if (nextDocType === 'text' && body.content !== undefined && !String(nextContent || '').trim()) {
                return sendError(res, 400, '請輸入文件內容', 'VALIDATION_ERROR');
            }
            if (body.title !== undefined && !String(nextTitle || '').trim()) {
                return sendError(res, 400, '請輸入標題', 'VALIDATION_ERROR');
            }

            const upload = trySaveDocumentUpload(body, nextDocType);
            if (!upload.ok) {
                return sendError(res, 400, upload.error || '檔案儲存失敗', upload.code || 'VALIDATION_ERROR');
            }

            let nextFileUrl = doc.fileUrl || null;
            let nextFilename = doc.filename || null;
            if (upload.fileUrl) {
                nextFileUrl = upload.fileUrl;
                nextFilename = upload.filename || body.filename || nextFilename;
            } else if (body.filename != null && body.filename !== '') {
                nextFilename = clampText(body.filename, 200) || nextFilename;
            }

            const nextVersion = (Number(doc.currentVersion) || 1) + 1;
            const nowIso = new Date().toISOString();
            const snapshot = buildDocumentVersionSnapshot(doc, {
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
            setDocumentRagStatus(doc, 'pending', { lastError: null });

            await saveStore(store);

            // If RAG index key would change, best-effort purge old key before reindex
            const nextRagFilename = getRagFilenameForDoc(doc);
            if (prevRagFilename && nextRagFilename && prevRagFilename !== nextRagFilename) {
                await proxyRagDeleteIndex(code, doc.kbId || 'general', prevRagFilename);
            }

            let fileBuffer = upload.fileBuffer || null;
            if (!fileBuffer && body.fileData && typeof body.fileData === 'string') {
                try {
                    fileBuffer = Buffer.from(body.fileData, 'base64');
                } catch (_) {
                    fileBuffer = null;
                }
            }

            const ragOrchestration = await orchestrateDocumentRagIndex(code, doc, {
                fileData: body.fileData || null,
                fileBuffer,
                kbId: doc.kbId
            });

            sendJson(res, 200, {
                ...buildRagOrchestrationResponse(ragOrchestration, doc),
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
            const query = method === 'GET' ? parseQuery(req) : null;
            const code = normalizeCode(
                (query && (query.get('groupCode') || query.get('group_code'))) || body.groupCode || body.group_code
            );
            const docId = (query && (query.get('documentId') || query.get('document_id')))
                || body.documentId || body.document_id;
            const memberId = (query && (query.get('memberId') || query.get('member_id')))
                || body.memberId || body.member_id;

            if (!code) return sendError(res, 400, '缺少 groupCode', 'VALIDATION_ERROR');
            if (!docId) return sendError(res, 400, '缺少 documentId', 'VALIDATION_ERROR');

            const group = getGroup(store, code);
            if (!group) return sendError(res, 404, '找不到群組', 'GROUP_NOT_FOUND');

            const access = await assertDocumentReadAccess(req, store, group, { memberId, groupCode: code });
            if (!access.ok) {
                return sendError(res, access.status, access.error, access.code);
            }

            // History is readable for soft-deleted docs too (audit); prefer active match
            let doc = findGroupDocument(group, { documentId: docId });
            if (!doc) {
                doc = (group.documents || []).find(d => d.id === docId) || null;
            }
            if (!doc) return sendError(res, 404, '找不到該文件', 'DOC_NOT_FOUND');

            ensureDocumentVersions(doc, {
                createdByMemberId: doc.authorMemberId || null,
                createdByName: doc.author || null
            });
            // Persist lazy migration so subsequent reads are consistent
            await saveStore(store);

            const versions = (doc.versions || [])
                .slice()
                .sort((a, b) => (Number(b.version) || 0) - (Number(a.version) || 0))
                .map(summarizeVersionMeta)
                .filter(Boolean);

            sendJson(res, 200, {
                ok: true,
                documentId: doc.id,
                currentVersion: doc.currentVersion || 1,
                versions
            });
        };

        if (method === 'POST') {
            return readBody(req).then(body => handleListVersions(body || {}));
        }
        return handleListVersions({});
    }

    // ── W2-F: get one document version (full content, members) ──
    if (
        (method === 'GET' && urlPath === '/api/enterprise/group/document/version')
        || (method === 'POST' && urlPath === '/api/enterprise/group/document/version/get')
    ) {
        const handleGetVersion = async (body = {}) => {
            const query = method === 'GET' ? parseQuery(req) : null;
            const code = normalizeCode(
                (query && (query.get('groupCode') || query.get('group_code'))) || body.groupCode || body.group_code
            );
            const docId = (query && (query.get('documentId') || query.get('document_id')))
                || body.documentId || body.document_id;
            const versionRaw = (query && (query.get('version') || query.get('v')))
                || body.version || body.v;
            const memberId = (query && (query.get('memberId') || query.get('member_id')))
                || body.memberId || body.member_id;

            if (!code) return sendError(res, 400, '缺少 groupCode', 'VALIDATION_ERROR');
            if (!docId) return sendError(res, 400, '缺少 documentId', 'VALIDATION_ERROR');
            const versionNum = parseInt(versionRaw, 10);
            if (!Number.isFinite(versionNum) || versionNum < 1) {
                return sendError(res, 400, '缺少或無效的 version', 'VALIDATION_ERROR');
            }

            const group = getGroup(store, code);
            if (!group) return sendError(res, 404, '找不到群組', 'GROUP_NOT_FOUND');

            const access = await assertDocumentReadAccess(req, store, group, { memberId, groupCode: code });
            if (!access.ok) {
                return sendError(res, access.status, access.error, access.code);
            }

            let doc = findGroupDocument(group, { documentId: docId });
            if (!doc) {
                doc = (group.documents || []).find(d => d.id === docId) || null;
            }
            if (!doc) return sendError(res, 404, '找不到該文件', 'DOC_NOT_FOUND');

            ensureDocumentVersions(doc, {
                createdByMemberId: doc.authorMemberId || null,
                createdByName: doc.author || null
            });

            const snap = (doc.versions || []).find(v => Number(v.version) === versionNum);
            if (!snap) {
                return sendError(res, 404, '找不到該版本', 'DOC_VERSION_NOT_FOUND');
            }

            sendJson(res, 200, {
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
            return readBody(req).then(body => handleGetVersion(body || {}));
        }
        return handleGetVersion({});
    }

    // ── W2-F: restore soft-deleted document (manager only) ──
    if (method === 'POST' && urlPath === '/api/enterprise/group/document/restore') {
        return readBody(req).then(async body => {
            const code = normalizeCode(body.groupCode);
            const managerId = body.managerId;
            const docId = body.documentId || body.document_id;
            const reindex = body.reindex !== false && body.reIndex !== false;

            const group = getGroup(store, code);
            if (!group) return sendError(res, 404, '找不到群組', 'GROUP_NOT_FOUND');

            const authUser = await getOptionalAuth(req);
            const memberCheck = await assertEnterpriseMember(group, managerId, authUser, { store });
            if (!memberCheck.ok) {
                return sendError(res, memberCheck.status || 403, memberCheck.error, memberCheck.code || 'GROUP_FORBIDDEN');
            }
            if (memberCheck.member.role !== 'manager') {
                return sendError(res, 403, '僅主管可管理知識庫', 'ROLE_FORBIDDEN');
            }
            if (!docId) {
                return sendError(res, 400, '缺少 documentId', 'VALIDATION_ERROR');
            }

            const doc = (group.documents || []).find(d => d.id === docId);
            if (!doc) return sendError(res, 404, '找不到該文件', 'DOC_NOT_FOUND');

            if (isActiveDocument(doc)) {
                return sendJson(res, 200, {
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
            ensureDocumentVersions(doc, {
                createdByMemberId: doc.authorMemberId || null,
                createdByName: doc.author || null
            });

            if (reindex) {
                setDocumentRagStatus(doc, 'pending', { lastError: null });
                await saveStore(store);
                const ragOrchestration = await orchestrateDocumentRagIndex(code, doc, {
                    kbId: doc.kbId
                });
                return sendJson(res, 200, {
                    ...buildRagOrchestrationResponse(ragOrchestration, doc),
                    currentVersion: doc.currentVersion || 1,
                    restored: true
                });
            }

            setDocumentRagStatus(doc, 'pending', { lastError: null });
            await saveStore(store);
            sendJson(res, 200, {
                ok: true,
                document: doc,
                currentVersion: doc.currentVersion || 1,
                ragStatus: doc.ragStatus || 'pending',
                restored: true
            });
        });
    }

    if (method === 'POST' && urlPath === '/api/enterprise/task/assign') {
        return readBody(req).then(async body => {
            const code = normalizeCode(body.groupCode);
            const managerId = body.managerId;
            const assigneeId = body.assigneeId;
            const title = clampText(body.title, 200);

            const group = getGroup(store, code);
            if (!group) return sendJson(res, 404, { error: '找不到群組' });

            const authUser = await getOptionalAuth(req);
            const memberCheck = await assertEnterpriseMember(group, managerId, authUser, { store });
            if (!memberCheck.ok || memberCheck.member.role !== 'manager') {
                return sendJson(res, memberCheck.status || 403, { error: memberCheck.error || '僅主管可指派任務' });
            }
            const manager = memberCheck.member;

            const assignee = group.members.find(m => m.id === assigneeId);
            if (!assignee) return sendJson(res, 404, { error: '找不到成員' });
            if (!title) return sendJson(res, 400, { error: '請輸入任務名稱' });

            // Optional knowledge-base / document binding for coach RAG (task-scoped)
            const bound = normalizeTaskKnowledgeBinding(group, body.kbIds, body.docIds);

            const task = {
                id: uid(),
                title,
                assigneeId: assignee.id,
                assigneeName: assignee.name,
                assignedBy: manager.name,
                assignedById: manager.id,
                duration: Math.min(480, Math.max(5, parseInt(body.duration, 10) || 30)),
                energy: Math.min(5, Math.max(1, parseInt(body.energy, 10) || 3)),
                category: ['deep', 'execution', 'meeting', 'learning', 'admin'].includes(body.category)
                    ? body.category : 'execution',
                due: clampText(body.due, 12) || new Date().toISOString().split('T')[0],
                kbIds: bound.kbIds,
                docIds: bound.docIds,
                completed: false,
                completedAt: null,
                createdAt: new Date().toISOString()
            };

            group.tasks.unshift(task);
            const notifications = [];
            if (assignee.id !== manager.id) {
                notifications.push(pushNotification(group, {
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
            notifications.push(pushNotification(group, {
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
            sendJson(res, 200, { ok: true, task, notifications });
        });
    }

    const taskMatch = urlPath.match(/^\/api\/enterprise\/task\/([a-f0-9]+)$/);
    if (method === 'PATCH' && taskMatch) {
        return readBody(req).then(async body => {
            const code = normalizeCode(body.groupCode);
            const memberId = body.memberId;
            const group = getGroup(store, code);
            if (!group) return sendJson(res, 404, { error: '找不到群組' });

            const task = group.tasks.find(t => t.id === taskMatch[1]);
            if (!task) return sendJson(res, 404, { error: '找不到任務' });

            const authUser = await getOptionalAuth(req);
            const memberCheck = await assertEnterpriseMember(group, memberId, authUser, { store });
            if (!memberCheck.ok) {
                return sendJson(res, memberCheck.status, { error: memberCheck.error });
            }
            const member = memberCheck.member;

            const canEdit = member.role === 'manager' || task.assigneeId === memberId;
            if (!canEdit) return sendJson(res, 403, { error: '無權限更新此任務' });

            // Manager may rebind knowledge bases / documents for coach scope
            if (member.role === 'manager' && (Array.isArray(body.kbIds) || Array.isArray(body.docIds))) {
                const bound = normalizeTaskKnowledgeBinding(
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
                        notifications.push(pushNotification(group, {
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
                        notifications.push(pushNotification(group, {
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
            sendJson(res, 200, { ok: true, task, notifications });
        });
    }

    if (method === 'GET' && urlPath === '/api/enterprise/notifications') {
        const query = parseQuery(req);
        const code = normalizeCode(query.get('groupCode'));
        const memberId = query.get('memberId');
        const group = getGroup(store, code);
        if (!group) return sendJson(res, 404, { error: '找不到群組' });
        const authUser = await getOptionalAuth(req);
        const memberCheck = await assertEnterpriseMember(group, memberId, authUser, { store });
        if (!memberCheck.ok) {
            return sendJson(res, memberCheck.status, { error: memberCheck.error });
        }
        ensureNotifications(group);
        const notifications = group.notifications
            .filter(n => n.recipientId === memberId)
            .slice(0, 50);
        const unreadCount = notifications.filter(n => !n.read).length;
        sendJson(res, 200, { ok: true, notifications, unreadCount });
        return;
    }

    if (method === 'PATCH' && urlPath === '/api/enterprise/notifications/read') {
        return readBody(req).then(async body => {
            const code = normalizeCode(body.groupCode);
            const memberId = body.memberId;
            const group = getGroup(store, code);
            if (!group) return sendJson(res, 404, { error: '找不到群組' });
            const authUser = await getOptionalAuth(req);
            const memberCheck = await assertEnterpriseMember(group, memberId, authUser, { store });
            if (!memberCheck.ok) {
                return sendJson(res, memberCheck.status, { error: memberCheck.error });
            }
            ensureNotifications(group);
            const ids = Array.isArray(body.ids) ? body.ids : [];
            let updated = 0;
            for (const note of group.notifications) {
                if (note.recipientId !== memberId) continue;
                if (body.readAll || ids.includes(note.id)) {
                    if (!note.read) updated++;
                    note.read = true;
                }
            }
            await saveStore(store);
            sendJson(res, 200, { ok: true, updated });
        });
    }

    sendJson(res, 404, { error: 'Enterprise route not found' });
}

async function handleAuth(req, res, urlPath, method) {
    if (!checkAuthRateLimit(req)) {
        return sendJson(res, 429, { error: '認證請求過於頻繁，請稍後再試' });
    }

    if (method === 'POST' && urlPath === '/api/auth/register') {
        const body = await readBody(req);
        const name = clampAuthText(body.name, 40);
        const email = normalizeEmail(body.email);
        const role = clampAuthText(body.role, 40) || '知識工作者';
        const password = String(body.password || '');

        if (!name) return sendJson(res, 400, { error: '請輸入顯示名稱' });
        if (!isValidEmail(email)) return sendJson(res, 400, { error: '請輸入有效的電子郵件' });
        if (password.length < 6) return sendJson(res, 400, { error: '密碼至少需要 6 個字元' });
        if (password.length > 64) return sendJson(res, 400, { error: '密碼過長' });

        const existing = await findUserByEmail(email);
        if (existing) return sendJson(res, 409, { error: '此電子郵件已註冊，請直接登入' });

        try {
            const passwordHash = await hashPassword(password);
            const user = await createUser({ email, name, role, passwordHash });
            await saveUserData(user.id, defaultUserData(user.id));
            const token = signToken({ userId: user.id, email: user.email });
            return sendJson(res, 201, { ok: true, token, user: sanitizeUser(user) });
        } catch (err) {
            if (err.code === 'EMAIL_EXISTS' || err.code === 11000) {
                return sendJson(res, 409, { error: '此電子郵件已註冊，請直接登入' });
            }
            throw err;
        }
    }

    if (method === 'POST' && urlPath === '/api/auth/login') {
        const body = await readBody(req);
        const email = normalizeEmail(body.email);
        const password = String(body.password || '');

        if (!isValidEmail(email)) return sendJson(res, 400, { error: '請輸入有效的電子郵件' });
        if (!password) return sendJson(res, 400, { error: '請輸入密碼' });

        const user = await findUserByEmail(email);
        if (!user) return sendJson(res, 401, { error: '電子郵件或密碼錯誤' });

        const valid = await verifyPassword(password, user.passwordHash);
        if (!valid) return sendJson(res, 401, { error: '電子郵件或密碼錯誤' });

        await ensureUserData(user.id);
        const token = signToken({ userId: user.id, email: user.email });
        return sendJson(res, 200, { ok: true, token, user: sanitizeUser(user) });
    }

    if (method === 'GET' && urlPath === '/api/auth/me') {
        const token = parseBearerToken(req);
        const payload = verifyToken(token);
        if (!payload) return sendJson(res, 401, { error: '登入已過期，請重新登入' });

        const user = await findUserById(payload.userId);
        if (!user) return sendJson(res, 401, { error: '帳號不存在' });
        return sendJson(res, 200, { ok: true, user: sanitizeUser(user) });
    }

    if (method === 'PATCH' && urlPath === '/api/auth/profile') {
        const token = parseBearerToken(req);
        const payload = verifyToken(token);
        if (!payload) return sendJson(res, 401, { error: '登入已過期，請重新登入' });

        const body = await readBody(req);
        const patch = {};
        if (body.name !== undefined) {
            const name = clampAuthText(body.name, 40);
            if (!name) return sendJson(res, 400, { error: '請輸入顯示名稱' });
            patch.name = name;
        }
        if (body.role !== undefined) patch.role = clampAuthText(body.role, 40) || '知識工作者';
        if (!Object.keys(patch).length) return sendJson(res, 400, { error: '沒有可更新的欄位' });

        const user = await updateUser(payload.userId, patch);
        if (!user) return sendJson(res, 404, { error: '帳號不存在' });
        return sendJson(res, 200, { ok: true, user: sanitizeUser(user) });
    }

    return sendJson(res, 404, { error: 'Auth route not found' });
}

function attachRequestLogging(req, res, urlPath) {
    const requestId = crypto.randomBytes(4).toString('hex');
    const startMs = Date.now();
    res.setHeader('X-Request-Id', requestId);
    res.on('finish', () => {
        if (urlPath === '/health' || urlPath === '/ready') return;
        console.log(`[req:${requestId}] ${req.method} ${urlPath} ${res.statusCode} ${Date.now() - startMs}ms`);
    });
}

const server = http.createServer(async (req, res) => {
    res._req = req;
    const urlPath = (req.url || '').split('?')[0];
    attachRequestLogging(req, res, urlPath);
    setCors(req, res);

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    if (!checkRateLimit(req)) {
        sendJson(res, 429, { error: '請求過於頻繁，請稍後再試' });
        return;
    }

    if (req.method === 'GET' && urlPath === '/health') {
        const dbStats = await getDatabaseStats();
        const ragDetail = await probeRagHealthDetail();
        sendJson(res, 200, {
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
            backgroundIndexJobs: ragBackgroundIndexJobs.size,
            observability: 'w3'
        });
        return;
    }

    if (req.method === 'GET' && urlPath === '/ready') {
        const readiness = await getReadiness();
        sendJson(res, readiness.ready ? 200 : 503, {
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
        const readiness = await getReadiness();
        const limit = Math.min(40, Math.max(1, Number(parseQuery(req).get('limit')) || 20));
        sendJson(res, 200, {
            ok: true,
            service: 'lumina-api-proxy',
            ready: readiness.ready,
            checks: readiness.checks,
            details: readiness.details,
            uptimeSec: readiness.uptimeSec,
            backgroundIndexJobs: readiness.backgroundIndexJobs,
            recentIndexEvents: ragIndexEvents.slice(0, limit),
            aiRateLimit: {
                max: AI_RATE_LIMIT_MAX,
                windowMs: AI_RATE_LIMIT_WINDOW_MS
            },
            ragIndexTimeoutMs: RAG_INDEX_TIMEOUT_MS
        });
        return;
    }

    if (req.method === 'GET' && urlPath.startsWith('/uploads/')) {
        await serveUploadFile(req, res, urlPath);
        return;
    }

    if (urlPath.startsWith('/api/user')) {
        try {
            await handleUserData(req, res, urlPath, req.method);
        } catch (err) {
            handleRouteError(res, err);
        }
        return;
    }

    if (urlPath.startsWith('/api/auth')) {
        try {
            await handleAuth(req, res, urlPath, req.method);
        } catch (err) {
            handleRouteError(res, err);
        }
        return;
    }

    if (urlPath.startsWith('/api/enterprise')) {
        try {
            await handleEnterprise(req, res, urlPath, req.method);
        } catch (err) {
            handleRouteError(res, err);
        }
        return;
    }

    if (urlPath.startsWith('/api/rag/')) {
        try {
            const aiAuth = await requireAiAuth(req);
            if (!aiAuth.ok) {
                sendError(res, aiAuth.status, aiAuth.error, aiAuth.code || 'UNAUTHORIZED');
                return;
            }

            // GET /api/rag/kb | /api/rag/kb/list — member list (kb_ids + items)
            if (req.method === 'GET' && (urlPath === '/api/rag/kb/list' || urlPath === '/api/rag/kb')) {
                const query = parseQuery(req);
                const groupCode = query.get('group_code') || query.get('groupCode') || '';
                const access = await assertRagGroupAccess(groupCode, aiAuth.user);
                if (!access.ok) {
                    sendAccessResult(res, access);
                    return;
                }
                const store = await prepareStore(await loadStore());
                const group = getGroup(store, groupCode);
                if (!group) {
                    sendError(res, 404, '找不到群組', 'GROUP_NOT_FOUND');
                    return;
                }
                const hadKbMap = !!(group.knowledgeBases && typeof group.knowledgeBases === 'object'
                    && !Array.isArray(group.knowledgeBases) && Object.keys(group.knowledgeBases).length);
                ensureKnowledgeBases(group);
                // Persist lazy migration once so list survives restarts
                if (!hadKbMap) await saveStore(store);
                sendJson(res, 200, buildKbListResponse(group));
                return;
            }

            // POST /api/rag/kb — manager create
            if (req.method === 'POST' && urlPath === '/api/rag/kb') {
                const body = await readBody(req);
                const groupCode = body.group_code || body.groupCode || '';
                const access = await assertRagGroupAccess(groupCode, aiAuth.user, { requireManager: true });
                if (!access.ok) {
                    sendAccessResult(res, access);
                    return;
                }
                const store = await prepareStore(await loadStore());
                const group = getGroup(store, groupCode);
                if (!group) {
                    sendError(res, 404, '找不到群組', 'GROUP_NOT_FOUND');
                    return;
                }
                ensureKnowledgeBases(group);

                const displayName = clampText(body.displayName || body.display_name || body.name, 80);
                if (!displayName) {
                    sendError(res, 400, '請提供 displayName', 'VALIDATION_ERROR');
                    return;
                }
                const explicitId = clampText(body.id || body.kb_id || body.kbId, 30);
                let kbId;
                if (explicitId) {
                    kbId = normalizeKbId(explicitId);
                } else {
                    const slug = displayName
                        .toLowerCase()
                        .replace(/[\s]+/g, '-')
                        .replace(/[^a-z0-9_-]/g, '');
                    kbId = slug ? normalizeKbId(slug) : normalizeKbId('kb' + uid().slice(0, 10));
                    // Chinese-only names slug to empty → general; use random id instead
                    if (kbId === 'general') {
                        kbId = normalizeKbId('kb' + uid().slice(0, 10));
                    }
                }
                if (!kbId) {
                    sendError(res, 400, '無效的知識庫 id', 'INVALID_KB_ID');
                    return;
                }

                const existing = group.knowledgeBases[kbId];
                if (existing && isActiveKb(existing)) {
                    sendError(res, 409, '知識庫 id 已存在', 'KB_EXISTS');
                    return;
                }

                const description = clampText(body.description, 500);
                const kb = createKbRecord(kbId, {
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
                sendJson(res, 200, { ok: true, knowledgeBase: serializeKbItem(kb) });
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
                const query = parseQuery(req);
                groupCode = query.get('group_code') || query.get('groupCode') || '';
                let body = {};
                try {
                    body = await readBody(req);
                    if (!groupCode) groupCode = body.group_code || body.groupCode || '';
                    if (!kbIdRaw) kbIdRaw = body.kb_id || body.kbId || body.id || '';
                } catch (_) {
                    body = {};
                }
                if (!kbIdRaw && query.get('kb_id')) kbIdRaw = query.get('kb_id');
                if (!String(kbIdRaw || '').trim()) {
                    sendError(res, 400, '缺少 kb_id', 'VALIDATION_ERROR');
                    return;
                }

                const access = await assertRagGroupAccess(groupCode, aiAuth.user, { requireManager: true });
                if (!access.ok) {
                    sendAccessResult(res, access);
                    return;
                }

                const store = await prepareStore(await loadStore());
                const group = getGroup(store, groupCode);
                if (!group) {
                    sendError(res, 404, '找不到群組', 'GROUP_NOT_FOUND');
                    return;
                }

                const result = await softDeleteKnowledgeBase(group, kbIdRaw);
                // Fail-closed wipe (non-empty KB): no metadata mutation
                if (!result.ok && result.ragDeleteOk === false) {
                    console.warn(
                        `[Lumina API] KB delete aborted (RAG wipe fail) group=${normalizeCode(groupCode)} kb=${result.kb_id}`
                    );
                    sendJson(res, 200, {
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
                    sendError(res, result.status, result.error, result.code);
                    return;
                }
                // ok:true may still have ragDeleteOk:false (empty KB, RAG unreachable — metadata-only)
                await saveStore(store);
                sendJson(res, 200, {
                    ok: true,
                    kb_id: result.kb_id,
                    documentsSoftDeleted: result.documentsSoftDeleted,
                    ragDeleteOk: result.ragDeleteOk !== false,
                    warning: result.warning
                });
                return;
            }

            if (req.method === 'POST' && urlPath === '/api/rag/query') {
                const aiUserId = aiAuth.user?.id || getClientIp(req);
                if (!checkAiRateLimit(aiUserId)) {
                    sendError(res, 429, 'AI 請求過於頻繁，請稍後再試', 'RATE_LIMITED');
                    return;
                }
                const body = await readBody(req);
                const access = await assertRagGroupAccess(body.group_code, aiAuth.user);
                if (!access.ok) {
                    sendAccessResult(res, access);
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
                    body.api_base = resolveLlmApiBase(null, { forceDefault: true });
                } else if (body.api_base != null && String(body.api_base).trim()) {
                    const resolved = resolveLlmApiBase(body.api_base);
                    if (!resolved) {
                        sendError(res, 400, 'api_base is not allowed', 'API_BASE_FORBIDDEN');
                        return;
                    }
                    body.api_base = resolved;
                } else if (hasClientLlmKey) {
                    body.api_base = DEFAULT_LLM_API_BASE;
                }
                // Only search active KBs (soft-deleted KB ids are dropped)
                ensureKnowledgeBases(access.group);
                const activeKbIds = new Set(
                    Object.values(access.group.knowledgeBases || {})
                        .filter(isActiveKb)
                        .map(k => k.id)
                );
                if (Array.isArray(body.kb_ids) && body.kb_ids.length) {
                    body.kb_ids = body.kb_ids
                        .map(id => normalizeKbId(id))
                        .filter(id => activeKbIds.has(id));
                    if (!body.kb_ids.length) {
                        // Client asked only for deleted/unknown KBs — empty answer, no RAG fan-out
                        sendJson(res, 200, {
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
                        sendJson(res, 200, {
                            answer: '抱歉，根據目前的知識庫資料，我無法回答此問題。',
                            sources: [],
                            citations: [],
                            retrieval_mode: 'none',
                            embedding_mode: 'none'
                        });
                        return;
                    }
                    body.document_filenames = body.document_ids
                        .map(id => getRagFilenameForDoc(byId.get(id)))
                        .filter(Boolean)
                        .slice(0, 50);
                } else {
                    delete body.document_ids;
                    delete body.document_filenames;
                }
                const proxied = await proxyRagJson('/api/rag/query', body);
                // Attach citations[] while keeping sources for compatibility
                if (proxied.status >= 200 && proxied.status < 300) {
                    try {
                        const data = JSON.parse(proxied.text || '{}');
                        if (data && typeof data === 'object') {
                            data.citations = normalizeRagCitations(data.sources || data.citations, access.group);
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
                const body = await readBody(req);
                const access = await assertRagGroupAccess(body.group_code, aiAuth.user, { requireManager: true });
                if (!access.ok) {
                    sendAccessResult(res, access);
                    return;
                }
                // Require active KB (auto_create default true for migration)
                const storeForKb = await prepareStore(await loadStore());
                const groupForKb = getGroup(storeForKb, body.group_code);
                if (!groupForKb) {
                    sendError(res, 404, '找不到群組', 'GROUP_NOT_FOUND');
                    return;
                }
                const autoCreate = body.auto_create !== false && body.autoCreate !== false;
                const kbResolve = resolveKbForWrite(groupForKb, body.kb_id || body.kbId || 'general', {
                    autoCreate,
                    createdByMemberId: access.member?.id || null,
                    createdByUserId: access.member?.userId || aiAuth.user?.id || null,
                    createdByName: access.member?.name || null
                });
                if (!kbResolve.ok) {
                    sendError(res, kbResolve.status, kbResolve.error, kbResolve.code);
                    return;
                }
                body.kb_id = kbResolve.kb.id;
                if (kbResolve.created) await saveStore(storeForKb);

                const lookup = {
                    documentId: body.document_id || body.documentId || null,
                    filename: body.filename || null,
                    title: body.title || null
                };
                const proxied = await proxyRagJson('/api/rag/document/upload-text', body);
                let chunks = null;
                let lastError = null;
                if (proxied.status >= 200 && proxied.status < 300) {
                    try {
                        const data = JSON.parse(proxied.text || '{}');
                        chunks = data.chunks != null ? data.chunks : null;
                    } catch (_) {}
                    await persistDocumentRagStatus(body.group_code, lookup, 'indexed', { chunks, lastError: null });
                } else {
                    try {
                        const data = JSON.parse(proxied.text || '{}');
                        lastError = data.detail || data.error || proxied.text || 'RAG index failed';
                    } catch (_) {
                        lastError = proxied.text || 'RAG index failed';
                    }
                    await persistDocumentRagStatus(body.group_code, lookup, 'failed', { lastError: String(lastError).slice(0, 500) });
                }
                res.writeHead(proxied.status, { 'Content-Type': 'application/json' });
                res.end(proxied.text);
                return;
            }

            if (req.method === 'POST' && urlPath === '/api/rag/document/upload') {
                const body = await readBody(req);
                const access = await assertRagGroupAccess(body.group_code, aiAuth.user, { requireManager: true });
                if (!access.ok) {
                    sendAccessResult(res, access);
                    return;
                }
                if (!body.file_base64 || !body.filename) {
                    sendError(res, 400, '缺少 file_base64 或 filename', 'VALIDATION_ERROR');
                    return;
                }
                const storeForKb = await prepareStore(await loadStore());
                const groupForKb = getGroup(storeForKb, body.group_code);
                if (!groupForKb) {
                    sendError(res, 404, '找不到群組', 'GROUP_NOT_FOUND');
                    return;
                }
                const autoCreate = body.auto_create !== false && body.autoCreate !== false;
                const kbResolve = resolveKbForWrite(groupForKb, body.kb_id || body.kbId || 'general', {
                    autoCreate,
                    createdByMemberId: access.member?.id || null,
                    createdByUserId: access.member?.userId || aiAuth.user?.id || null,
                    createdByName: access.member?.name || null
                });
                if (!kbResolve.ok) {
                    sendError(res, kbResolve.status, kbResolve.error, kbResolve.code);
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
                const binResult = await proxyRagUploadBinaryIndex({
                    groupCode: body.group_code,
                    kbId: body.kb_id || 'general',
                    filename: body.filename,
                    fileBuffer,
                    documentId,
                    title
                });
                if (binResult.ok) {
                    await persistDocumentRagStatus(body.group_code, lookup, 'indexed', {
                        chunks: binResult.chunks,
                        lastError: null
                    });
                    sendJson(res, binResult.status || 200, {
                        ok: true,
                        chunks: binResult.chunks,
                        document_id: documentId,
                        filename: body.filename
                    });
                } else {
                    await persistDocumentRagStatus(body.group_code, lookup, 'failed', {
                        lastError: String(binResult.lastError || 'RAG index failed').slice(0, 500)
                    });
                    sendJson(res, binResult.status || 500, {
                        ok: false,
                        error: binResult.lastError || 'RAG index failed'
                    });
                }
                return;
            }

            if (req.method === 'POST' && urlPath === '/api/rag/document/delete') {
                const body = await readBody(req);
                const access = await assertRagGroupAccess(body.group_code, aiAuth.user, { requireManager: true });
                if (!access.ok) {
                    sendAccessResult(res, access);
                    return;
                }
                const form = new URLSearchParams();
                form.set('group_code', body.group_code || '');
                form.set('kb_id', body.kb_id || 'general');
                form.set('filename', body.filename || '');
                const response = await fetch(`${RAG_SERVICE_URL}/api/rag/document/delete`, {
                    method: 'POST',
                    headers: buildRagHeaders({ 'Content-Type': 'application/x-www-form-urlencoded' }),
                    body: form.toString()
                });
                const text = await response.text();
                const lookup = {
                    documentId: body.document_id || body.documentId || null,
                    filename: body.filename || null
                };
                if (response.ok || response.status === 404) {
                    const store = await prepareStore(await loadStore());
                    const group = getGroup(store, body.group_code);
                    const doc = findGroupDocument(group, lookup);
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
                    await persistDocumentRagStatus(body.group_code, lookup, 'failed', {
                        lastError: String(lastError).slice(0, 500)
                    });
                }
                res.writeHead(response.status, { 'Content-Type': 'application/json' });
                res.end(text);
                return;
            }

            sendJson(res, 404, { error: 'RAG route not found' });
        } catch (err) {
            handleRouteError(res, err, 'RAG 代理失敗');
        }
        return;
    }

    if (req.method === 'POST' && urlPath === '/api/chat') {
        const aiAuth = await requireAiAuth(req);
        if (!aiAuth.ok) {
            sendJson(res, aiAuth.status, { error: aiAuth.error });
            return;
        }
        if (!API_KEY) {
            sendJson(res, 500, { error: 'Missing DEEPSEEK_API_KEY environment variable' });
            return;
        }
        const aiUserId = aiAuth.user?.id || getClientIp(req);
        if (!checkAiRateLimit(aiUserId)) {
            sendJson(res, 429, { error: 'AI 請求過於頻繁，請稍後再試' });
            return;
        }
        try {
            const rawBody = await readBody(req);
            const body = sanitizeChatBody(rawBody);
            if (!body) {
                sendJson(res, 400, { error: '無效的 AI 請求格式' });
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
            handleRouteError(res, err, 'AI 請求失敗');
        }
        return;
    }

    sendJson(res, 404, { error: 'Not found' });
});

enforceProductionSecrets();

initDb().then(async connected => {
    await ensureIndexes();
    await initStore();
    await initAuthStore();
    await initUserDataStore();
    server.listen(PORT, async () => {
        const dbStats = await getDatabaseStats();
        console.log(`Lumina API proxy running at http://localhost:${PORT}`);
        console.log(`  POST /api/chat                    → DeepSeek`);
        console.log(`  POST /api/rag/query               → RAG 知識庫查詢（注入 API Key）`);
        console.log(`  GET  /api/rag/kb[/list]           → KB 列表（kb_ids + items）`);
        console.log(`  POST /api/rag/kb                  → 建立 KB（manager）`);
        console.log(`  POST /api/rag/kb/delete           → 軟刪 KB（manager）`);
        console.log(`  DELETE /api/rag/kb/:kbId          → 軟刪 KB（manager）`);
        console.log(`  POST /api/auth/register           → 註冊帳號`);
        console.log(`  POST /api/auth/login              → 登入`);
        console.log(`  GET  /api/auth/me                 → 取得目前使用者`);
        console.log(`  PATCH /api/auth/profile           → 更新個人資料`);
        console.log(`  GET  /api/user/data               → 取得個人資料`);
        console.log(`  PUT  /api/user/data               → 儲存個人資料`);
        console.log(`  PATCH /api/user/data              → 合併個人資料`);
        console.log(`  GET  /ready                       → 就緒檢查（store + auth + RAG）`);
        console.log(`  GET  /uploads/:file               → 團隊上傳檔案（需 JWT）`);
        console.log(`  POST /api/enterprise/group/create → 建立群組`);
        console.log(`  POST /api/enterprise/group/join   → 加入群組`);
        console.log(`  GET  /api/enterprise/group/:code  → 群組資料`);
        console.log(`  POST /api/enterprise/group/document/add     → 文件 + server RAG 索引`);
        console.log(`  POST /api/enterprise/group/document/version → 發新版本 + 覆寫 RAG 索引`);
        console.log(`  GET  /api/enterprise/group/document/versions→ 列出版本歷史（成員可讀）`);
        console.log(`  GET  /api/enterprise/group/document/version → 讀取單一版本內容`);
        console.log(`  POST /api/enterprise/group/document/restore → 軟刪還原（manager）`);
        console.log(`  POST /api/enterprise/group/document/reindex → 重試 RAG 索引（manager）`);
        console.log(`  GET  /api/enterprise/group/document/status  → 輪詢 ragStatus（成員）`);
        console.log(`  GET  /api/ops/status                       → 可觀測快照（ready + 近期索引事件）`);
        console.log(`  POST /api/enterprise/group/document/delete  → 清索引後 soft-delete`);
        console.log(`  POST /api/enterprise/task/assign  → 指派任務`);
        console.log(`  PATCH /api/enterprise/task/:id    → 更新任務`);
        console.log(`  GET  /api/enterprise/notifications → 團隊通知`);
        console.log(`  PATCH /api/enterprise/notifications/read → 標記已讀`);
        console.log(`  Storage backend: ${getStoreBackend()}`);
        console.log(`  Auth storage: ${getAuthBackend()}`);
        console.log(`  User data storage: ${getUserDataBackend()}`);
        if (connected && dbStats.collections) {
            console.log(`  Database stats: users=${dbStats.collections.users}, user_data=${dbStats.collections.user_data}, groups=${dbStats.collections.enterprise_groups}`);
        }
        console.log(`  Allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
        console.log(`  AI rate limit: ${AI_RATE_LIMIT_MAX} requests / ${AI_RATE_LIMIT_WINDOW_MS / 60000} min / user`);
        console.log(`  LLM api_base allowlist: ${[...ALLOWED_LLM_API_BASES].join(', ')}`);
        if (!API_KEY) console.warn('  ⚠️  DEEPSEEK_API_KEY not set (AI chat proxy disabled)');
        if (PIN_SALT === 'lumina-pin-salt-change-in-production') {
            console.warn('  ⚠️  Using default PIN_SALT — set PIN_SALT env in production');
        }
        if (getJwtConfig().usingDefaultSecret) {
            console.warn('  ⚠️  Using default JWT_SECRET — set JWT_SECRET env in production');
        }
        if (!RAG_API_KEY) {
            console.warn('  ⚠️  RAG_API_KEY not set — RAG service should only listen on localhost');
        }
        if (IS_PRODUCTION) {
            console.log('  Production secret enforcement: enabled');
        }
        if (REQUIRE_ENTERPRISE_AUTH) {
            console.log('  Enterprise auth: required (memberId + JWT binding)');
        }
        if (ALLOW_ANONYMOUS_AI) {
            console.warn('  ⚠️  ALLOW_ANONYMOUS_AI=1 — /api/chat 與 /api/rag 允許匿名（僅限開發）');
        }
    });
}).catch(err => {
    console.error('[Lumina API] 啟動失敗:', err.message);
    process.exit(1);
});