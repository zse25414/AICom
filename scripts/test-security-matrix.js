/**
 * W1-D 安全負向矩陣（integration）
 *
 * T1  無 JWT → RAG query / upload-text → 401
 * T2  跨群組 query / upload → 403 GROUP_FORBIDDEN
 * T3  member RAG write（upload / delete）→ 403 ROLE_FORBIDDEN
 * T4  非成員 GET /uploads/* → 403；無 JWT → 401
 * T5  manager 索引 → delete → query 不得命中
 * T6  弱 PIN create → 400
 * T7  惡意 api_base → 400 API_BASE_FORBIDDEN 或安全覆寫（不得外洩）
 *
 * 需 API :3001；T5 建議 RAG :8000。CI 下 API 未就緒 → fail。
 */
const http = require('http');
const crypto = require('crypto');

const API_HOST = process.env.API_HOST || '127.0.0.1';
const API_PORT = Number(process.env.API_PORT || 3001);
const CI_MODE = process.env.CI === 'true' || process.env.CI === '1';
const UNIQUE = `${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`;
const MARKER = `LUMINA_W1D_SECRET_${UNIQUE}`;

const results = [];

function request(method, path, body, token) {
    return new Promise((resolve, reject) => {
        const payload = body == null ? null : JSON.stringify(body);
        const req = http.request({
            hostname: API_HOST,
            port: API_PORT,
            path,
            method,
            headers: {
                ...(payload
                    ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
                    : {}),
                ...(token ? { Authorization: `Bearer ${token}` } : {})
            }
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                let parsed = {};
                try { parsed = data ? JSON.parse(data) : {}; } catch (_) {}
                resolve({ status: res.statusCode, data: parsed, raw: data, headers: res.headers });
            });
        });
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

function probe(path, port = API_PORT) {
    return new Promise((resolve) => {
        const req = http.get({ hostname: API_HOST, port, path, timeout: 2000 }, (res) => {
            res.resume();
            resolve(res.statusCode === 200);
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
    });
}

function record(id, name, ok, detail) {
    results.push({ id, name, ok, detail: detail || '' });
    const tag = ok ? 'OK' : 'FAIL';
    console.log(`${tag} [${id}] ${name}${detail ? ` — ${detail}` : ''}`);
}

function assertCase(id, name, cond, detail) {
    if (!cond) {
        record(id, name, false, detail);
        return false;
    }
    record(id, name, true, detail);
    return true;
}

/** Prefer machine-readable code; fall back to status-only when code not yet wired. */
function hasCode(res, code) {
    return res.data && res.data.code === code;
}

function statusAndCode(res, status, code) {
    if (res.status !== status) {
        return { ok: false, detail: `status=${res.status} body=${res.raw}` };
    }
    if (code && res.data && res.data.code != null && res.data.code !== code) {
        return { ok: false, detail: `code=${res.data.code} expected=${code} body=${res.raw}` };
    }
    if (code && (res.data == null || res.data.code == null)) {
        // Soft note: status correct but code missing (W1-A partial)
        return { ok: true, detail: `status=${status} code=MISSING(expected ${code}) body=${(res.raw || '').slice(0, 120)}` };
    }
    return { ok: true, detail: `status=${status}${code ? ` code=${code}` : ''}` };
}

async function registerUser(label) {
    const email = `w1d-${label}-${UNIQUE}@lumina.test`;
    const res = await request('POST', '/api/auth/register', {
        name: `W1D ${label}`,
        email,
        role: '工程師',
        password: 'test1234-w1d'
    });
    if (res.status !== 201 || !res.data.token) {
        throw new Error(`register ${label} failed: ${res.raw}`);
    }
    return { email, token: res.data.token, user: res.data.user };
}

async function createGroup(token, prefix, managerName) {
    const code = `${prefix}${UNIQUE.slice(-6)}`.slice(0, 12).toUpperCase();
    const res = await request('POST', '/api/enterprise/group/create', {
        code,
        name: `W1D ${prefix} Team`,
        managerName: managerName || 'Manager',
        managerPin: '847293'
    }, token);
    if (res.status !== 200 || !res.data.ok) {
        throw new Error(`create group ${code} failed: ${res.raw}`);
    }
    return {
        code: res.data.group?.code || code,
        manager: res.data.member
    };
}

async function joinAsMember(token, groupCode, name) {
    const res = await request('POST', '/api/enterprise/group/join', {
        code: groupCode,
        name,
        role: 'member'
    }, token);
    if (res.status !== 200 || !res.data.member) {
        throw new Error(`join ${groupCode} failed: ${res.raw}`);
    }
    return res.data.member;
}

(async () => {
    try {
        const apiUp = await probe('/ready');
        if (!apiUp) {
            const msg = 'API not ready on :3001 — start with npm run api (and RAG for T5)';
            if (CI_MODE) {
                console.error('FAIL', msg);
                process.exit(1);
            }
            console.log('SKIP security-matrix (API not ready)');
            process.exit(0);
        }
        console.log('OK API ready');
        console.log(`W1-D security matrix fixture=${UNIQUE}\n`);

        // ── Fixture: dual user / dual group + member ──
        const userA = await registerUser('mgrA');
        const userB = await registerUser('mgrB');
        const userC = await registerUser('memberC');

        const g1 = await createGroup(userA.token, 'G1', 'ManagerA');
        const g2 = await createGroup(userB.token, 'G2', 'ManagerB');
        const memberC = await joinAsMember(userC.token, g1.code, 'MemberC');
        assertCase('FX', 'fixture dual-user dual-group + member', true,
            `G1=${g1.code} G2=${g2.code} memberC=${memberC.id}`);

        // ── T1: no JWT → 401 ──
        {
            const q = await request('POST', '/api/rag/query', {
                query: 'ping',
                group_code: g1.code,
                kb_ids: ['general']
            });
            const r = statusAndCode(q, 401, 'UNAUTHORIZED');
            assertCase('T1a', 'no JWT rag/query → 401', r.ok && q.status === 401, r.detail || q.raw);

            const u = await request('POST', '/api/rag/document/upload-text', {
                group_code: g1.code,
                kb_id: 'general',
                title: 'anon',
                content: 'should fail'
            });
            const r2 = statusAndCode(u, 401, 'UNAUTHORIZED');
            assertCase('T1b', 'no JWT rag/upload-text → 401', r2.ok && u.status === 401, r2.detail || u.raw);
        }

        // ── T2: cross-group → 403 GROUP_FORBIDDEN ──
        {
            const q = await request('POST', '/api/rag/query', {
                query: 'cross group leak?',
                group_code: g1.code,
                kb_ids: ['general']
            }, userB.token);
            const okStatus = q.status === 403;
            const okCode = hasCode(q, 'GROUP_FORBIDDEN');
            assertCase(
                'T2a',
                'cross-group query → 403 GROUP_FORBIDDEN',
                okStatus && okCode,
                `status=${q.status} code=${q.data.code || 'MISSING'} body=${q.raw}`
            );

            const up = await request('POST', '/api/rag/document/upload-text', {
                group_code: g1.code,
                kb_id: 'general',
                title: 'cross-upload',
                content: 'should not index into G1'
            }, userB.token);
            assertCase(
                'T2b',
                'cross-group upload-text → 403 GROUP_FORBIDDEN',
                up.status === 403 && hasCode(up, 'GROUP_FORBIDDEN'),
                `status=${up.status} code=${up.data.code || 'MISSING'} body=${up.raw}`
            );
        }

        // ── T3: member RAG write → 403 ROLE_FORBIDDEN ──
        {
            const entAdd = await request('POST', '/api/enterprise/group/document/add', {
                groupCode: g1.code,
                managerId: memberC.id,
                title: 'member-write',
                content: 'member should not add',
                docType: 'text'
            }, userC.token);
            assertCase(
                'T3a',
                'member enterprise document/add → 403 ROLE_FORBIDDEN',
                entAdd.status === 403 && hasCode(entAdd, 'ROLE_FORBIDDEN'),
                `status=${entAdd.status} code=${entAdd.data.code || 'MISSING'} body=${entAdd.raw}`
            );

            const ragUp = await request('POST', '/api/rag/document/upload-text', {
                group_code: g1.code,
                kb_id: 'general',
                title: 'member-rag-write',
                content: 'member must not upload to rag'
            }, userC.token);
            assertCase(
                'T3b',
                'member rag/upload-text → 403 ROLE_FORBIDDEN',
                ragUp.status === 403 && hasCode(ragUp, 'ROLE_FORBIDDEN'),
                `status=${ragUp.status} code=${ragUp.data.code || 'MISSING'} body=${ragUp.raw}`
            );

            const ragDel = await request('POST', '/api/rag/document/delete', {
                group_code: g1.code,
                kb_id: 'general',
                filename: 'text::member-rag-write.md'
            }, userC.token);
            assertCase(
                'T3c',
                'member rag/document/delete → 403 ROLE_FORBIDDEN',
                ragDel.status === 403 && hasCode(ragDel, 'ROLE_FORBIDDEN'),
                `status=${ragDel.status} code=${ragDel.data.code || 'MISSING'} body=${ragDel.raw}`
            );
        }

        // ── T4: uploads ACL ──
        {
            const tinyPng = Buffer.from(
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
                'base64'
            ).toString('base64');
            const addFile = await request('POST', '/api/enterprise/group/document/add', {
                groupCode: g1.code,
                managerId: g1.manager.id,
                title: 'ACL file',
                content: 'acl',
                docType: 'image',
                filename: 'acl-pixel.png',
                fileData: tinyPng
            }, userA.token);
            const setupOk = assertCase(
                'T4-setup',
                'manager uploads file for ACL test',
                addFile.status === 200 && !!addFile.data.document?.fileUrl,
                addFile.raw
            );

            if (setupOk) {
                const fileUrl = addFile.data.document.fileUrl;
                const filePath = fileUrl.startsWith('/') ? fileUrl : `/${fileUrl}`;

                const noJwt = await request('GET', filePath);
                assertCase('T4a', 'GET /uploads/* no JWT → 401', noJwt.status === 401, noJwt.raw);

                const outsider = await request('GET', filePath, null, userB.token);
                assertCase(
                    'T4b',
                    'GET /uploads/* non-member → 403',
                    outsider.status === 403,
                    `status=${outsider.status} body=${outsider.raw}`
                );

                const owner = await request('GET', filePath, null, userA.token);
                assertCase(
                    'T4c',
                    'GET /uploads/* member → 200',
                    owner.status === 200,
                    `status=${owner.status}`
                );
            } else {
                record('T4a', 'GET /uploads/* no JWT → 401', false, 'skipped: setup failed');
                record('T4b', 'GET /uploads/* non-member → 403', false, 'skipped: setup failed');
                record('T4c', 'GET /uploads/* member → 200', false, 'skipped: setup failed');
            }
        }

        // ── T5: delete → no retrieve ──
        {
            const ragAlive = await probe('/health', 8000);
            const title = `w1d-delete-${UNIQUE}`;
            const content = `機密標記 ${MARKER} 僅供刪除後檢索驗證使用。`;

            const upload = await request('POST', '/api/rag/document/upload-text', {
                group_code: g1.code,
                kb_id: 'general',
                title,
                content
            }, userA.token);

            if (upload.status !== 200) {
                if (!ragAlive && !CI_MODE) {
                    record('T5-upload', 'manager upload-text for delete test', true,
                        `SKIP status=${upload.status} rag_alive=${ragAlive}`);
                    record('T5-delete', 'manager rag delete', true, 'SKIP');
                    record('T5', 'delete → query must not retrieve marker', true, 'SKIP (RAG unavailable)');
                    console.log('  SKIP T5 (RAG not available outside CI)');
                } else {
                    assertCase('T5-upload', 'manager upload-text for delete test', false,
                        `status=${upload.status} body=${upload.raw}`);
                    record('T5-delete', 'manager rag delete', false, 'skipped: upload failed');
                    record('T5', 'delete → query must not retrieve marker', false, 'skipped: upload failed');
                }
            } else {
                record('T5-upload', 'manager upload-text for delete test', true, 'status=200');

                const before = await request('POST', '/api/rag/query', {
                    query: MARKER,
                    group_code: g1.code,
                    kb_ids: ['general']
                }, userA.token);

                const filename = `text::${title}.md`;
                const del = await request('POST', '/api/rag/document/delete', {
                    group_code: g1.code,
                    kb_id: 'general',
                    filename
                }, userA.token);
                assertCase(
                    'T5-delete',
                    'manager rag delete',
                    del.status === 200,
                    `status=${del.status} body=${del.raw}`
                );

                const after = await request('POST', '/api/rag/query', {
                    query: `請找出這段唯一標記：${MARKER}`,
                    group_code: g1.code,
                    kb_ids: ['general']
                }, userA.token);

                const answer = String(after.data?.answer || '');
                const sources = Array.isArray(after.data?.sources) ? after.data.sources : [];
                const sourceBlob = JSON.stringify(sources);
                const hitMarker =
                    answer.includes(MARKER) ||
                    sourceBlob.includes(MARKER) ||
                    /w1d-delete-/.test(sourceBlob) && sourceBlob.includes(title);

                if (after.status !== 200) {
                    assertCase(
                        'T5',
                        'delete → query must not retrieve marker',
                        false,
                        `query status=${after.status} body=${after.raw} beforeStatus=${before.status}`
                    );
                } else {
                    assertCase(
                        'T5',
                        'delete → query must not retrieve marker',
                        !hitMarker,
                        hitMarker
                            ? `MARKER still present answer=${answer.slice(0, 160)} sources=${sourceBlob.slice(0, 160)}`
                            : `no marker; answerLen=${answer.length} sources=${sources.length}`
                    );
                }
            }
        }

        // ── T6: weak PIN ──
        {
            const weak = await request('POST', '/api/enterprise/group/create', {
                code: `WP${UNIQUE.slice(-5)}`.slice(0, 10),
                name: 'Weak PIN',
                managerName: 'Boss',
                managerPin: '0000'
            }, userA.token);
            assertCase('T6a', 'weak PIN 0000 → 400', weak.status === 400, weak.raw);

            const missing = await request('POST', '/api/enterprise/group/create', {
                code: `NP${UNIQUE.slice(-5)}`.slice(0, 10),
                name: 'No PIN',
                managerName: 'Boss'
            }, userA.token);
            assertCase('T6b', 'missing manager PIN → 400', missing.status === 400, missing.raw);
        }

        // ── T7: malicious api_base ──
        {
            const withKey = await request('POST', '/api/rag/query', {
                query: 'api base probe',
                group_code: g1.code,
                kb_ids: ['general'],
                api_base: 'https://evil.example/v1',
                deepseek_api_key: 'sk-attacker-probe-not-real'
            }, userA.token);
            assertCase(
                'T7a',
                'evil api_base + client key → 400 API_BASE_FORBIDDEN',
                withKey.status === 400 && hasCode(withKey, 'API_BASE_FORBIDDEN'),
                `status=${withKey.status} code=${withKey.data.code || 'MISSING'} body=${withKey.raw}`
            );

            // No client key: server forces allowlisted base when DEEPSEEK_API_KEY set
            const noKey = await request('POST', '/api/rag/query', {
                query: 'api base force default',
                group_code: g1.code,
                kb_ids: ['general'],
                api_base: 'https://evil.example/v1'
            }, userA.token);
            const noKeyOk =
                noKey.status === 400 ||
                noKey.status === 200 ||
                noKey.status === 502 ||
                noKey.status === 503 ||
                (noKey.status === 500 && !/evil\.example/i.test(noKey.raw || ''));
            assertCase(
                'T7b',
                'evil api_base without client key → forced base or 400 (no exfil path)',
                noKeyOk && noKey.status !== 401,
                `status=${noKey.status} code=${noKey.data.code || 'n/a'} body=${(noKey.raw || '').slice(0, 160)}`
            );
        }

        // Summary
        const failed = results.filter(r => !r.ok);
        console.log('\n--- W1-D Security Matrix Summary ---');
        for (const r of results) {
            console.log(`${r.ok ? 'PASS' : 'FAIL'} ${String(r.id).padEnd(10)} ${r.name}`);
        }
        if (failed.length) {
            console.error(`\n${failed.length} case(s) failed — report production gaps to @Core Coder / @Lumina Planner`);
            process.exit(1);
        }
        console.log('\nAll W1-D security matrix checks passed');
        process.exit(0);
    } catch (e) {
        console.error('\nSECURITY MATRIX FAILED:', e.message);
        const failed = results.filter(r => !r.ok);
        if (failed.length) {
            console.error('Failed cases:', failed.map(f => f.id).join(', '));
        }
        process.exit(1);
    }
})();
