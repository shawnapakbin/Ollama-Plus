import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { classifyFetchFailure } from '../electron/runtime/ollamaClient.js';

/**
 * Feature: ollama-lifecycle-management
 * Property tests for fetch-failure classification.
 */

// Connection-class codes recognized by classifyFetchFailure.
const REFUSED_CODES = ['ECONNREFUSED'];
const DNS_CODES = ['ENOTFOUND', 'EAI_AGAIN'];
const OTHER_CONNECTION_CODES = [
  'ECONNRESET',
  'ECONNABORTED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ETIMEDOUT',
  'EPIPE',
];
const CONNECTION_CODES = [...REFUSED_CODES, ...DNS_CODES, ...OTHER_CONNECTION_CODES];

// A pool of codes that are NOT connection-class codes.
const NON_CONNECTION_CODES = [
  'EACCES',
  'ENOENT',
  'EEXIST',
  'EISDIR',
  'EPERM',
  'ERANGE',
  'UNKNOWN',
  'ERR_INVALID_ARG',
  '',
];

describe('Property 3: Only transport failures are attributed to unreachability', () => {
  // Feature: ollama-lifecycle-management, Property 3: Only transport failures are attributed to unreachability
  /**
   * Validates: Requirements 7.1, 7.3
   *
   * classifyFetchFailure returns `unreachable: true` iff the error is an
   * AbortError or its `cause.code` is a connection-class code; a resolved HTTP
   * error status is never classified as unreachable.
   */

  it('classifies AbortError as unreachable with reason timeout', () => {
    fc.assert(
      fc.property(fc.string(), (message) => {
        const error = new Error(message);
        error.name = 'AbortError';
        const result = classifyFetchFailure(error);
        expect(result.unreachable).toBe(true);
        expect(result.reason).toBe('timeout');
      }),
      { numRuns: 100 }
    );
  });

  it('classifies connection-class cause.code errors as unreachable with the correct reason', () => {
    fc.assert(
      fc.property(fc.constantFrom(...CONNECTION_CODES), fc.string(), (code, message) => {
        const error = new Error(message);
        error.cause = { code };
        const result = classifyFetchFailure(error);

        expect(result.unreachable).toBe(true);
        if (REFUSED_CODES.includes(code)) {
          expect(result.reason).toBe('refused');
        } else if (DNS_CODES.includes(code)) {
          expect(result.reason).toBe('dns');
        } else {
          expect(result.reason).toBe('other');
        }
      }),
      { numRuns: 100 }
    );
  });

  it('classifies non-connection cause.code errors as reachable (unreachable: false)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...NON_CONNECTION_CODES), fc.string(), (code, message) => {
        const error = new Error(message);
        error.cause = { code };
        const result = classifyFetchFailure(error);

        expect(result.unreachable).toBe(false);
        expect(result.reason).toBeUndefined();
      }),
      { numRuns: 100 }
    );
  });

  it('never attributes a resolved HTTP error status to unreachability', () => {
    // A reachable server that returns an error status surfaces as a plain
    // Error (from readJson) with no AbortError name and no connection cause.code.
    fc.assert(
      fc.property(
        fc.integer({ min: 400, max: 599 }),
        fc.string(),
        (status, statusText) => {
          const error = new Error(`Ollama request failed: ${status} ${statusText}`);
          // Optionally carry the status, but never a connection cause.code.
          error.status = status;
          const result = classifyFetchFailure(error);

          expect(result.unreachable).toBe(false);
          expect(result.reason).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('is total: never throws and always returns unreachable: false for arbitrary non-connection errors', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.anything(),
          fc.record({
            name: fc.string(),
            message: fc.string(),
            cause: fc.oneof(
              fc.constant(undefined),
              fc.constant(null),
              fc.anything(),
              fc.record({ code: fc.constantFrom(...NON_CONNECTION_CODES) })
            ),
          })
        ),
        (input) => {
          let result;
          expect(() => {
            result = classifyFetchFailure(input);
          }).not.toThrow();

          expect(typeof result.unreachable).toBe('boolean');

          const isAbort =
            input && typeof input === 'object' && input.name === 'AbortError';
          const code =
            input && typeof input === 'object' && input.cause && typeof input.cause === 'object'
              ? input.cause.code
              : undefined;
          const isConnection =
            typeof code === 'string' && CONNECTION_CODES.includes(code);

          if (!isAbort && !isConnection) {
            expect(result.unreachable).toBe(false);
            expect(result.reason).toBeUndefined();
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
