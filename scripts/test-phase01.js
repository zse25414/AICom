/**
 * Phase 0+1 smoke: analytics contract + freeze docs present.
 * Run: node scripts/test-phase01.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
let failed = 0;

function ok(cond, msg) {
    if (cond) console.log('OK', msg);
    else {
        console.error('FAIL', msg);
        failed++;
    }
}

// --- Docs ---
ok(fs.existsSync(path.join(root, 'docs/roadmap/PHASE-0-1.md')), 'docs/roadmap/PHASE-0-1.md');
ok(fs.existsSync(path.join(root, 'docs/UI-COACH.md')), 'docs/UI-COACH.md');

// --- Analytics module ---
const analyticsPath = path.join(root, 'js/modules/slices/utils/analytics.js');
ok(fs.existsSync(analyticsPath), 'analytics.js exists');
const analyticsSrc = fs.readFileSync(analyticsPath, 'utf8');
ok(analyticsSrc.includes('function track('), 'track() defined');
ok(analyticsSrc.includes('main_path_complete'), 'main_path_complete supported');
ok(analyticsSrc.includes('lumina_analytics_v1'), 'localStorage key');

// --- Manifest includes analytics ---
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'js/modules/slices/manifest.json'), 'utf8'));
ok(manifest.core.includes('utils/analytics.js'), 'manifest core has analytics');

// --- Instrumented call sites ---
const files = {
    boot: 'js/modules/slices/boot/init.js',
    tasks: 'js/modules/slices/tasks/index.js',
    dashboard: 'js/modules/slices/ui/dashboard.js',
    agent: 'js/modules/slices/coach/agent.js',
    decompose: 'js/modules/slices/coach/decompose.js',
    onboarding: 'js/modules/slices/ui/onboarding.js',
    html: 'lumina-ai.html'
};
const src = {};
for (const [k, rel] of Object.entries(files)) {
    src[k] = fs.readFileSync(path.join(root, rel), 'utf8');
}

ok(src.boot.includes("track('session_boot'"), 'session_boot instrumented');
ok(src.tasks.includes("track('task_created'"), 'task_created instrumented');
ok(src.tasks.includes("track('demo_seeded'"), 'demo_seeded instrumented');
ok(src.tasks.includes("track('task_completed'"), 'task_completed instrumented');
ok(src.agent.includes("track('coach_start'"), 'coach_start instrumented');
ok(src.agent.includes("track('coach_message'"), 'coach_message instrumented');
ok(src.agent.includes("track('coach_error'"), 'coach_error instrumented');
ok(src.agent.includes("track('rag_empty'"), 'rag_empty instrumented');
ok(src.decompose.includes("track('coach_open'"), 'coach_open instrumented');

// --- Phase 1 one-liner ---
ok(src.html.includes('今天最重要那一件') || src.html.includes('今天最重要'), 'dashboard one-liner');
ok(src.onboarding.includes('一步一步做完今天那件事') || src.onboarding.includes('知識庫'), 'beginner welcome aligned');

// --- Coach bubble safety ---
ok(src.agent.includes('coach-agent-msg-user'), 'user bubble class');
ok(!/coach-agent-msg-user[\s\S]{0,200}min-w-0/.test(src.agent), 'user bubble not using min-w-0 wrapper');

// --- Runtime track with mock localStorage ---
const store = {};
global.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
};
global.sessionStorage = {
    _s: {},
    getItem(k) { return k in this._s ? this._s[k] : null; },
    setItem(k, v) { this._s[k] = String(v); },
    removeItem(k) { delete this._s[k]; }
};
global.window = global;
global.console = console;

// Evaluate analytics in isolation (strip window export dependency issues)
const vm = require('vm');
const code = analyticsSrc
    .replace(/if \(typeof window !== 'undefined'\) \{[\s\S]*\}\s*$/, '');
vm.runInThisContext(code + '\nthis.track = track; this.getAnalyticsSummary = getAnalyticsSummary;');

track('task_created', { source: 'test' });
track('coach_start', {});
track('task_completed', {});
const summary = getAnalyticsSummary();
ok(summary.total >= 3, 'buffer has events: ' + summary.total);
ok(summary.counts.task_created >= 1, 'count task_created');
ok(summary.counts.main_path_complete >= 1, 'main_path_complete fired in session');

if (failed) {
    console.error(`\nPhase 0+1 checks FAILED: ${failed}`);
    process.exit(1);
}
console.log('\nPhase 0+1 checks passed');
process.exit(0);
