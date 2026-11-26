/**
 * Civ.IQ — Reusable Component Functions
 * ========================================
 * All components return HTML strings and optionally provide
 * a mount() function for attaching event listeners post-render.
 *
 * Uses ONLY Leaflet from CDN; zero other external dependencies.
 */

/* global L */

// ───────────────────────────────────────────────────────────
// Utility: escapeHtml — shared with app.js via window
// ───────────────────────────────────────────────────────────
window.CivIQ = window.CivIQ || {};

/** Escape user-generated content to prevent XSS */
window.CivIQ.escapeHtml = function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

const esc = window.CivIQ.escapeHtml;

// ───────────────────────────────────────────────────────────
// Utility: Category icons mapping
// ───────────────────────────────────────────────────────────
window.CivIQ.categoryIcons = {
  'Pothole/Road Damage': '🕳️',
  'Garbage/Waste': '🗑️',
  'Stray Animal': '🐕',
  'Streetlight': '💡',
  'Water/Drainage': '💧',
  'Other': '📋'
};

// ───────────────────────────────────────────────────────────
// 1. StatusTimeline(events)
//    Renders a vertical timeline of status changes.
//    events: [{ status, note, createdAt, changedBy }]
// ───────────────────────────────────────────────────────────
window.CivIQ.StatusTimeline = function StatusTimeline(events) {
  if (!events || events.length === 0) {
    return '<p class="text-muted text-sm">No status changes yet.</p>';
  }

  const dotClass = (status) => {
    if (!status) return '';
    const s = status.toLowerCase();
    if (s === 'resolved' || s === 'closed') return 'dot-success';
    if (s === 'reopened' || s === 'escalated') return 'dot-danger';
    if (s === 'in progress' || s === 'assigned') return 'dot-warning';
    return '';
  };

  const items = events.map(e => `
    <div class="timeline-item">
      <span class="timeline-dot ${dotClass(e.status || e.newStatus)}"></span>
      <div class="timeline-time">${window.CivIQ.formatDate ? window.CivIQ.formatDate(e.createdAt || e.changedAt) : esc(e.createdAt || e.changedAt || '')}</div>
      <div class="timeline-title">${window.CivIQ.renderStatusBadge ? window.CivIQ.renderStatusBadge(e.status || e.newStatus) : esc(e.status || e.newStatus || '')}</div>
      ${e.note ? `<div class="timeline-body">${esc(e.note)}</div>` : ''}
      ${e.changedBy ? `<div class="timeline-body text-xs text-muted">by ${esc(e.changedBy)}</div>` : ''}
    </div>
  `).join('');

  return `<div class="timeline" role="list" aria-label="Status timeline">${items}</div>`;
};

// ───────────────────────────────────────────────────────────
// 2. ReportCard(report)
//    Card component for the community feed.
//    report: { id, category, description, status, priority,
//              department, createdAt, upvoteCount, isAnonymous,
//              reporterName, hasUpvoted }
// ───────────────────────────────────────────────────────────
window.CivIQ.ReportCard = function ReportCard(report) {
  const icons = window.CivIQ.categoryIcons;
  const icon = icons[report.category] || '📋';
  const name = report.isAnonymous ? 'Community Member' : esc(report.reporterName || 'Unknown');
  const timeStr = window.CivIQ.timeAgo ? window.CivIQ.timeAgo(report.createdAt) : esc(report.createdAt || '');
  const statusBadge = window.CivIQ.renderStatusBadge ? window.CivIQ.renderStatusBadge(report.status) : '';
  const priorityBadge = window.CivIQ.renderPriorityBadge ? window.CivIQ.renderPriorityBadge(report.priority) : '';

  return `
    <article class="report-card" data-report-id="${esc(report.id)}" role="article" tabindex="0"
             aria-label="Report ${esc(report.id)}: ${esc(report.category)}">
      <div class="report-card-header">
        <div class="report-card-category">
          <span class="cat-icon" aria-hidden="true">${icon}</span>
          <span>${esc(report.category)}</span>
        </div>
        <div class="report-card-badges">
          ${statusBadge}
          ${priorityBadge}
        </div>
      </div>
      <div class="report-card-body">${esc(report.description)}</div>
      <div class="report-card-footer">
        <div class="report-card-meta">
          <span>${name}</span>
          <span aria-hidden="true">·</span>
          <span>${timeStr}</span>
          ${report.department ? `<span aria-hidden="true">·</span><span>${esc(report.department)}</span>` : ''}
          <span aria-hidden="true">·</span>
          <span title="Citizens supporting this report">🤝 ${report.supportCount || 0}</span>
          ${report.verificationState === 'awaiting' ? '<span class="badge badge-warning">⏳ Verify</span>' : ''}
          ${report.verificationState === 'verified_resolved' ? '<span class="badge badge-resolved">✅ Verified</span>' : ''}
        </div>
        <button class="upvote-btn ${report.hasUpvoted ? 'upvoted' : ''}"
                data-upvote-id="${esc(report.id)}"
                aria-label="Upvote this report, current count ${report.upvoteCount || 0}"
                aria-pressed="${report.hasUpvoted ? 'true' : 'false'}">
          <span aria-hidden="true">▲</span>
          <span class="upvote-count">${report.upvoteCount || 0}</span>
        </button>
      </div>
    </article>
  `;
};

// ───────────────────────────────────────────────────────────
// 3. StatCard(label, value, color, icon)
//    Dashboard stat card with large number.
// ───────────────────────────────────────────────────────────
window.CivIQ.StatCard = function StatCard(label, value, color, icon) {
  const colorClass = color ? `stat-card-${color}` : '';
  return `
    <div class="stat-card ${colorClass}" role="status" aria-label="${esc(label)}: ${value}">
      ${icon ? `<div class="stat-icon" aria-hidden="true">${icon}</div>` : ''}
      <div class="stat-value">${value}</div>
      <div class="stat-label">${esc(label)}</div>
    </div>
  `;
};

// ───────────────────────────────────────────────────────────
// 4. FilterBar(filters, currentValues)
//    Returns filter controls HTML.
//    filters: [{ key, label, type:'select'|'search'|'date', options:[{value,label}] }]
//    currentValues: { key: value }
// ───────────────────────────────────────────────────────────
window.CivIQ.FilterBar = function FilterBar(filters, currentValues) {
  currentValues = currentValues || {};

  const fields = filters.map(f => {
    if (f.type === 'search') {
      return `
        <div class="search-input-wrapper">
          <label for="filter-${esc(f.key)}" class="sr-only">${esc(f.label)}</label>
          <input type="search" id="filter-${esc(f.key)}" name="${esc(f.key)}"
                 placeholder="${esc(f.label)}" value="${esc(currentValues[f.key] || '')}"
                 data-filter-key="${esc(f.key)}" class="filter-input">
        </div>
      `;
    }
    if (f.type === 'date') {
      return `
        <div class="filter-group">
          <label for="filter-${esc(f.key)}">${esc(f.label)}</label>
          <input type="date" id="filter-${esc(f.key)}" name="${esc(f.key)}"
                 value="${esc(currentValues[f.key] || '')}"
                 data-filter-key="${esc(f.key)}" class="filter-input">
        </div>
      `;
    }
    // Default: select
    const opts = (f.options || []).map(o => {
      const sel = currentValues[f.key] === o.value ? 'selected' : '';
      return `<option value="${esc(o.value)}" ${sel}>${esc(o.label)}</option>`;
    }).join('');

    return `
      <div class="filter-group">
        <label for="filter-${esc(f.key)}">${esc(f.label)}</label>
        <select id="filter-${esc(f.key)}" name="${esc(f.key)}"
                data-filter-key="${esc(f.key)}" class="filter-input">
          <option value="">All</option>
          ${opts}
        </select>
      </div>
    `;
  }).join('');

  return `<div class="filter-bar" role="search" aria-label="Filter reports">${fields}</div>`;
};

// ───────────────────────────────────────────────────────────
// 5. Pagination(currentPage, totalPages)
//    Returns pagination controls HTML.
// ───────────────────────────────────────────────────────────
window.CivIQ.Pagination = function Pagination(currentPage, totalPages) {
  if (totalPages <= 1) return '';

  let buttons = '';

  // Previous
  buttons += `<button class="page-btn" data-page="${currentPage - 1}" ${currentPage <= 1 ? 'disabled' : ''}
               aria-label="Previous page">&laquo; Prev</button>`;

  // Page numbers (show max 7)
  let startPage = Math.max(1, currentPage - 3);
  let endPage = Math.min(totalPages, startPage + 6);
  if (endPage - startPage < 6) {
    startPage = Math.max(1, endPage - 6);
  }

  if (startPage > 1) {
    buttons += `<button class="page-btn" data-page="1" aria-label="Page 1">1</button>`;
    if (startPage > 2) buttons += `<span class="text-muted">…</span>`;
  }

  for (let i = startPage; i <= endPage; i++) {
    const active = i === currentPage ? 'active' : '';
    buttons += `<button class="page-btn ${active}" data-page="${i}" 
                 aria-label="Page ${i}" ${i === currentPage ? 'aria-current="page"' : ''}>${i}</button>`;
  }

  if (endPage < totalPages) {
    if (endPage < totalPages - 1) buttons += `<span class="text-muted">…</span>`;
    buttons += `<button class="page-btn" data-page="${totalPages}" aria-label="Page ${totalPages}">${totalPages}</button>`;
  }

  // Next
  buttons += `<button class="page-btn" data-page="${currentPage + 1}" ${currentPage >= totalPages ? 'disabled' : ''}
               aria-label="Next page">Next &raquo;</button>`;

  return `<nav class="pagination" aria-label="Pagination">${buttons}</nav>`;
};

// ───────────────────────────────────────────────────────────
// 6. ImageUpload()
//    Returns the image upload widget HTML.
//    State managed in app.js; this just renders the UI.
// ───────────────────────────────────────────────────────────
window.CivIQ.ImageUpload = function ImageUpload(previewSrc) {
  if (previewSrc) {
    return `
      <div class="image-preview-container" id="image-preview-container">
        <img src="${esc(previewSrc)}" alt="Uploaded image preview" class="image-preview">
        <button type="button" class="image-remove-btn" id="image-remove-btn" aria-label="Remove uploaded image">&times;</button>
      </div>
    `;
  }

  return `
    <div class="image-upload-zone" id="image-upload-zone" tabindex="0" role="button"
         aria-label="Click or drag to upload an image">
      <div style="font-size: 2rem;" aria-hidden="true">📷</div>
      <p>Click to upload or drag and drop</p>
      <p class="text-xs text-muted">JPEG, PNG, or WebP • Max 5MB</p>
      <input type="file" id="image-file-input" accept="image/jpeg,image/png,image/webp"
             class="sr-only" aria-label="Choose image file">
    </div>
  `;
};

// ───────────────────────────────────────────────────────────
// 7. LocationPicker(lat, lng, address)
//    Returns location picker HTML with GPS button, map, manual entry.
// ───────────────────────────────────────────────────────────
window.CivIQ.LocationPicker = function LocationPicker(lat, lng, address) {
  const hasCoords = lat != null && lng != null;

  return `
    <div class="location-picker">
      <div class="flex gap-sm flex-wrap mb-md">
        <button type="button" class="btn btn-secondary" id="gps-btn">
          📍 Use My Location
        </button>
        <span id="gps-status" class="text-sm text-muted" aria-live="polite"></span>
      </div>

      <div class="map-container mb-md" id="location-map" aria-label="Map for selecting report location"></div>

      ${hasCoords ? `
        <p class="text-sm mb-sm" id="coords-display">
          <strong>Coordinates:</strong> ${Number(lat).toFixed(6)}, ${Number(lng).toFixed(6)}
        </p>
      ` : '<p class="text-sm mb-sm text-muted" id="coords-display">No location selected yet.</p>'}

      <div class="form-group">
        <label class="form-label" for="manual-address">Address / Landmark <span class="text-xs text-muted">(optional fallback)</span></label>
        <textarea id="manual-address" class="form-textarea" rows="2"
                  placeholder="e.g. Near City Park, Main Road, Ward 12"
                  aria-describedby="address-help">${esc(address || '')}</textarea>
        <p class="form-help" id="address-help">Provide a recognizable landmark or street name to help locate the issue.</p>
      </div>
    </div>
  `;
};

// ───────────────────────────────────────────────────────────
// 8. NotificationDropdown(notifications)
//    Bell dropdown with notification list.
// ───────────────────────────────────────────────────────────
window.CivIQ.NotificationDropdown = function NotificationDropdown(notifications) {
  if (!notifications || notifications.length === 0) {
    return `
      <div class="notification-dropdown-header">Notifications</div>
      <div class="notification-empty">
        <span aria-hidden="true">🔔</span>
        <p>No notifications yet</p>
      </div>
    `;
  }

  const items = notifications.map(n => `
    <div class="notification-item ${n.isRead ? '' : 'unread'}" data-notification-id="${esc(n.id)}"
         role="menuitem" tabindex="0">
      <div class="notif-message">${esc(n.message)}</div>
      <div class="notif-time">${window.CivIQ.timeAgo ? window.CivIQ.timeAgo(n.createdAt) : esc(n.createdAt || '')}</div>
    </div>
  `).join('');

  return `
    <div class="notification-dropdown-header">
      Notifications
      <button class="btn btn-ghost btn-sm" id="mark-all-read-btn">Mark all read</button>
    </div>
    ${items}
  `;
};

// ───────────────────────────────────────────────────────────
// 9. AuditLog(events)
//    Full audit history display.
//    events: [{ action, userId, userName, details, createdAt }]
// ───────────────────────────────────────────────────────────
window.CivIQ.AuditLog = function AuditLog(events) {
  if (!events || events.length === 0) {
    return '<p class="text-muted text-sm">No audit history.</p>';
  }

  const rows = events.map(e => `
    <div class="audit-entry">
      <span class="audit-time">${window.CivIQ.formatDate ? window.CivIQ.formatDate(e.createdAt || e.changedAt) : esc(e.createdAt || e.changedAt || '')}</span>
      <span class="audit-action">
        <span class="audit-user">${esc(e.userName || e.changedBy || 'System')}</span>
        — ${esc(e.action || e.note || '')}
        ${e.details ? ` <span class="text-muted">(${esc(e.details)})</span>` : ''}
        ${e.oldStatus && e.newStatus ? ` <span class="text-muted">${esc(e.oldStatus)} → ${esc(e.newStatus)}</span>` : ''}
      </span>
    </div>
  `).join('');

  return `<div class="audit-log" role="log" aria-label="Audit history">${rows}</div>`;
};

// ───────────────────────────────────────────────────────────
// 10. BarChart(data, labels)
//     Simple CSS-based bar chart.
//     data: [number, ...], labels: [string, ...]
// ───────────────────────────────────────────────────────────
window.CivIQ.BarChart = function BarChart(data, labels) {
  if (!data || data.length === 0) {
    return '<p class="text-muted text-sm">No data to display.</p>';
  }

  const max = Math.max(...data, 1);

  const bars = data.map((val, i) => {
    const pct = Math.round((val / max) * 100);
    const label = labels && labels[i] ? labels[i] : '';
    return `
      <div class="bar-chart-col">
        <div class="bar-chart-bar" style="height: ${pct}%;" aria-label="${esc(label)}: ${val}">
          <span class="bar-value">${val}</span>
        </div>
        <span class="bar-chart-label">${esc(label)}</span>
      </div>
    `;
  }).join('');

  return `<div class="bar-chart" role="img" aria-label="Bar chart">${bars}</div>`;
};

// ───────────────────────────────────────────────────────────
// Date/time helpers shared globally
// ───────────────────────────────────────────────────────────

/** Format an ISO date string to a friendly display */
window.CivIQ.formatDate = function formatDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return esc(iso);
    return d.toLocaleDateString('en-IN', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  } catch {
    return esc(iso);
  }
};

/** Convert an ISO date to "X hours ago" style */
window.CivIQ.timeAgo = function timeAgo(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return esc(iso);
    const now = Date.now();
    const diff = now - d.getTime();
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months}mo ago`;
    const years = Math.floor(months / 12);
    return `${years}y ago`;
  } catch {
    return esc(iso);
  }
};

/** Render a colored status badge */
window.CivIQ.renderStatusBadge = function renderStatusBadge(status) {
  if (!status) return '';
  const classMap = {
    'Submitted': 'badge-submitted',
    'Under Review': 'badge-under-review',
    'Assigned': 'badge-assigned',
    'In Progress': 'badge-in-progress',
    'Resolved': 'badge-resolved',
    'Closed': 'badge-closed',
    'Reopened': 'badge-reopened'
  };
  const cls = classMap[status] || 'badge-submitted';
  return `<span class="badge ${cls}">${esc(status)}</span>`;
};

/** Render a colored priority badge with icon */
window.CivIQ.renderPriorityBadge = function renderPriorityBadge(priority) {
  if (!priority) return '';
  const map = {
    'Critical': { cls: 'badge-critical', icon: '🔴' },
    'High': { cls: 'badge-high', icon: '🟠' },
    'Medium': { cls: 'badge-medium', icon: '🟡' },
    'Low': { cls: 'badge-low', icon: '🟢' }
  };
  const m = map[priority] || { cls: 'badge-medium', icon: '⚪' };
  return `<span class="badge ${m.cls}"><span aria-hidden="true">${m.icon}</span> ${esc(priority)}</span>`;
};

console.log('[CivIQ] Components loaded.');
