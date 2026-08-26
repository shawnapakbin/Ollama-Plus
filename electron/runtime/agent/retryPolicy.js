/**
 * Retry Policy Engine
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.0.3
 *
 * Classifies tool errors as transient or permanent and determines retry
 * decisions with exponential backoff. Only transient errors are retried;
 * permanent errors are reported immediately.
 *
 * Backoff schedule: 2s (first retry), 8s (second retry).
 * Maximum 2 additional retry attempts per tool call.
 */

// ─── Constants ───────────────────────────────────────────────────────────────

/** Maximum number of additional retry attempts for transient errors. */
export const MAX_RETRIES = 2;

/** Backoff delay for the first retry attempt in milliseconds. */
export const FIRST_RETRY_DELAY_MS = 2000;

/** Backoff delay for the second retry attempt in milliseconds. */
export const SECOND_RETRY_DELAY_MS = 8000;

/**
 * Error codes classified as transient (eligible for retry).
 */
export const TRANSIENT_ERROR_CODES = new Set([
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'EPIPE',
  'EAI_AGAIN',
  'TIMEOUT',
  'RATE_LIMIT'
]);

/**
 * Error codes classified as permanent (never retried).
 */
export const PERMANENT_ERROR_CODES = new Set([
  'ENOENT',
  'EACCES',
  'EPERM',
  'EINVAL',
  'ENOTDIR',
  'EISDIR',
  'EEXIST',
  'ENOTEMPTY',
  'ENAMETOOLONG',
  'AUTH_FAILURE',
  'INVALID_PARAMS',
  'MALFORMED_REQUEST',
  'SCHEMA_VIOLATION'
]);

// ─── JSDoc Types ─────────────────────────────────────────────────────────────

/**
 * @typedef {Object} ToolError
 * @property {string} tool - The tool that produced the error
 * @property {string} action - The action that was attempted
 * @property {string} message - Human-readable error description
 * @property {string|null} code - Error code (e.g., 'ETIMEDOUT', 'ENOENT')
 * @property {number|null} httpStatus - HTTP status code if applicable
 */

/**
 * @typedef {{ action: 'retry'; delay: number }
 *         | { action: 'skip'; reason: string }
 *         | { action: 'replan'; reason: string }
 *         | { action: 'halt'; reason: string }} RetryDecision
 */

// ─── Error Classification ────────────────────────────────────────────────────

/**
 * Classifies a tool error as 'transient' or 'permanent'.
 *
 * Transient errors are recoverable (network issues, timeouts, rate limits, 5xx).
 * Permanent errors indicate a fundamental problem that retrying will not solve.
 *
 * Classification rules (in priority order):
 * 1. Known permanent error codes → permanent
 * 2. Known transient error codes → transient
 * 3. HTTP 429 (rate limit) → transient
 * 4. HTTP 5xx (server error) → transient
 * 5. HTTP 4xx (client error, except 429) → permanent
 * 6. Message-based heuristics for timeout/connection keywords → transient
 * 7. Default → permanent (fail-safe: do not retry unknown errors)
 *
 * @param {ToolError} error
 * @returns {'transient' | 'permanent'}
 */
export function classifyError(error) {
  if (!error || typeof error !== 'object') {
    return 'permanent';
  }

  const code = error.code;
  const httpStatus = error.httpStatus;
  const message = (error.message || '').toLowerCase();

  // Check explicit error codes first
  if (code && PERMANENT_ERROR_CODES.has(code)) {
    return 'permanent';
  }

  if (code && TRANSIENT_ERROR_CODES.has(code)) {
    return 'transient';
  }

  // HTTP status-based classification
  if (typeof httpStatus === 'number') {
    if (httpStatus === 429) {
      return 'transient';
    }
    if (httpStatus >= 500 && httpStatus < 600) {
      return 'transient';
    }
    if (httpStatus >= 400 && httpStatus < 500) {
      return 'permanent';
    }
  }

  // Message-based heuristics for common transient patterns
  if (
    message.includes('timeout') ||
    message.includes('timed out') ||
    message.includes('connection reset') ||
    message.includes('connection refused') ||
    message.includes('network') ||
    message.includes('rate limit') ||
    message.includes('too many requests') ||
    message.includes('service unavailable') ||
    message.includes('bad gateway') ||
    message.includes('gateway timeout')
  ) {
    return 'transient';
  }

  // Message-based heuristics for common permanent patterns
  if (
    message.includes('not found') ||
    message.includes('permission denied') ||
    message.includes('access denied') ||
    message.includes('unauthorized') ||
    message.includes('forbidden') ||
    message.includes('invalid') ||
    message.includes('malformed') ||
    message.includes('authentication')
  ) {
    return 'permanent';
  }

  // Default: treat unknown errors as permanent (fail-safe)
  return 'permanent';
}

// ─── Backoff Delay ───────────────────────────────────────────────────────────

/**
 * Returns the backoff delay in milliseconds for the given attempt number.
 *
 * Attempt 1: 2000 ms
 * Attempt 2: 8000 ms
 * Attempts beyond 2 return 8000 ms (capped), though shouldRetry will reject them.
 *
 * @param {number} attemptCount - The retry attempt number (1-indexed: 1 = first retry, 2 = second retry)
 * @returns {number} Delay in milliseconds
 */
export function getBackoffDelay(attemptCount) {
  if (typeof attemptCount !== 'number' || !Number.isFinite(attemptCount) || attemptCount < 1) {
    return FIRST_RETRY_DELAY_MS;
  }

  if (attemptCount === 1) {
    return FIRST_RETRY_DELAY_MS;
  }

  // Second and beyond (capped at second retry delay)
  return SECOND_RETRY_DELAY_MS;
}

// ─── Retry Decision ──────────────────────────────────────────────────────────

/**
 * Determines whether and how to retry a failed tool call.
 *
 * Decision logic:
 * - Permanent errors → never retry, return 'replan' decision
 * - Transient errors within retry budget → retry with backoff delay
 * - Transient errors at retry exhaustion → return 'replan' decision
 *
 * @param {ToolError} error - The tool error that occurred
 * @param {number} attemptCount - Number of attempts already made (0 = initial attempt, 1 = first retry done, etc.)
 * @param {number} [maxRetries=2] - Maximum number of additional retry attempts allowed
 * @returns {RetryDecision}
 */
export function shouldRetry(error, attemptCount, maxRetries = MAX_RETRIES) {
  const classification = classifyError(error);

  // Permanent errors: never retry
  if (classification === 'permanent') {
    return {
      action: 'replan',
      reason: `Permanent error (${error?.code || error?.message || 'unknown'}): not eligible for retry.`
    };
  }

  // Transient errors: check retry budget
  if (typeof attemptCount !== 'number' || attemptCount < 0) {
    attemptCount = 0;
  }

  if (typeof maxRetries !== 'number' || maxRetries < 0) {
    maxRetries = MAX_RETRIES;
  }

  if (attemptCount >= maxRetries) {
    return {
      action: 'replan',
      reason: `Transient error persisted after ${attemptCount} retries: escalating to replan.`
    };
  }

  // Retry with backoff
  const nextAttempt = attemptCount + 1;
  const delay = getBackoffDelay(nextAttempt);

  return {
    action: 'retry',
    delay
  };
}
