/**
 * server/domain/llm
 * 任務：LLM api_base allowlist 與 chat body 淨化
 * 透過 register(api) 掛載到共享 api 物件（跨域呼叫 api.fn）
 */
'use strict';


const config = require('../config');
const {
    PORT, API_KEY, DEEPSEEK_URL, RAG_SERVICE_URL, RAG_API_KEY, IS_PRODUCTION, REQUIRE_ENTERPRISE_AUTH, ALLOW_ANONYMOUS_AI, DATA_FILE, PIN_SALT, MAX_BODY_BYTES, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX, AUTH_RATE_LIMIT_MAX, PIN_MAX_ATTEMPTS, PIN_LOCK_MS, AI_RATE_LIMIT_MAX, AI_RATE_LIMIT_WINDOW_MS, DEFAULT_LLM_API_BASE, ALLOWED_LLM_API_BASES, MAX_UPLOAD_BYTES, ALLOWED_UPLOAD_EXT, WEAK_PINS, UPLOADS_DIR, ALLOWED_ORIGINS, RAG_INDEX_TIMEOUT_MS, RAG_INDEX_MAX_ATTEMPTS, RAG_INDEX_EVENT_LIMIT, serviceStartedAt, enforceProductionSecrets
} = config;

/** @param {Record<string, Function>} api */
function register(api) {
    function normalizeLlmApiBase(url) {
        return String(url || '').trim().replace(/\/+$/, '');
    }

    function isAllowedLlmApiBase(url) {
        const n = normalizeLlmApiBase(url);
        if (!n) return false;
        if (ALLOWED_LLM_API_BASES.has(n)) return true;
        // Accept host without /v1 if allowlist has either form
        if (ALLOWED_LLM_API_BASES.has(n + '/v1')) return true;
        if (n.endsWith('/v1') && ALLOWED_LLM_API_BASES.has(n.slice(0, -3))) return true;
        return false;
    }

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

    function sanitizeChatBody(body) {
        if (!body || typeof body !== 'object') return null;
        if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > 50) return null;
        const messages = body.messages.map((m) => {
            if (!m || typeof m !== 'object') return null;
            const role = ['system', 'user', 'assistant'].includes(m.role) ? m.role : 'user';
            const content = api.clampText(m.content, 16000);
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

    Object.assign(api, {
        normalizeLlmApiBase,
        isAllowedLlmApiBase,
        resolveLlmApiBase,
        sanitizeChatBody
    });
}

module.exports = { register };
