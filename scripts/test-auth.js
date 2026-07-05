/**
 * 認證 API 整合測試
 */
const http = require('http');

const API_HOST = process.env.API_HOST || '127.0.0.1';
const API_PORT = Number(process.env.API_PORT || 3001);

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
                resolve({ status: res.statusCode, data: parsed, raw: data });
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

(async () => {
    try {
        const email = `auth-${Date.now()}@lumina.test`;
        const register = await request('POST', '/api/auth/register', {
            name: 'Auth Test',
            email,
            role: '工程師',
            password: 'secure-pass-1'
        });
        assert('register', register.status === 201 && register.data.token, register.raw);
        const token = register.data.token;

        const me = await request('GET', '/api/auth/me', null, token);
        assert('me', me.status === 200 && me.data.user?.email === email, me.raw);

        const dup = await request('POST', '/api/auth/register', {
            name: 'Dup',
            email,
            role: '工程師',
            password: 'secure-pass-1'
        });
        assert('duplicate register -> 409', dup.status === 409, dup.raw);

        const badLogin = await request('POST', '/api/auth/login', {
            email,
            password: 'wrong-password'
        });
        assert('bad login -> 401', badLogin.status === 401, badLogin.raw);

        const goodLogin = await request('POST', '/api/auth/login', {
            email,
            password: 'secure-pass-1'
        });
        assert('login', goodLogin.status === 200 && goodLogin.data.token, goodLogin.raw);

        console.log('All auth tests passed');
        process.exit(0);
    } catch (e) {
        console.error('AUTH TEST FAILED:', e.message);
        process.exit(1);
    }
})();