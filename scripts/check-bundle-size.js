/**
 * Bundle size gate for lazy production builds.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
// 2026-07-18：enterprise/team.js 拆入 lazy chunk 後主包下降、enterprise-docs 上升。
// 上限 = 實測 + ~8% headroom（主 205、coach 90、enterprise 96）。
const limits = {
    'js/lumina-app.js': 220 * 1024,
    'js/chunks/lumina-coach.js': 98 * 1024,
    'js/chunks/lumina-enterprise-docs.js': 105 * 1024
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