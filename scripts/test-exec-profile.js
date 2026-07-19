/**
 * 執行畫像（軌道2）單元測試：載入 utils/exec-profile.js 純函數，餵固定數據斷言。
 * Run: node scripts/test-exec-profile.js（離線，無需服務）
 */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(
    path.join(__dirname, '..', 'js', 'modules', 'slices', 'utils', 'exec-profile.js'),
    'utf8'
);
const { computeExecProfile, buildExecProfileSummary } = new Function(
    src + '\nreturn { computeExecProfile, buildExecProfileSummary };'
)();

let failed = 0;
function ok(cond, msg, detail) {
    if (cond) console.log('OK', msg);
    else { console.error('FAIL', msg, detail || ''); failed++; }
}

// ---- fixture：2026-07-05（日）～ 07-18（六）共 14 天 ----
// 週二（07-07、07-14）rate 90，其餘 50
const dailyHistory = {};
for (let d = 5; d <= 18; d++) {
    const iso = `2026-07-${String(d).padStart(2, '0')}`;
    const dow = new Date(iso + 'T12:00:00').getDay();
    dailyHistory[iso] = { total: 4, completed: 2, rate: dow === 2 ? 90 : 50, focusMinutes: 60 };
}

// 任務：8 個已完成集中在 9–11 點；短任務完成率高、長任務低；splitPart 全數完成
const tasks = [];
let id = 1;
for (let i = 0; i < 8; i++) {
    tasks.push({
        id: id++, name: `done${i}`, duration: 25, completed: true,
        completedAt: `2026-07-${String(6 + i).padStart(2, '0')}T${String(9 + (i % 3)).padStart(2, '0')}:15:00`
    });
}
// 短任務未完成 2 個 → short: 10 總、8 完成 = 80%
tasks.push({ id: id++, name: 's1', duration: 20, completed: false });
tasks.push({ id: id++, name: 's2', duration: 30, completed: false });
// 長任務 4 個只完成 1 → 25%
tasks.push({ id: id++, name: 'l1', duration: 90, completed: true, completedAt: '2026-07-10T10:00:00' });
tasks.push({ id: id++, name: 'l2', duration: 90, completed: false });
tasks.push({ id: id++, name: 'l3', duration: 120, completed: false });
tasks.push({ id: id++, name: 'l4', duration: 75, completed: false });
// splitPart 3 個全完成
for (let i = 0; i < 3; i++) {
    tasks.push({
        id: id++, name: `p${i}`, duration: 20, completed: true, splitPart: 1,
        completedAt: `2026-07-1${5 + i}T09:30:00`
    });
}

const profile = computeExecProfile({ dailyHistory, tasks });
ok(!!profile, 'profile computed with 14 days');
ok(profile.sampleDays === 14, 'sampleDays = 14', profile.sampleDays);
ok(profile.bestWeekday?.weekday === 2 && profile.bestWeekday.avgRate === 90,
    'best weekday is Tuesday @90%', JSON.stringify(profile.bestWeekday));
ok(profile.bestHourRange && profile.bestHourRange.start >= 8 && profile.bestHourRange.start <= 10,
    'best hour window covers 9–11', JSON.stringify(profile.bestHourRange));
ok(profile.durationBuckets.short.rate >= 75 && profile.durationBuckets.long.rate <= 30,
    'short-task rate ≫ long-task rate', JSON.stringify(profile.durationBuckets));
ok(profile.splitLift != null && profile.splitLift >= 10,
    'splitLift >= 10', profile.splitLift);

const summary = buildExecProfileSummary(profile);
ok(summary.length > 0 && summary.length <= 300, 'summary within 300 chars', summary.length);
ok(summary.includes('週二'), 'summary mentions Tuesday', summary);
ok(/先拆|高於長任務/.test(summary), 'summary suggests splitting long tasks', summary);
ok(!/done0|報帳|l1/.test(summary), 'summary contains no task names (privacy)');

// 完成時段只認 completedAt：晚上才被編輯過的任務不得污染時段統計
const editedLate = tasks.map(t => (t.completed ? { ...t, updatedAt: '2026-07-18T23:50:00' } : t));
const profileEdited = computeExecProfile({ dailyHistory, tasks: editedLate });
ok(profileEdited.bestHourRange?.start === profile.bestHourRange?.start,
    'late edits do not shift best hour window',
    `${JSON.stringify(profile.bestHourRange)} vs ${JSON.stringify(profileEdited.bestHourRange)}`);

// 舊資料（只有 updatedAt、沒有 completedAt）→ 不猜完成時段
const legacy = tasks.map(t => {
    const { completedAt, ...rest } = t;
    return completedAt ? { ...rest, updatedAt: completedAt } : rest;
});
ok(computeExecProfile({ dailyHistory, tasks: legacy }).bestHourRange === null,
    'legacy tasks without completedAt yield no hour window');

// 樣本門檻：6 天 → null
const few = {};
Object.keys(dailyHistory).slice(0, 6).forEach(k => { few[k] = dailyHistory[k]; });
ok(computeExecProfile({ dailyHistory: few, tasks }) === null, 'under 7 days → null');
// 空輸入 → null
ok(computeExecProfile({}) === null, 'empty input → null');

if (failed) { console.error(`\n${failed} exec-profile checks failed`); process.exit(1); }
console.log('\nExec-profile unit tests passed');
