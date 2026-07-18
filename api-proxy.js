/**
 * Lumina AI — API 入口（薄封裝）
 *
 * 模組化結構：
 *   server/bootstrap.js      啟動
 *   server/app.js            Server 組裝
 *   server/routes/*          領域路由（各有任務）
 *   server/runtime-legacy.js 過渡期領域實作
 *   server/config.js         環境常數
 *   lib/*                    持久化 / 認證 primitive
 *
 * 地圖：docs/architecture/MODULES.md
 *
 *   node api-proxy.js
 *   node server/bootstrap.js
 */
'use strict';

const { startServer } = require('./server/bootstrap');

startServer().catch((err) => {
    console.error('[Lumina API] failed to start', err);
    process.exit(1);
});
