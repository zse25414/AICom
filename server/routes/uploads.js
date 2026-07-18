/**
 * routes/uploads — GET /uploads/*
 * 任務：受 JWT 保護的上傳檔案
 */
'use strict';
const runtime = require('../runtime-legacy');

async function handleUploadRoutes(req, res, urlPath, method) {
    if (!(method === 'GET' && urlPath.startsWith('/uploads/'))) return false;
    await runtime.dispatchRequest(req, res);
    return true;
}
module.exports = { handleUploadRoutes, OWNER: 'enterprise-files', PREFIX: '/uploads' };
