/**
 * Ollama Connectivity Handler
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.0.3
 *
 * Manages connectivity checks to the local Ollama endpoint with retry logic
 * and exponential backoff. Produces diagnostic messages when the endpoint
 * is unreachable after exhausting retry attempts.
 *
 * Requirement 10.4:
 * - Initial connection attempt with 10-second timeout
 * - 3 retry attempts over ~30 seconds with exponential backoff
 * - Pause task session with diagnostic message (endpoint address, attempt count, last error)
 * - Session remains resumable after connectivity restoration
 */

// ─── Constants ───────────────────────────────────────────────────────────────

/** Timeout per connection attempt in milliseconds (10 seconds). */
export const CONNECTION_TIMEOUT_MS = 10_000;

/** Maximum number of retry attempts after the initial attempt. */
export const MAX_RETRY_ATTEMPTS = 3;

/**
 * Backoff delays in milliseconds for each retry attempt.
 * Retry 1: 2s, Retry 2: 8s, Retry 3: 20s (totaling ~30s with attempts).
 */
export const BACKOFF_DELAYS_MS = [2000, 8000, 20000];

/** Health check path appended to the Ollama endpoint. */
export const HEALTH_CHECK_PATH = '/api/tags';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Creates an AbortController with an automatic timeout.
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {{ controller: AbortController, timeoutId: ReturnType<typeof setTimeout> }}
 */
function createTimeoutController(timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return { controller, timeoutId };
}

/**
 * Delays execution for the specified number of milliseconds.
 * @param {number} ms - Delay in milliseconds
 * @param {{ signal?: AbortSignal }} [options] - Optional abort signal to cancel the delay
 * @returns {Promise<void>}
 */
function delay(ms, options = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    if (options.signal) {
      options.signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new Error('Delay aborted'));
      }, { once: true });
    }
  });
}

/**
 * Extracts a user-friendly error message from an error object.
 * @param {Error|unknown} error
 * @returns {string}
 */
function extractErrorMessage(error) {
  if (!error) return 'Unknown error';
  if (error instanceof Error) {
    // Prefer the code for network errors
    if (error.cause && typeof error.cause === 'object' && 'code' in error.cause) {
      const code = /** @type {any} */ (error.cause).code;
      if (code === 'ECONNREFUSED') return 'Connection refused';
      if (code === 'ETIMEDOUT') return 'Connection timed out';
      if (code === 'ECONNRESET') return 'Connection reset';
      if (code === 'ENOTFOUND') return 'Host not found';
      if (code === 'ENETUNREACH') return 'Network unreachable';
      return code;
    }
    if (error.name === 'AbortError') return 'Connection timed out';
    return error.message || 'Unknown error';
  }
  if (typeof error === 'string') return error;
  return 'Unknown error';
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Checks if the Ollama endpoint is reachable by hitting its health check endpoint.
 *
 * Sends a GET request to `${endpoint}/api/tags` with a 10-second timeout.
 *
 * @param {string} endpoint - The Ollama endpoint URL (e.g., 'http://localhost:11434')
 * @param {object} [options]
 * @param {Function} [options.fetchImpl] - Custom fetch implementation (for testing)
 * @param {number} [options.timeoutMs] - Override timeout in milliseconds (default: 10000)
 * @returns {Promise<{ connected: boolean, error?: string }>}
 */
export async function checkOllamaConnectivity(endpoint, options = {}) {
  const fetchFn = options.fetchImpl || globalThis.fetch;
  const timeoutMs = options.timeoutMs || CONNECTION_TIMEOUT_MS;

  const url = `${endpoint.replace(/\/$/, '')}${HEALTH_CHECK_PATH}`;
  const { controller, timeoutId } = createTimeoutController(timeoutMs);

  try {
    const response = await fetchFn(url, {
      method: 'GET',
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      return { connected: true };
    }

    return {
      connected: false,
      error: `HTTP ${response.status}: ${response.statusText || 'Server error'}`
    };
  } catch (err) {
    clearTimeout(timeoutId);
    return {
      connected: false,
      error: extractErrorMessage(err)
    };
  }
}

/**
 * Attempts to connect to the Ollama endpoint with retry logic and exponential backoff.
 *
 * - Initial attempt with 10-second timeout
 * - On failure: up to 3 retries with backoff delays of 2s, 8s, 20s (~30s total)
 * - Returns diagnostic info on final failure for the pause message
 *
 * @param {string} endpoint - The Ollama endpoint URL (e.g., 'http://localhost:11434')
 * @param {object} [options]
 * @param {Function} [options.fetchImpl] - Custom fetch implementation (for testing)
 * @param {number} [options.timeoutMs] - Override timeout per attempt in milliseconds
 * @param {number[]} [options.backoffDelays] - Override backoff delays array
 * @param {Function} [options.delayFn] - Override delay function (for testing)
 * @returns {Promise<{ connected: boolean, attempts: number, lastError?: string, endpoint: string }>}
 */
export async function connectWithRetry(endpoint, options = {}) {
  const backoffDelays = options.backoffDelays || BACKOFF_DELAYS_MS;
  const delayFn = options.delayFn || delay;
  const maxRetries = backoffDelays.length;

  let attempts = 0;
  let lastError = '';

  // Initial attempt (attempt 1)
  attempts++;
  const initialResult = await checkOllamaConnectivity(endpoint, options);
  if (initialResult.connected) {
    return { connected: true, attempts, endpoint };
  }
  lastError = initialResult.error || 'Connection failed';

  // Retry attempts with exponential backoff
  for (let retryIndex = 0; retryIndex < maxRetries; retryIndex++) {
    const backoffMs = backoffDelays[retryIndex];
    await delayFn(backoffMs);

    attempts++;
    const result = await checkOllamaConnectivity(endpoint, options);
    if (result.connected) {
      return { connected: true, attempts, endpoint };
    }
    lastError = result.error || 'Connection failed';
  }

  // All attempts exhausted
  return {
    connected: false,
    attempts,
    lastError,
    endpoint
  };
}

/**
 * Builds a user-friendly diagnostic message from a connectivity result.
 *
 * Includes: endpoint address, number of attempts made, and last error description.
 *
 * @param {{ connected: boolean, attempts: number, lastError?: string, endpoint: string }} result
 * @returns {string}
 */
export function buildDiagnosticMessage(result) {
  if (result.connected) {
    return `Successfully connected to Ollama at ${result.endpoint} after ${result.attempts} attempt${result.attempts > 1 ? 's' : ''}.`;
  }

  const totalTime = estimateTotalTime(result.attempts);
  const lastErr = result.lastError || 'Unknown error';

  return `Could not connect to Ollama at ${result.endpoint}. Made ${result.attempts} attempt${result.attempts > 1 ? 's' : ''} over ${totalTime} seconds. Last error: ${lastErr}.`;
}

/**
 * Estimates the total elapsed time in seconds based on number of attempts.
 * @param {number} attempts
 * @returns {number}
 */
function estimateTotalTime(attempts) {
  // The initial attempt takes up to 10s, then each retry adds its backoff + 10s attempt
  // But we estimate based on the actual backoff delays summed
  let totalMs = 0;
  const retries = Math.max(0, attempts - 1);
  for (let i = 0; i < retries && i < BACKOFF_DELAYS_MS.length; i++) {
    totalMs += BACKOFF_DELAYS_MS[i];
  }
  // Round to nearest whole number of seconds
  return Math.round(totalMs / 1000) || (attempts > 0 ? 10 : 0);
}
