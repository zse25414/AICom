/* Lumina: storage/persist.js */
function loadDailyHistory() {
    try {
        const saved = localStorage.getItem(C.DAILY_HISTORY_KEY);
        if (saved) S.dailyHistory = JSON.parse(saved);
    } catch (_) {
        S.dailyHistory = {};
    }
}

function saveDailyHistory() {
    localStorage.setItem(C.DAILY_HISTORY_KEY, JSON.stringify(S.dailyHistory));
}

function loadTrackedFocus() {
    try {
        const saved = localStorage.getItem(C.TRACKED_FOCUS_KEY);
        S.trackedFocusByDay = saved && typeof JSON.parse(saved) === 'object' ? JSON.parse(saved) : {};
    } catch (_) {
        S.trackedFocusByDay = {};
    }
}

function saveTrackedFocus() {
    localStorage.setItem(C.TRACKED_FOCUS_KEY, JSON.stringify(S.trackedFocusByDay));
}

function getTrackedFocusMinutesForDate(dateISO) {
    let mins = Math.max(0, parseInt(S.trackedFocusByDay[dateISO], 10) || 0);
    if (dateISO === getTodayISO() && S.focusSession?.startedAt) {
        mins += Math.max(0, Math.round((Date.now() - S.focusSession.startedAt) / 60000));
    }
    return mins;
}

function recordFocusSessionMinutes(session) {
    if (!session?.startedAt || session.recorded) return 0;
    const elapsed = Math.max(1, Math.round((Date.now() - session.startedAt) / 60000));
    const today = getTodayISO();
    S.trackedFocusByDay[today] = (S.trackedFocusByDay[today] || 0) + elapsed;
    session.recorded = true;
    saveTrackedFocus();
    invalidateTodayStats();
    return elapsed;
}

function mergeTasksArrays(serverTasks, localTasks) {
    const byId = new Map();
    for (const t of [...(serverTasks || []), ...(localTasks || [])]) {
        if (!t || t.id === undefined || t.id === null) continue;
        const prev = byId.get(t.id);
        if (!prev) {
            byId.set(t.id, t);
            continue;
        }
        const prevTs = Date.parse(prev.updatedAt || '') || 0;
        const nextTs = Date.parse(t.updatedAt || '') || 0;
        byId.set(t.id, nextTs >= prevTs ? t : prev);
    }
    return Array.from(byId.values());
}

function trimDailyHistory(maxDays = 30) {
    const keys = Object.keys(S.dailyHistory).sort();
    while (keys.length > maxDays) {
        delete S.dailyHistory[keys.shift()];
    }
}

function snapshotDay(dateISO) {
    const relevant = S.tasks.filter(t => t.due <= dateISO);
    const completed = relevant.filter(t => t.completed);
    const tracked = getTrackedFocusMinutesForDate(dateISO);
    S.dailyHistory[dateISO] = {
        focusMinutes: tracked || completed.reduce((s, t) => s + (t.duration || 0), 0),
        trackedFocusMinutes: tracked,
        completed: completed.length,
        total: relevant.length,
        rate: relevant.length ? Math.round((completed.length / relevant.length) * 100) : 0
    };
}

function recordDailySnapshot() {
    snapshotDay(getTodayISO());
    trimDailyHistory();
    saveDailyHistory();
}

function recalculateWeeklyScores() {
    const scores = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);
        const iso = toLocalISO(d);
        if (S.dailyHistory[iso]) {
            scores.push(S.dailyHistory[iso].rate);
        } else if (iso === getTodayISO()) {
            scores.push(getTodayCompletionRate());
        } else {
            scores.push(0);
        }
    }
    S.weeklyScores = scores;
}

function getFocusComparisonText(todayMinutes = getTodayFocusMinutes()) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayISO = toLocalISO(yesterday);
    const yesterdayMinutes = S.dailyHistory[yesterdayISO]?.focusMinutes ?? 0;
    
    if (todayMinutes === 0 && yesterdayMinutes === 0) {
        return { text: '尚無比較數據', positive: null };
    }
    if (yesterdayMinutes === 0) {
        return { text: `今日已專注 ${(todayMinutes / 60).toFixed(1)}h`, positive: true };
    }
    const diffMin = todayMinutes - yesterdayMinutes;
    const diffH = Math.abs(diffMin / 60).toFixed(1);
    if (diffMin > 0) return { text: `+${diffH}h 比昨天`, positive: true };
    if (diffMin < 0) return { text: `-${diffH}h 比昨天`, positive: false };
    return { text: '與昨天相同', positive: null };
}

function applyStreakReward(dateISO, rate, { notify = false } = {}) {
    const earnedKey = 'lumina_streak_earned_' + dateISO;
    if (localStorage.getItem(earnedKey)) return false;
    
    const threshold = S.userProfile.streakThreshold || 80;
    if (rate < threshold) return false;
    
    localStorage.setItem(earnedKey, 'true');
    const prev = new Date(dateISO + 'T12:00:00');
    prev.setDate(prev.getDate() - 1);
    const prevISO = toLocalISO(prev);
    const lastEarned = localStorage.getItem('lumina_last_streak_date');
    
    if (lastEarned === prevISO) S.userProfile.streak += 1;
    else S.userProfile.streak = 1;
    
    S.userProfile.bestStreak = Math.max(S.userProfile.bestStreak || 0, S.userProfile.streak);
    localStorage.setItem('lumina_last_streak_date', dateISO);
    
    if (notify) {
        showToast(`🔥 達成今日 ${threshold}% 目標！連續高效 ${S.userProfile.streak} 天`, 'success');
    }
    return true;
}

function evaluateStreakForDate(dateISO) {
    const snap = S.dailyHistory[dateISO];
    applyStreakReward(dateISO, snap?.rate ?? 0);
}

function processDailyRollover() {
    const today = getTodayISO();
    const lastActive = localStorage.getItem(C.LAST_ACTIVE_DATE_KEY);
    
    if (!lastActive) {
        localStorage.setItem(C.LAST_ACTIVE_DATE_KEY, today);
        recordDailySnapshot();
        recalculateWeeklyScores();
        return { rolledCount: 0 };
    }
    
    if (lastActive === today) {
        recordDailySnapshot();
        recalculateWeeklyScores();
        return { rolledCount: 0 };
    }
    
    snapshotDay(lastActive);
    evaluateStreakForDate(lastActive);
    
    let rolledCount = 0;
    S.tasks.forEach(t => {
        if (!t.completed && t.due < today) {
            t.due = today;
            t.wasOverdue = true;
            rolledCount++;
        }
    });
    
    const daysDiff = Math.max(1, Math.round((new Date(today + 'T12:00:00') - new Date(lastActive + 'T12:00:00')) / 86400000));
    S.userProfile.joinDay = (S.userProfile.joinDay || 1) + daysDiff;
    
    localStorage.setItem(C.LAST_ACTIVE_DATE_KEY, today);
    recordDailySnapshot();
    recalculateWeeklyScores();
    saveState({ immediateAnalytics: true });
    
    return { rolledCount };
}

function safeParseJson(raw, fallback) {
    if (raw == null || raw === '') return fallback;
    try {
        return JSON.parse(raw);
    } catch (e) {
        console.warn('[Lumina] localStorage JSON 損壞，已忽略', e?.message || e);
        return fallback;
    }
}

function loadState() {
    try {
        const savedTasks = localStorage.getItem('lumina_tasks');
        if (savedTasks) {
            const parsed = safeParseJson(savedTasks, null);
            S.tasks = Array.isArray(parsed) ? parsed : [];
            if (!Array.isArray(parsed)) {
                try { localStorage.setItem('lumina_tasks', JSON.stringify(S.tasks)); } catch (_) {}
            }
        } else {
            S.tasks = [];
            try { localStorage.setItem('lumina_tasks', JSON.stringify(S.tasks)); } catch (_) {}
        }

        try { loadDailyHistory(); } catch (e) { console.warn('[Lumina] loadDailyHistory', e); }
        try { loadTrackedFocus(); } catch (e) { console.warn('[Lumina] loadTrackedFocus', e); }
        try { migrateApiKeyStorage(); } catch (e) { console.warn('[Lumina] migrateApiKeyStorage', e); }

        const savedProfile = localStorage.getItem('lumina_profile');
        if (savedProfile) {
            const profile = safeParseJson(savedProfile, null);
            if (profile && typeof profile === 'object' && !Array.isArray(profile)) {
                S.userProfile = { ...S.userProfile, ...profile };
            }
        }

        const savedEnterprise = localStorage.getItem('lumina_enterprise_session');
        if (savedEnterprise) {
            const ent = safeParseJson(savedEnterprise, null);
            S.enterpriseSession = (ent && typeof ent === 'object' && ent.groupCode)
                ? ent
                : null;
            if (!S.enterpriseSession) {
                try { localStorage.removeItem('lumina_enterprise_session'); } catch (_) {}
            }
        }

        try { migrateTasks(); } catch (e) {
            console.warn('[Lumina] migrateTasks failed, resetting task list shape', e);
            if (!Array.isArray(S.tasks)) S.tasks = [];
        }

        try {
            const rollover = processDailyRollover();
            S.rolledCountOnInit = rollover?.rolledCount || 0;
        } catch (e) {
            console.warn('[Lumina] processDailyRollover', e);
            S.rolledCountOnInit = 0;
        }

        const dueInput = document.getElementById('task-due');
        if (dueInput) {
            try { dueInput.value = getTomorrowISO(); } catch (_) {}
        }

        const thresholdSlider = document.getElementById('settings-streak-threshold');
        if (thresholdSlider && !thresholdSlider.dataset.bound) {
            thresholdSlider.dataset.bound = '1';
            thresholdSlider.addEventListener('input', () => {
                const el = document.getElementById('settings-streak-value');
                if (el) el.innerText = thresholdSlider.value + '%';
            });
        }

        document.getElementById('settings-api-mode')?.addEventListener('change', toggleApiModeFields);
        try { migrateApiSettings(); } catch (e) { console.warn('[Lumina] migrateApiSettings', e); }
        try { updateApiStatusBadge(); } catch (e) { console.warn('[Lumina] updateApiStatusBadge', e); }
    } catch (e) {
        console.error('[Lumina] loadState fatal, using defaults', e);
        if (!Array.isArray(S.tasks)) S.tasks = [];
        S.enterpriseSession = S.enterpriseSession || null;
        S.rolledCountOnInit = 0;
    }
}

function exportData() {
    const safeProfile = { ...S.userProfile };
    delete safeProfile.apiKey;
    const data = {
        version: 4,
        exportedAt: new Date().toISOString(),
        tasks: S.tasks,
        userProfile: safeProfile,
        weeklyScores: S.weeklyScores,
        dailyHistory: S.dailyHistory,
        trackedFocusByDay: S.trackedFocusByDay
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `lumina-backup-${getTodayISO()}.json`;
    a.click();
    showToast('資料已匯出', 'success');
}

function importData(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > C.IMPORT_MAX_BYTES) {
        showToast('匯入失敗：檔案過大（上限 2MB）', 'error');
        event.target.value = '';
        return;
    }
    
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            validateImportedData(data);
            if (data.tasks) {
                S.tasks = data.tasks.map((t, i) => sanitizeImportedTask(t, i)).filter(Boolean);
            }
            if (data.userProfile) {
                S.userProfile = { ...S.userProfile, ...sanitizeImportedProfile(data.userProfile) };
            }
            if (data.weeklyScores) {
                S.weeklyScores = data.weeklyScores.map(s => Math.min(100, Math.max(0, parseInt(s, 10) || 0)));
            }
            if (data.dailyHistory) S.dailyHistory = data.dailyHistory;
            if (data.trackedFocusByDay) {
                S.trackedFocusByDay = data.trackedFocusByDay;
                saveTrackedFocus();
            }
            migrateTasks();
            saveState({ immediate: true, immediateAnalytics: true });
            refreshUI({ dashboard: true, scheduler: true });
            loadSettingsForm();
            showToast('資料匯入成功！', 'success');
        } catch (err) {
            showToast('匯入失敗：' + (err.message || '檔案格式錯誤'), 'error');
        }
    };
    reader.readAsText(file);
    event.target.value = '';
}

function persistTasks() {
    localStorage.setItem('lumina_tasks', JSON.stringify(S.tasks));
}

function persistProfile() {
    localStorage.setItem('lumina_profile', JSON.stringify(S.userProfile));
}

function persistAnalytics(immediate = false) {
    const run = () => {
        recordDailySnapshot();
        recalculateWeeklyScores();
        localStorage.setItem('lumina_weekly', JSON.stringify(S.weeklyScores));
    };
    clearTimeout(S.analyticsPersistTimer);
    if (immediate) run();
    else S.analyticsPersistTimer = setTimeout(run, 300);
}

function flushPersistState(opts = {}) {
    const { immediateAnalytics = false } = opts;
    persistTasks();
    persistProfile();
    persistAnalytics(immediateAnalytics);
    syncUserDataToServer();
}

function saveState(opts = {}) {
    const { immediate = false, immediateAnalytics = false } = opts;
    rebuildTaskIndex();
    invalidateTodayStats();
    if (immediate) {
        clearTimeout(S.persistStateTimer);
        flushPersistState({ immediateAnalytics });
        return;
    }
    clearTimeout(S.persistStateTimer);
    S.persistStateTimer = setTimeout(() => flushPersistState({ immediateAnalytics }), C.PERSIST_STATE_DELAY_MS);
}
