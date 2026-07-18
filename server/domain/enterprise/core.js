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

    /**
     * Resolve group membership.
     * Prefer auth userId (cross-device truth); fall back to client memberId.
     * Stale memberIds from localStorage are auto-corrected when JWT matches a member.
     */
    async function assertEnterpriseMember(group, memberId, authUser, options = {}) {
        const { bind = true, store = null } = options;
        if (!group || !Array.isArray(group.members)) {
            return { ok: false, status: 403, error: '無效的成員或身份驗證失敗', code: 'GROUP_FORBIDDEN' };
        }

        const byId = memberId ? group.members.find(m => m.id === memberId) : null;
        const byUser = authUser?.id
            ? group.members.find(m => m.userId && m.userId === authUser.id)
            : null;

        // Authoritative: logged-in user already bound to a member row
        if (byUser) {
            return { ok: true, member: byUser, resolvedBy: 'userId' };
        }

        // Logged in, client sent a memberId that exists but is unbound → claim it
        if (authUser?.id && byId && !byId.userId) {
            if (bind) {
                byId.userId = authUser.id;
                if (store) await saveStore(store);
            }
            return { ok: true, member: byId, resolvedBy: 'memberId+bind' };
        }

        // Logged in, memberId exists but bound to someone else
        if (authUser?.id && byId && byId.userId && byId.userId !== authUser.id) {
            return {
                ok: false,
                status: 403,
                error: '此成員已綁定其他帳號，請用正確帳號登入或重新加入群組',
                code: 'MEMBER_BOUND_OTHER'
            };
        }

        // Logged in but not a member (stale local session / wrong group)
        if (authUser?.id && !byId) {
            return {
                ok: false,
                status: 403,
                error: '你不是此群組成員或本機成員資料已過期，請重新加入',
                code: 'NOT_A_MEMBER'
            };
        }

        // Production: require login for team APIs
        if (REQUIRE_ENTERPRISE_AUTH) {
            if (!authUser?.id) {
                return { ok: false, status: 401, error: '請先登入才能使用團隊功能', code: 'UNAUTHORIZED' };
            }
            return {
                ok: false,
                status: 403,
                error: '你不是此群組成員，請重新加入',
                code: 'NOT_A_MEMBER'
            };
        }

        // Dev anonymous: allow pure memberId without userId binding
        if (byId) {
            if (byId.userId && !authUser?.id) {
                return { ok: false, status: 401, error: '請先登入', code: 'UNAUTHORIZED' };
            }
            return { ok: true, member: byId, resolvedBy: 'memberId' };
        }

        if (!memberId) {
            return { ok: false, status: 403, error: '需要有效的 memberId', code: 'GROUP_FORBIDDEN' };
        }
        return { ok: false, status: 403, error: '無效的成員或身份驗證失敗', code: 'GROUP_FORBIDDEN' };
    }

    /**
     * List all groups where this userId is a member (for multi-group sync).
     */
    function listMembershipsForUser(store, userId) {
        if (!userId) return [];
        const out = [];
        for (const group of Object.values(store.groups || {})) {
            if (!group || !Array.isArray(group.members)) continue;
            const member = group.members.find(m => m.userId === userId);
            if (!member) continue;
            out.push({
                groupCode: group.code,
                groupName: group.name || group.code,
                memberId: member.id,
                name: member.name,
                role: member.role === 'manager' ? 'manager' : 'member',
                joinedAt: member.joinedAt || null
            });
        }
        // stable sort by code
        out.sort((a, b) => String(a.groupCode).localeCompare(String(b.groupCode)));
        return out;
    }

    /**
     * Kick: sole manager cannot be removed while others remain.
     * Leave: allow sole manager to leave — auto-promote another member.
     */
    function assertCanRemoveMember(group, member, { isKick = false } = {}) {
        if (!group || !member) {
            return { ok: false, status: 404, error: '找不到成員', code: 'MEMBER_NOT_FOUND' };
        }
        if (isKick && member.role === 'manager') {
            const managers = (group.members || []).filter(m => m.role === 'manager');
            const others = (group.members || []).filter(m => m.id !== member.id);
            if (managers.length <= 1 && others.length > 0) {
                return {
                    ok: false,
                    status: 409,
                    error: '無法移除唯一主管：請先指定其他主管',
                    code: 'LAST_MANAGER'
                };
            }
        }
        return { ok: true };
    }

    /**
     * If removing the sole manager while others remain, promote the next member.
     */
    function ensureManagerSuccessor(group, leavingMember) {
        if (!group || !leavingMember || leavingMember.role !== 'manager') {
            return { promoted: null };
        }
        const remainingManagers = (group.members || []).filter(
            (m) => m.role === 'manager' && m.id !== leavingMember.id
        );
        if (remainingManagers.length > 0) return { promoted: null };
        const successor = (group.members || []).find((m) => m.id !== leavingMember.id);
        if (!successor) return { promoted: null };
        successor.role = 'manager';
        return { promoted: successor };
    }

    /**
     * Remove member from group; returns { ok, groupEmpty, promoted }.
     */
    function removeMemberFromGroup(group, memberId) {
        if (!group || !Array.isArray(group.members)) {
            return { ok: false, removed: null, promoted: null };
        }
        const idx = group.members.findIndex(m => m.id === memberId);
        if (idx < 0) return { ok: false, removed: null, promoted: null };
        const leaving = group.members[idx];
        const { promoted } = ensureManagerSuccessor(group, leaving);
        const [removed] = group.members.splice(idx, 1);
        // Soft-cancel open tasks assigned to removed member
        if (Array.isArray(group.tasks)) {
            group.tasks = group.tasks.map((t) => {
                if (t.assigneeId === memberId && !t.completed) {
                    return {
                        ...t,
                        completed: false,
                        cancelled: true,
                        cancelledAt: new Date().toISOString(),
                        cancelReason: 'member_left'
                    };
                }
                return t;
            });
        }
        if (promoted) {
            pushNotification(group, {
                type: 'role_promoted',
                recipientId: promoted.id,
                title: '你已成為主管',
                message: `原主管已退出，你現在是群組「${group.name}」的主管`,
                actorId: removed.id,
                actorName: removed.name
            });
        }
        return { ok: true, removed, groupEmpty: group.members.length === 0, promoted };
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
        listMembershipsForUser,
        assertCanRemoveMember,
        ensureManagerSuccessor,
        removeMemberFromGroup,
        pushNotification,
        assertEnterpriseMember,
        assertRagGroupAccess
    });
}

module.exports = { register };
