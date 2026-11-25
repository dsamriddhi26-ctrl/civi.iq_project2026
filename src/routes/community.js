/**
 * Community Routes for Civ.IQ
 * 
 * Public community feed, leaderboard, and notifications.
 */

'use strict';

const { getCurrentUser, requireAuth } = require('../middleware/auth.js');
const { generateUUID } = require('../utils/helpers.js');

/**
 * Register community routes
 * @param {object} db - Database instance
 * @returns {object} Route handlers
 */
function communityRoutes(db) {
  return {
    /**
     * GET /api/community/feed
     * Public community feed with search, filters, sorting
     */
    getFeed(req, res) {
      const url = new URL(req.url, 'http://localhost');
      const search = url.searchParams.get('search');
      const category = url.searchParams.get('category');
      const status = url.searchParams.get('status');
      const priority = url.searchParams.get('priority');
      const sortBy = url.searchParams.get('sort') || 'newest';
      const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
      const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') || '20')));
      const offset = (page - 1) * limit;

      let where = ['1=1'];
      let params = [];

      if (search) {
        where.push('r.description LIKE ?');
        params.push(`%${search}%`);
      }
      if (category) {
        where.push('r.category = ?');
        params.push(category);
      }
      if (status) {
        where.push('r.status = ?');
        params.push(status);
      }
      if (priority) {
        where.push('r.priority = ?');
        params.push(priority);
      }

      let orderBy;
      switch (sortBy) {
        case 'upvotes':
          orderBy = 'r.upvote_count DESC, r.created_at DESC';
          break;
        case 'updated':
          orderBy = 'r.updated_at DESC';
          break;
        case 'oldest':
          orderBy = 'r.created_at ASC';
          break;
        case 'newest':
        default:
          orderBy = 'r.created_at DESC';
      }

      const whereClause = where.join(' AND ');
      const total = db.prepare(`SELECT COUNT(*) as count FROM reports r WHERE ${whereClause}`).get(...params).count;

      const reports = db.prepare(`
        SELECT r.id, r.report_number, r.category, r.description, r.status, r.priority,
               r.latitude, r.longitude, r.address, r.is_anonymous, r.upvote_count,
               r.image_path, r.created_at, r.updated_at,
               d.name as department_name,
               u.display_name as reporter_name, u.alias as reporter_alias
        FROM reports r
        LEFT JOIN departments d ON r.department_id = d.id
        LEFT JOIN users u ON r.user_id = u.id
        WHERE ${whereClause}
        ORDER BY ${orderBy}
        LIMIT ? OFFSET ?
      `).all(...params, limit, offset);

      // Check if current user has upvoted each report
      const user = getCurrentUser(db, req);
      let userUpvotes = new Set();
      if (user) {
        const upvotes = db.prepare('SELECT report_id FROM upvotes WHERE user_id = ?').all(user.id);
        userUpvotes = new Set(upvotes.map(u => u.report_id));
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        reports: reports.map(r => ({
          id: r.id,
          reportNumber: r.report_number,
          category: r.category,
          description: r.description,
          status: r.status,
          priority: r.priority,
          latitude: r.latitude,
          longitude: r.longitude,
          address: r.address,
          isAnonymous: !!r.is_anonymous,
          reporterName: r.is_anonymous ? 'Community Member' : (r.reporter_alias || r.reporter_name),
          departmentName: r.department_name,
          upvoteCount: r.upvote_count,
          userUpvoted: userUpvotes.has(r.id),
          imagePath: r.image_path ? `/uploads/${r.image_path}` : null,
          createdAt: r.created_at,
          updatedAt: r.updated_at
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit)
        }
      }));
    },

    /**
     * GET /api/community/leaderboard
     * Leaderboard based on helpful participation
     */
    getLeaderboard(req, res) {
      const user = getCurrentUser(db, req);

      // Leaderboard: users with most resolved non-anonymous reports + upvotes received
      const leaders = db.prepare(`
        SELECT u.id, u.display_name, u.alias,
               COUNT(DISTINCT r.id) as resolved_reports,
               COALESCE(SUM(r.upvote_count), 0) as total_upvotes
        FROM users u
        INNER JOIN reports r ON r.user_id = u.id
        WHERE r.is_anonymous = 0
          AND r.status IN ('resolved', 'closed')
        GROUP BY u.id
        HAVING resolved_reports > 0
        ORDER BY resolved_reports DESC, total_upvotes DESC
        LIMIT 20
      `).all();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        leaderboard: leaders.map((l, i) => ({
          rank: i + 1,
          displayName: l.alias || l.display_name,
          resolvedReports: l.resolved_reports,
          totalUpvotes: l.total_upvotes,
          isCurrentUser: user ? user.id === l.id : false
        })),
        criteria: 'Ranked by number of resolved non-anonymous reports, with total upvotes as tiebreaker'
      }));
    },

    /**
     * GET /api/community/recent-resolved
     * Recent resolved reports for homepage ticker
     */
    getRecentResolved(req, res) {
      const reports = db.prepare(`
        SELECT r.report_number, r.category, r.description, r.updated_at,
               d.name as department_name
        FROM reports r
        LEFT JOIN departments d ON r.department_id = d.id
        WHERE r.status IN ('resolved', 'closed')
        ORDER BY r.updated_at DESC
        LIMIT 5
      `).all();

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        reports: reports.map(r => ({
          reportNumber: r.report_number,
          category: r.category,
          description: r.description.substring(0, 100),
          departmentName: r.department_name,
          resolvedAt: r.updated_at
        }))
      }));
    },

    /**
     * GET /api/community/map-data
     * Report locations for map display
     */
    getMapData(req, res) {
      const url = new URL(req.url, 'http://localhost');
      const category = url.searchParams.get('category');
      const status = url.searchParams.get('status');

      let where = ['r.latitude IS NOT NULL AND r.longitude IS NOT NULL'];
      let params = [];

      if (category) {
        where.push('r.category = ?');
        params.push(category);
      }
      if (status) {
        where.push('r.status = ?');
        params.push(status);
      }

      const reports = db.prepare(`
        SELECT r.id, r.report_number, r.category, r.description, r.status, r.priority,
               r.latitude, r.longitude, r.address, r.created_at
        FROM reports r
        WHERE ${where.join(' AND ')}
        ORDER BY r.created_at DESC
      `).all(...params);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        reports: reports.map(r => ({
          id: r.id,
          reportNumber: r.report_number,
          category: r.category,
          description: r.description.substring(0, 80),
          status: r.status,
          priority: r.priority,
          latitude: r.latitude,
          longitude: r.longitude,
          address: r.address,
          createdAt: r.created_at
        }))
      }));
    },

    // ==================== NOTIFICATIONS ====================

    /**
     * GET /api/notifications
     * Get current user's notifications
     */
    getNotifications(req, res) {
      const user = requireAuth(db, req, res);
      if (!user) return;

      const url = new URL(req.url, 'http://localhost');
      const limit = Math.min(50, parseInt(url.searchParams.get('limit') || '20'));

      const notifications = db.prepare(`
        SELECT * FROM notifications
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `).all(user.id, limit);

      const unreadCount = db.prepare('SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0').get(user.id).count;

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        notifications: notifications.map(n => ({
          id: n.id,
          reportId: n.report_id,
          type: n.type,
          title: n.title,
          message: n.message,
          isRead: !!n.is_read,
          createdAt: n.created_at
        })),
        unreadCount
      }));
    },

    /**
     * PUT /api/notifications/:id/read
     * Mark notification as read
     */
    markNotificationRead(req, res, notifId) {
      const user = requireAuth(db, req, res);
      if (!user) return;

      const notif = db.prepare('SELECT id, user_id FROM notifications WHERE id = ?').get(notifId);
      if (!notif || notif.user_id !== user.id) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Notification not found' }));
        return;
      }

      db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(notifId);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'Marked as read' }));
    },

    /**
     * PUT /api/notifications/read-all
     * Mark all notifications as read
     */
    markAllRead(req, res) {
      const user = requireAuth(db, req, res);
      if (!user) return;

      db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0').run(user.id);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'All notifications marked as read' }));
    }
  };
}

module.exports = { communityRoutes };
