/**
 * routes/index — 領域路由註冊表（各有各的任務）
 */
'use strict';

const auth = require('./auth');
const userData = require('./user-data');
const enterprise = require('./enterprise');
const rag = require('./rag');
const chat = require('./chat');
const health = require('./health');
const uploads = require('./uploads');

const ROUTE_MODULES = [
    { id: 'health', ...health },
    { id: 'uploads', ...uploads },
    { id: 'auth', ...auth },
    { id: 'user-data', ...userData },
    { id: 'enterprise', ...enterprise },
    { id: 'rag', ...rag },
    { id: 'chat', ...chat }
];

module.exports = { ROUTE_MODULES, auth, userData, enterprise, rag, chat, health, uploads };
