/* Lumina: ui/feedback.js */
function triggerConfetti() {
    const colors = ['#6366f1', '#a855f7', '#ec4899', '#22c55e'];
    const container = document.body;
    
    for (let i = 0; i < 65; i++) {
        const particle = document.createElement('div');
        particle.style.position = 'fixed';
        particle.style.zIndex = '9999';
        particle.style.left = Math.random() * 100 + 'vw';
        particle.style.top = '-10px';
        particle.style.width = '8px';
        particle.style.height = '8px';
        particle.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
        particle.style.background = colors[Math.floor(Math.random() * colors.length)];
        particle.style.opacity = Math.random() + 0.6;
        container.appendChild(particle);
        
        const duration = Math.random() * 2800 + 2400;
        const angle = Math.random() * 70 + 55;
        
        particle.animate([
            { transform: `translateY(0) rotate(0deg)`, opacity: particle.style.opacity },
            { transform: `translateY(${window.innerHeight + 100}px) rotate(${angle * 4}deg)`, opacity: 0 }
        ], {
            duration: duration,
            easing: 'cubic-bezier(0.25, 0.1, 0.25, 1)'
        }).onfinish = () => particle.remove();
    }
}

// Toast notifications
// options: { actionLabel, onAction, durationMs }

function showToast(message, type = 'success', options = {}) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    const icon = type === 'success' ? 'fa-circle-check' : 'fa-circle-exclamation';
    toast.className = `toast-item ${type === 'success' ? 'toast-success' : 'toast-error'}`;
    toast.setAttribute('role', 'status');
    
    const iconEl = document.createElement('i');
    iconEl.className = `fa-solid ${icon} flex-shrink-0`;
    const textEl = document.createElement('div');
    textEl.className = 'flex-1 leading-snug';
    textEl.textContent = String(message);

    const actionLabel = options.actionLabel;
    const onAction = typeof options.onAction === 'function' ? options.onAction : null;
    let actionBtn = null;
    if (actionLabel && onAction) {
        actionBtn = document.createElement('button');
        actionBtn.type = 'button';
        actionBtn.className = 'toast-action-btn';
        actionBtn.textContent = actionLabel;
        actionBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            try { onAction(); } catch (err) { console.warn('[Lumina] toast action', err); }
            toast.remove();
        });
    }

    const closeBtn = document.createElement('button');
    closeBtn.className = 'opacity-70 hover:opacity-100 text-lg leading-none';
    closeBtn.setAttribute('aria-label', '關閉');
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => toast.remove());
    
    if (actionBtn) toast.append(iconEl, textEl, actionBtn, closeBtn);
    else toast.append(iconEl, textEl, closeBtn);
    container.appendChild(toast);
    const ttl = Math.max(1500, Number(options.durationMs) || (actionBtn ? 7000 : 3200));
    setTimeout(() => { if (toast.parentElement) toast.remove(); }, ttl);
}

/** Single-slot undo for last complete/delete (market UX). */
function setTaskUndo(entry) {
    if (S._taskUndoTimer) {
        clearTimeout(S._taskUndoTimer);
        S._taskUndoTimer = null;
    }
    S._taskUndo = entry || null;
    if (!entry) return;
    S._taskUndoTimer = setTimeout(() => {
        S._taskUndo = null;
        S._taskUndoTimer = null;
    }, 8000);
}

function undoLastTaskAction() {
    const u = S._taskUndo;
    if (!u) {
        showToast('沒有可復原的操作', 'error');
        return;
    }
    setTaskUndo(null);
    if (u.type === 'complete') {
        const task = S.tasks.find(t => t.id === u.taskId);
        if (task) {
            task.completed = !!u.wasCompleted;
            touchTask(task);
            if (u.todayFocusTaskId != null) S.todayFocusTaskId = u.todayFocusTaskId;
            saveState();
            refreshUI({ dashboard: true, scheduler: true, filters: true, schedule: true });
            if (task.enterpriseTaskId && S.enterpriseSession) {
                try { syncPersonalTaskCompletionToEnterprise(task); } catch (_) {}
            }
            showToast('已復原完成狀態', 'success');
        }
        return;
    }
    if (u.type === 'delete' && u.task) {
        S.tasks.splice(Math.min(u.index || 0, S.tasks.length), 0, u.task);
        rebuildTaskIndex();
        invalidateTodayStats();
        if (u.todayFocusTaskId != null) S.todayFocusTaskId = u.todayFocusTaskId;
        saveState();
        refreshUI({ dashboard: true, scheduler: true, filters: true, schedule: true });
        showToast('已復原刪除的任務', 'success');
    }
}

// Reset everything

async function resetAllData() {
    const ok = await showConfirmDialog({
        title: '重置所有資料',
        message: '這會清除任務與統計（API Key 與基本設定會保留）。此操作無法復原。',
        confirmLabel: '確定重置',
        cancelLabel: '取消',
        danger: true
    });
    if (!ok) return;

    clearSensitiveLocalData();
    location.reload();
}
