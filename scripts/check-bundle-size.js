/**
 * Bundle size gate for lazy production builds.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
// 2026-07-18：enterprise/team.js 拆入 lazy chunk 後主包下降、enterprise-docs 上升。
// 2026-07-18b：coach 市場合約（無任務問答／離線升級）後 coach chunk 略增。
// 上限 = 實測 + ~10% headroom。
const limits = {
    // 2026-07-18d：Phase 0–3 analytics + usage + chunk-errors 進 core
    // 2026-07-18e：P5-A1 key 設定嚮導進 coach chunk（實測 115 KB + headroom）
    // 2026-07-18f：P1 support.js + API key persist 進 core（實測 308 KB + headroom）
    'js/lumina-app.js': 340 * 1024,
    // 2026-07-18g：教練附件 + RAG 選庫 UX
    'js/chunks/lumina-coach.js': 155 * 1024,
    'js/chunks/lumina-enterprise-docs.js': 130 * 1024
};

const failures = [];
for (const [rel, max] of Object.entries(limits)) {
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) {
        failures.push(`${rel}: missing`);
        continue;
    }
    const size = fs.statSync(file).size;
    if (size > max) {
        failures.push(`${rel}: ${Math.round(size / 1024)} KB > ${Math.round(max / 1024)} KB`);
    } else {
        console.log(`OK ${rel}: ${Math.round(size / 1024)} KB`);
    }
}

if (failures.length) {
    console.error('BUNDLE SIZE CHECK FAILED:');
    failures.forEach(f => console.error(' -', f));
    process.exit(1);
}

console.log('Bundle size check passed');
process.exit(0);