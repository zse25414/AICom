/** Lumina AI — bundled (npm run build:app) */
(() => {
  // js/modules/core/constants.js
  var DAILY_HISTORY_KEY = "lumina_daily_history";
  var TRACKED_FOCUS_KEY = "lumina_tracked_focus";
  var AUTH_GUEST_DISMISSED_KEY = "lumina_auth_guest_dismissed";
  var LAST_ACTIVE_DATE_KEY = "lumina_last_active_date";
  var USER_DATA_SYNC_DELAY_MS = 800;
  var RAG_SERVICE_URL = "http://127.0.0.1:8000";
  var API_KEY_STORAGE = "lumina_api_key";
  var RAG_KB_LABELS = {
    general: "\u4E00\u822C\u9810\u8A2D (General)",
    onboarding: "\u65B0\u4EBA\u57F9\u8A13 (Onboarding)",
    specs: "\u958B\u767C\u898F\u683C (Specs)",
    meetings: "\u6703\u8B70 SOP (Meetings)"
  };
  var PERSIST_STATE_DELAY_MS = 120;
  var AUTH_SESSION_KEY = "lumina_auth_session";
  var AUTH_USERS_KEY = "lumina_users";
  var LOCAL_ENTERPRISE_KEY = "lumina_enterprise_local_store";
  var TEAM_NOTIF_PREFS_KEY = "lumina_team_notif_prefs";
  var CHART_JS_URL = "https://cdn.jsdelivr.net/npm/chart.js@3.9.1/dist/chart.min.js";
  var ENTERPRISE_FETCH_TTL_MS = 5e3;
  var ENTERPRISE_POLL_INTERVAL_MS = 15e3;
  var CATEGORIES = {
    deep: { label: "\u6DF1\u5EA6\u5DE5\u4F5C", color: "bg-indigo-500/10 text-indigo-400" },
    execution: { label: "\u57F7\u884C\u5354\u4F5C", color: "bg-purple-500/10 text-purple-400" },
    meeting: { label: "\u6703\u8B70\u6E9D\u901A", color: "bg-pink-500/10 text-pink-400" },
    learning: { label: "\u5B78\u7FD2\u6210\u9577", color: "bg-amber-500/10 text-amber-400" },
    admin: { label: "\u884C\u653F\u96DC\u52D9", color: "bg-slate-500/10 text-slate-300" }
  };
  var SANITIZE_ALLOWED_TAGS = /* @__PURE__ */ new Set(["BR", "STRONG", "B", "EM", "I", "P", "UL", "OL", "LI"]);
  var IMPORT_MAX_BYTES = 2 * 1024 * 1024;
  var TEXT_MAX_LEN = 500;
  var SAFE_FA_ICONS = /* @__PURE__ */ new Set(["fa-plus", "fa-brain", "fa-comment-dots", "fa-sun", "fa-list-check", "fa-circle"]);

  // js/modules/core/state-domain.js
  function createSlice() {
    return {
      tasks: [],
      weeklyScores: [0, 0, 0, 0, 0, 0, 0],
      dailyHistory: {},
      currentDecomposedPlan: null,
      activeCategoryFilter: "all",
      deferredInstallPrompt: null,
      editingTaskId: null,
      trackedFocusByDay: {},
      enterpriseSyncSuppress: false,
      userProfile: {
        name: "\u4F7F\u7528\u8005",
        role: "\u77E5\u8B58\u5DE5\u4F5C\u8005",
        streak: 0,
        bestStreak: 0,
        joinDay: 1,
        workStart: "09:00",
        workEnd: "18:00",
        peakStart: "09:00",
        peakEnd: "12:30",
        streakThreshold: 80,
        enableConfetti: true,
        apiEnabled: false,
        apiMode: "direct",
        apiModel: "deepseek-chat",
        apiProxyUrl: "http://localhost:3001/api/chat",
        enterpriseApiUrl: "http://localhost:3001"
      },
      enterpriseSession: null,
      enterpriseGroupData: null,
      teamNotifications: [],
      chatHistory: [],
      coachAgentMessages: [],
      coachRequestInFlight: false,
      ragServiceActive: false,
      ragRetrievalMode: "hybrid",
      ragSyncedGroupKey: null,
      checkedRagKbs: ["general"],
      rolledCountOnInit: 0,
      todayFocusTaskId: null,
      focusSession: null,
      enterpriseSyncQueue: [],
      schedulerTabPending: null,
      onboardingStep: 0,
      selectedDocFile: null
    };
  }

  // js/modules/core/state-cache.js
  function createSlice2() {
    return {
      todayStatsCache: null,
      todayQueueMap: null,
      categoryCountsCache: null,
      taskById: /* @__PURE__ */ new Map(),
      enterpriseDataFetchedAt: 0
    };
  }

  // js/modules/core/state-ui.js
  function createSlice3() {
    return {
      notifPanelOpen: false,
      teamNotificationsInitialized: false,
      taskListVirtual: null
    };
  }

  // js/modules/core/state-timers.js
  function createSlice4() {
    return {
      enterprisePollTimer: null,
      enterpriseSyncFlushTimer: null,
      userDataSyncTimer: null,
      focusTimerInterval: null,
      analyticsPersistTimer: null,
      persistStateTimer: null,
      refreshUIQueued: null,
      refreshUIRaf: null,
      chartJsLoadPromise: null,
      pdfJsLoadPromise: null,
      xlsxLoadPromise: null,
      weeklyChartInstance: null,
      pieChartInstance: null
    };
  }

  // js/modules/core/state-collections.js
  function createSlice5() {
    return {
      knownTeamNotificationIds: /* @__PURE__ */ new Set(),
      locallyReadNotificationIds: /* @__PURE__ */ new Set(),
      enterpriseToggleInFlight: /* @__PURE__ */ new Set(),
      coachPlans: /* @__PURE__ */ new Map(),
      taskCoachPlans: /* @__PURE__ */ new Map()
    };
  }

  // js/modules/core/store.js
  var S = {
    ...createSlice(),
    ...createSlice2(),
    ...createSlice3(),
    ...createSlice4(),
    ...createSlice5()
  };

  // js/modules/generated/app.js
  function initializeTailwind() {
    document.documentElement.style.setProperty("--accent", "#6366f1");
  }
  function $(id) {
    return document.getElementById(id);
  }
  function setElText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }
  function setElHtml(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }
  function setElStyle(id, prop, value) {
    const el = document.getElementById(id);
    if (el) el.style[prop] = value;
  }
  function formatNotifTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    const now = /* @__PURE__ */ new Date();
    const diff = now - d;
    if (diff < 6e4) return "\u525B\u525B";
    if (diff < 36e5) return `${Math.floor(diff / 6e4)} \u5206\u9418\u524D`;
    if (diff < 864e5) return `${Math.floor(diff / 36e5)} \u5C0F\u6642\u524D`;
    return d.toLocaleString("zh-TW", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  function addMinutes(timeStr, mins) {
    const [h, m] = timeStr.split(":").map(Number);
    const total = h * 60 + m + mins;
    return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  }
  function getInitials(name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }
  function toLocalISO(date = /* @__PURE__ */ new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  function getTodayISO() {
    return toLocalISO();
  }
  function getTomorrowISO() {
    const d = /* @__PURE__ */ new Date();
    d.setDate(d.getDate() + 1);
    return toLocalISO(d);
  }
  function formatDateTW(date = /* @__PURE__ */ new Date()) {
    return date.toLocaleDateString("zh-TW", { year: "numeric", month: "long", day: "numeric" });
  }
  function getGreeting() {
    const hour = (/* @__PURE__ */ new Date()).getHours();
    if (hour < 12) return "\u65E9\u5B89";
    if (hour < 18) return "\u5348\u5B89";
    return "\u665A\u5B89";
  }
  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }
  function sanitizeHtml(html) {
    if (!html) return "";
    const template = document.createElement("template");
    template.innerHTML = String(html);
    function walk(parent) {
      [...parent.childNodes].forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE) return;
        if (node.nodeType !== Node.ELEMENT_NODE) {
          node.remove();
          return;
        }
        if (!SANITIZE_ALLOWED_TAGS.has(node.tagName)) {
          const fragment = document.createDocumentFragment();
          while (node.firstChild) fragment.appendChild(node.firstChild);
          node.replaceWith(fragment);
          walk(parent);
          return;
        }
        [...node.attributes].forEach((attr) => node.removeAttribute(attr.name));
        walk(node);
      });
    }
    walk(template.content);
    return template.innerHTML;
  }
  function isSafeHttpUrl(url) {
    if (!url || typeof url !== "string") return false;
    try {
      const parsed = new URL(url.trim());
      return ["http:", "https:"].includes(parsed.protocol);
    } catch (_) {
      return false;
    }
  }
  function clampText(value, max = TEXT_MAX_LEN) {
    return String(value ?? "").slice(0, max);
  }
  function sanitizeFaIcon(icon) {
    const cleaned = String(icon || "").replace(/[^a-z0-9-]/gi, "");
    return SAFE_FA_ICONS.has(cleaned) ? cleaned : "fa-circle";
  }
  function getEnergyLabel(energy) {
    if (energy >= 5) return "\u6975\u9AD8";
    if (energy >= 4) return "\u9AD8";
    if (energy >= 3) return "\u4E2D";
    return "\u4F4E";
  }
  function getEnergyColor(energy) {
    if (energy >= 5) return "bg-red-500/10 text-red-400";
    if (energy >= 4) return "bg-orange-500/10 text-orange-400";
    if (energy >= 3) return "bg-amber-500/10 text-amber-400";
    return "bg-slate-500/10 text-slate-300";
  }
  function clearSensitiveLocalData() {
    const preserved = {};
    for (const key of ["lumina_profile", AUTH_SESSION_KEY, AUTH_USERS_KEY]) {
      const val = localStorage.getItem(key);
      if (val) preserved[key] = val;
    }
    const apiKey = sessionStorage.getItem(API_KEY_STORAGE);
    localStorage.clear();
    Object.entries(preserved).forEach(([k, v]) => localStorage.setItem(k, v));
    if (apiKey) sessionStorage.setItem(API_KEY_STORAGE, apiKey);
  }
  async function hashPin(pin) {
    const str = "lumina-pin:v1:" + String(pin);
    if (crypto?.subtle?.digest) {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
  }
  function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
  }
  function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }
  function getAuthBaseUrl() {
    return getEnterpriseBaseUrl();
  }
  function getAuthHeaders(includeJson = true) {
    const headers = {};
    if (includeJson) headers["Content-Type"] = "application/json";
    try {
      const session = JSON.parse(localStorage.getItem(AUTH_SESSION_KEY) || "null");
      if (session?.token) headers.Authorization = `Bearer ${session.token}`;
    } catch (_) {
    }
    return headers;
  }
  async function authApiRequest(path, options = {}) {
    const res = await fetch(getAuthBaseUrl() + path, {
      ...options,
      headers: {
        ...getAuthHeaders(options.body !== void 0),
        ...options.headers || {}
      }
    });
    let data = {};
    try {
      data = await res.json();
    } catch (_) {
    }
    if (!res.ok) {
      const err = new Error(data.error || "\u8ACB\u6C42\u5931\u6557");
      err.status = res.status;
      throw err;
    }
    return data;
  }
  function getAuthSession() {
    try {
      const session = JSON.parse(localStorage.getItem(AUTH_SESSION_KEY) || "null");
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
    if (localStorage.getItem(AUTH_GUEST_DISMISSED_KEY)) return false;
    return !getAuthSession()?.session?.token;
  }
  function persistAuthSession(user, token) {
    localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify({
      token,
      userId: user.id,
      email: user.email,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role || "\u77E5\u8B58\u5DE5\u4F5C\u8005",
        createdAt: user.createdAt
      },
      loggedInAt: (/* @__PURE__ */ new Date()).toISOString()
    }));
    localStorage.removeItem(AUTH_USERS_KEY);
  }
  function applyAuthUserToProfile(user, isNew = false) {
    S.userProfile.name = user.name;
    S.userProfile.role = user.role || "\u77E5\u8B58\u5DE5\u4F5C\u8005";
    if (isNew && S.tasks.length === 0 && !Object.keys(S.dailyHistory).length) {
      S.userProfile.streak = 0;
      S.userProfile.bestStreak = 0;
      S.userProfile.joinDay = 1;
    }
    persistProfile();
  }
  function clearAuthErrors() {
    setElText("auth-register-error", "");
    setElText("auth-login-error", "");
  }
  function showAuthOverlay(tab = "register") {
    const overlay = document.getElementById("auth-overlay");
    if (!overlay) return;
    clearAuthErrors();
    switchAuthTab(tab);
    overlay.classList.remove("hidden");
    const focusId = tab === "login" ? "auth-login-email" : "auth-reg-name";
    setTimeout(() => document.getElementById(focusId)?.focus(), 80);
  }
  function hideAuthOverlay() {
    document.getElementById("auth-overlay")?.classList.add("hidden");
    clearAuthErrors();
  }
  function switchAuthTab(tab) {
    const isLogin = tab === "login";
    document.getElementById("auth-tab-login")?.classList.toggle("active", isLogin);
    document.getElementById("auth-tab-register")?.classList.toggle("active", !isLogin);
    document.getElementById("auth-tab-login")?.setAttribute("aria-selected", String(isLogin));
    document.getElementById("auth-tab-register")?.setAttribute("aria-selected", String(!isLogin));
    document.getElementById("auth-login-form")?.classList.toggle("active", isLogin);
    document.getElementById("auth-register-form")?.classList.toggle("active", !isLogin);
    clearAuthErrors();
  }
  function updateAuthUI() {
    const loggedIn = isLoggedIn();
    const auth = getAuthSession();
    document.getElementById("settings-account-logged-in")?.classList.toggle("hidden", !loggedIn);
    document.getElementById("settings-account-guest")?.classList.toggle("hidden", loggedIn);
    if (loggedIn && auth) {
      setElText("settings-account-name", auth.user.name);
      setElText("settings-account-email", auth.user.email);
      const avatar = document.getElementById("settings-account-avatar");
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
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  function applyUserDataFromServer(data) {
    if (!data) return;
    if (Array.isArray(data.tasks)) {
      S.tasks = data.tasks;
      localStorage.setItem("lumina_tasks", JSON.stringify(S.tasks));
      migrateTasks();
    }
    if (data.profile && typeof data.profile === "object") {
      S.userProfile = { ...S.userProfile, ...data.profile };
      persistProfile();
    }
    if (data.dailyHistory && typeof data.dailyHistory === "object") {
      S.dailyHistory = data.dailyHistory;
      saveDailyHistory();
    }
    if (data.trackedFocusByDay && typeof data.trackedFocusByDay === "object") {
      S.trackedFocusByDay = { ...S.trackedFocusByDay, ...data.trackedFocusByDay };
      saveTrackedFocus();
    }
    if (Array.isArray(data.weeklyScores) && data.weeklyScores.length === 7) {
      S.weeklyScores = data.weeklyScores;
      localStorage.setItem("lumina_weekly", JSON.stringify(S.weeklyScores));
    }
    invalidateTodayStats();
  }
  async function syncUserDataToServer(options = {}) {
    const auth = getAuthSession();
    if (!auth?.session?.token) return;
    const run = async () => {
      try {
        await authApiRequest("/api/user/data", {
          method: "PATCH",
          body: JSON.stringify(buildUserDataPayload())
        });
      } catch (e) {
        console.warn("[Lumina] \u500B\u4EBA\u8CC7\u6599\u540C\u6B65\u5931\u6557:", e.message);
      }
    };
    if (options.immediate) return run();
    clearTimeout(S.userDataSyncTimer);
    S.userDataSyncTimer = setTimeout(run, USER_DATA_SYNC_DELAY_MS);
  }
  async function loadUserDataFromServer() {
    const auth = getAuthSession();
    if (!auth?.session?.token) return;
    try {
      const res = await authApiRequest("/api/user/data", { method: "GET" });
      const serverData = res.data || {};
      let localTasks = [];
      try {
        localTasks = JSON.parse(localStorage.getItem("lumina_tasks") || "[]");
      } catch (_) {
      }
      const hasLocal = Array.isArray(localTasks) && localTasks.length > 0;
      const hasServer = Array.isArray(serverData?.tasks) && serverData.tasks.length > 0;
      if (hasServer && hasLocal) {
        applyUserDataFromServer({
          ...serverData,
          tasks: mergeTasksArrays(serverData.tasks, localTasks),
          dailyHistory: { ...serverData.dailyHistory || {}, ...S.dailyHistory },
          trackedFocusByDay: { ...serverData.S.trackedFocusByDay || {}, ...S.trackedFocusByDay }
        });
        await syncUserDataToServer({ immediate: true });
      } else if (hasServer) {
        applyUserDataFromServer(serverData);
      } else if (hasLocal || Object.keys(S.trackedFocusByDay).length) {
        await syncUserDataToServer({ immediate: true });
      }
    } catch (e) {
      console.warn("[Lumina] \u500B\u4EBA\u8CC7\u6599\u96F2\u7AEF\u8F09\u5165\u5931\u6557:", e.message);
    }
  }
  async function finishAuth(user, isNew, token) {
    const hadLocalData = S.tasks.length > 0 || Object.keys(S.dailyHistory).length > 0;
    persistAuthSession(user, token);
    applyAuthUserToProfile(user, isNew);
    if (isNew && !hadLocalData) {
      localStorage.removeItem("lumina_onboarding_v2");
      localStorage.removeItem("lumina_welcomed");
    }
    await loadUserDataFromServer();
    hideAuthOverlay();
    localStorage.setItem(AUTH_GUEST_DISMISSED_KEY, "true");
    updateAuthUI();
    refreshUI({ dashboard: true, filters: true });
    const welcomeMsg = isNew ? hadLocalData ? `\u6B61\u8FCE\u52A0\u5165\uFF0C${user.name}\uFF01\u5DF2\u5408\u4F75\u8A2A\u5BA2\u671F\u9593\u7684\u8CC7\u6599` : `\u6B61\u8FCE\u52A0\u5165\uFF0C${user.name}\uFF01` : `\u6B61\u8FCE\u56DE\u4F86\uFF0C${user.name}\uFF01`;
    showToast(welcomeMsg, "success");
    if (isNew && !hadLocalData && S.tasks.length === 0) {
      setTimeout(() => startOnboarding(), 600);
    }
  }
  async function handleRegister(e) {
    e.preventDefault();
    clearAuthErrors();
    const name = clampText(document.getElementById("auth-reg-name")?.value, 40);
    const email = normalizeEmail(document.getElementById("auth-reg-email")?.value);
    const role = clampText(document.getElementById("auth-reg-role")?.value, 40) || "\u77E5\u8B58\u5DE5\u4F5C\u8005";
    const password = document.getElementById("auth-reg-password")?.value || "";
    const confirm2 = document.getElementById("auth-reg-password-confirm")?.value || "";
    const errEl = document.getElementById("auth-register-error");
    const btn = document.getElementById("auth-register-btn");
    if (!name) {
      if (errEl) errEl.textContent = "\u8ACB\u8F38\u5165\u986F\u793A\u540D\u7A31";
      return;
    }
    if (!isValidEmail(email)) {
      if (errEl) errEl.textContent = "\u8ACB\u8F38\u5165\u6709\u6548\u7684\u96FB\u5B50\u90F5\u4EF6";
      return;
    }
    if (password.length < 6) {
      if (errEl) errEl.textContent = "\u5BC6\u78BC\u81F3\u5C11\u9700\u8981 6 \u500B\u5B57\u5143";
      return;
    }
    if (password !== confirm2) {
      if (errEl) errEl.textContent = "\u5169\u6B21\u8F38\u5165\u7684\u5BC6\u78BC\u4E0D\u4E00\u81F4";
      return;
    }
    if (btn) btn.disabled = true;
    try {
      const data = await authApiRequest("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({ name, email, role, password })
      });
      finishAuth(data.user, true, data.token);
    } catch (err) {
      if (err.status === 409) {
        if (errEl) errEl.textContent = err.message || "\u6B64\u96FB\u5B50\u90F5\u4EF6\u5DF2\u8A3B\u518A\uFF0C\u8ACB\u76F4\u63A5\u767B\u5165";
        switchAuthTab("login");
        document.getElementById("auth-login-email").value = email;
        return;
      }
      if (errEl) errEl.textContent = err.message || "\u8A3B\u518A\u5931\u6557\uFF0C\u8ACB\u78BA\u8A8D API \u670D\u52D9\u5DF2\u555F\u52D5";
    } finally {
      if (btn) btn.disabled = false;
    }
  }
  async function handleLogin(e) {
    e.preventDefault();
    clearAuthErrors();
    const email = normalizeEmail(document.getElementById("auth-login-email")?.value);
    const password = document.getElementById("auth-login-password")?.value || "";
    const errEl = document.getElementById("auth-login-error");
    const btn = document.getElementById("auth-login-btn");
    if (!isValidEmail(email)) {
      if (errEl) errEl.textContent = "\u8ACB\u8F38\u5165\u6709\u6548\u7684\u96FB\u5B50\u90F5\u4EF6";
      return;
    }
    if (!password) {
      if (errEl) errEl.textContent = "\u8ACB\u8F38\u5165\u5BC6\u78BC";
      return;
    }
    if (btn) btn.disabled = true;
    try {
      const data = await authApiRequest("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password })
      });
      finishAuth(data.user, false, data.token);
    } catch (err) {
      if (errEl) errEl.textContent = err.message || "\u767B\u5165\u5931\u6557\uFF0C\u8ACB\u78BA\u8A8D API \u670D\u52D9\u5DF2\u555F\u52D5";
    } finally {
      if (btn) btn.disabled = false;
    }
  }
  async function handleLogout() {
    if (!isLoggedIn()) return;
    if (!confirm("\u78BA\u5B9A\u8981\u767B\u51FA\u55CE\uFF1F\u4F60\u7684\u4EFB\u52D9\u8207\u8A2D\u5B9A\u4ECD\u6703\u4FDD\u7559\u5728\u672C\u6A5F\u3002")) return;
    try {
      await syncUserDataToServer({ immediate: true });
    } catch (_) {
    }
    localStorage.removeItem(AUTH_SESSION_KEY);
    hideAuthOverlay();
    updateAuthUI();
    showToast("\u5DF2\u767B\u51FA", "success");
    showAuthOverlay("login");
  }
  function openUserMenu() {
    if (isLoggedIn()) {
      showSection("settings");
      return;
    }
    showAuthOverlay("login");
  }
  function dismissAuthAsGuest() {
    localStorage.setItem(AUTH_GUEST_DISMISSED_KEY, "true");
    hideAuthOverlay();
    if (!localStorage.getItem("lumina_welcomed")) {
      showToast("\u4EE5\u8A2A\u5BA2\u6A21\u5F0F\u4F7F\u7528\uFF0C\u8CC7\u6599\u4FDD\u5B58\u5728\u672C\u6A5F\u3002\u53EF\u96A8\u6642\u5728\u8A2D\u5B9A\u9801\u8A3B\u518A\u540C\u6B65\u3002", "success");
      localStorage.setItem("lumina_welcomed", "true");
    }
  }
  async function checkAuthOnInit() {
    const auth = getAuthSession();
    if (auth?.session?.token) {
      try {
        const data = await authApiRequest("/api/auth/me", { method: "GET" });
        if (data.user) {
          persistAuthSession(data.user, auth.session.token);
          applyAuthUserToProfile(data.user, false);
          await loadUserDataFromServer();
          updateAuthUI();
          refreshUI({ dashboard: true, filters: true });
          return;
        }
      } catch (_) {
        localStorage.removeItem(AUTH_SESSION_KEY);
      }
    }
    updateAuthUI();
    const params = new URLSearchParams(window.location.search);
    if (params.get("auth") === "login") {
      showAuthOverlay("login");
    } else if (params.get("auth") === "register") {
      showAuthOverlay("register");
    } else if (!localStorage.getItem(AUTH_GUEST_DISMISSED_KEY) && S.tasks.length === 0) {
      showAuthOverlay("register");
    }
  }
  async function verifyLocalManagerPin(group, pin) {
    if (group.managerPinHash) {
      return await hashPin(pin) === group.managerPinHash;
    }
    if (group.managerPin !== void 0) {
      return String(pin) === String(group.managerPin);
    }
    return false;
  }
  function ensureLocalGroupNotifications(group) {
    if (!Array.isArray(group.notifications)) group.notifications = [];
  }
  function pushLocalTeamNotification(groupCode, payload) {
    const store = loadLocalEnterpriseStore();
    const group = store.groups[normalizeEnterpriseCode(groupCode)];
    if (!group) return null;
    ensureLocalGroupNotifications(group);
    const note = {
      id: "n_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
      type: payload.type,
      recipientId: payload.recipientId,
      title: payload.title || "\u5718\u968A\u901A\u77E5",
      message: payload.message || "",
      taskId: payload.taskId || null,
      taskTitle: payload.taskTitle || "",
      actorId: payload.actorId || null,
      actorName: payload.actorName || "",
      read: false,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
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
    return group.notifications.filter((n) => n.recipientId === S.enterpriseSession.memberId).slice(0, 50);
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
      const parsed = JSON.parse(localStorage.getItem(key) || "[]");
      if (Array.isArray(parsed)) parsed.forEach((id) => S.locallyReadNotificationIds.add(id));
    } catch (_) {
    }
  }
  function persistLocallyReadNotificationIds() {
    const key = getLocalReadNotificationStorageKey();
    if (!key) return;
    localStorage.setItem(key, JSON.stringify([...S.locallyReadNotificationIds]));
  }
  function rememberLocallyReadNotificationIds(ids, readAll) {
    if (!S.enterpriseSession) return;
    if (readAll) {
      S.teamNotifications.forEach((n) => S.locallyReadNotificationIds.add(n.id));
    } else {
      ids.forEach((id) => S.locallyReadNotificationIds.add(id));
    }
    persistLocallyReadNotificationIds();
  }
  function applyLocalReadFlags(notifications) {
    return (notifications || []).map((note) => ({
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
      return { ...getDefaultTeamNotificationPrefs(), ...JSON.parse(localStorage.getItem(TEAM_NOTIF_PREFS_KEY) || "{}") };
    } catch (_) {
      return getDefaultTeamNotificationPrefs();
    }
  }
  function loadTeamNotificationPrefsForm() {
    const prefs = getTeamNotificationPrefs();
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.checked = !!val;
    };
    set("team-notif-assigned", prefs.taskAssigned);
    set("team-notif-completed", prefs.taskCompleted);
    set("team-notif-toast", prefs.toast);
    set("team-notif-desktop", prefs.desktop);
    const hint = document.getElementById("team-notif-perm-hint");
    if (hint) {
      hint.classList.toggle("hidden", !(prefs.desktop && Notification.permission !== "granted"));
    }
  }
  function shouldAlertForNotification(note, prefs) {
    if (note.type === "task_assigned" || note.type === "task_assigned_confirm") return prefs.taskAssigned;
    if (note.type === "task_completed" || note.type === "task_completed_confirm") return prefs.taskCompleted;
    return true;
  }
  function ingestTeamNotificationsFromResponse(notifications, alert = true) {
    if (!notifications?.length || !S.enterpriseSession) return;
    for (const rawNote of notifications) {
      if (rawNote.recipientId !== S.enterpriseSession.memberId) continue;
      const note = applyLocalReadFlags([rawNote])[0];
      const index = S.teamNotifications.findIndex((n) => n.id === note.id);
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
    if (prefs.toast) showToast(note.message || note.title, "success");
    if (prefs.desktop && "Notification" in window && Notification.permission === "granted") {
      try {
        new Notification(note.title || "Lumina \u5718\u968A\u901A\u77E5", {
          body: note.message,
          tag: "lumina-team-" + note.id,
          icon: void 0
        });
      } catch (_) {
      }
    }
  }
  function processIncomingTeamNotifications(notifications) {
    const incoming = applyLocalReadFlags(notifications || []);
    const previousById = new Map(S.teamNotifications.map((n) => [n.id, n]));
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
      incoming.forEach((n) => S.knownTeamNotificationIds.add(n.id));
      S.teamNotificationsInitialized = true;
      loadLocallyReadNotificationIds();
      incoming.forEach((n) => {
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
    const path = `/api/enterprise/notifications?groupCode=${encodeURIComponent(S.enterpriseSession.groupCode)}&memberId=${encodeURIComponent(S.enterpriseSession.memberId)}`;
    const api = await enterpriseFetch("GET", path);
    if (api.ok) {
      processIncomingTeamNotifications(api.data.notifications || []);
    } else {
      processIncomingTeamNotifications(getLocalTeamNotifications());
    }
  }
  function updateNotificationUI() {
    const wrap = document.getElementById("notif-wrap");
    const badge = document.getElementById("notif-badge");
    const bell = document.getElementById("notif-bell-btn");
    const unread = S.teamNotifications.filter((n) => !n.read).length;
    if (wrap) wrap.classList.toggle("hidden", !S.enterpriseSession);
    if (badge) {
      if (unread > 0) {
        badge.textContent = unread > 9 ? "9+" : String(unread);
        badge.classList.remove("hidden");
      } else {
        badge.classList.add("hidden");
      }
    }
    if (bell) bell.classList.toggle("has-unread", unread > 0);
    if (S.notifPanelOpen) renderNotificationPanel();
  }
  function renderNotificationPanel() {
    const list = document.getElementById("notif-panel-list");
    if (!list) return;
    if (!S.teamNotifications.length) {
      list.innerHTML = `<div class="notif-empty"><i class="fa-solid fa-bell-slash text-2xl mb-2 block opacity-40"></i>\u76EE\u524D\u6C92\u6709\u901A\u77E5</div>`;
      return;
    }
    list.innerHTML = S.teamNotifications.map((note) => {
      const isComplete = note.type === "task_completed" || note.type === "task_completed_confirm";
      const iconCls = isComplete ? "notif-item-icon-completed" : "notif-item-icon-assigned";
      const icon = isComplete ? "fa-check" : note.type === "task_assigned_confirm" ? "fa-share" : "fa-paper-plane";
      return `
            <div class="notif-item ${note.read ? "" : "unread"}" onclick="handleTeamNotificationClick('${note.id}')" role="button" tabindex="0">
                <div class="notif-item-icon ${iconCls}"><i class="fa-solid ${icon}"></i></div>
                <div class="min-w-0 flex-1">
                    <div class="notif-item-title">${escapeHtml(note.title)}</div>
                    <div class="notif-item-msg">${escapeHtml(note.message)}</div>
                    <div class="notif-item-time">${formatNotifTime(note.createdAt)}</div>
                </div>
                ${note.read ? "" : '<span class="w-2 h-2 rounded-full bg-indigo-400 flex-shrink-0 mt-1"></span>'}
            </div>`;
    }).join("");
  }
  function toggleNotificationPanel(event) {
    if (event) event.stopPropagation();
    S.notifPanelOpen = !S.notifPanelOpen;
    const panel = document.getElementById("notif-panel");
    const bell = document.getElementById("notif-bell-btn");
    if (panel) {
      panel.classList.toggle("hidden", !S.notifPanelOpen);
      panel.style.display = S.notifPanelOpen ? "" : "none";
    }
    if (bell) bell.setAttribute("aria-expanded", S.notifPanelOpen ? "true" : "false");
    if (S.notifPanelOpen) {
      renderNotificationPanel();
      refreshTeamNotifications(true);
    }
  }
  function closeNotificationPanel() {
    S.notifPanelOpen = false;
    const panel = document.getElementById("notif-panel");
    if (panel) {
      panel.classList.add("hidden");
      panel.style.display = "none";
    }
    document.getElementById("notif-bell-btn")?.setAttribute("aria-expanded", "false");
  }
  async function markAllTeamNotificationsRead() {
    if (!S.enterpriseSession) return;
    rememberLocallyReadNotificationIds([], true);
    markLocalTeamNotificationsRead([], true);
    S.teamNotifications.forEach((n) => {
      n.read = true;
    });
    updateNotificationUI();
    const api = await enterpriseFetch("PATCH", "/api/enterprise/notifications/read", {
      groupCode: S.enterpriseSession.groupCode,
      memberId: S.enterpriseSession.memberId,
      readAll: true
    });
    if (!api.ok && !S.enterpriseSession.offline) {
      showToast("\u5DF2\u5728\u672C\u6A5F\u6A19\u70BA\u5DF2\u8B80\uFF08\u4F3A\u670D\u5668\u540C\u6B65\u7A0D\u5F8C\u91CD\u8A66\uFF09", "success");
      return;
    }
    showToast("\u5DF2\u5168\u90E8\u6A19\u70BA\u5DF2\u8B80", "success");
  }
  function getRagFilenameForDoc(doc) {
    if (!doc) return "";
    if (doc.filename) return doc.filename;
    if (doc.title) return `text::${doc.title}.md`;
    return "";
  }
  function getRagKbLabel(kbId) {
    return RAG_KB_LABELS[kbId] || kbId;
  }
  async function syncDocumentToRag({ groupCode, kbId, docType, title, content, filename, fileData }, options = {}) {
    if (!groupCode) return false;
    const kb = kbId || "general";
    const ragFilename = filename || `text::${title}.md`;
    const textContent = (content || "").trim();
    const ragBase = getRagServiceBase();
    try {
      if (textContent) {
        const res = await fetch(`${ragBase}/api/rag/document/upload-text`, {
          method: "POST",
          headers: getAuthHeaders(true),
          body: JSON.stringify({
            group_code: groupCode,
            kb_id: kb,
            title,
            content: textContent,
            filename: docType === "text" ? `text::${title}.md` : ragFilename
          })
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || err.error || `RAG \u6587\u5B57\u7D22\u5F15\u5931\u6557 (${res.status})`);
        }
      } else if (fileData && filename && (docType === "pdf" || docType === "excel" || docType === "image")) {
        const res = await fetch(`${ragBase}/api/rag/document/upload`, {
          method: "POST",
          headers: getAuthHeaders(true),
          body: JSON.stringify({
            group_code: groupCode,
            kb_id: kb,
            filename: ragFilename,
            file_base64: fileData
          })
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.detail || err.error || `RAG \u6A94\u6848\u7D22\u5F15\u5931\u6557 (${res.status})`);
        }
      } else {
        throw new Error("\u6C92\u6709\u53EF\u7D22\u5F15\u7684\u6587\u4EF6\u5167\u5BB9");
      }
      console.log(`[Lumina RAG] \u5DF2\u7D22\u5F15\uFF1A${title} (${kb})`);
      if (options.toastOnSuccess) showToast(`\u5DF2\u540C\u6B65\u81F3 RAG\uFF1A${title}`, "success");
      return true;
    } catch (e) {
      console.warn("[Lumina RAG] \u6587\u4EF6\u7D22\u5F15\u540C\u6B65\u5931\u6557:", e.message);
      if (options.toastOnError) showToast(`RAG \u7D22\u5F15\u5931\u6557\uFF1A${e.message}`, "error");
      return false;
    }
  }
  async function reindexEnterpriseDocumentsToRag(options = {}) {
    if (!S.enterpriseSession || !S.enterpriseGroupData?.documents?.length) return { ok: 0, fail: 0 };
    let ok = 0;
    let fail = 0;
    for (const doc of S.enterpriseGroupData.documents) {
      const synced = await syncDocumentToRag({
        groupCode: S.enterpriseSession.groupCode,
        kbId: doc.kbId || "general",
        docType: doc.docType || "text",
        title: doc.title,
        content: doc.content,
        filename: getRagFilenameForDoc(doc)
      });
      if (synced) ok++;
      else fail++;
    }
    if (options.toast && ok > 0) {
      showToast(`\u5DF2\u91CD\u65B0\u540C\u6B65 ${ok} \u4EFD\u6587\u4EF6\u81F3 RAG \u77E5\u8B58\u5EAB`, "success");
    }
    if (options.toast && fail > 0) {
      showToast(`${fail} \u4EFD\u6587\u4EF6\u540C\u6B65 RAG \u5931\u6557\uFF0C\u8ACB\u7A0D\u5F8C\u518D\u8A66`, "error");
    }
    if (ok > 0) await window.renderRagKbCheckboxes?.();
    return { ok, fail };
  }
  async function ensureEnterpriseDocsInRag(options = {}) {
    if (!S.enterpriseSession || !S.enterpriseGroupData?.documents?.length) return;
    const syncKey = `${S.enterpriseSession.groupCode}:${S.enterpriseGroupData.documents.map((d) => d.id).join(",")}`;
    if (!options.force && S.ragSyncedGroupKey === syncKey) return;
    try {
      const res = await fetch(`${RAG_SERVICE_URL}/health`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.service !== "lumina-rag-service") return;
    } catch (_) {
      return;
    }
    const result = await reindexEnterpriseDocumentsToRag(options);
    if (result.ok > 0) S.ragSyncedGroupKey = syncKey;
  }
  async function fetchRagKbIds(groupCode) {
    const res = await fetch(`${getRagServiceBase()}/api/rag/kb/list?group_code=${encodeURIComponent(groupCode)}`, {
      headers: getAuthHeaders(false)
    });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data.kb_ids) ? data.kb_ids : null;
  }
  function getRagServiceBase() {
    return getEnterpriseBaseUrl();
  }
  function hasStoredApiKey() {
    return !!getStoredApiKey();
  }
  function migrateApiSettings() {
    if (hasStoredApiKey() && !S.userProfile.apiEnabled && S.userProfile.apiMode !== "proxy") {
      S.userProfile.apiEnabled = true;
      persistProfile();
    }
  }
  function migrateApiKeyStorage() {
    const legacy = localStorage.getItem(API_KEY_STORAGE);
    if (legacy && !sessionStorage.getItem(API_KEY_STORAGE)) {
      sessionStorage.setItem(API_KEY_STORAGE, legacy);
      localStorage.removeItem(API_KEY_STORAGE);
    }
  }
  function getStoredApiKey() {
    return (sessionStorage.getItem(API_KEY_STORAGE) || "").trim();
  }
  function setStoredApiKey(key) {
    const trimmed = String(key || "").trim();
    if (trimmed) sessionStorage.setItem(API_KEY_STORAGE, trimmed);
    else sessionStorage.removeItem(API_KEY_STORAGE);
    localStorage.removeItem(API_KEY_STORAGE);
  }
  function isApiReady() {
    if (!S.userProfile.apiEnabled) return false;
    if (S.userProfile.apiMode === "proxy") return !!S.userProfile.apiProxyUrl;
    return hasStoredApiKey();
  }
  function updateApiStatusBadge() {
    const badge = document.getElementById("api-status-badge");
    if (!badge) return;
    if (isApiReady()) {
      badge.textContent = S.userProfile.apiMode === "proxy" ? "\u4EE3\u7406\u6A21\u5F0F" : "DeepSeek \u5DF2\u555F\u7528";
      badge.className = "text-[10px] px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-300";
    } else if (hasStoredApiKey() && !S.userProfile.apiEnabled) {
      badge.textContent = "\u5DF2\u586B Key\uFF0C\u8ACB\u555F\u7528\u958B\u95DC";
      badge.className = "text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300";
    } else {
      badge.textContent = "\u672A\u555F\u7528\uFF08\u4F7F\u7528\u898F\u5247\u5F15\u64CE\uFF09";
      badge.className = "text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400";
    }
  }
  function toggleApiModeFields() {
    const mode = document.getElementById("settings-api-mode")?.value || "direct";
    document.getElementById("api-key-group")?.classList.toggle("hidden", mode === "proxy");
    document.getElementById("api-proxy-group")?.classList.toggle("hidden", mode !== "proxy");
  }
  async function callDeepSeek(messages, options = {}) {
    const { jsonMode = false, temperature = 0.7, timeoutMs = 9e4 } = options;
    if (!S.userProfile.apiEnabled) throw new Error("API \u672A\u555F\u7528");
    const useProxy = S.userProfile.apiMode === "proxy";
    const apiKey = getStoredApiKey();
    if (!useProxy && !apiKey) throw new Error("\u8ACB\u5728\u8A2D\u5B9A\u4E2D\u586B\u5165 DeepSeek API Key");
    if (useProxy && !S.userProfile.apiProxyUrl) throw new Error("\u8ACB\u8A2D\u5B9A\u4EE3\u7406\u4F3A\u670D\u5668 URL");
    const payload = {
      model: S.userProfile.apiModel || "deepseek-chat",
      messages,
      temperature,
      stream: false
    };
    if (jsonMode) payload.response_format = { type: "json_object" };
    const url = useProxy ? S.userProfile.apiProxyUrl : "https://api.deepseek.com/chat/completions";
    if (useProxy && !isSafeHttpUrl(url)) throw new Error("\u4EE3\u7406 URL \u4E0D\u5B89\u5168\u6216\u683C\u5F0F\u932F\u8AA4");
    const headers = useProxy ? getAuthHeaders(true) : { "Content-Type": "application/json" };
    if (!useProxy) headers["Authorization"] = `Bearer ${apiKey}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(url, { method: "POST", headers, body: JSON.stringify(payload), signal: controller.signal });
    } catch (e) {
      if (e.name === "AbortError") throw new Error("AI \u56DE\u61C9\u903E\u6642\uFF0C\u8ACB\u7A0D\u5F8C\u518D\u8A66");
      throw e;
    } finally {
      clearTimeout(timer);
    }
    const raw = await res.text();
    if (!res.ok) {
      let msg = raw;
      try {
        msg = JSON.parse(raw).error?.message || raw;
      } catch (_) {
      }
      throw new Error(msg || `API \u932F\u8AA4 ${res.status}`);
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (_) {
      throw new Error("API \u56DE\u61C9\u683C\u5F0F\u7570\u5E38");
    }
    const content = parsed.choices?.[0]?.message?.content;
    if (content == null || content === "") {
      const apiErr = parsed.error?.message || parsed.message;
      throw new Error(apiErr || "AI \u56DE\u50B3\u5167\u5BB9\u70BA\u7A7A");
    }
    return content;
  }
  async function testApiConnection() {
    const keyInput = document.getElementById("settings-api-key").value.trim();
    if (keyInput) {
      setStoredApiKey(keyInput);
      S.userProfile.apiEnabled = true;
      document.getElementById("settings-api-enabled").checked = true;
    } else {
      S.userProfile.apiEnabled = document.getElementById("settings-api-enabled").checked;
    }
    S.userProfile.apiMode = document.getElementById("settings-api-mode").value;
    S.userProfile.apiProxyUrl = document.getElementById("settings-api-proxy").value.trim();
    S.userProfile.apiModel = document.getElementById("settings-api-model").value;
    showToast("\u6B63\u5728\u6E2C\u8A66 API \u9023\u7DDA...", "success");
    try {
      await callDeepSeek([{ role: "user", content: "\u8ACB\u56DE\u8986\uFF1A\u9023\u7DDA\u6210\u529F" }], { temperature: 0 });
      showToast("\u2705 API \u9023\u7DDA\u6210\u529F\uFF01", "success");
      updateApiStatusBadge();
    } catch (err) {
      showToast("\u9023\u7DDA\u5931\u6557\uFF1A" + err.message, "error");
    }
  }
  function loadSettingsForm() {
    document.getElementById("settings-name").value = S.userProfile.name;
    document.getElementById("settings-role").value = S.userProfile.role;
    document.getElementById("settings-work-start").value = S.userProfile.workStart || "09:00";
    document.getElementById("settings-work-end").value = S.userProfile.workEnd || "18:00";
    document.getElementById("settings-peak-start").value = S.userProfile.peakStart || "09:00";
    document.getElementById("settings-peak-end").value = S.userProfile.peakEnd || "12:30";
    document.getElementById("settings-streak-threshold").value = S.userProfile.streakThreshold || 80;
    document.getElementById("settings-streak-value").innerText = (S.userProfile.streakThreshold || 80) + "%";
    document.getElementById("settings-confetti").checked = S.userProfile.enableConfetti !== false;
    document.getElementById("settings-api-enabled").checked = !!S.userProfile.apiEnabled;
    document.getElementById("settings-api-mode").value = S.userProfile.apiMode || "direct";
    document.getElementById("settings-api-key").value = getStoredApiKey();
    document.getElementById("settings-api-proxy").value = S.userProfile.apiProxyUrl || "http://localhost:3001/api/chat";
    document.getElementById("settings-api-model").value = S.userProfile.apiModel || "deepseek-chat";
    document.getElementById("settings-enterprise-api").value = S.userProfile.enterpriseApiUrl || "http://localhost:3001";
    toggleApiModeFields();
    updateApiStatusBadge();
    updateAuthUI();
  }
  function clearApiKey() {
    setStoredApiKey("");
    const input = document.getElementById("settings-api-key");
    if (input) input.value = "";
    updateApiStatusBadge();
    showToast("API Key \u5DF2\u6E05\u9664", "success");
  }
  function saveSettings() {
    S.userProfile.name = document.getElementById("settings-name").value.trim() || "\u4F7F\u7528\u8005";
    S.userProfile.role = document.getElementById("settings-role").value.trim() || "\u77E5\u8B58\u5DE5\u4F5C\u8005";
    S.userProfile.workStart = document.getElementById("settings-work-start").value;
    S.userProfile.workEnd = document.getElementById("settings-work-end").value;
    S.userProfile.peakStart = document.getElementById("settings-peak-start").value;
    S.userProfile.peakEnd = document.getElementById("settings-peak-end").value;
    S.userProfile.streakThreshold = parseInt(document.getElementById("settings-streak-threshold").value);
    S.userProfile.enableConfetti = document.getElementById("settings-confetti").checked;
    S.userProfile.apiEnabled = document.getElementById("settings-api-enabled").checked;
    S.userProfile.apiMode = document.getElementById("settings-api-mode").value;
    S.userProfile.apiModel = document.getElementById("settings-api-model").value;
    const proxyUrl = document.getElementById("settings-api-proxy").value.trim();
    const enterpriseUrl = document.getElementById("settings-enterprise-api").value.trim() || "http://localhost:3001";
    if (S.userProfile.apiMode === "proxy" && proxyUrl && !isSafeHttpUrl(proxyUrl)) {
      return showToast("\u4EE3\u7406\u4F3A\u670D\u5668 URL \u7121\u6548\uFF0C\u8ACB\u4F7F\u7528 http:// \u6216 https://", "error");
    }
    if (!isSafeHttpUrl(enterpriseUrl)) {
      return showToast("\u4F01\u696D API \u4F4D\u5740\u7121\u6548\uFF0C\u8ACB\u4F7F\u7528 http:// \u6216 https://", "error");
    }
    S.userProfile.apiProxyUrl = proxyUrl;
    S.userProfile.enterpriseApiUrl = enterpriseUrl;
    const apiKey = document.getElementById("settings-api-key").value.trim();
    if (apiKey) {
      setStoredApiKey(apiKey);
      S.userProfile.apiEnabled = true;
      document.getElementById("settings-api-enabled").checked = true;
    }
    saveState();
    refreshUI({ dashboard: true, filters: true });
    updateApiStatusBadge();
    showToast("\u8A2D\u5B9A\u5DF2\u5132\u5B58\uFF01", "success");
    showSection("dashboard");
  }
  function loadDailyHistory() {
    try {
      const saved = localStorage.getItem(DAILY_HISTORY_KEY);
      if (saved) S.dailyHistory = JSON.parse(saved);
    } catch (_) {
      S.dailyHistory = {};
    }
  }
  function saveDailyHistory() {
    localStorage.setItem(DAILY_HISTORY_KEY, JSON.stringify(S.dailyHistory));
  }
  function loadTrackedFocus() {
    try {
      const saved = localStorage.getItem(TRACKED_FOCUS_KEY);
      S.trackedFocusByDay = saved && typeof JSON.parse(saved) === "object" ? JSON.parse(saved) : {};
    } catch (_) {
      S.trackedFocusByDay = {};
    }
  }
  function saveTrackedFocus() {
    localStorage.setItem(TRACKED_FOCUS_KEY, JSON.stringify(S.trackedFocusByDay));
  }
  function getTrackedFocusMinutesForDate(dateISO) {
    let mins = Math.max(0, parseInt(S.trackedFocusByDay[dateISO], 10) || 0);
    if (dateISO === getTodayISO() && S.focusSession?.startedAt) {
      mins += Math.max(0, Math.round((Date.now() - S.focusSession.startedAt) / 6e4));
    }
    return mins;
  }
  function recordFocusSessionMinutes(session) {
    if (!session?.startedAt || session.recorded) return 0;
    const elapsed = Math.max(1, Math.round((Date.now() - session.startedAt) / 6e4));
    const today = getTodayISO();
    S.trackedFocusByDay[today] = (S.trackedFocusByDay[today] || 0) + elapsed;
    session.recorded = true;
    saveTrackedFocus();
    invalidateTodayStats();
    return elapsed;
  }
  function mergeTasksArrays(serverTasks, localTasks) {
    const byId = /* @__PURE__ */ new Map();
    for (const t of [...serverTasks || [], ...localTasks || []]) {
      if (!t || t.id === void 0 || t.id === null) continue;
      const prev = byId.get(t.id);
      if (!prev) {
        byId.set(t.id, t);
        continue;
      }
      const prevTs = Date.parse(prev.updatedAt || "") || 0;
      const nextTs = Date.parse(t.updatedAt || "") || 0;
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
    const relevant = S.tasks.filter((t) => t.due <= dateISO);
    const completed = relevant.filter((t) => t.completed);
    const tracked = getTrackedFocusMinutesForDate(dateISO);
    S.dailyHistory[dateISO] = {
      focusMinutes: tracked || completed.reduce((s, t) => s + (t.duration || 0), 0),
      trackedFocusMinutes: tracked,
      completed: completed.length,
      total: relevant.length,
      rate: relevant.length ? Math.round(completed.length / relevant.length * 100) : 0
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
      const d = /* @__PURE__ */ new Date();
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
    const yesterday = /* @__PURE__ */ new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayISO = toLocalISO(yesterday);
    const yesterdayMinutes = S.dailyHistory[yesterdayISO]?.focusMinutes ?? 0;
    if (todayMinutes === 0 && yesterdayMinutes === 0) {
      return { text: "\u5C1A\u7121\u6BD4\u8F03\u6578\u64DA", positive: null };
    }
    if (yesterdayMinutes === 0) {
      return { text: `\u4ECA\u65E5\u5DF2\u5C08\u6CE8 ${(todayMinutes / 60).toFixed(1)}h`, positive: true };
    }
    const diffMin = todayMinutes - yesterdayMinutes;
    const diffH = Math.abs(diffMin / 60).toFixed(1);
    if (diffMin > 0) return { text: `+${diffH}h \u6BD4\u6628\u5929`, positive: true };
    if (diffMin < 0) return { text: `-${diffH}h \u6BD4\u6628\u5929`, positive: false };
    return { text: "\u8207\u6628\u5929\u76F8\u540C", positive: null };
  }
  function applyStreakReward(dateISO, rate, { notify = false } = {}) {
    const earnedKey = "lumina_streak_earned_" + dateISO;
    if (localStorage.getItem(earnedKey)) return false;
    const threshold = S.userProfile.streakThreshold || 80;
    if (rate < threshold) return false;
    localStorage.setItem(earnedKey, "true");
    const prev = /* @__PURE__ */ new Date(dateISO + "T12:00:00");
    prev.setDate(prev.getDate() - 1);
    const prevISO = toLocalISO(prev);
    const lastEarned = localStorage.getItem("lumina_last_streak_date");
    if (lastEarned === prevISO) S.userProfile.streak += 1;
    else S.userProfile.streak = 1;
    S.userProfile.bestStreak = Math.max(S.userProfile.bestStreak || 0, S.userProfile.streak);
    localStorage.setItem("lumina_last_streak_date", dateISO);
    if (notify) {
      showToast(`\u{1F525} \u9054\u6210\u4ECA\u65E5 ${threshold}% \u76EE\u6A19\uFF01\u9023\u7E8C\u9AD8\u6548 ${S.userProfile.streak} \u5929`, "success");
    }
    return true;
  }
  function evaluateStreakForDate(dateISO) {
    const snap = S.dailyHistory[dateISO];
    applyStreakReward(dateISO, snap?.rate ?? 0);
  }
  function processDailyRollover() {
    const today = getTodayISO();
    const lastActive = localStorage.getItem(LAST_ACTIVE_DATE_KEY);
    if (!lastActive) {
      localStorage.setItem(LAST_ACTIVE_DATE_KEY, today);
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
    S.tasks.forEach((t) => {
      if (!t.completed && t.due < today) {
        t.due = today;
        t.wasOverdue = true;
        rolledCount++;
      }
    });
    const daysDiff = Math.max(1, Math.round((/* @__PURE__ */ new Date(today + "T12:00:00") - /* @__PURE__ */ new Date(lastActive + "T12:00:00")) / 864e5));
    S.userProfile.joinDay = (S.userProfile.joinDay || 1) + daysDiff;
    localStorage.setItem(LAST_ACTIVE_DATE_KEY, today);
    recordDailySnapshot();
    recalculateWeeklyScores();
    saveState({ immediateAnalytics: true });
    return { rolledCount };
  }
  function loadState() {
    const savedTasks = localStorage.getItem("lumina_tasks");
    if (savedTasks) {
      S.tasks = JSON.parse(savedTasks);
    } else {
      S.tasks = [];
      localStorage.setItem("lumina_tasks", JSON.stringify(S.tasks));
    }
    loadDailyHistory();
    loadTrackedFocus();
    migrateApiKeyStorage();
    const savedProfile = localStorage.getItem("lumina_profile");
    if (savedProfile) S.userProfile = { ...S.userProfile, ...JSON.parse(savedProfile) };
    const savedEnterprise = localStorage.getItem("lumina_enterprise_session");
    if (savedEnterprise) S.enterpriseSession = JSON.parse(savedEnterprise);
    migrateTasks();
    const rollover = processDailyRollover();
    S.rolledCountOnInit = rollover.rolledCount;
    const dueInput = document.getElementById("task-due");
    if (dueInput) dueInput.value = getTomorrowISO();
    const thresholdSlider = document.getElementById("settings-streak-threshold");
    if (thresholdSlider) {
      thresholdSlider.addEventListener("input", () => {
        document.getElementById("settings-streak-value").innerText = thresholdSlider.value + "%";
      });
    }
    document.getElementById("settings-api-mode")?.addEventListener("change", toggleApiModeFields);
    migrateApiSettings();
    updateApiStatusBadge();
  }
  function exportData() {
    const safeProfile = { ...S.userProfile };
    delete safeProfile.apiKey;
    const data = {
      version: 4,
      exportedAt: (/* @__PURE__ */ new Date()).toISOString(),
      tasks: S.tasks,
      userProfile: safeProfile,
      weeklyScores: S.weeklyScores,
      dailyHistory: S.dailyHistory,
      trackedFocusByDay: S.trackedFocusByDay
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `lumina-backup-${getTodayISO()}.json`;
    a.click();
    showToast("\u8CC7\u6599\u5DF2\u532F\u51FA", "success");
  }
  function persistTasks() {
    localStorage.setItem("lumina_tasks", JSON.stringify(S.tasks));
  }
  function persistProfile() {
    localStorage.setItem("lumina_profile", JSON.stringify(S.userProfile));
  }
  function persistAnalytics(immediate = false) {
    const run = () => {
      recordDailySnapshot();
      recalculateWeeklyScores();
      localStorage.setItem("lumina_weekly", JSON.stringify(S.weeklyScores));
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
    S.persistStateTimer = setTimeout(() => flushPersistState({ immediateAnalytics }), PERSIST_STATE_DELAY_MS);
  }
  function resolveTodayFocusTask() {
    const stats = getTodayStats();
    const pending = stats.pending;
    if (!pending.length) {
      S.todayFocusTaskId = null;
      return null;
    }
    if (S.todayFocusTaskId) {
      const focused = pending.find((t) => t.id === S.todayFocusTaskId);
      if (focused) return focused;
    }
    const next = rankTasksByNextStepScore(pending, getScoringContext())[0];
    S.todayFocusTaskId = next?.id ?? null;
    return next;
  }
  function normalizeFocusSteps(steps) {
    return (steps || []).slice(0, 4).map((s) => ({
      title: s.title || "\u6B65\u9A5F",
      duration: s.duration || "10 \u5206\u9418",
      action: s.action || s.detail || s.title || ""
    })).filter((s) => s.action);
  }
  function buildQuickStartSteps(task) {
    const name = task.name;
    const mins = task.duration || 30;
    const cat = resolveCategory(task);
    if (cat === "meeting") {
      return [
        { title: "\u78BA\u8A8D\u6703\u8B70\u76EE\u6A19", duration: "3 \u5206\u9418", action: `\u5BEB\u4E0B\u300C${name}\u300D\u8981\u9054\u6210\u7684 1 \u500B\u6C7A\u8B70\u6216\u7D50\u8AD6` },
        { title: "\u6E96\u5099\u8B70\u7A0B", duration: "5 \u5206\u9418", action: "\u5217\u51FA 3 \u500B\u8A0E\u8AD6\u91CD\u9EDE\u8207\u9700\u8981\u7684\u8CC7\u6599" },
        { title: "\u7522\u51FA\u6703\u5F8C\u884C\u52D5", duration: `${Math.max(5, mins - 8)} \u5206\u9418`, action: "\u6574\u7406\u5F85\u8FA6\uFF1A\u8AB0\u3001\u505A\u4EC0\u9EBC\u3001\u4F55\u6642\u5B8C\u6210" }
      ];
    }
    if (cat === "learning") {
      return [
        { title: "\u5B9A\u5B78\u7FD2\u7522\u51FA", duration: "3 \u5206\u9418", action: `\u300C${name}\u300D\u5B78\u5B8C\u5F8C\u8981\u80FD\u8AAA\u6E05\u695A\u7684\u4E00\u4EF6\u4E8B` },
        { title: "\u5C08\u6CE8\u5B78\u7FD2", duration: `${Math.min(25, mins - 8)} \u5206\u9418`, action: "\u4E00\u6B21\u53EA\u770B\u4E00\u500B\u4F86\u6E90\uFF0C\u908A\u770B\u908A\u8A18 3 \u500B\u91CD\u9EDE" },
        { title: "\u5167\u5316\u8F38\u51FA", duration: "5 \u5206\u9418", action: "\u7528 3 \u53E5\u8A71\u7E3D\u7D50\uFF0C\u6216\u5BEB\u4E00\u5247\u7D66\u81EA\u5DF1\u7684\u5099\u5FD8" }
      ];
    }
    if (mins <= 15) {
      return [
        { title: "\u555F\u52D5", duration: "2 \u5206\u9418", action: `\u5BEB\u4E0B\u300C${name}\u300D\u4ECA\u5929\u8981\u4EA4\u4ED8\u7684\u6700\u5C0F\u7522\u51FA\uFF08\u4E00\u53E5\u8A71\uFF09` },
        { title: "\u57F7\u884C", duration: `${Math.max(5, mins - 5)} \u5206\u9418`, action: "\u5C08\u6CE8\u7522\u51FA\uFF0C\u4E0D\u6C42\u5B8C\u7F8E\uFF0C\u5148\u6C42\u5B8C\u6210" },
        { title: "\u6536\u5C3E", duration: "3 \u5206\u9418", action: "\u5FEB\u901F\u6AA2\u67E5\uFF1A\u53EF\u4EE5\u7D66\u5225\u4EBA\u770B\u4E86\u55CE\uFF1F\u53EF\u4EE5\u5C31\u9EDE\u300C\u5B8C\u6210\u9019\u4EF6\u300D" }
      ];
    }
    return [
      { title: "\u6E96\u5099", duration: "5 \u5206\u9418", action: "\u95DC\u9589\u5E72\u64FE\u3001\u5099\u9F4A\u9700\u8981\u7684\u6A94\u6848\u8207\u5DE5\u5177" },
      { title: "\u6838\u5FC3\u57F7\u884C", duration: `${Math.min(25, mins - 10)} \u5206\u9418`, action: `\u5C08\u6CE8\u5B8C\u6210\u300C${name}\u300D\u7684\u6700\u5C0F\u53EF\u4EA4\u4ED8\u7248\u672C` },
      { title: "\u6AA2\u67E5\u5B8C\u6210", duration: "5 \u5206\u9418", action: "\u5C0D\u7167\u5B8C\u6210\u6A19\u6E96\uFF0C\u88DC\u6F0F\u6216\u76F4\u63A5\u6A19\u8A18\u5B8C\u6210" }
    ];
  }
  function getStepsForTask(task) {
    const cachedId = S.taskCoachPlans.get(task.id);
    const cached = cachedId ? S.coachPlans.get(cachedId) : null;
    if (cached?.steps?.length) return normalizeFocusSteps(cached.steps);
    return buildQuickStartSteps(task);
  }
  function clearFocusTimer() {
    if (S.focusTimerInterval) {
      clearInterval(S.focusTimerInterval);
      S.focusTimerInterval = null;
    }
  }
  function tickFocusTimer() {
    if (!S.focusSession?.endsAt) return;
    const el = document.getElementById("focus-timer-display");
    const remaining = Math.max(0, S.focusSession.endsAt - Date.now());
    const mins = Math.floor(remaining / 6e4);
    const secs = Math.floor(remaining % 6e4 / 1e3);
    if (el) el.textContent = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    if (remaining <= 0 && S.focusTimerInterval) {
      clearFocusTimer();
      showToast("\u6642\u9593\u5230\uFF01\u53EF\u4EE5\u6536\u5C3E\u6216\u9EDE\u300C\u5B8C\u6210\u9019\u4EF6\u300D", "success");
    }
  }
  function startFocusTimer(durationMins) {
    clearFocusTimer();
    if (!S.focusSession) return;
    S.focusSession.endsAt = Date.now() + (durationMins || 30) * 60 * 1e3;
    tickFocusTimer();
    S.focusTimerInterval = setInterval(tickFocusTimer, 1e3);
  }
  function endFocusSession(recordTime = true) {
    if (recordTime && S.focusSession?.startedAt && !S.focusSession.recorded) {
      recordFocusSessionMinutes(S.focusSession);
    }
    clearFocusTimer();
    S.focusSession = null;
    const card = document.getElementById("next-step-card");
    if (card) card.classList.remove("focus-session-active");
  }
  function renderFocusSessionPanel(task) {
    if (!S.focusSession || S.focusSession.taskId !== task.id) return "";
    const steps = S.focusSession.steps || [];
    const cur = Math.min(S.focusSession.currentStep || 0, Math.max(0, steps.length - 1));
    const current = steps[cur];
    const isLastStep = cur >= steps.length - 1;
    const hasCoachPlan = !!S.focusSession.planId;
    return `
        <div class="focus-session-panel mt-4 pt-4 border-t border-indigo-500/25">
            <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div class="flex items-center gap-3">
                    <span class="focus-session-badge"><i class="fa-solid fa-circle text-[6px]"></i> \u5C08\u6CE8\u9032\u884C\u4E2D</span>
                    <span id="focus-timer-display" class="focus-timer">--:--</span>
                    <span class="text-[10px] text-slate-500">\u6B65\u9A5F ${cur + 1}/${steps.length}${hasCoachPlan ? " \xB7 \u6559\u7DF4\u65B9\u6848" : ""}</span>
                </div>
                <button type="button" onclick="extendFocusTimer(5)" class="text-[10px] px-2 py-1 rounded-lg border border-slate-600 text-slate-400 hover:text-slate-300 hover:bg-slate-800">+5 \u5206</button>
            </div>
            ${current ? `
            <div class="focus-first-step mb-3">
                <div class="text-[10px] uppercase tracking-wider text-emerald-400 font-semibold mb-1">\u73FE\u5728\u5C31\u505A \xB7 ${escapeHtml(current.title)}</div>
                <div class="text-sm text-slate-200 leading-relaxed">${escapeHtml(current.action)}</div>
            </div>` : ""}
            <ol class="focus-step-list">
                ${steps.map((s, i) => {
      const cls = i < cur ? "focus-step-item-done" : i === cur ? "focus-step-item-active" : "";
      return `
                    <li class="focus-step-item ${cls}">
                        <span class="focus-step-num">${i + 1}</span>
                        <div class="min-w-0">
                            <div class="font-medium text-xs text-slate-200">${escapeHtml(s.title)}</div>
                            <div class="text-[10px] text-slate-500 mt-0.5">${escapeHtml(s.duration)}</div>
                        </div>
                    </li>`;
    }).join("")}
            </ol>
            <div class="flex flex-wrap gap-2 mt-4">
                <button type="button" onclick="advanceFocusStep(${task.id})" class="text-sm px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-medium">
                    <i class="fa-solid fa-${isLastStep ? "check" : "forward-step"} mr-1"></i>${isLastStep ? "\u5B8C\u6210\u9019\u4EF6" : "\u5B8C\u6210\u9019\u6B65"}
                </button>
                <button type="button" onclick="openCoachForTask(${task.id})" class="text-sm px-4 py-2 rounded-xl border border-sky-500/40 hover:bg-sky-500/10 text-sky-300">\u6559\u7DF4\u5E36\u6211\u505A</button>
                <button type="button" onclick="endFocusSession();refreshUI({dashboard:true,filters:false})" class="text-sm px-4 py-2 rounded-xl border border-slate-600 hover:bg-slate-800 text-slate-400">\u66AB\u505C</button>
            </div>
        </div>`;
  }
  function startTodayTask(taskId, opts = {}) {
    const task = S.tasks.find((t) => t.id === taskId);
    if (!task || task.completed) return;
    S.todayFocusTaskId = taskId;
    if (S.focusSession && S.focusSession.taskId !== taskId) {
      endFocusSession();
    }
    if (!opts.force && S.focusSession?.taskId === taskId) {
      showSection("dashboard");
      pulseNextStepCard();
      if (S.focusSession.endsAt > Date.now() && !S.focusTimerInterval) {
        tickFocusTimer();
        S.focusTimerInterval = setInterval(tickFocusTimer, 1e3);
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
    showSection("dashboard");
    refreshUI({ dashboard: true, filters: false });
    startFocusTimer(task.duration || 30);
    pulseNextStepCard();
    const card = document.getElementById("next-step-card");
    if (card) card.classList.add("focus-session-active");
    if (!opts.quiet) {
      const hint = planId ? "\uFF08\u5DF2\u8F09\u5165\u6559\u7DF4\u65B9\u6848\uFF09" : "";
      showToast(`\u958B\u59CB\uFF1A${task.name}${hint}`, "success");
    }
  }
  function rebuildTaskIndex() {
    S.taskById = /* @__PURE__ */ new Map();
    for (const t of S.tasks) {
      if (t?.id !== void 0 && t?.id !== null) S.taskById.set(t.id, t);
    }
  }
  function rebuildTodayQueueMap() {
    const pending = rankTasksByNextStepScore(getTodayStats().pending, getScoringContext());
    S.todayQueueMap = /* @__PURE__ */ new Map();
    pending.forEach((t, i) => S.todayQueueMap.set(t.id, i));
    return S.todayQueueMap;
  }
  function buildSyncedEnterpriseIdSet() {
    const ids = /* @__PURE__ */ new Set();
    for (const t of S.tasks) {
      if (t.enterpriseTaskId) ids.add(t.enterpriseTaskId);
    }
    return ids;
  }
  function migrateTasks() {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    S.tasks = S.tasks.map((t) => ({
      ...t,
      category: t.category || inferCategory(t.name, t.energy || 3),
      updatedAt: t.updatedAt || now
    }));
    rebuildTaskIndex();
  }
  function getFilteredTasks(taskList) {
    if (S.activeCategoryFilter === "all") return taskList;
    return taskList.filter((t) => resolveCategory(t) === S.activeCategoryFilter);
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
    if (schedule && $("scheduler")?.classList.contains("active")) {
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
  function renderCategoryFilters() {
    const counts = getCategoryCounts();
    const chips = [
      { id: "all", label: "\u5168\u90E8", color: "border-slate-600 text-slate-300" },
      ...Object.entries(CATEGORIES).map(([id, c]) => ({ id, label: c.label, color: c.color }))
    ];
    const html = chips.map((chip) => {
      const count = counts[chip.id] || 0;
      const active = S.activeCategoryFilter === chip.id;
      return `<button onclick="setCategoryFilter('${chip.id}')" class="filter-chip text-[10px] px-2.5 py-1 rounded-full border border-slate-700 ${chip.color} ${active ? "active !border-indigo-500 !text-indigo-300" : "hover:bg-slate-800"}">${chip.label}${count > 0 ? ` (${count})` : ""}</button>`;
    }).join("");
    ["scheduler-category-filters", "dashboard-category-filters"].forEach((id) => {
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
    const card = document.getElementById("next-step-card");
    if (!card) return;
    card.classList.remove("next-step-card-pulse");
    void card.offsetWidth;
    card.classList.add("next-step-card-pulse");
    setTimeout(() => card.classList.remove("next-step-card-pulse"), 700);
    card.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  function renderPersonalTaskRow(task, variant = "scheduler") {
    const cat = resolveCategory(task);
    const isDashboard = variant === "dashboard";
    const checked = task.completed ? "checked" : "";
    const dashFlag = isDashboard ? ", true" : "";
    const onChange = `onchange="toggleTaskComplete(${task.id}, this${dashFlag})"`;
    if (isDashboard) {
      const isActive = !task.completed && task.id === S.todayFocusTaskId;
      const isRunning = isActive && S.focusSession?.taskId === task.id;
      const queue = getTodayQueuePosition(task.id);
      const queueLabel = queue.index >= 0 && !task.completed ? `<span class="text-[10px] text-indigo-400/80">#${queue.index + 1}</span>` : "";
      const rowClass = task.completed ? "dashboard-task-row dashboard-task-row-done" : `dashboard-task-row task-card group${isActive ? " dashboard-task-row-active" : ""}`;
      return `<div class="${rowClass} flex items-center justify-between px-4 py-3 bg-slate-950 border border-slate-700 rounded-2xl"
            data-task-id="${task.id}" onclick="focusTodayTask(${task.id}, event)" role="button" tabindex="0"
            onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();focusTodayTask(${task.id},event)}">
            <div class="flex items-center gap-x-3 flex-1 min-w-0">
                <input type="checkbox" ${checked} ${onChange} onclick="event.stopPropagation()" class="accent-indigo-500 w-4 h-4 cursor-pointer flex-shrink-0">
                <div class="min-w-0 flex-1">
                    <div class="font-medium text-sm truncate ${task.completed ? "line-through text-slate-500" : ""}">${escapeHtml(task.name)}</div>
                    <div class="text-[10px] text-slate-500 flex flex-wrap items-center gap-1">${queueLabel} ${task.duration} \u5206\u9418 \u2022 <span class="cat-badge ${getCategoryColor(cat)}">${getCategoryLabel(cat)}</span> ${renderTaskBadges(task)}</div>
                </div>
            </div>
            <div class="flex items-center gap-1.5 flex-shrink-0">
                ${!task.completed ? `<button type="button" onclick="event.stopPropagation();startTodayTask(${task.id})" class="task-row-start-btn ${isActive ? "" : "hidden sm:inline-flex"}${isRunning ? " task-row-start-btn-active" : ""}">${isRunning ? "\u9032\u884C\u4E2D" : isActive ? "\u7E7C\u7E8C" : "\u958B\u59CB"}</button>` : ""}
                <button type="button" onclick="event.stopPropagation();openTaskEdit(${task.id})" class="text-slate-400 hover:text-indigo-300 p-1.5 ${task.completed ? "" : "opacity-70 hover:opacity-100"}" title="\u7DE8\u8F2F"><i class="fa-solid fa-pen text-xs"></i></button>
            </div>
        </div>`;
    }
    return `<div class="task-card flex items-center gap-x-3 px-4 py-3.5 bg-slate-950 border border-slate-700 rounded-2xl group ${task.completed ? "opacity-60" : ""}">
        <input type="checkbox" ${checked} ${onChange} class="accent-indigo-500 w-[17px] h-[17px] cursor-pointer flex-shrink-0">
        <div class="flex-1 min-w-0">
            <div class="font-medium text-sm ${task.completed ? "line-through text-slate-400" : ""}">${escapeHtml(task.name)}</div>
            <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs mt-0.5">
                <span class="font-mono text-slate-400">${task.duration} min</span>
                <span class="cat-badge ${getCategoryColor(cat)}">${getCategoryLabel(cat)}</span>
                <span class="px-2 py-px rounded text-[10px] ${getEnergyColor(task.energy)}">${getEnergyLabel(task.energy)}</span>
                <span class="text-slate-500">${task.due}</span>
                ${renderTaskBadges(task)}
            </div>
        </div>
        <div class="flex items-center gap-x-1 opacity-0 group-hover:opacity-100 transition-all">
            <button onclick="openTaskEdit(${task.id})" class="text-slate-400 hover:text-indigo-300 p-1.5" title="\u7DE8\u8F2F\u4EFB\u52D9"><i class="fa-solid fa-pen text-xs"></i></button>
            ${task.duration >= 60 && !task.completed ? `<button onclick="splitTask(${task.id})" class="text-indigo-400 hover:text-indigo-300 p-1.5" title="\u62C6\u5206\u4EFB\u52D9"><i class="fa-solid fa-scissors text-xs"></i></button>` : ""}
            <button onclick="deleteTask(${task.id}, event)" class="text-red-400 hover:text-red-500 p-1.5"><i class="fa-solid fa-trash text-xs"></i></button>
        </div>
    </div>`;
  }
  function getActiveParentGoals() {
    const groups = {};
    S.tasks.filter((t) => t.parentGoalId).forEach((t) => {
      if (!groups[t.parentGoalId]) {
        groups[t.parentGoalId] = { id: t.parentGoalId, name: t.parentGoalName || "\u5927\u76EE\u6A19", total: 0, done: 0 };
      }
      groups[t.parentGoalId].total++;
      if (t.completed) groups[t.parentGoalId].done++;
    });
    return Object.values(groups).filter((g) => g.done < g.total);
  }
  function renderActiveGoalsPanel() {
    const panel = document.getElementById("active-goals-panel");
    if (!panel) return;
    const goals = getActiveParentGoals();
    if (!goals.length) {
      panel.classList.add("hidden");
      panel.innerHTML = "";
      return;
    }
    panel.classList.remove("hidden");
    panel.innerHTML = goals.map((g) => {
      const pct = Math.round(g.done / g.total * 100);
      return `<div class="goal-progress-card">
            <div class="flex items-center justify-between gap-2">
                <div class="text-xs text-purple-300 font-medium truncate">\u{1F3AF} ${escapeHtml(g.name)}</div>
                <div class="text-[10px] text-slate-400 flex-shrink-0">${g.done}/${g.total} \u6B65\u9A5F</div>
            </div>
            <div class="goal-progress-bar"><div class="goal-progress-fill" style="width:${pct}%"></div></div>
        </div>`;
    }).join("");
  }
  function renderTaskBadges(task) {
    let html = "";
    if (task.wasOverdue && !task.completed) {
      html += `<span class="task-overdue-badge">\u5EF6\u5F8C</span>`;
    }
    if (task.parentGoalName) {
      html += `<span class="task-goal-badge" title="${escapeHtml(task.parentGoalName)}">\u{1F3AF} ${escapeHtml(task.parentGoalName)}</span>`;
    }
    return html;
  }
  function closeTaskEdit() {
    S.editingTaskId = null;
    document.getElementById("task-edit-modal")?.classList.add("hidden");
  }
  function saveTaskEdit() {
    if (!S.editingTaskId) return;
    const task = S.tasks.find((t) => t.id === S.editingTaskId);
    if (!task) return;
    const name = document.getElementById("edit-task-name").value.trim();
    if (!name) {
      showToast("\u8ACB\u8F38\u5165\u4EFB\u52D9\u540D\u7A31", "error");
      return;
    }
    task.name = name;
    task.duration = Math.max(5, parseInt(document.getElementById("edit-task-duration").value) || 30);
    task.energy = parseInt(document.getElementById("edit-task-energy").value) || 3;
    task.category = document.getElementById("edit-task-category").value;
    task.due = document.getElementById("edit-task-due").value || getTodayISO();
    if (task.due >= getTodayISO()) task.wasOverdue = false;
    saveState();
    closeTaskEdit();
    refreshUI({ dashboard: true, scheduler: true, schedule: true });
    showToast("\u4EFB\u52D9\u5DF2\u66F4\u65B0", "success");
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
  function focusQuickAdd() {
    showSection("dashboard");
    setTimeout(() => {
      const input = document.getElementById("quick-task-input");
      if (input) {
        input.focus();
        input.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 200);
  }
  function toggleDashStats() {
    const panel = document.getElementById("dash-stats-panel");
    const chevron = document.getElementById("dash-stats-chevron");
    const toggle = document.getElementById("dash-stats-toggle");
    if (!panel) return;
    const hidden = panel.classList.toggle("hidden");
    if (chevron) chevron.style.transform = hidden ? "" : "rotate(180deg)";
    if (toggle) {
      const span = toggle.querySelector("span");
      if (span) span.textContent = hidden ? "\u67E5\u770B\u6578\u64DA\u6458\u8981" : "\u6536\u8D77\u6578\u64DA\u6458\u8981";
    }
  }
  function updateNextStepCard(stats) {
    const el = $("next-step-card");
    if (!el) return;
    stats = stats || getTodayStats();
    const todayPending = stats.pending;
    const futurePending = stats.futurePending;
    const scoreCtx = getScoringContext();
    if (S.tasks.length === 0) {
      el.innerHTML = `<div class="next-step-label">\u4ECA\u65E5\u7B2C\u4E00\u6B65</div>
               <div class="font-semibold text-lg">\u4F60\u6709\u500B\u5927\u76EE\u6A19\uFF0C\u4F46\u4E0D\u77E5\u5F9E\u54EA\u958B\u59CB\uFF1F</div>
               <p class="text-sm text-slate-400 mt-1">\u8F38\u5165\u76EE\u6A19\uFF0CAI \u5E6B\u4F60\u62C6\u89E3\u4E26\u63A8\u85A6\u4ECA\u5929\u8A72\u505A\u7684\u7B2C\u4E00\u4EF6</p>
               <button onclick="openDecomposeTab()" class="mt-3 text-sm px-4 py-2 rounded-xl bg-indigo-500 hover:bg-indigo-600 text-white font-medium">\u5206\u89E3\u6211\u7684\u76EE\u6A19</button>
               <button onclick="focusQuickAdd()" class="mt-2 text-sm px-4 py-2 rounded-xl border border-slate-600 hover:bg-slate-800 text-slate-300">\u6216\u76F4\u63A5\u65B0\u589E\u4EFB\u52D9</button>`;
      return;
    }
    if (todayPending.length === 0) {
      if (futurePending.length > 0) {
        const next = futurePending.sort((a, b) => a.due.localeCompare(b.due))[0];
        el.innerHTML = `<div class="next-step-label">\u4ECA\u65E5\u72C0\u614B</div>
               <div class="font-semibold text-emerald-300">\u{1F389} \u4ECA\u65E5\u4EFB\u52D9\u5DF2\u5168\u90E8\u5B8C\u6210\uFF01</div>
               <p class="text-sm text-slate-400 mt-1">\u4E4B\u5F8C\u9084\u6709 ${futurePending.length} \u9805\u5F85\u8FA6\uFF0C\u6700\u8FD1\u4E00\u9805\uFF1A<strong class="text-slate-300">${escapeHtml(next.name)}</strong>\uFF08${next.due}\uFF09</p>
               <button onclick="showSection('scheduler')" class="mt-3 text-sm px-4 py-2 rounded-xl border border-slate-600 hover:bg-slate-800 text-slate-300">\u67E5\u770B\u5168\u90E8\u4EFB\u52D9</button>`;
      } else {
        el.innerHTML = `<div class="next-step-label">\u4ECA\u65E5\u72C0\u614B</div>
               <div class="font-semibold text-emerald-300">\u{1F389} \u6240\u6709\u4EFB\u52D9\u5DF2\u5B8C\u6210\uFF01</div>
               <p class="text-sm text-slate-400 mt-1">\u4F11\u606F\u4E00\u4E0B\uFF0C\u6216\u70BA\u660E\u5929\u65B0\u589E\u4EFB\u52D9</p>`;
      }
      return;
    }
    const top = resolveTodayFocusTask();
    if (!top) return;
    const reason = getNextStepReason(top);
    const queue = getTodayQueuePosition(top.id);
    const queueText = queue.total > 1 ? `\u7B2C ${queue.index + 1} / ${queue.total} \u9805` : "\u50C5\u5269 1 \u9805";
    const inFocus = S.focusSession && S.focusSession.taskId === top.id;
    const actionButtons = inFocus ? "" : `
        <div class="flex flex-wrap gap-2 mt-3">
            <button type="button" onclick="startTodayTask(${top.id})" class="text-sm px-4 py-2 rounded-xl bg-indigo-500 hover:bg-indigo-600 text-white font-medium">\u958B\u59CB\u505A\u9019\u4EF6</button>
            <button type="button" onclick="openCoachForTask(${top.id})" class="text-sm px-4 py-2 rounded-xl border border-sky-500/40 hover:bg-sky-500/10 text-sky-300">\u6559\u7DF4\u5E36\u6211\u505A</button>
            ${queue.total > 1 ? `<button type="button" onclick="skipToNextTodayTask()" class="text-sm px-4 py-2 rounded-xl border border-slate-600 hover:bg-slate-800 text-slate-300">\u5148\u505A\u4E0B\u4E00\u9805</button>` : ""}
        </div>
        <p class="text-[10px] text-slate-500 mt-3">${S.taskCoachPlans.has(top.id) ? "\u5DF2\u6709\u6559\u7DF4\u65B9\u6848\uFF0C\u9EDE\u958B\u59CB\u6703\u76F4\u63A5\u8F09\u5165" : "\u958B\u59CB\u505A\u9019\u4EF6 \u2192 \u5C08\u6CE8\u6A21\u5F0F\uFF1B\u6559\u7DF4\u5E36\u6211\u505A \u2192 \u5B8C\u6574\u65B9\u6848\u8207\u6587\u4EF6"}</p>`;
    el.classList.toggle("focus-session-active", !!inFocus);
    el.innerHTML = `
        <div class="next-step-label">${inFocus ? "\u5C08\u6CE8\u57F7\u884C\u4E2D" : "\u4ECA\u65E5\u9032\u884C\u4E2D"} <span class="text-slate-500 font-normal">\uFF08${queueText}\uFF09</span></div>
        <div class="flex items-start gap-3 mt-1">
            <input type="checkbox" ${top.completed ? "checked" : ""} onchange="toggleTaskComplete(${top.id}, this, true)" onclick="event.stopPropagation()"
                class="accent-indigo-500 w-5 h-5 cursor-pointer flex-shrink-0 mt-1" aria-label="\u6A19\u8A18\u5B8C\u6210">
            <div class="flex-1 min-w-0">
                <div class="font-semibold text-lg leading-snug">${escapeHtml(top.name)}</div>
                <div class="flex flex-wrap items-center gap-3 mt-2 text-xs text-slate-400">
                    <span>${top.duration} \u5206\u9418</span>
                    <span class="cat-badge ${getCategoryColor(resolveCategory(top))}">${getCategoryLabel(resolveCategory(top))}</span>
                    <span class="text-indigo-400/80">${reason}</span>
                </div>
            </div>
        </div>
        ${actionButtons}
        ${renderFocusSessionPanel(top)}`;
    if (inFocus) tickFocusTimer();
  }
  function quickAddTask() {
    const input = document.getElementById("quick-task-input");
    if (!input.value.trim()) return;
    const name = input.value.trim();
    const newTask = {
      id: Date.now(),
      name,
      duration: 30,
      energy: 3,
      category: inferCategory(name, 3),
      due: getTodayISO(),
      completed: false,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    S.tasks.unshift(newTask);
    saveState();
    input.value = "";
    showToast("\u4EFB\u52D9\u5DF2\u5FEB\u901F\u52A0\u5165\uFF01", "success");
    refreshUI({ dashboard: true, scheduler: true, filters: true, schedule: true });
  }
  function renderTaskList() {
    const container = document.getElementById("task-list");
    if (!container) return;
    const filtered = getFilteredTasks(S.tasks);
    const totalLabel = S.activeCategoryFilter === "all" ? `(${S.tasks.length} \u9805)` : `(${filtered.length}/${S.tasks.length} \u9805)`;
    setElText("task-count", totalLabel);
    if (S.tasks.length === 0) {
      S.taskListVirtual = null;
      container.onscroll = null;
      container.innerHTML = `<div class="text-center py-8 text-sm text-slate-400">\u76EE\u524D\u6C92\u6709\u4EFB\u52D9<br><span class="text-xs">\u5728\u4E0A\u65B9\u65B0\u589E\u4EFB\u52D9\u958B\u59CB\u898F\u5283</span></div>`;
      return;
    }
    if (filtered.length === 0) {
      S.taskListVirtual = null;
      container.onscroll = null;
      container.innerHTML = `<div class="text-center py-8 text-sm text-slate-400">\u6B64\u5206\u985E\u6C92\u6709\u4EFB\u52D9<br><span class="text-xs">\u8A66\u8A66\u5176\u4ED6\u7BE9\u9078\u689D\u4EF6</span></div>`;
      return;
    }
    const mount = globalThis.LuminaVirtual?.mountVirtualList;
    if (!mount) {
      container.innerHTML = filtered.map((t) => renderPersonalTaskRow(t, "scheduler")).join("");
      return;
    }
    if (!S.taskListVirtual || container.dataset.virtual === void 0) {
      S.taskListVirtual = mount(container, {
        items: filtered,
        renderRow: (task) => renderPersonalTaskRow(task, "scheduler")
      });
      return;
    }
    S.taskListVirtual.refresh(filtered);
  }
  function clearAllTasks() {
    if (!confirm("\u78BA\u5B9A\u6E05\u7A7A\u6240\u6709\u4EFB\u52D9\uFF1F")) return;
    S.tasks = [];
    saveState();
    refreshUI({ scheduler: true, filters: true });
    setElHtml("timeline-view", '<div class="text-center text-xs py-8 text-slate-400">\u6E05\u7A7A\u5F8C\u8ACB\u65B0\u589E\u4EFB\u52D9\u4E26\u9EDE\u64CA\u300C\u667A\u80FD\u6392\u7A0B\u300D</div>');
    setElText("total-scheduled-time", "0h 0m");
  }
  function quickStartToday() {
    if (S.tasks.length === 0) {
      showToast("\u5148\u5206\u89E3\u4E00\u500B\u5927\u76EE\u6A19\uFF0C\u627E\u51FA\u4ECA\u65E5\u7B2C\u4E00\u6B65", "success");
      openDecomposeTab();
      return;
    }
    const next = getNextRecommendedTask("today");
    if (!next) {
      showToast("\u4ECA\u65E5\u4EFB\u52D9\u5DF2\u5B8C\u6210\uFF01", "success");
      showSection("dashboard");
      return;
    }
    S.todayFocusTaskId = next.id;
    startTodayTask(next.id);
  }
  function buildTimeBlocks() {
    const peak = S.userProfile.peakStart || "09:00";
    const workEnd = S.userProfile.workEnd || "18:00";
    const peakEnd = S.userProfile.peakEnd || "12:30";
    return [
      { start: peak, end: addMinutes(peak, 90), label: "\u6668\u9593\u6DF1\u5EA6\u5DE5\u4F5C", maxEnergy: 5, preferredCategories: ["deep"], capacity: 90 },
      { start: addMinutes(peak, 105), end: peakEnd, label: "\u4E0A\u5348\u5C08\u6CE8\u6642\u6BB5", maxEnergy: 4, preferredCategories: ["deep", "execution"], capacity: 90 },
      { start: "13:30", end: "15:00", label: "\u4E0B\u5348\u57F7\u884C\u6642\u6BB5", maxEnergy: 3, preferredCategories: ["execution", "meeting"], capacity: 90 },
      { start: "15:15", end: "16:45", label: "\u5275\u610F\u8207\u5354\u4F5C", maxEnergy: 4, preferredCategories: ["meeting", "execution", "learning"], capacity: 90 },
      { start: "17:00", end: workEnd, label: "\u6536\u5C3E\u8207\u898F\u5283", maxEnergy: 2, preferredCategories: ["admin", "learning"], capacity: 60 }
    ];
  }
  function assignTasksToBlocks(pendingTasks, blocks) {
    const pool = pendingTasks.map(scoreTaskPriority);
    pool.sort((a, b) => b.priorityScore - a.priorityScore);
    const slots = blocks.map((block) => ({ block, tasks: [], load: 0 }));
    const remaining = [];
    for (const task of pool) {
      let bestIdx = -1;
      let bestFit = -Infinity;
      for (let i = 0; i < slots.length; i++) {
        const fit = scoreTaskBlockFit(task, slots[i]);
        if (fit > bestFit) {
          bestFit = fit;
          bestIdx = i;
        }
      }
      if (bestIdx >= 0) {
        slots[bestIdx].tasks.push(task);
        slots[bestIdx].load += task.duration;
      } else {
        remaining.push(task);
      }
    }
    return { assigned: slots.filter((s) => s.tasks.length > 0), remaining };
  }
  function optimizeSchedule(silent = false, force = false) {
    if (!force && !$("scheduler")?.classList.contains("active")) return;
    const container = document.getElementById("timeline-view");
    if (!container) return;
    container.innerHTML = "";
    const pendingTasks = S.tasks.filter((t) => !t.completed);
    if (pendingTasks.length === 0) {
      container.innerHTML = `<div class="text-center py-6"><span class="text-emerald-400">\u{1F389} \u4ECA\u65E5\u6240\u6709\u4EFB\u52D9\u5DF2\u5B8C\u6210\uFF01</span><br><span class="text-xs text-slate-400">\u4F11\u606F\u4E00\u4E0B\u6216\u898F\u5283\u660E\u5929\u7684\u76EE\u6A19\u5427</span></div>`;
      setElText("total-scheduled-time", "0h 0m");
      return;
    }
    const timeBlocks = buildTimeBlocks();
    const { assigned, remaining } = assignTasksToBlocks(pendingTasks, timeBlocks);
    let totalMinutes = 0;
    assigned.forEach((slot) => {
      const slotDiv = document.createElement("div");
      slotDiv.className = `timeline-slot flex gap-x-4 p-4 rounded-3xl border border-slate-700 bg-slate-950`;
      const loadPct = Math.round(slot.load / slot.block.capacity * 100);
      const tasksHTML = slot.tasks.map((t) => `
            <div class="flex items-center justify-between text-sm py-1.5 px-3 bg-slate-900 rounded-2xl mb-1.5 last:mb-0">
                <div class="flex items-center gap-x-2 min-w-0">
                    <span class="font-medium truncate">${escapeHtml(t.name)}</span>
                    <span class="cat-badge ${getCategoryColor(t.category)}">${getCategoryLabel(t.category)}</span>
                </div>
                <div class="flex items-center gap-x-2 text-xs flex-shrink-0 pl-3">
                    <span class="font-mono text-emerald-300">${t.duration}m</span>
                    <span class="px-2 py-px rounded-xl text-[10px] ${getEnergyColor(t.energy)}">${getEnergyLabel(t.energy)}</span>
                </div>
            </div>
        `).join("");
      slotDiv.innerHTML = `
            <div class="w-24 flex-shrink-0 pt-1">
                <div class="font-mono text-lg font-semibold text-indigo-300">${slot.block.start}</div>
                <div class="text-xs text-slate-500">\u2014 ${slot.block.end}</div>
                <div class="mt-3">
                    <div class="text-xs px-3 py-1 rounded-2xl bg-indigo-500/10 text-indigo-300 w-fit">${slot.block.label}</div>
                </div>
            </div>
            <div class="flex-1 min-w-0">
                <div class="mb-2 flex items-center justify-between">
                    <div class="text-xs text-slate-400">\u4EFB\u52D9\u8CA0\u8F09\uFF1A${slot.load}/${slot.block.capacity} \u5206\u9418 (${loadPct}%)</div>
                    <div class="text-xs px-2 py-px bg-emerald-500/10 text-emerald-300 rounded">${slot.tasks.length} \u9805\u4EFB\u52D9</div>
                </div>
                <div class="h-1 bg-slate-800 rounded-full mb-3 overflow-hidden">
                    <div class="h-1 bg-indigo-500 rounded-full transition-all duration-700" style="width:${loadPct}%"></div>
                </div>
                ${tasksHTML}
            </div>
        `;
      container.appendChild(slotDiv);
      totalMinutes += slot.load;
    });
    if (remaining.length > 0) {
      const remainingDiv = document.createElement("div");
      remainingDiv.className = `mt-4 p-4 border border-dashed border-amber-500/40 rounded-3xl text-xs bg-amber-500/5`;
      const itemsHTML = remaining.map((r) => `
            <div class="flex items-center justify-between py-2 border-b border-slate-800 last:border-0">
                <div class="flex items-center gap-x-2 min-w-0">
                    <span class="text-slate-200 truncate">${escapeHtml(r.name)}</span>
                    <span class="cat-badge ${getCategoryColor(r.category)}">${getCategoryLabel(r.category)}</span>
                    <span class="text-slate-500 font-mono">${r.duration}m</span>
                </div>
                ${r.duration >= 45 ? `<button onclick="splitTask(${r.id})" class="text-indigo-400 hover:text-indigo-300 px-2 py-1 rounded-lg border border-indigo-500/30 flex-shrink-0 ml-2"><i class="fa-solid fa-scissors text-[10px]"></i> \u62C6\u5206</button>` : ""}
            </div>
        `).join("");
      remainingDiv.innerHTML = `
            <div class="font-medium text-amber-300 mb-2 flex items-center gap-x-2">
                <i class="fa-solid fa-triangle-exclamation"></i>
                <span>${remaining.length} \u9805\u4EFB\u52D9\u672A\u80FD\u6392\u5165\uFF08\u80FD\u91CF/\u6642\u6BB5/\u5BB9\u91CF\u4E0D\u5339\u914D\uFF09</span>
            </div>
            ${itemsHTML}
            <div class="text-[10px] text-slate-400 mt-2">\u{1F4A1} \u5EFA\u8B70\uFF1A\u9EDE\u64CA\u300C\u62C6\u5206\u300D\u5C07\u5927\u4EFB\u52D9\u5207\u534A\uFF0C\u6216\u8ABF\u6574\u5206\u985E/\u80FD\u91CF\u5F8C\u91CD\u65B0\u512A\u5316</div>
        `;
      container.appendChild(remainingDiv);
    }
    setElText("total-scheduled-time", `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`);
    if (!silent) {
      const msg = remaining.length > 0 ? `\u6392\u7A0B\u5B8C\u6210\uFF0C${remaining.length} \u9805\u5F85\u8655\u7406` : "\u5DF2\u4F9D\u80FD\u91CF\u66F2\u7DDA\u8207\u6642\u6BB5\u5BB9\u91CF\u5B8C\u6210\u6392\u7A0B";
      showToast(msg, remaining.length > 0 ? "error" : "success");
    }
  }
  function inferCategory(name, energy) {
    const lower = name.toLowerCase();
    if (/會議|同步|討論|standup|review 會/.test(lower)) return "meeting";
    if (/學習|課程|閱讀|研究|prompt/.test(lower)) return "learning";
    if (/郵件|回覆|行政|okr|追蹤|整理/.test(lower)) return "admin";
    if (/撰寫|設計|開發|分析|規劃|審核|提案|簡報/.test(lower)) return energy >= 4 ? "deep" : "execution";
    if (energy >= 5) return "deep";
    if (energy >= 4) return "deep";
    if (energy === 3) return "execution";
    return "admin";
  }
  function getCategoryLabel(cat) {
    return CATEGORIES[cat]?.label || "\u5176\u4ED6";
  }
  function getCategoryColor(cat) {
    return CATEGORIES[cat]?.color || "bg-slate-500/10 text-slate-300";
  }
  function resolveCategory(task) {
    return task.category || inferCategory(task.name, task.energy || 3);
  }
  function invalidateTodayStats() {
    S.todayStatsCache = null;
    S.todayQueueMap = null;
    S.categoryCountsCache = null;
  }
  function computeTodayStats() {
    const today = getTodayISO();
    const stats = {
      today,
      relevant: [],
      pending: [],
      futurePending: [],
      completed: 0,
      rate: 0,
      focusMinutes: 0,
      futureCount: 0,
      highEnergyPending: 0
    };
    for (const t of S.tasks) {
      if (!t.completed && t.energy >= 4) stats.highEnergyPending++;
      if (t.due <= today) {
        stats.relevant.push(t);
        if (t.completed) {
          stats.completed++;
        } else {
          stats.pending.push(t);
        }
      } else if (!t.completed) {
        stats.futurePending.push(t);
      }
    }
    stats.futureCount = stats.futurePending.length;
    stats.rate = stats.relevant.length ? Math.round(stats.completed / stats.relevant.length * 100) : 0;
    stats.focusMinutes = getTrackedFocusMinutesForDate(today);
    return stats;
  }
  function getTodayStats() {
    if (!S.todayStatsCache) S.todayStatsCache = computeTodayStats();
    return S.todayStatsCache;
  }
  function getScoringContext() {
    return {
      today: getTodayISO(),
      hour: (/* @__PURE__ */ new Date()).getHours(),
      peakStart: parseHour(S.userProfile.peakStart),
      peakEnd: parseHour(S.userProfile.peakEnd)
    };
  }
  function getCategoryCounts() {
    if (S.categoryCountsCache) return S.categoryCountsCache;
    const counts = { all: S.tasks.length };
    Object.keys(CATEGORIES).forEach((k) => {
      counts[k] = 0;
    });
    for (const t of S.tasks) {
      const cat = resolveCategory(t);
      if (counts[cat] !== void 0) counts[cat]++;
    }
    S.categoryCountsCache = counts;
    return counts;
  }
  function getTodayPendingTasks() {
    return getTodayStats().pending;
  }
  function getFuturePendingTasks() {
    return getTodayStats().futurePending;
  }
  function getTodayFocusMinutes() {
    return getTodayStats().focusMinutes;
  }
  function getTodayCompletionRate() {
    return getTodayStats().rate;
  }
  function parseHour(timeStr) {
    return parseInt((timeStr || "09:00").split(":")[0], 10);
  }
  function scoreTaskForNextStep(task, ctx) {
    ctx = ctx || getScoringContext();
    let score = 0;
    if (task.due < ctx.today) score += 50;
    else if (task.due === ctx.today) score += 30;
    const inPeak = ctx.hour >= ctx.peakStart && ctx.hour < ctx.peakEnd;
    const cat = resolveCategory(task);
    if (inPeak && cat === "deep") score += 25;
    if (task.duration <= 25) score += 15;
    if (task.wasOverdue) score += 20;
    score += (task.energy || 3) * 3;
    return score;
  }
  function rankTasksByNextStepScore(taskList, ctx) {
    ctx = ctx || getScoringContext();
    return taskList.map((t) => ({ task: t, score: scoreTaskForNextStep(t, ctx) })).sort((a, b) => b.score - a.score).map((x) => x.task);
  }
  function getNextRecommendedTask(scope = "today") {
    let pending = scope === "today" ? getTodayPendingTasks() : S.tasks.filter((t) => !t.completed);
    if (!pending.length && scope === "today") pending = getFuturePendingTasks();
    if (!pending.length) return null;
    return rankTasksByNextStepScore(pending)[0];
  }
  function getNextStepReason(task) {
    const ctx = getScoringContext();
    const inPeak = ctx.hour >= ctx.peakStart && ctx.hour < ctx.peakEnd;
    if (task.wasOverdue) return "\u903E\u671F\u512A\u5148\u8655\u7406";
    if (inPeak && resolveCategory(task) === "deep") return "\u9AD8\u6548\u6642\u6BB5\uFF0C\u9069\u5408\u6DF1\u5EA6\u5DE5\u4F5C";
    if (!inPeak && resolveCategory(task) === "deep") return "\u53EF\u5148\u555F\u52D5\uFF0C\u6DF1\u5EA6\u6BB5\u843D\u7559\u5230\u9AD8\u6548\u6642\u6BB5";
    if (task.duration <= 15) return "\u77ED\u5C0F\u7CBE\u608D\uFF0C\u73FE\u5728\u5C31\u80FD\u5B8C\u6210";
    if (task.duration <= 25) return "\u9580\u6ABB\u4F4E\uFF0C\u9069\u5408\u73FE\u5728\u958B\u59CB";
    if (task.parentGoalName) {
      const g = task.parentGoalName;
      return `\u4F86\u81EA\u300C${g.length > 14 ? g.slice(0, 14) + "\u2026" : g}\u300D`;
    }
    return "\u7CFB\u7D71\u63A8\u85A6\u7684\u4ECA\u65E5\u7B2C\u4E00\u6B65";
  }
  function scoreTaskPriority(task) {
    const today = getTodayISO();
    const daysLeft = task.due <= today ? 0 : Math.ceil((/* @__PURE__ */ new Date(task.due + "T12:00:00") - /* @__PURE__ */ new Date(today + "T12:00:00")) / 864e5);
    let urgency = 3;
    if (daysLeft === 0) urgency = 10;
    else if (daysLeft === 1) urgency = 8;
    else if (daysLeft <= 3) urgency = 6;
    const priorityScore = urgency * 2.5 + task.energy * 1.4 + (task.duration > 60 ? 2 : 0);
    return { ...task, daysLeft, priorityScore };
  }
  function scoreTaskBlockFit(task, slot) {
    const block = slot.block;
    if (task.energy > block.maxEnergy) return -Infinity;
    if (slot.load + task.duration > block.capacity) return -Infinity;
    let fit = task.priorityScore;
    if (block.preferredCategories.includes(task.category)) fit += 22;
    if (task.category === "deep" && block.maxEnergy >= 4) fit += 8;
    if (task.category === "admin" && block.maxEnergy <= 2) fit += 10;
    fit -= slot.load / block.capacity * 12;
    return fit;
  }
  function updateDashboard() {
    const stats = getTodayStats();
    rebuildTodayQueueMap();
    const scoreCtx = getScoringContext();
    const todayRelevant = stats.relevant;
    const todayTotal = todayRelevant.length || 1;
    const firstName = S.userProfile.name.split(" ")[0] || S.userProfile.name;
    const weekScore = Math.round(S.weeklyScores.reduce((a, b) => a + b, 0) / S.weeklyScores.length);
    setElText("greeting-text", `${getGreeting()}\uFF0C${firstName}`);
    const summaryEl = $("today-summary");
    if (summaryEl) {
      const futureNote = stats.futureCount > 0 ? ` \xB7 \u4E4B\u5F8C ${stats.futureCount} \u9805` : "";
      summaryEl.textContent = `${formatDateTW()} \xB7 \u4ECA\u65E5 ${stats.completed}/${todayRelevant.length} \u9805\uFF08${stats.rate}%\uFF09${futureNote} \xB7 \u9023\u7E8C ${S.userProfile.streak} \u5929 \xB7 \u672C\u9031 ${weekScore} \u5206`;
    }
    setElText("S.tasks-completed", stats.completed);
    setElText("S.tasks-total", todayTotal);
    setElText("focus-time", (stats.focusMinutes / 60).toFixed(1));
    const comparison = getFocusComparisonText(stats.focusMinutes);
    const compEl = document.getElementById("focus-comparison");
    if (compEl) {
      const icon = comparison.positive === true ? "fa-arrow-trend-up text-emerald-400" : comparison.positive === false ? "fa-arrow-trend-down text-amber-400" : "fa-chart-line text-slate-400";
      compEl.className = `text-xs mt-4 flex items-center gap-x-1 ${comparison.positive === true ? "text-emerald-400" : comparison.positive === false ? "text-amber-400" : "text-slate-400"}`;
      compEl.innerHTML = `<i class="fa-solid ${icon}"></i><span>${comparison.text}</span>`;
    }
    const completionPercent = todayRelevant.length > 0 ? stats.rate : 0;
    setElStyle("completion-bar", "width", completionPercent + "%");
    setElText("streak", S.userProfile.streak);
    setElText("user-meta", `${S.userProfile.role} \u2022 \u7B2C ${S.userProfile.joinDay} \u5929`);
    setElText("user-name", S.userProfile.name);
    const avatar = document.getElementById("user-avatar");
    if (avatar) avatar.innerText = getInitials(S.userProfile.name);
    setElText("dash-peak-time", `${S.userProfile.peakStart || "09:00"} - ${S.userProfile.peakEnd || "12:30"}`);
    setElText("dash-peak-hint", stats.highEnergyPending > 0 ? `\u4F60\u8A2D\u5B9A\u7684\u6700\u9AD8\u6548\u6642\u6BB5 \u2022 ${stats.highEnergyPending} \u9805\u9AD8\u80FD\u91CF\u5F85\u8FA6` : `\u4F60\u8A2D\u5B9A\u7684\u6700\u9AD8\u6548\u6642\u6BB5 \u2022 \u4ECA\u65E5\u5B8C\u6210 ${stats.rate}%`);
    setElText("best-streak", S.userProfile.bestStreak);
    const container = $("today-focus-list");
    if (!container) return;
    const pending = getFilteredTasks(stats.pending);
    const ranked = rankTasksByNextStepScore(pending, scoreCtx);
    if (!S.todayFocusTaskId && ranked.length) S.todayFocusTaskId = ranked[0].id;
    const displayRanked = ranked.slice(0, 8);
    if (displayRanked.length === 0) {
      const futureHint = stats.futureCount > 0 ? `<span class="text-xs text-slate-500 mt-1">\u4E4B\u5F8C\u9084\u6709 ${stats.futureCount} \u9805\u5F85\u8FA6\uFF0C\u53EF\u5230\u300C\u4EFB\u52D9\u300D\u9801\u67E5\u770B</span>` : "";
      container.innerHTML = `<div class="text-center py-4 text-emerald-400 flex flex-col items-center"><i class="fa-solid fa-check-circle text-3xl mb-2"></i><span class="text-sm">\u592A\u68D2\u4E86\uFF01\u4ECA\u65E5\u4EFB\u52D9\u5DF2\u5168\u90E8\u5B8C\u6210</span>${futureHint}</div>`;
    } else {
      container.innerHTML = displayRanked.map((t) => renderPersonalTaskRow(t, "dashboard")).join("");
    }
    renderActiveGoalsPanel();
    updateNextStepCard(stats);
  }
  function addTaskToList() {
    const name = document.getElementById("task-name").value.trim();
    if (!name) {
      showToast("\u8ACB\u8F38\u5165\u4EFB\u52D9\u540D\u7A31", "error");
      return;
    }
    const duration = parseInt(document.getElementById("task-duration").value) || 30;
    const energy = parseInt(document.getElementById("task-energy").value);
    const category = document.getElementById("task-category").value;
    const due = document.getElementById("task-due").value || getTodayISO();
    const newTask = {
      id: Date.now(),
      name,
      duration,
      energy,
      category,
      due,
      completed: false,
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    S.tasks.push(newTask);
    saveState();
    document.getElementById("task-name").value = "";
    refreshUI({ scheduler: true, filters: true, schedule: true });
    showToast("\u4EFB\u52D9\u5DF2\u52A0\u5165\u6E05\u55AE", "success");
  }
  function getTimeDistribution() {
    const cats = { deep: 0, execution: 0, meeting: 0, learning: 0, admin: 0 };
    S.tasks.forEach((t) => {
      const cat = t.category || inferCategory(t.name, t.energy);
      cats[cat] = (cats[cat] || 0) + t.duration;
    });
    const totalMins = Object.values(cats).reduce((a, b) => a + b, 0);
    const pct = (v) => totalMins > 0 ? Math.round(v / totalMins * 100) : 0;
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
      el.className = "service-status-dot " + (ok ? "service-status-ok" : "service-status-off");
    };
    const apiStatus = await fetchApiReadiness();
    const apiReady = apiStatus.ready;
    const apiReachable = apiStatus.reachable;
    const apiEl = document.getElementById("status-api");
    if (apiEl) {
      if (apiReady) {
        apiEl.textContent = "\u25CF \u5DF2\u5C31\u7DD2";
        apiEl.className = "service-status-dot service-status-ok";
        apiEl.title = formatReadinessHint(apiStatus.checks) || "API \u5DF2\u5C31\u7DD2";
      } else if (apiReachable) {
        apiEl.textContent = "\u25CF \u672A\u5C31\u7DD2";
        apiEl.className = "service-status-dot service-status-off";
        apiEl.title = formatReadinessHint(apiStatus.checks) || "API \u5DF2\u9023\u7DDA\u4F46\u5B50\u7CFB\u7D71\u672A\u5C31\u7DD2";
      } else {
        apiEl.textContent = "\u25CF \u672A\u9023\u7DDA";
        apiEl.className = "service-status-dot service-status-off";
        apiEl.title = "\u8ACB\u57F7\u884C npm run api";
      }
    }
    if (apiReady && isLoggedIn()) {
      setStatus("status-sync", true, "\u25CF \u5DF2\u767B\u5165\u53EF\u540C\u6B65", "\u25CF \u8A2A\u5BA2\u6A21\u5F0F");
    } else if (apiReady) {
      setStatus("status-sync", false, "", "\u25CF \u8A2A\u5BA2\u6A21\u5F0F");
    } else if (apiReachable) {
      setStatus("status-sync", false, "", "\u25CF API \u555F\u52D5\u4E2D");
    } else {
      setStatus("status-sync", false, "", "\u25CF \u9700\u555F\u52D5 API");
    }
    try {
      const res = await fetch(RAG_SERVICE_URL + "/health", { method: "GET" });
      const data = res.ok ? await res.json() : null;
      const ragOk = data?.service === "lumina-rag-service";
      const ragEl = document.getElementById("status-rag");
      if (ragEl) {
        if (ragOk) {
          const mode = data.embedding || data.retrieval || "";
          ragEl.textContent = mode ? `\u25CF \u5DF2\u9023\u7DDA (${mode})` : "\u25CF \u5DF2\u9023\u7DDA";
          ragEl.className = "service-status-dot service-status-ok";
        } else {
          ragEl.textContent = "\u25CF \u672A\u9023\u7DDA";
          ragEl.className = "service-status-dot service-status-off";
        }
      }
    } catch (_) {
      setStatus("status-rag", false, "", "\u25CF \u672A\u9023\u7DDA");
    }
    renderCoachReadinessBar();
  }
  function triggerConfetti() {
    const colors = ["#6366f1", "#a855f7", "#ec4899", "#22c55e"];
    const container = document.body;
    for (let i = 0; i < 65; i++) {
      const particle = document.createElement("div");
      particle.style.position = "fixed";
      particle.style.zIndex = "9999";
      particle.style.left = Math.random() * 100 + "vw";
      particle.style.top = "-10px";
      particle.style.width = "8px";
      particle.style.height = "8px";
      particle.style.borderRadius = Math.random() > 0.5 ? "50%" : "2px";
      particle.style.background = colors[Math.floor(Math.random() * colors.length)];
      particle.style.opacity = Math.random() + 0.6;
      container.appendChild(particle);
      const duration = Math.random() * 2800 + 2400;
      const angle = Math.random() * 70 + 55;
      particle.animate([
        { transform: `translateY(0) rotate(0deg)`, opacity: particle.style.opacity },
        { transform: `translateY(${window.innerHeight + 100}px) rotate(${angle * 4}deg)`, opacity: 0 }
      ], {
        duration,
        easing: "cubic-bezier(0.25, 0.1, 0.25, 1)"
      }).onfinish = () => particle.remove();
    }
  }
  function showToast(message, type = "success") {
    const container = document.getElementById("toast-container");
    if (!container) return;
    const toast = document.createElement("div");
    const icon = type === "success" ? "fa-circle-check" : "fa-circle-exclamation";
    toast.className = `toast-item ${type === "success" ? "toast-success" : "toast-error"}`;
    toast.setAttribute("role", "status");
    const iconEl = document.createElement("i");
    iconEl.className = `fa-solid ${icon} flex-shrink-0`;
    const textEl = document.createElement("div");
    textEl.className = "flex-1 leading-snug";
    textEl.textContent = String(message);
    const closeBtn = document.createElement("button");
    closeBtn.className = "opacity-70 hover:opacity-100 text-lg leading-none";
    closeBtn.setAttribute("aria-label", "\u95DC\u9589");
    closeBtn.textContent = "\xD7";
    closeBtn.addEventListener("click", () => toast.remove());
    toast.append(iconEl, textEl, closeBtn);
    container.appendChild(toast);
    setTimeout(() => {
      if (toast.parentElement) toast.remove();
    }, 3200);
  }
  function resetAllData() {
    if (!confirm("\u78BA\u5B9A\u8981\u91CD\u7F6E\u6240\u6709\u8CC7\u6599\u55CE\uFF1F\u9019\u6703\u6E05\u9664\u4EFB\u52D9\u8207\u7D71\u8A08\uFF08API Key \u8207\u57FA\u672C\u8A2D\u5B9A\u6703\u4FDD\u7559\uFF09\u3002")) return;
    clearSensitiveLocalData();
    location.reload();
  }
  function loadChartJs() {
    if (typeof Chart !== "undefined") return Promise.resolve();
    if (S.chartJsLoadPromise) return S.chartJsLoadPromise;
    S.chartJsLoadPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = CHART_JS_URL;
      script.onload = resolve;
      script.onerror = () => reject(new Error("Chart.js \u8F09\u5165\u5931\u6557"));
      document.head.appendChild(script);
    });
    return S.chartJsLoadPromise;
  }
  async function refreshInsightsPage() {
    updateInsightsCards();
    try {
      await loadChartJs();
      requestAnimationFrame(() => initCharts());
    } catch (_) {
      $("weekly-chart-fallback")?.classList.remove("hidden");
    }
  }
  function updateInsightsCards() {
    const dist = getTimeDistribution();
    const avgScore = Math.round(S.weeklyScores.reduce((a, b) => a + b, 0) / S.weeklyScores.length);
    const prevAvg = Math.round(S.weeklyScores.slice(0, 6).reduce((a, b) => a + b, 0) / 6);
    const growth = prevAvg > 0 ? Math.round((avgScore - prevAvg) / prevAvg * 100) : 0;
    const peakEl = document.getElementById("insight-peak-time");
    const improveEl = document.getElementById("insight-improve-area");
    const growthEl = document.getElementById("insight-growth-pct");
    if (peakEl) {
      peakEl.innerText = `${S.userProfile.peakStart || "09:00"} - ${S.userProfile.peakEnd || "12:30"}`;
      setElText(
        "insight-peak-desc",
        `\u4F9D\u4F60\u8A2D\u5B9A\u7684\u6642\u6BB5 \xB7 \u6DF1\u5EA6\u5DE5\u4F5C\u4F54\u6BD4 ${dist.deep}%`
      );
    }
    if (improveEl) {
      const deepPending = S.tasks.filter((t) => !t.completed && resolveCategory(t) === "deep").length;
      const meetingMins = S.tasks.filter((t) => t.category === "meeting").reduce((s, t) => s + t.duration, 0);
      if (deepPending > 2) {
        improveEl.innerText = "\u6DF1\u5EA6\u5DE5\u4F5C\u4EFB\u52D9\u5806\u7A4D";
        setElText(
          "insight-improve-desc",
          `\u6709 ${deepPending} \u9805\u6DF1\u5EA6\u4EFB\u52D9\u5F85\u8655\u7406\uFF0C\u5EFA\u8B70\u6392\u5728 ${S.userProfile.peakStart}-${S.userProfile.peakEnd}`
        );
      } else if (dist.meeting > 25) {
        improveEl.innerText = "\u6703\u8B70\u6642\u9593\u4F54\u6BD4\u504F\u9AD8";
        setElText(
          "insight-improve-desc",
          `\u6703\u8B70\u6E9D\u901A\u4F54 ${dist.meeting}%\uFF0C\u5EFA\u8B70\u5408\u4F75\u6216\u7E2E\u77ED\u975E\u5FC5\u8981\u6703\u8B70`
        );
      } else if (dist.admin > 20) {
        improveEl.innerText = "\u884C\u653F\u96DC\u52D9\u4F54\u6BD4\u904E\u9AD8";
        setElText(
          "insight-improve-desc",
          `\u884C\u653F\u4E8B\u52D9\u4F54 ${dist.admin}%\uFF0C\u53EF\u6279\u6B21\u8655\u7406\u6216\u59D4\u6D3E`
        );
      } else {
        improveEl.innerText = "\u6574\u9AD4\u7BC0\u594F\u826F\u597D";
        setElText("insight-improve-desc", "\u7E7C\u7E8C\u4FDD\u6301\u4E0A\u5348\u6DF1\u5EA6\u3001\u4E0B\u5348\u57F7\u884C\u7684\u7BC0\u594F");
      }
    }
    if (growthEl) {
      growthEl.innerText = `${growth >= 0 ? "+" : ""}${growth}%`;
      setElText("insight-growth-desc", `\u4F60\u5DF2\u9023\u7E8C ${S.userProfile.streak} \u5929\u4FDD\u6301\u9AD8\u6548\u7BC0\u594F\uFF01`);
    }
  }
  function initCharts() {
    const weeklyFallback = document.getElementById("weekly-chart-fallback");
    const pieFallback = document.getElementById("pie-chart-fallback");
    const weekAvgEl = document.getElementById("insight-week-avg");
    if (typeof Chart === "undefined") {
      weeklyFallback?.classList.remove("hidden");
      return;
    }
    const weeklyCanvas = document.getElementById("weekly-chart");
    const pieCanvas = document.getElementById("time-pie-chart");
    if (!weeklyCanvas || !pieCanvas) return;
    weeklyFallback?.classList.add("hidden");
    pieFallback?.classList.add("hidden");
    const weekAvg = Math.round(S.weeklyScores.reduce((a, b) => a + b, 0) / S.weeklyScores.length);
    if (weekAvgEl) weekAvgEl.innerText = weekAvg;
    try {
      if (S.weeklyChartInstance) {
        S.weeklyChartInstance.data.datasets[0].data = S.weeklyScores;
        S.weeklyChartInstance.update("none");
      } else {
        S.weeklyChartInstance = new Chart(weeklyCanvas.getContext("2d"), {
          type: "bar",
          data: {
            labels: ["\u9031\u4E00", "\u9031\u4E8C", "\u9031\u4E09", "\u9031\u56DB", "\u9031\u4E94", "\u9031\u516D", "\u9031\u65E5"],
            datasets: [{
              label: "\u751F\u7522\u529B\u5206\u6578",
              data: S.weeklyScores,
              backgroundColor: "#6366f1",
              borderRadius: 6,
              barThickness: 18
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 400 },
            plugins: { legend: { display: false } },
            scales: {
              y: {
                min: 40,
                max: 100,
                grid: { color: "#334155" },
                ticks: { color: "#64748b", stepSize: 20 }
              },
              x: {
                grid: { display: false },
                ticks: { color: "#64748b" }
              }
            }
          }
        });
      }
    } catch (err) {
      console.error("[Lumina] weekly chart error:", err);
      weeklyFallback?.classList.remove("hidden");
    }
    const dist = getTimeDistribution();
    const pieData = [
      dist.minutes.deep,
      dist.minutes.execution,
      dist.minutes.meeting,
      dist.minutes.learning,
      dist.minutes.admin
    ];
    if (dist.totalMins === 0) {
      pieFallback?.classList.remove("hidden");
      return;
    }
    try {
      if (S.pieChartInstance) {
        S.pieChartInstance.data.datasets[0].data = pieData;
        S.pieChartInstance.update("none");
      } else {
        S.pieChartInstance = new Chart(pieCanvas.getContext("2d"), {
          type: "doughnut",
          data: {
            labels: ["\u6DF1\u5EA6\u5DE5\u4F5C", "\u57F7\u884C\u5354\u4F5C", "\u6703\u8B70\u6E9D\u901A", "\u5B78\u7FD2\u6210\u9577", "\u884C\u653F\u96DC\u52D9"],
            datasets: [{
              data: pieData,
              backgroundColor: ["#6366f1", "#a855f7", "#ec4899", "#f59e0b", "#64748b"],
              borderWidth: 0
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: "68%",
            plugins: {
              legend: {
                position: "bottom",
                labels: { color: "#94a3b8", padding: 12, font: { size: 11 }, boxWidth: 12 }
              },
              tooltip: {
                callbacks: {
                  label: (ctx) => {
                    const mins = ctx.raw;
                    const pct = dist.totalMins > 0 ? Math.round(mins / dist.totalMins * 100) : 0;
                    return ` ${ctx.label}: ${mins} \u5206\u9418 (${pct}%)`;
                  }
                }
              }
            }
          }
        });
      }
    } catch (err) {
      console.error("[Lumina] pie chart error:", err);
      pieFallback?.classList.remove("hidden");
    }
  }
  function recalculateInsights() {
    showToast("\u6B63\u5728\u91CD\u65B0\u8A08\u7B97\u672C\u9031\u6D1E\u5BDF...", "success");
    recordDailySnapshot();
    recalculateWeeklyScores();
    localStorage.setItem("lumina_weekly", JSON.stringify(S.weeklyScores));
    const avgScore = Math.round(S.weeklyScores.reduce((a, b) => a + b, 0) / S.weeklyScores.length);
    const daysWithData = S.weeklyScores.filter((s) => s > 0).length;
    setTimeout(() => {
      if (document.getElementById("insights").classList.contains("active")) {
        refreshInsightsPage();
      } else {
        updateInsightsCards();
      }
      refreshUI({ dashboard: true, filters: true });
      const msg = daysWithData > 0 ? `\u6D1E\u5BDF\u5DF2\u66F4\u65B0\uFF01\u672C\u9031\u5E73\u5747\u5B8C\u6210\u7387 ${avgScore}%` : "\u6D1E\u5BDF\u5DF2\u66F4\u65B0\uFF01\u5B8C\u6210\u66F4\u591A\u4EFB\u52D9\u5F8C\u6578\u64DA\u6703\u66F4\u6E96\u78BA";
      showToast(msg, "success");
    }, 400);
  }
  function switchSchedulerTab(tab) {
    const tasksPanel = document.getElementById("scheduler-panel-tasks");
    const decomposePanel = document.getElementById("scheduler-panel-decompose");
    const tabTasks = document.getElementById("sched-tab-tasks");
    const tabDecompose = document.getElementById("sched-tab-decompose");
    const isDecompose = tab === "decompose";
    if (tasksPanel) tasksPanel.classList.toggle("hidden", isDecompose);
    if (decomposePanel) decomposePanel.classList.toggle("hidden", !isDecompose);
    if (tabTasks) tabTasks.classList.toggle("active", !isDecompose);
    if (tabDecompose) tabDecompose.classList.toggle("active", isDecompose);
  }
  function openDecomposeTab() {
    showSection("scheduler");
    switchSchedulerTab("decompose");
  }
  function showGuideTab(tab) {
    ["solutions", "manual", "workflow"].forEach((t) => {
      document.getElementById("guide-panel-" + t)?.classList.toggle("active", t === tab);
      document.getElementById("guide-tab-" + t)?.classList.toggle("active", t === tab);
    });
  }
  function closeNavMore() {
    const menu = document.getElementById("nav-more-menu");
    const btn = document.getElementById("nav-more-btn");
    if (menu) menu.classList.add("hidden");
    if (btn) btn.setAttribute("aria-expanded", "false");
    closeMobileMore();
  }
  function toggleNavMore() {
    const menu = document.getElementById("nav-more-menu");
    const btn = document.getElementById("nav-more-btn");
    if (!menu || !btn) return;
    menu.classList.toggle("hidden");
    btn.setAttribute("aria-expanded", menu.classList.contains("hidden") ? "false" : "true");
  }
  function navigateFromMore(section) {
    closeNavMore();
    showSection(section);
  }
  function updateNavMoreState(section) {
    const moreBtn = document.getElementById("nav-more-btn");
    const mobMore = document.getElementById("mob-nav-more");
    const isMore = MORE_SECTIONS.includes(section);
    if (moreBtn) {
      moreBtn.classList.toggle("active", isMore);
      moreBtn.classList.toggle("text-indigo-400", isMore);
    }
    if (mobMore) {
      mobMore.classList.toggle("active", isMore);
      mobMore.classList.toggle("text-indigo-400", isMore);
      mobMore.classList.toggle("text-slate-400", !isMore);
    }
    MORE_SECTIONS.forEach((s) => {
      const item = document.getElementById("nav-dropdown-" + s);
      if (item) item.classList.toggle("active", section === s);
    });
  }
  function toggleMobileMore() {
    const sheet = document.getElementById("mobile-more-sheet");
    if (sheet) sheet.classList.toggle("hidden");
  }
  function closeMobileMore() {
    const sheet = document.getElementById("mobile-more-sheet");
    if (sheet) sheet.classList.add("hidden");
  }
  function navigateFromMobileMore(section) {
    closeMobileMore();
    showSection(section);
  }
  function showSection(section) {
    if (section === "decomposer") {
      openDecomposeTab();
      return;
    }
    closeNavMore();
    document.querySelectorAll(".section").forEach((s) => s.classList.remove("active"));
    const target = document.getElementById(section);
    if (target) target.classList.add("active");
    document.querySelectorAll('.nav-link[id^="nav-"]').forEach((nav) => {
      if (nav.id === "nav-more-btn") return;
      nav.classList.remove("active", "text-indigo-400");
      nav.classList.add("text-slate-300");
      nav.removeAttribute("aria-current");
    });
    const activeNav = document.getElementById("nav-" + section);
    if (activeNav) {
      activeNav.classList.add("active", "text-indigo-400");
      activeNav.classList.remove("text-slate-300");
      activeNav.setAttribute("aria-current", "page");
    }
    updateNavMoreState(section);
    document.querySelectorAll(".mobile-nav-btn").forEach((btn) => {
      btn.classList.remove("active", "text-indigo-400");
      btn.classList.add("text-slate-400");
    });
    if (!MORE_SECTIONS.includes(section)) {
      const mobNav = document.getElementById("mob-nav-" + section);
      if (mobNav) {
        mobNav.classList.add("active", "text-indigo-400");
        mobNav.classList.remove("text-slate-400");
      }
    }
    const pageTitle = PAGE_TITLES[section] || "Lumina";
    document.title = pageTitle + " \xB7 \u5149\u6D41 AI Lumina";
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (section === "insights") {
      refreshInsightsPage();
    }
    if (section === "coach") {
      renderCoachQuickActions();
      refreshCoachView();
      renderCoachReadinessBar();
    }
    if (section === "dashboard" && S.focusSession?.endsAt && S.focusSession.endsAt > Date.now() && !S.focusTimerInterval) {
      tickFocusTimer();
      S.focusTimerInterval = setInterval(tickFocusTimer, 1e3);
    }
    if (section === "settings") {
      loadSettingsForm();
      refreshServiceStatus();
    }
    if (section === "guide") {
      showGuideTab("solutions");
    }
    if (section === "team") {
      ensurePdfJs().catch(() => {
      });
      ensureXlsx().catch(() => {
      });
      renderEnterprisePage();
      updateTeamSyncStatus();
      startEnterprisePolling();
    } else {
      stopEnterprisePolling();
    }
    if (section === "scheduler") {
      if (S.schedulerTabPending) {
        switchSchedulerTab(S.schedulerTabPending);
        S.schedulerTabPending = null;
      }
      refreshUI({ scheduler: true, filters: true });
      const timeline = $("timeline-view");
      if (timeline && timeline.innerHTML.trim() === "") {
        optimizeSchedule(true);
      }
    }
    if (section === "dashboard") {
      refreshUI({ dashboard: true, filters: true });
    }
  }
  function setupKeyboardShortcuts() {
    const NAV_KEYS = { "1": "dashboard", "2": "scheduler", "3": "coach", "4": "insights" };
    document.addEventListener("keydown", function(e) {
      if (e.key === "Escape") {
        if (!document.getElementById("task-edit-modal")?.classList.contains("hidden")) {
          closeTaskEdit();
          return;
        }
        if (!document.getElementById("auth-overlay")?.classList.contains("hidden") && !needsAuthGate()) {
          hideAuthOverlay();
          return;
        }
        if (!document.getElementById("onboarding-overlay")?.classList.contains("hidden")) {
          skipOnboarding();
          return;
        }
        closeNavMore();
        closeMobileMore();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "/") {
        e.preventDefault();
        const dashboard = document.getElementById("dashboard");
        if (dashboard.classList.contains("active")) {
          document.getElementById("quick-task-input").focus();
        } else {
          showSection("dashboard");
          setTimeout(() => document.getElementById("quick-task-input").focus(), 300);
        }
      }
      if (e.key === "?" && document.activeElement.tagName === "BODY") {
        e.preventDefault();
        showSection("coach");
      }
      if (!e.metaKey && !e.ctrlKey && !e.altKey && NAV_KEYS[e.key] && document.activeElement.tagName === "BODY") {
        showSection(NAV_KEYS[e.key]);
      }
    });
    console.log("%c[Lumina AI] \u5FEB\u6377\u9375\uFF1A1-4 \u5207\u63DB\u9801\u9762\uFF0CCmd/Ctrl+/ \u65B0\u589E\u4EFB\u52D9\uFF0C? \u958B\u555F AI \u6559\u7DF4\uFF0CEsc \u95DC\u9589", "color:#64748b");
  }
  function clearOnboardHighlight() {
    document.querySelectorAll(".onboard-highlight").forEach((el) => el.classList.remove("onboard-highlight"));
  }
  function applyOnboardHighlight(id) {
    clearOnboardHighlight();
    const el = document.getElementById(id);
    if (el) {
      el.classList.add("onboard-highlight");
      setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "center" }), 400);
    }
  }
  function renderOnboardingStep() {
    const step = ONBOARDING_STEPS[S.onboardingStep];
    if (!step) return;
    const iconEl = document.getElementById("onboarding-icon");
    const titleEl = document.getElementById("onboarding-title");
    const descEl = document.getElementById("onboarding-desc");
    const nextBtn = document.getElementById("onboarding-next-btn");
    const dots = document.querySelectorAll(".onboarding-dot");
    if (iconEl) {
      iconEl.className = "onboarding-icon " + step.iconBg;
      iconEl.innerHTML = `<i class="fa-solid ${sanitizeFaIcon(step.icon)}"></i>`;
    }
    if (titleEl) titleEl.textContent = step.title;
    if (descEl) descEl.textContent = step.desc;
    if (nextBtn) nextBtn.textContent = S.onboardingStep === ONBOARDING_STEPS.length - 1 ? "\u958B\u59CB\u4F7F\u7528" : "\u4E0B\u4E00\u6B65";
    dots.forEach((dot, i) => {
      dot.classList.toggle("active", i === S.onboardingStep);
      dot.classList.toggle("done", i < S.onboardingStep);
    });
    showSection(step.section);
    if (step.schedTab) switchSchedulerTab(step.schedTab);
    if (step.onEnter) setTimeout(() => step.onEnter(), 400);
    setTimeout(() => {
      if (step.highlight) applyOnboardHighlight(step.highlight);
    }, 350);
  }
  function startOnboarding() {
    S.onboardingStep = 0;
    const overlay = document.getElementById("onboarding-overlay");
    if (overlay) overlay.classList.remove("hidden");
    renderOnboardingStep();
  }
  function nextOnboardingStep() {
    S.onboardingStep++;
    if (S.onboardingStep >= ONBOARDING_STEPS.length) {
      completeOnboarding();
      return;
    }
    renderOnboardingStep();
  }
  function skipOnboarding() {
    completeOnboarding();
  }
  function completeOnboarding() {
    clearOnboardHighlight();
    const overlay = document.getElementById("onboarding-overlay");
    if (overlay) overlay.classList.add("hidden");
    localStorage.setItem("lumina_onboarding_v2", "true");
    showSection("dashboard");
    showToast("\u6B61\u8FCE\u4F7F\u7528 Lumina\uFF01\u5F9E\u300C\u4ECA\u65E5\u300D\u9801\u958B\u59CB\u5427", "success");
  }
  function generateManifestIcon() {
    const fallback = "data:image/svg+xml," + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><rect width="192" height="192" rx="32" fill="#6366f1"/><text x="96" y="110" text-anchor="middle" font-size="80" fill="#fff">\u26A1</text></svg>'
    );
    const canvas = document.createElement("canvas");
    canvas.width = 192;
    canvas.height = 192;
    const ctx = canvas.getContext("2d");
    if (!ctx) return fallback;
    const grad = ctx.createLinearGradient(0, 0, 192, 192);
    grad.addColorStop(0, "#6366f1");
    grad.addColorStop(0.5, "#a855f7");
    grad.addColorStop(1, "#ec4899");
    ctx.fillStyle = grad;
    if (ctx.roundRect) {
      ctx.beginPath();
      ctx.roundRect(24, 24, 144, 144, 32);
      ctx.fill();
    } else {
      ctx.fillRect(24, 24, 144, 144);
    }
    ctx.fillStyle = "#fff";
    ctx.font = "bold 80px Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("\u26A1", 96, 100);
    return canvas.toDataURL("image/png");
  }
  function setupManifest() {
    const iconUrl = generateManifestIcon();
    const manifest = {
      name: "\u5149\u6D41 AI Lumina",
      short_name: "Lumina",
      description: "\u5927\u76EE\u6A19\u62C6\u6210\u5C0F\u6B65\uFF0CAI \u544A\u8A34\u4F60\u4ECA\u65E5\u7B2C\u4E00\u6B65\u8A72\u505A\u4EC0\u9EBC",
      start_url: window.location.href.split("?")[0],
      scope: "./",
      display: "standalone",
      background_color: "#020617",
      theme_color: "#6366f1",
      lang: "zh-TW",
      icons: [
        { src: iconUrl, sizes: "192x192", type: "image/png", purpose: "any maskable" }
      ]
    };
    const link = document.createElement("link");
    link.rel = "manifest";
    link.href = URL.createObjectURL(new Blob([JSON.stringify(manifest)], { type: "application/json" }));
    document.head.appendChild(link);
    let appleIcon = document.querySelector('link[rel="apple-touch-icon"]');
    if (!appleIcon) {
      appleIcon = document.createElement("link");
      appleIcon.rel = "apple-touch-icon";
      document.head.appendChild(appleIcon);
    }
    appleIcon.href = iconUrl;
  }
  function registerServiceWorker() {
    if (!("serviceWorker" in navigator) || window.location.protocol === "file:") return;
    const swCode = `
        const CACHE = 'lumina-v8';
        const origin = '${window.location.origin}';
        const LOCAL_ASSETS = [
            origin + '/lumina-ai.html',
            origin + '/js/lumina-app.js',
            origin + '/css/lumina.css',
            origin + '/css/tailwind.build.css'
        ];
        const CDN_ASSETS = [
            'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css'
        ];
        
        self.addEventListener('install', e => {
            e.waitUntil(
                caches.open(CACHE).then(c => c.addAll([...LOCAL_ASSETS, ...CDN_ASSETS]).catch(() => {}))
            );
            self.skipWaiting();
        });
        
        self.addEventListener('activate', e => {
            e.waitUntil(
                caches.keys().then(keys =>
                    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
                ).then(() => self.clients.claim())
            );
        });
        
        self.addEventListener('fetch', e => {
            if (e.request.method !== 'GET') return;
            const url = new URL(e.request.url);
            const isLocal = url.origin === origin;
            e.respondWith(
                (isLocal
                    ? caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
                        if (res.ok) {
                            const clone = res.clone();
                            caches.open(CACHE).then(c => c.put(e.request, clone));
                        }
                        return res;
                    }))
                    : fetch(e.request).then(res => {
                        if (res.ok) {
                            const clone = res.clone();
                            caches.open(CACHE).then(c => c.put(e.request, clone));
                        }
                        return res;
                    })
                ).catch(() => caches.match(e.request).then(cached =>
                    cached || new Response('\u96E2\u7DDA\u4E2D\uFF0C\u8ACB\u7A0D\u5F8C\u518D\u8A66', { status: 503, statusText: 'Offline' })
                ))
            );
        });
    `;
    const blob = new Blob([swCode], { type: "application/javascript" });
    navigator.serviceWorker.register(URL.createObjectURL(blob)).then(() => updatePwaStatus("\u5DF2\u555F\u7528\u96E2\u7DDA\u5FEB\u53D6")).catch(() => updatePwaStatus("\u96E2\u7DDA\u5FEB\u53D6\u555F\u7528\u5931\u6557\uFF08\u4E0D\u5F71\u97FF\u6B63\u5E38\u4F7F\u7528\uFF09"));
  }
  function updatePwaStatus(msg) {
    const el = document.getElementById("pwa-status");
    if (el) el.textContent = msg;
  }
  function setupPwaInstall() {
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      S.deferredInstallPrompt = e;
      const btn = document.getElementById("pwa-install-btn");
      if (btn) btn.classList.remove("hidden");
      updatePwaStatus("\u53EF\u5B89\u88DD\u5230\u4E3B\u756B\u9762\uFF0C\u50CF App \u4E00\u6A23\u4F7F\u7528");
    });
    window.addEventListener("appinstalled", () => {
      S.deferredInstallPrompt = null;
      const btn = document.getElementById("pwa-install-btn");
      if (btn) btn.classList.add("hidden");
      updatePwaStatus("\u2705 \u5DF2\u5B89\u88DD\u5230\u4E3B\u756B\u9762");
      showToast("Lumina \u5DF2\u5B89\u88DD\u5230\u4E3B\u756B\u9762\uFF01", "success");
    });
    if (window.matchMedia("(display-mode: standalone)").matches) {
      updatePwaStatus("\u2705 \u6B63\u4EE5 App \u6A21\u5F0F\u57F7\u884C");
    } else if (window.location.protocol === "file:") {
      updatePwaStatus("\u8ACB\u900F\u904E\u672C\u6A5F\u4F3A\u670D\u5668\u958B\u555F\u4EE5\u555F\u7528\u96E2\u7DDA\u8207\u5B89\u88DD\u529F\u80FD");
    }
  }
  async function promptInstall() {
    if (!S.deferredInstallPrompt) {
      showToast("\u76EE\u524D\u74B0\u5883\u4E0D\u652F\u63F4\u5B89\u88DD\uFF0C\u8ACB\u7528 Chrome \u4E26\u900F\u904E http:// \u958B\u555F", "error");
      return;
    }
    S.deferredInstallPrompt.prompt();
    await S.deferredInstallPrompt.userChoice;
    S.deferredInstallPrompt = null;
    document.getElementById("pwa-install-btn")?.classList.add("hidden");
  }
  function setupOfflineDetection() {
    const banner = document.getElementById("offline-banner");
    function updateOnlineStatus() {
      if (navigator.onLine) {
        banner?.classList.remove("show");
      } else {
        banner?.classList.add("show");
      }
    }
    window.addEventListener("online", () => {
      updateOnlineStatus();
      showToast("\u5DF2\u6062\u5FA9\u9023\u7DDA", "success");
    });
    window.addEventListener("offline", () => {
      updateOnlineStatus();
      showToast("\u5DF2\u9032\u5165\u96E2\u7DDA\u6A21\u5F0F\uFF0C\u8CC7\u6599\u4ECD\u6703\u4FDD\u5B58\u5728\u672C\u6A5F", "error");
    });
    updateOnlineStatus();
  }
  function getEnterpriseBaseUrl() {
    const url = (S.userProfile.enterpriseApiUrl || "http://localhost:3001").replace(/\/$/, "");
    return isSafeHttpUrl(url) ? url : "http://localhost:3001";
  }
  function loadLocalEnterpriseStore() {
    try {
      return JSON.parse(localStorage.getItem(LOCAL_ENTERPRISE_KEY) || '{"groups":{}}');
    } catch (_) {
      return { groups: {} };
    }
  }
  function saveLocalEnterpriseStore(store) {
    localStorage.setItem(LOCAL_ENTERPRISE_KEY, JSON.stringify(store));
  }
  function normalizeEnterpriseCode(code) {
    return String(code || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  }
  async function enterpriseFetch(method, path, body) {
    const url = getEnterpriseBaseUrl() + path;
    try {
      const res = await fetch(url, {
        method,
        headers: {
          ...getAuthHeaders(!!body),
          ...body ? { "Content-Type": "application/json" } : {}
        },
        body: body ? JSON.stringify(body) : void 0
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "\u8ACB\u6C42\u5931\u6557");
      return { ok: true, data, offline: false };
    } catch (err) {
      return { ok: false, error: err.message, offline: true };
    }
  }
  async function enterpriseLocalCreate(body) {
    const store = loadLocalEnterpriseStore();
    const code = normalizeEnterpriseCode(body.code);
    if (store.groups[code]) throw new Error("\u6B64\u7FA4\u7D44\u4EE3\u78BC\u5DF2\u5B58\u5728");
    const managerId = "m_" + Date.now();
    store.groups[code] = {
      code,
      name: clampText(body.name || "\u672A\u547D\u540D\u5718\u968A", 80),
      managerPinHash: await hashPin(body.managerPin || "0000"),
      members: [{
        id: managerId,
        name: clampText(body.managerName, 80),
        role: "manager",
        joinedAt: (/* @__PURE__ */ new Date()).toISOString()
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
    if (!group) throw new Error("\u627E\u4E0D\u5230\u6B64\u7FA4\u7D44\u4EE3\u78BC");
    if (body.role === "manager" && !await verifyLocalManagerPin(group, body.pin)) {
      throw new Error("\u4E3B\u7BA1\u91D1\u9470\u932F\u8AA4");
    }
    if (group.managerPin !== void 0 && !group.managerPinHash) {
      group.managerPinHash = await hashPin(group.managerPin);
      delete group.managerPin;
    }
    const existing = group.members.find((m) => m.name.toLowerCase() === body.name.toLowerCase());
    if (existing) return { group: { code, name: group.name }, member: existing };
    const member = {
      id: "u_" + Date.now(),
      name: clampText(body.name, 80),
      role: body.role || "member",
      joinedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    group.members.push(member);
    saveLocalEnterpriseStore(store);
    return { group: { code, name: group.name }, member };
  }
  function enterpriseLocalGetGroup(code, memberId) {
    const store = loadLocalEnterpriseStore();
    const group = store.groups[normalizeEnterpriseCode(code)];
    if (!group) throw new Error("\u627E\u4E0D\u5230\u7FA4\u7D44");
    const payload = { ...group };
    if (memberId) {
      ensureLocalGroupNotifications(group);
      payload.notifications = group.notifications.filter((n) => n.recipientId === memberId).slice(0, 50);
    }
    return { group: payload };
  }
  function getMemberInitials(name) {
    const n = String(name || "").trim();
    if (!n) return "?";
    if (/[\u4e00-\u9fff]/.test(n)) return n.slice(-1);
    const parts = n.split(/\s+/);
    return parts.length > 1 ? (parts[0][0] + parts[1][0]).toUpperCase() : n.slice(0, 2).toUpperCase();
  }
  function renderMemberChip(member) {
    const isManager = member.role === "manager";
    const colors = isManager ? "bg-amber-500/20 text-amber-200 border-amber-500/30" : "bg-indigo-500/20 text-indigo-200 border-indigo-500/30";
    return `
        <span class="member-chip">
            <span class="member-avatar ${colors} border">${escapeHtml(getMemberInitials(member.name))}</span>
            <span>${escapeHtml(member.name)}</span>
            ${isManager ? '<span class="text-[9px] text-amber-400/80 ml-0.5">\u4E3B\u7BA1</span>' : ""}
        </span>
    `;
  }
  async function fetchApiReadiness() {
    try {
      const res = await fetch(getEnterpriseBaseUrl() + "/ready", { method: "GET" });
      let data = {};
      try {
        data = await res.json();
      } catch (_) {
      }
      return {
        reachable: true,
        ready: res.ok && !!data.ok,
        checks: data.checks || null
      };
    } catch (_) {
      return { reachable: false, ready: false, checks: null };
    }
  }
  function formatReadinessHint(checks) {
    if (!checks) return "";
    const parts = [];
    if ("store" in checks) parts.push(`store:${checks.store ? "\u2713" : "\u2717"}`);
    if ("auth" in checks) parts.push(`auth:${checks.auth ? "\u2713" : "\u2717"}`);
    if ("rag" in checks) parts.push(`rag:${checks.rag ? "\u2713" : "\u2717"}`);
    return parts.join(" ");
  }
  async function updateTeamSyncStatus() {
    const el = document.getElementById("team-sync-status");
    if (!el) return;
    if (S.enterpriseSession?.offline) {
      el.textContent = "\u25CF \u96E2\u7DDA\u6A21\u5F0F";
      el.className = "text-[10px] px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/25";
      el.title = "\u8B8A\u66F4\u50C5\u5B58\u65BC\u672C\u6A5F\uFF0C\u8ACB\u555F\u52D5 API \u5F8C\u91CD\u65B0\u52A0\u5165\u5718\u968A";
      return;
    }
    const status = await fetchApiReadiness();
    if (!status.reachable) {
      el.textContent = "\u25CF \u96E2\u7DDA\u6A21\u5F0F";
      el.className = "text-[10px] px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/25";
      el.title = "API \u7121\u6CD5\u9023\u7DDA\uFF0C\u4F7F\u7528\u672C\u6A5F\u96E2\u7DDA\u6A21\u5F0F";
      return;
    }
    if (status.ready) {
      el.textContent = "\u25CF \u5DF2\u5C31\u7DD2";
      el.className = "text-[10px] px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/25";
    } else {
      el.textContent = "\u25CF \u555F\u52D5\u4E2D";
      el.className = "text-[10px] px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/25";
    }
    el.title = formatReadinessHint(status.checks) || (status.ready ? "API \u5DF2\u5C31\u7DD2" : "API \u9023\u7DDA\u4E2D\uFF0C\u5B50\u7CFB\u7D71\u5C1A\u672A\u5C31\u7DD2");
  }
  function copyGroupCode() {
    if (!S.enterpriseSession?.groupCode) return showToast("\u5C1A\u7121\u7FA4\u7D44\u4EE3\u78BC", "error");
    const code = S.enterpriseSession.groupCode;
    const shareText = `\u52A0\u5165 Lumina \u5718\u968A\uFF0C\u7FA4\u7D44\u4EE3\u78BC\uFF1A${code}`;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(shareText).then(() => showToast("\u7FA4\u7D44\u4EE3\u78BC\u5DF2\u8907\u88FD\uFF0C\u53EF\u5206\u4EAB\u7D66\u540C\u4E8B", "success"));
    } else {
      showToast(shareText, "success");
    }
  }
  function applyTeamInviteFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const code = normalizeEnterpriseCode(params.get("group") || params.get("code") || "");
    if (!code) return;
    const input = document.getElementById("team-join-code");
    if (input) input.value = code;
    if (!S.enterpriseSession) showSection("team");
  }
  async function createEnterpriseGroup() {
    if (!isLoggedIn()) {
      showToast("\u8ACB\u5148\u767B\u5165\u5E33\u865F\uFF0C\u624D\u80FD\u5EFA\u7ACB\u4E26\u540C\u6B65\u5718\u968A", "error");
      showAuthOverlay("login");
      return;
    }
    const name = document.getElementById("team-create-name").value.trim();
    const code = normalizeEnterpriseCode(document.getElementById("team-create-code").value);
    const managerName = document.getElementById("team-create-manager").value.trim();
    const managerPin = document.getElementById("team-create-pin").value.trim() || "0000";
    if (!code || code.length < 4) return showToast("\u7FA4\u7D44\u4EE3\u78BC\u81F3\u5C11 4 \u500B\u5B57\u5143", "error");
    if (!managerName) return showToast("\u8ACB\u8F38\u5165\u4E3B\u7BA1\u540D\u7A31", "error");
    const payload = { name, code, managerName, managerPin };
    let result;
    const api = await enterpriseFetch("POST", "/api/enterprise/group/create", payload);
    if (api.ok) {
      result = api.data;
    } else {
      try {
        result = { ok: true, ...await enterpriseLocalCreate(payload) };
        showToast("\u5DF2\u5EFA\u7ACB\u7FA4\u7D44\uFF08\u672C\u6A5F\u96E2\u7DDA\u6A21\u5F0F\uFF09", "success");
      } catch (e) {
        return showToast(e.message, "error");
      }
    }
    S.enterpriseSession = {
      memberId: result.member.id,
      name: result.member.name,
      role: result.member.role,
      groupCode: result.group.code,
      groupName: result.group.name,
      offline: !api.ok
    };
    localStorage.setItem("lumina_enterprise_session", JSON.stringify(S.enterpriseSession));
    loadLocallyReadNotificationIds();
    showToast(`\u7FA4\u7D44 ${result.group.code} \u5EFA\u7ACB\u6210\u529F\uFF01`, "success");
    await refreshEnterpriseData();
    renderEnterprisePage();
    startEnterprisePolling();
    await refreshTeamNotifications(true);
  }
  async function joinEnterpriseGroup() {
    if (!isLoggedIn()) {
      showToast("\u8ACB\u5148\u767B\u5165\u5E33\u865F\uFF0C\u624D\u80FD\u52A0\u5165\u5718\u968A\u4E26\u4F7F\u7528\u77E5\u8B58\u5EAB", "error");
      showAuthOverlay("login");
      return;
    }
    const code = normalizeEnterpriseCode(document.getElementById("team-join-code").value);
    const name = document.getElementById("team-join-name").value.trim();
    const role = document.getElementById("team-join-role").value;
    const pin = document.getElementById("team-join-pin").value.trim();
    if (!code) return showToast("\u8ACB\u8F38\u5165\u7FA4\u7D44\u4EE3\u78BC", "error");
    if (!name) return showToast("\u8ACB\u8F38\u5165\u4F60\u7684\u540D\u7A31", "error");
    const payload = { code, name, role, pin };
    let result;
    const api = await enterpriseFetch("POST", "/api/enterprise/group/join", payload);
    if (api.ok) {
      result = api.data;
    } else {
      try {
        result = { ok: true, ...await enterpriseLocalJoin(payload) };
        showToast("\u5DF2\u52A0\u5165\u7FA4\u7D44\uFF08\u672C\u6A5F\u96E2\u7DDA\u6A21\u5F0F\uFF09", "success");
      } catch (e) {
        return showToast(e.message, "error");
      }
    }
    S.enterpriseSession = {
      memberId: result.member.id,
      name: result.member.name,
      role: result.member.role,
      groupCode: result.group.code,
      groupName: result.group.name,
      offline: !api.ok
    };
    localStorage.setItem("lumina_enterprise_session", JSON.stringify(S.enterpriseSession));
    loadLocallyReadNotificationIds();
    showToast(`\u5DF2\u52A0\u5165 ${result.group.name}`, "success");
    await refreshEnterpriseData();
    renderEnterprisePage();
    startEnterprisePolling();
    await refreshTeamNotifications(true);
  }
  function leaveEnterpriseGroup() {
    if (!confirm("\u78BA\u5B9A\u96E2\u958B\u76EE\u524D\u7FA4\u7D44\uFF1F")) return;
    S.enterpriseSession = null;
    S.enterpriseGroupData = null;
    S.teamNotifications = [];
    S.teamNotificationsInitialized = false;
    S.knownTeamNotificationIds.clear();
    S.locallyReadNotificationIds.clear();
    closeNotificationPanel();
    stopEnterprisePolling();
    localStorage.removeItem("lumina_enterprise_session");
    renderEnterprisePage();
    updateNotificationUI();
    showToast("\u5DF2\u96E2\u958B\u7FA4\u7D44", "success");
  }
  async function refreshEnterpriseData(force = false) {
    if (!S.enterpriseSession) return;
    const now = Date.now();
    if (!force && S.enterpriseGroupData && now - S.enterpriseDataFetchedAt < ENTERPRISE_FETCH_TTL_MS) {
      renderEnterpriseTasks();
      return;
    }
    const code = S.enterpriseSession.groupCode;
    const memberQ = `?memberId=${encodeURIComponent(S.enterpriseSession.memberId)}`;
    const api = await enterpriseFetch("GET", `/api/enterprise/group/${code}${memberQ}`);
    if (api.ok) {
      S.enterpriseGroupData = api.data.group;
      cacheEnterpriseGroupLocally(api.data.group);
      if (api.data.group.notifications) {
        processIncomingTeamNotifications(api.data.group.notifications);
      }
    } else {
      try {
        S.enterpriseGroupData = enterpriseLocalGetGroup(code, S.enterpriseSession.memberId).group;
        if (S.enterpriseGroupData.notifications) {
          processIncomingTeamNotifications(S.enterpriseGroupData.notifications);
        }
      } catch (e) {
        showToast("\u540C\u6B65\u5931\u6557\uFF1A" + e.message, "error");
        return;
      }
    }
    S.enterpriseDataFetchedAt = Date.now();
    renderEnterpriseTasks();
    if (S.enterpriseGroupData?.documents?.length) {
      ensureEnterpriseDocsInRag();
    }
  }
  function renderEnterprisePage() {
    const onboarding = document.getElementById("team-onboarding");
    const workspace = document.getElementById("team-workspace");
    const badge = document.getElementById("team-status-badge");
    const apiHint = document.getElementById("team-api-hint");
    if (!S.enterpriseSession) {
      onboarding?.classList.remove("hidden");
      workspace?.classList.add("hidden");
      if (badge) {
        badge.textContent = "\u672A\u52A0\u5165\u7FA4\u7D44";
        badge.className = "self-start sm:self-auto text-xs px-4 py-2 rounded-full bg-slate-800/80 text-slate-400 border border-slate-700/60";
      }
      document.getElementById("team-stats-row")?.classList.add("hidden");
      apiHint?.classList.remove("hidden");
      return;
    }
    onboarding?.classList.add("hidden");
    workspace?.classList.remove("hidden");
    apiHint?.classList.add("hidden");
    const offlineBanner = document.getElementById("team-offline-banner");
    if (offlineBanner) {
      offlineBanner.classList.toggle("hidden", !S.enterpriseSession.offline);
    }
    setElText("team-group-name", S.enterpriseSession.groupName);
    setElText("team-group-code", S.enterpriseSession.groupCode);
    setElText("team-user-name", S.enterpriseSession.name);
    setElText("team-user-role", S.enterpriseSession.role === "manager" ? "\u4E3B\u7BA1" : "\u6210\u54E1");
    if (badge) {
      badge.textContent = `${S.enterpriseSession.groupCode} \xB7 ${S.enterpriseSession.role === "manager" ? "\u4E3B\u7BA1" : "\u6210\u54E1"}`;
      badge.className = "self-start sm:self-auto text-xs px-4 py-2 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/25";
    }
    const isManager = S.enterpriseSession.role === "manager";
    document.getElementById("team-manager-panel")?.classList.toggle("hidden", !isManager);
    document.getElementById("team-overview-panel")?.classList.toggle("hidden", !isManager);
    document.getElementById("team-stats-row")?.classList.remove("hidden");
    const tasksTitle = document.getElementById("team-S.tasks-title");
    if (tasksTitle) tasksTitle.textContent = isManager ? "\u6211\u8CA0\u8CAC\u7684\u4EFB\u52D9" : "\u6307\u6D3E\u7D66\u6211\u7684\u4EFB\u52D9";
    const dueInput = document.getElementById("team-assign-due");
    if (dueInput && !dueInput.value) dueInput.value = getTomorrowISO();
    updateTeamSyncStatus();
    loadTeamNotificationPrefsForm();
    refreshEnterpriseData();
    updateNotificationUI();
    refreshTeamNotifications();
  }
  function renderEnterpriseTasks() {
    if (!S.enterpriseSession || !S.enterpriseGroupData) return;
    const membersEl = document.getElementById("team-members-list");
    const assignSelect = document.getElementById("team-assign-member");
    const myTasksEl = document.getElementById("team-my-tasks");
    const overviewBody = document.getElementById("team-overview-body");
    const progressEl = document.getElementById("team-my-progress");
    const members = S.enterpriseGroupData.members || [];
    const groupTasks = S.enterpriseGroupData.tasks || [];
    const syncedIds = buildSyncedEnterpriseIdSet();
    const totalTasks = groupTasks.length;
    const doneTasks = groupTasks.filter((t) => t.completed).length;
    const rate = totalTasks ? Math.round(doneTasks / totalTasks * 100) : 0;
    const statMembers = document.getElementById("team-stat-members");
    const statTasks = document.getElementById("team-stat-tasks");
    const statRate = document.getElementById("team-stat-rate");
    if (statMembers) statMembers.textContent = members.length;
    if (statTasks) statTasks.textContent = totalTasks;
    if (statRate) statRate.textContent = rate + "%";
    if (membersEl) {
      membersEl.innerHTML = members.length ? members.map((m) => renderMemberChip(m)).join("") : '<span class="text-xs text-slate-500">\u5C1A\u7121\u6210\u54E1</span>';
    }
    if (assignSelect && S.enterpriseSession.role === "manager") {
      assignSelect.innerHTML = members.filter((m) => m.role !== "manager").map((m) => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join("") || '<option value="">\uFF08\u5C1A\u7121\u6210\u54E1\uFF0C\u8ACB\u9080\u8ACB\u540C\u4E8B\u52A0\u5165\uFF09</option>';
    }
    const myTasks = groupTasks.filter((t) => t.assigneeId === S.enterpriseSession.memberId);
    const done = myTasks.filter((t) => t.completed).length;
    const myRate = myTasks.length ? Math.round(done / myTasks.length * 100) : 0;
    const progressWrap = document.getElementById("team-progress-wrap");
    const progressFill = document.getElementById("team-progress-fill");
    if (progressEl) {
      progressEl.textContent = myTasks.length ? `\u5DF2\u5B8C\u6210 ${done} / ${myTasks.length}\uFF08${myRate}%\uFF09` : "\u7B49\u5F85\u4E3B\u7BA1\u6307\u6D3E\u4EFB\u52D9";
    }
    if (progressWrap && progressFill) {
      if (myTasks.length) {
        progressWrap.classList.remove("hidden");
        progressFill.style.width = myRate + "%";
      } else {
        progressWrap.classList.add("hidden");
        progressFill.style.width = "0%";
      }
    }
    if (myTasksEl) {
      if (myTasks.length === 0) {
        myTasksEl.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon"><i class="fa-solid fa-inbox"></i></div>
                    <div class="text-sm">\u76EE\u524D\u6C92\u6709\u6307\u6D3E\u7D66\u4F60\u7684\u4EFB\u52D9</div>
                    <div class="text-xs text-slate-600 mt-1">\u5B8C\u6210\u5F8C\u4E3B\u7BA1\u6703\u5373\u6642\u770B\u5230\u66F4\u65B0</div>
                </div>`;
      } else {
        myTasksEl.innerHTML = myTasks.map((t) => renderEnterpriseTaskRow(t, true, syncedIds)).join("");
      }
    }
    if (overviewBody && S.enterpriseSession.role === "manager") {
      if (groupTasks.length === 0) {
        overviewBody.innerHTML = `
                <tr><td colspan="4">
                    <div class="empty-state py-8">
                        <div class="empty-state-icon"><i class="fa-solid fa-clipboard-list"></i></div>
                        <div class="text-sm">\u5C1A\u7121\u5718\u968A\u4EFB\u52D9</div>
                        <div class="text-xs text-slate-600 mt-1">\u5728\u4E0A\u65B9\u6307\u6D3E\u7B2C\u4E00\u500B\u4EFB\u52D9</div>
                    </div>
                </td></tr>`;
      } else {
        overviewBody.innerHTML = groupTasks.map((t) => `
                <tr>
                    <td class="px-4 py-3 font-medium">${escapeHtml(t.title)}</td>
                    <td class="px-4 py-3">
                        <span class="inline-flex items-center gap-1.5 text-slate-400">
                            <span class="member-avatar bg-indigo-500/15 text-indigo-300 border border-indigo-500/20 text-[9px]">${escapeHtml(getMemberInitials(t.assigneeName))}</span>
                            ${escapeHtml(t.assigneeName)}
                        </span>
                    </td>
                    <td class="px-4 py-3 font-mono text-xs text-slate-400">${t.due}</td>
                    <td class="px-4 py-3">
                        <span class="status-pill ${t.completed ? "status-pill-done" : "status-pill-pending"}">
                            ${t.completed ? "\u2713 \u5DF2\u5B8C\u6210" : "\u9032\u884C\u4E2D"}
                        </span>
                    </td>
                </tr>
            `).join("");
      }
    }
    renderEnterpriseDocuments();
  }
  function renderEnterpriseTaskRow(task, canToggle, syncedIds) {
    const synced = syncedIds ? syncedIds.has(task.id) : buildSyncedEnterpriseIdSet().has(task.id);
    return `
        <div class="task-row ${task.completed ? "task-row-done" : ""}" data-team-task-id="${task.id}">
            <input type="checkbox" ${task.completed ? "checked" : ""} ${canToggle ? `onclick="event.stopPropagation()" onchange="toggleEnterpriseTask('${task.id}', this.checked)"` : "disabled"}
                   class="accent-indigo-500 w-4 h-4 cursor-pointer flex-shrink-0 rounded">
            <div class="flex-1 min-w-0">
                <div class="font-medium text-sm ${task.completed ? "line-through text-slate-400" : "text-slate-200"}">${escapeHtml(task.title)}</div>
                <div class="text-[10px] text-slate-500 mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
                    <span><i class="fa-solid fa-user-tie text-[8px] mr-0.5"></i>${escapeHtml(task.assignedBy)}</span>
                    <span>\xB7</span>
                    <span>${task.duration} \u5206\u9418</span>
                    <span>\xB7</span>
                    <span class="cat-badge ${getCategoryColor(task.category)}">${getCategoryLabel(task.category)}</span>
                    <span>\xB7</span>
                    <span>\u622A\u6B62 ${task.due}</span>
                </div>
            </div>
            <div class="flex items-center gap-2 flex-shrink-0">
                ${canToggle && !synced ? `<button onclick="syncEnterpriseTaskToPersonal('${task.id}')" class="text-[10px] px-2 py-1 rounded-lg border border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/10" title="\u540C\u6B65\u5230\u500B\u4EBA\u6E05\u55AE"><i class="fa-solid fa-arrow-down-to-bracket"></i></button>` : ""}
                ${synced ? `<span class="text-[10px] text-slate-500">\u5DF2\u540C\u6B65</span>` : ""}
                <span class="status-pill ${task.completed ? "status-pill-done" : "status-pill-pending"}">
                    ${task.completed ? "\u5DF2\u5B8C\u6210" : "\u9032\u884C\u4E2D"}
                </span>
            </div>
        </div>
    `;
  }
  async function assignEnterpriseTask() {
    if (!S.enterpriseSession || S.enterpriseSession.role !== "manager") {
      return showToast("\u50C5\u4E3B\u7BA1\u53EF\u6307\u6D3E\u4EFB\u52D9", "error");
    }
    const title = document.getElementById("team-assign-title").value.trim();
    const assigneeId = document.getElementById("team-assign-member").value;
    if (!title) return showToast("\u8ACB\u8F38\u5165\u4EFB\u52D9\u540D\u7A31", "error");
    if (!assigneeId) return showToast("\u8ACB\u9078\u64C7\u6210\u54E1", "error");
    const payload = {
      groupCode: S.enterpriseSession.groupCode,
      managerId: S.enterpriseSession.memberId,
      assigneeId,
      title,
      due: document.getElementById("team-assign-due").value || getTodayISO(),
      duration: parseInt(document.getElementById("team-assign-duration").value) || 30,
      category: document.getElementById("team-assign-category").value,
      energy: 3
    };
    const api = await enterpriseFetch("POST", "/api/enterprise/task/assign", payload);
    const localAssignFallback = () => {
      const store = loadLocalEnterpriseStore();
      const group = store.groups[S.enterpriseSession.groupCode];
      const assignee = group?.members.find((m) => m.id === assigneeId);
      const manager = group?.members.find((m) => m.id === S.enterpriseSession.memberId);
      if (!group || !assignee || !manager) return showToast("\u6307\u6D3E\u5931\u6557", "error");
      const taskId = "t_" + Date.now();
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
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      });
      const created = [];
      if (assignee.id !== manager.id) {
        created.push(pushLocalTeamNotification(S.enterpriseSession.groupCode, {
          type: "task_assigned",
          recipientId: assignee.id,
          title: "\u65B0\u4EFB\u52D9\u6307\u6D3E",
          message: `${manager.name} \u6307\u6D3E\u4E86\u300C${payload.title}\u300D\u7D66\u4F60\uFF0C\u622A\u6B62 ${payload.due}`,
          taskId,
          taskTitle: payload.title,
          actorId: manager.id,
          actorName: manager.name
        }));
      }
      created.push(pushLocalTeamNotification(S.enterpriseSession.groupCode, {
        type: "task_assigned_confirm",
        recipientId: manager.id,
        title: "\u4EFB\u52D9\u5DF2\u6307\u6D3E",
        message: `\u5DF2\u5C07\u300C${payload.title}\u300D\u6307\u6D3E\u7D66 ${assignee.name}\uFF0C\u622A\u6B62 ${payload.due}`,
        taskId,
        taskTitle: payload.title,
        actorId: manager.id,
        actorName: manager.name
      }));
      saveLocalEnterpriseStore(store);
      ingestTeamNotificationsFromResponse(created.filter(Boolean));
      showToast("\u4EFB\u52D9\u5DF2\u6307\u6D3E\uFF08\u672C\u6A5F\u6A21\u5F0F\uFF09", "success");
    };
    if (api.ok) {
      ingestTeamNotificationsFromResponse(api.data.notifications || []);
      showToast("\u4EFB\u52D9\u5DF2\u6307\u6D3E\uFF01\u5DF2\u767C\u9001\u901A\u77E5", "success");
    } else {
      localAssignFallback();
    }
    document.getElementById("team-assign-title").value = "";
    await refreshEnterpriseData(true);
    await refreshTeamNotifications(true);
  }
  function getEnterprisePollInterval() {
    if (document.visibilityState !== "visible") return ENTERPRISE_POLL_INTERVAL_MS * 4;
    if ($("team")?.classList.contains("active")) return ENTERPRISE_POLL_INTERVAL_MS;
    return ENTERPRISE_POLL_INTERVAL_MS * 2;
  }
  function startEnterprisePolling() {
    stopEnterprisePolling();
    if (!S.enterpriseSession) return;
    const tick = () => {
      if (document.visibilityState === "visible") {
        refreshTeamNotifications();
        if ($("team")?.classList.contains("active")) {
          refreshEnterpriseData();
        }
      }
      S.enterprisePollTimer = setTimeout(tick, getEnterprisePollInterval());
    };
    S.enterprisePollTimer = setTimeout(tick, getEnterprisePollInterval());
  }
  document.addEventListener("visibilitychange", () => {
    if (S.enterpriseSession && !S.enterprisePollTimer) startEnterprisePolling();
  });
  function stopEnterprisePolling() {
    if (S.enterprisePollTimer) {
      clearTimeout(S.enterprisePollTimer);
      S.enterprisePollTimer = null;
    }
  }
  window.addEventListener("storage", (e) => {
    if (e.key === LOCAL_ENTERPRISE_KEY && S.enterpriseSession) {
      refreshTeamNotifications(true);
      if (document.getElementById("team")?.classList.contains("active")) {
        refreshEnterpriseData();
      }
    }
  });
  var PAGE_TITLES = {
    dashboard: "\u4ECA\u65E5",
    decomposer: "\u76EE\u6A19\u5206\u89E3",
    scheduler: "\u4EFB\u52D9",
    coach: "\u884C\u52D5\u6559\u7DF4",
    insights: "\u6578\u64DA\u6D1E\u5BDF",
    team: "\u5718\u968A\u6A21\u5F0F",
    guide: "\u4F7F\u7528\u6307\u5357",
    settings: "\u500B\u4EBA\u8A2D\u5B9A"
  };
  var MORE_SECTIONS = ["insights", "team", "guide", "settings"];
  var ONBOARDING_STEPS = [
    {
      title: "\u5F9E\u5927\u76EE\u6A19\u958B\u59CB",
      desc: "\u6709\u6A21\u7CCA\u7684\u5927\u76EE\u6A19\uFF1F\u5148\u5230\u300C\u4EFB\u52D9\u300D\u9801\u7528\u76EE\u6A19\u5206\u89E3\u5668\u62C6\u958B\uFF0CAI \u6703\u63A8\u85A6\u4F60\u4ECA\u65E5\u7B2C\u4E00\u6B65\u3002",
      icon: "fa-wand-magic-sparkles",
      iconBg: "bg-purple-500/15 text-purple-400",
      section: "scheduler",
      highlight: null,
      onEnter: () => openDecomposeTab()
    },
    {
      title: "\u9396\u5B9A\u4ECA\u65E5\u7B2C\u4E00\u6B65",
      desc: "\u56DE\u5230\u300C\u4ECA\u65E5\u300D\u9801\uFF0C\u4F60\u6703\u770B\u5230\u7CFB\u7D71\u63A8\u85A6\u7684\u4ECA\u65E5\u7B2C\u4E00\u6B65\u2014\u2014\u4ECA\u5929\u53EA\u505A\u6700\u91CD\u8981\u90A3\u4E00\u4EF6\u3002",
      icon: "fa-forward-step",
      iconBg: "bg-indigo-500/15 text-indigo-400",
      section: "dashboard",
      highlight: "next-step-card"
    },
    {
      title: "\u884C\u52D5\u6559\u7DF4\u5E36\u4F60\u505A",
      desc: "\u5361\u4F4F\u6216\u62D6\u5EF6\uFF1F\u9EDE\u300C\u6559\u7DF4\u300D\uFF0C\u5B83\u6703\u8B80\u53D6\u4F60\u7684\u4EFB\u52D9\uFF0C\u544A\u8A34\u4F60\u600E\u9EBC\u958B\u59CB\u2014\u2014\u4E0D\u662F\u7A7A\u6CDB\u804A\u5929\u3002",
      icon: "fa-bolt",
      iconBg: "bg-sky-500/15 text-sky-400",
      section: "coach"
    }
  ];
  async function checkRagServiceHealth() {
    if (!S.enterpriseSession) {
      document.getElementById("rag-kb-selector-wrap")?.classList.add("hidden");
      return;
    }
    try {
      const res = await fetch(`${RAG_SERVICE_URL}/health`);
      if (res.ok) {
        const data = await res.json();
        if (data.service === "lumina-rag-service") {
          S.ragRetrievalMode = data.retrieval || S.ragRetrievalMode;
          if (!S.ragServiceActive) {
            S.ragServiceActive = true;
            console.log(`[Lumina RAG] \u5DF2\u9023\u7DDA \u2014 \u6AA2\u7D22\u6A21\u5F0F\uFF1A${data.retrieval || "hybrid"}\uFF0CEmbedding\uFF1A${data.embedding || "local"}`);
            document.getElementById("rag-kb-selector-wrap")?.classList.remove("hidden");
            await ensureEnterpriseDocsInRag({ toast: true, force: true });
          }
          await window.renderRagKbCheckboxes();
          return;
        }
      }
    } catch (_) {
    }
    if (S.ragServiceActive) {
      S.ragServiceActive = false;
      console.log("[Lumina RAG] RAG \u670D\u52D9\u4E2D\u65B7\uFF0C\u81EA\u52D5\u5207\u56DE\u672C\u5730\u96E2\u7DDA/\u7D14\u6587\u5B57\u6A21\u5F0F\u3002");
      document.getElementById("rag-kb-selector-wrap")?.classList.add("hidden");
    }
  }
  async function renderRagKbCheckboxes() {
    const container = document.getElementById("rag-kb-checkboxes");
    if (!container || !S.enterpriseSession) return;
    let kbIds = await fetchRagKbIds(S.enterpriseSession.groupCode).catch(() => null);
    if (!kbIds || !kbIds.length) {
      kbIds = Object.keys(RAG_KB_LABELS);
    }
    const available = new Set(kbIds);
    const kbs = [...available].map((id) => ({ id, label: getRagKbLabel(id) }));
    S.checkedRagKbs = S.checkedRagKbs.filter((id) => available.has(id));
    if (!S.checkedRagKbs.length) S.checkedRagKbs = [kbs[0]?.id || "general"];
    container.innerHTML = kbs.map((kb) => {
      const checked = S.checkedRagKbs.includes(kb.id) ? "checked" : "";
      return `
            <label class="inline-flex items-center gap-1.5 cursor-pointer bg-slate-900 border border-slate-800 hover:border-slate-700/80 px-2 py-1 rounded-lg text-[10px] text-slate-300">
                <input type="checkbox" name="rag-kb" value="${kb.id}" ${checked} onchange="window.onRagKbCheckboxChange()" class="accent-purple-500 w-3 h-3">
                <span>${escapeHtml(kb.label)}</span>
            </label>
        `;
    }).join("");
  }
  function onRagKbCheckboxChange() {
    const checkboxes = document.querySelectorAll('input[name="rag-kb"]:checked');
    S.checkedRagKbs = Array.from(checkboxes).map((cb) => cb.value);
  }
  function setupRagHealthMonitoring() {
    window.checkRagServiceHealth = checkRagServiceHealth;
    window.renderRagKbCheckboxes = renderRagKbCheckboxes;
    window.onRagKbCheckboxChange = onRagKbCheckboxChange;
    checkRagServiceHealth();
    setInterval(checkRagServiceHealth, 1e4);
  }
  function pregenerateExample() {
    document.getElementById("goal-input").value = "\u5B8C\u6210 Q3 \u7522\u54C1\u8DEF\u7DDA\u5716\u4E26\u7372\u5F97\u5718\u968A\u5171\u8B58";
    decomposeGoal();
  }
  function parseLuminaArg(raw, type) {
    if (raw === void 0 || raw === "") return void 0;
    if (type === "number") return Number(raw);
    if (type === "boolean") return raw === "true";
    return raw;
  }
  async function invokeLuminaAction(name, event, args = []) {
    const fn = window[name];
    if (typeof fn !== "function") {
      console.warn("[Lumina] action not found:", name);
      return;
    }
    const passEvent = args.length === 1 && args[0] === "__event__";
    const callArgs = passEvent ? [event] : args;
    return await fn(...callArgs);
  }
  async function runLuminaActionsFromElement(el, event) {
    if (el.dataset.luminaStop !== void 0) event.stopPropagation();
    if (el.dataset.luminaActions) {
      let chain;
      try {
        chain = JSON.parse(el.dataset.luminaActions);
      } catch (_) {
        console.warn("[Lumina] invalid data-lumina-actions");
        return;
      }
      for (const item of chain) {
        const [name2, ...args2] = item;
        await invokeLuminaAction(name2, event, args2);
      }
      return;
    }
    const name = el.dataset.luminaAction;
    if (!name) return;
    const args = [];
    if (el.dataset.luminaPassEvent !== void 0) {
      args.push("__event__");
    } else if (el.dataset.luminaArg !== void 0) {
      args.push(parseLuminaArg(el.dataset.luminaArg, el.dataset.luminaArgType));
    }
    await invokeLuminaAction(name, event, args);
  }
  var __luminaDelegationReady = false;
  function setupActionDelegation() {
    if (__luminaDelegationReady) return;
    __luminaDelegationReady = true;
    document.addEventListener("click", async (event) => {
      const dismissEl = event.target.closest("[data-lumina-dismiss]");
      if (dismissEl && event.target === dismissEl) {
        event.preventDefault();
        await invokeLuminaAction(dismissEl.dataset.luminaDismiss, event, ["__event__"]);
        return;
      }
      const actionEl = event.target.closest("[data-lumina-action],[data-lumina-actions],[data-lumina-stop]");
      if (!actionEl) return;
      if (actionEl.dataset.luminaStop !== void 0 && !actionEl.dataset.luminaAction && !actionEl.dataset.luminaActions) {
        event.stopPropagation();
        return;
      }
      if (actionEl.dataset.luminaAction || actionEl.dataset.luminaActions) {
        event.preventDefault();
        await runLuminaActionsFromElement(actionEl, event);
      }
    });
    document.addEventListener("submit", async (event) => {
      const form = event.target.closest("form[data-lumina-submit]");
      if (!form) return;
      event.preventDefault();
      await invokeLuminaAction(form.dataset.luminaSubmit, event, ["__event__"]);
    });
  }
  async function initializeApp() {
    if (window.__luminaAppInitialized) return;
    window.__luminaAppInitialized = true;
    try {
      setupActionDelegation();
    } catch (e) {
      console.warn("[Lumina] Action delegation skipped", e);
    }
    try {
      initializeTailwind();
    } catch (e) {
      console.warn("[Lumina] Tailwind init skipped", e);
    }
    try {
      setupManifest();
    } catch (e) {
      console.warn("[Lumina] Manifest setup skipped", e);
    }
    try {
      registerServiceWorker();
    } catch (e) {
      console.warn("[Lumina] Service worker skipped", e);
    }
    try {
      setupPwaInstall();
    } catch (e) {
      console.warn("[Lumina] PWA install skipped", e);
    }
    try {
      setupOfflineDetection();
    } catch (e) {
      console.warn("[Lumina] Offline detection skipped", e);
    }
    loadState();
    await checkAuthOnInit();
    await window.__luminaEnsureEnterprise?.();
    applyTeamInviteFromUrl();
    if (S.enterpriseSession) {
      loadLocallyReadNotificationIds();
      updateNotificationUI();
      startEnterprisePolling();
      refreshTeamNotifications();
    }
    try {
      refreshUIImmediate({ dashboard: true, scheduler: true, filters: true });
    } catch (e) {
      console.error("[Lumina] Dashboard init failed", e);
      showToast("\u90E8\u5206\u4ECB\u9762\u8F09\u5165\u5931\u6557\uFF0C\u8ACB\u91CD\u65B0\u6574\u7406\u9801\u9762", "error");
    }
    const runIdle = (cb) => {
      if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(cb, { timeout: 2500 });
      } else {
        setTimeout(cb, 800);
      }
    };
    runIdle(() => {
      try {
        refreshServiceStatus();
      } catch (_) {
      }
    });
    const navDashboard = document.getElementById("nav-dashboard");
    if (navDashboard) navDashboard.classList.add("active", "text-indigo-400");
    setTimeout(() => {
      const streakEl = document.getElementById("streak");
      if (streakEl && Math.random() > 0.7) {
        streakEl.style.transitionDuration = "400ms";
      }
    }, 1200);
    if (S.rolledCountOnInit > 0) {
      showToast(`${S.rolledCountOnInit} \u9805\u5EF6\u5F8C\u4EFB\u52D9\u5DF2\u79FB\u81F3\u4ECA\u65E5`, "success");
    }
    setTimeout(() => {
      if (document.getElementById("auth-overlay")?.classList.contains("hidden") && !localStorage.getItem("lumina_onboarding_v2") && S.tasks.length === 0) {
        startOnboarding();
      } else if (!document.getElementById("auth-overlay")?.classList.contains("hidden")) {
      } else if (!localStorage.getItem("lumina_welcomed")) {
        showToast("\u6B61\u8FCE\u4F7F\u7528 Lumina AI\uFF01", "success");
        localStorage.setItem("lumina_welcomed", "true");
      }
    }, 900);
    setupKeyboardShortcuts();
    refreshServiceStatus();
    document.addEventListener("click", (e) => {
      const wrap = document.getElementById("nav-more-wrap");
      if (wrap && !wrap.contains(e.target)) closeNavMore();
      const notifWrap = document.getElementById("notif-wrap");
      if (S.notifPanelOpen && notifWrap && !notifWrap.contains(e.target)) closeNotificationPanel();
    });
    console.log("%c[Lumina AI] \u5DF2\u6210\u529F\u521D\u59CB\u5316\u3002\u4F7F\u7528\u8005\u53EF\u7ACB\u5373\u4F7F\u7528\u6240\u6709\u529F\u80FD\u3002", "color:#475569");
    setupRagHealthMonitoring();
    window.pregenerateExample = pregenerateExample;
  }
  var __luminaChunkCache = {};
  function __loadChunk_coach() {
    if (__luminaChunkCache["coach"]) return __luminaChunkCache["coach"];
    __luminaChunkCache["coach"] = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "js/chunks/lumina-coach.js";
      s.onload = () => resolve(window.__luminaChunks["coach"]);
      s.onerror = () => reject(new Error("Failed to load coach chunk"));
      document.head.appendChild(s);
    });
    return __luminaChunkCache["coach"];
  }
  if (typeof window["pushCoachAgentMessage"] !== "function") {
    window["pushCoachAgentMessage"] = async function(...args) {
      await __loadChunk_coach();
      return window["pushCoachAgentMessage"]?.(...args);
    };
  }
  if (typeof window["getOpeningCoachMessage"] !== "function") {
    window["getOpeningCoachMessage"] = async function(...args) {
      await __loadChunk_coach();
      return window["getOpeningCoachMessage"]?.(...args);
    };
  }
  if (typeof window["ensureCoachSessionForTask"] !== "function") {
    window["ensureCoachSessionForTask"] = async function(...args) {
      await __loadChunk_coach();
      return window["ensureCoachSessionForTask"]?.(...args);
    };
  }
  if (typeof window["startStepTimerForCoach"] !== "function") {
    window["startStepTimerForCoach"] = async function(...args) {
      await __loadChunk_coach();
      return window["startStepTimerForCoach"]?.(...args);
    };
  }
  if (typeof window["coachBeginGuidedSession"] !== "function") {
    window["coachBeginGuidedSession"] = async function(...args) {
      await __loadChunk_coach();
      return window["coachBeginGuidedSession"]?.(...args);
    };
  }
  if (typeof window["coachPauseSession"] !== "function") {
    window["coachPauseSession"] = async function(...args) {
      await __loadChunk_coach();
      return window["coachPauseSession"]?.(...args);
    };
  }
  if (typeof window["coachAdvanceStepFromAgent"] !== "function") {
    window["coachAdvanceStepFromAgent"] = async function(...args) {
      await __loadChunk_coach();
      return window["coachAdvanceStepFromAgent"]?.(...args);
    };
  }
  if (typeof window["coachCompleteTaskFromAgent"] !== "function") {
    window["coachCompleteTaskFromAgent"] = async function(...args) {
      await __loadChunk_coach();
      return window["coachCompleteTaskFromAgent"]?.(...args);
    };
  }
  if (typeof window["buildOfflineAgentReply"] !== "function") {
    window["buildOfflineAgentReply"] = async function(...args) {
      await __loadChunk_coach();
      return window["buildOfflineAgentReply"]?.(...args);
    };
  }
  if (typeof window["inferAgentActionsFromUserMsg"] !== "function") {
    window["inferAgentActionsFromUserMsg"] = async function(...args) {
      await __loadChunk_coach();
      return window["inferAgentActionsFromUserMsg"]?.(...args);
    };
  }
  if (typeof window["isGenericCoachFallback"] !== "function") {
    window["isGenericCoachFallback"] = async function(...args) {
      await __loadChunk_coach();
      return window["isGenericCoachFallback"]?.(...args);
    };
  }
  if (typeof window["coachAgentRespondWithAI"] !== "function") {
    window["coachAgentRespondWithAI"] = async function(...args) {
      await __loadChunk_coach();
      return window["coachAgentRespondWithAI"]?.(...args);
    };
  }
  if (typeof window["parseJsonFromAI"] !== "function") {
    window["parseJsonFromAI"] = async function(...args) {
      await __loadChunk_coach();
      return window["parseJsonFromAI"]?.(...args);
    };
  }
  if (typeof window["parseCoachAgentResponse"] !== "function") {
    window["parseCoachAgentResponse"] = async function(...args) {
      await __loadChunk_coach();
      return window["parseCoachAgentResponse"]?.(...args);
    };
  }
  if (typeof window["coachRespondWithAI"] !== "function") {
    window["coachRespondWithAI"] = async function(...args) {
      await __loadChunk_coach();
      return window["coachRespondWithAI"]?.(...args);
    };
  }
  if (typeof window["getCoachWorkspace"] !== "function") {
    window["getCoachWorkspace"] = async function(...args) {
      await __loadChunk_coach();
      return window["getCoachWorkspace"]?.(...args);
    };
  }
  if (typeof window["formatCoachContent"] !== "function") {
    window["formatCoachContent"] = async function(...args) {
      await __loadChunk_coach();
      return window["formatCoachContent"]?.(...args);
    };
  }
  if (typeof window["renderCoachAgentThread"] !== "function") {
    window["renderCoachAgentThread"] = async function(...args) {
      await __loadChunk_coach();
      return window["renderCoachAgentThread"]?.(...args);
    };
  }
  if (typeof window["renderCoachEmptyState"] !== "function") {
    window["renderCoachEmptyState"] = async function(...args) {
      await __loadChunk_coach();
      return window["renderCoachEmptyState"]?.(...args);
    };
  }
  if (typeof window["renderCoachAgentView"] !== "function") {
    window["renderCoachAgentView"] = async function(...args) {
      await __loadChunk_coach();
      return window["renderCoachAgentView"]?.(...args);
    };
  }
  if (typeof window["coachStartFocusNow"] !== "function") {
    window["coachStartFocusNow"] = async function(...args) {
      await __loadChunk_coach();
      return window["coachStartFocusNow"]?.(...args);
    };
  }
  if (typeof window["refreshCoachView"] !== "function") {
    window["refreshCoachView"] = async function(...args) {
      await __loadChunk_coach();
      return window["refreshCoachView"]?.(...args);
    };
  }
  if (typeof window["askCoach"] !== "function") {
    window["askCoach"] = async function(...args) {
      await __loadChunk_coach();
      return window["askCoach"]?.(...args);
    };
  }
  if (typeof window["sendCoachAgentMessage"] !== "function") {
    window["sendCoachAgentMessage"] = async function(...args) {
      await __loadChunk_coach();
      return window["sendCoachAgentMessage"]?.(...args);
    };
  }
  if (typeof window["sendChatMessage"] !== "function") {
    window["sendChatMessage"] = async function(...args) {
      await __loadChunk_coach();
      return window["sendChatMessage"]?.(...args);
    };
  }
  if (typeof window["getCoachContext"] !== "function") {
    window["getCoachContext"] = async function(...args) {
      await __loadChunk_coach();
      return window["getCoachContext"]?.(...args);
    };
  }
  if (typeof window["buildCoachContextText"] !== "function") {
    window["buildCoachContextText"] = async function(...args) {
      await __loadChunk_coach();
      return window["buildCoachContextText"]?.(...args);
    };
  }
  if (typeof window["updateCoachContextBar"] !== "function") {
    window["updateCoachContextBar"] = async function(...args) {
      await __loadChunk_coach();
      return window["updateCoachContextBar"]?.(...args);
    };
  }
  if (typeof window["getCoachReadinessChecks"] !== "function") {
    window["getCoachReadinessChecks"] = async function(...args) {
      await __loadChunk_coach();
      return window["getCoachReadinessChecks"]?.(...args);
    };
  }
  if (typeof window["renderCoachReadinessBar"] !== "function") {
    window["renderCoachReadinessBar"] = async function(...args) {
      await __loadChunk_coach();
      return window["renderCoachReadinessBar"]?.(...args);
    };
  }
  if (typeof window["renderCoachQuickActions"] !== "function") {
    window["renderCoachQuickActions"] = async function(...args) {
      await __loadChunk_coach();
      return window["renderCoachQuickActions"]?.(...args);
    };
  }
  if (typeof window["openCoachForNextTask"] !== "function") {
    window["openCoachForNextTask"] = async function(...args) {
      await __loadChunk_coach();
      return window["openCoachForNextTask"]?.(...args);
    };
  }
  if (typeof window["decomposeGoalWithAI"] !== "function") {
    window["decomposeGoalWithAI"] = async function(...args) {
      await __loadChunk_coach();
      return window["decomposeGoalWithAI"]?.(...args);
    };
  }
  if (typeof window["askCoachAboutNextTask"] !== "function") {
    window["askCoachAboutNextTask"] = async function(...args) {
      await __loadChunk_coach();
      return window["askCoachAboutNextTask"]?.(...args);
    };
  }
  if (typeof window["openCoachForTask"] !== "function") {
    window["openCoachForTask"] = async function(...args) {
      await __loadChunk_coach();
      return window["openCoachForTask"]?.(...args);
    };
  }
  if (typeof window["renderDecomposePlan"] !== "function") {
    window["renderDecomposePlan"] = async function(...args) {
      await __loadChunk_coach();
      return window["renderDecomposePlan"]?.(...args);
    };
  }
  if (typeof window["decomposeGoal"] !== "function") {
    window["decomposeGoal"] = async function(...args) {
      await __loadChunk_coach();
      return window["decomposeGoal"]?.(...args);
    };
  }
  if (typeof window["generateSmartDecomposition"] !== "function") {
    window["generateSmartDecomposition"] = async function(...args) {
      await __loadChunk_coach();
      return window["generateSmartDecomposition"]?.(...args);
    };
  }
  if (typeof window["useExampleGoal"] !== "function") {
    window["useExampleGoal"] = async function(...args) {
      await __loadChunk_coach();
      return window["useExampleGoal"]?.(...args);
    };
  }
  if (typeof window["copyPlanToClipboard"] !== "function") {
    window["copyPlanToClipboard"] = async function(...args) {
      await __loadChunk_coach();
      return window["copyPlanToClipboard"]?.(...args);
    };
  }
  if (typeof window["addFirstStepToToday"] !== "function") {
    window["addFirstStepToToday"] = async function(...args) {
      await __loadChunk_coach();
      return window["addFirstStepToToday"]?.(...args);
    };
  }
  if (typeof window["addDecomposedToScheduler"] !== "function") {
    window["addDecomposedToScheduler"] = async function(...args) {
      await __loadChunk_coach();
      return window["addDecomposedToScheduler"]?.(...args);
    };
  }
  if (typeof window["findTaskForPlan"] !== "function") {
    window["findTaskForPlan"] = async function(...args) {
      await __loadChunk_coach();
      return window["findTaskForPlan"]?.(...args);
    };
  }
  if (typeof window["linkPlanToTask"] !== "function") {
    window["linkPlanToTask"] = async function(...args) {
      await __loadChunk_coach();
      return window["linkPlanToTask"]?.(...args);
    };
  }
  if (typeof window["syncFocusSessionWithPlan"] !== "function") {
    window["syncFocusSessionWithPlan"] = async function(...args) {
      await __loadChunk_coach();
      return window["syncFocusSessionWithPlan"]?.(...args);
    };
  }
  if (typeof window["normalizeCoachPlan"] !== "function") {
    window["normalizeCoachPlan"] = async function(...args) {
      await __loadChunk_coach();
      return window["normalizeCoachPlan"]?.(...args);
    };
  }
  if (typeof window["estimatePlanDuration"] !== "function") {
    window["estimatePlanDuration"] = async function(...args) {
      await __loadChunk_coach();
      return window["estimatePlanDuration"]?.(...args);
    };
  }
  if (typeof window["parseBulletToField"] !== "function") {
    window["parseBulletToField"] = async function(...args) {
      await __loadChunk_coach();
      return window["parseBulletToField"]?.(...args);
    };
  }
  if (typeof window["ensureDocumentFields"] !== "function") {
    window["ensureDocumentFields"] = async function(...args) {
      await __loadChunk_coach();
      return window["ensureDocumentFields"]?.(...args);
    };
  }
  if (typeof window["renderEditableDocumentHtml"] !== "function") {
    window["renderEditableDocumentHtml"] = async function(...args) {
      await __loadChunk_coach();
      return window["renderEditableDocumentHtml"]?.(...args);
    };
  }
  if (typeof window["updateCoachDocField"] !== "function") {
    window["updateCoachDocField"] = async function(...args) {
      await __loadChunk_coach();
      return window["updateCoachDocField"]?.(...args);
    };
  }
  if (typeof window["toggleCoachChecklistItem"] !== "function") {
    window["toggleCoachChecklistItem"] = async function(...args) {
      await __loadChunk_coach();
      return window["toggleCoachChecklistItem"]?.(...args);
    };
  }
  if (typeof window["extractTaskNameFromMessage"] !== "function") {
    window["extractTaskNameFromMessage"] = async function(...args) {
      await __loadChunk_coach();
      return window["extractTaskNameFromMessage"]?.(...args);
    };
  }
  if (typeof window["inferTaskDocType"] !== "function") {
    window["inferTaskDocType"] = async function(...args) {
      await __loadChunk_coach();
      return window["inferTaskDocType"]?.(...args);
    };
  }
  if (typeof window["buildTaskResources"] !== "function") {
    window["buildTaskResources"] = async function(...args) {
      await __loadChunk_coach();
      return window["buildTaskResources"]?.(...args);
    };
  }
  if (typeof window["buildDocumentDraft"] !== "function") {
    window["buildDocumentDraft"] = async function(...args) {
      await __loadChunk_coach();
      return window["buildDocumentDraft"]?.(...args);
    };
  }
  if (typeof window["buildOfflineCoachPlan"] !== "function") {
    window["buildOfflineCoachPlan"] = async function(...args) {
      await __loadChunk_coach();
      return window["buildOfflineCoachPlan"]?.(...args);
    };
  }
  if (typeof window["coachPlanToMarkdown"] !== "function") {
    window["coachPlanToMarkdown"] = async function(...args) {
      await __loadChunk_coach();
      return window["coachPlanToMarkdown"]?.(...args);
    };
  }
  if (typeof window["renderCoachPlan"] !== "function") {
    window["renderCoachPlan"] = async function(...args) {
      await __loadChunk_coach();
      return window["renderCoachPlan"]?.(...args);
    };
  }
  if (typeof window["storeCoachPlan"] !== "function") {
    window["storeCoachPlan"] = async function(...args) {
      await __loadChunk_coach();
      return window["storeCoachPlan"]?.(...args);
    };
  }
  if (typeof window["copyCoachPlan"] !== "function") {
    window["copyCoachPlan"] = async function(...args) {
      await __loadChunk_coach();
      return window["copyCoachPlan"]?.(...args);
    };
  }
  if (typeof window["downloadCoachDocument"] !== "function") {
    window["downloadCoachDocument"] = async function(...args) {
      await __loadChunk_coach();
      return window["downloadCoachDocument"]?.(...args);
    };
  }
  if (typeof window["startCoachPlan"] !== "function") {
    window["startCoachPlan"] = async function(...args) {
      await __loadChunk_coach();
      return window["startCoachPlan"]?.(...args);
    };
  }
  if (typeof window["applyCoachStepsAsTasks"] !== "function") {
    window["applyCoachStepsAsTasks"] = async function(...args) {
      await __loadChunk_coach();
      return window["applyCoachStepsAsTasks"]?.(...args);
    };
  }
  function __loadChunk_enterprise_docs() {
    if (__luminaChunkCache["enterprise-docs"]) return __luminaChunkCache["enterprise-docs"];
    __luminaChunkCache["enterprise-docs"] = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "js/chunks/lumina-enterprise-docs.js";
      s.onload = () => resolve(window.__luminaChunks["enterprise-docs"]);
      s.onerror = () => reject(new Error("Failed to load enterprise-docs chunk"));
      document.head.appendChild(s);
    });
    return __luminaChunkCache["enterprise-docs"];
  }
  if (typeof window["ensurePdfJs"] !== "function") {
    window["ensurePdfJs"] = async function(...args) {
      await __loadChunk_enterprise_docs();
      return window["ensurePdfJs"]?.(...args);
    };
  }
  if (typeof window["ensureXlsx"] !== "function") {
    window["ensureXlsx"] = async function(...args) {
      await __loadChunk_enterprise_docs();
      return window["ensureXlsx"]?.(...args);
    };
  }
  if (typeof window["toggleAddDocForm"] !== "function") {
    window["toggleAddDocForm"] = async function(...args) {
      await __loadChunk_enterprise_docs();
      return window["toggleAddDocForm"]?.(...args);
    };
  }
  if (typeof window["switchDocFormType"] !== "function") {
    window["switchDocFormType"] = async function(...args) {
      await __loadChunk_enterprise_docs();
      return window["switchDocFormType"]?.(...args);
    };
  }
  if (typeof window["handleDocFileSelect"] !== "function") {
    window["handleDocFileSelect"] = async function(...args) {
      await __loadChunk_enterprise_docs();
      return window["handleDocFileSelect"]?.(...args);
    };
  }
  if (typeof window["extractTextFromPdf"] !== "function") {
    window["extractTextFromPdf"] = async function(...args) {
      await __loadChunk_enterprise_docs();
      return window["extractTextFromPdf"]?.(...args);
    };
  }
  if (typeof window["extractTextFromExcel"] !== "function") {
    window["extractTextFromExcel"] = async function(...args) {
      await __loadChunk_enterprise_docs();
      return window["extractTextFromExcel"]?.(...args);
    };
  }
  if (typeof window["saveTeamDocument"] !== "function") {
    window["saveTeamDocument"] = async function(...args) {
      await __loadChunk_enterprise_docs();
      return window["saveTeamDocument"]?.(...args);
    };
  }
  if (typeof window["deleteTeamDocument"] !== "function") {
    window["deleteTeamDocument"] = async function(...args) {
      await __loadChunk_enterprise_docs();
      return window["deleteTeamDocument"]?.(...args);
    };
  }
  if (typeof window["renderEnterpriseDocuments"] !== "function") {
    window["renderEnterpriseDocuments"] = async function(...args) {
      await __loadChunk_enterprise_docs();
      return window["renderEnterpriseDocuments"]?.(...args);
    };
  }
  window.__luminaEnsureCoach = () => __loadChunk_coach();
  window.__luminaEnsureEnterprise = () => __loadChunk_enterprise_docs();
  window.__luminaPreloadSection = async (section) => {
    if (section === "coach" || section === "scheduler") await __loadChunk_coach();
    if (section === "team") await __loadChunk_enterprise_docs();
  };
  var __origShowSection = showSection;
  showSection = async function(section) {
    await window.__luminaPreloadSection?.(section);
    return __origShowSection(section);
  };
  window.showSection = showSection;
  window["addTaskToList"] = addTaskToList;
  window["assignEnterpriseTask"] = assignEnterpriseTask;
  window["clearAllTasks"] = clearAllTasks;
  window["clearApiKey"] = clearApiKey;
  window["closeMobileMore"] = closeMobileMore;
  window["closeNotificationPanel"] = closeNotificationPanel;
  window["closeTaskEdit"] = closeTaskEdit;
  window["copyGroupCode"] = copyGroupCode;
  window["createEnterpriseGroup"] = createEnterpriseGroup;
  window["dismissAuthAsGuest"] = dismissAuthAsGuest;
  window["exportData"] = exportData;
  window["focusQuickAdd"] = focusQuickAdd;
  window["handleLogin"] = handleLogin;
  window["handleLogout"] = handleLogout;
  window["handleRegister"] = handleRegister;
  window["initializeApp"] = initializeApp;
  window["isSafeHttpUrl"] = isSafeHttpUrl;
  window["joinEnterpriseGroup"] = joinEnterpriseGroup;
  window["leaveEnterpriseGroup"] = leaveEnterpriseGroup;
  window["markAllTeamNotificationsRead"] = markAllTeamNotificationsRead;
  window["mergeTasksArrays"] = mergeTasksArrays;
  window["navigateFromMobileMore"] = navigateFromMobileMore;
  window["navigateFromMore"] = navigateFromMore;
  window["nextOnboardingStep"] = nextOnboardingStep;
  window["openDecomposeTab"] = openDecomposeTab;
  window["openUserMenu"] = openUserMenu;
  window["optimizeSchedule"] = optimizeSchedule;
  window["promptInstall"] = promptInstall;
  window["quickAddTask"] = quickAddTask;
  window["quickStartToday"] = quickStartToday;
  window["recalculateInsights"] = recalculateInsights;
  window["refreshEnterpriseData"] = refreshEnterpriseData;
  window["refreshServiceStatus"] = refreshServiceStatus;
  window["renderTaskList"] = renderTaskList;
  window["resetAllData"] = resetAllData;
  window["sanitizeHtml"] = sanitizeHtml;
  window["saveSettings"] = saveSettings;
  window["saveTaskEdit"] = saveTaskEdit;
  window["showAuthOverlay"] = showAuthOverlay;
  window["showGuideTab"] = showGuideTab;
  window["showSection"] = showSection;
  window["skipOnboarding"] = skipOnboarding;
  window["switchAuthTab"] = switchAuthTab;
  window["switchSchedulerTab"] = switchSchedulerTab;
  window["testApiConnection"] = testApiConnection;
  window["toggleDashStats"] = toggleDashStats;
  window["toggleMobileMore"] = toggleMobileMore;
  window["toggleNavMore"] = toggleNavMore;
  window["toggleNotificationPanel"] = toggleNotificationPanel;
  window.initializeApp = initializeApp;
  window.onload = () => initializeApp();
  window.lumina = () => triggerConfetti();

  // js/modules/virtual/list.js
  var DEFAULT_ROW_HEIGHT = 76;
  var DEFAULT_THRESHOLD = 36;
  var DEFAULT_OVERSCAN = 4;
  function mountVirtualList(container, options) {
    const {
      items = [],
      renderRow,
      rowHeight = DEFAULT_ROW_HEIGHT,
      threshold = DEFAULT_THRESHOLD,
      overscan = DEFAULT_OVERSCAN
    } = options || {};
    if (!container || typeof renderRow !== "function") {
      return { refresh() {
      } };
    }
    if (items.length <= threshold) {
      container.classList.remove("virtual-list-host");
      container.dataset.virtual = "off";
      container.innerHTML = items.map((item, index) => renderRow(item, index)).join("");
      container.onscroll = null;
      return {
        refresh(nextItems) {
          mountVirtualList(container, { ...options, items: nextItems || [] });
        }
      };
    }
    container.classList.add("virtual-list-host");
    container.dataset.virtual = "on";
    let list = items;
    let scrollTop = container.scrollTop || 0;
    function paint() {
      const viewport = container.clientHeight || 320;
      const totalHeight = list.length * rowHeight;
      const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
      const visible = Math.ceil(viewport / rowHeight) + overscan * 2;
      const end = Math.min(list.length, start + visible);
      const offsetY = start * rowHeight;
      container.innerHTML = `
            <div class="virtual-list-track" style="height:${totalHeight}px;position:relative;width:100%">
                <div class="virtual-list-window" style="position:absolute;left:0;right:0;top:0;transform:translateY(${offsetY}px)">
                    ${list.slice(start, end).map((item, index) => renderRow(item, start + index)).join("")}
                </div>
            </div>`;
    }
    let scrollRaf = null;
    container.onscroll = () => {
      scrollTop = container.scrollTop;
      if (scrollRaf) return;
      scrollRaf = requestAnimationFrame(() => {
        scrollRaf = null;
        paint();
      });
    };
    paint();
    return {
      refresh(nextItems) {
        list = nextItems || list;
        scrollTop = container.scrollTop || 0;
        paint();
      }
    };
  }
  var LuminaVirtual = { mountVirtualList };

  // js/main.js
  if (typeof window !== "undefined") window.LuminaVirtual = LuminaVirtual;
})();
