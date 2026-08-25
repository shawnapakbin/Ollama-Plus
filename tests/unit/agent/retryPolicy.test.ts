import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  classifyError,
  getBackoffDelay,
  shouldRetry,
  MAX_RETRIES,
  FIRST_RETRY_DELAY_MS,
  SECOND_RETRY_DELAY_MS,
  TRANSIENT_ERROR_CODES,
  PERMANENT_ERROR_CODES
} from '../../../electron/runtime/agent/retryPolicy.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface ToolError {
  tool: string;
  action: string;
  message: string;
  code: string | null;
  httpStatus: number | null;
}

function makeError(overrides: Partial<ToolError> = {}): ToolError {
  return {
    tool: 'terminal',
    action: 'execute',
    message: 'Something went wrong',
    code: null,
    httpStatus: null,
    ...overrides
  };
}

// ─── Unit Tests: classifyError ───────────────────────────────────────────────

describe('retryPolicy - classifyError', () => {
  it('classifies ETIMEDOUT as transient', () => {
    expect(classifyError(makeError({ code: 'ETIMEDOUT' }))).toBe('transient');
  });

  it('classifies ECONNRESET as transient', () => {
    expect(classifyError(makeError({ code: 'ECONNRESET' }))).toBe('transient');
  });

  it('classifies ECONNREFUSED as transient', () => {
    expect(classifyError(makeError({ code: 'ECONNREFUSED' }))).toBe('transient');
  });

  it('classifies TIMEOUT as transient', () => {
    expect(classifyError(makeError({ code: 'TIMEOUT' }))).toBe('transient');
  });

  it('classifies RATE_LIMIT as transient', () => {
    expect(classifyError(makeError({ code: 'RATE_LIMIT' }))).toBe('transient');
  });

  it('classifies ENOENT as permanent', () => {
    expect(classifyError(makeError({ code: 'ENOENT' }))).toBe('permanent');
  });

  it('classifies EACCES as permanent', () => {
    expect(classifyError(makeError({ code: 'EACCES' }))).toBe('permanent');
  });

  it('classifies EINVAL as permanent', () => {
    expect(classifyError(makeError({ code: 'EINVAL' }))).toBe('permanent');
  });

  it('classifies AUTH_FAILURE as permanent', () => {
    expect(classifyError(makeError({ code: 'AUTH_FAILURE' }))).toBe('permanent');
  });

  it('classifies INVALID_PARAMS as permanent', () => {
    expect(classifyError(makeError({ code: 'INVALID_PARAMS' }))).toBe('permanent');
  });

  it('classifies HTTP 429 as transient', () => {
    expect(classifyError(makeError({ httpStatus: 429 }))).toBe('transient');
  });

  it('classifies HTTP 500 as transient', () => {
    expect(classifyError(makeError({ httpStatus: 500 }))).toBe('transient');
  });

  it('classifies HTTP 502 as transient', () => {
    expect(classifyError(makeError({ httpStatus: 502 }))).toBe('transient');
  });

  it('classifies HTTP 503 as transient', () => {
    expect(classifyError(makeError({ httpStatus: 503 }))).toBe('transient');
  });

  it('classifies HTTP 504 as transient', () => {
    expect(classifyError(makeError({ httpStatus: 504 }))).toBe('transient');
  });

  it('classifies HTTP 400 as permanent', () => {
    expect(classifyError(makeError({ httpStatus: 400 }))).toBe('permanent');
  });

  it('classifies HTTP 401 as permanent', () => {
    expect(classifyError(makeError({ httpStatus: 401 }))).toBe('permanent');
  });

  it('classifies HTTP 403 as permanent', () => {
    expect(classifyError(makeError({ httpStatus: 403 }))).toBe('permanent');
  });

  it('classifies HTTP 404 as permanent', () => {
    expect(classifyError(makeError({ httpStatus: 404 }))).toBe('permanent');
  });

  it('classifies timeout-related messages as transient', () => {
    expect(classifyError(makeError({ message: 'Operation timed out' }))).toBe('transient');
    expect(classifyError(makeError({ message: 'Request timeout after 30s' }))).toBe('transient');
  });

  it('classifies connection-related messages as transient', () => {
    expect(classifyError(makeError({ message: 'Connection reset by peer' }))).toBe('transient');
    expect(classifyError(makeError({ message: 'Connection refused to localhost:11434' }))).toBe('transient');
  });

  it('classifies rate limit messages as transient', () => {
    expect(classifyError(makeError({ message: 'Rate limit exceeded' }))).toBe('transient');
    expect(classifyError(makeError({ message: 'Too many requests' }))).toBe('transient');
  });

  it('classifies not-found messages as permanent', () => {
    expect(classifyError(makeError({ message: 'File not found: config.json' }))).toBe('permanent');
  });

  it('classifies permission messages as permanent', () => {
    expect(classifyError(makeError({ message: 'Permission denied: /etc/shadow' }))).toBe('permanent');
  });

  it('classifies invalid messages as permanent', () => {
    expect(classifyError(makeError({ message: 'Invalid parameter format' }))).toBe('permanent');
  });

  it('defaults unknown errors to permanent', () => {
    expect(classifyError(makeError({ message: 'Something bizarre happened' }))).toBe('permanent');
  });

  it('handles null/undefined error gracefully', () => {
    expect(classifyError(null as any)).toBe('permanent');
    expect(classifyError(undefined as any)).toBe('permanent');
  });

  it('prioritizes permanent code over transient message', () => {
    // ENOENT is permanent even if message mentions timeout
    expect(classifyError(makeError({ code: 'ENOENT', message: 'timeout reading file not found' }))).toBe('permanent');
  });

  it('prioritizes transient code over permanent message', () => {
    // ETIMEDOUT is transient even if message mentions "not found"
    expect(classifyError(makeError({ code: 'ETIMEDOUT', message: 'server not found' }))).toBe('transient');
  });
});

// ─── Unit Tests: getBackoffDelay ─────────────────────────────────────────────

describe('retryPolicy - getBackoffDelay', () => {
  it('returns 2000ms for first retry attempt', () => {
    expect(getBackoffDelay(1)).toBe(2000);
  });

  it('returns 8000ms for second retry attempt', () => {
    expect(getBackoffDelay(2)).toBe(8000);
  });

  it('returns 8000ms for attempts beyond 2 (capped)', () => {
    expect(getBackoffDelay(3)).toBe(8000);
    expect(getBackoffDelay(10)).toBe(8000);
  });

  it('returns 2000ms for invalid attempt numbers', () => {
    expect(getBackoffDelay(0)).toBe(2000);
    expect(getBackoffDelay(-1)).toBe(2000);
    expect(getBackoffDelay(NaN)).toBe(2000);
  });
});

// ─── Unit Tests: shouldRetry ─────────────────────────────────────────────────

describe('retryPolicy - shouldRetry', () => {
  it('retries transient error on first attempt with 2s delay', () => {
    const error = makeError({ code: 'ETIMEDOUT' });
    const decision = shouldRetry(error, 0);
    expect(decision).toEqual({ action: 'retry', delay: 2000 });
  });

  it('retries transient error on second attempt with 8s delay', () => {
    const error = makeError({ code: 'ECONNRESET' });
    const decision = shouldRetry(error, 1);
    expect(decision).toEqual({ action: 'retry', delay: 8000 });
  });

  it('escalates to replan when retries exhausted for transient error', () => {
    const error = makeError({ code: 'ETIMEDOUT' });
    const decision = shouldRetry(error, 2);
    expect(decision.action).toBe('replan');
    expect((decision as any).reason).toContain('replan');
  });

  it('never retries permanent errors', () => {
    const error = makeError({ code: 'ENOENT' });
    const decision = shouldRetry(error, 0);
    expect(decision.action).toBe('replan');
    expect((decision as any).reason).toContain('Permanent');
  });

  it('never retries permanent HTTP status errors', () => {
    const error = makeError({ httpStatus: 404 });
    const decision = shouldRetry(error, 0);
    expect(decision.action).toBe('replan');
  });

  it('retries HTTP 5xx transient errors', () => {
    const error = makeError({ httpStatus: 503 });
    const decision = shouldRetry(error, 0);
    expect(decision).toEqual({ action: 'retry', delay: 2000 });
  });

  it('retries HTTP 429 rate limit errors', () => {
    const error = makeError({ httpStatus: 429 });
    const decision = shouldRetry(error, 0);
    expect(decision).toEqual({ action: 'retry', delay: 2000 });
  });

  it('respects custom maxRetries parameter', () => {
    const error = makeError({ code: 'ETIMEDOUT' });

    // With maxRetries=1, one retry is allowed (attempt 0), but not at attempt 1
    expect(shouldRetry(error, 0, 1)).toEqual({ action: 'retry', delay: 2000 });
    expect(shouldRetry(error, 1, 1).action).toBe('replan');
  });

  it('respects maxRetries=0 (no retries)', () => {
    const error = makeError({ code: 'ECONNRESET' });
    const decision = shouldRetry(error, 0, 0);
    expect(decision.action).toBe('replan');
  });

  it('handles negative attemptCount gracefully', () => {
    const error = makeError({ code: 'ETIMEDOUT' });
    const decision = shouldRetry(error, -1);
    expect(decision).toEqual({ action: 'retry', delay: 2000 });
  });
});

// ─── Property-Based Tests: Property 9 ───────────────────────────────────────

describe('retryPolicy - Property 9: Retry policy with exponential backoff', () => {
  /**
   * **Validates: Requirements 4.5, 10.1, 10.5**
   *
   * For any transient error, the Retry Policy SHALL attempt at most 2
   * additional retries with delays of 2 seconds (first retry) and 8 seconds
   * (second retry). Permanent errors SHALL never be retried.
   */

  // Arbitraries for generating tool errors
  const transientCodeArb = fc.constantFrom(...Array.from(TRANSIENT_ERROR_CODES));
  const permanentCodeArb = fc.constantFrom(...Array.from(PERMANENT_ERROR_CODES));
  const http5xxArb = fc.integer({ min: 500, max: 599 });
  const http4xxExcept429Arb = fc.integer({ min: 400, max: 428 });
  const toolNameArb = fc.constantFrom('terminal', 'folder', 'browser', 'python', 'http');
  const actionArb = fc.constantFrom('execute', 'read', 'write', 'navigate', 'run');
  const messageArb = fc.string({ minLength: 1, maxLength: 200 });

  const transientErrorArb = fc.oneof(
    // Transient by code
    fc.record({
      tool: toolNameArb,
      action: actionArb,
      message: messageArb,
      code: transientCodeArb,
      httpStatus: fc.constant(null)
    }),
    // Transient by HTTP 5xx
    fc.record({
      tool: toolNameArb,
      action: actionArb,
      message: messageArb,
      code: fc.constant(null),
      httpStatus: http5xxArb
    }),
    // Transient by HTTP 429
    fc.record({
      tool: toolNameArb,
      action: actionArb,
      message: messageArb,
      code: fc.constant(null),
      httpStatus: fc.constant(429)
    })
  );

  const permanentErrorArb = fc.oneof(
    // Permanent by code
    fc.record({
      tool: toolNameArb,
      action: actionArb,
      message: messageArb,
      code: permanentCodeArb,
      httpStatus: fc.constant(null)
    }),
    // Permanent by HTTP 4xx (except 429)
    fc.record({
      tool: toolNameArb,
      action: actionArb,
      message: messageArb,
      code: fc.constant(null),
      httpStatus: http4xxExcept429Arb
    })
  );

  it('classifies all known transient error codes as transient', () => {
    fc.assert(
      fc.property(transientErrorArb, (error) => {
        expect(classifyError(error)).toBe('transient');
      }),
      { numRuns: 100 }
    );
  });

  it('classifies all known permanent error codes as permanent', () => {
    fc.assert(
      fc.property(permanentErrorArb, (error) => {
        expect(classifyError(error)).toBe('permanent');
      }),
      { numRuns: 100 }
    );
  });

  it('transient errors are retried at most 2 times', () => {
    fc.assert(
      fc.property(
        transientErrorArb,
        fc.integer({ min: 0, max: 10 }),
        (error, attemptCount) => {
          const decision = shouldRetry(error, attemptCount);
          if (attemptCount < MAX_RETRIES) {
            expect(decision.action).toBe('retry');
          } else {
            expect(decision.action).not.toBe('retry');
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('first retry delay is always 2000ms for transient errors', () => {
    fc.assert(
      fc.property(transientErrorArb, (error) => {
        const decision = shouldRetry(error, 0);
        expect(decision).toEqual({ action: 'retry', delay: FIRST_RETRY_DELAY_MS });
      }),
      { numRuns: 100 }
    );
  });

  it('second retry delay is always 8000ms for transient errors', () => {
    fc.assert(
      fc.property(transientErrorArb, (error) => {
        const decision = shouldRetry(error, 1);
        expect(decision).toEqual({ action: 'retry', delay: SECOND_RETRY_DELAY_MS });
      }),
      { numRuns: 100 }
    );
  });

  it('permanent errors are never retried regardless of attempt count', () => {
    fc.assert(
      fc.property(
        permanentErrorArb,
        fc.integer({ min: 0, max: 10 }),
        (error, attemptCount) => {
          const decision = shouldRetry(error, attemptCount);
          expect(decision.action).not.toBe('retry');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('backoff delay is strictly increasing: delay(1) < delay(2)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100 }),
        () => {
          const firstDelay = getBackoffDelay(1);
          const secondDelay = getBackoffDelay(2);
          expect(firstDelay).toBeLessThan(secondDelay);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('retry budget is exactly MAX_RETRIES for any transient error', () => {
    fc.assert(
      fc.property(transientErrorArb, (error) => {
        // Count how many retries are granted
        let retryCount = 0;
        for (let attempt = 0; attempt < 10; attempt++) {
          const decision = shouldRetry(error, attempt);
          if (decision.action === 'retry') {
            retryCount++;
          } else {
            break;
          }
        }
        expect(retryCount).toBe(MAX_RETRIES);
      }),
      { numRuns: 100 }
    );
  });
});
