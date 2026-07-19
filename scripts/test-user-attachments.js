/**
 * 個人附件上雲 + coachThread 同步 契約測試。
 * 需 API 已啟動：API_HOST / API_PORT 可覆寫（預設 127.0.0.1:3001）。
 *
 *   npm run test:attachments
 */
const http = require('http');
const pathMod = require('path');

const API_HOST = process.env.API_HOST || '127.0.0.1';
const API_PORT = Number(process.env.API_PORT || 3001);

function request(method, p, body, token, raw) {
    return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : null;
        const req = http.request({
            hostname: API_HOST, port: API_PORT, path: p, method,
            headers: {
                ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
                ...(token ? { Authorization: `Bearer ${token}` } : {})
            }
        }, res => {
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                const buf = Buffer.concat(chunks);
                if (raw) return resolve({ status: res.statusCode, buf });
                let parsed = {};
                try { parsed = JSON.parse(buf.toString('utf8') || '{}'); } catch (_) {}
                resolve({ status: res.statusCode, data: parsed, raw: buf.toString('utf8') });
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

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function registerUser(tag, suffix) {
    const r = await request('POST', '/api/auth/register', {
        name: tag, email: `${tag}-${suffix}@lumina.test`, role: 'QA', password: 'test1234'
    });
    if (r.status !== 201 || !r.data.token) throw new Error(`register ${tag} failed: ${r.raw}`);
    return r.data.token;
}

(async () => {
    const suffix = Date.now().toString().slice(-7);
    const tokenA = await registerUser('uatt-a', suffix);
    const tokenB = await registerUser('uatt-b', suffix);

    // 上傳 + ACL：本人 200、他人 403、匿名 401
    const up = await request('POST', '/api/user/attachment', {
        filename: 'note.png', mime: 'image/png', data_base64: PNG_B64
    }, tokenA);
    ok('upload', up.status === 200 && up.data.fileUrl?.startsWith('/uploads/user-'), up.raw);
    const fileUrl = up.data.fileUrl;
    ok('owner 200', (await request('GET', fileUrl, null, tokenA, true)).status === 200);
    ok('other user 403', (await request('GET', fileUrl, null, tokenB, true)).status === 403);
    ok('anonymous 401', (await request('GET', fileUrl, null, null, true)).status === 401);

    // 類型驗證：壞副檔名、magic byte 不符
    const badExt = await request('POST', '/api/user/attachment', {
        filename: 'evil.exe', mime: 'application/x-msdownload', data_base64: PNG_B64
    }, tokenA);
    ok('bad ext 400', badExt.status === 400, badExt.raw);
    const badMagic = await request('POST', '/api/user/attachment', {
        filename: 'fake.pdf', mime: 'application/pdf', data_base64: PNG_B64
    }, tokenA);
    ok('magic mismatch 400', badMagic.status === 400, badMagic.raw);

    // coachThread 同步：dataUrl 剝除、fileUrl 保留
    const t1 = Date.now();
    await request('PATCH', '/api/user/data', {
        tasks: [{
            id: 1, name: '附件任務', duration: 30, energy: 3, category: 'execution',
            due: '2026-07-19', completed: false, updatedAt: new Date().toISOString(),
            attachments: [{ id: 'att1', name: 'note.png', mime: 'image/png', size: 68, kind: 'image', fileUrl, dataUrl: 'data:image/png;base64,' + PNG_B64 }]
        }],
        coachThread: {
            v: 1, freeform: true, savedAt: t1,
            messages: [{ role: 'user', content: '跨裝置對話', ts: t1, attachments: [{ id: 'att1', name: 'note.png', mime: 'image/png', size: 68, kind: 'image', fileUrl }] }]
        },
        updatedAt: new Date().toISOString()
    }, tokenA);
    const g1 = (await request('GET', '/api/user/data', null, tokenA)).data.data;
    ok('thread persisted', g1.coachThread?.messages?.[0]?.content === '跨裝置對話', JSON.stringify(g1.coachThread).slice(0, 160));
    const att = g1.tasks?.[0]?.attachments?.[0];
    ok('attachment no dataUrl, fileUrl kept', att && att.fileUrl === fileUrl && att.dataUrl === undefined, JSON.stringify(att));

    // tombstone：較新 cleared 蓋掉；較舊 thread 不能復活
    await request('PATCH', '/api/user/data', {
        coachThread: { v: 1, cleared: true, savedAt: t1 + 5000 },
        updatedAt: new Date(Date.now() + 1000).toISOString()
    }, tokenA);
    await request('PATCH', '/api/user/data', {
        coachThread: { v: 1, freeform: true, savedAt: t1, messages: [{ role: 'user', content: '舊對話', ts: t1 }] },
        updatedAt: new Date(Date.now() + 2000).toISOString()
    }, tokenA);
    const g2 = (await request('GET', '/api/user/data', null, tokenA)).data.data;
    ok('tombstone wins, no resurrect', g2.coachThread?.cleared === true, JSON.stringify(g2.coachThread));

    // 限流：獨立帳號連打到 429（上限 20 / 10 分鐘）
    const tokenC = await registerUser('uatt-c', suffix);
    let got429 = false;
    for (let i = 0; i < 22; i++) {
        const r = await request('POST', '/api/user/attachment', {
            filename: `spam${i}.png`, mime: 'image/png', data_base64: PNG_B64
        }, tokenC);
        if (r.status === 429) { got429 = true; break; }
    }
    ok('per-user rate limit 429', got429);

    // GC：未被引用的 user-* 檔（graceMs=0）會被清；被引用的保留
    // 直接載入 domain（與 file 模式伺服器共用 user-data.json / uploads）
    const domain = require(pathMod.join(__dirname, '..', 'server', 'domain'));
    const orphan = await request('POST', '/api/user/attachment', {
        filename: 'orphan.png', mime: 'image/png', data_base64: PNG_B64
    }, tokenB);
    ok('orphan upload', orphan.status === 200, orphan.raw);
    const orphanName = orphan.data.fileUrl.split('/').pop();
    const keptName = fileUrl.split('/').pop();
    const gc = await domain.runUserAttachmentGc({ graceMs: 0 });
    ok('gc removes orphan', gc.removed.includes(orphanName), JSON.stringify(gc.removed.slice(0, 5)));
    ok('gc keeps referenced', !gc.removed.includes(keptName));
    ok('referenced file still readable', (await request('GET', fileUrl, null, tokenA, true)).status === 200);

    console.log('\nAll user-attachment checks passed');
    process.exit(0);
})().catch(err => { console.error('FAIL', err.message); process.exit(1); });
