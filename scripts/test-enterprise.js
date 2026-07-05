/**
 * 企業 API 整合測試
 */
const http = require('http');

const API_HOST = process.env.API_HOST || '127.0.0.1';
const API_PORT = Number(process.env.API_PORT || 3001);

function request(method, path, body, token) {
    return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : null;
        const req = http.request({
            hostname: API_HOST,
            port: API_PORT,
            path,
            method,
            headers: {
                ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
                ...(token ? { Authorization: `Bearer ${token}` } : {})
            }
        }, res => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                let parsed = {};
                try { parsed = data ? JSON.parse(data) : {}; } catch (_) {}
                resolve({ status: res.statusCode, data: parsed, raw: data });
            });
        });
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

function assertStep(name, cond, detail) {
    if (!cond) throw new Error(`${name}${detail ? `: ${detail}` : ''}`);
    console.log(`OK ${name}`);
}

(async () => {
    try {
        const suffix = Date.now().toString().slice(-6);
        const email = `ent-${suffix}@lumina.test`;

        const register = await request('POST', '/api/auth/register', {
            name: '企業測試',
            email,
            role: 'PM',
            password: 'test1234'
        });
        assertStep('register', register.status === 201 && register.data.token, register.raw);
        const token = register.data.token;

        const groupCode = `T${suffix}`;
        const create = await request('POST', '/api/enterprise/group/create', {
            code: groupCode,
            name: '測試團隊',
            managerName: '主管A',
            managerPin: '847293'
        }, token);
        assertStep('create group', create.status === 200 && create.data.member?.role === 'manager', create.raw);
        const managerId = create.data.member.id;

        const join = await request('POST', '/api/enterprise/group/join', {
            code: groupCode,
            name: '成員B',
            role: 'member'
        }, token);
        assertStep('join as member name', join.status === 200, join.raw);

        const assign = await request('POST', '/api/enterprise/task/assign', {
            groupCode,
            managerId,
            assigneeId: managerId,
            title: '整合測試任務',
            duration: 30,
            energy: 3,
            category: 'execution'
        }, token);
        assertStep('assign task', assign.status === 200 && assign.data.task?.id, assign.raw);
        const taskId = assign.data.task.id;

        const patch = await request('PATCH', `/api/enterprise/task/${taskId}`, {
            groupCode,
            memberId: managerId,
            completed: true
        }, token);
        assertStep('complete task', patch.status === 200 && patch.data.task?.completed === true, patch.raw);

        const notes = await request('GET', `/api/enterprise/notifications?groupCode=${groupCode}&memberId=${managerId}`, null, token);
        assertStep('notifications', notes.status === 200 && Array.isArray(notes.data.notifications), notes.raw);

        console.log('\nAll enterprise API checks passed');
        process.exit(0);
    } catch (err) {
        console.error('FAIL', err.message);
        process.exit(1);
    }
})();