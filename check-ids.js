const fs = require('fs');
const html = fs.readFileSync('lumina-ai.html', 'utf8');
const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
const script = html.match(/<script>([\s\S]*)<\/script>\s*<\/body>/)[1];
const refs = [...script.matchAll(/getElementById\('([^']+)'\)/g)].map(m => m[1]);
const missing = [...new Set(refs)].filter(r => !ids.has(r)).sort();
console.log('Missing IDs (' + missing.length + '):');
missing.forEach(m => console.log(' -', m));