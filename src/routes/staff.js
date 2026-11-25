/**
 * Staff Routes for Civ.IQ
 * 
 * Handles staff and admin actions: report management, assignments,
 * status updates, internal notes, escalation checks.
 */

'use strict';

const { requireStaff, requireAdmin } = require('../middleware/auth.js');
const { readJsonBody } = require('../middleware/upload.js');
const { generateUUID, sanitizeInput, validateStatus, validatePriority,
        STATUS_TRANSITIONS } = require('../utils/helpers.js');
const { calculateDeadline, checkEscalations } = require('../services/sla.js');
const { createNotification, notifyReportUpdate } = require('../services/notifications.js');

/**
 * Register staff routes
 * @param {object} db - Database instance
 * @returns {object} Route handlers
 */
function staffRoutes(db) {
  return {
    /**
     * GET /api/staff/reports
     * Get all reports with filters (staff only)
     */
    getAllReports(req, res) {
      const user = requireStaff(db, req, res);
      if (!user) return;

      const url = new URL(req.url, 'http://localhost');
      const status = url.searchParams.get('status');
      const priority = url.searchParams.get('priority');
      const category = url.searchParams.get('category');
      const department = url.searchParams.get('department');
      const search = url.searchParams.get('search');
      const sortBy = url.searchParams.get('sort') || 'created_at';
      const order = url.searchParams.get('order') === 'asc' ? 'ASC' : 'DESC';
      const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
      const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '20')));
      const offset = (page - 1) * limit;

      let where = ['1=1'];
      let params = [];

      if (status) {
        where.push('r.status = ?');
        params.push(status);
      }
      if (priority) {
        where.push('r.priority = ?');
        params.push(priority);
      }
      if (category) {
        where.push('r.category = ?');
        params.push(category);
      }
      if (department) {
        where.push('r.department_id = ?');
        params.push(department);
      }
      if (search) {
        where.push('(r.description LIKE ? OR r.report_number LIKE ?)');
        params.push(`%${search}%`, `%${search}%`);
      }

      const allowedSorts = ['created_at', 'updated_at', 'priority', 'status', 'category'];
      const sortCol = allowedSorts.includes(sortBy) ? sortBy : 'created_at';

      const countQuery = `SELECT COUNT(*) as total FROM reports r WHERE ${where.join(' AND ')}`;
      const total = db.prepare(countQuery).get(...params).total;

      const query = `
        SELECT r.*, d.name as department_name,
               u.display_name as reporter_name,
               a.display_name as assigned_to_name
        FROM reports r
        LEFT JOIN departments d ON r.department_id = d.id
        LEFT JOIN users u ON r.user_id = u.id
        LEFT JOIN users a ON r.assigned_to = a.id
        WHERE ${where.join(' AND ')}
        ORDER BY 
          CASE WHEN r.priority = 'critical' THEN 0 WHEN r.priority = 'medium' THEN 1 ELSE 2 END,
          r.${sortCol} ${order}
        LIMIT ? OFFSET ?
      `;

      const reports = db.prepare(query).all(...params, limit, offset);

      // Check overdue status for each report
      const now = new Date().toISOString();
      const enrichedReports = reports.map(r => ({
        id: r.id,
        reportNumber: r.report_number,
        category: r.category,
        description: r.description,
        imagePath: r.image_path ? `/uploads/${r.image_path}` : null,
        latitude: r.latitude,
        longitude: r.longitude,
        address: r.address,
        isAnonymous: !!r.is_anonymous,
        reporterName: r.reporter_name,
        status: r.status,
        priority: r.priority,
        departmentName: r.department_name,
        assignedToName: r.assigned_to_name,
        assignedTo: r.assigned_to,
        departmentId: r.department_id,
        upvoteCount: r.upvote_count,
        escalationLevel: r.escalation_level,
        isPaused: !!r.is_paused,
        pausedReason: r.paused_reason,
        slaDeadline: r.sla_deadline,
        isOverdue: r.sla_deadline && now > r.sla_deadline && !['resolved', 'closed'].includes(r.status),
        classificationSource: r.classification_source,
        createdAt: r.created_at,
        updatedAt: r.updated_at
      }));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        reports: enrichedReports,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      }));
    },

    /**
     * GET /api/staff/reports/:id
     * Get full report detail including internal notes (staff only)
     */
    getReportDetail(req, res, reportId) {
      const user = requireStaff(db, req, res);
      if (!user) return;

      const report = db.prepare(`
        SELECT r.*, d.name as department_name,
               u.display_name as reporter_name, u.email as reporter_email,
               a.display_name as assigned_to_name
        FROM reports r
        LEFT JOIN departments d ON r.department_id = d.id
        LEFT JOIN users u ON r.user_id = u.id
        LEFT JOIN users a ON r.assigned_to = a.id
        WHERE r.id = ?
      `).get(reportId);

      if (!report) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Report not found' }));
        return;
      }

      // Full status history (including staff-only entries)
      const statusHistory = db.prepare(`
        SELECT sh.*, u.display_name as changed_by_name
        FROM status_history sh
        LEFT JOIN users u ON sh.changed_by = u.id
        WHERE sh.report_id = ?
        ORDER BY sh.created_at ASC
      `).all(reportId);

      // Assignment history
      const assignments = db.prepare(`
        SELECT a.*, u.display_name as assigned_to_name,
               ab.display_name as assigned_by_name,
               d.name as department_name
        FROM assignments a
        LEFT JOIN users u ON a.assigned_to = u.id
        LEFT JOIN users ab ON a.assigned_by = ab.id
        LEFT JOIN departments d ON a.department_id = d.id
        WHERE a.report_id = ?
        ORDER BY a.created_at DESC
      `).all(reportId);

      // Internal notes (staff only - NOT exposed to citizens)
      const internalNotes = db.prepare(`
        SELECT n.*, u.display_name as author_name
        FROM internal_notes n
        LEFT JOIN users u ON n.user_id = u.id
        WHERE n.report_id = ?
        ORDER BY n.created_at DESC
      `).all(reportId);

      // Citizen-visible updates
      const citizenUpdates = db.prepare(`
        SELECT cu.*, u.display_name as author_name
        FROM citizen_updates cu
        LEFT JOIN users u ON cu.user_id = u.id
        WHERE cu.report_id = ?
        ORDER BY cu.created_at DESC
      `).all(reportId);

      // Duplicate suggestions
      const duplicates = db.prepare(`
        SELECT ds.*, r.report_number, r.description as dup_description, r.category as dup_category, r.status as dup_status,
               u.display_name as decided_by_name
        FROM duplicate_suggestions ds
        LEFT JOIN reports r ON ds.duplicate_of_id = r.id
        LEFT JOIN users u ON ds.decided_by = u.id
        WHERE ds.report_id = ?
        ORDER BY ds.similarity_score DESC
      `).all(reportId);

      // Escalation records
      const escalations = db.prepare(`
        SELECT e.*, u.display_name as acknowledged_by_name
        FROM escalation_records e
        LEFT JOIN users u ON e.acknowledged_by = u.id
        WHERE e.report_id = ?
        ORDER BY e.escalated_at DESC
      `).all(reportId);

      // Audit log
      const auditLog = db.prepare(`
        SELECT al.*, u.display_name as user_name
        FROM audit_log al
        LEFT JOIN users u ON al.user_id = u.id
        WHERE al.entity_type = 'report' AND al.entity_id = ?
        ORDER BY al.created_at DESC
      `).all(reportId);

      const now = new Date().toISOString();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        report: {
          id: report.id,
          reportNumber: report.report_number,
          category: report.category,
          description: report.description,
          imagePath: report.image_path ? `/uploads/${report.image_path}` : null,
          imageOriginalName: report.image_original_name,
          imageMimeType: report.image_mime_type,
          imageSize: report.image_size,
          latitude: report.latitude,
          longitude: report.longitude,
          address: report.address,
          isAnonymous: !!report.is_anonymous,
          reporterName: report.reporter_name,
          reporterEmail: report.reporter_email,
          userId: report.user_id,
          status: report.status,
          priority: report.priority,
          departmentName: report.department_name,
          departmentId: report.department_id,
          assignedTo: report.assigned_to,
          assignedToName: report.assigned_to_name,
          aiSuggestedCategory: report.ai_suggested_category,
          aiSuggestedPriority: report.ai_suggested_priority,
          aiSuggestedDepartmentId: report.ai_suggested_department_id,
          classificationSource: report.classification_source,
          isDuplicate: !!report.is_duplicate,
          duplicateOf: report.duplicate_of,
          upvoteCount: report.upvote_count,
          escalationLevel: report.escalation_level,
          isPaused: !!report.is_paused,
          pausedAt: report.paused_at,
          pausedReason: report.paused_reason,
          slaDeadline: report.sla_deadline,
          isOverdue: report.sla_deadline && now > report.sla_deadline && !['resolved', 'closed'].includes(report.status),
          createdAt: report.created_at,
          updatedAt: report.updated_at,
          statusHistory: statusHistory.map(sh => ({
            id: sh.id,
            oldStatus: sh.old_status,
            newStatus: sh.new_status,
            changedBy: sh.changed_by_name,
            note: sh.note,
            isCitizenVisible: !!sh.is_citizen_visible,
            createdAt: sh.created_at
          })),
          assignments: assignments.map(a => ({
            id: a.id,
            assignedTo: a.assigned_to_name,
            department: a.department_name,
            assignedBy: a.assigned_by_name,
            note: a.note,
            createdAt: a.created_at
          })),
          internalNotes: internalNotes.map(n => ({
            id: n.id,
            content: n.content,
            author: n.author_name,
            createdAt: n.created_at
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
            dupStatus: d.dup_status,
            similarityScore: d.similarity_score,
            distance: d.distance_meters,
            source: d.source,
            status: d.status,
            decidedBy: d.decided_by_name,
            decidedAt: d.decided_at
          })),
          escalations: escalations.map(e => ({
            id: e.id,
            level: e.escalation_level,
            reason: e.reason,
            escalatedAt: e.escalated_at,
            acknowledgedBy: e.acknowledged_by_name,
            acknowledgedAt: e.acknowledged_at
          })),
          auditLog: auditLog.map(a => ({
            id: a.id,
            action: a.action,
            userName: a.user_name,
            oldValue: a.old_value ? JSON.parse(a.old_value) : null,
            newValue: a.new_value ? JSON.parse(a.new_value) : null,
            createdAt: a.created_at
          }))
        }
      }));
    },

    /**
     * PUT /api/staff/reports/:id/status
     * Update report status (staff only)
     */
    async updateStatus(req, res, reportId) {
      const user = requireStaff(db, req, res);
      if (!user) return;

      try {
        const body = await readJsonBody(req);
        const { status: newStatus, note, isCitizenVisible = true } = body;

        if (!validateStatus(newStatus)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid status' }));
          return;
        }

        const report = db.prepare('SELECT id, status, priority, user_id FROM reports WHERE id = ?').get(reportId);
        if (!report) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Report not found' }));
          return;
        }

        // Check valid transition
        const allowedTransitions = STATUS_TRANSITIONS[report.status] || [];
        if (!allowedTransitions.includes(newStatus)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ 
            error: `Cannot transition from '${report.status}' to '${newStatus}'. Allowed: ${allowedTransitions.join(', ')}` 
          }));
          return;
        }

        const now = new Date().toISOString();

        // Update report
        db.prepare('UPDATE reports SET status = ?, updated_at = ? WHERE id = ?').run(newStatus, now, reportId);

        // Create status history
        db.prepare(`
          INSERT INTO status_history (id, report_id, old_status, new_status, changed_by, note, is_citizen_visible, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(generateUUID(), reportId, report.status, newStatus, user.id, sanitizeInput(note || ''), isCitizenVisible ? 1 : 0, now);

        // Audit log
        db.prepare(`
          INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, old_value, new_value, created_at)
          VALUES (?, ?, 'status_change', 'report', ?, ?, ?, ?)
        `).run(generateUUID(), user.id, reportId, JSON.stringify({ status: report.status }), JSON.stringify({ status: newStatus, note }), now);

        // Notify report owner
        createNotification(db, report.user_id, reportId, 'status_change',
          'Report Status Updated',
          `Your report has been updated to: ${newStatus.replace('_', ' ').toUpperCase()}`
        );

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Status updated', newStatus }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    },

    /**
     * PUT /api/staff/reports/:id/priority
     * Update report priority (staff only)
     */
    async updatePriority(req, res, reportId) {
      const user = requireStaff(db, req, res);
      if (!user) return;

      try {
        const body = await readJsonBody(req);
        const { priority } = body;

        if (!validatePriority(priority)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid priority. Must be: critical, medium, or low' }));
          return;
        }

        const report = db.prepare('SELECT id, priority, user_id FROM reports WHERE id = ?').get(reportId);
        if (!report) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Report not found' }));
          return;
        }

        const now = new Date().toISOString();
        const newDeadline = calculateDeadline(db, priority, report.created_at || now);

        db.prepare('UPDATE reports SET priority = ?, sla_deadline = ?, classification_source = ?, updated_at = ? WHERE id = ?')
          .run(priority, newDeadline, 'manual', now, reportId);

        // Audit log
        db.prepare(`
          INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, old_value, new_value, created_at)
          VALUES (?, ?, 'priority_change', 'report', ?, ?, ?, ?)
        `).run(generateUUID(), user.id, reportId, JSON.stringify({ priority: report.priority }), JSON.stringify({ priority, changedBy: user.display_name }), now);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Priority updated', priority, slaDeadline: newDeadline }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    },

    /**
     * PUT /api/staff/reports/:id/assign
     * Assign report to department/staff (staff only)
     */
    async assignReport(req, res, reportId) {
      const user = requireStaff(db, req, res);
      if (!user) return;

      try {
        const body = await readJsonBody(req);
        const { departmentId, assignedTo, note } = body;

        const report = db.prepare('SELECT id, department_id, assigned_to, user_id FROM reports WHERE id = ?').get(reportId);
        if (!report) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Report not found' }));
          return;
        }

        // Validate department exists
        if (departmentId) {
          const dept = db.prepare('SELECT id FROM departments WHERE id = ?').get(departmentId);
          if (!dept) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Department not found' }));
            return;
          }
        }

        // Validate assignee exists and is staff/admin
        if (assignedTo) {
          const assignee = db.prepare("SELECT id FROM users WHERE id = ? AND role IN ('staff', 'admin')").get(assignedTo);
          if (!assignee) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Assignee not found or is not staff' }));
            return;
          }
        }

        const now = new Date().toISOString();

        // Update report
        const updates = [];
        const params = [];
        if (departmentId !== undefined) {
          updates.push('department_id = ?');
          params.push(departmentId);
        }
        if (assignedTo !== undefined) {
          updates.push('assigned_to = ?');
          params.push(assignedTo);
        }
        updates.push('updated_at = ?');
        params.push(now);
        params.push(reportId);

        db.prepare(`UPDATE reports SET ${updates.join(', ')} WHERE id = ?`).run(...params);

        // If status is still 'submitted' or 'under_review', move to 'assigned'
        const currentReport = db.prepare('SELECT status FROM reports WHERE id = ?').get(reportId);
        if (['submitted', 'under_review'].includes(currentReport.status) && (departmentId || assignedTo)) {
          db.prepare('UPDATE reports SET status = ? WHERE id = ?').run('assigned', reportId);
          db.prepare(`
            INSERT INTO status_history (id, report_id, old_status, new_status, changed_by, note, is_citizen_visible, created_at)
            VALUES (?, ?, ?, 'assigned', ?, ?, 1, ?)
          `).run(generateUUID(), reportId, currentReport.status, user.id, 'Report assigned to department/staff', now);
        }

        // Create assignment record
        db.prepare(`
          INSERT INTO assignments (id, report_id, assigned_to, department_id, assigned_by, note, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(generateUUID(), reportId, assignedTo || null, departmentId || report.department_id, user.id, sanitizeInput(note || ''), now);

        // Audit log
        db.prepare(`
          INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, old_value, new_value, created_at)
          VALUES (?, ?, 'assign', 'report', ?, ?, ?, ?)
        `).run(generateUUID(), user.id, reportId,
          JSON.stringify({ departmentId: report.department_id, assignedTo: report.assigned_to }),
          JSON.stringify({ departmentId: departmentId || report.department_id, assignedTo, assignedBy: user.display_name }),
          now);

        // Notify assignee
        if (assignedTo) {
          createNotification(db, assignedTo, reportId, 'assigned',
            'Report Assigned to You',
            `Report ${report.id} has been assigned to you`
          );
        }

        // Notify report owner
        createNotification(db, report.user_id, reportId, 'assigned',
          'Report Assigned',
          'Your report has been assigned to a department for resolution'
        );

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Report assigned successfully' }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    },

    /**
     * POST /api/staff/reports/:id/notes
     * Add internal note (staff only — NOT visible to citizens)
     */
    async addInternalNote(req, res, reportId) {
      const user = requireStaff(db, req, res);
      if (!user) return;

      try {
        const body = await readJsonBody(req);
        const { content } = body;

        if (!content || content.trim().length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Content is required' }));
          return;
        }

        const report = db.prepare('SELECT id FROM reports WHERE id = ?').get(reportId);
        if (!report) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Report not found' }));
          return;
        }

        const noteId = generateUUID();
        const now = new Date().toISOString();

        db.prepare(`
          INSERT INTO internal_notes (id, report_id, user_id, content, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(noteId, reportId, user.id, sanitizeInput(content), now);

        // Audit log
        db.prepare(`
          INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, new_value, created_at)
          VALUES (?, ?, 'add_internal_note', 'report', ?, ?, ?)
        `).run(generateUUID(), user.id, reportId, JSON.stringify({ noteId }), now);

        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          message: 'Internal note added', 
          note: { id: noteId, content: sanitizeInput(content), author: user.display_name, createdAt: now } 
        }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    },

    /**
     * POST /api/staff/reports/:id/updates
     * Add citizen-visible update (staff only)
     */
    async addCitizenUpdate(req, res, reportId) {
      const user = requireStaff(db, req, res);
      if (!user) return;

      try {
        const body = await readJsonBody(req);
        const { content } = body;

        if (!content || content.trim().length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Content is required' }));
          return;
        }

        const report = db.prepare('SELECT id, user_id FROM reports WHERE id = ?').get(reportId);
        if (!report) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Report not found' }));
          return;
        }

        const updateId = generateUUID();
        const now = new Date().toISOString();

        db.prepare(`
          INSERT INTO citizen_updates (id, report_id, user_id, content, created_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(updateId, reportId, user.id, sanitizeInput(content), now);

        // Notify report owner
        createNotification(db, report.user_id, reportId, 'citizen_update',
          'Update on Your Report',
          `Staff update: ${content.substring(0, 100)}...`
        );

        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          message: 'Update published', 
          update: { id: updateId, content: sanitizeInput(content), author: user.display_name, createdAt: now } 
        }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    },

    /**
     * PUT /api/staff/reports/:id/duplicate
     * Confirm or reject a duplicate suggestion (staff only)
     */
    async handleDuplicate(req, res, reportId) {
      const user = requireStaff(db, req, res);
      if (!user) return;

      try {
        const body = await readJsonBody(req);
        const { suggestionId, decision } = body; // decision: 'confirmed' or 'rejected'

        if (!['confirmed', 'rejected'].includes(decision)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Decision must be "confirmed" or "rejected"' }));
          return;
        }

        const suggestion = db.prepare('SELECT * FROM duplicate_suggestions WHERE id = ? AND report_id = ?').get(suggestionId, reportId);
        if (!suggestion) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Suggestion not found' }));
          return;
        }

        const now = new Date().toISOString();

        db.prepare('UPDATE duplicate_suggestions SET status = ?, decided_by = ?, decided_at = ? WHERE id = ?')
          .run(decision, user.id, now, suggestionId);

        if (decision === 'confirmed') {
          db.prepare('UPDATE reports SET is_duplicate = 1, duplicate_of = ? WHERE id = ?')
            .run(suggestion.duplicate_of_id, reportId);
        }

        // Audit log
        db.prepare(`
          INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, old_value, new_value, created_at)
          VALUES (?, ?, 'duplicate_decision', 'report', ?, ?, ?, ?)
        `).run(generateUUID(), user.id, reportId,
          JSON.stringify({ suggestionId, previousStatus: suggestion.status }),
          JSON.stringify({ decision, decidedBy: user.display_name }),
          now);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: `Duplicate suggestion ${decision}`, decision }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    },

    /**
     * POST /api/staff/escalations/check
     * Run manual escalation check
     */
    runEscalationCheck(req, res) {
      const user = requireStaff(db, req, res);
      if (!user) return;

      try {
        const result = checkEscalations(db);
        
        // Audit log
        db.prepare(`
          INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, new_value, created_at)
          VALUES (?, ?, 'escalation_check', 'system', 'manual', ?, ?)
        `).run(generateUUID(), user.id, JSON.stringify(result), new Date().toISOString());

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          message: 'Escalation check completed',
          result
        }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    },

    /**
     * GET /api/staff/escalations
     * Get escalated/overdue reports
     */
    getEscalations(req, res) {
      const user = requireStaff(db, req, res);
      if (!user) return;

      const now = new Date().toISOString();

      // Get overdue reports
      const overdueReports = db.prepare(`
        SELECT r.*, d.name as department_name, a.display_name as assigned_to_name
        FROM reports r
        LEFT JOIN departments d ON r.department_id = d.id
        LEFT JOIN users a ON r.assigned_to = a.id
        WHERE r.sla_deadline IS NOT NULL 
          AND r.sla_deadline < ?
          AND r.status NOT IN ('resolved', 'closed')
        ORDER BY r.sla_deadline ASC
      `).all(now);

      // Get escalation records
      const escalationRecords = db.prepare(`
        SELECT e.*, r.report_number, r.description, r.priority, r.status,
               u.display_name as acknowledged_by_name
        FROM escalation_records e
        LEFT JOIN reports r ON e.report_id = r.id
        LEFT JOIN users u ON e.acknowledged_by = u.id
        ORDER BY e.escalated_at DESC
        LIMIT 50
      `).all();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        overdueReports: overdueReports.map(r => ({
          id: r.id,
          reportNumber: r.report_number,
          category: r.category,
          description: r.description,
          status: r.status,
          priority: r.priority,
          departmentName: r.department_name,
          assignedToName: r.assigned_to_name,
          slaDeadline: r.sla_deadline,
          escalationLevel: r.escalation_level,
          createdAt: r.created_at
        })),
        escalationRecords: escalationRecords.map(e => ({
          id: e.id,
          reportNumber: e.report_number,
          reportDescription: e.description,
          reportPriority: e.priority,
          reportStatus: e.status,
          level: e.escalation_level,
          reason: e.reason,
          escalatedAt: e.escalated_at,
          acknowledgedBy: e.acknowledged_by_name,
          acknowledgedAt: e.acknowledged_at
        }))
      }));
    },

    /**
     * GET /api/staff/dashboard
     * Get dashboard statistics (staff only)
     */
    getDashboard(req, res) {
      const user = requireStaff(db, req, res);
      if (!user) return;

      const now = new Date().toISOString();

      const totalReports = db.prepare('SELECT COUNT(*) as count FROM reports').get().count;
      
      const byStatus = db.prepare(`
        SELECT status, COUNT(*) as count FROM reports GROUP BY status
      `).all();

      const byPriority = db.prepare(`
        SELECT priority, COUNT(*) as count FROM reports WHERE priority IS NOT NULL GROUP BY priority
      `).all();

      const byCategory = db.prepare(`
        SELECT category, COUNT(*) as count FROM reports GROUP BY category
      `).all();

      const byDepartment = db.prepare(`
        SELECT d.name, COUNT(*) as count 
        FROM reports r 
        LEFT JOIN departments d ON r.department_id = d.id 
        GROUP BY r.department_id
      `).all();

      const overdueCount = db.prepare(`
        SELECT COUNT(*) as count FROM reports 
        WHERE sla_deadline IS NOT NULL AND sla_deadline < ? AND status NOT IN ('resolved', 'closed')
      `).get(now).count;

      const criticalCount = db.prepare(`
        SELECT COUNT(*) as count FROM reports WHERE priority = 'critical' AND status NOT IN ('resolved', 'closed')
      `).get().count;

      const openCount = db.prepare(`
        SELECT COUNT(*) as count FROM reports WHERE status NOT IN ('resolved', 'closed')
      `).get().count;

      const recentReports = db.prepare(`
        SELECT r.id, r.report_number, r.category, r.description, r.status, r.priority, r.created_at,
               d.name as department_name
        FROM reports r
        LEFT JOIN departments d ON r.department_id = d.id
        ORDER BY r.created_at DESC LIMIT 5
      `).all();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        stats: {
          total: totalReports,
          open: openCount,
          critical: criticalCount,
          overdue: overdueCount
        },
        byStatus: byStatus.reduce((acc, r) => { acc[r.status] = r.count; return acc; }, {}),
        byPriority: byPriority.reduce((acc, r) => { acc[r.priority] = r.count; return acc; }, {}),
        byCategory: byCategory.reduce((acc, r) => { acc[r.category] = r.count; return acc; }, {}),
        byDepartment: byDepartment.map(d => ({ name: d.name || 'Unassigned', count: d.count })),
        recentReports: recentReports.map(r => ({
          id: r.id,
          reportNumber: r.report_number,
          category: r.category,
          description: r.description,
          status: r.status,
          priority: r.priority,
          departmentName: r.department_name,
          createdAt: r.created_at
        }))
      }));
    },

    /**
     * PUT /api/staff/reports/:id/pause
     * Pause a report (awaiting info)
     */
    async pauseReport(req, res, reportId) {
      const user = requireStaff(db, req, res);
      if (!user) return;

      try {
        const body = await readJsonBody(req);
        const { reason } = body;

        const report = db.prepare('SELECT id, is_paused, user_id FROM reports WHERE id = ?').get(reportId);
        if (!report) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Report not found' }));
          return;
        }

        if (report.is_paused) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Report is already paused' }));
          return;
        }

        const now = new Date().toISOString();

        db.prepare('UPDATE reports SET is_paused = 1, paused_at = ?, paused_reason = ?, updated_at = ? WHERE id = ?')
          .run(now, sanitizeInput(reason || 'Awaiting additional information'), now, reportId);

        db.prepare(`
          INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, new_value, created_at)
          VALUES (?, ?, 'pause', 'report', ?, ?, ?)
        `).run(generateUUID(), user.id, reportId, JSON.stringify({ reason, note: 'SLA clock continues during pause in demo mode' }), now);

        // Notify citizen
        createNotification(db, report.user_id, reportId, 'paused',
          'Report Paused',
          `Your report has been paused: ${reason || 'Awaiting additional information'}`
        );

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
          message: 'Report paused',
          note: 'Note: In this demo, the SLA clock continues during pause. A production system should subtract paused time from SLA calculations.'
        }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    },

    /**
     * PUT /api/staff/reports/:id/resume
     * Resume a paused report
     */
    async resumeReport(req, res, reportId) {
      const user = requireStaff(db, req, res);
      if (!user) return;

      const report = db.prepare('SELECT id, is_paused FROM reports WHERE id = ?').get(reportId);
      if (!report) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Report not found' }));
        return;
      }

      if (!report.is_paused) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Report is not paused' }));
        return;
      }

      const now = new Date().toISOString();

      db.prepare('UPDATE reports SET is_paused = 0, paused_at = NULL, paused_reason = NULL, updated_at = ? WHERE id = ?')
        .run(now, reportId);

      db.prepare(`
        INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, new_value, created_at)
        VALUES (?, ?, 'resume', 'report', ?, ?, ?)
      `).run(generateUUID(), user.id, reportId, JSON.stringify({ resumedAt: now }), now);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Report resumed' }));
    }
  };
}

module.exports = { staffRoutes };
