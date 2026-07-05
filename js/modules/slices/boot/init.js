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

    loadState();
    await checkAuthOnInit();
    await window.__luminaEnsureEnterprise?.();
    applyTeamInviteFromUrl();

    if (S.enterpriseSession) {
        loadLocallyReadNotificationIds();
        updateNotificationUI();
        startEnterprisePolling();
        refreshTeamNotifications();
    }

    try {
        refreshUIImmediate({ dashboard: true, scheduler: true, filters: true });
    } catch (e) {
        console.error('[Lumina] Dashboard init failed', e);
        showToast('部分介面載入失敗，請重新整理頁面', 'error');
    }

    const runIdle = (cb) => {
        if (typeof window.requestIdleCallback === 'function') {
            window.requestIdleCallback(cb, { timeout: 2500 });
        } else {
            setTimeout(cb, 800);
        }
    };
    runIdle(() => {
        try { refreshServiceStatus(); } catch (_) {}
    });

    const navDashboard = document.getElementById('nav-dashboard');
    if (navDashboard) navDashboard.classList.add('active', 'text-indigo-400');

    setTimeout(() => {
        const streakEl = document.getElementById('streak');
        if (streakEl && Math.random() > 0.7) {
            streakEl.style.transitionDuration = '400ms';
        }
    }, 1200);

    if (S.rolledCountOnInit > 0) {
        showToast(`${S.rolledCountOnInit} 項延後任務已移至今日`, 'success');
    }

    setTimeout(() => {
        if (document.getElementById('auth-overlay')?.classList.contains('hidden') &&
            !localStorage.getItem('lumina_onboarding_v2') && S.tasks.length === 0) {
            startOnboarding();
        } else if (!document.getElementById('auth-overlay')?.classList.contains('hidden')) {
            /* wait for auth */
        } else if (!localStorage.getItem('lumina_welcomed')) {
            showToast('歡迎使用 Lumina AI！', 'success');
            localStorage.setItem('lumina_welcomed', 'true');
        }
    }, 900);

    setupKeyboardShortcuts();
    refreshServiceStatus();

    document.addEventListener('click', (e) => {
        const wrap = document.getElementById('nav-more-wrap');
        if (wrap && !wrap.contains(e.target)) closeNavMore();
        const notifWrap = document.getElementById('notif-wrap');
        if (S.notifPanelOpen && notifWrap && !notifWrap.contains(e.target)) closeNotificationPanel();
    });

    console.log('%c[Lumina AI] 已成功初始化。使用者可立即使用所有功能。', 'color:#475569');

    setupRagHealthMonitoring();
}