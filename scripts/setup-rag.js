/**
 * 跨平台建立 RAG venv 並安裝依賴
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ragDir = path.join(__dirname, '..', 'rag_service');
const venvDir = path.join(ragDir, 'venv');
const requirements = path.join(ragDir, 'requirements.txt');

function run(cmd, args, options = {}) {
    const result = spawnSync(cmd, args, {
        stdio: 'inherit',
        cwd: options.cwd || ragDir,
        env: process.env,
        shell: process.platform === 'win32'
    });
    if (result.status !== 0) {
        process.exit(result.status == null ? 1 : result.status);
    }
}

function findSystemPython() {
    for (const cmd of ['python3', 'python']) {
        const probe = spawnSync(cmd, ['--version'], { encoding: 'utf8' });
        if (probe.status === 0) return cmd;
    }
    console.error('[Lumina RAG] 找不到 python3 或 python，請先安裝 Python 3.10+');
    process.exit(1);
}

if (!fs.existsSync(requirements)) {
    console.error('[Lumina RAG] 找不到 requirements.txt');
    process.exit(1);
}

if (!fs.existsSync(venvDir)) {
    const py = findSystemPython();
    console.log('[Lumina RAG] 建立 venv...');
    run(py, ['-m', 'venv', 'venv'], { cwd: ragDir });
}

const pip = process.platform === 'win32'
    ? path.join(venvDir, 'Scripts', 'pip.exe')
    : path.join(venvDir, 'bin', 'pip');

console.log('[Lumina RAG] 安裝依賴...');
run(pip, ['install', '-r', 'requirements.txt']);

console.log('[Lumina RAG] 完成。執行 npm run rag 啟動服務。');