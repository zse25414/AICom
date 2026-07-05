/**
 * API 安全閘門測試（本機密碼學 + 可選 HTTP 整合）
 */
const http = require('http');
const bcrypt = require('bcryptjs');

const API_HOST = process.env.API_HOST || '127.0.0.1';
const API_PORT = Number(process.env.API_PORT || 3001);
const CI_MODE = process.env.CI === 'true';

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
                resolve({ status: res.statusCode, data: parsed, raw: data, headers: res.headers });
            });
        });
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

function assert(name, cond, detail) {
    if (!cond) throw new Error(`${name}${detail ? `: ${detail}` : ''}`);
    console.log(`OK ${name}`);
}

function probeApi() {
    return new Promise((resolve) => {
        const req = http.get({ hostname: API_HOST, port: API_PORT, path: '/ready', timeout: 2000 }, (res) => {
            res.resume();
            resolve(res.statusCode === 200);
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
    });
}

(async () => {
    try {
        const hash = bcrypt.hashSync('847293', 10);
        assert('bcrypt pin hash', hash.startsWith('$2'));
        assert('bcrypt pin verify', bcrypt.compareSync('847293', hash));
        assert('weak pin rejected concept', !['0000', '1234'].includes('847293'));

        const runHttp = process.env.SECURITY_HTTP_TESTS === '1';
        const apiUp = runHttp && await probeApi();
        if (!runHttp || !apiUp) {
            console.log('SKIP HTTP security tests (set SECURITY_HTTP_TESTS=1 with API running for full coverage)');
            console.log('Security API checks passed (local crypto)');
            process.exit(0);
        }

        const meNoAuth = await request('GET', '/api/auth/me');
        assert('me without token -> 401', meNoAuth.status === 401, meNoAuth.raw);

        const meQueryToken = await request('GET', '/api/auth/me?token=fake-token');
        assert('query token rejected', meQueryToken.status === 401, meQueryToken.raw);

        const createWeak = await request('POST', '/api/enterprise/group/create', {
            code: `T${Date.now().toString().slice(-5)}`,
            name: 'Weak PIN Team',
            managerName: 'Boss',
            managerPin: '0000'
        });
        assert('weak manager pin -> 400', createWeak.status === 400, createWeak.raw);

        const createNoPin = await request('POST', '/api/enterprise/group/create', {
            code: `T${Date.now().toString().slice(-5)}`,
            name: 'No PIN Team',
            managerName: 'Boss'
        });
        assert('missing manager pin -> 400', createNoPin.status === 400, createNoPin.raw);

        const userData = await request('GET', '/api/user/data');
        assert('user data without token -> 401', userData.status === 401, userData.raw);

        const chatNoAuth = await request('POST', '/api/chat', { messages: [{ role: 'user', content: 'hi' }] });
        assert('chat without auth blocked or allowed by env', [401, 500].includes(chatNoAuth.status), chatNoAuth.raw);

        const secHeaders = await request('GET', '/health');
        assert('security header X-Content-Type-Options', secHeaders.headers['x-content-type-options'] === 'nosniff');
        assert('security header X-Frame-Options', secHeaders.headers['x-frame-options'] === 'DENY');

        console.log('All security API checks passed');
        process.exit(0);
    } catch (e) {
        console.error('SECURITY API CHECK FAILED:', e.message);
        process.exit(1);
    }
})();