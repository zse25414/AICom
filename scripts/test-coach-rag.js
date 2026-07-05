/**
 * 教練 AI 知識庫問答 E2E 驗證（模擬前端流程）
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
        const email = `coach-${Date.now()}@lumina.test`;
        const register = await request('POST', '/api/auth/register', {
            name: '教練測試',
            email,
            role: '工程師',
            password: 'test1234'
        });
        assertStep('register', register.status === 201 && register.data.token, register.raw);
        const token = register.data.token;

        const join = await request('POST', '/api/enterprise/group/join', {
            code: '123456',
            name: `CoachTest${Date.now().toString().slice(-4)}`,
            role: 'member'
        }, token);
        assertStep('join group 123456', join.status === 200 && join.data.ok, join.data.error || join.raw);

        const kbList = await request('GET', '/api/rag/kb/list?group_code=123456', null, token);
        assertStep('kb list', kbList.status === 200, kbList.raw);
        const kbIds = Array.isArray(kbList.data.kb_ids) ? kbList.data.kb_ids : ['general'];
        console.log('  kb_ids:', kbIds.join(', '));

        const query = await request('POST', '/api/rag/query', {
            query: '公司的核心價值是什麼？',
            group_code: '123456',
            kb_ids: kbIds.length ? kbIds : ['onboarding', 'general']
        }, token);
        assertStep('rag query', query.status === 200 && query.data.answer, query.data.error || query.raw);

        const answer = String(query.data.answer || '');
        const sources = query.data.sources || [];
        const hasValueHint = /核心價值|用戶價值|簡單|使命/.test(answer);
        const hasSources = sources.length > 0;

        assertStep('answer has knowledge', hasValueHint || answer.length > 40, answer.slice(0, 120));
        assertStep('sources returned', hasSources, `count=${sources.length}`);

        console.log('\n--- Coach RAG preview ---');
        console.log('retrieval_mode:', query.data.retrieval_mode);
        console.log('sources:', sources.map(s => `[${s.ref_id}] ${s.kb_id}/${s.filename}`).join(', '));
        console.log('answer:', answer.slice(0, 280) + (answer.length > 280 ? '...' : ''));
        console.log('\nAll coach RAG checks passed');
        process.exit(0);
    } catch (err) {
        console.error('FAIL', err.message);
        process.exit(1);
    }
})();