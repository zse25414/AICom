/**
 * 驗證 api-proxy GET /ready（CI health gate）
 *
 *   node scripts/check-ready.js           # 單次檢查
 *   node scripts/check-ready.js --wait    # 輪詢直到就緒或逾時
 *   node scripts/check-ready.js --require-rag
 */
const http = require('http');

const host = process.env.API_HOST || '127.0.0.1';
const port = Number(process.env.API_PORT || 3001);
const wait = process.argv.includes('--wait');
const requireRag = process.argv.includes('--require-rag');
const timeoutSec = Number(process.env.READY_TIMEOUT_SEC || 30);

function fetchReady() {
    return new Promise((resolve, reject) => {
        const req = http.get(
            { hostname: host, port, path: '/ready', timeout: 5000 },
            res => {
                let body = '';
                res.on('data', chunk => { body += chunk; });
                res.on('end', () => {
                    try {
                        resolve({ status: res.statusCode, data: JSON.parse(body) });
                    } catch (_) {
                        reject(new Error('Invalid JSON from /ready'));
                    }
                });
            }
        );
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
    });
}

function validate(result) {
    const { status, data } = result;
    const checks = data?.checks || {};

    if (status !== 200 || !data?.ok) {
        return {
            ok: false,
            reason: `HTTP ${status}, ok=${!!data?.ok}`,
            checks
        };
    }
    if (!checks.store || !checks.auth) {
        return {
            ok: false,
            reason: 'store or auth not ready',
            checks
        };
    }
    if (requireRag && !checks.rag) {
        return {
            ok: false,
            reason: 'rag not ready',
            checks
        };
    }
    return { ok: true, checks };
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

(async () => {
    const deadline = Date.now() + timeoutSec * 1000;

    while (true) {
        try {
            const result = await fetchReady();
            const verdict = validate(result);
            if (verdict.ok) {
                console.log('OK /ready', JSON.stringify(verdict.checks));
                process.exit(0);
            }
            if (!wait || Date.now() >= deadline) {
                console.error('FAIL /ready:', verdict.reason, JSON.stringify(verdict.checks));
                process.exit(1);
            }
            console.log('WAIT /ready:', verdict.reason, JSON.stringify(verdict.checks));
        } catch (err) {
            if (!wait || Date.now() >= deadline) {
                console.error('FAIL /ready:', err.message);
                process.exit(1);
            }
            console.log('WAIT /ready:', err.message);
        }
        await sleep(1000);
    }
})();