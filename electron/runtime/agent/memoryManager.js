/**
 * Memory Manager — Agent Client
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 *
 * Persists memory records (facts, decisions, file locations) to a local JSON store.
 * Supports CRUD operations and keyword-overlap retrieval (max 20 records).
 *
 * Requirements: 8.3, 8.4, 8.5
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Maximum number of records returned by relevance retrieval */
const MAX_RETRIEVAL_LIMIT = 20;

/** Valid retention values */
const VALID_RETENTIONS = ['session', 'persistent'];

/** Minimum importance score */
const MIN_IMPORTANCE = 0;

/** Maximum importance score */
const MAX_IMPORTANCE = 100;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Ensures the directory containing the store file exists.
 * @param {string} storePath - Absolute path to the store JSON file
 */
function ensureStoreDir(storePath) {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
}

/**
 * Loads all memory records from the store file.
 * Returns an empty array if the file does not exist or is corrupted.
 *
 * @param {string} storePath - Absolute path to the store JSON file
 * @returns {Array<object>}
 */
function loadRecords(storePath) {
  if (!fs.existsSync(storePath)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(storePath, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/**
 * Persists all memory records to the store file.
 *
 * @param {string} storePath - Absolute path to the store JSON file
 * @param {Array<object>} records - The records array to persist
 */
function saveRecords(storePath, records) {
  ensureStoreDir(storePath);
  fs.writeFileSync(storePath, JSON.stringify(records, null, 2), 'utf8');
}

/**
 * Validates a memory record's required fields.
 * Returns an object { valid, errors }.
 *
 * @param {object} record - The record to validate
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateRecord(record) {
  const errors = [];

  if (!record || typeof record !== 'object') {
    return { valid: false, errors: ['Record must be an object'] };
  }

  if (typeof record.fact !== 'string' || record.fact.trim().length === 0) {
    errors.push('fact must be a non-empty string');
  }

  if (!Array.isArray(record.tags)) {
    errors.push('tags must be an array');
  } else {
    for (let i = 0; i < record.tags.length; i++) {
      if (typeof record.tags[i] !== 'string') {
        errors.push(`tags[${i}] must be a string`);
      }
    }
  }

  if (typeof record.importanceScore !== 'number' ||
      !Number.isFinite(record.importanceScore) ||
      record.importanceScore < MIN_IMPORTANCE ||
      record.importanceScore > MAX_IMPORTANCE) {
    errors.push(`importanceScore must be a number between ${MIN_IMPORTANCE} and ${MAX_IMPORTANCE}`);
  }

  if (!VALID_RETENTIONS.includes(record.retention)) {
    errors.push(`retention must be one of: ${VALID_RETENTIONS.join(', ')}`);
  }

  if (typeof record.sessionId !== 'string' || record.sessionId.trim().length === 0) {
    errors.push('sessionId must be a non-empty string');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Extracts keywords from a text string for matching purposes.
 * Splits on whitespace, lowercases, removes very short words (< 2 chars),
 * and deduplicates.
 *
 * @param {string} text - The text to extract keywords from
 * @returns {string[]}
 */
function extractKeywords(text) {
  if (typeof text !== 'string') return [];
  const words = text
    .toLowerCase()
    .split(/[\s,;:.!?()[\]{}"'`/\\|<>@#$%^&*~+=\-_]+/)
    .filter(w => w.length >= 2);
  return [...new Set(words)];
}

/**
 * Computes keyword overlap count between a record and a set of query keywords.
 * Matches against the record's fact text and tags.
 *
 * @param {object} record - A memory record
 * @param {string[]} queryKeywords - Keywords extracted from the task instruction
 * @returns {number} Number of overlapping keywords
 */
function computeKeywordOverlap(record, queryKeywords) {
  const recordKeywords = new Set([
    ...extractKeywords(record.fact),
    ...record.tags.map(t => t.toLowerCase())
  ]);
  let overlap = 0;
  for (const kw of queryKeywords) {
    if (recordKeywords.has(kw)) {
      overlap++;
    }
  }
  return overlap;
}

// ─── Memory Manager Class ────────────────────────────────────────────────────

/**
 * MemoryManager handles persistence and retrieval of memory records
 * (facts, decisions, file locations) across task sessions.
 */
export class MemoryManager {
  /**
   * @param {string} storePath - Absolute path to the JSON store file
   */
  constructor(storePath) {
    if (!storePath || typeof storePath !== 'string') {
      throw new Error('storePath must be a non-empty string');
    }
    this.storePath = storePath;
    ensureStoreDir(storePath);
  }

  /**
   * Creates and persists a new memory record.
   * Assigns id, createdAt, and updatedAt automatically.
   *
   * @param {object} record - Record data (sessionId, fact, tags, importanceScore, retention)
   * @returns {{ success: boolean, record?: object, errors?: string[] }}
   */
  createRecord(record) {
    const { valid, errors } = validateRecord(record);
    if (!valid) {
      return { success: false, errors };
    }

    const now = new Date().toISOString();
    const newRecord = {
      id: randomUUID(),
      sessionId: record.sessionId.trim(),
      fact: record.fact.trim(),
      tags: record.tags.map(t => (typeof t === 'string' ? t.trim() : '')).filter(t => t.length > 0),
      importanceScore: Math.round(record.importanceScore),
      retention: record.retention,
      createdAt: now,
      updatedAt: now
    };

    const records = loadRecords(this.storePath);
    records.push(newRecord);
    saveRecords(this.storePath, records);

    return { success: true, record: newRecord };
  }

  /**
   * Retrieves a single memory record by ID.
   *
   * @param {string} id - The record ID (UUID)
   * @returns {object|null} The record or null if not found
   */
  getRecord(id) {
    if (typeof id !== 'string') return null;
    const records = loadRecords(this.storePath);
    return records.find(r => r.id === id) || null;
  }

  /**
   * Updates an existing memory record's fields.
   * Only fact, tags, importanceScore, and retention may be updated.
   * Sets updatedAt to the current time.
   *
   * @param {string} id - The record ID to update
   * @param {object} updates - Fields to update
   * @returns {{ success: boolean, record?: object, errors?: string[] }}
   */
  updateRecord(id, updates) {
    if (typeof id !== 'string') {
      return { success: false, errors: ['id must be a string'] };
    }
    if (!updates || typeof updates !== 'object') {
      return { success: false, errors: ['updates must be an object'] };
    }

    const records = loadRecords(this.storePath);
    const index = records.findIndex(r => r.id === id);
    if (index === -1) {
      return { success: false, errors: ['Record not found'] };
    }

    const existing = records[index];
    const merged = { ...existing };

    // Apply allowed field updates with validation
    const errors = [];

    if ('fact' in updates) {
      if (typeof updates.fact === 'string' && updates.fact.trim().length > 0) {
        merged.fact = updates.fact.trim();
      } else {
        errors.push('fact must be a non-empty string');
      }
    }

    if ('tags' in updates) {
      if (Array.isArray(updates.tags)) {
        const validTags = updates.tags
          .filter(t => typeof t === 'string')
          .map(t => t.trim())
          .filter(t => t.length > 0);
        merged.tags = validTags;
      } else {
        errors.push('tags must be an array');
      }
    }

    if ('importanceScore' in updates) {
      if (typeof updates.importanceScore === 'number' &&
          Number.isFinite(updates.importanceScore) &&
          updates.importanceScore >= MIN_IMPORTANCE &&
          updates.importanceScore <= MAX_IMPORTANCE) {
        merged.importanceScore = Math.round(updates.importanceScore);
      } else {
        errors.push(`importanceScore must be a number between ${MIN_IMPORTANCE} and ${MAX_IMPORTANCE}`);
      }
    }

    if ('retention' in updates) {
      if (VALID_RETENTIONS.includes(updates.retention)) {
        merged.retention = updates.retention;
      } else {
        errors.push(`retention must be one of: ${VALID_RETENTIONS.join(', ')}`);
      }
    }

    if (errors.length > 0) {
      return { success: false, errors };
    }

    merged.updatedAt = new Date().toISOString();
    records[index] = merged;
    saveRecords(this.storePath, records);

    return { success: true, record: merged };
  }

  /**
   * Deletes a memory record by ID.
   *
   * @param {string} id - The record ID to delete
   * @returns {{ success: boolean, errors?: string[] }}
   */
  deleteRecord(id) {
    if (typeof id !== 'string') {
      return { success: false, errors: ['id must be a string'] };
    }

    const records = loadRecords(this.storePath);
    const index = records.findIndex(r => r.id === id);
    if (index === -1) {
      return { success: false, errors: ['Record not found'] };
    }

    records.splice(index, 1);
    saveRecords(this.storePath, records);

    return { success: true };
  }

  /**
   * Lists all memory records, optionally filtered by sessionId.
   *
   * @param {string} [sessionId] - Optional session ID to filter by
   * @returns {Array<object>}
   */
  listRecords(sessionId) {
    const records = loadRecords(this.storePath);
    if (typeof sessionId === 'string' && sessionId.trim().length > 0) {
      return records.filter(r => r.sessionId === sessionId.trim());
    }
    return records;
  }

  /**
   * Retrieves up to `limit` (max 20) relevant memory records based on
   * keyword overlap with the task instruction, sorted by relevance score.
   *
   * Relevance is computed as: importanceScore * keywordOverlapCount
   * Only records with at least one keyword overlap are returned.
   *
   * (Requirement 8.4)
   *
   * @param {string} taskInstruction - The task instruction text to match against
   * @param {number} [limit=20] - Maximum number of records to return (capped at 20)
   * @returns {Array<object>}
   */
  retrieveRelevant(taskInstruction, limit = MAX_RETRIEVAL_LIMIT) {
    if (typeof taskInstruction !== 'string' || taskInstruction.trim().length === 0) {
      return [];
    }

    const effectiveLimit = Math.min(
      Math.max(1, typeof limit === 'number' && Number.isFinite(limit) ? Math.floor(limit) : MAX_RETRIEVAL_LIMIT),
      MAX_RETRIEVAL_LIMIT
    );

    const queryKeywords = extractKeywords(taskInstruction);
    if (queryKeywords.length === 0) {
      return [];
    }

    const records = loadRecords(this.storePath);

    // Score each record by keyword overlap * importance
    const scored = [];
    for (const record of records) {
      const overlap = computeKeywordOverlap(record, queryKeywords);
      if (overlap > 0) {
        scored.push({
          record,
          relevance: record.importanceScore * overlap
        });
      }
    }

    // Sort by relevance descending, then by updatedAt descending for ties
    scored.sort((a, b) => {
      if (b.relevance !== a.relevance) return b.relevance - a.relevance;
      return (b.record.updatedAt || '').localeCompare(a.record.updatedAt || '');
    });

    return scored.slice(0, effectiveLimit).map(s => s.record);
  }
}
