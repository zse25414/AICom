/**
 * W2-E KB / document sync security & contract matrix
 *
 * KB-1  manager POST /api/rag/kb → GET list sees items.displayName
 * KB-2  member POST /api/rag/kb → 403 ROLE_FORBIDDEN
 * KB-3  cross-group list / create → 403 GROUP_FORBIDDEN
 * KB-4  no JWT → 401
 * KB-5  manager soft-delete non-general → list no longer includes it
 * KB-6  cannot delete general → 400 KB_PROTECTED
 * DOC-1 manager document/add text → response has ragStatus (+ ragOk preferred)
 * DOC-2 member reindex → 403 ROLE_FORBIDDEN
 * DOC-3 manager reindex → 200 or explainable error (RAG optional)
 *
 * Requires API :3001. RAG :8000 optional (document index may stay pending).
 * CI=true + API not ready → fail; local → skip.
 */
const http = require('http');
const crypto = require('crypto');

const API_HOST = process.env.API_HOST || '127.0.0.1';
const API_PORT = Number(process.env.API_PORT || 3001);
const CI_MODE = process.env.CI === 'true' || process.env.CI === '1';
const UNIQUE = `${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`;

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

function hasCode(res, code) {
    return res.data && res.data.code === code;
}

function listItems(listRes) {
    if (Array.isArray(listRes?.data?.items)) return listRes.data.items;
    return [];
}

function findKbItem(listRes, kbId) {
    return listItems(listRes).find(i => i && i.id === kbId) || null;
}

async function registerUser(label) {
    const email = `w2kb-${label}-${UNIQUE}@lumina.test`;
    const res = await request('POST', '/api/auth/register', {
        name: `W2KB ${label}`,
        email,
        role: '工程師',
        password: 'test1234-w2kb'
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
        name: `W2KB ${prefix} Team`,
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
            const msg = 'API not ready on :3001 — start with npm run api (RAG optional for DOC-1/DOC-3)';
            if (CI_MODE) {
                console.error('FAIL', msg);
                process.exit(1);
            }
            console.log('SKIP w2-kb-sync (API not ready)');
            process.exit(0);
        }
        console.log('OK API ready');
        console.log(`W2-E KB sync fixture=${UNIQUE}\n`);

        // ── Fixture: dual user / dual group + member ──
        const userA = await registerUser('mgrA');
        const userB = await registerUser('mgrB');
        const userC = await registerUser('memberC');

        const g1 = await createGroup(userA.token, 'K1', 'ManagerA');
        const g2 = await createGroup(userB.token, 'K2', 'ManagerB');
        const memberC = await joinAsMember(userC.token, g1.code, 'MemberC');
        assertCase('FX', 'fixture dual-user dual-group + member', true,
            `G1=${g1.code} G2=${g2.code} memberC=${memberC.id}`);

        const kbId = `specs-${UNIQUE.slice(-6)}`.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 30);
        const kbDisplayName = `W2 Specs ${UNIQUE.slice(-4)}`;

        // ── KB-1: manager create + list displayName ──
        {
            const create = await request('POST', '/api/rag/kb', {
                group_code: g1.code,
                id: kbId,
                displayName: kbDisplayName,
                description: 'W2-E contract test KB'
            }, userA.token);

            const createOk = create.status === 200
                && create.data?.ok === true
                && create.data?.knowledgeBase?.id === kbId
                && create.data?.knowledgeBase?.displayName === kbDisplayName;
            assertCase(
                'KB-1a',
                'manager POST /api/rag/kb create',
                createOk,
                `status=${create.status} body=${create.raw}`
            );

            const list = await request(
                'GET',
                `/api/rag/kb?group_code=${encodeURIComponent(g1.code)}`,
                null,
                userA.token
            );
            const item = findKbItem(list, kbId);
            const listAlias = await request(
                'GET',
                `/api/rag/kb/list?group_code=${encodeURIComponent(g1.code)}`,
                null,
                userA.token
            );
            const itemAlias = findKbItem(listAlias, kbId);
            const listOk = list.status === 200
                && Array.isArray(list.data?.items)
                && Array.isArray(list.data?.kb_ids)
                && list.data.kb_ids.includes(kbId)
                && item
                && item.displayName === kbDisplayName;
            assertCase(
                'KB-1b',
                'manager GET /api/rag/kb list sees items.displayName',
                listOk,
                listOk
                    ? `kbId=${kbId} displayName=${item.displayName} items=${list.data.items.length}`
                    : `status=${list.status} body=${list.raw}`
            );
            assertCase(
                'KB-1c',
                'GET /api/rag/kb/list alias also includes KB',
                listAlias.status === 200 && !!itemAlias && itemAlias.displayName === kbDisplayName,
                `status=${listAlias.status} found=${!!itemAlias}`
            );
        }

        // ── KB-2: member create → 403 ROLE_FORBIDDEN ──
        {
            const res = await request('POST', '/api/rag/kb', {
                group_code: g1.code,
                id: `member-${UNIQUE.slice(-5)}`.toLowerCase(),
                displayName: 'Member should not create'
            }, userC.token);
            assertCase(
                'KB-2',
                'member POST /api/rag/kb → 403 ROLE_FORBIDDEN',
                res.status === 403 && hasCode(res, 'ROLE_FORBIDDEN'),
                `status=${res.status} code=${res.data.code || 'MISSING'} body=${res.raw}`
            );
        }

        // ── KB-3: cross-group list / create → GROUP_FORBIDDEN ──
        {
            const list = await request(
                'GET',
                `/api/rag/kb/list?group_code=${encodeURIComponent(g1.code)}`,
                null,
                userB.token
            );
            assertCase(
                'KB-3a',
                'cross-group GET kb list → 403 GROUP_FORBIDDEN',
                list.status === 403 && hasCode(list, 'GROUP_FORBIDDEN'),
                `status=${list.status} code=${list.data.code || 'MISSING'} body=${list.raw}`
            );

            const create = await request('POST', '/api/rag/kb', {
                group_code: g1.code,
                id: `xgroup-${UNIQUE.slice(-5)}`.toLowerCase(),
                displayName: 'Cross group create'
            }, userB.token);
            assertCase(
                'KB-3b',
                'cross-group POST /api/rag/kb → 403 GROUP_FORBIDDEN',
                create.status === 403 && hasCode(create, 'GROUP_FORBIDDEN'),
                `status=${create.status} code=${create.data.code || 'MISSING'} body=${create.raw}`
            );
        }

        // ── KB-4: no JWT → 401 ──
        {
            const list = await request(
                'GET',
                `/api/rag/kb?group_code=${encodeURIComponent(g1.code)}`
            );
            assertCase(
                'KB-4a',
                'no JWT GET /api/rag/kb → 401',
                list.status === 401,
                `status=${list.status} code=${list.data.code || 'n/a'} body=${list.raw}`
            );

            const create = await request('POST', '/api/rag/kb', {
                group_code: g1.code,
                id: `anon-${UNIQUE.slice(-5)}`.toLowerCase(),
                displayName: 'Anon create'
            });
            assertCase(
                'KB-4b',
                'no JWT POST /api/rag/kb → 401',
                create.status === 401,
                `status=${create.status} code=${create.data.code || 'n/a'} body=${create.raw}`
            );

            const del = await request('POST', '/api/rag/kb/delete', {
                group_code: g1.code,
                kb_id: kbId
            });
            assertCase(
                'KB-4c',
                'no JWT POST /api/rag/kb/delete → 401',
                del.status === 401,
                `status=${del.status} code=${del.data.code || 'n/a'} body=${del.raw}`
            );
        }

        // ── KB-6 before KB-5: cannot delete general ──
        {
            const delGeneral = await request('POST', '/api/rag/kb/delete', {
                group_code: g1.code,
                kb_id: 'general'
            }, userA.token);
            assertCase(
                'KB-6',
                'manager cannot delete general → 400 KB_PROTECTED',
                delGeneral.status === 400 && hasCode(delGeneral, 'KB_PROTECTED'),
                `status=${delGeneral.status} code=${delGeneral.data.code || 'MISSING'} body=${delGeneral.raw}`
            );
        }

        // ── KB-5: soft-delete non-general → gone from list ──
        {
            const del = await request('POST', '/api/rag/kb/delete', {
                group_code: g1.code,
                kb_id: kbId
            }, userA.token);
            const delOk = del.status === 200 && del.data?.ok === true && del.data?.kb_id === kbId;
            assertCase(
                'KB-5a',
                'manager soft-delete non-general KB',
                delOk,
                `status=${del.status} body=${del.raw}`
            );

            const list = await request(
                'GET',
                `/api/rag/kb/list?group_code=${encodeURIComponent(g1.code)}`,
                null,
                userA.token
            );
            const stillThere = findKbItem(list, kbId);
            const ids = Array.isArray(list.data?.kb_ids) ? list.data.kb_ids : [];
            assertCase(
                'KB-5b',
                'deleted KB no longer appears in list',
                list.status === 200 && !stillThere && !ids.includes(kbId),
                stillThere
                    ? `still present: ${JSON.stringify(stillThere)}`
                    : `status=${list.status} kb_ids=${JSON.stringify(ids)}`
            );

            // general must still be present after soft-delete of other KB
            assertCase(
                'KB-5c',
                'general still present after soft-delete of other KB',
                list.status === 200 && ids.includes('general'),
                `kb_ids=${JSON.stringify(ids)}`
            );
        }

        // ── DOC-1: manager document/add → ragStatus field ──
        let createdDocId = null;
        {
            const title = `w2-kb-doc-${UNIQUE}`;
            const content = `W2-C server sync fixture document ${UNIQUE}. Knowledge base indexing status contract.`;
            const add = await request('POST', '/api/enterprise/group/document/add', {
                groupCode: g1.code,
                managerId: g1.manager.id,
                title,
                content,
                docType: 'text',
                kbId: 'general'
            }, userA.token);

            const hasRagStatus = typeof add.data?.ragStatus === 'string'
                || typeof add.data?.document?.ragStatus === 'string';
            const ragStatus = add.data?.ragStatus || add.data?.document?.ragStatus;
            const allowedStatus = ragStatus === 'pending'
                || ragStatus === 'indexed'
                || ragStatus === 'failed';
            // ragOk may be true/false/undefined depending on RAG availability; field preferred when present
            const hasRagOkField = Object.prototype.hasOwnProperty.call(add.data || {}, 'ragOk');
            const addOk = add.status === 200 && add.data?.ok === true && hasRagStatus && allowedStatus;

            assertCase(
                'DOC-1a',
                'manager document/add text → 200 with ragStatus',
                addOk,
                addOk
                    ? `ragStatus=${ragStatus} ragOk=${add.data.ragOk} ragPending=${add.data.ragPending} docId=${add.data.document?.id}`
                    : `status=${add.status} body=${add.raw}`
            );
            assertCase(
                'DOC-1b',
                'document/add response exposes ragOk field',
                add.status === 200 && hasRagOkField,
                hasRagOkField
                    ? `ragOk=${add.data.ragOk}`
                    : `missing ragOk; keys=${Object.keys(add.data || {}).join(',')}`
            );

            if (add.status === 200 && add.data?.document?.id) {
                createdDocId = add.data.document.id;
            }
        }

        // ── DOC-2: member reindex → 403 ROLE_FORBIDDEN ──
        {
            const res = await request('POST', '/api/enterprise/group/document/reindex', {
                groupCode: g1.code,
                managerId: memberC.id,
                documentId: createdDocId || 'missing-doc-id'
            }, userC.token);
            assertCase(
                'DOC-2',
                'member document/reindex → 403 ROLE_FORBIDDEN',
                res.status === 403 && hasCode(res, 'ROLE_FORBIDDEN'),
                `status=${res.status} code=${res.data.code || 'MISSING'} body=${res.raw}`
            );
        }

        // ── DOC-3: manager reindex → 200 or explainable error ──
        {
            if (!createdDocId) {
                record('DOC-3', 'manager document/reindex', false, 'skipped: DOC-1 did not create document');
            } else {
                const res = await request('POST', '/api/enterprise/group/document/reindex', {
                    groupCode: g1.code,
                    managerId: g1.manager.id,
                    documentId: createdDocId
                }, userA.token);

                // Happy path: 200 with ragStatus
                // Explainable: 502/503 when RAG down but proxy still returns structured body;
                // or 200 with ragStatus pending/failed (RAG optional).
                const statusOk = res.status === 200
                    || res.status === 502
                    || res.status === 503
                    || res.status === 504;
                const hasStatusField = typeof res.data?.ragStatus === 'string'
                    || typeof res.data?.document?.ragStatus === 'string'
                    || typeof res.data?.error === 'string'
                    || typeof res.data?.code === 'string';
                // Must not be auth/rbac failure for manager of own group
                const notAuthFail = res.status !== 401 && res.status !== 403;

                assertCase(
                    'DOC-3',
                    'manager reindex → 200 or explainable error (RAG optional)',
                    statusOk && notAuthFail && hasStatusField,
                    `status=${res.status} ragStatus=${res.data?.ragStatus || res.data?.document?.ragStatus || 'n/a'} body=${(res.raw || '').slice(0, 200)}`
                );
            }
        }

        // Summary
        const failed = results.filter(r => !r.ok);
        console.log('\n--- W2-E KB Sync Security/Contract Summary ---');
        for (const r of results) {
            console.log(`${r.ok ? 'PASS' : 'FAIL'} ${String(r.id).padEnd(8)} ${r.name}`);
        }
        if (failed.length) {
            console.error(`\n${failed.length} case(s) failed — report production gaps to @Core Coder / @Lumina Planner`);
            process.exit(1);
        }
        console.log('\nAll W2-E KB sync checks passed');
        process.exit(0);
    } catch (e) {
        console.error('\nW2-E KB SYNC FAILED:', e.message);
        const failed = results.filter(r => !r.ok);
        if (failed.length) {
            console.error('Failed cases:', failed.map(f => f.id).join(', '));
        }
        process.exit(1);
    }
})();
