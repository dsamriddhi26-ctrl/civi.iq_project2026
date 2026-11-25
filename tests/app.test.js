/**
 * Automated Tests for Civ.IQ MVP
 * Uses Node.js built-in node:test and node:assert.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');

const { initDatabase } = require('../src/db/schema.js');
const { seedDatabase } = require('../src/db/seed.js');
const { classifyReport, getDuplicateSuggestions } = require('../src/services/classifier.js');
const { calculateDeadline, checkEscalations } = require('../src/services/sla.js');
const { createAppServer } = require('../server.js');

/**
 * Helper to make HTTP requests to a test server and preserve cookies.
 */
function request(baseUrl, method, path, { body, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const headers = {};
    let payload = null;

    if (body !== undefined) {
      payload = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    if (cookie) {
      headers['Cookie'] = cookie;
    }

    const req = http.request(url, { method, headers }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let json = null;
        try {
          json = raw ? JSON.parse(raw) : null;
        } catch {
          json = null;
        }
        const setCookie = res.headers['set-cookie'];
        resolve({ status: res.statusCode, headers: res.headers, setCookie, json, raw });
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

test('Database schema initialization and idempotent seeding', () => {
  const db = initDatabase(':memory:');
  seedDatabase(db);

  const firstDeptCount = db.prepare('SELECT COUNT(*) AS c FROM departments').get().c;
  const firstUserCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  const firstReportCount = db.prepare('SELECT COUNT(*) AS c FROM reports').get().c;

  assert.equal(firstDeptCount, 6);
  assert.equal(firstUserCount, 4);
  assert.ok(firstReportCount >= 8);

  // Calling seedDatabase a second time should be a no-op
  seedDatabase(db);

  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM departments').get().c, firstDeptCount);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM users').get().c, firstUserCount);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM reports').get().c, firstReportCount);

  db.close();
});

test('Rules-based classification and duplicate detection', () => {
  const db = initDatabase(':memory:');
  seedDatabase(db);

  const criticalResult = classifyReport(
    db,
    'Exposed wire and dangerous electrical hazard near school gate',
    'streetlight',
    null
  );
  assert.equal(criticalResult.priority, 'critical');
  assert.equal(criticalResult.source, 'rules_engine');
  assert.equal(criticalResult.departmentName, 'Street Lighting');

  const lowResult = classifyReport(
    db,
    'Minor cosmetic crack on footpath, not urgent, repair when possible',
    'pothole',
    null
  );
  assert.equal(lowResult.priority, 'low');

  // Seeded report CIV-2026-00001 is at (19.1197, 72.8464) in category 'pothole'
  const duplicates = getDuplicateSuggestions(
    db,
    19.1198,
    72.8465,
    'pothole',
    'Large pothole on SV Road near Andheri station causing traffic jams',
    null
  );
  assert.ok(duplicates.length > 0, 'Expected at least one nearby duplicate suggestion');
  assert.equal(duplicates[0].source, 'rules_engine');
  assert.ok(duplicates[0].similarity_score > 0.3);

  db.close();
});

test('SLA deadline calculation and idempotent escalation checks', () => {
  const db = initDatabase(':memory:');
  seedDatabase(db);

  const created = '2026-01-01T00:00:00.000Z';
  const deadline = calculateDeadline(db, 'critical', created);
  assert.equal(deadline, '2026-01-01 04:00:00');

  const firstRun = checkEscalations(db);
  assert.ok(firstRun.checked > 0);
  const escCountAfterFirst = db.prepare('SELECT COUNT(*) AS c FROM escalation_records').get().c;

  const secondRun = checkEscalations(db);
  const escCountAfterSecond = db.prepare('SELECT COUNT(*) AS c FROM escalation_records').get().c;

  assert.equal(secondRun.escalated, 0, 'Second escalation check should not create duplicate escalations');
  assert.equal(escCountAfterSecond, escCountAfterFirst);

  db.close();
});

test('Server-side role authorization, private note protection, and upvote uniqueness', async () => {
  const { server, db } = createAppServer(':memory:');

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const citizen = db.prepare("SELECT id FROM users WHERE role = 'citizen' LIMIT 1").get();
    const staff = db.prepare("SELECT id FROM users WHERE role = 'staff' LIMIT 1").get();
    const report = db.prepare('SELECT id, upvote_count FROM reports LIMIT 1').get();

    // Add an internal note directly to verify it is hidden from public /api/reports/:id
    db.prepare(`
      INSERT INTO internal_notes (id, report_id, user_id, content, created_at)
      VALUES (?, ?, ?, 'INTERNAL SECRET STAFF NOTE', datetime('now'))
    `).run(crypto.randomUUID(), report.id, staff.id);

    // 1. Unauthenticated requests to staff/admin must return 401
    const unauthStaff = await request(baseUrl, 'GET', '/api/staff/reports');
    assert.equal(unauthStaff.status, 401);

    // 2. Log in as Citizen
    const loginCitizen = await request(baseUrl, 'POST', '/api/auth/demo-login', {
      body: { userId: citizen.id }
    });
    assert.equal(loginCitizen.status, 200);
    const citizenCookie = loginCitizen.setCookie[0].split(';')[0];

    // Citizen cannot access staff or admin routes (403)
    const citizenStaffRes = await request(baseUrl, 'GET', '/api/staff/reports', { cookie: citizenCookie });
    assert.equal(citizenStaffRes.status, 403);

    const citizenAdminRes = await request(baseUrl, 'GET', '/api/admin/settings', { cookie: citizenCookie });
    assert.equal(citizenAdminRes.status, 403);

    // Public report endpoint must NOT expose internalNotes
    const publicReportRes = await request(baseUrl, 'GET', `/api/reports/${report.id}`, { cookie: citizenCookie });
    assert.equal(publicReportRes.status, 200);
    assert.equal(publicReportRes.json.report.internalNotes, undefined);
    assert.ok(!publicReportRes.raw.includes('INTERNAL SECRET STAFF NOTE'));

    // Staff endpoint DOES expose internalNotes to staff
    const loginStaff = await request(baseUrl, 'POST', '/api/auth/demo-login', {
      body: { userId: staff.id }
    });
    assert.equal(loginStaff.status, 200);
    const staffCookie = loginStaff.setCookie[0].split(';')[0];

    const staffReportRes = await request(baseUrl, 'GET', `/api/staff/reports/${report.id}`, { cookie: staffCookie });
    assert.equal(staffReportRes.status, 200);
    assert.ok(Array.isArray(staffReportRes.json.report.internalNotes));
    assert.ok(staffReportRes.raw.includes('INTERNAL SECRET STAFF NOTE'));

    // 3. Upvote uniqueness: one vote per user per report (second POST toggles off)
    const freshReportId = db.prepare(`
      SELECT r.id FROM reports r
      WHERE NOT EXISTS (SELECT 1 FROM upvotes u WHERE u.report_id = r.id AND u.user_id = ?)
      LIMIT 1
    `).get(citizen.id).id;

    const firstVote = await request(baseUrl, 'POST', `/api/reports/${freshReportId}/upvote`, { cookie: citizenCookie });
    assert.equal(firstVote.status, 200);
    assert.equal(firstVote.json.upvoted, true);

    const secondVote = await request(baseUrl, 'POST', `/api/reports/${freshReportId}/upvote`, { cookie: citizenCookie });
    assert.equal(secondVote.status, 200);
    assert.equal(secondVote.json.upvoted, false);

    // Direct DB constraint also enforces UNIQUE(report_id, user_id)
    const upId1 = crypto.randomUUID();
    const upId2 = crypto.randomUUID();
    db.prepare('INSERT INTO upvotes (id, report_id, user_id) VALUES (?, ?, ?)').run(upId1, freshReportId, citizen.id);
    assert.throws(() => {
      db.prepare('INSERT INTO upvotes (id, report_id, user_id) VALUES (?, ?, ?)').run(upId2, freshReportId, citizen.id);
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});
