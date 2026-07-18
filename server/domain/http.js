/**
 * server/domain/http
 * 任務：CORS、body、JSON 回應、錯誤、request log
 * 透過 register(api) 掛載到共享 api 物件（跨域呼叫 api.fn）
 */
'use strict';

const zlib = require('zlib');
const crypto = require('crypto');
const config = require('../config');
const {
    PORT, API_KEY, DEEPSEEK_URL, RAG_SERVICE_URL, RAG_API_KEY, IS_PRODUCTION, REQUIRE_ENTERPRISE_AUTH, ALLOW_ANONYMOUS_AI, DATA_FILE, PIN_SALT, MAX_BODY_BYTES, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX, AUTH_RATE_LIMIT_MAX, PIN_MAX_ATTEMPTS, PIN_LOCK_MS, AI_RATE_LIMIT_MAX, AI_RATE_LIMIT_WINDOW_MS, DEFAULT_LLM_API_BASE, ALLOWED_LLM_API_BASES, MAX_UPLOAD_BYTES, ALLOWED_UPLOAD_EXT, WEAK_PINS, UPLOADS_DIR, ALLOWED_ORIGINS, RAG_INDEX_TIMEOUT_MS, RAG_INDEX_MAX_ATTEMPTS, RAG_INDEX_EVENT_LIMIT, serviceStartedAt, enforceProductionSecrets
} = config;

/** @param {Record<string, Function>} api */
function register(api) {
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

    function handleRouteError(res, err, fallbackMsg = '伺服器錯誤') {
        if (err && err.message === 'Request body too large') {
            sendJson(res, 413, { error: err.message });
            return;
        }
        console.error('[Lumina API] 未預期錯誤:', err);
        sendJson(res, 500, { error: fallbackMsg });
    }

    function sendError(res, status, error, code) {
        const body = { ok: false, error };
        if (code) body.code = code;
        sendJson(res, status, body);
    }

    function sendAccessResult(res, access) {
        sendError(res, access.status, access.error, access.code);
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

    Object.assign(api, {
        setCors,
        readBody,
        securityHeaders,
        sendJson,
        handleRouteError,
        sendError,
        sendAccessResult,
        attachRequestLogging
    });
}

module.exports = { register };
