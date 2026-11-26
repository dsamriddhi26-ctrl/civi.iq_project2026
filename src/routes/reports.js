/**
 * Report Routes for Civ.IQ
 * 
 * Handles citizen report creation, viewing, tracking, and classification.
 */

'use strict';

const fs = require('node:fs');
const { requireAuth, getCurrentUser } = require('../middleware/auth.js');
const { parseMultipart, readJsonBody } = require('../middleware/upload.js');
const { generateUUID, generateReportNumber, sanitizeInput, validateCategory, validateStatus,
        extractExifGps, ALLOWED_CATEGORIES, ALLOWED_STATUSES } = require('../utils/helpers.js');
const { classifyReport, getDuplicateSuggestions } = require('../services/classifier.js');
const { calculateDeadline } = require('../services/sla.js');
const { createNotification, notifyReportUpdate } = require('../services/notifications.js');

/**
 * Register report routes
 * @param {object} db - Database instance
 * @returns {object} Route handlers
 */
function reportRoutes(db) {
  return {
    /**
     * POST /api/reports
     * Create a new report
     */
    async createReport(req, res) {
      const user = requireAuth(db, req, res);
      if (!user) return;

      try {
        const { fields, file } = await parseMultipart(req);

        // Validate required fields
        const description = sanitizeInput(fields.description || '');
        const category = fields.category;
        const isAnonymous = fields.is_anonymous === '1' || fields.is_anonymous === 'true' ? 1 : 0;
        let latitude = fields.latitude ? parseFloat(fields.latitude) : null;
        let longitude = fields.longitude ? parseFloat(fields.longitude) : null;
        const address = sanitizeInput(fields.address || '');

        // If user uploaded a geo-tagged JPEG without manual/GPS coordinates, extract EXIF GPS
        if (file && file.mimeType === 'image/jpeg' && (latitude === null || longitude === null)) {
          try {
            const imgBuf = fs.readFileSync(file.path);
            const exifGps = extractExifGps(imgBuf);
            if (exifGps) {
              latitude = exifGps.latitude;
              longitude = exifGps.longitude;
            }
          } catch {
            // Ignore EXIF read errors
          }
        }

        if (!description || description.length < 20) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Description must be at least 20 characters' }));
          return;
        }

        if (!validateCategory(category)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Invalid category. Allowed: ${ALLOWED_CATEGORIES.join(', ')}` }));
          return;
        }

        // Classify the report
        const classification = classifyReport(db, description, category, file ? { name: file.originalName, mime: file.mimeType, size: file.size } : null);

        // Look up department from routing rules
        let departmentId = classification.departmentId;
        let departmentName = classification.departmentName;
        
        // Fallback to General Services if no routing rule
        if (!departmentId) {
          const genSvc = db.prepare("SELECT id, name FROM departments WHERE name = 'General Services'").get();
          if (genSvc) {
            departmentId = genSvc.id;
            departmentName = genSvc.name;
          }
        }

        const reportId = generateUUID();
        const reportNumber = generateReportNumber(db);
        const now = new Date().toISOString();

        // Map optional user-selected severity (high/medium/low/critical) to internal priority
        const rawSeverity = String(fields.severity || fields.priority || '').trim().toLowerCase();
        const severityMap = { high: 'critical', critical: 'critical', medium: 'medium', low: 'low' };
        const priority = severityMap[rawSeverity] || classification.priority || 'medium';
        const slaDeadline = calculateDeadline(db, priority, now);

        const insertStmt = db.prepare(`
          INSERT INTO reports (
            id, report_number, user_id, category, description,
            image_path, image_original_name, image_mime_type, image_size,
            latitude, longitude, address, is_anonymous,
            status, priority, department_id,
            ai_suggested_category, ai_suggested_priority, ai_suggested_department_id,
            classification_source, sla_deadline,
            created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        insertStmt.run(
          reportId, reportNumber, user.id, category, description,
          file ? file.savedName : null,
          file ? file.originalName : null,
          file ? file.mimeType : null,
          file ? file.size : null,
          latitude, longitude, address, isAnonymous,
          priority, departmentId,
          classification.category, classification.priority, classification.departmentId,
          classification.source,
          slaDeadline,
          now, now
        );

        // Create initial status history entry
        const historyStmt = db.prepare(`
          INSERT INTO status_history (id, report_id, old_status, new_status, changed_by, note, is_citizen_visible, created_at)
          VALUES (?, ?, NULL, 'submitted', ?, 'Report submitted', 1, ?)
        `);
        historyStmt.run(generateUUID(), reportId, user.id, now);

        // Create audit log entry
        const auditStmt = db.prepare(`
          INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, new_value, created_at)
          VALUES (?, ?, 'create', 'report', ?, ?, ?)
        `);
        auditStmt.run(generateUUID(), user.id, reportId, JSON.stringify({ category, priority, department: departmentName }), now);

        // Store duplicate suggestions if any
        if (latitude && longitude) {
          const duplicates = getDuplicateSuggestions(db, latitude, longitude, category, description, reportId);
          for (const dup of duplicates) {
            const dupStmt = db.prepare(`
              INSERT INTO duplicate_suggestions (id, report_id, duplicate_of_id, similarity_score, distance_meters, source, status, created_at)
              VALUES (?, ?, ?, ?, ?, 'rules_engine', 'pending', ?)
            `);
            dupStmt.run(generateUUID(), reportId, dup.reportId, dup.similarity_score, dup.distance_meters, now);
          }
        }

        // Notify staff about new report
        const staffUsers = db.prepare("SELECT id FROM users WHERE role IN ('staff', 'admin')").all();
        for (const s of staffUsers) {
          createNotification(db, s.id, reportId, 'new_report',
            'New Report Submitted',
            `New ${category.replace('_', ' ')} report: ${reportNumber} — ${description.substring(0, 80)}...`
          );
        }

        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          message: 'Report submitted successfully',
          report: {
            id: reportId,
            reportNumber,
            category,
            priority,
            status: 'submitted',
            department: departmentName,
            classification: {
              suggestedCategory: classification.category,
              suggestedPriority: classification.priority,
              suggestedDepartment: classification.departmentName,
              confidence: classification.confidence,
              source: classification.source,
              note: classification.notes
            },
            trackingUrl: `/#/report/${reportId}`,
            createdAt: now
          }
        }));
      } catch (e) {
        console.error('Create report error:', e.message);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    },

    /**
     * GET /api/reports/:id
     * Get report detail (public view — no internal notes)
     */
    getReport(req, res, reportId) {
      const user = getCurrentUser(db, req);

      const report = db.prepare(`
        SELECT r.*, d.name as department_name,
               u.display_name as reporter_name, u.alias as reporter_alias
        FROM reports r
        LEFT JOIN departments d ON r.department_id = d.id
        LEFT JOIN users u ON r.user_id = u.id
        WHERE r.id = ?
      `).get(reportId);

      if (!report) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Report not found' }));
        return;
      }

      // Get public status history
      const statusHistory = db.prepare(`
        SELECT sh.*, u.display_name as changed_by_name
        FROM status_history sh
        LEFT JOIN users u ON sh.changed_by = u.id
        WHERE sh.report_id = ? AND sh.is_citizen_visible = 1
        ORDER BY sh.created_at ASC
      `).all(reportId);

      // Get citizen-visible updates
      const citizenUpdates = db.prepare(`
        SELECT cu.*, u.display_name as author_name
        FROM citizen_updates cu
        LEFT JOIN users u ON cu.user_id = u.id
        WHERE cu.report_id = ?
        ORDER BY cu.created_at DESC
      `).all(reportId);

      // Get upvote & support counts and whether current user has upvoted/supported
      const upvoteCount = db.prepare('SELECT COUNT(*) as count FROM upvotes WHERE report_id = ?').get(reportId).count;
      const supportCount = db.prepare('SELECT COUNT(*) as count FROM report_supports WHERE report_id = ?').get(reportId).count;
      let userUpvoted = false;
      let userSupported = false;
      let userVerificationVote = null;
      if (user) {
        userUpvoted = !!db.prepare('SELECT 1 FROM upvotes WHERE report_id = ? AND user_id = ?').get(reportId, user.id);
        userSupported = !!db.prepare('SELECT 1 FROM report_supports WHERE report_id = ? AND user_id = ?').get(reportId, user.id);
        const uv = db.prepare('SELECT vote FROM resolution_verifications WHERE report_id = ? AND user_id = ? AND is_active = 1').get(reportId, user.id);
        if (uv) userVerificationVote = uv.vote;
      }

      // Community resolution verification summary & public feedback (no private user info)
      const verifRows = db.prepare(`
        SELECT rv.id, rv.vote, rv.comment, rv.image_path, rv.created_at,
               u.alias as verifier_alias
        FROM resolution_verifications rv
        LEFT JOIN users u ON rv.user_id = u.id
        WHERE rv.report_id = ? AND rv.is_active = 1
        ORDER BY rv.created_at DESC
      `).all(reportId);
      const fixedCount = verifRows.filter(v => v.vote === 'fixed').length;
      const stillPresentCount = verifRows.filter(v => v.vote === 'still_present').length;
      const fixedThreshold = parseInt(db.prepare("SELECT value FROM app_settings WHERE key = 'verification_fixed_threshold'").get()?.value || '2', 10);
      const reopenThreshold = parseInt(db.prepare("SELECT value FROM app_settings WHERE key = 'verification_reopen_threshold'").get()?.value || '2', 10);
      const canUserVerify = !!(
        user &&
        user.role === 'citizen' &&
        user.id !== report.user_id &&
        report.status === 'resolved' &&
        report.verification_state === 'awaiting' &&
        !userVerificationVote
      );

      // Get duplicate suggestions (public — only confirmed ones for citizens)
      let duplicates = [];
      if (user && (user.role === 'staff' || user.role === 'admin')) {
        duplicates = db.prepare(`
          SELECT ds.*, r.report_number, r.description as dup_description, r.category as dup_category
          FROM duplicate_suggestions ds
          LEFT JOIN reports r ON ds.duplicate_of_id = r.id
          WHERE ds.report_id = ?
          ORDER BY ds.similarity_score DESC
        `).all(reportId);
      }

      // Build public response
      const responseReport = {
        id: report.id,
        reportNumber: report.report_number,
        category: report.category,
        description: report.description,
        imagePath: report.image_path ? `/uploads/${report.image_path}` : null,
        latitude: report.latitude,
        longitude: report.longitude,
        address: report.address,
        isAnonymous: !!report.is_anonymous,
        reporterName: report.is_anonymous ? 'Community Member' : (report.reporter_alias || report.reporter_name),
        status: report.status,
        priority: report.priority,
        departmentName: report.department_name,
        classificationSource: report.classification_source,
        upvoteCount,
        userUpvoted,
        supportCount,
        userSupported,
        verification: {
          state: report.verification_state || 'none',
          deadline: report.verification_deadline || null,
          verifiedAt: report.verified_at || null,
          fixedCount,
          stillPresentCount,
          fixedThreshold,
          reopenThreshold,
          userVote: userVerificationVote,
          canVerify: canUserVerify,
          entries: verifRows.map(v => ({
            id: v.id,
            vote: v.vote,
            comment: v.comment,
            imagePath: v.image_path ? `/uploads/${v.image_path}` : null,
            author: v.verifier_alias || 'Verified Citizen',
            createdAt: v.created_at
          }))
        },
        isPaused: !!report.is_paused,
        pausedReason: report.paused_reason,
        slaDeadline: report.sla_deadline,
        createdAt: report.created_at,
        updatedAt: report.updated_at,
        isOwner: user ? user.id === report.user_id : false,
        statusHistory: statusHistory.map(sh => ({
          status: sh.new_status,
          note: sh.note,
          changedBy: sh.changed_by_name,
          createdAt: sh.created_at
        })),
        citizenUpdates: citizenUpdates.map(cu => ({
          id: cu.id,
          content: cu.content,
          author: cu.author_name,
          createdAt: cu.created_at
        })),
        duplicates: duplicates.map(d => ({
          id: d.id,
          reportNumber: d.report_number,
          description: d.dup_description,
          category: d.dup_category,
          similarityScore: d.similarity_score,
          distance: d.distance_meters,
          status: d.status,
          source: d.source
        }))
      };

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ report: responseReport }));
    },

    /**
     * GET /api/reports/my
     * Get current user's reports
     */
    getMyReports(req, res) {
      const user = requireAuth(db, req, res);
      if (!user) return;

      const reports = db.prepare(`
        SELECT r.*, d.name as department_name
        FROM reports r
        LEFT JOIN departments d ON r.department_id = d.id
        WHERE r.user_id = ?
        ORDER BY r.created_at DESC
      `).all(user.id);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        reports: reports.map(r => ({
          id: r.id,
          reportNumber: r.report_number,
          category: r.category,
          description: r.description,
          status: r.status,
          priority: r.priority,
          departmentName: r.department_name,
          upvoteCount: r.upvote_count,
          createdAt: r.created_at,
          updatedAt: r.updated_at
        }))
      }));
    },

    /**
     * GET /api/reports/classify
     * Get AI/rules classification suggestion
     * Query: description, category
     */
    classifyReportEndpoint(req, res) {
      const user = requireAuth(db, req, res);
      if (!user) return;

      const url = new URL(req.url, 'http://localhost');
      const description = url.searchParams.get('description') || '';
      const category = url.searchParams.get('category') || '';

      const result = classifyReport(db, description, category, null);
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        classification: {
          category: result.category,
          priority: result.priority,
          department: result.departmentName,
          confidence: result.confidence,
          source: result.source,
          note: result.notes,
          label: 'Rules-based demo analysis'
        }
      }));
    },

    /**
     * GET /api/reports/duplicates
     * Get potential duplicate suggestions
     * Query: lat, lng, category, description
     */
    getDuplicatesEndpoint(req, res) {
      const url = new URL(req.url, 'http://localhost');
      const lat = parseFloat(url.searchParams.get('lat') || '0');
      const lng = parseFloat(url.searchParams.get('lng') || '0');
      const category = url.searchParams.get('category') || '';
      const description = url.searchParams.get('description') || '';
      const excludeId = url.searchParams.get('excludeId') || '';

      if (!lat || !lng) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ duplicates: [], label: 'Rules-based demo analysis — Location required for duplicate detection' }));
        return;
      }

      const duplicates = getDuplicateSuggestions(db, lat, lng, category, description, excludeId);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        duplicates: duplicates.map(d => ({
          reportId: d.reportId,
          reportNumber: d.reportNumber,
          description: d.description,
          category: d.category,
          address: d.address || null,
          status: d.status,
          supportCount: d.support_count || 0,
          distance: Math.round(d.distance_meters),
          score: Math.round(d.similarity_score * 100) / 100,
          source: 'rules_engine'
        })),
        label: 'Rules-based demo analysis',
        radius: parseInt(db.prepare("SELECT value FROM app_settings WHERE key = 'duplicate_radius_meters'").get()?.value || '500')
      }));
    },

    /**
     * POST /api/reports/:id/upvote
     * Toggle upvote on a report (one per user)
     */
    toggleUpvote(req, res, reportId) {
      const user = requireAuth(db, req, res);
      if (!user) return;

      const report = db.prepare('SELECT id, user_id, upvote_count FROM reports WHERE id = ?').get(reportId);
      if (!report) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Report not found' }));
        return;
      }

      // Check if already upvoted
      const existing = db.prepare('SELECT id FROM upvotes WHERE report_id = ? AND user_id = ?').get(reportId, user.id);

      if (existing) {
        // Remove upvote
        db.prepare('DELETE FROM upvotes WHERE id = ?').run(existing.id);
        db.prepare('UPDATE reports SET upvote_count = MAX(0, upvote_count - 1) WHERE id = ?').run(reportId);
        const newCount = db.prepare('SELECT upvote_count FROM reports WHERE id = ?').get(reportId).upvote_count;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ upvoted: false, upvoteCount: newCount }));
      } else {
        // Add upvote
        db.prepare('INSERT INTO upvotes (id, report_id, user_id, created_at) VALUES (?, ?, ?, ?)').run(
          generateUUID(), reportId, user.id, new Date().toISOString()
        );
        db.prepare('UPDATE reports SET upvote_count = upvote_count + 1 WHERE id = ?').run(reportId);
        const newCount = db.prepare('SELECT upvote_count FROM reports WHERE id = ?').get(reportId).upvote_count;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ upvoted: true, upvoteCount: newCount }));
      }
    },

    /**
     * POST /api/reports/:id/support
     * Support an active existing report instead of filing a duplicate
     */
    addSupport(req, res, reportId) {
      const user = requireAuth(db, req, res);
      if (!user) return;

      if (user.role !== 'citizen') {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Only citizens can add report support' }));
        return;
      }

      const report = db.prepare('SELECT id, status, verification_state FROM reports WHERE id = ?').get(reportId);
      if (!report) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Report not found' }));
        return;
      }

      if (['resolved', 'closed'].includes(report.status)) {
        const alt = report.verification_state === 'awaiting'
          ? 'You can submit community verification feedback instead.'
          : 'Please file a new report if the issue has returned.';
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: `This report is already ${report.status} and cannot receive new support. ${alt}`
        }));
        return;
      }

      const existing = db.prepare('SELECT id FROM report_supports WHERE report_id = ? AND user_id = ?').get(reportId, user.id);
      if (existing) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'You are already supporting this report' }));
        return;
      }

      const now = new Date().toISOString();
      db.prepare('INSERT INTO report_supports (id, report_id, user_id, created_at) VALUES (?, ?, ?, ?)')
        .run(generateUUID(), reportId, user.id, now);
      db.prepare('UPDATE reports SET support_count = (SELECT COUNT(*) FROM report_supports WHERE report_id = ?) WHERE id = ?')
        .run(reportId, reportId);
      db.prepare(`
        INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, new_value, created_at)
        VALUES (?, ?, 'add_support', 'report', ?, ?, ?)
      `).run(generateUUID(), user.id, reportId, JSON.stringify({ supported: true }), now);

      const newCount = db.prepare('SELECT support_count FROM reports WHERE id = ?').get(reportId).support_count;
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ supported: true, supportCount: newCount }));
    },

    /**
     * DELETE /api/reports/:id/support
     * Remove citizen support from an active report
     */
    removeSupport(req, res, reportId) {
      const user = requireAuth(db, req, res);
      if (!user) return;

      const report = db.prepare('SELECT id, status FROM reports WHERE id = ?').get(reportId);
      if (!report) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Report not found' }));
        return;
      }

      if (['resolved', 'closed'].includes(report.status)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Cannot remove support from a ${report.status} report` }));
        return;
      }

      const existing = db.prepare('SELECT id FROM report_supports WHERE report_id = ? AND user_id = ?').get(reportId, user.id);
      if (!existing) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Support record not found' }));
        return;
      }

      const now = new Date().toISOString();
      db.prepare('DELETE FROM report_supports WHERE id = ?').run(existing.id);
      db.prepare('UPDATE reports SET support_count = (SELECT COUNT(*) FROM report_supports WHERE report_id = ?) WHERE id = ?')
        .run(reportId, reportId);
      db.prepare(`
        INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, old_value, new_value, created_at)
        VALUES (?, ?, 'remove_support', 'report', ?, ?, ?, ?)
      `).run(generateUUID(), user.id, reportId, JSON.stringify({ supported: true }), JSON.stringify({ supported: false }), now);

      const newCount = db.prepare('SELECT support_count FROM reports WHERE id = ?').get(reportId).support_count;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ supported: false, supportCount: newCount }));
    },

    /**
     * POST /api/reports/:id/verify
     * Submit a community resolution verification vote ('fixed' or 'still_present')
     * Eligibility: authenticated citizen, not report owner, report is resolved & awaiting verification, 1 active vote max.
     */
    async submitVerification(req, res, reportId) {
      const user = requireAuth(db, req, res);
      if (!user) return;

      if (user.role !== 'citizen') {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Only independent citizens can submit community verification votes' }));
        return;
      }

      try {
        const { fields, file } = await parseMultipart(req);
        const vote = String(fields.vote || '').trim().toLowerCase();
        const comment = sanitizeInput(fields.comment || '');

        if (!['fixed', 'still_present'].includes(vote)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Vote must be "fixed" or "still_present"' }));
          return;
        }

        const report = db.prepare('SELECT id, report_number, user_id, status, verification_state FROM reports WHERE id = ?').get(reportId);
        if (!report) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Report not found' }));
          return;
        }

        if (report.user_id === user.id) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Report owners cannot vote on their own community verification' }));
          return;
        }

        if (report.status !== 'resolved' || report.verification_state !== 'awaiting') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'This report is not currently awaiting community verification' }));
          return;
        }

        const existingVote = db.prepare(
          'SELECT id FROM resolution_verifications WHERE report_id = ? AND user_id = ? AND is_active = 1'
        ).get(reportId, user.id);
        if (existingVote) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'You have already submitted an active verification vote for this report' }));
          return;
        }

        const now = new Date().toISOString();
        const verifId = generateUUID();

        db.prepare(`
          INSERT INTO resolution_verifications (id, report_id, user_id, vote, comment, image_path, is_active, created_at)
          VALUES (?, ?, ?, ?, ?, ?, 1, ?)
        `).run(verifId, reportId, user.id, vote, comment || null, file ? file.savedName : null, now);

        db.prepare(`
          INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, new_value, created_at)
          VALUES (?, ?, 'community_verification_vote', 'report', ?, ?, ?)
        `).run(generateUUID(), user.id, reportId, JSON.stringify({ vote, hasComment: !!comment, hasPhoto: !!file }), now);

        // Evaluate thresholds
        const fixedCount = db.prepare("SELECT COUNT(*) as c FROM resolution_verifications WHERE report_id = ? AND is_active = 1 AND vote = 'fixed'").get(reportId).c;
        const stillPresentCount = db.prepare("SELECT COUNT(*) as c FROM resolution_verifications WHERE report_id = ? AND is_active = 1 AND vote = 'still_present'").get(reportId).c;
        const fixedThreshold = parseInt(db.prepare("SELECT value FROM app_settings WHERE key = 'verification_fixed_threshold'").get()?.value || '2', 10);
        const reopenThreshold = parseInt(db.prepare("SELECT value FROM app_settings WHERE key = 'verification_reopen_threshold'").get()?.value || '2', 10);

        let newVerificationState = report.verification_state;
        let newStatus = report.status;

        if (fixedCount >= fixedThreshold) {
          newVerificationState = 'verified_resolved';
          db.prepare('UPDATE reports SET verification_state = ?, verified_at = ?, updated_at = ? WHERE id = ?')
            .run(newVerificationState, now, now, reportId);
          db.prepare(`
            INSERT INTO status_history (id, report_id, old_status, new_status, changed_by, note, is_citizen_visible, created_at)
            VALUES (?, ?, 'resolved', 'resolved', ?, ?, 1, ?)
          `).run(generateUUID(), reportId, user.id, `Community verified resolved (${fixedCount} confirmations)`, now);
          db.prepare(`
            INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, old_value, new_value, created_at)
            VALUES (?, ?, 'verification_threshold_met', 'report', ?, ?, ?, ?)
          `).run(generateUUID(), user.id, reportId, JSON.stringify({ verificationState: 'awaiting' }), JSON.stringify({ verificationState: 'verified_resolved', fixedCount }), now);
        } else if (stillPresentCount >= reopenThreshold) {
          newVerificationState = 'needs_followup';
          newStatus = 'reopened';
          db.prepare('UPDATE reports SET status = ?, verification_state = ?, updated_at = ? WHERE id = ?')
            .run(newStatus, newVerificationState, now, reportId);
          db.prepare(`
            INSERT INTO status_history (id, report_id, old_status, new_status, changed_by, note, is_citizen_visible, created_at)
            VALUES (?, ?, 'resolved', 'reopened', ?, ?, 1, ?)
          `).run(generateUUID(), reportId, user.id, `Reopened after ${stillPresentCount} community reports that the issue is still present`, now);
          db.prepare(`
            INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, old_value, new_value, created_at)
            VALUES (?, ?, 'verification_reopened', 'report', ?, ?, ?, ?)
          `).run(generateUUID(), user.id, reportId, JSON.stringify({ status: 'resolved' }), JSON.stringify({ status: 'reopened', stillPresentCount }), now);

          const staffUsers = db.prepare("SELECT id FROM users WHERE role IN ('staff', 'admin')").all();
          for (const s of staffUsers) {
            createNotification(db, s.id, reportId, 'verification_followup',
              `Follow-up Needed: ${report.report_number}`,
              `Community verification reported that ${report.report_number} is still present and it has been reopened.`
            );
          }
        }

        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          message: 'Verification vote recorded',
          vote,
          verificationState: newVerificationState,
          status: newStatus,
          fixedCount,
          stillPresentCount
        }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    }
  };
}

module.exports = { reportRoutes };
