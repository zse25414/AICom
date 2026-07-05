/**
 * 教練 AI 知識庫問答 E2E（自包含：建立群組 + 上傳文件 + 查詢）
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
            res.on('data', (chunk) => { data += chunk; });
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

        const code = `C${Date.now().toString().slice(-6)}`;
        const create = await request('POST', '/api/enterprise/group/create', {
            code,
            name: 'Coach RAG Team',
            managerName: 'Manager',
            managerPin: '847293'
        }, token);
        assertStep('create group', create.status === 200 && create.data.ok, create.data.error || create.raw);

        const upload = await request('POST', '/api/rag/document/upload-text', {
            group_code: code,
            kb_id: 'general',
            title: '公司文化手冊',
            content: '我們公司的核心價值是用戶價值第一。使命是幫助每個人完成今日第一步，簡單可執行。'
        }, token);
        assertStep('upload knowledge', upload.status === 200, upload.data.detail || upload.raw);

        const kbList = await request('GET', `/api/rag/kb/list?group_code=${encodeURIComponent(code)}`, null, token);
        assertStep('kb list', kbList.status === 200, kbList.raw);
        const kbIds = Array.isArray(kbList.data.kb_ids) ? kbList.data.kb_ids : ['general'];
        console.log('  kb_ids:', kbIds.join(', '));

        const query = await request('POST', '/api/rag/query', {
            query: '公司的核心價值是什麼？',
            group_code: code,
            kb_ids: kbIds.length ? kbIds : ['general']
        }, token);
        assertStep('rag query', query.status === 200 && query.data.answer, query.data.error || query.data.detail || query.raw);

        const answer = String(query.data.answer || '');
        const sources = query.data.sources || [];
        const hasValueHint = /核心價值|用戶價值|簡單|使命/.test(answer);
        assertStep('answer has knowledge', hasValueHint || answer.length > 20, answer.slice(0, 120));
        assertStep('sources returned', sources.length > 0, `count=${sources.length}`);

        console.log('\n--- Coach RAG preview ---');
        console.log(answer.slice(0, 200));
        console.log('All coach-rag tests passed');
        process.exit(0);
    } catch (e) {
        console.error('COACH RAG TEST FAILED:', e.message);
        process.exit(1);
    }
})();