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
    
    setElText('tasks-completed', stats.completed);
    setElText('tasks-total', todayTotal);
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
    // Show more of today's queue; virtualize when long
    const displayRanked = ranked.slice(0, 40);

    if (displayRanked.length === 0) {
        S.todayListVirtual = null;
        container.onscroll = null;
        container.classList.remove('virtual-list-host');
        delete container.dataset.virtual;
        if (S.tasks.length === 0) {
            container.innerHTML = `
                <div class="beginner-empty-list">
                    <div class="text-sm text-slate-300 font-medium">還沒有任務</div>
                    <div class="text-xs text-slate-500 mt-1">在上方輸入一項，或用「一鍵體驗」看看流程</div>
                </div>`;
        } else {
            const futureHint = stats.futureCount > 0
                ? `<span class="text-xs text-slate-500 mt-1">之後還有 ${stats.futureCount} 項待辦，可到「任務」頁查看</span>`
                : '';
            container.innerHTML = `<div class="text-center py-4 text-emerald-400 flex flex-col items-center"><i class="fa-solid fa-check-circle text-3xl mb-2"></i><span class="text-sm">太棒了！今日任務已全部完成</span>${futureHint}</div>`;
        }
    } else {
        const mount = globalThis.LuminaVirtual?.mountVirtualList;
        if (mount && displayRanked.length > 12) {
            if (!S.todayListVirtual || container.dataset.virtual === undefined) {
                S.todayListVirtual = mount(container, {
                    items: displayRanked,
                    rowHeight: 72,
                    threshold: 12,
                    renderRow: (task) => renderPersonalTaskRow(task, 'dashboard')
                });
            } else {
                S.todayListVirtual.refresh(displayRanked);
            }
        } else {
            S.todayListVirtual = null;
            container.onscroll = null;
            container.classList.remove('virtual-list-host');
            delete container.dataset.virtual;
            container.innerHTML = displayRanked.map(t => renderPersonalTaskRow(t, 'dashboard')).join('');
        }
    }
    
    renderActiveGoalsPanel();
    updateNextStepCard(stats);
    try { renderBeginnerWelcome(); } catch (_) {}
    try { applySimpleModeChrome(); } catch (_) {}
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
    if (due <= getTodayISO()) S.todayFocusTaskId = newTask.id;
    saveState();
    
    // Clear inputs
    document.getElementById('task-name').value = '';
    
    refreshUI({ dashboard: true, scheduler: true, filters: true, schedule: true });
    showToast(due <= getTodayISO() ? '任務已加入今日清單' : '任務已加入清單', 'success');
    if (due <= getTodayISO()) {
        try { pulseNextStepCard(); } catch (_) {}
    }
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
    const details = apiStatus.details || {};
    const apiEl = document.getElementById('status-api');
    if (apiEl) {
        if (apiReady) {
            const backend = details.store?.backend || details.auth?.backend || '';
            apiEl.textContent = backend ? `● 已就緒 (${backend})` : '● 已就緒';
            apiEl.className = 'service-status-dot service-status-ok';
            apiEl.title = formatReadinessHint(apiStatus.checks, details) || 'API 已就緒';
        } else if (apiReachable) {
            apiEl.textContent = '● 未就緒';
            apiEl.className = 'service-status-dot service-status-off';
            apiEl.title = formatReadinessHint(apiStatus.checks, details) || 'API 已連線但子系統未就緒';
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

    try {
        let ragOk = false;
        if (apiStatus.checks && 'rag' in apiStatus.checks) {
            ragOk = !!apiStatus.checks.rag;
        }
        const ragDetail = details.rag || {};
        const ragEl = document.getElementById('status-rag');
        if (ragEl) {
            if (ragOk) {
                const bits = [];
                if (ragDetail.retrieval) bits.push(ragDetail.retrieval);
                if (ragDetail.latencyMs != null) bits.push(`${ragDetail.latencyMs}ms`);
                ragEl.textContent = bits.length ? `● 已連線 (${bits.join(' · ')})` : '● 已連線';
                ragEl.className = 'service-status-dot service-status-ok';
                ragEl.title = formatReadinessHint(apiStatus.checks, details) || '經 API /ready 檢查';
            } else {
                const errHint = ragDetail.errorCode || ragDetail.error || '';
                ragEl.textContent = errHint ? `● 未連線 (${errHint})` : '● 未連線';
                ragEl.className = 'service-status-dot service-status-off';
                ragEl.title = apiReachable
                    ? (`API 已連線，RAG 未就緒` + (errHint ? ` — ${errHint}` : ''))
                    : '請執行 npm run dev';
            }
        }
    } catch (_) {
        setStatus('status-rag', false, '', '● 未連線');
    }

    // Wave 3: expand ops detail panel when present
    try {
        await renderServiceOpsPanel(apiStatus);
    } catch (e) {
        console.warn('[Lumina] ops panel', e);
    }

    renderCoachReadinessBar();
}

async function renderServiceOpsPanel(apiStatus) {
    const detailEl = document.getElementById('service-status-detail');
    const eventsEl = document.getElementById('service-index-events');
    if (!detailEl && !eventsEl) return;

    const ops = await fetchOpsStatus(10);
    const details = (ops && ops.details) || apiStatus.details || {};
    const rag = details.rag || {};
    const uptime = ops?.uptimeSec != null ? ops.uptimeSec : apiStatus.uptimeSec;
    const jobs = ops?.backgroundIndexJobs != null
        ? ops.backgroundIndexJobs
        : apiStatus.backgroundIndexJobs;

    if (detailEl) {
        const lines = [
            `uptime: ${uptime != null ? uptime + 's' : '—'}`,
            `store: ${details.store?.backend || '—'}`,
            `auth: ${details.auth?.backend || '—'}`,
            `rag: ${rag.ok ? 'up' : 'down'}` +
                (rag.latencyMs != null ? ` ${rag.latencyMs}ms` : '') +
                (rag.embedding ? ` · ${rag.embedding}` : '') +
                (rag.retrieval ? ` · ${rag.retrieval}` : '') +
                (rag.errorCode ? ` · ${rag.errorCode}` : ''),
            `indexJobs: ${jobs != null ? jobs : 0}`
        ];
        detailEl.textContent = lines.join('\n');
        detailEl.classList.remove('hidden');
    }

    if (eventsEl) {
        const events = Array.isArray(ops?.recentIndexEvents) ? ops.recentIndexEvents : [];
        if (!events.length) {
            eventsEl.innerHTML = '<div class="text-[10px] text-slate-500">尚無近期索引事件（服務重啟後清空）</div>';
        } else {
            eventsEl.innerHTML = events.slice(0, 8).map(ev => {
                const outcome = escapeHtml(ev.outcome || '—');
                const code = ev.errorCode ? ` · ${escapeHtml(ev.errorCode)}` : '';
                const title = escapeHtml((ev.title || ev.documentId || '').toString().slice(0, 40));
                const ts = ev.ts ? escapeHtml(String(ev.ts).replace('T', ' ').slice(0, 19)) : '';
                const ms = ev.durationMs != null ? ` · ${ev.durationMs}ms` : '';
                const color = ev.outcome === 'indexed'
                    ? 'text-emerald-400'
                    : (ev.outcome === 'failed' ? 'text-rose-400' : 'text-amber-300');
                return `<div class="text-[10px] py-1 border-b border-slate-800/80 last:border-0">
                    <span class="${color} font-medium">${outcome}</span>${code}${ms}
                    <span class="text-slate-500"> · ${title}</span>
                    <div class="text-slate-600">${ts}</div>
                </div>`;
            }).join('');
        }
        eventsEl.classList.remove('hidden');
    }
}

// Keyboard shortcuts hint
