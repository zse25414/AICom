/**
 * server/app — HTTP 伺服器組裝
 * 任務：建立 Server；請求分派與 legacy 控制流 1:1（行為不變）
 */
'use strict';

const runtime = require('./runtime-legacy');
const { ROUTE_MODULES } = require('./routes');

function createApp() {
    return runtime.createServer();
}

function listRouteOwners() {
    return ROUTE_MODULES.map((m) => ({ id: m.id, owner: m.OWNER, prefix: m.PREFIX }));
}

module.exports = { createApp, listRouteOwners };
