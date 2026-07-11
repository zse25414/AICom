/**
 * 幂等 Demo 種子資料
 *
 * 固定帳號 / 群組 / 手冊文本，可重複執行：
 *   - 用戶已存在 → login
 *   - 群組已存在 → join 為 manager
 *   - 再 upload-text 寫入固定知識（RAG 會重索引同 title 亦可）
 *
 * 用法：
 *   node scripts/seed-demo.js
 *   npm run seed:demo
 *
 * 環境：
 *   API_HOST / API_PORT（預設 127.0.0.1:3001）
 *   SEED_EMAIL / SEED_PASSWORD / SEED_GROUP_CODE / SEED_MANAGER_PIN
 *
 * Exit codes：
 *   0 成功
 *   1 失敗（含 API 未啟動 ECONNREFUSED）
 */
const http = require('http');

const API_HOST = process.env.API_HOST || '127.0.0.1';
const API_PORT = Number(process.env.API_PORT || 3001);

const DEMO = {
    email: process.env.SEED_EMAIL || 'demo@lumina.test',
    password: process.env.SEED_PASSWORD || 'demo-pass-1234',
    name: process.env.SEED_NAME || 'Demo 用戶',
    role: process.env.SEED_ROLE || '工程師',
    groupCode: process.env.SEED_GROUP_CODE || 'SEED01',
    groupName: process.env.SEED_GROUP_NAME || 'Lumina Demo 團隊',
    managerName: process.env.SEED_MANAGER_NAME || 'Demo 主管',
    managerPin: process.env.SEED_MANAGER_PIN || '847293',
    kbId: process.env.SEED_KB_ID || 'general',
    handbookTitle: 'Lumina 新人手冊',
    handbookContent: [
        '【Lumina AI Demo 知識庫】',
        '第一天請完成帳號設定、加入團隊頻道，並參加下午三點的團隊同步會議。',
        '我們公司的核心價值是用戶價值第一。',
        '使命是幫助每個人完成今日第一步，簡單可執行。',
        '教練問答時可引用本手冊作為來源。',
        '緊急聯絡：請先找團隊主管（Demo 主管）。'
    ].join('\n')
};

function request(method, path, body, token) {
    return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : null;
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
        req.setTimeout(30000, () => {
            req.destroy();
            reject(new Error(`Request timeout: ${method} ${path}`));
        });
        if (payload) req.write(payload);
        req.end();
    });
}

function log(step, msg) {
    console.log(`[seed-demo] ${step}: ${msg}`);
}

function failApiDown(err) {
    const code = err && (err.code || err.errno);
    if (code === 'ECONNREFUSED' || /ECONNREFUSED/.test(String(err && err.message))) {
        console.error(
            `[seed-demo] FAIL: API 未啟動（${API_HOST}:${API_PORT}）。\n` +
            '  請先執行：npm run api   或   npm run dev / npm run dev:all\n' +
            '  （RAG 上傳需一併啟動：npm run rag）'
        );
        process.exit(1);
    }
}

async function ensureUser() {
    const register = await request('POST', '/api/auth/register', {
        name: DEMO.name,
        email: DEMO.email,
        role: DEMO.role,
        password: DEMO.password
    });

    if (register.status === 201 && register.data.token) {
        log('user', `已註冊 ${DEMO.email}`);
        return register.data.token;
    }

    if (register.status === 409) {
        const login = await request('POST', '/api/auth/login', {
            email: DEMO.email,
            password: DEMO.password
        });
        if (login.status === 200 && login.data.token) {
            log('user', `已存在，登入 ${DEMO.email}`);
            return login.data.token;
        }
        throw new Error(`login failed after 409: ${login.status} ${login.raw}`);
    }

    throw new Error(`register failed: ${register.status} ${register.raw}`);
}

async function ensureGroup(token) {
    const create = await request('POST', '/api/enterprise/group/create', {
        code: DEMO.groupCode,
        name: DEMO.groupName,
        managerName: DEMO.managerName,
        managerPin: DEMO.managerPin
    }, token);

    if (create.status === 200 && create.data.ok) {
        log('group', `已建立 ${DEMO.groupCode}`);
        return create.data.member;
    }

    if (create.status === 409) {
        const join = await request('POST', '/api/enterprise/group/join', {
            code: DEMO.groupCode,
            name: DEMO.managerName,
            role: 'manager',
            pin: DEMO.managerPin
        }, token);
        if (join.status === 200 && join.data.ok) {
            log('group', `已存在，已加入/重入 ${DEMO.groupCode}（role=${join.data.member?.role || '?'}）`);
            return join.data.member;
        }
        throw new Error(`join failed after 409: ${join.status} ${join.raw}`);
    }

    throw new Error(`create group failed: ${create.status} ${create.raw}`);
}

async function seedKnowledge(token) {
    const upload = await request('POST', '/api/rag/document/upload-text', {
        group_code: DEMO.groupCode,
        kb_id: DEMO.kbId,
        title: DEMO.handbookTitle,
        content: DEMO.handbookContent,
        filename: 'lumina-seed-handbook.txt',
        auto_create: true
    }, token);

    if (upload.status >= 200 && upload.status < 300) {
        log('kb', `upload-text OK（kb=${DEMO.kbId}, title=${DEMO.handbookTitle}）`);
        return;
    }

    // RAG 未就緒常見 502/503；仍視為明確失敗
    throw new Error(
        `upload-text failed: ${upload.status} ${upload.data.error || upload.data.detail || upload.raw}`
    );
}

(async () => {
    try {
        log('start', `API ${API_HOST}:${API_PORT}`);

        // 先探活，API 未起則清楚 exit 1
        try {
            await request('GET', '/ready');
        } catch (err) {
            failApiDown(err);
            throw err;
        }

        const token = await ensureUser();
        await ensureGroup(token);
        await seedKnowledge(token);

        console.log('');
        console.log('[seed-demo] 完成（幂等）');
        console.log(`  帳號: ${DEMO.email}`);
        console.log(`  密碼: ${DEMO.password}`);
        console.log(`  群組: ${DEMO.groupCode}`);
        console.log(`  主管 PIN: ${DEMO.managerPin}`);
        console.log(`  知識庫: ${DEMO.kbId} / ${DEMO.handbookTitle}`);
        process.exit(0);
    } catch (err) {
        failApiDown(err);
        console.error('[seed-demo] FAIL:', err.message || err);
        process.exit(1);
    }
})();
