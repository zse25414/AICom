const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const srcPath = path.join(root, 'lumina-ai.html');
const src = fs.readFileSync(srcPath, 'utf8');

const styleStart = src.indexOf('<style>') + 7;
const styleEnd = src.indexOf('</style>');
const css = src.slice(styleStart, styleEnd).trim();

const scriptTag = '<script>';
const scriptStart = src.lastIndexOf(scriptTag) + scriptTag.length;
const scriptEnd = src.lastIndexOf('</script>');
const js = src.slice(scriptStart, scriptEnd).trim();

const htmlBeforeStyle = src.slice(0, src.indexOf('<style>'));
const htmlAfterStyle = src.slice(styleEnd + '</style>'.length, src.lastIndexOf(scriptTag));
const htmlAfterScript = src.slice(scriptEnd + '</script>'.length);

const headLink = '    <link rel="stylesheet" href="css/lumina.css">\n';
const html = (
    htmlBeforeStyle
    + headLink
    + htmlAfterStyle.trimEnd()
    + '\n    <script src="js/lumina-app.js" defer></script>\n'
    + htmlAfterScript
);

fs.mkdirSync(path.join(root, 'css'), { recursive: true });
fs.mkdirSync(path.join(root, 'js'), { recursive: true });
fs.writeFileSync(path.join(root, 'css', 'lumina.css'), css + '\n');
fs.writeFileSync(path.join(root, 'js', 'lumina-app.js'), js + '\n');
fs.writeFileSync(srcPath, html);

console.log('Split complete:');
console.log('  css/lumina.css:', css.split('\n').length, 'lines');
console.log('  js/lumina-app.js:', js.split('\n').length, 'lines');
console.log('  lumina-ai.html:', html.split('\n').length, 'lines');