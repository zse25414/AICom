/* Lumina: enterprise/team.js */
function getEnterpriseBaseUrl() {
    const url = (S.userProfile.enterpriseApiUrl || 'http://localhost:3001').replace(/\/$/, '');
    return isSafeHttpUrl(url) ? url : 'http://localhost:3001';
}

function loadLocalEnterpriseStore() {
    try {
        return JSON.parse(localStorage.getItem(C.LOCAL_ENTERPRISE_KEY) || '{"groups":{}}');
    } catch (_) {
        return { groups: {} };
    }
}

function saveLocalEnterpriseStore(store) {
    localStorage.setItem(C.LOCAL_ENTERPRISE_KEY, JSON.stringify(store));
}

function normalizeEnterpriseCode(code) {
    return String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Enterprise HTTP helper.
 * - offline:true  only for network / unreachable (not HTTP 4xx/5xx business errors)
 * - returns { ok, data, error, code, status, offline }
 */
async function enterpriseFetch(method, path, body) {
    const url = getEnterpriseBaseUrl() + path;
    try {
        const res = await fetch(url, {
            method,
            headers: {
                ...getAuthHeaders(false),
                ...(body != null ? { 'Content-Type': 'application/json' } : {})
            },
            body: body != null ? JSON.stringify(body) : undefined
        });
        let data = {};
        try {
            data = await res.json();
        } catch (_) {
            data = {};
        }
        if (!res.ok) {
            return {
                ok: false,
                data,
                error: data.error || data.message || `HTTP ${res.status}`,
                code: data.code || null,
                status: res.status,
                offline: false
            };
        }
        return { ok: true, data, offline: false, status: res.status, error: null, code: null };
    } catch (err) {
        // Network failure / DNS / CORS / connection refused only
        return {
            ok: false,
            data: null,
            error: err.message || '網路錯誤',
            code: 'NETWORK_ERROR',
            status: 0,
            offline: true
        };
    }
}

async function enterpriseLocalCreate(body) {
    const store = loadLocalEnterpriseStore();
    const code = normalizeEnterpriseCode(body.code);
    if (store.groups[code]) throw new Error('此群組代碼已存在');
    const managerId = 'm_' + Date.now();
    store.groups[code] = {
        code,
        name: clampText(body.name || '未命名團隊', 80),
        managerPinHash: await hashPin(body.managerPin),
        members: [{
            id: managerId,
            name: clampText(body.managerName, 80),
            role: 'manager',
            joinedAt: new Date().toISOString()
        }],
        tasks: [],
        notifications: [],
        documents: []
    };
    saveLocalEnterpriseStore(store);
    return { group: { code, name: store.groups[code].name }, member: store.groups[code].members[0] };
}

async function enterpriseLocalJoin(body) {
    const store = loadLocalEnterpriseStore();
    const code = normalizeEnterpriseCode(body.code);
    const group = store.groups[code];
    if (!group) throw new Error('找不到此群組代碼');
    if (body.role === 'manager' && !(await verifyLocalManagerPin(group, body.pin))) {
        throw new Error('主管金鑰錯誤');
    }
    if (group.managerPin !== undefined && !group.managerPinHash) {
        group.managerPinHash = await hashPin(group.managerPin);
        delete group.managerPin;
    }
    const existing = group.members.find(m => m.name.toLowerCase() === body.name.toLowerCase());
    if (existing) return { group: { code, name: group.name }, member: existing };
    const member = {
        id: 'u_' + Date.now(),
        name: clampText(body.name, 80),
        role: body.role || 'member',
        joinedAt: new Date().toISOString()
    };
    group.members.push(member);
    saveLocalEnterpriseStore(store);
    return { group: { code, name: group.name }, member };
}

function enterpriseLocalGetGroup(code, memberId) {
    const store = loadLocalEnterpriseStore();
    const group = store.groups[normalizeEnterpriseCode(code)];
    if (!group) throw new Error('找不到群組');
    const payload = { ...group };
    if (memberId) {
        ensureLocalGroupNotifications(group);
        payload.notifications = group.notifications
            .filter(n => n.recipientId === memberId)
            .slice(0, 50);
    }
    return { group: payload };
}

function toggleManagerPin() {
    const role = document.getElementById('team-join-role')?.value;
    const pinField = document.getElementById('team-join-pin-field');
    const pin = document.getElementById('team-join-pin');
    if (pinField) pinField.classList.toggle('hidden', role !== 'manager');
    if (pin && role !== 'manager') pin.value = '';
}

function getMemberInitials(name) {
    const n = String(name || '').trim();
    if (!n) return '?';
    if (/[\u4e00-\u9fff]/.test(n)) return n.slice(-1);
    const parts = n.split(/\s+/);
    return parts.length > 1
        ? (parts[0][0] + parts[1][0]).toUpperCase()
        : n.slice(0, 2).toUpperCase();
}

function renderMemberChip(member) {
    const isManager = member.role === 'manager';
    const colors = isManager
        ? 'bg-amber-500/20 text-amber-200 border-amber-500/30'
        : 'bg-indigo-500/20 text-indigo-200 border-indigo-500/30';
    return `
        <span class="member-chip">
            <span class="member-avatar ${colors} border">${escapeHtml(getMemberInitials(member.name))}</span>
            <span>${escapeHtml(member.name)}</span>
            ${isManager ? '<span class="text-[9px] text-amber-400/80 ml-0.5">主管</span>' : ''}
        </span>
    `;
}

async function fetchApiReadiness() {
    try {
        const res = await fetch(getEnterpriseBaseUrl() + '/ready', { method: 'GET' });
        let data = {};
        try { data = await res.json(); } catch (_) {}
        return {
            reachable: true,
            ready: res.ok && !!data.ok,
            checks: data.checks || null,
            details: data.details || null,
            uptimeSec: data.uptimeSec != null ? data.uptimeSec : null,
            backgroundIndexJobs: data.backgroundIndexJobs != null ? data.backgroundIndexJobs : null
        };
    } catch (_) {
        return {
            reachable: false,
            ready: false,
            checks: null,
            details: null,
            uptimeSec: null,
            backgroundIndexJobs: null
        };
    }
}

async function fetchOpsStatus(limit = 12) {
    try {
        const res = await fetch(
            getEnterpriseBaseUrl() + '/api/ops/status?limit=' + encodeURIComponent(String(limit)),
            { method: 'GET' }
        );
        if (!res.ok) return null;
        return await res.json().catch(() => null);
    } catch (_) {
        return null;
    }
}

function formatReadinessHint(checks, details) {
    if (!checks) return '';
    const parts = [];
    if ('store' in checks) parts.push(`store:${checks.store ? '✓' : '✗'}`);
    if ('auth' in checks) parts.push(`auth:${checks.auth ? '✓' : '✗'}`);
    if ('rag' in checks) parts.push(`rag:${checks.rag ? '✓' : '✗'}`);
    if (details?.rag?.latencyMs != null) parts.push(`ragLatency:${details.rag.latencyMs}ms`);
    if (details?.rag?.embedding) parts.push(`embed:${details.rag.embedding}`);
    if (details?.rag?.retrieval) parts.push(`retrieval:${details.rag.retrieval}`);
    return parts.join(' ');
}

async function updateTeamSyncStatus() {
    const el = document.getElementById('team-sync-status');
    if (!el) return;
    if (S.enterpriseSession?.offline) {
        el.textContent = '● 離線模式';
        el.className = 'text-[10px] px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/25';
        el.title = '變更僅存於本機，請啟動 API 後重新加入團隊';
        return;
    }
    const status = await fetchApiReadiness();
    if (!status.reachable) {
        el.textContent = '● 離線模式';
        el.className = 'text-[10px] px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/25';
        el.title = 'API 無法連線，使用本機離線模式';
        return;
    }
    if (status.ready) {
        el.textContent = '● 已就緒';
        el.className = 'text-[10px] px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/25';
    } else {
        el.textContent = '● 啟動中';
        el.className = 'text-[10px] px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/25';
    }
    el.title = formatReadinessHint(status.checks) || (status.ready ? 'API 已就緒' : 'API 連線中，子系統尚未就緒');
}

function copyGroupCode() {
    if (!S.enterpriseSession?.groupCode) return showToast('尚無群組代碼', 'error');
    const code = S.enterpriseSession.groupCode;
    const shareText = `加入 Lumina 團隊，群組代碼：${code}`;
    if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(shareText).then(() => showToast('群組代碼已複製，可分享給同事', 'success'));
    } else {
        showToast(shareText, 'success');
    }
}

function applyTeamInviteFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const code = normalizeEnterpriseCode(params.get('group') || params.get('code') || '');
    if (!code) return;
    const input = document.getElementById('team-join-code');
    if (input) input.value = code;
    if (!S.enterpriseSession) showSection('team');
}

async function createEnterpriseGroup() {
    if (!isLoggedIn()) {
        showToast('請先登入帳號，才能建立並同步團隊', 'error');
        showAuthOverlay('login');
        return;
    }
    const name = document.getElementById('team-create-name').value.trim();
    const code = normalizeEnterpriseCode(document.getElementById('team-create-code').value);
    const managerName = document.getElementById('team-create-manager').value.trim();
    const managerPin = document.getElementById('team-create-pin').value.trim();
    
    if (!code || code.length < 4) return showToast('群組代碼至少 4 個字元', 'error');
    if (!managerName) return showToast('請輸入主管名稱', 'error');
    if (!managerPin || managerPin.length < 4) return showToast('請設定至少 4 位主管 PIN', 'error');
    if (['0000', '1234', '1111'].includes(managerPin)) return showToast('PIN 過於簡單，請更換', 'error');
    
    const payload = { name, code, managerName, managerPin };
    let result;
    const api = await enterpriseFetch('POST', '/api/enterprise/group/create', payload);
    
    if (api.ok) {
        result = api.data;
    } else if (api.offline) {
        try {
            result = { ok: true, ...(await enterpriseLocalCreate(payload)) };
            showToast('已建立群組（本機離線模式）', 'success');
        } catch (e) {
            return showToast(e.message, 'error');
        }
    } else {
        return showToast(api.error || '建立群組失敗', 'error');
    }
    
    S.enterpriseSession = {
        memberId: result.member.id,
        name: result.member.name,
        role: result.member.role,
        groupCode: result.group.code,
        groupName: result.group.name,
        offline: !!api.offline
    };
    localStorage.setItem('lumina_enterprise_session', JSON.stringify(S.enterpriseSession));
    loadLocallyReadNotificationIds();
    showToast(`群組 ${result.group.code} 建立成功！`, 'success');
    await refreshEnterpriseData();
    renderEnterprisePage();
    startEnterprisePolling();
    await refreshTeamNotifications(true);
}

async function joinEnterpriseGroup() {
    if (!isLoggedIn()) {
        showToast('請先登入帳號，才能加入團隊並使用知識庫', 'error');
        showAuthOverlay('login');
        return;
    }
    const code = normalizeEnterpriseCode(document.getElementById('team-join-code').value);
    const name = document.getElementById('team-join-name').value.trim();
    const role = document.getElementById('team-join-role').value;
    const pin = document.getElementById('team-join-pin').value.trim();
    
    if (!code) return showToast('請輸入群組代碼', 'error');
    if (!name) return showToast('請輸入你的名稱', 'error');
    
    const payload = { code, name, role, pin };
    let result;
    const api = await enterpriseFetch('POST', '/api/enterprise/group/join', payload);
    
    if (api.ok) {
        result = api.data;
    } else if (api.offline) {
        try {
            result = { ok: true, ...(await enterpriseLocalJoin(payload)) };
            showToast('已加入群組（本機離線模式）', 'success');
        } catch (e) {
            return showToast(e.message, 'error');
        }
    } else {
        return showToast(api.error || '加入群組失敗', 'error');
    }
    
    S.enterpriseSession = {
        memberId: result.member.id,
        name: result.member.name,
        role: result.member.role,
        groupCode: result.group.code,
        groupName: result.group.name,
        offline: !!api.offline
    };
    localStorage.setItem('lumina_enterprise_session', JSON.stringify(S.enterpriseSession));
    loadLocallyReadNotificationIds();
    showToast(`已加入 ${result.group.name}`, 'success');
    await refreshEnterpriseData();
    renderEnterprisePage();
    startEnterprisePolling();
    await refreshTeamNotifications(true);
}

function leaveEnterpriseGroup() {
    if (!confirm('確定離開目前群組？')) return;
    S.enterpriseSession = null;
    S.enterpriseGroupData = null;
    S.teamNotifications = [];
    S.teamNotificationsInitialized = false;
    S.knownTeamNotificationIds.clear();
    S.locallyReadNotificationIds.clear();
    S.teamWorkspaceTab = 'members';
    S.ragKbItemsById = {};
    closeNotificationPanel();
    stopEnterprisePolling();
    localStorage.removeItem('lumina_enterprise_session');
    renderEnterprisePage();
    updateNotificationUI();
    showToast('已離開群組', 'success');
}

/**
 * Team workspace primary tabs: members | knowledge (not main nav).
 */
function switchTeamWorkspaceTab(tab) {
    const next = tab === 'knowledge' ? 'knowledge' : 'members';
    S.teamWorkspaceTab = next;

    const membersPane = document.getElementById('team-pane-members');
    const knowledgePane = document.getElementById('team-pane-knowledge');
    const tabMembers = document.getElementById('team-tab-members');
    const tabKnowledge = document.getElementById('team-tab-knowledge');
    const isKnowledge = next === 'knowledge';

    if (membersPane) {
        membersPane.classList.toggle('hidden', isKnowledge);
        membersPane.hidden = isKnowledge;
    }
    if (knowledgePane) {
        knowledgePane.classList.toggle('hidden', !isKnowledge);
        knowledgePane.hidden = !isKnowledge;
    }
    if (tabMembers) {
        tabMembers.classList.toggle('active', !isKnowledge);
        tabMembers.setAttribute('aria-selected', isKnowledge ? 'false' : 'true');
    }
    if (tabKnowledge) {
        tabKnowledge.classList.toggle('active', isKnowledge);
        tabKnowledge.setAttribute('aria-selected', isKnowledge ? 'true' : 'false');
    }

    if (isKnowledge) {
        // renderEnterpriseDocuments also refreshes KB list when on knowledge pane
        if (typeof window.renderEnterpriseDocuments === 'function' && S.enterpriseGroupData) {
            window.renderEnterpriseDocuments();
        } else {
            window.renderTeamKnowledgeBases?.();
        }
    }
}

async function refreshEnterpriseData(force = false) {
    if (!S.enterpriseSession) return;
    
    const now = Date.now();
    if (!force && S.enterpriseGroupData && (now - S.enterpriseDataFetchedAt) < C.ENTERPRISE_FETCH_TTL_MS) {
        renderEnterpriseTasks();
        return;
    }
    
    const code = S.enterpriseSession.groupCode;
    const memberQ = `?memberId=${encodeURIComponent(S.enterpriseSession.memberId)}`;
    const api = await enterpriseFetch('GET', `/api/enterprise/group/${code}${memberQ}`);
    
    if (api.ok) {
        // Preserve local ragStatus overrides when server lags (pending poll)
        const prevDocs = S.enterpriseGroupData?.documents || [];
        const prevById = Object.fromEntries(prevDocs.map(d => [d.id, d]));
        S.enterpriseGroupData = api.data.group;
        if (Array.isArray(S.enterpriseGroupData.documents)) {
            S.enterpriseGroupData.documents = S.enterpriseGroupData.documents.map(d => {
                const prev = prevById[d.id];
                if (!prev) return d;
                const localSt = prev.ragStatus || prev.rag?.status;
                const serverSt = d.ragStatus || d.rag?.status;
                // Keep more specific local failure/index codes if server still pending
                if (localSt && localSt !== 'pending' && serverSt === 'pending') {
                    return {
                        ...d,
                        ragStatus: localSt,
                        rag: { ...(d.rag || {}), ...(prev.rag || {}), status: localSt }
                    };
                }
                return d;
            });
        }
        cacheEnterpriseGroupLocally(api.data.group);
        if (api.data.group.notifications) {
            processIncomingTeamNotifications(api.data.group.notifications);
        }
    } else if (api.offline || S.enterpriseSession.offline) {
        try {
            S.enterpriseGroupData = enterpriseLocalGetGroup(code, S.enterpriseSession.memberId).group;
            if (S.enterpriseGroupData.notifications) {
                processIncomingTeamNotifications(S.enterpriseGroupData.notifications);
            }
        } catch (e) {
            showToast('同步失敗：' + e.message, 'error');
            return;
        }
    } else {
        showToast(api.error || '同步失敗', 'error');
        return;
    }
    S.enterpriseDataFetchedAt = Date.now();
    renderEnterpriseTasks();
    if (S.enterpriseGroupData?.documents?.length) {
        ensureEnterpriseDocsInRag();
    }
}

function renderEnterprisePage() {
    const onboarding = document.getElementById('team-onboarding');
    const workspace = document.getElementById('team-workspace');
    const badge = document.getElementById('team-status-badge');
    const apiHint = document.getElementById('team-api-hint');
    const tabs = document.getElementById('team-workspace-tabs');
    
    if (!S.enterpriseSession) {
        onboarding?.classList.remove('hidden');
        workspace?.classList.add('hidden');
        tabs?.classList.add('hidden');
        if (badge) { badge.textContent = '未加入群組'; badge.className = 'self-start sm:self-auto text-xs px-4 py-2 rounded-full bg-slate-800/80 text-slate-400 border border-slate-700/60'; }
        document.getElementById('team-stats-row')?.classList.add('hidden');
        apiHint?.classList.remove('hidden');
        return;
    }
    
    onboarding?.classList.add('hidden');
    workspace?.classList.remove('hidden');
    tabs?.classList.remove('hidden');
    apiHint?.classList.add('hidden');

    const offlineBanner = document.getElementById('team-offline-banner');
    if (offlineBanner) {
        offlineBanner.classList.toggle('hidden', !S.enterpriseSession.offline);
    }
    
    setElText('team-group-name', S.enterpriseSession.groupName);
    setElText('team-group-code', S.enterpriseSession.groupCode);
    setElText('team-user-name', S.enterpriseSession.name);
    setElText('team-user-role', S.enterpriseSession.role === 'manager' ? '主管' : '成員');
    
    if (badge) {
        badge.textContent = `${S.enterpriseSession.groupCode} · ${S.enterpriseSession.role === 'manager' ? '主管' : '成員'}`;
        badge.className = 'self-start sm:self-auto text-xs px-4 py-2 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/25';
    }
    
    const isManager = S.enterpriseSession.role === 'manager';
    document.getElementById('team-manager-panel')?.classList.toggle('hidden', !isManager);
    document.getElementById('team-overview-panel')?.classList.toggle('hidden', !isManager);
    document.getElementById('team-stats-row')?.classList.remove('hidden');
    const tasksTitle = document.getElementById('team-tasks-title');
    if (tasksTitle) tasksTitle.textContent = isManager ? '我負責的任務' : '指派給我的任務';

    // Restore / apply workspace tab (members | knowledge)
    switchTeamWorkspaceTab(S.teamWorkspaceTab === 'knowledge' ? 'knowledge' : 'members');
    
    const dueInput = document.getElementById('team-assign-due');
    if (dueInput && !dueInput.value) dueInput.value = getTomorrowISO();
    
    updateTeamSyncStatus();
    loadTeamNotificationPrefsForm();
    refreshEnterpriseData();
    updateNotificationUI();
    refreshTeamNotifications();
}

function getTeamTaskFilterState() {
    return {
        myStatus: document.getElementById('team-my-tasks-status')?.value || '',
        mySort: document.getElementById('team-my-tasks-sort')?.value || 'due_asc',
        ovMember: document.getElementById('team-overview-member')?.value || '',
        ovStatus: document.getElementById('team-overview-status')?.value || '',
        ovSort: document.getElementById('team-overview-sort')?.value || 'due_asc'
    };
}

function taskDueKey(t) {
    return String(t?.due || '9999-99-99');
}

function taskCreatedTs(t) {
    const n = Date.parse(t?.createdAt || 0);
    return Number.isFinite(n) ? n : 0;
}

function sortTeamTasks(tasks, sortKey) {
    const list = [...(tasks || [])];
    const key = sortKey || 'due_asc';
    list.sort((a, b) => {
        if (key === 'due_desc') return taskDueKey(b).localeCompare(taskDueKey(a));
        if (key === 'newest') return taskCreatedTs(b) - taskCreatedTs(a);
        if (key === 'status') {
            const ca = a.completed ? 1 : 0;
            const cb = b.completed ? 1 : 0;
            if (ca !== cb) return ca - cb;
            return taskDueKey(a).localeCompare(taskDueKey(b));
        }
        // due_asc
        return taskDueKey(a).localeCompare(taskDueKey(b));
    });
    return list;
}

function filterTeamTasksByStatus(tasks, status) {
    if (status === 'done') return (tasks || []).filter(t => t.completed);
    if (status === 'pending') return (tasks || []).filter(t => !t.completed);
    return tasks || [];
}

function onTeamTasksFilterChange() {
    renderEnterpriseTasks();
}

function populateTeamOverviewMemberFilter(members) {
    const el = document.getElementById('team-overview-member');
    if (!el) return;
    const prev = el.value || '';
    const opts = ['<option value="">全部成員</option>'];
    (members || []).forEach(m => {
        opts.push(`<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)}</option>`);
    });
    el.innerHTML = opts.join('');
    if (prev && [...el.options].some(o => o.value === prev)) el.value = prev;
}

function renderEnterpriseTasks() {
    if (!S.enterpriseSession || !S.enterpriseGroupData) return;
    
    const membersEl = document.getElementById('team-members-list');
    const assignSelect = document.getElementById('team-assign-member');
    const myTasksEl = document.getElementById('team-my-tasks');
    const overviewBody = document.getElementById('team-overview-body');
    const progressEl = document.getElementById('team-my-progress');
    const filters = getTeamTaskFilterState();
    
    const members = S.enterpriseGroupData.members || [];
    const groupTasks = S.enterpriseGroupData.tasks || [];
    const syncedIds = buildSyncedEnterpriseIdSet();
    
    const totalTasks = groupTasks.length;
    const doneTasks = groupTasks.filter(t => t.completed).length;
    const rate = totalTasks ? Math.round((doneTasks / totalTasks) * 100) : 0;
    
    const statMembers = document.getElementById('team-stat-members');
    const statTasks = document.getElementById('team-stat-tasks');
    const statRate = document.getElementById('team-stat-rate');
    if (statMembers) statMembers.textContent = members.length;
    if (statTasks) statTasks.textContent = totalTasks;
    if (statRate) statRate.textContent = rate + '%';
    
    if (membersEl) {
        membersEl.innerHTML = members.length
            ? members.map(m => renderMemberChip(m)).join('')
            : '<span class="text-xs text-slate-500">尚無成員</span>';
    }
    
    if (assignSelect && S.enterpriseSession.role === 'manager') {
        assignSelect.innerHTML = members
            .filter(m => m.role !== 'manager')
            .map(m => `<option value="${m.id}">${escapeHtml(m.name)}</option>`)
            .join('') || '<option value="">（尚無成員，請邀請同事加入）</option>';
    }

    if (S.enterpriseSession.role === 'manager') {
        populateTeamOverviewMemberFilter(members);
    }
    
    const myTasksAll = groupTasks.filter(t => t.assigneeId === S.enterpriseSession.memberId);
    const done = myTasksAll.filter(t => t.completed).length;
    const myRate = myTasksAll.length ? Math.round((done / myTasksAll.length) * 100) : 0;
    const myTasks = sortTeamTasks(
        filterTeamTasksByStatus(myTasksAll, filters.myStatus),
        filters.mySort
    );
    
    const progressWrap = document.getElementById('team-progress-wrap');
    const progressFill = document.getElementById('team-progress-fill');
    if (progressEl) {
        progressEl.textContent = myTasksAll.length ? `已完成 ${done} / ${myTasksAll.length}（${myRate}%）` : '等待主管指派任務';
    }
    if (progressWrap && progressFill) {
        if (myTasksAll.length) {
            progressWrap.classList.remove('hidden');
            progressFill.style.width = myRate + '%';
        } else {
            progressWrap.classList.add('hidden');
            progressFill.style.width = '0%';
        }
    }

    const myMeta = document.getElementById('team-my-tasks-meta');
    if (myMeta) {
        const filtering = !!(filters.myStatus || (filters.mySort && filters.mySort !== 'due_asc'));
        if (myTasksAll.length && filtering) {
            myMeta.classList.remove('hidden');
            myMeta.textContent = `顯示 ${myTasks.length} / ${myTasksAll.length} 項`;
        } else {
            myMeta.classList.add('hidden');
            myMeta.textContent = '';
        }
    }
    
    if (myTasksEl) {
        if (myTasksAll.length === 0) {
            myTasksEl.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon"><i class="fa-solid fa-inbox"></i></div>
                    <div class="text-sm">目前沒有指派給你的任務</div>
                    <div class="text-xs text-slate-600 mt-1">完成後主管會即時看到更新</div>
                </div>`;
        } else if (myTasks.length === 0) {
            myTasksEl.innerHTML = `
                <div class="empty-state py-6">
                    <div class="empty-state-icon"><i class="fa-solid fa-filter"></i></div>
                    <div class="text-sm">沒有符合篩選的任務</div>
                    <div class="text-xs text-slate-600 mt-1">試試改選「全部狀態」</div>
                </div>`;
        } else {
            myTasksEl.innerHTML = myTasks.map(t => renderEnterpriseTaskRow(t, true, syncedIds)).join('');
        }
    }
    
    if (overviewBody && S.enterpriseSession.role === 'manager') {
        let overviewTasks = groupTasks;
        if (filters.ovMember) {
            overviewTasks = overviewTasks.filter(t => t.assigneeId === filters.ovMember);
        }
        overviewTasks = filterTeamTasksByStatus(overviewTasks, filters.ovStatus);
        overviewTasks = sortTeamTasks(overviewTasks, filters.ovSort);

        const ovMeta = document.getElementById('team-overview-meta');
        if (ovMeta) {
            const filtering = !!(filters.ovMember || filters.ovStatus || (filters.ovSort && filters.ovSort !== 'due_asc'));
            ovMeta.textContent = filtering
                ? `顯示 ${overviewTasks.length} / 共 ${groupTasks.length} 項任務`
                : (groupTasks.length ? `共 ${groupTasks.length} 項任務` : '');
        }

        if (groupTasks.length === 0) {
            overviewBody.innerHTML = `
                <tr><td colspan="4">
                    <div class="empty-state py-8">
                        <div class="empty-state-icon"><i class="fa-solid fa-clipboard-list"></i></div>
                        <div class="text-sm">尚無團隊任務</div>
                        <div class="text-xs text-slate-600 mt-1">在上方指派第一個任務</div>
                    </div>
                </td></tr>`;
        } else if (overviewTasks.length === 0) {
            overviewBody.innerHTML = `
                <tr><td colspan="4">
                    <div class="empty-state py-8">
                        <div class="empty-state-icon"><i class="fa-solid fa-filter"></i></div>
                        <div class="text-sm">沒有符合篩選的任務</div>
                        <div class="text-xs text-slate-600 mt-1">試試清除成員或狀態篩選</div>
                    </div>
                </td></tr>`;
        } else {
            overviewBody.innerHTML = overviewTasks.map(t => `
                <tr>
                    <td class="px-4 py-3 font-medium">${escapeHtml(t.title)}</td>
                    <td class="px-4 py-3">
                        <span class="inline-flex items-center gap-1.5 text-slate-400">
                            <span class="member-avatar bg-indigo-500/15 text-indigo-300 border border-indigo-500/20 text-[9px]">${escapeHtml(getMemberInitials(t.assigneeName))}</span>
                            ${escapeHtml(t.assigneeName)}
                        </span>
                    </td>
                    <td class="px-4 py-3 font-mono text-xs text-slate-400">${escapeHtml(t.due || '')}</td>
                    <td class="px-4 py-3">
                        <span class="status-pill ${t.completed ? 'status-pill-done' : 'status-pill-pending'}">
                            ${t.completed ? '✓ 已完成' : '進行中'}
                        </span>
                    </td>
                </tr>
            `).join('');
        }
    }
    renderEnterpriseDocuments();
}

function renderEnterpriseTaskRow(task, canToggle, syncedIds) {
    const synced = syncedIds ? syncedIds.has(task.id) : buildSyncedEnterpriseIdSet().has(task.id);
    return `
        <div class="task-row ${task.completed ? 'task-row-done' : ''}" data-team-task-id="${task.id}">
            <input type="checkbox" ${task.completed ? 'checked' : ''} ${canToggle ? `${luminaChange('toggleEnterpriseTask', [task.id, '__checked__'])} data-lumina-stop` : 'disabled'}
                   class="accent-indigo-500 w-4 h-4 cursor-pointer flex-shrink-0 rounded">
            <div class="flex-1 min-w-0">
                <div class="font-medium text-sm ${task.completed ? 'line-through text-slate-400' : 'text-slate-200'}">${escapeHtml(task.title)}</div>
                <div class="text-[10px] text-slate-500 mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                    <span><i class="fa-solid fa-user-tie text-[8px] mr-0.5"></i>${escapeHtml(task.assignedBy)}</span>
                    <span>·</span>
                    <span>${task.duration} 分鐘</span>
                    <span>·</span>
                    <span class="cat-badge ${getCategoryColor(task.category)}">${getCategoryLabel(task.category)}</span>
                    <span>·</span>
                    <span>截止 ${task.due}</span>
                </div>
            </div>
            <div class="flex items-center gap-2 flex-shrink-0">
                ${canToggle && !synced ? `<button ${luminaAction('syncEnterpriseTaskToPersonal', { arg: task.id })} class="text-[10px] px-2 py-1 rounded-lg border border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/10" title="同步到個人清單"><i class="fa-solid fa-arrow-down-to-bracket"></i></button>` : ''}
                ${synced ? `<span class="text-[10px] text-slate-500">已同步</span>` : ''}
                <span class="status-pill ${task.completed ? 'status-pill-done' : 'status-pill-pending'}">
                    ${task.completed ? '已完成' : '進行中'}
                </span>
            </div>
        </div>
    `;
}

async function assignEnterpriseTask() {
    if (!S.enterpriseSession || S.enterpriseSession.role !== 'manager') {
        return showToast('僅主管可指派任務', 'error');
    }
    if (S._assignTaskInFlight) {
        return showToast('任務指派中，請稍候…', 'error');
    }
    
    const title = document.getElementById('team-assign-title').value.trim();
    const assigneeId = document.getElementById('team-assign-member').value;
    if (!title) return showToast('請輸入任務名稱', 'error');
    if (!assigneeId) return showToast('請選擇成員', 'error');
    
    const payload = {
        groupCode: S.enterpriseSession.groupCode,
        managerId: S.enterpriseSession.memberId,
        assigneeId,
        title,
        due: document.getElementById('team-assign-due').value || getTodayISO(),
        duration: parseInt(document.getElementById('team-assign-duration').value) || 30,
        category: document.getElementById('team-assign-category').value,
        energy: 3
    };

    S._assignTaskInFlight = true;
    const assignBtn = document.querySelector('[data-lumina-action="assignEnterpriseTask"]');
    if (assignBtn) {
        assignBtn.disabled = true;
        assignBtn.classList.add('opacity-60');
    }

    let api;
    try {
        api = await enterpriseFetch('POST', '/api/enterprise/task/assign', payload);
    } finally {
        S._assignTaskInFlight = false;
        if (assignBtn) {
            assignBtn.disabled = false;
            assignBtn.classList.remove('opacity-60');
        }
    }
    
    const localAssignFallback = () => {
        const store = loadLocalEnterpriseStore();
        const group = store.groups[S.enterpriseSession.groupCode];
        const assignee = group?.members.find(m => m.id === assigneeId);
        const manager = group?.members.find(m => m.id === S.enterpriseSession.memberId);
        if (!group || !assignee || !manager) return showToast('指派失敗', 'error');
        const taskId = 't_' + Date.now();
        group.tasks.unshift({
            id: taskId,
            title: payload.title,
            assigneeId: assignee.id,
            assigneeName: assignee.name,
            assignedBy: manager.name,
            assignedById: manager.id,
            duration: payload.duration,
            energy: 3,
            category: payload.category,
            due: payload.due,
            completed: false,
            completedAt: null,
            createdAt: new Date().toISOString()
        });
        const created = [];
        if (assignee.id !== manager.id) {
            created.push(pushLocalTeamNotification(S.enterpriseSession.groupCode, {
                type: 'task_assigned',
                recipientId: assignee.id,
                title: '新任務指派',
                message: `${manager.name} 指派了「${payload.title}」給你，截止 ${payload.due}`,
                taskId,
                taskTitle: payload.title,
                actorId: manager.id,
                actorName: manager.name
            }));
        }
        created.push(pushLocalTeamNotification(S.enterpriseSession.groupCode, {
            type: 'task_assigned_confirm',
            recipientId: manager.id,
            title: '任務已指派',
            message: `已將「${payload.title}」指派給 ${assignee.name}，截止 ${payload.due}`,
            taskId,
            taskTitle: payload.title,
            actorId: manager.id,
            actorName: manager.name
        }));
        saveLocalEnterpriseStore(store);
        ingestTeamNotificationsFromResponse(created.filter(Boolean));
        showToast('任務已指派（本機模式）', 'success');
    };
    
    if (api.ok) {
        ingestTeamNotificationsFromResponse(api.data.notifications || []);
        // Optimistic: prepend server task if returned
        const serverTask = api.data.task;
        if (serverTask && S.enterpriseGroupData) {
            if (!Array.isArray(S.enterpriseGroupData.tasks)) S.enterpriseGroupData.tasks = [];
            if (!S.enterpriseGroupData.tasks.some(t => t.id === serverTask.id)) {
                S.enterpriseGroupData.tasks.unshift(serverTask);
            }
            renderEnterpriseTasks();
        }
        showToast('任務已指派！已發送通知', 'success');
    } else if (api.offline || S.enterpriseSession.offline) {
        localAssignFallback();
    } else {
        return showToast(api.error || '指派失敗', 'error');
    }

    // Clear form for next assign
    const titleEl = document.getElementById('team-assign-title');
    if (titleEl) titleEl.value = '';
    const dueEl = document.getElementById('team-assign-due');
    if (dueEl) dueEl.value = (typeof getTomorrowISO === 'function' ? getTomorrowISO() : getTodayISO());
    const durEl = document.getElementById('team-assign-duration');
    if (durEl && !durEl.value) durEl.value = '30';
    // keep assignee + category for bulk assign convenience
    titleEl?.focus();

    await refreshEnterpriseData(true);
    await refreshTeamNotifications(true);
}

function applyEnterpriseTaskToCache(taskId, completed, serverTask) {
    if (!S.enterpriseGroupData?.tasks) return false;
    const task = S.enterpriseGroupData.tasks.find(t => t.id === taskId);
    if (!task) return false;
    if (serverTask) {
        Object.assign(task, serverTask);
    } else {
        task.completed = completed;
        task.completedAt = completed ? new Date().toISOString() : null;
    }
    renderEnterpriseTasks();
    return true;
}

function persistEnterpriseTaskToggle(taskId, completed) {
    const store = loadLocalEnterpriseStore();
    const group = store.groups[S.enterpriseSession.groupCode];
    const task = group?.tasks.find(t => t.id === taskId);
    const member = group?.members.find(m => m.id === S.enterpriseSession.memberId);
    if (!task || !(S.enterpriseSession.role === 'manager' || task.assigneeId === S.enterpriseSession.memberId)) {
        return { ok: false, notifications: [] };
    }
    const wasCompleted = !!task.completed;
    task.completed = completed;
    task.completedAt = completed ? new Date().toISOString() : null;
    const created = [];
    if (completed && !wasCompleted && task.assignedById && task.assignedById !== S.enterpriseSession.memberId) {
        created.push(pushLocalTeamNotification(S.enterpriseSession.groupCode, {
            type: 'task_completed',
            recipientId: task.assignedById,
            title: '任務已完成',
            message: `${member?.name || S.enterpriseSession.name} 完成了「${task.title}」`,
            taskId: task.id,
            taskTitle: task.title,
            actorId: S.enterpriseSession.memberId,
            actorName: member?.name || S.enterpriseSession.name
        }));
    }
    if (completed && !wasCompleted && task.assigneeId === S.enterpriseSession.memberId && task.assigneeId !== task.assignedById) {
        created.push(pushLocalTeamNotification(S.enterpriseSession.groupCode, {
            type: 'task_completed_confirm',
            recipientId: S.enterpriseSession.memberId,
            title: '任務已標記完成',
            message: `你已完成「${task.title}」，主管已收到通知`,
            taskId: task.id,
            taskTitle: task.title,
            actorId: S.enterpriseSession.memberId,
            actorName: member?.name || S.enterpriseSession.name
        }));
    }
    saveLocalEnterpriseStore(store);
    return { ok: true, notifications: created.filter(Boolean), task: { ...task } };
}

async function toggleEnterpriseTask(taskId, completed) {
    if (!S.enterpriseSession || S.enterpriseToggleInFlight.has(taskId)) return;
    S.enterpriseToggleInFlight.add(taskId);
    
    const snapshot = S.enterpriseGroupData?.tasks?.find(t => t.id === taskId);
    const prevCompleted = snapshot?.completed;
    applyEnterpriseTaskToCache(taskId, completed);
    
    const payload = {
        groupCode: S.enterpriseSession.groupCode,
        memberId: S.enterpriseSession.memberId,
        completed
    };
    
    let succeeded = false;
    try {
        const api = await enterpriseFetch('PATCH', `/api/enterprise/task/${taskId}`, payload);
        
        if (api.ok) {
            succeeded = true;
            if (api.data.task) applyEnterpriseTaskToCache(taskId, completed, api.data.task);
            ingestTeamNotificationsFromResponse(api.data.notifications || []);
        } else if (api.offline || S.enterpriseSession.offline) {
            const local = persistEnterpriseTaskToggle(taskId, completed);
            if (local.ok) {
                succeeded = true;
                applyEnterpriseTaskToCache(taskId, completed, local.task);
                ingestTeamNotificationsFromResponse(local.notifications);
            }
        }
        
        if (!succeeded && snapshot) {
            applyEnterpriseTaskToCache(taskId, prevCompleted, snapshot);
            showToast('更新失敗，請再試一次', 'error');
            return;
        }
        
        if (succeeded) {
            syncEnterpriseCompletionToPersonal(taskId, completed);
        }

        if (completed && succeeded) {
            showToast('任務已完成！已發送通知', 'success');
            if (S.userProfile.enableConfetti !== false) triggerConfetti();
        }
        
        await refreshEnterpriseData(true);
        await refreshTeamNotifications(true);
    } finally {
        S.enterpriseToggleInFlight.delete(taskId);
    }
}

function getEnterprisePollInterval() {
    if (document.visibilityState !== 'visible') return C.ENTERPRISE_POLL_INTERVAL_MS * 4;
    if ($('team')?.classList.contains('active')) return C.ENTERPRISE_POLL_INTERVAL_MS;
    return C.ENTERPRISE_POLL_INTERVAL_MS * 2;
}

function startEnterprisePolling() {
    stopEnterprisePolling();
    if (!S.enterpriseSession) return;
    const tick = () => {
        if (document.visibilityState === 'visible') {
            refreshTeamNotifications();
            if ($('team')?.classList.contains('active')) {
                refreshEnterpriseData();
            }
        }
        S.enterprisePollTimer = setTimeout(tick, getEnterprisePollInterval());
    };
    S.enterprisePollTimer = setTimeout(tick, getEnterprisePollInterval());
}

document.addEventListener('visibilitychange', () => {
    if (S.enterpriseSession && !S.enterprisePollTimer) startEnterprisePolling();
});

function stopEnterprisePolling() {
    if (S.enterprisePollTimer) {
        clearTimeout(S.enterprisePollTimer);
        S.enterprisePollTimer = null;
    }
}

window.addEventListener('storage', (e) => {
    if (e.key === C.LOCAL_ENTERPRISE_KEY && S.enterpriseSession) {
        refreshTeamNotifications(true);
        if (document.getElementById('team')?.classList.contains('active')) {
            refreshEnterpriseData();
        }
    }
});

const PAGE_TITLES = {
    dashboard: '今日',
    decomposer: '目標分解',
    scheduler: '任務',
    coach: '行動教練',
    insights: '數據洞察',
    team: '團隊模式',
    guide: '使用指南',
    settings: '個人設定'
};

const MORE_SECTIONS = ['insights', 'team', 'guide', 'settings'];


const ONBOARDING_STEPS = [
    {
        title: '從大目標開始',
        desc: '有模糊的大目標？先到「任務」頁用目標分解器拆開，AI 會推薦你今日第一步。',
        icon: 'fa-wand-magic-sparkles',
        iconBg: 'bg-purple-500/15 text-purple-400',
        section: 'scheduler',
        highlight: null,
        onEnter: () => openDecomposeTab()
    },
    {
        title: '鎖定今日第一步',
        desc: '回到「今日」頁，你會看到系統推薦的今日第一步——今天只做最重要那一件。',
        icon: 'fa-forward-step',
        iconBg: 'bg-indigo-500/15 text-indigo-400',
        section: 'dashboard',
        highlight: 'next-step-card'
    },
    {
        title: '行動教練帶你做',
        desc: '卡住或拖延？點「教練」，它會讀取你的任務，告訴你怎麼開始——不是空泛聊天。',
        icon: 'fa-bolt',
        iconBg: 'bg-sky-500/15 text-sky-400',
        section: 'coach'
    }
];
