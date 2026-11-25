/**
 * @module notifications
 * In-app notification service for Civ.IQ.
 *
 * Uses local SQLite persistence only. Email and SMS delivery are not
 * implemented in this local MVP.
 */

'use strict';

const crypto = require('node:crypto');

/**
 * Create a new in-app notification for a user.
 *
 * @param {import('node:sqlite').DatabaseSync} db - Database instance.
 * @param {string} userId - Recipient user ID.
 * @param {string|null} reportId - Related report ID, if any.
 * @param {string} type - Notification type (e.g. 'new_report', 'status_change', 'assigned', 'citizen_update', 'escalated', 'paused').
 * @param {string} title - Short notification title.
 * @param {string} message - Notification body text.
 * @returns {string} The created notification ID.
 */
function createNotification(db, userId, reportId, type, title, message) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO notifications (id, user_id, report_id, type, title, message, is_read, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?)
  `).run(id, userId, reportId || null, type, title, message, now);

  return id;
}

/**
 * Retrieve recent notifications for a user, ordered newest first.
 *
 * @param {import('node:sqlite').DatabaseSync} db - Database instance.
 * @param {string} userId - User ID.
 * @param {number} [limit=20] - Maximum number of notifications to return.
 * @returns {Array<object>} Notification records.
 */
function getUserNotifications(db, userId, limit = 20) {
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
  return db.prepare(`
    SELECT id, user_id, report_id, type, title, message, is_read, created_at
    FROM notifications
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(userId, safeLimit);
}

/**
 * Mark a specific notification as read, verifying ownership.
 *
 * @param {import('node:sqlite').DatabaseSync} db - Database instance.
 * @param {string} notificationId - Notification ID.
 * @param {string} userId - Owner user ID.
 * @returns {boolean} True if a notification was updated, false otherwise.
 */
function markAsRead(db, notificationId, userId) {
  const result = db.prepare(`
    UPDATE notifications
    SET is_read = 1
    WHERE id = ? AND user_id = ?
  `).run(notificationId, userId);

  return result.changes > 0;
}

/**
 * Get the count of unread notifications for a user.
 *
 * @param {import('node:sqlite').DatabaseSync} db - Database instance.
 * @param {string} userId - User ID.
 * @returns {number} Unread notification count.
 */
function getUnreadCount(db, userId) {
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM notifications
    WHERE user_id = ? AND is_read = 0
  `).get(userId);

  return row ? row.count : 0;
}

/**
 * Notify relevant users when a report is updated.
 *
 * @param {import('node:sqlite').DatabaseSync} db - Database instance.
 * @param {object} report - Report record (must include id and user_id; may include report_number, status, assigned_to).
 * @param {string} updateType - One of 'status_change', 'assigned', 'citizen_update', 'escalated', 'duplicate_suggested'.
 */
function notifyReportUpdate(db, report, updateType) {
  if (!report || !report.id) return;

  const label = report.report_number || report.id;
  const messages = {
    status_change: {
      title: 'Report Status Updated',
      message: `Report ${label} status changed to ${(report.status || 'updated').replace('_', ' ').toUpperCase()}.`
    },
    assigned: {
      title: 'Report Assigned',
      message: `Report ${label} has been assigned to a municipal team.`
    },
    citizen_update: {
      title: 'Update on Your Report',
      message: `Municipal staff posted a new update on report ${label}.`
    },
    escalated: {
      title: 'Report Escalated',
      message: `Report ${label} has been escalated due to SLA threshold.`
    },
    duplicate_suggested: {
      title: 'Potential Duplicate Detected',
      message: `Report ${label} has a potential duplicate match for review.`
    }
  };

  const payload = messages[updateType] || {
    title: 'Report Updated',
    message: `Report ${label} has been updated.`
  };

  if (report.user_id) {
    createNotification(db, report.user_id, report.id, updateType, payload.title, payload.message);
  }

  if (report.assigned_to && report.assigned_to !== report.user_id) {
    createNotification(db, report.assigned_to, report.id, updateType, payload.title, payload.message);
  }
}

module.exports = {
  createNotification,
  getUserNotifications,
  markAsRead,
  getUnreadCount,
  notifyReportUpdate
};
