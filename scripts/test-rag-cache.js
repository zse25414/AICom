/**
 * test-rag-cache — RAG 索引/BM25 快取失效 E2E（P5 RAG 優化）
 * 上傳 → 查到 v1 → 覆蓋同檔 → 查到 v2（非舊快取）→ 刪除 → 查不到。
 * 前置：RAG 服務已在 :8000 運行（npm run rag）。RAG_API_KEY 環境下自帶 header。
 */
const http = require('http');
const RAG_API_KEY = (process.env.RAG_API_KEY || '').trim();

function post(path, body) {
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(body);
        const req = http.request({
            hostname: '127.0.0.1', port: 8000, path, method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...(RAG_API_KEY ? { 'X-RAG-API-Key': RAG_API_KEY } : {}) }
        }, res => {
            let b = '';
            res.on('data', c => b += c);
            res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(b || '{}') }));
        });
        req.on('error', reject);
        req.write(data); req.end();
    });
}

let failures = 0;
function check(name, cond, detail) {
    if (cond) console.log(`OK ${name}`);
    else { failures++; console.error(`FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

(async () => {
    const G = 'CACHETEST01';
    const FILE = 'cache-test.md';

    // v1
    let r = await post('/api/rag/document/upload-text', {
        group_code: G, kb_id: 'general', title: '快取測試',
        content: '通關密語是 ALPHA-7788。', filename: FILE
    });
    check('v1 上傳成功', r.status === 200, JSON.stringify(r.json).slice(0, 100));

    r = await post('/api/rag/query', { group_code: G, query: '通關密語是什麼' });
    const hitV1 = JSON.stringify(r.json).includes('ALPHA-7788');
    check('查詢命中 v1 內容', hitV1);

    // v2 覆蓋同一檔名（upsert 路徑 → 快取需失效/刷新）
    r = await post('/api/rag/document/upload-text', {
        group_code: G, kb_id: 'general', title: '快取測試',
        content: '通關密語是 BRAVO-9911。', filename: FILE
    });
    check('v2 覆蓋上傳成功', r.status === 200);

    r = await post('/api/rag/query', { group_code: G, query: '通關密語是什麼' });
    const s = JSON.stringify(r.json);
    check('查詢反映 v2（不是舊快取）', s.includes('BRAVO-9911') && !s.includes('ALPHA-7788'), s.slice(0, 200));

    // 刪除 → 查不到（delete 端點吃 form-urlencoded）
    r = await new Promise((resolve, reject) => {
        const data = `group_code=${G}&kb_id=general&filename=${encodeURIComponent(FILE)}`;
        const req = http.request({
            hostname: '127.0.0.1', port: 8000, path: '/api/rag/document/delete', method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(data), ...(RAG_API_KEY ? { 'X-RAG-API-Key': RAG_API_KEY } : {}) }
        }, res => {
            let b = '';
            res.on('data', c => b += c);
            res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(b || '{}') }));
        });
        req.on('error', reject);
        req.write(data); req.end();
    });
    check('刪除成功', r.status === 200);

    r = await post('/api/rag/query', { group_code: G, query: '通關密語是什麼' });
    const gone = !JSON.stringify(r.json).includes('BRAVO-9911');
    check('刪除後查不到（快取已失效）', gone, JSON.stringify(r.json).slice(0, 200));

    // 整庫刪除清理
    r = await post('/api/rag/kb/delete', { group_code: G, kb_id: 'general' });
    check('清理測試 KB', r.status === 200 || r.status === 404);

    console.log('────────');
    if (failures) { console.error(`cache invalidation failed: ${failures}`); process.exit(1); }
    console.log('cache invalidation passed');
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
