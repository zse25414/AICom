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
const errors = [];

window.addEventListener('error', (e) => {
  errors.push({ type: 'error', message: e.message, stack: e.error?.stack });
});

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
window.requestAnimationFrame = (cb) => setTimeout(cb, 0);
window.cancelAnimationFrame = (id) => clearTimeout(id);
window.requestIdleCallback = (cb) => setTimeout(cb, 0);

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

  try {
    let delegationHits = 0;
    const origToggle = window.toggleDashStats;
    window.toggleDashStats = function () {
      delegationHits++;
      return origToggle?.apply(this, arguments);
    };
    const delegateBtn = window.document.querySelector('[data-lumina-action="toggleDashStats"]');
    if (!delegateBtn) {
      errors.push({ type: 'delegation', message: 'toggleDashStats button missing data-lumina-action' });
    } else {
      delegateBtn.click();
      if (delegationHits !== 1) {
        errors.push({ type: 'delegation', message: `expected 1 delegated click, got ${delegationHits}` });
      }
    }
  } catch (e) {
    errors.push({ type: 'delegation', message: e.message, stack: e.stack });
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
    window.optimizeSchedule(true, true);
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