/**
 * Authentication Routes for Civ.IQ
 * 
 * ⚠️ DEMO AUTHENTICATION ONLY
 * Uses simple session cookies with pre-seeded demo accounts.
 * Production would require: proper password authentication (bcrypt),
 * OAuth2/OpenID Connect, CSRF tokens, rate limiting, account lockout.
 */

'use strict';

const { createSession, destroySession, getCurrentUser } = require('../middleware/auth.js');
const { readJsonBody } = require('../middleware/upload.js');
const { generateUUID } = require('../utils/helpers.js');

/**
 * Register auth routes
 * @param {object} db - Database instance
 * @returns {object} Route handlers
 */
function authRoutes(db) {
  return {
    /**
     * GET /api/auth/me
     * Get current authenticated user
     */
    getMe(req, res) {
      const user = getCurrentUser(db, req);
      if (!user) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ user: null }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        user: {
          id: user.id,
          email: user.email,
          displayName: user.display_name,
          alias: user.alias,
          role: user.role,
          departmentId: user.department_id,
          verifiedStatus: user.verified_status,
          createdAt: user.created_at
        }
      }));
    },

    /**
     * POST /api/auth/demo-login
     * Demo login — switch to a pre-seeded user
     * Body: { userId: string }
     */
    async demoLogin(req, res) {
      try {
        const body = await readJsonBody(req);
        const { userId } = body;

        if (!userId) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'userId is required' }));
          return;
        }

        const stmt = db.prepare('SELECT id, email, display_name, alias, role, department_id, verified_status, created_at FROM users WHERE id = ?');
        const user = stmt.get(userId);

        if (!user) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'User not found' }));
          return;
        }

        // Destroy existing session
        destroySession(req, res);
        
        // Create new session
        createSession(res, user);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          message: 'Demo login successful',
          user: {
            id: user.id,
            email: user.email,
            displayName: user.display_name,
            alias: user.alias,
            role: user.role,
            departmentId: user.department_id,
            verifiedStatus: user.verified_status,
            createdAt: user.created_at
          }
        }));
      } catch (e) {
        console.error('Demo login error:', e.message);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    },

    /**
     * POST /api/auth/logout
     * Destroy current session
     */
    logout(req, res) {
      destroySession(req, res);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Logged out' }));
    },

    /**
     * GET /api/auth/demo-users
     * List available demo users for the role-switcher
     */
    getDemoUsers(req, res) {
      const stmt = db.prepare('SELECT id, email, display_name, role FROM users ORDER BY role, display_name');
      const users = stmt.all();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        notice: '⚠️ DEMO MODE — These accounts are for development/testing only. Production authentication would use secure password hashing, OAuth2/OpenID Connect, MFA, and proper session management.',
        users: users.map(u => ({
          id: u.id,
          email: u.email,
          displayName: u.display_name,
          role: u.role
        }))
      }));
    }
  };
}

module.exports = { authRoutes };
