/**
 * P2 polish smoke (source contracts).
 * Run: node scripts/test-phase-p2.js
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

function read(rel) {
    return fs.readFileSync(path.join(root, rel), 'utf8');
}

const confirm = read('js/modules/slices/ui/confirm.js');
const feedback = read('js/modules/slices/ui/feedback.js');
const tasks = read('js/modules/slices/tasks/index.js');
const auth = read('js/modules/slices/auth/index.js');
const team = read('js/modules/slices/enterprise/team.js');
const docs = read('js/modules/slices/enterprise/documents.js');
const agent = read('js/modules/slices/coach/agent.js');
const focus = read('js/modules/slices/tasks/focus.js');
const pwa = read('js/modules/slices/ui/pwa.js');
const constants = read('js/modules/core/constants.js');
const css = read('css/lumina.css');
const manifest = JSON.parse(read('js/modules/slices/manifest.json'));
const pkg = JSON.parse(read('package.json'));

// P2-1 confirm modal
ok(manifest.core.includes('ui/confirm.js'), 'manifest confirm');
ok(confirm.includes('function showConfirmDialog'), 'showConfirmDialog');
ok(confirm.includes('app-confirm-overlay'), 'confirm overlay id');
ok(!tasks.includes('confirm('), 'tasks no window.confirm');
ok(!auth.includes('confirm('), 'auth no window.confirm');
ok(!feedback.includes('confirm('), 'feedback no window.confirm');
ok(!team.includes('confirm('), 'team no window.confirm');
ok(!docs.includes('confirm('), 'docs no window.confirm');
ok(tasks.includes('showConfirmDialog'), 'tasks uses modal');
ok(docs.includes('showConfirmDialog'), 'docs uses modal');

// P2-2 split duration
ok(tasks.includes('part1Duration'), 'split part1Duration');
ok(tasks.includes('part2Duration'), 'split part2Duration');
ok(tasks.includes('optimizeSchedule'), 'split re-optimizes schedule');
ok(tasks.includes('splitPart'), 'splitPart metadata');

// P2-3 freeform persistence
ok(constants.includes('COACH_THREAD_STORAGE'), 'COACH_THREAD_STORAGE');
ok(agent.includes('persistCoachFreeformThread'), 'persist freeform');
ok(agent.includes('loadCoachFreeformThread'), 'load freeform');
ok(agent.includes('clearPersistedCoachFreeformThread'), 'clear freeform');
ok(read('js/modules/slices/boot/init.js').includes('loadCoachFreeformThread'), 'boot restores thread');

// P2-4 celebrate next
ok(focus.includes('getNextRelatedTask'), 'related next task');
ok(focus.includes('celebrate_next_task') || focus.includes('開始下一項'), 'celebrate CTA');
ok(focus.includes('parentGoalName') || focus.includes('同目標'), 'prefer same goal');

// P2-5 SW
ok(constants.includes('APP_BUILD_ID'), 'APP_BUILD_ID');
ok(pwa.includes('network-first') || pwa.includes('Network-first') || pwa.includes('isShellRequest'), 'shell network-first');
ok(pwa.includes('showAppUpdateBanner'), 'update banner fn');
ok(css.includes('app-update-banner'), 'update banner css');
ok(pwa.includes('controllerchange') || pwa.includes('updatefound'), 'sw update listeners');

ok(pkg.scripts['test:phase-p2'], 'npm test:phase-p2');

if (failed) {
    console.error(`\n${failed} P2 checks failed`);
    process.exit(1);
}
console.log('\nP2 phase smoke passed');
process.exit(0);