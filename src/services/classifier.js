/**
 * @module classifier
 * Report classification and duplicate detection service for Civ.IQ.
 *
 * Uses a rules-based engine as the default classifier.
 * Supports pluggable AI provider interface for enhanced classification.
 *
 * AI Provider interface (implement for real AI integration):
 * {
 *   classifyReport(description, category, imageInfo) => Promise<{category, priority, department, confidence}>
 *   detectDuplicates(report, candidates) => Promise<[{reportId, similarity, reason}]>
 * }
 */

const { haversineDistance } = require('../utils/helpers');

// ─── Provider Management ─────────────────────────────────────────────────────

/** @type {Object|null} Currently configured AI provider */
let _provider = null;

/**
 * Set an AI provider implementation.
 * The provider must implement classifyReport() and detectDuplicates().
 * @param {Object} provider - AI provider object.
 */
function setProvider(provider) {
  _provider = provider;
}

/**
 * Get the currently configured AI provider, or null if none is set.
 * @returns {Object|null}
 */
function getProvider() {
  return _provider;
}

// ─── Keyword Dictionaries ────────────────────────────────────────────────────

/** Keywords that indicate a critical-priority issue */
const CRITICAL_KEYWORDS = [
  'dangerous', 'hazard', 'hazardous', 'emergency', 'collapse', 'collapsed',
  'flooding', 'flood', 'exposed wire', 'sinkhole', 'accident', 'injury',
  'injured', 'urgent', 'electrical', 'electrocution', 'electrocuted',
  'life-threatening', 'fatal', 'cave-in', 'fire', 'explosion', 'toxic',
  'sewage overflow', 'gas leak'
];

/** Keywords that indicate a low-priority issue */
const LOW_KEYWORDS = [
  'minor', 'cosmetic', 'small', 'eventually', 'when possible', 'not urgent',
  'low priority', 'whenever', 'no rush', 'slight', 'barely'
];

/** Category keyword hints for cross-category suggestion */
const CATEGORY_KEYWORDS = {
  pothole:         ['pothole', 'road damage', 'road crack', 'crater', 'road hole', 'road repair'],
  garbage:         ['garbage', 'trash', 'waste', 'litter', 'rubbish', 'dump', 'debris', 'filth'],
  stray_animal:    ['stray dog', 'stray cat', 'stray animal', 'stray cow', 'dog bite', 'animal', 'pack of dogs'],
  streetlight:     ['streetlight', 'street light', 'lamp post', 'light pole', 'dark road', 'no light'],
  water_drainage:  ['water', 'drain', 'drainage', 'waterlogging', 'sewage', 'flooding', 'leak', 'pipe', 'nalla'],
  other:           []
};

/** Common English stop words excluded from text similarity matching */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
  'used', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
  'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then',
  'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each',
  'every', 'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no',
  'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just',
  'because', 'but', 'and', 'or', 'if', 'while', 'about', 'up', 'it',
  'its', 'this', 'that', 'these', 'those', 'i', 'me', 'my', 'we', 'our',
  'you', 'your', 'he', 'him', 'his', 'she', 'her', 'they', 'them', 'their',
  'what', 'which', 'who', 'whom', 'near', 'also', 'get', 'got', 'much'
]);

// ─── Classification ──────────────────────────────────────────────────────────

/**
 * Classify a report using the rules engine (or AI provider if available).
 *
 * Returns category confirmation/suggestion, priority assessment, and department routing.
 *
 * @param {import('node:sqlite').DatabaseSync} db - Database instance.
 * @param {string} description - The report description text.
 * @param {string} category - The user-selected category.
 * @param {Object|null} imageInfo - Optional image information { path, mimeType, size }.
 * @returns {{ category: string, priority: string, departmentId: string|null, departmentName: string|null, confidence: number, source: string, notes: string[] }}
 */
function classifyReport(db, description, category, imageInfo) {
  const result = {
    category,
    priority: 'medium',
    departmentId: null,
    departmentName: null,
    confidence: 0.7,
    source: 'rules_engine',
    notes: []
  };

  const descLower = (description || '').toLowerCase();

  // ── Priority determination ──────────────────────────────────────────
  // Use word-boundary matching to avoid partial matches (e.g. "not urgent" matching "urgent")
  // Also check for negation: "not urgent" should not trigger critical
  const hasCriticalKeyword = CRITICAL_KEYWORDS.some(kw => {
    if (kw.includes(' ')) return descLower.includes(kw);            // multi-word: exact substring
    const re = new RegExp(`\\b${kw}\\b`);
    if (!re.test(descLower)) return false;
    // Check for negation just before the keyword
    const negRe = new RegExp(`\\bnot\\s+${kw}\\b`);
    return !negRe.test(descLower);
  });
  // LOW_KEYWORDS are intentionally multi-word phrases, so substring match is fine
  const hasLowKeyword = LOW_KEYWORDS.some(kw => descLower.includes(kw));

  if (hasCriticalKeyword) {
    result.priority = 'critical';
    result.confidence = 0.80;
  } else if (hasLowKeyword) {
    result.priority = 'low';
    result.confidence = 0.75;
  } else {
    result.priority = 'medium';
    result.confidence = 0.70;
  }

  // ── Category cross-check ───────────────────────────────────────────
  // If the user selected a category, check if keywords strongly suggest a different one
  if (category === 'other') {
    // Try to suggest a more specific category
    for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      if (cat === 'other') continue;
      const matchCount = keywords.filter(kw => descLower.includes(kw)).length;
      if (matchCount >= 2) {
        result.category = cat;
        result.confidence = 0.65;
        result.notes.push(`Category auto-suggested as "${cat}" based on description keywords (user selected "other").`);
        break;
      }
    }
  } else {
    // Check if the description strongly hints at a different category
    for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
      if (cat === category || cat === 'other') continue;
      const matchCount = keywords.filter(kw => descLower.includes(kw)).length;
      if (matchCount >= 3) {
        result.notes.push(`Description keywords may indicate "${cat}" rather than "${category}". Keeping user selection.`);
        result.confidence = Math.max(0.60, result.confidence - 0.1);
        break;
      }
    }
  }

  // ── Department routing ─────────────────────────────────────────────
  const routingRule = db.prepare(
    `SELECT rr.department_id, d.name AS department_name
     FROM routing_rules rr
     JOIN departments d ON d.id = rr.department_id
     WHERE rr.category = ?
     ORDER BY rr.priority DESC
     LIMIT 1`
  ).get(result.category);

  if (routingRule) {
    result.departmentId = routingRule.department_id;
    result.departmentName = routingRule.department_name;
  } else {
    result.notes.push('No routing rule found for this category. Manual department assignment needed.');
    result.confidence = Math.max(0.60, result.confidence - 0.15);
  }

  // ── Image info note ────────────────────────────────────────────────
  if (!imageInfo) {
    result.notes.push('Image analysis unavailable — classification based on text and category only.');
  }

  // Clamp confidence to rules-engine range
  result.confidence = Math.min(0.85, Math.max(0.60, result.confidence));

  return result;
}

// ─── Duplicate Detection ─────────────────────────────────────────────────────

/**
 * Extract significant (non-stop) words from text, lowercased.
 * @param {string} text - Input text.
 * @returns {string[]} Array of significant words.
 */
function extractSignificantWords(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

/**
 * Calculate simple text similarity based on significant word overlap.
 * @param {string} text1 - First text.
 * @param {string} text2 - Second text.
 * @returns {number} Similarity score between 0 and 1.
 */
function textSimilarity(text1, text2) {
  const words1 = extractSignificantWords(text1);
  const words2 = extractSignificantWords(text2);

  if (words1.length === 0 || words2.length === 0) return 0;

  const set2 = new Set(words2);
  const matchCount = words1.filter(w => set2.has(w)).length;
  const totalUnique = new Set([...words1, ...words2]).size;

  return totalUnique > 0 ? matchCount / totalUnique : 0;
}

/**
 * Find potential duplicate reports near the given location with similar content.
 *
 * Uses configurable radius from app_settings, Haversine distance, category matching,
 * and text similarity to score candidates.
 *
 * @param {import('node:sqlite').DatabaseSync} db - Database instance.
 * @param {number|null} lat - Latitude of the new report.
 * @param {number|null} lng - Longitude of the new report.
 * @param {string} category - Category of the new report.
 * @param {string} description - Description of the new report.
 * @param {string|null} excludeReportId - Report ID to exclude (the report being checked).
 * @returns {Array<{ reportId: string, reportNumber: string, category: string, description: string, distance_meters: number|null, similarity_score: number, source: string }>}
 */
function getDuplicateSuggestions(db, lat, lng, category, description, excludeReportId) {
  // Get configurable radius
  const radiusSetting = db.prepare(
    "SELECT value FROM app_settings WHERE key = 'duplicate_radius_meters'"
  ).get();
  const radiusMeters = radiusSetting ? parseFloat(radiusSetting.value) : 500;

  // Related categories that could be near-duplicates
  const relatedCategories = {
    pothole: ['pothole'],
    garbage: ['garbage'],
    stray_animal: ['stray_animal'],
    streetlight: ['streetlight'],
    water_drainage: ['water_drainage'],
    other: ['other', 'pothole', 'garbage', 'stray_animal', 'streetlight', 'water_drainage']
  };

  // Query candidate reports that are not resolved/closed
  let candidates;
  if (excludeReportId) {
    candidates = db.prepare(
      `SELECT id, report_number, category, description, latitude, longitude, status, address
       FROM reports
       WHERE id != ?
         AND status NOT IN ('closed')
         AND is_duplicate = 0
       ORDER BY created_at DESC
       LIMIT 100`
    ).all(excludeReportId);
  } else {
    candidates = db.prepare(
      `SELECT id, report_number, category, description, latitude, longitude, status, address
       FROM reports
       WHERE status NOT IN ('closed')
         AND is_duplicate = 0
       ORDER BY created_at DESC
       LIMIT 100`
    ).all();
  }

  const results = [];

  for (const candidate of candidates) {
    // ── Distance score ────────────────────────────────────────────
    let distanceMeters = null;
    let distanceScore = 0;

    if (lat != null && lng != null && candidate.latitude != null && candidate.longitude != null) {
      distanceMeters = haversineDistance(lat, lng, candidate.latitude, candidate.longitude);

      if (distanceMeters > radiusMeters) {
        // Outside radius — skip unless text similarity is very high
        // (we'll still compute text score for edge cases)
        distanceScore = 0;
      } else {
        // Closer = higher score (1.0 at same location, 0 at radius edge)
        distanceScore = 1 - (distanceMeters / radiusMeters);
      }
    }

    // ── Category score ────────────────────────────────────────────
    let categoryScore = 0;
    const related = relatedCategories[category] || [category];
    if (candidate.category === category) {
      categoryScore = 1.0;
    } else if (related.includes(candidate.category)) {
      categoryScore = 0.5;
    }

    // ── Text similarity score ─────────────────────────────────────
    const textScore = textSimilarity(description, candidate.description);

    // ── Combined score ────────────────────────────────────────────
    // Weights: distance 0.4, category 0.3, text 0.3
    const combinedScore = (distanceScore * 0.4) + (categoryScore * 0.3) + (textScore * 0.3);

    // Only return matches above threshold
    if (combinedScore > 0.3) {
      results.push({
        reportId: candidate.id,
        reportNumber: candidate.report_number,
        category: candidate.category,
        description: candidate.description,
        address: candidate.address,
        status: candidate.status,
        distance_meters: distanceMeters !== null ? Math.round(distanceMeters) : null,
        similarity_score: parseFloat(combinedScore.toFixed(4)),
        source: 'rules_engine'
      });
    }
  }

  // Sort by combined score descending
  results.sort((a, b) => b.similarity_score - a.similarity_score);

  return results;
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  setProvider,
  getProvider,
  classifyReport,
  getDuplicateSuggestions
};
