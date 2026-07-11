/**
 * 備份 RAG storage（可選 uploads）到 backups/ 時間戳目錄／壓縮檔
 *
 * 用法：
 *   node scripts/backup-rag-storage.js
 *   node scripts/backup-rag-storage.js --with-uploads
 *   node scripts/backup-rag-storage.js --no-compress   # 僅複製目錄，不 tar
 *   npm run backup:rag
 *   npm run backup:rag -- --with-uploads
 *
 * 輸出：
 *   backups/rag-storage-YYYYMMDD-HHmmss.tar.gz
 *   或 backups/rag-storage-YYYYMMDD-HHmmss/（--no-compress）
 *
 * Exit：0 成功；1 來源不存在或打包失敗
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const STORAGE_DIR = path.join(ROOT, 'rag_service', 'storage');
const UPLOADS_DIR = path.join(ROOT, 'uploads');
const BACKUPS_DIR = path.join(ROOT, 'backups');

const withUploads = process.argv.includes('--with-uploads');
const noCompress = process.argv.includes('--no-compress');

function pad(n) {
    return String(n).padStart(2, '0');
}

function timestamp() {
    const d = new Date();
    return (
        `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
        `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
    );
}

function copyRecursive(src, dest) {
    const st = fs.statSync(src);
    if (st.isDirectory()) {
        fs.mkdirSync(dest, { recursive: true });
        for (const name of fs.readdirSync(src)) {
            copyRecursive(path.join(src, name), path.join(dest, name));
        }
        return;
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
}

function dirSize(dir) {
    let total = 0;
    if (!fs.existsSync(dir)) return 0;
    const walk = (p) => {
        const st = fs.statSync(p);
        if (st.isDirectory()) {
            for (const name of fs.readdirSync(p)) walk(path.join(p, name));
        } else {
            total += st.size;
        }
    };
    walk(dir);
    return total;
}

function formatBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function tryTar(archivePath, entries) {
    // Windows 10+ 與 Unix 皆有 tar；-a 讓副檔名決定格式
    const args = ['-czf', archivePath, ...entries];
    const result = spawnSync('tar', args, {
        cwd: ROOT,
        encoding: 'utf8',
        shell: process.platform === 'win32'
    });
    if (result.status !== 0) {
        const err = (result.stderr || result.stdout || result.error || '').toString().trim();
        throw new Error(`tar 失敗 (exit ${result.status}): ${err || 'unknown'}`);
    }
}

(function main() {
    console.log('[backup-rag] root:', ROOT);

    if (!fs.existsSync(STORAGE_DIR)) {
        console.error('[backup-rag] FAIL: 找不到 rag_service/storage');
        console.error('  路徑:', STORAGE_DIR);
        process.exit(1);
    }

    if (withUploads && !fs.existsSync(UPLOADS_DIR)) {
        console.warn('[backup-rag] WARN: --with-uploads 但 uploads/ 不存在，略過 uploads');
    }

    fs.mkdirSync(BACKUPS_DIR, { recursive: true });
    const stamp = timestamp();
    const baseName = `rag-storage-${stamp}`;

    const includeUploads = withUploads && fs.existsSync(UPLOADS_DIR);
    const storageBytes = dirSize(STORAGE_DIR);
    const uploadsBytes = includeUploads ? dirSize(UPLOADS_DIR) : 0;

    console.log(`[backup-rag] storage: ${formatBytes(storageBytes)}`);
    if (includeUploads) console.log(`[backup-rag] uploads:  ${formatBytes(uploadsBytes)}`);

    if (noCompress) {
        const outDir = path.join(BACKUPS_DIR, baseName);
        fs.mkdirSync(outDir, { recursive: true });
        copyRecursive(STORAGE_DIR, path.join(outDir, 'rag_service', 'storage'));
        if (includeUploads) {
            copyRecursive(UPLOADS_DIR, path.join(outDir, 'uploads'));
        }
        console.log('[backup-rag] OK (copy):', path.relative(ROOT, outDir));
        process.exit(0);
    }

    const archivePath = path.join(BACKUPS_DIR, `${baseName}.tar.gz`);
    const entries = ['rag_service/storage'];
    if (includeUploads) entries.push('uploads');

    try {
        tryTar(archivePath, entries);
    } catch (err) {
        // tar 失敗時 fallback 為目錄複製
        console.warn('[backup-rag] tar 不可用，改為目錄複製:', err.message);
        const outDir = path.join(BACKUPS_DIR, baseName);
        fs.mkdirSync(outDir, { recursive: true });
        copyRecursive(STORAGE_DIR, path.join(outDir, 'rag_service', 'storage'));
        if (includeUploads) {
            copyRecursive(UPLOADS_DIR, path.join(outDir, 'uploads'));
        }
        console.log('[backup-rag] OK (copy fallback):', path.relative(ROOT, outDir));
        process.exit(0);
    }

    const size = fs.statSync(archivePath).size;
    console.log('[backup-rag] OK:', path.relative(ROOT, archivePath), `(${formatBytes(size)})`);
    console.log('[backup-rag] 還原範例:');
    console.log(`  tar -xzf ${path.relative(ROOT, archivePath)} -C .`);
    process.exit(0);
})();
