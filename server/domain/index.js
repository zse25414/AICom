/**
 * server/domain — 領域模組組裝
 * 載入順序：工具 → 基礎設施 → 企業 → RAG → HTTP handlers
 */
'use strict';

const config = require('../config');
const {
    initDb, ensureIndexes, getDatabaseStats
} = require('../../lib/db');
const {
    initStore, getStoreBackend
} = require('../../lib/enterprise-store');
const {
    initAuthStore, getAuthBackend
} = require('../../lib/auth-store');
const {
    initUserDataStore, getUserDataBackend
} = require('../../lib/user-data-store');

/** @type {Record<string, any>} */
const api = Object.create(null);

Object.assign(api, {
    config,
    PORT: config.PORT,
    API_KEY: config.API_KEY,
    DEEPSEEK_URL: config.DEEPSEEK_URL,
    RAG_SERVICE_URL: config.RAG_SERVICE_URL,
    serviceStartedAt: config.serviceStartedAt,
    AI_RATE_LIMIT_MAX: config.AI_RATE_LIMIT_MAX,
    AI_RATE_LIMIT_WINDOW_MS: config.AI_RATE_LIMIT_WINDOW_MS,
    RAG_INDEX_TIMEOUT_MS: config.RAG_INDEX_TIMEOUT_MS,
    enforceProductionSecrets: config.enforceProductionSecrets,
    initDb,
    ensureIndexes,
    initStore,
    initAuthStore,
    initUserDataStore,
    getStoreBackend,
    getAuthBackend,
    getUserDataBackend,
    getDatabaseStats
});

const order = [
    'util',
    'pin',
    'rate-limit',
    'llm',
    'http',
    'auth-mw',
    'enterprise/core',
    'enterprise/kb',
    'enterprise/documents',
    'rag/ops',
    'handlers/user-data',
    'handlers/auth',
    'handlers/enterprise',
    'handlers/dispatch'
];

for (const name of order) {
    require('./' + name).register(api);
}

module.exports = api;
