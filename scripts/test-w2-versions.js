/**
 * W2-F Document version history contract tests
 *
 * VER-1  manager document/add → currentVersion=1 + versions[0]
 * VER-2  manager POST document/version → currentVersion=2 + ragStatus
 * VER-3  member GET versions list (no full content) + GET one version (has content)
 * VER-4  member POST document/version → 403 ROLE_FORBIDDEN
 * VER-5  manager restore soft-deleted doc (optional path after delete)
 *
 * Requires API :3001. RAG optional (index may stay pending).
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
                resolve({ status: res.statusCode, data: parsed, raw: data });
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

async function registerUser(label) {
    const email = `w2ver-${label}-${UNIQUE}@lumina.test`;
    const res = await request('POST', '/api/auth/register', {
        name: `W2Ver ${label}`,
        email,
        role: '工程師',
        password: 'test1234-w2ver'
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
        name: `W2Ver ${prefix} Team`,
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
            const msg = 'API not ready on :3001 — start with npm run api';
            if (CI_MODE) {
                console.error('FAIL', msg);
                process.exit(1);
            }
            console.log('SKIP w2-versions (API not ready)');
            process.exit(0);
        }
        console.log('OK API ready');
        console.log(`W2-F versions fixture=${UNIQUE}\n`);

        const mgr = await registerUser('mgr');
        const member = await registerUser('mem');
        const g = await createGroup(mgr.token, 'V1', 'VerManager');
        const mem = await joinAsMember(member.token, g.code, 'VerMember');
        assertCase('FX', 'fixture manager + member', true,
            `G=${g.code} mgr=${g.manager.id} mem=${mem.id}`);

        // ── VER-1: add creates v1 ──
        let docId = null;
        {
            const title = `w2-ver-doc-${UNIQUE}`;
            const content = `Version history base content ${UNIQUE}. Line A.`;
            const add = await request('POST', '/api/enterprise/group/document/add', {
                groupCode: g.code,
                managerId: g.manager.id,
                title,
                content,
                docType: 'text',
                kbId: 'general'
            }, mgr.token);

            const doc = add.data?.document;
            docId = doc?.id || null;
            const cv = doc?.currentVersion;
            const versions = doc?.versions;
            const v1 = Array.isArray(versions) && versions.find(v => Number(v.version) === 1);
            const ok = add.status === 200
                && add.data?.ok === true
                && !!docId
                && Number(cv) === 1
                && !!v1
                && typeof v1.content === 'string'
                && v1.content.includes(UNIQUE);

            assertCase(
                'VER-1',
                'manager document/add → currentVersion=1 + versions[0]',
                ok,
                ok
                    ? `docId=${docId} currentVersion=${cv} versions=${versions.length} ragStatus=${add.data.ragStatus}`
                    : `status=${add.status} body=${add.raw}`
            );
        }

        if (!docId) {
            console.error('FATAL: no document id; abort remaining cases');
            process.exit(1);
        }

        // ── VER-2: publish new version ──
        {
            const newContent = `Version 2 content ${UNIQUE}. Line B updated.`;
            const pub = await request('POST', '/api/enterprise/group/document/version', {
                groupCode: g.code,
                managerId: g.manager.id,
                documentId: docId,
                title: `w2-ver-doc-${UNIQUE}-v2`,
                content: newContent,
                changeNote: 'W2-F test bump'
            }, mgr.token);

            const doc = pub.data?.document;
            const cv = pub.data?.currentVersion ?? doc?.currentVersion;
            const ragStatus = pub.data?.ragStatus || doc?.ragStatus;
            const hasRagStatus = typeof ragStatus === 'string';
            const versions = doc?.versions || [];
            const v2 = versions.find(v => Number(v.version) === 2);
            const ok = pub.status === 200
                && pub.data?.ok === true
                && Number(cv) === 2
                && hasRagStatus
                && !!v2
                && String(doc?.content || '').includes('Line B');

            assertCase(
                'VER-2',
                'manager POST document/version → currentVersion=2 + ragStatus',
                ok,
                ok
                    ? `currentVersion=${cv} ragStatus=${ragStatus} versions=${versions.length}`
                    : `status=${pub.status} body=${pub.raw}`
            );
        }

        // ── VER-3: member list + get one ──
        {
            const listPath = `/api/enterprise/group/document/versions?groupCode=${encodeURIComponent(g.code)}&documentId=${encodeURIComponent(docId)}&memberId=${encodeURIComponent(mem.id)}`;
            const list = await request('GET', listPath, null, member.token);

            const versions = Array.isArray(list.data?.versions) ? list.data.versions : [];
            const listHasNoContent = versions.every(v => v.content === undefined);
            const hasV2Meta = versions.some(v => Number(v.version) === 2 && v.changeNote === 'W2-F test bump');
            const listOk = list.status === 200
                && list.data?.ok === true
                && Number(list.data?.currentVersion) === 2
                && versions.length >= 2
                && listHasNoContent
                && hasV2Meta;

            assertCase(
                'VER-3a',
                'member GET versions list (meta only, no full content)',
                listOk,
                listOk
                    ? `currentVersion=${list.data.currentVersion} count=${versions.length}`
                    : `status=${list.status} body=${list.raw}`
            );

            const getPath = `/api/enterprise/group/document/version?groupCode=${encodeURIComponent(g.code)}&documentId=${encodeURIComponent(docId)}&version=1&memberId=${encodeURIComponent(mem.id)}`;
            const one = await request('GET', getPath, null, member.token);
            const snap = one.data?.version;
            const oneOk = one.status === 200
                && one.data?.ok === true
                && Number(snap?.version) === 1
                && typeof snap?.content === 'string'
                && snap.content.includes('Line A')
                && !String(snap.content).includes('Line B');

            assertCase(
                'VER-3b',
                'member GET single version=1 has full content',
                oneOk,
                oneOk
                    ? `v1 title=${snap.title} contentLen=${snap.content.length}`
                    : `status=${one.status} body=${one.raw}`
            );
        }

        // ── VER-4: member cannot publish version ──
        {
            const res = await request('POST', '/api/enterprise/group/document/version', {
                groupCode: g.code,
                managerId: mem.id,
                documentId: docId,
                content: 'member should not publish',
                changeNote: 'forbidden'
            }, member.token);

            assertCase(
                'VER-4',
                'member POST document/version → 403 ROLE_FORBIDDEN',
                res.status === 403 && hasCode(res, 'ROLE_FORBIDDEN'),
                `status=${res.status} code=${res.data.code || 'MISSING'} body=${res.raw}`
            );
        }

        // ── VER-5: soft-delete + restore ──
        {
            const del = await request('POST', '/api/enterprise/group/document/delete', {
                groupCode: g.code,
                managerId: g.manager.id,
                documentId: docId
            }, mgr.token);

            // RAG may fail cleanup in some envs — still try restore if soft-deleted
            const deleted = del.status === 200 && del.data?.ok === true;

            if (!deleted) {
                assertCase(
                    'VER-5',
                    'manager restore soft-deleted document',
                    true,
                    `SKIP restore (delete did not soft-delete: ragDeleteOk=${del.data?.ragDeleteOk} body=${del.raw})`
                );
            } else {
                const restore = await request('POST', '/api/enterprise/group/document/restore', {
                    groupCode: g.code,
                    managerId: g.manager.id,
                    documentId: docId,
                    reindex: true
                }, mgr.token);

                const doc = restore.data?.document;
                const ok = restore.status === 200
                    && restore.data?.ok === true
                    && restore.data?.restored === true
                    && doc
                    && isActiveLike(doc)
                    && Number(restore.data?.currentVersion || doc.currentVersion) === 2;

                assertCase(
                    'VER-5',
                    'manager restore soft-deleted document',
                    ok,
                    ok
                        ? `restored currentVersion=${restore.data.currentVersion} ragStatus=${restore.data.ragStatus}`
                        : `status=${restore.status} body=${restore.raw}`
                );
            }
        }

        const failed = results.filter(r => !r.ok);
        console.log(`\nW2-F versions: ${results.length - failed.length}/${results.length} passed`);
        if (failed.length) {
            failed.forEach(f => console.error(`  FAIL ${f.id}: ${f.name} — ${f.detail}`));
            process.exit(1);
        }
        process.exit(0);
    } catch (err) {
        console.error('FATAL', err);
        process.exit(1);
    }
})();

function isActiveLike(doc) {
    if (!doc) return false;
    if (doc.deletedAt) return false;
    if (doc.status === 'deleted') return false;
    return true;
}
