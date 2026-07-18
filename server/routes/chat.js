/**
 * routes/chat — POST /api/chat
 * 任務：LLM 代理（限流 + body 淨化 + DeepSeek）
 */
'use strict';
const runtime = require('../runtime-legacy');

async function handleChatRoutes(req, res, urlPath, method) {
    if (!(method === 'POST' && urlPath === '/api/chat')) return false;
    await runtime.dispatchRequest(req, res);
    return true;
}
module.exports = { handleChatRoutes, OWNER: 'chat', PREFIX: '/api/chat' };
