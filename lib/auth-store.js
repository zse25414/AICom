const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getDb, isUsingMongo } = require('./db');
const { queueWrite } = require('./write-queue');

const DATA_FILE = path.join(__dirname, '..', 'auth-users.json');

function uid() {
    return crypto.randomUUID();
}

async function initAuthStore() {
    if (!isUsingMongo()) {
        console.log('[Lumina Auth] 使用本機 JSON 檔案儲存使用者');
        return;
    }

    const db = getDb();
    const count = await db.collection('users').countDocuments();
    if (count === 0 && fs.existsSync(DATA_FILE)) {
        try {
            const local = loadUsersFromFile();
            const users = Object.values(local.users || {});
            if (users.length > 0) {
                await db.collection('users').insertMany(users);
                console.log(`[Lumina Auth] 已將 ${users.length} 位使用者從 auth-users.json 匯入 MongoDB`);
            }
        } catch (err) {
            console.warn('[Lumina Auth] 本機使用者匯入失敗:', err.message);
        }
    }
    console.log(`[Lumina Auth] MongoDB 使用者集合已就緒`);
}

function loadUsersFromFile() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            return raw && typeof raw.users === 'object' ? raw : { users: {} };
        }
    } catch (_) {}
    return { users: {} };
}

function saveUsersToFile(store) {
    return queueWrite(DATA_FILE, JSON.stringify(store, null, 2));
}

async function findUserByEmail(email) {
    if (isUsingMongo()) {
        return getDb().collection('users').findOne({ email });
    }
    const store = loadUsersFromFile();
    return store.users[email] || null;
}

async function findUserById(userId) {
    if (isUsingMongo()) {
        return getDb().collection('users').findOne({ id: userId });
    }
    const store = loadUsersFromFile();
    return Object.values(store.users).find(u => u.id === userId) || null;
}

async function createUser({ email, name, role, passwordHash }) {
    const now = new Date().toISOString();
    const user = {
        id: uid(),
        email,
        name,
        role: role || '知識工作者',
        passwordHash,
        createdAt: now,
        updatedAt: now
    };

    if (isUsingMongo()) {
        await getDb().collection('users').insertOne(user);
        return user;
    }

    const store = loadUsersFromFile();
    if (store.users[email]) {
        const err = new Error('EMAIL_EXISTS');
        err.code = 'EMAIL_EXISTS';
        throw err;
    }
    store.users[email] = user;
    await saveUsersToFile(store);
    return user;
}

async function updateUser(userId, patch) {
    const now = new Date().toISOString();
    const updates = { ...patch, updatedAt: now };

    if (isUsingMongo()) {
        await getDb().collection('users').updateOne({ id: userId }, { $set: updates });
        return findUserById(userId);
    }

    const store = loadUsersFromFile();
    const user = Object.values(store.users).find(u => u.id === userId);
    if (!user) return null;
    Object.assign(user, updates);
    store.users[user.email] = user;
    await saveUsersToFile(store);
    return user;
}

function getAuthBackend() {
    return isUsingMongo() ? 'mongodb' : 'file';
}

module.exports = {
    initAuthStore,
    findUserByEmail,
    findUserById,
    createUser,
    updateUser,
    getAuthBackend
};