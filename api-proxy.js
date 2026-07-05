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
const AI_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
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

function hashPin(pin) {
    return bcrypt.hashSync(String(pin), 10);
}

function verifyLegacyPinHash(pin, hash) {
    return crypto.createHash('sha256').update(PIN_SALT + ':' + String(pin)).digest('hex') === hash;
}

function verifyPinHash(pin, hash) {
    if (!hash) return false;
    if (String(hash).startsWith('$2')) return bcrypt.compareSync(String(pin), hash);
    return verifyLegacyPinHash(pin, hash);
}

function verifyManagerPin(group, pin) {
    if (group.managerPinHash) {
        const ok = verifyPinHash(pin, group.managerPinHash);
        if (ok && !String(group.managerPinHash).startsWith('$2')) {
            group.managerPinHash = hashPin(pin);
        }
        return ok;
    }
    if (group.managerPin !== undefined) {
        return String(pin) === String(group.managerPin);
    }
    return false;
}

function migrateGroupPin(group) {
    if (!group.managerPinHash && group.managerPin !== undefined) {
        group.managerPinHash = hashPin(group.managerPin);
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

function checkRateLimitBucket(map, key, max) {
    const now = Date.now();
    let bucket = map.get(key);
    if (!bucket || now - bucket.start > RATE_LIMIT_WINDOW_MS) {
        bucket = { start: now, count: 0 };
        map.set(key, bucket);
    }
    bucket.count++;
    return bucket.count <= max;
}

function checkRateLimit(req) {
    return checkRateLimitBucket(rateBuckets, getClientIp(req), RATE_LIMIT_MAX);
}

function checkAuthRateLimit(req) {
    return checkRateLimitBucket(authRateBuckets, 'auth:' + getClientIp(req), AUTH_RATE_LIMIT_MAX);
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
    if (bucket.count >= PIN_MAX_ATTEMPTS) {
        bucket.lockedUntil = now + PIN_LOCK_MS;
        bucket.count = 0;
    }
    pinAttemptBuckets.set(key, bucket);
}

function clearPinFailures(code, ip) {
    pinAttemptBuckets.delete(getPinAttemptKey(code, ip));
}

function setCors(req, res) {
    const origin = req.headers.origin;
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
    } else if (!origin) {
        res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS[0] || 'http://localhost:3456');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
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
    return checkRateLimitBucket(aiRateBuckets, key, AI_RATE_LIMIT_MAX);
}

function prepareStore(store) {
    for (const group of Object.values(store.groups || {})) {
        migrateGroupPin(group);
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
    if (!user) return { ok: false, status: 401, error: '請先登入才能使用 AI 功能' };
    return { ok: true, user };
}

async function assertEnterpriseMember(group, memberId, authUser, options = {}) {
    const { bind = true, store = null } = options;
    if (!group || !memberId) {
        return { ok: false, status: 403, error: '無效的成員或身份驗證失敗' };
    }
    const member = group.members.find(m => m.id === memberId);
    if (!member) {
        return { ok: false, status: 403, error: '無效的成員或身份驗證失敗' };
    }

    if (REQUIRE_ENTERPRISE_AUTH) {
        if (!authUser?.id) {
            return { ok: false, status: 401, error: '請先登入才能使用團隊功能' };
        }
        if (member.userId && member.userId !== authUser.id) {
            return { ok: false, status: 403, error: '此成員已綁定其他帳號' };
        }
        if (!member.userId && bind) {
            member.userId = authUser.id;
            if (store) await saveStore(store);
        }
        return { ok: true, member };
    }

    if (member.userId) {
        if (!authUser?.id || authUser.id !== member.userId) {
            return { ok: false, status: 403, error: '無效的成員或身份驗證失敗' };
        }
    } else if (authUser?.id && bind) {
        member.userId = authUser.id;
        if (store) await saveStore(store);
    }
    return { ok: true, member };
}

async function assertRagGroupAccess(groupCode, authUser) {
    const code = normalizeCode(groupCode);
    if (!code) return { ok: false, status: 400, error: '缺少 group_code' };

    const store = prepareStore(await loadStore());
    const group = getGroup(store, code);
    if (!group) return { ok: false, status: 404, error: '找不到群組' };

    if (ALLOW_ANONYMOUS_AI && !REQUIRE_ENTERPRISE_AUTH) {
        return { ok: true, group };
    }

    if (!authUser?.id) {
        return { ok: false, status: 401, error: '請先登入才能使用知識庫' };
    }

    const member = group.members.find(m => m.userId === authUser.id);
    if (!member) {
        return { ok: false, status: 403, error: '你不是此群組成員' };
    }
    return { ok: true, group, member };
}

async function canAccessUpload(authUser, filename) {
    if (!authUser?.id) return false;
    const store = prepareStore(await loadStore());
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

async function getReadiness() {
    const checks = { store: false, auth: false, rag: false };
    try {
        await loadStore();
        checks.store = true;
    } catch (_) {}
    try {
        checks.auth = !!getAuthBackend();
    } catch (_) {}
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2000);
        const response = await fetch(`${RAG_SERVICE_URL}/health`, { signal: controller.signal });
        clearTimeout(timer);
        checks.rag = response.ok;
    } catch (_) {}
    const ready = checks.store && checks.auth;
    return { ready, checks };
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
    const store = prepareStore(await loadStore());

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
                managerPinHash: hashPin(managerPin),
                createdAt: new Date().toISOString(),
                members: [{
                    id: managerId,
                    name: managerName,
                    role: 'manager',
                    userId: authUser?.id || null,
                    joinedAt: new Date().toISOString()
                }],
                tasks: [],
                notifications: []
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
                if (!verifyManagerPin(group, pin)) {
                    recordPinFailure(code, clientIp);
                    return sendJson(res, 403, { error: '主管金鑰錯誤' });
                }
                clearPinFailures(code, clientIp);
            }

            migrateGroupPin(group);

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
            documents: group.documents || [],
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
            if (!memberCheck.ok || memberCheck.member.role !== 'manager') {
                return sendJson(res, memberCheck.status || 403, { error: memberCheck.error || '僅主管可管理知識庫' });
            }
            const manager = memberCheck.member;

            if (docType === 'text' && (!title || !content)) {
                return sendJson(res, 400, { error: '請輸入標題與內容' });
            }
            if (!title) {
                return sendJson(res, 400, { error: '請輸入標題' });
            }

            let fileUrl = null;
            if ((docType === 'pdf' || docType === 'image' || docType === 'excel') && body.fileData && body.filename) {
                try {
                    const fileBuffer = Buffer.from(body.fileData, 'base64');
                    const ext = (path.extname(body.filename) || (docType === 'pdf' ? '.pdf' : docType === 'excel' ? '.xlsx' : '.png')).toLowerCase();
                    if (!ALLOWED_UPLOAD_EXT.has(ext)) {
                        return sendJson(res, 400, { error: '不支援的檔案類型' });
                    }
                    if (fileBuffer.length > MAX_UPLOAD_BYTES) {
                        return sendJson(res, 400, { error: '檔案過大（上限 5MB）' });
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
            const doc = {
                id: uid(),
                title,
                content, // represents extractedText or description for files
                docType,
                fileUrl,
                filename: body.filename || null,
                kbId: clampText(body.kbId, 30) || 'general',
                author: manager.name,
                createdAt: new Date().toISOString()
            };
            group.documents.unshift(doc);
            await saveStore(store);

            sendJson(res, 200, { ok: true, document: doc });
        });
    }

    if (method === 'POST' && urlPath === '/api/enterprise/group/document/delete') {
        return readBody(req).then(async body => {
            const code = normalizeCode(body.groupCode);
            const managerId = body.managerId;
            const docId = body.documentId;

            const group = getGroup(store, code);
            if (!group) return sendJson(res, 404, { error: '找不到群組' });

            const authUser = await getOptionalAuth(req);
            const memberCheck = await assertEnterpriseMember(group, managerId, authUser, { store });
            if (!memberCheck.ok || memberCheck.member.role !== 'manager') {
                return sendJson(res, memberCheck.status || 403, { error: memberCheck.error || '僅主管可管理知識庫' });
            }

            if (!group.documents) group.documents = [];
            const index = group.documents.findIndex(d => d.id === docId);
            if (index === -1) return sendJson(res, 404, { error: '找不到該文件' });

            const doc = group.documents[index];
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

            group.documents.splice(index, 1);
            await saveStore(store);

            sendJson(res, 200, { ok: true });
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
        sendJson(res, 200, {
            ok: true,
            service: 'lumina-api-proxy',
            enterprise: true,
            auth: true,
            userData: true,
            storage: getStoreBackend(),
            authStorage: getAuthBackend(),
            userDataStorage: getUserDataBackend(),
            database: dbStats
        });
        return;
    }

    if (req.method === 'GET' && urlPath === '/ready') {
        const { ready, checks } = await getReadiness();
        sendJson(res, ready ? 200 : 503, {
            ok: ready,
            service: 'lumina-api-proxy',
            checks
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
            const status = err.message === 'Request body too large' ? 413 : 500;
            sendJson(res, status, { error: err.message || '伺服器錯誤' });
        }
        return;
    }

    if (urlPath.startsWith('/api/auth')) {
        try {
            await handleAuth(req, res, urlPath, req.method);
        } catch (err) {
            const status = err.message === 'Request body too large' ? 413 : 500;
            sendJson(res, status, { error: err.message || '伺服器錯誤' });
        }
        return;
    }

    if (urlPath.startsWith('/api/enterprise')) {
        try {
            await handleEnterprise(req, res, urlPath, req.method);
        } catch (err) {
            const status = err.message === 'Request body too large' ? 413 : 500;
            sendJson(res, status, { error: err.message });
        }
        return;
    }

    if (urlPath.startsWith('/api/rag/')) {
        try {
            const aiAuth = await requireAiAuth(req);
            if (!aiAuth.ok) {
                sendJson(res, aiAuth.status, { error: aiAuth.error });
                return;
            }

            if (req.method === 'GET' && urlPath === '/api/rag/kb/list') {
                const query = parseQuery(req);
                const groupCode = query.get('group_code') || query.get('groupCode') || '';
                const access = await assertRagGroupAccess(groupCode, aiAuth.user);
                if (!access.ok) {
                    sendJson(res, access.status, { error: access.error });
                    return;
                }
                const proxied = await proxyRagGet(`/api/rag/kb/list?group_code=${encodeURIComponent(groupCode)}`);
                res.writeHead(proxied.status, { 'Content-Type': 'application/json' });
                res.end(proxied.text);
                return;
            }

            if (req.method === 'POST' && urlPath === '/api/rag/query') {
                const aiUserId = aiAuth.user?.id || getClientIp(req);
                if (!checkAiRateLimit(aiUserId)) {
                    sendJson(res, 429, { error: 'AI 請求過於頻繁，請稍後再試' });
                    return;
                }
                const body = await readBody(req);
                const access = await assertRagGroupAccess(body.group_code, aiAuth.user);
                if (!access.ok) {
                    sendJson(res, access.status, { error: access.error });
                    return;
                }
                if (!body.deepseek_api_key && !body.openai_api_key && API_KEY) {
                    body.deepseek_api_key = API_KEY;
                    body.api_base = body.api_base || 'https://api.deepseek.com/v1';
                }
                const proxied = await proxyRagJson('/api/rag/query', body);
                res.writeHead(proxied.status, { 'Content-Type': 'application/json' });
                res.end(proxied.text);
                return;
            }

            if (req.method === 'POST' && urlPath === '/api/rag/document/upload-text') {
                const body = await readBody(req);
                const access = await assertRagGroupAccess(body.group_code, aiAuth.user);
                if (!access.ok) {
                    sendJson(res, access.status, { error: access.error });
                    return;
                }
                const proxied = await proxyRagJson('/api/rag/document/upload-text', body);
                res.writeHead(proxied.status, { 'Content-Type': 'application/json' });
                res.end(proxied.text);
                return;
            }

            if (req.method === 'POST' && urlPath === '/api/rag/document/upload') {
                const body = await readBody(req);
                const access = await assertRagGroupAccess(body.group_code, aiAuth.user);
                if (!access.ok) {
                    sendJson(res, access.status, { error: access.error });
                    return;
                }
                if (!body.file_base64 || !body.filename) {
                    sendJson(res, 400, { error: '缺少 file_base64 或 filename' });
                    return;
                }
                const fileBuffer = Buffer.from(body.file_base64, 'base64');
                const boundary = 'lumina-rag-' + crypto.randomBytes(8).toString('hex');
                const parts = [
                    `--${boundary}\r\nContent-Disposition: form-data; name="group_code"\r\n\r\n${body.group_code || ''}\r\n`,
                    `--${boundary}\r\nContent-Disposition: form-data; name="kb_id"\r\n\r\n${body.kb_id || 'general'}\r\n`,
                    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${body.filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
                    fileBuffer,
                    `\r\n--${boundary}--\r\n`
                ];
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
                res.writeHead(response.status, { 'Content-Type': 'application/json' });
                res.end(text);
                return;
            }

            if (req.method === 'POST' && urlPath === '/api/rag/document/delete') {
                const body = await readBody(req);
                const access = await assertRagGroupAccess(body.group_code, aiAuth.user);
                if (!access.ok) {
                    sendJson(res, access.status, { error: access.error });
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
                res.writeHead(response.status, { 'Content-Type': 'application/json' });
                res.end(text);
                return;
            }

            sendJson(res, 404, { error: 'RAG route not found' });
        } catch (err) {
            const status = err.message === 'Request body too large' ? 413 : 500;
            sendJson(res, status, { error: err.message || 'RAG 代理失敗' });
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
            const status = err.message === 'Request body too large' ? 413 : 500;
            sendJson(res, status, { error: { message: err.message } });
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