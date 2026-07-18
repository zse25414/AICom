/**
 * Smoke test: multi-group memberships leave/kick APIs.
 * Requires API on :3001.
 *
 *   node scripts/test-enterprise-memberships.js
 */
'use strict';

const BASE = process.env.API_BASE || 'http://127.0.0.1:3001';

async function req(method, path, body, token) {
    const res = await fetch(BASE + path, {
        method,
        headers: {
            ...(body != null ? { 'Content-Type': 'application/json' } : {}),
            ...(token ? { Authorization: 'Bearer ' + token } : {})
        },
        body: body != null ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
}

function assert(cond, msg) {
    if (!cond) throw new Error(msg);
}

async function main() {
    const stamp = Date.now();
    const emailA = `mgr-${stamp}@lumina.test`;
    const emailB = `mem-${stamp}@lumina.test`;
    const code = ('G' + stamp.toString(36)).toUpperCase().slice(0, 10);

    // register manager
    let r = await req('POST', '/api/auth/register', {
        name: 'ManagerA', email: emailA, password: 'test1234', role: '主管'
    });
    assert(r.status === 201 && r.data.token, 'register manager failed: ' + JSON.stringify(r.data));
    const tokenA = r.data.token;

    r = await req('POST', '/api/auth/register', {
        name: 'MemberB', email: emailB, password: 'test1234', role: '成員'
    });
    assert(r.status === 201 && r.data.token, 'register member failed');
    const tokenB = r.data.token;

    // create group
    r = await req('POST', '/api/enterprise/group/create', {
        code, name: 'Multi Group Test', managerName: 'ManagerA', managerPin: '5678'
    }, tokenA);
    assert(r.status === 200 && r.data.ok, 'create group failed: ' + JSON.stringify(r.data));
    const managerId = r.data.member.id;

    // join as member
    r = await req('POST', '/api/enterprise/group/join', {
        code, name: 'MemberB', role: 'member'
    }, tokenB);
    assert(r.status === 200 && r.data.ok, 'join failed: ' + JSON.stringify(r.data));
    const memberId = r.data.member.id;

    // memberships for A and B
    r = await req('GET', '/api/enterprise/memberships', null, tokenA);
    assert(r.status === 200 && Array.isArray(r.data.memberships), 'memberships A failed');
    assert(r.data.memberships.some(m => m.groupCode === code), 'A missing group');

    r = await req('GET', '/api/enterprise/memberships', null, tokenB);
    assert(r.status === 200 && r.data.memberships.some(m => m.groupCode === code), 'B missing group');

    // leave as B
    r = await req('POST', '/api/enterprise/group/leave', {
        groupCode: code, memberId
    }, tokenB);
    assert(r.status === 200 && r.data.ok, 'leave failed: ' + JSON.stringify(r.data));

    r = await req('GET', '/api/enterprise/memberships', null, tokenB);
    assert(!r.data.memberships.some(m => m.groupCode === code), 'B still listed after leave');

    // rejoin B then kick
    r = await req('POST', '/api/enterprise/group/join', {
        code, name: 'MemberB', role: 'member'
    }, tokenB);
    assert(r.status === 200, 'rejoin failed');
    const memberId2 = r.data.member.id;

    r = await req('POST', '/api/enterprise/group/kick', {
        groupCode: code, managerId, targetMemberId: memberId2
    }, tokenA);
    assert(r.status === 200 && r.data.ok, 'kick failed: ' + JSON.stringify(r.data));

    r = await req('GET', '/api/enterprise/memberships', null, tokenB);
    assert(!r.data.memberships.some(m => m.groupCode === code), 'B still listed after kick');

    // sole manager leave with no members should work
    r = await req('POST', '/api/enterprise/group/leave', {
        groupCode: code, memberId: managerId
    }, tokenA);
    assert(r.status === 200 && r.data.ok, 'manager leave empty failed: ' + JSON.stringify(r.data));

    console.log('OK enterprise memberships leave/kick');
    console.log('  group:', code);
}

main().catch((e) => {
    console.error('FAIL', e.message);
    process.exit(1);
});
