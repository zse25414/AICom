/**
 * routes/rag — /api/rag/*
 * 任務：KB 列表／建立／刪除、查詢、文件索引代理
 */
'use strict';
const runtime = require('../runtime-legacy');

async function handleRagRoutes(req, res, urlPath) {
    if (!urlPath.startsWith('/api/rag/')) return false;
    await runtime.dispatchRequest(req, res);
    return true;
}
module.exports = { handleRagRoutes, OWNER: 'rag', PREFIX: '/api/rag' };
