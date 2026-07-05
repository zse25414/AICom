/**
 * Convert lumina-ai.html onclick/onsubmit to data-lumina-* delegation attributes.
 * Run: node scripts/migrate-html-actions.js
 */
const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, '..', 'lumina-ai.html');
let html = fs.readFileSync(htmlPath, 'utf8');

function escapeAttr(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;');
}

function parseCall(stmt) {
    const value = stmt.trim();
    const passEvent = value.match(/^(\w+)\(\s*event\s*\)$/);
    if (passEvent) return [passEvent[1], '__event__'];

    const noArgs = value.match(/^(\w+)\(\)$/);
    if (noArgs) return [noArgs[1]];

    const strArg = value.match(/^(\w+)\(\s*'([^']*)'\s*\)$/);
    if (strArg) return [strArg[1], strArg[2]];

    const numArg = value.match(/^(\w+)\(\s*(\d+)\s*\)$/);
    if (numArg) return [numArg[1], Number(numArg[2])];

    const boolArg = value.match(/^(\w+)\(\s*(true|false)\s*\)$/);
    if (boolArg) return [boolArg[1], boolArg[2] === 'true'];

    return null;
}

function convertOnclick(value) {
    const raw = value.trim();

    const dismiss = raw.match(/^if\s*\(\s*event\.target\s*===\s*this\s*\)\s*(\w+)\(\)\s*$/);
    if (dismiss) {
        return { replace: `data-lumina-dismiss="${dismiss[1]}"` };
    }

    if (raw === 'event.stopPropagation()') {
        return { replace: 'data-lumina-stop' };
    }

    const stopThen = raw.match(/^event\.stopPropagation\(\)\s*;\s*(.+)$/);
    if (stopThen) {
        const call = parseCall(stopThen[1].trim());
        if (!call) return null;
        if (call.length === 1) {
            return { replace: `data-lumina-stop data-lumina-action="${call[0]}"` };
        }
        if (call[1] === '__event__') {
            return { replace: `data-lumina-stop data-lumina-action="${call[0]}" data-lumina-pass-event` };
        }
        const type = typeof call[1] === 'number' ? 'number' : typeof call[1] === 'boolean' ? 'boolean' : undefined;
        const typeAttr = type ? ` data-lumina-arg-type="${type}"` : '';
        return { replace: `data-lumina-stop data-lumina-action="${call[0]}" data-lumina-arg="${call[1]}"${typeAttr}` };
    }

    if (raw.includes(';')) {
        const chain = raw.split(';').map(s => s.trim()).filter(Boolean).map(parseCall).filter(Boolean);
        if (!chain.length || chain.length !== raw.split(';').map(s => s.trim()).filter(Boolean).length) return null;
        return { replace: `data-lumina-actions='${JSON.stringify(chain)}'` };
    }

    const call = parseCall(raw);
    if (!call) return null;

    if (call.length === 1) {
        return { replace: `data-lumina-action="${call[0]}"` };
    }
    if (call[1] === '__event__') {
        return { replace: `data-lumina-action="${call[0]}" data-lumina-pass-event` };
    }
    const type = typeof call[1] === 'number' ? 'number' : typeof call[1] === 'boolean' ? 'boolean' : undefined;
    const typeAttr = type ? ` data-lumina-arg-type="${type}"` : '';
    const arg = typeof call[1] === 'string' ? escapeAttr(call[1]) : call[1];
    return { replace: `data-lumina-action="${call[0]}" data-lumina-arg="${arg}"${typeAttr}` };
}

let converted = 0;
let kept = 0;

html = html.replace(/\sonclick="([^"]*)"/g, (full, value) => {
    const result = convertOnclick(value);
    if (!result) {
        kept++;
        return full;
    }
    converted++;
    return ` ${result.replace}`;
});

html = html.replace(/\sonsubmit="(\w+)\(event\)"/g, (full, fn) => {
    converted++;
    return ` data-lumina-submit="${fn}"`;
});

fs.writeFileSync(htmlPath, html);
console.log(`HTML actions migrated: ${converted} converted, ${kept} onclick kept`);