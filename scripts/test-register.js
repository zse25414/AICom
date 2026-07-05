/**
 * 註冊 API 整合測試（不依賴 MongoDB）
 */
const http = require('http');
const path = require('path');

delete process.env.MONGODB_URI;
process.chdir(path.join(__dirname, '..'));

const { initDb, ensureIndexes } = require('../lib/db');
const { initAuthStore, findUserByEmail, createUser } = require('../lib/auth-store');
const { initUserDataStore, getUserData, saveUserData, defaultUserData } = require('../lib/user-data-store');
const { hashPassword, signToken, sanitizeUser } = require('../lib/auth');

async function runRegisterFlow() {
    await initDb();
    await ensureIndexes();
    await initAuthStore();
    await initUserDataStore();

    const email = `test-${Date.now()}@lumina.test`;
    const passwordHash = await hashPassword('test1234');
    const user = await createUser({
        email,
        name: '測試用戶',
        role: '工程師',
        passwordHash
    });
    await saveUserData(user.id, defaultUserData(user.id));
    const token = signToken({ userId: user.id, email: user.email });
    const data = await getUserData(user.id);

    const found = await findUserByEmail(email);
    if (!found || found.id !== user.id) throw new Error('註冊後找不到使用者');
    if (!data || !Array.isArray(data.tasks)) throw new Error('註冊後未建立 user_data');
    if (!token) throw new Error('JWT 簽發失敗');

    console.log('OK register flow');
    console.log('  user:', sanitizeUser(user).email);
    console.log('  token length:', token.length);
    console.log('  user_data tasks:', data.tasks.length);
    return { email, token };
}

async function runHttpRegister(port) {
    return new Promise((resolve, reject) => {
        const email = `http-${Date.now()}@lumina.test`;
        const body = JSON.stringify({
            name: 'HTTP 測試',
            email,
            role: 'PM',
            password: 'pass1234'
        });
        const req = http.request({
            hostname: '127.0.0.1',
            port,
            path: '/api/auth/register',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        }, res => {
            let data = '';
            res.on('data', c => { data += c; });
            res.on('end', () => {
                if (res.statusCode !== 201) {
                    reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                    return;
                }
                const parsed = JSON.parse(data);
                if (!parsed.ok || !parsed.token || !parsed.user?.id) {
                    reject(new Error('回應格式錯誤: ' + data));
                    return;
                }
                console.log('OK HTTP register');
                console.log('  status:', res.statusCode);
                console.log('  user:', parsed.user.email);
                resolve(parsed);
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

(async () => {
    try {
        await runRegisterFlow();
        const ciMode = process.env.CI === 'true' || process.env.CI === '1';
        const apiPort = Number(process.env.API_PORT || 3001);
        try {
            await runHttpRegister(apiPort);
        } catch (e) {
            if (e.message.includes('ECONNREFUSED')) {
                if (ciMode) {
                    throw new Error('CI 模式下 api-proxy 必須在背景執行（ECONNREFUSED）');
                }
                console.log('SKIP HTTP test (api-proxy 未啟動，請執行 npm run api)');
            } else {
                throw e;
            }
        }
        process.exit(0);
    } catch (err) {
        console.error('FAIL', err.message);
        process.exit(1);
    }
})();