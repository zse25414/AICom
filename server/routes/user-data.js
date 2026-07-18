/**
 * routes/user-data — /api/user/*
 * 任務：個人任務／設定雲端同步
 */
'use strict';
const runtime = require('../runtime-legacy');

async function handleUserDataRoutes(req, res, urlPath, method) {
    return runtime.handleUserData(req, res, urlPath, method);
}
module.exports = { handleUserDataRoutes, OWNER: 'user-data', PREFIX: '/api/user' };
