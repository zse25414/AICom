/**
 * server/domain/pin
 * 任務：主管 PIN 雜湊、鎖定、遷移
 * 透過 register(api) 掛載到共享 api 物件（跨域呼叫 api.fn）
 */
'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const config = require('../config');
const {
    PORT, API_KEY, DEEPSEEK_URL, RAG_SERVICE_URL, RAG_API_KEY, IS_PRODUCTION, REQUIRE_ENTERPRISE_AUTH, ALLOW_ANONYMOUS_AI, DATA_FILE, PIN_SALT, MAX_BODY_BYTES, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX, AUTH_RATE_LIMIT_MAX, PIN_MAX_ATTEMPTS, PIN_LOCK_MS, AI_RATE_LIMIT_MAX, AI_RATE_LIMIT_WINDOW_MS, DEFAULT_LLM_API_BASE, ALLOWED_LLM_API_BASES, MAX_UPLOAD_BYTES, ALLOWED_UPLOAD_EXT, WEAK_PINS, UPLOADS_DIR, ALLOWED_ORIGINS, RAG_INDEX_TIMEOUT_MS, RAG_INDEX_MAX_ATTEMPTS, RAG_INDEX_EVENT_LIMIT, serviceStartedAt, enforceProductionSecrets
} = config;

/** @param {Record<string, Function>} api */
function register(api) {
    const pinAttemptBuckets = api.__pinAttemptBuckets || (api.__pinAttemptBuckets = new Map());
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

    function getPinAttemptKey(code, ip) {
        return `${api.normalizeCode(code)}:${ip}`;
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

    Object.assign(api, {
        isValidManagerPin,
        hashPin,
        verifyLegacyPinHash,
        verifyPinHash,
        verifyManagerPin,
        migrateGroupPin,
        getPinAttemptKey,
        isPinLocked,
        recordPinFailure,
        clearPinFailures,
        sweepPinAttemptBuckets
    });
}

module.exports = { register };
