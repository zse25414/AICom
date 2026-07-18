/* Lumina: notifications/index.js */
function ensureLocalGroupNotifications(group) {
    if (!Array.isArray(group.notifications)) group.notifications = [];
}

function pushLocalTeamNotification(groupCode, payload) {
    const store = loadLocalEnterpriseStore();
    const group = store.groups[normalizeEnterpriseCode(groupCode)];
    if (!group) return null;
    ensureLocalGroupNotifications(group);
    const note = {
        id: 'n_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        type: payload.type,
        recipientId: payload.recipientId,
        title: payload.title || '團隊通知',
        message: payload.message || '',
        taskId: payload.taskId || null,
        taskTitle: payload.taskTitle || '',
        actorId: payload.actorId || null,
        actorName: payload.actorName || '',
        read: false,
        createdAt: new Date().toISOString()
    };
    group.notifications.unshift(note);
    if (group.notifications.length > 200) group.notifications.length = 200;
    saveLocalEnterpriseStore(store);
    return note;
}

function getLocalTeamNotifications() {
    if (!S.enterpriseSession) return [];
    const store = loadLocalEnterpriseStore();
    const group = store.groups[normalizeEnterpriseCode(S.enterpriseSession.groupCode)];
    if (!group) return [];
    ensureLocalGroupNotifications(group);
    return group.notifications
        .filter(n => n.recipientId === S.enterpriseSession.memberId)
        .slice(0, 50);
}

function getLocalReadNotificationStorageKey() {
    if (!S.enterpriseSession) return null;
    return `lumina_notif_read_${normalizeEnterpriseCode(S.enterpriseSession.groupCode)}_${S.enterpriseSession.memberId}`;
}

function loadLocallyReadNotificationIds() {
    const key = getLocalReadNotificationStorageKey();
    if (!key) return;
    S.locallyReadNotificationIds.clear();
    try {
        const parsed = JSON.parse(localStorage.getItem(key) || '[]');
        if (Array.isArray(parsed)) parsed.forEach(id => S.locallyReadNotificationIds.add(id));
    } catch (_) {}
}

function persistLocallyReadNotificationIds() {
    const key = getLocalReadNotificationStorageKey();
    if (!key) return;
    localStorage.setItem(key, JSON.stringify([...S.locallyReadNotificationIds]));
}

function rememberLocallyReadNotificationIds(ids, readAll) {
    if (!S.enterpriseSession) return;
    if (readAll) {
        S.teamNotifications.forEach(n => S.locallyReadNotificationIds.add(n.id));
    } else {
        ids.forEach(id => S.locallyReadNotificationIds.add(id));
    }
    persistLocallyReadNotificationIds();
}

function applyLocalReadFlags(notifications) {
    return (notifications || []).map(note => ({
        ...note,
        read: !!(note.read || S.locallyReadNotificationIds.has(note.id))
    }));
}

function markLocalTeamNotificationsRead(ids, readAll) {
    if (!S.enterpriseSession) return 0;
    const store = loadLocalEnterpriseStore();
    const group = store.groups[normalizeEnterpriseCode(S.enterpriseSession.groupCode)];
    if (!group) return 0;
    ensureLocalGroupNotifications(group);
    let updated = 0;
    for (const note of group.notifications) {
        if (note.recipientId !== S.enterpriseSession.memberId) continue;
        if (readAll || ids.includes(note.id)) {
            if (!note.read) updated++;
            note.read = true;
        }
    }
    saveLocalEnterpriseStore(store);
    rememberLocallyReadNotificationIds(ids, readAll);
    return updated;
}

function getDefaultTeamNotificationPrefs() {
    return { taskAssigned: true, taskCompleted: true, toast: true, desktop: false };
}

function getTeamNotificationPrefs() {
    try {
        return { ...getDefaultTeamNotificationPrefs(), ...JSON.parse(localStorage.getItem(C.TEAM_NOTIF_PREFS_KEY) || '{}') };
    } catch (_) {
        return getDefaultTeamNotificationPrefs();
    }
}

function saveTeamNotificationPrefs() {
    const prefs = {
        taskAssigned: !!document.getElementById('team-notif-assigned')?.checked,
        taskCompleted: !!document.getElementById('team-notif-completed')?.checked,
        toast: !!document.getElementById('team-notif-toast')?.checked,
        desktop: !!document.getElementById('team-notif-desktop')?.checked
    };
    localStorage.setItem(C.TEAM_NOTIF_PREFS_KEY, JSON.stringify(prefs));
}

async function onTeamDesktopNotifToggle() {
    const el = document.getElementById('team-notif-desktop');
    const hint = document.getElementById('team-notif-perm-hint');
    if (!el?.checked) {
        if (hint) hint.classList.add('hidden');
        saveTeamNotificationPrefs();
        return;
    }
    if (!('Notification' in window)) {
        el.checked = false;
        showToast('此瀏覽器不支援桌面通知', 'error');
        return;
    }
    if (Notification.permission === 'granted') {
        if (hint) hint.classList.add('hidden');
        saveTeamNotificationPrefs();
        return;
    }
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') {
        el.checked = false;
        if (hint) hint.classList.remove('hidden');
        showToast('未授權桌面通知', 'error');
    } else {
        if (hint) hint.classList.add('hidden');
        saveTeamNotificationPrefs();
        showToast('已啟用桌面通知', 'success');
    }
}

function loadTeamNotificationPrefsForm() {
    const prefs = getTeamNotificationPrefs();
    const set = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };
    set('team-notif-assigned', prefs.taskAssigned);
    set('team-notif-completed', prefs.taskCompleted);
    set('team-notif-toast', prefs.toast);
    set('team-notif-desktop', prefs.desktop);
    const hint = document.getElementById('team-notif-perm-hint');
    if (hint) {
        hint.classList.toggle('hidden', !(prefs.desktop && Notification.permission !== 'granted'));
    }
}

function shouldAlertForNotification(note, prefs) {
    if (note.type === 'task_assigned' || note.type === 'task_assigned_confirm') return prefs.taskAssigned;
    if (note.type === 'task_completed' || note.type === 'task_completed_confirm') return prefs.taskCompleted;
    return true;
}

function ingestTeamNotificationsFromResponse(notifications, alert = true) {
    if (!notifications?.length || !S.enterpriseSession) return;
    for (const rawNote of notifications) {
        if (rawNote.recipientId !== S.enterpriseSession.memberId) continue;
        const note = applyLocalReadFlags([rawNote])[0];
        const index = S.teamNotifications.findIndex(n => n.id === note.id);
        if (index >= 0) {
            S.teamNotifications[index] = { ...S.teamNotifications[index], ...note, read: S.teamNotifications[index].read || note.read };
            continue;
        }
        S.knownTeamNotificationIds.add(note.id);
        S.teamNotifications = [note, ...S.teamNotifications].slice(0, 50);
        if (alert && !note.read) alertForNewTeamNotification(note);
    }
    updateNotificationUI();
}

function alertForNewTeamNotification(note) {
    const prefs = getTeamNotificationPrefs();
    if (!shouldAlertForNotification(note, prefs)) return;
    if (prefs.toast) showToast(note.message || note.title, 'success');
    if (prefs.desktop && 'Notification' in window && Notification.permission === 'granted') {
        try {
            new Notification(note.title || 'Lumina 團隊通知', {
                body: note.message,
                tag: 'lumina-team-' + note.id,
                icon: undefined
            });
        } catch (_) {}
    }
}

function processIncomingTeamNotifications(notifications) {
    const incoming = applyLocalReadFlags(notifications || []);
    const previousById = new Map(S.teamNotifications.map(n => [n.id, n]));
    const newUnread = [];
    for (const note of incoming) {
        const wasRead = previousById.get(note.id)?.read;
        note.read = !!(note.read || wasRead);
        if (!S.knownTeamNotificationIds.has(note.id)) {
            S.knownTeamNotificationIds.add(note.id);
            if (S.teamNotificationsInitialized && !note.read) newUnread.push(note);
        }
    }
    if (!S.teamNotificationsInitialized) {
        incoming.forEach(n => S.knownTeamNotificationIds.add(n.id));
        S.teamNotificationsInitialized = true;
        loadLocallyReadNotificationIds();
        incoming.forEach(n => {
            if (S.locallyReadNotificationIds.has(n.id)) n.read = true;
        });
    }
    for (const note of newUnread) alertForNewTeamNotification(note);
    S.teamNotifications = incoming;
    updateNotificationUI();
}

async function refreshTeamNotifications(force = false) {
    if (!S.enterpriseSession) {
        S.teamNotifications = [];
        updateNotificationUI();
        return;
    }
    if (S._enterpriseRateLimitedUntil && Date.now() < S._enterpriseRateLimitedUntil) {
        return;
    }
    if (S._refreshNotifInFlight) return S._refreshNotifInFlight;
    const now = Date.now();
    if (!force && S._refreshNotifAt && now - S._refreshNotifAt < 8000) return;
    S._refreshNotifAt = now;

    S._refreshNotifInFlight = (async () => {
        const path = `/api/enterprise/notifications?groupCode=${encodeURIComponent(S.enterpriseSession.groupCode)}&memberId=${encodeURIComponent(S.enterpriseSession.memberId || '')}`;
        const api = await enterpriseFetch('GET', path);
        if (api.status === 429) {
            S._enterpriseRateLimitedUntil = Date.now() + 20000;
            return;
        }
        if (api.ok) {
            if (api.data?.member?.id && api.data.member.id !== S.enterpriseSession.memberId) {
                try {
                    if (typeof applyResolvedEnterpriseMember === 'function') {
                        applyResolvedEnterpriseMember(api.data.member, {
                            code: S.enterpriseSession.groupCode,
                            name: S.enterpriseSession.groupName
                        });
                    }
                } catch (_) {}
            }
            processIncomingTeamNotifications(api.data.notifications || []);
        } else {
            processIncomingTeamNotifications(getLocalTeamNotifications());
        }
    })().finally(() => { S._refreshNotifInFlight = null; });
    return S._refreshNotifInFlight;
}

function updateNotificationUI() {
    const wrap = document.getElementById('notif-wrap');
    const badge = document.getElementById('notif-badge');
    const bell = document.getElementById('notif-bell-btn');
    const unread = S.teamNotifications.filter(n => !n.read).length;
    
    if (wrap) wrap.classList.toggle('hidden', !S.enterpriseSession);
    if (badge) {
        if (unread > 0) {
            badge.textContent = unread > 9 ? '9+' : String(unread);
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    }
    if (bell) bell.classList.toggle('has-unread', unread > 0);
    if (S.notifPanelOpen) renderNotificationPanel();
}

function renderNotificationPanel() {
    const list = document.getElementById('notif-panel-list');
    if (!list) return;
    if (!S.teamNotifications.length) {
        list.innerHTML = `<div class="notif-empty"><i class="fa-solid fa-bell-slash text-2xl mb-2 block opacity-40"></i>目前沒有通知</div>`;
        return;
    }
    list.innerHTML = S.teamNotifications.map(note => {
        const isComplete = note.type === 'task_completed' || note.type === 'task_completed_confirm';
        const iconCls = isComplete ? 'notif-item-icon-completed' : 'notif-item-icon-assigned';
        const icon = isComplete ? 'fa-check' : (note.type === 'task_assigned_confirm' ? 'fa-share' : 'fa-paper-plane');
        return `
            <div class="notif-item ${note.read ? '' : 'unread'}" ${luminaAction('handleTeamNotificationClick', { arg: note.id })} role="button" tabindex="0">
                <div class="notif-item-icon ${iconCls}"><i class="fa-solid ${icon}"></i></div>
                <div class="min-w-0 flex-1">
                    <div class="notif-item-title">${escapeHtml(note.title)}</div>
                    <div class="notif-item-msg">${escapeHtml(note.message)}</div>
                    <div class="notif-item-time">${formatNotifTime(note.createdAt)}</div>
                </div>
                ${note.read ? '' : '<span class="w-2 h-2 rounded-full bg-indigo-400 flex-shrink-0 mt-1"></span>'}
            </div>`;
    }).join('');
}

function toggleNotificationPanel(event) {
    if (event) event.stopPropagation();
    S.notifPanelOpen = !S.notifPanelOpen;
    const panel = document.getElementById('notif-panel');
    const bell = document.getElementById('notif-bell-btn');
    if (panel) {
        panel.classList.toggle('hidden', !S.notifPanelOpen);
        panel.style.display = S.notifPanelOpen ? '' : 'none';
    }
    if (bell) bell.setAttribute('aria-expanded', S.notifPanelOpen ? 'true' : 'false');
    if (S.notifPanelOpen) {
        renderNotificationPanel();
        refreshTeamNotifications(true);
    }
}

function closeNotificationPanel() {
    S.notifPanelOpen = false;
    const panel = document.getElementById('notif-panel');
    if (panel) {
        panel.classList.add('hidden');
        panel.style.display = 'none';
    }
    document.getElementById('notif-bell-btn')?.setAttribute('aria-expanded', 'false');
}

async function markTeamNotificationRead(noteId) {
    if (!S.enterpriseSession || !noteId) return;
    rememberLocallyReadNotificationIds([noteId], false);
    markLocalTeamNotificationsRead([noteId], false);
    const note = S.teamNotifications.find(n => n.id === noteId);
    if (note) note.read = true;
    updateNotificationUI();

    const api = await enterpriseFetch('PATCH', '/api/enterprise/notifications/read', {
        groupCode: S.enterpriseSession.groupCode,
        memberId: S.enterpriseSession.memberId,
        ids: [noteId]
    });
    if (!api.ok && !S.enterpriseSession.offline) {
        console.warn('[Lumina] 標記已讀同步失敗:', api.error);
    }
}

async function markAllTeamNotificationsRead() {
    if (!S.enterpriseSession) return;
    rememberLocallyReadNotificationIds([], true);
    markLocalTeamNotificationsRead([], true);
    S.teamNotifications.forEach(n => { n.read = true; });
    updateNotificationUI();

    const api = await enterpriseFetch('PATCH', '/api/enterprise/notifications/read', {
        groupCode: S.enterpriseSession.groupCode,
        memberId: S.enterpriseSession.memberId,
        readAll: true
    });
    if (!api.ok && !S.enterpriseSession.offline) {
        showToast('已在本機標為已讀（伺服器同步稍後重試）', 'success');
        return;
    }
    showToast('已全部標為已讀', 'success');
}

function handleTeamNotificationClick(noteId) {
    const note = S.teamNotifications.find(n => n.id === noteId);
    if (!note) return;
    markTeamNotificationRead(noteId);
    closeNotificationPanel();
    showSection('team');
    if (note.taskId) {
        setTimeout(() => {
            const row = document.querySelector(`[data-team-task-id="${note.taskId}"]`);
            row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 300);
    }
}
