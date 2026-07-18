/* Lumina: boot/init.js */
async function initializeApp() {
    if (window.__luminaAppInitialized) return;
    window.__luminaAppInitialized = true;

    try { setupActionDelegation(); } catch (e) { console.warn('[Lumina] Action delegation skipped', e); }
    try { initializeTailwind(); } catch (e) { console.warn('[Lumina] Tailwind init skipped', e); }
    try { setupManifest(); } catch (e) { console.warn('[Lumina] Manifest setup skipped', e); }
    try { registerServiceWorker(); } catch (e) { console.warn('[Lumina] Service worker skipped', e); }
    try { setupPwaInstall(); } catch (e) { console.warn('[Lumina] PWA install skipped', e); }
    try { setupOfflineDetection(); } catch (e) { console.warn('[Lumina] Offline detection skipped', e); }

    // Local state must never hard-fail boot (corrupt JSON is common)
    try {
        loadState();
    } catch (e) {
        console.error('[Lumina] loadState crashed', e);
        if (!Array.isArray(S.tasks)) S.tasks = [];
    }

    try {
        await checkAuthOnInit();
    } catch (e) {
        console.warn('[Lumina] checkAuthOnInit failed', e);
        try { updateAuthUI(); } catch (_) {}
    }

    // Only preload enterprise chunk when needed — never block whole app if chunk fails
    const needsEnterprise =
        !!S.enterpriseSession ||
        !!(typeof URLSearchParams !== 'undefined' &&
            new URLSearchParams(window.location.search || '').get('group'));
    if (needsEnterprise && typeof window.__luminaEnsureEnterprise === 'function') {
        try {
            await window.__luminaEnsureEnterprise();
        } catch (e) {
            console.warn('[Lumina] enterprise chunk preload failed (app continues)', e);
        }
    }

    try { applyTeamInviteFromUrl(); } catch (e) { console.warn('[Lumina] applyTeamInviteFromUrl', e); }

    if (S.enterpriseSession) {
        try { loadLocallyReadNotificationIds(); } catch (e) { console.warn('[Lumina] loadLocallyReadNotificationIds', e); }
        try { updateNotificationUI(); } catch (e) { console.warn('[Lumina] updateNotificationUI', e); }
        try {
            // Always resolve via window — lazy stubs live on window, bare free-ids can throw in strict bundles
            const pollFn = window.startEnterprisePolling || startEnterprisePolling;
            const poll = typeof pollFn === 'function' ? pollFn() : null;
            if (poll && typeof poll.catch === 'function') poll.catch(err => console.warn('[Lumina] polling start', err));
        } catch (e) { console.warn('[Lumina] startEnterprisePolling', e); }
        try {
            const notesFn = window.refreshTeamNotifications || refreshTeamNotifications;
            const notes = typeof notesFn === 'function' ? notesFn() : null;
            if (notes && typeof notes.catch === 'function') notes.catch(err => console.warn('[Lumina] notifications', err));
        } catch (e) { console.warn('[Lumina] refreshTeamNotifications', e); }
    }

    try {
        refreshUIImmediate({ dashboard: true, scheduler: true, filters: true });
    } catch (e) {
        console.error('[Lumina] Dashboard init failed', e);
        try { showToast('部分介面載入失敗，請重新整理頁面', 'error'); } catch (_) {}
    }

    const navDashboard = document.getElementById('nav-dashboard');
    if (navDashboard) navDashboard.classList.add('active', 'text-indigo-400');

    setTimeout(() => {
        try {
            const streakEl = document.getElementById('streak');
            if (streakEl && Math.random() > 0.7) {
                streakEl.style.transitionDuration = '400ms';
            }
        } catch (_) {}
    }, 1200);

    if (S.rolledCountOnInit > 0) {
        try { showToast(`${S.rolledCountOnInit} 項延後任務已移至今日`, 'success'); } catch (_) {}
    }

    setTimeout(() => {
        try {
            if (document.getElementById('auth-overlay')?.classList.contains('hidden') &&
                !localStorage.getItem('lumina_onboarding_v2') && (S.tasks?.length || 0) === 0) {
                startOnboarding();
            } else if (!document.getElementById('auth-overlay')?.classList.contains('hidden')) {
                /* wait for auth */
            } else if (!localStorage.getItem('lumina_welcomed')) {
                showToast('歡迎使用 Lumina AI！', 'success');
                localStorage.setItem('lumina_welcomed', 'true');
            }
        } catch (e) {
            console.warn('[Lumina] post-init onboarding', e);
        }
    }, 900);

    try { setupKeyboardShortcuts(); } catch (e) { console.warn('[Lumina] keyboard shortcuts', e); }
    try {
        const p = refreshServiceStatus?.();
        if (p && typeof p.catch === 'function') p.catch(err => console.warn('[Lumina] service status', err));
    } catch (e) { console.warn('[Lumina] refreshServiceStatus', e); }

    document.addEventListener('click', (e) => {
        try {
            const wrap = document.getElementById('nav-more-wrap');
            if (wrap && !wrap.contains(e.target)) closeNavMore();
            const notifWrap = document.getElementById('notif-wrap');
            if (S.notifPanelOpen && notifWrap && !notifWrap.contains(e.target)) closeNotificationPanel();
        } catch (_) {}
    });

    console.debug('%c[Lumina AI] 已成功初始化。使用者可立即使用所有功能。', 'color:#475569');

    try { setupRagHealthMonitoring(); } catch (e) { console.warn('[Lumina] RAG health monitor', e); }
}