/* Lumina: ui/navigation.js */
function switchSchedulerTab(tab) {
    const tasksPanel = document.getElementById('scheduler-panel-tasks');
    const decomposePanel = document.getElementById('scheduler-panel-decompose');
    const tabTasks = document.getElementById('sched-tab-tasks');
    const tabDecompose = document.getElementById('sched-tab-decompose');
    
    const isDecompose = tab === 'decompose';
    if (tasksPanel) tasksPanel.classList.toggle('hidden', isDecompose);
    if (decomposePanel) decomposePanel.classList.toggle('hidden', !isDecompose);
    if (tabTasks) tabTasks.classList.toggle('active', !isDecompose);
    if (tabDecompose) tabDecompose.classList.toggle('active', isDecompose);
}

function openDecomposeTab() {
    showSection('scheduler');
    switchSchedulerTab('decompose');
}

function showGuideTab(tab) {
    ['solutions', 'manual', 'workflow'].forEach(t => {
        document.getElementById('guide-panel-' + t)?.classList.toggle('active', t === tab);
        document.getElementById('guide-tab-' + t)?.classList.toggle('active', t === tab);
    });
}

function closeNavMore() {
    const menu = document.getElementById('nav-more-menu');
    const btn = document.getElementById('nav-more-btn');
    if (menu) menu.classList.add('hidden');
    if (btn) btn.setAttribute('aria-expanded', 'false');
    closeMobileMore();
}

function toggleNavMore() {
    const menu = document.getElementById('nav-more-menu');
    const btn = document.getElementById('nav-more-btn');
    if (!menu || !btn) return;
    menu.classList.toggle('hidden');
    btn.setAttribute('aria-expanded', menu.classList.contains('hidden') ? 'false' : 'true');
}

function navigateFromMore(section) {
    closeNavMore();
    showSection(section);
}

function updateNavMoreState(section) {
    const moreBtn = document.getElementById('nav-more-btn');
    const mobMore = document.getElementById('mob-nav-more');
    const isMore = MORE_SECTIONS.includes(section);
    
    if (moreBtn) {
        moreBtn.classList.toggle('active', isMore);
        moreBtn.classList.toggle('text-indigo-400', isMore);
    }
    if (mobMore) {
        mobMore.classList.toggle('active', isMore);
        mobMore.classList.toggle('text-indigo-400', isMore);
        mobMore.classList.toggle('text-slate-400', !isMore);
    }
    MORE_SECTIONS.forEach(s => {
        const item = document.getElementById('nav-dropdown-' + s);
        if (item) item.classList.toggle('active', section === s);
    });
}

function toggleMobileMore() {
    const sheet = document.getElementById('mobile-more-sheet');
    if (sheet) sheet.classList.toggle('hidden');
}

function closeMobileMore() {
    const sheet = document.getElementById('mobile-more-sheet');
    if (sheet) sheet.classList.add('hidden');
}

function navigateFromMobileMore(section) {
    closeMobileMore();
    showSection(section);
}

function showSection(section) {
    if (section === 'decomposer') {
        openDecomposeTab();
        return;
    }
    
    closeNavMore();
    
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    
    const target = document.getElementById(section);
    if (target) target.classList.add('active');
    
    document.querySelectorAll('.nav-link[id^="nav-"]').forEach(nav => {
        if (nav.id === 'nav-more-btn') return;
        nav.classList.remove('active', 'text-indigo-400');
        nav.classList.add('text-slate-300');
        nav.removeAttribute('aria-current');
    });
    
    const activeNav = document.getElementById('nav-' + section);
    if (activeNav) {
        activeNav.classList.add('active', 'text-indigo-400');
        activeNav.classList.remove('text-slate-300');
        activeNav.setAttribute('aria-current', 'page');
    }
    
    updateNavMoreState(section);
    
    document.querySelectorAll('.mobile-nav-btn').forEach(btn => {
        btn.classList.remove('active', 'text-indigo-400');
        btn.classList.add('text-slate-400');
    });
    if (!MORE_SECTIONS.includes(section)) {
        const mobNav = document.getElementById('mob-nav-' + section);
        if (mobNav) {
            mobNav.classList.add('active', 'text-indigo-400');
            mobNav.classList.remove('text-slate-400');
        }
    }
    
    const pageTitle = PAGE_TITLES[section] || 'Lumina';
    document.title = pageTitle + ' · 光流 AI Lumina';
    
    window.scrollTo({ top: 0, behavior: 'smooth' });
    
    // Special inits
    if (section === 'insights') {
        refreshInsightsPage();
    }
    
    if (section === 'coach') {
        renderCoachQuickActions();
        refreshCoachView();
        renderCoachReadinessBar();
    }
    
    if (section === 'dashboard' && S.focusSession?.endsAt && S.focusSession.endsAt > Date.now() && !S.focusTimerInterval) {
        tickFocusTimer();
        S.focusTimerInterval = setInterval(tickFocusTimer, 1000);
    }
    
    if (section === 'settings') {
        loadSettingsForm();
        refreshServiceStatus();
    }
    
    if (section === 'guide') {
        showGuideTab('solutions');
    }
    
    if (section === 'team') {
        ensurePdfJs().catch(() => {});
        ensureXlsx().catch(() => {});
        renderEnterprisePage();
        updateTeamSyncStatus();
        startEnterprisePolling();
    } else {
        stopEnterprisePolling();
    }
    
    if (section === 'scheduler') {
        if (S.schedulerTabPending) {
            switchSchedulerTab(S.schedulerTabPending);
            S.schedulerTabPending = null;
        }
        refreshUI({ scheduler: true, filters: true });
        const timeline = $('timeline-view');
        if (timeline && timeline.innerHTML.trim() === '') {
            optimizeSchedule(true);
        }
    }
    
    if (section === 'dashboard') {
        refreshUI({ dashboard: true, filters: true });
    }
}

function setupKeyboardShortcuts() {
    const NAV_KEYS = { '1': 'dashboard', '2': 'scheduler', '3': 'coach', '4': 'insights' };
    
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            if (!document.getElementById('task-edit-modal')?.classList.contains('hidden')) {
                closeTaskEdit();
                return;
            }
            if (!document.getElementById('auth-overlay')?.classList.contains('hidden') && !needsAuthGate()) {
                hideAuthOverlay();
                return;
            }
            if (!document.getElementById('onboarding-overlay')?.classList.contains('hidden')) {
                skipOnboarding();
                return;
            }
            closeNavMore();
            closeMobileMore();
            return;
        }
        
        if ((e.metaKey || e.ctrlKey) && e.key === '/') {
            e.preventDefault();
            const dashboard = document.getElementById('dashboard');
            if (dashboard.classList.contains('active')) {
                document.getElementById('quick-task-input').focus();
            } else {

/* Lumina module: init, shortcuts, boot */
                showSection('dashboard');
                setTimeout(() => document.getElementById('quick-task-input').focus(), 300);
            }
        }
        
        if (e.key === '?' && document.activeElement.tagName === 'BODY') {
            e.preventDefault();
            showSection('coach');
        }
        
        if (!e.metaKey && !e.ctrlKey && !e.altKey && NAV_KEYS[e.key] && document.activeElement.tagName === 'BODY') {
            showSection(NAV_KEYS[e.key]);
        }
    });
    
    console.log('%c[Lumina AI] 快捷鍵：1-4 切換頁面，Cmd/Ctrl+/ 新增任務，? 開啟 AI 教練，Esc 關閉', 'color:#64748b');
}
