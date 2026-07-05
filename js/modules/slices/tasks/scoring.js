/* Lumina: tasks/scoring.js */
function inferCategory(name, energy) {
    const lower = name.toLowerCase();
    if (/會議|同步|討論|standup|review 會/.test(lower)) return 'meeting';
    if (/學習|課程|閱讀|研究|prompt/.test(lower)) return 'learning';
    if (/郵件|回覆|行政|okr|追蹤|整理/.test(lower)) return 'admin';
    if (/撰寫|設計|開發|分析|規劃|審核|提案|簡報/.test(lower)) return energy >= 4 ? 'deep' : 'execution';
    if (energy >= 5) return 'deep';
    if (energy >= 4) return 'deep';
    if (energy === 3) return 'execution';
    return 'admin';
}

function getCategoryLabel(cat) {
    return C.CATEGORIES[cat]?.label || '其他';
}

function getCategoryColor(cat) {
    return C.CATEGORIES[cat]?.color || 'bg-slate-500/10 text-slate-300';
}

function resolveCategory(task) {
    return task.category || inferCategory(task.name, task.energy || 3);
}

function invalidateTodayStats() {
    S.todayStatsCache = null;
    S.todayQueueMap = null;
    S.categoryCountsCache = null;
}

function computeTodayStats() {
    const today = getTodayISO();
    const stats = {
        today,
        relevant: [],
        pending: [],
        futurePending: [],
        completed: 0,
        rate: 0,
        focusMinutes: 0,
        futureCount: 0,
        highEnergyPending: 0
    };
    
    for (const t of S.tasks) {
        if (!t.completed && t.energy >= 4) stats.highEnergyPending++;
        if (t.due <= today) {
            stats.relevant.push(t);
            if (t.completed) {
                stats.completed++;
            } else {
                stats.pending.push(t);
            }
        } else if (!t.completed) {
            stats.futurePending.push(t);
        }
    }
    stats.futureCount = stats.futurePending.length;
    stats.rate = stats.relevant.length
        ? Math.round((stats.completed / stats.relevant.length) * 100)
        : 0;
    stats.focusMinutes = getTrackedFocusMinutesForDate(today);
    return stats;
}

function getTodayStats() {
    if (!S.todayStatsCache) S.todayStatsCache = computeTodayStats();
    return S.todayStatsCache;
}

function getScoringContext() {
    return {
        today: getTodayISO(),
        hour: new Date().getHours(),
        peakStart: parseHour(S.userProfile.peakStart),
        peakEnd: parseHour(S.userProfile.peakEnd)
    };
}

function getCategoryCounts() {
    if (S.categoryCountsCache) return S.categoryCountsCache;
    const counts = { all: S.tasks.length };
    Object.keys(C.CATEGORIES).forEach(k => { counts[k] = 0; });
    for (const t of S.tasks) {
        const cat = resolveCategory(t);
        if (counts[cat] !== undefined) counts[cat]++;
    }
    S.categoryCountsCache = counts;
    return counts;
}

function getCompletedCount() {
    return S.tasks.filter(t => t.completed).length;
}

function getTodayRelevantTasks() {
    return getTodayStats().relevant;
}

function getTodayPendingTasks() {
    return getTodayStats().pending;
}

function getFuturePendingTasks() {
    return getTodayStats().futurePending;
}

function getTodayCompletedCount() {
    return getTodayStats().completed;
}

function getTodayFocusMinutes() {
    return getTodayStats().focusMinutes;
}

function getTodayCompletionRate() {
    return getTodayStats().rate;
}

function parseHour(timeStr) {
    return parseInt((timeStr || '09:00').split(':')[0], 10);
}

function scoreTaskForNextStep(task, ctx) {
    ctx = ctx || getScoringContext();
    let score = 0;
    if (task.due < ctx.today) score += 50;
    else if (task.due === ctx.today) score += 30;
    
    const inPeak = ctx.hour >= ctx.peakStart && ctx.hour < ctx.peakEnd;
    const cat = resolveCategory(task);
    
    if (inPeak && cat === 'deep') score += 25;
    if (task.duration <= 25) score += 15;
    if (task.wasOverdue) score += 20;
    score += (task.energy || 3) * 3;
    return score;
}

function rankTasksByNextStepScore(taskList, ctx) {
    ctx = ctx || getScoringContext();
    return taskList
        .map(t => ({ task: t, score: scoreTaskForNextStep(t, ctx) }))
        .sort((a, b) => b.score - a.score)
        .map(x => x.task);
}

function getNextRecommendedTask(scope = 'today') {
    let pending = scope === 'today' ? getTodayPendingTasks() : S.tasks.filter(t => !t.completed);
    if (!pending.length && scope === 'today') pending = getFuturePendingTasks();
    if (!pending.length) return null;
    return rankTasksByNextStepScore(pending)[0];
}

function getNextStepReason(task) {
    const ctx = getScoringContext();
    const inPeak = ctx.hour >= ctx.peakStart && ctx.hour < ctx.peakEnd;
    if (task.wasOverdue) return '逾期優先處理';
    if (inPeak && resolveCategory(task) === 'deep') return '高效時段，適合深度工作';
    if (!inPeak && resolveCategory(task) === 'deep') return '可先啟動，深度段落留到高效時段';
    if (task.duration <= 15) return '短小精悍，現在就能完成';
    if (task.duration <= 25) return '門檻低，適合現在開始';
    if (task.parentGoalName) {
        const g = task.parentGoalName;
        return `來自「${g.length > 14 ? g.slice(0, 14) + '…' : g}」`;
    }
    return '系統推薦的今日第一步';
}

function scoreTaskPriority(task) {
    const today = getTodayISO();
    const daysLeft = task.due <= today ? 0 : Math.ceil((new Date(task.due + 'T12:00:00') - new Date(today + 'T12:00:00')) / 86400000);
    
    let urgency = 3;
    if (daysLeft === 0) urgency = 10;
    else if (daysLeft === 1) urgency = 8;
    else if (daysLeft <= 3) urgency = 6;
    
    const priorityScore = (urgency * 2.5) + (task.energy * 1.4) + (task.duration > 60 ? 2 : 0);
    return { ...task, daysLeft, priorityScore };
}

function scoreTaskBlockFit(task, slot) {
    const block = slot.block;
    if (task.energy > block.maxEnergy) return -Infinity;
    if (slot.load + task.duration > block.capacity) return -Infinity;
    
    let fit = task.priorityScore;
    if (block.preferredCategories.includes(task.category)) fit += 22;
    if (task.category === 'deep' && block.maxEnergy >= 4) fit += 8;
    if (task.category === 'admin' && block.maxEnergy <= 2) fit += 10;
    fit -= (slot.load / block.capacity) * 12;
    return fit;
}
