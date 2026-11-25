/**
 * Admin Routes for Civ.IQ
 * 
 * Handles administrator actions: department management, SLA settings,
 * user management, service areas, and application settings.
 */

'use strict';

const { requireAdmin } = require('../middleware/auth.js');
const { readJsonBody } = require('../middleware/upload.js');
const { generateUUID, sanitizeInput } = require('../utils/helpers.js');

/**
 * Register admin routes
 * @param {object} db - Database instance
 * @returns {object} Route handlers
 */
function adminRoutes(db) {
  return {
    // ==================== DEPARTMENTS ====================

    /**
     * GET /api/admin/departments
     */
    getDepartments(req, res) {
      const user = requireAdmin(db, req, res);
      if (!user) return;

      const departments = db.prepare(`
        SELECT d.*, 
               (SELECT COUNT(*) FROM reports r WHERE r.department_id = d.id) as report_count,
               (SELECT COUNT(*) FROM users u WHERE u.department_id = d.id) as staff_count
        FROM departments d
        ORDER BY d.name
      `).all();

      const routingRules = db.prepare(`
        SELECT rr.*, d.name as department_name
        FROM routing_rules rr
        LEFT JOIN departments d ON rr.department_id = d.id
        ORDER BY rr.category, rr.priority DESC
      `).all();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        departments: departments.map(d => ({
          id: d.id,
          name: d.name,
          description: d.description,
          isActive: !!d.is_active,
          reportCount: d.report_count,
          staffCount: d.staff_count,
          createdAt: d.created_at
        })),
        routingRules: routingRules.map(r => ({
          id: r.id,
          category: r.category,
          departmentId: r.department_id,
          departmentName: r.department_name,
          priority: r.priority
        }))
      }));
    },

    /**
     * POST /api/admin/departments
     */
    async createDepartment(req, res) {
      const user = requireAdmin(db, req, res);
      if (!user) return;

      try {
        const body = await readJsonBody(req);
        const { name, description } = body;

        if (!name || name.trim().length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Department name is required' }));
          return;
        }

        // Check uniqueness
        const existing = db.prepare('SELECT id FROM departments WHERE name = ?').get(name.trim());
        if (existing) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Department with this name already exists' }));
          return;
        }

        const id = generateUUID();
        const now = new Date().toISOString();

        db.prepare('INSERT INTO departments (id, name, description, is_active, created_at) VALUES (?, ?, ?, 1, ?)')
          .run(id, sanitizeInput(name.trim()), sanitizeInput(description || ''), now);

        db.prepare(`
          INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, new_value, created_at)
          VALUES (?, ?, 'create', 'department', ?, ?, ?)
        `).run(generateUUID(), user.id, id, JSON.stringify({ name, description }), now);

        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Department created', id }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    },

    /**
     * PUT /api/admin/departments/:id
     */
    async updateDepartment(req, res, deptId) {
      const user = requireAdmin(db, req, res);
      if (!user) return;

      try {
        const body = await readJsonBody(req);
        const { name, description, isActive } = body;

        const dept = db.prepare('SELECT * FROM departments WHERE id = ?').get(deptId);
        if (!dept) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Department not found' }));
          return;
        }

        const now = new Date().toISOString();
        const updates = [];
        const params = [];

        if (name !== undefined) {
          updates.push('name = ?');
          params.push(sanitizeInput(name.trim()));
        }
        if (description !== undefined) {
          updates.push('description = ?');
          params.push(sanitizeInput(description));
        }
        if (isActive !== undefined) {
          updates.push('is_active = ?');
          params.push(isActive ? 1 : 0);
        }

        if (updates.length === 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No fields to update' }));
          return;
        }

        params.push(deptId);
        db.prepare(`UPDATE departments SET ${updates.join(', ')} WHERE id = ?`).run(...params);

        db.prepare(`
          INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, old_value, new_value, created_at)
          VALUES (?, ?, 'update', 'department', ?, ?, ?, ?)
        `).run(generateUUID(), user.id, deptId,
          JSON.stringify({ name: dept.name, description: dept.description, isActive: dept.is_active }),
          JSON.stringify({ name, description, isActive }),
          now);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Department updated' }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    },

    /**
     * DELETE /api/admin/departments/:id
     */
    deleteDepartment(req, res, deptId) {
      const user = requireAdmin(db, req, res);
      if (!user) return;

      const dept = db.prepare('SELECT * FROM departments WHERE id = ?').get(deptId);
      if (!dept) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Department not found' }));
        return;
      }

      // Check if department has reports
      const reportCount = db.prepare('SELECT COUNT(*) as count FROM reports WHERE department_id = ?').get(deptId).count;
      if (reportCount > 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Cannot delete department with ${reportCount} assigned reports. Deactivate instead.` }));
        return;
      }

      db.prepare('DELETE FROM routing_rules WHERE department_id = ?').run(deptId);
      db.prepare('DELETE FROM service_areas WHERE department_id = ?').run(deptId);
      db.prepare('DELETE FROM departments WHERE id = ?').run(deptId);

      db.prepare(`
        INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, old_value, created_at)
        VALUES (?, ?, 'delete', 'department', ?, ?, ?)
      `).run(generateUUID(), user.id, deptId, JSON.stringify({ name: dept.name }), new Date().toISOString());

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Department deleted' }));
    },

    // ==================== SLA SETTINGS ====================

    /**
     * GET /api/admin/sla
     */
    getSLASettings(req, res) {
      const user = requireAdmin(db, req, res);
      if (!user) return;

      const settings = db.prepare('SELECT * FROM sla_settings ORDER BY target_hours ASC').all();
      
      const now = new Date().toISOString();
      const overdueByPriority = db.prepare(`
        SELECT priority, COUNT(*) as count FROM reports
        WHERE sla_deadline IS NOT NULL AND sla_deadline < ? AND status NOT IN ('resolved', 'closed')
        GROUP BY priority
      `).all(now);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        settings: settings.map(s => ({
          id: s.id,
          priority: s.priority,
          targetHours: s.target_hours,
          escalationHours: s.escalation_hours,
          updatedAt: s.updated_at
        })),
        overdueByPriority: overdueByPriority.reduce((acc, r) => { acc[r.priority] = r.count; return acc; }, {})
      }));
    },

    /**
     * PUT /api/admin/sla/:id
     */
    async updateSLASetting(req, res, slaId) {
      const user = requireAdmin(db, req, res);
      if (!user) return;

      try {
        const body = await readJsonBody(req);
        const { targetHours, escalationHours } = body;

        const setting = db.prepare('SELECT * FROM sla_settings WHERE id = ?').get(slaId);
        if (!setting) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'SLA setting not found' }));
          return;
        }

        if (targetHours !== undefined && (typeof targetHours !== 'number' || targetHours < 1)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Target hours must be a positive number' }));
          return;
        }

        if (escalationHours !== undefined && (typeof escalationHours !== 'number' || escalationHours < 1)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Escalation hours must be a positive number' }));
          return;
        }

        const now = new Date().toISOString();
        db.prepare('UPDATE sla_settings SET target_hours = ?, escalation_hours = ?, updated_at = ? WHERE id = ?')
          .run(targetHours || setting.target_hours, escalationHours || setting.escalation_hours, now, slaId);

        db.prepare(`
          INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, old_value, new_value, created_at)
          VALUES (?, ?, 'update', 'sla_settings', ?, ?, ?, ?)
        `).run(generateUUID(), user.id, slaId,
          JSON.stringify({ targetHours: setting.target_hours, escalationHours: setting.escalation_hours }),
          JSON.stringify({ targetHours, escalationHours }),
          now);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'SLA settings updated' }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    },

    // ==================== USERS ====================

    /**
     * GET /api/admin/users
     */
    getUsers(req, res) {
      const user = requireAdmin(db, req, res);
      if (!user) return;

      const users = db.prepare(`
        SELECT u.*, d.name as department_name,
               (SELECT COUNT(*) FROM reports r WHERE r.user_id = u.id) as report_count
        FROM users u
        LEFT JOIN departments d ON u.department_id = d.id
        ORDER BY u.role, u.display_name
      `).all();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        users: users.map(u => ({
          id: u.id,
          email: u.email,
          displayName: u.display_name,
          alias: u.alias,
          role: u.role,
          departmentId: u.department_id,
          departmentName: u.department_name,
          verifiedStatus: u.verified_status,
          reportCount: u.report_count,
          createdAt: u.created_at
        }))
      }));
    },

    /**
     * PUT /api/admin/users/:id/role
     */
    async updateUserRole(req, res, userId) {
      const user = requireAdmin(db, req, res);
      if (!user) return;

      try {
        const body = await readJsonBody(req);
        const { role, departmentId } = body;

        if (!['citizen', 'staff', 'admin'].includes(role)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid role' }));
          return;
        }

        const targetUser = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
        if (!targetUser) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'User not found' }));
          return;
        }

        const now = new Date().toISOString();
        db.prepare('UPDATE users SET role = ?, department_id = ?, updated_at = ? WHERE id = ?')
          .run(role, departmentId || null, now, userId);

        db.prepare(`
          INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, old_value, new_value, created_at)
          VALUES (?, ?, 'role_change', 'user', ?, ?, ?, ?)
        `).run(generateUUID(), user.id, userId,
          JSON.stringify({ role: targetUser.role, departmentId: targetUser.department_id }),
          JSON.stringify({ role, departmentId, changedBy: user.display_name }),
          now);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'User role updated' }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    },

    // ==================== SETTINGS ====================

    /**
     * GET /api/admin/settings
     */
    getSettings(req, res) {
      const user = requireAdmin(db, req, res);
      if (!user) return;

      const settings = db.prepare('SELECT * FROM app_settings').all();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        settings: settings.reduce((acc, s) => {
          acc[s.key] = s.value;
          return acc;
        }, {})
      }));
    },

    /**
     * PUT /api/admin/settings
     */
    async updateSettings(req, res) {
      const user = requireAdmin(db, req, res);
      if (!user) return;

      try {
        const body = await readJsonBody(req);
        const now = new Date().toISOString();

        for (const [key, value] of Object.entries(body)) {
          const existing = db.prepare('SELECT key FROM app_settings WHERE key = ?').get(key);
          if (existing) {
            db.prepare('UPDATE app_settings SET value = ?, updated_at = ? WHERE key = ?')
              .run(String(value), now, key);
          } else {
            db.prepare('INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)')
              .run(key, String(value), now);
          }
        }

        db.prepare(`
          INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, new_value, created_at)
          VALUES (?, ?, 'update', 'app_settings', 'global', ?, ?)
        `).run(generateUUID(), user.id, JSON.stringify(body), now);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Settings updated' }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    }
  };
}

module.exports = { adminRoutes };
