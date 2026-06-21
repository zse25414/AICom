const fs = require('fs');
const html = fs.readFileSync('lumina-ai.html', 'utf8');
const script = html.match(/<script>([\s\S]*)<\/script>\s*<\/body>/)[1];
const fns = new Set([...script.matchAll(/function\s+(\w+)/g)].map(m => m[1]));
const calls = [...html.matchAll(/onclick="([^"]+)"/g)].map(m => m[1]);
const missing = [];
for (const c of calls) {
  const fn = c.replace(/\(.*/, '').trim();
  if (fn && !fns.has(fn) && fn !== 'event') missing.push(fn + ' -> ' + c);
}
const uniq = [...new Set(missing)];
console.log('Potentially missing handlers (' + uniq.length + '):');
uniq.forEach(m => console.log(' -', m));