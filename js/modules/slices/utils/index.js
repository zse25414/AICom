/* Lumina: utils/index.js */
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
            if (!C.SANITIZE_ALLOWED_TAGS.has(node.tagName)) {
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

function openSafeUrl(url) {
    const href = String(url || '');
    if (isSafeHttpUrl(href) || href.startsWith('blob:')) window.open(href, '_blank', 'noopener,noreferrer');
}

function clampText(value, max = C.TEXT_MAX_LEN) {
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
    const validCategories = Object.keys(C.CATEGORIES);
    const category = validCategories.includes(raw.category) ? raw.category : undefined;
    const name = clampText(raw.name, C.TASK_NAME_MAX_LEN).trim();
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
    if (raw.parentGoalName) task.parentGoalName = clampText(raw.parentGoalName, C.TASK_NAME_MAX_LEN);
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
            throw new Error('S.weeklyScores 格式錯誤');
        }
    }
    if (data.dailyHistory !== undefined && !isPlainObject(data.dailyHistory)) {
        throw new Error('S.dailyHistory 格式錯誤');
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

function sanitizeFaIcon(icon) {
    const cleaned = String(icon || '').replace(/[^a-z0-9-]/gi, '');
    return C.SAFE_FA_ICONS.has(cleaned) ? cleaned : 'fa-circle';
}

function getEnergyLabel(energy) {
    if (energy >= 5) return '極高';
    if (energy >= 4) return '高';
    if (energy >= 3) return '中';
    return '低';
}

// Quick add from dashboard

function getEnergyColor(energy) {
    if (energy >= 5) return 'bg-red-500/10 text-red-400';
    if (energy >= 4) return 'bg-orange-500/10 text-orange-400';
    if (energy >= 3) return 'bg-amber-500/10 text-amber-400';
    return 'bg-slate-500/10 text-slate-300';
}
