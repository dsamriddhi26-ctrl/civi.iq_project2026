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
const { extractExifGps } = require('../src/utils/helpers.js');
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

test('App ratings & reviews API and EXIF GPS extraction', async () => {
  // 1. Build a minimal synthetic little-endian JPEG EXIF APP1 buffer with GPS (19.0760, 72.8777)
  const buf = Buffer.alloc(160, 0);
  buf[0] = 0xFF; buf[1] = 0xD8; // SOI
  buf[2] = 0xFF; buf[3] = 0xE1; // APP1
  buf.writeUInt16BE(150, 4);    // segment length
  buf.write('Exif\0\0', 6, 'ascii');
  const tiff = 12;
  buf.write('II', tiff, 'ascii'); // little-endian
  buf.writeUInt16LE(42, tiff + 2);
  buf.writeUInt32LE(8, tiff + 4);  // IFD0 offset

  // IFD0 at tiff + 8: 1 entry (0x8825 GPSInfoIFDPointer) -> points to tiff + 26
  buf.writeUInt16LE(1, tiff + 8);
  buf.writeUInt16LE(0x8825, tiff + 10);
  buf.writeUInt16LE(4, tiff + 12);
  buf.writeUInt32LE(1, tiff + 14);
  buf.writeUInt32LE(26, tiff + 18);
  buf.writeUInt32LE(0, tiff + 22);

  // GPS IFD at tiff + 26: 4 entries
  const gps = tiff + 26;
  buf.writeUInt16LE(4, gps);
  // Entry 0: GPSLatitudeRef = 'N'
  buf.writeUInt16LE(1, gps + 2);
  buf.writeUInt16LE(2, gps + 4);
  buf.writeUInt32LE(2, gps + 6);
  buf[gps + 10] = 78; // 'N'
  // Entry 1: GPSLatitude -> tiff + 80
  buf.writeUInt16LE(2, gps + 14);
  buf.writeUInt16LE(5, gps + 16);
  buf.writeUInt32LE(3, gps + 18);
  buf.writeUInt32LE(80, gps + 22);
  // Entry 2: GPSLongitudeRef = 'E'
  buf.writeUInt16LE(3, gps + 26);
  buf.writeUInt16LE(2, gps + 28);
  buf.writeUInt32LE(2, gps + 30);
  buf[gps + 34] = 69; // 'E'
  // Entry 3: GPSLongitude -> tiff + 104
  buf.writeUInt16LE(4, gps + 38);
  buf.writeUInt16LE(5, gps + 40);
  buf.writeUInt32LE(3, gps + 42);
  buf.writeUInt32LE(104, gps + 46);

  // Lat: 19 deg, 4 min, 33.6 sec (336/10) => ~19.0760
  buf.writeUInt32LE(19, tiff + 80); buf.writeUInt32LE(1, tiff + 84);
  buf.writeUInt32LE(4, tiff + 88); buf.writeUInt32LE(1, tiff + 92);
  buf.writeUInt32LE(336, tiff + 96); buf.writeUInt32LE(10, tiff + 100);
  // Lng: 72 deg, 52 min, 39.72 sec (3972/100) => ~72.8777
  buf.writeUInt32LE(72, tiff + 104); buf.writeUInt32LE(1, tiff + 108);
  buf.writeUInt32LE(52, tiff + 112); buf.writeUInt32LE(1, tiff + 116);
  buf.writeUInt32LE(3972, tiff + 120); buf.writeUInt32LE(100, tiff + 124);

  const coords = extractExifGps(buf);
  assert.ok(coords, 'Expected EXIF GPS coordinates to be extracted');
  assert.ok(Math.abs(coords.latitude - 19.076) < 0.001);
  assert.ok(Math.abs(coords.longitude - 72.8777) < 0.001);

  // 2. Reviews API
  const { server, db } = createAppServer(':memory:');
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const initial = await request(baseUrl, 'GET', '/api/community/reviews');
    assert.equal(initial.status, 200);
    assert.ok(initial.json.summary.totalReviews >= 4);
    assert.ok(initial.json.summary.averageRating > 0);

    // Unauthenticated POST should return 401
    const unauthPost = await request(baseUrl, 'POST', '/api/community/reviews', {
      body: { rating: 5, issueResolved: 'yes', comment: 'Great app for reporting issues!' }
    });
    assert.equal(unauthPost.status, 401);

    // Authenticated citizen can submit a review
    const citizen = db.prepare("SELECT id FROM users WHERE role = 'citizen' LIMIT 1").get();
    const login = await request(baseUrl, 'POST', '/api/auth/demo-login', { body: { userId: citizen.id } });
    const cookie = login.setCookie[0].split(';')[0];

    const created = await request(baseUrl, 'POST', '/api/community/reviews', {
      cookie,
      body: {
        rating: 5,
        issueResolved: 'yes',
        title: 'Problem fixed fast',
        comment: 'The pothole near my street was repaired within 48 hours.'
      }
    });
    assert.equal(created.status, 201);
    assert.equal(created.json.review.rating, 5);
    assert.equal(created.json.review.issueResolved, 'yes');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});

test('Role-based email/phone signup & login, and user-selected report severity', async () => {
  const { server, db } = createAppServer(':memory:');
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Signup as Citizen with phone number
    const signupRes = await request(baseUrl, 'POST', '/api/auth/signup', {
      body: { role: 'citizen', displayName: 'Sam Citizen', contact: '9876543210' }
    });
    assert.equal(signupRes.status, 201);
    assert.equal(signupRes.json.user.role, 'citizen');
    assert.equal(signupRes.json.user.phone, '9876543210');

    // Duplicate phone signup should fail with 409
    const dupRes = await request(baseUrl, 'POST', '/api/auth/signup', {
      body: { role: 'citizen', displayName: 'Sam Duplicate', contact: '9876543210' }
    });
    assert.equal(dupRes.status, 409);

    // Login with wrong role should fail with 403
    const wrongRoleRes = await request(baseUrl, 'POST', '/api/auth/login', {
      body: { role: 'admin', contact: '9876543210' }
    });
    assert.equal(wrongRoleRes.status, 403);

    // Login with matching role and phone should succeed
    const loginRes = await request(baseUrl, 'POST', '/api/auth/login', {
      body: { role: 'citizen', contact: '9876543210' }
    });
    assert.equal(loginRes.status, 200);
    const cookie = loginRes.setCookie[0].split(';')[0];

    // 2. Submit report with explicit severity = 'high' -> stored as priority 'critical'
    const createRes = await request(baseUrl, 'POST', '/api/reports', {
      cookie,
      body: {
        category: 'pothole',
        severity: 'high',
        description: 'Large road crater near bus stop causing severe traffic slowdown',
        address: 'MG Road, Sector 4'
      }
    });
    assert.equal(createRes.status, 201);
    assert.equal(createRes.json.report.priority, 'critical');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});

test('Community resolution verification eligibility, uniqueness, staff decision, and anti-duplicate support', async () => {
  const { server, db } = createAppServer(':memory:');
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const priya = db.prepare("SELECT id FROM users WHERE email = 'priya@demo.civiq.local'").get();
    const rahul = db.prepare("SELECT id FROM users WHERE email = 'rahul@demo.civiq.local'").get();
    const staff = db.prepare("SELECT id FROM users WHERE role = 'staff' LIMIT 1").get();

    // Sign up a third independent citizen so we can test threshold = 2
    const signup3 = await request(baseUrl, 'POST', '/api/auth/signup', {
      body: { role: 'citizen', displayName: 'Citizen Three', contact: 'c3@demo.civiq.local' }
    });
    assert.equal(signup3.status, 201);
    const c3Cookie = signup3.setCookie[0].split(';')[0];

    const loginPriya = await request(baseUrl, 'POST', '/api/auth/demo-login', { body: { userId: priya.id } });
    const priyaCookie = loginPriya.setCookie[0].split(';')[0];
    const loginRahul = await request(baseUrl, 'POST', '/api/auth/demo-login', { body: { userId: rahul.id } });
    const rahulCookie = loginRahul.setCookie[0].split(';')[0];
    const loginStaff = await request(baseUrl, 'POST', '/api/auth/demo-login', { body: { userId: staff.id } });
    const staffCookie = loginStaff.setCookie[0].split(';')[0];

    // Seeded resolved report CIV-2026-00007 is owned by Priya and awaiting verification
    const resolvedRep = db.prepare("SELECT id FROM reports WHERE report_number = 'CIV-2026-00007'").get();

    // 1. Report owner (Priya) cannot vote on her own report's verification (403)
    const ownerVote = await request(baseUrl, 'POST', `/api/reports/${resolvedRep.id}/verify`, {
      cookie: priyaCookie,
      body: { vote: 'fixed' }
    });
    assert.equal(ownerVote.status, 403);

    // 2. Staff cannot submit a citizen verification vote (403)
    const staffVote = await request(baseUrl, 'POST', `/api/reports/${resolvedRep.id}/verify`, {
      cookie: staffCookie,
      body: { vote: 'fixed' }
    });
    assert.equal(staffVote.status, 403);

    // 3. Independent citizen (Rahul) can submit one verification vote (201)
    const rahulVote1 = await request(baseUrl, 'POST', `/api/reports/${resolvedRep.id}/verify`, {
      cookie: rahulCookie,
      body: { vote: 'fixed', comment: 'Looks clean now!' }
    });
    assert.equal(rahulVote1.status, 201);
    assert.equal(rahulVote1.json.fixedCount, 1);

    // 4. Rahul cannot vote twice (409)
    const rahulVote2 = await request(baseUrl, 'POST', `/api/reports/${resolvedRep.id}/verify`, {
      cookie: rahulCookie,
      body: { vote: 'fixed' }
    });
    assert.equal(rahulVote2.status, 409);

    // 5. Second independent citizen meets threshold (2) -> verified_resolved
    const c3Vote = await request(baseUrl, 'POST', `/api/reports/${resolvedRep.id}/verify`, {
      cookie: c3Cookie,
      body: { vote: 'fixed' }
    });
    assert.equal(c3Vote.status, 201);
    assert.equal(c3Vote.json.verificationState, 'verified_resolved');

    // 6. Staff can record an explicit verification decision (e.g. reopen if needed)
    const staffDecision = await request(baseUrl, 'POST', `/api/staff/reports/${resolvedRep.id}/verification-decision`, {
      cookie: staffCookie,
      body: { decision: 'confirm_resolved', explanation: 'Verified by field supervisor.' }
    });
    assert.equal(staffDecision.status, 200);
    assert.equal(staffDecision.json.verificationState, 'verified_resolved');

    // 7. Support existing active report (CIV-2026-00003) once, block duplicate, allow remove
    const activeRep = db.prepare("SELECT id FROM reports WHERE report_number = 'CIV-2026-00003'").get();
    const sup1 = await request(baseUrl, 'POST', `/api/reports/${activeRep.id}/support`, { cookie: rahulCookie });
    assert.equal(sup1.status, 201);
    assert.equal(sup1.json.supported, true);
    assert.equal(sup1.json.supportCount, 1);

    const supDup = await request(baseUrl, 'POST', `/api/reports/${activeRep.id}/support`, { cookie: rahulCookie });
    assert.equal(supDup.status, 409);

    const supDel = await request(baseUrl, 'DELETE', `/api/reports/${activeRep.id}/support`, { cookie: rahulCookie });
    assert.equal(supDel.status, 200);
    assert.equal(supDel.json.supported, false);
    assert.equal(supDel.json.supportCount, 0);

    // 8. Resolved/closed report cannot receive new support (400)
    const supResolved = await request(baseUrl, 'POST', `/api/reports/${resolvedRep.id}/support`, { cookie: rahulCookie });
    assert.equal(supResolved.status, 400);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});
