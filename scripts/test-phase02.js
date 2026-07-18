/**
 * Phase 2 contract: business docs + usage module + instrumentation hooks.
 * Run: node scripts/test-phase02.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
let failed = 0;

function ok(cond, msg) {
    if (cond) console.log('OK', msg);
    else {
        console.error('FAIL', msg);
        failed++;
    }
}

ok(fs.existsSync(path.join(root, 'docs/roadmap/PHASE-2.md')), 'PHASE-2.md');
ok(fs.existsSync(path.join(root, 'docs/business/ONE-PAGER.md')), 'ONE-PAGER.md');
ok(fs.existsSync(path.join(root, 'docs/business/PILOT-PLAYBOOK.md')), 'PILOT-PLAYBOOK.md');

const onePager = fs.readFileSync(path.join(root, 'docs/business/ONE-PAGER.md'), 'utf8');
ok(onePager.includes('今天最重要'), 'one-pager positioning');

const usagePath = path.join(root, 'js/modules/slices/utils/usage.js');
ok(fs.existsSync(usagePath), 'usage.js');
const usageSrc = fs.readFileSync(usagePath, 'utf8');
ok(usageSrc.includes('assertUsageQuota'), 'assertUsageQuota');
ok(usageSrc.includes('recordUsage'), 'recordUsage');
ok(usageSrc.includes('getCoachCachedAnswer'), 'coach cache');
ok(usageSrc.includes('COST_USD_PER_1K_TOKENS'), 'cost constant');

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'js/modules/slices/manifest.json'), 'utf8'));
ok(manifest.core.includes('utils/usage.js'), 'manifest usage');

const apiSrc = fs.readFileSync(path.join(root, 'js/modules/slices/storage/api.js'), 'utf8');
ok(apiSrc.includes('assertUsageQuota'), 'callDeepSeek checks quota');
ok(apiSrc.includes('recordUsage'), 'callDeepSeek records usage');

const agentSrc = fs.readFileSync(path.join(root, 'js/modules/slices/coach/agent.js'), 'utf8');
ok(agentSrc.includes('getCoachCachedAnswer'), 'coach uses cache');
ok(agentSrc.includes('assertUsageQuota'), 'coach RAG quota');
ok(agentSrc.includes('USAGE_QUOTA'), 'coach handles quota error');

const html = fs.readFileSync(path.join(root, 'lumina-ai.html'), 'utf8');
ok(html.includes('usage-meter-panel'), 'settings usage panel');
ok(html.includes('settings-plan-pro'), 'pro toggle');

// Runtime quota simulation
const store = {};
global.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
};
global.S = { userProfile: { plan: 'free' } };
global.getTodayISO = () => '2099-01-15';
global.track = () => {};
global.window = global;

const code = usageSrc.replace(/if \(typeof window !== 'undefined'\) \{[\s\S]*\}\s*$/, '');
vm.runInThisContext(code + `
  this.assertUsageQuota = assertUsageQuota;
  this.recordUsage = recordUsage;
  this.checkUsageQuota = checkUsageQuota;
  this.setUsagePlan = setUsagePlan;
  this.getCoachCachedAnswer = getCoachCachedAnswer;
  this.setCoachCachedAnswer = setCoachCachedAnswer;
  this.coachCacheKey = coachCacheKey;
`);

setUsagePlan('free');
const q0 = checkUsageQuota('ai');
ok(q0.limit === 40, 'free AI limit 40');
ok(q0.ok === true, 'free AI ok initially');

// Exhaust free AI
for (let i = 0; i < 40; i++) recordUsage({ kind: 'ai', tokensIn: 10, tokensOut: 10 });
let blocked = false;
try {
    assertUsageQuota('ai');
} catch (e) {
    blocked = e.code === 'USAGE_QUOTA';
}
ok(blocked, 'quota blocks after 40 AI calls');

setUsagePlan('pro');
ok(checkUsageQuota('ai').ok === true, 'pro raises limit');

const key = coachCacheKey({ q: 'hello', taskId: 1 });
setCoachCachedAnswer(key, { reply: 'cached', meta: {} });
const hit = getCoachCachedAnswer(key);
ok(hit && hit.reply === 'cached', 'coach cache hit');

if (failed) {
    console.error(`\nPhase 2 checks FAILED: ${failed}`);
    process.exit(1);
}
console.log('\nPhase 2 checks passed');
process.exit(0);
