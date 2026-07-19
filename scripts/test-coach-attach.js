/**
 * 教練附件位元組取得（readCoachAttachmentBase64）行為測試。
 * 迴歸背景：附件背景上雲後本機只剩 fileUrl，若取位元組只認 _file／dataUrl，
 * 「存入知識庫」對 PDF 會永久失效。此測試把三種來源都跑一遍。
 * Run: node scripts/test-coach-attach.js（離線，無需服務）
 */
const fs = require('fs');
const path = require('path');

const srcPath = path.join(__dirname, '..', 'js', 'modules', 'slices', 'coach', 'attachments.js');
const src = fs.readFileSync(srcPath, 'utf8');

let failed = 0;
function ok(cond, msg, detail) {
    if (cond) console.log('OK', msg);
    else { console.error('FAIL', msg, detail || ''); failed++; }
}

// 以最小替身載入 slice：只有被測路徑會碰到的全域才需要стуб
const prelude = `
const S = { coachPendingAttachments: [] };
function showToast() {}
function escapeHtml(s) { return String(s); }
function getAuthBaseUrl() { return 'http://api.test'; }
function getAuthHeaders() { return {}; }
function isLoggedIn() { return true; }
function saveState() {}
function persistCoachFreeformThread() {}
function authApiRequest() { return Promise.resolve({}); }
const document = { getElementById: () => null, querySelectorAll: () => [] };
const URL = { createObjectURL: () => 'blob:fake-object-url', revokeObjectURL() {} };
class FileReader {
    readAsDataURL(blob) {
        const b64 = (blob && blob.__b64) || 'RU1QVFk=';
        setTimeout(() => { this.result = 'data:application/pdf;base64,' + b64; this.onload(); }, 0);
    }
}
const __fetchLog = [];
function fetch(url) {
    __fetchLog.push(String(url));
    return Promise.resolve({ ok: true, blob: () => Promise.resolve({ __b64: 'RlJPTV9DTE9VRA==' }) });
}
`;

const api = new Function(
    prelude + src + '\nreturn { readCoachAttachmentBase64, __fetchLog };'
)();
const { readCoachAttachmentBase64, __fetchLog } = api;

(async () => {
    // 1) 本機 dataUrl（圖片壓縮後版本）優先
    const fromDataUrl = await readCoachAttachmentBase64({
        id: 'a1', name: 'shot.jpg', kind: 'image', dataUrl: 'data:image/jpeg;base64,SU1BR0U='
    });
    ok(fromDataUrl === 'SU1BR0U=', 'dataUrl source returns local bytes', fromDataUrl);

    // 2) 只有原始 File（剛加入、尚未上雲的 PDF）
    const fromFile = await readCoachAttachmentBase64({
        id: 'a2', name: 'doc.pdf', kind: 'file', dataUrl: null, _file: { __b64: 'RlJPTV9GSUxF' }
    });
    ok(fromFile === 'RlJPTV9GSUxF', 'raw File source returns bytes', fromFile);

    // 3) 只有 fileUrl（已上雲，本機無 dataUrl／_file）— 正是先前失效的情境
    const fromCloud = await readCoachAttachmentBase64({
        id: 'a3', name: 'doc.pdf', kind: 'file', dataUrl: null, fileUrl: '/uploads/user-abc-doc.pdf'
    });
    ok(fromCloud === 'RlJPTV9DTE9VRA==', 'uploaded-only attachment still yields bytes', fromCloud);
    ok(__fetchLog.some(u => u.includes('/uploads/user-abc-doc.pdf')),
        'cloud fetch used the attachment fileUrl', JSON.stringify(__fetchLog));

    // 4) 三者皆無 → null（呼叫端據此略過）
    ok(await readCoachAttachmentBase64({ id: 'a4', name: 'x.pdf' }) === null, 'no source returns null');
    ok(await readCoachAttachmentBase64(null) === null, 'null attachment returns null');

    // 5) 來源契約：上雲成功後不得丟棄 _file（否則 4 會提前發生）
    ok(!/delete\s+att\._file/.test(src), 'upload does not delete att._file');
    // 6) 存入知識庫的 PDF 分支不得只靠 _file
    const kbSection = src.slice(src.indexOf('async function saveCoachPendingAttachmentsToKb'));
    ok(!/att\._file\s*&&\s*\/\\\.pdf/.test(kbSection) && /readCoachAttachmentBase64/.test(kbSection),
        'KB save path uses shared byte reader');

    if (failed) { console.error(`\n${failed} coach-attachment checks failed`); process.exit(1); }
    console.log('\nCoach attachment byte-source tests passed');
})().catch(e => { console.error('FAIL crashed:', e.message); process.exit(1); });
