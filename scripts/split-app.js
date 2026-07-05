/**
 * Split js/lumina-app.js into maintainable source modules.
 * Run: node scripts/split-app.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'js', 'lumina-app.js'), 'utf8');
const lines = src.split(/\r?\n/);

const parts = [
    {
        file: 'js/src/lumina-state.js',
        start: 1,
        end: 2403,
        banner: '/* Lumina module: state, auth, focus, scoring */'
    },
    {
        file: 'js/src/lumina-data.js',
        start: 2404,
        end: 5224,
        banner: '/* Lumina module: storage, API, enterprise, RAG sync */'
    },
    {
        file: 'js/src/lumina-ui.js',
        start: 5225,
        end: 6763,
        banner: '/* Lumina module: navigation, dashboard, scheduler, coach */'
    },
    {
        file: 'js/src/lumina-boot.js',
        start: 6764,
        end: lines.length,
        banner: '/* Lumina module: init, shortcuts, boot */'
    }
];

fs.mkdirSync(path.join(root, 'js', 'src'), { recursive: true });

for (const part of parts) {
    const chunk = lines.slice(part.start - 1, part.end).join('\n').trimEnd() + '\n';
    const content = `${part.banner}\n${chunk}`;
    const outPath = path.join(root, part.file);
    fs.writeFileSync(outPath, content);
    console.log(`  ${part.file}: ${part.end - part.start + 1} lines`);
}

console.log('Split complete.');