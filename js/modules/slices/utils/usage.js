/* Lumina: utils/usage.js — Phase 2 usage, quota, cost, short cache */
const USAGE_STORAGE_KEY = 'lumina_usage_v1';
const PLAN_STORAGE_KEY = 'lumina_plan';

/** Blended rough USD per 1K tokens (order-of-magnitude for planning). */
const COST_USD_PER_1K_TOKENS = 0.00027;

const PLAN_LIMITS = {
    free: { aiPerDay: 40, ragPerDay: 80, label: 'Free' },
    pro: { aiPerDay: 400, ragPerDay: 800, label: 'Pro（試點）' }
};

/** In-memory coach answer cache: key → { ts, payload } */
const __coachAnswerCache = new Map();
const COACH_CACHE_TTL_MS = 5 * 60 * 1000;
const COACH_CACHE_MAX = 40;

function getUsagePlan() {
    try {
        const fromProfile = S?.userProfile?.plan;
        if (fromProfile === 'pro' || fromProfile === 'free') return fromProfile;
    } catch (_) {}
    try {
        const p = localStorage.getItem(PLAN_STORAGE_KEY);
        if (p === 'pro' || p === 'free') return p;
    } catch (_) {}
    return 'free';
}

function setUsagePlan(plan) {
    const p = plan === 'pro' ? 'pro' : 'free';
    try {
        if (S?.userProfile) S.userProfile.plan = p;
    } catch (_) {}
    try {
        localStorage.setItem(PLAN_STORAGE_KEY, p);
    } catch (_) {}
    try {
        if (typeof track === 'function') track('plan_set', { plan: p });
    } catch (_) {}
}

function getPlanLimits(plan) {
    return PLAN_LIMITS[plan === 'pro' ? 'pro' : 'free'];
}

function _usageTodayKey() {
    return typeof getTodayISO === 'function' ? getTodayISO() : new Date().toISOString().slice(0, 10);
}

function _emptyDay(day) {
    return {
        day,
        aiCalls: 0,
        ragCalls: 0,
        cacheHits: 0,
        tokensIn: 0,
        tokensOut: 0,
        estCostUsd: 0
    };
}

function loadUsageState() {
    try {
        const raw = localStorage.getItem(USAGE_STORAGE_KEY);
        const data = raw ? JSON.parse(raw) : null;
        if (!data || typeof data !== 'object') return { days: {} };
        if (!data.days || typeof data.days !== 'object') data.days = {};
        return data;
    } catch (_) {
        return { days: {} };
    }
}

function saveUsageState(state) {
    try {
        // Keep ~45 days
        const days = state.days || {};
        const keys = Object.keys(days).sort();
        if (keys.length > 45) {
            keys.slice(0, keys.length - 45).forEach(k => { delete days[k]; });
        }
        localStorage.setItem(USAGE_STORAGE_KEY, JSON.stringify({ days }));
    } catch (_) {}
}

function getTodayUsage() {
    const day = _usageTodayKey();
    const state = loadUsageState();
    if (!state.days[day]) state.days[day] = _emptyDay(day);
    return { state, day, row: state.days[day] };
}

function estimateTokensFromText(text) {
    const n = String(text || '').length;
    return Math.max(1, Math.ceil(n / 4));
}

function estimateTokensFromMessages(messages) {
    try {
        return estimateTokensFromText(JSON.stringify(messages || []));
    } catch (_) {
        return 64;
    }
}

function estimateCostUsd(tokensIn, tokensOut) {
    return ((tokensIn + tokensOut) / 1000) * COST_USD_PER_1K_TOKENS;
}

/**
 * @param {'ai'|'rag'} kind
 * @returns {{ ok: boolean, remaining: number, limit: number, plan: string, used: number }}
 */
function checkUsageQuota(kind) {
    const plan = getUsagePlan();
    const limits = getPlanLimits(plan);
    const { row } = getTodayUsage();
    if (kind === 'rag') {
        const limit = limits.ragPerDay;
        const used = row.ragCalls || 0;
        return { ok: used < limit, remaining: Math.max(0, limit - used), limit, plan, used };
    }
    const limit = limits.aiPerDay;
    const used = row.aiCalls || 0;
    return { ok: used < limit, remaining: Math.max(0, limit - used), limit, plan, used };
}

/**
 * @param {'ai'|'rag'} kind
 * @throws {Error} when over free/pro daily quota
 */
function assertUsageQuota(kind) {
    const q = checkUsageQuota(kind);
    if (q.ok) return q;
    const label = kind === 'rag' ? '知識庫查詢' : 'AI 對話';
    const err = new Error(
        `今日${label}已達 ${q.plan === 'pro' ? 'Pro' : '免費'}上限（${q.limit} 次）。可到設定開啟「試點 Pro」或明日再試。`
    );
    err.code = 'USAGE_QUOTA';
    throw err;
}

/**
 * @param {{ kind: 'ai'|'rag', tokensIn?: number, tokensOut?: number, cached?: boolean, source?: string }} opts
 */
function recordUsage(opts = {}) {
    const kind = opts.kind === 'rag' ? 'rag' : 'ai';
    const cached = !!opts.cached;
    const tokensIn = Math.max(0, parseInt(opts.tokensIn, 10) || 0);
    const tokensOut = Math.max(0, parseInt(opts.tokensOut, 10) || 0);
    const { state, day, row } = getTodayUsage();

    if (cached) {
        row.cacheHits = (row.cacheHits || 0) + 1;
    } else if (kind === 'rag') {
        row.ragCalls = (row.ragCalls || 0) + 1;
    } else {
        row.aiCalls = (row.aiCalls || 0) + 1;
    }
    row.tokensIn = (row.tokensIn || 0) + tokensIn;
    row.tokensOut = (row.tokensOut || 0) + tokensOut;
    const addCost = cached ? 0 : estimateCostUsd(tokensIn, tokensOut);
    row.estCostUsd = Math.round(((row.estCostUsd || 0) + addCost) * 1e6) / 1e6;
    state.days[day] = row;
    saveUsageState(state);

    try {
        if (typeof track === 'function') {
            track('ai_usage', {
                kind,
                cached,
                tokensIn,
                tokensOut,
                source: opts.source || null,
                plan: getUsagePlan()
            });
        }
    } catch (_) {}

    try {
        if (typeof renderUsageMeter === 'function') renderUsageMeter();
    } catch (_) {}

    return row;
}

function getMonthUsageSummary() {
    const state = loadUsageState();
    const prefix = _usageTodayKey().slice(0, 7); // YYYY-MM
    let aiCalls = 0;
    let ragCalls = 0;
    let cacheHits = 0;
    let tokens = 0;
    let estCostUsd = 0;
    Object.keys(state.days || {}).forEach(d => {
        if (!d.startsWith(prefix)) return;
        const r = state.days[d];
        aiCalls += r.aiCalls || 0;
        ragCalls += r.ragCalls || 0;
        cacheHits += r.cacheHits || 0;
        tokens += (r.tokensIn || 0) + (r.tokensOut || 0);
        estCostUsd += r.estCostUsd || 0;
    });
    return {
        month: prefix,
        aiCalls,
        ragCalls,
        cacheHits,
        tokens,
        estCostUsd: Math.round(estCostUsd * 1e6) / 1e6
    };
}

function coachCacheKey(parts) {
    try {
        return JSON.stringify(parts);
    } catch (_) {
        return String(parts?.query || '') + '|' + String(parts?.taskId || '');
    }
}

function getCoachCachedAnswer(key) {
    const hit = __coachAnswerCache.get(key);
    if (!hit) return null;
    if (Date.now() - hit.ts > COACH_CACHE_TTL_MS) {
        __coachAnswerCache.delete(key);
        return null;
    }
    return hit.payload;
}

function setCoachCachedAnswer(key, payload) {
    __coachAnswerCache.set(key, { ts: Date.now(), payload });
    if (__coachAnswerCache.size > COACH_CACHE_MAX) {
        const first = __coachAnswerCache.keys().next().value;
        __coachAnswerCache.delete(first);
    }
}

function renderUsageMeter() {
    const el = document.getElementById('usage-meter-panel');
    if (!el) return;

    const plan = getUsagePlan();
    const limits = getPlanLimits(plan);
    const { row } = getTodayUsage();
    const month = getMonthUsageSummary();
    const aiQ = checkUsageQuota('ai');
    const ragQ = checkUsageQuota('rag');

    const aiPct = Math.min(100, Math.round((aiQ.used / Math.max(1, aiQ.limit)) * 100));
    const ragPct = Math.min(100, Math.round((ragQ.used / Math.max(1, ragQ.limit)) * 100));

    el.innerHTML = `
        <div class="usage-meter-head">
            <span class="usage-plan-badge usage-plan-${plan}">${limits.label}</span>
            <span class="usage-meter-day">今日 ${_usageTodayKey()}</span>
        </div>
        <div class="usage-meter-row">
            <div class="usage-meter-label">AI 對話 <strong>${aiQ.used}</strong> / ${aiQ.limit}</div>
            <div class="usage-meter-bar"><i style="width:${aiPct}%"></i></div>
        </div>
        <div class="usage-meter-row">
            <div class="usage-meter-label">知識庫查詢 <strong>${ragQ.used}</strong> / ${ragQ.limit}</div>
            <div class="usage-meter-bar"><i style="width:${ragPct}%"></i></div>
        </div>
        <div class="usage-meter-meta">
            快取命中今日 ${row.cacheHits || 0} · 本月估算成本 ≈ $${month.estCostUsd.toFixed(4)} USD
            <span class="usage-meter-hint">（粗估，僅供規劃）</span>
        </div>
    `;

    const planToggle = document.getElementById('settings-plan-pro');
    if (planToggle) planToggle.checked = plan === 'pro';
}

function onPlanProToggle(checked) {
    setUsagePlan(checked ? 'pro' : 'free');
    renderUsageMeter();
    if (typeof showToast === 'function') {
        showToast(checked ? '已切換試點 Pro 配額（本機）' : '已切回 Free 配額', 'success');
    }
}

if (typeof window !== 'undefined') {
    window.checkUsageQuota = checkUsageQuota;
    window.assertUsageQuota = assertUsageQuota;
    window.recordUsage = recordUsage;
    window.getMonthUsageSummary = getMonthUsageSummary;
    window.renderUsageMeter = renderUsageMeter;
    window.getUsagePlan = getUsagePlan;
    window.setUsagePlan = setUsagePlan;
    window.onPlanProToggle = onPlanProToggle;
    window.getCoachCachedAnswer = getCoachCachedAnswer;
    window.setCoachCachedAnswer = setCoachCachedAnswer;
    window.coachCacheKey = coachCacheKey;
    window.estimateTokensFromMessages = estimateTokensFromMessages;
    window.estimateTokensFromText = estimateTokensFromText;
}
