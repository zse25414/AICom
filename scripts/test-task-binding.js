/**
 * Task KB/doc binding contract test (requires API :3001)
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
        const email = `bind-${suffix}@lumina.test`;

        const register = await request('POST', '/api/auth/register', {
            name: '綁定測試',
            email,
            role: 'PM',
            password: 'test1234'
        });
        assertStep('register', register.status === 201 && register.data.token, register.raw);
        const token = register.data.token;

        const groupCode = `B${suffix}`;
        const create = await request('POST', '/api/enterprise/group/create', {
            code: groupCode,
            name: '綁定測試團隊',
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
        assertStep('join member', join.status === 200 && join.data.member?.id, join.raw);
        const memberId = join.data.member.id;

        const addDoc = await request('POST', '/api/enterprise/group/document/add', {
            groupCode,
            managerId,
            title: '環境架設 SOP',
            content: '第一天請先安裝 Node 18 並執行 npm install。綁定文件測試內容。',
            docType: 'text',
            kbId: 'onboarding'
        }, token);
        assertStep('add document', addDoc.status === 200 && addDoc.data.document?.id, addDoc.raw);
        const docId = addDoc.data.document.id;

        const assign = await request('POST', '/api/enterprise/task/assign', {
            groupCode,
            managerId,
            assigneeId: memberId,
            title: '依 SOP 完成環境架設',
            duration: 45,
            energy: 3,
            category: 'learning',
            kbIds: ['onboarding'],
            docIds: [docId]
        }, token);
        assertStep(
            'assign with kb+doc binds',
            assign.status === 200
                && Array.isArray(assign.data.task?.kbIds)
                && assign.data.task.kbIds.includes('onboarding')
                && Array.isArray(assign.data.task?.docIds)
                && assign.data.task.docIds.includes(docId),
            assign.raw
        );

        // Only docs — should derive kbIds
        const assign2 = await request('POST', '/api/enterprise/task/assign', {
            groupCode,
            managerId,
            assigneeId: memberId,
            title: '只綁文件',
            duration: 20,
            category: 'execution',
            kbIds: [],
            docIds: [docId]
        }, token);
        assertStep(
            'assign with doc-only derives kbIds',
            assign2.status === 200
                && assign2.data.task?.docIds?.includes(docId)
                && assign2.data.task?.kbIds?.includes('onboarding'),
            assign2.raw
        );

        // Invalid doc id dropped
        const assign3 = await request('POST', '/api/enterprise/task/assign', {
            groupCode,
            managerId,
            assigneeId: memberId,
            title: '無效文件應被過濾',
            duration: 15,
            category: 'admin',
            kbIds: ['onboarding'],
            docIds: ['not-a-real-doc-id', docId]
        }, token);
        assertStep(
            'invalid docIds filtered',
            assign3.status === 200
                && assign3.data.task?.docIds?.length === 1
                && assign3.data.task.docIds[0] === docId,
            assign3.raw
        );

        const taskId = assign.data.task.id;
        const patch = await request('PATCH', `/api/enterprise/task/${taskId}`, {
            groupCode,
            memberId: managerId,
            kbIds: ['general', 'onboarding'],
            docIds: []
        }, token);
        assertStep(
            'manager rebind kbIds via PATCH',
            patch.status === 200
                && patch.data.task?.kbIds?.includes('general')
                && patch.data.task?.kbIds?.includes('onboarding')
                && Array.isArray(patch.data.task?.docIds)
                && patch.data.task.docIds.length === 0,
            patch.raw
        );

        console.log('\nAll task-binding checks passed');
        process.exit(0);
    } catch (err) {
        console.error('FAIL', err.message);
        process.exit(1);
    }
})();
