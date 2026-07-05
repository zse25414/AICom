const fs = require('fs');
const { JSDOM } = require('jsdom');

function inlineAppScripts(html) {
    html = html.replace(/<script src="[^"]+"><\/script>\s*/g, '');
    const scripts = [fs.readFileSync('js/lumina-app.js', 'utf8')];
    for (const chunk of ['lumina-coach.js', 'lumina-enterprise-docs.js']) {
        const path = `js/chunks/${chunk}`;
        if (fs.existsSync(path)) scripts.push(fs.readFileSync(path, 'utf8'));
    }
    const tags = scripts.map(s => `<script>${s}</script>`).join('\n');
    return html.replace('</body>', `${tags}\n</body>`);
}

let html = inlineAppScripts(fs.readFileSync('lumina-ai.html', 'utf8'));

const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'http://localhost:3456/lumina-ai.html',
    pretendToBeVisual: true
});

const { window } = dom;

window.localStorage = {
    _data: {},
    getItem(k) { return k in this._data ? this._data[k] : null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; },
    clear() { this._data = {}; }
};
window.sessionStorage = {
    _data: {},
    getItem(k) { return k in this._data ? this._data[k] : null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; },
    clear() { this._data = {}; }
};
window.fetch = async () => ({ ok: true, json: async () => ({}) });
window.navigator.serviceWorker = { register: async () => ({}) };
window.crypto = require('crypto').webcrypto;
window.HTMLCanvasElement.prototype.getContext = () => null;
window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,test';
window.URL.createObjectURL = () => 'blob:mock';
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
window.cancelAnimationFrame = (id) => clearTimeout(id);
window.requestIdleCallback = (cb) => setTimeout(cb, 0);

const tests = [];

function assert(name, cond) {
    tests.push({ name, ok: !!cond });
}

setTimeout(() => {
    assert('sanitizeHtml strips script', !window.sanitizeHtml('<img onerror=alert(1) src=x>').includes('onerror'));
    assert('sanitizeHtml keeps br', window.sanitizeHtml('a<br>b').includes('<br>'));
    assert('sanitizeHtml keeps strong', window.sanitizeHtml('<strong>x</strong>').includes('<strong>'));
    assert('isSafeHttpUrl accepts http', window.isSafeHttpUrl('http://localhost:3001/api/chat'));
    assert('isSafeHttpUrl rejects javascript', !window.isSafeHttpUrl('javascript:alert(1)'));
    assert('isSafeHttpUrl rejects data', !window.isSafeHttpUrl('data:text/html,<script>alert(1)</script>'));
    assert('recalculateInsights exists', typeof window.recalculateInsights === 'function');
    assert('clearApiKey exists', typeof window.clearApiKey === 'function');
    assert('mergeTasksArrays prefers newer updatedAt', (() => {
        const merged = window.mergeTasksArrays(
            [{ id: 1, name: 'server', updatedAt: '2026-01-01T00:00:00.000Z' }],
            [{ id: 1, name: 'local', updatedAt: '2026-06-01T00:00:00.000Z' }]
        );
        return merged.length === 1 && merged[0].name === 'local';
    })());

    const failed = tests.filter(t => !t.ok);
    if (failed.length) {
        console.log('SECURITY CHECK FAILED:');
        failed.forEach(t => console.log(' -', t.name));
        process.exit(1);
    }
    console.log('All security checks passed (' + tests.length + ')');
    process.exit(0);
}, 150);