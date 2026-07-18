/**
 * routes/health — /health, /ready, /api/ops/status
 * 任務：存活、就緒、可觀測（無密鑰）
 */
'use strict';
const runtime = require('../runtime-legacy');

async function handleHealthRoutes(req, res, urlPath, method) {
    if (method !== 'GET') return false;
    if (urlPath === '/health' || urlPath === '/ready' || urlPath === '/api/ops/status') {
        await runtime.dispatchRequest(req, res);
        return true;
    }
    return false;
}
module.exports = { handleHealthRoutes, OWNER: 'platform', PREFIX: '/health|/ready|/api/ops' };
