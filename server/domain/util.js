/**
 * server/domain/util
 * 任務：純字串／ID／query 工具
 * 透過 register(api) 掛載到共享 api 物件（跨域呼叫 api.fn）
 */
'use strict';

const crypto = require('crypto');

/** @param {Record<string, Function>} api */
function register(api) {
    function clampText(value, max) {
        return String(value || '').trim().slice(0, max);
    }

    function getClientIp(req) {
        const forwarded = req.headers['x-forwarded-for'];
        if (forwarded) return String(forwarded).split(',')[0].trim();
        return req.socket.remoteAddress || 'unknown';
    }

    function uid() {
        return crypto.randomBytes(8).toString('hex');
    }

    function normalizeCode(code) {
        return String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    }

    function parseQuery(req) {
        const idx = (req.url || '').indexOf('?');
        if (idx < 0) return new URLSearchParams();
        return new URLSearchParams((req.url || '').slice(idx + 1));
    }

    Object.assign(api, {
        clampText,
        getClientIp,
        uid,
        normalizeCode,
        parseQuery
    });
}

module.exports = { register };
