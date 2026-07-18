const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 以檔案路徑為 key 的寫入佇列：同一檔案的寫入依序執行，避免並行 write 造成競態／內容錯亂。
const queues = new Map();

async function writeFileAtomic(filePath, data) {
    const dir = path.dirname(filePath);
    const tmpPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
    await fs.promises.writeFile(tmpPath, data, 'utf8');
    await fs.promises.rename(tmpPath, filePath);
}

/**
 * 將檔案寫入排入該檔案的序列佇列，並以「寫 temp 檔 → rename」的方式原子覆蓋目標檔案。
 * 回傳寫入完成的 Promise。
 */
function queueWrite(filePath, data) {
    const prev = queues.get(filePath) || Promise.resolve();
    const next = prev
        .catch(() => {}) // 前一次寫入失敗不應阻塞後續寫入
        .then(() => writeFileAtomic(filePath, data));
    queues.set(filePath, next);
    return next;
}

// 以任意 key 為單位的 async mutex：同 key 的臨界區（load→mutate→save）依序執行，
// 避免跨請求 read-modify-write 造成 lost update。與 queueWrite 各自獨立的佇列表。
const lockQueues = new Map();

/**
 * 將 asyncFn 排入該 key 的鎖佇列，確保同 key 的呼叫依序（非重疊）執行。
 * 回傳 asyncFn() 的結果；asyncFn 拋出的錯誤會正確傳播給呼叫者，且不會卡住後續排隊的呼叫。
 */
function withLock(key, asyncFn) {
    const prev = lockQueues.get(key) || Promise.resolve();
    const run = prev.catch(() => {}).then(() => asyncFn());
    // 只用於串接下一個呼叫的時機；不吞掉 run 本身要回傳給呼叫者的結果／錯誤。
    lockQueues.set(key, run.catch(() => {}));
    return run;
}

module.exports = { queueWrite, withLock };
