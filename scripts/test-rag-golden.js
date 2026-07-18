/**
 * P1-4: RAG golden-set evaluation.
 * Requires API (+ RAG) running. Seed docs → query → assert must_include / sources.
 *
 *   npm run test:rag-golden
 *   API_HOST=127.0.0.1 API_PORT=3001 node scripts/test-rag-golden.js
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

const API_HOST = process.env.API_HOST || '127.0.0.1';
const API_PORT = Number(process.env.API_PORT || 3001);
const fixturePath = path.join(__dirname, '..', 'fixtures', 'rag-golden-set.json');

function request(method, pathName, body, token) {
    return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : null;
        const req = http.request({
            hostname: API_HOST,
            port: API_PORT,
            path: pathName,
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

function includesAny(text, list) {
    const t = String(text || '');
    return (list || []).some((s) => t.includes(s));
}

(async () => {
    if (!fs.existsSync(fixturePath)) {
        console.error('Missing fixture:', fixturePath);
        process.exit(1);
    }
    const golden = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    const questions = golden.questions || [];
    const passRatio = Number(golden.pass_ratio) || 0.8;

    const ready = await request('GET', '/ready');
    // /ready 回應欄位是 ok（舊版曾是 ready），兩者都接受
    if (ready.status !== 200 || !(ready.data?.ok ?? ready.data?.ready)) {
        console.error('API not ready. Start with npm run dev:all');
        process.exit(1);
    }
    if (ready.data?.checks && ready.data.checks.rag === false) {
        console.warn('WARN RAG not ok on /ready — queries may fail');
    }

    const email = `golden-${Date.now()}@lumina.test`;
    const reg = await request('POST', '/api/auth/register', {
        name: 'Golden',
        email,
        role: 'QA',
        password: 'test1234'
    });
    if (reg.status !== 201 || !reg.data.token) {
        console.error('register failed', reg.raw);
        process.exit(1);
    }
    const token = reg.data.token;
    const code = `G${Date.now().toString().slice(-6)}`;
    const create = await request('POST', '/api/enterprise/group/create', {
        code,
        name: 'Golden Set Team',
        managerName: 'Mgr',
        managerPin: '847293'
    }, token);
    if (create.status !== 200 || !create.data.ok) {
        console.error('create group failed', create.data?.error || create.raw);
        process.exit(1);
    }

    for (const doc of golden.documents || []) {
        const up = await request('POST', '/api/rag/document/upload-text', {
            group_code: code,
            kb_id: doc.kb_id || 'general',
            title: doc.title,
            content: doc.content
        }, token);
        if (up.status !== 200) {
            console.error('upload failed', doc.id, up.data?.detail || up.raw);
            process.exit(1);
        }
        console.log('OK seed', doc.id || doc.title);
    }

    // brief settle for indexing
    await new Promise((r) => setTimeout(r, 800));

    let passed = 0;
    const results = [];
    for (const q of questions) {
        const res = await request('POST', '/api/rag/query', {
            query: q.query,
            group_code: code,
            kb_ids: q.kb_ids || ['general']
        }, token);
        const answer = String(res.data?.answer || '');
        const sources = res.data?.sources || [];
        const okStatus = res.status === 200 && answer.length > 0;
        const okText = includesAny(answer, q.must_include_any);
        const okSrc = sources.length >= (q.min_sources || 0);
        const ok = okStatus && okText && okSrc;
        if (ok) passed++;
        results.push({ id: q.id, ok, okStatus, okText, okSrc, answer: answer.slice(0, 120), sources: sources.length });
        console.log(ok ? 'PASS' : 'FAIL', q.id, ok ? '' : JSON.stringify({ okStatus, okText, okSrc, sources: sources.length, preview: answer.slice(0, 80) }));
    }

    const ratio = questions.length ? passed / questions.length : 0;
    console.log(`\nGolden: ${passed}/${questions.length} (ratio=${ratio.toFixed(2)}, need≥${passRatio})`);
    if (ratio + 1e-9 < passRatio) {
        console.error('RAG golden set BELOW threshold');
        process.exit(1);
    }
    console.log('RAG golden set passed');
    process.exit(0);
})().catch((e) => {
    console.error('RAG golden crashed:', e.message);
    process.exit(1);
});
