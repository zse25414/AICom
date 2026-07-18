/** Immutable configuration */
export const DAILY_HISTORY_KEY = 'lumina_daily_history';
export const TRACKED_FOCUS_KEY = 'lumina_tracked_focus';
export const AUTH_GUEST_DISMISSED_KEY = 'lumina_auth_guest_dismissed';
export const LAST_ACTIVE_DATE_KEY = 'lumina_last_active_date';
export const USER_DATA_SYNC_DELAY_MS = 800;
export const RAG_SERVICE_URL = "http://127.0.0.1:8000";
export const API_KEY_STORAGE = 'lumina_api_key';
/** When '1', API key is also kept in localStorage across browser restarts (opt-in). */
export const API_KEY_PERSIST_FLAG = 'lumina_api_key_persist';
export const ENTERPRISE_SYNC_RETRY_MS = 5000;
export const RAG_KB_LABELS = {
    general: '一般預設 (General)',
    onboarding: '新人培訓 (Onboarding)',
    specs: '開發規格 (Specs)',
    meetings: '會議 SOP (Meetings)'
};
export const PERSIST_STATE_DELAY_MS = 120;
export const AUTH_SESSION_KEY = 'lumina_auth_session';
export const AUTH_USERS_KEY = 'lumina_users';
export const LOCAL_ENTERPRISE_KEY = 'lumina_enterprise_local_store';
export const ENTERPRISE_SESSION_KEY = 'lumina_enterprise_session';
export const ENTERPRISE_MEMBERSHIPS_KEY = 'lumina_enterprise_memberships';
export const TEAM_NOTIF_PREFS_KEY = 'lumina_team_notif_prefs';
export const CHART_JS_URL = 'https://cdn.jsdelivr.net/npm/chart.js@3.9.1/dist/chart.min.js';
export const ENTERPRISE_FETCH_TTL_MS = 5000;
export const ENTERPRISE_POLL_INTERVAL_MS = 15000;
export const CATEGORIES = {
    deep:       { label: '深度工作', color: 'bg-indigo-500/10 text-indigo-400' },
    execution:  { label: '執行協作', color: 'bg-purple-500/10 text-purple-400' },
    meeting:    { label: '會議溝通', color: 'bg-pink-500/10 text-pink-400' },
    learning:   { label: '學習成長', color: 'bg-amber-500/10 text-amber-400' },
    admin:      { label: '行政雜務', color: 'bg-slate-500/10 text-slate-300' }
};
export const SANITIZE_ALLOWED_TAGS = new Set(['BR', 'STRONG', 'B', 'EM', 'I', 'P', 'UL', 'OL', 'LI']);
export const IMPORT_MAX_BYTES = 2 * 1024 * 1024;
export const TEXT_MAX_LEN = 500;
export const TASK_NAME_MAX_LEN = 200;
export const SAFE_FA_ICONS = new Set(['fa-plus', 'fa-brain', 'fa-comment-dots', 'fa-sun', 'fa-list-check', 'fa-circle']);
