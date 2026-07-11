/**
 * 整合測試：register + enterprise + security-matrix + w2-kb + coach-rag
 * （需 API；coach-rag / w2 document index 建議 RAG）
 */
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const ciMode = process.env.CI === 'true' || process.env.CI === '1';
const scripts = [
    'test-register.js',
    'test-enterprise.js',
    'test-security-matrix.js',
    'test-w2-kb-sync.js',
    'test-coach-rag.js'
];

function run(rel) {
    console.log(`\n==> ${rel}`);
    const result = spawnSync('node', [path.join('scripts', rel)], {
        cwd: root,
        stdio: 'inherit',
        env: process.env
    });
    return result.status === 0;
}

(async () => {
    try {
        const ready = spawnSync('node', ['scripts/check-ready.js'], { cwd: root, stdio: 'pipe', encoding: 'utf8' });
        if (ready.status !== 0) {
            const msg = 'API 未就緒，請先執行 npm run api';
            if (ciMode) {
                console.error('FAIL', msg);
                process.exit(1);
            }
            console.log('SKIP integration (API not ready)');
            process.exit(0);
        }
        console.log('OK API ready');

        for (const script of scripts) {
            if (!run(script)) process.exit(1);
        }

        const ragProbe = spawnSync('node', ['-e', `
            const http=require('http');
            http.get('http://127.0.0.1:8000/health',res=>{process.exit(res.statusCode===200?0:1)}).on('error',()=>process.exit(2));
        `], { cwd: root, stdio: 'pipe' });
        if (ragProbe.status === 0) {
            console.log('OK RAG health');
        } else if (ciMode) {
            console.warn('WARN RAG not running in CI — coach-rag already passed via proxy if indexed');
        } else {
            console.log('SKIP RAG direct health (optional)');
        }

        console.log('\nAll integration checks passed');
        process.exit(0);
    } catch (err) {
        console.error('FAIL', err.message);
        process.exit(1);
    }
})();
