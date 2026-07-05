const { MongoClient } = require('mongodb');

let mongoClient = null;
let mongoDb = null;
let usingMongo = false;

const IS_PRODUCTION = process.env.NODE_ENV === 'production' || process.env.LUMINA_ENFORCE_SECRETS === '1';
const REQUIRE_MONGODB = IS_PRODUCTION || process.env.REQUIRE_MONGODB === '1';

async function initDb() {
    const uri = (process.env.MONGODB_URI || '').trim();
    if (!uri) {
        if (REQUIRE_MONGODB) {
            throw new Error('生產環境必須設定 MONGODB_URI');
        }
        usingMongo = false;
        return false;
    }

    if (mongoClient) return true;

    try {
        const clientOptions = {
            serverSelectionTimeoutMS: 8000,
            connectTimeoutMS: 8000
        };
        if (uri.includes('mongodb+srv://') || uri.includes('ssl=true') || uri.includes('tls=true')) {
            clientOptions.tls = true;
        }
        if (process.env.MONGODB_TLS_INSECURE === '1') {
            clientOptions.tlsAllowInvalidCertificates = true;
        }
        mongoClient = new MongoClient(uri, clientOptions);
        await mongoClient.connect();
        mongoDb = mongoClient.db(process.env.MONGODB_DB || 'lumina');
        usingMongo = true;
        return true;
    } catch (err) {
        if (mongoClient) {
            try { await mongoClient.close(); } catch (_) {}
        }
        mongoClient = null;
        mongoDb = null;
        usingMongo = false;
        if (REQUIRE_MONGODB) {
            console.error('[Lumina DB] MongoDB 連線失敗，生產環境拒絕降級:', err.message);
            throw err;
        }
        console.warn('[Lumina DB] MongoDB 連線失敗，改用本機 JSON 儲存:', err.message);
        return false;
    }
}

function getDb() {
    return mongoDb;
}

function isUsingMongo() {
    return usingMongo;
}

function getDbName() {
    return process.env.MONGODB_DB || 'lumina';
}

async function ensureIndexes() {
    if (!usingMongo || !mongoDb) return;

    await mongoDb.collection('users').createIndex({ email: 1 }, { unique: true });
    await mongoDb.collection('users').createIndex({ id: 1 }, { unique: true });
    await mongoDb.collection('user_data').createIndex({ userId: 1 }, { unique: true });
    await mongoDb.collection('enterprise_store').createIndex({ _id: 1 });
}

async function getDatabaseStats() {
    if (!usingMongo || !mongoDb) {
        return { mode: 'file' };
    }

    const [users, userData, enterprise] = await Promise.all([
        mongoDb.collection('users').countDocuments(),
        mongoDb.collection('user_data').countDocuments(),
        mongoDb.collection('enterprise_store').findOne({ _id: 'main' })
    ]);

    const groups = enterprise?.groups || {};
    let members = 0;
    let tasks = 0;
    let documents = 0;
    for (const group of Object.values(groups)) {
        members += (group.members || []).length;
        tasks += (group.tasks || []).length;
        documents += (group.documents || []).length;
    }

    return {
        mode: 'mongodb',
        database: getDbName(),
        collections: {
            users,
            user_data: userData,
            enterprise_groups: Object.keys(groups).length,
            enterprise_members: members,
            enterprise_tasks: tasks,
            enterprise_documents: documents
        }
    };
}

async function closeDb() {
    if (mongoClient) {
        await mongoClient.close();
        mongoClient = null;
        mongoDb = null;
        usingMongo = false;
    }
}

module.exports = {
    initDb,
    getDb,
    isUsingMongo,
    getDbName,
    ensureIndexes,
    getDatabaseStats,
    closeDb
};