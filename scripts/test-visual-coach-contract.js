/**
 * Phase 3: static visual/layout contracts for coach (prevents known regressions).
 * No browser — greps built CSS + source HTML/JS.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
let failed = 0;
function ok(c, m) {
    if (c) console.log('OK', m);
    else { console.error('FAIL', m); failed++; }
}

const css = fs.readFileSync(path.join(root, 'css/lumina.css'), 'utf8');
const agent = fs.readFileSync(path.join(root, 'js/modules/slices/coach/agent.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'lumina-ai.html'), 'utf8');

// Input: single-line default, not multi-row textarea default
ok(html.includes('id="chat-input"') && html.includes('rows="1"'), 'chat-input rows=1');
ok(css.includes('field-sizing: fixed') || css.includes('--coach-line'), 'input height tokens');
ok(/\.coach-chat-input[\s\S]{0,400}max-height:\s*calc\(var\(--coach-fs\) \* var\(--coach-line\) \* 6\)/.test(css)
    || css.includes('* 6)'), 'input max 6 lines');

// User bubble: fit-content horizontal, not collapse
ok(css.includes('width: fit-content') && css.includes('.coach-agent-msg-user'), 'user bubble fit-content');
ok(css.includes('word-break: normal') && css.includes('/* do not break CJK'), 'user bubble word-break normal');

// Render path splits user vs coach (no min-w-0 on user)
ok(agent.includes("m.role === 'user'"), 'user branch in render');
ok(agent.includes('coach-agent-msg-user'), 'user class emitted');
const userBlock = agent.split("m.role === 'user'")[1]?.slice(0, 500) || '';
ok(!userBlock.includes('min-w-0'), 'user branch avoids min-w-0');

// Chunk error UI
ok(css.includes('coach-chunk-error'), 'chunk error styles');
ok(fs.existsSync(path.join(root, 'js/modules/slices/utils/chunk-errors.js')), 'chunk-errors.js');

// Tokens doc
ok(fs.existsSync(path.join(root, 'docs/UI-COACH.md')), 'UI-COACH.md');

if (failed) {
    console.error(`Visual coach contracts FAILED: ${failed}`);
    process.exit(1);
}
console.log('Visual coach contracts passed');
process.exit(0);
