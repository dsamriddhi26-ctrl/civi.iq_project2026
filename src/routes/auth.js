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
const { generateUUID, sanitizeInput, validateEmail } = require('../utils/helpers.js');

/**
 * Parse a contact string as either an email address or a normalized phone number.
 * @param {string} raw
 * @returns {{ type: 'email'|'phone', value: string } | null}
 */
function parseContact(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;
  if (trimmed.includes('@')) {
    const lower = trimmed.toLowerCase();
    return validateEmail(lower) ? { type: 'email', value: lower } : null;
  }
  const digits = trimmed.replace(/[\s\-().]/g, '').replace(/^\+/, '');
  if (/^\d{7,15}$/.test(digits)) {
    return { type: 'phone', value: digits };
  }
  return null;
}

function formatUserResponse(user) {
  return {
    id: user.id,
    email: user.email,
    phone: user.phone || null,
    displayName: user.display_name,
    alias: user.alias,
    role: user.role,
    departmentId: user.department_id,
    verifiedStatus: user.verified_status,
    createdAt: user.created_at
  };
}

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
        user: formatUserResponse(user)
      }));
    },

    /**
     * POST /api/auth/signup
     * Demo local signup with role (citizen, staff, admin) and email or phone number
     */
    async signup(req, res) {
      try {
        const body = await readJsonBody(req);
        const role = String(body.role || '').trim().toLowerCase();
        const displayName = sanitizeInput(body.displayName || '');
        const parsed = parseContact(body.contact || body.email || body.phone || '');

        if (!['citizen', 'staff', 'admin'].includes(role)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Please select a valid role: citizen, staff, or admin' }));
          return;
        }
        if (!displayName || displayName.length < 2) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Full name must be at least 2 characters' }));
          return;
        }
        if (!parsed) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Please enter a valid email address or 7-15 digit phone number' }));
          return;
        }

        const existing = parsed.type === 'email'
          ? db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').get(parsed.value)
          : db.prepare('SELECT id FROM users WHERE phone = ?').get(parsed.value);

        if (existing) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'An account with this email or phone number already exists. Please log in.' }));
          return;
        }

        const userId = generateUUID();
        const emailVal = parsed.type === 'email' ? parsed.value : `phone.${parsed.value}@phone.civiq.local`;
        const phoneVal = parsed.type === 'phone' ? parsed.value : null;

        let departmentId = null;
        if (role === 'staff') {
          const defaultDept = db.prepare("SELECT id FROM departments WHERE is_active = 1 LIMIT 1").get();
          departmentId = defaultDept ? defaultDept.id : null;
        }

        const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
        db.prepare(`
          INSERT INTO users (id, email, phone, display_name, role, department_id, verified_status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 'demo', ?, ?)
        `).run(userId, emailVal, phoneVal, displayName, role, departmentId, now, now);

        const createdUser = db.prepare('SELECT id, email, phone, display_name, alias, role, department_id, verified_status, created_at FROM users WHERE id = ?').get(userId);
        destroySession(req, res);
        createSession(res, createdUser);

        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          message: 'Account created (demo local auth)',
          user: formatUserResponse(createdUser)
        }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    },

    /**
     * POST /api/auth/login
     * Demo local login with role + email or phone number
     */
    async login(req, res) {
      try {
        const body = await readJsonBody(req);
        const role = String(body.role || '').trim().toLowerCase();
        const parsed = parseContact(body.contact || body.email || body.phone || '');

        if (!['citizen', 'staff', 'admin'].includes(role)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Please select a role: citizen, staff, or admin' }));
          return;
        }
        if (!parsed) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Please enter a valid email address or phone number' }));
          return;
        }

        const user = parsed.type === 'email'
          ? db.prepare('SELECT id, email, phone, display_name, alias, role, department_id, verified_status, created_at FROM users WHERE LOWER(email) = ?').get(parsed.value)
          : db.prepare('SELECT id, email, phone, display_name, alias, role, department_id, verified_status, created_at FROM users WHERE phone = ?').get(parsed.value);

        if (!user) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No account found for that email or phone number. Please sign up first.' }));
          return;
        }

        if (user.role !== role) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `This account is registered as "${user.role}", not "${role}". Please select the matching role.` }));
          return;
        }

        destroySession(req, res);
        createSession(res, user);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          message: 'Login successful',
          user: formatUserResponse(user)
        }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
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
