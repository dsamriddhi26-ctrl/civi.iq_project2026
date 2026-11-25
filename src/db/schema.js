/**
 * @module schema
 * Database schema initialization for Civ.IQ.
 * Uses the built-in node:sqlite DatabaseSync API.
 *
 * All tables use IF NOT EXISTS for idempotent setup.
 * Foreign keys are enforced, indexes are created for query performance.
 */

const { DatabaseSync } = require('node:sqlite');

/**
 * Initialize the SQLite database with all Civ.IQ tables, indexes, and constraints.
 * Safe to call multiple times — all CREATE statements use IF NOT EXISTS.
 *
 * @param {string} dbPath - File path for the SQLite database (or ':memory:' for in-memory).
 * @returns {DatabaseSync} The opened and initialized database instance.
 */
function initDatabase(dbPath) {
  const db = new DatabaseSync(dbPath);

  // Enable WAL mode for better concurrent read performance
  db.exec('PRAGMA journal_mode = WAL');

  // Enforce foreign key constraints
  db.exec('PRAGMA foreign_keys = ON');

  // ─── Departments ─────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS departments (
      id              TEXT PRIMARY KEY,
      name            TEXT UNIQUE NOT NULL,
      description     TEXT,
      is_active       INTEGER DEFAULT 1,
      created_at      TEXT DEFAULT (datetime('now'))
    )
  `);

  // ─── Users ───────────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id              TEXT PRIMARY KEY,
      email           TEXT UNIQUE NOT NULL,
      display_name    TEXT NOT NULL,
      alias           TEXT,
      role            TEXT NOT NULL CHECK(role IN ('citizen','staff','admin')),
      department_id   TEXT REFERENCES departments(id),
      verified_status TEXT DEFAULT 'demo' CHECK(verified_status IN ('demo','pending','verified')),
      created_at      TEXT DEFAULT (datetime('now')),
      updated_at      TEXT DEFAULT (datetime('now'))
    )
  `);

  // ─── Service Areas ───────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS service_areas (
      id              TEXT PRIMARY KEY,
      department_id   TEXT NOT NULL REFERENCES departments(id),
      name            TEXT NOT NULL,
      description     TEXT,
      created_at      TEXT DEFAULT (datetime('now'))
    )
  `);

  // ─── Routing Rules ───────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS routing_rules (
      id              TEXT PRIMARY KEY,
      category        TEXT NOT NULL,
      department_id   TEXT NOT NULL REFERENCES departments(id),
      service_area_id TEXT REFERENCES service_areas(id),
      priority        INTEGER DEFAULT 0,
      created_at      TEXT DEFAULT (datetime('now'))
    )
  `);

  // ─── Reports ─────────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS reports (
      id                        TEXT PRIMARY KEY,
      report_number             TEXT UNIQUE NOT NULL,
      user_id                   TEXT NOT NULL REFERENCES users(id),
      category                  TEXT NOT NULL CHECK(category IN ('pothole','garbage','stray_animal','streetlight','water_drainage','other')),
      description               TEXT NOT NULL,
      image_path                TEXT,
      image_original_name       TEXT,
      image_mime_type           TEXT,
      image_size                INTEGER,
      latitude                  REAL,
      longitude                 REAL,
      address                   TEXT,
      is_anonymous              INTEGER DEFAULT 0,
      status                    TEXT DEFAULT 'submitted' CHECK(status IN ('submitted','under_review','assigned','in_progress','resolved','closed','reopened')),
      priority                  TEXT CHECK(priority IN ('critical','medium','low')),
      department_id             TEXT REFERENCES departments(id),
      assigned_to               TEXT REFERENCES users(id),
      ai_suggested_category     TEXT,
      ai_suggested_priority     TEXT,
      ai_suggested_department_id TEXT,
      classification_source     TEXT CHECK(classification_source IN ('ai_provider','rules_engine','manual')),
      is_duplicate              INTEGER DEFAULT 0,
      duplicate_of              TEXT REFERENCES reports(id),
      sla_deadline              TEXT,
      escalation_level          INTEGER DEFAULT 0,
      is_paused                 INTEGER DEFAULT 0,
      paused_at                 TEXT,
      paused_reason             TEXT,
      upvote_count              INTEGER DEFAULT 0,
      created_at                TEXT DEFAULT (datetime('now')),
      updated_at                TEXT DEFAULT (datetime('now'))
    )
  `);

  // ─── Status History ──────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS status_history (
      id                TEXT PRIMARY KEY,
      report_id         TEXT NOT NULL REFERENCES reports(id),
      old_status        TEXT,
      new_status        TEXT NOT NULL,
      changed_by        TEXT NOT NULL REFERENCES users(id),
      note              TEXT,
      is_citizen_visible INTEGER DEFAULT 1,
      created_at        TEXT DEFAULT (datetime('now'))
    )
  `);

  // ─── Assignments ─────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS assignments (
      id              TEXT PRIMARY KEY,
      report_id       TEXT NOT NULL REFERENCES reports(id),
      assigned_to     TEXT REFERENCES users(id),
      department_id   TEXT REFERENCES departments(id),
      assigned_by     TEXT NOT NULL REFERENCES users(id),
      note            TEXT,
      created_at      TEXT DEFAULT (datetime('now'))
    )
  `);

  // ─── Internal Notes ──────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS internal_notes (
      id              TEXT PRIMARY KEY,
      report_id       TEXT NOT NULL REFERENCES reports(id),
      user_id         TEXT NOT NULL REFERENCES users(id),
      content         TEXT NOT NULL,
      created_at      TEXT DEFAULT (datetime('now'))
    )
  `);

  // ─── Citizen Updates ─────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS citizen_updates (
      id              TEXT PRIMARY KEY,
      report_id       TEXT NOT NULL REFERENCES reports(id),
      user_id         TEXT NOT NULL REFERENCES users(id),
      content         TEXT NOT NULL,
      created_at      TEXT DEFAULT (datetime('now'))
    )
  `);

  // ─── Upvotes ─────────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS upvotes (
      id              TEXT PRIMARY KEY,
      report_id       TEXT NOT NULL REFERENCES reports(id),
      user_id         TEXT NOT NULL REFERENCES users(id),
      created_at      TEXT DEFAULT (datetime('now')),
      UNIQUE(report_id, user_id)
    )
  `);

  // ─── Duplicate Suggestions ───────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS duplicate_suggestions (
      id                TEXT PRIMARY KEY,
      report_id         TEXT NOT NULL REFERENCES reports(id),
      duplicate_of_id   TEXT NOT NULL REFERENCES reports(id),
      similarity_score  REAL,
      distance_meters   REAL,
      source            TEXT CHECK(source IN ('ai_provider','rules_engine')),
      status            TEXT DEFAULT 'pending' CHECK(status IN ('pending','confirmed','rejected')),
      decided_by        TEXT REFERENCES users(id),
      decided_at        TEXT,
      created_at        TEXT DEFAULT (datetime('now'))
    )
  `);

  // ─── SLA Settings ───────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS sla_settings (
      id                TEXT PRIMARY KEY,
      priority          TEXT UNIQUE NOT NULL CHECK(priority IN ('critical','medium','low')),
      target_hours      INTEGER NOT NULL,
      escalation_hours  INTEGER NOT NULL,
      created_at        TEXT DEFAULT (datetime('now')),
      updated_at        TEXT DEFAULT (datetime('now'))
    )
  `);

  // ─── Escalation Records ─────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS escalation_records (
      id                TEXT PRIMARY KEY,
      report_id         TEXT NOT NULL REFERENCES reports(id),
      escalation_level  INTEGER NOT NULL,
      reason            TEXT NOT NULL,
      escalated_at      TEXT DEFAULT (datetime('now')),
      acknowledged_by   TEXT REFERENCES users(id),
      acknowledged_at   TEXT
    )
  `);

  // ─── Notifications ──────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS notifications (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL REFERENCES users(id),
      report_id       TEXT REFERENCES reports(id),
      type            TEXT NOT NULL,
      title           TEXT NOT NULL,
      message         TEXT NOT NULL,
      is_read         INTEGER DEFAULT 0,
      created_at      TEXT DEFAULT (datetime('now'))
    )
  `);

  // ─── Audit Log ───────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL REFERENCES users(id),
      action          TEXT NOT NULL,
      entity_type     TEXT NOT NULL,
      entity_id       TEXT,
      old_value       TEXT,
      new_value       TEXT,
      created_at      TEXT DEFAULT (datetime('now'))
    )
  `);

  // ─── App Settings ────────────────────────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key             TEXT PRIMARY KEY,
      value           TEXT NOT NULL,
      updated_at      TEXT DEFAULT (datetime('now'))
    )
  `);

  // ─── App Reviews & Resolution Ratings ────────────────────────────────────
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_reviews (
      id              TEXT PRIMARY KEY,
      user_id         TEXT REFERENCES users(id),
      report_id       TEXT REFERENCES reports(id),
      rating          INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
      issue_resolved  TEXT NOT NULL CHECK(issue_resolved IN ('yes','partially','no')),
      title           TEXT,
      comment         TEXT NOT NULL,
      created_at      TEXT DEFAULT (datetime('now'))
    )
  `);

  // ─── Indexes ─────────────────────────────────────────────────────────────
  // Reports indexes for common query patterns
  db.exec(`CREATE INDEX IF NOT EXISTS idx_reports_user_id       ON reports(user_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_reports_status        ON reports(status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_reports_department_id ON reports(department_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_reports_category      ON reports(category)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_reports_priority      ON reports(priority)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_reports_created_at    ON reports(created_at)`);

  // Status history lookups by report
  db.exec(`CREATE INDEX IF NOT EXISTS idx_status_history_report_id ON status_history(report_id)`);

  // Upvote lookups
  db.exec(`CREATE INDEX IF NOT EXISTS idx_upvotes_report_id ON upvotes(report_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_upvotes_user_id   ON upvotes(user_id)`);

  // Notification queries for unread count and listing
  db.exec(`CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, is_read)`);

  // Audit log entity lookups
  db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id)`);

  // App reviews lookups
  db.exec(`CREATE INDEX IF NOT EXISTS idx_app_reviews_created_at ON app_reviews(created_at)`);

  return db;
}

module.exports = { initDatabase };
