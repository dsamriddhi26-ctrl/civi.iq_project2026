/**
 * Authentication & Authorization Middleware for Civ.IQ
 * 
 * DEMO AUTHENTICATION ONLY — Not production-secure.
 * This uses simple cookie-based sessions with an in-memory session store.
 * Production would require: proper password hashing, JWT or OAuth2,
 * secure session storage (Redis), CSRF protection, rate limiting on login.
 */

'use strict';

const crypto = require('node:crypto');
const { parseCookies } = require('../utils/helpers.js');

// In-memory session store (demo only — lost on restart)
const sessions = new Map();

const SESSION_COOKIE = 'civiq_session';
const SESSION_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Create a new session for a user
 * @param {object} res - HTTP response
 * @param {object} user - User object from database
 * @returns {string} Session ID
 */
function createSession(res, user) {
  const sessionId = crypto.randomUUID();
  sessions.set(sessionId, {
    userId: user.id,
    role: user.role,
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_MAX_AGE
  });

  const cookie = `${SESSION_COOKIE}=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE / 1000}`;
  res.setHeader('Set-Cookie', cookie);
  return sessionId;
}

/**
 * Destroy a session
 * @param {object} req - HTTP request
 * @param {object} res - HTTP response
 */
function destroySession(req, res) {
  const cookies = parseCookies(req.headers.cookie || '');
  const sessionId = cookies[SESSION_COOKIE];
  if (sessionId) {
    sessions.delete(sessionId);
  }
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

/**
 * Get the current user from session
 * @param {object} db - Database instance
 * @param {object} req - HTTP request
 * @returns {object|null} User object or null
 */
function getCurrentUser(db, req) {
  const cookies = parseCookies(req.headers.cookie || '');
  const sessionId = cookies[SESSION_COOKIE];
  
  if (!sessionId) return null;
  
  const session = sessions.get(sessionId);
  if (!session) return null;
  
  // Check expiry
  if (Date.now() > session.expiresAt) {
    sessions.delete(sessionId);
    return null;
  }

  try {
    const stmt = db.prepare('SELECT id, email, display_name, alias, role, department_id, verified_status, created_at FROM users WHERE id = ?');
    const user = stmt.get(session.userId);
    return user || null;
  } catch (e) {
    console.error('Error fetching user from session:', e.message);
    return null;
  }
}

/**
 * Middleware: require authentication
 * Sets req.user if authenticated, sends 401 if not
 */
function requireAuth(db, req, res) {
  const user = getCurrentUser(db, req);
  if (!user) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Authentication required' }));
    return null;
  }
  return user;
}

/**
 * Middleware: require specific role(s)
 * @param {object} db - Database instance
 * @param {object} req - HTTP request
 * @param {object} res - HTTP response
 * @param {string[]} roles - Allowed roles
 * @returns {object|null} User object or null (response already sent)
 */
function requireRole(db, req, res, roles) {
  const user = requireAuth(db, req, res);
  if (!user) return null;
  
  if (!roles.includes(user.role)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Insufficient permissions' }));
    return null;
  }
  return user;
}

/**
 * Require staff or admin role
 */
function requireStaff(db, req, res) {
  return requireRole(db, req, res, ['staff', 'admin']);
}

/**
 * Require admin role
 */
function requireAdmin(db, req, res) {
  return requireRole(db, req, res, ['admin']);
}

// Clean expired sessions periodically
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now > session.expiresAt) {
      sessions.delete(id);
    }
  }
}, 60 * 60 * 1000).unref(); // Every hour — .unref() so it doesn't prevent process exit

module.exports = {
  createSession,
  destroySession,
  getCurrentUser,
  requireAuth,
  requireRole,
  requireStaff,
  requireAdmin
};
