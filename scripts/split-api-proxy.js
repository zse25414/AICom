/**
 * Modularize api-proxy.js → server/* (behavior-preserving).
 * Prefers api-proxy.monolith.bak.js as source if present.
 *
 *   node scripts/split-api-proxy.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const bak = path.join(root, 'api-proxy.monolith.bak.js');
const srcPath = fs.existsSync(bak) ? bak : path.join(root, 'api-proxy.js');
const lines = fs.readFileSync(srcPath, 'utf8').split(/\r?\n/);

function slice(a, b) {
    return lines.slice(a - 1, b).join('\n');
}
function write(rel, content) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content.replace(/\n+$/, '') + '\n', 'utf8');
    console.log('wrote', rel, Math.round(Buffer.byteLength(content) / 1024) + 'KB');
}

// ── config ────────────────────────────────────────────────────────────
write('server/config.js', [
    "/**",
    " * server/config — 環境與全域常數（無業務邏輯）",
    " * 擁有者：Backend / Platform",
    " */",
    "'use strict';",
    "",
    "const path = require('path');",
    "const fs = require('fs');",
    "const { loadEnvFile } = require('../lib/env');",
    "const { getJwtConfig } = require('../lib/auth');",
    "",
    "loadEnvFile();",
    "",
    "const PORT = process.env.PORT || 3001;",
    "const API_KEY = process.env.DEEPSEEK_API_KEY;",
    "const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';",
    "const RAG_SERVICE_URL = process.env.RAG_SERVICE_URL || 'http://127.0.0.1:8000';",
    "const RAG_API_KEY = (process.env.RAG_API_KEY || '').trim();",
    "const IS_PRODUCTION = process.env.NODE_ENV === 'production' || process.env.LUMINA_ENFORCE_SECRETS === '1';",
    "const REQUIRE_ENTERPRISE_AUTH = IS_PRODUCTION || process.env.REQUIRE_ENTERPRISE_AUTH === '1';",
    "const ALLOW_ANONYMOUS_AI = !IS_PRODUCTION && process.env.ALLOW_ANONYMOUS_AI === '1';",
    "const DATA_FILE = path.join(__dirname, '..', 'enterprise-data.json');",
    "const PIN_SALT = process.env.PIN_SALT || 'lumina-pin-salt-change-in-production';",
    "const MAX_BODY_BYTES = 6 * 1024 * 1024;",
    "const RATE_LIMIT_WINDOW_MS = 60 * 1000;",
    "const RATE_LIMIT_MAX = 120;",
    "const AUTH_RATE_LIMIT_MAX = 20;",
    "const PIN_MAX_ATTEMPTS = 5;",
    "const PIN_LOCK_MS = 15 * 60 * 1000;",
    "const AI_RATE_LIMIT_MAX = 30;",
    "const AI_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;",
    "const DEFAULT_LLM_API_BASE = 'https://api.deepseek.com/v1';",
    "const ALLOWED_LLM_API_BASES = new Set(",
    "    (process.env.ALLOWED_LLM_API_BASES || 'https://api.deepseek.com,https://api.deepseek.com/v1')",
    "        .split(',')",
    "        .map(s => s.trim().replace(/\\/+$/, ''))",
    "        .filter(Boolean)",
    ");",
    "const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;",
    "const ALLOWED_UPLOAD_EXT = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.xlsx', '.xls', '.csv']);",
    "const WEAK_PINS = new Set(['0000', '1234', '1111', '9999', '4321', '1212', 'password', 'admin']);",
    "const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');",
    "if (!fs.existsSync(UPLOADS_DIR)) {",
    "    fs.mkdirSync(UPLOADS_DIR, { recursive: true });",
    "}",
    "const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:3456,http://127.0.0.1:3456,http://localhost:3000,http://127.0.0.1:3000')",
    "    .split(',')",
    "    .map(s => s.trim())",
    "    .filter(Boolean);",
    "",
    "const RAG_INDEX_TIMEOUT_MS = Math.max(2000, Number(process.env.RAG_INDEX_TIMEOUT_MS) || 12000);",
    "const RAG_INDEX_MAX_ATTEMPTS = 2;",
    "const RAG_INDEX_EVENT_LIMIT = 40;",
    "const serviceStartedAt = Date.now();",
    "",
    "function enforceProductionSecrets() {",
    "    if (!IS_PRODUCTION) return;",
    "    const missing = [];",
    "    if (getJwtConfig().usingDefaultSecret) missing.push('JWT_SECRET');",
    "    if (PIN_SALT === 'lumina-pin-salt-change-in-production') missing.push('PIN_SALT');",
    "    if (!RAG_API_KEY) missing.push('RAG_API_KEY');",
    "    if (!API_KEY) missing.push('DEEPSEEK_API_KEY');",
    "    if (missing.length) {",
    "        console.error('[Lumina API] 生產環境缺少必要密鑰設定:', missing.join(', '));",
    "        process.exit(1);",
    "    }",
    "}",
    "",
    "module.exports = {",
    "    PORT, API_KEY, DEEPSEEK_URL, RAG_SERVICE_URL, RAG_API_KEY,",
    "    IS_PRODUCTION, REQUIRE_ENTERPRISE_AUTH, ALLOW_ANONYMOUS_AI,",
    "    DATA_FILE, PIN_SALT, MAX_BODY_BYTES,",
    "    RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX, AUTH_RATE_LIMIT_MAX,",
    "    PIN_MAX_ATTEMPTS, PIN_LOCK_MS, AI_RATE_LIMIT_MAX, AI_RATE_LIMIT_WINDOW_MS,",
    "    DEFAULT_LLM_API_BASE, ALLOWED_LLM_API_BASES,",
    "    MAX_UPLOAD_BYTES, ALLOWED_UPLOAD_EXT, WEAK_PINS, UPLOADS_DIR, ALLOWED_ORIGINS,",
    "    RAG_INDEX_TIMEOUT_MS, RAG_INDEX_MAX_ATTEMPTS, RAG_INDEX_EVENT_LIMIT,",
    "    serviceStartedAt, enforceProductionSecrets",
    "};",
    ""
].join('\n'));

// ── helpers body ──────────────────────────────────────────────────────
let helpers = slice(122, 2827);
helpers = helpers
    .replace(/\/\*\* In-memory ring of recent index outcomes \(Wave 3 ops\)\. \*\/\r?\nconst RAG_INDEX_EVENT_LIMIT = 40;\r?\n\/\*\* @type \{Array<object>\} \*\/\r?\nconst ragIndexEvents = \[\];\r?\nconst serviceStartedAt = Date\.now\(\);\r?\n/, '')
    .replace(/\/\/ ── W2-C: Server-side RAG index orchestration ─+\r?\n\/\/ Prefer sync await within RAG_INDEX_TIMEOUT_MS; on timeout respond pending and\r?\n\/\/ finish in-process \(fire-and-forget\) with 1 retry\. See document\/add response\.\r?\nconst RAG_INDEX_TIMEOUT_MS = Math\.max\(2000, Number\(process\.env\.RAG_INDEX_TIMEOUT_MS\) \|\| 12000\);\r?\nconst RAG_INDEX_MAX_ATTEMPTS = 2; \/\/ initial \+ 1 retry\r?\n\/\*\* @type \{Set<string>\} \*\/\r?\nconst ragBackgroundIndexJobs = new Set\(\);\r?\n/, '// (RAG index constants from config; jobs/events in preamble)\n');

// ── createServer body → dispatchRequest ───────────────────────────────
const serverStart = lines.findIndex((l) => l.includes('http.createServer'));
if (serverStart < 0) throw new Error('createServer not found');
let depth = 0;
let bodyStart = -1;
let bodyEnd = -1;
for (let i = serverStart; i < lines.length; i++) {
    for (const ch of lines[i]) {
        if (ch === '{') {
            depth++;
            if (bodyStart < 0) bodyStart = i;
        } else if (ch === '}') {
            depth--;
            if (depth === 0 && bodyStart >= 0) {
                bodyEnd = i;
                break;
            }
        }
    }
    if (bodyEnd >= 0) break;
}
if (bodyEnd < 0) throw new Error('could not find createServer body end');
const dispatchBody = lines.slice(bodyStart + 1, bodyEnd).join('\n');

const runtimeParts = [];
runtimeParts.push("/**");
runtimeParts.push(" * server/runtime-legacy — 過渡期領域實作（由 api-proxy 機械遷移）");
runtimeParts.push(" * 新功能請寫到 server/routes/* 或 domain/*，不要再加長本檔。");
runtimeParts.push(" */");
runtimeParts.push("'use strict';");
runtimeParts.push("");
runtimeParts.push("const http = require('http');");
runtimeParts.push("const fs = require('fs');");
runtimeParts.push("const path = require('path');");
runtimeParts.push("const crypto = require('crypto');");
runtimeParts.push("const zlib = require('zlib');");
runtimeParts.push("const bcrypt = require('bcryptjs');");
runtimeParts.push("const { withLock } = require('../lib/write-queue');");
runtimeParts.push("const { initDb, ensureIndexes, getDatabaseStats } = require('../lib/db');");
runtimeParts.push("const { initStore, loadStore, saveStore, getStoreBackend } = require('../lib/enterprise-store');");
runtimeParts.push("const { initAuthStore, findUserByEmail, findUserById, createUser, updateUser, getAuthBackend } = require('../lib/auth-store');");
runtimeParts.push("const { initUserDataStore, getUserData, saveUserData, mergeUserData, ensureUserData, getUserDataBackend, defaultUserData } = require('../lib/user-data-store');");
runtimeParts.push("const { normalizeEmail, isValidEmail, clampText: clampAuthText, signToken, verifyToken, parseBearerToken, hashPassword, verifyPassword, sanitizeUser, getJwtConfig } = require('../lib/auth');");
runtimeParts.push("");
runtimeParts.push("const config = require('./config');");
runtimeParts.push("const {");
runtimeParts.push("    PORT, API_KEY, DEEPSEEK_URL, RAG_SERVICE_URL, RAG_API_KEY,");
runtimeParts.push("    IS_PRODUCTION, REQUIRE_ENTERPRISE_AUTH, ALLOW_ANONYMOUS_AI,");
runtimeParts.push("    DATA_FILE, PIN_SALT, MAX_BODY_BYTES,");
runtimeParts.push("    RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX, AUTH_RATE_LIMIT_MAX,");
runtimeParts.push("    PIN_MAX_ATTEMPTS, PIN_LOCK_MS, AI_RATE_LIMIT_MAX, AI_RATE_LIMIT_WINDOW_MS,");
runtimeParts.push("    DEFAULT_LLM_API_BASE, ALLOWED_LLM_API_BASES,");
runtimeParts.push("    MAX_UPLOAD_BYTES, ALLOWED_UPLOAD_EXT, WEAK_PINS, UPLOADS_DIR, ALLOWED_ORIGINS,");
runtimeParts.push("    RAG_INDEX_TIMEOUT_MS, RAG_INDEX_MAX_ATTEMPTS, RAG_INDEX_EVENT_LIMIT,");
runtimeParts.push("    serviceStartedAt, enforceProductionSecrets");
runtimeParts.push("} = config;");
runtimeParts.push("");
runtimeParts.push("const rateBuckets = new Map();");
runtimeParts.push("const authRateBuckets = new Map();");
runtimeParts.push("const pinAttemptBuckets = new Map();");
runtimeParts.push("const aiRateBuckets = new Map();");
runtimeParts.push("const ragIndexEvents = [];");
runtimeParts.push("const ragBackgroundIndexJobs = new Set();");
runtimeParts.push("");
runtimeParts.push(helpers);
runtimeParts.push("");
runtimeParts.push("async function dispatchRequest(req, res) {");
runtimeParts.push(dispatchBody);
runtimeParts.push("}");
runtimeParts.push("");
runtimeParts.push("function createServer() {");
runtimeParts.push("    return http.createServer(async (req, res) => {");
runtimeParts.push("        try {");
runtimeParts.push("            await dispatchRequest(req, res);");
runtimeParts.push("        } catch (err) {");
runtimeParts.push("            handleRouteError(res, err);");
runtimeParts.push("        }");
runtimeParts.push("    });");
runtimeParts.push("}");
runtimeParts.push("");
runtimeParts.push("module.exports = {");
runtimeParts.push("    enforceProductionSecrets,");
runtimeParts.push("    createServer,");
runtimeParts.push("    dispatchRequest,");
runtimeParts.push("    handleUserData,");
runtimeParts.push("    handleEnterprise,");
runtimeParts.push("    handleAuth,");
runtimeParts.push("    serveUploadFile,");
runtimeParts.push("    getReadiness,");
runtimeParts.push("    setCors, readBody, sendJson, handleRouteError, sendError, sendAccessResult,");
runtimeParts.push("    attachRequestLogging, parseQuery,");
runtimeParts.push("    checkRateLimit, checkAuthRateLimit, checkAiRateLimit,");
runtimeParts.push("    requireAuth, requireAiAuth, getAuthFromRequest, sanitizeChatBody,");
runtimeParts.push("    getStoreBackend, getAuthBackend, getUserDataBackend, getDatabaseStats,");
runtimeParts.push("    probeRagHealthDetail,");
runtimeParts.push("    initDb, ensureIndexes, initStore, initAuthStore, initUserDataStore,");
runtimeParts.push("    PORT, API_KEY, DEEPSEEK_URL, RAG_SERVICE_URL, serviceStartedAt,");
runtimeParts.push("    ragIndexEvents, ragBackgroundIndexJobs,");
runtimeParts.push("    AI_RATE_LIMIT_MAX, AI_RATE_LIMIT_WINDOW_MS, RAG_INDEX_TIMEOUT_MS,");
runtimeParts.push("    config");
runtimeParts.push("};");
runtimeParts.push("");
write('server/runtime-legacy.js', runtimeParts.join('\n'));

function thinRoute(name, header, bodyLines) {
    write('server/routes/' + name + '.js', [header, "'use strict';", "const runtime = require('../runtime-legacy');", ""].concat(bodyLines).join('\n'));
}

thinRoute('auth',
    "/**\n * routes/auth — /api/auth/*\n * 任務：註冊、登入、me、profile\n */",
    [
        "async function handleAuthRoutes(req, res, urlPath, method) {",
        "    return runtime.handleAuth(req, res, urlPath, method);",
        "}",
        "module.exports = { handleAuthRoutes, OWNER: 'auth', PREFIX: '/api/auth' };",
        ""
    ]);

thinRoute('user-data',
    "/**\n * routes/user-data — /api/user/*\n * 任務：個人任務／設定雲端同步\n */",
    [
        "async function handleUserDataRoutes(req, res, urlPath, method) {",
        "    return runtime.handleUserData(req, res, urlPath, method);",
        "}",
        "module.exports = { handleUserDataRoutes, OWNER: 'user-data', PREFIX: '/api/user' };",
        ""
    ]);

thinRoute('enterprise',
    "/**\n * routes/enterprise — /api/enterprise/*\n * 任務：群組、指派、文件版本、團隊通知\n */",
    [
        "async function handleEnterpriseRoutes(req, res, urlPath, method) {",
        "    return runtime.handleEnterprise(req, res, urlPath, method);",
        "}",
        "module.exports = { handleEnterpriseRoutes, OWNER: 'enterprise', PREFIX: '/api/enterprise' };",
        ""
    ]);

thinRoute('chat',
    "/**\n * routes/chat — POST /api/chat\n * 任務：LLM 代理（限流 + body 淨化 + DeepSeek）\n */",
    [
        "async function handleChatRoutes(req, res, urlPath, method) {",
        "    if (!(method === 'POST' && urlPath === '/api/chat')) return false;",
        "    await runtime.dispatchRequest(req, res);",
        "    return true;",
        "}",
        "module.exports = { handleChatRoutes, OWNER: 'chat', PREFIX: '/api/chat' };",
        ""
    ]);

thinRoute('health',
    "/**\n * routes/health — /health, /ready, /api/ops/status\n * 任務：存活、就緒、可觀測（無密鑰）\n */",
    [
        "async function handleHealthRoutes(req, res, urlPath, method) {",
        "    if (method !== 'GET') return false;",
        "    if (urlPath === '/health' || urlPath === '/ready' || urlPath === '/api/ops/status') {",
        "        await runtime.dispatchRequest(req, res);",
        "        return true;",
        "    }",
        "    return false;",
        "}",
        "module.exports = { handleHealthRoutes, OWNER: 'platform', PREFIX: '/health|/ready|/api/ops' };",
        ""
    ]);

thinRoute('rag',
    "/**\n * routes/rag — /api/rag/*\n * 任務：KB 列表／建立／刪除、查詢、文件索引代理\n */",
    [
        "async function handleRagRoutes(req, res, urlPath) {",
        "    if (!urlPath.startsWith('/api/rag/')) return false;",
        "    await runtime.dispatchRequest(req, res);",
        "    return true;",
        "}",
        "module.exports = { handleRagRoutes, OWNER: 'rag', PREFIX: '/api/rag' };",
        ""
    ]);

thinRoute('uploads',
    "/**\n * routes/uploads — GET /uploads/*\n * 任務：受 JWT 保護的上傳檔案\n */",
    [
        "async function handleUploadRoutes(req, res, urlPath, method) {",
        "    if (!(method === 'GET' && urlPath.startsWith('/uploads/'))) return false;",
        "    await runtime.dispatchRequest(req, res);",
        "    return true;",
        "}",
        "module.exports = { handleUploadRoutes, OWNER: 'enterprise-files', PREFIX: '/uploads' };",
        ""
    ]);

write('server/routes/index.js', [
    "/**",
    " * routes/index — 領域路由註冊表（各有各的任務）",
    " */",
    "'use strict';",
    "",
    "const auth = require('./auth');",
    "const userData = require('./user-data');",
    "const enterprise = require('./enterprise');",
    "const rag = require('./rag');",
    "const chat = require('./chat');",
    "const health = require('./health');",
    "const uploads = require('./uploads');",
    "",
    "const ROUTE_MODULES = [",
    "    { id: 'health', ...health },",
    "    { id: 'uploads', ...uploads },",
    "    { id: 'auth', ...auth },",
    "    { id: 'user-data', ...userData },",
    "    { id: 'enterprise', ...enterprise },",
    "    { id: 'rag', ...rag },",
    "    { id: 'chat', ...chat }",
    "];",
    "",
    "module.exports = { ROUTE_MODULES, auth, userData, enterprise, rag, chat, health, uploads };",
    ""
].join('\n'));

write('server/app.js', [
    "/**",
    " * server/app — HTTP 伺服器組裝",
    " * 任務：建立 Server；請求分派與 legacy 控制流 1:1（行為不變）",
    " */",
    "'use strict';",
    "",
    "const runtime = require('./runtime-legacy');",
    "const { ROUTE_MODULES } = require('./routes');",
    "",
    "function createApp() {",
    "    return runtime.createServer();",
    "}",
    "",
    "function listRouteOwners() {",
    "    return ROUTE_MODULES.map((m) => ({ id: m.id, owner: m.OWNER, prefix: m.PREFIX }));",
    "}",
    "",
    "module.exports = { createApp, listRouteOwners };",
    ""
].join('\n'));

write('server/bootstrap.js', [
    "/**",
    " * server/bootstrap — 程序啟動：DB / store 初始化 + listen",
    " */",
    "'use strict';",
    "",
    "const runtime = require('./runtime-legacy');",
    "const { createApp, listRouteOwners } = require('./app');",
    "",
    "function startServer() {",
    "    runtime.enforceProductionSecrets();",
    "    const server = createApp();",
    "",
    "    return runtime.initDb().then(async () => {",
    "        await runtime.ensureIndexes();",
    "        await runtime.initStore();",
    "        await runtime.initAuthStore();",
    "        await runtime.initUserDataStore();",
    "        return new Promise((resolve) => {",
    "            server.listen(runtime.PORT, async () => {",
    "                const dbStats = await runtime.getDatabaseStats();",
    "                console.log('Lumina API proxy running at http://localhost:' + runtime.PORT);",
    "                console.log('  Modular routes:');",
    "                for (const r of listRouteOwners()) {",
    "                    console.log('   - [' + r.id + '] ' + r.prefix + '  (owner: ' + r.owner + ')');",
    "                }",
    "                console.log('  Storage:', runtime.getStoreBackend(),",
    "                    '| Auth:', runtime.getAuthBackend(),",
    "                    '| UserData:', runtime.getUserDataBackend());",
    "                if (dbStats) console.log('  Database:', JSON.stringify(dbStats));",
    "                resolve(server);",
    "            });",
    "        });",
    "    });",
    "}",
    "",
    "module.exports = { startServer };",
    "",
    "if (require.main === module) {",
    "    startServer().catch((err) => {",
    "        console.error('[Lumina API] bootstrap failed', err);",
    "        process.exit(1);",
    "    });",
    "}",
    ""
].join('\n'));

write('api-proxy.js', [
    "/**",
    " * Lumina AI — API 入口（薄封裝）",
    " *",
    " * 模組化結構：",
    " *   server/bootstrap.js      啟動",
    " *   server/app.js            Server 組裝",
    " *   server/routes/*          領域路由（各有任務）",
    " *   server/runtime-legacy.js 過渡期領域實作",
    " *   server/config.js         環境常數",
    " *   lib/*                    持久化 / 認證 primitive",
    " *",
    " * 地圖：docs/architecture/MODULES.md",
    " *",
    " *   node api-proxy.js",
    " *   node server/bootstrap.js",
    " */",
    "'use strict';",
    "",
    "const { startServer } = require('./server/bootstrap');",
    "",
    "startServer().catch((err) => {",
    "    console.error('[Lumina API] failed to start', err);",
    "    process.exit(1);",
    "});",
    ""
].join('\n'));

write('server/README.md', [
    "# Server 模組（API :3001）",
    "",
    "每個模組只做一件事。跨模組只透過 export；`runtime-legacy.js` 只允許搬出、禁止堆新功能。",
    "",
    "| 模組 | 任務 |",
    "|------|------|",
    "| `config.js` | 環境常數、生產密鑰檢查 |",
    "| `app.js` | 組裝 HTTP Server |",
    "| `bootstrap.js` | 初始化 DB/store 後 listen |",
    "| `routes/auth` | `/api/auth/*` 註冊登入 |",
    "| `routes/user-data` | `/api/user/*` 個人資料同步 |",
    "| `routes/enterprise` | `/api/enterprise/*` 團隊 |",
    "| `routes/rag` | `/api/rag/*` 知識庫代理 |",
    "| `routes/chat` | `POST /api/chat` LLM |",
    "| `routes/health` | `/health` `/ready` ops |",
    "| `routes/uploads` | `/uploads/*` 檔案 |",
    "| `runtime-legacy.js` | 過渡期領域實作（逐步拆出） |",
    "| `../lib/*` | 持久化與 JWT primitive |",
    "",
    "詳見 `docs/architecture/MODULES.md`。",
    ""
].join('\n'));

console.log('OK — next: node --check server/runtime-legacy.js');
