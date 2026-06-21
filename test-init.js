const fs = require('fs');
const { JSDOM } = require('jsdom');

let html = fs.readFileSync('lumina-ai.html', 'utf8');
// Strip external scripts that block or fail in JSDOM
html = html.replace(/<script src="[^"]+"><\/script>\s*/g, '');

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  url: 'http://localhost:3456/lumina-ai.html',
  pretendToBeVisual: true
});

const { window } = dom;
const errors = [];

window.addEventListener('error', (e) => {
  errors.push({ type: 'error', message: e.message, stack: e.error?.stack });
});

window.tailwind = { config: {} };

const store = {};
window.localStorage.getItem = (k) => (k in store ? store[k] : null);
window.localStorage.setItem = (k, v) => { store[k] = String(v); };
window.localStorage.removeItem = (k) => { delete store[k]; };

window.fetch = async () => ({
  ok: true,
  text: async () => JSON.stringify({ choices: [{ message: { content: 'ok' } }] })
});

window.navigator.serviceWorker = { register: async () => ({}) };
window.HTMLCanvasElement.prototype.getContext = function () {
  return {
    createLinearGradient: () => ({ addColorStop() {} }),
    fillStyle: '',
    beginPath() {},
    roundRect() {},
    fill() {},
    fillRect() {},
    font: '',
    textAlign: '',
    textBaseline: '',
    fillText() {}
  };
};
window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,test';
window.URL.createObjectURL = () => 'blob:mock';
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
window.scrollTo = () => {};

function runTests() {
  if (typeof window.initializeApp !== 'function') {
    console.log('initializeApp not found');
    process.exit(1);
  }

  try {
    window.initializeApp();
  } catch (e) {
    errors.push({ type: 'init', message: e.message, stack: e.stack });
  }

  const navTests = ['dashboard', 'scheduler', 'coach', 'insights', 'team', 'guide', 'settings'];
  for (const section of navTests) {
    try {
      window.showSection(section);
    } catch (e) {
      errors.push({ type: 'nav:' + section, message: e.message, stack: e.stack });
    }
  }

  try {
    window.renderTaskList();
    window.optimizeSchedule(true);
    window.openDecomposeTab();
    window.decomposeGoal?.();
  } catch (e) {
    if (e.message && !e.message.includes('請輸入')) {
      errors.push({ type: 'feature', message: e.message, stack: e.stack });
    }
  }

  if (errors.length) {
    console.log('ERRORS (' + errors.length + '):');
    errors.forEach((e, i) => {
      console.log('\n#' + (i + 1), e.type, e.message);
      if (e.stack) console.log(e.stack.split('\n').slice(0, 5).join('\n'));
    });
    process.exit(1);
  }

  console.log('All smoke tests passed');
  process.exit(0);
}

setTimeout(runTests, 200);