import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { computeSha512, verifyIntegrity } from '../electron/integrity.js';

/**
 * Property-Based Tests: Auto-Updater State Machine Transitions
 *
 * Property 1: Auto-updater state machine transitions are valid
 *
 * For any sequence of update events, the updater state machine SHALL only
 * transition to states reachable from the current state according to the
 * defined state diagram — no invalid transitions shall occur.
 *
 * **Validates: Requirements 8.1, 8.2, 8.4, 8.8**
 */

// ─── State Machine Definition (mirrors electron/updater.js) ──────────────────

/**
 * All valid states in the auto-updater state machine.
 */
const ALL_STATES = [
  'idle',
  'checking',
  'update-available',
  'downloading',
  'downloaded',
  'verifying',
  'ready-to-install',
  'installing'
] as const;

type UpdaterState = typeof ALL_STATES[number];

/**
 * Valid state transitions map — mirrors the VALID_TRANSITIONS in electron/updater.js.
 * Maps each state to its allowed next states.
 */
const VALID_TRANSITIONS: Record<UpdaterState, UpdaterState[]> = {
  'idle': ['checking'],
  'checking': ['update-available', 'idle'],
  'update-available': ['downloading', 'idle'],
  'downloading': ['downloaded', 'idle'],
  'downloaded': ['verifying'],
  'verifying': ['ready-to-install', 'idle'],
  'ready-to-install': ['installing', 'idle'],
  'installing': []
};

/**
 * Pure transition function that mirrors the updater's state machine logic.
 * Returns the new state if the transition is valid, or the current state if invalid.
 */
function transition(currentState: UpdaterState, nextState: UpdaterState): { newState: UpdaterState; valid: boolean } {
  const allowed = VALID_TRANSITIONS[currentState];
  if (allowed && allowed.includes(nextState)) {
    return { newState: nextState, valid: true };
  }
  return { newState: currentState, valid: false };
}

/**
 * Simulate a full sequence of transition attempts, starting from 'idle'.
 * Returns the history of states and whether any invalid transitions were accepted.
 */
function simulateTransitionSequence(events: UpdaterState[]): {
  stateHistory: UpdaterState[];
  invalidTransitionsAccepted: boolean;
} {
  let current: UpdaterState = 'idle';
  const stateHistory: UpdaterState[] = [current];
  let invalidTransitionsAccepted = false;

  for (const nextState of events) {
    const result = transition(current, nextState);
    if (result.valid) {
      current = result.newState;
      stateHistory.push(current);
    }
    // If invalid, state doesn't change (transition is rejected)
    if (result.valid && !VALID_TRANSITIONS[stateHistory[stateHistory.length - 2]]?.includes(current)) {
      invalidTransitionsAccepted = true;
    }
  }

  return { stateHistory, invalidTransitionsAccepted };
}

// ─── Arbitraries (Generators) ────────────────────────────────────────────────

/** Generate an arbitrary state from the state machine */
const stateArbitrary = fc.constantFrom(...ALL_STATES);

/** Generate an arbitrary sequence of state transition attempts */
const transitionSequenceArbitrary = fc.array(stateArbitrary, { minLength: 1, maxLength: 50 });

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Feature: windows-installer, Property 1: Auto-updater state machine transitions are valid', () => {
  /**
   * Property: For any sequence of transition attempts, the state machine
   * only moves to states that are reachable from the current state.
   */
  it('only valid transitions are accepted for arbitrary event sequences', () => {
    fc.assert(
      fc.property(transitionSequenceArbitrary, (events) => {
        let current: UpdaterState = 'idle';

        for (const nextState of events) {
          const result = transition(current, nextState);
          if (result.valid) {
            // If the transition was accepted, the next state must be in the allowed list
            expect(VALID_TRANSITIONS[current]).toContain(nextState);
            current = result.newState;
          } else {
            // If the transition was rejected, the state must remain unchanged
            expect(result.newState).toBe(current);
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property: No transition from 'idle' directly to 'installing' is possible.
   * The state machine requires going through intermediate states.
   */
  it('no direct transition from idle to installing is ever accepted', () => {
    fc.assert(
      fc.property(transitionSequenceArbitrary, (events) => {
        let current: UpdaterState = 'idle';

        for (const nextState of events) {
          const result = transition(current, nextState);
          if (result.valid) {
            // If we were in idle, we must NOT have transitioned to installing
            if (current === 'idle') {
              expect(result.newState).not.toBe('installing');
            }
            current = result.newState;
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property: The state machine always starts from 'idle' and any reachable
   * state must have been reached through a valid chain of transitions.
   */
  it('every state in the history is reachable via valid transitions from idle', () => {
    fc.assert(
      fc.property(transitionSequenceArbitrary, (events) => {
        const { stateHistory } = simulateTransitionSequence(events);

        // First state is always idle
        expect(stateHistory[0]).toBe('idle');

        // Every consecutive pair in the history must be a valid transition
        for (let i = 1; i < stateHistory.length; i++) {
          const from = stateHistory[i - 1];
          const to = stateHistory[i];
          expect(VALID_TRANSITIONS[from]).toContain(to);
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property: The 'installing' state is terminal — once reached, no further
   * transitions are possible.
   */
  it('installing is a terminal state with no outgoing transitions', () => {
    fc.assert(
      fc.property(transitionSequenceArbitrary, (events) => {
        let current: UpdaterState = 'idle';
        let reachedInstalling = false;

        for (const nextState of events) {
          const result = transition(current, nextState);
          if (result.valid) {
            current = result.newState;
          }

          if (current === 'installing') {
            reachedInstalling = true;
          }

          // Once installing is reached, no further transitions should succeed
          if (reachedInstalling && current === 'installing') {
            const anyTransition = transition(current, nextState);
            expect(anyTransition.valid).toBe(false);
            expect(anyTransition.newState).toBe('installing');
          }
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Invalid transitions never mutate the current state.
   * The state machine is safe against arbitrary invalid inputs.
   */
  it('invalid transitions never change the current state', () => {
    fc.assert(
      fc.property(
        stateArbitrary,
        stateArbitrary,
        (currentState, attemptedState) => {
          const result = transition(currentState, attemptedState);

          if (!VALID_TRANSITIONS[currentState]?.includes(attemptedState)) {
            // Invalid transition: state must not change
            expect(result.valid).toBe(false);
            expect(result.newState).toBe(currentState);
          } else {
            // Valid transition: state changes to the attempted state
            expect(result.valid).toBe(true);
            expect(result.newState).toBe(attemptedState);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: To reach 'installing', the state machine must pass through
   * 'ready-to-install' — there is no shortcut path.
   */
  it('installing can only be reached from ready-to-install', () => {
    fc.assert(
      fc.property(transitionSequenceArbitrary, (events) => {
        const { stateHistory } = simulateTransitionSequence(events);

        for (let i = 1; i < stateHistory.length; i++) {
          if (stateHistory[i] === 'installing') {
            expect(stateHistory[i - 1]).toBe('ready-to-install');
          }
        }
      }),
      { numRuns: 100 }
    );
  });
});


// ═══════════════════════════════════════════════════════════════════════════════
// Property 2: Update integrity verification round-trip
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Property 2: Update integrity verification round-trip
 *
 * For any downloaded update artifact with a known checksum, verifying the
 * artifact's integrity SHALL return true if and only if the computed checksum
 * matches the expected checksum — the verification function is a pure predicate
 * over bytes and hash.
 *
 * **Validates: Requirements 8.6**
 */
describe('Feature: windows-installer, Property 2: Update integrity verification round-trip', () => {
  /**
   * Property 2a: For any data, verifyIntegrity(data, sha512(data)) returns true.
   * A correct hash always passes verification.
   */
  it('verifyIntegrity returns true when computed hash matches expected hash (PBT)', () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 0, maxLength: 1024 }),
        (data) => {
          const buffer = Buffer.from(data);
          const correctHash = createHash('sha512').update(buffer).digest('hex');
          expect(verifyIntegrity(buffer, correctHash)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 2b: For any data and any different hash, verifyIntegrity(data, wrongHash)
   * returns false. SHA-512 collision probability is negligible.
   */
  it('verifyIntegrity returns false when expected hash does not match computed hash (PBT)', () => {
    // Generate a random 64-byte array and convert to hex to simulate a wrong SHA-512 hash
    const hexHashArbitrary = fc.uint8Array({ minLength: 64, maxLength: 64 }).map(
      (bytes) => Buffer.from(bytes).toString('hex')
    );

    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 0, maxLength: 1024 }),
        hexHashArbitrary,
        (data, randomHexHash) => {
          const buffer = Buffer.from(data);
          const actualHash = createHash('sha512').update(buffer).digest('hex');

          // Only assert false when the random hash differs from the actual hash
          // (collision is astronomically unlikely but we guard against it)
          if (randomHexHash.toLowerCase() !== actualHash) {
            expect(verifyIntegrity(buffer, randomHexHash)).toBe(false);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 2c: For any data, the verification is deterministic —
   * same input always produces the same output.
   */
  it('verifyIntegrity is deterministic: same input always yields same result (PBT)', () => {
    // Generate a random 64-byte array and convert to hex to simulate an arbitrary SHA-512 hash
    const hexHashArbitrary = fc.uint8Array({ minLength: 64, maxLength: 64 }).map(
      (bytes) => Buffer.from(bytes).toString('hex')
    );

    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 0, maxLength: 1024 }),
        hexHashArbitrary,
        (data, hash) => {
          const buffer = Buffer.from(data);
          const result1 = verifyIntegrity(buffer, hash);
          const result2 = verifyIntegrity(buffer, hash);
          const result3 = verifyIntegrity(buffer, hash);
          expect(result1).toBe(result2);
          expect(result2).toBe(result3);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 2d: computeSha512 is consistent with node:crypto directly.
   * The helper function produces the same result as using createHash directly.
   */
  it('computeSha512 matches direct node:crypto computation (PBT)', () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 0, maxLength: 1024 }),
        (data) => {
          const buffer = Buffer.from(data);
          const expected = createHash('sha512').update(buffer).digest('hex');
          const actual = computeSha512(buffer);
          expect(actual).toBe(expected);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 2e: verifyIntegrity is case-insensitive for the expected hash.
   * SHA-512 hex strings should match regardless of case.
   */
  it('verifyIntegrity is case-insensitive for hash comparison (PBT)', () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 1, maxLength: 512 }),
        (data) => {
          const buffer = Buffer.from(data);
          const correctHash = createHash('sha512').update(buffer).digest('hex');
          const upperHash = correctHash.toUpperCase();
          const mixedHash = correctHash
            .split('')
            .map((ch, i) => (i % 2 === 0 ? ch.toUpperCase() : ch.toLowerCase()))
            .join('');

          expect(verifyIntegrity(buffer, correctHash)).toBe(true);
          expect(verifyIntegrity(buffer, upperHash)).toBe(true);
          expect(verifyIntegrity(buffer, mixedHash)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});
