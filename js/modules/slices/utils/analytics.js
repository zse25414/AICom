/* Lumina: utils/analytics.js — Phase 0 local product analytics */
const ANALYTICS_KEY = 'lumina_analytics_v1';
const ANALYTICS_MAX = 200;

const MAIN_PATH_KEYS = {
    created: 'lumina_mp_created',
    coach: 'lumina_mp_coach',
    completed: 'lumina_mp_completed'
};

function _analyticsNow() {
    return new Date().toISOString();
}

function _readAnalyticsBuffer() {
    try {
        const raw = localStorage.getItem(ANALYTICS_KEY);
        const arr = raw ? JSON.parse(raw) : [];
        return Array.isArray(arr) ? arr : [];
    } catch (_) {
        return [];
    }
}

function _writeAnalyticsBuffer(arr) {
    try {
        localStorage.setItem(ANALYTICS_KEY, JSON.stringify(arr.slice(-ANALYTICS_MAX)));
    } catch (_) { /* quota / private mode */ }
}

/**
 * Product analytics (local buffer). Safe no-op outside browser.
 * @param {string} name
 * @param {Record<string, unknown>} [props]
 */
function track(name, props = {}) {
    const eventName = String(name || '').trim();
    if (!eventName) return;

    const entry = {
        name: eventName,
        props: props && typeof props === 'object' ? props : {},
        ts: _analyticsNow()
    };

    try {
        if (typeof console !== 'undefined' && console.debug) {
            console.debug('[Lumina track]', entry.name, entry.props);
        }
    } catch (_) {}

    if (typeof localStorage === 'undefined') return;

    const buf = _readAnalyticsBuffer();
    buf.push(entry);
    _writeAnalyticsBuffer(buf);

    try {
        _updateMainPathFlags(eventName);
    } catch (_) {}
}

function _updateMainPathFlags(eventName) {
    if (typeof sessionStorage === 'undefined') return;
    if (eventName === 'task_created' || eventName === 'demo_seeded') {
        sessionStorage.setItem(MAIN_PATH_KEYS.created, '1');
    }
    if (eventName === 'coach_start') {
        sessionStorage.setItem(MAIN_PATH_KEYS.coach, '1');
    }
    if (eventName === 'task_completed') {
        sessionStorage.setItem(MAIN_PATH_KEYS.completed, '1');
        if (
            sessionStorage.getItem(MAIN_PATH_KEYS.created) === '1' &&
            sessionStorage.getItem(MAIN_PATH_KEYS.coach) === '1'
        ) {
            // Fire once per browser session
            if (sessionStorage.getItem('lumina_mp_done') === '1') return;
            sessionStorage.setItem('lumina_mp_done', '1');
            const buf = _readAnalyticsBuffer();
            buf.push({
                name: 'main_path_complete',
                props: { session: true },
                ts: _analyticsNow()
            });
            _writeAnalyticsBuffer(buf);
            try {
                console.debug('[Lumina track]', 'main_path_complete', { session: true });
            } catch (_) {}
        }
    }
}

function getAnalyticsEvents(limit = 50) {
    const buf = _readAnalyticsBuffer();
    return buf.slice(-Math.max(1, limit));
}

function getAnalyticsSummary() {
    const buf = _readAnalyticsBuffer();
    const counts = {};
    for (const e of buf) {
        counts[e.name] = (counts[e.name] || 0) + 1;
    }
    return { total: buf.length, counts, last: buf[buf.length - 1] || null };
}

function clearAnalytics() {
    try {
        localStorage.removeItem(ANALYTICS_KEY);
    } catch (_) {}
}

if (typeof window !== 'undefined') {
    window.track = track;
    window.getAnalyticsSummary = getAnalyticsSummary;
    window.getAnalyticsEvents = getAnalyticsEvents;
}
