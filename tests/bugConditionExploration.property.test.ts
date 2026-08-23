import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { appendMessage, createSession } from '../electron/runtime/runtimeStore.js';

/**
 * Bug Condition Exploration Tests
 * 
 * These tests encode the EXPECTED (correct) behavior for three bugs.
 * They are written BEFORE any fix is implemented and are EXPECTED TO FAIL
 * on unfixed code, confirming each bug exists.
 * 
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
 */

// ─── Test Infrastructure ─────────────────────────────────────────────────────

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

function createTempStatePath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-plus-bug-exploration-'));
  tempDirs.push(dir);
  return path.join(dir, 'state.json');
}

function setupSessionForTest(statePath: string): string {
  const session = createSession(statePath, 'Test Session', {
    idFactory: () => 'test-session-id',
    now: '2025-01-01T00:00:00.000Z'
  });
  return session.id;
}

// ─── Arbitraries (Generators) ────────────────────────────────────────────────

/** Generate valid RuntimeChatMetrics with non-negative finite numbers */
const validMetricsArbitrary = fc.record({
  totalDuration: fc.nat({ max: 60_000_000_000 }),   // up to 60s in nanoseconds
  loadDuration: fc.nat({ max: 10_000_000_000 }),    // up to 10s in nanoseconds
  promptEvalCount: fc.nat({ max: 10_000 }),          // reasonable token counts
  promptEvalDuration: fc.nat({ max: 30_000_000_000 }),
  evalCount: fc.nat({ max: 10_000 }),
  evalDuration: fc.nat({ max: 60_000_000_000 })
});

/** Generate metrics with a mix of valid numbers and invalid values (NaN, Infinity) */
const mixedMetricsArbitrary = fc.record({
  totalDuration: fc.oneof(fc.nat(), fc.constant(NaN), fc.constant(Infinity)),
  loadDuration: fc.oneof(fc.nat(), fc.constant(NaN), fc.constant(Infinity)),
  promptEvalCount: fc.oneof(fc.nat(), fc.constant(NaN), fc.constant(Infinity)),
  promptEvalDuration: fc.oneof(fc.nat(), fc.constant(NaN), fc.constant(Infinity)),
  evalCount: fc.oneof(fc.nat(), fc.constant(NaN), fc.constant(Infinity)),
  evalDuration: fc.oneof(fc.nat(), fc.constant(NaN), fc.constant(Infinity))
});

// ═══════════════════════════════════════════════════════════════════════════════
// BUG 1: Metrics Not Persisted
// ═══════════════════════════════════════════════════════════════════════════════

describe('Bug 1 Exploration: Metrics Persistence', () => {
  /**
   * **Validates: Requirements 2.1, 2.2**
   * 
   * Bug Condition: When appendMessage is called with an assistant message that
   * includes a non-null metrics object, the metrics SHOULD be persisted.
   * 
   * On UNFIXED code: appendMessage omits `metrics: input.metrics` from the object
   * passed to normalizeMessage, so result.metrics is always null.
   * 
   * EXPECTED: This test FAILS on unfixed code (confirming the bug exists).
   */

  it('appendMessage with valid metrics should persist non-null metrics (PBT)', () => {
    fc.assert(
      fc.property(
        validMetricsArbitrary,
        fc.string({ minLength: 1, maxLength: 200 }),
        (metrics, content) => {
          const statePath = createTempStatePath();
          const sessionId = setupSessionForTest(statePath);

          const result = appendMessage(statePath, {
            sessionId,
            role: 'assistant',
            content,
            model: 'llama3',
            endpoint: 'http://127.0.0.1:11434',
            metrics
          }, {
            idFactory: () => `msg-${Date.now()}-${Math.random()}`,
            now: '2025-01-01T00:01:00.000Z'
          });

          // Bug condition assertion: metrics should NOT be null
          expect(result.metrics).not.toBeNull();
          expect(result.metrics).toBeDefined();
          expect(typeof result.metrics).toBe('object');
        }
      ),
      { numRuns: 50 }
    );
  });

  it('appendMessage with valid metrics should preserve each metric field value', () => {
    const statePath = createTempStatePath();
    const sessionId = setupSessionForTest(statePath);

    const inputMetrics = {
      totalDuration: 5000000000,
      loadDuration: 200000000,
      promptEvalCount: 10,
      promptEvalDuration: 500000000,
      evalCount: 45,
      evalDuration: 4500000000
    };

    const result = appendMessage(statePath, {
      sessionId,
      role: 'assistant',
      content: 'Hello, I am an AI assistant.',
      model: 'llama3',
      endpoint: 'http://127.0.0.1:11434',
      metrics: inputMetrics
    }, {
      idFactory: () => 'test-msg-1',
      now: '2025-01-01T00:01:00.000Z'
    });

    // Each field should be preserved as a valid number
    expect(result.metrics).not.toBeNull();
    expect(result.metrics!.totalDuration).toBe(5000000000);
    expect(result.metrics!.loadDuration).toBe(200000000);
    expect(result.metrics!.promptEvalCount).toBe(10);
    expect(result.metrics!.promptEvalDuration).toBe(500000000);
    expect(result.metrics!.evalCount).toBe(45);
    expect(result.metrics!.evalDuration).toBe(4500000000);
  });

  it('appendMessage with mixed valid/invalid metrics should normalize per-field (PBT)', () => {
    fc.assert(
      fc.property(
        mixedMetricsArbitrary,
        (metrics) => {
          const statePath = createTempStatePath();
          const sessionId = setupSessionForTest(statePath);

          const result = appendMessage(statePath, {
            sessionId,
            role: 'assistant',
            content: 'Test response',
            model: 'llama3',
            endpoint: 'http://127.0.0.1:11434',
            metrics
          }, {
            idFactory: () => `msg-${Date.now()}-${Math.random()}`,
            now: '2025-01-01T00:01:00.000Z'
          });

          // The metrics object itself should NOT be null (it was provided)
          expect(result.metrics).not.toBeNull();

          // Each field should be independently validated:
          // - Valid finite numbers are preserved
          // - NaN/Infinity are coerced to null
          if (result.metrics) {
            for (const key of ['totalDuration', 'loadDuration', 'promptEvalCount', 'promptEvalDuration', 'evalCount', 'evalDuration'] as const) {
              const inputValue = metrics[key];
              if (Number.isFinite(inputValue)) {
                expect(result.metrics[key]).toBe(inputValue);
              } else {
                expect(result.metrics[key]).toBeNull();
              }
            }
          }
        }
      ),
      { numRuns: 50 }
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BUG 2: Composer Not Clearing Immediately
// ═══════════════════════════════════════════════════════════════════════════════

describe('Bug 2 Exploration: Composer Clearing Before Stream', () => {
  /**
   * **Validates: Requirements 2.3, 2.4**
   * 
   * Bug Condition: When handleSendMessage is called, the composer text and
   * attachments should clear IMMEDIATELY (before the streaming await resolves).
   * 
   * On UNFIXED code: setComposer('') is placed AFTER the
   * `await runtimeClient.sendChatMessageStream(...)` call, which means the
   * composer stays populated for the entire duration of the stream (3-30+ seconds).
   * 
   * Testing approach: We verify the code structure by reading the source and
   * checking that setComposer('') appears BEFORE the await of sendChatMessageStream.
   * This is a structural assertion that confirms the bug exists.
   * 
   * EXPECTED: This test FAILS on unfixed code (confirming the bug exists).
   */

  it('setComposer should be called BEFORE the streaming await in sendPromptWithStreaming', () => {
    // Read the source file and verify the ordering of operations
    const appSource = fs.readFileSync(
      path.resolve(__dirname, '../src/App.tsx'),
      'utf8'
    );

    // Find the sendPromptWithStreaming function
    const funcStart = appSource.indexOf('async function sendPromptWithStreaming');
    expect(funcStart).toBeGreaterThan(-1);

    // Extract the function body (find the next function or end)
    const funcBody = appSource.slice(funcStart, appSource.indexOf('async function handleSendMessage'));

    // Find positions of key operations within the function
    const streamAwaitPos = funcBody.indexOf('await runtimeClient.sendChatMessageStream');
    const setComposerPos = funcBody.indexOf("setComposer('')");

    // Both should exist in the function
    expect(streamAwaitPos).toBeGreaterThan(-1);
    expect(setComposerPos).toBeGreaterThan(-1);

    // CRITICAL ASSERTION: setComposer('') must appear BEFORE the stream await
    // On unfixed code, setComposer('') appears AFTER the await (bug condition)
    expect(setComposerPos).toBeLessThan(streamAwaitPos);
  });

  it('setComposerAttachments should be called BEFORE the streaming await', () => {
    const appSource = fs.readFileSync(
      path.resolve(__dirname, '../src/App.tsx'),
      'utf8'
    );

    const funcStart = appSource.indexOf('async function sendPromptWithStreaming');
    expect(funcStart).toBeGreaterThan(-1);

    const funcBody = appSource.slice(funcStart, appSource.indexOf('async function handleSendMessage'));

    const streamAwaitPos = funcBody.indexOf('await runtimeClient.sendChatMessageStream');

    // setComposerAttachments should be in sendPromptWithStreaming BEFORE the await
    const setAttachmentsPos = funcBody.indexOf('setComposerAttachments');

    // On unfixed code: setComposerAttachments is in handleSendMessage (not in sendPromptWithStreaming)
    // so it won't be found in the sendPromptWithStreaming function body, or if found,
    // it will be AFTER the await
    expect(setAttachmentsPos).toBeGreaterThan(-1);
    expect(setAttachmentsPos).toBeLessThan(streamAwaitPos);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BUG 3: No Steering While Streaming
// ═══════════════════════════════════════════════════════════════════════════════

describe('Bug 3 Exploration: Steering While Streaming', () => {
  /**
   * **Validates: Requirements 2.5, 2.6**
   * 
   * Bug Condition: When isSendingMessage is true (stream is active) and the user
   * has content in the composer, the send button should NOT be disabled.
   * 
   * On UNFIXED code: disabled={isSendingMessage || !canSendMessage} means the
   * button is ALWAYS disabled when isSendingMessage is true, regardless of content.
   * 
   * Testing approach: We verify the disabled condition on the send button does NOT
   * include isSendingMessage as a disabling factor.
   * 
   * EXPECTED: This test FAILS on unfixed code (confirming the bug exists).
   */

  it('send button disabled condition should NOT include isSendingMessage', () => {
    const appSource = fs.readFileSync(
      path.resolve(__dirname, '../src/App.tsx'),
      'utf8'
    );

    // Find the send button JSX
    const primaryActionRegion = appSource.indexOf('className="primary-action"');
    expect(primaryActionRegion).toBeGreaterThan(-1);

    // Get the line containing the primary-action button
    const lineStart = appSource.lastIndexOf('\n', primaryActionRegion);
    const lineEnd = appSource.indexOf('\n', primaryActionRegion + 50);
    const buttonLine = appSource.slice(lineStart, lineEnd);

    // Extract the disabled condition
    const disabledMatch = buttonLine.match(/disabled=\{([^}]+)\}/);
    expect(disabledMatch).not.toBeNull();

    const disabledCondition = disabledMatch![1];

    // The disabled condition should NOT reference isSendingMessage
    // On unfixed code: disabled={isSendingMessage || !canSendMessage} — INCLUDES isSendingMessage
    // On fixed code: disabled={!canSendMessage} — does NOT include isSendingMessage
    expect(disabledCondition).not.toContain('isSendingMessage');
  });

  it('handleComposerKeyDown should allow Enter during streaming (no isSendingMessage guard)', () => {
    const appSource = fs.readFileSync(
      path.resolve(__dirname, '../src/App.tsx'),
      'utf8'
    );

    // Find the handleComposerKeyDown function
    const funcStart = appSource.indexOf('const handleComposerKeyDown');
    expect(funcStart).toBeGreaterThan(-1);

    // Get function body (until next const or function declaration)
    const funcEnd = appSource.indexOf('\n  return (', funcStart);
    const funcBody = appSource.slice(funcStart, funcEnd);

    // The Enter key submission condition should NOT guard on isSendingMessage
    // On unfixed code: `if (!isSendingMessage && canSendMessage)` blocks during streaming
    // On fixed code: the condition should allow submission during streaming (routes to queue)
    expect(funcBody).not.toContain('!isSendingMessage');
  });

  it('handleSendMessage should support queuing when isSendingMessage is true', () => {
    const appSource = fs.readFileSync(
      path.resolve(__dirname, '../src/App.tsx'),
      'utf8'
    );

    // Find the handleSendMessage function
    const funcStart = appSource.indexOf('async function handleSendMessage');
    expect(funcStart).toBeGreaterThan(-1);

    // Get function body
    const nextFunc = appSource.indexOf('\n  async function', funcStart + 10);
    const funcBody = appSource.slice(funcStart, nextFunc > -1 ? nextFunc : funcStart + 2000);

    // On fixed code, handleSendMessage should reference queuedMessage for the queue path
    // On unfixed code, there is no queuing mechanism at all
    expect(funcBody).toContain('queuedMessage');
  });
});
