/* Lumina: ui/dashboard.js */
function updateDashboard() {
    const stats = getTodayStats();
    rebuildTodayQueueMap();
    const scoreCtx = getScoringContext();
    const todayRelevant = stats.relevant;
    const todayTotal = todayRelevant.length || 1;
    const firstName = S.userProfile.name.split(' ')[0] || S.userProfile.name;
    const weekScore = Math.round(S.weeklyScores.reduce((a, b) => a + b, 0) / S.weeklyScores.length);
    
    setElText('greeting-text', `${getGreeting()}，${firstName}`);
    
    const summaryEl = $('today-summary');
    if (summaryEl) {
        const futureNote = stats.futureCount > 0 ? ` · 之後 ${stats.futureCount} 項` : '';
        summaryEl.textContent = `${formatDateTW()} · 今日 ${stats.completed}/${todayRelevant.length} 項（${stats.rate}%）${futureNote} · 連續 ${S.userProfile.streak} 天 · 本週 ${weekScore} 分`;
    }
    
    setElText('S.tasks-completed', stats.completed);
    setElText('S.tasks-total', todayTotal);
    setElText('focus-time', (stats.focusMinutes / 60).toFixed(1));
    
    const comparison = getFocusComparisonText(stats.focusMinutes);
    const compEl = document.getElementById('focus-comparison');
    if (compEl) {
        const icon = comparison.positive === true ? 'fa-arrow-trend-up text-emerald-400'
            : comparison.positive === false ? 'fa-arrow-trend-down text-amber-400'
            : 'fa-chart-line text-slate-400';
        compEl.className = `text-xs mt-4 flex items-center gap-x-1 ${comparison.positive === true ? 'text-emerald-400' : comparison.positive === false ? 'text-amber-400' : 'text-slate-400'}`;
        compEl.innerHTML = `<i class="fa-solid ${icon}"></i><span>${comparison.text}</span>`;
    }
    
    const completionPercent = todayRelevant.length > 0 ? stats.rate : 0;
    setElStyle('completion-bar', 'width', completionPercent + '%');
    
    setElText('streak', S.userProfile.streak);
    setElText('user-meta', `${S.userProfile.role} • 第 ${S.userProfile.joinDay} 天`);
    setElText('user-name', S.userProfile.name);
    
    const avatar = document.getElementById('user-avatar');
    if (avatar) avatar.innerText = getInitials(S.userProfile.name);
    
    setElText('dash-peak-time', `${S.userProfile.peakStart || '09:00'} - ${S.userProfile.peakEnd || '12:30'}`);
    
    setElText('dash-peak-hint', stats.highEnergyPending > 0
        ? `你設定的最高效時段 • ${stats.highEnergyPending} 項高能量待辦`
        : `你設定的最高效時段 • 今日完成 ${stats.rate}%`);
    setElText('best-streak', S.userProfile.bestStreak);
    
    const container = $('today-focus-list');
    if (!container) return;
    
    const pending = getFilteredTasks(stats.pending);
    const ranked = rankTasksByNextStepScore(pending, scoreCtx);
    if (!S.todayFocusTaskId && ranked.length) S.todayFocusTaskId = ranked[0].id;
    const displayRanked = ranked.slice(0, 8);
    
    if (displayRanked.length === 0) {
        const futureHint = stats.futureCount > 0
            ? `<span class="text-xs text-slate-500 mt-1">之後還有 ${stats.futureCount} 項待辦，可到「任務」頁查看</span>`
            : '';
        container.innerHTML = `<div class="text-center py-4 text-emerald-400 flex flex-col items-center"><i class="fa-solid fa-check-circle text-3xl mb-2"></i><span class="text-sm">太棒了！今日任務已全部完成</span>${futureHint}</div>`;
    } else {
        container.innerHTML = displayRanked.map(t => renderPersonalTaskRow(t, 'dashboard')).join('');
    }
    
    renderActiveGoalsPanel();
    updateNextStepCard(stats);
}

function syncCategoryFromEnergy() {
    const energy = parseInt(document.getElementById('task-energy').value);
    const name = document.getElementById('task-name').value;
    const cat = inferCategory(name || '任務', energy);
    document.getElementById('task-category').value = cat;
}

function addTaskToList() {
    const name = document.getElementById('task-name').value.trim();
    if (!name) {
        showToast('請輸入任務名稱', 'error');
        return;
    }
    
    const duration = parseInt(document.getElementById('task-duration').value) || 30;
    const energy = parseInt(document.getElementById('task-energy').value);
    const category = document.getElementById('task-category').value;
    const due = document.getElementById('task-due').value || getTodayISO();
    
    const newTask = {
        id: Date.now(),
        name: name,
        duration: duration,
        energy: energy,
        category: category,
        due: due,
        completed: false,
        updatedAt: new Date().toISOString()
    };
    
    S.tasks.push(newTask);
    saveState();
    
    // Clear inputs
    document.getElementById('task-name').value = '';
    
    refreshUI({ scheduler: true, filters: true, schedule: true });
    showToast('任務已加入清單', 'success');
}

function getTimeDistribution() {
    const cats = { deep: 0, execution: 0, meeting: 0, learning: 0, admin: 0 };
    S.tasks.forEach(t => {
        const cat = t.category || inferCategory(t.name, t.energy);
        cats[cat] = (cats[cat] || 0) + t.duration;
    });
    const totalMins = Object.values(cats).reduce((a, b) => a + b, 0);
    const pct = (v) => totalMins > 0 ? Math.round((v / totalMins) * 100) : 0;
    return {
        deep: pct(cats.deep),
        exec: pct(cats.execution),
        meeting: pct(cats.meeting),
        learn: pct(cats.learning),
        admin: pct(cats.admin),
        minutes: cats,
        totalMins
    };
}

async function refreshServiceStatus() {
    const setStatus = (id, ok, okText, failText) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = ok ? okText : failText;
        el.className = 'service-status-dot ' + (ok ? 'service-status-ok' : 'service-status-off');
    };

    const apiStatus = await fetchApiReadiness();
    const apiReady = apiStatus.ready;
    const apiReachable = apiStatus.reachable;
    const apiEl = document.getElementById('status-api');
    if (apiEl) {
        if (apiReady) {
            apiEl.textContent = '● 已就緒';
            apiEl.className = 'service-status-dot service-status-ok';
            apiEl.title = formatReadinessHint(apiStatus.checks) || 'API 已就緒';
        } else if (apiReachable) {
            apiEl.textContent = '● 未就緒';
            apiEl.className = 'service-status-dot service-status-off';
            apiEl.title = formatReadinessHint(apiStatus.checks) || 'API 已連線但子系統未就緒';
        } else {
            apiEl.textContent = '● 未連線';
            apiEl.className = 'service-status-dot service-status-off';
            apiEl.title = '請執行 npm run api';
        }
    }

    if (apiReady && isLoggedIn()) {
        setStatus('status-sync', true, '● 已登入可同步', '● 訪客模式');
    } else if (apiReady) {
        setStatus('status-sync', false, '', '● 訪客模式');
    } else if (apiReachable) {
        setStatus('status-sync', false, '', '● API 啟動中');
    } else {
        setStatus('status-sync', false, '', '● 需啟動 API');
    }

    // Prefer /ready checks.rag (enterprise base); avoid hardcoding only 127.0.0.1:8000
    try {
        let ragOk = false;
        let mode = '';
        if (apiStatus.checks && 'rag' in apiStatus.checks) {
            ragOk = !!apiStatus.checks.rag;
        } else {
            const base = typeof getEnterpriseBaseUrl === 'function' ? getEnterpriseBaseUrl() : '';
            const res = await fetch((base || '') + '/ready', { method: 'GET' });
            const data = res.ok ? await res.json().catch(() => ({})) : null;
            if (data?.checks && 'rag' in data.checks) {
                ragOk = !!data.checks.rag;
            }
        }
        const ragEl = document.getElementById('status-rag');
        if (ragEl) {
            if (ragOk) {
                ragEl.textContent = mode ? `● 已連線 (${mode})` : '● 已連線';
                ragEl.className = 'service-status-dot service-status-ok';
                ragEl.title = '經 API /ready 檢查';
            } else {
                ragEl.textContent = '● 未連線';
                ragEl.className = 'service-status-dot service-status-off';
                ragEl.title = apiReachable ? 'API 已連線，RAG 子系統未就緒' : '請執行 npm run dev';
            }
        }
    } catch (_) {
        setStatus('status-rag', false, '', '● 未連線');
    }

    renderCoachReadinessBar();
}

// Keyboard shortcuts hint
