'use strict';

/**
 * Dashboard authentication - stateless HMAC-signed session cookies.
 * No external dependencies; sessions invalidate when the process restarts.
 */
const crypto = require('crypto');
const { log } = require('../utils/logger');
const { getConfig } = require('../config');

const COOKIE_NAME = 'panel_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

// Per-process random secret - all sessions die on restart (safe default)
const SECRET = crypto.randomBytes(32);

// Simple in-memory login rate limiting: max 5 failed attempts per 5 minutes per IP
const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 5 * 60 * 1000;

function timingSafeEqualStr(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function sign(payload) {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}

function createToken() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + SESSION_TTL_MS })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return false;
  const dot = token.lastIndexOf('.');
  if (dot === -1) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(payload);
  if (sig.length !== expected.length) return false;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.exp > Date.now();
  } catch (e) {
    return false;
  }
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx > -1) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  });
  return out;
}

function isRateLimited(ip) {
  const entry = loginAttempts.get(ip);
  if (!entry) return false;
  if (Date.now() > entry.resetAt) {
    loginAttempts.delete(ip);
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

function recordFailedLogin(ip) {
  const entry = loginAttempts.get(ip);
  if (!entry || Date.now() > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: Date.now() + WINDOW_MS });
  } else {
    entry.count++;
  }
}

/** Express middleware factory - protects /api routes */
function authMiddleware() {
  return (req, res, next) => {
    const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
    if (token && verifyToken(token)) return next();
    res.status(401).json({ error: 'unauthorized' });
  };
}

/**
 * Check a raw cookie header for a valid session.
 * Used by non-Express surfaces (e.g. socket.io handshake for the 3D viewer).
 */
function isAuthed(cookieHeader) {
  const token = parseCookies(cookieHeader)[COOKIE_NAME];
  return !!(token && verifyToken(token));
}

/** Handle POST /api/login */
function loginHandler(req, res) {
  const ip = req.socket.remoteAddress || 'unknown';
  const password = (req.body && req.body.password) || '';

  if (isRateLimited(ip)) {
    log('Dashboard', `Login rate limited for ${ip}`);
    return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  }

  // Read the current password live from config (dashboard edits apply instantly)
  const dash = getConfig().dashboard || {};
  const expected = dash.password || 'changeme';
  if (!timingSafeEqualStr(password, expected)) {
    recordFailedLogin(ip);
    log('Dashboard', `Failed login attempt from ${ip}`);
    return res.status(401).json({ error: 'Wrong password' });
  }

  loginAttempts.delete(ip);
  res.setHeader('Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(createToken())}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_MS / 1000}`);
  res.json({ ok: true });
}

/** Handle POST /api/logout */
function logoutHandler(req, res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
  res.json({ ok: true });
}

/** Check session validity for the frontend */
function sessionHandler(req, res) {
  res.json({ ok: true });
}

module.exports = {
  authMiddleware,
  isAuthed,
  loginHandler,
  logoutHandler,
  sessionHandler,
  COOKIE_NAME
};
