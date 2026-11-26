# Civ.IQ — Civic Issue Reporting & Resolution MVP

Civ.IQ is a beginner-friendly, zero-dependency local MVP for reporting local civic issues (potholes, garbage, stray animals, broken streetlights, water/drainage) and managing their review, routing, SLA tracking, and resolution.

> **⚠️ Demo Disclaimer:** This local MVP uses development/demo authentication, an in-app rules-based classification engine, in-app notifications, and local file storage. It is **not** an emergency service and is **not** production-hardened out of the box.

---

## Prerequisites

- **Node.js v22+ / v26+** (built with `node:http`, `node:sqlite`, `node:test` — **zero `npm install` required**)
- Modern web browser (for Geolocation API and Leaflet OpenStreetMap tiles)

---

## Quick Start

1. **Navigate to the project directory:**
   ```powershell
   cd c:\Users\dsamr\Downloads\civ.iq
   ```

2. **(Optional) Review environment variables:**
   See [.env.example](.env.example). Defaults work out of the box (`PORT=3000`, `DB_PATH=./civiq.db`).

3. **Start the application:**
   ```powershell
   node server.js
   ```
   On startup, `server.js` automatically initializes the SQLite database (`civiq.db`), creates all tables/indexes idempotently, and seeds realistic fictional demo data.

4. **Open in your browser:**
   Visit `http://localhost:3000`

5. **Run the automated test suite:**
   ```powershell
   node --test tests/
   ```

6. **Check health endpoint:**
   `GET http://localhost:3000/api/health`

---

## Demo Accounts (Development Only)

Use the **Demo Mode** bar at the top of the UI to switch between seeded accounts:

| Name | Email | Role | Capabilities |
|------|-------|------|--------------|
| Priya Sharma | `priya@demo.civiq.local` | `citizen` | Submit reports, track own reports, upvote, view community feed & leaderboard |
| Rahul Verma | `rahul@demo.civiq.local` | `citizen` | Submit reports, track own reports, upvote, view community feed & leaderboard |
| Meera Patel | `meera@demo.civiq.local` | `staff` | Staff dashboard, review/assign/update reports, internal notes, citizen updates, duplicate decisions, escalation checks |
| Arjun Singh | `arjun@demo.civiq.local` | `admin` | All staff capabilities + manage departments, SLA targets, user roles, and app settings |

> **Production Auth Note:** Production deployment requires real authentication (hashed passwords or OAuth2/OIDC, MFA, persistent session store, CSRF protection) instead of the demo role switcher.

---

## Project Structure

```text
civ.iq/
├── server.js                    # Node.js HTTP server, static/upload serving, API router
├── .env.example                 # Safe placeholder environment variables
├── README.md                    # Setup, architecture, and production checklist
├── public/
│   ├── index.html               # SPA shell + demo auth bar + Leaflet CDN
│   ├── css/style.css            # Responsive civic design system
│   └── js/
│       ├── app.js               # Hash router, state, Citizen/Staff/Admin views
│       └── components/all.js    # Reusable UI components & XSS escaping
├── src/
│   ├── db/
│   │   ├── schema.js            # SQLite schema & indexes (node:sqlite)
│   │   └── seed.js              # Idempotent demo data seeder
│   ├── middleware/
│   │   ├── auth.js              # Session cookies & server-side role checks
│   │   └── upload.js            # Multipart parser & magic-byte image validation
│   ├── routes/
│   │   ├── auth.js              # /api/auth/*
│   │   ├── reports.js           # /api/reports/*
│   │   ├── staff.js             # /api/staff/*
│   │   ├── admin.js             # /api/admin/*
│   │   ├── community.js         # /api/community/* & /api/notifications/*
│   │   └── health.js            # /api/health
│   ├── services/
│   │   ├── classifier.js        # AI provider interface + rules-based fallback
│   │   ├── sla.js               # SLA deadlines, pause/resume, escalation checks
│   │   └── notifications.js     # In-app notification persistence
│   └── utils/helpers.js         # Validation, Haversine distance, status transitions
├── tests/app.test.js            # Automated tests (node:test)
└── uploads/                     # Uploaded report images (.jpg, .png, .webp)
```

---

## API Overview

- **Health:** `GET /api/health`
- **Auth (Demo):** `GET /api/auth/demo-users`, `GET /api/auth/me`, `POST /api/auth/demo-login`, `POST /api/auth/logout`
- **Reports:** `POST /api/reports`, `GET /api/reports/my`, `GET /api/reports/classify`, `GET /api/reports/duplicates`, `GET /api/reports/:id`, `POST /api/reports/:id/upvote`
- **Community & Notifications:** `GET /api/community/feed`, `GET /api/community/leaderboard`, `GET /api/community/recent-resolved`, `GET /api/community/map-data`, `GET /api/notifications`, `PUT /api/notifications/:id/read`, `PUT /api/notifications/read-all`
- **Staff (`staff` / `admin`):** `GET /api/staff/dashboard`, `GET /api/staff/reports`, `GET /api/staff/reports/:id`, `PUT /api/staff/reports/:id/status`, `PUT /api/staff/reports/:id/priority`, `PUT /api/staff/reports/:id/assign`, `POST /api/staff/reports/:id/notes`, `POST /api/staff/reports/:id/updates`, `PUT /api/staff/reports/:id/duplicate`, `PUT /api/staff/reports/:id/pause`, `PUT /api/staff/reports/:id/resume`, `GET /api/staff/escalations`, `POST /api/staff/escalations/check`
- **Admin (`admin`):** `GET/POST /api/admin/departments`, `PUT/DELETE /api/admin/departments/:id`, `GET /api/admin/sla`, `PUT /api/admin/sla/:id`, `GET /api/admin/users`, `PUT /api/admin/users/:id/role`, `GET/PUT /api/admin/settings`

---

## Known Demo-Only Limitations

1. **Authentication:** Uses an in-memory session `Map` and one-click demo role switching. Sessions clear on server restart.
2. **AI Classification & Duplicates:** Uses a transparent, deterministic local **rules-based demo analysis** (`src/services/classifier.js`). Image analysis is not performed locally; a provider interface (`setProvider`) is included for future AI integration.
3. **Identity Verification:** Uses a non-biometric `verified_status` (`demo`/`pending`/`verified`) placeholder without an external identity provider.
4. **Notifications:** Stored in SQLite and shown in-app only (no email or SMS delivery).
5. **SLA Pause Clock:** Pausing a report records `paused_at` and `paused_reason`, but in this demo the SLA deadline is not automatically extended by paused duration.
6. **Escalation Checks:** Triggered manually via the **Run Escalation Check** button (`POST /api/staff/escalations/check`) rather than a background cron daemon.
7. **Storage:** Local SQLite (`civiq.db`) and local `uploads/` directory are intended for single-instance local demos.

---

## Production-Readiness Checklist

- [ ] Replace demo auth with OAuth2/OIDC or password auth + MFA + persistent session store (e.g., Redis)
- [ ] Enable HTTPS/TLS and `Secure` cookies + CSRF tokens
- [ ] Move file uploads to object storage (S3/GCS) with virus/malware scanning
- [ ] Migrate SQLite to PostgreSQL/PostGIS for multi-instance concurrency and spatial queries
- [ ] Connect a real AI provider via `setProvider()` in `src/services/classifier.js`
- [ ] Configure transactional email/SMS providers and scheduled background SLA escalation jobs

---

## Troubleshooting

- **Port 3000 already in use:** Start with a custom port: `$env:PORT=3001; node server.js`
- **Reset demo database:** Stop the server, delete `civiq.db` (and `-wal`/`-shm` files if present), and run `node server.js` again.
- **Map tiles not loading:** Leaflet loads tiles from OpenStreetMap CDN (`unpkg.com` and `openstreetmap.org`); offline environments will still work with coordinates and manual address fallback.

## Community Verification, Anti-Duplicate Support & Accessibility

### 1. Community Resolution Verification
- **Trigger:** When municipal staff mark a report as `resolved`, `verification_state` becomes `awaiting` with a configurable deadline (`verification_window_hours`, default `72` hours in `app_settings`). The original reporter and any citizens who upvoted or supported the report receive an in-app notification.
- **Eligibility Rule (enforced server-side):** Only authenticated `citizen` accounts who are **not** the report owner (`user.id !== report.user_id`) may vote while `status === 'resolved'` and `verification_state === 'awaiting'`. Staff, admins, and report owners are blocked (`403`). One active vote per citizen per report is enforced via `idx_res_verif_active` in SQLite (`409` on duplicate vote).
- **Thresholds & Evaluation:** Configurable in `app_settings` (`verification_fixed_threshold = 2`, `verification_reopen_threshold = 2`). Reaching the fixed threshold sets `verification_state = 'verified_resolved'`; reaching the still-present threshold reopens the report (`status = 'reopened'`, `verification_state = 'needs_followup'`) and notifies staff.
- **Staff Review & Expiry Limitation:** Because this MVP runs without a background job scheduler, expired verification windows are evaluated on demand via `POST /api/staff/verifications/check-expired` rather than a background cron. Staff can also record an explicit decision (`confirm_resolved`, `reopen`, or `close_with_explanation`) on any report in `#/staff/report/:id`.

### 2. Support an Existing Report Instead of Duplicating It
- **Separate from Upvotes:** `report_supports` (`POST` / `DELETE /api/reports/:id/support`) tracks citizens experiencing the same issue so they can support an active report instead of filing a duplicate, while `upvotes` remains for community priority voting.
- **Rules:** Enforces one active support per citizen per report (`UNIQUE(report_id, user_id)`). Resolved or closed reports cannot receive new support (`400`) and direct citizens to community verification instead. Reports are never auto-merged or deleted; staff review duplicate suggestions manually.

### 3. Accessibility & Language Options
- **Language Selector & Simple-Language Mode:** Available in the header (`public/js/i18n.js`). Includes **English (`en`)** and a clearly labeled demonstration **Hindi (`hi`)** translation, plus a **Simple words** toggle for shorter, clearer citizen wording.
- **Persistence:** Saved in `localStorage` (`civiq_lang`, `civiq_simple_lang`).
- **Adding Languages:** Add a new key under `STRINGS` (and optionally `SIMPLE_OVERRIDES`) in `public/js/i18n.js` and add the `<option>` to `#lang-select` in `public/index.html`.
- **Content Policy:** User-submitted descriptions, comments, and staff notes are never auto-translated and are displayed in their original language.
