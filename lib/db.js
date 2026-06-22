const { MongoClient } = require('mongodb');

let mongoClient = null;
let mongoDb = null;
let usingMongo = false;

async function initDb() {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        usingMongo = false;
        return false;
    }

    if (mongoClient) return true;

    mongoClient = new MongoClient(uri);
    await mongoClient.connect();
    mongoDb = mongoClient.db(process.env.MONGODB_DB || 'lumina');
    usingMongo = true;
    return true;
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