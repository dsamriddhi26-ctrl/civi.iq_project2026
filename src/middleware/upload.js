/**
 * Multipart Form Data Upload Handler for Civ.IQ
 * 
 * Parses multipart/form-data requests without external dependencies.
 * Validates file types using magic bytes (not client-provided MIME types).
 * Enforces size limits and sanitizes filenames.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_BODY_SIZE = 6 * 1024 * 1024; // 6MB total body
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');

// Magic bytes for allowed image types
const MAGIC_BYTES = {
  'image/jpeg': [
    [0xFF, 0xD8, 0xFF]
  ],
  'image/png': [
    [0x89, 0x50, 0x4E, 0x47]
  ],
  'image/webp': [
    // RIFF....WEBP
    [0x52, 0x49, 0x46, 0x46]
  ]
};

/**
 * Detect actual MIME type from file buffer magic bytes
 * @param {Buffer} buffer - File content
 * @returns {string|null} Detected MIME type or null
 */
function detectMimeType(buffer) {
  if (buffer.length < 12) return null;

  for (const [mime, signatures] of Object.entries(MAGIC_BYTES)) {
    for (const sig of signatures) {
      let match = true;
      for (let i = 0; i < sig.length; i++) {
        if (buffer[i] !== sig[i]) {
          match = false;
          break;
        }
      }
      if (match) {
        // Additional check for WebP: bytes 8-11 should be "WEBP"
        if (mime === 'image/webp') {
          const webpSig = buffer.slice(8, 12).toString('ascii');
          if (webpSig !== 'WEBP') continue;
        }
        return mime;
      }
    }
  }
  return null;
}

/**
 * Generate a safe filename for storage
 * @param {string} originalName - Original filename from client
 * @param {string} mimeType - Detected MIME type
 * @returns {string} Safe filename
 */
function generateSafeFilename(originalName, mimeType) {
  const ext = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp'
  }[mimeType] || '.bin';
  
  return `${crypto.randomUUID()}${ext}`;
}

/**
 * Parse multipart form data from request
 * @param {object} req - HTTP request
 * @returns {Promise<{fields: object, file: object|null}>}
 */
async function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const contentType = req.headers['content-type'] || '';
    
    // Handle JSON content type
    if (contentType.includes('application/json')) {
      let body = '';
      req.on('data', chunk => {
        body += chunk;
        if (body.length > MAX_BODY_SIZE) {
          reject(new Error('Request body too large'));
          req.destroy();
        }
      });
      req.on('end', () => {
        try {
          const fields = JSON.parse(body);
          resolve({ fields, file: null });
        } catch (e) {
          reject(new Error('Invalid JSON body'));
        }
      });
      req.on('error', reject);
      return;
    }

    // Handle URL-encoded
    if (contentType.includes('application/x-www-form-urlencoded')) {
      let body = '';
      req.on('data', chunk => {
        body += chunk;
        if (body.length > MAX_BODY_SIZE) {
          reject(new Error('Request body too large'));
          req.destroy();
        }
      });
      req.on('end', () => {
        const fields = {};
        const params = new URLSearchParams(body);
        for (const [key, value] of params) {
          fields[key] = value;
        }
        resolve({ fields, file: null });
      });
      req.on('error', reject);
      return;
    }

    // Handle multipart
    if (!contentType.includes('multipart/form-data')) {
      // Try to read as raw body
      let body = '';
      req.on('data', chunk => {
        body += chunk;
        if (body.length > MAX_BODY_SIZE) {
          reject(new Error('Request body too large'));
          req.destroy();
        }
      });
      req.on('end', () => {
        try {
          const fields = body ? JSON.parse(body) : {};
          resolve({ fields, file: null });
        } catch {
          resolve({ fields: {}, file: null });
        }
      });
      req.on('error', reject);
      return;
    }

    const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^\s;]+))/);
    if (!boundaryMatch) {
      reject(new Error('Missing boundary in multipart request'));
      return;
    }
    const boundary = boundaryMatch[1] || boundaryMatch[2];

    const chunks = [];
    let totalSize = 0;

    req.on('data', (chunk) => {
      totalSize += chunk.length;
      if (totalSize > MAX_BODY_SIZE) {
        reject(new Error(`Upload too large. Maximum total size is ${MAX_BODY_SIZE / (1024 * 1024)}MB`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      try {
        const buffer = Buffer.concat(chunks);
        const result = parseMultipartBuffer(buffer, boundary);
        resolve(result);
      } catch (e) {
        reject(e);
      }
    });

    req.on('error', reject);
  });
}

/**
 * Parse a multipart buffer into fields and file
 * @param {Buffer} buffer - Raw request body
 * @param {string} boundary - Multipart boundary
 * @returns {{fields: object, file: object|null}}
 */
function parseMultipartBuffer(buffer, boundary) {
  const fields = {};
  let file = null;

  const boundaryBuffer = Buffer.from(`--${boundary}`);
  const parts = [];
  
  let start = 0;
  while (true) {
    const idx = buffer.indexOf(boundaryBuffer, start);
    if (idx === -1) break;
    if (start > 0) {
      // Extract part between previous boundary and this one
      // Skip the CRLF after boundary
      let partStart = start;
      let partEnd = idx;
      // Remove trailing CRLF before boundary
      if (partEnd >= 2 && buffer[partEnd - 2] === 0x0D && buffer[partEnd - 1] === 0x0A) {
        partEnd -= 2;
      }
      if (partStart < partEnd) {
        parts.push(buffer.slice(partStart, partEnd));
      }
    }
    start = idx + boundaryBuffer.length;
    // Skip -- (end marker) or CRLF
    if (buffer[start] === 0x2D && buffer[start + 1] === 0x2D) {
      break; // End boundary
    }
    if (buffer[start] === 0x0D && buffer[start + 1] === 0x0A) {
      start += 2;
    }
  }

  for (const part of parts) {
    // Find header/body separator (double CRLF)
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;

    const headerStr = part.slice(0, headerEnd).toString('utf-8');
    const body = part.slice(headerEnd + 4);

    const nameMatch = headerStr.match(/name="([^"]+)"/);
    if (!nameMatch) continue;
    const name = nameMatch[1];

    const filenameMatch = headerStr.match(/filename="([^"]*)"/) ;
    
    if (filenameMatch) {
      // This is a file field
      const originalName = filenameMatch[1];
      if (!originalName || body.length === 0) continue; // Empty file field

      if (body.length > MAX_FILE_SIZE) {
        throw new Error(`File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB`);
      }

      // Detect actual MIME type from magic bytes
      const detectedMime = detectMimeType(body);
      if (!detectedMime) {
        throw new Error('Invalid file type. Only JPEG, PNG, and WebP images are allowed.');
      }

      // Save file
      const safeFilename = generateSafeFilename(originalName, detectedMime);
      const filePath = path.join(UPLOAD_DIR, safeFilename);

      // Ensure upload directory exists
      if (!fs.existsSync(UPLOAD_DIR)) {
        fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      }

      fs.writeFileSync(filePath, body);

      file = {
        fieldName: name,
        originalName: originalName,
        savedName: safeFilename,
        path: filePath,
        mimeType: detectedMime,
        size: body.length
      };
    } else {
      // Regular field
      fields[name] = body.toString('utf-8');
    }
  }

  return { fields, file };
}

/**
 * Read JSON body from request
 * @param {object} req - HTTP request
 * @returns {Promise<object>}
 */
async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > MAX_BODY_SIZE) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

module.exports = {
  parseMultipart,
  readJsonBody,
  detectMimeType,
  MAX_FILE_SIZE,
  UPLOAD_DIR
};
