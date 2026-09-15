// Feature: mcp-tools-wiring, Property 23: Probe note length bound
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  clampNote,
  composePythonAvailability,
  PROBE_NOTE_MAX_LENGTH
} from '../mcp/lib/probeHelpers.mjs';

/**
 * Property 23: Probe note length bound
 *
 * For any service entry in a probe result, the entry's `note` SHALL be a
 * non-empty string of length at most 200 characters, on both the available
 * and unavailable branches.
 *
 * `clampNote` is the pure helper every service/gateway note flows through
 * before it is surfaced by `probeMcpServices()`. It normalizes arbitrary input
 * (empty, whitespace-only, over-long, or non-string) to a non-empty string of
 * length <= PROBE_NOTE_MAX_LENGTH (200). `composePythonAvailability` composes
 * the Python entry note via `clampNote` on both branches, so the same bound
 * holds for the available ("Python sandbox ready.") and unavailable branches.
 *
 * Validates: Requirements 11.2, 11.3
 */

// ─── Arbitraries ─────────────────────────────────────────────────────────────

// Candidate note text spanning every relevant shape: empty, whitespace-only,
// short, exactly-at-bound, and well over the 200-char bound.
const noteTextArb = fc.oneof(
  fc.constant(''),
  fc.constant('   '),
  fc.constant('\t\n  \r'),
  fc.constant('Directory available.'),
  fc.string({ minLength: 0, maxLength: 50 }),
  fc.string({ minLength: PROBE_NOTE_MAX_LENGTH, maxLength: PROBE_NOTE_MAX_LENGTH + 400 }),
  // Whitespace padding around real content to exercise trimming.
  fc.string({ minLength: 1, maxLength: 40 }).map((s) => `   ${s}   `)
);

// Non-string inputs the helper must tolerate (number, boolean, null, undefined,
// object, array, symbol). All should be treated as empty and replaced.
const nonStringArb = fc.oneof(
  fc.constant(null),
  fc.constant(undefined),
  fc.integer(),
  fc.double(),
  fc.boolean(),
  fc.object(),
  fc.array(fc.anything()),
  fc.constant(Symbol('x'))
);

// A fallback candidate: sometimes a valid non-empty string, sometimes empty /
// whitespace / non-string (which forces the built-in 'Unavailable.' default).
const fallbackArb = fc.oneof(
  fc.constant(undefined),
  fc.constant(''),
  fc.constant('   '),
  fc.constant('Unavailable.'),
  fc.string({ minLength: 1, maxLength: 30 }),
  nonStringArb
);

// Root / docker check arbitraries reused for the composition branch coverage.
const rootCheckArb = fc.record({
  ok: fc.boolean(),
  root: fc.string({ minLength: 1, maxLength: 60 }).filter((s) => s.trim().length > 0),
  note: fc.oneof(
    fc.constant(''),
    fc.constant('Directory does not exist.'),
    fc.string({ minLength: 0, maxLength: 400 })
  )
});

const dockerCheckArb = fc.record({
  ok: fc.boolean(),
  note: fc.oneof(
    fc.constant('Docker version 25.0.3'),
    fc.constant('Docker CLI unavailable.'),
    fc.string({ minLength: 0, maxLength: 400 })
  )
});

// ─── Assertions helper ───────────────────────────────────────────────────────

function assertBoundedNonEmpty(note: unknown): void {
  expect(typeof note).toBe('string');
  const value = note as string;
  expect(value.length).toBeGreaterThan(0);
  expect(value.length).toBeLessThanOrEqual(PROBE_NOTE_MAX_LENGTH);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Feature: mcp-tools-wiring, Property 23: Probe note length bound', () => {
  it('clampNote returns a non-empty string of length <= 200 for any string input (PBT)', () => {
    fc.assert(
      fc.property(noteTextArb, fallbackArb, (text, fallback) => {
        const note = clampNote(text as string, fallback as string);
        assertBoundedNonEmpty(note);
      }),
      { numRuns: 100 }
    );
  });

  it('clampNote returns a non-empty string of length <= 200 for any non-string input (PBT)', () => {
    fc.assert(
      fc.property(nonStringArb, fallbackArb, (text, fallback) => {
        // Non-string text is treated as empty and replaced by the fallback
        // (or the built-in default), never producing an empty note.
        const note = clampNote(text as unknown as string, fallback as string);
        assertBoundedNonEmpty(note);
      }),
      { numRuns: 100 }
    );
  });

  it('composePythonAvailability note is non-empty and <= 200 on both branches (PBT)', () => {
    fc.assert(
      fc.property(rootCheckArb, dockerCheckArb, (pythonRoot, docker) => {
        const result = composePythonAvailability(pythonRoot, docker);

        // The bound holds regardless of the available/unavailable branch.
        assertBoundedNonEmpty(result.note);

        if (pythonRoot.ok && docker.ok) {
          // Available branch: ready note is bounded and non-empty.
          expect(result.note).toBe('Python sandbox ready.');
        } else {
          // Unavailable branch: still a bounded, non-empty note.
          expect(result.note).not.toBe('');
        }
      }),
      { numRuns: 100 }
    );
  });
});
