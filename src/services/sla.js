/**
 * @module sla
 * SLA (Service Level Agreement) management for Civ.IQ.
 *
 * Handles deadline calculation, escalation checking, overdue report tracking,
 * and report pause/resume functionality.
 */

const crypto = require('node:crypto');

/**
 * Calculate the SLA deadline for a report based on its priority.
 *
 * @param {import('node:sqlite').DatabaseSync} db - Database instance.
 * @param {string} priority - Report priority ('critical', 'medium', or 'low').
 * @param {string} createdAt - ISO datetime string of when the report was created.
 * @returns {string|null} ISO datetime string for the SLA deadline, or null if priority not found.
 */
function calculateDeadline(db, priority, createdAt) {
  const sla = db.prepare(
    'SELECT target_hours FROM sla_settings WHERE priority = ?'
  ).get(priority);

  if (!sla) return null;

  // Parse the created-at timestamp (handle both "YYYY-MM-DD HH:MM:SS" and ISO formats)
  const normalizedTs = createdAt.includes('T') ? createdAt : createdAt.replace(' ', 'T') + 'Z';
  const created = new Date(normalizedTs);

  if (isNaN(created.getTime())) return null;

  const deadline = new Date(created.getTime() + sla.target_hours * 3600000);
  return deadline.toISOString().replace('T', ' ').substring(0, 19);
}

/**
 * Check all open reports for SLA violations and create escalation records.
 *
 * Escalation levels:
 *  - Level 1: Report is past its SLA target_hours deadline → flagged as overdue.
 *  - Level 2: Report is past the escalation_hours threshold → escalated to department head.
 *
 * This function is idempotent — it checks for existing escalation records before creating new ones.
 *
 * @param {import('node:sqlite').DatabaseSync} db - Database instance.
 * @returns {{ checked: number, escalated: number, alreadyEscalated: number }}
 */
function checkEscalations(db) {
  const counts = { checked: 0, escalated: 0, alreadyEscalated: 0 };
  const now = new Date();

  // Find all reports that are NOT resolved or closed
  const openReports = db.prepare(
    `SELECT r.id, r.report_number, r.priority, r.sla_deadline, r.escalation_level,
            r.department_id, r.assigned_to, r.user_id, r.is_paused
     FROM reports r
     WHERE r.status NOT IN ('resolved', 'closed')
       AND r.sla_deadline IS NOT NULL
       AND r.priority IS NOT NULL`
  ).all();

  // Load SLA settings into a map
  const slaRows = db.prepare('SELECT priority, target_hours, escalation_hours FROM sla_settings').all();
  const slaMap = {};
  for (const row of slaRows) {
    slaMap[row.priority] = row;
  }

  const insertEscalation = db.prepare(
    `INSERT INTO escalation_records (id, report_id, escalation_level, reason, escalated_at)
     VALUES (?, ?, ?, ?, ?)`
  );

  const updateReportLevel = db.prepare(
    'UPDATE reports SET escalation_level = ?, updated_at = datetime(\'now\') WHERE id = ?'
  );

  const insertNotification = db.prepare(
    `INSERT INTO notifications (id, user_id, report_id, type, title, message, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  const insertAudit = db.prepare(
    `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, old_value, new_value, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const checkExisting = db.prepare(
    'SELECT id FROM escalation_records WHERE report_id = ? AND escalation_level = ?'
  );

  for (const report of openReports) {
    counts.checked++;

    const sla = slaMap[report.priority];
    if (!sla) continue;

    // Parse SLA deadline
    const deadlineStr = report.sla_deadline.includes('T')
      ? report.sla_deadline
      : report.sla_deadline.replace(' ', 'T') + 'Z';
    const deadline = new Date(deadlineStr);

    if (isNaN(deadline.getTime())) continue;

    const hoursOverdue = (now.getTime() - deadline.getTime()) / 3600000;

    if (hoursOverdue <= 0) continue; // Not overdue yet

    // ── Level 1: Past target_hours → flag as overdue ─────────────────
    if (report.escalation_level < 1) {
      const existing = checkExisting.get(report.id, 1);
      if (existing) {
        counts.alreadyEscalated++;
      } else {
        const reason = `Report ${report.report_number} is overdue. SLA deadline was ${report.sla_deadline}. Currently ${hoursOverdue.toFixed(1)} hours past deadline.`;

        insertEscalation.run(
          crypto.randomUUID(), report.id, 1, reason, now.toISOString().replace('T', ' ').substring(0, 19)
        );

        updateReportLevel.run(1, report.id);

        // Notify assigned staff (if any)
        if (report.assigned_to) {
          insertNotification.run(
            crypto.randomUUID(), report.assigned_to, report.id,
            'escalated',
            `SLA Overdue: ${report.report_number}`,
            `Report ${report.report_number} has exceeded its SLA deadline. Please prioritize resolution.`,
            now.toISOString().replace('T', ' ').substring(0, 19)
          );
        }

        // Audit entry — use a system user ID or the assigned user
        const auditUserId = report.assigned_to || report.user_id;
        insertAudit.run(
          crypto.randomUUID(), auditUserId, 'sla_escalation',
          'report', report.id,
          JSON.stringify({ escalation_level: 0 }),
          JSON.stringify({ escalation_level: 1, reason }),
          now.toISOString().replace('T', ' ').substring(0, 19)
        );

        counts.escalated++;
      }
    }

    // ── Level 2: Past escalation_hours → escalate to department head ─
    const escalationThresholdHours = sla.escalation_hours;
    // Level 2 triggers when overdue hours exceed the escalation threshold
    // (escalation_hours is the time after creation, so we compare total elapsed)
    const totalHoursSinceCreation = hoursOverdue + sla.target_hours;

    if (report.escalation_level < 2 && totalHoursSinceCreation > (sla.target_hours + escalationThresholdHours)) {
      const existing = checkExisting.get(report.id, 2);
      if (existing) {
        counts.alreadyEscalated++;
      } else {
        const reason = `Report ${report.report_number} requires department head attention. ${hoursOverdue.toFixed(1)} hours past SLA deadline, exceeding escalation threshold of ${escalationThresholdHours}h.`;

        insertEscalation.run(
          crypto.randomUUID(), report.id, 2, reason, now.toISOString().replace('T', ' ').substring(0, 19)
        );

        updateReportLevel.run(2, report.id);

        // Notify department-level staff
        if (report.department_id) {
          const deptStaff = db.prepare(
            `SELECT id FROM users
             WHERE department_id = ? AND role IN ('staff', 'admin')`
          ).all(report.department_id);

          for (const staff of deptStaff) {
            insertNotification.run(
              crypto.randomUUID(), staff.id, report.id,
              'escalated',
              `Critical Escalation: ${report.report_number}`,
              `Report ${report.report_number} has been escalated to Level 2. Immediate attention required.`,
              now.toISOString().replace('T', ' ').substring(0, 19)
            );
          }
        }

        // Also notify all admins
        const admins = db.prepare("SELECT id FROM users WHERE role = 'admin'").all();
        for (const admin of admins) {
          insertNotification.run(
            crypto.randomUUID(), admin.id, report.id,
            'escalated',
            `Critical Escalation: ${report.report_number}`,
            reason,
            now.toISOString().replace('T', ' ').substring(0, 19)
          );
        }

        const auditUserId = report.assigned_to || report.user_id;
        insertAudit.run(
          crypto.randomUUID(), auditUserId, 'sla_escalation',
          'report', report.id,
          JSON.stringify({ escalation_level: report.escalation_level }),
          JSON.stringify({ escalation_level: 2, reason }),
          now.toISOString().replace('T', ' ').substring(0, 19)
        );

        counts.escalated++;
      }
    }
  }

  return counts;
}

/**
 * Get all reports that are past their SLA deadline, with time overdue.
 *
 * @param {import('node:sqlite').DatabaseSync} db - Database instance.
 * @returns {Array<{ id: string, report_number: string, category: string, priority: string, status: string, sla_deadline: string, hours_overdue: number, department_id: string|null, assigned_to: string|null }>}
 */
function getOverdueReports(db) {
  const now = new Date();

  const reports = db.prepare(
    `SELECT id, report_number, category, priority, status,
            sla_deadline, department_id, assigned_to, escalation_level
     FROM reports
     WHERE status NOT IN ('resolved', 'closed')
       AND sla_deadline IS NOT NULL`
  ).all();

  const overdue = [];

  for (const report of reports) {
    const deadlineStr = report.sla_deadline.includes('T')
      ? report.sla_deadline
      : report.sla_deadline.replace(' ', 'T') + 'Z';
    const deadline = new Date(deadlineStr);

    if (isNaN(deadline.getTime())) continue;

    const hoursOverdue = (now.getTime() - deadline.getTime()) / 3600000;

    if (hoursOverdue > 0) {
      overdue.push({
        id: report.id,
        report_number: report.report_number,
        category: report.category,
        priority: report.priority,
        status: report.status,
        sla_deadline: report.sla_deadline,
        hours_overdue: parseFloat(hoursOverdue.toFixed(2)),
        department_id: report.department_id,
        assigned_to: report.assigned_to,
        escalation_level: report.escalation_level
      });
    }
  }

  // Sort by hours overdue (most overdue first)
  overdue.sort((a, b) => b.hours_overdue - a.hours_overdue);

  return overdue;
}

/**
 * Pause a report's SLA tracking.
 *
 * Note: In this demo, the SLA clock continues during pause.
 * A production system should subtract paused time from SLA calculations.
 *
 * @param {import('node:sqlite').DatabaseSync} db - Database instance.
 * @param {string} reportId - The report to pause.
 * @param {string} reason - Reason for pausing.
 * @param {string} userId - ID of the user performing the pause.
 * @returns {{ success: boolean, message: string }}
 */
function pauseReport(db, reportId, reason, userId) {
  const report = db.prepare('SELECT id, is_paused, report_number FROM reports WHERE id = ?').get(reportId);

  if (!report) {
    return { success: false, message: 'Report not found.' };
  }

  if (report.is_paused === 1) {
    return { success: false, message: 'Report is already paused.' };
  }

  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

  db.prepare(
    `UPDATE reports
     SET is_paused = 1, paused_at = ?, paused_reason = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(now, reason, reportId);

  // Audit entry
  db.prepare(
    `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, old_value, new_value, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    crypto.randomUUID(), userId, 'report_paused',
    'report', reportId,
    JSON.stringify({ is_paused: 0 }),
    JSON.stringify({ is_paused: 1, paused_reason: reason }),
    now
  );

  return { success: true, message: `Report ${report.report_number} paused. Note: In this demo, the SLA clock continues during pause. A production system should subtract paused time from SLA calculations.` };
}

/**
 * Resume a paused report's SLA tracking.
 *
 * @param {import('node:sqlite').DatabaseSync} db - Database instance.
 * @param {string} reportId - The report to resume.
 * @param {string} userId - ID of the user performing the resume.
 * @returns {{ success: boolean, message: string }}
 */
function resumeReport(db, reportId, userId) {
  const report = db.prepare('SELECT id, is_paused, paused_at, paused_reason, report_number FROM reports WHERE id = ?').get(reportId);

  if (!report) {
    return { success: false, message: 'Report not found.' };
  }

  if (report.is_paused !== 1) {
    return { success: false, message: 'Report is not currently paused.' };
  }

  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

  db.prepare(
    `UPDATE reports
     SET is_paused = 0, paused_at = NULL, paused_reason = NULL, updated_at = datetime('now')
     WHERE id = ?`
  ).run(reportId);

  // Audit entry
  db.prepare(
    `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, old_value, new_value, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    crypto.randomUUID(), userId, 'report_resumed',
    'report', reportId,
    JSON.stringify({ is_paused: 1, paused_at: report.paused_at, paused_reason: report.paused_reason }),
    JSON.stringify({ is_paused: 0 }),
    now
  );

  return { success: true, message: `Report ${report.report_number} resumed.` };
}

module.exports = {
  calculateDeadline,
  checkEscalations,
  getOverdueReports,
  pauseReport,
  resumeReport
};
