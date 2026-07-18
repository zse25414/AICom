/**
 * P1 non-billing smoke (source contracts).
 * Run: node scripts/test-phase-p1.js
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

// Docs
ok(fs.existsSync(path.join(root, 'docs/engineering/DOGFOOD-5MIN.md')), 'DOGFOOD-5MIN.md');
ok(fs.existsSync(path.join(root, 'docs/engineering/DOGFOOD-TEAM.md')), 'DOGFOOD-TEAM.md');
ok(fs.existsSync(path.join(root, 'fixtures/rag-golden-set.json')), 'rag-golden-set.json');
ok(fs.existsSync(path.join(root, 'scripts/test-rag-golden.js')), 'test-rag-golden.js');
ok(fs.existsSync(path.join(root, 'scripts/test-e2e-team-path.js')), 'test-e2e-team-path.js');

// P1-2 key persist
const constants = read('js/modules/core/constants.js');
const api = read('js/modules/slices/storage/api.js');
const keywiz = read('js/modules/slices/coach/keywizard.js');
const html = read('lumina-ai.html');
ok(constants.includes('API_KEY_PERSIST_FLAG'), 'API_KEY_PERSIST_FLAG constant');
ok(api.includes('isApiKeyPersisted'), 'isApiKeyPersisted');
ok(api.includes('setStoredApiKey(key, options'), 'setStoredApiKey options');
ok(api.includes('persist'), 'api persist path');
ok(html.includes('settings-api-key-persist'), 'settings persist checkbox');
ok(keywiz.includes('key-wizard-persist'), 'wizard persist checkbox');
ok(html.includes('openKeyWizard'), 'settings opens key wizard');

// P1-3 offline quality
const agent = read('js/modules/slices/coach/agent.js');
ok(agent.includes('function buildOfflineAgentReply'), 'offline reply');
ok(agent.includes('進度 ${cur + 1}/${total}') || agent.includes('進度'), 'offline progress');
ok(agent.includes('新人 5 分鐘路徑') || agent.includes('5 分鐘'), 'offline 5min path hint');

// P1-6 support
const support = read('js/modules/slices/ui/support.js');
const manifest = JSON.parse(read('js/modules/slices/manifest.json'));
ok(manifest.core.includes('ui/support.js'), 'manifest support');
ok(support.includes('openReportIssue'), 'openReportIssue');
ok(support.includes('support_report'), 'analytics support_report');
ok(html.includes('report-issue-overlay'), 'report overlay');
ok(html.includes('openReportIssue'), 'settings report CTA');

const runbook = read('docs/engineering/RUNBOOK.md');
ok(runbook.includes('LUMINA_SUPPORT_EMAIL') || runbook.includes('On-call'), 'runbook contact');
ok(runbook.includes('回報問題') || runbook.includes('support'), 'runbook product path');

// package scripts
const pkg = JSON.parse(read('package.json'));
ok(pkg.scripts['test:rag-golden'], 'npm test:rag-golden');
ok(pkg.scripts['test:e2e-team'], 'npm test:e2e-team');
ok(pkg.scripts['test:phase-p1'], 'npm test:phase-p1');

// Coach attachments (images / files)
const att = read('js/modules/slices/coach/attachments.js');
const htmlCoach = read('lumina-ai.html');
ok(manifest.lazy.includes('coach/attachments.js'), 'manifest coach/attachments');
ok(att.includes('processCoachAttachmentFile'), 'process attachment');
ok(att.includes('pinPendingAttachmentsToTask'), 'pin to task');
ok(att.includes('buildAttachmentsContextText'), 'AI attach context');
ok(htmlCoach.includes('coach-attach-input'), 'composer file input');
ok(htmlCoach.includes('openCoachAttachPicker'), 'attach picker action');
ok(agent.includes('pendingAtt') || agent.includes('takeCoachPendingAttachmentsForSend'), 'send uses attachments');
ok(agent.includes('renderMessageAttachmentsHtml') || agent.includes('attachments'), 'render att in thread');

if (failed) {
    console.error(`\n${failed} P1 checks failed`);
    process.exit(1);
}
console.log('\nP1 phase smoke passed');
process.exit(0);
