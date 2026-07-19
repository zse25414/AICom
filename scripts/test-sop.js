/**
 * 活的 SOP 契約測試：文件 → 步驟編譯（heuristic fallback）、contentHash 快取、
 * 卡點事件累計、成員/外人權限。
 * 需 API 已啟動：API_HOST / API_PORT 可覆寫（預設 127.0.0.1:3001）。
 *
 *   npm run test:sop
 */
const http = require('http');

const API_HOST = process.env.API_HOST || '127.0.0.1';
const API_PORT = Number(process.env.API_PORT || 3001);

function request(method, p, body, token) {
    return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : null;
        const req = http.request({
            hostname: API_HOST, port: API_PORT, path: p, method,
            headers: {
                ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
                ...(token ? { Authorization: `Bearer ${token}` } : {})
            }
        }, res => {
            let data = '';
            res.on('data', c => { data += c; });
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

function ok(name, cond, detail) {
    if (!cond) throw new Error(`${name}: ${detail || 'failed'}`);
    console.log(`OK ${name}`);
}

const SOP_CONTENT = [
    '# 新人報帳流程',
    '1. 收集單據：把當月發票整理成 PDF，命名「姓名-月份」。',
    '2. 填寫報帳單：登入 ERP，選「一般報帳」，逐筆填入金額與事由。',
    '3. 送出簽核：確認金額總計無誤後送出，通知直屬主管。',
    '4. 追蹤進度：三個工作天未過簽核，到財務頻道詢問。'
].join('\n');

(async () => {
    const suffix = Date.now().toString().slice(-7);
    const reg = await request('POST', '/api/auth/register', {
        name: 'SOP測試', email: `sop-${suffix}@lumina.test`, role: 'QA', password: 'test1234'
    });
    ok('register', reg.status === 201 && reg.data.token, reg.raw);
    const token = reg.data.token;

    const groupCode = `SP${suffix.slice(-5)}`;
    const create = await request('POST', '/api/enterprise/group/create', {
        code: groupCode, name: 'SOP 團隊', managerName: '主管', managerPin: '847293'
    }, token);
    ok('create group', create.status === 200, create.raw);
    const managerId = create.data.member.id;

    const add = await request('POST', '/api/enterprise/group/document/add', {
        groupCode, managerId, title: '新人報帳流程', content: SOP_CONTENT, docType: 'text'
    }, token);
    const docId = (add.data.document || {}).id;
    ok('add doc', !!docId, add.raw.slice(0, 200));

    // 編譯：CI 無合法 LLM key → heuristic；4 條編號行應成 4 步（含標題行共可 ≥4）
    const plan1 = await request('POST', '/api/enterprise/group/document/plan', {
        groupCode, memberId: managerId, documentId: docId
    }, token);
    ok('compile plan', plan1.status === 200 && plan1.data.ok, plan1.raw.slice(0, 300));
    const steps = plan1.data.plan?.steps || [];
    ok('steps >= 4', steps.length >= 4, `got ${steps.length}`);
    ok('step titles', steps.some(s => s.title.includes('收集單據')), JSON.stringify(steps.map(s => s.title)));
    ok('first compile not cached', plan1.data.cached === false);

    const plan2 = await request('POST', '/api/enterprise/group/document/plan', {
        groupCode, memberId: managerId, documentId: docId
    }, token);
    ok('second compile cached', plan2.status === 200 && plan2.data.cached === true, plan2.raw.slice(0, 200));

    // 事件累計：run ×1、step1 done、step2 stuck ×2
    await request('POST', '/api/enterprise/group/document/sop-event', { groupCode, memberId: managerId, documentId: docId, event: 'run' }, token);
    await request('POST', '/api/enterprise/group/document/sop-event', { groupCode, memberId: managerId, documentId: docId, event: 'done', step: 1 }, token);
    await request('POST', '/api/enterprise/group/document/sop-event', { groupCode, memberId: managerId, documentId: docId, event: 'stuck', step: 2 }, token);
    const evt = await request('POST', '/api/enterprise/group/document/sop-event', { groupCode, memberId: managerId, documentId: docId, event: 'stuck', step: 2 }, token);
    ok('sop-event accepted', evt.status === 200 && evt.data.ok, evt.raw.slice(0, 200));

    const g = await request('GET', `/api/enterprise/group/${groupCode}?memberId=${managerId}`, null, token);
    const doc = (g.data.group?.documents || []).find(d => d.id === docId);
    const stats = doc?.sopStats?.v1;
    ok('stats aggregated', stats && stats.runs === 1 && stats.byStep?.['1']?.done === 1 && stats.byStep?.['2']?.stuck === 2,
        JSON.stringify(doc?.sopStats));
    ok('plan persisted on doc', Array.isArray(doc?.compiledPlan?.steps) && doc.compiledPlan.steps.length >= 4);

    // force：略過快取重編（無 LLM key 時仍走 heuristic，但必須重新產出）
    const forced = await request('POST', '/api/enterprise/group/document/plan', {
        groupCode, memberId: managerId, documentId: docId, force: true
    }, token);
    ok('force bypasses cache', forced.status === 200 && forced.data.cached === false, forced.raw.slice(0, 200));
    ok('forced heuristic not rewritten', forced.data.persisted === undefined || typeof forced.data.persisted === 'boolean',
        forced.raw.slice(0, 200));
    ok('forced plan still valid', (forced.data.plan?.steps || []).length >= 4);

    // 編譯不得覆蓋同時間的其他寫入（plan 走鎖內重載，只改 compiledPlan）
    const concurrentTitle = `並行文件${suffix}`;
    const [, concurrentAdd] = await Promise.all([
        request('POST', '/api/enterprise/group/document/plan', {
            groupCode, memberId: managerId, documentId: docId, force: true
        }, token),
        request('POST', '/api/enterprise/group/document/add', {
            groupCode, managerId, title: concurrentTitle, content: '並行寫入測試內容。', docType: 'text'
        }, token)
    ]);
    ok('concurrent doc add succeeded', concurrentAdd.status === 200 || concurrentAdd.status === 201, concurrentAdd.raw.slice(0, 200));
    const afterConcurrent = await request('GET', `/api/enterprise/group/${groupCode}?memberId=${managerId}`, null, token);
    ok('concurrent write survived plan compile',
        (afterConcurrent.data.group?.documents || []).some(d => d.title === concurrentTitle),
        (afterConcurrent.data.group?.documents || []).map(d => d.title).join(','));

    // 權限：外人（未入群帳號）不可編譯／回報
    const reg2 = await request('POST', '/api/auth/register', {
        name: '外人', email: `sopx-${suffix}@lumina.test`, role: 'QA', password: 'test1234'
    });
    const outsider = await request('POST', '/api/enterprise/group/document/plan', {
        groupCode, memberId: managerId, documentId: docId
    }, reg2.data.token);
    ok('outsider forbidden', outsider.status === 403 || outsider.status === 404, `status=${outsider.status}`);

    // 壞事件驗證
    const bad = await request('POST', '/api/enterprise/group/document/sop-event', {
        groupCode, memberId: managerId, documentId: docId, event: 'hack', step: 1
    }, token);
    ok('bad event 400', bad.status === 400, bad.raw.slice(0, 120));

    // 事件限流（上限 30 / 10 分）— 放最後：會用掉本帳號額度，也佔全域 IP 配額
    let sopRateLimited = false;
    for (let i = 0; i < 34; i++) {
        const r = await request('POST', '/api/enterprise/group/document/sop-event',
            { groupCode, memberId: managerId, documentId: docId, event: 'done', step: 1 }, token);
        if (r.status === 429) { sopRateLimited = true; break; }
    }
    ok('sop-event rate limited', sopRateLimited);

    console.log('\nAll SOP checks passed');
    process.exit(0);
})().catch(err => { console.error('FAIL', err.message); process.exit(1); });
