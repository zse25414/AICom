/**
 * Extract server/runtime-legacy.js into server/domain/* using register(api) pattern.
 * Cross-domain calls become api.fnName(...). Same-domain bare names stay.
 *
 *   node scripts/extract-domains.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const srcPath = path.join(root, 'server', 'runtime-legacy.js');
const src = fs.readFileSync(srcPath, 'utf8');
const lines = src.split(/\r?\n/);

/** @type {Record<string, string[]>} */
const DOMAINS = {
    util: ['clampText', 'getClientIp', 'uid', 'normalizeCode', 'parseQuery'],
    pin: [
        'isValidManagerPin', 'hashPin', 'verifyLegacyPinHash', 'verifyPinHash',
        'verifyManagerPin', 'migrateGroupPin',
        'getPinAttemptKey', 'isPinLocked', 'recordPinFailure', 'clearPinFailures',
        'sweepPinAttemptBuckets'
    ],
    'rate-limit': [
        'checkRateLimitBucket', 'checkRateLimit', 'checkAuthRateLimit',
        'checkAiRateLimit', 'sweepRateLimitBucket'
    ],
    llm: [
        'normalizeLlmApiBase', 'isAllowedLlmApiBase', 'resolveLlmApiBase', 'sanitizeChatBody'
    ],
    http: [
        'setCors', 'readBody', 'securityHeaders', 'sendJson', 'handleRouteError',
        'sendError', 'sendAccessResult', 'attachRequestLogging'
    ],
    'auth-mw': [
        'getAuthFromRequest', 'getOptionalAuth', 'requireAuth', 'requireAiAuth'
    ],
    'enterprise/core': [
        'prepareStore', 'getGroup', 'ensureNotifications', 'pushNotification',
        'assertEnterpriseMember', 'assertRagGroupAccess'
    ],
    'enterprise/kb': [
        'normalizeKbId', 'isActiveKb', 'defaultKbDisplayName', 'createKbRecord',
        'ensureKnowledgeBases', 'serializeKbItem', 'buildKbListResponse',
        'resolveKbForWrite', 'softDeleteKnowledgeBase'
    ],
    'enterprise/documents': [
        'isActiveDocument', 'normalizeTaskKnowledgeBinding', 'getRagFilenameForDoc',
        'computeContentHash', 'buildDocumentVersionSnapshot', 'ensureDocumentVersions',
        'summarizeVersionMeta', 'assertDocumentReadAccess', 'trySaveDocumentUpload'
    ],
    'rag/ops': [
        'proxyRagDeleteKb', 'classifyRagError', 'pushRagIndexEvent', 'setDocumentRagStatus',
        'findGroupDocument', 'persistDocumentRagStatus', 'compensateRagIndexAfterDelete',
        'proxyRagDeleteIndex', 'parseRagProxyResult', 'proxyRagUploadTextIndex',
        'proxyRagUploadBinaryIndex', 'indexEnterpriseDocumentToRag', 'indexDocumentWithRetry',
        'raceWithTimeout', 'runBackgroundRagIndex', 'applyDocumentRagIndexResult',
        'orchestrateDocumentRagIndex', 'buildRagOrchestrationResponse', 'normalizeRagCitations',
        'canAccessUpload', 'buildRagHeaders', 'proxyRagJson', 'proxyRagGet',
        'serveUploadFile', 'probeRagHealthDetail', 'getReadiness'
    ],
    'handlers/user-data': ['handleUserData'],
    'handlers/auth': ['handleAuth'],
    'handlers/enterprise': ['handleEnterprise'],
    'handlers/dispatch': ['dispatchRequest', 'createServer']
};

const ALL_FNS = new Set(Object.values(DOMAINS).flat());
const FN_TO_DOMAIN = {};
for (const [dom, fns] of Object.entries(DOMAINS)) {
    for (const fn of fns) FN_TO_DOMAIN[fn] = dom;
}

// Locate top-level function ranges
const fnStarts = [];
for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(async )?function ([a-zA-Z0-9_]+)\b/);
    if (m && ALL_FNS.has(m[2])) {
        fnStarts.push({ name: m[2], start: i, async: !!m[1] });
    }
}

/**
 * Find end line of a top-level function, correctly handling default params
 * like `({ forceDefault = false } = {}) { ... }`.
 */
function findFnEnd(startIdx) {
    // Concatenate from start until we can locate body open brace after params.
    let i = startIdx;
    let buf = '';
    let phase = 'seek-paren'; // seek-paren | in-params | seek-body | in-body
    let paren = 0;
    let brace = 0;
    let inS = null;
    let esc = false;
    let bodyStarted = false;

    for (; i < lines.length; i++) {
        const line = lines[i];
        for (let j = 0; j < line.length; j++) {
            const ch = line[j];
            const prev = j > 0 ? line[j - 1] : '';

            if (inS) {
                if (esc) {
                    esc = false;
                    continue;
                }
                if (ch === '\\') {
                    esc = true;
                    continue;
                }
                if (ch === inS) inS = null;
                continue;
            }
            if (ch === '"' || ch === "'" || ch === '`') {
                inS = ch;
                continue;
            }

            if (phase === 'seek-paren') {
                if (ch === '(') {
                    phase = 'in-params';
                    paren = 1;
                }
                continue;
            }
            if (phase === 'in-params') {
                if (ch === '(') paren++;
                else if (ch === ')') {
                    paren--;
                    if (paren === 0) phase = 'seek-body';
                }
                // ignore braces inside params
                continue;
            }
            if (phase === 'seek-body') {
                if (ch === '{') {
                    phase = 'in-body';
                    brace = 1;
                    bodyStarted = true;
                }
                continue;
            }
            if (phase === 'in-body') {
                if (ch === '{') brace++;
                else if (ch === '}') {
                    brace--;
                    if (bodyStarted && brace === 0) return i;
                }
            }
        }
    }
    throw new Error('no end for function at ' + (startIdx + 1));
}

const fnBodies = {};
for (const f of fnStarts) {
    const end = findFnEnd(f.start);
    fnBodies[f.name] = lines.slice(f.start, end + 1).join('\n');
}

// Also capture preamble: rate bucket maps + cleanup interval between rate-limit functions
// Lines with const rateBuckets etc. and setInterval - find in source
const preambleMatch = src.match(
    /const rateBuckets = new Map\(\);[\s\S]*?bucketCleanupInterval\.unref\(\);/
);
const ratePreamble = preambleMatch ? preambleMatch[0] : [
    'const rateBuckets = new Map();',
    'const authRateBuckets = new Map();',
    'const pinAttemptBuckets = new Map();',
    'const aiRateBuckets = new Map();',
    'const ragIndexEvents = [];',
    'const ragBackgroundIndexJobs = new Set();',
    'const BUCKET_CLEANUP_INTERVAL_MS = 10 * 60 * 1000;',
    'const bucketCleanupInterval = setInterval(() => {',
    '    sweepRateLimitBucket(rateBuckets, RATE_LIMIT_WINDOW_MS);',
    '    sweepRateLimitBucket(authRateBuckets, RATE_LIMIT_WINDOW_MS);',
    '    sweepRateLimitBucket(aiRateBuckets, AI_RATE_LIMIT_WINDOW_MS);',
    '    sweepPinAttemptBuckets();',
    '}, BUCKET_CLEANUP_INTERVAL_MS);',
    'bucketCleanupInterval.unref();'
].join('\n');

// Shared non-function state owned by rag/ops (referenced from handlers)
const SHARED_STATE = ['ragIndexEvents', 'ragBackgroundIndexJobs'];

function rewriteCrossDomain(body, ownDomain) {
    const own = new Set(DOMAINS[ownDomain]);
    // Replace bare calls to foreign domain functions: name( -> api.name(
    let out = body.replace(
        /(?<![\w.$])([A-Za-z_][A-Za-z0-9_]*)\s*\(/g,
        (match, name) => {
            if (!ALL_FNS.has(name)) return match;
            if (own.has(name)) return match;
            return `api.${name}(`;
        }
    );
    // Shared state refs (not functions) used outside rag/ops
    if (ownDomain !== 'rag/ops') {
        for (const name of SHARED_STATE) {
            out = out.replace(new RegExp(`(?<![\\w.$])${name}\\b`, 'g'), `api.${name}`);
        }
    }
    return out;
}

// Fix false positives: async function api.foo(  and function api.foo(
function fixDeclarations(body) {
    return body
        .replace(/async function api\.(\w+)\s*\(/g, 'async function $1(')
        .replace(/function api\.(\w+)\s*\(/g, 'function $1(');
}

function write(rel, content) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content.replace(/\n+$/, '') + '\n', 'utf8');
    console.log('wrote', rel, Math.round(Buffer.byteLength(content) / 1024) + 'KB');
}

const domainHeader = (name, task) => `/**
 * server/domain/${name}
 * 任務：${task}
 * 透過 register(api) 掛載到共享 api 物件（跨域呼叫 api.fn）
 */
'use strict';
`;

const TASKS = {
    util: '純字串／ID／query 工具',
    pin: '主管 PIN 雜湊、鎖定、遷移',
    'rate-limit': '全站／認證／AI 限流',
    llm: 'LLM api_base allowlist 與 chat body 淨化',
    http: 'CORS、body、JSON 回應、錯誤、request log',
    'auth-mw': 'JWT 解析與 requireAuth / requireAiAuth',
    'enterprise/core': '群組存取、通知、成員斷言',
    'enterprise/kb': '知識庫 CRUD 領域邏輯',
    'enterprise/documents': '文件版本、上傳、綁定',
    'rag/ops': 'RAG 代理、索引編排、就緒探測',
    'handlers/user-data': 'HTTP：/api/user/*',
    'handlers/auth': 'HTTP：/api/auth/*',
    'handlers/enterprise': 'HTTP：/api/enterprise/*',
    'handlers/dispatch': 'HTTP：總分派與 createServer'
};

const NEEDS = {
    util: { node: ['crypto'], config: false, libs: false },
    pin: { node: ['crypto', 'bcryptjs'], config: true, libs: false },
    'rate-limit': { node: [], config: true, libs: false },
    llm: { node: [], config: true, libs: false },
    http: { node: ['zlib', 'crypto'], config: true, lib: [] },
    'auth-mw': {
        node: [],
        config: true,
        lib: [
            "const { findUserById } = require('../../lib/auth-store');",
            "const { verifyToken, parseBearerToken } = require('../../lib/auth');"
        ]
    },
    'enterprise/core': {
        node: [],
        config: true,
        lib: [
            "const { loadStore, saveStore } = require('../../../lib/enterprise-store');"
        ]
    },
    'enterprise/kb': {
        node: [],
        config: false,
        lib: [
            "const { loadStore, saveStore } = require('../../../lib/enterprise-store');",
            "const { withLock } = require('../../../lib/write-queue');"
        ]
    },
    'enterprise/documents': {
        node: ['fs', 'path', 'crypto'],
        config: true,
        lib: []
    },
    'rag/ops': {
        node: ['fs', 'path', 'crypto'],
        config: true,
        lib: [
            "const { loadStore, saveStore, getStoreBackend } = require('../../../lib/enterprise-store');",
            "const { getAuthBackend } = require('../../../lib/auth-store');",
            "const { getUserDataBackend } = require('../../../lib/user-data-store');",
            "const { getDatabaseStats } = require('../../../lib/db');",
            "const { withLock } = require('../../../lib/write-queue');"
        ]
    },
    'handlers/user-data': {
        node: [],
        config: false,
        lib: [
            "const { getUserData, saveUserData, mergeUserData, getUserDataBackend, defaultUserData } = require('../../../lib/user-data-store');"
        ]
    },
    'handlers/auth': {
        node: [],
        config: false,
        lib: [
            "const { findUserByEmail, findUserById, createUser, updateUser } = require('../../../lib/auth-store');",
            "const { saveUserData, ensureUserData, defaultUserData } = require('../../../lib/user-data-store');",
            "const { normalizeEmail, isValidEmail, clampText: clampAuthText, signToken, verifyToken, parseBearerToken, hashPassword, verifyPassword, sanitizeUser } = require('../../../lib/auth');"
        ]
    },
    'handlers/enterprise': {
        node: [],
        config: true,
        lib: [
            "const { loadStore, saveStore } = require('../../../lib/enterprise-store');",
            "const { withLock } = require('../../../lib/write-queue');"
        ]
    },
    'handlers/dispatch': {
        node: ['http'],
        config: true,
        lib: [
            "const { getStoreBackend } = require('../../../lib/enterprise-store');",
            "const { getAuthBackend } = require('../../../lib/auth-store');",
            "const { getUserDataBackend } = require('../../../lib/user-data-store');",
            "const { getDatabaseStats } = require('../../../lib/db');"
        ]
    }
};

// default empty lib for leaf domains
for (const key of Object.keys(DOMAINS)) {
    if (!NEEDS[key]) NEEDS[key] = { node: [], config: false, lib: [] };
    if (!NEEDS[key].lib) NEEDS[key].lib = [];
}

const CONFIG_KEYS = [
    'PORT', 'API_KEY', 'DEEPSEEK_URL', 'RAG_SERVICE_URL', 'RAG_API_KEY',
    'IS_PRODUCTION', 'REQUIRE_ENTERPRISE_AUTH', 'ALLOW_ANONYMOUS_AI',
    'DATA_FILE', 'PIN_SALT', 'MAX_BODY_BYTES',
    'RATE_LIMIT_WINDOW_MS', 'RATE_LIMIT_MAX', 'AUTH_RATE_LIMIT_MAX',
    'PIN_MAX_ATTEMPTS', 'PIN_LOCK_MS', 'AI_RATE_LIMIT_MAX', 'AI_RATE_LIMIT_WINDOW_MS',
    'DEFAULT_LLM_API_BASE', 'ALLOWED_LLM_API_BASES',
    'MAX_UPLOAD_BYTES', 'ALLOWED_UPLOAD_EXT', 'WEAK_PINS', 'UPLOADS_DIR', 'ALLOWED_ORIGINS',
    'RAG_INDEX_TIMEOUT_MS', 'RAG_INDEX_MAX_ATTEMPTS', 'RAG_INDEX_EVENT_LIMIT',
    'serviceStartedAt', 'enforceProductionSecrets'
];

function configRequire(depth) {
    const rel = depth === 2 ? '../../config' : '../config';
    return [
        `const config = require('${rel}');`,
        'const {',
        '    ' + CONFIG_KEYS.join(', '),
        '} = config;'
    ].join('\n');
}

function nodeRequires(list) {
    const map = {
        crypto: "const crypto = require('crypto');",
        bcryptjs: "const bcrypt = require('bcryptjs');",
        zlib: "const zlib = require('zlib');",
        fs: "const fs = require('fs');",
        path: "const path = require('path');",
        http: "const http = require('http');"
    };
    return list.map((n) => map[n]).filter(Boolean).join('\n');
}

for (const [dom, fns] of Object.entries(DOMAINS)) {
    const depth = dom.includes('/') ? 2 : 1;
    const needs = NEEDS[dom];
    const parts = [];
    parts.push(domainHeader(dom, TASKS[dom]));
    parts.push(nodeRequires(needs.node));
    if (needs.config) parts.push(configRequire(depth));
    if (needs.lib && needs.lib.length) parts.push(needs.lib.join('\n'));
    parts.push('');
    parts.push('/** @param {Record<string, Function>} api */');
    parts.push('function register(api) {');

    if (dom === 'rate-limit') {
        // mutable buckets live here
        parts.push('    const rateBuckets = api.__rateBuckets || (api.__rateBuckets = new Map());');
        parts.push('    const authRateBuckets = api.__authRateBuckets || (api.__authRateBuckets = new Map());');
        parts.push('    const aiRateBuckets = api.__aiRateBuckets || (api.__aiRateBuckets = new Map());');
    }
    if (dom === 'pin') {
        parts.push('    const pinAttemptBuckets = api.__pinAttemptBuckets || (api.__pinAttemptBuckets = new Map());');
    }
    if (dom === 'rag/ops') {
        parts.push('    const ragIndexEvents = api.ragIndexEvents || (api.ragIndexEvents = []);');
        parts.push('    const ragBackgroundIndexJobs = api.ragBackgroundIndexJobs || (api.ragBackgroundIndexJobs = new Set());');
        parts.push('    // expose for health/ops');
        parts.push('    api.ragIndexEvents = ragIndexEvents;');
        parts.push('    api.ragBackgroundIndexJobs = ragBackgroundIndexJobs;');
    }

    for (const name of fns) {
        if (!fnBodies[name]) {
            console.warn('MISSING body', name);
            continue;
        }
        let body = fnBodies[name];
        body = rewriteCrossDomain(body, dom);
        body = fixDeclarations(body);
        // indent function body by 4 spaces
        body = body.split('\n').map((l) => (l ? '    ' + l : l)).join('\n');
        parts.push(body);
        parts.push('');
    }

    // Assign to api
    parts.push('    Object.assign(api, {');
    parts.push('        ' + fns.filter((n) => fnBodies[n]).join(',\n        '));
    parts.push('    });');

    if (dom === 'rate-limit') {
        // start cleanup once
        parts.push('');
        parts.push('    if (!api.__bucketCleanupStarted) {');
        parts.push('        api.__bucketCleanupStarted = true;');
        parts.push('        const BUCKET_CLEANUP_INTERVAL_MS = 10 * 60 * 1000;');
        parts.push('        const bucketCleanupInterval = setInterval(() => {');
        parts.push('            sweepRateLimitBucket(rateBuckets, RATE_LIMIT_WINDOW_MS);');
        parts.push('            sweepRateLimitBucket(authRateBuckets, RATE_LIMIT_WINDOW_MS);');
        parts.push('            sweepRateLimitBucket(aiRateBuckets, AI_RATE_LIMIT_WINDOW_MS);');
        parts.push('            if (typeof api.sweepPinAttemptBuckets === "function") api.sweepPinAttemptBuckets();');
        parts.push('        }, BUCKET_CLEANUP_INTERVAL_MS);');
        parts.push('        bucketCleanupInterval.unref();');
        parts.push('    }');
    }

    parts.push('}');
    parts.push('');
    parts.push('module.exports = { register };');
    parts.push('');
    write('server/domain/' + dom + '.js', parts.join('\n'));
}


// domain/index.js — assembly order (deps first)
write('server/domain/index.js', [
    '/**',
    ' * server/domain — 領域模組組裝',
    ' * 載入順序：工具 → 基礎設施 → 企業 → RAG → HTTP handlers',
    ' */',
    "'use strict';",
    '',
    "const config = require('../config');",
    'const {',
    '    initDb, ensureIndexes, getDatabaseStats',
    "} = require('../../lib/db');",
    'const {',
    '    initStore, getStoreBackend',
    "} = require('../../lib/enterprise-store');",
    'const {',
    '    initAuthStore, getAuthBackend',
    "} = require('../../lib/auth-store');",
    'const {',
    '    initUserDataStore, getUserDataBackend',
    "} = require('../../lib/user-data-store');",
    '',
    '/** @type {Record<string, any>} */',
    'const api = Object.create(null);',
    '',
    'Object.assign(api, {',
    '    config,',
    '    PORT: config.PORT,',
    '    API_KEY: config.API_KEY,',
    '    DEEPSEEK_URL: config.DEEPSEEK_URL,',
    '    RAG_SERVICE_URL: config.RAG_SERVICE_URL,',
    '    serviceStartedAt: config.serviceStartedAt,',
    '    AI_RATE_LIMIT_MAX: config.AI_RATE_LIMIT_MAX,',
    '    AI_RATE_LIMIT_WINDOW_MS: config.AI_RATE_LIMIT_WINDOW_MS,',
    '    RAG_INDEX_TIMEOUT_MS: config.RAG_INDEX_TIMEOUT_MS,',
    '    enforceProductionSecrets: config.enforceProductionSecrets,',
    '    initDb,',
    '    ensureIndexes,',
    '    initStore,',
    '    initAuthStore,',
    '    initUserDataStore,',
    '    getStoreBackend,',
    '    getAuthBackend,',
    '    getUserDataBackend,',
    '    getDatabaseStats',
    '});',
    '',
    'const order = [',
    "    'util',",
    "    'pin',",
    "    'rate-limit',",
    "    'llm',",
    "    'http',",
    "    'auth-mw',",
    "    'enterprise/core',",
    "    'enterprise/kb',",
    "    'enterprise/documents',",
    "    'rag/ops',",
    "    'handlers/user-data',",
    "    'handlers/auth',",
    "    'handlers/enterprise',",
    "    'handlers/dispatch'",
    '];',
    '',
    'for (const name of order) {',
    "    require('./' + name).register(api);",
    '}',
    '',
    'module.exports = api;',
    ''
].join('\n'));

write('server/runtime-legacy.js', [
    '/**',
    ' * server/runtime-legacy — 相容層',
    ' * 實作已拆至 server/domain/*。本檔只 re-export。',
    ' */',
    "'use strict';",
    '',
    "module.exports = require('./domain');",
    ''
].join('\n'));

write('server/domain/README.md', [
    '# Domain 模組（純領域 + HTTP handlers）',
    '',
    '| 模組 | 任務 |',
    '|------|------|',
    '| util | clampText / uid / normalizeCode / parseQuery |',
    '| pin | 主管 PIN |',
    '| rate-limit | 限流桶 |',
    '| llm | chat body / api_base allowlist |',
    '| http | CORS / JSON / errors |',
    '| auth-mw | JWT require* |',
    '| enterprise/* | 群組、KB、文件 |',
    '| rag/ops | RAG 代理與索引編排 |',
    '| handlers/* | HTTP 適配 |',
    '',
    '跨域呼叫統一 api.fn(...)；同域內可直接呼叫。',
    ''
].join('\n'));

console.log('Done. Validate: node --check server/domain/index.js');
