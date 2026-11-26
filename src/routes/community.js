/**
 * Community Routes for Civ.IQ
 * 
 * Public community feed, leaderboard, and notifications.
 */

'use strict';

const { getCurrentUser, requireAuth } = require('../middleware/auth.js');
const { readJsonBody } = require('../middleware/upload.js');
const { generateUUID, sanitizeInput } = require('../utils/helpers.js');

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
               r.support_count, r.verification_state,
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
          supportCount: r.support_count || 0,
          verificationState: r.verification_state || 'none',
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
               r.latitude, r.longitude, r.address, r.upvote_count, r.created_at
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
          upvoteCount: r.upvote_count || 0,
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
    },

    // ==================== APP RATINGS & REVIEWS ====================

    /**
     * GET /api/community/reviews
     * Public summary & list of citizen ratings and issue-resolution reviews
     */
    getReviews(req, res) {
      const url = new URL(req.url, 'http://localhost');
      const filterResolved = url.searchParams.get('issueResolved');

      let where = '1=1';
      const params = [];
      if (filterResolved && ['yes', 'partially', 'no'].includes(filterResolved)) {
        where = 'ar.issue_resolved = ?';
        params.push(filterResolved);
      }

      const reviews = db.prepare(`
        SELECT ar.id, ar.rating, ar.issue_resolved, ar.title, ar.comment, ar.created_at,
               ar.report_id, r.report_number, r.category AS report_category,
               u.display_name, u.alias, u.role
        FROM app_reviews ar
        LEFT JOIN users u ON ar.user_id = u.id
        LEFT JOIN reports r ON ar.report_id = r.id
        WHERE ${where}
        ORDER BY ar.created_at DESC
        LIMIT 50
      `).all(...params);

      const allStats = db.prepare(`
        SELECT
          COUNT(*) AS total,
          AVG(rating) AS avg_rating,
          SUM(CASE WHEN issue_resolved = 'yes' THEN 1 ELSE 0 END) AS resolved_yes,
          SUM(CASE WHEN issue_resolved = 'partially' THEN 1 ELSE 0 END) AS resolved_partially,
          SUM(CASE WHEN issue_resolved = 'no' THEN 1 ELSE 0 END) AS resolved_no,
          SUM(CASE WHEN rating = 5 THEN 1 ELSE 0 END) AS r5,
          SUM(CASE WHEN rating = 4 THEN 1 ELSE 0 END) AS r4,
          SUM(CASE WHEN rating = 3 THEN 1 ELSE 0 END) AS r3,
          SUM(CASE WHEN rating = 2 THEN 1 ELSE 0 END) AS r2,
          SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) AS r1
        FROM app_reviews
      `).get();

      const total = allStats.total || 0;
      const resolvedYes = allStats.resolved_yes || 0;
      const resolvedPartially = allStats.resolved_partially || 0;
      const resolvedNo = allStats.resolved_no || 0;
      const solvedPercent = total > 0 ? Math.round(((resolvedYes + resolvedPartially * 0.5) / total) * 100) : 0;

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        summary: {
          totalReviews: total,
          averageRating: total > 0 ? Math.round((allStats.avg_rating || 0) * 10) / 10 : 0,
          resolvedYes,
          resolvedPartially,
          resolvedNo,
          solvedPercent,
          breakdown: {
            5: allStats.r5 || 0,
            4: allStats.r4 || 0,
            3: allStats.r3 || 0,
            2: allStats.r2 || 0,
            1: allStats.r1 || 0
          }
        },
        reviews: reviews.map(rv => ({
          id: rv.id,
          rating: rv.rating,
          issueResolved: rv.issue_resolved,
          title: rv.title,
          comment: rv.comment,
          reportId: rv.report_id,
          reportNumber: rv.report_number,
          reportCategory: rv.report_category,
          authorName: rv.alias || rv.display_name || 'Community Member',
          createdAt: rv.created_at
        }))
      }));
    },

    /**
     * POST /api/community/reviews
     * Submit an app & issue-resolution review (authenticated users)
     */
    async createReview(req, res) {
      const user = requireAuth(db, req, res);
      if (!user) return;

      try {
        const body = await readJsonBody(req);
        const rating = parseInt(body.rating, 10);
        const issueResolved = body.issueResolved;
        const title = sanitizeInput(body.title || '');
        const comment = sanitizeInput(body.comment || '');
        const reportId = body.reportId ? String(body.reportId).trim() : null;

        if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Rating must be between 1 and 5 stars' }));
          return;
        }

        if (!['yes', 'partially', 'no'].includes(issueResolved)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Please indicate whether your issue was resolved (yes, partially, or no)' }));
          return;
        }

        if (!comment || comment.length < 10) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Please write at least 10 characters in your review' }));
          return;
        }

        let validReportId = null;
        if (reportId) {
          const rep = db.prepare('SELECT id FROM reports WHERE id = ?').get(reportId);
          if (!rep) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Linked report not found' }));
            return;
          }
          validReportId = rep.id;
        }

        const reviewId = generateUUID();
        const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

        db.prepare(`
          INSERT INTO app_reviews (id, user_id, report_id, rating, issue_resolved, title, comment, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(reviewId, user.id, validReportId, rating, issueResolved, title || null, comment, now);

        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          message: 'Thank you for your review!',
          review: {
            id: reviewId,
            rating,
            issueResolved,
            title: title || null,
            comment,
            reportId: validReportId,
            authorName: user.alias || user.display_name,
            createdAt: now
          }
        }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    }
  };
}

module.exports = { communityRoutes };
