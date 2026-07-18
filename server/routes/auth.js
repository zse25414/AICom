/**
 * routes/auth — /api/auth/*
 * 任務：註冊、登入、me、profile
 */
'use strict';
const runtime = require('../runtime-legacy');

async function handleAuthRoutes(req, res, urlPath, method) {
    return runtime.handleAuth(req, res, urlPath, method);
}
module.exports = { handleAuthRoutes, OWNER: 'auth', PREFIX: '/api/auth' };
