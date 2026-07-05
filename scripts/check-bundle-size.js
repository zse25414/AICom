/**
 * Bundle size gate for lazy production builds.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const limits = {
    'js/lumina-app.js': 165 * 1024,
    'js/chunks/lumina-coach.js': 80 * 1024,
    'js/chunks/lumina-enterprise-docs.js': 25 * 1024
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