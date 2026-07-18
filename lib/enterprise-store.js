const fs = require('fs');
const path = require('path');
const { getDb, isUsingMongo } = require('./db');
const { queueWrite } = require('./write-queue');

const DATA_FILE = path.join(__dirname, '..', 'enterprise-data.json');
const STORE_DOC_ID = 'main';

async function initStore() {
    if (!isUsingMongo()) {
        console.log('[Lumina Store] 使用本機 JSON 檔案儲存');
        return;
    }

    console.log(`[Lumina Store] MongoDB 已連線 (database: ${process.env.MONGODB_DB || 'lumina'})`);

    const existing = await getDb().collection('enterprise_store').findOne({ _id: STORE_DOC_ID });
    if (!existing?.groups && fs.existsSync(DATA_FILE)) {
        try {
            const local = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            if (local?.groups && Object.keys(local.groups).length > 0) {
                await saveStore(local);
                console.log('[Lumina Store] 已將本機 enterprise-data.json 匯入 MongoDB');
            }
        } catch (err) {
            console.warn('[Lumina Store] 本機資料匯入失敗:', err.message);
        }
    }
}

function loadStoreFromFile() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const store = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            return store && typeof store.groups === 'object' ? store : { groups: {} };
        }
    } catch (_) {}
    return { groups: {} };
}

function saveStoreToFile(store) {
    return queueWrite(DATA_FILE, JSON.stringify(store, null, 2));
}

async function loadStore() {
    if (isUsingMongo()) {
        const doc = await getDb().collection('enterprise_store').findOne({ _id: STORE_DOC_ID });
        if (!doc || typeof doc.groups !== 'object') return { groups: {} };
        return { groups: doc.groups };
    }
    return loadStoreFromFile();
}

async function saveStore(store) {
    const payload = { groups: store.groups || {} };
    if (isUsingMongo()) {
        await getDb().collection('enterprise_store').replaceOne(
            { _id: STORE_DOC_ID },
            { _id: STORE_DOC_ID, groups: payload.groups, updatedAt: new Date() },
            { upsert: true }
        );
        return;
    }
    await saveStoreToFile(payload);
}

function getStoreBackend() {
    return isUsingMongo() ? 'mongodb' : 'file';
}

module.exports = {
    initStore,
    loadStore,
    saveStore,
    getStoreBackend
};