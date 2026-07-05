/**
 * Bundle Lumina ESM modules → js/lumina-app.js (+ optional lazy chunks)
 */
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const modulesDir = path.join(root, 'js', 'modules');
const slicesDir = path.join(modulesDir, 'slices');
const manifestPath = path.join(slicesDir, 'manifest.json');
const chunksDir = path.join(root, 'js', 'chunks');

function readSlice(rel) {
    return fs.readFileSync(path.join(slicesDir, rel), 'utf8').trim();
}

function scanFunctions(code) {
    const names = [];
    const re = /^(?:async )?function (\w+)\s*\(/gm;
    let m;
    while ((m = re.exec(code)) !== null) names.push(m[1]);
    return names;
}

function mergeSliceCode(sliceFiles) {
    return sliceFiles.map(readSlice).join('\n\n');
}

function wrapChunkModule(name, sliceFiles) {
    const code = mergeSliceCode(sliceFiles);
    const fns = scanFunctions(code);
    return {
        name,
        code: `/**
 * Lumina — ${name} (auto-generated)
 */
import * as C from '../core/constants.js';
import { S } from '../core/store.js';

${code}

export const __exports = { ${fns.join(', ')} };
export function registerChunkGlobals() {
    const fns = { ${fns.join(', ')} };
    for (const [key, val] of Object.entries(fns)) {
        if (typeof val === 'function') {
            window[key] = val;
            window.registerLuminaAction?.(key, val);
        }
    }
}
registerChunkGlobals();
`,
        fns
    };
}

function generateLazyStubs(lazyGroups) {
    const lines = [];
    lines.push('const __luminaChunkCache = {};');
    for (const [chunk, files] of Object.entries(lazyGroups)) {
        const fns = files.flatMap(f => scanFunctions(readSlice(f)));
        lines.push(`const __lazy_${chunk.replace(/-/g, '_')} = ${JSON.stringify(fns)};`);
        lines.push(`function __loadChunk_${chunk.replace(/-/g, '_')}() {`);
        lines.push(`  if (__luminaChunkCache['${chunk}']) return __luminaChunkCache['${chunk}'];`);
        lines.push(`  __luminaChunkCache['${chunk}'] = new Promise((resolve, reject) => {`);
        lines.push(`    const s = document.createElement('script');`);
        lines.push(`    s.src = 'js/chunks/lumina-${chunk}.js';`);
        lines.push(`    s.onload = () => resolve(window.__luminaChunks['${chunk}']);`);
        lines.push(`    s.onerror = () => reject(new Error('Failed to load ${chunk} chunk'));`);
        lines.push(`    document.head.appendChild(s);`);
        lines.push(`  });`);
        lines.push(`  return __luminaChunkCache['${chunk}'];`);
        lines.push('}');
        for (const fn of fns) {
            lines.push(`if (typeof window['${fn}'] !== 'function') {`);
            lines.push(`  window['${fn}'] = async function(...args) {`);
            lines.push(`    await __loadChunk_${chunk.replace(/-/g, '_')}();`);
            lines.push(`    return window['${fn}']?.(...args);`);
            lines.push(`  };`);
            lines.push('}');
        }
    }
    lines.push(`window.__luminaEnsureCoach = () => __loadChunk_coach();`);
    lines.push(`window.__luminaEnsureEnterprise = () => __loadChunk_enterprise_docs();`);
    lines.push(`window.__luminaPreloadSection = async (section) => {`);
    lines.push(`  if (section === 'coach' || section === 'scheduler') await __loadChunk_coach();`);
    lines.push(`  if (section === 'team') await __loadChunk_enterprise_docs();`);
    lines.push(`};`);
    return lines.join('\n');
}

const LAZY_TEST_EXPORTS = [
    'initializeApp', 'showSection', 'renderTaskList', 'optimizeSchedule',
    'openDecomposeTab', 'sanitizeHtml', 'isSafeHttpUrl', 'recalculateInsights',
    'clearApiKey', 'mergeTasksArrays', 'toggleDashStats'
];

function collectActionNamesFromSource(text) {
    const names = new Set();
    for (const m of text.matchAll(/data-lumina-action="(\w+)"/g)) names.add(m[1]);
    for (const m of text.matchAll(/data-lumina-dismiss="(\w+)"/g)) names.add(m[1]);
    for (const m of text.matchAll(/data-lumina-submit="(\w+)"/g)) names.add(m[1]);
    for (const m of text.matchAll(/data-lumina-change="(\w+)"/g)) names.add(m[1]);
    for (const m of text.matchAll(/data-lumina-keydown="(\w+)"/g)) names.add(m[1]);
    for (const m of text.matchAll(/luminaAction\(\s*'(\w+)'/g)) names.add(m[1]);
    for (const m of text.matchAll(/luminaAction\(\s*"(\w+)"/g)) names.add(m[1]);
    for (const m of text.matchAll(/luminaAction\(\s*(\w+)/g)) names.add(m[1]);
    for (const m of text.matchAll(/luminaChange\(\s*'(\w+)'/g)) names.add(m[1]);
    for (const m of text.matchAll(/data-lumina-actions='([^']+)'/g)) {
        try {
            JSON.parse(m[1]).forEach(([n]) => names.add(n));
        } catch (_) {}
    }
    for (const m of text.matchAll(/actions:\s*\[([^\]]+)\]/g)) {
        for (const n of m[1].matchAll(/'(\w+)'/g)) names.add(n[1]);
    }
    return names;
}

function collectAllActionNames(manifest) {
    const names = new Set();
    collectActionNamesFromSource(fs.readFileSync(path.join(root, 'lumina-ai.html'), 'utf8')).forEach((n) => names.add(n));
    for (const rel of manifest.core) {
        const file = path.join(slicesDir, rel);
        if (fs.existsSync(file)) {
            collectActionNamesFromSource(fs.readFileSync(file, 'utf8')).forEach((n) => names.add(n));
        }
    }
    return names;
}

function collectLazyWindowExports(coreFns, manifest) {
    const names = collectAllActionNames(manifest);
    LAZY_TEST_EXPORTS.forEach((n) => names.add(n));
    const coreSet = new Set(coreFns);
    const reserved = new Set(['true', 'false', 'isLast', 'undefined', 'null']);
    return [...names].filter((n) => coreSet.has(n) && !reserved.has(n)).sort();
}

async function build() {
    if (!fs.existsSync(manifestPath)) {
        console.error('Missing manifest. Run: node scripts/reorganize-slices.js');
        process.exit(1);
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const inlineChunks = process.env.LUMINA_LAZY !== '1';

    const lazyGroups = {
        coach: manifest.lazy.filter(f => f.startsWith('coach/')),
        'enterprise-docs': manifest.lazy.filter(f => f.startsWith('enterprise/'))
    };

    const coreCode = mergeSliceCode(manifest.core);
    const coachMod = wrapChunkModule('coach', lazyGroups.coach);
    const entMod = wrapChunkModule('enterprise-docs', lazyGroups['enterprise-docs']);
    const coreFns = scanFunctions(coreCode);
    const allLazyFns = [...coachMod.fns, ...entMod.fns];

    fs.mkdirSync(path.join(modulesDir, 'generated'), { recursive: true });

    const lazyBridge = generateLazyStubs(inlineChunks ? {} : lazyGroups);
    const patchNav = `
const __origShowSection = showSection;
showSection = async function(section) {
    await window.__luminaPreloadSection?.(section);
    return __origShowSection(section);
};
window.showSection = showSection;
`;

    let mainEntry;
    const allFns = [...new Set([...coreFns, ...allLazyFns])];

    if (inlineChunks) {
        const body = [coreCode, mergeSliceCode(manifest.lazy)].join('\n\n');
        fs.writeFileSync(
            path.join(modulesDir, 'generated', 'bundle.js'),
            `/** Lumina inline bundle (auto-generated) */
import * as C from '../core/constants.js';
import { S } from '../core/store.js';

${body}

window.__luminaPreloadSection = async () => {};
window.__luminaEnsureCoach = async () => {};
window.__luminaEnsureEnterprise = async () => {};
export function registerAllGlobals() {
    const fns = { ${allFns.join(', ')} };
    for (const [key, val] of Object.entries(fns)) {
        if (typeof val === 'function') window[key] = val;
    }
    window.initializeApp = initializeApp;
    window.onload = () => initializeApp().catch((e) => {
        console.error('[Lumina] Fatal init', e);
        if (typeof showToast === 'function') showToast('應用程式啟動失敗，請重新整理', 'error');
    });
    window.lumina = () => triggerConfetti();
}
registerAllGlobals();
`
        );
    } else {
        fs.writeFileSync(path.join(modulesDir, 'generated', 'coach.js'), coachMod.code);
        fs.writeFileSync(path.join(modulesDir, 'generated', 'enterprise-docs.js'), entMod.code);
        fs.writeFileSync(
            path.join(modulesDir, 'generated', 'app.js'),
            `/** Lumina core bundle (auto-generated) */
import * as C from '../core/constants.js';
import { S } from '../core/store.js';

${coreCode}

${lazyBridge}
${patchNav}
${collectLazyWindowExports(coreFns, manifest).map((n) => `registerLuminaAction('${n}', ${n});`).join('\n')}
${LAZY_TEST_EXPORTS.filter((n) => coreFns.includes(n)).map((n) => `window['${n}'] = ${n};`).join('\n')}
window.initializeApp = initializeApp;
window.onload = () => initializeApp().catch((e) => {
    console.error('[Lumina] Fatal init', e);
    if (typeof showToast === 'function') showToast('應用程式啟動失敗，請重新整理', 'error');
});
window.lumina = () => triggerConfetti();
`
        );
    }

    fs.writeFileSync(
        path.join(root, 'js', 'main.js'),
        `/** Lumina entry */\nimport './modules/generated/${inlineChunks ? 'bundle' : 'app'}.js';\nimport { LuminaVirtual } from './modules/virtual/list.js';\nif (typeof window !== 'undefined') window.LuminaVirtual = LuminaVirtual;\n`
    );

    const prod = process.env.NODE_ENV === 'production';
    await esbuild.build({
        entryPoints: [path.join(root, 'js', 'main.js')],
        bundle: true,
        format: 'iife',
        outfile: path.join(root, 'js', 'lumina-app.js'),
        platform: 'browser',
        target: ['es2020'],
        minify: prod,
        legalComments: 'none',
        banner: { js: '/** Lumina AI — bundled (npm run build:app) */' },
        logLevel: 'warning'
    });

    if (!inlineChunks) {
        fs.mkdirSync(chunksDir, { recursive: true });
        for (const [chunk, mod] of [['coach', coachMod], ['enterprise-docs', entMod]]) {
            const chunkEntry = path.join(modulesDir, 'generated', `entry-${chunk}.js`);
            fs.writeFileSync(chunkEntry, mod.code + `\nwindow.__luminaChunks = window.__luminaChunks || {};\nwindow.__luminaChunks['${chunk}'] = { ${mod.fns.join(', ')} };\n`);
            await esbuild.build({
                entryPoints: [chunkEntry],
                bundle: true,
                format: 'iife',
                outfile: path.join(chunksDir, `lumina-${chunk}.js`),
                platform: 'browser',
                target: ['es2020'],
                minify: prod,
                legalComments: 'none',
                logLevel: 'warning'
            });
        }
    }

    const stats = fs.statSync(path.join(root, 'js', 'lumina-app.js'));
    const sliceCount = manifest.core.length + manifest.lazy.length;
    console.log(`Built js/lumina-app.js (${Math.round(stats.size / 1024)} KB, ${sliceCount} slices, inline=${inlineChunks})`);
}

build().catch((err) => {
    console.error(err);
    process.exit(1);
});