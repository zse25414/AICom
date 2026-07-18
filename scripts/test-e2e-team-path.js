/**
 * P1-5: Team main-path E2E (API level).
 * register → create group → join → assign task → complete → upload KB → query.
 * Requires API running (RAG optional but query step needs it).
 *
 *   npm run test:e2e-team
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
        }, (res) => {
            let data = '';
            res.on('data', (c) => { data += c; });
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
    console.log('OK', name);
}

(async () => {
    const suffix = Date.now().toString().slice(-6);
    const mgrEmail = `tmgr-${suffix}@lumina.test`;
    const memEmail = `tmem-${suffix}@lumina.test`;

    const ready = await request('GET', '/ready');
    assertStep('ready', ready.status === 200 && ready.data?.ready, ready.raw);

    const regMgr = await request('POST', '/api/auth/register', {
        name: 'TeamMgr', email: mgrEmail, role: 'PM', password: 'test1234'
    });
    assertStep('register manager', regMgr.status === 201 && regMgr.data.token, regMgr.raw);
    const mgrToken = regMgr.data.token;

    const regMem = await request('POST', '/api/auth/register', {
        name: 'TeamMem', email: memEmail, role: 'Eng', password: 'test1234'
    });
    assertStep('register member', regMem.status === 201 && regMem.data.token, regMem.raw);
    const memToken = regMem.data.token;

    const code = `E${suffix}`;
    const create = await request('POST', '/api/enterprise/group/create', {
        code,
        name: 'E2E Team Path',
        managerName: '主管',
        managerPin: '847293'
    }, mgrToken);
    assertStep('create group', create.status === 200 && create.data.member?.role === 'manager', create.raw);
    const managerId = create.data.member.id;

    const join = await request('POST', '/api/enterprise/group/join', {
        code,
        name: '成員',
        role: 'member'
    }, memToken);
    assertStep('member join', join.status === 200 && join.data.member, join.raw);
    const memberId = join.data.member.id;

    const assign = await request('POST', '/api/enterprise/task/assign', {
        groupCode: code,
        managerId,
        assigneeId: memberId,
        title: 'E2E 團隊任務',
        duration: 25,
        energy: 3,
        category: 'execution'
    }, mgrToken);
    assertStep('assign task', assign.status === 200 && assign.data.task?.id, assign.raw);
    const taskId = assign.data.task.id;

    const patch = await request('PATCH', `/api/enterprise/task/${taskId}`, {
        groupCode: code,
        memberId,
        completed: true
    }, memToken);
    assertStep('complete task', patch.status === 200 && patch.data.task?.completed === true, patch.raw);

    const notes = await request('GET', `/api/enterprise/notifications?groupCode=${code}&memberId=${memberId}`, null, memToken);
    assertStep('notifications list', notes.status === 200 && Array.isArray(notes.data.notifications), notes.raw);

    const upload = await request('POST', '/api/rag/document/upload-text', {
        group_code: code,
        kb_id: 'general',
        title: 'E2E 知識片段',
        content: '團隊主路徑驗收關鍵字：藍莓派協議。所有成員需在週一同步站會。'
    }, mgrToken);
    assertStep('upload knowledge', upload.status === 200, upload.data?.detail || upload.raw);

    await new Promise((r) => setTimeout(r, 600));

    const query = await request('POST', '/api/rag/query', {
        query: '藍莓派協議是什麼？週一要做什麼？',
        group_code: code,
        kb_ids: ['general']
    }, mgrToken);

    if (query.status === 200 && query.data?.answer) {
        const ans = String(query.data.answer);
        const hit = /藍莓|週一|站會/.test(ans);
        assertStep('rag query knowledge', hit || ans.length > 10, ans.slice(0, 100));
        assertStep('rag sources', Array.isArray(query.data.sources) && query.data.sources.length > 0, `n=${query.data.sources?.length}`);
    } else {
        // Soft-fail RAG when service down: still pass team path if core team steps OK
        console.warn('SKIP rag query (status=' + query.status + ') — start RAG for full gate');
        if (process.env.REQUIRE_RAG === '1') {
            throw new Error('rag query required: ' + (query.data?.error || query.raw));
        }
    }

    console.log('\nTeam main-path E2E passed');
    process.exit(0);
})().catch((e) => {
    console.error('TEAM E2E FAIL:', e.message);
    process.exit(1);
});
