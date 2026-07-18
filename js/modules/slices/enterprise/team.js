/* Lumina: enterprise/team.js */
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

function renderMemberChip(member, opts = {}) {
    const isManager = member.role === 'manager';
    const colors = isManager
        ? 'bg-amber-500/20 text-amber-200 border-amber-500/30'
        : 'bg-indigo-500/20 text-indigo-200 border-indigo-500/30';
    const canKick = !!opts.canKick && member.id && member.id !== opts.selfId;
    return `
        <span class="member-chip">
            <span class="member-avatar ${colors} border">${escapeHtml(getMemberInitials(member.name))}</span>
            <span>${escapeHtml(member.name)}</span>
            ${isManager ? '<span class="text-[9px] text-amber-400/80 ml-0.5">主管</span>' : ''}
            ${canKick
                ? `<button type="button" class="member-kick-btn" title="移出群組"
                    data-lumina-action="kickEnterpriseMember" data-lumina-arg="${escapeHtml(member.id)}">
                    <i class="fa-solid fa-user-minus"></i>
                </button>`
                : ''}
        </span>
    `;
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

/* ── Multi-group memberships (local workspace list) ─────────────────── */

function enterpriseSessionKey() {
    return (typeof C !== 'undefined' && C.ENTERPRISE_SESSION_KEY) || 'lumina_enterprise_session';
}
function enterpriseMembershipsKey() {
    return (typeof C !== 'undefined' && C.ENTERPRISE_MEMBERSHIPS_KEY) || 'lumina_enterprise_memberships';
}

function normalizeEnterpriseMembership(m) {
    if (!m || typeof m !== 'object') return null;
    const groupCode = normalizeEnterpriseCode(m.groupCode || m.code || '');
    if (!groupCode) return null;
    return {
        memberId: m.memberId || m.id || '',
        name: String(m.name || '').trim() || '成員',
        role: m.role === 'manager' ? 'manager' : 'member',
        groupCode,
        groupName: String(m.groupName || groupCode).trim() || groupCode,
        offline: !!m.offline,
        joinedAt: m.joinedAt || new Date().toISOString()
    };
}

function ensureEnterpriseMembershipsLoaded() {
    if (!Array.isArray(S.enterpriseMemberships)) S.enterpriseMemberships = [];
    if (S.enterpriseMemberships.length) return S.enterpriseMemberships;
    try {
        const raw = JSON.parse(localStorage.getItem(enterpriseMembershipsKey()) || '[]');
        const list = (Array.isArray(raw) ? raw : []).map(normalizeEnterpriseMembership).filter(Boolean);
        const map = new Map();
        list.forEach((m) => map.set(m.groupCode, m));
        if (!map.size && S.enterpriseSession?.groupCode) {
            const cur = normalizeEnterpriseMembership(S.enterpriseSession);
            if (cur) map.set(cur.groupCode, cur);
        }
        S.enterpriseMemberships = [...map.values()];
    } catch (_) {
        S.enterpriseMemberships = S.enterpriseSession?.groupCode
            ? [normalizeEnterpriseMembership(S.enterpriseSession)].filter(Boolean)
            : [];
    }
    return S.enterpriseMemberships;
}

function saveEnterpriseMemberships() {
    ensureEnterpriseMembershipsLoaded();
    localStorage.setItem(enterpriseMembershipsKey(), JSON.stringify(S.enterpriseMemberships));
}

function upsertEnterpriseMembership(session) {
    const m = normalizeEnterpriseMembership(session);
    if (!m) return null;
    ensureEnterpriseMembershipsLoaded();
    const idx = S.enterpriseMemberships.findIndex((x) => x.groupCode === m.groupCode);
    if (idx >= 0) S.enterpriseMemberships[idx] = { ...S.enterpriseMemberships[idx], ...m };
    else S.enterpriseMemberships.push(m);
    saveEnterpriseMemberships();
    return m;
}

function setActiveEnterpriseSession(session) {
    const m = session ? normalizeEnterpriseMembership(session) : null;
    S.enterpriseSession = m;
    if (m) {
        localStorage.setItem(enterpriseSessionKey(), JSON.stringify(m));
        upsertEnterpriseMembership(m);
    } else {
        localStorage.removeItem(enterpriseSessionKey());
    }
    return m;
}

function clearActiveEnterpriseWorkspaceCaches() {
    S.enterpriseGroupData = null;
    S.enterpriseDataFetchedAt = 0;
    S.teamNotifications = [];
    S.teamNotificationsInitialized = false;
    try { S.knownTeamNotificationIds?.clear?.(); } catch (_) {}
    try { S.locallyReadNotificationIds?.clear?.(); } catch (_) {}
    S.teamWorkspaceTab = 'members';
    S.ragKbItemsById = {};
    S.ragSyncedGroupKey = null;
    S.docRagStatusOverrides = {};
    try { closeNotificationPanel?.(); } catch (_) {}
}

function openEnterpriseJoinForm() {
    S.enterpriseJoinFormOpen = true;
    renderEnterprisePage();
    setTimeout(() => {
        document.getElementById('team-onboarding')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        document.getElementById('team-join-code')?.focus();
    }, 80);
}

function closeEnterpriseJoinForm() {
    S.enterpriseJoinFormOpen = false;
    renderEnterprisePage();
}

async function selectEnterpriseGroup(groupCode) {
    const code = normalizeEnterpriseCode(groupCode);
    ensureEnterpriseMembershipsLoaded();
    const m = S.enterpriseMemberships.find((x) => x.groupCode === code);
    if (!m) {
        showToast('找不到該群組', 'error');
        return;
    }
    if (S.enterpriseSession?.groupCode === code) {
        S.enterpriseJoinFormOpen = false;
        renderEnterprisePage();
        showToast('目前已在此群組', 'success');
        return;
    }
    try { stopEnterprisePolling(); } catch (_) {}
    clearActiveEnterpriseWorkspaceCaches();
    setActiveEnterpriseSession(m);
    S.enterpriseJoinFormOpen = false;
    try { loadLocallyReadNotificationIds(); } catch (_) {}
    showToast(`已切換至 ${m.groupName || m.groupCode}`, 'success');
    await refreshEnterpriseData(true);
    renderEnterprisePage();
    try { startEnterprisePolling(); } catch (_) {}
    try { await refreshTeamNotifications(true); } catch (_) {}
    try { updateNotificationUI(); } catch (_) {}
}

function renderEnterpriseMembershipsPanel() {
    const el = document.getElementById('team-memberships');
    if (!el) return;
    ensureEnterpriseMembershipsLoaded();
    const list = S.enterpriseMemberships || [];
    if (!list.length) {
        el.classList.add('hidden');
        el.innerHTML = '';
        return;
    }
    el.classList.remove('hidden');
    const active = normalizeEnterpriseCode(S.enterpriseSession?.groupCode || '');
    el.innerHTML = `
        <div class="team-memberships-head">
            <div class="min-w-0">
                <div class="font-semibold text-sm text-slate-100">我的群組
                    <span class="text-slate-500 font-normal">（${list.length}）</span>
                </div>
                <div class="text-[11px] text-slate-500 mt-0.5">可同時加入多個群組；點「切換」辨識目前工作區，點「退出」移出本機清單</div>
            </div>
            <div class="flex flex-wrap gap-2">
                <button type="button" data-lumina-action="openEnterpriseJoinForm"
                    class="text-xs px-3 py-2 rounded-xl border border-indigo-500/40 text-indigo-300 hover:bg-indigo-500/10 transition-colors">
                    <i class="fa-solid fa-plus mr-1"></i>加入／建立其他
                </button>
            </div>
        </div>
        <div class="team-memberships-grid" role="list">
            ${list.map((m) => {
                const isActive = m.groupCode === active;
                const roleLabel = m.role === 'manager' ? '主管' : '成員';
                return `
                <div class="team-membership-card ${isActive ? 'is-active' : ''}" role="listitem">
                    <div class="min-w-0 flex-1">
                        <div class="font-medium text-sm text-slate-100 truncate" title="${escapeHtml(m.groupName || m.groupCode)}">${escapeHtml(m.groupName || m.groupCode)}</div>
                        <div class="flex flex-wrap items-center gap-1.5 mt-1.5">
                            <span class="team-membership-code">${escapeHtml(m.groupCode)}</span>
                            <span class="text-[10px] text-slate-500">${roleLabel}${m.offline ? ' · 離線' : ''}</span>
                            ${isActive ? '<span class="team-membership-active-pill">使用中</span>' : ''}
                        </div>
                    </div>
                    <div class="flex flex-col gap-1.5 flex-shrink-0">
                        ${isActive
                            ? ''
                            : `<button type="button" data-lumina-action="selectEnterpriseGroup" data-lumina-arg="${escapeHtml(m.groupCode)}"
                                class="text-[11px] px-2.5 py-1.5 rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white font-medium">切換</button>`}
                        <button type="button" data-lumina-action="leaveEnterpriseGroup" data-lumina-arg="${escapeHtml(m.groupCode)}"
                            class="text-[11px] px-2.5 py-1.5 rounded-lg border border-red-500/35 text-red-400 hover:bg-red-500/10">退出</button>
                    </div>
                </div>`;
            }).join('')}
        </div>`;
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
    
    clearActiveEnterpriseWorkspaceCaches();
    setActiveEnterpriseSession({
        memberId: result.member.id,
        name: result.member.name,
        role: result.member.role,
        groupCode: result.group.code,
        groupName: result.group.name,
        offline: !!api.offline
    });
    S.enterpriseJoinFormOpen = false;
    loadLocallyReadNotificationIds();
    showToast(`群組 ${result.group.code} 建立成功！已加入「我的群組」`, 'success');
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
    
    // Re-joining same code updates membership; switching if different
    const nextCode = normalizeEnterpriseCode(result.group.code);
    const switching = S.enterpriseSession?.groupCode && S.enterpriseSession.groupCode !== nextCode;
    if (switching) {
        try { stopEnterprisePolling(); } catch (_) {}
        clearActiveEnterpriseWorkspaceCaches();
    }
    setActiveEnterpriseSession({
        memberId: result.member.id,
        name: result.member.name,
        role: result.member.role,
        groupCode: result.group.code,
        groupName: result.group.name,
        offline: !!api.offline
    });
    S.enterpriseJoinFormOpen = false;
    loadLocallyReadNotificationIds();
    showToast(`已加入 ${result.group.name}（${result.group.code}）`, 'success');
    await refreshEnterpriseData(true);
    renderEnterprisePage();
    startEnterprisePolling();
    await refreshTeamNotifications(true);
}

/**
 * Apply local leave after server (or offline) success.
 */
function applyLocalLeaveMembership(code) {
    ensureEnterpriseMembershipsLoaded();
    S.enterpriseMemberships = S.enterpriseMemberships.filter((m) => m.groupCode !== code);
    saveEnterpriseMemberships();

    const leavingActive = normalizeEnterpriseCode(S.enterpriseSession?.groupCode || '') === code;
    if (!leavingActive) {
        renderEnterprisePage();
        return;
    }
    try { stopEnterprisePolling(); } catch (_) {}
    clearActiveEnterpriseWorkspaceCaches();
    const next = S.enterpriseMemberships[0] || null;
    setActiveEnterpriseSession(next);
    S.enterpriseJoinFormOpen = false;
    if (next) {
        try { loadLocallyReadNotificationIds(); } catch (_) {}
        refreshEnterpriseData(true).then(() => {
            renderEnterprisePage();
            try { startEnterprisePolling(); } catch (_) {}
            try { refreshTeamNotifications(true); } catch (_) {}
            try { updateNotificationUI(); } catch (_) {}
        }).catch(() => renderEnterprisePage());
    } else {
        setActiveEnterpriseSession(null);
        renderEnterprisePage();
        try { updateNotificationUI(); } catch (_) {}
    }
}

/**
 * Leave one membership (by code) or the active group.
 * Always stops polling first (avoids 429 blocking leave). Server leave preferred;
 * on rate-limit / network error still clears local session so UI recovers.
 */
async function leaveEnterpriseGroup(groupCode) {
    if (S._leaveGroupInFlight) {
        showToast('退出處理中…', 'error');
        return;
    }
    ensureEnterpriseMembershipsLoaded();
    const code = normalizeEnterpriseCode(groupCode || S.enterpriseSession?.groupCode || '');
    if (!code) {
        showToast('沒有可離開的群組', 'error');
        return;
    }
    const target = S.enterpriseMemberships.find((m) => m.groupCode === code)
        || (normalizeEnterpriseCode(S.enterpriseSession?.groupCode || '') === code ? S.enterpriseSession : null);
    const label = target?.groupName || code;
    let memberId = target?.memberId
        || (normalizeEnterpriseCode(S.enterpriseSession?.groupCode || '') === code ? S.enterpriseSession.memberId : null);
    if (!confirm(`確定退出群組「${label}」？\n代碼：${code}\n（若你是唯一主管，系統會自動將主管權交給其他成員）`)) return;

    S._leaveGroupInFlight = true;
    // Stop request storm before leave API
    try { stopEnterprisePolling(); } catch (_) {}
    try { stopRagStatusPolling?.(); } catch (_) {}

    try {
        const useServer = isLoggedIn() && !(target?.offline === true && !navigator.onLine);
        if (useServer) {
            // Prefer server-resolved member when local id is stale
            if (!memberId && S.enterpriseSession?.memberId) memberId = S.enterpriseSession.memberId;
            const api = await enterpriseFetch('POST', '/api/enterprise/group/leave', {
                groupCode: code,
                memberId: memberId || ''
            });
            if (api.ok) {
                applyLocalLeaveMembership(code);
                const promo = api.data?.promoted?.name;
                showToast(
                    promo
                        ? `已退出 ${code}（主管已交接給 ${promo}）`
                        : `已正式退出群組 ${code}`,
                    'success'
                );
                return;
            }
            // 429 / 5xx: still leave locally so UI unsticks; user can re-sync later
            if (api.status === 429 || api.offline) {
                applyLocalLeaveMembership(code);
                showToast(`已退出本機群組 ${code}（伺服器忙碌或離線，稍後會自動同步）`, 'success');
                return;
            }
            if (api.code === 'NOT_A_MEMBER' || api.code === 'GROUP_FORBIDDEN' || api.status === 403 || api.status === 404) {
                // Already not a member on server — just clean local
                applyLocalLeaveMembership(code);
                showToast(`已清除本機群組 ${code}`, 'success');
                return;
            }
            showToast(api.error || '退出失敗', 'error');
            // Restart poll if still in a group
            if (S.enterpriseSession) {
                try { startEnterprisePolling(); } catch (_) {}
            }
            return;
        }

        // Offline / guest local leave
        try {
            const store = loadLocalEnterpriseStore();
            const group = store.groups[code];
            if (group && memberId) {
                group.members = (group.members || []).filter((m) => m.id !== memberId);
                saveLocalEnterpriseStore(store);
            }
        } catch (_) {}
        applyLocalLeaveMembership(code);
        showToast(`已退出群組 ${code}`, 'success');
    } finally {
        S._leaveGroupInFlight = false;
    }
}

/**
 * Manager kicks a member from the active group (server-side).
 */
async function kickEnterpriseMember(targetMemberId) {
    if (!S.enterpriseSession || S.enterpriseSession.role !== 'manager') {
        showToast('僅主管可移除成員', 'error');
        return;
    }
    if (!targetMemberId || targetMemberId === S.enterpriseSession.memberId) {
        showToast('請使用「退出此組」離開自己', 'error');
        return;
    }
    const target = (S.enterpriseGroupData?.members || []).find((m) => m.id === targetMemberId);
    const name = target?.name || '該成員';
    if (!confirm(`確定將「${name}」移出群組 ${S.enterpriseSession.groupCode}？`)) return;

    if (S.enterpriseSession.offline) {
        try {
            const store = loadLocalEnterpriseStore();
            const group = store.groups[normalizeEnterpriseCode(S.enterpriseSession.groupCode)];
            if (group) {
                group.members = (group.members || []).filter((m) => m.id !== targetMemberId);
                saveLocalEnterpriseStore(store);
            }
            await refreshEnterpriseData(true);
            renderEnterprisePage();
            showToast(`已移出 ${name}（離線本機）`, 'success');
        } catch (e) {
            showToast(e.message || '移出失敗', 'error');
        }
        return;
    }

    const api = await enterpriseFetch('POST', '/api/enterprise/group/kick', {
        groupCode: S.enterpriseSession.groupCode,
        managerId: S.enterpriseSession.memberId,
        targetMemberId
    });
    if (!api.ok) {
        showToast(api.error || '移出失敗', 'error');
        return;
    }
    showToast(`已移出 ${name}`, 'success');
    await refreshEnterpriseData(true);
    renderEnterprisePage();
}

/**
 * Pull server memberships for the logged-in user and merge into local multi-group list.
 */
async function syncEnterpriseMembershipsFromServer(options = {}) {
    if (!isLoggedIn()) return { ok: false, reason: 'not_logged_in' };
    const api = await enterpriseFetch('GET', '/api/enterprise/memberships');
    if (!api.ok) {
        if (!api.offline) console.warn('[Lumina] memberships sync failed', api.error);
        return { ok: false, offline: !!api.offline, error: api.error };
    }
    const remote = Array.isArray(api.data?.memberships) ? api.data.memberships : [];
    ensureEnterpriseMembershipsLoaded();
    const byCode = new Map();
    remote.forEach((m) => {
        const code = normalizeEnterpriseCode(m.groupCode);
        if (!code) return;
        byCode.set(code, {
            memberId: m.memberId,
            name: m.name,
            role: m.role === 'manager' ? 'manager' : 'member',
            groupCode: code,
            groupName: m.groupName || code,
            offline: false,
            joinedAt: m.joinedAt || null
        });
    });
    // Keep pure offline-local memberships not present on server
    const offlineLocals = (S.enterpriseMemberships || []).filter(
        (m) => m.offline && !byCode.has(normalizeEnterpriseCode(m.groupCode))
    );
    S.enterpriseMemberships = [...byCode.values(), ...offlineLocals];
    saveEnterpriseMemberships();

    const activeCode = normalizeEnterpriseCode(S.enterpriseSession?.groupCode || '');
    if (activeCode && byCode.has(activeCode)) {
        setActiveEnterpriseSession({ ...S.enterpriseSession, ...byCode.get(activeCode) });
    } else if (activeCode && !byCode.has(activeCode) && !offlineLocals.some((m) => m.groupCode === activeCode)) {
        // Kicked / left on another device
        try { stopEnterprisePolling(); } catch (_) {}
        clearActiveEnterpriseWorkspaceCaches();
        const next = S.enterpriseMemberships[0] || null;
        setActiveEnterpriseSession(next);
        if (options.toast !== false) {
            showToast(next
                ? `帳號已不在 ${activeCode}，已切換至 ${next.groupName || next.groupCode}`
                : `帳號已不在群組 ${activeCode}`, 'success');
        }
        if (next) {
            try { loadLocallyReadNotificationIds(); } catch (_) {}
            try { await refreshEnterpriseData(true); } catch (_) {}
            try { startEnterprisePolling(); } catch (_) {}
            try { await refreshTeamNotifications(true); } catch (_) {}
        }
    } else if (!activeCode && S.enterpriseMemberships.length && options.autoSelect !== false) {
        setActiveEnterpriseSession(S.enterpriseMemberships[0]);
        try { loadLocallyReadNotificationIds(); } catch (_) {}
        try { await refreshEnterpriseData(true); } catch (_) {}
        try { startEnterprisePolling(); } catch (_) {}
    }

    if (options.render !== false) {
        try { renderEnterprisePage(); } catch (_) {}
        try { updateNotificationUI(); } catch (_) {}
    }
    return { ok: true, memberships: S.enterpriseMemberships };
}

/**
 * Team workspace primary tabs: members | knowledge (not main nav).
 */
function onTeamGroupSwitcherChange(el) {
    const code = el?.value || document.getElementById('team-group-switcher')?.value;
    if (code) selectEnterpriseGroup(code);
}

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

/**
 * Align active session memberId/role with server-resolved membership.
 */
function applyResolvedEnterpriseMember(member, groupMeta) {
    if (!member?.id || !S.enterpriseSession) return;
    const patch = {
        ...S.enterpriseSession,
        memberId: member.id,
        name: member.name || S.enterpriseSession.name,
        role: member.role === 'manager' ? 'manager' : (member.role || S.enterpriseSession.role),
        offline: false
    };
    if (groupMeta?.name) patch.groupName = groupMeta.name;
    if (groupMeta?.code) patch.groupCode = normalizeEnterpriseCode(groupMeta.code);
    setActiveEnterpriseSession(patch);
}

async function refreshEnterpriseData(force = false) {
    if (!S.enterpriseSession) return;
    // Coalesce concurrent refreshes (poll + UI + recovery)
    if (S._refreshEnterpriseInFlight) {
        if (force) S._refreshEnterprisePendingForce = true;
        return S._refreshEnterpriseInFlight;
    }

    const run = (async () => {
    const now = Date.now();
    const ttl = (typeof C !== 'undefined' && C.ENTERPRISE_FETCH_TTL_MS) || 5000;
    if (!force && S.enterpriseGroupData && (now - S.enterpriseDataFetchedAt) < ttl) {
        renderEnterpriseTasks();
        return;
    }

    // Back off when rate-limited
    if (S._enterpriseRateLimitedUntil && Date.now() < S._enterpriseRateLimitedUntil) {
        return;
    }
    
    const code = S.enterpriseSession.groupCode;
    const memberQ = `?memberId=${encodeURIComponent(S.enterpriseSession.memberId || '')}`;
    let api = await enterpriseFetch('GET', `/api/enterprise/group/${code}${memberQ}`);

    if (api.status === 429) {
        S._enterpriseRateLimitedUntil = Date.now() + 20000;
        return;
    }

    // Recover stale local memberId via account memberships, then retry once
    if (!api.ok && !api.offline && (api.status === 403 || api.status === 401
        || api.code === 'GROUP_FORBIDDEN' || api.code === 'NOT_A_MEMBER' || api.code === 'MEMBER_BOUND_OTHER')) {
        // Only one recovery attempt per 30s to avoid loops
        if (!S._membershipRecoverAt || Date.now() - S._membershipRecoverAt > 30000) {
            S._membershipRecoverAt = Date.now();
            try {
                await syncEnterpriseMembershipsFromServer({ toast: false, render: false, autoSelect: false });
            } catch (_) {}
        }
        const fixed = (S.enterpriseMemberships || []).find(
            (m) => normalizeEnterpriseCode(m.groupCode) === normalizeEnterpriseCode(code)
        );
        if (fixed) {
            setActiveEnterpriseSession(fixed);
            const q2 = `?memberId=${encodeURIComponent(fixed.memberId || '')}`;
            api = await enterpriseFetch('GET', `/api/enterprise/group/${code}${q2}`);
            if (api.status === 429) {
                S._enterpriseRateLimitedUntil = Date.now() + 20000;
                return;
            }
        } else {
            // Not a server member anymore — drop stale local entry
            ensureEnterpriseMembershipsLoaded();
            S.enterpriseMemberships = (S.enterpriseMemberships || []).filter(
                (m) => normalizeEnterpriseCode(m.groupCode) !== normalizeEnterpriseCode(code)
            );
            saveEnterpriseMemberships();
            if (normalizeEnterpriseCode(S.enterpriseSession?.groupCode) === normalizeEnterpriseCode(code)) {
                try { stopEnterprisePolling(); } catch (_) {}
                clearActiveEnterpriseWorkspaceCaches();
                const next = S.enterpriseMemberships[0] || null;
                setActiveEnterpriseSession(next);
                showToast(api.error || '群組成員資格已失效，請重新加入', 'error');
                renderEnterprisePage();
                if (next) {
                    try { startEnterprisePolling(); } catch (_) {}
                }
            }
            return;
        }
    }
    
    if (api.ok) {
        // Server may return resolved member (corrects stale local memberId)
        if (api.data?.member?.id) {
            applyResolvedEnterpriseMember(api.data.member, api.data.group || { code, name: api.data.group?.name });
        }
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
        // Throttle RAG ensure — not on every poll tick
        if (!S._ensureDocsAt || Date.now() - S._ensureDocsAt > 60000) {
            S._ensureDocsAt = Date.now();
            ensureEnterpriseDocsInRag();
        }
    }
    })();

    S._refreshEnterpriseInFlight = run.finally(() => {
        S._refreshEnterpriseInFlight = null;
        if (S._refreshEnterprisePendingForce) {
            S._refreshEnterprisePendingForce = false;
            refreshEnterpriseData(true);
        }
    });
    return S._refreshEnterpriseInFlight;
}

function renderEnterprisePage() {
    const onboarding = document.getElementById('team-onboarding');
    const workspace = document.getElementById('team-workspace');
    const badge = document.getElementById('team-status-badge');
    const apiHint = document.getElementById('team-api-hint');
    const tabs = document.getElementById('team-workspace-tabs');
    const joinFormBar = document.getElementById('team-join-form-bar');

    ensureEnterpriseMembershipsLoaded();
    // Soft refresh memberships at most every 60s (avoid request storms)
    if (isLoggedIn() && !S._membershipSyncInFlight) {
        const now = Date.now();
        if (!S._membershipSyncAt || now - S._membershipSyncAt > 60000) {
            S._membershipSyncInFlight = true;
            S._membershipSyncAt = now;
            Promise.resolve()
                .then(() => syncEnterpriseMembershipsFromServer({ toast: false, render: false, autoSelect: false }))
                .then(() => {
                    renderEnterpriseMembershipsPanel();
                    try {
                        const memCount = (S.enterpriseMemberships || []).length;
                        const b = document.getElementById('team-status-badge');
                        if (b && S.enterpriseSession) {
                            const role = S.enterpriseSession.role === 'manager' ? '主管' : '成員';
                            b.textContent = memCount > 1
                                ? `${S.enterpriseSession.groupCode} · ${role} · 共 ${memCount} 組`
                                : `${S.enterpriseSession.groupCode} · ${role}`;
                        }
                    } catch (_) {}
                })
                .catch(() => {})
                .finally(() => { S._membershipSyncInFlight = false; });
        }
    }
    renderEnterpriseMembershipsPanel();

    const hasSession = !!S.enterpriseSession?.groupCode;
    const showJoinForm = !hasSession || !!S.enterpriseJoinFormOpen;
    const memCount = (S.enterpriseMemberships || []).length;

    // Join/create forms: when no group, or user asked to add another
    onboarding?.classList.toggle('hidden', !showJoinForm);
    joinFormBar?.classList.toggle('hidden', !(showJoinForm && hasSession));
    apiHint?.classList.toggle('hidden', hasSession && !S.enterpriseJoinFormOpen);

    if (!hasSession) {
        workspace?.classList.add('hidden');
        tabs?.classList.add('hidden');
        if (badge) {
            badge.textContent = memCount ? `${memCount} 個群組（請選擇）` : '未加入群組';
            badge.className = 'self-start sm:self-auto text-xs px-4 py-2 rounded-full bg-slate-800/80 text-slate-400 border border-slate-700/60';
        }
        document.getElementById('team-stats-row')?.classList.add('hidden');
        return;
    }

    workspace?.classList.remove('hidden');
    tabs?.classList.remove('hidden');

    const offlineBanner = document.getElementById('team-offline-banner');
    if (offlineBanner) {
        offlineBanner.classList.toggle('hidden', !S.enterpriseSession.offline);
    }

    // Sync membership label if group name refreshed from server
    if (S.enterpriseGroupData?.name && S.enterpriseSession.groupName !== S.enterpriseGroupData.name) {
        S.enterpriseSession.groupName = S.enterpriseGroupData.name;
        setActiveEnterpriseSession(S.enterpriseSession);
    }

    setElText('team-group-name', S.enterpriseSession.groupName);
    setElText('team-group-code', S.enterpriseSession.groupCode);
    setElText('team-user-name', S.enterpriseSession.name);
    setElText('team-user-role', S.enterpriseSession.role === 'manager' ? '主管' : '成員');

    // Group switcher select
    const switcher = document.getElementById('team-group-switcher');
    if (switcher) {
        const active = S.enterpriseSession.groupCode;
        switcher.innerHTML = (S.enterpriseMemberships || []).map((m) =>
            `<option value="${escapeHtml(m.groupCode)}" ${m.groupCode === active ? 'selected' : ''}>${escapeHtml(m.groupName || m.groupCode)}（${escapeHtml(m.groupCode)}）</option>`
        ).join('');
        switcher.classList.toggle('hidden', (S.enterpriseMemberships || []).length < 2);
    }
    const switcherWrap = document.getElementById('team-group-switcher-wrap');
    if (switcherWrap) {
        switcherWrap.classList.toggle('hidden', (S.enterpriseMemberships || []).length < 2);
    }

    if (badge) {
        const role = S.enterpriseSession.role === 'manager' ? '主管' : '成員';
        badge.textContent = memCount > 1
            ? `${S.enterpriseSession.groupCode} · ${role} · 共 ${memCount} 組`
            : `${S.enterpriseSession.groupCode} · ${role}`;
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
        const canKick = S.enterpriseSession.role === 'manager';
        const selfId = S.enterpriseSession.memberId;
        membersEl.innerHTML = members.length
            ? members.map(m => renderMemberChip(m, { canKick, selfId })).join('')
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
        // Preserve current KB/doc selection when re-rendering
        const prevKb = typeof readKbBindPicker === 'function' ? readKbBindPicker('team-assign-kb') : [];
        const prevDoc = typeof readDocBindPicker === 'function' ? readDocBindPicker('team-assign-doc') : [];
        populateTeamAssignKbPicker(prevKb, prevDoc);
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
            overviewBody.innerHTML = overviewTasks.map(t => {
                const kbBadge = typeof renderTaskKbBadges === 'function' ? renderTaskKbBadges(t) : '';
                return `
                <tr>
                    <td class="px-4 py-3 font-medium">
                        <div>${escapeHtml(t.title)}</div>
                        ${kbBadge ? `<div class="mt-1">${kbBadge}</div>` : ''}
                    </td>
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
            `;
            }).join('');
        }
    }
    renderEnterpriseDocuments();
}

function populateTeamAssignKbPicker(selectedKbIds, selectedDocIds) {
    const kbIds = selectedKbIds || [];
    if (typeof renderKbBindPicker === 'function') {
        renderKbBindPicker('team-assign-kb-list', kbIds, 'team-assign-kb');
    }
    if (typeof renderDocBindPicker === 'function') {
        renderDocBindPicker(
            'team-assign-doc-list',
            selectedDocIds || [],
            'team-assign-doc',
            kbIds
        );
    }
}

function renderEnterpriseTaskRow(task, canToggle, syncedIds) {
    const synced = syncedIds ? syncedIds.has(task.id) : buildSyncedEnterpriseIdSet().has(task.id);
    const kbBadge = typeof renderTaskKbBadges === 'function' ? renderTaskKbBadges(task) : '';
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
                    ${kbBadge ? `<span>·</span>${kbBadge}` : ''}
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
    
    const kbIds = typeof readKbBindPicker === 'function'
        ? readKbBindPicker('team-assign-kb')
        : [];
    const docIds = typeof readDocBindPicker === 'function'
        ? readDocBindPicker('team-assign-doc')
        : [];

    const payload = {
        groupCode: S.enterpriseSession.groupCode,
        managerId: S.enterpriseSession.memberId,
        assigneeId,
        title,
        due: document.getElementById('team-assign-due').value || getTodayISO(),
        duration: parseInt(document.getElementById('team-assign-duration').value) || 30,
        category: document.getElementById('team-assign-category').value,
        energy: 3,
        kbIds,
        docIds
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
            kbIds: Array.isArray(payload.kbIds) ? payload.kbIds : [],
            docIds: Array.isArray(payload.docIds) ? payload.docIds : [],
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
    // keep assignee + category for bulk assign convenience; reset KB/doc binds
    populateTeamAssignKbPicker([], []);
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
    const base = (typeof C !== 'undefined' && C.ENTERPRISE_POLL_INTERVAL_MS) || 15000;
    const safe = Math.max(10000, Number(base) || 15000);
    if (document.visibilityState !== 'visible') return safe * 4;
    if ($('team')?.classList.contains('active')) return safe;
    return safe * 2;
}

function startEnterprisePolling() {
    stopEnterprisePolling();
    if (!S.enterpriseSession) return;
    const gen = S._enterprisePollGen || 0;
    const tick = async () => {
        if ((S._enterprisePollGen || 0) !== gen) return;
        if (!S.enterpriseSession) return;
        try {
            if (document.visibilityState === 'visible') {
                // Serialize + skip if previous tick still running (prevents request storms)
                if (!S._enterprisePollTickBusy) {
                    S._enterprisePollTickBusy = true;
                    try {
                        await refreshTeamNotifications();
                        if ($('team')?.classList.contains('active')) {
                            await refreshEnterpriseData(false);
                        }
                    } finally {
                        S._enterprisePollTickBusy = false;
                    }
                }
            }
        } catch (e) {
            S._enterprisePollTickBusy = false;
            console.warn('[Lumina] enterprise poll tick', e);
        }
        if ((S._enterprisePollGen || 0) !== gen) return;
        S.enterprisePollTimer = setTimeout(tick, getEnterprisePollInterval());
    };
    S.enterprisePollTimer = setTimeout(tick, getEnterprisePollInterval());
}

// Register global listeners once (chunk may re-eval in some builds)
if (!window.__luminaEnterprisePollListenersBound) {
    window.__luminaEnterprisePollListenersBound = true;
    document.addEventListener('visibilitychange', () => {
        if (S.enterpriseSession && !S.enterprisePollTimer) startEnterprisePolling();
    });
    window.addEventListener('storage', (e) => {
        const key = (typeof C !== 'undefined' && C.LOCAL_ENTERPRISE_KEY) || 'lumina_enterprise_local_store';
        if (e.key === key && S.enterpriseSession) {
            refreshTeamNotifications(true);
            if (document.getElementById('team')?.classList.contains('active')) {
                refreshEnterpriseData();
            }
        }
    });
}
