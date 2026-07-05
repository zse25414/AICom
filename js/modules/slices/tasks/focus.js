/* Lumina: tasks/focus.js */
function resolveTodayFocusTask() {
    const stats = getTodayStats();
    const pending = stats.pending;
    if (!pending.length) {
        S.todayFocusTaskId = null;
        return null;
    }
    if (S.todayFocusTaskId) {
        const focused = pending.find(t => t.id === S.todayFocusTaskId);
        if (focused) return focused;
    }
    const next = rankTasksByNextStepScore(pending, getScoringContext())[0];
    S.todayFocusTaskId = next?.id ?? null;
    return next;
}

function normalizeFocusSteps(steps) {
    return (steps || []).slice(0, 4).map(s => ({
        title: s.title || '步驟',
        duration: s.duration || '10 分鐘',
        action: s.action || s.detail || s.title || ''
    })).filter(s => s.action);
}

function buildQuickStartSteps(task) {
    const name = task.name;
    const mins = task.duration || 30;
    const cat = resolveCategory(task);
    if (cat === 'meeting') {
        return [
            { title: '確認會議目標', duration: '3 分鐘', action: `寫下「${name}」要達成的 1 個決議或結論` },
            { title: '準備議程', duration: '5 分鐘', action: '列出 3 個討論重點與需要的資料' },
            { title: '產出會後行動', duration: `${Math.max(5, mins - 8)} 分鐘`, action: '整理待辦：誰、做什麼、何時完成' }
        ];
    }
    if (cat === 'learning') {
        return [
            { title: '定學習產出', duration: '3 分鐘', action: `「${name}」學完後要能說清楚的一件事` },
            { title: '專注學習', duration: `${Math.min(25, mins - 8)} 分鐘`, action: '一次只看一個來源，邊看邊記 3 個重點' },
            { title: '內化輸出', duration: '5 分鐘', action: '用 3 句話總結，或寫一則給自己的備忘' }
        ];
    }
    if (mins <= 15) {
        return [
            { title: '啟動', duration: '2 分鐘', action: `寫下「${name}」今天要交付的最小產出（一句話）` },
            { title: '執行', duration: `${Math.max(5, mins - 5)} 分鐘`, action: '專注產出，不求完美，先求完成' },
            { title: '收尾', duration: '3 分鐘', action: '快速檢查：可以給別人看了嗎？可以就點「完成這件」' }
        ];
    }
    return [
        { title: '準備', duration: '5 分鐘', action: '關閉干擾、備齊需要的檔案與工具' },
        { title: '核心執行', duration: `${Math.min(25, mins - 10)} 分鐘`, action: `專注完成「${name}」的最小可交付版本` },
        { title: '檢查完成', duration: '5 分鐘', action: '對照完成標準，補漏或直接標記完成' }
    ];
}

function getStepsForTask(task) {
    const cachedId = S.taskCoachPlans.get(task.id);
    const cached = cachedId ? S.coachPlans.get(cachedId) : null;
    if (cached?.steps?.length) return normalizeFocusSteps(cached.steps);
    return buildQuickStartSteps(task);
}

function parseStepMinutes(step) {
    const m = String(step?.duration || '').match(/(\d+)/);
    return m ? parseInt(m[1], 10) : 10;
}

function getCoachTask() {
    return getCoachContext().nextTask;
}

function clearFocusTimer() {
    if (S.focusTimerInterval) {
        clearInterval(S.focusTimerInterval);
        S.focusTimerInterval = null;
    }
}

function tickFocusTimer() {
    if (!S.focusSession?.endsAt) return;
    const el = document.getElementById('focus-timer-display');
    const remaining = Math.max(0, S.focusSession.endsAt - Date.now());
    const mins = Math.floor(remaining / 60000);
    const secs = Math.floor((remaining % 60000) / 1000);
    if (el) el.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    if (remaining <= 0 && S.focusTimerInterval) {
        clearFocusTimer();
        showToast('時間到！可以收尾或點「完成這件」', 'success');
    }
}

function startFocusTimer(durationMins) {
    clearFocusTimer();
    if (!S.focusSession) return;
    S.focusSession.endsAt = Date.now() + (durationMins || 30) * 60 * 1000;
    tickFocusTimer();
    S.focusTimerInterval = setInterval(tickFocusTimer, 1000);
}

function endFocusSession(recordTime = true) {
    if (recordTime && S.focusSession?.startedAt && !S.focusSession.recorded) {
        recordFocusSessionMinutes(S.focusSession);
    }
    clearFocusTimer();
    S.focusSession = null;
    const card = document.getElementById('next-step-card');
    if (card) card.classList.remove('focus-session-active');
}

function extendFocusTimer(mins) {
    if (!S.focusSession?.endsAt) return;
    S.focusSession.endsAt += mins * 60 * 1000;
    if (!S.focusTimerInterval) startFocusTimer(Math.ceil((S.focusSession.endsAt - Date.now()) / 60000));
    showToast(`已延長 ${mins} 分鐘`, 'success');
    tickFocusTimer();
}

function completeFocusTask(taskId) {
    const task = S.tasks.find(t => t.id === taskId);
    if (!task || task.completed) return;
    endFocusSession();
    toggleTaskComplete(taskId, { checked: true }, true, true);
}

function renderFocusSessionPanel(task) {
    if (!S.focusSession || S.focusSession.taskId !== task.id) return '';
    const steps = S.focusSession.steps || [];
    const cur = Math.min(S.focusSession.currentStep || 0, Math.max(0, steps.length - 1));
    const current = steps[cur];
    const isLastStep = cur >= steps.length - 1;
    const hasCoachPlan = !!S.focusSession.planId;
    return `
        <div class="focus-session-panel mt-4 pt-4 border-t border-indigo-500/25">
            <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div class="flex items-center gap-3">
                    <span class="focus-session-badge"><i class="fa-solid fa-circle text-[6px]"></i> 專注進行中</span>
                    <span id="focus-timer-display" class="focus-timer">--:--</span>
                    <span class="text-[10px] text-slate-500">步驟 ${cur + 1}/${steps.length}${hasCoachPlan ? ' · 教練方案' : ''}</span>
                </div>
                <button type="button" ${luminaAction('extendFocusTimer', { arg: 5, type: 'number' })} class="text-[10px] px-2 py-1 rounded-lg border border-slate-600 text-slate-400 hover:text-slate-300 hover:bg-slate-800">+5 分</button>
            </div>
            ${current ? `
            <div class="focus-first-step mb-3">
                <div class="text-[10px] uppercase tracking-wider text-emerald-400 font-semibold mb-1">現在就做 · ${escapeHtml(current.title)}</div>
                <div class="text-sm text-slate-200 leading-relaxed">${escapeHtml(current.action)}</div>
            </div>` : ''}
            <ol class="focus-step-list">
                ${steps.map((s, i) => {
                    const cls = i < cur ? 'focus-step-item-done' : i === cur ? 'focus-step-item-active' : '';
                    return `
                    <li class="focus-step-item ${cls}">
                        <span class="focus-step-num">${i + 1}</span>
                        <div class="min-w-0">
                            <div class="font-medium text-xs text-slate-200">${escapeHtml(s.title)}</div>
                            <div class="text-[10px] text-slate-500 mt-0.5">${escapeHtml(s.duration)}</div>
                        </div>
                    </li>`;
                }).join('')}
            </ol>
            <div class="flex flex-wrap gap-2 mt-4">
                <button type="button" ${luminaAction('advanceFocusStep', { arg: task.id, type: 'number' })} class="text-sm px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-medium">
                    <i class="fa-solid fa-${isLastStep ? 'check' : 'forward-step'} mr-1"></i>${isLastStep ? '完成這件' : '完成這步'}
                </button>
                <button type="button" ${luminaAction('openCoachForTask', { arg: task.id, type: 'number' })} class="text-sm px-4 py-2 rounded-xl border border-sky-500/40 hover:bg-sky-500/10 text-sky-300">教練帶我做</button>
                <button type="button" ${luminaAction('', { actions: [['endFocusSession'], ['refreshUI', { dashboard: true, filters: false }]] })} class="text-sm px-4 py-2 rounded-xl border border-slate-600 hover:bg-slate-800 text-slate-400">暫停</button>
            </div>
        </div>`;
}

function advanceFocusStep(taskId) {
    if (!S.focusSession || S.focusSession.taskId !== taskId) return;
    const steps = S.focusSession.steps || [];
    if (S.focusSession.currentStep < steps.length - 1) {
        S.focusSession.currentStep++;
        refreshUI({ dashboard: true, filters: false });
        tickFocusTimer();
        const step = steps[S.focusSession.currentStep];
        if (step) showToast(`下一步：${step.title}`, 'success');
    } else {
        completeFocusTask(taskId);
    }
}

function focusTodayTask(taskId, event) {
    if (event) {
        const target = event.target;
        if (target?.closest('input, button, a, label')) return;
    }
    const task = S.tasks.find(t => t.id === taskId);
    if (!task || task.completed) return;
    if (task.due > getTodayISO()) {
        showToast('此任務排程在之後，請到任務頁查看', 'error');
        return;
    }
    if (S.focusSession && S.focusSession.taskId !== taskId) endFocusSession();
    S.todayFocusTaskId = taskId;
    refreshUI({ dashboard: true, filters: false });
    pulseNextStepCard();
}

function startTodayTask(taskId, opts = {}) {
    const task = S.tasks.find(t => t.id === taskId);
    if (!task || task.completed) return;
    S.todayFocusTaskId = taskId;

    if (S.focusSession && S.focusSession.taskId !== taskId) {
        endFocusSession();
    }
    
    if (!opts.force && S.focusSession?.taskId === taskId) {
        showSection('dashboard');
        pulseNextStepCard();
        if (S.focusSession.endsAt > Date.now() && !S.focusTimerInterval) {
            tickFocusTimer();
            S.focusTimerInterval = setInterval(tickFocusTimer, 1000);
        }
        return;
    }
    
    const planId = S.taskCoachPlans.get(taskId) || null;
    S.focusSession = {
        taskId,
        startedAt: Date.now(),
        steps: getStepsForTask(task),
        currentStep: 0,
        planId
    };
    showSection('dashboard');
    refreshUI({ dashboard: true, filters: false });
    startFocusTimer(task.duration || 30);
    pulseNextStepCard();
    const card = document.getElementById('next-step-card');
    if (card) card.classList.add('focus-session-active');
    if (!opts.quiet) {
        const hint = planId ? '（已載入教練方案）' : '';
        showToast(`開始：${task.name}${hint}`, 'success');
    }
}

function onTodayTaskCompleted(completedId, fromFocus = false) {
    const wasFocus = fromFocus || S.focusSession?.taskId === completedId;
    if (S.focusSession?.taskId === completedId) endFocusSession();
    if (S.todayFocusTaskId === completedId) S.todayFocusTaskId = null;
    invalidateTodayStats();
    const next = getNextRecommendedTask('today');
    if (next) {
        S.todayFocusTaskId = next.id;
        setTimeout(() => {
            if (wasFocus) {
                startTodayTask(next.id, { quiet: true, autoContinue: true });
                showToast(`接著做：${next.name}`, 'success');
            } else {
                showToast(`完成！下一項：${next.name}`, 'success');
                pulseNextStepCard();
            }
        }, wasFocus ? 350 : 120);
    } else {
        setTimeout(() => showToast('今日待辦全部完成！', 'success'), 120);
    }
    updateCoachContextBar();
    renderCoachQuickActions();
    if (document.getElementById('coach')?.classList.contains('active')) {
        renderCoachAgentView();
    }
}
