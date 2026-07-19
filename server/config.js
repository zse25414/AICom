/**
 * server/config — 環境與全域常數（無業務邏輯）
 * 擁有者：Backend / Platform
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { loadEnvFile } = require('../lib/env');
const { getJwtConfig } = require('../lib/auth');

loadEnvFile();

const PORT = process.env.PORT || 3001;
const API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
const RAG_SERVICE_URL = process.env.RAG_SERVICE_URL || 'http://127.0.0.1:8000';
const RAG_API_KEY = (process.env.RAG_API_KEY || '').trim();
const IS_PRODUCTION = process.env.NODE_ENV === 'production' || process.env.LUMINA_ENFORCE_SECRETS === '1';
const REQUIRE_ENTERPRISE_AUTH = IS_PRODUCTION || process.env.REQUIRE_ENTERPRISE_AUTH === '1';
const ALLOW_ANONYMOUS_AI = !IS_PRODUCTION && process.env.ALLOW_ANONYMOUS_AI === '1';
const DATA_FILE = path.join(__dirname, '..', 'enterprise-data.json');
const PIN_SALT = process.env.PIN_SALT || 'lumina-pin-salt-change-in-production';
const MAX_BODY_BYTES = 6 * 1024 * 1024;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
// Higher ceiling: team poll + UI can be chatty; auth is exempt from this bucket.
const RATE_LIMIT_MAX = Math.max(180, Number(process.env.RATE_LIMIT_MAX) || 240);
const AUTH_RATE_LIMIT_MAX = Math.max(30, Number(process.env.AUTH_RATE_LIMIT_MAX) || 40);
const PIN_MAX_ATTEMPTS = 5;
const PIN_LOCK_MS = 15 * 60 * 1000;
const AI_RATE_LIMIT_MAX = 30;
const AI_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
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
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:3456,http://127.0.0.1:3456,http://localhost:3000,http://127.0.0.1:3000')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

const RAG_INDEX_TIMEOUT_MS = Math.max(2000, Number(process.env.RAG_INDEX_TIMEOUT_MS) || 12000);
const RAG_INDEX_MAX_ATTEMPTS = 2;
const RAG_INDEX_EVENT_LIMIT = 40;
// 排程自動對帳（0 = 停用；預設每 60 分鐘，僅重排索引不清殘留）
const RAG_RECONCILE_INTERVAL_MS = process.env.RAG_RECONCILE_INTERVAL_MS != null
    ? Math.max(0, Number(process.env.RAG_RECONCILE_INTERVAL_MS) || 0)
    : 60 * 60 * 1000;
// 個人附件孤兒檔 GC（0 = 停用；預設每 6 小時，只清 24h 以上未被引用的 user-* 檔）
const USER_ATTACH_GC_INTERVAL_MS = process.env.USER_ATTACH_GC_INTERVAL_MS != null
    ? Math.max(0, Number(process.env.USER_ATTACH_GC_INTERVAL_MS) || 0)
    : 6 * 60 * 60 * 1000;
const serviceStartedAt = Date.now();

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

module.exports = {
    PORT, API_KEY, DEEPSEEK_URL, RAG_SERVICE_URL, RAG_API_KEY,
    IS_PRODUCTION, REQUIRE_ENTERPRISE_AUTH, ALLOW_ANONYMOUS_AI,
    DATA_FILE, PIN_SALT, MAX_BODY_BYTES,
    RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX, AUTH_RATE_LIMIT_MAX,
    PIN_MAX_ATTEMPTS, PIN_LOCK_MS, AI_RATE_LIMIT_MAX, AI_RATE_LIMIT_WINDOW_MS,
    DEFAULT_LLM_API_BASE, ALLOWED_LLM_API_BASES,
    MAX_UPLOAD_BYTES, ALLOWED_UPLOAD_EXT, WEAK_PINS, UPLOADS_DIR, ALLOWED_ORIGINS,
    RAG_INDEX_TIMEOUT_MS, RAG_INDEX_MAX_ATTEMPTS, RAG_INDEX_EVENT_LIMIT,
    RAG_RECONCILE_INTERVAL_MS, USER_ATTACH_GC_INTERVAL_MS,
    serviceStartedAt, enforceProductionSecrets
};
