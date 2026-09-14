// Feature: mcp-tools-wiring, Property 21: Python availability composition
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  composePythonAvailability,
  PROBE_NOTE_MAX_LENGTH
} from '../mcp/lib/probeHelpers.mjs';

/**
 * Property 21: Python availability composition
 *
 * The Python_Sandbox_Tool is reported available (`ok: true`) if and only if
 * Docker is available AND the sandbox root path is reachable. When unavailable,
 * the note names the precondition that failed (Docker unavailable vs. sandbox
 * root unreachable). Availability is derived purely from the actual check
 * results and never from probe response time.
 *
 * `composePythonAvailability` is the pure composition helper extracted from
 * `electron/main.js`'s `probeMcpServices()`. It performs no I/O and no timing,
 * so its output depends only on the supplied `pythonRoot` / `docker` check
 * results — which is exactly the "regardless of response time" guarantee.
 *
 * Validates: Requirements 10.1, 10.2
 */

// ─── Arbitraries ─────────────────────────────────────────────────────────────

// A resolved root path string (kept simple; the value is passed through).
const rootPathArb = fc
  .string({ minLength: 1, maxLength: 60 })
  .filter((s) => s.trim().length > 0);

// A root-check note. When the root is unreachable this note describes the
// failed precondition (e.g. "Directory does not exist."), so we keep it
// non-empty for the unreachable branch. We include arbitrary text (including
// very long strings) to exercise clamping.
const noteArb = fc.oneof(
  fc.constant('Directory available.'),
  fc.constant('Directory does not exist.'),
  fc.string({ minLength: 1, maxLength: 400 }),
  fc.string({ minLength: 0, maxLength: 400 })
);

const dockerNoteArb = fc.oneof(
  fc.constant('Docker version 25.0.3'),
  fc.constant('Docker CLI unavailable.'),
  fc.string({ minLength: 0, maxLength: 400 })
);

// A root check result. To keep the "unreachable → note names the precondition"
// invariant meaningful, the failing branch carries a non-empty descriptive note.
const rootCheckArb = fc.record({
  ok: fc.boolean(),
  root: rootPathArb,
  note: noteArb
});

const dockerCheckArb = fc.record({
  ok: fc.boolean(),
  note: dockerNoteArb
});

describe('Feature: mcp-tools-wiring, Property 21: Python availability composition', () => {
  it('reports ok iff root reachable AND docker available, naming the failed precondition (PBT)', () => {
    fc.assert(
      fc.property(rootCheckArb, dockerCheckArb, (pythonRoot, docker) => {
        const result = composePythonAvailability(pythonRoot, docker);

        // Availability is exactly the conjunction of the two check results.
        expect(result.ok).toBe(Boolean(pythonRoot.ok && docker.ok));

        // The resolved root and docker note are surfaced verbatim.
        expect(result.root).toBe(pythonRoot.root);
        expect(result.docker).toBe(docker.note);

        // The note is always a non-empty string clamped to <= 200 chars.
        expect(typeof result.note).toBe('string');
        expect(result.note.length).toBeGreaterThan(0);
        expect(result.note.length).toBeLessThanOrEqual(PROBE_NOTE_MAX_LENGTH);

        if (pythonRoot.ok && docker.ok) {
          // Both preconditions met → available, ready note.
          expect(result.note).toBe('Python sandbox ready.');
        } else if (!pythonRoot.ok) {
          // Sandbox root unreachable is the named precondition. The note is
          // derived from the root check's own note (which describes the root
          // issue), falling back to the unavailable message when that note is
          // empty. Either way it must NOT be the ready message.
          expect(result.note).not.toBe('Python sandbox ready.');
          const expectedRoot = pythonRoot.note.trim()
            ? pythonRoot.note.trim().slice(0, PROBE_NOTE_MAX_LENGTH)
            : 'Python sandbox unavailable.';
          expect(result.note).toBe(expectedRoot);
        } else {
          // Root reachable but Docker unavailable → the note names Docker as
          // the failed precondition.
          expect(result.note).toBe('Sandbox root ready but Docker unavailable.');
          expect(result.note).toMatch(/docker unavailable/i);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('does not depend on probe response time — identical check results yield identical output (PBT)', () => {
    // "Regardless of response time" means the composition is a pure function of
    // the check results. Composing the same inputs twice (as if from a fast and
    // a slow probe) yields identical availability and notes.
    fc.assert(
      fc.property(rootCheckArb, dockerCheckArb, (pythonRoot, docker) => {
        const fast = composePythonAvailability(pythonRoot, docker);
        const slow = composePythonAvailability(pythonRoot, docker);
        expect(slow).toEqual(fast);
        // And availability still equals the raw conjunction.
        expect(fast.ok).toBe(Boolean(pythonRoot.ok && docker.ok));
      }),
      { numRuns: 100 }
    );
  });
});
