const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const JWT_SECRET = process.env.JWT_SECRET || 'lumina-jwt-secret-change-in-production';
const JWT_EXPIRES_SEC = Number(process.env.JWT_EXPIRES_SEC || 7 * 24 * 60 * 60);
const BCRYPT_ROUNDS = 10;

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function clampText(value, max) {
    return String(value || '').trim().slice(0, max);
}

function base64url(input) {
    return Buffer.from(input)
        .toString('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
}

function signToken(payload) {
    const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const now = Math.floor(Date.now() / 1000);
    const body = base64url(JSON.stringify({
        sub: payload.userId,
        email: payload.email,
        iat: now,
        exp: now + JWT_EXPIRES_SEC
    }));
    const sig = crypto
        .createHmac('sha256', JWT_SECRET)
        .update(`${header}.${body}`)
        .digest('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
    return `${header}.${body}.${sig}`;
}

function verifyToken(token) {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const [header, body, sig] = parts;
    const expected = crypto
        .createHmac('sha256', JWT_SECRET)
        .update(`${header}.${body}`)
        .digest('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
    if (sig.length !== expected.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;

    try {
        const payload = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
        if (!payload?.sub || !payload?.exp) return null;
        if (payload.exp < Math.floor(Date.now() / 1000)) return null;
        return { userId: payload.sub, email: payload.email };
    } catch (_) {
        return null;
    }
}

function parseBearerToken(req) {
    const auth = req.headers.authorization || req.headers.Authorization || '';
    const match = String(auth).match(/^Bearer\s+(.+)$/i);
    return match ? match[1].trim() : null;
}

async function hashPassword(password) {
    return bcrypt.hash(String(password), BCRYPT_ROUNDS);
}

async function verifyPassword(password, passwordHash) {
    return bcrypt.compare(String(password), String(passwordHash || ''));
}

function sanitizeUser(user) {
    if (!user) return null;
    return {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role || '知識工作者',
        createdAt: user.createdAt,
        updatedAt: user.updatedAt || user.createdAt
    };
}

function getJwtConfig() {
    return {
        usingDefaultSecret: JWT_SECRET === 'lumina-jwt-secret-change-in-production',
        expiresSec: JWT_EXPIRES_SEC
    };
}

module.exports = {
    normalizeEmail,
    isValidEmail,
    clampText,
    signToken,
    verifyToken,
    parseBearerToken,
    hashPassword,
    verifyPassword,
    sanitizeUser,
    getJwtConfig
};