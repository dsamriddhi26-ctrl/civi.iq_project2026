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
      showMap: false,
      mapMode: 'pins'
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
      severity: 'medium',
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

  /**
   * Render a zero-dependency Leaflet canvas thermal heatmap.
   * Points: [{ lat, lng, weight }] where weight is ~0.4..1.5
   */
  function renderHeatmap(containerId, points = [], options = {}) {
    const el = document.getElementById(containerId);
    if (!el) return null;

    if (typeof L === 'undefined') {
      el.innerHTML = '<div class="empty-state"><p>Map library unavailable offline.</p></div>';
      return null;
    }

    const validPoints = points.filter(p => p.lat != null && p.lng != null);
    const centerLat = options.lat ?? validPoints[0]?.lat ?? DEFAULT_COORDS.lat;
    const centerLng = options.lng ?? validPoints[0]?.lng ?? DEFAULT_COORDS.lng;
    const zoom = options.zoom || 11;

    const map = L.map(containerId).setView([Number(centerLat), Number(centerLng)], zoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19
    }).addTo(map);

    const HeatCanvasLayer = L.Layer.extend({
      onAdd(m) {
        this._map = m;
        const pane = m.getPane('overlayPane');
        this._canvas = L.DomUtil.create('canvas', 'leaflet-heatmap-layer');
        this._canvas.style.position = 'absolute';
        this._canvas.style.pointerEvents = 'none';
        pane.appendChild(this._canvas);
        m.on('moveend zoomend resize', this._redraw, this);
        this._redraw();
      },
      onRemove(m) {
        m.off('moveend zoomend resize', this._redraw, this);
        if (this._canvas && this._canvas.parentNode) {
          this._canvas.parentNode.removeChild(this._canvas);
        }
      },
      _redraw() {
        const m = this._map;
        const size = m.getSize();
        const topLeft = m.containerPointToLayerPoint([0, 0]);
        L.DomUtil.setPosition(this._canvas, topLeft);
        this._canvas.width = size.x;
        this._canvas.height = size.y;

        const ctx = this._canvas.getContext('2d');
        ctx.clearRect(0, 0, size.x, size.y);
        if (validPoints.length === 0) return;

        // Draw grayscale alpha intensity on offscreen canvas, then colorize
        const off = document.createElement('canvas');
        off.width = size.x;
        off.height = size.y;
        const octx = off.getContext('2d');

        const radius = Math.max(24, Math.min(48, Math.round(size.x / 22)));
        for (const pt of validPoints) {
          const p = m.latLngToContainerPoint([Number(pt.lat), Number(pt.lng)]);
          if (p.x < -radius || p.y < -radius || p.x > size.x + radius || p.y > size.y + radius) continue;
          const weight = Math.min(1, Math.max(0.25, Number(pt.weight || 0.6)));
          const grad = octx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
          grad.addColorStop(0, `rgba(0,0,0,${(weight * 0.85).toFixed(2)})`);
          grad.addColorStop(0.5, `rgba(0,0,0,${(weight * 0.4).toFixed(2)})`);
          grad.addColorStop(1, 'rgba(0,0,0,0)');
          octx.fillStyle = grad;
          octx.beginPath();
          octx.arc(p.x, p.y, radius, 0, Math.PI * 2);
          octx.fill();
        }

        const imgData = octx.getImageData(0, 0, size.x, size.y);
        const data = imgData.data;
        for (let i = 0; i < data.length; i += 4) {
          const alpha = data[i + 3];
          if (alpha === 0) continue;
          const t = alpha / 255;
          let r = 0, g = 0, b = 0;
          if (t < 0.25) {
            const k = t / 0.25;
            r = 46; g = Math.round(134 + k * 80); b = 220;
          } else if (t < 0.5) {
            const k = (t - 0.25) / 0.25;
            r = Math.round(46 + k * 190); g = 210; b = Math.round(220 - k * 170);
          } else if (t < 0.75) {
            const k = (t - 0.5) / 0.25;
            r = 245; g = Math.round(210 - k * 100); b = 30;
          } else {
            const k = (t - 0.75) / 0.25;
            r = 220; g = Math.round(110 - k * 85); b = 25;
          }
          data[i] = r;
          data[i + 1] = g;
          data[i + 2] = b;
          data[i + 3] = Math.min(200, Math.round(alpha * 0.82));
        }
        ctx.putImageData(imgData, 0, 0);
      }
    });

    new HeatCanvasLayer().addTo(map);

    // Add interactive hover/click circle markers with low opacity for popups
    validPoints.forEach(pt => {
      if (pt.popup) {
        L.circleMarker([Number(pt.lat), Number(pt.lng)], {
          radius: 8,
          color: 'transparent',
          fillColor: '#000',
          fillOpacity: 0.01
        }).addTo(map).bindPopup(pt.popup);
      }
    });

    state.activeMaps.push(map);
    setTimeout(() => map.invalidateSize(), 100);
    return map;
  }

  /**
   * Read EXIF GPS coordinates from a JPEG File in the browser (zero dependencies).
   */
  async function extractBrowserExifGps(file) {
    if (!file || file.type !== 'image/jpeg') return null;
    try {
      const buf = await file.slice(0, 131072).arrayBuffer();
      const view = new DataView(buf);
      if (view.byteLength < 12 || view.getUint16(0, false) !== 0xFFD8) return null;

      let offset = 2;
      while (offset + 4 < view.byteLength) {
        if (view.getUint8(offset) !== 0xFF) break;
        const marker = view.getUint8(offset + 1);
        if (marker === 0xDA || marker === 0xD9) break;
        const segLen = view.getUint16(offset + 2, false);
        if (marker === 0xE1 && segLen >= 8) {
          const exifHeader = String.fromCharCode(
            view.getUint8(offset + 4), view.getUint8(offset + 5),
            view.getUint8(offset + 6), view.getUint8(offset + 7)
          );
          if (exifHeader === 'Exif') {
            const tiffStart = offset + 10;
            if (tiffStart + 8 > view.byteLength) return null;
            const order = view.getUint16(tiffStart, false);
            const le = order === 0x4949;
            if (!le && order !== 0x4D4D) return null;

            const u16 = (p) => view.getUint16(p, le);
            const u32 = (p) => view.getUint32(p, le);
            const rat = (p) => {
              const d = u32(p + 4);
              return d ? u32(p) / d : 0;
            };

            const ifd0 = tiffStart + u32(tiffStart + 4);
            const count = u16(ifd0);
            let gpsOff = null;
            for (let i = 0; i < count; i++) {
              const ep = ifd0 + 2 + i * 12;
              if (ep + 12 > view.byteLength) break;
              if (u16(ep) === 0x8825) { gpsOff = u32(ep + 8); break; }
            }
            if (gpsOff == null) return null;

            const gpsStart = tiffStart + gpsOff;
            const gCount = u16(gpsStart);
            let latRef = 'N', lngRef = 'E', latV = null, lngV = null;
            for (let i = 0; i < gCount; i++) {
              const ep = gpsStart + 2 + i * 12;
              if (ep + 12 > view.byteLength) break;
              const tag = u16(ep);
              const valOff = tiffStart + u32(ep + 8);
              if (tag === 1) latRef = String.fromCharCode(view.getUint8(ep + 8) || 78);
              else if (tag === 3) lngRef = String.fromCharCode(view.getUint8(ep + 8) || 69);
              else if (tag === 2 && u32(ep + 4) === 3) latV = [rat(valOff), rat(valOff + 8), rat(valOff + 16)];
              else if (tag === 4 && u32(ep + 4) === 3) lngV = [rat(valOff), rat(valOff + 8), rat(valOff + 16)];
            }
            if (latV && lngV) {
              let lat = latV[0] + latV[1] / 60 + latV[2] / 3600;
              let lng = lngV[0] + lngV[1] / 60 + lngV[2] / 3600;
              if (latRef === 'S') lat = -lat;
              if (lngRef === 'W') lng = -lng;
              if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) {
                return { latitude: Math.round(lat * 1e6) / 1e6, longitude: Math.round(lng * 1e6) / 1e6 };
              }
            }
            return null;
          }
        }
        if (segLen < 2) break;
        offset += 2 + segLen;
      }
    } catch {
      return null;
    }
    return null;
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
      { href: '#/leaderboard', label: 'Leaderboard' },
      { href: '#/reviews', label: 'Reviews' }
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
      if (path === '/auth') {
        if (state.user) {
          navigate('#/home');
          return;
        }
        renderAuthPage(app);
      } else if (path === '/' || path === '/home') {
        if (!state.user) {
          renderAuthPage(app);
        } else {
          await renderHomePage(app);
        }
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
      } else if (path === '/reviews') {
        await renderReviewsPage(app);
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
          Please sign up or log in (as Citizen, Staff, or Admin) to ${esc(actionLabel)}.
        </p>
        <div class="flex gap-sm justify-center flex-wrap">
          <a href="#/auth" class="btn btn-primary">Sign Up / Log In</a>
          <a href="#/community" class="btn btn-secondary">Browse Community Reports</a>
        </div>
      </div>
    `;
  }

  // ─── 0. AuthPage (First Screen: Role Selection + Login / Signup) ───────────

  function renderAuthPage(app) {
    let selectedRole = 'citizen';
    let authMode = 'login'; // 'login' | 'signup'

    const roleMeta = {
      citizen: { icon: '👤', title: 'Citizen', desc: 'Report issues, track progress, upvote & review' },
      staff:   { icon: '🛠️', title: 'Municipal Staff', desc: 'Review queue, assign crews, update status' },
      admin:   { icon: '🔑', title: 'Administrator', desc: 'Manage departments, SLA rules & settings' }
    };

    const draw = () => {
      const demoForRole = (state.demoUsers || []).filter(u => u.role === selectedRole);

      app.innerHTML = `
        <section class="card auth-card">
          <div class="card-header">
            <h1>Welcome to Civ.IQ</h1>
            <p class="text-sm text-muted">Select your role, then sign up or log in using your email or phone number.</p>
          </div>
          <div class="card-body">
            <div class="emergency-banner mb-md">
              <strong>⚠️ Local Demo Authentication:</strong> Accounts created here are stored in the local SQLite database for development/demo use (no real SMS OTP or email verification is sent).
            </div>

            <div class="form-group">
              <label class="form-label">1. Choose Your Role</label>
              <div class="role-selector" role="radiogroup" aria-label="Account role">
                ${Object.entries(roleMeta).map(([key, info]) => `
                  <button type="button" class="role-option ${selectedRole === key ? 'active' : ''}" data-role="${key}" aria-pressed="${selectedRole === key}">
                    <span class="role-icon" aria-hidden="true">${info.icon}</span>
                    <strong>${esc(info.title)}</strong>
                    <span class="text-xs text-muted">${esc(info.desc)}</span>
                  </button>
                `).join('')}
              </div>
            </div>

            <div class="auth-tabs mb-md" role="tablist">
              <button type="button" class="auth-tab ${authMode === 'login' ? 'active' : ''}" data-mode="login" role="tab">Log In</button>
              <button type="button" class="auth-tab ${authMode === 'signup' ? 'active' : ''}" data-mode="signup" role="tab">Sign Up</button>
            </div>

            <form id="auth-form" novalidate>
              ${authMode === 'signup' ? `
                <div class="form-group">
                  <label class="form-label" for="auth-name">Full Name</label>
                  <input type="text" id="auth-name" class="form-input" placeholder="e.g., Samriddhi" minlength="2" required>
                </div>
              ` : ''}

              <div class="form-group">
                <label class="form-label" for="auth-contact">Email Address or Phone Number</label>
                <input type="text" id="auth-contact" class="form-input" placeholder="e.g., name@example.com or 9876543210" required>
                <p class="form-help">Enter a valid email or a 7–15 digit phone number.</p>
              </div>

              <p class="form-error mb-sm" id="auth-error" hidden></p>

              <button type="submit" class="btn btn-primary btn-lg" style="width: 100%;" id="auth-submit-btn">
                ${authMode === 'signup' ? `Sign Up as ${roleMeta[selectedRole].title}` : `Log In as ${roleMeta[selectedRole].title}`}
              </button>
            </form>

            ${demoForRole.length > 0 ? `
              <div class="mt-lg">
                <p class="text-xs text-muted mb-sm">Quick Demo Account (${esc(roleMeta[selectedRole].title)}):</p>
                <div class="flex gap-sm flex-wrap">
                  ${demoForRole.map(u => `
                    <button type="button" class="btn btn-ghost btn-sm auth-demo-quick" data-email="${esc(u.email)}">
                      ${esc(u.displayName)} (${esc(u.email)})
                    </button>
                  `).join('')}
                </div>
              </div>
            ` : ''}

            <div class="mt-lg text-center">
              <a href="#/community" class="text-sm">Browse Public Community Feed &amp; Heatmap as Guest &rarr;</a>
            </div>
          </div>
        </section>
      `;

      app.querySelectorAll('.role-option').forEach(btn => {
        btn.addEventListener('click', () => {
          selectedRole = btn.dataset.role;
          draw();
        });
      });

      app.querySelectorAll('.auth-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          authMode = tab.dataset.mode;
          draw();
        });
      });

      app.querySelectorAll('.auth-demo-quick').forEach(btn => {
        btn.addEventListener('click', () => {
          authMode = 'login';
          draw();
          const contactEl = document.getElementById('auth-contact');
          if (contactEl) contactEl.value = btn.dataset.email || '';
        });
      });

      document.getElementById('auth-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const errEl = document.getElementById('auth-error');
        const submitBtn = document.getElementById('auth-submit-btn');
        const contact = document.getElementById('auth-contact')?.value.trim() || '';
        const displayName = document.getElementById('auth-name')?.value.trim() || '';

        if (errEl) errEl.hidden = true;
        submitBtn.disabled = true;

        try {
          const endpoint = authMode === 'signup' ? '/api/auth/signup' : '/api/auth/login';
          const payload = authMode === 'signup'
            ? { role: selectedRole, displayName, contact }
            : { role: selectedRole, contact };

          const data = await fetchAPI(endpoint, { method: 'POST', body: payload });
          state.user = data.user;
          renderDemoAuthBar();
          renderNavigation();
          await refreshNotifications();
          showToast(
            `${authMode === 'signup' ? 'Welcome' : 'Signed in'}, ${data.user.displayName} (${data.user.role})`,
            'success'
          );
          navigate(data.user.role === 'staff' || data.user.role === 'admin' ? '#/staff/dashboard' : '#/home');
        } catch (err) {
          if (errEl) {
            errEl.textContent = err.message;
            errEl.hidden = false;
          }
          submitBtn.disabled = false;
        }
      });
    };

    draw();
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
              <div class="grid grid-2">
                <div class="form-group">
                  <label class="form-label" for="report-category">Category</label>
                  <select id="report-category" class="form-select" required>
                    ${Object.entries(CATEGORY_LABELS).map(([val, lbl]) => `
                      <option value="${esc(val)}" ${d.category === val ? 'selected' : ''}>${esc(lbl)}</option>
                    `).join('')}
                  </select>
                </div>

                <div class="form-group">
                  <label class="form-label" for="report-severity">Severity</label>
                  <select id="report-severity" class="form-select" required>
                    <option value="low" ${d.severity === 'low' ? 'selected' : ''}>Low — Minor or cosmetic issue</option>
                    <option value="medium" ${d.severity === 'medium' ? 'selected' : ''}>Medium — Needs standard attention</option>
                    <option value="high" ${d.severity === 'high' ? 'selected' : ''}>High — Urgent / safety hazard</option>
                  </select>
                </div>
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
        const sev = document.getElementById('report-severity').value;
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
        d.severity = sev;
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
              <p><strong>Severity:</strong> ${esc(d.severity === 'high' ? 'High (Critical)' : d.severity === 'low' ? 'Low' : 'Medium')}</p>
              <p><strong>Description:</strong> ${esc(d.description)}</p>
              <p><strong>Visibility:</strong> ${d.isAnonymous ? 'Anonymous to Community' : 'Publicly attributed'}</p>
              ${d.previewSrc ? `<img src="${esc(d.previewSrc)}" alt="Preview" class="image-preview mt-sm">` : ''}
            </div>
          </div>

          <div class="card mb-md">
            <div class="card-header flex justify-between items-center">
              <strong>Location ${d.latitude != null ? '<span class="badge badge-info">📍 Geo-tagged</span>' : ''}</strong>
              <button type="button" class="btn btn-ghost btn-sm" id="edit-step2-btn">Edit</button>
            </div>
            <div class="card-body">
              <p><strong>Coordinates:</strong> ${d.latitude != null ? `${Number(d.latitude).toFixed(5)}, ${Number(d.longitude).toFixed(5)}` : 'Not provided'}</p>
              <p><strong>Address / Landmark:</strong> ${esc(d.address || 'Not provided')}</p>
              ${d.geoSource === 'photo_exif' ? '<p class="text-xs text-muted mt-sm">Extracted automatically from uploaded photo EXIF GPS metadata.</p>' : ''}
              ${d.latitude != null && d.longitude != null ? '<div class="map-container-sm mt-sm" id="review-step-map"></div>' : ''}
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

    if (d.latitude != null && d.longitude != null) {
      renderMap('review-step-map', d.latitude, d.longitude, [{
        lat: d.latitude,
        lng: d.longitude,
        popup: esc(d.address || 'Pinned issue location')
      }], { zoom: 15 });
    }

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
            ${cls.note && (Array.isArray(cls.note) ? cls.note.length > 0 : true)
              ? `<p class="text-xs text-muted mt-sm">${esc(Array.isArray(cls.note) ? cls.note.join(' ') : cls.note)}</p>`
              : ''}
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
        fd.append('severity', d.severity || 'medium');
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
      extractBrowserExifGps(file).then((gps) => {
        if (gps) {
          draft.latitude = gps.latitude;
          draft.longitude = gps.longitude;
          draft.geoSource = 'photo_exif';
          showToast(`Photo geo-tag detected (${gps.latitude.toFixed(4)}, ${gps.longitude.toFixed(4)}) — location pre-filled!`, 'success');
        }
      });
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
              <div class="detail-row"><span class="detail-label">Geo-tag</span><span class="detail-value">${r.latitude != null && r.longitude != null ? `📍 ${Number(r.latitude).toFixed(5)}, ${Number(r.longitude).toFixed(5)}` : 'Not geo-tagged'}</span></div>
              <div class="detail-row"><span class="detail-label">Last Updated</span><span class="detail-value">${formatDate(r.updatedAt)}</span></div>
              ${['resolved', 'closed'].includes(r.status) ? `
                <div class="mt-md">
                  <a href="#/reviews?reportId=${esc(r.id)}" class="btn btn-primary btn-sm">⭐ Rate Resolution &amp; App</a>
                </div>
              ` : ''}
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
        <div class="flex gap-sm flex-wrap">
          <button type="button" class="btn ${f.showMap && f.mapMode === 'pins' ? 'btn-primary' : 'btn-secondary'}" id="toggle-community-pins">
            ${f.showMap && f.mapMode === 'pins' ? 'Hide Pin Map' : '🗺️ Pin Map'}
          </button>
          <button type="button" class="btn ${f.showMap && f.mapMode === 'heatmap' ? 'btn-primary' : 'btn-secondary'}" id="toggle-community-heatmap">
            ${f.showMap && f.mapMode === 'heatmap' ? 'Hide Heatmap' : '🔥 Issue Heatmap'}
          </button>
          <a href="#/report/new" class="btn btn-primary">+ Report Issue</a>
        </div>
      </div>

      ${C.FilterBar ? C.FilterBar(filterDefs, f) : ''}

      ${f.showMap ? `
        <div class="card mb-lg">
          <div class="card-header flex justify-between items-center flex-wrap gap-sm">
            <strong>${f.mapMode === 'heatmap' ? '🔥 Civic Issue Density Heatmap' : '🗺️ Geo-tagged Issue Map'}</strong>
            ${f.mapMode === 'heatmap' ? `
              <div class="heatmap-legend">
                <span>Low</span>
                <span class="heatmap-gradient"></span>
                <span>High / Critical</span>
              </div>
            ` : ''}
          </div>
          <div class="card-body">
            <div class="map-container" id="community-map"></div>
          </div>
        </div>
      ` : ''}

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
        const mapParams = new URLSearchParams();
        if (f.category) mapParams.set('category', f.category);
        if (f.status) mapParams.set('status', f.status);
        const mapData = await fetchAPI(`/api/community/map-data?${mapParams.toString()}`);
        const mapReports = mapData.reports || [];
        if (f.mapMode === 'heatmap') {
          const points = mapReports.map(m => ({
            lat: m.latitude,
            lng: m.longitude,
            weight: (m.priority === 'critical' ? 1.0 : m.priority === 'medium' ? 0.7 : 0.45) + Math.min(0.3, (m.upvoteCount || 0) * 0.05),
            popup: `<strong>${esc(m.reportNumber)}</strong> · ${esc(priorityLabel(m.priority))}<br>${esc(catLabel(m.category))}<br>${esc(m.description)}<br><a href="#/report/${esc(m.id)}">View</a>`
          }));
          renderHeatmap('community-map', points, { zoom: 12 });
        } else {
          const markers = mapReports.map(m => ({
            lat: m.latitude,
            lng: m.longitude,
            popup: `<strong>${esc(m.reportNumber)}</strong><br>${esc(catLabel(m.category))}<br>${esc(m.description)}<br><a href="#/report/${esc(m.id)}">View</a>`
          }));
          const first = markers[0];
          renderMap('community-map', first?.lat, first?.lng, markers, { zoom: 12 });
        }
      } catch {
        // Ignore map error
      }
    }

    document.getElementById('toggle-community-pins')?.addEventListener('click', () => {
      if (f.showMap && f.mapMode === 'pins') {
        f.showMap = false;
      } else {
        f.showMap = true;
        f.mapMode = 'pins';
      }
      renderCommunityFeedPage(app);
    });

    document.getElementById('toggle-community-heatmap')?.addEventListener('click', () => {
      if (f.showMap && f.mapMode === 'heatmap') {
        f.showMap = false;
      } else {
        f.showMap = true;
        f.mapMode = 'heatmap';
      }
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

  // ─── 6b. ReviewsPage ───────────────────────────────────────────────────────

  async function renderReviewsPage(app) {
    const hashParts = (window.location.hash || '').split('?');
    const queryParams = new URLSearchParams(hashParts[1] || '');
    const preselectedReportId = queryParams.get('reportId') || '';

    const [reviewsData, myReportsData] = await Promise.all([
      fetchAPI('/api/community/reviews'),
      state.user ? fetchAPI('/api/reports/my').catch(() => ({ reports: [] })) : Promise.resolve({ reports: [] })
    ]);

    const summary = reviewsData.summary || {};
    const reviews = reviewsData.reviews || [];
    const myReports = myReportsData.reports || [];
    const breakdown = summary.breakdown || { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    const total = summary.totalReviews || 0;

    let selectedRating = 5;

    app.innerHTML = `
      <div class="flex justify-between items-center mb-md flex-wrap gap-sm">
        <div>
          <h1>App Ratings &amp; Issue Resolution Reviews</h1>
          <p class="text-sm text-muted">See whether citizens' civic issues are being resolved and how people rate Civ.IQ.</p>
        </div>
      </div>

      <div class="grid grid-3 mb-lg">
        ${C.StatCard ? C.StatCard('Average App Rating', `${summary.averageRating || 0} / 5 ★`, 'primary', '⭐') : ''}
        ${C.StatCard ? C.StatCard('Issues Solved Rate', `${summary.solvedPercent || 0}%`, 'success', '✅') : ''}
        ${C.StatCard ? C.StatCard('Total Citizen Reviews', total, 'info', '💬') : ''}
      </div>

      <div class="grid grid-2 mb-lg">
        <section class="card">
          <div class="card-header"><h2>Satisfaction &amp; Resolution Breakdown</h2></div>
          <div class="card-body">
            <div class="mb-md">
              ${[5, 4, 3, 2, 1].map(star => {
                const count = breakdown[star] || 0;
                const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                return `
                  <div class="rating-bar-row">
                    <span>${star} ★</span>
                    <div class="rating-bar-track"><div class="rating-bar-fill" style="width:${pct}%"></div></div>
                    <span class="text-xs text-muted">${count} (${pct}%)</span>
                  </div>
                `;
              }).join('')}
            </div>
            <div class="detail-row"><span class="detail-label">Issues Completely Solved</span><span class="detail-value"><strong>${summary.resolvedYes || 0}</strong></span></div>
            <div class="detail-row"><span class="detail-label">Partially Solved</span><span class="detail-value"><strong>${summary.resolvedPartially || 0}</strong></span></div>
            <div class="detail-row"><span class="detail-label">Not Solved Yet</span><span class="detail-value"><strong>${summary.resolvedNo || 0}</strong></span></div>
          </div>
        </section>

        <section class="card">
          <div class="card-header"><h2>Share Your Rating &amp; Experience</h2></div>
          <div class="card-body">
            ${!state.user ? `
              <p class="text-muted mb-md">Sign in with any demo account in the top bar to submit a rating and review.</p>
            ` : `
              <form id="app-review-form">
                <div class="form-group">
                  <label class="form-label">Your App Rating</label>
                  <div class="star-picker" id="star-picker" role="radiogroup" aria-label="App rating in stars">
                    ${[1, 2, 3, 4, 5].map(n => `
                      <button type="button" class="star-btn ${n <= selectedRating ? 'active' : ''}" data-star="${n}" aria-label="${n} stars">★</button>
                    `).join('')}
                  </div>
                </div>
                <div class="form-group">
                  <label class="form-label" for="review-resolved">Was your civic issue solved?</label>
                  <select id="review-resolved" class="form-select" required>
                    <option value="yes">Yes — Issue was completely solved</option>
                    <option value="partially">Partially — Progress made, still ongoing</option>
                    <option value="no">Not yet — Still waiting for resolution</option>
                  </select>
                </div>
                ${myReports.length > 0 ? `
                  <div class="form-group">
                    <label class="form-label" for="review-report-id">Related Report (optional)</label>
                    <select id="review-report-id" class="form-select">
                      <option value="">General App Feedback</option>
                      ${myReports.map(r => `
                        <option value="${esc(r.id)}" ${r.id === preselectedReportId ? 'selected' : ''}>
                          ${esc(r.reportNumber)} — ${esc(catLabel(r.category))} (${esc(statusLabel(r.status))})
                        </option>
                      `).join('')}
                    </select>
                  </div>
                ` : ''}
                <div class="form-group">
                  <label class="form-label" for="review-title">Headline (optional)</label>
                  <input type="text" id="review-title" class="form-input" placeholder="e.g., Quick pothole repair!" maxlength="100">
                </div>
                <div class="form-group">
                  <label class="form-label" for="review-comment">Your Review</label>
                  <textarea id="review-comment" class="form-textarea" rows="3" minlength="10" required placeholder="Tell us if your issue was solved and how Civ.IQ worked for you…"></textarea>
                </div>
                <button type="submit" class="btn btn-primary" id="submit-review-btn">Submit Review</button>
              </form>
            `}
          </div>
        </section>
      </div>

      <section class="card">
        <div class="card-header"><h2>Recent Citizen Reviews (${reviews.length})</h2></div>
        <div class="card-body">
          ${reviews.length === 0 ? '<p class="text-muted">No reviews yet. Be the first to share feedback!</p>' : `
            <div class="grid grid-2">
              ${reviews.map(rv => {
                const solvedBadge = rv.issueResolved === 'yes'
                  ? '<span class="badge badge-success">✅ Issue Solved</span>'
                  : rv.issueResolved === 'partially'
                    ? '<span class="badge badge-warning">🟡 Partially Solved</span>'
                    : '<span class="badge badge-danger">⏳ Not Solved Yet</span>';
                return `
                  <article class="card review-card">
                    <div class="card-body">
                      <div class="flex justify-between items-center mb-sm flex-wrap gap-sm">
                        <span class="review-stars" aria-label="${rv.rating} out of 5 stars">${'★'.repeat(rv.rating)}${'☆'.repeat(5 - rv.rating)}</span>
                        ${solvedBadge}
                      </div>
                      ${rv.title ? `<h3 class="mb-sm">${esc(rv.title)}</h3>` : ''}
                      <p class="mb-sm">${esc(rv.comment)}</p>
                      <div class="text-xs text-muted flex justify-between flex-wrap gap-sm">
                        <span>By ${esc(rv.authorName)}</span>
                        <span>${rv.reportNumber ? `Report ${esc(rv.reportNumber)} · ` : ''}${timeAgo(rv.createdAt)}</span>
                      </div>
                    </div>
                  </article>
                `;
              }).join('')}
            </div>
          `}
        </div>
      </section>
    `;

    const starBtns = app.querySelectorAll('#star-picker .star-btn');
    starBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        selectedRating = Number(btn.dataset.star) || 5;
        starBtns.forEach(b => b.classList.toggle('active', Number(b.dataset.star) <= selectedRating));
      });
    });

    document.getElementById('app-review-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const submitBtn = document.getElementById('submit-review-btn');
      submitBtn.disabled = true;
      try {
        await fetchAPI('/api/community/reviews', {
          method: 'POST',
          body: {
            rating: selectedRating,
            issueResolved: document.getElementById('review-resolved').value,
            reportId: document.getElementById('review-report-id')?.value || preselectedReportId || null,
            title: document.getElementById('review-title').value.trim(),
            comment: document.getElementById('review-comment').value.trim()
          }
        });
        showToast('Thank you! Your review has been published.', 'success');
        renderReviewsPage(app);
      } catch (err) {
        showToast(err.message, 'error');
        submitBtn.disabled = false;
      }
    });
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

      <section class="card mb-lg">
        <div class="card-header flex justify-between items-center flex-wrap gap-sm">
          <h2>🔥 Civic Issue Density Heatmap</h2>
          <div class="heatmap-legend">
            <span>Low</span>
            <span class="heatmap-gradient"></span>
            <span>High / Critical</span>
          </div>
        </div>
        <div class="card-body">
          <div class="map-container" id="staff-dashboard-heatmap"></div>
        </div>
      </section>

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

    try {
      const mapData = await fetchAPI('/api/community/map-data');
      const points = (mapData.reports || []).map(m => ({
        lat: m.latitude,
        lng: m.longitude,
        weight: (m.priority === 'critical' ? 1.0 : m.priority === 'medium' ? 0.7 : 0.45) + Math.min(0.3, (m.upvoteCount || 0) * 0.05),
        popup: `<strong>${esc(m.reportNumber)}</strong> · ${esc(priorityLabel(m.priority))}<br>${esc(catLabel(m.category))}<br>${esc(m.description)}<br><a href="#/staff/report/${esc(m.id)}">Open in Staff View</a>`
      }));
      renderHeatmap('staff-dashboard-heatmap', points, { zoom: 12 });
    } catch {
      // Ignore heatmap load error
    }
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
