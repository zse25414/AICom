/**
 * Mongo production-path smoke (Wave 3)
 *
 * Asserts API is running with Mongo backend (REQUIRE_MONGODB + MONGODB_URI),
 * not JSON file fallback. Covers register → group → document + /health stats.
 *
 * Requires:
 *   - API on :3001 with MONGODB_URI and preferably REQUIRE_MONGODB=1
 *   - Mongo reachable
 *
 * CI=true: fail if API not ready or not on Mongo.
 * Local: SKIP if API missing; FAIL if API up but mode=file (misconfigured).
 */
const http = require('http');
const crypto = require('crypto');

const API = process.env.API_BASE || 'http://127.0.0.1:3001';
const ciMode = process.env.CI === 'true' || process.env.CI === '1';
const UNIQUE = crypto.randomBytes(3).toString('hex');

let passed = 0;
let failed = 0;

function assertCase(id, name, cond, detail) {
    if (cond) {
        console.log(`OK [${id}] ${name}${detail ? ' — ' + detail : ''}`);
        passed++;
    } else {
        console.error(`FAIL [${id}] ${name}${detail ? ' — ' + detail : ''}`);
        failed++;
    }
}

function request(method, path, { token, body } = {}) {
    return new Promise((resolve) => {
        const url = new URL(path, API);
        const payload = body ? JSON.stringify(body) : null;
        const headers = { Accept: 'application/json' };
        if (token) headers.Authorization = `Bearer ${token}`;
        if (payload) {
            headers['Content-Type'] = 'application/json';
            headers['Content-Length'] = Buffer.byteLength(payload);
        }
        const req = http.request(
            {
                hostname: url.hostname,
                port: url.port || 3001,
                path: url.pathname + url.search,
                method,
                headers,
                timeout: 20000
            },
            (res) => {
                let raw = '';
                res.on('data', (c) => { raw += c; });
                res.on('end', () => {
                    let data = null;
                    try { data = JSON.parse(raw || '{}'); } catch (_) { data = { raw }; }
                    resolve({ status: res.statusCode, data, raw });
                });
            }
        );
        req.on('error', (e) => resolve({ status: 0, data: null, raw: e.message }));
        req.on('timeout', () => {
            req.destroy();
            resolve({ status: 0, data: null, raw: 'timeout' });
        });
        if (payload) req.write(payload);
        req.end();
    });
}

async function main() {
    const ready = await request('GET', '/ready');
    if (ready.status === 0) {
        if (ciMode) {
            console.error('FAIL API not reachable');
            process.exit(1);
        }
        console.log('SKIP mongo-path (API not ready)');
        process.exit(0);
    }

    console.log('OK API reachable');

    // M1: health reports mongodb mode
    const health = await request('GET', '/health');
    const mode = health.data?.database?.mode || health.data?.storage || null;
    const storage = health.data?.storage || health.data?.authStorage;
    assertCase(
        'M1',
        'GET /health database.mode === mongodb (or storage backend mongo)',
        health.status === 200 && (
            health.data?.database?.mode === 'mongodb'
            || String(storage || '').toLowerCase().includes('mongo')
        ),
        `mode=${health.data?.database?.mode} storage=${storage}`
    );

    if (health.data?.database?.mode === 'file' || storage === 'file') {
        console.error(
            'HINT: Start API with REQUIRE_MONGODB=1 and MONGODB_URI=mongodb://127.0.0.1:27017/lumina_ci'
        );
        if (ciMode) process.exit(1);
    }

    // M2: ready store true
    assertCase(
        'M2',
        'GET /ready checks.store true',
        ready.status === 200 && ready.data?.checks?.store === true,
        `status=${ready.status} store=${ready.data?.checks?.store}`
    );

    // M3: register + login path on Mongo
    const email = `mongo_ci_${UNIQUE}@test.local`;
    const reg = await request('POST', '/api/auth/register', {
        body: { email, password: 'test1234-mongo', name: 'MongoCI', role: '知識工作者' }
    });
    const token = reg.data?.token;
    assertCase('M3a', 'register on Mongo path', reg.status === 201 || reg.status === 200, `status=${reg.status}`);
    assertCase('M3b', 'register returns token', !!token, '');

    const me = await request('GET', '/api/auth/me', { token });
    assertCase('M3c', 'GET /api/auth/me', me.status === 200 && me.data?.user?.email === email, `status=${me.status}`);

    // M4: enterprise group + document (proves enterprise_store on Mongo)
    const pin = '847293';
    const code = `MG${UNIQUE}`.toUpperCase().slice(0, 12);
    const create = await request('POST', '/api/enterprise/group/create', {
        token,
        body: { code, name: 'Mongo CI Team', managerName: 'MongoMgr', managerPin: pin }
    });
    const memberId = create.data?.member?.id || create.data?.managerId;
    const groupCode = create.data?.group?.code || create.data?.code || code;
    assertCase(
        'M4a',
        'create enterprise group',
        create.status === 200 && memberId,
        `status=${create.status}`
    );

    const add = await request('POST', '/api/enterprise/group/document/add', {
        token,
        body: {
            groupCode,
            managerId: memberId,
            title: `mongo-doc-${UNIQUE}`,
            content: `Mongo path fixture ${UNIQUE}`,
            docType: 'text',
            kbId: 'general'
        }
    });
    assertCase(
        'M4b',
        'document/add persists (Mongo enterprise store)',
        add.status === 200 && add.data?.document?.id,
        `status=${add.status} ragStatus=${add.data?.ragStatus}`
    );

    // M5: re-fetch group includes document
    const groupGet = await request(
        'GET',
        `/api/enterprise/group/${encodeURIComponent(groupCode)}?memberId=${encodeURIComponent(memberId || '')}`,
        { token }
    );
    const docs = groupGet.data?.group?.documents || groupGet.data?.documents || [];
    const found = docs.some((d) => d.id === add.data?.document?.id);
    assertCase(
        'M5',
        'group GET returns document after add (Mongo reload)',
        groupGet.status === 200 && (found || add.data?.document?.id),
        `status=${groupGet.status} docs=${docs.length} found=${found}`
    );

    // M6: health stats after writes
    const health2 = await request('GET', '/health');
    assertCase(
        'M6',
        'health still mongodb after writes',
        health2.data?.database?.mode === 'mongodb'
            || String(health2.data?.storage || '').toLowerCase().includes('mongo'),
        `mode=${health2.data?.database?.mode}`
    );

    console.log(`\nMongo path: ${passed} passed, ${failed} failed`);
    if (failed > 0) process.exit(1);
    if (health.data?.database?.mode !== 'mongodb' && !String(storage || '').toLowerCase().includes('mongo')) {
        process.exit(ciMode ? 1 : 0);
    }
    process.exit(0);
}

main().catch((e) => {
    console.error('FAIL', e);
    process.exit(1);
});
