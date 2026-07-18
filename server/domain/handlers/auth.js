/**
 * server/domain/handlers/auth
 * 任務：HTTP：/api/auth/*
 * 透過 register(api) 掛載到共享 api 物件（跨域呼叫 api.fn）
 */
'use strict';


const { findUserByEmail, findUserById, createUser, updateUser } = require('../../../lib/auth-store');
const { saveUserData, ensureUserData, defaultUserData } = require('../../../lib/user-data-store');
const { normalizeEmail, isValidEmail, clampText: clampAuthText, signToken, verifyToken, parseBearerToken, hashPassword, verifyPassword, sanitizeUser } = require('../../../lib/auth');

/** @param {Record<string, Function>} api */
function register(api) {
    async function handleAuth(req, res, urlPath, method) {
        if (!api.checkAuthRateLimit(req)) {
            return api.sendJson(res, 429, { error: '認證請求過於頻繁，請稍後再試' });
        }

        if (method === 'POST' && urlPath === '/api/auth/register') {
            const body = await api.readBody(req);
            const name = clampAuthText(body.name, 40);
            const email = normalizeEmail(body.email);
            const role = clampAuthText(body.role, 40) || '知識工作者';
            const password = String(body.password || '');

            if (!name) return api.sendJson(res, 400, { error: '請輸入顯示名稱' });
            if (!isValidEmail(email)) return api.sendJson(res, 400, { error: '請輸入有效的電子郵件' });
            if (password.length < 6) return api.sendJson(res, 400, { error: '密碼至少需要 6 個字元' });
            if (password.length > 64) return api.sendJson(res, 400, { error: '密碼過長' });

            const existing = await findUserByEmail(email);
            if (existing) return api.sendJson(res, 409, { error: '此電子郵件已註冊，請直接登入' });

            try {
                const passwordHash = await hashPassword(password);
                const user = await createUser({ email, name, role, passwordHash });
                await saveUserData(user.id, defaultUserData(user.id));
                const token = signToken({ userId: user.id, email: user.email });
                return api.sendJson(res, 201, { ok: true, token, user: sanitizeUser(user) });
            } catch (err) {
                if (err.code === 'EMAIL_EXISTS' || err.code === 11000) {
                    return api.sendJson(res, 409, { error: '此電子郵件已註冊，請直接登入' });
                }
                throw err;
            }
        }

        if (method === 'POST' && urlPath === '/api/auth/login') {
            const body = await api.readBody(req);
            const email = normalizeEmail(body.email);
            const password = String(body.password || '');

            if (!isValidEmail(email)) return api.sendJson(res, 400, { error: '請輸入有效的電子郵件' });
            if (!password) return api.sendJson(res, 400, { error: '請輸入密碼' });

            const user = await findUserByEmail(email);
            if (!user) return api.sendJson(res, 401, { error: '電子郵件或密碼錯誤' });

            const valid = await verifyPassword(password, user.passwordHash);
            if (!valid) return api.sendJson(res, 401, { error: '電子郵件或密碼錯誤' });

            await ensureUserData(user.id);
            const token = signToken({ userId: user.id, email: user.email });
            return api.sendJson(res, 200, { ok: true, token, user: sanitizeUser(user) });
        }

        if (method === 'GET' && urlPath === '/api/auth/me') {
            const token = parseBearerToken(req);
            const payload = verifyToken(token);
            if (!payload) return api.sendJson(res, 401, { error: '登入已過期，請重新登入' });

            const user = await findUserById(payload.userId);
            if (!user) return api.sendJson(res, 401, { error: '帳號不存在' });
            return api.sendJson(res, 200, { ok: true, user: sanitizeUser(user) });
        }

        if (method === 'PATCH' && urlPath === '/api/auth/profile') {
            const token = parseBearerToken(req);
            const payload = verifyToken(token);
            if (!payload) return api.sendJson(res, 401, { error: '登入已過期，請重新登入' });

            const body = await api.readBody(req);
            const patch = {};
            if (body.name !== undefined) {
                const name = clampAuthText(body.name, 40);
                if (!name) return api.sendJson(res, 400, { error: '請輸入顯示名稱' });
                patch.name = name;
            }
            if (body.role !== undefined) patch.role = clampAuthText(body.role, 40) || '知識工作者';
            if (!Object.keys(patch).length) return api.sendJson(res, 400, { error: '沒有可更新的欄位' });

            const user = await updateUser(payload.userId, patch);
            if (!user) return api.sendJson(res, 404, { error: '帳號不存在' });
            return api.sendJson(res, 200, { ok: true, user: sanitizeUser(user) });
        }

        return api.sendJson(res, 404, { error: 'Auth route not found' });
    }

    Object.assign(api, {
        handleAuth
    });
}

module.exports = { register };
