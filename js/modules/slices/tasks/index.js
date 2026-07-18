/* Lumina: tasks/index.js */
function rebuildTaskIndex() {
    S.taskById = new Map();
    for (const t of S.tasks) {
        if (t?.id !== undefined && t?.id !== null) S.taskById.set(t.id, t);
    }
}

function getTaskById(id) {
    return S.taskById.get(id);
}

function rebuildTodayQueueMap() {
    const pending = rankTasksByNextStepScore(getTodayStats().pending, getScoringContext());
    S.todayQueueMap = new Map();
    pending.forEach((t, i) => S.todayQueueMap.set(t.id, i));
    return S.todayQueueMap;
}

function buildSyncedEnterpriseIdSet() {
    const ids = new Set();
    for (const t of S.tasks) {
        if (t.enterpriseTaskId) ids.add(t.enterpriseTaskId);
    }
    return ids;
}

function migrateTasks() {
    const now = new Date().toISOString();
    S.tasks = S.tasks.map(t => ({
        ...t,
        category: t.category || inferCategory(t.name, t.energy || 3),
        kbIds: normalizeTaskKbIds(t.kbIds),
        docIds: normalizeTaskDocIds(t.docIds),
        updatedAt: t.updatedAt || now
    }));
    rebuildTaskIndex();
}

/** Normalize task-bound knowledge base ids (max 12). */
function normalizeTaskKbIds(raw) {
    if (!Array.isArray(raw)) return [];
    return [...new Set(
        raw.map(id => String(id || '').trim()).filter(Boolean)
    )].slice(0, 12);
}

/** Normalize task-bound document ids (max 20). */
function normalizeTaskDocIds(raw) {
    if (!Array.isArray(raw)) return [];
    return [...new Set(
        raw.map(id => String(id || '').trim()).filter(Boolean)
    )].slice(0, 20);
}

function getTaskBoundKbIds(task) {
    return normalizeTaskKbIds(task?.kbIds);
}

function getTaskBoundDocIds(task) {
    return normalizeTaskDocIds(task?.docIds);
}

function shortTaskKbLabel(kbId) {
    const raw = typeof getRagKbLabel === 'function'
        ? getRagKbLabel(kbId)
        : (C.RAG_KB_LABELS?.[kbId] || kbId);
    return String(raw || kbId).replace(/\s*\([^)]*\)\s*$/, '').trim() || String(kbId);
}

/** Available KB options for pickers (team context preferred). */
function getAvailableKbOptions() {
    const ids = new Set(Object.keys(C.RAG_KB_LABELS || {}));
    Object.keys(S.ragKbItemsById || {}).forEach(id => ids.add(id));
    (S.enterpriseGroupData?.documents || []).forEach(d => {
        if (d && d.status !== 'deleted') ids.add(d.kbId || 'general');
    });
    const kbMap = S.enterpriseGroupData?.knowledgeBases;
    if (kbMap && typeof kbMap === 'object') {
        Object.entries(kbMap).forEach(([id, kb]) => {
            if (kb && kb.status !== 'deleted') ids.add(id);
        });
    }
    return [...ids].map(id => ({
        id,
        label: shortTaskKbLabel(id)
    }));
}

/**
 * Render multi-select KB chips into a container.
 * @param {string} containerId
 * @param {string[]} selectedIds
 * @param {string} inputName  shared name for checkboxes
 */
function renderKbBindPicker(containerId, selectedIds, inputName) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const selected = new Set(normalizeTaskKbIds(selectedIds));
    const opts = getAvailableKbOptions();
    if (!opts.length) {
        el.innerHTML = '<span class="text-[11px] text-slate-500">尚無可綁定知識庫</span>';
        return;
    }
    el.innerHTML = opts.map(o => {
        const checked = selected.has(o.id) ? 'checked' : '';
        return `
            <label class="task-kb-chip ${checked ? 'task-kb-chip-active' : ''}">
                <input type="checkbox" name="${escapeHtml(inputName)}" value="${escapeHtml(o.id)}" ${checked}
                    class="task-kb-chip-input accent-indigo-400"
                    data-task-kb-picker="${escapeHtml(inputName)}">
                <span class="task-kb-chip-text">${escapeHtml(o.label)}</span>
            </label>
        `;
    }).join('');
    el.querySelectorAll(`input[name="${inputName}"]`).forEach(input => {
        input.addEventListener('change', () => {
            input.closest('.task-kb-chip')?.classList.toggle('task-kb-chip-active', input.checked);
            if (typeof onTaskKbPickerChange === 'function') onTaskKbPickerChange(inputName);
        });
    });
}

function readKbBindPicker(inputName) {
    return normalizeTaskKbIds(
        Array.from(document.querySelectorAll(`input[name="${inputName}"]:checked`)).map(el => el.value)
    );
}

/** Documents available for binding, optionally filtered by selected KBs. */
function getAvailableDocOptions(kbIds) {
    const kbSet = Array.isArray(kbIds) && kbIds.length ? new Set(kbIds) : null;
    return (S.enterpriseGroupData?.documents || [])
        .filter(d => d && d.status !== 'deleted')
        .filter(d => !kbSet || kbSet.has(d.kbId || 'general'))
        .map(d => ({
            id: d.id,
            title: d.title || d.filename || d.id,
            kbId: d.kbId || 'general'
        }))
        .slice(0, 80);
}

function renderDocBindPicker(containerId, selectedIds, inputName, kbIds) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const selected = new Set(normalizeTaskDocIds(selectedIds));
    const opts = getAvailableDocOptions(kbIds);
    if (!opts.length) {
        el.innerHTML = '<span class="text-[11px] text-slate-500">此範圍尚無可綁定文件（可先上傳或改選知識庫）</span>';
        return;
    }
    el.innerHTML = opts.map(o => {
        const checked = selected.has(o.id) ? 'checked' : '';
        const kbLabel = shortTaskKbLabel(o.kbId);
        const shortTitle = o.title.length > 36 ? o.title.slice(0, 34) + '…' : o.title;
        return `
            <label class="task-doc-chip ${checked ? 'task-doc-chip-active' : ''}" title="${escapeHtml(o.title)} · ${escapeHtml(kbLabel)}">
                <input type="checkbox" name="${escapeHtml(inputName)}" value="${escapeHtml(o.id)}" ${checked}
                    class="task-kb-chip-input accent-indigo-400"
                    onchange="this.closest('.task-doc-chip')?.classList.toggle('task-doc-chip-active', this.checked)">
                <span class="task-doc-chip-text">
                    <span class="task-doc-chip-title">${escapeHtml(shortTitle)}</span>
                    <span class="task-doc-chip-kb">${escapeHtml(kbLabel)}</span>
                </span>
            </label>
        `;
    }).join('');
}

function readDocBindPicker(inputName) {
    return normalizeTaskDocIds(
        Array.from(document.querySelectorAll(`input[name="${inputName}"]:checked`)).map(el => el.value)
    );
}

/** When KB selection changes, refresh linked document picker and prune invalid docs. */
function onTaskKbPickerChange(inputName) {
    if (inputName === 'team-assign-kb') {
        const kbIds = readKbBindPicker('team-assign-kb');
        const prev = readDocBindPicker('team-assign-doc');
        const valid = new Set(getAvailableDocOptions(kbIds).map(d => d.id));
        renderDocBindPicker('team-assign-doc-list', prev.filter(id => valid.has(id)), 'team-assign-doc', kbIds);
        return;
    }
    if (inputName === 'edit-task-kb') {
        const kbIds = readKbBindPicker('edit-task-kb');
        const prev = readDocBindPicker('edit-task-doc');
        const valid = new Set(getAvailableDocOptions(kbIds).map(d => d.id));
        renderDocBindPicker('edit-task-doc-list', prev.filter(id => valid.has(id)), 'edit-task-doc', kbIds);
    }
}

function renderTaskKbBadges(task) {
    const kbIds = getTaskBoundKbIds(task);
    const docIds = getTaskBoundDocIds(task);
    if (!kbIds.length && !docIds.length) return '';

    let html = '';
    if (kbIds.length) {
        const labels = kbIds.map(shortTaskKbLabel);
        const title = `綁定知識庫：${labels.join('、')}`;
        const shown = labels.slice(0, 2).join('、');
        const more = labels.length > 2 ? ` +${labels.length - 2}` : '';
        html += `<span class="task-kb-bind-badge" title="${escapeHtml(title)}"><i class="fa-solid fa-database"></i> ${escapeHtml(shown)}${more}</span>`;
    }
    if (docIds.length) {
        const docs = S.enterpriseGroupData?.documents || [];
        const titles = docIds.map(id => {
            const d = docs.find(x => x.id === id);
            return d?.title || d?.filename || id;
        });
        const title = `綁定文件：${titles.join('、')}`;
        html += `<span class="task-doc-bind-badge" title="${escapeHtml(title)}"><i class="fa-solid fa-file-lines"></i> ${docIds.length} 份文件</span>`;
    }
    return html;
}

function touchTask(task) {
    if (!task) return task;
    task.updatedAt = new Date().toISOString();
    return task;
}

function getFilteredTasks(taskList) {
    if (S.activeCategoryFilter === 'all') return taskList;
    return taskList.filter(t => resolveCategory(t) === S.activeCategoryFilter);
}

function flushRefreshUI(parts = {}) {
    const {
        dashboard = false,
        scheduler = false,
        filters = true,
        schedule = false
    } = parts;
    if (filters) renderCategoryFilters();
    if (dashboard) updateDashboard();
    if (scheduler) renderTaskList();
    if (schedule && $('scheduler')?.classList.contains('active')) {
        optimizeSchedule(true);
    }
}

function refreshUI(parts = {}) {
    const next = {
        dashboard: !!parts.dashboard,
        scheduler: !!parts.scheduler,
        filters: parts.filters !== false,
        schedule: !!parts.schedule
    };
    if (S.refreshUIQueued) {
        S.refreshUIQueued = {
            dashboard: S.refreshUIQueued.dashboard || next.dashboard,
            scheduler: S.refreshUIQueued.scheduler || next.scheduler,
            filters: S.refreshUIQueued.filters && next.filters,
            schedule: S.refreshUIQueued.schedule || next.schedule
        };
    } else {
        S.refreshUIQueued = next;
    }
    if (S.refreshUIRaf) return;
    S.refreshUIRaf = requestAnimationFrame(() => {
        S.refreshUIRaf = null;
        const queued = S.refreshUIQueued;
        S.refreshUIQueued = null;
        if (queued) flushRefreshUI(queued);
    });
}

function refreshUIImmediate(parts = {}) {
    if (S.refreshUIRaf) {
        cancelAnimationFrame(S.refreshUIRaf);
        S.refreshUIRaf = null;
    }
    S.refreshUIQueued = null;
    flushRefreshUI(parts);
}

function setCategoryFilter(cat) {
    S.activeCategoryFilter = cat;
    refreshUI({ dashboard: true, scheduler: true });
}

function renderCategoryFilters() {
    const counts = getCategoryCounts();
    const chips = [
        { id: 'all', label: '全部', color: 'border-slate-600 text-slate-300' },
        ...Object.entries(C.CATEGORIES).map(([id, c]) => ({ id, label: c.label, color: c.color }))
    ];
    
    const html = chips.map(chip => {
        const count = counts[chip.id] || 0;
        const active = S.activeCategoryFilter === chip.id;
        return `<button ${luminaAction('setCategoryFilter', { arg: chip.id })} class="filter-chip text-[10px] px-2.5 py-1 rounded-full border border-slate-700 ${chip.color} ${active ? 'active !border-indigo-500 !text-indigo-300' : 'hover:bg-slate-800'}">${chip.label}${count > 0 ? ` (${count})` : ''}</button>`;
    }).join('');
    
    ['scheduler-category-filters', 'dashboard-category-filters'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = html;
    });
}

function getTodayQueuePosition(taskId) {
    if (!S.todayQueueMap) rebuildTodayQueueMap();
    const idx = S.todayQueueMap.has(taskId) ? S.todayQueueMap.get(taskId) : -1;
    return { index: idx, total: S.todayQueueMap.size };
}

function pulseNextStepCard() {
    const card = document.getElementById('next-step-card');
    if (!card) return;
    card.classList.remove('next-step-card-pulse');
    void card.offsetWidth;
    card.classList.add('next-step-card-pulse');
    setTimeout(() => card.classList.remove('next-step-card-pulse'), 700);
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderPersonalTaskRow(task, variant = 'scheduler') {
    const cat = resolveCategory(task);
    const isDashboard = variant === 'dashboard';
    const checked = task.completed ? 'checked' : '';
    const dashFlag = isDashboard ? ', true' : '';
    const onChange = luminaChange('toggleTaskComplete', [task.id, '__target__', ...(isDashboard ? [true] : [])]);
    
    if (isDashboard) {
        const isActive = !task.completed && task.id === S.todayFocusTaskId;
        const isRunning = isActive && S.focusSession?.taskId === task.id;
        const queue = getTodayQueuePosition(task.id);
        const queueLabel = queue.index >= 0 && !task.completed
            ? `<span class="text-[10px] text-indigo-400/80">#${queue.index + 1}</span>`
            : '';
        const rowClass = task.completed
            ? 'dashboard-task-row dashboard-task-row-done'
            : `dashboard-task-row task-card group${isActive ? ' dashboard-task-row-active' : ''}`;
        return `<div class="${rowClass} flex items-center justify-between px-4 py-3 bg-slate-950 border border-slate-700 rounded-2xl"
            data-task-id="${task.id}" ${luminaAction('focusTodayTask', { arg: task.id, type: 'number', passEvent: true })} ${luminaKeydown('focusTodayTask', { arg: task.id, type: 'number', passEvent: true })} role="button" tabindex="0">
            <div class="flex items-center gap-x-3 flex-1 min-w-0">
                <input type="checkbox" ${checked} ${onChange} data-lumina-stop class="accent-indigo-500 w-4 h-4 cursor-pointer flex-shrink-0">
                <div class="min-w-0 flex-1">
                    <div class="font-medium text-sm truncate ${task.completed ? 'line-through text-slate-500' : ''}">${escapeHtml(task.name)}</div>
                    <div class="text-[10px] text-slate-500 flex flex-wrap items-center gap-1">${queueLabel} ${task.duration} 分鐘 • <span class="cat-badge ${getCategoryColor(cat)}">${getCategoryLabel(cat)}</span> ${renderTaskBadges(task)}</div>
                </div>
            </div>
            <div class="flex items-center gap-1.5 flex-shrink-0">
                ${!task.completed ? `<button type="button" ${luminaAction('startTodayTask', { arg: task.id, type: 'number', stop: true })} class="task-row-start-btn ${isActive ? '' : 'hidden sm:inline-flex'}${isRunning ? ' task-row-start-btn-active' : ''}">${isRunning ? '進行中' : isActive ? '繼續' : '開始'}</button>` : ''}
                <button type="button" ${luminaAction('openTaskEdit', { arg: task.id, type: 'number', stop: true })} class="text-slate-400 hover:text-indigo-300 p-1.5 ${task.completed ? '' : 'opacity-70 hover:opacity-100'}" title="編輯"><i class="fa-solid fa-pen text-xs"></i></button>
            </div>
        </div>`;
    }
    
    return `<div class="task-card flex items-center gap-x-3 px-4 py-3.5 bg-slate-950 border border-slate-700 rounded-2xl group ${task.completed ? 'opacity-60' : ''}">
        <input type="checkbox" ${checked} ${onChange} class="accent-indigo-500 w-[17px] h-[17px] cursor-pointer flex-shrink-0">
        <div class="flex-1 min-w-0">
            <div class="font-medium text-sm ${task.completed ? 'line-through text-slate-400' : ''}">${escapeHtml(task.name)}</div>
            <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs mt-0.5">
                <span class="font-mono text-slate-400">${task.duration} min</span>
                <span class="cat-badge ${getCategoryColor(cat)}">${getCategoryLabel(cat)}</span>
                <span class="px-2 py-px rounded text-[10px] ${getEnergyColor(task.energy)}">${getEnergyLabel(task.energy)}</span>
                <span class="text-slate-500">${task.due}</span>
                ${renderTaskBadges(task)}
            </div>
        </div>
        <div class="flex items-center gap-x-1 opacity-0 group-hover:opacity-100 transition-all">
            <button ${luminaAction('openTaskEdit', { arg: task.id, type: 'number' })} class="text-slate-400 hover:text-indigo-300 p-1.5" title="編輯任務"><i class="fa-solid fa-pen text-xs"></i></button>
            ${task.duration >= 60 && !task.completed ? `<button ${luminaAction('splitTask', { arg: task.id, type: 'number' })} class="text-indigo-400 hover:text-indigo-300 p-1.5" title="拆分任務"><i class="fa-solid fa-scissors text-xs"></i></button>` : ''}
            <button ${luminaAction('deleteTask', { arg: task.id, type: 'number', passEvent: true })} class="text-red-400 hover:text-red-500 p-1.5"><i class="fa-solid fa-trash text-xs"></i></button>
        </div>
    </div>`;
}

function getActiveParentGoals() {
    const groups = {};
    S.tasks.filter(t => t.parentGoalId).forEach(t => {
        if (!groups[t.parentGoalId]) {
            groups[t.parentGoalId] = { id: t.parentGoalId, name: t.parentGoalName || '大目標', total: 0, done: 0 };
        }
        groups[t.parentGoalId].total++;
        if (t.completed) groups[t.parentGoalId].done++;
    });
    return Object.values(groups).filter(g => g.done < g.total);
}

function checkParentGoalComplete(task) {
    if (!task.parentGoalId || !task.completed) return;
    const siblings = S.tasks.filter(t => t.parentGoalId === task.parentGoalId);
    if (siblings.length > 1 && siblings.every(t => t.completed)) {
        const name = task.parentGoalName || '大目標';
        showToast(`🎉 大目標「${name}」的所有步驟已完成！`, 'success');
        if (S.userProfile.enableConfetti !== false) triggerConfetti();
    }
}

function renderActiveGoalsPanel() {
    const panel = document.getElementById('active-goals-panel');
    if (!panel) return;
    
    const goals = getActiveParentGoals();
    if (!goals.length) {
        panel.classList.add('hidden');
        panel.innerHTML = '';
        return;
    }
    
    panel.classList.remove('hidden');
    panel.innerHTML = goals.map(g => {
        const pct = Math.round((g.done / g.total) * 100);
        return `<div class="goal-progress-card">
            <div class="flex items-center justify-between gap-2">
                <div class="text-xs text-purple-300 font-medium truncate">🎯 ${escapeHtml(g.name)}</div>
                <div class="text-[10px] text-slate-400 flex-shrink-0">${g.done}/${g.total} 步驟</div>
            </div>
            <div class="goal-progress-bar"><div class="goal-progress-fill" style="width:${pct}%"></div></div>
        </div>`;
    }).join('');
}

function renderTaskBadges(task) {
    let html = '';
    if (task.wasOverdue && !task.completed) {
        html += `<span class="task-overdue-badge">延後</span>`;
    }
    if (task.parentGoalName) {
        html += `<span class="task-goal-badge" title="${escapeHtml(task.parentGoalName)}">🎯 ${escapeHtml(task.parentGoalName)}</span>`;
    }
    html += renderTaskKbBadges(task);
    return html;
}

function openTaskEdit(taskId) {
    const task = S.tasks.find(t => t.id === taskId);
    if (!task) return;
    S.editingTaskId = taskId;
    
    document.getElementById('edit-task-name').value = task.name;
    document.getElementById('edit-task-duration').value = task.duration;
    document.getElementById('edit-task-energy').value = task.energy;
    document.getElementById('edit-task-category').value = task.category || inferCategory(task.name, task.energy);
    document.getElementById('edit-task-due').value = task.due;

    const kbWrap = document.getElementById('edit-task-kb-wrap');
    if (kbWrap) {
        // Show bind UI when user is in a team (or task already has binds)
        const showKb = !!S.enterpriseSession
            || getTaskBoundKbIds(task).length > 0
            || getTaskBoundDocIds(task).length > 0;
        kbWrap.classList.toggle('hidden', !showKb);
        if (showKb) {
            const kbIds = getTaskBoundKbIds(task);
            renderKbBindPicker('edit-task-kb-list', kbIds, 'edit-task-kb');
            renderDocBindPicker('edit-task-doc-list', getTaskBoundDocIds(task), 'edit-task-doc', kbIds);
        }
    }
    
    document.getElementById('task-edit-modal').classList.remove('hidden');
}

function closeTaskEdit() {
    S.editingTaskId = null;
    document.getElementById('task-edit-modal')?.classList.add('hidden');
}

function saveTaskEdit() {
    if (!S.editingTaskId) return;
    const task = S.tasks.find(t => t.id === S.editingTaskId);
    if (!task) return;
    
    const name = document.getElementById('edit-task-name').value.trim();
    if (!name) {
        showToast('請輸入任務名稱', 'error');
        return;
    }
    
    task.name = name;
    task.duration = Math.max(5, parseInt(document.getElementById('edit-task-duration').value) || 30);
    task.energy = parseInt(document.getElementById('edit-task-energy').value) || 3;
    task.category = document.getElementById('edit-task-category').value;
    task.due = document.getElementById('edit-task-due').value || getTodayISO();
    if (task.due >= getTodayISO()) task.wasOverdue = false;

    const kbWrap = document.getElementById('edit-task-kb-wrap');
    if (kbWrap && !kbWrap.classList.contains('hidden')) {
        task.kbIds = readKbBindPicker('edit-task-kb');
        task.docIds = readDocBindPicker('edit-task-doc');
        // Derive KBs from docs if only docs selected
        if (!task.kbIds.length && task.docIds.length) {
            const docs = S.enterpriseGroupData?.documents || [];
            task.kbIds = normalizeTaskKbIds(
                task.docIds.map(id => (docs.find(d => d.id === id)?.kbId) || 'general')
            );
        }
    }
    touchTask(task);
    
    saveState();
    closeTaskEdit();
    refreshUI({ dashboard: true, scheduler: true, schedule: true });
    showToast('任務已更新', 'success');
}

function syncEnterpriseTaskToPersonal(enterpriseTaskId) {
    if (!S.enterpriseGroupData) return;
    const et = (S.enterpriseGroupData.tasks || []).find(t => t.id === enterpriseTaskId);
    if (!et) return;
    
    const existing = S.tasks.find(t => t.enterpriseTaskId === enterpriseTaskId);
    if (existing) {
        if (existing.completed !== et.completed) {
            syncEnterpriseCompletionToPersonal(enterpriseTaskId, et.completed);
        } else {
            showToast('此團隊任務已同步到個人清單', 'error');
        }
        return;
    }
    
    S.tasks.push({
        id: Date.now(),
        name: `[團隊] ${et.title}`,
        duration: et.duration || 30,
        energy: et.energy || 3,
        category: et.category || inferCategory(et.title, 3),
        due: et.due || getTodayISO(),
        completed: !!et.completed,
        enterpriseTaskId: enterpriseTaskId,
        kbIds: normalizeTaskKbIds(et.kbIds),
        docIds: normalizeTaskDocIds(et.docIds)
    });
    
    saveState();
    refreshUI({ dashboard: true, scheduler: true });
    showToast('已同步到個人今日清單', 'success');
}

function syncEnterpriseCompletionToPersonal(enterpriseTaskId, completed) {
    if (S.enterpriseSyncSuppress) return;
    const personal = S.tasks.find(t => t.enterpriseTaskId === enterpriseTaskId);
    if (!personal || personal.completed === completed) return;
    S.enterpriseSyncSuppress = true;
    try {
        personal.completed = completed;
        saveState({ immediateAnalytics: true });
        refreshUI({ dashboard: true, scheduler: true, filters: true });
    } finally {
        S.enterpriseSyncSuppress = false;
    }
}

function enqueueEnterpriseSync(item) {
    S.enterpriseSyncQueue.push({ ...item, attempts: 0, addedAt: Date.now() });
    scheduleEnterpriseSyncFlush();
}

function scheduleEnterpriseSyncFlush() {
    if (S.enterpriseSyncFlushTimer) return;
    S.enterpriseSyncFlushTimer = setTimeout(flushEnterpriseSyncQueue, C.ENTERPRISE_SYNC_RETRY_MS);
}

async function flushEnterpriseSyncQueue() {
    S.enterpriseSyncFlushTimer = null;
    if (!S.enterpriseSyncQueue.length || !S.enterpriseSession) return;
    const pending = S.enterpriseSyncQueue.splice(0);
    for (const item of pending) {
        try {
            if (item.type === 'task_toggle') {
                const api = await enterpriseFetch('PATCH', `/api/enterprise/task/${item.taskId}`, item.payload);
                if (!api.ok) throw new Error(api.error || '同步失敗');
            }
        } catch (_) {
            if (item.attempts < 5) {
                S.enterpriseSyncQueue.push({ ...item, attempts: item.attempts + 1 });
            }
        }
    }
    if (S.enterpriseSyncQueue.length) scheduleEnterpriseSyncFlush();
}

async function syncPersonalTaskCompletionToEnterprise(task) {
    if (S.enterpriseSyncSuppress || !task?.enterpriseTaskId || !S.enterpriseSession) return;
    const et = S.enterpriseGroupData?.tasks?.find(t => t.id === task.enterpriseTaskId);
    if (!et || et.completed === task.completed) return;
    S.enterpriseSyncSuppress = true;
    try {
        await toggleEnterpriseTask(task.enterpriseTaskId, task.completed);
    } catch (_) {
        enqueueEnterpriseSync({
            type: 'task_toggle',
            taskId: task.enterpriseTaskId,
            payload: {
                groupCode: S.enterpriseSession.groupCode,
                memberId: S.enterpriseSession.memberId,
                completed: task.completed
            }
        });
        showToast('團隊任務同步已加入重試佇列', 'error');
    } finally {
        S.enterpriseSyncSuppress = false;
    }
}

function cacheEnterpriseGroupLocally(group) {
    if (!group?.code) return;
    const code = normalizeEnterpriseCode(group.code);
    const store = loadLocalEnterpriseStore();
    const existing = store.groups[code] || {};
    store.groups[code] = {
        ...existing,
        code: group.code,
        name: group.name,
        members: group.members,
        tasks: group.tasks,
        documents: group.documents || [],
        notifications: group.notifications || existing.notifications || []
    };
    saveLocalEnterpriseStore(store);
}

function evaluateStreakOnComplete() {
    invalidateTodayStats();
    if (applyStreakReward(getTodayISO(), getTodayStats().rate, { notify: true })) {
        persistProfile();
    }
}

// Load from localStorage

function focusQuickAdd() {
    showSection('dashboard');
    setTimeout(() => {
        const input = document.getElementById('quick-task-input');
        if (input) { input.focus(); input.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    }, 200);
}

function toggleDashStats() {
    const panel = document.getElementById('dash-stats-panel');
    const chevron = document.getElementById('dash-stats-chevron');
    const toggle = document.getElementById('dash-stats-toggle');
    if (!panel) return;
    const hidden = panel.classList.toggle('hidden');
    if (chevron) chevron.style.transform = hidden ? '' : 'rotate(180deg)';
    if (toggle) {
        const span = toggle.querySelector('span');
        if (span) span.textContent = hidden ? '查看數據摘要' : '收起數據摘要';
    }
}

function updateNextStepCard(stats) {
    const el = $('next-step-card');
    if (!el) return;
    
    stats = stats || getTodayStats();
    const todayPending = stats.pending;
    const futurePending = stats.futurePending;
    const scoreCtx = getScoringContext();
    
    if (S.tasks.length === 0) {
        el.innerHTML = `
            <div class="next-step-label">從這裡開始（只要 30 秒）</div>
            <div class="font-semibold text-lg text-slate-100">今天只做一件事</div>
            <p class="text-sm text-slate-400 mt-1.5 leading-relaxed">
                先有一項待辦，Lumina 才會幫你排出「今日第一步」並可用教練帶做。
            </p>
            <div class="flex flex-wrap gap-2 mt-4">
                <button type="button" ${luminaAction('seedDemoFirstTask')}
                    class="text-sm px-4 py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-600 text-white font-medium shadow-lg shadow-indigo-500/20">
                    <i class="fa-solid fa-wand-magic-sparkles mr-1.5"></i>一鍵體驗（加入範例任務）
                </button>
                <button type="button" ${luminaAction('focusQuickAdd')}
                    class="text-sm px-4 py-2.5 rounded-xl border border-slate-600 hover:bg-slate-800 text-slate-200 font-medium">
                    自己輸入任務
                </button>
                <button type="button" ${luminaAction('openDecomposeTab')}
                    class="text-sm px-4 py-2.5 rounded-xl border border-purple-500/35 hover:bg-purple-500/10 text-purple-200 font-medium">
                    我有大目標，先拆解
                </button>
            </div>
            <p class="text-[10px] text-slate-500 mt-3">進階功能（團隊知識庫、數據洞察）在「更多」裡，之後需要再打開即可。</p>`;
        return;
    }
    
    if (todayPending.length === 0) {
        if (futurePending.length > 0) {
            const next = futurePending.sort((a, b) => a.due.localeCompare(b.due))[0];
            el.innerHTML = `<div class="next-step-label">今日狀態</div>
               <div class="font-semibold text-emerald-300">🎉 今日任務已全部完成！</div>
               <p class="text-sm text-slate-400 mt-1">之後還有 ${futurePending.length} 項待辦，最近一項：<strong class="text-slate-300">${escapeHtml(next.name)}</strong>（${next.due}）</p>
               <button ${luminaAction('showSection', { arg: 'scheduler' })} class="mt-3 text-sm px-4 py-2 rounded-xl border border-slate-600 hover:bg-slate-800 text-slate-300">查看全部任務</button>`;
        } else {
            el.innerHTML = `<div class="next-step-label">今日狀態</div>
               <div class="font-semibold text-emerald-300">🎉 所有任務已完成！</div>
               <p class="text-sm text-slate-400 mt-1">休息一下，或為明天新增任務</p>`;
        }
        return;
    }
    
    const top = resolveTodayFocusTask();
    if (!top) return;
    const reason = getNextStepReason(top);
    const queue = getTodayQueuePosition(top.id);
    const queueText = queue.total > 1 ? `第 ${queue.index + 1} / ${queue.total} 項` : '僅剩 1 項';
    const inFocus = S.focusSession && S.focusSession.taskId === top.id;
    const actionButtons = inFocus ? '' : `
        <div class="flex flex-wrap gap-2 mt-3">
            <button type="button" ${luminaAction('startTodayTask', { arg: top.id, type: 'number' })} class="text-sm px-4 py-2 rounded-xl bg-indigo-500 hover:bg-indigo-600 text-white font-medium">開始做這件</button>
            <button type="button" ${luminaAction('openCoachForTask', { arg: top.id, type: 'number' })} class="text-sm px-4 py-2 rounded-xl border border-sky-500/40 hover:bg-sky-500/10 text-sky-300">教練帶我做</button>
            ${queue.total > 1 ? `<button type="button" ${luminaAction('skipToNextTodayTask')} class="text-sm px-4 py-2 rounded-xl border border-slate-600 hover:bg-slate-800 text-slate-300">先做下一項</button>` : ''}
        </div>
        <p class="text-[10px] text-slate-500 mt-3">${S.taskCoachPlans.has(top.id) ? '已有教練方案，點開始會直接載入' : '開始做這件 → 專注模式；教練帶我做 → 完整方案與文件'}</p>`;
    el.classList.toggle('focus-session-active', !!inFocus);
    el.innerHTML = `
        <div class="next-step-label">${inFocus ? '專注執行中' : '今日進行中'} <span class="text-slate-500 font-normal">（${queueText}）</span></div>
        <div class="flex items-start gap-3 mt-1">
            <input type="checkbox" ${top.completed ? 'checked' : ''} ${luminaChange('toggleTaskComplete', [top.id, '__target__', true])} data-lumina-stop
                class="accent-indigo-500 w-5 h-5 cursor-pointer flex-shrink-0 mt-1" aria-label="標記完成">
            <div class="flex-1 min-w-0">
                <div class="font-semibold text-lg leading-snug">${escapeHtml(top.name)}</div>
                <div class="flex flex-wrap items-center gap-3 mt-2 text-xs text-slate-400">
                    <span>${top.duration} 分鐘</span>
                    <span class="cat-badge ${getCategoryColor(resolveCategory(top))}">${getCategoryLabel(resolveCategory(top))}</span>
                    <span class="text-indigo-400/80">${reason}</span>
                </div>
            </div>
        </div>
        ${actionButtons}
        ${renderFocusSessionPanel(top)}`;
    if (inFocus) tickFocusTimer();
}

function skipToNextTodayTask() {
    const pending = rankTasksByNextStepScore(getTodayStats().pending, getScoringContext());
    const currentIdx = pending.findIndex(t => t.id === S.todayFocusTaskId);
    const next = pending[currentIdx + 1] || pending[0];
    if (!next || (pending.length === 1 && next.id === S.todayFocusTaskId)) {
        showToast('沒有其他待辦了', 'error');
        return;
    }
    endFocusSession();
    S.todayFocusTaskId = next.id;
    refreshUI({ dashboard: true, filters: false });
    showToast(`已切換：${next.name}`, 'success');
    pulseNextStepCard();
}

// Show specific section

function quickAddTask() {
    const input = document.getElementById('quick-task-input');
    if (!input.value.trim()) return;
    
    const name = input.value.trim();
    const newTask = {
        id: Date.now(),
        name: name,
        duration: 30,
        energy: 3,
        category: inferCategory(name, 3),
        due: getTodayISO(),
        completed: false,
        updatedAt: new Date().toISOString()
    };
    
    S.tasks.unshift(newTask);
    S.todayFocusTaskId = newTask.id;
    saveState();
    input.value = '';
    
    showToast('任務已加入今日！可按「開始做這件」', 'success');
    refreshUI({ dashboard: true, scheduler: true, filters: true, schedule: true });
    try { pulseNextStepCard(); } catch (_) {}
}

/** One-click demo task so newcomers can feel the full loop immediately. */
function seedDemoFirstTask() {
    if (S.tasks.some(t => !t.completed && t.due <= getTodayISO())) {
        showToast('你已有今日待辦，直接從上方「今日第一步」開始即可', 'success');
        showSection('dashboard');
        try { pulseNextStepCard(); } catch (_) {}
        return;
    }
    const demo = {
        id: Date.now(),
        name: '整理今天最重要的一件事（5 分鐘）',
        duration: 10,
        energy: 2,
        category: 'admin',
        due: getTodayISO(),
        completed: false,
        updatedAt: new Date().toISOString(),
        source: 'demo'
    };
    S.tasks.unshift(demo);
    S.todayFocusTaskId = demo.id;
    saveState();
    localStorage.setItem('lumina_beginner_dismissed', 'true');
    showSection('dashboard');
    refreshUI({ dashboard: true, scheduler: true, filters: true, schedule: true });
    showToast('已加入範例任務 — 點「開始做這件」或「教練帶我做」', 'success');
    try { pulseNextStepCard(); } catch (_) {}
    try { renderBeginnerWelcome(); } catch (_) {}
}

function renderTaskList() {
    const container = document.getElementById('task-list');
    if (!container) return;

    const filtered = getFilteredTasks(S.tasks);
    const totalLabel = S.activeCategoryFilter === 'all'
        ? `(${S.tasks.length} 項)`
        : `(${filtered.length}/${S.tasks.length} 項)`;
    setElText('task-count', totalLabel);

    if (S.tasks.length === 0) {
        S.taskListVirtual = null;
        container.onscroll = null;
        container.innerHTML = `<div class="text-center py-8 text-sm text-slate-400">目前沒有任務<br><span class="text-xs">在上方新增任務開始規劃</span></div>`;
        return;
    }

    if (filtered.length === 0) {
        S.taskListVirtual = null;
        container.onscroll = null;
        container.innerHTML = `<div class="text-center py-8 text-sm text-slate-400">此分類沒有任務<br><span class="text-xs">試試其他篩選條件</span></div>`;
        return;
    }

    const mount = globalThis.LuminaVirtual?.mountVirtualList;
    if (!mount) {
        container.innerHTML = filtered.map(t => renderPersonalTaskRow(t, 'scheduler')).join('');
        return;
    }

    if (!S.taskListVirtual || container.dataset.virtual === undefined) {
        S.taskListVirtual = mount(container, {
            items: filtered,
            renderRow: (task) => renderPersonalTaskRow(task, 'scheduler')
        });
        return;
    }

    S.taskListVirtual.refresh(filtered);
}

function toggleTaskComplete(taskId, checkbox, fromDashboard = false, fromFocus = false) {
    const task = getTaskById(taskId);
    if (!task) return;
    
    task.completed = checkbox.checked;
    touchTask(task);
    saveState();
    
    if (task.enterpriseTaskId && S.enterpriseSession) {
        syncPersonalTaskCompletionToEnterprise(task);
    }
    
    let advancedToday = false;
    if (task.completed) {
        if (fromDashboard || task.due <= getTodayISO()) {
            onTodayTaskCompleted(task.id, fromFocus || S.focusSession?.taskId === task.id);
            advancedToday = true;
        }
        if (!advancedToday) showToast('太棒了！任務完成', 'success');
        evaluateStreakOnComplete();
        checkParentGoalComplete(task);
        
        const stats = getTodayStats();
        if (stats.relevant.length > 0 && stats.relevant.every(t => t.completed)) {
            if (S.userProfile.enableConfetti !== false) triggerConfetti();
        } else if (S.userProfile.enableConfetti !== false && Math.random() > 0.6) {
            triggerConfetti();
        }
    } else if (fromDashboard) {
        S.todayFocusTaskId = task.id;
    }
    
    refreshUI({
        dashboard: true,
        scheduler: !fromDashboard,
        filters: true,
        schedule: true
    });
}

function splitTask(taskId) {
    const task = S.tasks.find(t => t.id === taskId);
    if (!task || task.duration < 30) {
        showToast('任務太短，無需拆分', 'error');
        return;
    }
    
    const half = Math.ceil(task.duration / 2);
    const part2Duration = task.duration - half;
    const baseName = task.name.replace(/ \(Part \d\)$/, '');
    
    S.tasks = S.tasks.filter(t => t.id !== taskId);
    S.tasks.push(
        { ...task, id: Date.now(), name: baseName + ' (Part 1)', duration: half },
        { ...task, id: Date.now() + 1, name: baseName + ' (Part 2)', duration: part2Duration }
    );
    
    saveState();
    refreshUI({ scheduler: true, filters: true, schedule: true });
    showToast('任務已拆分為兩部分，重新排程中', 'success');
}

function deleteTask(taskId, e) {
    e.stopImmediatePropagation();
    if (!confirm('確定要刪除這個任務嗎？')) return;
    
    S.tasks = S.tasks.filter(t => t.id !== taskId);
    saveState();
    refreshUI({ scheduler: true, filters: true, schedule: true });
}

function clearAllTasks() {
    if (!confirm('確定清空所有任務？')) return;
    S.tasks = [];
    saveState();
    refreshUI({ scheduler: true, filters: true });
    setElHtml('timeline-view', '<div class="text-center text-xs py-8 text-slate-400">清空後請新增任務並點擊「智能排程」</div>');
    setElText('total-scheduled-time', '0h 0m');
}

function quickStartToday() {
    if (S.tasks.length === 0) {
        showToast('先分解一個大目標，找出今日第一步', 'success');
        openDecomposeTab();
        return;
    }
    const next = getNextRecommendedTask('today');
    if (!next) {
        showToast('今日任務已完成！', 'success');
        showSection('dashboard');
        return;
    }
    S.todayFocusTaskId = next.id;
    startTodayTask(next.id);
}

// Confetti for celebrations
