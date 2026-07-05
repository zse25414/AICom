/* Lumina: auth/index.js */
function clearSensitiveLocalData() {
    const preserved = {};
    for (const key of ['lumina_profile', C.AUTH_SESSION_KEY, C.AUTH_USERS_KEY]) {
        const val = localStorage.getItem(key);
        if (val) preserved[key] = val;
    }
    const apiKey = sessionStorage.getItem(C.API_KEY_STORAGE);
    localStorage.clear();
    Object.entries(preserved).forEach(([k, v]) => localStorage.setItem(k, v));
    if (apiKey) sessionStorage.setItem(C.API_KEY_STORAGE, apiKey);
}

async function hashPin(pin) {
    const str = 'lumina-pin:v1:' + String(pin);
    if (crypto?.subtle?.digest) {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
        return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
}

async function hashPassword(password) {
    const str = 'lumina-auth:v1:' + String(password);
    if (crypto?.subtle?.digest) {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
        return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
}

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getAuthBaseUrl() {
    return getEnterpriseBaseUrl();
}

function getAuthHeaders(includeJson = true) {
    const headers = {};
    if (includeJson) headers['Content-Type'] = 'application/json';
    try {
        const session = JSON.parse(localStorage.getItem(C.AUTH_SESSION_KEY) || 'null');
        if (session?.token) headers.Authorization = `Bearer ${session.token}`;
    } catch (_) {}
    return headers;
}

async function authApiRequest(path, options = {}) {
    const res = await fetch(getAuthBaseUrl() + path, {
        ...options,
        headers: {
            ...getAuthHeaders(options.body !== undefined),
            ...(options.headers || {})
        }
    });
    let data = {};
    try {
        data = await res.json();
    } catch (_) {}
    if (!res.ok) {
        const err = new Error(data.error || '請求失敗');
        err.status = res.status;
        throw err;
    }
    return data;
}

function getAuthSession() {
    try {
        const session = JSON.parse(localStorage.getItem(C.AUTH_SESSION_KEY) || 'null');
        if (!session?.email) return null;
        if (session.token && session.user?.id) {
            if (session.userId && session.user.id !== session.userId) return null;
            return { session, user: session.user };
        }
        return null;
    } catch (_) {
        return null;
    }
}

function isLoggedIn() {
    return !!getAuthSession();
}

function needsAuthGate() {
    if (localStorage.getItem(C.AUTH_GUEST_DISMISSED_KEY)) return false;
    return !getAuthSession()?.session?.token;
}

function persistAuthSession(user, token) {
    localStorage.setItem(C.AUTH_SESSION_KEY, JSON.stringify({
        token,
        userId: user.id,
        email: user.email,
        user: {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role || '知識工作者',
            createdAt: user.createdAt
        },
        loggedInAt: new Date().toISOString()
    }));
    localStorage.removeItem(C.AUTH_USERS_KEY);
}

function applyAuthUserToProfile(user, isNew = false) {
    S.userProfile.name = user.name;
    S.userProfile.role = user.role || '知識工作者';
    if (isNew && S.tasks.length === 0 && !Object.keys(S.dailyHistory).length) {
        S.userProfile.streak = 0;
        S.userProfile.bestStreak = 0;
        S.userProfile.joinDay = 1;
    }
    persistProfile();
}

function clearAuthErrors() {
    setElText('auth-register-error', '');
    setElText('auth-login-error', '');
}

function showAuthOverlay(tab = 'register') {
    const overlay = document.getElementById('auth-overlay');
    if (!overlay) return;
    clearAuthErrors();
    switchAuthTab(tab);
    overlay.classList.remove('hidden');
    const focusId = tab === 'login' ? 'auth-login-email' : 'auth-reg-name';
    setTimeout(() => document.getElementById(focusId)?.focus(), 80);
}

function hideAuthOverlay() {
    document.getElementById('auth-overlay')?.classList.add('hidden');
    clearAuthErrors();
}

function switchAuthTab(tab) {
    const isLogin = tab === 'login';
    document.getElementById('auth-tab-login')?.classList.toggle('active', isLogin);
    document.getElementById('auth-tab-register')?.classList.toggle('active', !isLogin);
    document.getElementById('auth-tab-login')?.setAttribute('aria-selected', String(isLogin));
    document.getElementById('auth-tab-register')?.setAttribute('aria-selected', String(!isLogin));
    document.getElementById('auth-login-form')?.classList.toggle('active', isLogin);
    document.getElementById('auth-register-form')?.classList.toggle('active', !isLogin);
    clearAuthErrors();
}

function updateAuthUI() {
    const loggedIn = isLoggedIn();
    const auth = getAuthSession();
    document.getElementById('settings-account-logged-in')?.classList.toggle('hidden', !loggedIn);
    document.getElementById('settings-account-guest')?.classList.toggle('hidden', loggedIn);
    if (loggedIn && auth) {
        setElText('settings-account-name', auth.user.name);
        setElText('settings-account-email', auth.user.email);
        const avatar = document.getElementById('settings-account-avatar');
        if (avatar) avatar.innerText = getInitials(auth.user.name);
    }
}

function buildUserDataPayload() {
    return {
        tasks: S.tasks,
        profile: S.userProfile,
        dailyHistory: S.dailyHistory,
        trackedFocusByDay: S.trackedFocusByDay,
        weeklyScores: S.weeklyScores,
        updatedAt: new Date().toISOString()
    };
}

function applyUserDataFromServer(data) {
    if (!data) return;
    if (Array.isArray(data.tasks)) {
        S.tasks = data.tasks;
        localStorage.setItem('lumina_tasks', JSON.stringify(S.tasks));
        migrateTasks();
    }
    if (data.profile && typeof data.profile === 'object') {
        S.userProfile = { ...S.userProfile, ...data.profile };
        persistProfile();
    }
    if (data.dailyHistory && typeof data.dailyHistory === 'object') {
        S.dailyHistory = data.dailyHistory;
        saveDailyHistory();
    }
    if (data.trackedFocusByDay && typeof data.trackedFocusByDay === 'object') {
        S.trackedFocusByDay = { ...S.trackedFocusByDay, ...data.trackedFocusByDay };
        saveTrackedFocus();
    }
    if (Array.isArray(data.weeklyScores) && data.weeklyScores.length === 7) {
        S.weeklyScores = data.weeklyScores;
        localStorage.setItem('lumina_weekly', JSON.stringify(S.weeklyScores));
    }
    invalidateTodayStats();
}

async function syncUserDataToServer(options = {}) {
    const auth = getAuthSession();
    if (!auth?.session?.token) return;
    const run = async () => {
        try {
            await authApiRequest('/api/user/data', {
                method: 'PATCH',
                body: JSON.stringify(buildUserDataPayload())
            });
        } catch (e) {
            console.warn('[Lumina] 個人資料同步失敗:', e.message);
        }
    };
    if (options.immediate) return run();
    clearTimeout(S.userDataSyncTimer);
    S.userDataSyncTimer = setTimeout(run, C.USER_DATA_SYNC_DELAY_MS);
}

async function loadUserDataFromServer() {
    const auth = getAuthSession();
    if (!auth?.session?.token) return;
    try {
        const res = await authApiRequest('/api/user/data', { method: 'GET' });
        const serverData = res.data || {};
        let localTasks = [];
        try {
            localTasks = JSON.parse(localStorage.getItem('lumina_tasks') || '[]');
        } catch (_) {}
        const hasLocal = Array.isArray(localTasks) && localTasks.length > 0;
        const hasServer = Array.isArray(serverData?.tasks) && serverData.tasks.length > 0;

        if (hasServer && hasLocal) {
            applyUserDataFromServer({
                ...serverData,
                tasks: mergeTasksArrays(serverData.tasks, localTasks),
                dailyHistory: { ...(serverData.dailyHistory || {}), ...S.dailyHistory },
                trackedFocusByDay: { ...(serverData.trackedFocusByDay || {}), ...S.trackedFocusByDay }
            });
            await syncUserDataToServer({ immediate: true });
        } else if (hasServer) {
            applyUserDataFromServer(serverData);
        } else if (hasLocal || Object.keys(S.trackedFocusByDay).length) {
            await syncUserDataToServer({ immediate: true });
        }
    } catch (e) {
        console.warn('[Lumina] 個人資料雲端載入失敗:', e.message);
    }
}

async function finishAuth(user, isNew, token) {
    const hadLocalData = S.tasks.length > 0 || Object.keys(S.dailyHistory).length > 0;
    persistAuthSession(user, token);
    applyAuthUserToProfile(user, isNew);
    if (isNew && !hadLocalData) {
        localStorage.removeItem('lumina_onboarding_v2');
        localStorage.removeItem('lumina_welcomed');
    }
    await loadUserDataFromServer();
    hideAuthOverlay();
    localStorage.setItem(C.AUTH_GUEST_DISMISSED_KEY, 'true');
    updateAuthUI();
    refreshUI({ dashboard: true, filters: true });
    const welcomeMsg = isNew
        ? (hadLocalData ? `歡迎加入，${user.name}！已合併訪客期間的資料` : `歡迎加入，${user.name}！`)
        : `歡迎回來，${user.name}！`;
    showToast(welcomeMsg, 'success');
    if (isNew && !hadLocalData && S.tasks.length === 0) {
        setTimeout(() => startOnboarding(), 600);
    }
}

async function handleRegister(e) {
    e.preventDefault();
    clearAuthErrors();
    
    const name = clampText(document.getElementById('auth-reg-name')?.value, 40);
    const email = normalizeEmail(document.getElementById('auth-reg-email')?.value);
    const role = clampText(document.getElementById('auth-reg-role')?.value, 40) || '知識工作者';
    const password = document.getElementById('auth-reg-password')?.value || '';
    const confirm = document.getElementById('auth-reg-password-confirm')?.value || '';
    const errEl = document.getElementById('auth-register-error');
    const btn = document.getElementById('auth-register-btn');
    
    if (!name) {
        if (errEl) errEl.textContent = '請輸入顯示名稱';
        return;
    }
    if (!isValidEmail(email)) {
        if (errEl) errEl.textContent = '請輸入有效的電子郵件';
        return;
    }
    if (password.length < 6) {
        if (errEl) errEl.textContent = '密碼至少需要 6 個字元';
        return;
    }
    if (password !== confirm) {
        if (errEl) errEl.textContent = '兩次輸入的密碼不一致';
        return;
    }
    
    if (btn) btn.disabled = true;
    try {
        const data = await authApiRequest('/api/auth/register', {
            method: 'POST',
            body: JSON.stringify({ name, email, role, password })
        });
        finishAuth(data.user, true, data.token);
    } catch (err) {
        if (err.status === 409) {
            if (errEl) errEl.textContent = err.message || '此電子郵件已註冊，請直接登入';
            switchAuthTab('login');
            document.getElementById('auth-login-email').value = email;
            return;
        }
        if (errEl) errEl.textContent = err.message || '註冊失敗，請確認 API 服務已啟動';
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function handleLogin(e) {
    e.preventDefault();
    clearAuthErrors();
    
    const email = normalizeEmail(document.getElementById('auth-login-email')?.value);
    const password = document.getElementById('auth-login-password')?.value || '';
    const errEl = document.getElementById('auth-login-error');
    const btn = document.getElementById('auth-login-btn');
    
    if (!isValidEmail(email)) {
        if (errEl) errEl.textContent = '請輸入有效的電子郵件';
        return;
    }
    if (!password) {
        if (errEl) errEl.textContent = '請輸入密碼';
        return;
    }
    
    if (btn) btn.disabled = true;
    try {
        const data = await authApiRequest('/api/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email, password })
        });
        finishAuth(data.user, false, data.token);
    } catch (err) {
        if (errEl) errEl.textContent = err.message || '登入失敗，請確認 API 服務已啟動';
    } finally {
        if (btn) btn.disabled = false;
    }
}

async function handleLogout() {
    if (!isLoggedIn()) return;
    if (!confirm('確定要登出嗎？你的任務與設定仍會保留在本機。')) return;
    try {
        await syncUserDataToServer({ immediate: true });
    } catch (_) {}
    localStorage.removeItem(C.AUTH_SESSION_KEY);
    hideAuthOverlay();
    updateAuthUI();
    showToast('已登出', 'success');
    showAuthOverlay('login');
}

function openUserMenu() {
    if (isLoggedIn()) {
        showSection('settings');
        return;
    }
    showAuthOverlay('login');
}

function dismissAuthAsGuest() {
    localStorage.setItem(C.AUTH_GUEST_DISMISSED_KEY, 'true');
    hideAuthOverlay();
    if (!localStorage.getItem('lumina_welcomed')) {
        showToast('以訪客模式使用，資料保存在本機。可隨時在設定頁註冊同步。', 'success');
        localStorage.setItem('lumina_welcomed', 'true');
    }
}

async function checkAuthOnInit() {
    const auth = getAuthSession();
    if (auth?.session?.token) {
        try {
            const data = await authApiRequest('/api/auth/me', { method: 'GET' });
            if (data.user) {
                persistAuthSession(data.user, auth.session.token);
                applyAuthUserToProfile(data.user, false);
                await loadUserDataFromServer();
                updateAuthUI();
                refreshUI({ dashboard: true, filters: true });
                return;
            }
        } catch (_) {
            localStorage.removeItem(C.AUTH_SESSION_KEY);
        }
    }
    updateAuthUI();
    const params = new URLSearchParams(window.location.search);
    if (params.get('auth') === 'login') {
        showAuthOverlay('login');
    } else if (params.get('auth') === 'register') {
        showAuthOverlay('register');
    } else if (!localStorage.getItem(C.AUTH_GUEST_DISMISSED_KEY) && S.tasks.length === 0) {
        showAuthOverlay('register');
    }
}

async function verifyLocalManagerPin(group, pin) {
    if (group.managerPinHash) {
        return (await hashPin(pin)) === group.managerPinHash;
    }
    if (group.managerPin !== undefined) {
        return String(pin) === String(group.managerPin);
    }
    return false;
}
