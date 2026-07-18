/**
 * server/domain/rate-limit
 * 任務：全站／認證／AI 限流
 * 透過 register(api) 掛載到共享 api 物件（跨域呼叫 api.fn）
 */
'use strict';


const config = require('../config');
const {
    PORT, API_KEY, DEEPSEEK_URL, RAG_SERVICE_URL, RAG_API_KEY, IS_PRODUCTION, REQUIRE_ENTERPRISE_AUTH, ALLOW_ANONYMOUS_AI, DATA_FILE, PIN_SALT, MAX_BODY_BYTES, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX, AUTH_RATE_LIMIT_MAX, PIN_MAX_ATTEMPTS, PIN_LOCK_MS, AI_RATE_LIMIT_MAX, AI_RATE_LIMIT_WINDOW_MS, DEFAULT_LLM_API_BASE, ALLOWED_LLM_API_BASES, MAX_UPLOAD_BYTES, ALLOWED_UPLOAD_EXT, WEAK_PINS, UPLOADS_DIR, ALLOWED_ORIGINS, RAG_INDEX_TIMEOUT_MS, RAG_INDEX_MAX_ATTEMPTS, RAG_INDEX_EVENT_LIMIT, serviceStartedAt, enforceProductionSecrets
} = config;

/** @param {Record<string, Function>} api */
function register(api) {
    const rateBuckets = api.__rateBuckets || (api.__rateBuckets = new Map());
    const authRateBuckets = api.__authRateBuckets || (api.__authRateBuckets = new Map());
    const aiRateBuckets = api.__aiRateBuckets || (api.__aiRateBuckets = new Map());
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
        return checkRateLimitBucket(rateBuckets, api.getClientIp(req), RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
    }

    function checkAuthRateLimit(req) {
        return checkRateLimitBucket(authRateBuckets, 'auth:' + api.getClientIp(req), AUTH_RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS);
    }

    function checkAiRateLimit(userId) {
        const key = userId || 'anonymous';
        return checkRateLimitBucket(aiRateBuckets, key, AI_RATE_LIMIT_MAX, AI_RATE_LIMIT_WINDOW_MS);
    }

    function sweepRateLimitBucket(map, windowMs) {
        const now = Date.now();
        for (const [key, bucket] of map) {
            if (!bucket || now - bucket.start > windowMs) map.delete(key);
        }
    }

    Object.assign(api, {
        checkRateLimitBucket,
        checkRateLimit,
        checkAuthRateLimit,
        checkAiRateLimit,
        sweepRateLimitBucket
    });

    if (!api.__bucketCleanupStarted) {
        api.__bucketCleanupStarted = true;
        const BUCKET_CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
        const bucketCleanupInterval = setInterval(() => {
            sweepRateLimitBucket(rateBuckets, RATE_LIMIT_WINDOW_MS);
            sweepRateLimitBucket(authRateBuckets, RATE_LIMIT_WINDOW_MS);
            sweepRateLimitBucket(aiRateBuckets, AI_RATE_LIMIT_WINDOW_MS);
            if (typeof api.sweepPinAttemptBuckets === "function") api.sweepPinAttemptBuckets();
        }, BUCKET_CLEANUP_INTERVAL_MS);
        bucketCleanupInterval.unref();
    }
}

module.exports = { register };
