/* Lumina: enterprise/team-boot.js
 * Core-resident subset of the former enterprise/team.js.
 * Kept in the core bundle because these are used unconditionally on
 * every boot / every navigation, or are non-function consts that the
 * lazy-chunk stub generator cannot proxy (only `function` exports get
 * window stubs — see scripts/build-app.js generateLazyStubs).
 */
function getEnterpriseBaseUrl() {
    const url = (S.userProfile.enterpriseApiUrl || 'http://localhost:3001').replace(/\/$/, '');
    return isSafeHttpUrl(url) ? url : 'http://localhost:3001';
}

/**
 * Pure/dependency-free. Kept in core (rather than lazy team.js) because
 * applyTeamInviteFromUrl below calls it synchronously on every boot —
 * a lazy stub would return a Promise instead of a string there.
 */
function normalizeEnterpriseCode(code) {
    return String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

async function fetchApiReadiness() {
    try {
        const res = await fetch(getEnterpriseBaseUrl() + '/ready', { method: 'GET' });
        let data = {};
        try { data = await res.json(); } catch (_) {}
        return {
            reachable: true,
            ready: res.ok && !!data.ok,
            checks: data.checks || null,
            details: data.details || null,
            uptimeSec: data.uptimeSec != null ? data.uptimeSec : null,
            backgroundIndexJobs: data.backgroundIndexJobs != null ? data.backgroundIndexJobs : null
        };
    } catch (_) {
        return {
            reachable: false,
            ready: false,
            checks: null,
            details: null,
            uptimeSec: null,
            backgroundIndexJobs: null
        };
    }
}

async function fetchOpsStatus(limit = 12) {
    try {
        const res = await fetch(
            getEnterpriseBaseUrl() + '/api/ops/status?limit=' + encodeURIComponent(String(limit)),
            { method: 'GET' }
        );
        if (!res.ok) return null;
        return await res.json().catch(() => null);
    } catch (_) {
        return null;
    }
}

function formatReadinessHint(checks, details) {
    if (!checks) return '';
    const parts = [];
    if ('store' in checks) parts.push(`store:${checks.store ? '✓' : '✗'}`);
    if ('auth' in checks) parts.push(`auth:${checks.auth ? '✓' : '✗'}`);
    if ('rag' in checks) parts.push(`rag:${checks.rag ? '✓' : '✗'}`);
    if (details?.rag?.latencyMs != null) parts.push(`ragLatency:${details.rag.latencyMs}ms`);
    if (details?.rag?.embedding) parts.push(`embed:${details.rag.embedding}`);
    if (details?.rag?.retrieval) parts.push(`retrieval:${details.rag.retrieval}`);
    return parts.join(' ');
}

/**
 * Parses ?group=/?code= invite params on boot. Does not depend on any
 * lazy team.js function synchronously — only touches DOM/state and
 * optionally calls showSection('team') when an invite code is present.
 */
function applyTeamInviteFromUrl() {
    try {
        const params = new URLSearchParams(window.location.search);
        const code = normalizeEnterpriseCode(params.get('group') || params.get('code') || '');
        if (!code) return;
        const input = document.getElementById('team-join-code');
        if (input) input.value = code;
        if (!S.enterpriseSession) {
            // showSection may be async (lazy preload); never throw from boot path
            const p = showSection('team');
            if (p && typeof p.catch === 'function') {
                p.catch(err => console.warn('[Lumina] open team from invite', err));
            }
        }
    } catch (e) {
        console.warn('[Lumina] applyTeamInviteFromUrl', e);
    }
}

/**
 * Called unconditionally on every non-team section switch
 * (ui/navigation.js showSection else-branch), so it must be core.
 */
function stopEnterprisePolling() {
    if (S.enterprisePollTimer) {
        clearTimeout(S.enterprisePollTimer);
        S.enterprisePollTimer = null;
    }
}

const PAGE_TITLES = {
    dashboard: '今日',
    decomposer: '目標分解',
    scheduler: '任務',
    coach: '行動教練',
    insights: '數據洞察',
    team: '團隊模式',
    guide: '使用指南',
    settings: '個人設定'
};

const MORE_SECTIONS = ['insights', 'team', 'guide', 'settings'];


const ONBOARDING_STEPS = [
    {
        title: '從大目標開始',
        desc: '有模糊的大目標？先到「任務」頁用目標分解器拆開，AI 會推薦你今日第一步。',
        icon: 'fa-wand-magic-sparkles',
        iconBg: 'bg-purple-500/15 text-purple-400',
        section: 'scheduler',
        highlight: null,
        onEnter: () => openDecomposeTab()
    },
    {
        title: '鎖定今日第一步',
        desc: '回到「今日」頁，你會看到系統推薦的今日第一步——今天只做最重要那一件。',
        icon: 'fa-forward-step',
        iconBg: 'bg-indigo-500/15 text-indigo-400',
        section: 'dashboard',
        highlight: 'next-step-card'
    },
    {
        title: '行動教練帶你做',
        desc: '卡住或拖延？點「教練」，它會讀取你的任務，告訴你怎麼開始——不是空泛聊天。',
        icon: 'fa-bolt',
        iconBg: 'bg-sky-500/15 text-sky-400',
        section: 'coach'
    }
];
