/**
 * server/domain/handlers/user-data
 * 任務：HTTP：/api/user/*
 * 透過 register(api) 掛載到共享 api 物件（跨域呼叫 api.fn）
 */
'use strict';


const { getUserData, saveUserData, mergeUserData, getUserDataBackend, defaultUserData } = require('../../../lib/user-data-store');

/** @param {Record<string, Function>} api */
function register(api) {
    async function handleUserData(req, res, urlPath, method) {
        const user = await api.requireAuth(req);
        if (!user) return api.sendJson(res, 401, { error: '請先登入' });

        if (method === 'GET' && urlPath === '/api/user/data') {
            const data = await getUserData(user.id);
            return api.sendJson(res, 200, {
                ok: true,
                data: data || defaultUserData(user.id),
                storage: getUserDataBackend()
            });
        }

        if (method === 'PUT' && urlPath === '/api/user/data') {
            const body = await api.readBody(req);
            const saved = await saveUserData(user.id, body);
            return api.sendJson(res, 200, { ok: true, data: saved, storage: getUserDataBackend() });
        }

        if (method === 'PATCH' && urlPath === '/api/user/data') {
            const body = await api.readBody(req);
            const result = await mergeUserData(user.id, body);
            return api.sendJson(res, 200, {
                ok: true,
                data: result.data,
                merged: result.merged,
                storage: getUserDataBackend()
            });
        }

        return api.sendJson(res, 404, { error: 'User data route not found' });
    }

    Object.assign(api, {
        handleUserData
    });
}

module.exports = { register };
