/**
 * routes/enterprise — /api/enterprise/*
 * 任務：群組、指派、文件版本、團隊通知
 */
'use strict';
const runtime = require('../runtime-legacy');

async function handleEnterpriseRoutes(req, res, urlPath, method) {
    return runtime.handleEnterprise(req, res, urlPath, method);
}
module.exports = { handleEnterpriseRoutes, OWNER: 'enterprise', PREFIX: '/api/enterprise' };
