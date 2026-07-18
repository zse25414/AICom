/**
 * server/domain/auth-mw
 * 任務：JWT 解析與 requireAuth / requireAiAuth
 * 透過 register(api) 掛載到共享 api 物件（跨域呼叫 api.fn）
 */
'use strict';


const config = require('../config');
const {
    PORT, API_KEY, DEEPSEEK_URL, RAG_SERVICE_URL, RAG_API_KEY, IS_PRODUCTION, REQUIRE_ENTERPRISE_AUTH, ALLOW_ANONYMOUS_AI, DATA_FILE, PIN_SALT, MAX_BODY_BYTES, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX, AUTH_RATE_LIMIT_MAX, PIN_MAX_ATTEMPTS, PIN_LOCK_MS, AI_RATE_LIMIT_MAX, AI_RATE_LIMIT_WINDOW_MS, DEFAULT_LLM_API_BASE, ALLOWED_LLM_API_BASES, MAX_UPLOAD_BYTES, ALLOWED_UPLOAD_EXT, WEAK_PINS, UPLOADS_DIR, ALLOWED_ORIGINS, RAG_INDEX_TIMEOUT_MS, RAG_INDEX_MAX_ATTEMPTS, RAG_INDEX_EVENT_LIMIT, serviceStartedAt, enforceProductionSecrets
} = config;
const { findUserById } = require('../../lib/auth-store');
const { verifyToken, parseBearerToken } = require('../../lib/auth');

/** @param {Record<string, Function>} api */
function register(api) {
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

    Object.assign(api, {
        getAuthFromRequest,
        getOptionalAuth,
        requireAuth,
        requireAiAuth
    });
}

module.exports = { register };
