/**
 * Lumina AI — API 代理 + 企業團隊模式後端
 *
 * 用法：
 *   set DEEPSEEK_API_KEY=sk-your-key
 *   node api-proxy.js
 *
 * 企業 API：
 *   POST /api/enterprise/group/create
 *   POST /api/enterprise/group/join
 *   GET  /api/enterprise/group/:code
 *   POST /api/enterprise/task/assign
 *   PATCH /api/enterprise/task/:id
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3001;
const API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
const DATA_FILE = path.join(__dirname, 'enterprise-data.json');

function setCors(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
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
            return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
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

function handleEnterprise(req, res, urlPath, method) {
    const store = loadStore();

    if (method === 'POST' && urlPath === '/api/enterprise/group/create') {
        return readBody(req).then(body => {
            const code = normalizeCode(body.code);
            const name = String(body.name || '').trim() || '未命名團隊';
            const managerName = String(body.managerName || '').trim();
            const managerPin = String(body.managerPin || '0000').trim();

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
                managerPin,
                createdAt: new Date().toISOString(),
                members: [{
                    id: managerId,
                    name: managerName,
                    role: 'manager',
                    joinedAt: new Date().toISOString()
                }],
                tasks: []
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
            const name = String(body.name || '').trim();
            const role = body.role === 'manager' ? 'manager' : 'member';
            const pin = String(body.pin || '').trim();

            const group = getGroup(store, code);
            if (!group) {
                return sendJson(res, 404, { error: '找不到此群組代碼' });
            }
            if (!name) {
                return sendJson(res, 400, { error: '請輸入你的名稱' });
            }
            if (role === 'manager' && pin !== group.managerPin) {
                return sendJson(res, 403, { error: '主管金鑰錯誤' });
            }

            const existing = group.members.find(m => m.name.toLowerCase() === name.toLowerCase());
            if (existing) {
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
        sendJson(res, 200, {
            ok: true,
            group: {
                code: group.code,
                name: group.name,
                members: group.members,
                tasks: group.tasks
            }
        });
        return;
    }

    if (method === 'POST' && urlPath === '/api/enterprise/task/assign') {
        return readBody(req).then(body => {
            const code = normalizeCode(body.groupCode);
            const managerId = body.managerId;
            const assigneeId = body.assigneeId;
            const title = String(body.title || '').trim();

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
                duration: parseInt(body.duration) || 30,
                energy: parseInt(body.energy) || 3,
                category: body.category || 'execution',
                due: body.due || new Date().toISOString().split('T')[0],
                completed: false,
                completedAt: null,
                createdAt: new Date().toISOString()
            };

            group.tasks.unshift(task);
            saveStore(store);
            sendJson(res, 200, { ok: true, task });
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

            if (typeof body.completed === 'boolean') {
                task.completed = body.completed;
                task.completedAt = body.completed ? new Date().toISOString() : null;
            }

            saveStore(store);
            sendJson(res, 200, { ok: true, task });
        });
    }

    sendJson(res, 404, { error: 'Enterprise route not found' });
}

const server = http.createServer(async (req, res) => {
    setCors(res);

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
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
            sendJson(res, 500, { error: err.message });
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
            sendJson(res, 500, { error: { message: err.message } });
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
    console.log(`  Data file: ${DATA_FILE}`);
    if (!API_KEY) console.warn('  ⚠️  DEEPSEEK_API_KEY not set (AI chat proxy disabled)');
});