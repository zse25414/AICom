/**
 * Phase 4 contract: templates, exec memory, docs.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
let failed = 0;
function ok(c, m) {
    if (c) console.log('OK', m);
    else { console.error('FAIL', m); failed++; }
}

ok(fs.existsSync(path.join(root, 'docs/roadmap/PHASE-4.md')), 'PHASE-4.md');
ok(fs.existsSync(path.join(root, 'docs/business/PRIVATE-DEPLOY.md')), 'PRIVATE-DEPLOY.md');

const templatesPath = path.join(root, 'js/modules/slices/utils/templates.js');
const memoryPath = path.join(root, 'js/modules/slices/utils/exec-memory.js');
ok(fs.existsSync(templatesPath), 'templates.js');
ok(fs.existsSync(memoryPath), 'exec-memory.js');

const tplSrc = fs.readFileSync(templatesPath, 'utf8');
const memSrc = fs.readFileSync(memoryPath, 'utf8');
ok(tplSrc.includes('onboarding-week1'), 'onboarding template');
ok(tplSrc.includes('cs-daily'), 'cs template');
ok(tplSrc.includes('weekly-review'), 'weekly template');
ok(tplSrc.includes('applyWorkflowTemplate'), 'applyWorkflowTemplate');
ok(memSrc.includes('recordTaskCompletionMemory'), 'completion memory');
ok(memSrc.includes('buildExecMemoryContextText'), 'memory context for coach');
ok(memSrc.includes('getKnowledgeHealthSummary'), 'kb health');

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'js/modules/slices/manifest.json'), 'utf8'));
ok(manifest.core.includes('utils/templates.js'), 'manifest templates');
ok(manifest.core.includes('utils/exec-memory.js'), 'manifest exec-memory');

const html = fs.readFileSync(path.join(root, 'lumina-ai.html'), 'utf8');
ok(html.includes('workflow-templates-panel'), 'templates panel markup');
ok(html.includes('exec-memory-panel'), 'memory panel markup');
ok(html.includes('kb-health-panel'), 'kb health panel markup');

const agent = fs.readFileSync(path.join(root, 'js/modules/slices/coach/agent.js'), 'utf8');
ok(agent.includes('buildExecMemoryContextText'), 'coach uses memory context');
ok(agent.includes('rememberCoachSourcesForMemory'), 'coach remembers sources');

const tasks = fs.readFileSync(path.join(root, 'js/modules/slices/tasks/index.js'), 'utf8');
ok(tasks.includes('recordTaskCompletionMemory'), 'complete records memory');

// Runtime: apply template + memory
const store = {};
global.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
};
global.S = { tasks: [], todayFocusTaskId: null, coachAgentMessages: [] };
global.toLocalISO = (d = new Date()) => d.toISOString().slice(0, 10);
global.rebuildTaskIndex = () => {};
global.invalidateTodayStats = () => {};
global.saveState = () => {};
global.refreshUI = () => {};
global.showToast = () => {};
global.track = () => {};
global.escapeHtml = (s) => String(s);
global.window = global;

const tplCode = tplSrc.replace(/if \(typeof window !== 'undefined'\) \{[\s\S]*\}\s*$/, '');
const memCode = memSrc.replace(/if \(typeof window !== 'undefined'\) \{[\s\S]*\}\s*$/, '');
vm.runInThisContext(memCode + '\nthis.recordExecMemory=recordExecMemory;this.getExecMemory=getExecMemory;this.recordTaskCompletionMemory=recordTaskCompletionMemory;this.buildExecMemoryContextText=buildExecMemoryContextText;this.getKnowledgeHealthSummary=getKnowledgeHealthSummary;');
vm.runInThisContext(tplCode + '\nthis.applyWorkflowTemplate=applyWorkflowTemplate;this.getWorkflowTemplates=getWorkflowTemplates;');

const created = applyWorkflowTemplate('onboarding-week1');
ok(Array.isArray(created) && created.length === 5, 'template creates 5 tasks');
ok(S.tasks.length === 5, 'S.tasks filled');
ok(S.tasks[0].source === 'template', 'task source template');

recordTaskCompletionMemory(S.tasks[0]);
const mem = getExecMemory(5);
ok(mem.length >= 1 && mem.some(m => m.type === 'task_completed' || m.type === 'template_applied'), 'memory recorded');
const ctx = buildExecMemoryContextText(5);
ok(ctx.includes('執行記憶') || ctx.includes('完成') || ctx.includes('模板'), 'memory context text');

S.enterpriseSession = { groupCode: 'T' };
S.enterpriseGroupData = {
    documents: [
        { id: '1', status: 'ok', rag: { status: 'indexed' } },
        { id: '2', status: 'ok', rag: { status: 'failed' } }
    ]
};
global.resolveDocRagStatus = (d) => d.rag?.status || 'unknown';
const health = getKnowledgeHealthSummary();
ok(health.total === 2 && health.failed === 1, 'kb health counts');

if (failed) {
    console.error(`\nPhase 4 FAILED: ${failed}`);
    process.exit(1);
}
console.log('\nPhase 4 checks passed');
process.exit(0);
