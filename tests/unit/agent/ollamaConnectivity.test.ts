import { describe, expect, it, vi } from 'vitest';
import {
  checkOllamaConnectivity,
  connectWithRetry,
  buildDiagnosticMessage,
  CONNECTION_TIMEOUT_MS,
  MAX_RETRY_ATTEMPTS,
  BACKOFF_DELAYS_MS,
  HEALTH_CHECK_PATH
} from '../../../electron/runtime/agent/ollamaConnectivity.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Creates a mock fetch that resolves successfully.
 */
function createSuccessFetch() {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK'
  });
}

/**
 * Creates a mock fetch that rejects with a connection error.
 */
function createFailingFetch(errorMessage = 'Connection refused', code?: string) {
  const error = new Error(errorMessage);
  if (code) {
    (error as any).cause = { code };
  }
  return vi.fn().mockRejectedValue(error);
}

/**
 * Creates a mock fetch that returns a non-OK HTTP response.
 */
function createHttpErrorFetch(status: number, statusText = 'Server Error') {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    statusText
  });
}

/**
 * Creates a mock fetch that fails N times then succeeds.
 */
function createEventuallySucceedsFetch(failCount: number, errorMessage = 'Connection refused') {
  let calls = 0;
  return vi.fn().mockImplementation(() => {
    calls++;
    if (calls <= failCount) {
      return Promise.reject(new Error(errorMessage));
    }
    return Promise.resolve({ ok: true, status: 200, statusText: 'OK' });
  });
}

/**
 * A delay function that resolves immediately (for testing).
 */
const instantDelay = vi.fn().mockResolvedValue(undefined);

// ─── Unit Tests: checkOllamaConnectivity ─────────────────────────────────────

describe('ollamaConnectivity - checkOllamaConnectivity', () => {
  it('returns connected: true when endpoint responds with 200', async () => {
    const fetchImpl = createSuccessFetch();
    const result = await checkOllamaConnectivity('http://localhost:11434', { fetchImpl });

    expect(result.connected).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('calls the correct health check URL', async () => {
    const fetchImpl = createSuccessFetch();
    await checkOllamaConnectivity('http://localhost:11434', { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:11434/api/tags',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('trims trailing slash from endpoint', async () => {
    const fetchImpl = createSuccessFetch();
    await checkOllamaConnectivity('http://localhost:11434/', { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://localhost:11434/api/tags',
      expect.any(Object)
    );
  });

  it('returns connected: false with error message on connection failure', async () => {
    const fetchImpl = createFailingFetch('fetch failed');
    const result = await checkOllamaConnectivity('http://localhost:11434', { fetchImpl });

    expect(result.connected).toBe(false);
    expect(result.error).toBe('fetch failed');
  });

  it('returns connected: false on non-OK HTTP response', async () => {
    const fetchImpl = createHttpErrorFetch(500, 'Internal Server Error');
    const result = await checkOllamaConnectivity('http://localhost:11434', { fetchImpl });

    expect(result.connected).toBe(false);
    expect(result.error).toContain('500');
  });

  it('extracts ECONNREFUSED error as "Connection refused"', async () => {
    const error = new Error('fetch failed');
    (error as any).cause = { code: 'ECONNREFUSED' };
    const fetchImpl = vi.fn().mockRejectedValue(error);

    const result = await checkOllamaConnectivity('http://localhost:11434', { fetchImpl });

    expect(result.connected).toBe(false);
    expect(result.error).toBe('Connection refused');
  });

  it('extracts AbortError as "Connection timed out"', async () => {
    const error = new Error('The operation was aborted');
    error.name = 'AbortError';
    const fetchImpl = vi.fn().mockRejectedValue(error);

    const result = await checkOllamaConnectivity('http://localhost:11434', { fetchImpl });

    expect(result.connected).toBe(false);
    expect(result.error).toBe('Connection timed out');
  });

  it('passes an AbortSignal for timeout control', async () => {
    const fetchImpl = createSuccessFetch();
    await checkOllamaConnectivity('http://localhost:11434', { fetchImpl, timeoutMs: 5000 });

    const callArgs = fetchImpl.mock.calls[0];
    expect(callArgs[1]).toHaveProperty('signal');
    expect(callArgs[1].signal).toBeInstanceOf(AbortSignal);
  });
});

// ─── Unit Tests: connectWithRetry ────────────────────────────────────────────

describe('ollamaConnectivity - connectWithRetry', () => {
  it('returns immediately on successful first attempt', async () => {
    const fetchImpl = createSuccessFetch();
    const delayFn = vi.fn();

    const result = await connectWithRetry('http://localhost:11434', {
      fetchImpl,
      delayFn
    });

    expect(result.connected).toBe(true);
    expect(result.attempts).toBe(1);
    expect(result.endpoint).toBe('http://localhost:11434');
    expect(delayFn).not.toHaveBeenCalled();
  });

  it('retries up to 3 times on failure with exponential backoff delays', async () => {
    const fetchImpl = createFailingFetch('Connection refused');
    const delayFn = vi.fn().mockResolvedValue(undefined);

    const result = await connectWithRetry('http://localhost:11434', {
      fetchImpl,
      delayFn
    });

    expect(result.connected).toBe(false);
    expect(result.attempts).toBe(4); // 1 initial + 3 retries
    expect(result.lastError).toBe('Connection refused');
    expect(result.endpoint).toBe('http://localhost:11434');

    // Verify backoff delays
    expect(delayFn).toHaveBeenCalledTimes(3);
    expect(delayFn).toHaveBeenNthCalledWith(1, 2000);
    expect(delayFn).toHaveBeenNthCalledWith(2, 8000);
    expect(delayFn).toHaveBeenNthCalledWith(3, 20000);
  });

  it('succeeds on second attempt after one failure', async () => {
    const fetchImpl = createEventuallySucceedsFetch(1);
    const delayFn = vi.fn().mockResolvedValue(undefined);

    const result = await connectWithRetry('http://localhost:11434', {
      fetchImpl,
      delayFn
    });

    expect(result.connected).toBe(true);
    expect(result.attempts).toBe(2);
    expect(delayFn).toHaveBeenCalledTimes(1);
    expect(delayFn).toHaveBeenCalledWith(2000);
  });

  it('succeeds on third attempt after two failures', async () => {
    const fetchImpl = createEventuallySucceedsFetch(2);
    const delayFn = vi.fn().mockResolvedValue(undefined);

    const result = await connectWithRetry('http://localhost:11434', {
      fetchImpl,
      delayFn
    });

    expect(result.connected).toBe(true);
    expect(result.attempts).toBe(3);
    expect(delayFn).toHaveBeenCalledTimes(2);
  });

  it('succeeds on fourth attempt after three failures', async () => {
    const fetchImpl = createEventuallySucceedsFetch(3);
    const delayFn = vi.fn().mockResolvedValue(undefined);

    const result = await connectWithRetry('http://localhost:11434', {
      fetchImpl,
      delayFn
    });

    expect(result.connected).toBe(true);
    expect(result.attempts).toBe(4);
    expect(delayFn).toHaveBeenCalledTimes(3);
  });

  it('returns diagnostic info after all retries are exhausted', async () => {
    const fetchImpl = createFailingFetch('ECONNREFUSED');
    const delayFn = vi.fn().mockResolvedValue(undefined);

    const result = await connectWithRetry('http://localhost:11434', {
      fetchImpl,
      delayFn
    });

    expect(result.connected).toBe(false);
    expect(result.attempts).toBe(4);
    expect(result.lastError).toBeDefined();
    expect(result.endpoint).toBe('http://localhost:11434');
  });

  it('tracks the last error from the most recent failed attempt', async () => {
    let callCount = 0;
    const fetchImpl = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.reject(new Error('First error'));
      if (callCount === 2) return Promise.reject(new Error('Second error'));
      if (callCount === 3) return Promise.reject(new Error('Third error'));
      return Promise.reject(new Error('Fourth error'));
    });
    const delayFn = vi.fn().mockResolvedValue(undefined);

    const result = await connectWithRetry('http://localhost:11434', {
      fetchImpl,
      delayFn
    });

    expect(result.lastError).toBe('Fourth error');
  });

  it('makes exactly 4 fetch calls when all attempts fail (1 initial + 3 retries)', async () => {
    const fetchImpl = createFailingFetch('Unreachable');
    const delayFn = vi.fn().mockResolvedValue(undefined);

    await connectWithRetry('http://localhost:11434', { fetchImpl, delayFn });

    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('respects custom backoff delays', async () => {
    const fetchImpl = createFailingFetch('Refused');
    const delayFn = vi.fn().mockResolvedValue(undefined);
    const customDelays = [100, 200];

    const result = await connectWithRetry('http://localhost:11434', {
      fetchImpl,
      delayFn,
      backoffDelays: customDelays
    });

    // 1 initial + 2 retries (based on customDelays length)
    expect(result.attempts).toBe(3);
    expect(delayFn).toHaveBeenCalledTimes(2);
    expect(delayFn).toHaveBeenNthCalledWith(1, 100);
    expect(delayFn).toHaveBeenNthCalledWith(2, 200);
  });
});

// ─── Unit Tests: buildDiagnosticMessage ──────────────────────────────────────

describe('ollamaConnectivity - buildDiagnosticMessage', () => {
  it('includes endpoint address in the message', () => {
    const message = buildDiagnosticMessage({
      connected: false,
      attempts: 4,
      lastError: 'Connection refused',
      endpoint: 'http://localhost:11434'
    });

    expect(message).toContain('http://localhost:11434');
  });

  it('includes attempt count in the message', () => {
    const message = buildDiagnosticMessage({
      connected: false,
      attempts: 4,
      lastError: 'Connection refused',
      endpoint: 'http://localhost:11434'
    });

    expect(message).toContain('4 attempts');
  });

  it('includes last error description in the message', () => {
    const message = buildDiagnosticMessage({
      connected: false,
      attempts: 4,
      lastError: 'Connection refused',
      endpoint: 'http://localhost:11434'
    });

    expect(message).toContain('Connection refused');
  });

  it('includes estimated total time in seconds', () => {
    const message = buildDiagnosticMessage({
      connected: false,
      attempts: 4,
      lastError: 'Timeout',
      endpoint: 'http://localhost:11434'
    });

    expect(message).toContain('30 seconds');
  });

  it('generates a success message when connected is true', () => {
    const message = buildDiagnosticMessage({
      connected: true,
      attempts: 2,
      endpoint: 'http://localhost:11434'
    });

    expect(message).toContain('Successfully connected');
    expect(message).toContain('http://localhost:11434');
  });

  it('handles single attempt in message', () => {
    const message = buildDiagnosticMessage({
      connected: false,
      attempts: 1,
      lastError: 'Timeout',
      endpoint: 'http://myserver:11434'
    });

    expect(message).toContain('1 attempt');
    expect(message).toContain('http://myserver:11434');
    expect(message).toContain('Timeout');
  });

  it('handles missing lastError gracefully', () => {
    const message = buildDiagnosticMessage({
      connected: false,
      attempts: 4,
      endpoint: 'http://localhost:11434'
    });

    expect(message).toContain('Unknown error');
  });

  it('produces expected format for typical failure scenario', () => {
    const message = buildDiagnosticMessage({
      connected: false,
      attempts: 4,
      lastError: 'Connection refused',
      endpoint: 'http://localhost:11434'
    });

    expect(message).toBe(
      'Could not connect to Ollama at http://localhost:11434. Made 4 attempts over 30 seconds. Last error: Connection refused.'
    );
  });
});

// ─── Constants Exported Correctly ────────────────────────────────────────────

describe('ollamaConnectivity - exported constants', () => {
  it('CONNECTION_TIMEOUT_MS is 10 seconds', () => {
    expect(CONNECTION_TIMEOUT_MS).toBe(10_000);
  });

  it('MAX_RETRY_ATTEMPTS is 3', () => {
    expect(MAX_RETRY_ATTEMPTS).toBe(3);
  });

  it('BACKOFF_DELAYS_MS sums to approximately 30 seconds', () => {
    const totalBackoff = BACKOFF_DELAYS_MS.reduce((sum, d) => sum + d, 0);
    expect(totalBackoff).toBe(30000);
  });

  it('HEALTH_CHECK_PATH is /api/tags', () => {
    expect(HEALTH_CHECK_PATH).toBe('/api/tags');
  });
});
