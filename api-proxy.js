/**
 * Lumina AI — API 代理 + 企業團隊模式後端
 *
 * 用法：
 *   set DEEPSEEK_API_KEY=sk-your-key
 *   set ALLOWED_ORIGINS=http://localhost:3456,http://127.0.0.1:3456
 *   node api-proxy.js
 *
 * 企業 API：
 *   POST /api/enterprise/group/create
 *   POST /api/enterprise/group/join
 *   GET  /api/enterprise/group/:code
 *   POST /api/enterprise/task/assign
 *   PATCH /api/enterprise/task/:id
 *   GET  /api/enterprise/notifications?groupCode=&memberId=
 *   PATCH /api/enterprise/notifications/read
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3001;
const API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
const DATA_FILE = path.join(__dirname, 'enterprise-data.json');
const PIN_SALT = process.env.PIN_SALT || 'lumina-pin-salt-change-in-production';
const MAX_BODY_BYTES = 6 * 1024 * 1024; // 6 MB to support file uploads
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 120;
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:3456,http://127.0.0.1:3456,http://localhost:3000,http://127.0.0.1:3000')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

const rateBuckets = new Map();

function hashPin(pin) {
    return crypto.createHash('sha256').update(PIN_SALT + ':' + String(pin)).digest('hex');
}

function verifyManagerPin(group, pin) {
    if (group.managerPinHash) {
        return hashPin(pin) === group.managerPinHash;
    }
    if (group.managerPin !== undefined) {
        return String(pin) === String(group.managerPin);
    }
    return false;
}

function migrateGroupPin(group) {
    if (!group.managerPinHash && group.managerPin !== undefined) {
        group.managerPinHash = hashPin(group.managerPin);
        delete group.managerPin;
    }
}

function clampText(value, max) {
    return String(value || '').trim().slice(0, max);
}

function getClientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) return String(forwarded).split(',')[0].trim();
    return req.socket.remoteAddress || 'unknown';
}

function checkRateLimit(req) {
    const ip = getClientIp(req);
    const now = Date.now();
    let bucket = rateBuckets.get(ip);
    if (!bucket || now - bucket.start > RATE_LIMIT_WINDOW_MS) {
        bucket = { start: now, count: 0 };
        rateBuckets.set(ip, bucket);
    }
    bucket.count++;
    return bucket.count <= RATE_LIMIT_MAX;
}

function setCors(req, res) {
    const origin = req.headers.origin;
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
    } else if (!origin) {
        res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS[0] || 'http://localhost:3456');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        let size = 0;
        req.on('data', chunk => {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                reject(new Error('Request body too large'));
                req.destroy();
                return;
            }
            body += chunk;
        });
        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (e) {
                reject(new Error('Invalid JSON'));
            }
        });
        req.on('error', reject);
    });
}

function sendJson(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}

function loadStore() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const store = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
            for (const group of Object.values(store.groups || {})) {
                migrateGroupPin(group);
                ensureNotifications(group);
            }
            return store;
        }
    } catch (_) {}
    return { groups: {} };
}

function saveStore(store) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), 'utf8');
}

function uid() {
    return crypto.randomBytes(8).toString('hex');
}

function normalizeCode(code) {
    return String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function getGroup(store, code) {
    const key = normalizeCode(code);
    return store.groups[key] || null;
}

function ensureNotifications(group) {
    if (!Array.isArray(group.notifications)) group.notifications = [];
}

function pushNotification(group, payload) {
    ensureNotifications(group);
    const note = {
        id: uid(),
        type: payload.type,
        recipientId: payload.recipientId,
        title: clampText(payload.title, 80) || '團隊通知',
        message: clampText(payload.message, 300),
        taskId: payload.taskId || null,
        taskTitle: clampText(payload.taskTitle, 120),
        actorId: payload.actorId || null,
        actorName: clampText(payload.actorName, 80),
        read: false,
        createdAt: new Date().toISOString()
    };
    group.notifications.unshift(note);
    if (group.notifications.length > 200) group.notifications.length = 200;
    return note;
}

function parseQuery(req) {
    const idx = (req.url || '').indexOf('?');
    if (idx < 0) return new URLSearchParams();
    return new URLSearchParams((req.url || '').slice(idx + 1));
}

function handleEnterprise(req, res, urlPath, method) {
    const store = loadStore();

    if (method === 'POST' && urlPath === '/api/enterprise/group/create') {
        return readBody(req).then(body => {
            const code = normalizeCode(body.code);
            const name = clampText(body.name, 80) || '未命名團隊';
            const managerName = clampText(body.managerName, 80);
            const managerPin = clampText(body.managerPin, 32) || '0000';

            if (!code || code.length < 4) {
                return sendJson(res, 400, { error: '群組代碼至少 4 個字元' });
            }
            if (!managerName) {
                return sendJson(res, 400, { error: '請輸入主管名稱' });
            }
            if (store.groups[code]) {
                return sendJson(res, 409, { error: '此群組代碼已存在' });
            }

            const managerId = uid();
            store.groups[code] = {
                code,
                name,
                managerPinHash: hashPin(managerPin),
                createdAt: new Date().toISOString(),
                members: [{
                    id: managerId,
                    name: managerName,
                    role: 'manager',
                    joinedAt: new Date().toISOString()
                }],
                tasks: [],
                notifications: []
            };
            saveStore(store);

            sendJson(res, 200, {
                ok: true,
                group: { code, name },
                member: { id: managerId, name: managerName, role: 'manager' }
            });
        });
    }

    if (method === 'POST' && urlPath === '/api/enterprise/group/join') {
        return readBody(req).then(body => {
            const code = normalizeCode(body.code);
            const name = clampText(body.name, 80);
            const role = body.role === 'manager' ? 'manager' : 'member';
            const pin = clampText(body.pin, 32);

            const group = getGroup(store, code);
            if (!group) {
                return sendJson(res, 404, { error: '找不到此群組代碼' });
            }
            if (!name) {
                return sendJson(res, 400, { error: '請輸入你的名稱' });
            }
            if (role === 'manager' && !verifyManagerPin(group, pin)) {
                return sendJson(res, 403, { error: '主管金鑰錯誤' });
            }

            migrateGroupPin(group);

            const existing = group.members.find(m => m.name.toLowerCase() === name.toLowerCase());
            if (existing) {
                saveStore(store);
                return sendJson(res, 200, {
                    ok: true,
                    group: { code: group.code, name: group.name },
                    member: existing
                });
            }

            const member = {
                id: uid(),
                name,
                role,
                joinedAt: new Date().toISOString()
            };
            group.members.push(member);
            saveStore(store);

            sendJson(res, 200, {
                ok: true,
                group: { code: group.code, name: group.name },
                member
            });
        });
    }

    const groupMatch = urlPath.match(/^\/api\/enterprise\/group\/([A-Za-z0-9]+)$/);
    if (method === 'GET' && groupMatch) {
        const group = getGroup(store, groupMatch[1]);
        if (!group) {
            return sendJson(res, 404, { error: '找不到群組' });
        }
        ensureNotifications(group);
        const query = parseQuery(req);
        const memberId = query.get('memberId');
        const payload = {
            code: group.code,
            name: group.name,
            members: group.members,
            tasks: group.tasks,
            documents: group.documents || []
        };
        if (memberId) {
            payload.notifications = group.notifications
                .filter(n => n.recipientId === memberId)
                .slice(0, 50);
            payload.unreadCount = payload.notifications.filter(n => !n.read).length;
        }
        sendJson(res, 200, { ok: true, group: payload });
        return;
    }

    if (method === 'POST' && urlPath === '/api/enterprise/group/document/add') {
        return readBody(req).then(body => {
            const code = normalizeCode(body.groupCode);
            const managerId = body.managerId;
            const title = clampText(body.title, 100) || body.filename || '未命名文件';
            const content = clampText(body.content, 10000);
            const docType = clampText(body.docType, 10) || 'text';

            const group = getGroup(store, code);
            if (!group) return sendJson(res, 404, { error: '找不到群組' });

            const manager = group.members.find(m => m.id === managerId && m.role === 'manager');
            if (!manager) return sendJson(res, 403, { error: '僅主管可管理知識庫' });

            if (docType === 'text' && (!title || !content)) {
                return sendJson(res, 400, { error: '請輸入標題與內容' });
            }
            if (!title) {
                return sendJson(res, 400, { error: '請輸入標題' });
            }

            let fileUrl = null;
            if ((docType === 'pdf' || docType === 'image' || docType === 'excel') && body.fileData && body.filename) {
                try {
                    const fileBuffer = Buffer.from(body.fileData, 'base64');
                    const ext = path.extname(body.filename) || (docType === 'pdf' ? '.pdf' : docType === 'excel' ? '.xlsx' : '.png');
                    const uniqueFilename = `${uid()}-${path.basename(body.filename, ext)}${ext}`;
                    const filePath = path.join(UPLOADS_DIR, uniqueFilename);
                    fs.writeFileSync(filePath, fileBuffer);
                    fileUrl = `/uploads/${uniqueFilename}`;
                } catch (e) {
                    return sendJson(res, 500, { error: '檔案儲存失敗: ' + e.message });
                }
            }

            if (!group.documents) group.documents = [];
            const doc = {
                id: uid(),
                title,
                content, // represents extractedText or description for files
                docType,
                fileUrl,
                filename: body.filename || null,
                kbId: clampText(body.kbId, 30) || 'general',
                author: manager.name,
                createdAt: new Date().toISOString()
            };
            group.documents.unshift(doc);
            saveStore(store);

            sendJson(res, 200, { ok: true, document: doc });
        });
    }

    if (method === 'POST' && urlPath === '/api/enterprise/group/document/delete') {
        return readBody(req).then(body => {
            const code = normalizeCode(body.groupCode);
            const managerId = body.managerId;
            const docId = body.documentId;

            const group = getGroup(store, code);
            if (!group) return sendJson(res, 404, { error: '找不到群組' });

            const manager = group.members.find(m => m.id === managerId && m.role === 'manager');
            if (!manager) return sendJson(res, 403, { error: '僅主管可管理知識庫' });

            if (!group.documents) group.documents = [];
            const index = group.documents.findIndex(d => d.id === docId);
            if (index === -1) return sendJson(res, 404, { error: '找不到該文件' });

            const doc = group.documents[index];
            if (doc.fileUrl) {
                try {
                    const baseName = path.basename(doc.fileUrl);
                    const filePath = path.join(UPLOADS_DIR, baseName);
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                    }
                } catch (e) {
                    console.warn('[Lumina Backend] 檔案刪除失敗:', e.message);
                }
            }

            group.documents.splice(index, 1);
            saveStore(store);

            sendJson(res, 200, { ok: true });
        });
    }

    if (method === 'POST' && urlPath === '/api/enterprise/task/assign') {
        return readBody(req).then(body => {
            const code = normalizeCode(body.groupCode);
            const managerId = body.managerId;
            const assigneeId = body.assigneeId;
            const title = clampText(body.title, 200);

            const group = getGroup(store, code);
            if (!group) return sendJson(res, 404, { error: '找不到群組' });

            const manager = group.members.find(m => m.id === managerId && m.role === 'manager');
            if (!manager) return sendJson(res, 403, { error: '僅主管可指派任務' });

            const assignee = group.members.find(m => m.id === assigneeId);
            if (!assignee) return sendJson(res, 404, { error: '找不到成員' });
            if (!title) return sendJson(res, 400, { error: '請輸入任務名稱' });

            const task = {
                id: uid(),
                title,
                assigneeId: assignee.id,
                assigneeName: assignee.name,
                assignedBy: manager.name,
                assignedById: manager.id,
                duration: Math.min(480, Math.max(5, parseInt(body.duration, 10) || 30)),
                energy: Math.min(5, Math.max(1, parseInt(body.energy, 10) || 3)),
                category: ['deep', 'execution', 'meeting', 'learning', 'admin'].includes(body.category)
                    ? body.category : 'execution',
                due: clampText(body.due, 12) || new Date().toISOString().split('T')[0],
                completed: false,
                completedAt: null,
                createdAt: new Date().toISOString()
            };

            group.tasks.unshift(task);
            const notifications = [];
            if (assignee.id !== manager.id) {
                notifications.push(pushNotification(group, {
                    type: 'task_assigned',
                    recipientId: assignee.id,
                    title: '新任務指派',
                    message: `${manager.name} 指派了「${title}」給你，截止 ${task.due}`,
                    taskId: task.id,
                    taskTitle: title,
                    actorId: manager.id,
                    actorName: manager.name
                }));
            }
            notifications.push(pushNotification(group, {
                type: 'task_assigned_confirm',
                recipientId: manager.id,
                title: '任務已指派',
                message: `已將「${title}」指派給 ${assignee.name}，截止 ${task.due}`,
                taskId: task.id,
                taskTitle: title,
                actorId: manager.id,
                actorName: manager.name
            }));
            saveStore(store);
            sendJson(res, 200, { ok: true, task, notifications });
        });
    }

    const taskMatch = urlPath.match(/^\/api\/enterprise\/task\/([a-f0-9]+)$/);
    if (method === 'PATCH' && taskMatch) {
        return readBody(req).then(body => {
            const code = normalizeCode(body.groupCode);
            const memberId = body.memberId;
            const group = getGroup(store, code);
            if (!group) return sendJson(res, 404, { error: '找不到群組' });

            const task = group.tasks.find(t => t.id === taskMatch[1]);
            if (!task) return sendJson(res, 404, { error: '找不到任務' });

            const member = group.members.find(m => m.id === memberId);
            if (!member) return sendJson(res, 403, { error: '無效的成員' });

            const canEdit = member.role === 'manager' || task.assigneeId === memberId;
            if (!canEdit) return sendJson(res, 403, { error: '無權限更新此任務' });

            let notifications = [];
            if (typeof body.completed === 'boolean') {
                const wasCompleted = !!task.completed;
                task.completed = body.completed;
                task.completedAt = body.completed ? new Date().toISOString() : null;
                if (body.completed && !wasCompleted) {
                    if (task.assignedById && task.assignedById !== memberId) {
                        notifications.push(pushNotification(group, {
                            type: 'task_completed',
                            recipientId: task.assignedById,
                            title: '任務已完成',
                            message: `${member.name} 完成了「${task.title}」`,
                            taskId: task.id,
                            taskTitle: task.title,
                            actorId: member.id,
                            actorName: member.name
                        }));
                    }
                    if (task.assigneeId === memberId && task.assigneeId !== task.assignedById) {
                        notifications.push(pushNotification(group, {
                            type: 'task_completed_confirm',
                            recipientId: memberId,
                            title: '任務已標記完成',
                            message: `你已完成「${task.title}」，主管已收到通知`,
                            taskId: task.id,
                            taskTitle: task.title,
                            actorId: member.id,
                            actorName: member.name
                        }));
                    }
                }
            }

            saveStore(store);
            sendJson(res, 200, { ok: true, task, notifications });
        });
    }

    if (method === 'GET' && urlPath === '/api/enterprise/notifications') {
        const query = parseQuery(req);
        const code = normalizeCode(query.get('groupCode'));
        const memberId = query.get('memberId');
        const group = getGroup(store, code);
        if (!group) return sendJson(res, 404, { error: '找不到群組' });
        if (!memberId || !group.members.some(m => m.id === memberId)) {
            return sendJson(res, 403, { error: '無效的成員' });
        }
        ensureNotifications(group);
        const notifications = group.notifications
            .filter(n => n.recipientId === memberId)
            .slice(0, 50);
        const unreadCount = notifications.filter(n => !n.read).length;
        sendJson(res, 200, { ok: true, notifications, unreadCount });
        return;
    }

    if (method === 'PATCH' && urlPath === '/api/enterprise/notifications/read') {
        return readBody(req).then(body => {
            const code = normalizeCode(body.groupCode);
            const memberId = body.memberId;
            const group = getGroup(store, code);
            if (!group) return sendJson(res, 404, { error: '找不到群組' });
            if (!memberId || !group.members.some(m => m.id === memberId)) {
                return sendJson(res, 403, { error: '無效的成員' });
            }
            ensureNotifications(group);
            const ids = Array.isArray(body.ids) ? body.ids : [];
            let updated = 0;
            for (const note of group.notifications) {
                if (note.recipientId !== memberId) continue;
                if (body.readAll || ids.includes(note.id)) {
                    if (!note.read) updated++;
                    note.read = true;
                }
            }
            saveStore(store);
            sendJson(res, 200, { ok: true, updated });
        });
    }

    sendJson(res, 404, { error: 'Enterprise route not found' });
}

const server = http.createServer(async (req, res) => {
    setCors(req, res);

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    if (!checkRateLimit(req)) {
        sendJson(res, 429, { error: '請求過於頻繁，請稍後再試' });
        return;
    }

    const urlPath = (req.url || '').split('?')[0];

    if (req.method === 'GET' && urlPath === '/health') {
        sendJson(res, 200, { ok: true, service: 'lumina-api-proxy', enterprise: true });
        return;
    }

    if (urlPath.startsWith('/api/enterprise')) {
        try {
            await handleEnterprise(req, res, urlPath, req.method);
        } catch (err) {
            const status = err.message === 'Request body too large' ? 413 : 500;
            sendJson(res, status, { error: err.message });
        }
        return;
    }

    if (req.method === 'POST' && urlPath === '/api/chat') {
        if (!API_KEY) {
            sendJson(res, 500, { error: 'Missing DEEPSEEK_API_KEY environment variable' });
            return;
        }
        try {
            const body = await readBody(req);
            const response = await fetch(DEEPSEEK_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${API_KEY}`
                },
                body: JSON.stringify(body)
            });
            const text = await response.text();
            res.writeHead(response.status, { 'Content-Type': 'application/json' });
            res.end(text);
        } catch (err) {
            const status = err.message === 'Request body too large' ? 413 : 500;
            sendJson(res, status, { error: { message: err.message } });
        }
        return;
    }

    sendJson(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
    console.log(`Lumina API proxy running at http://localhost:${PORT}`);
    console.log(`  POST /api/chat                    → DeepSeek`);
    console.log(`  POST /api/enterprise/group/create → 建立群組`);
    console.log(`  POST /api/enterprise/group/join   → 加入群組`);
    console.log(`  GET  /api/enterprise/group/:code  → 群組資料`);
    console.log(`  POST /api/enterprise/task/assign  → 指派任務`);
    console.log(`  PATCH /api/enterprise/task/:id    → 更新任務`);
    console.log(`  GET  /api/enterprise/notifications → 團隊通知`);
    console.log(`  PATCH /api/enterprise/notifications/read → 標記已讀`);
    console.log(`  Data file: ${DATA_FILE}`);
    console.log(`  Allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
    if (!API_KEY) console.warn('  ⚠️  DEEPSEEK_API_KEY not set (AI chat proxy disabled)');
    if (PIN_SALT === 'lumina-pin-salt-change-in-production') {
        console.warn('  ⚠️  Using default PIN_SALT — set PIN_SALT env in production');
    }
});