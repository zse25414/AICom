const fs = require('fs');
const { JSDOM } = require('jsdom');

let html = fs.readFileSync('lumina-ai.html', 'utf8');
html = html.replace(/<script src="[^"]+"><\/script>\s*/g, '');

const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: 'http://localhost:3456/lumina-ai.html'
});

const { window } = dom;
window.tailwind = { config: {} };
window.localStorage = {
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

    const failed = tests.filter(t => !t.ok);
    if (failed.length) {
        console.log('SECURITY CHECK FAILED:');
        failed.forEach(t => console.log(' -', t.name));
        process.exit(1);
    }
    console.log('All security checks passed (' + tests.length + ')');
    process.exit(0);
}, 100);