/**
 * Lumina AI — 主應用邏輯
 * 由 lumina-ai.html 拆出，維持全域函式供 onclick 使用
 */
// Tailwind script
function initializeTailwind() {
    document.documentElement.style.setProperty('--accent', '#6366f1');
    if (typeof tailwind === 'undefined') return;
    tailwind.config = {
        theme: {
            extend: {
                fontFamily: {
                    'sans': ['Inter', 'Noto Sans TC', 'system-ui', 'sans-serif']
                }
            }
        }
    };
}

// Global state
let tasks = [];
let weeklyScores = [0, 0, 0, 0, 0, 0, 0];
let dailyHistory = {};
let currentDecomposedPlan = null;
let activeCategoryFilter = 'all';
let deferredInstallPrompt = null;
let editingTaskId = null;
const DAILY_HISTORY_KEY = 'lumina_daily_history';
const LAST_ACTIVE_DATE_KEY = 'lumina_last_active_date';
let userProfile = {
    name: 'Alex Chen', role: '產品經理', streak: 12, bestStreak: 19, joinDay: 47,
    workStart: '09:00', workEnd: '18:00', peakStart: '09:00', peakEnd: '12:30',
    streakThreshold: 80, enableConfetti: true,
    apiEnabled: false, apiMode: 'direct', apiModel: 'deepseek-chat',
    apiProxyUrl: 'http://localhost:3001/api/chat',
    enterpriseApiUrl: 'http://localhost:3001'
};

let enterpriseSession = null;
let enterpriseGroupData = null;
let enterprisePollTimer = null;
let teamNotifications = [];
const knownTeamNotificationIds = new Set();
let notifPanelOpen = false;
let teamNotificationsInitialized = false;
const enterpriseToggleInFlight = new Set();
let chatHistory = [];
let coachAgentMessages = [];
let coachRequestInFlight = false;
const coachPlans = new Map();

// RAG Global States
let ragServiceActive = false;
let ragRetrievalMode = 'hybrid';
let ragSyncedGroupKey = null;
let userDataSyncTimer = null;
const USER_DATA_SYNC_DELAY_MS = 800;
let checkedRagKbs = ['general'];
const RAG_SERVICE_URL = "http://127.0.0.1:8000";
const RAG_KB_LABELS = {
    general: '一般預設 (General)',
    onboarding: '新人培訓 (Onboarding)',
    specs: '開發規格 (Specs)',
    meetings: '會議 SOP (Meetings)'
};

function getRagFilenameForDoc(doc) {
    if (!doc) return '';
    if (doc.filename) return doc.filename;
    if (doc.title) return `text::${doc.title}.md`;
    return '';
}

function getRagKbLabel(kbId) {
    return RAG_KB_LABELS[kbId] || kbId;
}

async function syncDocumentToRag({ groupCode, kbId, docType, title, content, filename, fileData }, options = {}) {
    if (!groupCode) return false;
    const kb = kbId || 'general';
    const ragFilename = filename || `text::${title}.md`;
    const textContent = (content || '').trim();

    try {
        if (textContent) {
            const res = await fetch(`${RAG_SERVICE_URL}/api/rag/document/upload-text`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    group_code: groupCode,
                    kb_id: kb,
                    title,
                    content: textContent,
                    filename: docType === 'text' ? `text::${title}.md` : ragFilename
                })
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || `RAG 文字索引失敗 (${res.status})`);
            }
        } else if (fileData && filename && (docType === 'pdf' || docType === 'excel')) {
            const byteCharacters = atob(fileData);
            const byteArray = new Uint8Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
                byteArray[i] = byteCharacters.charCodeAt(i);
            }
            const mime = docType === 'pdf'
                ? 'application/pdf'
                : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
            const fileBlob = new Blob([byteArray], { type: mime });
            const formData = new FormData();
            formData.append('group_code', groupCode);
            formData.append('kb_id', kb);
            formData.append('file', fileBlob, filename);
            const res = await fetch(`${RAG_SERVICE_URL}/api/rag/document/upload`, {
                method: 'POST',
                body: formData
            });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.detail || `RAG 檔案索引失敗 (${res.status})`);
            }
        } else {
            throw new Error('沒有可索引的文件內容');
        }

        console.log(`[Lumina RAG] 已索引：${title} (${kb})`);
        if (options.toastOnSuccess) showToast(`已同步至 RAG：${title}`, 'success');
        return true;
    } catch (e) {
        console.warn('[Lumina RAG] 文件索引同步失敗:', e.message);
        if (options.toastOnError) showToast(`RAG 索引失敗：${e.message}`, 'error');
        return false;
    }
}

async function reindexEnterpriseDocumentsToRag(options = {}) {
    if (!enterpriseSession || !enterpriseGroupData?.documents?.length) return { ok: 0, fail: 0 };

    let ok = 0;
    let fail = 0;
    for (const doc of enterpriseGroupData.documents) {
        const synced = await syncDocumentToRag({
            groupCode: enterpriseSession.groupCode,
            kbId: doc.kbId || 'general',
            docType: doc.docType || 'text',
            title: doc.title,
            content: doc.content,
            filename: getRagFilenameForDoc(doc)
        });
        if (synced) ok++;
        else fail++;
    }

    if (options.toast && ok > 0) {
        showToast(`已重新同步 ${ok} 份文件至 RAG 知識庫`, 'success');
    }
    if (options.toast && fail > 0) {
        showToast(`${fail} 份文件同步 RAG 失敗，請稍後再試`, 'error');
    }
    if (ok > 0) await window.renderRagKbCheckboxes?.();
    return { ok, fail };
}

async function ensureEnterpriseDocsInRag(options = {}) {
    if (!enterpriseSession || !enterpriseGroupData?.documents?.length) return;
    const syncKey = `${enterpriseSession.groupCode}:${enterpriseGroupData.documents.map(d => d.id).join(',')}`;
    if (!options.force && ragSyncedGroupKey === syncKey) return;

    try {
        const res = await fetch(`${RAG_SERVICE_URL}/health`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.service !== 'lumina-rag-service') return;
    } catch (_) {
        return;
    }

    const result = await reindexEnterpriseDocumentsToRag(options);
    if (result.ok > 0) ragSyncedGroupKey = syncKey;
}

async function deleteDocumentFromRag({ groupCode, kbId, filename }) {
    if (!ragServiceActive || !groupCode || !filename) return;
    try {
        const formData = new FormData();
        formData.append('group_code', groupCode);
        formData.append('kb_id', kbId || 'general');
        formData.append('filename', filename);
        const res = await fetch(`${RAG_SERVICE_URL}/api/rag/document/delete`, {
            method: 'POST',
            body: formData
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.detail || `RAG 刪除失敗 (${res.status})`);
        }
        console.log('[Lumina RAG] 文件已從知識庫索引移除。');
    } catch (e) {
        console.warn('[Lumina RAG] 知識庫刪除同步失敗:', e.message);
    }
}

async function fetchRagKbIds(groupCode) {
    const res = await fetch(`${RAG_SERVICE_URL}/api/rag/kb/list?group_code=${encodeURIComponent(groupCode)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data.kb_ids) ? data.kb_ids : null;
}
const taskCoachPlans = new Map();
let rolledCountOnInit = 0;
let todayFocusTaskId = null;
let focusSession = null;
let focusTimerInterval = null;
let analyticsPersistTimer = null;
let chartJsLoadPromise = null;
let enterpriseDataFetchedAt = 0;
let todayStatsCache = null;
let weeklyChartInstance = null;
let pieChartInstance = null;
const AUTH_SESSION_KEY = 'lumina_auth_session';
const AUTH_USERS_KEY = 'lumina_users';
const LOCAL_ENTERPRISE_KEY = 'lumina_enterprise_local_store';
const TEAM_NOTIF_PREFS_KEY = 'lumina_team_notif_prefs';
const CHART_JS_URL = 'https://cdn.jsdelivr.net/npm/chart.js@3.9.1/dist/chart.min.js';
const ENTERPRISE_FETCH_TTL_MS = 5000;
const ENTERPRISE_POLL_INTERVAL_MS = 15000;

const CATEGORIES = {
    deep:       { label: '深度工作', color: 'bg-indigo-500/10 text-indigo-400' },
    execution:  { label: '執行協作', color: 'bg-purple-500/10 text-purple-400' },
    meeting:    { label: '會議溝通', color: 'bg-pink-500/10 text-pink-400' },
    learning:   { label: '學習成長', color: 'bg-amber-500/10 text-amber-400' },
    admin:      { label: '行政雜務', color: 'bg-slate-500/10 text-slate-300' }
};

function inferCategory(name, energy) {
    const lower = name.toLowerCase();
    if (/會議|同步|討論|standup|review 會/.test(lower)) return 'meeting';
    if (/學習|課程|閱讀|研究|prompt/.test(lower)) return 'learning';
    if (/郵件|回覆|行政|okr|追蹤|整理/.test(lower)) return 'admin';
    if (/撰寫|設計|開發|分析|規劃|審核|提案|簡報/.test(lower)) return energy >= 4 ? 'deep' : 'execution';
    if (energy >= 5) return 'deep';
    if (energy >= 4) return 'deep';
    if (energy === 3) return 'execution';
    return 'admin';
}

function getCategoryLabel(cat) {
    return CATEGORIES[cat]?.label || '其他';
}

function getCategoryColor(cat) {
    return CATEGORIES[cat]?.color || 'bg-slate-500/10 text-slate-300';
}

function $(id) {
    return document.getElementById(id);
}

function resolveCategory(task) {
    return task.category || inferCategory(task.name, task.energy || 3);
}

function invalidateTodayStats() {
    todayStatsCache = null;
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
    
    for (const t of tasks) {
        if (!t.completed && t.energy >= 4) stats.highEnergyPending++;
        if (t.due <= today) {
            stats.relevant.push(t);
            if (t.completed) {
                stats.completed++;
                stats.focusMinutes += t.duration || 0;
            } else {
                stats.pending.push(t);
            }
        } else if (!t.completed) {
            stats.futurePending.push(t);
        }
    }
    stats.futureCount = stats.futurePending.length;
    stats.rate = stats.relevant.length
        ? Math.round((stats.completed / stats.relevant.length) * 100)
        : 0;
    return stats;
}

function getTodayStats() {
    if (!todayStatsCache) todayStatsCache = computeTodayStats();
    return todayStatsCache;
}

function getScoringContext() {
    return {
        today: getTodayISO(),
        hour: new Date().getHours(),
        peakStart: parseHour(userProfile.peakStart),
        peakEnd: parseHour(userProfile.peakEnd)
    };
}

function buildSyncedEnterpriseIdSet() {
    const ids = new Set();
    for (const t of tasks) {
        if (t.enterpriseTaskId) ids.add(t.enterpriseTaskId);
    }
    return ids;
}

function migrateTasks() {
    tasks = tasks.map(t => ({
        ...t,
        category: t.category || inferCategory(t.name, t.energy || 3)
    }));
}

function addMinutes(timeStr, mins) {
    const [h, m] = timeStr.split(':').map(Number);
    const total = h * 60 + m + mins;
    return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function getInitials(name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
}

function getFilteredTasks(taskList) {
    if (activeCategoryFilter === 'all') return taskList;
    return taskList.filter(t => resolveCategory(t) === activeCategoryFilter);
}

function getCategoryCounts() {
    const counts = { all: tasks.length };
    Object.keys(CATEGORIES).forEach(k => { counts[k] = 0; });
    tasks.forEach(t => {
        const cat = resolveCategory(t);
        if (counts[cat] !== undefined) counts[cat]++;
    });
    return counts;
}

function refreshUI(parts = {}) {
    const {
        dashboard = false,
        scheduler = false,
        filters = true,
        schedule = false
    } = parts;
    invalidateTodayStats();
    if (filters) renderCategoryFilters();
    if (dashboard) updateDashboard();
    if (scheduler) renderTaskList();
    if (schedule && $('scheduler')?.classList.contains('active')) {
        optimizeSchedule(true);
    }
}

function setCategoryFilter(cat) {
    activeCategoryFilter = cat;
    refreshUI({ dashboard: true, scheduler: true });
}

function renderCategoryFilters() {
    const counts = getCategoryCounts();
    const chips = [
        { id: 'all', label: '全部', color: 'border-slate-600 text-slate-300' },
        ...Object.entries(CATEGORIES).map(([id, c]) => ({ id, label: c.label, color: c.color }))
    ];
    
    const html = chips.map(chip => {
        const count = counts[chip.id] || 0;
        const active = activeCategoryFilter === chip.id;
        return `<button onclick="setCategoryFilter('${chip.id}')" class="filter-chip text-[10px] px-2.5 py-1 rounded-full border border-slate-700 ${chip.color} ${active ? 'active !border-indigo-500 !text-indigo-300' : 'hover:bg-slate-800'}">${chip.label}${count > 0 ? ` (${count})` : ''}</button>`;
    }).join('');
    
    ['scheduler-category-filters', 'dashboard-category-filters'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = html;
    });
}

function generateManifestIcon() {
    const fallback = 'data:image/svg+xml,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><rect width="192" height="192" rx="32" fill="#6366f1"/><text x="96" y="110" text-anchor="middle" font-size="80" fill="#fff">⚡</text></svg>'
    );
    const canvas = document.createElement('canvas');
    canvas.width = 192;
    canvas.height = 192;
    const ctx = canvas.getContext('2d');
    if (!ctx) return fallback;
    const grad = ctx.createLinearGradient(0, 0, 192, 192);
    grad.addColorStop(0, '#6366f1');
    grad.addColorStop(0.5, '#a855f7');
    grad.addColorStop(1, '#ec4899');
    ctx.fillStyle = grad;
    if (ctx.roundRect) {
        ctx.beginPath();
        ctx.roundRect(24, 24, 144, 144, 32);
        ctx.fill();
    } else {
        ctx.fillRect(24, 24, 144, 144);
    }
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 80px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('⚡', 96, 100);
    return canvas.toDataURL('image/png');
}

function setupManifest() {
    const iconUrl = generateManifestIcon();
    const manifest = {
        name: '光流 AI Lumina',
        short_name: 'Lumina',
        description: '大目標拆成小步，AI 告訴你今日第一步該做什麼',
        start_url: window.location.href.split('?')[0],
        scope: './',
        display: 'standalone',
        background_color: '#020617',
        theme_color: '#6366f1',
        lang: 'zh-TW',
        icons: [
            { src: iconUrl, sizes: '192x192', type: 'image/png', purpose: 'any maskable' }
        ]
    };
    
    const link = document.createElement('link');
    link.rel = 'manifest';
    link.href = URL.createObjectURL(new Blob([JSON.stringify(manifest)], { type: 'application/json' }));
    document.head.appendChild(link);
    
    let appleIcon = document.querySelector('link[rel="apple-touch-icon"]');
    if (!appleIcon) {
        appleIcon = document.createElement('link');
        appleIcon.rel = 'apple-touch-icon';
        document.head.appendChild(appleIcon);
    }
    appleIcon.href = iconUrl;
}

function registerServiceWorker() {
    if (!('serviceWorker' in navigator) || window.location.protocol === 'file:') return;
    
    const swCode = `
        const CACHE = 'lumina-v7';
        const PRECACHE = [
            'https://cdn.tailwindcss.com',
            'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css',
            'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=Noto+Sans+TC:wght@300;400;500;700&display=swap'
        ];
        
        self.addEventListener('install', e => {
            e.waitUntil(
                caches.open(CACHE).then(c => c.addAll(PRECACHE).catch(() => {}))
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
            e.respondWith(
                fetch(e.request).then(res => {
                    if (res.ok) {
                        const clone = res.clone();
                        caches.open(CACHE).then(c => c.put(e.request, clone));
                    }
                    return res;
                }).catch(() => caches.match(e.request).then(cached =>
                    cached || new Response('離線中，請稍後再試', { status: 503, statusText: 'Offline' })
                ))
            );
        });
    `;
    
    const blob = new Blob([swCode], { type: 'application/javascript' });
    navigator.serviceWorker.register(URL.createObjectURL(blob))
        .then(() => updatePwaStatus('已啟用離線快取'))
        .catch(() => updatePwaStatus('離線快取啟用失敗（不影響正常使用）'));
}

function updatePwaStatus(msg) {
    const el = document.getElementById('pwa-status');
    if (el) el.textContent = msg;
}

function setupPwaInstall() {
    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredInstallPrompt = e;
        const btn = document.getElementById('pwa-install-btn');
        if (btn) btn.classList.remove('hidden');
        updatePwaStatus('可安裝到主畫面，像 App 一樣使用');
    });
    
    window.addEventListener('appinstalled', () => {
        deferredInstallPrompt = null;
        const btn = document.getElementById('pwa-install-btn');
        if (btn) btn.classList.add('hidden');
        updatePwaStatus('✅ 已安裝到主畫面');
        showToast('Lumina 已安裝到主畫面！', 'success');
    });
    
    if (window.matchMedia('(display-mode: standalone)').matches) {
        updatePwaStatus('✅ 正以 App 模式執行');
    } else if (window.location.protocol === 'file:') {
        updatePwaStatus('請透過本機伺服器開啟以啟用離線與安裝功能');
    }
}

async function promptInstall() {
    if (!deferredInstallPrompt) {
        showToast('目前環境不支援安裝，請用 Chrome 並透過 http:// 開啟', 'error');
        return;
    }
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    document.getElementById('pwa-install-btn')?.classList.add('hidden');
}

function setupOfflineDetection() {
    const banner = document.getElementById('offline-banner');
    
    function updateOnlineStatus() {
        if (navigator.onLine) {
            banner?.classList.remove('show');
        } else {
            banner?.classList.add('show');
        }
    }
    
    window.addEventListener('online', () => {
        updateOnlineStatus();
        showToast('已恢復連線', 'success');
    });
    window.addEventListener('offline', () => {
        updateOnlineStatus();
        showToast('已進入離線模式，資料仍會保存在本機', 'error');
    });
    
    updateOnlineStatus();
}

function toLocalISO(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function getTodayISO() {
    return toLocalISO();
}

function getTomorrowISO() {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return toLocalISO(d);
}

function formatDateTW(date = new Date()) {
    return date.toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' });
}

function getGreeting() {
    const hour = new Date().getHours();
    if (hour < 12) return '早安';
    if (hour < 18) return '午安';
    return '晚安';
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

const SANITIZE_ALLOWED_TAGS = new Set(['BR', 'STRONG', 'B', 'EM', 'I', 'P', 'UL', 'OL', 'LI']);
const IMPORT_MAX_BYTES = 2 * 1024 * 1024;
const TEXT_MAX_LEN = 500;
const TASK_NAME_MAX_LEN = 200;
const SAFE_FA_ICONS = new Set(['fa-plus', 'fa-brain', 'fa-comment-dots', 'fa-sun', 'fa-list-check', 'fa-circle']);

function sanitizeHtml(html) {
    if (!html) return '';
    const template = document.createElement('template');
    template.innerHTML = String(html);
    
    function walk(parent) {
        [...parent.childNodes].forEach(node => {
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
            [...node.attributes].forEach(attr => node.removeAttribute(attr.name));
            walk(node);
        });
    }
    walk(template.content);
    return template.innerHTML;
}

function isSafeHttpUrl(url) {
    if (!url || typeof url !== 'string') return false;
    try {
        const parsed = new URL(url.trim());
        return ['http:', 'https:'].includes(parsed.protocol);
    } catch (_) {
        return false;
    }
}

function clampText(value, max = TEXT_MAX_LEN) {
    return String(value ?? '').slice(0, max);
}

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
        && Object.getPrototypeOf(value) === Object.prototype;
}

function sanitizeImportedTask(raw, index) {
    if (!isPlainObject(raw)) return null;
    const energy = Math.min(5, Math.max(1, parseInt(raw.energy, 10) || 3));
    const duration = Math.min(480, Math.max(5, parseInt(raw.duration, 10) || 30));
    const validCategories = Object.keys(CATEGORIES);
    const category = validCategories.includes(raw.category) ? raw.category : undefined;
    const name = clampText(raw.name, TASK_NAME_MAX_LEN).trim();
    if (!name) return null;
    const task = {
        id: typeof raw.id === 'number' ? raw.id : Date.now() + index,
        name,
        duration,
        energy,
        due: clampText(raw.due, 12) || getTodayISO(),
        completed: !!raw.completed,
        wasOverdue: !!raw.wasOverdue
    };
    if (category) task.category = category;
    if (raw.parentGoalId != null) task.parentGoalId = Number(raw.parentGoalId);
    if (raw.parentGoalName) task.parentGoalName = clampText(raw.parentGoalName, TASK_NAME_MAX_LEN);
    if (raw.enterpriseTaskId) task.enterpriseTaskId = clampText(raw.enterpriseTaskId, 64);
    return task;
}

function validateImportedData(data) {
    if (!isPlainObject(data)) throw new Error('無效的資料格式');
    for (const key of ['__proto__', 'constructor', 'prototype']) {
        if (Object.prototype.hasOwnProperty.call(data, key)) throw new Error('含不允許的欄位');
    }
    if (data.tasks !== undefined) {
        if (!Array.isArray(data.tasks)) throw new Error('tasks 必須是陣列');
        if (data.tasks.length > 2000) throw new Error('任務數量超過上限');
    }
    if (data.userProfile !== undefined && !isPlainObject(data.userProfile)) {
        throw new Error('userProfile 格式錯誤');
    }
    if (data.weeklyScores !== undefined) {
        if (!Array.isArray(data.weeklyScores) || data.weeklyScores.length !== 7) {
            throw new Error('weeklyScores 格式錯誤');
        }
    }
    if (data.dailyHistory !== undefined && !isPlainObject(data.dailyHistory)) {
        throw new Error('dailyHistory 格式錯誤');
    }
}

function sanitizeImportedProfile(raw) {
    const allowed = [
        'name', 'role', 'workStart', 'workEnd', 'peakStart', 'peakEnd',
        'streakThreshold', 'enableConfetti', 'apiEnabled', 'apiMode',
        'apiModel', 'apiProxyUrl', 'enterpriseApiUrl'
    ];
    const out = {};
    for (const key of allowed) {
        if (raw[key] === undefined) continue;
        if (key === 'streakThreshold') {
            out[key] = Math.min(100, Math.max(0, parseInt(raw[key], 10) || 80));
        } else if (key === 'enableConfetti' || key === 'apiEnabled') {
            out[key] = !!raw[key];
        } else if (key === 'apiMode') {
            out[key] = raw[key] === 'proxy' ? 'proxy' : 'direct';
        } else if (key === 'apiModel') {
            out[key] = ['deepseek-chat', 'deepseek-reasoner'].includes(raw[key])
                ? raw[key] : 'deepseek-chat';
        } else if (key === 'apiProxyUrl' || key === 'enterpriseApiUrl') {
            const url = clampText(raw[key], 300).trim();
            if (url && isSafeHttpUrl(url)) out[key] = url;
        } else {
            out[key] = clampText(raw[key], 80);
        }
    }
    return out;
}

function clearSensitiveLocalData() {
    const preserved = {};
    for (const key of ['lumina_api_key', 'lumina_profile', AUTH_SESSION_KEY, AUTH_USERS_KEY]) {
        const val = localStorage.getItem(key);
        if (val) preserved[key] = val;
    }
    localStorage.clear();
    Object.entries(preserved).forEach(([k, v]) => localStorage.setItem(k, v));
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
        const session = JSON.parse(localStorage.getItem(AUTH_SESSION_KEY) || 'null');
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
        const session = JSON.parse(localStorage.getItem(AUTH_SESSION_KEY) || 'null');
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
    const auth = getAuthSession();
    if (auth?.session?.token) return false;
    return true;
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
            role: user.role || '知識工作者',
            createdAt: user.createdAt
        },
        loggedInAt: new Date().toISOString()
    }));
    localStorage.removeItem(AUTH_USERS_KEY);
}

function applyAuthUserToProfile(user, isNew = false) {
    userProfile.name = user.name;
    userProfile.role = user.role || '知識工作者';
    if (isNew) {
        userProfile.streak = 0;
        userProfile.bestStreak = 0;
        userProfile.joinDay = 1;
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
        tasks,
        profile: userProfile,
        dailyHistory,
        weeklyScores,
        updatedAt: new Date().toISOString()
    };
}

function applyUserDataFromServer(data) {
    if (!data) return;
    if (Array.isArray(data.tasks)) {
        tasks = data.tasks;
        localStorage.setItem('lumina_tasks', JSON.stringify(tasks));
        migrateTasks();
    }
    if (data.profile && typeof data.profile === 'object') {
        userProfile = { ...userProfile, ...data.profile };
        persistProfile();
    }
    if (data.dailyHistory && typeof data.dailyHistory === 'object') {
        dailyHistory = data.dailyHistory;
        saveDailyHistory();
    }
    if (Array.isArray(data.weeklyScores) && data.weeklyScores.length === 7) {
        weeklyScores = data.weeklyScores;
        localStorage.setItem('lumina_weekly', JSON.stringify(weeklyScores));
    }
    invalidateTodayStats();
}

async function syncUserDataToServer(options = {}) {
    const auth = getAuthSession();
    if (!auth?.session?.token) return;
    const run = async () => {
        try {
            await authApiRequest('/api/user/data', {
                method: 'PUT',
                body: JSON.stringify(buildUserDataPayload())
            });
        } catch (e) {
            console.warn('[Lumina] 個人資料同步失敗:', e.message);
        }
    };
    if (options.immediate) return run();
    clearTimeout(userDataSyncTimer);
    userDataSyncTimer = setTimeout(run, USER_DATA_SYNC_DELAY_MS);
}

async function loadUserDataFromServer() {
    const auth = getAuthSession();
    if (!auth?.session?.token) return;
    try {
        const res = await authApiRequest('/api/user/data', { method: 'GET' });
        const serverData = res.data;
        let localTasks = [];
        try {
            localTasks = JSON.parse(localStorage.getItem('lumina_tasks') || '[]');
        } catch (_) {}
        const hasLocal = Array.isArray(localTasks) && localTasks.length > 0;
        const hasServer = Array.isArray(serverData?.tasks) && serverData.tasks.length > 0;

        if (hasServer) {
            applyUserDataFromServer(serverData);
        } else if (hasLocal) {
            await syncUserDataToServer({ immediate: true });
        }
    } catch (e) {
        console.warn('[Lumina] 個人資料雲端載入失敗:', e.message);
    }
}

async function finishAuth(user, isNew, token) {
    persistAuthSession(user, token);
    applyAuthUserToProfile(user, isNew);
    if (isNew) {
        tasks = [];
        localStorage.setItem('lumina_tasks', JSON.stringify(tasks));
        localStorage.removeItem('lumina_onboarding_v2');
        localStorage.removeItem('lumina_welcomed');
    }
    await loadUserDataFromServer();
    hideAuthOverlay();
    updateAuthUI();
    refreshUI({ dashboard: true, filters: true });
    showToast(isNew ? `歡迎加入，${user.name}！` : `歡迎回來，${user.name}！`, 'success');
    if (isNew) {
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

function handleLogout() {
    if (!isLoggedIn()) return;
    if (!confirm('確定要登出嗎？你的任務與設定仍會保留在本機。')) return;
    localStorage.removeItem(AUTH_SESSION_KEY);
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
            localStorage.removeItem(AUTH_SESSION_KEY);
        }
    }
    updateAuthUI();
    if (needsAuthGate()) showAuthOverlay('register');
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

function sanitizeFaIcon(icon) {
    const cleaned = String(icon || '').replace(/[^a-z0-9-]/gi, '');
    return SAFE_FA_ICONS.has(cleaned) ? cleaned : 'fa-circle';
}

function getCompletedCount() {
    return tasks.filter(t => t.completed).length;
}

function getSampleTasks() {
    const today = getTodayISO();
    const tomorrow = getTomorrowISO();
    const dayAfter = new Date();
    dayAfter.setDate(dayAfter.getDate() + 2);
    const dayAfterISO = toLocalISO(dayAfter);
    
    return [
        { id: 1, name: "審核 Q3 產品路線圖草案", duration: 90, energy: 5, category: 'deep', due: today, completed: false },
        { id: 2, name: "與設計團隊同步新功能 UI", duration: 45, energy: 3, category: 'meeting', due: today, completed: true },
        { id: 3, name: "撰寫客戶提案第 2 版", duration: 75, energy: 5, category: 'deep', due: tomorrow, completed: false },
        { id: 4, name: "回覆重要供應商郵件", duration: 20, energy: 2, category: 'admin', due: today, completed: true },
        { id: 5, name: "準備週三部門會議簡報", duration: 60, energy: 4, category: 'execution', due: dayAfterISO, completed: false },
        { id: 6, name: "更新個人 OKR 追蹤表", duration: 25, energy: 2, category: 'admin', due: today, completed: false },
    ];
}

function getTodayRelevantTasks() {
    return getTodayStats().relevant;
}

function getTodayPendingTasks() {
    return getTodayStats().pending;
}

function getFuturePendingTasks() {
    return getTodayStats().futurePending;
}

function getTodayCompletedCount() {
    return getTodayStats().completed;
}

function getTodayFocusMinutes() {
    return getTodayStats().focusMinutes;
}

function getTodayCompletionRate() {
    return getTodayStats().rate;
}

function loadDailyHistory() {
    try {
        const saved = localStorage.getItem(DAILY_HISTORY_KEY);
        if (saved) dailyHistory = JSON.parse(saved);
    } catch (_) {
        dailyHistory = {};
    }
}

function saveDailyHistory() {
    localStorage.setItem(DAILY_HISTORY_KEY, JSON.stringify(dailyHistory));
}

function trimDailyHistory(maxDays = 30) {
    const keys = Object.keys(dailyHistory).sort();
    while (keys.length > maxDays) {
        delete dailyHistory[keys.shift()];
    }
}

function snapshotDay(dateISO) {
    const relevant = tasks.filter(t => t.due <= dateISO);
    const completed = relevant.filter(t => t.completed);
    dailyHistory[dateISO] = {
        focusMinutes: completed.reduce((s, t) => s + (t.duration || 0), 0),
        completed: completed.length,
        total: relevant.length,
        rate: relevant.length ? Math.round((completed.length / relevant.length) * 100) : 0
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
        const d = new Date();
        d.setDate(d.getDate() - i);
        const iso = toLocalISO(d);
        if (dailyHistory[iso]) {
            scores.push(dailyHistory[iso].rate);
        } else if (iso === getTodayISO()) {
            scores.push(getTodayCompletionRate());
        } else {
            scores.push(0);
        }
    }
    weeklyScores = scores;
}

function getFocusComparisonText(todayMinutes = getTodayFocusMinutes()) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayISO = toLocalISO(yesterday);
    const yesterdayMinutes = dailyHistory[yesterdayISO]?.focusMinutes ?? 0;
    
    if (todayMinutes === 0 && yesterdayMinutes === 0) {
        return { text: '尚無比較數據', positive: null };
    }
    if (yesterdayMinutes === 0) {
        return { text: `今日已專注 ${(todayMinutes / 60).toFixed(1)}h`, positive: true };
    }
    const diffMin = todayMinutes - yesterdayMinutes;
    const diffH = Math.abs(diffMin / 60).toFixed(1);
    if (diffMin > 0) return { text: `+${diffH}h 比昨天`, positive: true };
    if (diffMin < 0) return { text: `-${diffH}h 比昨天`, positive: false };
    return { text: '與昨天相同', positive: null };
}

function applyStreakReward(dateISO, rate, { notify = false } = {}) {
    const earnedKey = 'lumina_streak_earned_' + dateISO;
    if (localStorage.getItem(earnedKey)) return false;
    
    const threshold = userProfile.streakThreshold || 80;
    if (rate < threshold) return false;
    
    localStorage.setItem(earnedKey, 'true');
    const prev = new Date(dateISO + 'T12:00:00');
    prev.setDate(prev.getDate() - 1);
    const prevISO = toLocalISO(prev);
    const lastEarned = localStorage.getItem('lumina_last_streak_date');
    
    if (lastEarned === prevISO) userProfile.streak += 1;
    else userProfile.streak = 1;
    
    userProfile.bestStreak = Math.max(userProfile.bestStreak || 0, userProfile.streak);
    localStorage.setItem('lumina_last_streak_date', dateISO);
    
    if (notify) {
        showToast(`🔥 達成今日 ${threshold}% 目標！連續高效 ${userProfile.streak} 天`, 'success');
    }
    return true;
}

function evaluateStreakForDate(dateISO) {
    const snap = dailyHistory[dateISO];
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
    tasks.forEach(t => {
        if (!t.completed && t.due < today) {
            t.due = today;
            t.wasOverdue = true;
            rolledCount++;
        }
    });
    
    const daysDiff = Math.max(1, Math.round((new Date(today + 'T12:00:00') - new Date(lastActive + 'T12:00:00')) / 86400000));
    userProfile.joinDay = (userProfile.joinDay || 1) + daysDiff;
    
    localStorage.setItem(LAST_ACTIVE_DATE_KEY, today);
    recordDailySnapshot();
    recalculateWeeklyScores();
    saveState({ immediateAnalytics: true });
    
    return { rolledCount };
}

function parseHour(timeStr) {
    return parseInt((timeStr || '09:00').split(':')[0], 10);
}

function scoreTaskForNextStep(task, ctx) {
    ctx = ctx || getScoringContext();
    let score = 0;
    if (task.due < ctx.today) score += 50;
    else if (task.due === ctx.today) score += 30;
    
    const inPeak = ctx.hour >= ctx.peakStart && ctx.hour < ctx.peakEnd;
    const cat = resolveCategory(task);
    
    if (inPeak && cat === 'deep') score += 25;
    if (task.duration <= 25) score += 15;
    if (task.wasOverdue) score += 20;
    score += (task.energy || 3) * 3;
    return score;
}

function rankTasksByNextStepScore(taskList, ctx) {
    ctx = ctx || getScoringContext();
    return taskList
        .map(t => ({ task: t, score: scoreTaskForNextStep(t, ctx) }))
        .sort((a, b) => b.score - a.score)
        .map(x => x.task);
}

function getNextRecommendedTask(scope = 'today') {
    let pending = scope === 'today' ? getTodayPendingTasks() : tasks.filter(t => !t.completed);
    if (!pending.length && scope === 'today') pending = getFuturePendingTasks();
    if (!pending.length) return null;
    return rankTasksByNextStepScore(pending)[0];
}

function resolveTodayFocusTask() {
    const stats = getTodayStats();
    const pending = stats.pending;
    if (!pending.length) {
        todayFocusTaskId = null;
        return null;
    }
    if (todayFocusTaskId) {
        const focused = pending.find(t => t.id === todayFocusTaskId);
        if (focused) return focused;
    }
    const next = rankTasksByNextStepScore(pending, getScoringContext())[0];
    todayFocusTaskId = next?.id ?? null;
    return next;
}

function getTodayQueuePosition(taskId) {
    const pending = rankTasksByNextStepScore(getTodayStats().pending, getScoringContext());
    const idx = pending.findIndex(t => t.id === taskId);
    return { index: idx, total: pending.length };
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
    const cachedId = taskCoachPlans.get(task.id);
    const cached = cachedId ? coachPlans.get(cachedId) : null;
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

function pushCoachAgentMessage(role, content, sources) {
    coachAgentMessages.push({ role, content, ts: Date.now(), sources: sources || null });
    if (coachAgentMessages.length > 24) coachAgentMessages = coachAgentMessages.slice(-24);
    chatHistory.push({ role: role === 'coach' ? 'assistant' : 'user', content });
    if (chatHistory.length > 20) chatHistory = chatHistory.slice(-20);
}

function getOpeningCoachMessage(task, steps) {
    const s0 = steps[0];
    const total = steps.reduce((n, s) => n + parseStepMinutes(s), 0);
    return `我來帶你完成「${task.name}」，分 ${steps.length} 步、約 ${total} 分鐘。\n\n現在：${s0.title} — ${s0.action}\n\n做完跟我說，或點「完成這步」。\n[選項: 我準備好了，開始第一步]\n[選項: 這個任務有難度，先幫我做些引導分析]`;
}

function ensureCoachSessionForTask(task) {
    if (!task) return null;
    if (focusSession?.taskId === task.id) return focusSession;
    todayFocusTaskId = task.id;
    focusSession = {
        taskId: task.id,
        steps: getStepsForTask(task),
        currentStep: 0,
        startedAt: null,
        coachActive: false,
        planId: taskCoachPlans.get(task.id) || null
    };
    return focusSession;
}

function startStepTimerForCoach(session) {
    const step = session.steps[session.currentStep];
    if (!step) return;
    clearFocusTimer();
    const mins = parseStepMinutes(step);
    focusSession.endsAt = Date.now() + mins * 60 * 1000;
    tickFocusTimer();
    focusTimerInterval = setInterval(tickFocusTimer, 1000);
}

function coachBeginGuidedSession() {
    const task = getCoachTask();
    if (!task) {
        showToast('尚無待辦，先分解目標吧', 'error');
        openDecomposeTab();
        return;
    }
    const session = ensureCoachSessionForTask(task);
    session.coachActive = true;
    session.startedAt = Date.now();
    session.currentStep = session.currentStep || 0;
    if (!coachAgentMessages.length) {
        pushCoachAgentMessage('coach', getOpeningCoachMessage(task, session.steps));
    }
    startStepTimerForCoach(session);
    document.getElementById('next-step-card')?.classList.add('focus-session-active');
    renderCoachAgentView();
    showToast('教練開始帶你做', 'success');
}

function coachPauseSession() {
    if (!focusSession) return;
    focusSession.coachActive = false;
    clearFocusTimer();
    pushCoachAgentMessage('coach', '先暫停。準備好再點「教練帶我做」繼續。');
    document.getElementById('next-step-card')?.classList.remove('focus-session-active');
    renderCoachAgentView();
}

function coachAdvanceStepFromAgent() {
    const task = getCoachTask();
    if (!task || !focusSession || focusSession.taskId !== task.id) {
        return coachBeginGuidedSession();
    }
    const steps = focusSession.steps;
    const cur = focusSession.currentStep;
    if (cur < steps.length - 1) {
        focusSession.currentStep++;
        const next = steps[focusSession.currentStep];
        const cheers = ['很好，繼續！', '做得漂亮！', '保持這個節奏！'];
        pushCoachAgentMessage('coach', `${cheers[cur % cheers.length]}\n\n下一步「${next.title}」：${next.action}`);
        startStepTimerForCoach(focusSession);
    } else {
        pushCoachAgentMessage('coach', '最後一步了！完成後點「完成這件」，我幫你接下一個任務。');
    }
    renderCoachAgentView();
}

function coachCompleteTaskFromAgent() {
    const task = getCoachTask();
    if (!task) return;
    const taskName = task.name;
    coachAgentMessages = [];
    focusSession.coachActive = false;
    completeFocusTask(task.id);
    setTimeout(() => {
        refreshCoachView();
        const next = getCoachContext().nextTask;
        if (next) {
            pushCoachAgentMessage('coach', `「${taskName}」完成了！要繼續做「${next.name}」嗎？點「教練帶我做」。`);
        } else {
            pushCoachAgentMessage('coach', '今日待辦都完成了，休息一下！');
        }
        renderCoachAgentThread();
    }, 350);
}

function buildOfflineAgentReply(userMsg, task, session) {
    const lower = userMsg.toLowerCase();
    const step = session.steps[session.currentStep];
    if (/完成這步|做完了|好了|done/.test(lower)) {
        const isLast = session.currentStep >= session.steps.length - 1;
        if (isLast) {
            return { reply: '太棒了！點「完成這件」勾選任務。', advance: false, complete: false };
        }
        return { reply: '收到，幫你進下一步。', advance: true, complete: false };
    }
    if (/卡住|難|不會|拖延|不想/.test(lower)) {
        const micro = step.action.split(/[，。]/)[0] || step.action;
        return {
            reply: `沒問題，我們再縮小一點。\n\n只做這件事：${micro.slice(0, 80)}。\n2 分鐘就好，做完跟我說。`,
            advance: false, complete: false
        };
    }
    if (/簡單|太難|換/.test(lower)) {
        return {
            reply: `好，把「${step.title}」簡化成：先打開相關檔案，寫下今天要交出的「一句話版本」。`,
            advance: false, complete: false
        };
    }
    if (/資料|參考|範本/.test(lower)) {
        const q = encodeURIComponent(`${task.name} 範本`);
        return {
            reply: `需要參考時，先搜這個關鍵字找範本，找到一個就回來繼續當前步驟。\n（google.com/search?q=${q}）`,
            advance: false, complete: false
        };
    }
    const micro = (step.action || '').split(/[，。]/)[0] || step.action;
    if (/怎麼|如何|什麼|為何|哪裡|嗎|？|\?/.test(userMsg)) {
        return {
            reply: `可以這樣開始：${micro}。\n先做 2 分鐘能完成的最小塊，做完說「完成這步」。`,
            advance: false, complete: false
        };
    }
    return {
        reply: `收到。此刻專注「${step.title}」——${micro}。\n卡住就說「卡住了」，我幫你拆更細。`,
        advance: false, complete: false
    };
}

function inferAgentActionsFromUserMsg(userMsg, session) {
    if (/完成這步|做完了|做好了|好了/.test(userMsg)) {
        const isLast = session.currentStep >= session.steps.length - 1;
        return { advance: !isLast, complete: isLast };
    }
    return { advance: false, complete: false };
}

function isGenericCoachFallback(reply) {
    return /專注這一步就好|針對「[^」]+」：/.test(reply || '');
}

async function coachAgentRespondWithAI(userMsg, task, session) {
    if (ragServiceActive && checkedRagKbs.length > 0 && enterpriseSession) {
        try {
            const payload = {
                query: userMsg,
                group_code: enterpriseSession.groupCode,
                kb_ids: checkedRagKbs,
                ...getRagLlmCredentials()
            };
            
            const response = await fetch(getRagQueryUrl(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            
            if (response.ok) {
                const data = await response.json();
                if (data.retrieval_mode) ragRetrievalMode = data.retrieval_mode;
                let reply = data.answer || '';
                
                // Add Claude-style options to the reply if they are not generated
                if (!reply.includes('[選項:')) {
                    reply += `\n\n[選項: 我了解，繼續執行當前步驟]\n[選項: 請幫我把這段資料再做詳細拆解]`;
                }
                
                return {
                    reply: clampText(reply, 5000),
                    sources: data.sources || [],
                    ...inferAgentActionsFromUserMsg(userMsg, session)
                };
            }
        } catch (e) {
            console.warn('[Lumina RAG] RAG 查詢失敗，降級到一般 AI 問答:', e.message);
        }
    }

    const step = session.steps[session.currentStep];
    const contextBlock = buildCoachContextText(getCoachContext());
    const systemPrompt = `你是 Lumina 行動教練，是引導用戶高效工作的專業教練。
請使用繁體中文，語氣專業嚴謹、邏輯條理清晰。請根據用戶當前的情境給予深入且具實用性、結構化的專業引導與建議。
用戶剛傳了一則訊息——請針對他的訊息進行嚴謹的回應，不要重複貼上無關的完整步驟說明。

重要要求——動態行動選項：
你必須在回答的最後，根據當前的對話進度與情境，額外設計 2 到 3 個用戶可能想要選擇的「具體行動選項」，供用戶點選回答（類似 Claude 的引導選項）。
請嚴格遵守以下格式，在回答的最底部每行輸出一個選項（不要放在代碼塊中）：
[選項: 選項文字]
例如：
[選項: 沒問題，我準備好開始寫第一段]
[選項: 遇到瓶頸，請幫我把當前步驟再拆更細]
[選項: 我需要找一些範本參考，能給我關鍵字嗎]

若用戶詢問如何執行或怎麼做：請給予結構化、有步驟邏輯的引導，列出清晰的步驟。
若用戶表示卡住、遇到瓶頸或拖延：請為他分析可能原因，並提供具體的應對方法或重新規劃子步驟。
禁止：直接回傳原始 JSON。
允許且建議：使用 markdown（例如粗體、無序列表、有序列點、程式碼區塊等）使回答更具結構性。
${contextBlock}
當前任務：${task.name}
當前步驟（${session.currentStep + 1}/${session.steps.length}）「${step?.title}」：${step?.action}`;
    
    const messages = [
        { role: 'system', content: systemPrompt },
        ...coachAgentMessages.slice(-8).map(m => ({
            role: m.role === 'coach' ? 'assistant' : 'user',
            content: m.content.slice(0, 500)
        }))
    ];
    const content = await callDeepSeek(messages, { temperature: 0.75 });
    const text = String(content || '').trim();
    
    if (text.startsWith('{')) {
        const parsed = parseCoachAgentResponse(text, userMsg, task, session);
        if (parsed.reply && !isGenericCoachFallback(parsed.reply)) {
            return { ...parsed, ...inferAgentActionsFromUserMsg(userMsg, session) };
        }
    }
    
    if (!text) return buildOfflineAgentReply(userMsg, task, session);
    
    return {
        reply: clampText(text, 400),
        ...inferAgentActionsFromUserMsg(userMsg, session)
    };
}

function findTaskForPlan(plan) {
    if (!plan?.task) return null;
    const pending = tasks.filter(t => !t.completed);
    const exact = pending.find(t => t.name === plan.task);
    if (exact) return exact;
    return pending.find(t => plan.task.includes(t.name) || t.name.includes(plan.task)) || null;
}

function linkPlanToTask(planId, plan, taskId) {
    if (taskId) {
        taskCoachPlans.set(taskId, planId);
        return;
    }
    const task = findTaskForPlan(plan);
    if (task) taskCoachPlans.set(task.id, planId);
}

function syncFocusSessionWithPlan(plan, planId) {
    if (!focusSession || !plan?.steps?.length) return;
    const task = tasks.find(t => t.id === focusSession.taskId);
    if (!task || plan.task !== task.name) return;
    focusSession.steps = normalizeFocusSteps(plan.steps);
    focusSession.planId = planId;
    focusSession.currentStep = Math.min(focusSession.currentStep || 0, focusSession.steps.length - 1);
}

function clearFocusTimer() {
    if (focusTimerInterval) {
        clearInterval(focusTimerInterval);
        focusTimerInterval = null;
    }
}

function tickFocusTimer() {
    if (!focusSession?.endsAt) return;
    const el = document.getElementById('focus-timer-display');
    const remaining = Math.max(0, focusSession.endsAt - Date.now());
    const mins = Math.floor(remaining / 60000);
    const secs = Math.floor((remaining % 60000) / 1000);
    if (el) el.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    if (remaining <= 0 && focusTimerInterval) {
        clearFocusTimer();
        showToast('時間到！可以收尾或點「完成這件」', 'success');
    }
}

function startFocusTimer(durationMins) {
    clearFocusTimer();
    if (!focusSession) return;
    focusSession.endsAt = Date.now() + (durationMins || 30) * 60 * 1000;
    tickFocusTimer();
    focusTimerInterval = setInterval(tickFocusTimer, 1000);
}

function endFocusSession() {
    clearFocusTimer();
    focusSession = null;
    const card = document.getElementById('next-step-card');
    if (card) card.classList.remove('focus-session-active');
}

function extendFocusTimer(mins) {
    if (!focusSession?.endsAt) return;
    focusSession.endsAt += mins * 60 * 1000;
    if (!focusTimerInterval) startFocusTimer(Math.ceil((focusSession.endsAt - Date.now()) / 60000));
    showToast(`已延長 ${mins} 分鐘`, 'success');
    tickFocusTimer();
}

function completeFocusTask(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if (!task || task.completed) return;
    endFocusSession();
    toggleTaskComplete(taskId, { checked: true }, true, true);
}

function renderFocusSessionPanel(task) {
    if (!focusSession || focusSession.taskId !== task.id) return '';
    const steps = focusSession.steps || [];
    const cur = Math.min(focusSession.currentStep || 0, Math.max(0, steps.length - 1));
    const current = steps[cur];
    const isLastStep = cur >= steps.length - 1;
    const hasCoachPlan = !!focusSession.planId;
    return `
        <div class="focus-session-panel mt-4 pt-4 border-t border-indigo-500/25">
            <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div class="flex items-center gap-3">
                    <span class="focus-session-badge"><i class="fa-solid fa-circle text-[6px]"></i> 專注進行中</span>
                    <span id="focus-timer-display" class="focus-timer">--:--</span>
                    <span class="text-[10px] text-slate-500">步驟 ${cur + 1}/${steps.length}${hasCoachPlan ? ' · 教練方案' : ''}</span>
                </div>
                <button type="button" onclick="extendFocusTimer(5)" class="text-[10px] px-2 py-1 rounded-lg border border-slate-600 text-slate-400 hover:text-slate-300 hover:bg-slate-800">+5 分</button>
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
                <button type="button" onclick="advanceFocusStep(${task.id})" class="text-sm px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-medium">
                    <i class="fa-solid fa-${isLastStep ? 'check' : 'forward-step'} mr-1"></i>${isLastStep ? '完成這件' : '完成這步'}
                </button>
                <button type="button" onclick="openCoachForTask(${task.id})" class="text-sm px-4 py-2 rounded-xl border border-sky-500/40 hover:bg-sky-500/10 text-sky-300">教練帶我做</button>
                <button type="button" onclick="endFocusSession();refreshUI({dashboard:true,filters:false})" class="text-sm px-4 py-2 rounded-xl border border-slate-600 hover:bg-slate-800 text-slate-400">暫停</button>
            </div>
        </div>`;
}

function advanceFocusStep(taskId) {
    if (!focusSession || focusSession.taskId !== taskId) return;
    const steps = focusSession.steps || [];
    if (focusSession.currentStep < steps.length - 1) {
        focusSession.currentStep++;
        refreshUI({ dashboard: true, filters: false });
        tickFocusTimer();
        const step = steps[focusSession.currentStep];
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
    const task = tasks.find(t => t.id === taskId);
    if (!task || task.completed) return;
    if (task.due > getTodayISO()) {
        showToast('此任務排程在之後，請到任務頁查看', 'error');
        return;
    }
    if (focusSession && focusSession.taskId !== taskId) endFocusSession();
    todayFocusTaskId = taskId;
    refreshUI({ dashboard: true, filters: false });
    pulseNextStepCard();
}

function startTodayTask(taskId, opts = {}) {
    const task = tasks.find(t => t.id === taskId);
    if (!task || task.completed) return;
    todayFocusTaskId = taskId;
    
    if (!opts.force && focusSession?.taskId === taskId) {
        showSection('dashboard');
        pulseNextStepCard();
        if (focusSession.endsAt > Date.now() && !focusTimerInterval) {
            tickFocusTimer();
            focusTimerInterval = setInterval(tickFocusTimer, 1000);
        }
        return;
    }
    
    const planId = taskCoachPlans.get(taskId) || null;
    focusSession = {
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
    const wasFocus = fromFocus || focusSession?.taskId === completedId;
    if (focusSession?.taskId === completedId) endFocusSession();
    if (todayFocusTaskId === completedId) todayFocusTaskId = null;
    invalidateTodayStats();
    const next = getNextRecommendedTask('today');
    if (next) {
        todayFocusTaskId = next.id;
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

function getNextStepReason(task) {
    const ctx = getScoringContext();
    const inPeak = ctx.hour >= ctx.peakStart && ctx.hour < ctx.peakEnd;
    if (task.wasOverdue) return '逾期優先處理';
    if (inPeak && resolveCategory(task) === 'deep') return '高效時段，適合深度工作';
    if (!inPeak && resolveCategory(task) === 'deep') return '可先啟動，深度段落留到高效時段';
    if (task.duration <= 15) return '短小精悍，現在就能完成';
    if (task.duration <= 25) return '門檻低，適合現在開始';
    if (task.parentGoalName) {
        const g = task.parentGoalName;
        return `來自「${g.length > 14 ? g.slice(0, 14) + '…' : g}」`;
    }
    return '系統推薦的今日第一步';
}

function renderPersonalTaskRow(task, variant = 'scheduler') {
    const cat = resolveCategory(task);
    const isDashboard = variant === 'dashboard';
    const checked = task.completed ? 'checked' : '';
    const dashFlag = isDashboard ? ', true' : '';
    const onChange = `onchange="toggleTaskComplete(${task.id}, this${dashFlag})"`;
    
    if (isDashboard) {
        const isActive = !task.completed && task.id === todayFocusTaskId;
        const isRunning = isActive && focusSession?.taskId === task.id;
        const queue = getTodayQueuePosition(task.id);
        const queueLabel = queue.index >= 0 && !task.completed
            ? `<span class="text-[10px] text-indigo-400/80">#${queue.index + 1}</span>`
            : '';
        const rowClass = task.completed
            ? 'dashboard-task-row dashboard-task-row-done'
            : `dashboard-task-row task-card group${isActive ? ' dashboard-task-row-active' : ''}`;
        return `<div class="${rowClass} flex items-center justify-between px-4 py-3 bg-slate-950 border border-slate-700 rounded-2xl"
            data-task-id="${task.id}" onclick="focusTodayTask(${task.id}, event)" role="button" tabindex="0"
            onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();focusTodayTask(${task.id},event)}">
            <div class="flex items-center gap-x-3 flex-1 min-w-0">
                <input type="checkbox" ${checked} ${onChange} onclick="event.stopPropagation()" class="accent-indigo-500 w-4 h-4 cursor-pointer flex-shrink-0">
                <div class="min-w-0 flex-1">
                    <div class="font-medium text-sm truncate ${task.completed ? 'line-through text-slate-500' : ''}">${escapeHtml(task.name)}</div>
                    <div class="text-[10px] text-slate-500 flex flex-wrap items-center gap-1">${queueLabel} ${task.duration} 分鐘 • <span class="cat-badge ${getCategoryColor(cat)}">${getCategoryLabel(cat)}</span> ${renderTaskBadges(task)}</div>
                </div>
            </div>
            <div class="flex items-center gap-1.5 flex-shrink-0">
                ${!task.completed ? `<button type="button" onclick="event.stopPropagation();startTodayTask(${task.id})" class="task-row-start-btn ${isActive ? '' : 'hidden sm:inline-flex'}${isRunning ? ' task-row-start-btn-active' : ''}">${isRunning ? '進行中' : isActive ? '繼續' : '開始'}</button>` : ''}
                <button type="button" onclick="event.stopPropagation();openTaskEdit(${task.id})" class="text-slate-400 hover:text-indigo-300 p-1.5 ${task.completed ? '' : 'opacity-70 hover:opacity-100'}" title="編輯"><i class="fa-solid fa-pen text-xs"></i></button>
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
            <button onclick="openTaskEdit(${task.id})" class="text-slate-400 hover:text-indigo-300 p-1.5" title="編輯任務"><i class="fa-solid fa-pen text-xs"></i></button>
            ${task.duration >= 60 && !task.completed ? `<button onclick="splitTask(${task.id})" class="text-indigo-400 hover:text-indigo-300 p-1.5" title="拆分任務"><i class="fa-solid fa-scissors text-xs"></i></button>` : ''}
            <button onclick="deleteTask(${task.id}, event)" class="text-red-400 hover:text-red-500 p-1.5"><i class="fa-solid fa-trash text-xs"></i></button>
        </div>
    </div>`;
}

function getActiveParentGoals() {
    const groups = {};
    tasks.filter(t => t.parentGoalId).forEach(t => {
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
    const siblings = tasks.filter(t => t.parentGoalId === task.parentGoalId);
    if (siblings.length > 1 && siblings.every(t => t.completed)) {
        const name = task.parentGoalName || '大目標';
        showToast(`🎉 大目標「${name}」的所有步驟已完成！`, 'success');
        if (userProfile.enableConfetti !== false) triggerConfetti();
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
    return html;
}

function openTaskEdit(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    editingTaskId = taskId;
    
    document.getElementById('edit-task-name').value = task.name;
    document.getElementById('edit-task-duration').value = task.duration;
    document.getElementById('edit-task-energy').value = task.energy;
    document.getElementById('edit-task-category').value = task.category || inferCategory(task.name, task.energy);
    document.getElementById('edit-task-due').value = task.due;
    
    document.getElementById('task-edit-modal').classList.remove('hidden');
}

function closeTaskEdit() {
    editingTaskId = null;
    document.getElementById('task-edit-modal')?.classList.add('hidden');
}

function saveTaskEdit() {
    if (!editingTaskId) return;
    const task = tasks.find(t => t.id === editingTaskId);
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
    
    saveState();
    closeTaskEdit();
    refreshUI({ dashboard: true, scheduler: true, schedule: true });
    showToast('任務已更新', 'success');
}

function syncEnterpriseTaskToPersonal(enterpriseTaskId) {
    if (!enterpriseGroupData) return;
    const et = (enterpriseGroupData.tasks || []).find(t => t.id === enterpriseTaskId);
    if (!et) return;
    
    if (tasks.some(t => t.enterpriseTaskId === enterpriseTaskId)) {
        showToast('此團隊任務已同步到個人清單', 'error');
        return;
    }
    
    tasks.push({
        id: Date.now(),
        name: `[團隊] ${et.title}`,
        duration: et.duration || 30,
        energy: et.energy || 3,
        category: et.category || inferCategory(et.title, 3),
        due: et.due || getTodayISO(),
        completed: false,
        enterpriseTaskId: enterpriseTaskId
    });
    
    saveState();
    refreshUI({ dashboard: true, scheduler: true });
    showToast('已同步到個人今日清單', 'success');
}

function evaluateStreakOnComplete() {
    invalidateTodayStats();
    if (applyStreakReward(getTodayISO(), getTodayStats().rate, { notify: true })) {
        persistProfile();
    }
}

// Load from localStorage
function loadState() {
    const savedTasks = localStorage.getItem('lumina_tasks');
    if (savedTasks) {
        tasks = JSON.parse(savedTasks);
    } else {
        tasks = getSampleTasks();
        localStorage.setItem('lumina_tasks', JSON.stringify(tasks));
    }
    
    loadDailyHistory();
    
    const savedProfile = localStorage.getItem('lumina_profile');
    if (savedProfile) userProfile = { ...userProfile, ...JSON.parse(savedProfile) };
    
    const savedEnterprise = localStorage.getItem('lumina_enterprise_session');
    if (savedEnterprise) enterpriseSession = JSON.parse(savedEnterprise);
    
    migrateTasks();
    
    const rollover = processDailyRollover();
    rolledCountOnInit = rollover.rolledCount;
    
    const dueInput = document.getElementById('task-due');
    if (dueInput) dueInput.value = getTomorrowISO();
    
    const thresholdSlider = document.getElementById('settings-streak-threshold');
    if (thresholdSlider) {
        thresholdSlider.addEventListener('input', () => {
            document.getElementById('settings-streak-value').innerText = thresholdSlider.value + '%';
        });
    }
    
    document.getElementById('settings-api-mode')?.addEventListener('change', toggleApiModeFields);
    migrateApiSettings();
    updateApiStatusBadge();
}

function hasStoredApiKey() {
    return !!getStoredApiKey();
}

function migrateApiSettings() {
    if (hasStoredApiKey() && !userProfile.apiEnabled && userProfile.apiMode !== 'proxy') {
        userProfile.apiEnabled = true;
        persistProfile();
    }
}

function getStoredApiKey() {
    return (localStorage.getItem('lumina_api_key') || '').trim();
}

function getDeepSeekClientCredentials() {
    if (!userProfile.apiEnabled) return {};
    if (userProfile.apiMode === 'proxy') return {};
    const apiKey = getStoredApiKey();
    if (!apiKey) return {};
    return {
        deepseek_api_key: apiKey,
        api_base: 'https://api.deepseek.com/v1'
    };
}

function getRagLlmCredentials() {
    const apiKey = getStoredApiKey();
    if (!apiKey) return {};
    return {
        deepseek_api_key: apiKey,
        api_base: 'https://api.deepseek.com/v1'
    };
}

function getRagQueryUrl() {
    return getEnterpriseBaseUrl() + '/api/rag/query';
}

function isApiReady() {
    if (!userProfile.apiEnabled) return false;
    if (userProfile.apiMode === 'proxy') return !!userProfile.apiProxyUrl;
    return hasStoredApiKey();
}

function updateApiStatusBadge() {
    const badge = document.getElementById('api-status-badge');
    if (!badge) return;
    if (isApiReady()) {
        badge.textContent = userProfile.apiMode === 'proxy' ? '代理模式' : 'DeepSeek 已啟用';
        badge.className = 'text-[10px] px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-300';
    } else if (hasStoredApiKey() && !userProfile.apiEnabled) {
        badge.textContent = '已填 Key，請啟用開關';
        badge.className = 'text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300';
    } else {
        badge.textContent = '未啟用（使用規則引擎）';
        badge.className = 'text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400';
    }
}

function toggleApiModeFields() {
    const mode = document.getElementById('settings-api-mode')?.value || 'direct';
    document.getElementById('api-key-group')?.classList.toggle('hidden', mode === 'proxy');
    document.getElementById('api-proxy-group')?.classList.toggle('hidden', mode !== 'proxy');
}

async function callDeepSeek(messages, options = {}) {
    const { jsonMode = false, temperature = 0.7, timeoutMs = 90000 } = options;
    if (!userProfile.apiEnabled) throw new Error('API 未啟用');
    
    const useProxy = userProfile.apiMode === 'proxy';
    const apiKey = (localStorage.getItem('lumina_api_key') || '').trim();
    if (!useProxy && !apiKey) throw new Error('請在設定中填入 DeepSeek API Key');
    if (useProxy && !userProfile.apiProxyUrl) throw new Error('請設定代理伺服器 URL');
    
    const payload = {
        model: userProfile.apiModel || 'deepseek-chat',
        messages,
        temperature,
        stream: false
    };
    if (jsonMode) payload.response_format = { type: 'json_object' };
    
    const url = useProxy ? userProfile.apiProxyUrl : 'https://api.deepseek.com/chat/completions';
    if (useProxy && !isSafeHttpUrl(url)) throw new Error('代理 URL 不安全或格式錯誤');
    const headers = { 'Content-Type': 'application/json' };
    if (!useProxy) headers['Authorization'] = `Bearer ${apiKey}`;
    
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
        res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload), signal: controller.signal });
    } catch (e) {
        if (e.name === 'AbortError') throw new Error('AI 回應逾時，請稍後再試');
        throw e;
    } finally {
        clearTimeout(timer);
    }
    const raw = await res.text();
    if (!res.ok) {
        let msg = raw;
        try { msg = JSON.parse(raw).error?.message || raw; } catch (_) {}
        throw new Error(msg || `API 錯誤 ${res.status}`);
    }
    let parsed;
    try { parsed = JSON.parse(raw); } catch (_) {
        throw new Error('API 回應格式異常');
    }
    const content = parsed.choices?.[0]?.message?.content;
    if (content == null || content === '') {
        const apiErr = parsed.error?.message || parsed.message;
        throw new Error(apiErr || 'AI 回傳內容為空');
    }
    return content;
}

function parseJsonFromAI(text) {
    const trimmed = String(text || '').trim().replace(/^\uFEFF/, '');
    if (!trimmed) throw new Error('AI 回傳為空');
    try { return JSON.parse(trimmed); } catch (_) {}
    const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (match) {
        try { return JSON.parse(match[1].trim()); } catch (_) {}
    }
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
        try { return JSON.parse(trimmed.slice(start, end + 1)); } catch (_) {}
    }
    throw new Error('AI 回傳格式無法解析');
}

function parseCoachAgentResponse(content, userMsg, task, session) {
    const text = String(content || '').trim();
    if (!text) return buildOfflineAgentReply(userMsg, task, session);
    
    try {
        const raw = parseJsonFromAI(text);
        const reply = raw.reply || raw.message || raw.content || raw.text;
        if (reply) {
            return {
                reply: clampText(String(reply), 400),
                advance: !!(raw.advance || raw.next_step),
                complete: !!raw.complete
            };
        }
    } catch (_) {}
    
    if (!text.startsWith('{') && !text.startsWith('[')) {
        return { reply: clampText(text, 400), advance: false, complete: false };
    }
    
    const replyMatch = text.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/s)
        || text.match(/"reply"\s*:\s*'([^']*)'/);
    if (replyMatch) {
        try {
            const unescaped = replyMatch[1]
                .replace(/\\n/g, '\n')
                .replace(/\\"/g, '"')
                .replace(/\\\\/g, '\\');
            return {
                reply: clampText(unescaped, 400),
                advance: /"advance"\s*:\s*true/i.test(text),
                complete: /"complete"\s*:\s*true/i.test(text)
            };
        } catch (_) {}
    }
    
    return buildOfflineAgentReply(userMsg, task, session);
}

async function decomposeGoalWithAI(goalText) {
    const systemPrompt = `你是 Lumina 任務行動代理。將用戶的大目標拆解為可執行步驟，並確保第一步是「今天就能開始」的最小行動。繁體中文。
回傳合法 JSON：
{"mainGoal":"...","steps":[{"title":"...","time":30,"priority":"高","why":"...","suggestedTime":"09:00"}],"tips":["..."],"totalTime":120}
priority 只能是「高」「中」「低」。steps 4-8 個。第一步必須門檻最低、可在 30 分鐘內完成。`;
    
    const content = await callDeepSeek([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `請拆解：${goalText}` }
    ], { jsonMode: true, temperature: 0.6 });
    
    const parsed = parseJsonFromAI(content);
    if (!parsed.steps?.length) throw new Error('AI 未回傳有效步驟');
    parsed.totalTime = parsed.totalTime || parsed.steps.reduce((s, x) => s + (x.time || 0), 0);
    parsed.mainGoal = parsed.mainGoal || goalText;
    parsed.tips = parsed.tips || [];
    return parsed;
}

function normalizeCoachPlan(raw, fallbackTask) {
    const plan = {
        title: clampText(raw?.title || '任務執行方案', 80),
        task: clampText(raw?.task || fallbackTask || '目前任務', 120),
        summary: clampText(raw?.summary || '', 400),
        steps: [],
        resources: [],
        document: null,
        checklist: [],
        tips: []
    };
    
    for (const s of (raw?.steps || []).slice(0, 6)) {
        if (!s?.title) continue;
        plan.steps.push({
            title: clampText(s.title, 100),
            duration: clampText(s.duration || '10 分鐘', 20),
            action: clampText(s.action || s.detail || '', 300)
        });
    }
    
    for (const r of (raw?.resources || []).slice(0, 5)) {
        if (!r?.title) continue;
        const url = String(r.url || '').trim();
        plan.resources.push({
            title: clampText(r.title, 80),
            url: isSafeHttpUrl(url) ? url : '',
            note: clampText(r.note || '', 120)
        });
    }
    
    if (raw?.document?.title) {
        plan.document = {
            title: clampText(raw.document.title, 80),
            sections: (raw.document.sections || []).slice(0, 8).map(sec => ({
                heading: clampText(sec.heading || sec.title || '章節', 60),
                bullets: (sec.bullets || sec.items || []).slice(0, 8).map(b => clampText(b, 200))
            }))
        };
    }
    
    plan.checklist = (raw?.checklist || []).slice(0, 8).map(c => clampText(c, 120)).filter(Boolean);
    plan.checklistDone = plan.checklist.map(() => false);
    plan.tips = (raw?.tips || []).slice(0, 4).map(t => clampText(t, 200)).filter(Boolean);
    
    if (plan.document) ensureDocumentFields(plan.document);
    
    const taskForResources = plan.task || fallbackTask || '';
    if (plan.resources.length < 2 && taskForResources) {
        const extras = buildTaskResources(taskForResources, inferCategory(taskForResources, 3));
        for (const r of extras) {
            if (plan.resources.length >= 5) break;
            if (!plan.resources.some(x => x.title === r.title)) plan.resources.push(r);
        }
    }
    return plan;
}

function estimatePlanDuration(plan) {
    let mins = 0;
    for (const s of (plan?.steps || [])) {
        const m = String(s.duration || '').match(/(\d+)/);
        if (m) mins += parseInt(m[1], 10);
    }
    return mins || null;
}

function parseBulletToField(bullet, index) {
    const text = String(bullet || '').trim();
    if (!text) return { label: `項目 ${index + 1}`, value: '', placeholder: '請填寫…', editable: true };
    
    const colonSplit = text.match(/^(.+?)[：:]\s*(.*)$/);
    if (colonSplit) {
        const label = colonSplit[1].trim();
        const rest = colonSplit[2].trim();
        const needsFill = !rest || /\[請填|待填|___/.test(rest);
        if (needsFill) {
            const ph = rest.replace(/\[請填[^\]]*\]/g, '').trim();
            return { label, value: '', placeholder: ph || `填寫${label}…`, editable: true };
        }
        return { label, value: rest, placeholder: `補充${label}…`, editable: true };
    }
    
    if (/^\[請填/.test(text)) {
        return { label: `項目 ${index + 1}`, value: '', placeholder: '請填寫…', editable: true };
    }
    
    if (/（\d+\s*min）|（\d+\s*分鐘）|\d+min\)/.test(text) && !/\[請填|待填/.test(text)) {
        return { static: true, value: text };
    }
    
    return { label: `項目 ${index + 1}`, value: text, placeholder: '請填寫…', editable: true };
}

function ensureDocumentFields(document) {
    if (!document) return null;
    document.sections = (document.sections || []).map(sec => {
        if (sec.fields?.length) return sec;
        const bullets = sec.bullets || [];
        return {
            heading: sec.heading,
            bullets,
            fields: bullets.map((b, i) => parseBulletToField(b, i))
        };
    });
    return document;
}

function renderEditableDocumentHtml(planId, document) {
    if (!document?.sections?.length) return '';
    ensureDocumentFields(document);
    return document.sections.map((sec, si) => `
        <div class="coach-doc-section">
            <div class="coach-doc-heading">${escapeHtml(sec.heading)}</div>
            <div class="coach-doc-fields">
                ${(sec.fields || []).map((f, fi) => {
                    if (f.static) {
                        return `<div class="coach-doc-static">${escapeHtml(f.value)}</div>`;
                    }
                    const label = f.label || `項目 ${fi + 1}`;
                    return `
                    <label class="coach-doc-field">
                        <span class="coach-doc-label">${escapeHtml(label)}</span>
                        <textarea class="coach-doc-input" rows="2" placeholder="${escapeHtml(f.placeholder || '請填寫…')}"
                            oninput="updateCoachDocField('${escapeHtml(planId)}', ${si}, ${fi}, this.value)">${escapeHtml(f.value || '')}</textarea>
                    </label>`;
                }).join('')}
            </div>
        </div>`).join('');
}

function updateCoachDocField(planId, sectionIdx, fieldIdx, value) {
    const plan = coachPlans.get(planId);
    if (!plan?.document?.sections?.[sectionIdx]?.fields?.[fieldIdx]) return;
    plan.document.sections[sectionIdx].fields[fieldIdx].value = value;
}

function toggleCoachChecklistItem(planId, itemIdx, checked) {
    const plan = coachPlans.get(planId);
    if (!plan) return;
    if (!plan.checklistDone) plan.checklistDone = plan.checklist.map(() => false);
    plan.checklistDone[itemIdx] = checked;
}

function extractTaskNameFromMessage(msg) {
    const quoted = msg.match(/[「『"']([^」』"']+)[」』"']/);
    if (quoted) return quoted[1].trim();
    const prefix = msg.match(/(?:開始做|帶我|任務[：:]|關於)\s*(.+)$/i);
    if (prefix) return prefix[1].trim().slice(0, 120);
    return '';
}

function inferTaskDocType(taskName) {
    const lower = taskName.toLowerCase();
    if (/報告|okr|路線圖|分析/.test(lower)) return 'report';
    if (/提案|簡報|pitch/.test(lower)) return 'proposal';
    if (/會議|同步|討論|standup/.test(lower)) return 'meeting';
    if (/郵件|回覆|信/.test(lower)) return 'email';
    return 'worksheet';
}

function buildTaskResources(taskName, category) {
    const catLabel = getCategoryLabel(category || 'execution');
    const q = encodeURIComponent(`${taskName} ${catLabel} 範本`);
    const resources = [
        { title: '搜尋相關資料與範本', url: `https://www.google.com/search?q=${q}`, note: '找產業案例、格式參考' }
    ];
    const lower = taskName.toLowerCase();
    if (/報告|路線圖|okr/.test(lower)) {
        resources.push({ title: 'Notion 模板庫', url: 'https://www.notion.so/templates', note: '尋找報告／專案規劃模板' });
    }
    if (/提案|簡報/.test(lower)) {
        resources.push({ title: 'Canva 簡報模板', url: 'https://www.canva.com/templates/', note: '快速建立視覺提案' });
    }
    if (/學習|課程|研究/.test(lower)) {
        resources.push({ title: 'Google Scholar', url: `https://scholar.google.com/scholar?q=${encodeURIComponent(taskName)}`, note: '學術與深度資料' });
    }
    return resources;
}

function buildDocumentDraft(taskName, docType) {
    const title = `${taskName} — 執行草稿`;
    const sections = [];
    
    if (docType === 'report') {
        sections.push(
            { heading: '一、背景與目標', bullets: ['現況摘要：[請填寫 3 句]', '核心問題：[請填寫]', '成功標準：[請填寫]'] },
            { heading: '二、分析與發現', bullets: ['數據／事實 #1：[請填寫]', '數據／事實 #2：[請填寫]', '關鍵洞察：[請填寫]'] },
            { heading: '三、建議與行動', bullets: ['優先建議 A：[請填寫]', '優先建議 B：[請填寫]', '負責人與時程：[請填寫]'] }
        );
    } else if (docType === 'proposal') {
        sections.push(
            { heading: '開場（30 秒）', bullets: ['聽眾痛點：[請填寫]', '方案一句話：[請填寫]'] },
            { heading: '核心內容', bullets: ['問題定義：[請填寫]', '解決方案：[請填寫]', '預期效益：[請填寫]'] },
            { heading: '結尾行動', bullets: ['希望對方決定：[請填寫]', '時程與聯絡：[請填寫]'] }
        );
    } else if (docType === 'meeting') {
        sections.push(
            { heading: '會議資訊', bullets: [`主題：${taskName}`, '時間：[請填寫]', '與會者：[請填寫]'] },
            { heading: '議程', bullets: ['開場＆目標（5min）', '討論重點（20min）', '決議與待辦（10min）'] },
            { heading: '會後待辦', bullets: ['待辦 #1 — 負責人 — 截止日：[請填寫]', '待辦 #2 — 負責人 — 截止日：[請填寫]'] }
        );
    } else if (docType === 'email') {
        sections.push(
            { heading: '郵件主旨', bullets: [`Re: ${taskName}`] },
            { heading: '內文結構', bullets: ['開頭（目的＋上下文）：[請填寫]', '正文（重點 1-2-3）：[請填寫]', '結尾（明確請求）：[請填寫]'] }
        );
    } else {
        sections.push(
            { heading: '任務定義', bullets: [`任務：${taskName}`, '完成標準：[請填寫]', '預估時間：[請填寫]'] },
            { heading: '執行步驟', bullets: ['準備（工具／資料）：[請填寫]', '執行（核心產出）：[請填寫]', '檢查（自我審核）：[請填寫]'] }
        );
    }
    return { title, sections };
}

function buildOfflineCoachPlan(userMsg, ctx) {
    ctx = ctx || getCoachContext();
    const extracted = extractTaskNameFromMessage(userMsg);
    const next = ctx.nextTask;
    const taskName = extracted || next?.name || '今日優先任務';
    const category = next ? resolveCategory(next) : inferCategory(taskName, 3);
    const duration = next?.duration || 30;
    const lower = userMsg.toLowerCase();
    
    let title = '任務執行方案';
    let summary = `針對「${taskName}」的行動計劃，依你目前的待辦脈絡整理，可直接照著做。`;
    const steps = [];
    const tips = [];
    const checklist = [];
    
    if (lower.includes('拖延') || lower.includes('拖')) {
        title = '克服拖延 — 啟動方案';
        summary = '用「極小第一步」降低啟動阻力，先產出可見進展再擴大範圍。';
        steps.push(
            { title: '關閉干擾', duration: '2 分鐘', action: '手機勿擾、關閉非必要分頁，只留一個工作視窗' },
            { title: '定義最小產出', duration: '3 分鐘', action: `寫下「${taskName}」今天只要完成的一小塊（不超過 15 分鐘工作量）` },
            { title: '番茄鐘執行', duration: `${Math.min(15, duration)} 分鐘`, action: '計時開始，只做剛才定義的最小產出，不求完美' }
        );
    } else if (lower.includes('找資料') || lower.includes('參考') || lower.includes('資源') || lower.includes('範本')) {
        title = '參考資料清單';
        summary = `針對「${taskName}」整理可立即查閱的資源與搜尋連結，並附文件大綱供你填寫。`;
        steps.push(
            { title: '瀏覽參考資源', duration: '8 分鐘', action: '依下方連結找 1-2 個最相關的範本或案例' },
            { title: '擷取可用片段', duration: '10 分鐘', action: '把有用的結構或段落貼到下方文件欄位' },
            { title: '整合進任務', duration: '7 分鐘', action: '在下方文件區填完第一節，形成最小可交付版本' }
        );
        tips.push('優先找「已有結構」的範本，比從零寫快 3 倍');
    } else if (lower.includes('文件') || lower.includes('產出') || lower.includes('草稿') || lower.includes('大綱')) {
        title = '執行文件產出';
        summary = `為「${taskName}」生成可直接填寫的結構化草稿，照著填就能推進。`;
        steps.push(
            { title: '打開文件區', duration: '1 分鐘', action: '在下方文件區找到第一個待填欄位' },
            { title: '填寫第一節', duration: '15 分鐘', action: '直接在頁面上填完第一個章節，不求完整' },
            { title: '自我檢查', duration: '5 分鐘', action: '對照下方檢核清單，確認可交付' }
        );
    } else {
        title = '今日執行方案';
        steps.push(
            { title: '準備環境與資料', duration: '5 分鐘', action: '列出需要的檔案、連結、人員，一次備齊' },
            { title: '核心執行', duration: `${Math.min(25, duration)} 分鐘`, action: `專注完成「${taskName}」的最小可交付版本` },
            { title: '收尾檢查', duration: '5 分鐘', action: '對照完成標準，標記待補項目或直接勾選完成' }
        );
    }
    
    checklist.push(
        `「${taskName}」的完成標準已寫下`,
        '所需資料已備齊',
        '產出可給他人看的最小版本',
        '下一步行動已排入待辦'
    );
    tips.push('先完成再完美——有 60 分版本就先交付', `你的高效時段是 ${ctx.peakWindow}，深度工作盡量排在這段`);
    
    return normalizeCoachPlan({
        title,
        task: taskName,
        summary,
        steps,
        resources: buildTaskResources(taskName, category),
        checklist,
        tips
    }, taskName);
}

function coachPlanToMarkdown(plan) {
    let md = `# ${plan.document?.title || plan.title}\n\n`;
    md += `> 任務：${plan.task}\n\n`;
    md += `## 摘要\n${plan.summary}\n\n`;
    if (plan.steps.length) {
        md += `## 執行步驟\n`;
        plan.steps.forEach((s, i) => {
            md += `### ${i + 1}. ${s.title}（${s.duration}）\n${s.action}\n\n`;
        });
    }
    if (plan.document?.sections?.length) {
        ensureDocumentFields(plan.document);
        md += `## ${plan.document.title}\n\n`;
        for (const sec of plan.document.sections) {
            md += `### ${sec.heading}\n`;
            if (sec.fields?.length) {
                for (const f of sec.fields) {
                    if (f.static) md += `${f.value}\n`;
                    else md += `**${f.label}**：${f.value || '（待填）'}\n`;
                }
            } else {
                for (const b of (sec.bullets || [])) md += `- ${b}\n`;
            }
            md += '\n';
        }
    }
    if (plan.checklist.length) {
        md += `## 完成檢核\n`;
        plan.checklist.forEach((c, i) => {
            const done = plan.checklistDone?.[i];
            md += `- [${done ? 'x' : ' '}] ${c}\n`;
        });
        md += '\n';
    }
    if (plan.resources.length) {
        md += `## 參考資源\n`;
        plan.resources.forEach(r => {
            md += `- ${r.title}${r.url ? `：${r.url}` : ''}${r.note ? ` — ${r.note}` : ''}\n`;
        });
    }
    if (plan.tips.length) {
        md += `\n## 教練提醒\n`;
        plan.tips.forEach(t => { md += `- ${t}\n`; });
    }
    md += `\n---\n由 Lumina 行動教練產出 · ${new Date().toLocaleString('zh-TW')}\n`;
    return md;
}

function renderCoachPlan(plan, planId) {
    const estMins = estimatePlanDuration(plan);
    const statsHtml = `
        <div class="coach-plan-stats">
            <span class="coach-plan-stat"><strong>${plan.steps.length}</strong> 步驟</span>
            ${estMins ? `<span class="coach-plan-stat">約 <strong>${estMins}</strong> 分鐘</span>` : ''}
            ${plan.resources.length ? `<span class="coach-plan-stat"><strong>${plan.resources.length}</strong> 資源</span>` : ''}
            ${plan.document ? `<span class="coach-plan-stat">含文件草稿</span>` : ''}
        </div>`;
    
    const stepsHtml = plan.steps.map((s, i) => `
        <li class="coach-step-item">
            <span class="coach-step-num">${i + 1}</span>
            <div>
                <div class="coach-step-title">${escapeHtml(s.title)}</div>
                <div class="coach-step-detail">${escapeHtml(s.action)}</div>
                <div class="coach-step-duration"><i class="fa-regular fa-clock"></i> ${escapeHtml(s.duration)}</div>
            </div>
        </li>`).join('');
    
    const resourcesHtml = plan.resources.length ? `
        <div class="coach-plan-section">
            <div class="coach-plan-section-title"><i class="fa-solid fa-book-open"></i> 參考資源</div>
            <ul class="coach-resource-list">
                ${plan.resources.map(r => `
                    <li class="coach-resource-item">
                        ${r.url
                            ? `<a class="coach-resource-link" href="${escapeHtml(r.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(r.title)}</a>`
                            : `<span class="text-slate-300">${escapeHtml(r.title)}</span>`}
                        ${r.note ? `<div class="text-[10px] text-slate-500 mt-0.5">${escapeHtml(r.note)}</div>` : ''}
                    </li>`).join('')}
            </ul>
        </div>` : '';
    
    const docHtml = plan.document ? `
        <div class="coach-plan-section">
            <div class="coach-plan-section-title"><i class="fa-solid fa-pen-to-square"></i> ${escapeHtml(plan.document.title || '執行文件')} <span class="text-[10px] text-slate-500 font-normal ml-1">直接填寫</span></div>
            <div class="coach-doc-block">${renderEditableDocumentHtml(planId, plan.document)}</div>
        </div>` : '';
    
    const checklistHtml = plan.checklist.length ? `
        <div class="coach-plan-section">
            <div class="coach-plan-section-title"><i class="fa-solid fa-list-check"></i> 完成檢核</div>
            <ul class="coach-checklist-interactive">${plan.checklist.map((c, i) => `
                <li><label class="coach-check-item">
                    <input type="checkbox" ${plan.checklistDone?.[i] ? 'checked' : ''} onchange="toggleCoachChecklistItem('${escapeHtml(planId)}', ${i}, this.checked)">
                    <span>${escapeHtml(c)}</span>
                </label></li>`).join('')}</ul>
        </div>` : '';
    
    const tipsHtml = plan.tips.length ? `
        <div class="coach-plan-section">
            <div class="coach-plan-section-title"><i class="fa-solid fa-lightbulb"></i> 提醒</div>
            <ul class="coach-checklist">${plan.tips.map(t => `<li>${escapeHtml(t)}</li>`).join('')}</ul>
        </div>` : '';
    
    return `
        <div class="coach-plan-card" data-plan-id="${escapeHtml(planId)}">
            <div class="coach-plan-header">
                <div class="coach-plan-title">${escapeHtml(plan.title)}</div>
                <div class="coach-plan-meta">任務：${escapeHtml(plan.task)}</div>
                ${statsHtml}
            </div>
            <div class="coach-plan-body">
                <div class="coach-plan-section">
                    <div class="coach-plan-section-title"><i class="fa-solid fa-bullseye"></i> 摘要</div>
                    <div class="coach-plan-summary">${escapeHtml(plan.summary)}</div>
                </div>
                ${stepsHtml ? `<div class="coach-plan-section"><div class="coach-plan-section-title"><i class="fa-solid fa-shoe-prints"></i> 執行步驟</div><ol class="coach-step-list">${stepsHtml}</ol></div>` : ''}
                ${resourcesHtml}
                ${docHtml}
                ${checklistHtml}
                ${tipsHtml}
            </div>
            <div class="coach-action-bar">
                <button type="button" class="coach-action-btn coach-action-btn-success" onclick="startCoachPlan('${planId}')"><i class="fa-solid fa-play"></i> 照此開始</button>
                <button type="button" class="coach-action-btn coach-action-btn-primary" onclick="copyCoachPlan('${planId}')"><i class="fa-solid fa-copy"></i> 複製已填內容</button>
                <button type="button" class="coach-action-btn" onclick="applyCoachStepsAsTasks('${planId}')"><i class="fa-solid fa-plus"></i> 加入子步驟</button>
                <button type="button" class="coach-action-btn opacity-70" onclick="downloadCoachDocument('${planId}')"><i class="fa-solid fa-file-export"></i> 匯出 .md</button>
            </div>
        </div>`;
}

function storeCoachPlan(plan, taskId) {
    const planId = 'coach_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    coachPlans.set(planId, plan);
    linkPlanToTask(planId, plan, taskId);
    return planId;
}

function copyCoachPlan(planId) {
    const plan = coachPlans.get(planId);
    if (!plan) return showToast('找不到方案內容', 'error');
    const md = coachPlanToMarkdown(plan);
    navigator.clipboard.writeText(md).then(() => showToast('已複製到剪貼簿', 'success'))
        .catch(() => showToast('複製失敗，請手動選取', 'error'));
}

function downloadCoachDocument(planId) {
    const plan = coachPlans.get(planId);
    if (!plan) return showToast('找不到文件內容', 'error');
    const md = coachPlanToMarkdown(plan);
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (plan.document?.title || plan.title || 'Lumina教練文件').replace(/[\\/:*?"<>|]/g, '_') + '.md';
    a.click();
    URL.revokeObjectURL(a.href);
    showToast('文件已下載', 'success');
}

function startCoachPlan(planId) {
    const plan = coachPlans.get(planId);
    if (!plan) return showToast('找不到方案內容', 'error');
    
    const existing = findTaskForPlan(plan);
    if (existing && plan.steps?.length) {
        taskCoachPlans.set(existing.id, planId);
        todayFocusTaskId = existing.id;
        focusSession = {
            taskId: existing.id,
            startedAt: Date.now(),
            steps: normalizeFocusSteps(plan.steps),
            currentStep: 0,
            planId
        };
        showSection('dashboard');
        refreshUI({ dashboard: true, scheduler: true, filters: true });
        startFocusTimer(existing.duration || 30);
        pulseNextStepCard();
        document.getElementById('next-step-card')?.classList.add('focus-session-active');
        showToast(`照方案開始：${existing.name}`, 'success');
        return;
    }
    
    if (plan.steps?.length) {
        applyCoachStepsAsTasks(planId);
    } else {
        showSection('dashboard');
        showToast(`開始執行：${plan.task}`, 'success');
    }
}

function applyCoachStepsAsTasks(planId) {
    const plan = coachPlans.get(planId);
    if (!plan?.steps?.length) return showToast('此方案沒有可加入的步驟', 'error');
    if (findTaskForPlan(plan)) {
        return showToast('此任務已在待辦中，請點「照此開始」', 'error');
    }
    const parentGoalId = Date.now();
    const parentGoalName = plan.task;
    plan.steps.forEach((step, index) => {
        const mins = parseInt(step.duration, 10) || 10;
        tasks.push({
            id: parentGoalId + index + 1,
            name: step.title,
            duration: mins,
            energy: index === 0 ? 4 : 3,
            category: inferCategory(step.title, 3),
            due: getTodayISO(),
            completed: false,
            parentGoalId,
            parentGoalName
        });
    });
    todayFocusTaskId = parentGoalId + 1;
    saveState();
    refreshUI({ dashboard: true, scheduler: true, filters: true });
    showToast(`已拆解為 ${plan.steps.length} 個子步驟，開始第一步`, 'success');
    showSection('dashboard');
    setTimeout(() => startTodayTask(parentGoalId + 1, { quiet: true }), 300);
}

async function coachRespondWithAI(userMsg) {
    const ctx = getCoachContext();
    const contextBlock = buildCoachContextText(ctx);
    const taskHint = extractTaskNameFromMessage(userMsg) || ctx.nextTask?.name || '';
    
    const systemPrompt = `你是 Lumina 任務行動代理。繁體中文，語氣專業正式、條理清晰。你必須回傳「僅 JSON」、不要 markdown 程式碼區塊。

JSON 格式：
{
  "title": "方案標題（如：Q3 報告執行方案）",
  "task": "對應任務名稱",
  "summary": "2-3句正式摘要，說明目標與產出",
  "steps": [{"title":"步驟名","duration":"10分鐘","action":"具體、可立即執行的做法"}],
  "resources": [{"title":"資源名","url":"https://...","note":"用途說明"}],
  "document": {"title":"文件名","sections":[{"heading":"章節","bullets":["條目（待填處用 [請填寫]）"]}]},
  "checklist": ["完成檢核項"],
  "tips": ["專業提醒"]
}

要求：
1. steps 固定 3 項，duration 用「X 分鐘」格式，action 要具體可執行
2. document 必須是可填寫的正式草稿（報告／提案／會議議程／郵件／執行清單），每節 2-4 條；待填欄位格式為「欄位名稱：[請填寫]」（用戶會在頁面上直接輸入，不需下載）
3. resources 至少 3 項真實可查的連結（Google 搜尋、官方文件、範本庫等）
4. 若用戶要「找資料」，resources 為重點，title 改為「參考資料清單」
5. 禁止空泛勵志語，全部對應任務脈絡與用戶待辦

${contextBlock}
用戶聚焦任務：${taskHint || '（依待辦推斷）'}`;
    
    const messages = [
        { role: 'system', content: systemPrompt },
        ...chatHistory.slice(-6).map(m => ({
            role: m.role,
            content: m.content.replace(/<[^>]+>/g, '').slice(0, 800)
        })),
        { role: 'user', content: userMsg }
    ];
    const content = await callDeepSeek(messages, { jsonMode: true, temperature: 0.55 });
    try {
        return normalizeCoachPlan(parseJsonFromAI(content), taskHint);
    } catch (_) {
        return buildOfflineCoachPlan(userMsg, ctx);
    }
}

async function testApiConnection() {
    const keyInput = document.getElementById('settings-api-key').value.trim();
    if (keyInput) {
        localStorage.setItem('lumina_api_key', keyInput);
        userProfile.apiEnabled = true;
        document.getElementById('settings-api-enabled').checked = true;
    } else {
        userProfile.apiEnabled = document.getElementById('settings-api-enabled').checked;
    }
    userProfile.apiMode = document.getElementById('settings-api-mode').value;
    userProfile.apiProxyUrl = document.getElementById('settings-api-proxy').value.trim();
    userProfile.apiModel = document.getElementById('settings-api-model').value;
    
    showToast('正在測試 API 連線...', 'success');
    try {
        await callDeepSeek([{ role: 'user', content: '請回覆：連線成功' }], { temperature: 0 });
        showToast('✅ API 連線成功！', 'success');
        updateApiStatusBadge();
    } catch (err) {
        showToast('連線失敗：' + err.message, 'error');
    }
}

function loadSettingsForm() {
    document.getElementById('settings-name').value = userProfile.name;
    document.getElementById('settings-role').value = userProfile.role;
    document.getElementById('settings-work-start').value = userProfile.workStart || '09:00';
    document.getElementById('settings-work-end').value = userProfile.workEnd || '18:00';
    document.getElementById('settings-peak-start').value = userProfile.peakStart || '09:00';
    document.getElementById('settings-peak-end').value = userProfile.peakEnd || '12:30';
    document.getElementById('settings-streak-threshold').value = userProfile.streakThreshold || 80;
    document.getElementById('settings-streak-value').innerText = (userProfile.streakThreshold || 80) + '%';
    document.getElementById('settings-confetti').checked = userProfile.enableConfetti !== false;
    document.getElementById('settings-api-enabled').checked = !!userProfile.apiEnabled;
    document.getElementById('settings-api-mode').value = userProfile.apiMode || 'direct';
    document.getElementById('settings-api-key').value = localStorage.getItem('lumina_api_key') || '';
    document.getElementById('settings-api-proxy').value = userProfile.apiProxyUrl || 'http://localhost:3001/api/chat';
    document.getElementById('settings-api-model').value = userProfile.apiModel || 'deepseek-chat';
    document.getElementById('settings-enterprise-api').value = userProfile.enterpriseApiUrl || 'http://localhost:3001';
    toggleApiModeFields();
    updateApiStatusBadge();
    updateAuthUI();
}

function clearApiKey() {
    localStorage.removeItem('lumina_api_key');
    const input = document.getElementById('settings-api-key');
    if (input) input.value = '';
    updateApiStatusBadge();
    showToast('API Key 已清除', 'success');
}

function saveSettings() {
    userProfile.name = document.getElementById('settings-name').value.trim() || '使用者';
    userProfile.role = document.getElementById('settings-role').value.trim() || '知識工作者';
    userProfile.workStart = document.getElementById('settings-work-start').value;
    userProfile.workEnd = document.getElementById('settings-work-end').value;
    userProfile.peakStart = document.getElementById('settings-peak-start').value;
    userProfile.peakEnd = document.getElementById('settings-peak-end').value;
    userProfile.streakThreshold = parseInt(document.getElementById('settings-streak-threshold').value);
    userProfile.enableConfetti = document.getElementById('settings-confetti').checked;
    userProfile.apiEnabled = document.getElementById('settings-api-enabled').checked;
    userProfile.apiMode = document.getElementById('settings-api-mode').value;
    userProfile.apiModel = document.getElementById('settings-api-model').value;
    
    const proxyUrl = document.getElementById('settings-api-proxy').value.trim();
    const enterpriseUrl = document.getElementById('settings-enterprise-api').value.trim() || 'http://localhost:3001';
    if (userProfile.apiMode === 'proxy' && proxyUrl && !isSafeHttpUrl(proxyUrl)) {
        return showToast('代理伺服器 URL 無效，請使用 http:// 或 https://', 'error');
    }
    if (!isSafeHttpUrl(enterpriseUrl)) {
        return showToast('企業 API 位址無效，請使用 http:// 或 https://', 'error');
    }
    userProfile.apiProxyUrl = proxyUrl;
    userProfile.enterpriseApiUrl = enterpriseUrl;
    
    const apiKey = document.getElementById('settings-api-key').value.trim();
    if (apiKey) {
        localStorage.setItem('lumina_api_key', apiKey);
        userProfile.apiEnabled = true;
        document.getElementById('settings-api-enabled').checked = true;
    }
    
    saveState();
    refreshUI({ dashboard: true, filters: true });
    updateApiStatusBadge();
    showToast('設定已儲存！', 'success');
    showSection('dashboard');
}

function exportData() {
    const safeProfile = { ...userProfile };
    delete safeProfile.apiKey;
    const data = {
        version: 3,
        exportedAt: new Date().toISOString(),
        tasks,
        userProfile: safeProfile,
        weeklyScores,
        dailyHistory
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `lumina-backup-${getTodayISO()}.json`;
    a.click();
    showToast('資料已匯出', 'success');
}

function importData(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > IMPORT_MAX_BYTES) {
        showToast('匯入失敗：檔案過大（上限 2MB）', 'error');
        event.target.value = '';
        return;
    }
    
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            validateImportedData(data);
            if (data.tasks) {
                tasks = data.tasks.map((t, i) => sanitizeImportedTask(t, i)).filter(Boolean);
            }
            if (data.userProfile) {
                userProfile = { ...userProfile, ...sanitizeImportedProfile(data.userProfile) };
            }
            if (data.weeklyScores) {
                weeklyScores = data.weeklyScores.map(s => Math.min(100, Math.max(0, parseInt(s, 10) || 0)));
            }
            if (data.dailyHistory) dailyHistory = data.dailyHistory;
            migrateTasks();
            saveState({ immediateAnalytics: true });
            refreshUI({ dashboard: true, scheduler: true });
            loadSettingsForm();
            showToast('資料匯入成功！', 'success');
        } catch (err) {
            showToast('匯入失敗：' + (err.message || '檔案格式錯誤'), 'error');
        }
    };
    reader.readAsText(file);
    event.target.value = '';
}

function persistTasks() {
    localStorage.setItem('lumina_tasks', JSON.stringify(tasks));
}

function persistProfile() {
    localStorage.setItem('lumina_profile', JSON.stringify(userProfile));
}

function persistAnalytics(immediate = false) {
    const run = () => {
        recordDailySnapshot();
        recalculateWeeklyScores();
        localStorage.setItem('lumina_weekly', JSON.stringify(weeklyScores));
    };
    clearTimeout(analyticsPersistTimer);
    if (immediate) run();
    else analyticsPersistTimer = setTimeout(run, 300);
}

function saveState(opts = {}) {
    const { immediateAnalytics = false } = opts;
    persistTasks();
    persistProfile();
    persistAnalytics(immediateAnalytics);
    invalidateTodayStats();
    syncUserDataToServer();
}

function getEnterpriseBaseUrl() {
    const url = (userProfile.enterpriseApiUrl || 'http://localhost:3001').replace(/\/$/, '');
    return isSafeHttpUrl(url) ? url : 'http://localhost:3001';
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
    return String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

async function enterpriseFetch(method, path, body) {
    const url = getEnterpriseBaseUrl() + path;
    try {
        const res = await fetch(url, {
            method,
            headers: {
                ...getAuthHeaders(!!body),
                ...(body ? { 'Content-Type': 'application/json' } : {})
            },
            body: body ? JSON.stringify(body) : undefined
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '請求失敗');
        return { ok: true, data, offline: false };
    } catch (err) {
        return { ok: false, error: err.message, offline: true };
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
        managerPinHash: await hashPin(body.managerPin || '0000'),
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
    if (!enterpriseSession) return [];
    const store = loadLocalEnterpriseStore();
    const group = store.groups[normalizeEnterpriseCode(enterpriseSession.groupCode)];
    if (!group) return [];
    ensureLocalGroupNotifications(group);
    return group.notifications
        .filter(n => n.recipientId === enterpriseSession.memberId)
        .slice(0, 50);
}

function markLocalTeamNotificationsRead(ids, readAll) {
    if (!enterpriseSession) return 0;
    const store = loadLocalEnterpriseStore();
    const group = store.groups[normalizeEnterpriseCode(enterpriseSession.groupCode)];
    if (!group) return 0;
    ensureLocalGroupNotifications(group);
    let updated = 0;
    for (const note of group.notifications) {
        if (note.recipientId !== enterpriseSession.memberId) continue;
        if (readAll || ids.includes(note.id)) {
            if (!note.read) updated++;
            note.read = true;
        }
    }
    saveLocalEnterpriseStore(store);
    return updated;
}

function getDefaultTeamNotificationPrefs() {
    return { taskAssigned: true, taskCompleted: true, toast: true, desktop: false };
}

function getTeamNotificationPrefs() {
    try {
        return { ...getDefaultTeamNotificationPrefs(), ...JSON.parse(localStorage.getItem(TEAM_NOTIF_PREFS_KEY) || '{}') };
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
    localStorage.setItem(TEAM_NOTIF_PREFS_KEY, JSON.stringify(prefs));
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

function formatNotifTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return '剛剛';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分鐘前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小時前`;
    return d.toLocaleString('zh-TW', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function shouldAlertForNotification(note, prefs) {
    if (note.type === 'task_assigned' || note.type === 'task_assigned_confirm') return prefs.taskAssigned;
    if (note.type === 'task_completed' || note.type === 'task_completed_confirm') return prefs.taskCompleted;
    return true;
}

function ingestTeamNotificationsFromResponse(notifications, alert = true) {
    if (!notifications?.length || !enterpriseSession) return;
    for (const note of notifications) {
        if (note.recipientId !== enterpriseSession.memberId) continue;
        const exists = teamNotifications.some(n => n.id === note.id);
        if (exists) continue;
        knownTeamNotificationIds.add(note.id);
        teamNotifications = [note, ...teamNotifications].slice(0, 50);
        if (alert) alertForNewTeamNotification(note);
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
    const incoming = notifications || [];
    const newUnread = [];
    for (const note of incoming) {
        if (!knownTeamNotificationIds.has(note.id)) {
            knownTeamNotificationIds.add(note.id);
            if (teamNotificationsInitialized && !note.read) newUnread.push(note);
        }
    }
    if (!teamNotificationsInitialized) {
        incoming.forEach(n => knownTeamNotificationIds.add(n.id));
        teamNotificationsInitialized = true;
    }
    for (const note of newUnread) alertForNewTeamNotification(note);
    teamNotifications = incoming;
    updateNotificationUI();
}

async function refreshTeamNotifications(force = false) {
    if (!enterpriseSession) {
        teamNotifications = [];
        updateNotificationUI();
        return;
    }
    const path = `/api/enterprise/notifications?groupCode=${encodeURIComponent(enterpriseSession.groupCode)}&memberId=${encodeURIComponent(enterpriseSession.memberId)}`;
    const api = await enterpriseFetch('GET', path);
    if (api.ok) {
        processIncomingTeamNotifications(api.data.notifications || []);
    } else {
        processIncomingTeamNotifications(getLocalTeamNotifications());
    }
}

function updateNotificationUI() {
    const wrap = document.getElementById('notif-wrap');
    const badge = document.getElementById('notif-badge');
    const bell = document.getElementById('notif-bell-btn');
    const unread = teamNotifications.filter(n => !n.read).length;
    
    if (wrap) wrap.classList.toggle('hidden', !enterpriseSession);
    if (badge) {
        if (unread > 0) {
            badge.textContent = unread > 9 ? '9+' : String(unread);
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    }
    if (bell) bell.classList.toggle('has-unread', unread > 0);
    if (notifPanelOpen) renderNotificationPanel();
}

function renderNotificationPanel() {
    const list = document.getElementById('notif-panel-list');
    if (!list) return;
    if (!teamNotifications.length) {
        list.innerHTML = `<div class="notif-empty"><i class="fa-solid fa-bell-slash text-2xl mb-2 block opacity-40"></i>目前沒有通知</div>`;
        return;
    }
    list.innerHTML = teamNotifications.map(note => {
        const isComplete = note.type === 'task_completed' || note.type === 'task_completed_confirm';
        const iconCls = isComplete ? 'notif-item-icon-completed' : 'notif-item-icon-assigned';
        const icon = isComplete ? 'fa-check' : (note.type === 'task_assigned_confirm' ? 'fa-share' : 'fa-paper-plane');
        return `
            <div class="notif-item ${note.read ? '' : 'unread'}" onclick="handleTeamNotificationClick('${note.id}')" role="button" tabindex="0">
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
    notifPanelOpen = !notifPanelOpen;
    const panel = document.getElementById('notif-panel');
    const bell = document.getElementById('notif-bell-btn');
    if (panel) panel.classList.toggle('hidden', !notifPanelOpen);
    if (bell) bell.setAttribute('aria-expanded', notifPanelOpen ? 'true' : 'false');
    if (notifPanelOpen) {
        renderNotificationPanel();
        refreshTeamNotifications(true);
    }
}

function closeNotificationPanel() {
    notifPanelOpen = false;
    document.getElementById('notif-panel')?.classList.add('hidden');
    document.getElementById('notif-bell-btn')?.setAttribute('aria-expanded', 'false');
}

async function markTeamNotificationRead(noteId) {
    if (!enterpriseSession || !noteId) return;
    const api = await enterpriseFetch('PATCH', '/api/enterprise/notifications/read', {
        groupCode: enterpriseSession.groupCode,
        memberId: enterpriseSession.memberId,
        ids: [noteId]
    });
    if (!api.ok) markLocalTeamNotificationsRead([noteId], false);
    const note = teamNotifications.find(n => n.id === noteId);
    if (note) note.read = true;
    updateNotificationUI();
}

async function markAllTeamNotificationsRead() {
    if (!enterpriseSession) return;
    const api = await enterpriseFetch('PATCH', '/api/enterprise/notifications/read', {
        groupCode: enterpriseSession.groupCode,
        memberId: enterpriseSession.memberId,
        readAll: true
    });
    if (!api.ok) markLocalTeamNotificationsRead([], true);
    teamNotifications.forEach(n => { n.read = true; });
    updateNotificationUI();
    showToast('已全部標為已讀', 'success');
}

function handleTeamNotificationClick(noteId) {
    const note = teamNotifications.find(n => n.id === noteId);
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

async function updateTeamSyncStatus() {
    const el = document.getElementById('team-sync-status');
    if (!el) return;
    try {
        const res = await fetch(getEnterpriseBaseUrl() + '/health', { method: 'GET' });
        if (res.ok) {
            el.textContent = '● 已連線';
            el.className = 'text-[10px] px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/25';
        } else {
            throw new Error('offline');
        }
    } catch (_) {
        el.textContent = '● 離線模式';
        el.className = 'text-[10px] px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/25';
    }
}

function copyGroupCode() {
    if (!enterpriseSession?.groupCode) return showToast('尚無群組代碼', 'error');
    const code = enterpriseSession.groupCode;
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
    if (!enterpriseSession) showSection('team');
}

async function createEnterpriseGroup() {
    const name = document.getElementById('team-create-name').value.trim();
    const code = normalizeEnterpriseCode(document.getElementById('team-create-code').value);
    const managerName = document.getElementById('team-create-manager').value.trim();
    const managerPin = document.getElementById('team-create-pin').value.trim() || '0000';
    
    if (!code || code.length < 4) return showToast('群組代碼至少 4 個字元', 'error');
    if (!managerName) return showToast('請輸入主管名稱', 'error');
    
    const payload = { name, code, managerName, managerPin };
    let result;
    const api = await enterpriseFetch('POST', '/api/enterprise/group/create', payload);
    
    if (api.ok) {
        result = api.data;
    } else {
        try {
            result = { ok: true, ...(await enterpriseLocalCreate(payload)) };
            showToast('已建立群組（本機離線模式）', 'success');
        } catch (e) {
            return showToast(e.message, 'error');
        }
    }
    
    enterpriseSession = {
        memberId: result.member.id,
        name: result.member.name,
        role: result.member.role,
        groupCode: result.group.code,
        groupName: result.group.name
    };
    localStorage.setItem('lumina_enterprise_session', JSON.stringify(enterpriseSession));
    showToast(`群組 ${result.group.code} 建立成功！`, 'success');
    await refreshEnterpriseData();
    renderEnterprisePage();
    startEnterprisePolling();
    await refreshTeamNotifications(true);
}

async function joinEnterpriseGroup() {
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
    } else {
        try {
            result = { ok: true, ...(await enterpriseLocalJoin(payload)) };
            showToast('已加入群組（本機離線模式）', 'success');
        } catch (e) {
            return showToast(e.message, 'error');
        }
    }
    
    enterpriseSession = {
        memberId: result.member.id,
        name: result.member.name,
        role: result.member.role,
        groupCode: result.group.code,
        groupName: result.group.name
    };
    localStorage.setItem('lumina_enterprise_session', JSON.stringify(enterpriseSession));
    showToast(`已加入 ${result.group.name}`, 'success');
    await refreshEnterpriseData();
    renderEnterprisePage();
    startEnterprisePolling();
    await refreshTeamNotifications(true);
}

function leaveEnterpriseGroup() {
    if (!confirm('確定離開目前群組？')) return;
    enterpriseSession = null;
    enterpriseGroupData = null;
    teamNotifications = [];
    teamNotificationsInitialized = false;
    knownTeamNotificationIds.clear();
    closeNotificationPanel();
    stopEnterprisePolling();
    localStorage.removeItem('lumina_enterprise_session');
    renderEnterprisePage();
    updateNotificationUI();
    showToast('已離開群組', 'success');
}

async function refreshEnterpriseData(force = false) {
    if (!enterpriseSession) return;
    
    const now = Date.now();
    if (!force && enterpriseGroupData && (now - enterpriseDataFetchedAt) < ENTERPRISE_FETCH_TTL_MS) {
        renderEnterpriseTasks();
        return;
    }
    
    const code = enterpriseSession.groupCode;
    const memberQ = `?memberId=${encodeURIComponent(enterpriseSession.memberId)}`;
    const api = await enterpriseFetch('GET', `/api/enterprise/group/${code}${memberQ}`);
    
    if (api.ok) {
        enterpriseGroupData = api.data.group;
        if (api.data.group.notifications) {
            processIncomingTeamNotifications(api.data.group.notifications);
        }
    } else {
        try {
            enterpriseGroupData = enterpriseLocalGetGroup(code, enterpriseSession.memberId).group;
            if (enterpriseGroupData.notifications) {
                processIncomingTeamNotifications(enterpriseGroupData.notifications);
            }
        } catch (e) {
            showToast('同步失敗：' + e.message, 'error');
            return;
        }
    }
    enterpriseDataFetchedAt = Date.now();
    renderEnterpriseTasks();
    if (enterpriseGroupData?.documents?.length) {
        ensureEnterpriseDocsInRag();
    }
}

function renderEnterprisePage() {
    const onboarding = document.getElementById('team-onboarding');
    const workspace = document.getElementById('team-workspace');
    const badge = document.getElementById('team-status-badge');
    const apiHint = document.getElementById('team-api-hint');
    
    if (!enterpriseSession) {
        onboarding?.classList.remove('hidden');
        workspace?.classList.add('hidden');
        if (badge) { badge.textContent = '未加入群組'; badge.className = 'self-start sm:self-auto text-xs px-4 py-2 rounded-full bg-slate-800/80 text-slate-400 border border-slate-700/60'; }
        document.getElementById('team-stats-row')?.classList.add('hidden');
        apiHint?.classList.remove('hidden');
        return;
    }
    
    onboarding?.classList.add('hidden');
    workspace?.classList.remove('hidden');
    apiHint?.classList.add('hidden');
    
    setElText('team-group-name', enterpriseSession.groupName);
    setElText('team-group-code', enterpriseSession.groupCode);
    setElText('team-user-name', enterpriseSession.name);
    setElText('team-user-role', enterpriseSession.role === 'manager' ? '主管' : '成員');
    
    if (badge) {
        badge.textContent = `${enterpriseSession.groupCode} · ${enterpriseSession.role === 'manager' ? '主管' : '成員'}`;
        badge.className = 'self-start sm:self-auto text-xs px-4 py-2 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/25';
    }
    
    const isManager = enterpriseSession.role === 'manager';
    document.getElementById('team-manager-panel')?.classList.toggle('hidden', !isManager);
    document.getElementById('team-overview-panel')?.classList.toggle('hidden', !isManager);
    document.getElementById('team-stats-row')?.classList.remove('hidden');
    const tasksTitle = document.getElementById('team-tasks-title');
    if (tasksTitle) tasksTitle.textContent = isManager ? '我負責的任務' : '指派給我的任務';
    
    const dueInput = document.getElementById('team-assign-due');
    if (dueInput && !dueInput.value) dueInput.value = getTomorrowISO();
    
    updateTeamSyncStatus();
    loadTeamNotificationPrefsForm();
    refreshEnterpriseData();
    updateNotificationUI();
    refreshTeamNotifications();
}

function renderEnterpriseTasks() {
    if (!enterpriseSession || !enterpriseGroupData) return;
    
    const membersEl = document.getElementById('team-members-list');
    const assignSelect = document.getElementById('team-assign-member');
    const myTasksEl = document.getElementById('team-my-tasks');
    const overviewBody = document.getElementById('team-overview-body');
    const progressEl = document.getElementById('team-my-progress');
    
    const members = enterpriseGroupData.members || [];
    const groupTasks = enterpriseGroupData.tasks || [];
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
    
    if (assignSelect && enterpriseSession.role === 'manager') {
        assignSelect.innerHTML = members
            .filter(m => m.role !== 'manager')
            .map(m => `<option value="${m.id}">${escapeHtml(m.name)}</option>`)
            .join('') || '<option value="">（尚無成員，請邀請同事加入）</option>';
    }
    
    const myTasks = groupTasks.filter(t => t.assigneeId === enterpriseSession.memberId);
    const done = myTasks.filter(t => t.completed).length;
    const myRate = myTasks.length ? Math.round((done / myTasks.length) * 100) : 0;
    
    const progressWrap = document.getElementById('team-progress-wrap');
    const progressFill = document.getElementById('team-progress-fill');
    if (progressEl) {
        progressEl.textContent = myTasks.length ? `已完成 ${done} / ${myTasks.length}（${myRate}%）` : '等待主管指派任務';
    }
    if (progressWrap && progressFill) {
        if (myTasks.length) {
            progressWrap.classList.remove('hidden');
            progressFill.style.width = myRate + '%';
        } else {
            progressWrap.classList.add('hidden');
            progressFill.style.width = '0%';
        }
    }
    
    if (myTasksEl) {
        if (myTasks.length === 0) {
            myTasksEl.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon"><i class="fa-solid fa-inbox"></i></div>
                    <div class="text-sm">目前沒有指派給你的任務</div>
                    <div class="text-xs text-slate-600 mt-1">完成後主管會即時看到更新</div>
                </div>`;
        } else {
            myTasksEl.innerHTML = myTasks.map(t => renderEnterpriseTaskRow(t, true, syncedIds)).join('');
        }
    }
    
    if (overviewBody && enterpriseSession.role === 'manager') {
        if (groupTasks.length === 0) {
            overviewBody.innerHTML = `
                <tr><td colspan="4">
                    <div class="empty-state py-8">
                        <div class="empty-state-icon"><i class="fa-solid fa-clipboard-list"></i></div>
                        <div class="text-sm">尚無團隊任務</div>
                        <div class="text-xs text-slate-600 mt-1">在上方指派第一個任務</div>
                    </div>
                </td></tr>`;
        } else {
            overviewBody.innerHTML = groupTasks.map(t => `
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

function toggleAddDocForm(show) {
    const form = document.getElementById('team-add-doc-form');
    if (!form) return;
    if (show === undefined) {
        form.classList.toggle('hidden');
    } else {
        form.classList.toggle('hidden', !show);
    }
}

let selectedDocFile = null;

function switchDocFormType(type) {
    const isText = type === 'text';
    document.getElementById('team-doc-text-area')?.classList.toggle('hidden', !isText);
    document.getElementById('team-doc-file-area')?.classList.toggle('hidden', isText);
    selectedDocFile = null;
    const infoEl = document.getElementById('team-doc-file-info');
    if (infoEl) {
        infoEl.innerHTML = '';
        infoEl.classList.add('hidden');
    }
    const fileInput = document.getElementById('team-doc-file');
    if (fileInput) fileInput.value = '';
}

async function handleDocFileSelect(event) {
    const file = event.target.files?.[0];
    if (!file) {
        selectedDocFile = null;
        return;
    }
    
    if (file.size > 5 * 1024 * 1024) {
        showToast('檔案大小不能超過 5MB', 'error');
        event.target.value = '';
        selectedDocFile = null;
        return;
    }
    
    const infoEl = document.getElementById('team-doc-file-info');
    if (infoEl) {
        infoEl.classList.remove('hidden');
        infoEl.textContent = '載入並解析檔案中，請稍候...';
    }
    
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    const isImage = file.type.startsWith('image/');
    const isExcel = file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || 
                    file.type === 'application/vnd.ms-excel' || 
                    file.name.toLowerCase().endsWith('.xlsx') || 
                    file.name.toLowerCase().endsWith('.xls');
    
    if (!isPdf && !isImage && !isExcel) {
        showToast('僅支援上傳 PDF 文件、圖片與 Excel 檔案', 'error');
        event.target.value = '';
        selectedDocFile = null;
        if (infoEl) infoEl.classList.add('hidden');
        return;
    }
    
    const titleInput = document.getElementById('team-doc-title');
    if (titleInput && !titleInput.value) {
        const extIndex = file.name.lastIndexOf('.');
        titleInput.value = extIndex !== -1 ? file.name.slice(0, extIndex) : file.name;
    }
    
    try {
        const reader = new FileReader();
        const base64Promise = new Promise((resolve) => {
            reader.onload = () => {
                const res = reader.result;
                const base64 = res.split(',')[1];
                resolve(base64);
            };
            reader.readAsDataURL(file);
        });
        
        const base64Data = await base64Promise;
        
        if (isPdf) {
            let extractedText = '';
            try {
                extractedText = await extractTextFromPdf(file);
            } catch (e) {
                console.warn('[Lumina PDF] 文字解析失敗:', e.message);
                extractedText = '';
            }
            
            selectedDocFile = {
                filename: file.name,
                fileData: base64Data,
                docType: 'pdf',
                extractedText: extractedText
            };
            
            if (infoEl) {
                infoEl.innerHTML = `<i class="fa-solid fa-file-pdf mr-1 text-red-400"></i> PDF 解析完成！共擷取 <strong>${extractedText.length}</strong> 字元，將會自動餵給 AI 行動教練。`;
            }
        } else if (isExcel) {
            let extractedText = '';
            try {
                extractedText = await extractTextFromExcel(file);
            } catch (e) {
                console.warn('[Lumina Excel] 資料解析失敗:', e.message);
                extractedText = '';
            }
            
            selectedDocFile = {
                filename: file.name,
                fileData: base64Data,
                docType: 'excel',
                extractedText: extractedText
            };
            
            if (infoEl) {
                infoEl.innerHTML = `<i class="fa-solid fa-file-excel mr-1 text-green-500"></i> Excel 解析完成！共擷取 <strong>${extractedText.length}</strong> 字元，將會自動餵給 AI 行動教練。`;
            }
        } else if (isImage) {
            selectedDocFile = {
                filename: file.name,
                fileData: base64Data,
                docType: 'image',
                extractedText: ''
            };
            
            if (infoEl) {
                infoEl.innerHTML = `
                    <div class="flex flex-col gap-1.5">
                        <span class="text-emerald-400"><i class="fa-solid fa-file-image mr-1"></i> 圖片已載入</span>
                        <img src="data:${file.type};base64,${base64Data}" class="max-h-24 rounded-lg border border-slate-800 object-contain w-fit self-start mt-1">
                    </div>`;
            }
        }
    } catch (err) {
        showToast('檔案載入失敗: ' + err.message, 'error');
        event.target.value = '';
        selectedDocFile = null;
        if (infoEl) infoEl.classList.add('hidden');
    }
}

async function extractTextFromPdf(file) {
    if (typeof pdfjsLib === 'undefined') {
        throw new Error('PDF.js 未載入');
    }
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';
    
    const maxPages = Math.min(pdf.numPages, 30);
    for (let i = 1; i <= maxPages; i++) {
        try {
            const page = await pdf.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(item => item.str).join(' ');
            fullText += pageText + '\n';
        } catch (e) {
            console.warn(`[Lumina PDF] 第 ${i} 頁解析失敗`, e);
        }
    }
    return fullText.trim();
}

async function extractTextFromExcel(file) {
    if (typeof XLSX === 'undefined') {
        throw new Error('SheetJS (XLSX) 未載入');
    }
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    let fullText = '';
    
    for (const sheetName of workbook.SheetNames) {
        const worksheet = workbook.Sheets[sheetName];
        const csv = XLSX.utils.sheet_to_csv(worksheet);
        if (csv && csv.trim()) {
            fullText += `--- 工作表: ${sheetName} ---\n${csv}\n\n`;
        }
    }
    return fullText.trim();
}

async function saveTeamDocument() {
    if (!enterpriseSession) return;
    
    const typeRadios = document.getElementsByName('team-doc-type');
    let docFormType = 'text';
    for (const r of typeRadios) {
        if (r.checked) {
            docFormType = r.value;
            break;
        }
    }
    
    const title = document.getElementById('team-doc-title')?.value?.trim();
    if (!title) {
        showToast('請輸入文件標題', 'error');
        return;
    }
    
    let content = '';
    let docType = 'text';
    let fileData = null;
    let filename = null;
    
    if (docFormType === 'text') {
        content = document.getElementById('team-doc-content')?.value?.trim();
        if (!content) {
            showToast('請輸入文件內容', 'error');
            return;
        }
    } else {
        if (!selectedDocFile) {
            showToast('請選擇要上傳的檔案 (PDF / 圖片 / Excel)', 'error');
            return;
        }
        
        docType = selectedDocFile.docType;
        filename = selectedDocFile.filename;
        fileData = selectedDocFile.fileData;
        
        if (docType === 'pdf' || docType === 'excel') {
            content = selectedDocFile.extractedText || '';
            const desc = document.getElementById('team-doc-description')?.value?.trim();
            if (desc) {
                const docLabel = docType === 'pdf' ? 'PDF 原文內容' : 'Excel 資料內容';
                content = `【檔案備註說明】：${desc}\n\n【${docLabel}】：\n${content}`;
            }
        } else if (docType === 'image') {
            content = document.getElementById('team-doc-description')?.value?.trim();
            if (!content) {
                showToast('請輸入圖片描述/備註，供 AI 行動教練閱讀學習', 'error');
                return;
            }
        }
    }
    
    const kbId = document.getElementById('team-doc-kb-select')?.value || 'general';
    const payload = {
        groupCode: enterpriseSession.groupCode,
        managerId: enterpriseSession.memberId,
        title,
        content,
        docType,
        filename,
        fileData,
        kbId
    };
    
    let ok = false;
    let newDoc = null;
    
    if (enterpriseSession.offline) {
        try {
            const store = loadLocalEnterpriseStore();
            const group = store.groups[normalizeEnterpriseCode(enterpriseSession.groupCode)];
            if (!group) throw new Error('找不到群組');
            if (!group.documents) group.documents = [];
            
            let fileUrl = null;
            if (fileData) {
                if (docType === 'image') {
                    fileUrl = `data:image/png;base64,${fileData}`;
                } else if (docType === 'pdf') {
                    fileUrl = 'blob:local-pdf-file';
                } else if (docType === 'excel') {
                    fileUrl = 'blob:local-excel-file';
                } else {
                    fileUrl = `blob:local-${docType}-file`;
                }
            }
            
            newDoc = {
                id: 'd_' + Date.now(),
                title,
                content,
                docType,
                fileUrl,
                filename,
                author: enterpriseSession.name,
                createdAt: new Date().toISOString()
            };
            group.documents.unshift(newDoc);
            saveLocalEnterpriseStore(store);
            ok = true;
            await syncDocumentToRag({
                groupCode: enterpriseSession.groupCode,
                kbId,
                docType,
                title,
                content,
                filename,
                fileData
            }, { toastOnError: true });
            ragSyncedGroupKey = null;
        } catch (e) {
            showToast('本機保存失敗: ' + e.message, 'error');
        }
    } else {
        const res = await enterpriseFetch('POST', '/api/enterprise/group/document/add', payload);
        if (res.ok) {
            ok = true;
            newDoc = res.data.document;
            
            await syncDocumentToRag({
                groupCode: enterpriseSession.groupCode,
                kbId,
                docType,
                title,
                content,
                filename,
                fileData
            }, { toastOnError: true });
            ragSyncedGroupKey = null;
        } else {
            showToast('發布失敗: ' + res.error, 'error');
        }
    }
    
    if (ok) {
        showToast('文件已成功發布', 'success');
        const tEl = document.getElementById('team-doc-title');
        const cEl = document.getElementById('team-doc-content');
        const fInput = document.getElementById('team-doc-file');
        const descEl = document.getElementById('team-doc-description');
        if (tEl) tEl.value = '';
        if (cEl) cEl.value = '';
        if (fInput) fInput.value = '';
        if (descEl) descEl.value = '';
        
        const textRadio = document.querySelector('input[name="team-doc-type"][value="text"]');
        if (textRadio) {
            textRadio.checked = true;
            switchDocFormType('text');
        }
        
        selectedDocFile = null;
        toggleAddDocForm(false);
        refreshEnterpriseData();
    }
}

async function deleteTeamDocument(docId) {
    if (!enterpriseSession) return;
    if (!confirm('確定要刪除此文件嗎？刪除後將無法恢復，且 AI 也無法讀取該資料。')) return;
    
    const docs = enterpriseGroupData?.documents || [];
    const docToDelete = docs.find(d => d.id === docId);
    
    const payload = {
        groupCode: enterpriseSession.groupCode,
        managerId: enterpriseSession.memberId,
        documentId: docId
    };
    
    let ok = false;
    
    if (enterpriseSession.offline) {
        try {
            const store = loadLocalEnterpriseStore();
            const group = store.groups[normalizeEnterpriseCode(enterpriseSession.groupCode)];
            if (!group) throw new Error('找不到群組');
            if (group.documents) {
                group.documents = group.documents.filter(d => d.id !== docId);
            }
            saveLocalEnterpriseStore(store);
            ok = true;
        } catch (e) {
            showToast('本機刪除失敗: ' + e.message, 'error');
        }
    } else {
        const res = await enterpriseFetch('POST', '/api/enterprise/group/document/delete', payload);
        if (res.ok) {
            ok = true;
        } else {
            showToast('刪除失敗: ' + res.error, 'error');
        }
    }
    
    if (ok) {
        showToast('文件已成功刪除', 'success');
        
        if (ragServiceActive && docToDelete) {
            await deleteDocumentFromRag({
                groupCode: enterpriseSession.groupCode,
                kbId: docToDelete.kbId || 'general',
                filename: getRagFilenameForDoc(docToDelete)
            });
        }
        
        refreshEnterpriseData();
    }
}

function renderEnterpriseDocuments() {
    if (!enterpriseSession || !enterpriseGroupData) return;
    const docs = enterpriseGroupData.documents || [];
    const isManager = enterpriseSession.role === 'manager';
    
    const addBtn = document.getElementById('team-add-doc-btn');
    if (addBtn) addBtn.classList.toggle('hidden', !isManager);
    
    const listEl = document.getElementById('team-docs-list');
    if (!listEl) return;
    
    if (docs.length === 0) {
        listEl.innerHTML = `
            <div class="empty-state py-8">
                <div class="empty-state-icon bg-purple-500/10 text-purple-400" style="background-color: rgba(168, 85, 247, 0.1); color: rgb(192, 132, 252);"><i class="fa-solid fa-folder-open"></i></div>
                <div class="text-sm text-slate-400">目前沒有知識庫文件</div>
                <div class="text-xs text-slate-500 mt-1">${isManager ? '在上方點擊「新增文件」發布專案指南或新人資料' : '主管發布指南後將會在此顯示，且 AI 行動教練會自動學習'}</div>
            </div>`;
        return;
    }
    
    function resolveDocFileUrl(fileUrl) {
        if (!fileUrl) return '';
        if (fileUrl.startsWith('data:image/')) return fileUrl;
        if (fileUrl.startsWith('blob:')) return fileUrl;
        if (fileUrl.startsWith('http:') || fileUrl.startsWith('https:')) {
            return fileUrl;
        }
        if (fileUrl.startsWith('/uploads/')) {
            return getEnterpriseBaseUrl() + fileUrl;
        }
        return '';
    }
    
    listEl.innerHTML = docs.map(d => {
        const type = d.docType || 'text';
        const isText = type === 'text';
        const isPdf = type === 'pdf';
        const isImage = type === 'image';
        const isExcel = type === 'excel';
        
        let typeBadge = '';
        if (isPdf) {
            typeBadge = '<span class="px-2 py-0.5 rounded text-[9px] font-semibold bg-red-500/20 text-red-300 border border-red-500/20"><i class="fa-solid fa-file-pdf mr-1"></i>PDF 文件</span>';
        } else if (isExcel) {
            typeBadge = '<span class="px-2 py-0.5 rounded text-[9px] font-semibold bg-green-500/20 text-green-300 border border-green-500/20"><i class="fa-solid fa-file-excel mr-1"></i>Excel 檔案</span>';
        } else if (isImage) {
            typeBadge = '<span class="px-2 py-0.5 rounded text-[9px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/20"><i class="fa-solid fa-image mr-1"></i>圖片檔案</span>';
        } else {
            typeBadge = '<span class="px-2 py-0.5 rounded text-[9px] font-semibold bg-purple-500/20 text-purple-300 border border-purple-500/20"><i class="fa-solid fa-file-lines mr-1"></i>文字筆記</span>';
        }

        const kbLabels = {
            general: '一般預設',
            onboarding: '新人培訓',
            specs: '開發規格',
            meetings: '會議 SOP'
        };
        const kbName = kbLabels[d.kbId || 'general'] || '一般預設';
        const kbBadge = `<span class="px-2 py-0.5 rounded text-[9px] font-semibold bg-indigo-500/20 text-indigo-300 border border-indigo-500/20"><i class="fa-solid fa-tag mr-1"></i>${kbName}</span>`;
        
        return `
        <div class="p-4 rounded-2xl border border-slate-800 bg-slate-950/40 hover:bg-slate-900/50 transition-colors">
            <div class="flex items-start justify-between gap-3 mb-2">
                <div>
                    <div class="flex items-center gap-2 flex-wrap">
                        <h4 class="font-semibold text-sm text-slate-200">${escapeHtml(d.title)}</h4>
                        ${typeBadge}
                        ${kbBadge}
                    </div>
                    <div class="text-[10px] text-slate-500 mt-0.5">發布者：${escapeHtml(d.author || '主管')} · ${new Date(d.createdAt).toLocaleString('zh-TW')}</div>
                </div>
                ${isManager ? `
                    <button onclick="deleteTeamDocument('${d.id}')" class="text-red-400 hover:text-red-300 text-xs px-2 py-1 rounded hover:bg-red-500/10 transition-colors">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                ` : ''}
            </div>
            
            ${isText ? `
                <p class="text-xs text-slate-400 whitespace-pre-wrap leading-relaxed">${escapeHtml(d.content)}</p>
            ` : ''}
            
            ${isPdf ? `
                <div class="mt-3 flex items-center gap-2">
                    <a href="${resolveDocFileUrl(d.fileUrl)}" target="_blank" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-red-500/30 bg-red-500/5 text-red-400 text-xs hover:bg-red-500/15 transition-colors">
                        <i class="fa-solid fa-file-pdf"></i>
                        <span>開啟 PDF 檔案 (${escapeHtml(d.filename || '檢視文件')})</span>
                    </a>
                </div>
                ${d.content ? `
                    <div class="mt-3">
                        <div class="text-[10px] text-slate-500 mb-1">擷取文字內容預覽 (已自動導入 AI 教練)：</div>
                        <p class="text-[11px] text-slate-400 max-h-24 overflow-y-auto bg-slate-950/40 p-2.5 rounded-xl border border-slate-800/80 leading-relaxed custom-scroll font-mono">${escapeHtml(d.content.slice(0, 500))}${d.content.length > 500 ? '...' : ''}</p>
                    </div>
                ` : ''}
            ` : ''}
            
            ${isExcel ? `
                <div class="mt-3 flex items-center gap-2">
                    <a href="${resolveDocFileUrl(d.fileUrl)}" target="_blank" class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-green-500/30 bg-green-500/5 text-green-400 text-xs hover:bg-green-500/15 transition-colors">
                        <i class="fa-solid fa-file-excel"></i>
                        <span>開啟 Excel 檔案 (${escapeHtml(d.filename || '檢視資料')})</span>
                    </a>
                </div>
                ${d.content ? `
                    <div class="mt-3">
                        <div class="text-[10px] text-slate-500 mb-1">擷取試算表內容預覽 (已自動導入 AI 教練)：</div>
                        <p class="text-[11px] text-slate-400 max-h-24 overflow-y-auto bg-slate-950/40 p-2.5 rounded-xl border border-slate-800/80 leading-relaxed custom-scroll font-mono">${escapeHtml(d.content.slice(0, 500))}${d.content.length > 500 ? '...' : ''}</p>
                    </div>
                ` : ''}
            ` : ''}
            
            ${isImage ? `
                <div class="mt-3">
                    <img src="${resolveDocFileUrl(d.fileUrl)}" class="max-h-48 rounded-xl border border-slate-800/80 object-contain hover:scale-[1.01] transition-transform cursor-pointer" onclick="window.open(this.src, '_blank')">
                </div>
                <p class="text-xs text-slate-400 mt-2.5 whitespace-pre-wrap leading-relaxed"><i class="fa-solid fa-circle-info mr-1 text-purple-400"></i>${escapeHtml(d.content)}</p>
            ` : ''}
        </div>
    `;
    }).join('');
}

function renderEnterpriseTaskRow(task, canToggle, syncedIds) {
    const synced = syncedIds ? syncedIds.has(task.id) : buildSyncedEnterpriseIdSet().has(task.id);
    return `
        <div class="task-row ${task.completed ? 'task-row-done' : ''}" data-team-task-id="${task.id}">
            <input type="checkbox" ${task.completed ? 'checked' : ''} ${canToggle ? `onclick="event.stopPropagation()" onchange="toggleEnterpriseTask('${task.id}', this.checked)"` : 'disabled'}
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
                ${canToggle && !synced ? `<button onclick="syncEnterpriseTaskToPersonal('${task.id}')" class="text-[10px] px-2 py-1 rounded-lg border border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/10" title="同步到個人清單"><i class="fa-solid fa-arrow-down-to-bracket"></i></button>` : ''}
                ${synced ? `<span class="text-[10px] text-slate-500">已同步</span>` : ''}
                <span class="status-pill ${task.completed ? 'status-pill-done' : 'status-pill-pending'}">
                    ${task.completed ? '已完成' : '進行中'}
                </span>
            </div>
        </div>
    `;
}

async function assignEnterpriseTask() {
    if (!enterpriseSession || enterpriseSession.role !== 'manager') {
        return showToast('僅主管可指派任務', 'error');
    }
    
    const title = document.getElementById('team-assign-title').value.trim();
    const assigneeId = document.getElementById('team-assign-member').value;
    if (!title) return showToast('請輸入任務名稱', 'error');
    if (!assigneeId) return showToast('請選擇成員', 'error');
    
    const payload = {
        groupCode: enterpriseSession.groupCode,
        managerId: enterpriseSession.memberId,
        assigneeId,
        title,
        due: document.getElementById('team-assign-due').value || getTodayISO(),
        duration: parseInt(document.getElementById('team-assign-duration').value) || 30,
        category: document.getElementById('team-assign-category').value,
        energy: 3
    };
    
    const api = await enterpriseFetch('POST', '/api/enterprise/task/assign', payload);
    
    const localAssignFallback = () => {
        const store = loadLocalEnterpriseStore();
        const group = store.groups[enterpriseSession.groupCode];
        const assignee = group?.members.find(m => m.id === assigneeId);
        const manager = group?.members.find(m => m.id === enterpriseSession.memberId);
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
            created.push(pushLocalTeamNotification(enterpriseSession.groupCode, {
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
        created.push(pushLocalTeamNotification(enterpriseSession.groupCode, {
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
        showToast('任務已指派！已發送通知', 'success');
    } else {
        localAssignFallback();
    }
    
    document.getElementById('team-assign-title').value = '';
    await refreshEnterpriseData(true);
    await refreshTeamNotifications(true);
}

function applyEnterpriseTaskToCache(taskId, completed, serverTask) {
    if (!enterpriseGroupData?.tasks) return false;
    const task = enterpriseGroupData.tasks.find(t => t.id === taskId);
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
    const group = store.groups[enterpriseSession.groupCode];
    const task = group?.tasks.find(t => t.id === taskId);
    const member = group?.members.find(m => m.id === enterpriseSession.memberId);
    if (!task || !(enterpriseSession.role === 'manager' || task.assigneeId === enterpriseSession.memberId)) {
        return { ok: false, notifications: [] };
    }
    const wasCompleted = !!task.completed;
    task.completed = completed;
    task.completedAt = completed ? new Date().toISOString() : null;
    const created = [];
    if (completed && !wasCompleted && task.assignedById && task.assignedById !== enterpriseSession.memberId) {
        created.push(pushLocalTeamNotification(enterpriseSession.groupCode, {
            type: 'task_completed',
            recipientId: task.assignedById,
            title: '任務已完成',
            message: `${member?.name || enterpriseSession.name} 完成了「${task.title}」`,
            taskId: task.id,
            taskTitle: task.title,
            actorId: enterpriseSession.memberId,
            actorName: member?.name || enterpriseSession.name
        }));
    }
    if (completed && !wasCompleted && task.assigneeId === enterpriseSession.memberId && task.assigneeId !== task.assignedById) {
        created.push(pushLocalTeamNotification(enterpriseSession.groupCode, {
            type: 'task_completed_confirm',
            recipientId: enterpriseSession.memberId,
            title: '任務已標記完成',
            message: `你已完成「${task.title}」，主管已收到通知`,
            taskId: task.id,
            taskTitle: task.title,
            actorId: enterpriseSession.memberId,
            actorName: member?.name || enterpriseSession.name
        }));
    }
    saveLocalEnterpriseStore(store);
    return { ok: true, notifications: created.filter(Boolean), task: { ...task } };
}

async function toggleEnterpriseTask(taskId, completed) {
    if (!enterpriseSession || enterpriseToggleInFlight.has(taskId)) return;
    enterpriseToggleInFlight.add(taskId);
    
    const snapshot = enterpriseGroupData?.tasks?.find(t => t.id === taskId);
    const prevCompleted = snapshot?.completed;
    applyEnterpriseTaskToCache(taskId, completed);
    
    const payload = {
        groupCode: enterpriseSession.groupCode,
        memberId: enterpriseSession.memberId,
        completed
    };
    
    let succeeded = false;
    try {
        const api = await enterpriseFetch('PATCH', `/api/enterprise/task/${taskId}`, payload);
        
        if (api.ok) {
            succeeded = true;
            if (api.data.task) applyEnterpriseTaskToCache(taskId, completed, api.data.task);
            ingestTeamNotificationsFromResponse(api.data.notifications || []);
        } else {
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
        
        if (completed && succeeded) {
            showToast('任務已完成！已發送通知', 'success');
            if (userProfile.enableConfetti !== false) triggerConfetti();
        }
        
        await refreshEnterpriseData(true);
        await refreshTeamNotifications(true);
    } finally {
        enterpriseToggleInFlight.delete(taskId);
    }
}

function startEnterprisePolling() {
    stopEnterprisePolling();
    if (!enterpriseSession) return;
    enterprisePollTimer = setInterval(() => {
        if (document.visibilityState !== 'visible') return;
        refreshTeamNotifications();
        if ($('team')?.classList.contains('active')) {
            refreshEnterpriseData();
        }
    }, ENTERPRISE_POLL_INTERVAL_MS);
}

function stopEnterprisePolling() {
    if (enterprisePollTimer) {
        clearInterval(enterprisePollTimer);
        enterprisePollTimer = null;
    }
}

window.addEventListener('storage', (e) => {
    if (e.key === LOCAL_ENTERPRISE_KEY && enterpriseSession) {
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

let schedulerTabPending = null;
let onboardingStep = 0;

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

function switchSchedulerTab(tab) {
    const tasksPanel = document.getElementById('scheduler-panel-tasks');
    const decomposePanel = document.getElementById('scheduler-panel-decompose');
    const tabTasks = document.getElementById('sched-tab-tasks');
    const tabDecompose = document.getElementById('sched-tab-decompose');
    
    const isDecompose = tab === 'decompose';
    if (tasksPanel) tasksPanel.classList.toggle('hidden', isDecompose);
    if (decomposePanel) decomposePanel.classList.toggle('hidden', !isDecompose);
    if (tabTasks) tabTasks.classList.toggle('active', !isDecompose);
    if (tabDecompose) tabDecompose.classList.toggle('active', isDecompose);
}

function openDecomposeTab() {
    showSection('scheduler');
    switchSchedulerTab('decompose');
}

function clearOnboardHighlight() {
    document.querySelectorAll('.onboard-highlight').forEach(el => el.classList.remove('onboard-highlight'));
}

function applyOnboardHighlight(id) {
    clearOnboardHighlight();
    const el = document.getElementById(id);
    if (el) {
        el.classList.add('onboard-highlight');
        setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'center' }), 400);
    }
}

function renderOnboardingStep() {
    const step = ONBOARDING_STEPS[onboardingStep];
    if (!step) return;
    
    const iconEl = document.getElementById('onboarding-icon');
    const titleEl = document.getElementById('onboarding-title');
    const descEl = document.getElementById('onboarding-desc');
    const nextBtn = document.getElementById('onboarding-next-btn');
    const dots = document.querySelectorAll('.onboarding-dot');
    
    if (iconEl) {
        iconEl.className = 'onboarding-icon ' + step.iconBg;
        iconEl.innerHTML = `<i class="fa-solid ${sanitizeFaIcon(step.icon)}"></i>`;
    }
    if (titleEl) titleEl.textContent = step.title;
    if (descEl) descEl.textContent = step.desc;
    if (nextBtn) nextBtn.textContent = onboardingStep === ONBOARDING_STEPS.length - 1 ? '開始使用' : '下一步';
    
    dots.forEach((dot, i) => {
        dot.classList.toggle('active', i === onboardingStep);
        dot.classList.toggle('done', i < onboardingStep);
    });
    
    showSection(step.section);
    if (step.schedTab) switchSchedulerTab(step.schedTab);
    if (step.onEnter) setTimeout(() => step.onEnter(), 400);
    setTimeout(() => {
        if (step.highlight) applyOnboardHighlight(step.highlight);
    }, 350);
}

function startOnboarding() {
    onboardingStep = 0;
    const overlay = document.getElementById('onboarding-overlay');
    if (overlay) overlay.classList.remove('hidden');
    renderOnboardingStep();
}

function nextOnboardingStep() {
    onboardingStep++;
    if (onboardingStep >= ONBOARDING_STEPS.length) {
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
    const overlay = document.getElementById('onboarding-overlay');
    if (overlay) overlay.classList.add('hidden');
    localStorage.setItem('lumina_onboarding_v2', 'true');
    showSection('dashboard');
    showToast('歡迎使用 Lumina！從「今日」頁開始吧', 'success');
}

function showGuideTab(tab) {
    ['solutions', 'manual', 'workflow'].forEach(t => {
        document.getElementById('guide-panel-' + t)?.classList.toggle('active', t === tab);
        document.getElementById('guide-tab-' + t)?.classList.toggle('active', t === tab);
    });
}

function closeNavMore() {
    const menu = document.getElementById('nav-more-menu');
    const btn = document.getElementById('nav-more-btn');
    if (menu) menu.classList.add('hidden');
    if (btn) btn.setAttribute('aria-expanded', 'false');
    closeMobileMore();
}

function toggleNavMore() {
    const menu = document.getElementById('nav-more-menu');
    const btn = document.getElementById('nav-more-btn');
    if (!menu || !btn) return;
    menu.classList.toggle('hidden');
    btn.setAttribute('aria-expanded', menu.classList.contains('hidden') ? 'false' : 'true');
}

function navigateFromMore(section) {
    closeNavMore();
    showSection(section);
}

function updateNavMoreState(section) {
    const moreBtn = document.getElementById('nav-more-btn');
    const mobMore = document.getElementById('mob-nav-more');
    const isMore = MORE_SECTIONS.includes(section);
    
    if (moreBtn) {
        moreBtn.classList.toggle('active', isMore);
        moreBtn.classList.toggle('text-indigo-400', isMore);
    }
    if (mobMore) {
        mobMore.classList.toggle('active', isMore);
        mobMore.classList.toggle('text-indigo-400', isMore);
        mobMore.classList.toggle('text-slate-400', !isMore);
    }
    MORE_SECTIONS.forEach(s => {
        const item = document.getElementById('nav-dropdown-' + s);
        if (item) item.classList.toggle('active', section === s);
    });
}

function toggleMobileMore() {
    const sheet = document.getElementById('mobile-more-sheet');
    if (sheet) sheet.classList.toggle('hidden');
}

function closeMobileMore() {
    const sheet = document.getElementById('mobile-more-sheet');
    if (sheet) sheet.classList.add('hidden');
}

function navigateFromMobileMore(section) {
    closeMobileMore();
    showSection(section);
}

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
    
    if (tasks.length === 0) {
        el.innerHTML = `<div class="next-step-label">今日第一步</div>
               <div class="font-semibold text-lg">你有個大目標，但不知從哪開始？</div>
               <p class="text-sm text-slate-400 mt-1">輸入目標，AI 幫你拆解並推薦今天該做的第一件</p>
               <button onclick="openDecomposeTab()" class="mt-3 text-sm px-4 py-2 rounded-xl bg-indigo-500 hover:bg-indigo-600 text-white font-medium">分解我的目標</button>
               <button onclick="focusQuickAdd()" class="mt-2 text-sm px-4 py-2 rounded-xl border border-slate-600 hover:bg-slate-800 text-slate-300">或直接新增任務</button>`;
        return;
    }
    
    if (todayPending.length === 0) {
        if (futurePending.length > 0) {
            const next = futurePending.sort((a, b) => a.due.localeCompare(b.due))[0];
            el.innerHTML = `<div class="next-step-label">今日狀態</div>
               <div class="font-semibold text-emerald-300">🎉 今日任務已全部完成！</div>
               <p class="text-sm text-slate-400 mt-1">之後還有 ${futurePending.length} 項待辦，最近一項：<strong class="text-slate-300">${escapeHtml(next.name)}</strong>（${next.due}）</p>
               <button onclick="showSection('scheduler')" class="mt-3 text-sm px-4 py-2 rounded-xl border border-slate-600 hover:bg-slate-800 text-slate-300">查看全部任務</button>`;
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
    const inFocus = focusSession && focusSession.taskId === top.id;
    const actionButtons = inFocus ? '' : `
        <div class="flex flex-wrap gap-2 mt-3">
            <button type="button" onclick="startTodayTask(${top.id})" class="text-sm px-4 py-2 rounded-xl bg-indigo-500 hover:bg-indigo-600 text-white font-medium">開始做這件</button>
            <button type="button" onclick="openCoachForTask(${top.id})" class="text-sm px-4 py-2 rounded-xl border border-sky-500/40 hover:bg-sky-500/10 text-sky-300">教練帶我做</button>
            ${queue.total > 1 ? `<button type="button" onclick="skipToNextTodayTask()" class="text-sm px-4 py-2 rounded-xl border border-slate-600 hover:bg-slate-800 text-slate-300">先做下一項</button>` : ''}
        </div>
        <p class="text-[10px] text-slate-500 mt-3">${taskCoachPlans.has(top.id) ? '已有教練方案，點開始會直接載入' : '開始做這件 → 專注模式；教練帶我做 → 完整方案與文件'}</p>`;
    el.classList.toggle('focus-session-active', !!inFocus);
    el.innerHTML = `
        <div class="next-step-label">${inFocus ? '專注執行中' : '今日進行中'} <span class="text-slate-500 font-normal">（${queueText}）</span></div>
        <div class="flex items-start gap-3 mt-1">
            <input type="checkbox" ${top.completed ? 'checked' : ''} onchange="toggleTaskComplete(${top.id}, this, true)" onclick="event.stopPropagation()"
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
    const currentIdx = pending.findIndex(t => t.id === todayFocusTaskId);
    const next = pending[currentIdx + 1] || pending[0];
    if (!next || (pending.length === 1 && next.id === todayFocusTaskId)) {
        showToast('沒有其他待辦了', 'error');
        return;
    }
    endFocusSession();
    todayFocusTaskId = next.id;
    refreshUI({ dashboard: true, filters: false });
    showToast(`已切換：${next.name}`, 'success');
    pulseNextStepCard();
}

// Show specific section
function showSection(section) {
    if (section === 'decomposer') {
        openDecomposeTab();
        return;
    }
    
    closeNavMore();
    
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    
    const target = document.getElementById(section);
    if (target) target.classList.add('active');
    
    document.querySelectorAll('.nav-link[id^="nav-"]').forEach(nav => {
        if (nav.id === 'nav-more-btn') return;
        nav.classList.remove('active', 'text-indigo-400');
        nav.classList.add('text-slate-300');
        nav.removeAttribute('aria-current');
    });
    
    const activeNav = document.getElementById('nav-' + section);
    if (activeNav) {
        activeNav.classList.add('active', 'text-indigo-400');
        activeNav.classList.remove('text-slate-300');
        activeNav.setAttribute('aria-current', 'page');
    }
    
    updateNavMoreState(section);
    
    document.querySelectorAll('.mobile-nav-btn').forEach(btn => {
        btn.classList.remove('active', 'text-indigo-400');
        btn.classList.add('text-slate-400');
    });
    if (!MORE_SECTIONS.includes(section)) {
        const mobNav = document.getElementById('mob-nav-' + section);
        if (mobNav) {
            mobNav.classList.add('active', 'text-indigo-400');
            mobNav.classList.remove('text-slate-400');
        }
    }
    
    const pageTitle = PAGE_TITLES[section] || 'Lumina';
    document.title = pageTitle + ' · 光流 AI Lumina';
    
    window.scrollTo({ top: 0, behavior: 'smooth' });
    
    // Special inits
    if (section === 'insights') {
        refreshInsightsPage();
    }
    
    if (section === 'coach') {
        renderCoachQuickActions();
        refreshCoachView();
    }
    
    if (section === 'dashboard' && focusSession?.endsAt && focusSession.endsAt > Date.now() && !focusTimerInterval) {
        tickFocusTimer();
        focusTimerInterval = setInterval(tickFocusTimer, 1000);
    }
    
    if (section === 'settings') {
        loadSettingsForm();
    }
    
    if (section === 'guide') {
        showGuideTab('solutions');
    }
    
    if (section === 'team') {
        renderEnterprisePage();
        updateTeamSyncStatus();
        startEnterprisePolling();
    } else {
        stopEnterprisePolling();
    }
    
    if (section === 'scheduler') {
        if (schedulerTabPending) {
            switchSchedulerTab(schedulerTabPending);
            schedulerTabPending = null;
        }
        refreshUI({ scheduler: true, filters: true });
        const timeline = $('timeline-view');
        if (timeline && timeline.innerHTML.trim() === '') {
            optimizeSchedule(true);
        }
    }
    
    if (section === 'dashboard') {
        refreshUI({ dashboard: true, filters: true });
    }
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

// Update dashboard numbers and lists
function updateDashboard() {
    invalidateTodayStats();
    const stats = getTodayStats();
    const scoreCtx = getScoringContext();
    const todayRelevant = stats.relevant;
    const todayTotal = todayRelevant.length || 1;
    const firstName = userProfile.name.split(' ')[0] || userProfile.name;
    const weekScore = Math.round(weeklyScores.reduce((a, b) => a + b, 0) / weeklyScores.length);
    
    setElText('greeting-text', `${getGreeting()}，${firstName}`);
    
    const summaryEl = $('today-summary');
    if (summaryEl) {
        const futureNote = stats.futureCount > 0 ? ` · 之後 ${stats.futureCount} 項` : '';
        summaryEl.textContent = `${formatDateTW()} · 今日 ${stats.completed}/${todayRelevant.length} 項（${stats.rate}%）${futureNote} · 連續 ${userProfile.streak} 天 · 本週 ${weekScore} 分`;
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
    
    setElText('streak', userProfile.streak);
    setElText('user-meta', `${userProfile.role} • 第 ${userProfile.joinDay} 天`);
    setElText('user-name', userProfile.name);
    
    const avatar = document.getElementById('user-avatar');
    if (avatar) avatar.innerText = getInitials(userProfile.name);
    
    setElText('dash-peak-time', `${userProfile.peakStart || '09:00'} - ${userProfile.peakEnd || '12:30'}`);
    
    setElText('dash-peak-hint', stats.highEnergyPending > 0
        ? `有 ${stats.highEnergyPending} 項高能量任務 • 今日完成 ${stats.rate}%`
        : `是你最高效時段 • 今日完成 ${stats.rate}%`);
    setElText('best-streak', userProfile.bestStreak);
    
    const container = $('today-focus-list');
    if (!container) return;
    
    const pending = getFilteredTasks(stats.pending);
    const ranked = rankTasksByNextStepScore(pending, scoreCtx);
    if (!todayFocusTaskId && ranked.length) todayFocusTaskId = ranked[0].id;
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

function askCoachAboutNextTask() {
    const pending = resolveTodayFocusTask() || getNextRecommendedTask('today');
    if (!pending) {
        showToast(getFuturePendingTasks().length ? '今日任務已完成，之後的待辦在任務頁' : '目前沒有待辦任務', 'error');
        return;
    }
    openCoachForTask(pending.id);
}

function openCoachForTask(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return openCoachForNextTask();
    todayFocusTaskId = taskId;
    if (focusSession?.taskId !== taskId) {
        clearFocusTimer();
        focusSession = null;
        coachAgentMessages = [];
    }
    showSection('coach');
    setTimeout(() => coachBeginGuidedSession(), 120);
}

function getEnergyLabel(energy) {
    if (energy >= 5) return '極高';
    if (energy >= 4) return '高';
    if (energy >= 3) return '中';
    return '低';
}

// Quick add from dashboard
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
        completed: false
    };
    
    tasks.unshift(newTask);
    saveState();
    input.value = '';
    
    showToast('任務已快速加入！', 'success');
    refreshUI({ dashboard: true, scheduler: true, filters: true, schedule: true });
}

function renderDecomposePlan(plan, source = '規則引擎') {
    const content = document.getElementById('decompose-content');
    if (!content) return;
    content.innerHTML = `
        <div class="mb-3 flex items-center gap-x-2">
            <span class="text-[10px] px-2 py-0.5 rounded-full ${source.includes('DeepSeek') ? 'bg-violet-500/20 text-violet-300' : 'bg-slate-700 text-slate-400'}">${escapeHtml(source)}</span>
        </div>
        <div class="mb-5">
            <div class="uppercase tracking-[1.5px] text-xs text-purple-400 font-medium mb-1">主要目標</div>
            <div class="text-2xl font-semibold leading-tight">${escapeHtml(plan.mainGoal)}</div>
        </div>
        <div class="mb-6">
            <div class="flex items-center justify-between mb-3">
                <div class="text-xs uppercase tracking-wider text-slate-400 font-medium">執行步驟 (${plan.steps.length} 個)</div>
                <div class="text-xs px-3 py-px rounded-full bg-purple-500/10 text-purple-300 font-mono">總預估 ${plan.totalTime} 分鐘</div>
            </div>
            <div class="space-y-2.5">
                ${plan.steps.map((step, idx) => `
                    <div class="subtask group flex gap-x-4 px-5 py-[13px] bg-slate-950 hover:bg-slate-900 transition-colors border border-slate-700 rounded-2xl items-start ${idx === 0 ? 'decompose-first-step' : ''}">
                        <div class="mt-0.5 w-6 h-6 flex-shrink-0 rounded-xl ${idx === 0 ? 'bg-indigo-500/20 text-indigo-300' : 'bg-purple-500/10 text-purple-400'} flex items-center justify-center text-xs font-mono font-bold">${idx === 0 ? '★' : idx + 1}</div>
                        <div class="flex-1 min-w-0 pt-0.5">
                            <div class="font-medium pr-2">${escapeHtml(step.title)}${idx === 0 ? ' <span class="text-[10px] text-indigo-300 font-normal">← 今日第一步</span>' : ''}</div>
                            <div class="text-xs text-slate-400 mt-px">${escapeHtml(step.why)}</div>
                            <div class="flex items-center gap-x-4 mt-3 text-xs">
                                <div class="flex items-center gap-x-1.5 text-emerald-300">
                                    <i class="fa-regular fa-clock"></i>
                                    <span class="font-mono">${step.time} 分鐘</span>
                                </div>
                                <div class="px-2.5 py-px rounded-xl text-xs border ${step.priority === '高' ? 'border-red-400/60 text-red-400' : step.priority === '中' ? 'border-amber-400/60 text-amber-300' : 'border-slate-400/60 text-slate-300'}">${step.priority} 優先</div>
                            </div>
                        </div>
                        <div class="text-right flex-shrink-0">
                            <div class="text-[10px] text-slate-500">建議開始</div>
                            <div class="font-mono text-xs text-slate-300">${escapeHtml(step.suggestedTime || '')}</div>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
        <div class="pt-4 border-t border-slate-700">
            <div class="text-xs uppercase tracking-[1px] text-purple-300 font-medium mb-2">LUMINA AI 額外建議</div>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-x-4 text-xs text-slate-300">
                ${plan.tips.map(tip => `<div class="flex gap-x-2 py-1"><i class="fa-solid fa-check text-emerald-400 mt-0.5 text-xs"></i> <span>${escapeHtml(tip)}</span></div>`).join('')}
            </div>
        </div>
    `;
}

async function decomposeGoal() {
    const input = document.getElementById('goal-input').value.trim();
    if (!input) {
        showToast('請先輸入你的目標', 'error');
        return;
    }
    
    const resultDiv = document.getElementById('decompose-result');
    const content = document.getElementById('decompose-content');
    if (!resultDiv || !content) return;
    resultDiv.classList.remove('hidden');
    content.innerHTML = `
        <div class="flex justify-center py-8">
            <div class="flex flex-col items-center">
                <div class="w-9 h-9 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                <div class="text-sm text-purple-300">${isApiReady() ? 'DeepSeek 正在分析目標...' : 'Lumina AI 正在分析目標...'}</div>
            </div>
        </div>
    `;
    
    let plan, source = '規則引擎';
    try {
        if (isApiReady()) {
            plan = await decomposeGoalWithAI(input);
            source = 'DeepSeek AI';
        } else {
            await new Promise(r => setTimeout(r, 800));
            plan = generateSmartDecomposition(input);
        }
    } catch (err) {
        showToast('AI 失敗，已改用離線規則：' + err.message, 'error');
        plan = generateSmartDecomposition(input);
        source = '規則引擎（備援）';
    }
    
    currentDecomposedPlan = plan;
    renderDecomposePlan(plan, source);
    showToast('目標分解完成！', 'success');
}

function generateSmartDecomposition(goalText) {
    const lower = goalText.toLowerCase();
    let steps = [];
    let tips = [];
    let totalTime = 0;
    let mainGoal = goalText;
    
    // Smart detection
    if (lower.includes('報告') || lower.includes('okr') || lower.includes('路線圖')) {
        steps = [
            { title: "收集資料與現況分析", time: 45, priority: "高", why: "確保數據與事實基礎正確", suggestedTime: "09:00" },
            { title: "建立大綱與關鍵論點", time: 35, priority: "高", why: "先有框架再填充內容", suggestedTime: "10:00" },
            { title: "撰寫初稿（核心章節）", time: 90, priority: "高", why: "最耗時的部分，安排在高峰期", suggestedTime: "10:45" },
            { title: "視覺化圖表與數據呈現", time: 40, priority: "中", why: "讓報告更具說服力", suggestedTime: "14:00" },
            { title: "內部 review 與修改", time: 50, priority: "高", why: "找出盲點與提升品質", suggestedTime: "15:30" },
            { title: "最終校對與格式調整", time: 25, priority: "中", why: "專業度來自細節", suggestedTime: "16:45" }
        ];
        tips = [
            "使用 AI 工具先產生初稿大綱，再親自調整語氣",
            "設定 3 個檢查點：大綱完成、初稿完成、review 完成",
            "準備一個「反對意見」頁面，展示你已思考周全"
        ];
        totalTime = 285;
    } 
    else if (lower.includes('提案') || lower.includes('簡報') || lower.includes('pitch')) {
        steps = [
            { title: "定義聽眾痛點與目標", time: 25, priority: "高", why: "先懂對方需求才能說服", suggestedTime: "09:15" },
            { title: "設計故事線與 3 個關鍵訊息", time: 30, priority: "高", why: "簡報的核心是故事而非數據", suggestedTime: "09:45" },
            { title: "製作高品質視覺簡報", time: 75, priority: "高", why: "視覺決定第一印象", suggestedTime: "10:30" },
            { title: "準備可能問答與反對意見", time: 40, priority: "中", why: "專業的表現來自準備", suggestedTime: "14:00" },
            { title: "彩排與時間控制練習", time: 25, priority: "高", why: "流暢度決定信任感", suggestedTime: "15:30" }
        ];
        tips = [
            "每頁只講一個核心觀點，避免資訊過載",
            "準備 2 種版本：5 分鐘精華版 + 完整版",
            "最後一頁永遠放「下一步行動」與聯絡方式"
        ];
        totalTime = 195;
    }
    else if (lower.includes('專案') || lower.includes('mvp') || lower.includes('side project') || lower.includes('product hunt') || lower.includes('上架')) {
        steps = [
            { title: "定義 MVP 核心功能（只做 3 件事）", time: 30, priority: "高", why: "範圍控制是 side project 成敗關鍵", suggestedTime: "09:00" },
            { title: "技術選型與專案架構搭建", time: 45, priority: "高", why: "先讓骨架跑起來再優化", suggestedTime: "09:45" },
            { title: "開發核心功能 v0.1", time: 120, priority: "高", why: "可 demo 的版本比完美更重要", suggestedTime: "10:30" },
            { title: "設計 Landing Page 與文案", time: 50, priority: "中", why: "第一印象決定轉換率", suggestedTime: "14:00" },
            { title: "內部測試與 bug 修復", time: 40, priority: "高", why: "上線前最後一道防線", suggestedTime: "15:30" },
            { title: "準備 Product Hunt 上架素材", time: 35, priority: "中", why: "好的發布能帶來初始流量", suggestedTime: "16:30" }
        ];
        tips = [
            "設定「上線截止日」並公開承諾，增加外部壓力",
            "先找 5 個朋友做 beta 測試，收集真實 feedback",
            "準備 3 張產品截圖 + 30 秒 demo 影片"
        ];
        totalTime = 320;
    }
    else if (lower.includes('學習') || lower.includes('技能') || lower.includes('prompt')) {
        steps = [
            { title: "定義學習目標與可驗證成果", time: 15, priority: "高", why: "沒有明確目標很容易半途而廢", suggestedTime: "晚上" },
            { title: "收集優質學習資源（課程/文章/範例）", time: 25, priority: "中", why: "好的資源決定學習效率", suggestedTime: "晚上" },
            { title: "建立個人知識筆記系統", time: 20, priority: "中", why: "輸出是最好的輸入", suggestedTime: "晚上" },
            { title: "每天實作 1 小時 + 記錄心得", time: 60, priority: "高", why: " deliberate practice 才是關鍵", suggestedTime: "固定時段" },
            { title: "找人 review 或分享學習成果", time: 30, priority: "中", why: "教學是最好的學習", suggestedTime: "週末" }
        ];
        tips = [
            "使用費曼技巧：用簡單語言解釋給別人聽",
            "設定「輸出里程碑」：第 7 天做出一個小專案",
            "加入相關社群或 Discord 保持動力"
        ];
        totalTime = 150;
    }
    else {
        // Generic smart breakdown
        steps = [
            { title: "明確定義成功標準與範圍", time: 20, priority: "高", why: "避免做到一半發現方向錯誤", suggestedTime: "09:00" },
            { title: "拆解成最小可執行單元", time: 25, priority: "高", why: "降低啟動阻力", suggestedTime: "09:30" },
            { title: "分配資源與時間預算", time: 15, priority: "中", why: "現實的規劃才有執行力", suggestedTime: "10:00" },
            { title: "執行第一個 25 分鐘 Pomodoro", time: 25, priority: "高", why: "克服開始的惰性", suggestedTime: "10:30" },
            { title: "每日復盤與調整計劃", time: 15, priority: "中", why: "持續優化是長期成功的關鍵", suggestedTime: "每日晚上" }
        ];
        tips = [
            "每完成一個步驟就給自己小獎勵",
            "使用「2 分鐘法則」：任何小事立刻做",
            "設定環境：關閉通知、準備好需要的工具"
        ];
        totalTime = 100;
    }
    
    // Add some variation
    if (lower.includes('團隊') || lower.includes('共識')) {
        steps.push({ title: "收集團隊 feedback 並整合", time: 35, priority: "中", why: "共識比完美更重要", suggestedTime: "隔天" });
        totalTime += 35;
    }
    
    return {
        mainGoal: mainGoal,
        steps: steps,
        totalTime: totalTime,
        tips: tips
    };
}

function useExampleGoal(idx) {
    const examples = [
        "完成本季 OKR 報告並獲得主管認可",
        "準備下週與大客戶的產品提案簡報",
        "在 30 天內學會 Prompt Engineering 並應用在工作上",
        "完成個人 side project MVP 並上架到 Product Hunt"
    ];
    document.getElementById('goal-input').value = examples[idx];
    decomposeGoal();
}

function copyPlanToClipboard() {
    if (!currentDecomposedPlan) return;
    
    let text = `目標：${currentDecomposedPlan.mainGoal}\n\n`;
    text += `總預估時間：${currentDecomposedPlan.totalTime} 分鐘\n\n`;
    text += `執行步驟：\n`;
    
    currentDecomposedPlan.steps.forEach((step, i) => {
        text += `${i+1}. ${step.title}（${step.time}分鐘・${step.priority}優先）\n   建議時間：${step.suggestedTime}\n   原因：${step.why}\n\n`;
    });
    
    text += `AI 建議：\n`;
    currentDecomposedPlan.tips.forEach(t => text += `• ${t}\n`);
    
    navigator.clipboard.writeText(text).then(() => {
        showToast('計劃已複製到剪貼簿！', 'success');
    });
}

function addFirstStepToToday() {
    if (!currentDecomposedPlan?.steps?.length) return;
    const step = currentDecomposedPlan.steps[0];
    const parentGoalId = Date.now();
    const energy = step.priority === '高' ? 5 : (step.priority === '中' ? 3 : 2);
    const newTask = {
        id: parentGoalId + 1,
        name: step.title,
        duration: step.time,
        energy: energy,
        category: inferCategory(step.title, energy),
        due: getTodayISO(),
        completed: false,
        parentGoalId: parentGoalId,
        parentGoalName: currentDecomposedPlan.mainGoal
    };
    tasks.push(newTask);
    todayFocusTaskId = newTask.id;
    saveState();
    showToast('今日第一步已加入！', 'success');
    showSection('dashboard');
    refreshUI({ dashboard: true, filters: true });
    setTimeout(() => pulseNextStepCard(), 300);
}

function addDecomposedToScheduler() {
    if (!currentDecomposedPlan) return;
    
    const parentGoalId = Date.now();
    const parentGoalName = currentDecomposedPlan.mainGoal;
    
    currentDecomposedPlan.steps.forEach((step, index) => {
        const energy = step.priority === '高' ? 5 : (step.priority === '中' ? 3 : 2);
        const dueToday = index <= 1 || step.priority === '高';
        const newTask = {
            id: parentGoalId + index + 1,
            name: step.title,
            duration: step.time,
            energy: energy,
            category: inferCategory(step.title, energy),
            due: dueToday ? getTodayISO() : toLocalISO(new Date(Date.now() + (index - 1) * 86400000)),
            completed: false,
            parentGoalId: parentGoalId,
            parentGoalName: parentGoalName
        };
        tasks.push(newTask);
    });
    
    saveState();
    todayFocusTaskId = parentGoalId + 1;
    showToast('已加入任務！今日可連續執行前兩步', 'success');
    showSection('dashboard');
    refreshUI({ dashboard: true, scheduler: true, filters: true, schedule: true });
    setTimeout(() => pulseNextStepCard(), 300);
}

// Task management for scheduler
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
        completed: false
    };
    
    tasks.push(newTask);
    saveState();
    
    // Clear inputs
    document.getElementById('task-name').value = '';
    
    refreshUI({ scheduler: true, filters: true, schedule: true });
    showToast('任務已加入清單', 'success');
}

function renderTaskList() {
    const container = document.getElementById('task-list');
    if (!container) return;
    container.innerHTML = '';
    
    const filtered = getFilteredTasks(tasks);
    const totalLabel = activeCategoryFilter === 'all'
        ? `(${tasks.length} 項)`
        : `(${filtered.length}/${tasks.length} 項)`;
    setElText('task-count', totalLabel);
    
    if (tasks.length === 0) {
        container.innerHTML = `<div class="text-center py-8 text-sm text-slate-400">目前沒有任務<br><span class="text-xs">在上方新增任務開始規劃</span></div>`;
        return;
    }
    
    if (filtered.length === 0) {
        container.innerHTML = `<div class="text-center py-8 text-sm text-slate-400">此分類沒有任務<br><span class="text-xs">試試其他篩選條件</span></div>`;
        return;
    }
    
    container.innerHTML = filtered.map(t => renderPersonalTaskRow(t, 'scheduler')).join('');
}

function getEnergyColor(energy) {
    if (energy >= 5) return 'bg-red-500/10 text-red-400';
    if (energy >= 4) return 'bg-orange-500/10 text-orange-400';
    if (energy >= 3) return 'bg-amber-500/10 text-amber-400';
    return 'bg-slate-500/10 text-slate-300';
}

function toggleTaskComplete(taskId, checkbox, fromDashboard = false, fromFocus = false) {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    
    task.completed = checkbox.checked;
    saveState();
    
    let advancedToday = false;
    if (task.completed) {
        if (fromDashboard || task.due <= getTodayISO()) {
            onTodayTaskCompleted(task.id, fromFocus || focusSession?.taskId === task.id);
            advancedToday = true;
        }
        if (!advancedToday) showToast('太棒了！任務完成', 'success');
        evaluateStreakOnComplete();
        checkParentGoalComplete(task);
        
        const stats = getTodayStats();
        if (stats.relevant.length > 0 && stats.relevant.every(t => t.completed)) {
            if (userProfile.enableConfetti !== false) triggerConfetti();
        } else if (userProfile.enableConfetti !== false && Math.random() > 0.6) {
            triggerConfetti();
        }
    } else if (fromDashboard) {
        todayFocusTaskId = task.id;
    }
    
    refreshUI({
        dashboard: true,
        scheduler: !fromDashboard,
        filters: true,
        schedule: true
    });
}

function splitTask(taskId) {
    const task = tasks.find(t => t.id === taskId);
    if (!task || task.duration < 30) {
        showToast('任務太短，無需拆分', 'error');
        return;
    }
    
    const half = Math.ceil(task.duration / 2);
    const part2Duration = task.duration - half;
    const baseName = task.name.replace(/ \(Part \d\)$/, '');
    
    tasks = tasks.filter(t => t.id !== taskId);
    tasks.push(
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
    
    tasks = tasks.filter(t => t.id !== taskId);
    saveState();
    refreshUI({ scheduler: true, filters: true, schedule: true });
}

function clearAllTasks() {
    if (!confirm('確定清空所有任務？')) return;
    tasks = [];
    saveState();
    refreshUI({ scheduler: true, filters: true });
    setElHtml('timeline-view', '<div class="text-center text-xs py-8 text-slate-400">清空後請新增任務並點擊「AI 重新優化排程」</div>');
    setElText('total-scheduled-time', '0h 0m');
}

function buildTimeBlocks() {
    const peak = userProfile.peakStart || '09:00';
    const workEnd = userProfile.workEnd || '18:00';
    const peakEnd = userProfile.peakEnd || '12:30';
    
    return [
        { start: peak, end: addMinutes(peak, 90), label: "晨間深度工作", maxEnergy: 5, preferredCategories: ['deep'], capacity: 90 },
        { start: addMinutes(peak, 105), end: peakEnd, label: "上午專注時段", maxEnergy: 4, preferredCategories: ['deep', 'execution'], capacity: 90 },
        { start: "13:30", end: "15:00", label: "下午執行時段", maxEnergy: 3, preferredCategories: ['execution', 'meeting'], capacity: 90 },
        { start: "15:15", end: "16:45", label: "創意與協作", maxEnergy: 4, preferredCategories: ['meeting', 'execution', 'learning'], capacity: 90 },
        { start: "17:00", end: workEnd, label: "收尾與規劃", maxEnergy: 2, preferredCategories: ['admin', 'learning'], capacity: 60 }
    ];
}

function scoreTaskPriority(task) {
    const today = getTodayISO();
    const daysLeft = task.due <= today ? 0 : Math.ceil((new Date(task.due + 'T12:00:00') - new Date(today + 'T12:00:00')) / 86400000);
    
    let urgency = 3;
    if (daysLeft === 0) urgency = 10;
    else if (daysLeft === 1) urgency = 8;
    else if (daysLeft <= 3) urgency = 6;
    
    const priorityScore = (urgency * 2.5) + (task.energy * 1.4) + (task.duration > 60 ? 2 : 0);
    return { ...task, daysLeft, priorityScore };
}

function scoreTaskBlockFit(task, slot) {
    const block = slot.block;
    if (task.energy > block.maxEnergy) return -Infinity;
    if (slot.load + task.duration > block.capacity) return -Infinity;
    
    let fit = task.priorityScore;
    if (block.preferredCategories.includes(task.category)) fit += 22;
    if (task.category === 'deep' && block.maxEnergy >= 4) fit += 8;
    if (task.category === 'admin' && block.maxEnergy <= 2) fit += 10;
    fit -= (slot.load / block.capacity) * 12;
    return fit;
}

function assignTasksToBlocks(pendingTasks, blocks) {
    const pool = pendingTasks.map(scoreTaskPriority);
    pool.sort((a, b) => b.priorityScore - a.priorityScore);
    
    const slots = blocks.map(block => ({ block, tasks: [], load: 0 }));
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
    
    return { assigned: slots.filter(s => s.tasks.length > 0), remaining };
}

// Upgraded scheduling algorithm: category-aware best-fit + split suggestions
function optimizeSchedule(silent = false) {
    const container = document.getElementById('timeline-view');
    if (!container) return;
    container.innerHTML = '';
    
    const pendingTasks = tasks.filter(t => !t.completed);
    
    if (pendingTasks.length === 0) {
        container.innerHTML = `<div class="text-center py-6"><span class="text-emerald-400">🎉 今日所有任務已完成！</span><br><span class="text-xs text-slate-400">休息一下或規劃明天的目標吧</span></div>`;
        setElText('total-scheduled-time', '0h 0m');
        return;
    }
    
    const timeBlocks = buildTimeBlocks();
    const { assigned, remaining } = assignTasksToBlocks(pendingTasks, timeBlocks);
    let totalMinutes = 0;
    
    assigned.forEach(slot => {
        const slotDiv = document.createElement('div');
        slotDiv.className = `timeline-slot flex gap-x-4 p-4 rounded-3xl border border-slate-700 bg-slate-950`;
        
        const loadPct = Math.round((slot.load / slot.block.capacity) * 100);
        const tasksHTML = slot.tasks.map(t => `
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
        `).join('');
        
        slotDiv.innerHTML = `
            <div class="w-24 flex-shrink-0 pt-1">
                <div class="font-mono text-lg font-semibold text-indigo-300">${slot.block.start}</div>
                <div class="text-xs text-slate-500">— ${slot.block.end}</div>
                <div class="mt-3">
                    <div class="text-xs px-3 py-1 rounded-2xl bg-indigo-500/10 text-indigo-300 w-fit">${slot.block.label}</div>
                </div>
            </div>
            <div class="flex-1 min-w-0">
                <div class="mb-2 flex items-center justify-between">
                    <div class="text-xs text-slate-400">任務負載：${slot.load}/${slot.block.capacity} 分鐘 (${loadPct}%)</div>
                    <div class="text-xs px-2 py-px bg-emerald-500/10 text-emerald-300 rounded">${slot.tasks.length} 項任務</div>
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
        const remainingDiv = document.createElement('div');
        remainingDiv.className = `mt-4 p-4 border border-dashed border-amber-500/40 rounded-3xl text-xs bg-amber-500/5`;
        
        const itemsHTML = remaining.map(r => `
            <div class="flex items-center justify-between py-2 border-b border-slate-800 last:border-0">
                <div class="flex items-center gap-x-2 min-w-0">
                    <span class="text-slate-200 truncate">${escapeHtml(r.name)}</span>
                    <span class="cat-badge ${getCategoryColor(r.category)}">${getCategoryLabel(r.category)}</span>
                    <span class="text-slate-500 font-mono">${r.duration}m</span>
                </div>
                ${r.duration >= 45 ? `<button onclick="splitTask(${r.id})" class="text-indigo-400 hover:text-indigo-300 px-2 py-1 rounded-lg border border-indigo-500/30 flex-shrink-0 ml-2"><i class="fa-solid fa-scissors text-[10px]"></i> 拆分</button>` : ''}
            </div>
        `).join('');
        
        remainingDiv.innerHTML = `
            <div class="font-medium text-amber-300 mb-2 flex items-center gap-x-2">
                <i class="fa-solid fa-triangle-exclamation"></i>
                <span>${remaining.length} 項任務未能排入（能量/時段/容量不匹配）</span>
            </div>
            ${itemsHTML}
            <div class="text-[10px] text-slate-400 mt-2">💡 建議：點擊「拆分」將大任務切半，或調整分類/能量後重新優化</div>
        `;
        container.appendChild(remainingDiv);
    }
    
    setElText('total-scheduled-time', `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`);
    
    if (!silent) {
        const msg = remaining.length > 0
            ? `排程完成，${remaining.length} 項待處理`
            : 'AI 已根據分類與能量曲線優化排程';
        showToast(msg, remaining.length > 0 ? 'error' : 'success');
    }
}

// AI Coach — agent-style guided session
function getCoachWorkspace() {
    return document.getElementById('coach-workspace');
}

function renderCoachAgentThread(thinking) {
    const el = document.getElementById('coach-agent-thread');
    if (!el) return;
    const recent = coachAgentMessages.slice(-12);
    if (!recent.length && !thinking) {
        el.innerHTML = '<div class="coach-agent-thread-hint"><i class="fa-solid fa-bolt text-sky-500/60 text-2xl mb-3 block"></i>教練會在這裡回應你<br>帶你一步一步完成任務</div>';
        return;
    }
    const thinkingLabel = thinking === 'deepseek' ? 'DeepSeek 回覆中'
        : thinking === 'offline' ? '離線引導中'
        : thinking ? '教練思考中' : '';
    
    let html = '';
    recent.forEach((m, idx) => {
        const isLast = idx === recent.length - 1;
        let displayContent = m.content;
        const options = [];
        
        if (m.role === 'coach') {
            displayContent = m.content.replace(/\[選項:\s*([^\]]+)\]/g, (match, optText) => {
                options.push(optText.trim());
                return '';
            }).replace(/\n\s*\n/g, '\n').trim();
        }
        
        let sourcesHtml = '';
        if (m.sources && m.sources.length > 0) {
            sourcesHtml = `
                <div class="mt-3 pt-2.5 border-t border-slate-800/80 text-xs text-slate-500">
                    <div class="font-medium text-slate-400 mb-1.5 flex items-center gap-1.5">
                        <i class="fa-solid fa-list-check text-purple-400"></i>
                        <span>資料來源引用</span>
                    </div>
                    <div class="flex flex-wrap gap-2 mt-1">
                        ${m.sources.map(s => `
                            <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-400">
                                <span class="font-mono text-purple-400">[${s.ref_id}]</span>
                                ${s.kb_id ? `<span class="text-indigo-400/80">${escapeHtml(getRagKbLabel(s.kb_id))}</span>` : ''}
                                <span>${escapeHtml(s.filename)}</span>
                                <span class="text-[10px] text-slate-600">(${Math.round(s.score * 100)}%)</span>
                            </span>
                        `).join('')}
                    </div>
                </div>
            `;
        }

        html += `
            <div class="coach-agent-msg coach-agent-msg-${m.role}">
                ${m.role === 'coach' ? '<i class="fa-solid fa-bolt text-sky-400"></i>' : ''}
                <div class="flex-1 min-w-0">
                    <span>${escapeHtml(displayContent)}</span>
                    ${sourcesHtml}
                    ${(isLast && options.length > 0 && !thinking) ? `
                        <div class="coach-agent-options flex flex-wrap gap-2 mt-3">
                            ${options.map(opt => `
                                <button type="button" onclick="sendCoachAgentMessage(this.dataset.msg)" data-msg="${escapeHtml(opt)}" class="coach-agent-option-btn">${escapeHtml(opt)}</button>
                            `).join('')}
                        </div>
                    ` : ''}
                </div>
            </div>`;
    });
    
    if (thinkingLabel) {
        html += `<div class="coach-agent-thinking"><span class="thinking-dots">${thinkingLabel}</span></div>`;
    }
    
    el.innerHTML = html;
    el.scrollTop = el.scrollHeight;
}

function renderCoachEmptyState(container) {
    container.innerHTML = `
        <div class="coach-empty-state">
            <div class="coach-empty-icon"><i class="fa-solid fa-route"></i></div>
            <div class="coach-empty-title">尚無今日待辦</div>
            <div class="coach-empty-desc">分解一個大目標後，教練會帶你從第一步開始做</div>
            <button type="button" onclick="openDecomposeTab()" class="coach-empty-btn"><i class="fa-solid fa-magic mr-1"></i> 分解目標</button>
        </div>`;
}

function renderCoachAgentView() {
    const ws = getCoachWorkspace();
    if (!ws) return;
    const task = getCoachTask();
    
    if (!task) {
        renderCoachEmptyState(ws);
        renderCoachAgentThread();
        return;
    }
    
    const session = focusSession?.taskId === task.id ? focusSession : null;
    const steps = session?.steps || getStepsForTask(task);
    const isActive = !!session?.coachActive;
    const cur = isActive ? Math.min(session.currentStep || 0, steps.length - 1) : 0;
    const current = steps[cur];
    const isLast = cur >= steps.length - 1;
    
    if (!isActive) {
        ws.innerHTML = `
            <div class="coach-agent-ready">
                <div class="coach-agent-task-badge">${escapeHtml(task.name)}</div>
                <div class="coach-agent-ready-meta">${task.duration} 分鐘 · ${steps.length} 步驟</div>
                <p class="coach-agent-ready-desc">教練會一步一步帶你做完，不用自己規劃或填表。</p>
                <button type="button" onclick="coachBeginGuidedSession()" class="coach-agent-start-btn">
                    <i class="fa-solid fa-play"></i> 教練帶我做
                </button>
                <div class="coach-agent-preview">
                    ${steps.map((s, i) => `<span class="coach-agent-preview-step">${i + 1}. ${escapeHtml(s.title)}</span>`).join('')}
                </div>
            </div>`;
    } else {
        ws.innerHTML = `
            <div class="coach-agent-session">
                <div class="coach-agent-session-header">
                    <span class="coach-agent-live"><i class="fa-solid fa-circle text-[6px]"></i> 教練帶做中</span>
                    <span id="focus-timer-display" class="coach-agent-timer">--:--</span>
                    <span class="coach-agent-progress">步驟 ${cur + 1} / ${steps.length}</span>
                </div>
                <div class="coach-agent-hero">
                    <div class="coach-agent-hero-label">現在就做</div>
                    <div class="coach-agent-hero-title">${escapeHtml(current.title)}</div>
                    <div class="coach-agent-hero-action">${escapeHtml(current.action)}</div>
                </div>
                <div class="coach-agent-steps-rail">
                    ${steps.map((s, i) => {
                        const cls = i < cur ? 'done' : i === cur ? 'active' : '';
                        return `<div class="coach-agent-rail-step ${cls}"><span>${i + 1}</span><span class="truncate">${escapeHtml(s.title)}</span></div>`;
                    }).join('')}
                </div>
                <div class="coach-agent-actions">
                    <button type="button" onclick="${isLast ? 'coachCompleteTaskFromAgent()' : 'coachAdvanceStepFromAgent()'}" class="coach-agent-btn-primary">
                        <i class="fa-solid fa-${isLast ? 'check' : 'forward-step'} mr-1"></i>${isLast ? '完成這件' : '完成這步'}
                    </button>
                    <button type="button" onclick="sendCoachAgentMessage('卡住了')" class="coach-agent-btn-secondary">卡住了</button>
                    <button type="button" onclick="coachPauseSession()" class="coach-agent-btn-ghost">暫停</button>
                </div>
            </div>`;
        tickFocusTimer();
    }
    renderCoachAgentThread();
}

function coachStartFocusNow() {
    showSection('coach');
    setTimeout(() => coachBeginGuidedSession(), 80);
}

function refreshCoachView() {
    if (coachRequestInFlight) return;
    updateCoachContextBar();
    renderCoachAgentView();
}

function askCoach(question) {
    const input = document.getElementById('chat-input');
    if (!input) return;
    input.value = question;
    sendCoachAgentMessage();
}

async function sendCoachAgentMessage(preset) {
    const input = document.getElementById('chat-input');
    const msg = typeof preset === 'string' ? preset : (input?.value?.trim() || '');
    if (!msg) return;
    if (coachRequestInFlight) {
        showToast('教練還在回覆中，請稍候', 'error');
        return;
    }
    if (input && typeof preset !== 'string') input.value = '';
    
    const task = getCoachTask();
    if (!task) {
        showToast('尚無待辦任務', 'error');
        return;
    }
    
    if (!focusSession?.coachActive) {
        ensureCoachSessionForTask(task);
        focusSession.coachActive = true;
        focusSession.startedAt = Date.now();
        if (!coachAgentMessages.length) {
            pushCoachAgentMessage('coach', getOpeningCoachMessage(task, focusSession.steps));
        }
        startStepTimerForCoach(focusSession);
        document.getElementById('next-step-card')?.classList.add('focus-session-active');
        renderCoachAgentView();
    }
    
    if (/^完成這步$|^做完了$|^好了$/.test(msg)) {
        const isLast = focusSession.currentStep >= focusSession.steps.length - 1;
        if (isLast) coachCompleteTaskFromAgent();
        else coachAdvanceStepFromAgent();
        return;
    }
    
    pushCoachAgentMessage('user', msg);
    renderCoachAgentThread(isApiReady() ? 'deepseek' : 'offline');
    coachRequestInFlight = true;
    
    let result;
    try {
        if (isApiReady()) {
            result = await coachAgentRespondWithAI(msg, task, focusSession);
        } else {
            result = buildOfflineAgentReply(msg, task, focusSession);
        }
    } catch (err) {
        console.warn('[Lumina Coach] AI 請求失敗，改用離線引導:', err.message);
        result = buildOfflineAgentReply(msg, task, focusSession);
    } finally {
        coachRequestInFlight = false;
    }
    
    pushCoachAgentMessage('coach', result.reply, result.sources);
    if (result.complete) {
        coachCompleteTaskFromAgent();
    } else if (result.advance) {
        coachAdvanceStepFromAgent();
    } else {
        renderCoachAgentView();
    }
}

function sendChatMessage() { sendCoachAgentMessage(); }

function getCoachContext() {
    const stats = getTodayStats();
    const todayPending = stats.pending;
    const overdue = todayPending.filter(t => t.due < getTodayISO());
    const scoreCtx = getScoringContext();
    const nextTask = todayPending.length
        ? (resolveTodayFocusTask() || rankTasksByNextStepScore(todayPending, scoreCtx)[0])
        : getNextRecommendedTask('all');
    const activeGoals = [...new Set(
        tasks.filter(t => t.parentGoalName && !t.completed).map(t => t.parentGoalName)
    )].slice(0, 3);
    return {
        pendingCount: todayPending.length,
        totalPending: tasks.filter(t => !t.completed).length,
        overdueCount: overdue.length,
        completionRate: stats.rate,
        nextTask,
        activeGoals,
        peakWindow: `${userProfile.peakStart || '09:00'}-${userProfile.peakEnd || '12:30'}`
    };
}

function buildCoachContextText(ctx) {
    ctx = ctx || getCoachContext();
    const next = ctx.nextTask;
    const pendingList = tasks.filter(t => !t.completed && t.due <= getTodayISO()).slice(0, 5)
        .map(t => `- ${t.name}（${t.duration}分鐘・${getCategoryLabel(resolveCategory(t))}）`).join('\n');
    
    let text = `用戶：${userProfile.name}（${userProfile.role}）
今日完成率：${ctx.completionRate}%｜連續高效 ${userProfile.streak} 天｜高效時段 ${ctx.peakWindow}
今日待辦 ${ctx.pendingCount} 項${ctx.overdueCount > 0 ? `（${ctx.overdueCount} 項逾期）` : ''}：
${pendingList || '（今日無待辦）'}
${next ? `系統推薦的今日第一步：「${next.name}」（${next.duration} 分鐘）` : '尚無推薦任務，建議先分解一個大目標'}
${ctx.activeGoals.length ? `進行中的大目標：${ctx.activeGoals.join('、')}` : ''}`;

    if (enterpriseSession && enterpriseGroupData && enterpriseGroupData.documents && enterpriseGroupData.documents.length > 0) {
        const docs = enterpriseGroupData.documents.slice(0, 10);
        const docText = docs.map(d => `--- 文件名稱：${d.title} ---\n${d.content}`).join('\n\n');
        text += `\n\n=== 團隊共享知識庫與新人資料 ===\n${docText}\n=================================\n注意：在回答時，若用戶的問題涉及此專案、流程或工作指南，請務必遵循並優先引用上方「團隊共享知識庫」的內容來進行回覆。`;
    }
    
    return text;
}

function updateCoachContextBar() {
    const bar = document.getElementById('coach-context-bar');
    if (!bar) return;
    const ctx = getCoachContext();
    const chips = [
        `今日 ${ctx.completionRate}%`,
        `待辦 ${ctx.pendingCount} 項`,
        ctx.nextTask ? `下一步：${ctx.nextTask.name.slice(0, 18)}${ctx.nextTask.name.length > 18 ? '…' : ''}` : '尚無任務'
    ];
    bar.innerHTML = chips.map(c => `<span class="coach-context-chip">${escapeHtml(c)}</span>`).join('');
}

function renderCoachQuickActions() {
    const container = document.getElementById('coach-quick-actions');
    if (!container) return;
    const ctx = getCoachContext();
    const actions = [];
    if (ctx.nextTask) {
        if (!focusSession?.coachActive) {
            actions.push({ label: '教練帶我做', fn: 'coachBeginGuidedSession()' });
        }
        actions.push({ label: '卡住了', fn: "sendCoachAgentMessage('卡住了')" });
        actions.push({ label: '完成這步', fn: "sendCoachAgentMessage('完成這步')" });
        actions.push({ label: '換簡單點', fn: "sendCoachAgentMessage('太難了，換簡單一點')" });
    } else {
        actions.push({ label: '分解目標', fn: 'openDecomposeTab()' });
    }
    container.innerHTML = actions.map(a =>
        `<button type="button" onclick="${a.fn}" class="coach-quick-btn">${escapeHtml(a.label)}</button>`
    ).join('');
}

function openCoachForNextTask() {
    const next = resolveTodayFocusTask() || getNextRecommendedTask('today');
    if (!next) {
        showToast('尚無待辦，先分解一個大目標吧', 'error');
        openDecomposeTab();
        return;
    }
    openCoachForTask(next.id);
}

function getTimeDistribution() {
    const cats = { deep: 0, execution: 0, meeting: 0, learning: 0, admin: 0 };
    tasks.forEach(t => {
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

function loadChartJs() {
    if (typeof Chart !== 'undefined') return Promise.resolve();
    if (chartJsLoadPromise) return chartJsLoadPromise;
    chartJsLoadPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = CHART_JS_URL;
        script.onload = resolve;
        script.onerror = () => reject(new Error('Chart.js 載入失敗'));
        document.head.appendChild(script);
    });
    return chartJsLoadPromise;
}

async function refreshInsightsPage() {
    updateInsightsCards();
    try {
        await loadChartJs();
        requestAnimationFrame(() => initCharts());
    } catch (_) {
        $('weekly-chart-fallback')?.classList.remove('hidden');
    }
}

function updateInsightsCards() {
    const dist = getTimeDistribution();
    const avgScore = Math.round(weeklyScores.reduce((a, b) => a + b, 0) / weeklyScores.length);
    const prevAvg = Math.round(weeklyScores.slice(0, 6).reduce((a, b) => a + b, 0) / 6);
    const growth = prevAvg > 0 ? Math.round(((avgScore - prevAvg) / prevAvg) * 100) : 0;
    
    const peakEl = document.getElementById('insight-peak-time');
    const improveEl = document.getElementById('insight-improve-area');
    const growthEl = document.getElementById('insight-growth-pct');
    
    if (peakEl) {
        peakEl.innerText = `${userProfile.peakStart || '09:00'} - ${userProfile.peakEnd || '12:30'}`;
        setElText('insight-peak-desc',
            `深度工作佔比 ${dist.deep}%，${dist.deep > 35 ? '節奏良好' : '建議增加上午深度時段'}`);
    }
    if (improveEl) {
        const deepPending = tasks.filter(t => !t.completed && resolveCategory(t) === 'deep').length;
        const meetingMins = tasks.filter(t => t.category === 'meeting').reduce((s, t) => s + t.duration, 0);
        
        if (deepPending > 2) {
            improveEl.innerText = '深度工作任務堆積';
            setElText('insight-improve-desc',
                `有 ${deepPending} 項深度任務待處理，建議排在 ${userProfile.peakStart}-${userProfile.peakEnd}`);
        } else if (dist.meeting > 25) {
            improveEl.innerText = '會議時間佔比偏高';
            setElText('insight-improve-desc',
                `會議溝通佔 ${dist.meeting}%，建議合併或縮短非必要會議`);
        } else if (dist.admin > 20) {
            improveEl.innerText = '行政雜務佔比過高';
            setElText('insight-improve-desc',
                `行政事務佔 ${dist.admin}%，可批次處理或委派`);
        } else {
            improveEl.innerText = '整體節奏良好';
            setElText('insight-improve-desc', '繼續保持上午深度、下午執行的節奏');
        }
    }
    if (growthEl) {
        growthEl.innerText = `${growth >= 0 ? '+' : ''}${growth}%`;
        setElText('insight-growth-desc', `你已連續 ${userProfile.streak} 天保持高效節奏！`);
    }
}

function initCharts() {
    const weeklyFallback = document.getElementById('weekly-chart-fallback');
    const pieFallback = document.getElementById('pie-chart-fallback');
    const weekAvgEl = document.getElementById('insight-week-avg');
    
    if (typeof Chart === 'undefined') {
        weeklyFallback?.classList.remove('hidden');
        return;
    }
    
    const weeklyCanvas = document.getElementById('weekly-chart');
    const pieCanvas = document.getElementById('time-pie-chart');
    if (!weeklyCanvas || !pieCanvas) return;
    
    weeklyFallback?.classList.add('hidden');
    pieFallback?.classList.add('hidden');
    
    const weekAvg = Math.round(weeklyScores.reduce((a, b) => a + b, 0) / weeklyScores.length);
    if (weekAvgEl) weekAvgEl.innerText = weekAvg;
    
    try {
        if (weeklyChartInstance) {
            weeklyChartInstance.data.datasets[0].data = weeklyScores;
            weeklyChartInstance.update('none');
        } else {
        weeklyChartInstance = new Chart(weeklyCanvas.getContext('2d'), {
            type: 'bar',
            data: {
                labels: ['週一', '週二', '週三', '週四', '週五', '週六', '週日'],
                datasets: [{
                    label: '生產力分數',
                    data: weeklyScores,
                    backgroundColor: '#6366f1',
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
                        grid: { color: '#334155' },
                        ticks: { color: '#64748b', stepSize: 20 }
                    },
                    x: {
                        grid: { display: false },
                        ticks: { color: '#64748b' }
                    }
                }
            }
        });
        }
    } catch (err) {
        console.error('[Lumina] weekly chart error:', err);
        weeklyFallback?.classList.remove('hidden');
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
        pieFallback?.classList.remove('hidden');
        return;
    }
    
    try {
        if (pieChartInstance) {
            pieChartInstance.data.datasets[0].data = pieData;
            pieChartInstance.update('none');
        } else {
        pieChartInstance = new Chart(pieCanvas.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: ['深度工作', '執行協作', '會議溝通', '學習成長', '行政雜務'],
                datasets: [{
                    data: pieData,
                    backgroundColor: ['#6366f1', '#a855f7', '#ec4899', '#f59e0b', '#64748b'],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '68%',
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { color: '#94a3b8', padding: 12, font: { size: 11 }, boxWidth: 12 }
                    },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => {
                                const mins = ctx.raw;
                                const pct = dist.totalMins > 0 ? Math.round((mins / dist.totalMins) * 100) : 0;
                                return ` ${ctx.label}: ${mins} 分鐘 (${pct}%)`;
                            }
                        }
                    }
                }
            }
        });
        }
    } catch (err) {
        console.error('[Lumina] pie chart error:', err);
        pieFallback?.classList.remove('hidden');
    }
}

function recalculateInsights() {
    showToast('正在重新計算本週洞察...', 'success');
    
    recordDailySnapshot();
    recalculateWeeklyScores();
    localStorage.setItem('lumina_weekly', JSON.stringify(weeklyScores));
    
    const avgScore = Math.round(weeklyScores.reduce((a, b) => a + b, 0) / weeklyScores.length);
    const daysWithData = weeklyScores.filter(s => s > 0).length;
    
    setTimeout(() => {
        if (document.getElementById('insights').classList.contains('active')) {
            refreshInsightsPage();
        } else {
            updateInsightsCards();
        }
        refreshUI({ dashboard: true, filters: true });
        const msg = daysWithData > 0
            ? `洞察已更新！本週平均完成率 ${avgScore}%`
            : '洞察已更新！完成更多任務後數據會更準確';
        showToast(msg, 'success');
    }, 400);
}

function quickStartToday() {
    if (tasks.length === 0) {
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
    todayFocusTaskId = next.id;
    startTodayTask(next.id);
}

// Confetti for celebrations
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
function showToast(message, type = 'success') {
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
    const closeBtn = document.createElement('button');
    closeBtn.className = 'opacity-70 hover:opacity-100 text-lg leading-none';
    closeBtn.setAttribute('aria-label', '關閉');
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => toast.remove());
    
    toast.append(iconEl, textEl, closeBtn);
    container.appendChild(toast);
    setTimeout(() => { if (toast.parentElement) toast.remove(); }, 3200);
}

// Reset everything
function resetAllData() {
    if (!confirm('確定要重置所有資料嗎？這會清除任務與統計（API Key 與基本設定會保留）。')) return;
    
    clearSensitiveLocalData();
    location.reload();
}

// Keyboard shortcuts hint
function setupKeyboardShortcuts() {
    const NAV_KEYS = { '1': 'dashboard', '2': 'scheduler', '3': 'coach', '4': 'insights' };
    
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            if (!document.getElementById('task-edit-modal')?.classList.contains('hidden')) {
                closeTaskEdit();
                return;
            }
            if (!document.getElementById('auth-overlay')?.classList.contains('hidden') && !needsAuthGate()) {
                hideAuthOverlay();
                return;
            }
            if (!document.getElementById('onboarding-overlay')?.classList.contains('hidden')) {
                skipOnboarding();
                return;
            }
            closeNavMore();
            closeMobileMore();
            return;
        }
        
        if ((e.metaKey || e.ctrlKey) && e.key === '/') {
            e.preventDefault();
            const dashboard = document.getElementById('dashboard');
            if (dashboard.classList.contains('active')) {
                document.getElementById('quick-task-input').focus();
            } else {
                showSection('dashboard');
                setTimeout(() => document.getElementById('quick-task-input').focus(), 300);
            }
        }
        
        if (e.key === '?' && document.activeElement.tagName === 'BODY') {
            e.preventDefault();
            showSection('coach');
        }
        
        if (!e.metaKey && !e.ctrlKey && !e.altKey && NAV_KEYS[e.key] && document.activeElement.tagName === 'BODY') {
            showSection(NAV_KEYS[e.key]);
        }
    });
    
    console.log('%c[Lumina AI] 快捷鍵：1-4 切換頁面，Cmd/Ctrl+/ 新增任務，? 開啟 AI 教練，Esc 關閉', 'color:#64748b');
}

// Initialize everything
async function initializeApp() {
    if (typeof pdfjsLib !== 'undefined') {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
    try { initializeTailwind(); } catch (e) { console.warn('[Lumina] Tailwind init skipped', e); }
    try { setupManifest(); } catch (e) { console.warn('[Lumina] Manifest setup skipped', e); }
    try { registerServiceWorker(); } catch (e) { console.warn('[Lumina] Service worker skipped', e); }
    try { setupPwaInstall(); } catch (e) { console.warn('[Lumina] PWA install skipped', e); }
    try { setupOfflineDetection(); } catch (e) { console.warn('[Lumina] Offline detection skipped', e); }
    
    loadState();
    await checkAuthOnInit();
    applyTeamInviteFromUrl();
    
    if (enterpriseSession) {
        updateNotificationUI();
        startEnterprisePolling();
        refreshTeamNotifications();
    }
    
    try {
        refreshUI({ dashboard: true, scheduler: true, filters: true });
    } catch (e) {
        console.error('[Lumina] Dashboard init failed', e);
        showToast('部分介面載入失敗，請重新整理頁面', 'error');
    }
    
    const navDashboard = document.getElementById('nav-dashboard');
    if (navDashboard) navDashboard.classList.add('active', 'text-indigo-400');
    
    // Random nice touch: sometimes show streak increase hint
    setTimeout(() => {
        const streakEl = document.getElementById('streak');
        if (streakEl && Math.random() > 0.7) {
            streakEl.style.transitionDuration = '400ms';
        }
    }, 1200);
    
    if (rolledCountOnInit > 0) {
        showToast(`${rolledCountOnInit} 項延後任務已移至今日`, 'success');
    }
    
    setTimeout(() => {
        if (document.getElementById('auth-overlay')?.classList.contains('hidden') &&
            !localStorage.getItem('lumina_onboarding_v2') && tasks.length === 0) {
            startOnboarding();
        } else if (!document.getElementById('auth-overlay')?.classList.contains('hidden')) {
            /* wait for auth */
        } else if (!localStorage.getItem('lumina_welcomed')) {
            showToast('歡迎使用 Lumina AI！', 'success');
            localStorage.setItem('lumina_welcomed', 'true');
        }
    }, 900);
    
    setupKeyboardShortcuts();
    
    document.addEventListener('click', (e) => {
        const wrap = document.getElementById('nav-more-wrap');
        if (wrap && !wrap.contains(e.target)) closeNavMore();
        const notifWrap = document.getElementById('notif-wrap');
        if (notifPanelOpen && notifWrap && !notifWrap.contains(e.target)) closeNotificationPanel();
    });
    
    // Make sure initial timeline hint
    console.log('%c[Lumina AI] 已成功初始化。使用者可立即使用所有功能。', 'color:#475569');
    
    // RAG Health Checking and helper bindings
    window.checkRagServiceHealth = async () => {
        if (!enterpriseSession) {
            document.getElementById('rag-kb-selector-wrap')?.classList.add('hidden');
            return;
        }
        try {
            const res = await fetch(`${RAG_SERVICE_URL}/health`);
            if (res.ok) {
                const data = await res.json();
                if (data.service === 'lumina-rag-service') {
                    ragRetrievalMode = data.retrieval || ragRetrievalMode;
                    if (!ragServiceActive) {
                        ragServiceActive = true;
                        console.log(`[Lumina RAG] 已連線 — 檢索模式：${data.retrieval || 'hybrid'}，Embedding：${data.embedding || 'local'}`);
                        document.getElementById('rag-kb-selector-wrap')?.classList.remove('hidden');
                        await ensureEnterpriseDocsInRag({ toast: true, force: true });
                    }
                    await window.renderRagKbCheckboxes();
                    return;
                }
            }
        } catch (_) {}
        
        if (ragServiceActive) {
            ragServiceActive = false;
            console.log('[Lumina RAG] RAG 服務中斷，自動切回本地離線/純文字模式。');
            document.getElementById('rag-kb-selector-wrap')?.classList.add('hidden');
        }
    };

    window.renderRagKbCheckboxes = async () => {
        const container = document.getElementById('rag-kb-checkboxes');
        if (!container || !enterpriseSession) return;

        let kbIds = await fetchRagKbIds(enterpriseSession.groupCode).catch(() => null);
        if (!kbIds || !kbIds.length) {
            kbIds = Object.keys(RAG_KB_LABELS);
        }

        const available = new Set(kbIds);
        const kbs = [...available].map(id => ({ id, label: getRagKbLabel(id) }));
        checkedRagKbs = checkedRagKbs.filter(id => available.has(id));
        if (!checkedRagKbs.length) checkedRagKbs = [kbs[0]?.id || 'general'];

        container.innerHTML = kbs.map(kb => {
            const checked = checkedRagKbs.includes(kb.id) ? 'checked' : '';
            return `
                <label class="inline-flex items-center gap-1.5 cursor-pointer bg-slate-900 border border-slate-800 hover:border-slate-700/80 px-2 py-1 rounded-lg text-[10px] text-slate-300">
                    <input type="checkbox" name="rag-kb" value="${kb.id}" ${checked} onchange="window.onRagKbCheckboxChange()" class="accent-purple-500 w-3 h-3">
                    <span>${escapeHtml(kb.label)}</span>
                </label>
            `;
        }).join('');
    };

    window.onRagKbCheckboxChange = () => {
        const checkboxes = document.querySelectorAll('input[name="rag-kb"]:checked');
        checkedRagKbs = Array.from(checkboxes).map(cb => cb.value);
    };

    window.checkRagServiceHealth();
    setInterval(window.checkRagServiceHealth, 10000);

    // Bonus: pre-generate one nice decomposition if user goes there
    window.pregenerateExample = () => {
        document.getElementById('goal-input').value = "完成 Q3 產品路線圖並獲得團隊共識";
        decomposeGoal();
    };
}

// Boot the app
window.onload = initializeApp;

// Easter egg: type "lumina" in console for fun
window.lumina = () => triggerConfetti();
