/**
 * server/domain/enterprise/core
 * 任務：群組存取、通知、成員斷言
 * 透過 register(api) 掛載到共享 api 物件（跨域呼叫 api.fn）
 */
'use strict';


const config = require('../../config');
const {
    PORT, API_KEY, DEEPSEEK_URL, RAG_SERVICE_URL, RAG_API_KEY, IS_PRODUCTION, REQUIRE_ENTERPRISE_AUTH, ALLOW_ANONYMOUS_AI, DATA_FILE, PIN_SALT, MAX_BODY_BYTES, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX, AUTH_RATE_LIMIT_MAX, PIN_MAX_ATTEMPTS, PIN_LOCK_MS, AI_RATE_LIMIT_MAX, AI_RATE_LIMIT_WINDOW_MS, DEFAULT_LLM_API_BASE, ALLOWED_LLM_API_BASES, MAX_UPLOAD_BYTES, ALLOWED_UPLOAD_EXT, WEAK_PINS, UPLOADS_DIR, ALLOWED_ORIGINS, RAG_INDEX_TIMEOUT_MS, RAG_INDEX_MAX_ATTEMPTS, RAG_INDEX_EVENT_LIMIT, serviceStartedAt, enforceProductionSecrets
} = config;
const { loadStore, saveStore } = require('../../../lib/enterprise-store');

/** @param {Record<string, Function>} api */
function register(api) {
    async function prepareStore(store) {
        for (const group of Object.values(store.groups || {})) {
            await api.migrateGroupPin(group);
            ensureNotifications(group);
        }
        return store;
    }

    function getGroup(store, code) {
        const key = api.normalizeCode(code);
        return store.groups[key] || null;
    }

    function ensureNotifications(group) {
        if (!Array.isArray(group.notifications)) group.notifications = [];
    }

    function pushNotification(group, payload) {
        ensureNotifications(group);
        const note = {
            id: api.uid(),
            type: payload.type,
            recipientId: payload.recipientId,
            title: api.clampText(payload.title, 80) || '團隊通知',
            message: api.clampText(payload.message, 300),
            taskId: payload.taskId || null,
            taskTitle: api.clampText(payload.taskTitle, 120),
            actorId: payload.actorId || null,
            actorName: api.clampText(payload.actorName, 80),
            read: false,
            createdAt: new Date().toISOString()
        };
        group.notifications.unshift(note);
        if (group.notifications.length > 200) group.notifications.length = 200;
        return note;
    }

    async function assertEnterpriseMember(group, memberId, authUser, options = {}) {
        const { bind = true, store = null } = options;
        if (!group || !memberId) {
            return { ok: false, status: 403, error: '無效的成員或身份驗證失敗', code: 'GROUP_FORBIDDEN' };
        }
        const member = group.members.find(m => m.id === memberId);
        if (!member) {
            return { ok: false, status: 403, error: '無效的成員或身份驗證失敗', code: 'GROUP_FORBIDDEN' };
        }

        if (REQUIRE_ENTERPRISE_AUTH) {
            if (!authUser?.id) {
                return { ok: false, status: 401, error: '請先登入才能使用團隊功能', code: 'UNAUTHORIZED' };
            }
            if (member.userId && member.userId !== authUser.id) {
                return { ok: false, status: 403, error: '此成員已綁定其他帳號', code: 'GROUP_FORBIDDEN' };
            }
            if (!member.userId && bind) {
                member.userId = authUser.id;
                if (store) await saveStore(store);
            }
            return { ok: true, member };
        }

        if (member.userId) {
            if (!authUser?.id || authUser.id !== member.userId) {
                return { ok: false, status: 403, error: '無效的成員或身份驗證失敗', code: 'GROUP_FORBIDDEN' };
            }
        } else if (authUser?.id && bind) {
            member.userId = authUser.id;
            if (store) await saveStore(store);
        }
        return { ok: true, member };
    }

    async function assertRagGroupAccess(groupCode, authUser, options = {}) {
        const { requireManager = false } = options;
        const code = api.normalizeCode(groupCode);
        if (!code) return { ok: false, status: 400, error: '缺少 group_code', code: 'VALIDATION_ERROR' };

        const store = await prepareStore(await loadStore());
        const group = getGroup(store, code);
        if (!group) return { ok: false, status: 404, error: '找不到群組', code: 'GROUP_NOT_FOUND' };

        // Dev anonymous: allow read paths only; write still needs a bound manager when requireManager.
        if (ALLOW_ANONYMOUS_AI && !REQUIRE_ENTERPRISE_AUTH && !requireManager) {
            return { ok: true, group, member: null, store };
        }

        if (!authUser?.id) {
            return { ok: false, status: 401, error: '請先登入才能使用知識庫', code: 'UNAUTHORIZED' };
        }

        const member = group.members.find(m => m.userId === authUser.id);
        if (!member) {
            return { ok: false, status: 403, error: '你不是此群組成員', code: 'GROUP_FORBIDDEN' };
        }
        if (requireManager && member.role !== 'manager') {
            return { ok: false, status: 403, error: '僅主管可管理知識庫', code: 'ROLE_FORBIDDEN' };
        }
        return { ok: true, group, member, store };
    }

    Object.assign(api, {
        prepareStore,
        getGroup,
        ensureNotifications,
        pushNotification,
        assertEnterpriseMember,
        assertRagGroupAccess
    });
}

module.exports = { register };
