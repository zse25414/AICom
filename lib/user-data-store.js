const fs = require('fs');
const path = require('path');
const { getDb, isUsingMongo } = require('./db');
const { queueWrite } = require('./write-queue');

const DATA_FILE = path.join(__dirname, '..', 'user-data.json');
const MAX_TASKS = 500;
const MAX_DAILY_HISTORY_DAYS = 90;
const MAX_TASK_ATTACHMENTS = 6;
const MAX_COACH_THREAD_MESSAGES = 16;

function defaultUserData(userId) {
    return {
        userId,
        tasks: [],
        profile: {},
        dailyHistory: {},
        trackedFocusByDay: {},
        weeklyScores: [0, 0, 0, 0, 0, 0, 0],
        coachThread: null,
        version: 1,
        updatedAt: new Date().toISOString()
    };
}

// 附件僅存中繼資料與 /uploads/ 參照，不存 base64（payload 體積與隱私考量）
function sanitizeAttachments(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
        .filter(a => a && typeof a === 'object' && a.name)
        .slice(0, MAX_TASK_ATTACHMENTS)
        .map(a => ({
            id: String(a.id || '').slice(0, 60) || null,
            name: String(a.name || 'file').slice(0, 200),
            mime: String(a.mime || 'application/octet-stream').slice(0, 120),
            size: Math.max(0, parseInt(a.size, 10) || 0),
            kind: a.kind === 'image' || a.kind === 'text' ? a.kind : 'file',
            fileUrl: typeof a.fileUrl === 'string' && a.fileUrl.startsWith('/uploads/')
                ? a.fileUrl.slice(0, 300)
                : null,
            textPreview: typeof a.textPreview === 'string' ? a.textPreview.slice(0, 2000) : null,
            addedAt: Math.max(0, parseInt(a.addedAt, 10) || 0) || null
        }));
}

function sanitizeCoachThread(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const savedAt = Math.max(0, parseInt(raw.savedAt, 10) || 0);
    if (!savedAt) return null;
    if (raw.cleared === true) {
        return { v: 1, cleared: true, savedAt };
    }
    if (raw.freeform !== true || !Array.isArray(raw.messages) || !raw.messages.length) return null;
    const messages = raw.messages.slice(-MAX_COACH_THREAD_MESSAGES)
        .filter(m => m && typeof m === 'object')
        .map(m => ({
            role: m.role === 'user' ? 'user' : 'coach',
            content: String(m.content || '').slice(0, 8000),
            ts: Math.max(0, parseInt(m.ts, 10) || 0) || null,
            sources: Array.isArray(m.sources)
                ? m.sources.slice(0, 5).map(s => ({
                    filename: s?.filename ? String(s.filename).slice(0, 200) : null,
                    title: s?.title ? String(s.title).slice(0, 200) : null,
                    kb_id: s?.kb_id ? String(s.kb_id).slice(0, 60) : null,
                    document_id: s?.document_id ? String(s.document_id).slice(0, 60) : null,
                    score: typeof s?.score === 'number' ? s.score : null,
                    snippet: s?.snippet ? String(s.snippet).slice(0, 500) : null,
                    ref_id: s?.ref_id != null ? s.ref_id : null
                }))
                : null,
            meta: (() => {
                try {
                    if (!m.meta || typeof m.meta !== 'object') return null;
                    const json = JSON.stringify(m.meta);
                    return json.length <= 1500 ? m.meta : null;
                } catch (_) { return null; }
            })(),
            attachments: sanitizeAttachments(m.attachments)
        }));
    if (!messages.length) return null;
    return { v: 1, freeform: true, savedAt, messages };
}

function sanitizeProfile(profile) {
    if (!profile || typeof profile !== 'object') return {};
    const allowed = [
        'name', 'role', 'streak', 'bestStreak', 'joinDay',
        'workStart', 'workEnd', 'peakStart', 'peakEnd',
        'streakThreshold', 'enableConfetti',
        'apiEnabled', 'apiMode', 'apiModel', 'apiProxyUrl', 'enterpriseApiUrl'
    ];
    const out = {};
    for (const key of allowed) {
        if (profile[key] !== undefined) out[key] = profile[key];
    }
    return out;
}

function mergeTasksByUpdatedAt(existingTasks, incomingTasks) {
    const byId = new Map();
    for (const t of [...(existingTasks || []), ...(incomingTasks || [])]) {
        if (!t || t.id === undefined || t.id === null) continue;
        const prev = byId.get(t.id);
        if (!prev) {
            byId.set(t.id, t);
            continue;
        }
        const prevTs = Date.parse(prev.updatedAt || '') || 0;
        const nextTs = Date.parse(t.updatedAt || '') || 0;
        byId.set(t.id, nextTs >= prevTs ? t : prev);
    }
    return Array.from(byId.values());
}

function sanitizeTasks(tasks) {
    if (!Array.isArray(tasks)) return [];
    return tasks.slice(0, MAX_TASKS).map(t => ({
        id: t.id,
        name: String(t.name || '').slice(0, 200),
        duration: Math.min(480, Math.max(5, parseInt(t.duration, 10) || 30)),
        energy: Math.min(5, Math.max(1, parseInt(t.energy, 10) || 3)),
        category: String(t.category || 'execution').slice(0, 20),
        due: String(t.due || '').slice(0, 10),
        completed: !!t.completed,
        wasOverdue: !!t.wasOverdue,
        parentGoalId: t.parentGoalId ?? null,
        parentGoalName: t.parentGoalName ? String(t.parentGoalName).slice(0, 120) : null,
        enterpriseTaskId: t.enterpriseTaskId ? String(t.enterpriseTaskId).slice(0, 40) : null,
        attachments: sanitizeAttachments(t.attachments),
        updatedAt: t.updatedAt ? String(t.updatedAt).slice(0, 30) : null
    }));
}

function sanitizeDailyHistory(history) {
    if (!history || typeof history !== 'object') return {};
    const out = {};
    const keys = Object.keys(history).sort().slice(-MAX_DAILY_HISTORY_DAYS);
    for (const key of keys) {
        const day = history[key];
        if (!day || typeof day !== 'object') continue;
        out[key] = {
            focusMinutes: Math.max(0, parseInt(day.focusMinutes, 10) || 0),
            trackedFocusMinutes: Math.max(0, parseInt(day.trackedFocusMinutes, 10) || 0),
            completed: Math.max(0, parseInt(day.completed, 10) || 0),
            total: Math.max(0, parseInt(day.total, 10) || 0),
            rate: Math.min(100, Math.max(0, parseInt(day.rate, 10) || 0))
        };
    }
    return out;
}

function sanitizeTrackedFocus(tracked) {
    if (!tracked || typeof tracked !== 'object') return {};
    const out = {};
    const keys = Object.keys(tracked).sort().slice(-MAX_DAILY_HISTORY_DAYS);
    for (const key of keys) {
        const mins = Math.max(0, parseInt(tracked[key], 10) || 0);
        if (mins > 0) out[key] = mins;
    }
    return out;
}

function sanitizePayload(payload, userId) {
    const now = new Date().toISOString();
    return {
        userId,
        tasks: sanitizeTasks(payload.tasks),
        profile: sanitizeProfile(payload.profile),
        dailyHistory: sanitizeDailyHistory(payload.dailyHistory),
        trackedFocusByDay: sanitizeTrackedFocus(payload.trackedFocusByDay),
        weeklyScores: Array.isArray(payload.weeklyScores) && payload.weeklyScores.length === 7
            ? payload.weeklyScores.map(s => Math.min(100, Math.max(0, parseInt(s, 10) || 0)))
            : [0, 0, 0, 0, 0, 0, 0],
        coachThread: sanitizeCoachThread(payload.coachThread),
        version: Math.max(1, parseInt(payload.version, 10) || 1),
        updatedAt: payload.updatedAt || now
    };
}

// coachThread 取 savedAt 較新者（tombstone cleared 也算一個較新狀態）
function mergeCoachThread(existingThread, incomingThread) {
    const a = sanitizeCoachThread(existingThread);
    const b = sanitizeCoachThread(incomingThread);
    if (!a) return b;
    if (!b) return a;
    return (b.savedAt >= a.savedAt) ? b : a;
}

function loadFromFile() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            return raw && typeof raw.users === 'object' ? raw : { users: {} };
        }
    } catch (_) {}
    return { users: {} };
}

function saveToFile(store) {
    return queueWrite(DATA_FILE, JSON.stringify(store, null, 2));
}

async function getUserData(userId) {
    if (isUsingMongo()) {
        const doc = await getDb().collection('user_data').findOne({ userId });
        if (!doc) return null;
        const { _id, ...rest } = doc;
        return rest;
    }

    const store = loadFromFile();
    return store.users[userId] || null;
}

async function saveUserData(userId, payload) {
    const existing = await getUserData(userId);
    const data = sanitizePayload(payload, userId);
    data.updatedAt = new Date().toISOString();
    const baseVersion = parseInt(existing?.version ?? payload.version, 10) || 0;
    data.version = baseVersion + 1;

    if (isUsingMongo()) {
        await getDb().collection('user_data').replaceOne(
            { userId },
            data,
            { upsert: true }
        );
        return data;
    }

    const store = loadFromFile();
    store.users[userId] = data;
    await saveToFile(store);
    return data;
}

async function mergeUserData(userId, payload) {
    const existing = (await getUserData(userId)) || defaultUserData(userId);
    const incomingUpdatedAt = payload.updatedAt ? Date.parse(payload.updatedAt) : 0;
    const existingUpdatedAt = existing.updatedAt ? Date.parse(existing.updatedAt) : 0;

    if (incomingUpdatedAt && existingUpdatedAt && incomingUpdatedAt <= existingUpdatedAt) {
        return { data: existing, merged: false };
    }

    const mergedTasks = payload.tasks !== undefined
        ? mergeTasksByUpdatedAt(existing.tasks, payload.tasks)
        : existing.tasks;

    const merged = sanitizePayload({
        tasks: mergedTasks,
        profile: { ...existing.profile, ...(payload.profile || {}) },
        dailyHistory: { ...existing.dailyHistory, ...(payload.dailyHistory || {}) },
        trackedFocusByDay: { ...(existing.trackedFocusByDay || {}), ...(payload.trackedFocusByDay || {}) },
        weeklyScores: payload.weeklyScores ?? existing.weeklyScores,
        coachThread: mergeCoachThread(existing.coachThread, payload.coachThread),
        version: existing.version,
        updatedAt: payload.updatedAt || new Date().toISOString()
    }, userId);

    const saved = await saveUserData(userId, merged);
    return { data: saved, merged: true };
}

async function initUserDataStore() {
    if (!isUsingMongo()) {
        console.log('[Lumina UserData] 使用本機 JSON 檔案儲存個人資料');
        return;
    }

    const db = getDb();
    const count = await db.collection('user_data').countDocuments();
    if (count === 0 && fs.existsSync(DATA_FILE)) {
        try {
            const local = loadFromFile();
            const entries = Object.entries(local.users || {});
            if (entries.length > 0) {
                const docs = entries.map(([userId, data]) => sanitizePayload(data, userId));
                await db.collection('user_data').insertMany(docs);
                console.log(`[Lumina UserData] 已將 ${docs.length} 筆個人資料從 user-data.json 匯入 MongoDB`);
            }
        } catch (err) {
            console.warn('[Lumina UserData] 本機個人資料匯入失敗:', err.message);
        }
    }

    const users = await db.collection('users').find({}, { projection: { id: 1 } }).toArray();
    let backfilled = 0;
    for (const user of users) {
        const existing = await db.collection('user_data').findOne({ userId: user.id }, { projection: { _id: 1 } });
        if (!existing) {
            await saveUserData(user.id, defaultUserData(user.id));
            backfilled += 1;
        }
    }
    if (backfilled > 0) {
        console.log(`[Lumina UserData] 已為 ${backfilled} 位使用者建立預設個人資料`);
    }
    console.log('[Lumina UserData] MongoDB 個人資料集合已就緒');
}

async function ensureUserData(userId) {
    const existing = await getUserData(userId);
    if (existing) return existing;
    return saveUserData(userId, defaultUserData(userId));
}

function getUserDataBackend() {
    return isUsingMongo() ? 'mongodb' : 'file';
}

module.exports = {
    initUserDataStore,
    getUserData,
    saveUserData,
    mergeUserData,
    ensureUserData,
    sanitizePayload,
    getUserDataBackend,
    defaultUserData
};