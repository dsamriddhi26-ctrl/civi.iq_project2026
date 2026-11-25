/**
 * Civ.IQ — Main Single-Page Application (SPA)
 * ==========================================
 * Hash router, state management, demo auth switcher,
 * Citizen, Staff, and Admin views.
 *
 * Uses ONLY browser APIs, Leaflet (CDN), and window.CivIQ components.
 */

/* global L */
(function () {
  'use strict';

  const C = window.CivIQ || {};
  const esc = C.escapeHtml || function (str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };

  // ─── Constants & Mappings ──────────────────────────────────────────────────

  const CATEGORY_LABELS = {
    pothole: 'Pothole/Road Damage',
    garbage: 'Garbage/Waste',
    stray_animal: 'Stray Animal',
    streetlight: 'Streetlight',
    water_drainage: 'Water/Drainage',
    other: 'Other'
  };

  const STATUS_LABELS = {
    submitted: 'Submitted',
    under_review: 'Under Review',
    assigned: 'Assigned',
    in_progress: 'In Progress',
    resolved: 'Resolved',
    closed: 'Closed',
    reopened: 'Reopened'
  };

  const PRIORITY_LABELS = {
    critical: 'Critical',
    medium: 'Medium',
    low: 'Low'
  };

  const STATUS_TRANSITIONS = {
    submitted: ['under_review', 'assigned', 'closed'],
    under_review: ['assigned', 'in_progress', 'resolved', 'closed'],
    assigned: ['in_progress', 'resolved', 'closed'],
    in_progress: ['resolved', 'closed'],
    resolved: ['closed', 'reopened'],
    closed: ['reopened'],
    reopened: ['under_review', 'assigned', 'in_progress', 'resolved', 'closed']
  };

  const DEFAULT_COORDS = { lat: 19.0760, lng: 72.8777 }; // Mumbai demo center

  // ─── Global Application State ──────────────────────────────────────────────

  const state = {
    user: null,
    demoUsers: [],
    notifications: [],
    unreadCount: 0,
    activeMaps: [],
    communityFilters: {
      search: '',
      category: '',
      status: '',
      priority: '',
      sort: 'newest',
      page: 1,
      showMap: false
    },
    staffFilters: {
      search: '',
      status: '',
      priority: '',
      category: '',
      page: 1
    },
    reportDraft: createEmptyDraft()
  };

  function createEmptyDraft() {
    return {
      step: 1,
      category: 'pothole',
      description: '',
      isAnonymous: false,
      file: null,
      previewSrc: null,
      latitude: null,
      longitude: null,
      address: '',
      submittedReport: null
    };
  }

  // ─── Format & Display Helpers ──────────────────────────────────────────────

  function catLabel(cat) {
    return CATEGORY_LABELS[cat] || cat || 'Other';
  }

  function statusLabel(st) {
    return STATUS_LABELS[st] || st || 'Submitted';
  }

  function priorityLabel(pr) {
    return PRIORITY_LABELS[pr] || pr || 'Medium';
  }

  function statusBadge(st) {
    return C.renderStatusBadge ? C.renderStatusBadge(statusLabel(st)) : esc(statusLabel(st));
  }

  function priorityBadge(pr) {
    return C.renderPriorityBadge ? C.renderPriorityBadge(priorityLabel(pr)) : esc(priorityLabel(pr));
  }

  function formatDate(iso) {
    return C.formatDate ? C.formatDate(iso) : esc(iso || '—');
  }

  function timeAgo(iso) {
    return C.timeAgo ? C.timeAgo(iso) : esc(iso || '');
  }

  function debounce(fn, ms) {
    let timer = null;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  // ─── API Helper ────────────────────────────────────────────────────────────

  async function fetchAPI(url, options = {}) {
    const opts = {
      credentials: 'include',
      ...options
    };

    if (opts.body && !(opts.body instanceof FormData) && typeof opts.body === 'object') {
      opts.headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
      opts.body = JSON.stringify(opts.body);
    }

    const res = await fetch(url, opts);
    let data = {};
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      data = await res.json();
    }

    if (!res.ok) {
      const msg = data.error || `Request failed (${res.status})`;
      throw new Error(msg);
    }
    return data;
  }

  // ─── Toast & Modal ─────────────────────────────────────────────────────────

  function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.setAttribute('role', 'status');
    toast.innerHTML = `
      <span>${esc(message)}</span>
      <button type="button" class="toast-close" aria-label="Dismiss">&times;</button>
    `;

    toast.querySelector('.toast-close').addEventListener('click', () => toast.remove());
    container.appendChild(toast);

    setTimeout(() => {
      if (toast.parentNode) toast.remove();
    }, 4500);
  }

  function showModal(title, contentHtml, actions = []) {
    const overlay = document.getElementById('modal-overlay');
    const titleEl = document.getElementById('modal-title');
    const bodyEl = document.getElementById('modal-body');
    const actionsEl = document.getElementById('modal-actions');
    if (!overlay) return;

    titleEl.textContent = title;
    bodyEl.innerHTML = contentHtml;
    actionsEl.innerHTML = '';

    actions.forEach(act => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `btn ${act.className || 'btn-secondary'}`;
      btn.textContent = act.label;
      btn.addEventListener('click', () => {
        if (act.onClick) act.onClick(closeModal);
        else closeModal();
      });
      actionsEl.appendChild(btn);
    });

    if (actions.length === 0) {
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'btn btn-secondary';
      closeBtn.textContent = 'Close';
      closeBtn.addEventListener('click', closeModal);
      actionsEl.appendChild(closeBtn);
    }

    overlay.hidden = false;
    overlay.setAttribute('aria-hidden', 'false');
  }

  function closeModal() {
    const overlay = document.getElementById('modal-overlay');
    if (!overlay) return;
    overlay.hidden = true;
    overlay.setAttribute('aria-hidden', 'true');
  }

  // ─── Leaflet Map Helpers ───────────────────────────────────────────────────

  function cleanupMaps() {
    while (state.activeMaps.length > 0) {
      const map = state.activeMaps.pop();
      try {
        map.remove();
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  function renderMap(containerId, lat, lng, markers = [], options = {}) {
    const el = document.getElementById(containerId);
    if (!el) return null;

    if (typeof L === 'undefined') {
      el.innerHTML = '<div class="empty-state"><p>Map library unavailable offline. Use coordinates or address fallback.</p></div>';
      return null;
    }

    const centerLat = lat != null ? Number(lat) : DEFAULT_COORDS.lat;
    const centerLng = lng != null ? Number(lng) : DEFAULT_COORDS.lng;
    const zoom = options.zoom || (lat != null ? 15 : 12);

    const map = L.map(containerId).setView([centerLat, centerLng], zoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19
    }).addTo(map);

    markers.forEach(m => {
      if (m.lat == null || m.lng == null) return;
      const marker = L.marker([Number(m.lat), Number(m.lng)], {
        draggable: !!m.draggable
      }).addTo(map);

      if (m.popup) {
        marker.bindPopup(m.popup);
      }
      if (m.onDragEnd) {
        marker.on('dragend', () => {
          const pos = marker.getLatLng();
          m.onDragEnd(pos.lat, pos.lng);
        });
      }
    });

    if (options.onClick) {
      map.on('click', (e) => {
        options.onClick(e.latlng.lat, e.latlng.lng);
      });
    }

    state.activeMaps.push(map);
    setTimeout(() => map.invalidateSize(), 100);
    return map;
  }

  // ─── Authentication & Header UI ────────────────────────────────────────────

  async function initAuth() {
    try {
      const [demoData, meData] = await Promise.all([
        fetchAPI('/api/auth/demo-users'),
        fetchAPI('/api/auth/me')
      ]);
      state.demoUsers = demoData.users || [];
      state.user = meData.user || null;
    } catch (err) {
      console.error('Auth init failed:', err);
    }
    renderDemoAuthBar();
    renderNavigation();
    await refreshNotifications();
  }

  function renderDemoAuthBar() {
    const container = document.querySelector('.demo-auth-buttons');
    if (!container) return;

    if (state.demoUsers.length === 0) {
      container.innerHTML = '<span class="text-xs">No demo accounts found</span>';
      return;
    }

    const roleIcons = { citizen: '👤', staff: '🛠️', admin: '🔑' };

    const buttonsHtml = state.demoUsers.map(u => {
      const isActive = state.user && state.user.id === u.id;
      const icon = roleIcons[u.role] || '👤';
      const labelRole = u.role.charAt(0).toUpperCase() + u.role.slice(1);
      return `
        <button type="button"
                class="demo-btn ${isActive ? 'active' : ''}"
                data-demo-user-id="${esc(u.id)}"
                aria-pressed="${isActive ? 'true' : 'false'}">
          ${icon} ${esc(labelRole)} (${esc(u.displayName.split(' ')[0])})
        </button>
      `;
    }).join('');

    const logoutHtml = state.user
      ? `<button type="button" class="demo-btn" id="demo-logout-btn">Sign Out (${esc(state.user.displayName.split(' ')[0])})</button>`
      : '';

    container.innerHTML = buttonsHtml + logoutHtml;
  }

  async function handleDemoLogin(userId) {
    try {
      const data = await fetchAPI('/api/auth/demo-login', {
        method: 'POST',
        body: { userId }
      });
      state.user = data.user;
      renderDemoAuthBar();
      renderNavigation();
      await refreshNotifications();
      showToast(`Signed in as ${data.user.displayName} (${data.user.role})`, 'success');
      route();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function handleLogout() {
    try {
      await fetchAPI('/api/auth/logout', { method: 'POST' });
      state.user = null;
      state.notifications = [];
      state.unreadCount = 0;
      renderDemoAuthBar();
      renderNavigation();
      renderNotificationsUI();
      showToast('Signed out', 'info');
      route();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  function renderNavigation() {
    const nav = document.getElementById('main-nav');
    if (!nav) return;

    const hash = window.location.hash || '#/home';
    const role = state.user ? state.user.role : null;

    const links = [
      { href: '#/home', label: 'Home' },
      { href: '#/report/new', label: 'Report Issue' },
      ...(state.user ? [{ href: '#/my-reports', label: 'My Reports' }] : []),
      { href: '#/community', label: 'Community' },
      { href: '#/leaderboard', label: 'Leaderboard' }
    ];

    if (role === 'staff' || role === 'admin') {
      links.push(
        { href: '#/staff/dashboard', label: 'Dashboard' },
        { href: '#/staff/reports', label: 'Staff Queue' },
        { href: '#/staff/escalations', label: 'Escalations' }
      );
    }

    if (role === 'admin') {
      links.push(
        { href: '#/admin/departments', label: 'Departments' },
        { href: '#/admin/sla', label: 'SLA' },
        { href: '#/admin/users', label: 'Users' },
        { href: '#/admin/settings', label: 'Settings' }
      );
    }

    nav.innerHTML = links.map(l => {
      const active = hash.startsWith(l.href) ? 'active' : '';
      return `<a href="${l.href}" class="nav-link ${active}">${esc(l.label)}</a>`;
    }).join('');
  }

  // ─── Notifications ─────────────────────────────────────────────────────────

  async function refreshNotifications() {
    if (!state.user) {
      state.notifications = [];
      state.unreadCount = 0;
      renderNotificationsUI();
      return;
    }

    try {
      const data = await fetchAPI('/api/notifications?limit=15');
      state.notifications = data.notifications || [];
      state.unreadCount = data.unreadCount || 0;
      renderNotificationsUI();
    } catch {
      // Ignore notification polling failures
    }
  }

  function renderNotificationsUI() {
    const bellWrap = document.getElementById('notification-bell');
    const badge = document.getElementById('notification-badge');
    const dropdown = document.getElementById('notification-dropdown');
    if (!bellWrap || !badge || !dropdown) return;

    if (!state.user) {
      bellWrap.style.display = 'none';
      return;
    }

    bellWrap.style.display = '';
    if (state.unreadCount > 0) {
      badge.textContent = state.unreadCount > 99 ? '99+' : String(state.unreadCount);
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }

    dropdown.innerHTML = C.NotificationDropdown
      ? C.NotificationDropdown(state.notifications)
      : '<div class="notification-empty">No notifications</div>';
  }

  // ─── Router ────────────────────────────────────────────────────────────────

  function navigate(hash) {
    window.location.hash = hash;
  }

  function parseRoute() {
    const raw = window.location.hash || '#/home';
    const path = raw.replace(/^#/, '');
    return path.startsWith('/') ? path : `/${path}`;
  }

  async function route() {
    cleanupMaps();
    const navToggle = document.getElementById('nav-toggle');
    if (navToggle) navToggle.checked = false;

    renderNavigation();

    const path = parseRoute();
    const app = document.getElementById('app');
    if (!app) return;

    // Role guard helper
    const role = state.user ? state.user.role : null;

    if (path.startsWith('/staff/') && role !== 'staff' && role !== 'admin') {
      app.innerHTML = renderAccessDenied('Municipal Staff or Administrator');
      return;
    }

    if (path.startsWith('/admin/') && role !== 'admin') {
      app.innerHTML = renderAccessDenied('Administrator');
      return;
    }

    app.innerHTML = '<div class="loading-spinner"><div class="spinner"></div><p>Loading…</p></div>';

    try {
      if (path === '/' || path === '/home') {
        await renderHomePage(app);
      } else if (path === '/report/new') {
        await renderReportNewPage(app);
      } else if (path.match(/^\/report\/([^/]+)$/)) {
        const id = decodeURIComponent(path.match(/^\/report\/([^/]+)$/)[1]);
        await renderReportDetailPage(app, id);
      } else if (path === '/my-reports') {
        await renderMyReportsPage(app);
      } else if (path === '/community') {
        await renderCommunityFeedPage(app);
      } else if (path === '/leaderboard') {
        await renderLeaderboardPage(app);
      } else if (path === '/staff/dashboard') {
        await renderStaffDashboardPage(app);
      } else if (path === '/staff/reports') {
        await renderStaffReportListPage(app);
      } else if (path.match(/^\/staff\/report\/([^/]+)$/)) {
        const id = decodeURIComponent(path.match(/^\/staff\/report\/([^/]+)$/)[1]);
        await renderStaffReportDetailPage(app, id);
      } else if (path === '/staff/escalations') {
        await renderEscalationsPage(app);
      } else if (path === '/admin/departments') {
        await renderAdminDepartmentsPage(app);
      } else if (path === '/admin/sla') {
        await renderAdminSLAPage(app);
      } else if (path === '/admin/users') {
        await renderAdminUsersPage(app);
      } else if (path === '/admin/settings') {
        await renderAdminSettingsPage(app);
      } else {
        app.innerHTML = `
          <div class="card empty-state">
            <div class="empty-state-icon" aria-hidden="true">🔍</div>
            <h1>Page Not Found</h1>
            <p class="text-muted mb-md">The requested view does not exist.</p>
            <a href="#/home" class="btn btn-primary">Return Home</a>
          </div>
        `;
      }
    } catch (err) {
      console.error('Route render error:', err);
      app.innerHTML = `
        <div class="card empty-state">
          <div class="empty-state-icon" aria-hidden="true">⚠️</div>
          <h2>Unable to load page</h2>
          <p class="text-muted mb-md">${esc(err.message)}</p>
          <a href="#/home" class="btn btn-secondary">Back to Home</a>
        </div>
      `;
    }
  }

  function renderAccessDenied(requiredRole) {
    return `
      <div class="card empty-state">
        <div class="empty-state-icon" aria-hidden="true">🔒</div>
        <h1>Access Restricted</h1>
        <p class="text-muted mb-md">
          This area requires <strong>${esc(requiredRole)}</strong> permissions.
          Use the demo role switcher bar at the top to switch accounts.
        </p>
        <a href="#/home" class="btn btn-primary">Return Home</a>
      </div>
    `;
  }

  function renderSignInPrompt(actionLabel) {
    return `
      <div class="card empty-state">
        <div class="empty-state-icon" aria-hidden="true">👤</div>
        <h1>Sign In Required</h1>
        <p class="text-muted mb-md">
          Please select a demo account in the top bar to ${esc(actionLabel)}.
        </p>
        <a href="#/community" class="btn btn-secondary">Browse Community Reports</a>
      </div>
    `;
  }

  // ─── 1. HomePage ───────────────────────────────────────────────────────────

  async function renderHomePage(app) {
    let recent = [];
    try {
      const data = await fetchAPI('/api/community/recent-resolved');
      recent = data.reports || [];
    } catch {
      recent = [];
    }

    app.innerHTML = `
      <section class="hero card mb-lg">
        <h1>Report civic issues. Track resolution. Build a better community.</h1>
        <p class="text-muted mb-lg">
          Civ.IQ connects residents with municipal departments to report potholes, waste,
          streetlights, drainage, and stray animal issues with transparent tracking.
        </p>
        <div class="flex gap-md flex-wrap justify-center">
          <a href="#/report/new" class="btn btn-primary btn-lg">Report an Issue</a>
          <a href="#/community" class="btn btn-secondary btn-lg">Browse Community Reports</a>
        </div>
      </section>

      <div class="emergency-banner mb-lg" role="note">
        <strong>⚠️ Not an Emergency Service:</strong>
        Civ.IQ is for non-emergency civic maintenance only. For immediate life-safety, fire,
        medical, or crime emergencies, dial your local emergency number (e.g., 112 / 100).
      </div>

      <section class="grid grid-3 mb-xl">
        <article class="card">
          <div class="card-body">
            <h2>1. Report</h2>
            <p class="text-muted mb-md">Describe the issue, attach a photo, and pin the location via GPS or manual address.</p>
            <a href="#/report/new" class="btn btn-ghost btn-sm">Submit Report &rarr;</a>
          </div>
        </article>
        <article class="card">
          <div class="card-body">
            <h2>2. Track</h2>
            <p class="text-muted mb-md">Follow real-time status updates from Submitted through Assigned, In Progress, and Resolved.</p>
            <a href="#/my-reports" class="btn btn-ghost btn-sm">My Reports &rarr;</a>
          </div>
        </article>
        <article class="card">
          <div class="card-body">
            <h2>3. Community</h2>
            <p class="text-muted mb-md">Search local reports, upvote shared neighborhood priorities, and view top contributors.</p>
            <a href="#/community" class="btn btn-ghost btn-sm">Explore Feed &rarr;</a>
          </div>
        </article>
      </section>

      <section class="card">
        <div class="card-header flex justify-between items-center">
          <h2>Recently Resolved Issues</h2>
          <a href="#/community" class="btn btn-ghost btn-sm">View All</a>
        </div>
        <div class="card-body">
          ${recent.length === 0 ? '<p class="text-muted">No resolved reports yet.</p>' : `
            <div class="grid grid-2">
              ${recent.map(r => `
                <div class="detail-row">
                  <div>
                    <strong>${esc(r.reportNumber)}</strong> · ${esc(catLabel(r.category))}
                    <p class="text-sm text-muted">${esc(r.description)}</p>
                  </div>
                  <div class="text-xs text-muted">${esc(r.departmentName || '')} · ${timeAgo(r.resolvedAt)}</div>
                </div>
              `).join('')}
            </div>
          `}
        </div>
      </section>
    `;
  }

  // ─── 2. ReportNewPage (3-Step Wizard) ──────────────────────────────────────

  async function renderReportNewPage(app) {
    if (!state.user) {
      app.innerHTML = renderSignInPrompt('submit a civic issue report');
      return;
    }

    const d = state.reportDraft;

    if (d.submittedReport) {
      const rep = d.submittedReport;
      app.innerHTML = `
        <section class="card confirmation-box">
          <div style="font-size: 2.5rem;" aria-hidden="true">✅</div>
          <h1>Report Submitted</h1>
          <p class="text-muted mb-md">Your report has been recorded and routed for review.</p>
          <p class="mb-sm"><strong>Report Number:</strong> ${esc(rep.reportNumber)}</p>
          <p class="mb-sm"><strong>Assigned Department:</strong> ${esc(rep.department || 'General Services')}</p>
          <p class="mb-md"><strong>Suggested Priority:</strong> ${priorityBadge(rep.priority)}</p>
          <div class="flex gap-md justify-center flex-wrap mt-lg">
            <a href="#/report/${esc(rep.id)}" class="btn btn-primary">Track This Report</a>
            <button type="button" class="btn btn-secondary" id="new-another-btn">Submit Another Report</button>
          </div>
        </section>
      `;
      document.getElementById('new-another-btn')?.addEventListener('click', () => {
        state.reportDraft = createEmptyDraft();
        renderReportNewPage(app);
      });
      return;
    }

    const stepIndicator = `
      <div class="flex gap-sm mb-lg flex-wrap" aria-label="Form steps">
        <span class="badge ${d.step === 1 ? 'badge-submitted' : 'badge-closed'}">1. Issue Details</span>
        <span class="badge ${d.step === 2 ? 'badge-submitted' : 'badge-closed'}">2. Location</span>
        <span class="badge ${d.step === 3 ? 'badge-submitted' : 'badge-closed'}">3. Review &amp; Submit</span>
      </div>
    `;

    if (d.step === 1) {
      app.innerHTML = `
        <section class="card">
          <div class="card-header"><h1>Report a Civic Issue</h1></div>
          <div class="card-body">
            ${stepIndicator}
            <form id="step1-form" novalidate>
              <div class="form-group">
                <label class="form-label" for="report-category">Category</label>
                <select id="report-category" class="form-select" required>
                  ${Object.entries(CATEGORY_LABELS).map(([val, lbl]) => `
                    <option value="${esc(val)}" ${d.category === val ? 'selected' : ''}>${esc(lbl)}</option>
                  `).join('')}
                </select>
              </div>

              <div class="form-group">
                <label class="form-label" for="report-description">Description</label>
                <textarea id="report-description" class="form-textarea" rows="4" required minlength="20"
                          placeholder="Describe the location, severity, and details of the issue (minimum 20 characters)...">${esc(d.description)}</textarea>
                <p class="form-help">Minimum 20 characters. Include safety hazards if applicable.</p>
                <p class="form-error" id="step1-desc-error" hidden></p>
              </div>

              <div class="form-group">
                <label class="form-label">Photo Evidence <span class="text-xs text-muted">(optional)</span></label>
                <div id="image-upload-container">
                  ${C.ImageUpload ? C.ImageUpload(d.previewSrc) : ''}
                </div>
                <p class="form-error" id="step1-img-error" hidden></p>
              </div>

              <div class="form-group form-check">
                <input type="checkbox" id="report-anonymous" ${d.isAnonymous ? 'checked' : ''}>
                <label for="report-anonymous">Hide my name from the public community feed</label>
              </div>
              <p class="form-help mb-lg">
                Your identity will be hidden from the community feed (shown as "Community Member"),
                but remains visible to authorized municipal staff for verification.
              </p>

              <div class="flex justify-between">
                <a href="#/home" class="btn btn-ghost">Cancel</a>
                <button type="submit" class="btn btn-primary">Next: Location &rarr;</button>
              </div>
            </form>
          </div>
        </section>
      `;

      bindImageUploadEvents(d);

      document.getElementById('step1-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const cat = document.getElementById('report-category').value;
        const desc = document.getElementById('report-description').value.trim();
        const anon = document.getElementById('report-anonymous').checked;
        const errEl = document.getElementById('step1-desc-error');

        if (desc.length < 20) {
          errEl.textContent = 'Please enter at least 20 characters describing the issue.';
          errEl.hidden = false;
          return;
        }
        errEl.hidden = true;
        d.category = cat;
        d.description = desc;
        d.isAnonymous = anon;
        d.step = 2;
        renderReportNewPage(app);
      });
      return;
    }

    if (d.step === 2) {
      app.innerHTML = `
        <section class="card">
          <div class="card-header"><h1>Report Location</h1></div>
          <div class="card-body">
            ${stepIndicator}
            ${C.LocationPicker ? C.LocationPicker(d.latitude, d.longitude, d.address) : ''}
            <div class="flex justify-between mt-lg">
              <button type="button" class="btn btn-secondary" id="step2-back">&larr; Back</button>
              <button type="button" class="btn btn-primary" id="step2-next">Next: Review &rarr;</button>
            </div>
          </div>
        </section>
      `;

      const updateCoordsText = (lat, lng) => {
        const el = document.getElementById('coords-display');
        if (el) {
          el.innerHTML = `<strong>Coordinates:</strong> ${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)}`;
          el.classList.remove('text-muted');
        }
      };

      const initLocationMap = () => {
        cleanupMaps();
        const markers = d.latitude != null && d.longitude != null
          ? [{
              lat: d.latitude,
              lng: d.longitude,
              draggable: true,
              popup: 'Selected location (drag to adjust)',
              onDragEnd: (lat, lng) => {
                d.latitude = lat;
                d.longitude = lng;
                updateCoordsText(lat, lng);
              }
            }]
          : [];

        renderMap('location-map', d.latitude, d.longitude, markers, {
          onClick: (lat, lng) => {
            d.latitude = lat;
            d.longitude = lng;
            updateCoordsText(lat, lng);
            initLocationMap();
          }
        });
      };

      initLocationMap();

      document.getElementById('gps-btn')?.addEventListener('click', () => {
        const statusEl = document.getElementById('gps-status');
        if (!navigator.geolocation) {
          if (statusEl) statusEl.textContent = 'Geolocation is not supported by this browser. Use the map or address field below.';
          return;
        }
        if (statusEl) statusEl.textContent = 'Requesting location…';
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            d.latitude = pos.coords.latitude;
            d.longitude = pos.coords.longitude;
            if (statusEl) statusEl.textContent = 'Location captured.';
            updateCoordsText(d.latitude, d.longitude);
            initLocationMap();
          },
          (err) => {
            if (statusEl) {
              statusEl.textContent = err.code === 1
                ? 'Location permission denied. Please click on the map or enter an address below.'
                : 'Unable to capture GPS location. Please use the map or manual address fallback.';
            }
          },
          { enableHighAccuracy: true, timeout: 10000 }
        );
      });

      document.getElementById('step2-back')?.addEventListener('click', () => {
        d.address = document.getElementById('manual-address')?.value.trim() || '';
        d.step = 1;
        renderReportNewPage(app);
      });

      document.getElementById('step2-next')?.addEventListener('click', () => {
        d.address = document.getElementById('manual-address')?.value.trim() || '';
        if (d.latitude == null && !d.address) {
          showToast('Please select a map pin, capture GPS, or enter a manual address.', 'error');
          return;
        }
        d.step = 3;
        renderReportNewPage(app);
      });
      return;
    }

    // Step 3: Review & Submit
    app.innerHTML = `
      <section class="card">
        <div class="card-header"><h1>Review &amp; Submit</h1></div>
        <div class="card-body">
          ${stepIndicator}

          <div class="card mb-md">
            <div class="card-header flex justify-between items-center">
              <strong>Issue Details</strong>
              <button type="button" class="btn btn-ghost btn-sm" id="edit-step1-btn">Edit</button>
            </div>
            <div class="card-body">
              <p><strong>Category:</strong> ${esc(catLabel(d.category))}</p>
              <p><strong>Description:</strong> ${esc(d.description)}</p>
              <p><strong>Visibility:</strong> ${d.isAnonymous ? 'Anonymous to Community' : 'Publicly attributed'}</p>
              ${d.previewSrc ? `<img src="${esc(d.previewSrc)}" alt="Preview" class="image-preview mt-sm">` : ''}
            </div>
          </div>

          <div class="card mb-md">
            <div class="card-header flex justify-between items-center">
              <strong>Location</strong>
              <button type="button" class="btn btn-ghost btn-sm" id="edit-step2-btn">Edit</button>
            </div>
            <div class="card-body">
              <p><strong>Coordinates:</strong> ${d.latitude != null ? `${Number(d.latitude).toFixed(5)}, ${Number(d.longitude).toFixed(5)}` : 'Not provided'}</p>
              <p><strong>Address / Landmark:</strong> ${esc(d.address || 'Not provided')}</p>
            </div>
          </div>

          <div class="card mb-md" id="classification-preview">
            <div class="card-body"><p class="text-muted">Running rules-based demo analysis…</p></div>
          </div>

          <div class="card mb-lg" id="duplicates-preview">
            <div class="card-body"><p class="text-muted">Checking for nearby potential duplicates…</p></div>
          </div>

          <div class="flex justify-between">
            <button type="button" class="btn btn-secondary" id="step3-back">&larr; Back</button>
            <button type="button" class="btn btn-primary btn-lg" id="submit-report-btn">Submit Report</button>
          </div>
        </div>
      </section>
    `;

    document.getElementById('edit-step1-btn')?.addEventListener('click', () => {
      d.step = 1;
      renderReportNewPage(app);
    });
    document.getElementById('edit-step2-btn')?.addEventListener('click', () => {
      d.step = 2;
      renderReportNewPage(app);
    });
    document.getElementById('step3-back')?.addEventListener('click', () => {
      d.step = 2;
      renderReportNewPage(app);
    });

    // Fetch rules-based classification + duplicate suggestions
    try {
      const clsUrl = `/api/reports/classify?description=${encodeURIComponent(d.description)}&category=${encodeURIComponent(d.category)}`;
      const clsData = await fetchAPI(clsUrl);
      const cls = clsData.classification || {};
      const clsEl = document.getElementById('classification-preview');
      if (clsEl) {
        clsEl.innerHTML = `
          <div class="card-header"><strong>${esc(cls.label || 'Rules-based demo analysis')}</strong></div>
          <div class="card-body">
            <p><strong>Suggested Category:</strong> ${esc(catLabel(cls.category))}</p>
            <p><strong>Suggested Priority:</strong> ${priorityBadge(cls.priority)}</p>
            <p><strong>Suggested Department:</strong> ${esc(cls.department || 'General Services')}</p>
            ${cls.note ? `<p class="text-xs text-muted mt-sm">${esc(cls.note)}</p>` : ''}
          </div>
        `;
      }
    } catch {
      const clsEl = document.getElementById('classification-preview');
      if (clsEl) clsEl.innerHTML = '<div class="card-body text-muted">Classification preview unavailable.</div>';
    }

    try {
      const dupUrl = `/api/reports/duplicates?lat=${encodeURIComponent(d.latitude || '')}&lng=${encodeURIComponent(d.longitude || '')}&category=${encodeURIComponent(d.category)}&description=${encodeURIComponent(d.description)}`;
      const dupData = await fetchAPI(dupUrl);
      const dups = dupData.duplicates || [];
      const dupEl = document.getElementById('duplicates-preview');
      if (dupEl) {
        dupEl.innerHTML = `
          <div class="card-header"><strong>Potential Nearby Duplicates (${esc(dupData.label || 'Rules-based demo analysis')})</strong></div>
          <div class="card-body">
            ${dups.length === 0
              ? '<p class="text-muted">No matching nearby reports found.</p>'
              : dups.map(dup => `
                <div class="duplicate-item">
                  <div>
                    <strong>${esc(dup.reportNumber)}</strong> · ${esc(catLabel(dup.category))} · ${statusBadge(dup.status)}
                    <p class="text-sm">${esc(dup.description)}</p>
                    <span class="text-xs text-muted">${dup.distance}m away · Similarity ${Math.round((dup.score || 0) * 100)}%</span>
                  </div>
                  <a href="#/report/${esc(dup.reportId)}" target="_blank" class="btn btn-ghost btn-sm">View</a>
                </div>
              `).join('')
            }
          </div>
        `;
      }
    } catch {
      const dupEl = document.getElementById('duplicates-preview');
      if (dupEl) dupEl.innerHTML = '<div class="card-body text-muted">Duplicate check unavailable.</div>';
    }

    document.getElementById('submit-report-btn')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = 'Submitting…';
      try {
        const fd = new FormData();
        fd.append('category', d.category);
        fd.append('description', d.description);
        fd.append('is_anonymous', d.isAnonymous ? '1' : '0');
        if (d.latitude != null) fd.append('latitude', String(d.latitude));
        if (d.longitude != null) fd.append('longitude', String(d.longitude));
        if (d.address) fd.append('address', d.address);
        if (d.file) fd.append('image', d.file);

        const resData = await fetchAPI('/api/reports', { method: 'POST', body: fd });
        d.submittedReport = resData.report;
        showToast('Report submitted successfully!', 'success');
        await refreshNotifications();
        renderReportNewPage(app);
      } catch (err) {
        showToast(err.message, 'error');
        btn.disabled = false;
        btn.textContent = 'Submit Report';
      }
    });
  }

  function bindImageUploadEvents(draft) {
    const container = document.getElementById('image-upload-container');
    if (!container) return;

    const handleFile = (file) => {
      const errEl = document.getElementById('step1-img-error');
      const allowed = ['image/jpeg', 'image/png', 'image/webp'];
      if (!allowed.includes(file.type)) {
        if (errEl) {
          errEl.textContent = 'Invalid file type. Only JPEG, PNG, and WebP images are allowed.';
          errEl.hidden = false;
        }
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        if (errEl) {
          errEl.textContent = 'File too large. Maximum allowed size is 5MB.';
          errEl.hidden = false;
        }
        return;
      }
      if (errEl) errEl.hidden = true;

      draft.file = file;
      const reader = new FileReader();
      reader.onload = (ev) => {
        draft.previewSrc = ev.target.result;
        container.innerHTML = C.ImageUpload ? C.ImageUpload(draft.previewSrc) : '';
        bindImageUploadEvents(draft);
      };
      reader.readAsDataURL(file);
    };

    const zone = document.getElementById('image-upload-zone');
    const input = document.getElementById('image-file-input');
    const removeBtn = document.getElementById('image-remove-btn');

    if (zone && input) {
      zone.addEventListener('click', () => input.click());
      zone.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          input.click();
        }
      });
      zone.addEventListener('dragover', (e) => e.preventDefault());
      zone.addEventListener('drop', (e) => {
        e.preventDefault();
        if (e.dataTransfer?.files?.[0]) handleFile(e.dataTransfer.files[0]);
      });
      input.addEventListener('change', () => {
        if (input.files?.[0]) handleFile(input.files[0]);
      });
    }

    if (removeBtn) {
      removeBtn.addEventListener('click', () => {
        draft.file = null;
        draft.previewSrc = null;
        container.innerHTML = C.ImageUpload ? C.ImageUpload(null) : '';
        bindImageUploadEvents(draft);
      });
    }
  }

  // ─── 3. ReportDetailPage (Citizen / Public) ────────────────────────────────

  async function renderReportDetailPage(app, reportId) {
    const data = await fetchAPI(`/api/reports/${encodeURIComponent(reportId)}`);
    const r = data.report;

    const timelineEvents = (r.statusHistory || []).map(sh => ({
      status: statusLabel(sh.status),
      note: sh.note,
      changedBy: sh.changedBy,
      createdAt: sh.createdAt
    }));

    app.innerHTML = `
      <div class="mb-md">
        <a href="#/community" class="btn btn-ghost btn-sm">&larr; Back to Community</a>
      </div>

      <article class="card mb-lg">
        <div class="card-header flex justify-between items-center flex-wrap gap-sm">
          <div>
            <h1>${esc(r.reportNumber)} — ${esc(catLabel(r.category))}</h1>
            <p class="text-sm text-muted">Reported by ${esc(r.reporterName)} · ${formatDate(r.createdAt)}</p>
          </div>
          <div class="flex gap-sm items-center">
            ${statusBadge(r.status)}
            ${priorityBadge(r.priority)}
            <button type="button" class="upvote-btn ${r.userUpvoted ? 'upvoted' : ''}" id="detail-upvote-btn">
              <span aria-hidden="true">▲</span>
              <span id="detail-upvote-count">${r.upvoteCount || 0}</span>
            </button>
          </div>
        </div>
        <div class="card-body">
          ${r.isPaused ? `
            <div class="emergency-banner mb-md">
              <strong>⏸️ Report Paused:</strong> ${esc(r.pausedReason || 'Awaiting additional information')}
            </div>
          ` : ''}

          <p class="mb-md">${esc(r.description)}</p>

          <div class="grid grid-2 mb-md">
            <div>
              <div class="detail-row"><span class="detail-label">Department</span><span class="detail-value">${esc(r.departmentName || 'General Services')}</span></div>
              <div class="detail-row"><span class="detail-label">Address</span><span class="detail-value">${esc(r.address || '—')}</span></div>
              <div class="detail-row"><span class="detail-label">Last Updated</span><span class="detail-value">${formatDate(r.updatedAt)}</span></div>
            </div>
            <div>
              ${r.imagePath ? `<img src="${esc(r.imagePath)}" alt="Report evidence" class="image-preview-lg">` : '<p class="text-muted text-sm">No image attached.</p>'}
            </div>
          </div>

          ${r.latitude != null && r.longitude != null ? '<div class="map-container-sm mb-md" id="detail-map"></div>' : ''}
        </div>
      </article>

      <div class="grid grid-2">
        <section class="card">
          <div class="card-header"><h2>Status History</h2></div>
          <div class="card-body">
            ${C.StatusTimeline ? C.StatusTimeline(timelineEvents) : ''}
          </div>
        </section>

        <section class="card">
          <div class="card-header"><h2>Official Municipal Updates</h2></div>
          <div class="card-body">
            ${(r.citizenUpdates || []).length === 0
              ? '<p class="text-muted text-sm">No municipal updates posted yet.</p>'
              : r.citizenUpdates.map(u => `
                <div class="detail-row">
                  <div>
                    <p>${esc(u.content)}</p>
                    <p class="text-xs text-muted">${esc(u.author || 'Staff')} · ${formatDate(u.createdAt)}</p>
                  </div>
                </div>
              `).join('')
            }
          </div>
        </section>
      </div>
    `;

    if (r.latitude != null && r.longitude != null) {
      renderMap('detail-map', r.latitude, r.longitude, [{
        lat: r.latitude,
        lng: r.longitude,
        popup: `${esc(r.reportNumber)}: ${esc(catLabel(r.category))}`
      }]);
    }

    document.getElementById('detail-upvote-btn')?.addEventListener('click', async () => {
      if (!state.user) {
        showToast('Please sign in using a demo account to upvote.', 'info');
        return;
      }
      try {
        const res = await fetchAPI(`/api/reports/${encodeURIComponent(reportId)}/upvote`, { method: 'POST' });
        const btn = document.getElementById('detail-upvote-btn');
        const cnt = document.getElementById('detail-upvote-count');
        if (cnt) cnt.textContent = String(res.upvoteCount);
        if (btn) btn.classList.toggle('upvoted', !!res.upvoted);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  // ─── 4. MyReportsPage ──────────────────────────────────────────────────────

  async function renderMyReportsPage(app) {
    if (!state.user) {
      app.innerHTML = renderSignInPrompt('view your submitted reports');
      return;
    }

    const data = await fetchAPI('/api/reports/my');
    const reports = data.reports || [];

    app.innerHTML = `
      <div class="flex justify-between items-center mb-lg flex-wrap gap-sm">
        <h1>My Reports</h1>
        <a href="#/report/new" class="btn btn-primary">+ New Report</a>
      </div>

      ${reports.length === 0 ? `
        <div class="card empty-state">
          <div class="empty-state-icon" aria-hidden="true">📋</div>
          <h2>No reports yet</h2>
          <p class="text-muted mb-md">Submit your first civic issue report to track it here.</p>
          <a href="#/report/new" class="btn btn-primary">Report an Issue</a>
        </div>
      ` : `
        <div class="card">
          <table class="data-table">
            <thead>
              <tr>
                <th>Report #</th>
                <th>Category</th>
                <th>Description</th>
                <th>Department</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              ${reports.map(r => `
                <tr>
                  <td><a href="#/report/${esc(r.id)}"><strong>${esc(r.reportNumber)}</strong></a></td>
                  <td>${esc(catLabel(r.category))}</td>
                  <td>${esc((r.description || '').slice(0, 70))}${(r.description || '').length > 70 ? '…' : ''}</td>
                  <td>${esc(r.departmentName || 'General Services')}</td>
                  <td>${priorityBadge(r.priority)}</td>
                  <td>${statusBadge(r.status)}</td>
                  <td>${timeAgo(r.createdAt)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `}
    `;
  }

  // ─── 5. CommunityFeedPage ──────────────────────────────────────────────────

  async function renderCommunityFeedPage(app) {
    const f = state.communityFilters;
    const params = new URLSearchParams();
    if (f.search) params.set('search', f.search);
    if (f.category) params.set('category', f.category);
    if (f.status) params.set('status', f.status);
    if (f.priority) params.set('priority', f.priority);
    params.set('sort', f.sort || 'newest');
    params.set('page', String(f.page || 1));

    const feedData = await fetchAPI(`/api/community/feed?${params.toString()}`);
    const reports = feedData.reports || [];
    const pag = feedData.pagination || { page: 1, totalPages: 1, total: 0 };

    const filterDefs = [
      { key: 'search', label: 'Search descriptions…', type: 'search' },
      {
        key: 'category', label: 'Category', type: 'select',
        options: Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label }))
      },
      {
        key: 'status', label: 'Status', type: 'select',
        options: Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))
      },
      {
        key: 'priority', label: 'Priority', type: 'select',
        options: Object.entries(PRIORITY_LABELS).map(([value, label]) => ({ value, label }))
      },
      {
        key: 'sort', label: 'Sort', type: 'select',
        options: [
          { value: 'newest', label: 'Newest' },
          { value: 'upvotes', label: 'Most Upvoted' },
          { value: 'updated', label: 'Recently Updated' },
          { value: 'oldest', label: 'Oldest' }
        ]
      }
    ];

    app.innerHTML = `
      <div class="flex justify-between items-center mb-md flex-wrap gap-sm">
        <div>
          <h1>Community Reports</h1>
          <p class="text-sm text-muted">${pag.total} total reports</p>
        </div>
        <div class="flex gap-sm">
          <button type="button" class="btn btn-secondary" id="toggle-community-map">
            ${f.showMap ? 'Hide Map' : '🗺️ Show Map'}
          </button>
          <a href="#/report/new" class="btn btn-primary">+ Report Issue</a>
        </div>
      </div>

      ${C.FilterBar ? C.FilterBar(filterDefs, f) : ''}

      ${f.showMap ? '<div class="map-container mb-lg" id="community-map"></div>' : ''}

      <div id="community-list" class="grid grid-2">
        ${reports.length === 0 ? `
          <div class="card empty-state" style="grid-column: 1 / -1;">
            <div class="empty-state-icon" aria-hidden="true">📭</div>
            <h2>No matching reports</h2>
            <p class="text-muted">Try clearing filters or submit a new report.</p>
          </div>
        ` : reports.map(r => C.ReportCard ? C.ReportCard({
          id: r.id,
          category: catLabel(r.category),
          description: r.description,
          status: statusLabel(r.status),
          priority: priorityLabel(r.priority),
          department: r.departmentName,
          createdAt: r.createdAt,
          upvoteCount: r.upvoteCount,
          isAnonymous: r.isAnonymous,
          reporterName: r.reporterName,
          hasUpvoted: r.userUpvoted
        }) : '').join('')}
      </div>

      ${C.Pagination ? C.Pagination(pag.page, pag.totalPages) : ''}
    `;

    if (f.showMap) {
      try {
        const mapData = await fetchAPI('/api/community/map-data');
        const markers = (mapData.reports || []).map(m => ({
          lat: m.latitude,
          lng: m.longitude,
          popup: `<strong>${esc(m.reportNumber)}</strong><br>${esc(catLabel(m.category))}<br>${esc(m.description)}<br><a href="#/report/${esc(m.id)}">View</a>`
        }));
        const first = markers[0];
        renderMap('community-map', first?.lat, first?.lng, markers, { zoom: 12 });
      } catch {
        // Ignore map error
      }
    }

    document.getElementById('toggle-community-map')?.addEventListener('click', () => {
      f.showMap = !f.showMap;
      renderCommunityFeedPage(app);
    });

    const onFilterChange = debounce((key, val) => {
      f[key] = val;
      f.page = 1;
      renderCommunityFeedPage(app);
    }, 250);

    app.querySelectorAll('.filter-input').forEach(el => {
      const eventName = el.type === 'search' ? 'input' : 'change';
      el.addEventListener(eventName, (e) => {
        onFilterChange(e.target.dataset.filterKey, e.target.value);
      });
    });

    app.querySelectorAll('.page-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = Number(btn.dataset.page);
        if (p >= 1) {
          f.page = p;
          renderCommunityFeedPage(app);
        }
      });
    });
  }

  // ─── 6. LeaderboardPage ────────────────────────────────────────────────────

  async function renderLeaderboardPage(app) {
    const data = await fetchAPI('/api/community/leaderboard');
    const leaders = data.leaderboard || [];

    app.innerHTML = `
      <section class="card">
        <div class="card-header">
          <h1>Community Leaderboard</h1>
          <p class="text-sm text-muted">${esc(data.criteria || '')}</p>
        </div>
        <div class="card-body">
          ${leaders.length === 0 ? `
            <div class="empty-state">
              <div class="empty-state-icon" aria-hidden="true">🏆</div>
              <p class="text-muted">No resolved public reports yet.</p>
            </div>
          ` : `
            <div class="leaderboard-list">
              ${leaders.map(l => `
                <div class="leaderboard-item ${l.isCurrentUser ? 'active' : ''}">
                  <div class="leaderboard-rank">#${l.rank}</div>
                  <div class="leaderboard-info">
                    <div class="leaderboard-name">
                      ${esc(l.displayName)}
                      ${l.isCurrentUser ? '<span class="badge badge-submitted">You</span>' : ''}
                    </div>
                  </div>
                  <div class="leaderboard-stats">
                    <span><strong>${l.resolvedReports}</strong> resolved</span>
                    <span>·</span>
                    <span><strong>${l.totalUpvotes}</strong> upvotes</span>
                  </div>
                </div>
              `).join('')}
            </div>
          `}
        </div>
      </section>
    `;
  }

  // ─── 7. StaffDashboardPage ─────────────────────────────────────────────────

  async function renderStaffDashboardPage(app) {
    const data = await fetchAPI('/api/staff/dashboard');
    const s = data.stats || {};
    const catKeys = Object.keys(data.byCategory || {});
    const catVals = catKeys.map(k => data.byCategory[k]);
    const stKeys = Object.keys(data.byStatus || {});
    const stVals = stKeys.map(k => data.byStatus[k]);

    app.innerHTML = `
      <div class="flex justify-between items-center mb-lg flex-wrap gap-sm">
        <h1>Municipal Staff Dashboard</h1>
        <div class="flex gap-sm">
          <a href="#/staff/reports" class="btn btn-primary">View Report Queue</a>
          <a href="#/staff/escalations" class="btn btn-secondary">Escalations</a>
        </div>
      </div>

      <div class="grid grid-4 mb-lg">
        ${C.StatCard ? C.StatCard('Total Reports', s.total || 0, 'primary', '📋') : ''}
        ${C.StatCard ? C.StatCard('Open Reports', s.open || 0, 'warning', '📂') : ''}
        ${C.StatCard ? C.StatCard('Critical Open', s.critical || 0, 'danger', '🔴') : ''}
        ${C.StatCard ? C.StatCard('Overdue SLA', s.overdue || 0, 'danger', '⏰') : ''}
      </div>

      <div class="grid grid-2 mb-lg">
        <section class="card">
          <div class="card-header"><h2>Reports by Category</h2></div>
          <div class="card-body">
            ${C.BarChart ? C.BarChart(catVals, catKeys.map(catLabel)) : ''}
          </div>
        </section>
        <section class="card">
          <div class="card-header"><h2>Reports by Status</h2></div>
          <div class="card-body">
            ${C.BarChart ? C.BarChart(stVals, stKeys.map(statusLabel)) : ''}
          </div>
        </section>
      </div>

      <section class="card">
        <div class="card-header"><h2>Recent Reports</h2></div>
        <div class="card-body">
          <table class="data-table">
            <thead>
              <tr><th>Report #</th><th>Category</th><th>Department</th><th>Priority</th><th>Status</th><th>Created</th></tr>
            </thead>
            <tbody>
              ${(data.recentReports || []).map(r => `
                <tr>
                  <td><a href="#/staff/report/${esc(r.id)}"><strong>${esc(r.reportNumber)}</strong></a></td>
                  <td>${esc(catLabel(r.category))}</td>
                  <td>${esc(r.departmentName || 'General Services')}</td>
                  <td>${priorityBadge(r.priority)}</td>
                  <td>${statusBadge(r.status)}</td>
                  <td>${timeAgo(r.createdAt)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  // ─── 8. StaffReportListPage ────────────────────────────────────────────────

  async function renderStaffReportListPage(app) {
    const f = state.staffFilters;
    const params = new URLSearchParams();
    if (f.search) params.set('search', f.search);
    if (f.status) params.set('status', f.status);
    if (f.priority) params.set('priority', f.priority);
    if (f.category) params.set('category', f.category);
    params.set('page', String(f.page || 1));

    const data = await fetchAPI(`/api/staff/reports?${params.toString()}`);
    const reports = data.reports || [];
    const pag = data.pagination || { page: 1, totalPages: 1, total: 0 };

    const filterDefs = [
      { key: 'search', label: 'Search # or description…', type: 'search' },
      {
        key: 'status', label: 'Status', type: 'select',
        options: Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))
      },
      {
        key: 'priority', label: 'Priority', type: 'select',
        options: Object.entries(PRIORITY_LABELS).map(([value, label]) => ({ value, label }))
      },
      {
        key: 'category', label: 'Category', type: 'select',
        options: Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label }))
      }
    ];

    app.innerHTML = `
      <div class="flex justify-between items-center mb-md flex-wrap gap-sm">
        <h1>Staff Report Queue (${pag.total})</h1>
        <a href="#/staff/dashboard" class="btn btn-secondary">Dashboard</a>
      </div>

      ${C.FilterBar ? C.FilterBar(filterDefs, f) : ''}

      <div class="card">
        <table class="data-table">
          <thead>
            <tr>
              <th>Report #</th>
              <th>Category</th>
              <th>Reporter</th>
              <th>Department</th>
              <th>Priority</th>
              <th>Status</th>
              <th>SLA</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${reports.length === 0 ? `
              <tr><td colspan="8" class="text-muted">No reports match your filters.</td></tr>
            ` : reports.map(r => `
              <tr style="${r.isOverdue ? 'background-color: #fdecea;' : ''}">
                <td><strong>${esc(r.reportNumber)}</strong></td>
                <td>${esc(catLabel(r.category))}</td>
                <td>${esc(r.reporterName || '—')}</td>
                <td>${esc(r.departmentName || 'General Services')}</td>
                <td>${priorityBadge(r.priority)}</td>
                <td>${statusBadge(r.status)}</td>
                <td>${r.isOverdue ? '<span class="badge badge-critical">OVERDUE</span>' : timeAgo(r.slaDeadline)}</td>
                <td><a href="#/staff/report/${esc(r.id)}" class="btn btn-primary btn-sm">Review</a></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      ${C.Pagination ? C.Pagination(pag.page, pag.totalPages) : ''}
    `;

    const onFilterChange = debounce((key, val) => {
      f[key] = val;
      f.page = 1;
      renderStaffReportListPage(app);
    }, 250);

    app.querySelectorAll('.filter-input').forEach(el => {
      const eventName = el.type === 'search' ? 'input' : 'change';
      el.addEventListener(eventName, (e) => {
        onFilterChange(e.target.dataset.filterKey, e.target.value);
      });
    });

    app.querySelectorAll('.page-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = Number(btn.dataset.page);
        if (p >= 1) {
          f.page = p;
          renderStaffReportListPage(app);
        }
      });
    });
  }

  // ─── 9. StaffReportDetailPage ──────────────────────────────────────────────

  async function renderStaffReportDetailPage(app, reportId) {
    const [detailData, demoUsersData] = await Promise.all([
      fetchAPI(`/api/staff/reports/${encodeURIComponent(reportId)}`),
      fetchAPI('/api/auth/demo-users')
    ]);

    const r = detailData.report;
    const staffUsers = (demoUsersData.users || []).filter(u => u.role === 'staff' || u.role === 'admin');

    let departments = [];
    if (state.user?.role === 'admin') {
      try {
        const deptData = await fetchAPI('/api/admin/departments');
        departments = deptData.departments || [];
      } catch {
        departments = [];
      }
    }

    const allowedNext = STATUS_TRANSITIONS[r.status] || [];

    app.innerHTML = `
      <div class="mb-md flex justify-between items-center flex-wrap gap-sm">
        <a href="#/staff/reports" class="btn btn-ghost btn-sm">&larr; Back to Queue</a>
        <div class="flex gap-sm">
          ${r.isPaused
            ? `<button type="button" class="btn btn-success btn-sm" id="resume-report-btn">Resume Report</button>`
            : `<button type="button" class="btn btn-secondary btn-sm" id="pause-report-btn">Pause Report</button>`
          }
        </div>
      </div>

      <article class="card mb-lg">
        <div class="card-header flex justify-between items-center flex-wrap gap-sm">
          <div>
            <h1>${esc(r.reportNumber)} — ${esc(catLabel(r.category))}</h1>
            <p class="text-sm text-muted">
              Reporter: ${esc(r.reporterName)} (${esc(r.reporterEmail)})
              ${r.isAnonymous ? '· <em>Submitted as anonymous to community</em>' : ''}
            </p>
          </div>
          <div class="flex gap-sm items-center">
            ${statusBadge(r.status)}
            ${priorityBadge(r.priority)}
            ${r.isOverdue ? '<span class="badge badge-critical">OVERDUE</span>' : ''}
          </div>
        </div>
        <div class="card-body">
          <p class="mb-md">${esc(r.description)}</p>
          <div class="grid grid-2 mb-md">
            <div>
              <div class="detail-row"><span class="detail-label">Department</span><span class="detail-value">${esc(r.departmentName || 'General Services')}</span></div>
              <div class="detail-row"><span class="detail-label">Assigned To</span><span class="detail-value">${esc(r.assignedToName || 'Unassigned')}</span></div>
              <div class="detail-row"><span class="detail-label">Address</span><span class="detail-value">${esc(r.address || '—')}</span></div>
              <div class="detail-row"><span class="detail-label">Classification Source</span><span class="detail-value">${esc(r.classificationSource || 'rules_engine')}</span></div>
              <div class="detail-row"><span class="detail-label">SLA Deadline</span><span class="detail-value">${formatDate(r.slaDeadline)}</span></div>
            </div>
            <div>
              ${r.imagePath ? `<img src="${esc(r.imagePath)}" alt="Evidence" class="image-preview-lg">` : '<p class="text-muted text-sm">No image uploaded.</p>'}
            </div>
          </div>
          ${r.latitude != null && r.longitude != null ? '<div class="map-container-sm" id="staff-detail-map"></div>' : ''}
        </div>
      </article>

      <div class="grid grid-3 mb-lg">
        <!-- Update Status -->
        <section class="card">
          <div class="card-header"><h2>Update Status</h2></div>
          <div class="card-body">
            <form id="staff-status-form">
              <div class="form-group">
                <label class="form-label" for="staff-status-select">New Status</label>
                <select id="staff-status-select" class="form-select" required>
                  ${allowedNext.map(st => `<option value="${esc(st)}">${esc(statusLabel(st))}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label" for="staff-status-note">Status Note</label>
                <textarea id="staff-status-note" class="form-textarea" rows="2" placeholder="Reason or progress note..."></textarea>
              </div>
              <button type="submit" class="btn btn-primary btn-block" ${allowedNext.length === 0 ? 'disabled' : ''}>Update Status</button>
            </form>
          </div>
        </section>

        <!-- Update Priority -->
        <section class="card">
          <div class="card-header"><h2>Set Priority</h2></div>
          <div class="card-body">
            <form id="staff-priority-form">
              <div class="form-group">
                <label class="form-label" for="staff-priority-select">Priority</label>
                <select id="staff-priority-select" class="form-select">
                  ${Object.entries(PRIORITY_LABELS).map(([val, lbl]) => `
                    <option value="${esc(val)}" ${r.priority === val ? 'selected' : ''}>${esc(lbl)}</option>
                  `).join('')}
                </select>
              </div>
              <button type="submit" class="btn btn-secondary btn-block">Save Priority</button>
            </form>
          </div>
        </section>

        <!-- Assign Report -->
        <section class="card">
          <div class="card-header"><h2>Assign</h2></div>
          <div class="card-body">
            <form id="staff-assign-form">
              ${departments.length > 0 ? `
                <div class="form-group">
                  <label class="form-label" for="staff-dept-select">Department</label>
                  <select id="staff-dept-select" class="form-select">
                    <option value="">Keep current (${esc(r.departmentName || 'None')})</option>
                    ${departments.map(d => `<option value="${esc(d.id)}" ${r.departmentId === d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}
                  </select>
                </div>
              ` : ''}
              <div class="form-group">
                <label class="form-label" for="staff-assignee-select">Assign to Staff</label>
                <select id="staff-assignee-select" class="form-select">
                  <option value="">Unassigned</option>
                  ${staffUsers.map(u => `<option value="${esc(u.id)}" ${r.assignedTo === u.id ? 'selected' : ''}>${esc(u.displayName)} (${esc(u.role)})</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label" for="staff-assign-note">Assignment Note</label>
                <input type="text" id="staff-assign-note" class="form-input" placeholder="Optional note">
              </div>
              <button type="submit" class="btn btn-primary btn-block">Assign</button>
            </form>
          </div>
        </section>
      </div>

      <!-- Duplicate Suggestions -->
      <section class="card duplicate-panel mb-lg">
        <div class="card-header"><h2>Duplicate Suggestions</h2></div>
        <div class="card-body">
          ${(r.duplicates || []).length === 0 ? '<p class="text-muted text-sm">No duplicate suggestions for this report.</p>' : `
            ${r.duplicates.map(d => `
              <div class="duplicate-item">
                <div>
                  <strong>${esc(d.reportNumber)}</strong> · ${esc(catLabel(d.category))} · ${statusBadge(d.dupStatus || 'submitted')}
                  <p class="text-sm">${esc(d.description)}</p>
                  <span class="text-xs text-muted">
                    ${Math.round(d.distance || 0)}m away · Similarity ${Math.round((d.similarityScore || 0) * 100)}% · Status: <strong>${esc(d.status)}</strong>
                  </span>
                </div>
                <div class="flex gap-sm">
                  <button type="button" class="btn btn-success btn-sm dup-decision-btn" data-suggestion-id="${esc(d.id)}" data-decision="confirmed">Confirm</button>
                  <button type="button" class="btn btn-danger btn-sm dup-decision-btn" data-suggestion-id="${esc(d.id)}" data-decision="rejected">Reject</button>
                </div>
              </div>
            `).join('')}
          `}
        </div>
      </section>

      <!-- Notes & Citizen Updates -->
      <div class="grid grid-2 mb-lg">
        <section class="card">
          <div class="card-header">
            <h2>Internal Notes</h2>
            <div class="internal-banner mt-sm">🔒 Internal — Not visible to citizens</div>
          </div>
          <div class="card-body">
            <form id="internal-note-form" class="mb-md">
              <div class="form-group">
                <label class="form-label" for="internal-note-input">Add Internal Note</label>
                <textarea id="internal-note-input" class="form-textarea" rows="2" required></textarea>
              </div>
              <button type="submit" class="btn btn-secondary btn-sm">Save Internal Note</button>
            </form>
            ${(r.internalNotes || []).map(n => `
              <div class="detail-row">
                <div>
                  <p>${esc(n.content)}</p>
                  <span class="text-xs text-muted">${esc(n.author)} · ${formatDate(n.createdAt)}</span>
                </div>
              </div>
            `).join('') || '<p class="text-muted text-sm">No internal notes yet.</p>'}
          </div>
        </section>

        <section class="card">
          <div class="card-header"><h2>Citizen-Visible Updates</h2></div>
          <div class="card-body">
            <form id="citizen-update-form" class="mb-md">
              <div class="form-group">
                <label class="form-label" for="citizen-update-input">Publish Public Update</label>
                <textarea id="citizen-update-input" class="form-textarea" rows="2" required></textarea>
              </div>
              <button type="submit" class="btn btn-primary btn-sm">Publish Update</button>
            </form>
            ${(r.citizenUpdates || []).map(u => `
              <div class="detail-row">
                <div>
                  <p>${esc(u.content)}</p>
                  <span class="text-xs text-muted">${esc(u.author)} · ${formatDate(u.createdAt)}</span>
                </div>
              </div>
            `).join('') || '<p class="text-muted text-sm">No citizen updates yet.</p>'}
          </div>
        </section>
      </div>

      <!-- Audit Log -->
      <section class="card">
        <div class="card-header"><h2>Audit History</h2></div>
        <div class="card-body">
          ${C.AuditLog ? C.AuditLog((r.auditLog || []).map(a => ({
            action: a.action,
            userName: a.userName,
            details: a.newValue ? JSON.stringify(a.newValue) : '',
            createdAt: a.createdAt
          }))) : ''}
        </div>
      </section>
    `;

    if (r.latitude != null && r.longitude != null) {
      renderMap('staff-detail-map', r.latitude, r.longitude, [{
        lat: r.latitude, lng: r.longitude, popup: esc(r.reportNumber)
      }]);
    }

    document.getElementById('staff-status-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await fetchAPI(`/api/staff/reports/${encodeURIComponent(reportId)}/status`, {
          method: 'PUT',
          body: {
            status: document.getElementById('staff-status-select').value,
            note: document.getElementById('staff-status-note').value
          }
        });
        showToast('Status updated', 'success');
        renderStaffReportDetailPage(app, reportId);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    document.getElementById('staff-priority-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await fetchAPI(`/api/staff/reports/${encodeURIComponent(reportId)}/priority`, {
          method: 'PUT',
          body: { priority: document.getElementById('staff-priority-select').value }
        });
        showToast('Priority updated', 'success');
        renderStaffReportDetailPage(app, reportId);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    document.getElementById('staff-assign-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const deptEl = document.getElementById('staff-dept-select');
        const body = {
          assignedTo: document.getElementById('staff-assignee-select').value || null,
          note: document.getElementById('staff-assign-note').value
        };
        if (deptEl && deptEl.value) body.departmentId = deptEl.value;
        await fetchAPI(`/api/staff/reports/${encodeURIComponent(reportId)}/assign`, {
          method: 'PUT',
          body
        });
        showToast('Report assigned', 'success');
        renderStaffReportDetailPage(app, reportId);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    app.querySelectorAll('.dup-decision-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await fetchAPI(`/api/staff/reports/${encodeURIComponent(reportId)}/duplicate`, {
            method: 'PUT',
            body: {
              suggestionId: btn.dataset.suggestionId,
              decision: btn.dataset.decision
            }
          });
          showToast(`Duplicate ${btn.dataset.decision}`, 'success');
          renderStaffReportDetailPage(app, reportId);
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

    document.getElementById('internal-note-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await fetchAPI(`/api/staff/reports/${encodeURIComponent(reportId)}/notes`, {
          method: 'POST',
          body: { content: document.getElementById('internal-note-input').value }
        });
        showToast('Internal note saved', 'success');
        renderStaffReportDetailPage(app, reportId);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    document.getElementById('citizen-update-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await fetchAPI(`/api/staff/reports/${encodeURIComponent(reportId)}/updates`, {
          method: 'POST',
          body: { content: document.getElementById('citizen-update-input').value }
        });
        showToast('Public update published', 'success');
        renderStaffReportDetailPage(app, reportId);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    document.getElementById('pause-report-btn')?.addEventListener('click', () => {
      showModal('Pause Report', `
        <div class="form-group">
          <label class="form-label" for="pause-reason-input">Reason for pausing</label>
          <input type="text" id="pause-reason-input" class="form-input" value="Awaiting additional information">
        </div>
        <p class="text-xs text-muted">Note: In this demo, the SLA clock continues during pause.</p>
      `, [
        { label: 'Cancel', className: 'btn-ghost' },
        {
          label: 'Pause Report',
          className: 'btn-primary',
          onClick: async (close) => {
            try {
              const reason = document.getElementById('pause-reason-input').value;
              await fetchAPI(`/api/staff/reports/${encodeURIComponent(reportId)}/pause`, {
                method: 'PUT',
                body: { reason }
              });
              close();
              showToast('Report paused', 'info');
              renderStaffReportDetailPage(app, reportId);
            } catch (err) {
              showToast(err.message, 'error');
            }
          }
        }
      ]);
    });

    document.getElementById('resume-report-btn')?.addEventListener('click', async () => {
      try {
        await fetchAPI(`/api/staff/reports/${encodeURIComponent(reportId)}/resume`, { method: 'PUT' });
        showToast('Report resumed', 'success');
        renderStaffReportDetailPage(app, reportId);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  // ─── 10. EscalationsPage ───────────────────────────────────────────────────

  async function renderEscalationsPage(app) {
    const data = await fetchAPI('/api/staff/escalations');
    const overdue = data.overdueReports || [];
    const records = data.escalationRecords || [];

    app.innerHTML = `
      <div class="flex justify-between items-center mb-lg flex-wrap gap-sm">
        <h1>SLA &amp; Escalations</h1>
        <button type="button" class="btn btn-primary" id="run-escalation-btn">Run Escalation Check</button>
      </div>

      <section class="card mb-lg">
        <div class="card-header"><h2>Overdue Reports (${overdue.length})</h2></div>
        <div class="card-body">
          <table class="data-table">
            <thead>
              <tr><th>Report #</th><th>Category</th><th>Department</th><th>Priority</th><th>Status</th><th>SLA Deadline</th><th>Level</th></tr>
            </thead>
            <tbody>
              ${overdue.length === 0 ? '<tr><td colspan="7" class="text-muted">No overdue reports.</td></tr>' : overdue.map(r => `
                <tr>
                  <td><a href="#/staff/report/${esc(r.id)}"><strong>${esc(r.reportNumber)}</strong></a></td>
                  <td>${esc(catLabel(r.category))}</td>
                  <td>${esc(r.departmentName || 'General Services')}</td>
                  <td>${priorityBadge(r.priority)}</td>
                  <td>${statusBadge(r.status)}</td>
                  <td>${formatDate(r.slaDeadline)}</td>
                  <td>Level ${r.escalationLevel || 0}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </section>

      <section class="card">
        <div class="card-header"><h2>Escalation History</h2></div>
        <div class="card-body">
          <table class="data-table">
            <thead>
              <tr><th>Report #</th><th>Level</th><th>Reason</th><th>Escalated At</th></tr>
            </thead>
            <tbody>
              ${records.length === 0 ? '<tr><td colspan="4" class="text-muted">No escalation records yet.</td></tr>' : records.map(e => `
                <tr>
                  <td><strong>${esc(e.reportNumber || '—')}</strong></td>
                  <td>Level ${e.level}</td>
                  <td>${esc(e.reason)}</td>
                  <td>${formatDate(e.escalatedAt)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </section>
    `;

    document.getElementById('run-escalation-btn')?.addEventListener('click', async () => {
      try {
        const res = await fetchAPI('/api/staff/escalations/check', { method: 'POST' });
        const r = res.result || {};
        showToast(`Checked ${r.checked || 0} reports, escalated ${r.escalated || 0}`, 'success');
        renderEscalationsPage(app);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  // ─── 11. Admin Pages ───────────────────────────────────────────────────────

  async function renderAdminDepartmentsPage(app) {
    const data = await fetchAPI('/api/admin/departments');
    const depts = data.departments || [];
    const rules = data.routingRules || [];

    app.innerHTML = `
      <h1 class="mb-lg">Manage Departments &amp; Routing</h1>

      <div class="grid grid-2 mb-lg">
        <section class="card">
          <div class="card-header"><h2>Add Department</h2></div>
          <div class="card-body">
            <form id="add-dept-form">
              <div class="form-group">
                <label class="form-label" for="dept-name">Department Name</label>
                <input type="text" id="dept-name" class="form-input" required>
              </div>
              <div class="form-group">
                <label class="form-label" for="dept-desc">Description</label>
                <textarea id="dept-desc" class="form-textarea" rows="2"></textarea>
              </div>
              <button type="submit" class="btn btn-primary">Create Department</button>
            </form>
          </div>
        </section>

        <section class="card">
          <div class="card-header"><h2>Category Routing Rules</h2></div>
          <div class="card-body">
            <table class="data-table">
              <thead><tr><th>Category</th><th>Department</th><th>Priority</th></tr></thead>
              <tbody>
                ${rules.map(r => `
                  <tr>
                    <td>${esc(catLabel(r.category))}</td>
                    <td>${esc(r.departmentName)}</td>
                    <td>${r.priority}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section class="card">
        <div class="card-header"><h2>Departments</h2></div>
        <div class="card-body">
          <table class="data-table">
            <thead><tr><th>Name</th><th>Description</th><th>Reports</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              ${depts.map(d => `
                <tr>
                  <td><strong>${esc(d.name)}</strong></td>
                  <td>${esc(d.description || '')}</td>
                  <td>${d.reportCount}</td>
                  <td>${d.isActive ? '<span class="badge badge-resolved">Active</span>' : '<span class="badge badge-closed">Inactive</span>'}</td>
                  <td class="flex gap-sm">
                    <button type="button" class="btn btn-secondary btn-sm toggle-dept-btn" data-id="${esc(d.id)}" data-active="${d.isActive ? '1' : '0'}">
                      ${d.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                    <button type="button" class="btn btn-danger btn-sm delete-dept-btn" data-id="${esc(d.id)}">Delete</button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </section>
    `;

    document.getElementById('add-dept-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await fetchAPI('/api/admin/departments', {
          method: 'POST',
          body: {
            name: document.getElementById('dept-name').value,
            description: document.getElementById('dept-desc').value
          }
        });
        showToast('Department created', 'success');
        renderAdminDepartmentsPage(app);
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    app.querySelectorAll('.toggle-dept-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const isActive = btn.dataset.active === '1';
        try {
          await fetchAPI(`/api/admin/departments/${encodeURIComponent(btn.dataset.id)}`, {
            method: 'PUT',
            body: { isActive: !isActive }
          });
          showToast('Department updated', 'success');
          renderAdminDepartmentsPage(app);
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

    app.querySelectorAll('.delete-dept-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await fetchAPI(`/api/admin/departments/${encodeURIComponent(btn.dataset.id)}`, { method: 'DELETE' });
          showToast('Department deleted', 'success');
          renderAdminDepartmentsPage(app);
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });
  }

  async function renderAdminSLAPage(app) {
    const data = await fetchAPI('/api/admin/sla');
    const settings = data.settings || [];
    const overdue = data.overdueByPriority || {};

    app.innerHTML = `
      <h1 class="mb-lg">SLA Targets &amp; Escalation Thresholds</h1>
      <section class="card">
        <div class="card-body">
          <table class="data-table">
            <thead>
              <tr><th>Priority</th><th>Target Hours</th><th>Escalation Hours</th><th>Currently Overdue</th><th>Action</th></tr>
            </thead>
            <tbody>
              ${settings.map(s => `
                <tr>
                  <td>${priorityBadge(s.priority)}</td>
                  <td><input type="number" min="1" class="form-input sla-target-input" data-id="${esc(s.id)}" value="${s.targetHours}" style="max-width: 100px;"></td>
                  <td><input type="number" min="1" class="form-input sla-esc-input" data-id="${esc(s.id)}" value="${s.escalationHours}" style="max-width: 100px;"></td>
                  <td>${overdue[s.priority] || 0}</td>
                  <td><button type="button" class="btn btn-primary btn-sm save-sla-btn" data-id="${esc(s.id)}">Save</button></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </section>
    `;

    app.querySelectorAll('.save-sla-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const targetHours = parseInt(app.querySelector(`.sla-target-input[data-id="${id}"]`).value, 10);
        const escalationHours = parseInt(app.querySelector(`.sla-esc-input[data-id="${id}"]`).value, 10);
        try {
          await fetchAPI(`/api/admin/sla/${encodeURIComponent(id)}`, {
            method: 'PUT',
            body: { targetHours, escalationHours }
          });
          showToast('SLA settings updated', 'success');
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });
  }

  async function renderAdminUsersPage(app) {
    const [usersData, deptsData] = await Promise.all([
      fetchAPI('/api/admin/users'),
      fetchAPI('/api/admin/departments')
    ]);
    const users = usersData.users || [];
    const depts = deptsData.departments || [];

    app.innerHTML = `
      <h1 class="mb-lg">User &amp; Role Management</h1>
      <section class="card">
        <div class="card-body">
          <table class="data-table">
            <thead>
              <tr><th>Name</th><th>Email</th><th>Verification</th><th>Reports</th><th>Role</th><th>Department</th><th>Save</th></tr>
            </thead>
            <tbody>
              ${users.map(u => `
                <tr>
                  <td><strong>${esc(u.displayName)}</strong></td>
                  <td>${esc(u.email)}</td>
                  <td><span class="badge badge-under-review">${esc(u.verifiedStatus)}</span></td>
                  <td>${u.reportCount}</td>
                  <td>
                    <select class="form-select user-role-select" data-id="${esc(u.id)}">
                      ${['citizen', 'staff', 'admin'].map(r => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${r}</option>`).join('')}
                    </select>
                  </td>
                  <td>
                    <select class="form-select user-dept-select" data-id="${esc(u.id)}">
                      <option value="">None</option>
                      ${depts.map(d => `<option value="${esc(d.id)}" ${u.departmentId === d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}
                    </select>
                  </td>
                  <td><button type="button" class="btn btn-primary btn-sm save-user-role-btn" data-id="${esc(u.id)}">Update</button></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </section>
    `;

    app.querySelectorAll('.save-user-role-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const role = app.querySelector(`.user-role-select[data-id="${id}"]`).value;
        const departmentId = app.querySelector(`.user-dept-select[data-id="${id}"]`).value || null;
        try {
          await fetchAPI(`/api/admin/users/${encodeURIComponent(id)}/role`, {
            method: 'PUT',
            body: { role, departmentId }
          });
          showToast('User role updated', 'success');
          await initAuth();
          renderAdminUsersPage(app);
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });
  }

  async function renderAdminSettingsPage(app) {
    const data = await fetchAPI('/api/admin/settings');
    const settings = data.settings || {};

    app.innerHTML = `
      <h1 class="mb-lg">Application Settings</h1>
      <section class="card">
        <div class="card-body">
          <form id="admin-settings-form">
            <div class="form-group">
              <label class="form-label" for="setting-emergency">Emergency Guidance Banner Text</label>
              <textarea id="setting-emergency" class="form-textarea" rows="3">${esc(settings.emergency_guidance || '')}</textarea>
            </div>
            <div class="form-group">
              <label class="form-label" for="setting-radius">Duplicate Detection Radius (meters)</label>
              <input type="number" id="setting-radius" class="form-input" min="50" max="10000" value="${esc(settings.duplicate_radius_meters || '500')}">
            </div>
            <button type="submit" class="btn btn-primary">Save Settings</button>
          </form>
        </div>
      </section>
    `;

    document.getElementById('admin-settings-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await fetchAPI('/api/admin/settings', {
          method: 'PUT',
          body: {
            emergency_guidance: document.getElementById('setting-emergency').value,
            duplicate_radius_meters: document.getElementById('setting-radius').value
          }
        });
        showToast('Settings saved', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  // ─── Global Event Delegation & Bootstrap ───────────────────────────────────

  document.addEventListener('click', async (e) => {
    // Demo auth buttons
    const demoBtn = e.target.closest('[data-demo-user-id]');
    if (demoBtn) {
      await handleDemoLogin(demoBtn.dataset.demoUserId);
      return;
    }

    if (e.target.closest('#demo-logout-btn')) {
      await handleLogout();
      return;
    }

    // Modal close
    if (e.target.closest('.modal-close') || e.target.id === 'modal-overlay') {
      closeModal();
      return;
    }

    // Notification bell toggle
    const bellBtn = e.target.closest('.bell-btn');
    const dropdown = document.getElementById('notification-dropdown');
    if (bellBtn && dropdown) {
      const opening = dropdown.hidden;
      dropdown.hidden = !opening;
      bellBtn.setAttribute('aria-expanded', opening ? 'true' : 'false');
      return;
    }

    // Mark all notifications read
    if (e.target.closest('#mark-all-read-btn')) {
      try {
        await fetchAPI('/api/notifications/read-all', { method: 'PUT' });
        await refreshNotifications();
      } catch (err) {
        showToast(err.message, 'error');
      }
      return;
    }

    // Single notification click
    const notifItem = e.target.closest('[data-notification-id]');
    if (notifItem) {
      const id = notifItem.dataset.notificationId;
      const found = state.notifications.find(n => n.id === id);
      try {
        await fetchAPI(`/api/notifications/${encodeURIComponent(id)}/read`, { method: 'PUT' });
        await refreshNotifications();
      } catch {
        // Ignore
      }
      if (dropdown) dropdown.hidden = true;
      if (found?.reportId) navigate(`#/report/${found.reportId}`);
      return;
    }

    // Close notification dropdown on outside click
    if (dropdown && !dropdown.hidden && !e.target.closest('#notification-bell')) {
      dropdown.hidden = true;
    }

    // Community card upvote button
    const upvoteBtn = e.target.closest('[data-upvote-id]');
    if (upvoteBtn) {
      e.stopPropagation();
      if (!state.user) {
        showToast('Please sign in using a demo account to upvote.', 'info');
        return;
      }
      const reportId = upvoteBtn.dataset.upvoteId;
      try {
        const res = await fetchAPI(`/api/reports/${encodeURIComponent(reportId)}/upvote`, { method: 'POST' });
        upvoteBtn.classList.toggle('upvoted', !!res.upvoted);
        upvoteBtn.setAttribute('aria-pressed', res.upvoted ? 'true' : 'false');
        const cntEl = upvoteBtn.querySelector('.upvote-count');
        if (cntEl) cntEl.textContent = String(res.upvoteCount);
      } catch (err) {
        showToast(err.message, 'error');
      }
      return;
    }

    // Community report card click -> detail page
    const card = e.target.closest('.report-card[data-report-id]');
    if (card) {
      navigate(`#/report/${card.dataset.reportId}`);
    }
  });

  window.addEventListener('hashchange', route);

  document.addEventListener('DOMContentLoaded', async () => {
    await initAuth();
    if (!window.location.hash) {
      window.location.hash = '#/home';
    } else {
      await route();
    }
  });
})();
