/**
 * 一鍵啟動 web + api + rag，並等待 /ready
 */
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const root = path.join(__dirname, '..');
const isWin = process.platform === 'win32';
const children = [];

function run(command, args, name, env = {}) {
    const child = spawn(command, args, {
        cwd: root,
        stdio: 'inherit',
        shell: isWin,
        env: { ...process.env, ...env }
    });
    child.on('exit', code => {
        if (code) console.error(`[dev-all] ${name} exited with code ${code}`);
    });
    children.push(child);
    return child;
}

function waitReady(timeoutSec = 45) {
    const port = Number(process.env.API_PORT || 3001);
    const deadline = Date.now() + timeoutSec * 1000;
    return new Promise((resolve, reject) => {
        const poll = () => {
            const req = http.get({ hostname: '127.0.0.1', port, path: '/ready', timeout: 3000 }, res => {
                let body = '';
                res.on('data', c => { body += c; });
                res.on('end', () => {
                    if (res.statusCode === 200) {
                        resolve(body);
                        return;
                    }
                    retry();
                });
            });
            req.on('error', retry);
            req.on('timeout', () => { req.destroy(); retry(); });

            function retry() {
                if (Date.now() >= deadline) {
                    reject(new Error('API /ready timeout'));
                    return;
                }
                setTimeout(poll, 1000);
            }
        };
        poll();
    });
}

function shutdown() {
    for (const child of children) {
        try { child.kill(); } catch (_) {}
    }
    process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

(async () => {
    console.log('[dev-all] 啟動 API (3001)...');
    run('node', ['api-proxy.js'], 'api', { MONGODB_URI: '' });

    console.log('[dev-all] 啟動 RAG (8000)...');
    run('node', ['scripts/run-rag.js'], 'rag');

    console.log('[dev-all] 等待 API 就緒...');
    try {
        const body = await waitReady(Number(process.env.READY_TIMEOUT_SEC || 45));
        console.log('[dev-all] API ready:', body);
    } catch (err) {
        console.warn('[dev-all] API 等待逾時，仍啟動前端:', err.message);
    }

    console.log('[dev-all] 啟動前端 (3456)...');
    run('npm', ['run', 'start'], 'web');

    console.log('\n[dev-all] Lumina 已啟動 → http://127.0.0.1:3456/lumina-ai.html');
    console.log('[dev-all] 按 Ctrl+C 結束所有服務');
})();