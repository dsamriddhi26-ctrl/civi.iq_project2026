/**
 * @module helpers
 * Utility functions for the Civ.IQ application.
 * Uses only Node.js built-in modules.
 */

const crypto = require('node:crypto');

// ─── Constants ───────────────────────────────────────────────────────────────

/** Allowed report categories */
const ALLOWED_CATEGORIES = [
  'pothole', 'garbage', 'stray_animal', 'streetlight', 'water_drainage', 'other'
];

/** Allowed report statuses */
const ALLOWED_STATUSES = [
  'submitted', 'under_review', 'assigned', 'in_progress',
  'resolved', 'closed', 'reopened'
];

/** Allowed priority levels */
const ALLOWED_PRIORITIES = ['critical', 'medium', 'low'];

/**
 * Valid status transitions.
 * Maps each status to the list of statuses it can transition to.
 */
const STATUS_TRANSITIONS = {
  submitted:    ['under_review', 'assigned', 'closed'],
  under_review: ['assigned', 'in_progress', 'closed'],
  assigned:     ['in_progress', 'under_review', 'closed'],
  in_progress:  ['resolved', 'assigned', 'closed'],
  resolved:     ['closed', 'reopened'],
  closed:       ['reopened'],
  reopened:     ['under_review', 'assigned', 'in_progress', 'closed']
};

// ─── UUID ────────────────────────────────────────────────────────────────────

/**
 * Generate a new v4 UUID.
 * @returns {string} A new UUID string.
 */
function generateUUID() {
  return crypto.randomUUID();
}

// ─── Report Number ───────────────────────────────────────────────────────────

/**
 * Generate a unique, human-readable report number in CIV-YYYY-NNNNN format.
 * Checks the database for uniqueness before returning.
 * @param {import('node:sqlite').DatabaseSync} db - The database instance.
 * @returns {string} A unique report number like "CIV-2024-00001".
 */
function generateReportNumber(db) {
  const year = new Date().getFullYear();
  const prefix = `CIV-${year}-`;

  // Find the highest existing number for this year
  const row = db.prepare(
    `SELECT report_number FROM reports
     WHERE report_number LIKE ? || '%'
     ORDER BY report_number DESC LIMIT 1`
  ).get(prefix);

  let nextNum = 1;
  if (row) {
    const lastNum = parseInt(row.report_number.split('-')[2], 10);
    nextNum = lastNum + 1;
  }

  const reportNumber = `${prefix}${String(nextNum).padStart(5, '0')}`;

  // Double-check uniqueness (belt-and-suspenders)
  const existing = db.prepare(
    'SELECT id FROM reports WHERE report_number = ?'
  ).get(reportNumber);

  if (existing) {
    // Extremely unlikely race condition fallback — increment and retry
    return generateReportNumber(db);
  }

  return reportNumber;
}

// ─── Input Sanitization ──────────────────────────────────────────────────────

/**
 * Sanitize a string by trimming whitespace and removing control characters.
 * @param {string} str - The input string.
 * @returns {string} The sanitized string, or empty string if input is falsy.
 */
function sanitizeInput(str) {
  if (!str || typeof str !== 'string') return '';
  // Remove ASCII control characters (0x00-0x1F) except tab, newline, carriage return
  // Also remove DEL (0x7F)
  return str.trim().replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Validate a basic email format.
 * @param {string} email - The email address to validate.
 * @returns {boolean} True if the email format is valid.
 */
function validateEmail(email) {
  if (!email || typeof email !== 'string') return false;
  // Reasonably strict regex: local@domain.tld
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email) && email.length <= 254;
}

/**
 * Validate that a category is in the allowed list.
 * @param {string} cat - The category to validate.
 * @returns {boolean} True if the category is allowed.
 */
function validateCategory(cat) {
  return ALLOWED_CATEGORIES.includes(cat);
}

/**
 * Validate that a status is in the allowed list.
 * @param {string} status - The status to validate.
 * @returns {boolean} True if the status is allowed.
 */
function validateStatus(status) {
  return ALLOWED_STATUSES.includes(status);
}

/**
 * Validate that a priority is in the allowed list.
 * @param {string} priority - The priority to validate.
 * @returns {boolean} True if the priority is allowed.
 */
function validatePriority(priority) {
  return ALLOWED_PRIORITIES.includes(priority);
}

// ─── Geospatial ──────────────────────────────────────────────────────────────

/**
 * Calculate the great-circle distance between two points using the Haversine formula.
 * @param {number} lat1 - Latitude of point 1 (degrees).
 * @param {number} lng1 - Longitude of point 1 (degrees).
 * @param {number} lat2 - Latitude of point 2 (degrees).
 * @param {number} lng2 - Longitude of point 2 (degrees).
 * @returns {number} Distance in meters.
 */
function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000; // Earth's radius in meters
  const toRad = (deg) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// ─── Cookie Parsing ──────────────────────────────────────────────────────────

/**
 * Parse a Cookie header string into a key-value object.
 * @param {string} cookieHeader - The raw Cookie header value.
 * @returns {Object<string, string>} Parsed cookies.
 */
function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader || typeof cookieHeader !== 'string') return cookies;

  cookieHeader.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const key = pair.substring(0, idx).trim();
    const val = pair.substring(idx + 1).trim();
    if (key) {
      // Decode URI-encoded values, falling back to raw value on error
      try {
        cookies[key] = decodeURIComponent(val);
      } catch {
        cookies[key] = val;
      }
    }
  });

  return cookies;
}

// ─── Image Validation ────────────────────────────────────────────────────────

/**
 * Magic byte signatures for supported image types.
 * We check the file buffer rather than trusting the client-supplied MIME type.
 */
const IMAGE_MAGIC = {
  jpeg: [
    { bytes: [0xFF, 0xD8, 0xFF] }
  ],
  png: [
    { bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] }
  ],
  webp: [
    // RIFF....WEBP
    { bytes: [0x52, 0x49, 0x46, 0x46], offset4: [0x57, 0x45, 0x42, 0x50] }
  ]
};

/**
 * Validate an image by checking its magic bytes.
 * Does NOT trust the client-supplied MIME type.
 * @param {string} mimeType - The claimed MIME type (used only for logging, not for validation).
 * @param {Buffer} buffer - The file buffer (at least the first 12 bytes are needed).
 * @returns {{ valid: boolean, detectedType: string|null }} Validation result.
 */
function isValidImageType(mimeType, buffer) {
  if (!buffer || buffer.length < 12) {
    return { valid: false, detectedType: null };
  }

  // Check JPEG
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return { valid: true, detectedType: 'image/jpeg' };
  }

  // Check PNG
  const pngSig = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
  if (pngSig.every((b, i) => buffer[i] === b)) {
    return { valid: true, detectedType: 'image/png' };
  }

  // Check WebP: starts with "RIFF", bytes 8-11 are "WEBP"
  const riff = [0x52, 0x49, 0x46, 0x46];
  const webp = [0x57, 0x45, 0x42, 0x50];
  if (
    riff.every((b, i) => buffer[i] === b) &&
    webp.every((b, i) => buffer[i + 8] === b)
  ) {
    return { valid: true, detectedType: 'image/webp' };
  }

  return { valid: false, detectedType: null };
}

// ─── HTML Escaping ───────────────────────────────────────────────────────────

/**
 * Escape HTML entities to prevent XSS when embedding user content in HTML.
 * @param {string} str - The raw string.
 * @returns {string} The escaped string safe for HTML insertion.
 */
function escapeHtml(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── Formatting ──────────────────────────────────────────────────────────────

/**
 * Format a byte count into a human-readable string.
 * @param {number} bytes - The number of bytes.
 * @returns {string} Formatted string, e.g. "1.5 MB".
 */
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  if (typeof bytes !== 'number' || bytes < 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const idx = Math.min(i, units.length - 1);
  const value = bytes / Math.pow(k, idx);

  return `${parseFloat(value.toFixed(2))} ${units[idx]}`;
}

// ─── Numeric Utilities ───────────────────────────────────────────────────────

/**
 * Clamp a number within a min/max range.
 * @param {number} val - The value to clamp.
 * @param {number} min - The minimum allowed value.
 * @param {number} max - The maximum allowed value.
 * @returns {number} The clamped value.
 */
function clamp(val, min, max) {
  return Math.min(Math.max(val, min), max);
}

/**
 * Extract GPS latitude/longitude from a JPEG EXIF APP1 buffer (zero dependencies).
 * Returns null if no EXIF GPS data is present or the buffer is not a valid JPEG.
 * @param {Buffer} buffer
 * @returns {{ latitude: number, longitude: number } | null}
 */
function extractExifGps(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer[0] !== 0xFF || buffer[1] !== 0xD8) return null; // Not JPEG

  let offset = 2;
  while (offset + 4 < buffer.length) {
    if (buffer[offset] !== 0xFF) break;
    const marker = buffer[offset + 1];
    if (marker === 0xDA || marker === 0xD9) break; // SOS or EOI
    const segLen = buffer.readUInt16BE(offset + 2);
    if (marker === 0xE1 && segLen >= 8 && buffer.toString('ascii', offset + 4, offset + 10) === 'Exif\0\0') {
      const tiffStart = offset + 10;
      if (tiffStart + 8 > buffer.length) return null;
      const byteOrder = buffer.toString('ascii', tiffStart, tiffStart + 2);
      const le = byteOrder === 'II';
      if (!le && byteOrder !== 'MM') return null;

      const u16 = (p) => (p + 2 <= buffer.length ? (le ? buffer.readUInt16LE(p) : buffer.readUInt16BE(p)) : 0);
      const u32 = (p) => (p + 4 <= buffer.length ? (le ? buffer.readUInt32LE(p) : buffer.readUInt32BE(p)) : 0);
      const readRational = (p) => {
        if (p + 8 > buffer.length) return 0;
        const num = u32(p);
        const den = u32(p + 4);
        return den ? num / den : 0;
      };

      const ifd0Offset = u32(tiffStart + 4);
      const ifd0Start = tiffStart + ifd0Offset;
      const entries = u16(ifd0Start);
      let gpsIfdOffset = null;
      for (let i = 0; i < entries; i++) {
        const entryPos = ifd0Start + 2 + i * 12;
        if (entryPos + 12 > buffer.length) break;
        if (u16(entryPos) === 0x8825) { // GPSInfoIFDPointer
          gpsIfdOffset = u32(entryPos + 8);
          break;
        }
      }
      if (gpsIfdOffset == null) return null;

      const gpsStart = tiffStart + gpsIfdOffset;
      const gpsEntries = u16(gpsStart);
      let latRef = 'N';
      let lngRef = 'E';
      let latVals = null;
      let lngVals = null;

      for (let i = 0; i < gpsEntries; i++) {
        const entryPos = gpsStart + 2 + i * 12;
        if (entryPos + 12 > buffer.length) break;
        const tag = u16(entryPos);
        const count = u32(entryPos + 4);
        const valOffset = tiffStart + u32(entryPos + 8);

        if (tag === 1) { // GPSLatitudeRef
          latRef = String.fromCharCode(buffer[entryPos + 8] || 78);
        } else if (tag === 3) { // GPSLongitudeRef
          lngRef = String.fromCharCode(buffer[entryPos + 8] || 69);
        } else if (tag === 2 && count === 3) { // GPSLatitude
          latVals = [readRational(valOffset), readRational(valOffset + 8), readRational(valOffset + 16)];
        } else if (tag === 4 && count === 3) { // GPSLongitude
          lngVals = [readRational(valOffset), readRational(valOffset + 8), readRational(valOffset + 16)];
        }
      }

      if (latVals && lngVals) {
        let lat = latVals[0] + latVals[1] / 60 + latVals[2] / 3600;
        let lng = lngVals[0] + lngVals[1] / 60 + lngVals[2] / 3600;
        if (latRef === 'S') lat = -lat;
        if (lngRef === 'W') lng = -lng;
        if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) {
          return {
            latitude: Math.round(lat * 1e6) / 1e6,
            longitude: Math.round(lng * 1e6) / 1e6
          };
        }
      }
      return null;
    }
    if (segLen < 2) break;
    offset += 2 + segLen;
  }
  return null;
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  // Constants
  ALLOWED_CATEGORIES,
  ALLOWED_STATUSES,
  ALLOWED_PRIORITIES,
  STATUS_TRANSITIONS,

  // Functions
  generateUUID,
  generateReportNumber,
  sanitizeInput,
  validateEmail,
  validateCategory,
  validateStatus,
  validatePriority,
  haversineDistance,
  parseCookies,
  isValidImageType,
  escapeHtml,
  formatFileSize,
  clamp,
  extractExifGps
};
