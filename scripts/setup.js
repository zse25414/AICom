/**
 * npm run setup — 首次啟動精靈（P5-A3）
 * 檢查 Node / 依賴 / Python / venv / .env / 埠占用，人話診斷 + 下一步指令。
 * 非互動環境（CI、無 TTY）自動略過提問，只輸出檢查結果。
 * 用法：npm run setup [-- --check]（--check 純檢查，不寫任何檔案）
 */
const fs = require('fs');
const path = require('path');
const net = require('net');
const http = require('http');
const readline = require('readline');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const checkOnly = process.argv.includes('--check');
const interactive = process.stdin.isTTY && !checkOnly;

const results = [];
function ok(label, detail) { results.push({ level: 'ok', label, detail }); console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`); }
function warn(label, detail) { results.push({ level: 'warn', label, detail }); console.log(`  ! ${label}${detail ? ` — ${detail}` : ''}`); }
function fail(label, detail) { results.push({ level: 'fail', label, detail }); console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); }

function probeCmd(cmd, args) {
    const r = spawnSync(cmd, args, { encoding: 'utf8', shell: process.platform === 'win32' });
    return r.status === 0 ? String(r.stdout || r.stderr).trim() : null;
}

function portStatus(port) {
    // 用 connect 探測：Windows 上 listen(127.0.0.1) 在 0.0.0.0 已被綁定時仍可能成功，不可靠
    return new Promise(resolve => {
        const sock = net.connect({ host: '127.0.0.1', port, timeout: 1500 });
        sock.once('connect', () => { sock.destroy(); resolve('busy'); });
        sock.once('error', () => resolve('free'));
        sock.once('timeout', () => { sock.destroy(); resolve('free'); });
    });
}

function fetchJson(port, p) {
    return new Promise(resolve => {
        const req = http.get({ hostname: '127.0.0.1', port, path: p, timeout: 2500 }, res => {
            let body = '';
            res.on('data', c => { body += c; });
            res.on('end', () => {
                try { resolve({ status: res.statusCode, json: JSON.parse(body) }); }
                catch (_) { resolve({ status: res.statusCode, json: null }); }
            });
        });
        req.on('error', () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
    });
}

function ask(question) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => rl.question(question, a => { rl.close(); resolve(a.trim()); }));
}

async function main() {
    console.log('\nLumina AI 首次啟動精靈');
    console.log('────────────────────────────');

    // 1. Node 版本
    const major = Number(process.versions.node.split('.')[0]);
    if (major >= 20) ok(`Node.js ${process.versions.node}`);
    else fail(`Node.js ${process.versions.node}`, '需要 20+，請到 https://nodejs.org 更新');

    // 2. npm 依賴
    if (fs.existsSync(path.join(root, 'node_modules', 'concurrently'))) ok('npm 依賴已安裝');
    else fail('npm 依賴未安裝', '請先執行：npm install');

    // 3. Python（RAG 知識庫需要；純個人任務模式可不裝）
    const pyVer = probeCmd('python', ['--version']) || probeCmd('python3', ['--version']);
    if (pyVer) {
        const m = pyVer.match(/(\d+)\.(\d+)/);
        const new_enough = m && (Number(m[1]) > 3 || (Number(m[1]) === 3 && Number(m[2]) >= 10));
        if (new_enough) ok(`Python（${pyVer}）`);
        else warn(`Python 版本偏舊（${pyVer}）`, '建議 3.10+；既有 venv 可用就不影響');
    } else warn('找不到 Python', '知識庫（RAG）功能需要 Python 3.10+；不用知識庫可略過');

    // 4. RAG venv
    const venvOk = fs.existsSync(path.join(root, 'rag_service', 'venv'));
    if (venvOk) ok('RAG venv 已建立');
    else if (pyVer) warn('RAG venv 未建立', '要用知識庫請執行：npm run rag:setup');
    else warn('RAG venv 未建立', '先安裝 Python，再執行：npm run rag:setup');

    // 5. .env
    const envPath = path.join(root, '.env');
    const envExample = path.join(root, '.env.example');
    let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : null;
    if (envContent === null) {
        if (interactive && fs.existsSync(envExample)) {
            const a = await ask('  ? 沒有 .env，要從 .env.example 建立嗎？(Y/n) ');
            if (a === '' || /^y/i.test(a)) {
                fs.copyFileSync(envExample, envPath);
                envContent = fs.readFileSync(envPath, 'utf8');
                ok('.env 已從 .env.example 建立');
            } else warn('.env 未建立', '之後可手動：cp .env.example .env');
        } else {
            warn('沒有 .env', '執行：cp .env.example .env（再填入密鑰）');
        }
    } else ok('.env 存在');

    // 6. DEEPSEEK_API_KEY（AI 回覆用；沒有也能用內建規則引導）
    const hasKey = !!(envContent && /^\s*DEEPSEEK_API_KEY\s*=\s*\S+/m.test(envContent)) || !!process.env.DEEPSEEK_API_KEY;
    if (hasKey) ok('DEEPSEEK_API_KEY 已設定');
    else {
        let wrote = false;
        if (interactive && envContent !== null) {
            const key = await ask('  ? 要現在填入 DeepSeek API Key 嗎？（沒有可直接按 Enter 跳過，也可之後在網頁設定頁填）\n    Key: ');
            if (key) {
                fs.appendFileSync(envPath, `\nDEEPSEEK_API_KEY=${key}\n`);
                ok('DEEPSEEK_API_KEY 已寫入 .env');
                wrote = true;
            }
        }
        if (!wrote) warn('未設定 DEEPSEEK_API_KEY', 'AI 教練會用內建規則引導；要真 AI 可在網頁「設定 → 跟嚮導走」填 Key');
    }

    // 7. 埠占用 / 服務狀態
    const api = await fetchJson(3001, '/ready');
    if (api && api.status === 200) ok('API（:3001）已在運行且就緒');
    else if ((await portStatus(3001)) === 'busy') warn('埠 3001 被占用但 /ready 未通過', '可能是別的程式，或 API 剛啟動中');
    else ok('埠 3001 可用（API 尚未啟動）');

    for (const [port, name] of [[3456, '前端'], [8000, 'RAG']]) {
        const st = await portStatus(port);
        if (st === 'free') ok(`埠 ${port} 可用（${name}尚未啟動）`);
        else ok(`埠 ${port} 使用中（${name}可能已在運行）`);
    }

    // 總結
    const fails = results.filter(r => r.level === 'fail');
    const warns = results.filter(r => r.level === 'warn');
    console.log('────────────────────────────');
    if (fails.length) {
        console.log(`✗ 有 ${fails.length} 項必修問題，先照上面提示處理，再重跑 npm run setup`);
        process.exit(1);
    }
    console.log(warns.length
        ? `✓ 可以啟動（${warns.length} 項提醒不擋路）。下一步：`
        : '✓ 一切就緒。下一步：');
    console.log('    npm run dev:all     ← 啟動全部（前端 + API + RAG）');
    console.log('    然後開瀏覽器 → http://localhost:3456\n');
}

main().catch(err => { console.error('[setup] 未預期錯誤：', err.message); process.exit(1); });
