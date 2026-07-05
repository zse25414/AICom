/**
 * 檢查前端 JS 是否引用 HTML 中不存在的 element id
 */
const fs = require('fs');
const path = require('path');

const root = __dirname;
const html = fs.readFileSync(path.join(root, 'lumina-ai.html'), 'utf8');
const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));

function collectJsFiles(dir, acc = []) {
    if (!fs.existsSync(dir)) return acc;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory() && entry.name !== 'generated') collectJsFiles(full, acc);
        else if (entry.name.endsWith('.js') && !full.includes('generated')) acc.push(full);
    }
    return acc;
}

const scriptFiles = [
    path.join(root, 'js', 'modules', 'virtual', 'list.js'),
    ...collectJsFiles(path.join(root, 'js', 'modules', 'core')),
    ...collectJsFiles(path.join(root, 'js', 'modules', 'slices'))
];

const combined = scriptFiles.map(file => fs.readFileSync(file, 'utf8')).join('\n');

const unsafe = [];
const re = /document\.getElementById\(['"]([^'"]+)['"]\)\.(\w+)/g;
let match;
while ((match = re.exec(combined)) !== null) {
    const id = match[1];
    if (!ids.has(id)) {
        unsafe.push({
            id,
            prop: match[2],
            line: combined.slice(0, match.index).split('\n').length
        });
    }
}

if (unsafe.length) {
    console.log('UNSAFE DOM ID CHECK FAILED (' + unsafe.length + '):');
    unsafe.forEach(u => console.log(`  L${u.line}: ${u.id}.${u.prop}`));
    process.exit(1);
}

console.log('All DOM ID refs safe (' + ids.size + ' ids checked)');
process.exit(0);