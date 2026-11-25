/**
 * Health Check Route for Civ.IQ
 */

'use strict';

function healthRoutes(db) {
  return {
    /**
     * GET /api/health
     * Basic health/status endpoint
     */
    getHealth(req, res) {
      let dbOk = false;
      let reportCount = 0;
      let userCount = 0;

      try {
        reportCount = db.prepare('SELECT COUNT(*) as count FROM reports').get().count;
        userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
        dbOk = true;
      } catch (e) {
        console.error('Health check DB error:', e.message);
      }

      const status = dbOk ? 'healthy' : 'degraded';
      const statusCode = dbOk ? 200 : 503;

      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status,
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        database: dbOk ? 'connected' : 'error',
        counts: {
          reports: reportCount,
          users: userCount
        },
        demo: true,
        notice: 'Civ.IQ MVP — Demo mode with local authentication'
      }));
    }
  };
}

module.exports = { healthRoutes };
