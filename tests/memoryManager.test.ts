import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MemoryManager } from '../electron/runtime/agent/memoryManager.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Test Helpers
// ═══════════════════════════════════════════════════════════════════════════════

function createTempStorePath(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-test-'));
  return path.join(tmpDir, 'memory-store.json');
}

function validRecord(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    sessionId: 'session-001',
    fact: 'The project uses TypeScript with Vite bundler',
    tags: ['typescript', 'vite', 'bundler'],
    importanceScore: 75,
    retention: 'persistent' as const,
    ...overrides
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Unit Tests: MemoryManager Constructor
// ═══════════════════════════════════════════════════════════════════════════════

describe('MemoryManager constructor', () => {
  it('throws when storePath is empty', () => {
    expect(() => new MemoryManager('')).toThrow('storePath must be a non-empty string');
  });

  it('throws when storePath is not a string', () => {
    expect(() => new MemoryManager(null as unknown as string)).toThrow();
  });

  it('creates directory structure on construction', () => {
    const storePath = createTempStorePath();
    new MemoryManager(storePath);
    expect(fs.existsSync(path.dirname(storePath))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Unit Tests: createRecord
// ═══════════════════════════════════════════════════════════════════════════════

describe('MemoryManager.createRecord', () => {
  let storePath: string;
  let manager: MemoryManager;

  beforeEach(() => {
    storePath = createTempStorePath();
    manager = new MemoryManager(storePath);
  });

  afterEach(() => {
    try { fs.rmSync(path.dirname(storePath), { recursive: true }); } catch { /* ignore cleanup errors */ }
  });

  it('creates a valid record with generated id, createdAt, updatedAt', () => {
    const result = manager.createRecord(validRecord());
    expect(result.success).toBe(true);
    expect(result.record).toBeDefined();
    expect(result.record!.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.record!.createdAt).toBeDefined();
    expect(result.record!.updatedAt).toBeDefined();
    expect(result.record!.fact).toBe('The project uses TypeScript with Vite bundler');
  });

  it('persists the record to disk', () => {
    manager.createRecord(validRecord());
    const raw = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    expect(raw).toHaveLength(1);
    expect(raw[0].fact).toBe('The project uses TypeScript with Vite bundler');
  });

  it('rejects record with empty fact', () => {
    const result = manager.createRecord(validRecord({ fact: '   ' }));
    expect(result.success).toBe(false);
    expect(result.errors).toContain('fact must be a non-empty string');
  });

  it('rejects record with missing sessionId', () => {
    const result = manager.createRecord(validRecord({ sessionId: '' }));
    expect(result.success).toBe(false);
    expect(result.errors).toContain('sessionId must be a non-empty string');
  });

  it('rejects record with importanceScore out of range', () => {
    const result = manager.createRecord(validRecord({ importanceScore: 150 }));
    expect(result.success).toBe(false);
    expect(result.errors![0]).toContain('importanceScore');
  });

  it('rejects record with invalid retention value', () => {
    const result = manager.createRecord(validRecord({ retention: 'forever' }));
    expect(result.success).toBe(false);
    expect(result.errors![0]).toContain('retention');
  });

  it('trims fact and tags on save', () => {
    const result = manager.createRecord(validRecord({ fact: '  spaced fact  ', tags: ['  tag1  ', 'tag2'] }));
    expect(result.success).toBe(true);
    expect(result.record!.fact).toBe('spaced fact');
    expect(result.record!.tags).toEqual(['tag1', 'tag2']);
  });

  it('filters out empty tags', () => {
    const result = manager.createRecord(validRecord({ tags: ['valid', '', '  '] }));
    expect(result.success).toBe(true);
    expect(result.record!.tags).toEqual(['valid']);
  });

  it('rounds importanceScore to nearest integer', () => {
    const result = manager.createRecord(validRecord({ importanceScore: 72.7 }));
    expect(result.success).toBe(true);
    expect(result.record!.importanceScore).toBe(73);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Unit Tests: getRecord
// ═══════════════════════════════════════════════════════════════════════════════

describe('MemoryManager.getRecord', () => {
  let storePath: string;
  let manager: MemoryManager;

  beforeEach(() => {
    storePath = createTempStorePath();
    manager = new MemoryManager(storePath);
  });

  afterEach(() => {
    try { fs.rmSync(path.dirname(storePath), { recursive: true }); } catch { /* ignore cleanup errors */ }
  });

  it('retrieves a record by its ID', () => {
    const { record } = manager.createRecord(validRecord());
    const retrieved = manager.getRecord(record!.id);
    expect(retrieved).toEqual(record);
  });

  it('returns null for non-existent ID', () => {
    expect(manager.getRecord('non-existent-id')).toBeNull();
  });

  it('returns null for non-string input', () => {
    expect(manager.getRecord(123 as unknown as string)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Unit Tests: updateRecord
// ═══════════════════════════════════════════════════════════════════════════════

describe('MemoryManager.updateRecord', () => {
  let storePath: string;
  let manager: MemoryManager;

  beforeEach(() => {
    storePath = createTempStorePath();
    manager = new MemoryManager(storePath);
  });

  afterEach(() => {
    try { fs.rmSync(path.dirname(storePath), { recursive: true }); } catch { /* ignore cleanup errors */ }
  });

  it('updates fact and sets new updatedAt', () => {
    const { record } = manager.createRecord(validRecord());
    const originalUpdatedAt = record!.updatedAt;

    // Small delay to ensure updatedAt differs
    const result = manager.updateRecord(record!.id, { fact: 'Updated fact' });
    expect(result.success).toBe(true);
    expect(result.record!.fact).toBe('Updated fact');
    expect(result.record!.updatedAt >= originalUpdatedAt).toBe(true);
  });

  it('updates tags', () => {
    const { record } = manager.createRecord(validRecord());
    const result = manager.updateRecord(record!.id, { tags: ['new-tag'] });
    expect(result.success).toBe(true);
    expect(result.record!.tags).toEqual(['new-tag']);
  });

  it('updates importanceScore', () => {
    const { record } = manager.createRecord(validRecord());
    const result = manager.updateRecord(record!.id, { importanceScore: 50 });
    expect(result.success).toBe(true);
    expect(result.record!.importanceScore).toBe(50);
  });

  it('updates retention', () => {
    const { record } = manager.createRecord(validRecord());
    const result = manager.updateRecord(record!.id, { retention: 'session' });
    expect(result.success).toBe(true);
    expect(result.record!.retention).toBe('session');
  });

  it('rejects update for non-existent ID', () => {
    const result = manager.updateRecord('no-such-id', { fact: 'test' });
    expect(result.success).toBe(false);
    expect(result.errors).toContain('Record not found');
  });

  it('rejects invalid importanceScore in update', () => {
    const { record } = manager.createRecord(validRecord());
    const result = manager.updateRecord(record!.id, { importanceScore: -5 });
    expect(result.success).toBe(false);
    expect(result.errors![0]).toContain('importanceScore');
  });

  it('rejects empty fact in update', () => {
    const { record } = manager.createRecord(validRecord());
    const result = manager.updateRecord(record!.id, { fact: '' });
    expect(result.success).toBe(false);
    expect(result.errors![0]).toContain('fact');
  });

  it('persists updates to disk', () => {
    const { record } = manager.createRecord(validRecord());
    manager.updateRecord(record!.id, { fact: 'Persisted update' });
    const raw = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    expect(raw[0].fact).toBe('Persisted update');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Unit Tests: deleteRecord
// ═══════════════════════════════════════════════════════════════════════════════

describe('MemoryManager.deleteRecord', () => {
  let storePath: string;
  let manager: MemoryManager;

  beforeEach(() => {
    storePath = createTempStorePath();
    manager = new MemoryManager(storePath);
  });

  afterEach(() => {
    try { fs.rmSync(path.dirname(storePath), { recursive: true }); } catch { /* ignore cleanup errors */ }
  });

  it('deletes an existing record', () => {
    const { record } = manager.createRecord(validRecord());
    const result = manager.deleteRecord(record!.id);
    expect(result.success).toBe(true);
    expect(manager.getRecord(record!.id)).toBeNull();
  });

  it('returns error for non-existent record', () => {
    const result = manager.deleteRecord('non-existent');
    expect(result.success).toBe(false);
    expect(result.errors).toContain('Record not found');
  });

  it('persists deletion to disk', () => {
    const { record } = manager.createRecord(validRecord());
    manager.deleteRecord(record!.id);
    const raw = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    expect(raw).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Unit Tests: listRecords
// ═══════════════════════════════════════════════════════════════════════════════

describe('MemoryManager.listRecords', () => {
  let storePath: string;
  let manager: MemoryManager;

  beforeEach(() => {
    storePath = createTempStorePath();
    manager = new MemoryManager(storePath);
  });

  afterEach(() => {
    try { fs.rmSync(path.dirname(storePath), { recursive: true }); } catch { /* ignore cleanup errors */ }
  });

  it('returns empty array when no records exist', () => {
    expect(manager.listRecords()).toEqual([]);
  });

  it('returns all records when no sessionId filter', () => {
    manager.createRecord(validRecord({ sessionId: 'session-1' }));
    manager.createRecord(validRecord({ sessionId: 'session-2' }));
    expect(manager.listRecords()).toHaveLength(2);
  });

  it('filters by sessionId when provided', () => {
    manager.createRecord(validRecord({ sessionId: 'session-1' }));
    manager.createRecord(validRecord({ sessionId: 'session-2' }));
    manager.createRecord(validRecord({ sessionId: 'session-1' }));
    const filtered = manager.listRecords('session-1');
    expect(filtered).toHaveLength(2);
    expect(filtered.every((r: { sessionId: string }) => r.sessionId === 'session-1')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Unit Tests: retrieveRelevant
// ═══════════════════════════════════════════════════════════════════════════════

describe('MemoryManager.retrieveRelevant', () => {
  let storePath: string;
  let manager: MemoryManager;

  beforeEach(() => {
    storePath = createTempStorePath();
    manager = new MemoryManager(storePath);
  });

  afterEach(() => {
    try { fs.rmSync(path.dirname(storePath), { recursive: true }); } catch { /* ignore cleanup errors */ }
  });

  it('returns empty array for empty instruction', () => {
    manager.createRecord(validRecord());
    expect(manager.retrieveRelevant('')).toEqual([]);
  });

  it('returns empty array when no records exist', () => {
    expect(manager.retrieveRelevant('build the project')).toEqual([]);
  });

  it('returns records with keyword overlap', () => {
    manager.createRecord(validRecord({ fact: 'Uses TypeScript for type safety', tags: ['typescript'] }));
    manager.createRecord(validRecord({ fact: 'Database is PostgreSQL', tags: ['database', 'postgres'] }));

    const results = manager.retrieveRelevant('TypeScript configuration');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].fact).toContain('TypeScript');
  });

  it('returns at most limit records', () => {
    // Create 25 records all matching "code"
    for (let i = 0; i < 25; i++) {
      manager.createRecord(validRecord({ fact: `Code fact ${i}`, tags: ['code'], importanceScore: 50 }));
    }
    const results = manager.retrieveRelevant('code implementation');
    expect(results.length).toBeLessThanOrEqual(20);
  });

  it('respects custom limit parameter', () => {
    for (let i = 0; i < 10; i++) {
      manager.createRecord(validRecord({ fact: `Python fact ${i}`, tags: ['python'], importanceScore: 50 }));
    }
    const results = manager.retrieveRelevant('python scripting', 5);
    expect(results.length).toBeLessThanOrEqual(5);
  });

  it('caps custom limit at 20', () => {
    for (let i = 0; i < 30; i++) {
      manager.createRecord(validRecord({ fact: `JS fact ${i}`, tags: ['javascript'], importanceScore: 50 }));
    }
    const results = manager.retrieveRelevant('javascript development', 100);
    expect(results.length).toBeLessThanOrEqual(20);
  });

  it('sorts by relevance (importanceScore * overlap count)', () => {
    manager.createRecord(validRecord({
      fact: 'Low importance multi keyword match typescript vite',
      tags: ['typescript', 'vite'],
      importanceScore: 10
    }));
    manager.createRecord(validRecord({
      fact: 'High importance typescript match',
      tags: ['typescript'],
      importanceScore: 90
    }));

    const results = manager.retrieveRelevant('typescript vite project');
    // The high importance record with 1 overlap (90*1=90) should rank
    // below the low importance record with 2 overlaps (10*2=20) — wait, 90 > 20
    // Actually 90*1=90 vs 10*2=20, so high importance wins
    expect(results[0].importanceScore).toBe(90);
  });

  it('excludes records with zero keyword overlap', () => {
    manager.createRecord(validRecord({ fact: 'About python and flask', tags: ['python', 'flask'] }));
    const results = manager.retrieveRelevant('rust cargo compilation');
    expect(results).toHaveLength(0);
  });

  it('matches against tags case-insensitively', () => {
    manager.createRecord(validRecord({ fact: 'Some fact', tags: ['TypeScript'] }));
    const results = manager.retrieveRelevant('typescript');
    expect(results.length).toBe(1);
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// Property-Based Tests: Property 14
// Feature: agent-client, Property 14
// ═══════════════════════════════════════════════════════════════════════════════

import fc from 'fast-check';

describe('MemoryManager - Property 14: Memory persistence round-trip', () => {
  /**
   * **Validates: Requirements 8.3, 8.4**
   *
   * For any valid memory record (with non-empty fact, valid tags, importance
   * score 0-100, and valid retention value), persisting and then retrieving
   * it SHALL produce a record with equivalent field values. Memory retrieval
   * for a task instruction SHALL return at most 20 records, each having at
   * least one keyword overlapping with the task instruction.
   */

  // ─── Arbitraries ─────────────────────────────────────────────────────────

  /** Generates a non-empty, non-whitespace-only string */
  const nonEmptyStringArb = fc.string({ minLength: 1, maxLength: 100 })
    .filter(s => s.trim().length > 0);

  /** Generates a valid tag (non-empty string after trimming) */
  const tagArb = fc.string({ minLength: 1, maxLength: 50 })
    .filter(s => s.trim().length > 0);

  /** Generates a valid retention value */
  const retentionArb = fc.constantFrom('session', 'persistent');

  /** Generates a valid importance score (integer 0-100) */
  const importanceScoreArb = fc.integer({ min: 0, max: 100 });

  /** Generates a valid memory record input */
  const validRecordArb = fc.record({
    sessionId: nonEmptyStringArb,
    fact: nonEmptyStringArb,
    tags: fc.array(tagArb, { minLength: 0, maxLength: 10 }),
    importanceScore: importanceScoreArb,
    retention: retentionArb
  });

  // ─── Property: Round-trip persistence produces equivalent fields ─────────

  it('persisting and retrieving a valid record produces equivalent field values', () => {
    fc.assert(
      fc.property(validRecordArb, (input) => {
        const storePath = createTempStorePath();
        const manager = new MemoryManager(storePath);

        try {
          const createResult = manager.createRecord(input);
          expect(createResult.success).toBe(true);
          expect(createResult.record).toBeDefined();

          const retrieved = manager.getRecord(createResult.record!.id);
          expect(retrieved).not.toBeNull();

          // Verify equivalent field values
          expect(retrieved!.sessionId).toBe(input.sessionId.trim());
          expect(retrieved!.fact).toBe(input.fact.trim());
          expect(retrieved!.importanceScore).toBe(Math.round(input.importanceScore));
          expect(retrieved!.retention).toBe(input.retention);

          // Tags should be trimmed and non-empty filtered
          const expectedTags = input.tags
            .map(t => t.trim())
            .filter(t => t.length > 0);
          expect(retrieved!.tags).toEqual(expectedTags);

          // System fields should exist
          expect(retrieved!.id).toMatch(/^[0-9a-f-]{36}$/);
          expect(retrieved!.createdAt).toBeDefined();
          expect(retrieved!.updatedAt).toBeDefined();
        } finally {
          try { fs.rmSync(path.dirname(storePath), { recursive: true }); } catch { /* ignore cleanup errors */ }
        }
      }),
      { numRuns: 100 }
    );
  }, 30000);

  // ─── Property: Retrieval returns at most 20 records ──────────────────────

  it('retrieval returns at most 20 records regardless of total stored', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 21, max: 35 }),
        (recordCount) => {
          const storePath = createTempStorePath();
          const manager = new MemoryManager(storePath);

          try {
            // Create recordCount records all sharing a common keyword
            const sharedKeyword = 'typescript';
            for (let i = 0; i < recordCount; i++) {
              manager.createRecord({
                sessionId: `session-${i}`,
                fact: `Fact about ${sharedKeyword} project number ${i}`,
                tags: [sharedKeyword, `tag-${i}`],
                importanceScore: Math.floor(Math.random() * 101),
                retention: 'persistent'
              });
            }

            const results = manager.retrieveRelevant(`${sharedKeyword} project`);
            expect(results.length).toBeLessThanOrEqual(20);
          } finally {
            try { fs.rmSync(path.dirname(storePath), { recursive: true }); } catch { /* ignore cleanup errors */ }
          }
        }
      ),
      { numRuns: 30 }
    );
  }, 30000);

  // ─── Property: Retrieved records have keyword overlap with instruction ───

  it('every retrieved record has at least one keyword overlapping with the task instruction', () => {
    fc.assert(
      fc.property(
        fc.array(validRecordArb, { minLength: 1, maxLength: 15 }),
        nonEmptyStringArb,
        (records, taskInstruction) => {
          const storePath = createTempStorePath();
          const manager = new MemoryManager(storePath);

          try {
            for (const record of records) {
              manager.createRecord(record);
            }

            const results = manager.retrieveRelevant(taskInstruction);

            // Extract keywords from task instruction (same logic as the implementation)
            const queryKeywords = taskInstruction
              .toLowerCase()
              .split(/[\s,;:.!?()[\]{}"'`/\\|<>@#$%^&*~+=\-_]+/)
              .filter(w => w.length >= 2);
            const queryKeywordSet = new Set(queryKeywords);

            for (const result of results) {
              // Extract keywords from the record's fact and tags
              const factKeywords = result.fact
                .toLowerCase()
                .split(/[\s,;:.!?()[\]{}"'`/\\|<>@#$%^&*~+=\-_]+/)
                .filter((w: string) => w.length >= 2);
              const tagKeywords = result.tags.map((t: string) => t.toLowerCase());
              const recordKeywords = new Set([...factKeywords, ...tagKeywords]);

              // At least one keyword must overlap
              const hasOverlap = [...queryKeywordSet].some(kw => recordKeywords.has(kw));
              expect(hasOverlap).toBe(true);
            }
          } finally {
            try { fs.rmSync(path.dirname(storePath), { recursive: true }); } catch { /* ignore cleanup errors */ }
          }
        }
      ),
      { numRuns: 100 }
    );
  }, 30000);
});
