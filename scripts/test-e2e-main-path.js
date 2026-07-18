/**
 * Phase 3: main-path E2E (jsdom) — create task → coach start → complete.
 * Mirrors test-init boot, then exercises product functions.
 */
const fs = require('fs');
const { JSDOM } = require('jsdom');

function inlineAppScripts(html) {
    html = html.replace(/<script\b[^>]*\bsrc=["'][^"']+["'][^>]*>\s*<\/script>\s*/gi, '');
    const scripts = [fs.readFileSync('js/lumina-app.js', 'utf8')];
    for (const chunk of ['lumina-coach.js', 'lumina-enterprise-docs.js']) {
        const p = `js/chunks/${chunk}`;
        if (fs.existsSync(p)) scripts.push(fs.readFileSync(p, 'utf8'));
    }
    const tags = scripts.map(s => {
        const safe = s.replace(/<\/script/gi, '<\\/script');
        return `<script>${safe}</script>`;
    }).join('\n');
    return html.replace('</body>', `${tags}\n</body>`);
}

let html = inlineAppScripts(fs.readFileSync('lumina-ai.html', 'utf8'));
const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'http://localhost:3456/lumina-ai.html',
    pretendToBeVisual: true
});
const { window } = dom;
const errors = [];
window.addEventListener('error', (e) => {
    errors.push({ type: 'error', message: e.message });
});

const store = {};
window.localStorage.getItem = (k) => (k in store ? store[k] : null);
window.localStorage.setItem = (k, v) => { store[k] = String(v); };
window.localStorage.removeItem = (k) => { delete store[k]; };
const sess = {};
window.sessionStorage.getItem = (k) => (k in sess ? sess[k] : null);
window.sessionStorage.setItem = (k, v) => { sess[k] = String(v); };
window.sessionStorage.removeItem = (k) => { delete sess[k]; };

window.fetch = async (url, opts) => {
    const u = String(url || '');
    // Default mock: DeepSeek-shaped chat completion
    if (u.includes('/api/chat') || u.includes('deepseek') || (opts && opts.method === 'POST')) {
        return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({
                choices: [{ message: { content: '好的，先做第一步。\n[選項: 完成這步]\n[選項: 卡住了]' } }],
                usage: { prompt_tokens: 20, completion_tokens: 15 }
            }),
            json: async () => ({
                choices: [{ message: { content: 'ok' } }],
                answer: 'mock answer',
                sources: []
            })
        };
    }
    return { ok: true, status: 200, text: async () => '{}', json: async () => ({}) };
};

window.navigator.serviceWorker = { register: async () => ({}) };
if (window.HTMLCanvasElement) {
    window.HTMLCanvasElement.prototype.getContext = function () {
        return {
            createLinearGradient: () => ({ addColorStop() {} }),
            fillStyle: '', beginPath() {}, roundRect() {}, fill() {}, fillRect() {},
            font: '', textAlign: '', textBaseline: '', fillText() {}
        };
    };
    window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,test';
}
window.URL.createObjectURL = () => 'blob:mock';
window.URL.revokeObjectURL = () => {};
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
window.scrollTo = () => {};
window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
window.cancelAnimationFrame = (id) => clearTimeout(id);
window.requestIdleCallback = (cb) => setTimeout(cb, 0);
// confetti / transitions
if (window.Element && !window.Element.prototype.animate) {
    window.Element.prototype.animate = function () {
        return { onfinish: null, finished: Promise.resolve(), cancel() {} };
    };
}
window.confirm = () => true;

function fail(msg) {
    console.error('E2E FAIL:', msg);
    process.exit(1);
}

async function run() {
    if (typeof window.initializeApp !== 'function') fail('initializeApp missing');
    const initRet = window.initializeApp();
    if (initRet && typeof initRet.then === 'function') await initRet;
    await new Promise(r => setTimeout(r, 120));

    // Store is globalThis singleton (see docs/engineering/STATE-CONTRACT.md)
    const appStore = window.__LUMINA_STORE__ || window.globalThis?.__LUMINA_STORE__;
    if (!appStore || typeof appStore !== 'object') {
        fail('store missing: ' + typeof window.__LUMINA_STORE__);
    }
    if (!Array.isArray(appStore.tasks)) appStore.tasks = [];
    const store = appStore;

    // Enable API for coach AI path (still mocked fetch)
    store.userProfile = store.userProfile || {};
    store.userProfile.apiEnabled = true;
    store.userProfile.apiMode = 'proxy';
    store.userProfile.apiProxyUrl = 'http://localhost:3001/api/chat';

    // 1) Create task via quickAdd
    const input = window.document.getElementById('quick-task-input');
    if (!input) fail('quick-task-input missing');
    input.value = 'E2E 主路徑任務';
    const today = window.document.getElementById('quick-task-today');
    if (today) today.checked = true;
    if (typeof window.quickAddTask !== 'function') fail('quickAddTask missing');
    window.quickAddTask();

    if (!store.tasks.some(t => t.name === 'E2E 主路徑任務' && !t.completed)) {
        fail('task not created');
    }
    console.log('OK task_created');

    // 2) Open coach + begin guided session
    const task = store.tasks.find(t => t.name === 'E2E 主路徑任務');
    store.todayFocusTaskId = task.id;
    if (typeof window.showSection === 'function') window.showSection('coach');
    await new Promise(r => setTimeout(r, 80));

    if (typeof window.coachBeginGuidedSession !== 'function') fail('coachBeginGuidedSession missing (chunk?)');
    window.coachBeginGuidedSession();
    await new Promise(r => setTimeout(r, 30));

    if (!store.focusSession || !store.focusSession.coachActive) fail('focusSession not coachActive');
    if (!store.coachAgentMessages || !store.coachAgentMessages.length) fail('no coach opening message');
    console.log('OK coach_start');

    // 3) User bubble width contract: render a short message and check class
    if (typeof window.pushCoachAgentMessage === 'function') {
        window.pushCoachAgentMessage('user', '你是誰');
        if (typeof window.renderCoachAgentThread === 'function') window.renderCoachAgentThread();
        const userBubble = window.document.querySelector('.coach-agent-msg-user');
        if (!userBubble) fail('user bubble not rendered');
        // Must not wrap in min-w-0 flex that collapses CJK
        if (userBubble.querySelector('.min-w-0')) fail('user bubble has min-w-0 child');
        console.log('OK user_bubble_structure');
    }

    // 4) Complete task
    if (typeof window.toggleTaskComplete !== 'function') fail('toggleTaskComplete missing');
    window.toggleTaskComplete(task.id, { checked: true }, true, true);
    const done = store.tasks.find(t => t.id === task.id);
    if (!done || !done.completed) fail('task not completed');
    console.log('OK task_completed');

    // 5) Analytics main path (best-effort)
    if (typeof window.getAnalyticsSummary === 'function') {
        const sum = window.getAnalyticsSummary();
        if (!sum.counts || !sum.counts.task_created) {
            console.warn('WARN analytics task_created not counted (ok if track path differs)');
        } else {
            console.log('OK analytics has task_created');
        }
    }

    // 6) Usage meter exists in settings DOM
    window.showSection('settings');
    if (typeof window.renderUsageMeter === 'function') window.renderUsageMeter();
    const meter = window.document.getElementById('usage-meter-panel');
    if (!meter) fail('usage-meter-panel missing');
    console.log('OK usage_panel');

    if (errors.length) {
        console.error('Window errors:', errors);
        process.exit(1);
    }

    console.log('E2E main path passed');
    process.exit(0);
}

setTimeout(() => {
    run().catch(e => {
        console.error('E2E crashed', e);
        process.exit(1);
    });
}, 250);
