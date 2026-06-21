const fs = require('fs');
const html = fs.readFileSync('lumina-ai.html', 'utf8');
const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
const script = html.match(/<script>([\s\S]*)<\/script>\s*<\/body>/)[1];
const unsafe = [];
const re = /document\.getElementById\('([^']+)'\)\.(\w+)/g;
let m;
while ((m = re.exec(script)) !== null) {
  const id = m[1];
  if (!ids.has(id)) {
    unsafe.push({ id, prop: m[2], line: script.slice(0, m.index).split('\n').length });
  }
}
console.log('Unsafe refs to missing IDs (' + unsafe.length + '):');
unsafe.forEach(u => console.log('  L' + u.line + ': ' + u.id + '.' + u.prop));