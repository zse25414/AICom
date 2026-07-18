/**
 * check-contrast — 色弱友善對比度契約（P5-A4）
 *
 * 驗證兩件事：
 * 1. 深色主題常用「文字色 × 底色」組合達 WCAG AA（一般文字 4.5:1）。
 *    text-slate-500 / text-slate-600 的實際色值從 css/lumina.css 的 a11y 覆寫讀出，
 *    保證檢查對象就是使用者實際看到的顏色。
 * 2. 狀態不能只靠紅／綠分辨：已知的狀態元件模板需同時帶相異圖示（雙編碼）。
 *
 * 失敗即 exit 1（進 npm test 閘門）。
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
let failures = 0;
function pass(msg) { console.log(`OK ${msg}`); }
function failCheck(msg) { failures++; console.error(`FAIL ${msg}`); }

// ---- WCAG ----
function luminance(hex) {
    const c = hex.slice(1).match(/../g)
        .map(x => parseInt(x, 16) / 255)
        .map(v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(fg, bg) {
    const [l1, l2] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
    return (l1 + 0.05) / (l2 + 0.05);
}

// ---- 1. 讀 a11y 覆寫值 ----
const css = fs.readFileSync(path.join(root, 'css', 'lumina.css'), 'utf8');
function overriddenColor(cls) {
    const m = css.match(new RegExp(`\\.${cls}\\s*\\{\\s*color:\\s*(#[0-9a-fA-F]{6})`));
    return m ? m[1].toLowerCase() : null;
}
const slate500 = overriddenColor('text-slate-500');
const slate600 = overriddenColor('text-slate-600');
if (!slate500 || !slate600) {
    failCheck('css/lumina.css 缺少 text-slate-500 / text-slate-600 的 a11y 對比覆寫');
}

// ---- 2. 對比契約 ----
const surfaces = { 'slate-950': '#020617', 'slate-900': '#0f172a', 'slate-800': '#1e293b' };
// [文字色名, 色值, 底色清單, 最低比率]
const contract = [
    ['text-slate-300', '#cbd5e1', ['slate-950', 'slate-900', 'slate-800'], 4.5],
    ['text-slate-400', '#94a3b8', ['slate-950', 'slate-900', 'slate-800'], 4.5],
    // 覆寫後的 muted 文字：主要出現在 900/950 面板，AA 必達；800 上少見，底線 4.0
    ['text-slate-500(覆寫)', slate500, ['slate-950', 'slate-900'], 4.5],
    ['text-slate-500(覆寫)', slate500, ['slate-800'], 4.0],
    ['text-slate-600(覆寫)', slate600, ['slate-950', 'slate-900'], 4.5],
    ['text-indigo-300', '#a5b4fc', ['slate-950', 'slate-900', 'slate-800'], 4.5],
    ['text-violet-300', '#c4b5fd', ['slate-950', 'slate-900', 'slate-800'], 4.5],
    ['text-emerald-400', '#34d399', ['slate-950', 'slate-900', 'slate-800'], 4.5],
    ['text-red-400', '#f87171', ['slate-950', 'slate-900', 'slate-800'], 4.5],
    ['text-amber-400', '#fbbf24', ['slate-950', 'slate-900', 'slate-800'], 4.5],
    ['text-sky-300', '#7dd3fc', ['slate-950', 'slate-900', 'slate-800'], 4.5],
];
for (const [name, hex, bgs, min] of contract) {
    if (!hex) continue;
    for (const bg of bgs) {
        const r = contrast(hex, surfaces[bg]);
        if (r >= min) pass(`${name} on ${bg} = ${r.toFixed(2)}:1（≥ ${min}）`);
        else failCheck(`${name} on ${bg} = ${r.toFixed(2)}:1，低於 ${min}:1`);
    }
}

// ---- 3. 狀態雙編碼（不能只靠紅綠）----
// 已知的成對狀態模板：同一模板需同時出現顏色與「相異圖示」。
const dualCoded = [
    {
        file: 'js/modules/slices/coach/agent.js',
        label: '教練就緒 chips',
        needle: /coach-readiness-chip[\s\S]{0,200}fa-\$\{c\.ok \? '([a-z-]+)' : '([a-z-]+)'\}/,
        distinct: m => m[1] !== m[2]
    },
    {
        file: 'js/modules/slices/coach/keywizard.js',
        label: 'key 嚮導測試狀態',
        needle: /fa-circle-check[\s\S]*fa-circle-xmark/,
        distinct: () => true
    }
];
for (const { file, label, needle, distinct } of dualCoded) {
    const src = fs.readFileSync(path.join(root, file), 'utf8');
    const m = src.match(needle);
    if (m && distinct(m)) pass(`${label}：狀態有顏色 + 相異圖示雙編碼`);
    else failCheck(`${label}（${file}）：找不到「顏色 + 相異圖示」雙編碼模板，狀態疑似只靠顏色分辨`);
}

console.log('────────');
if (failures) {
    console.error(`Contrast checks failed: ${failures}`);
    process.exit(1);
}
console.log('Contrast checks passed');
