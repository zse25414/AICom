/**
 * 跨平台啟動 RAG 服務（Windows / macOS / Linux）
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const root = path.join(__dirname, '..');
const ragDir = path.join(root, 'rag_service');
const mainPy = path.join(ragDir, 'main.py');

function resolvePython() {
    const isWin = process.platform === 'win32';
    const subdir = isWin ? ['Scripts', 'python.exe'] : ['bin', 'python'];
    const venvNames = ['venv', '.venv'];

    for (const name of venvNames) {
        const candidate = path.join(ragDir, name, ...subdir);
        if (fs.existsSync(candidate)) return candidate;
    }

    const fallback = isWin ? 'python' : 'python3';
    console.warn(`[Lumina RAG] 找不到 venv，改用 PATH 中的 ${fallback}`);
    console.warn('[Lumina RAG] 請先執行：npm run rag:setup');
    return fallback;
}

if (!fs.existsSync(mainPy)) {
    console.error('[Lumina RAG] 找不到 rag_service/main.py');
    process.exit(1);
}

const python = resolvePython();
const child = spawn(python, [mainPy], {
    cwd: ragDir,
    stdio: 'inherit',
    env: process.env,
    shell: process.platform === 'win32'
});

child.on('error', err => {
    console.error('[Lumina RAG] 啟動失敗:', err.message);
    process.exit(1);
});

child.on('exit', code => {
    process.exit(code == null ? 1 : code);
});