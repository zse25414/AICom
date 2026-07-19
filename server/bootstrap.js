/**
 * server/bootstrap — 程序啟動：DB / store 初始化 + listen
 */
'use strict';

const runtime = require('./runtime-legacy');
const { createApp, listRouteOwners } = require('./app');

function startServer() {
    runtime.enforceProductionSecrets();
    const server = createApp();

    return runtime.initDb().then(async () => {
        await runtime.ensureIndexes();
        await runtime.initStore();
        await runtime.initAuthStore();
        await runtime.initUserDataStore();
        return new Promise((resolve) => {
            server.listen(runtime.PORT, async () => {
                const dbStats = await runtime.getDatabaseStats();
                console.log('Lumina API proxy running at http://localhost:' + runtime.PORT);
                console.log('  Modular routes:');
                for (const r of listRouteOwners()) {
                    console.log('   - [' + r.id + '] ' + r.prefix + '  (owner: ' + r.owner + ')');
                }
                console.log('  Storage:', runtime.getStoreBackend(),
                    '| Auth:', runtime.getAuthBackend(),
                    '| UserData:', runtime.getUserDataBackend());
                if (dbStats) console.log('  Database:', JSON.stringify(dbStats));
                if (typeof runtime.startRagReconcileScheduler === 'function') {
                    const timer = runtime.startRagReconcileScheduler();
                    console.log('  RAG auto-reconcile:', timer
                        ? `every ${Math.round(runtime.config.RAG_RECONCILE_INTERVAL_MS / 60000)}min (reindex-only)`
                        : 'disabled');
                }
                if (typeof runtime.startUserAttachmentGc === 'function') {
                    const gc = runtime.startUserAttachmentGc();
                    console.log('  Attachment GC:', gc
                        ? `every ${Math.round(runtime.config.USER_ATTACH_GC_INTERVAL_MS / 3600000)}h (24h grace)`
                        : 'disabled');
                }
                resolve(server);
            });
        });
    });
}

module.exports = { startServer };

if (require.main === module) {
    startServer().catch((err) => {
        console.error('[Lumina API] bootstrap failed', err);
        process.exit(1);
    });
}
