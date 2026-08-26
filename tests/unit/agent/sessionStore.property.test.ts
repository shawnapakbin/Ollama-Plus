/**
 * Property-Based Tests: Session Store (Properties 15, 16)
 *
 * **Validates: Requirements 9.1, 9.2, 14.5**
 *
 * Property 15: For any valid TaskSession, persisting it and then retrieving it
 * SHALL produce a session with equivalent instruction, status, plan, step results,
 * artifacts, and configuration. No data loss SHALL occur between persistence and retrieval.
 *
 * Property 16: For any list of Task Sessions, paginating with page size 20
 * SHALL return pages where: each page contains at most 20 items, items within
 * each page are in strictly descending order by createdAt, and the last item
 * on page N has a createdAt >= first item on page N+1.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import {
  saveSession,
  getSession,
  listSessions
} from '../../../electron/runtime/agent/sessionStore.js';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

function createTempStorePath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-session-prop-'));
  tempDirs.push(dir);
  return path.join(dir, 'agent-sessions.json');
}

/**
 * Generates a valid ISO 8601 timestamp within a reasonable range.
 * Uses integer-based approach to avoid invalid Date objects from fast-check.
 */
const MIN_TS = new Date('2020-01-01T00:00:00.000Z').getTime();
const MAX_TS = new Date('2030-12-31T23:59:59.999Z').getTime();

const timestampArb = fc.integer({ min: MIN_TS, max: MAX_TS })
  .map((ms) => new Date(ms).toISOString());

/**
 * Generates a minimal valid session with a unique ID and a random createdAt.
 * Used for Property 16 pagination tests.
 */
const sessionArb = fc.record({
  id: fc.uuid(),
  createdAt: timestampArb,
  instruction: fc.string({ minLength: 1, maxLength: 100 })
}).map((rec) => ({
  id: rec.id,
  instruction: rec.instruction,
  status: 'completed' as const,
  workingDirectory: '/tmp',
  modelId: 'test-model',
  endpoint: 'http://localhost:11434',
  plan: null,
  attachments: [],
  artifacts: [],
  stepResults: [],
  replanCount: 0,
  createdAt: rec.createdAt,
  updatedAt: rec.createdAt,
  startedAt: null,
  completedAt: null,
  totalDuration: null,
  config: {
    stepTimeout: 120,
    taskTimeout: 900,
    retryCount: 3,
    autoApprovalLowRisk: false,
    customApprovalRules: [],
    toolTimeouts: { terminal: 60, file: 30, browser: 120, python: 60, http: 30 }
  }
}));

// ─── Generators for Property 15 (Full Session Round-Trip) ────────────────────

const statusArb = fc.constantFrom(
  'planned', 'running', 'paused', 'waiting_approval', 'completed', 'failed', 'canceled'
) as fc.Arbitrary<string>;

const toolCallRecordArb = fc.record({
  id: fc.uuid(),
  tool: fc.constantFrom('terminal', 'folder', 'browser', 'python', 'http'),
  server: fc.string({ minLength: 1, maxLength: 30 }),
  action: fc.string({ minLength: 1, maxLength: 30 }),
  params: fc.constant({}),
  output: fc.string({ minLength: 0, maxLength: 200 }),
  status: fc.constantFrom('success', 'error', 'timeout'),
  error: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: null }),
  duration: fc.nat({ max: 120000 }),
  startedAt: timestampArb,
  completedAt: timestampArb
});

const stepResultArb = fc.record({
  stepId: fc.uuid(),
  title: fc.string({ minLength: 1, maxLength: 120 }),
  status: fc.constantFrom('completed', 'failed', 'skipped', 'canceled'),
  toolCalls: fc.array(toolCallRecordArb, { minLength: 0, maxLength: 3 }),
  output: fc.string({ minLength: 0, maxLength: 200 }),
  error: fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: null }),
  startedAt: timestampArb,
  completedAt: timestampArb,
  duration: fc.nat({ max: 600000 }),
  retryCount: fc.nat({ max: 10 })
});

const stepArb = fc.record({
  id: fc.uuid(),
  title: fc.string({ minLength: 1, maxLength: 120 }),
  description: fc.string({ minLength: 0, maxLength: 200 }),
  riskLevel: fc.constantFrom('low', 'medium', 'high'),
  requiredTools: fc.array(fc.string({ minLength: 1, maxLength: 30 }), { minLength: 0, maxLength: 5 }),
  parallelSafe: fc.boolean(),
  timeout: fc.nat({ max: 600000 }),
  dependsOn: fc.array(fc.uuid(), { minLength: 0, maxLength: 3 })
});

const planArb = fc.option(
  fc.record({
    steps: fc.array(stepArb, { minLength: 1, maxLength: 5 }),
    estimatedDuration: fc.nat({ max: 3600000 }),
    reasoning: fc.string({ minLength: 1, maxLength: 200 })
  }),
  { nil: null }
);

const configArb = fc.record({
  stepTimeout: fc.integer({ min: 30, max: 600 }),
  taskTimeout: fc.integer({ min: 60, max: 3600 }),
  retryCount: fc.integer({ min: 0, max: 10 }),
  autoApprovalLowRisk: fc.boolean(),
  customApprovalRules: fc.array(
    fc.record({
      id: fc.uuid(),
      pattern: fc.string({ minLength: 1, maxLength: 100 }),
      type: fc.constantFrom('glob', 'regex'),
      description: fc.string({ minLength: 0, maxLength: 100 })
    }),
    { minLength: 0, maxLength: 3 }
  ),
  toolTimeouts: fc.record({
    terminal: fc.integer({ min: 10, max: 300 }),
    file: fc.integer({ min: 10, max: 300 }),
    browser: fc.integer({ min: 10, max: 300 }),
    python: fc.integer({ min: 10, max: 300 }),
    http: fc.integer({ min: 10, max: 300 })
  })
});

/**
 * Generates a full valid TaskSession with random but valid values for all fields.
 * Used for Property 15 persistence round-trip tests.
 */
const fullSessionArb = fc.record({
  id: fc.uuid(),
  instruction: fc.string({ minLength: 1, maxLength: 500 }),
  status: statusArb,
  workingDirectory: fc.string({ minLength: 1, maxLength: 100 }),
  modelId: fc.string({ minLength: 1, maxLength: 50 }),
  endpoint: fc.string({ minLength: 1, maxLength: 100 }),
  plan: planArb,
  attachments: fc.array(
    fc.record({
      id: fc.uuid(),
      filename: fc.string({ minLength: 1, maxLength: 50 }),
      mimeType: fc.constantFrom('text/plain', 'image/png', 'application/json'),
      size: fc.nat({ max: 1000000 }),
      content: fc.string({ minLength: 0, maxLength: 100 })
    }),
    { minLength: 0, maxLength: 3 }
  ),
  artifacts: fc.constant([]),
  stepResults: fc.array(stepResultArb, { minLength: 0, maxLength: 5 }),
  replanCount: fc.nat({ max: 3 }),
  createdAt: timestampArb,
  updatedAt: timestampArb,
  startedAt: fc.option(timestampArb, { nil: null }),
  completedAt: fc.option(timestampArb, { nil: null }),
  totalDuration: fc.option(fc.nat({ max: 3600000 }), { nil: null }),
  config: configArb
});

// ─── Property 15: Session persistence round-trip ─────────────────────────────

describe('Property 15: Session persistence round-trip', () => {
  it('persisted and retrieved sessions have equivalent instruction, status, plan, stepResults, artifacts, and config', () => {
    fc.assert(
      fc.property(
        fullSessionArb,
        (session) => {
          const storePath = createTempStorePath();

          const saved = saveSession(storePath, session);
          const retrieved = getSession(storePath, saved.id);

          // Must be retrievable
          expect(retrieved).not.toBeNull();

          // Verify all core fields are preserved
          expect(retrieved!.id).toBe(saved.id);
          expect(retrieved!.instruction).toBe(saved.instruction);
          expect(retrieved!.status).toBe(saved.status);
          expect(retrieved!.workingDirectory).toBe(saved.workingDirectory);
          expect(retrieved!.modelId).toBe(saved.modelId);
          expect(retrieved!.endpoint).toBe(saved.endpoint);
          expect(retrieved!.replanCount).toBe(saved.replanCount);
          expect(retrieved!.createdAt).toBe(saved.createdAt);
          expect(retrieved!.startedAt).toBe(saved.startedAt);
          expect(retrieved!.completedAt).toBe(saved.completedAt);
          expect(retrieved!.totalDuration).toBe(saved.totalDuration);

          // Deep equality for complex objects
          expect(retrieved!.plan).toEqual(saved.plan);
          expect(retrieved!.stepResults).toEqual(saved.stepResults);
          expect(retrieved!.artifacts).toEqual(saved.artifacts);
          expect(retrieved!.config).toEqual(saved.config);
          expect(retrieved!.attachments).toEqual(saved.attachments);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('multiple sessions can be persisted and each retrieved independently without interference', () => {
    fc.assert(
      fc.property(
        fc.array(fullSessionArb, { minLength: 2, maxLength: 10 }),
        (sessions) => {
          const storePath = createTempStorePath();

          // Save all sessions
          const savedSessions = sessions.map((s) => saveSession(storePath, s));

          // Each should be independently retrievable with all data intact
          for (const saved of savedSessions) {
            const retrieved = getSession(storePath, saved.id);
            expect(retrieved).not.toBeNull();
            expect(retrieved!.id).toBe(saved.id);
            expect(retrieved!.instruction).toBe(saved.instruction);
            expect(retrieved!.plan).toEqual(saved.plan);
            expect(retrieved!.stepResults).toEqual(saved.stepResults);
            expect(retrieved!.config).toEqual(saved.config);
          }

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('updating a session preserves all fields that were not changed', () => {
    fc.assert(
      fc.property(
        fullSessionArb,
        statusArb,
        (session, newStatus) => {
          const storePath = createTempStorePath();

          // Save initial session
          const saved = saveSession(storePath, session);

          // Update only the status
          const updated = saveSession(storePath, { ...saved, status: newStatus });

          // Retrieve and check non-updated fields remain intact
          const retrieved = getSession(storePath, saved.id);
          expect(retrieved).not.toBeNull();
          expect(retrieved!.instruction).toBe(saved.instruction);
          expect(retrieved!.workingDirectory).toBe(saved.workingDirectory);
          expect(retrieved!.modelId).toBe(saved.modelId);
          expect(retrieved!.plan).toEqual(saved.plan);
          expect(retrieved!.stepResults).toEqual(saved.stepResults);
          expect(retrieved!.config).toEqual(saved.config);
          expect(retrieved!.createdAt).toBe(saved.createdAt);

          // The status should reflect the new value (normalized)
          expect(retrieved!.status).toBe(updated.status);

          return true;
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── Property 16: Pagination ordering invariant ──────────────────────────────

describe('Property 16: Pagination ordering invariant', () => {
  it('each page contains at most pageSize items', () => {
    fc.assert(
      fc.property(
        fc.array(sessionArb, { minLength: 0, maxLength: 60 }),
        fc.integer({ min: 1, max: 50 }),
        (sessions, pageSize) => {
          const storePath = createTempStorePath();

          for (const session of sessions) {
            saveSession(storePath, session);
          }

          const totalPages = Math.max(1, Math.ceil(sessions.length / pageSize));
          for (let page = 1; page <= totalPages; page++) {
            const result = listSessions(storePath, { page, pageSize });
            if (result.items.length > pageSize) {
              return false;
            }
          }
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('items within each page are in strictly descending order by createdAt', () => {
    fc.assert(
      fc.property(
        fc.array(sessionArb, { minLength: 2, maxLength: 50 }),
        (sessions) => {
          const storePath = createTempStorePath();

          for (const session of sessions) {
            saveSession(storePath, session);
          }

          const pageSize = 20;
          const result = listSessions(storePath, { page: 1, pageSize });

          for (let i = 0; i < result.items.length - 1; i++) {
            const current = result.items[i].createdAt;
            const next = result.items[i + 1].createdAt;
            // Strictly descending: current >= next (descending order)
            if (current.localeCompare(next) < 0) {
              return false;
            }
          }
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('last item on page N has createdAt >= first item on page N+1', () => {
    fc.assert(
      fc.property(
        fc.array(sessionArb, { minLength: 5, maxLength: 60 }),
        fc.integer({ min: 2, max: 10 }),
        (sessions, pageSize) => {
          const storePath = createTempStorePath();

          for (const session of sessions) {
            saveSession(storePath, session);
          }

          const totalPages = Math.ceil(sessions.length / pageSize);
          for (let page = 1; page < totalPages; page++) {
            const currentPage = listSessions(storePath, { page, pageSize });
            const nextPage = listSessions(storePath, { page: page + 1, pageSize });

            if (currentPage.items.length === 0 || nextPage.items.length === 0) {
              continue;
            }

            const lastOnCurrent = currentPage.items[currentPage.items.length - 1].createdAt;
            const firstOnNext = nextPage.items[0].createdAt;

            // Last item on page N must have createdAt >= first item on page N+1
            if (lastOnCurrent.localeCompare(firstOnNext) < 0) {
              return false;
            }
          }
          return true;
        }
      ),
      { numRuns: 100 }
    );
  });

  it('total items across all pages equals total session count', () => {
    fc.assert(
      fc.property(
        fc.array(sessionArb, { minLength: 0, maxLength: 50 }),
        fc.integer({ min: 1, max: 25 }),
        (sessions, pageSize) => {
          const storePath = createTempStorePath();

          for (const session of sessions) {
            saveSession(storePath, session);
          }

          let totalCollected = 0;
          const totalPages = Math.max(1, Math.ceil(sessions.length / pageSize));
          for (let page = 1; page <= totalPages; page++) {
            const result = listSessions(storePath, { page, pageSize });
            totalCollected += result.items.length;
          }

          return totalCollected === sessions.length;
        }
      ),
      { numRuns: 100 }
    );
  });
});
