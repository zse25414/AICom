/* Lumina: utils/exec-profile.js — 個人執行畫像（軌道2）
 * 從本機既有數據（dailyHistory / tasks）彙算工作模式，供教練與排序引用。
 * computeExecProfile / buildExecProfileSummary 為純函數（可離線單測）；
 * getExecProfile / buildExecProfileContext 讀 S 並做當日快取。
 * 隱私：只有統計量，不含任務內容原文；樣本 < 7 天不啟用。 */

const EXEC_PROFILE_MIN_DAYS = 7;
const EXEC_WEEKDAY_NAMES = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];

function computeExecProfile(input = {}) {
    const dailyHistory = input.dailyHistory && typeof input.dailyHistory === 'object' ? input.dailyHistory : {};
    const tasks = Array.isArray(input.tasks) ? input.tasks : [];
    const days = Object.keys(dailyHistory).filter(d => (dailyHistory[d]?.total || 0) > 0);
    const sampleDays = days.length;
    if (sampleDays < EXEC_PROFILE_MIN_DAYS) return null;

    // 星期別平均完成率（單一星期樣本 ≥2 天才列入）
    const byWeekday = {};
    for (const iso of days) {
        const dow = new Date(iso + 'T12:00:00').getDay();
        if (Number.isNaN(dow)) continue;
        const b = byWeekday[dow] || (byWeekday[dow] = { sum: 0, n: 0 });
        b.sum += dailyHistory[iso].rate || 0;
        b.n += 1;
    }
    let bestWeekday = null;
    for (const [dow, v] of Object.entries(byWeekday)) {
        if (v.n < 2) continue;
        const avgRate = Math.round(v.sum / v.n);
        if (!bestWeekday || avgRate > bestWeekday.avgRate) {
            bestWeekday = { weekday: Number(dow), avgRate, samples: v.n };
        }
    }

    // 最常完成時段：completedAt 小時分布的最密集 3 小時窗（樣本 ≥5）。
    // 只認 completedAt——updatedAt 任何編輯都會更新，會把「最後修改時段」誤當完成時段。
    const hourCounts = new Array(24).fill(0);
    let completedWithTs = 0;
    for (const t of tasks) {
        if (!t?.completed || !t.completedAt) continue;
        const ts = Date.parse(t.completedAt);
        if (!ts) continue;
        hourCounts[new Date(ts).getHours()] += 1;
        completedWithTs += 1;
    }
    let bestHourRange = null;
    if (completedWithTs >= 5) {
        let best = -1;
        let bestStart = 0;
        for (let h = 0; h <= 21; h++) {
            const c = hourCounts[h] + hourCounts[h + 1] + hourCounts[h + 2];
            if (c > best) { best = c; bestStart = h; }
        }
        bestHourRange = { start: bestStart, end: bestStart + 3, share: Math.round((best / completedWithTs) * 100) };
    }

    // 任務時長桶完成率（每桶樣本 ≥3 才給 rate）
    const bucketDefs = [
        { key: 'short', label: '≤30分', test: d => d <= 30 },
        { key: 'mid', label: '31–60分', test: d => d > 30 && d <= 60 },
        { key: 'long', label: '>60分', test: d => d > 60 }
    ];
    const durationBuckets = {};
    for (const def of bucketDefs) {
        const list = tasks.filter(t => def.test(parseInt(t?.duration, 10) || 30));
        const done = list.filter(t => t?.completed).length;
        durationBuckets[def.key] = {
            label: def.label,
            total: list.length,
            rate: list.length >= 3 ? Math.round((done / list.length) * 100) : null
        };
    }

    // 拆分效益：splitPart 任務完成率 vs 全體（樣本 ≥3）
    const overallTotal = tasks.length;
    const overallRate = overallTotal >= 5
        ? Math.round((tasks.filter(t => t?.completed).length / overallTotal) * 100)
        : null;
    const parts = tasks.filter(t => t?.splitPart);
    let splitLift = null;
    if (parts.length >= 3 && overallRate != null) {
        const partRate = Math.round((parts.filter(t => t.completed).length / parts.length) * 100);
        splitLift = partRate - overallRate;
    }

    return {
        v: 1,
        computedAt: new Date().toISOString(),
        sampleDays,
        bestWeekday,
        bestHourRange,
        durationBuckets,
        overallRate,
        splitLift
    };
}

/** 給教練 prompt／insights 卡的中文摘要（≤300 字，只講有樣本依據的） */
function buildExecProfileSummary(profile) {
    if (!profile) return '';
    const lines = [];
    if (profile.bestWeekday) {
        lines.push(`${EXEC_WEEKDAY_NAMES[profile.bestWeekday.weekday]}平均完成率最高（${profile.bestWeekday.avgRate}%）`);
    }
    if (profile.bestHourRange) {
        lines.push(`最常在 ${profile.bestHourRange.start}–${profile.bestHourRange.end} 點完成任務（佔 ${profile.bestHourRange.share}%）`);
    }
    const b = profile.durationBuckets || {};
    if (b.short?.rate != null && b.long?.rate != null && b.short.rate - b.long.rate >= 15) {
        lines.push(`短任務（${b.short.label}）完成率 ${b.short.rate}%，明顯高於長任務（${b.long.label}）的 ${b.long.rate}%——長任務建議先拆`);
    }
    if (profile.splitLift != null && profile.splitLift >= 10) {
        lines.push(`拆分後的子任務完成率比整體高 ${profile.splitLift} 點`);
    }
    if (!lines.length) return '';
    return `近 ${profile.sampleDays} 天觀察：${lines.join('；')}。`.slice(0, 300);
}

/** 讀 S、當日快取。flag（userProfile.enableExecProfile）預設開，設 false 停用。 */
function getExecProfile() {
    try {
        if (typeof S === 'undefined' || !S) return null;
        if (S.userProfile?.enableExecProfile === false) return null;
        const today = typeof getTodayISO === 'function' ? getTodayISO() : new Date().toISOString().slice(0, 10);
        if (S._execProfileCache?.day === today) return S._execProfileCache.profile;
        const profile = computeExecProfile({ dailyHistory: S.dailyHistory, tasks: S.tasks });
        S._execProfileCache = { day: today, profile };
        return profile;
    } catch (_) {
        return null;
    }
}

/** 教練 system prompt 注入區塊；無畫像回空字串 */
function buildExecProfileContext() {
    const summary = buildExecProfileSummary(getExecProfile());
    if (!summary) return '';
    return `\n\n【使用者執行畫像（依此安排建議與排程，不要整段照唸）】\n${summary}`;
}
