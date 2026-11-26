/**
 * Civ.IQ HTTP Server
 *
 * Uses only Node.js built-in modules (node:http, node:fs, node:path, node:url, node:sqlite).
 * Initializes SQLite database, seeds demo data, serves static frontend and safe uploads,
 * and routes all /api/* requests.
 */

'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const { initDatabase } = require('./src/db/schema.js');
const { seedDatabase } = require('./src/db/seed.js');
const { authRoutes } = require('./src/routes/auth.js');
const { reportRoutes } = require('./src/routes/reports.js');
const { staffRoutes } = require('./src/routes/staff.js');
const { adminRoutes } = require('./src/routes/admin.js');
const { communityRoutes } = require('./src/routes/community.js');
const { healthRoutes } = require('./src/routes/health.js');

const PORT = parseInt(process.env.PORT || '3000', 10);
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'civiq.db');

const PUBLIC_DIR = path.resolve(__dirname, 'public');
const UPLOADS_DIR = path.resolve(__dirname, 'uploads');

const STATIC_MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

const ALLOWED_UPLOAD_MIME_TYPES = {
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp'
};

// Simple in-memory rate limiter for POST endpoints (local demo protection)
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_POSTS = 60;
const postRateLimits = new Map();

/**
 * Check if a client IP has exceeded the POST rate limit.
 * @param {string} ip
 * @returns {boolean} True if allowed, false if rate-limited.
 */
function checkPostRateLimit(ip) {
  const now = Date.now();
  const entry = postRateLimits.get(ip);

  if (!entry || now > entry.resetAt) {
    postRateLimits.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  if (entry.count >= RATE_LIMIT_MAX_POSTS) {
    return false;
  }

  entry.count += 1;
  return true;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of postRateLimits) {
    if (now > entry.resetAt) {
      postRateLimits.delete(ip);
    }
  }
}, RATE_LIMIT_WINDOW_MS).unref();

/**
 * Apply baseline security headers to every response.
 * @param {http.ServerResponse} res
 */
function applySecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(self)');
}

/**
 * Send a JSON response.
 * @param {http.ServerResponse} res
 * @param {number} statusCode
 * @param {object} payload
 */
function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

/**
 * Safely serve a file from a base directory, preventing path traversal.
 * @param {http.ServerResponse} res
 * @param {string} baseDir
 * @param {string} requestedPath
 * @param {Record<string, string>} mimeMap
 * @returns {boolean} True if served, false if not found or forbidden.
 */
function serveSafeFile(res, baseDir, requestedPath, mimeMap) {
  let decoded;
  try {
    decoded = decodeURIComponent(requestedPath);
  } catch {
    return false;
  }

  const normalized = path.normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, '');
  const resolved = path.resolve(baseDir, normalized);

  if (resolved !== baseDir && !resolved.startsWith(baseDir + path.sep)) {
    return false;
  }

  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    return false;
  }

  const ext = path.extname(resolved).toLowerCase();
  const contentType = mimeMap[ext];
  if (!contentType) {
    return false;
  }

  res.writeHead(200, { 'Content-Type': contentType });
  fs.createReadStream(resolved).pipe(res);
  return true;
}

/**
 * Create and configure the HTTP server (exported for testing).
 * @param {string} [dbPath=DB_PATH]
 * @returns {{ server: http.Server, db: import('node:sqlite').DatabaseSync }}
 */
function createAppServer(dbPath = DB_PATH) {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }

  const db = initDatabase(dbPath);
  seedDatabase(db);

  const auth = authRoutes(db);
  const reports = reportRoutes(db);
  const staff = staffRoutes(db);
  const admin = adminRoutes(db);
  const community = communityRoutes(db);
  const health = healthRoutes(db);

  const server = http.createServer(async (req, res) => {
    applySecurityHeaders(res);

    const method = (req.method || 'GET').toUpperCase();
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    // Rate limit POST requests
    if (method === 'POST') {
      const clientIp = req.socket?.remoteAddress || 'unknown';
      if (!checkPostRateLimit(clientIp)) {
        sendJson(res, 429, { error: 'Too many requests. Please wait a moment before trying again.' });
        return;
      }
    }

    try {
      // ─── API Routes ──────────────────────────────────────────────────────
      if (pathname.startsWith('/api/')) {
        // Health
        if (method === 'GET' && pathname === '/api/health') {
          return health.getHealth(req, res);
        }

        // Auth
        if (method === 'GET' && pathname === '/api/auth/me') {
          return auth.getMe(req, res);
        }
        if (method === 'POST' && pathname === '/api/auth/demo-login') {
          return await auth.demoLogin(req, res);
        }
        if (method === 'POST' && pathname === '/api/auth/signup') {
          return await auth.signup(req, res);
        }
        if (method === 'POST' && pathname === '/api/auth/login') {
          return await auth.login(req, res);
        }
        if (method === 'POST' && pathname === '/api/auth/logout') {
          return auth.logout(req, res);
        }
        if (method === 'GET' && pathname === '/api/auth/demo-users') {
          return auth.getDemoUsers(req, res);
        }

        // Reports (static paths before parameterized :id)
        if (method === 'POST' && pathname === '/api/reports') {
          return await reports.createReport(req, res);
        }
        if (method === 'GET' && pathname === '/api/reports/my') {
          return reports.getMyReports(req, res);
        }
        if (method === 'GET' && pathname === '/api/reports/classify') {
          return reports.classifyReportEndpoint(req, res);
        }
        if (method === 'GET' && pathname === '/api/reports/duplicates') {
          return reports.getDuplicatesEndpoint(req, res);
        }

        let match = pathname.match(/^\/api\/reports\/([^/]+)\/upvote$/);
        if (method === 'POST' && match) {
          return reports.toggleUpvote(req, res, decodeURIComponent(match[1]));
        }

        match = pathname.match(/^\/api\/reports\/([^/]+)\/support$/);
        if (method === 'POST' && match) {
          return reports.addSupport(req, res, decodeURIComponent(match[1]));
        }
        if (method === 'DELETE' && match) {
          return reports.removeSupport(req, res, decodeURIComponent(match[1]));
        }

        match = pathname.match(/^\/api\/reports\/([^/]+)\/verify$/);
        if (method === 'POST' && match) {
          return await reports.submitVerification(req, res, decodeURIComponent(match[1]));
        }

        match = pathname.match(/^\/api\/reports\/([^/]+)$/);
        if (method === 'GET' && match) {
          return reports.getReport(req, res, decodeURIComponent(match[1]));
        }

        // Community & Notifications
        if (method === 'GET' && pathname === '/api/community/feed') {
          return community.getFeed(req, res);
        }
        if (method === 'GET' && pathname === '/api/community/leaderboard') {
          return community.getLeaderboard(req, res);
        }
        if (method === 'GET' && pathname === '/api/community/recent-resolved') {
          return community.getRecentResolved(req, res);
        }
        if (method === 'GET' && pathname === '/api/community/map-data') {
          return community.getMapData(req, res);
        }
        if (method === 'GET' && pathname === '/api/community/reviews') {
          return community.getReviews(req, res);
        }
        if (method === 'POST' && pathname === '/api/community/reviews') {
          return await community.createReview(req, res);
        }
        if (method === 'GET' && pathname === '/api/notifications') {
          return community.getNotifications(req, res);
        }
        if (method === 'PUT' && pathname === '/api/notifications/read-all') {
          return community.markAllRead(req, res);
        }

        match = pathname.match(/^\/api\/notifications\/([^/]+)\/read$/);
        if (method === 'PUT' && match) {
          return community.markNotificationRead(req, res, decodeURIComponent(match[1]));
        }

        // Staff
        if (method === 'GET' && pathname === '/api/staff/dashboard') {
          return staff.getDashboard(req, res);
        }
        if (method === 'GET' && pathname === '/api/staff/escalations') {
          return staff.getEscalations(req, res);
        }
        if (method === 'POST' && pathname === '/api/staff/escalations/check') {
          return staff.runEscalationCheck(req, res);
        }
        if (method === 'POST' && pathname === '/api/staff/verifications/check-expired') {
          return staff.checkExpiredVerifications(req, res);
        }
        if (method === 'GET' && pathname === '/api/staff/reports') {
          return staff.getAllReports(req, res);
        }

        match = pathname.match(/^\/api\/staff\/reports\/([^/]+)$/);
        if (method === 'GET' && match) {
          return staff.getReportDetail(req, res, decodeURIComponent(match[1]));
        }

        match = pathname.match(/^\/api\/staff\/reports\/([^/]+)\/status$/);
        if (method === 'PUT' && match) {
          return await staff.updateStatus(req, res, decodeURIComponent(match[1]));
        }

        match = pathname.match(/^\/api\/staff\/reports\/([^/]+)\/priority$/);
        if (method === 'PUT' && match) {
          return await staff.updatePriority(req, res, decodeURIComponent(match[1]));
        }

        match = pathname.match(/^\/api\/staff\/reports\/([^/]+)\/assign$/);
        if (method === 'PUT' && match) {
          return await staff.assignReport(req, res, decodeURIComponent(match[1]));
        }

        match = pathname.match(/^\/api\/staff\/reports\/([^/]+)\/notes$/);
        if (method === 'POST' && match) {
          return await staff.addInternalNote(req, res, decodeURIComponent(match[1]));
        }

        match = pathname.match(/^\/api\/staff\/reports\/([^/]+)\/updates$/);
        if (method === 'POST' && match) {
          return await staff.addCitizenUpdate(req, res, decodeURIComponent(match[1]));
        }

        match = pathname.match(/^\/api\/staff\/reports\/([^/]+)\/duplicate$/);
        if (method === 'PUT' && match) {
          return await staff.handleDuplicate(req, res, decodeURIComponent(match[1]));
        }

        match = pathname.match(/^\/api\/staff\/reports\/([^/]+)\/pause$/);
        if (method === 'PUT' && match) {
          return await staff.pauseReport(req, res, decodeURIComponent(match[1]));
        }

        match = pathname.match(/^\/api\/staff\/reports\/([^/]+)\/resume$/);
        if (method === 'PUT' && match) {
          return await staff.resumeReport(req, res, decodeURIComponent(match[1]));
        }

        match = pathname.match(/^\/api\/staff\/reports\/([^/]+)\/verification-decision$/);
        if (method === 'POST' && match) {
          return await staff.verificationDecision(req, res, decodeURIComponent(match[1]));
        }

        // Admin
        if (method === 'GET' && pathname === '/api/admin/departments') {
          return admin.getDepartments(req, res);
        }
        if (method === 'POST' && pathname === '/api/admin/departments') {
          return await admin.createDepartment(req, res);
        }

        match = pathname.match(/^\/api\/admin\/departments\/([^/]+)$/);
        if (method === 'PUT' && match) {
          return await admin.updateDepartment(req, res, decodeURIComponent(match[1]));
        }
        if (method === 'DELETE' && match) {
          return admin.deleteDepartment(req, res, decodeURIComponent(match[1]));
        }

        if (method === 'GET' && pathname === '/api/admin/sla') {
          return admin.getSLASettings(req, res);
        }

        match = pathname.match(/^\/api\/admin\/sla\/([^/]+)$/);
        if (method === 'PUT' && match) {
          return await admin.updateSLASetting(req, res, decodeURIComponent(match[1]));
        }

        if (method === 'GET' && pathname === '/api/admin/users') {
          return admin.getUsers(req, res);
        }

        match = pathname.match(/^\/api\/admin\/users\/([^/]+)\/role$/);
        if (method === 'PUT' && match) {
          return await admin.updateUserRole(req, res, decodeURIComponent(match[1]));
        }

        if (method === 'GET' && pathname === '/api/admin/settings') {
          return admin.getSettings(req, res);
        }
        if (method === 'PUT' && pathname === '/api/admin/settings') {
          return await admin.updateSettings(req, res);
        }

        sendJson(res, 404, { error: 'API endpoint not found' });
        return;
      }

      // ─── Uploaded Images ─────────────────────────────────────────────────
      if (pathname.startsWith('/uploads/')) {
        if (method !== 'GET' && method !== 'HEAD') {
          sendJson(res, 405, { error: 'Method not allowed' });
          return;
        }
        const relUploadPath = pathname.slice('/uploads/'.length);
        // Restrict to single-segment safe filenames with .jpg, .png, or .webp
        if (!relUploadPath || relUploadPath.includes('/') || relUploadPath.includes('\\')) {
          sendJson(res, 403, { error: 'Forbidden' });
          return;
        }
        if (!serveSafeFile(res, UPLOADS_DIR, relUploadPath, ALLOWED_UPLOAD_MIME_TYPES)) {
          sendJson(res, 404, { error: 'File not found' });
        }
        return;
      }

      // ─── Static Files & SPA Fallback ─────────────────────────────────────
      if (method !== 'GET' && method !== 'HEAD') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
      }

      const relStaticPath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      if (serveSafeFile(res, PUBLIC_DIR, relStaticPath, STATIC_MIME_TYPES)) {
        return;
      }

      // SPA fallback for non-API routes (only if not requesting a missing asset with extension)
      const indexPath = path.join(PUBLIC_DIR, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        fs.createReadStream(indexPath).pipe(res);
        return;
      }

      sendJson(res, 404, { error: 'Not found' });
    } catch (err) {
      console.error('Unhandled server error:', err);
      if (!res.headersSent) {
        sendJson(res, 500, { error: 'Internal server error' });
      }
    }
  });

  return { server, db };
}

// Start server only when executed directly
if (require.main === module) {
  const { server } = createAppServer(DB_PATH);
  server.listen(PORT, () => {
    console.log(`Civ.IQ server running at http://localhost:${PORT}`);
    console.log(`Database: ${DB_PATH}`);
    console.log('Mode: Local MVP (demo authentication only)');
  });
}

module.exports = { createAppServer };
