/**
 * Phase 3 gate: docs + visual contracts + e2e main path (spawned).
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
let failed = 0;
function ok(c, m) {
    if (c) console.log('OK', m);
    else { console.error('FAIL', m); failed++; }
}

const docs = [
    'docs/roadmap/PHASE-3.md',
    'docs/engineering/STATE-CONTRACT.md',
    'docs/engineering/SLO.md',
    'docs/engineering/RUNBOOK.md'
];
for (const d of docs) {
    ok(fs.existsSync(path.join(root, d)), d);
}

const buildApp = fs.readFileSync(path.join(root, 'scripts/build-app.js'), 'utf8');
ok(buildApp.includes('__luminaOnChunkError'), 'lazy loader calls chunk error handler');

const nav = fs.readFileSync(path.join(root, 'js/modules/slices/ui/navigation.js'), 'utf8');
ok(nav.includes('__luminaEnsureCoach'), 'showSection ensures coach chunk');
ok(nav.includes('showCoachChunkError'), 'showSection handles coach error');

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'js/modules/slices/manifest.json'), 'utf8'));
ok(manifest.core.includes('utils/chunk-errors.js'), 'manifest chunk-errors');

function run(script) {
    const r = spawnSync(process.execPath, [path.join(root, script)], {
        cwd: root,
        encoding: 'utf8',
        env: process.env
    });
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
    return r.status === 0;
}

ok(run('scripts/test-visual-coach-contract.js'), 'visual coach contract');
ok(run('scripts/test-e2e-main-path.js'), 'e2e main path');

if (failed) {
    console.error(`\nPhase 3 checks FAILED: ${failed}`);
    process.exit(1);
}
console.log('\nPhase 3 checks passed');
process.exit(0);
