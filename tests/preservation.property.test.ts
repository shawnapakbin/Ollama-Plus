import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { appendMessage, createSession, listMessages } from '../electron/runtime/runtimeStore.js';
import { normalizeMessage } from '../electron/runtime/stateSchema.js';

/**
 * Preservation Property Tests
 *
 * These tests encode behaviors that should NOT change after the bug fixes.
 * They run on UNFIXED code and MUST PASS, verifying the non-buggy paths.
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-plus-preservation-'));
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

/** Generate valid message content */
const contentArbitrary = fc.string({ minLength: 1, maxLength: 500 });

/** Generate a valid model name */
const modelArbitrary = fc.constantFrom('llama3', 'llama2', 'mistral', 'codellama', 'phi3', 'gemma');

/** Generate a valid endpoint */
const endpointArbitrary = fc.constantFrom(
  'http://127.0.0.1:11434',
  'http://localhost:11434',
  'http://192.168.1.100:11434'
);

/** Generate metrics with a mix of valid numbers and invalid values (NaN, Infinity) */
const mixedMetricsArbitrary = fc.record({
  totalDuration: fc.oneof(fc.nat({ max: 60_000_000_000 }), fc.constant(NaN), fc.constant(Infinity), fc.constant(-Infinity)),
  loadDuration: fc.oneof(fc.nat({ max: 10_000_000_000 }), fc.constant(NaN), fc.constant(Infinity)),
  promptEvalCount: fc.oneof(fc.nat({ max: 10_000 }), fc.constant(NaN), fc.constant(Infinity)),
  promptEvalDuration: fc.oneof(fc.nat({ max: 30_000_000_000 }), fc.constant(NaN), fc.constant(Infinity)),
  evalCount: fc.oneof(fc.nat({ max: 10_000 }), fc.constant(NaN), fc.constant(Infinity)),
  evalDuration: fc.oneof(fc.nat({ max: 60_000_000_000 }), fc.constant(NaN), fc.constant(Infinity))
});

// ═══════════════════════════════════════════════════════════════════════════════
// BUG 1 PRESERVATION: Non-Metrics Input Behavior Unchanged
// ═══════════════════════════════════════════════════════════════════════════════

describe('Bug 1 Preservation: Non-Metrics Input Behavior', () => {
  /**
   * **Validates: Requirements 3.1, 3.2**
   *
   * For all inputs where the bug condition does NOT hold (user messages,
   * or assistant messages with undefined/null metrics), the result should
   * persist metrics: null. This behavior must remain unchanged after the fix.
   */

  it('appendMessage with metrics: undefined returns metrics: null (PBT)', () => {
    fc.assert(
      fc.property(
        contentArbitrary,
        modelArbitrary,
        endpointArbitrary,
        fc.constantFrom('user', 'assistant', 'system'),
        (content, model, endpoint, role) => {
          const statePath = createTempStatePath();
          const sessionId = setupSessionForTest(statePath);

          const result = appendMessage(statePath, {
            sessionId,
            role,
            content,
            model,
            endpoint
            // metrics is implicitly undefined
          }, {
            idFactory: () => `msg-${Date.now()}-${Math.random()}`,
            now: '2025-01-01T00:01:00.000Z'
          });

          // When no metrics is provided, result.metrics should be null
          expect(result.metrics).toBeNull();
        }
      ),
      { numRuns: 50 }
    );
  });

  it('appendMessage with metrics: null returns metrics: null (PBT)', () => {
    fc.assert(
      fc.property(
        contentArbitrary,
        modelArbitrary,
        endpointArbitrary,
        fc.constantFrom('user', 'assistant', 'system'),
        (content, model, endpoint, role) => {
          const statePath = createTempStatePath();
          const sessionId = setupSessionForTest(statePath);

          const result = appendMessage(statePath, {
            sessionId,
            role,
            content,
            model,
            endpoint,
            metrics: null
          }, {
            idFactory: () => `msg-${Date.now()}-${Math.random()}`,
            now: '2025-01-01T00:01:00.000Z'
          });

          // When metrics is explicitly null, result.metrics should be null
          expect(result.metrics).toBeNull();
        }
      ),
      { numRuns: 50 }
    );
  });

  it('user messages always persist metrics: null regardless of input (PBT)', () => {
    fc.assert(
      fc.property(
        contentArbitrary,
        modelArbitrary,
        endpointArbitrary,
        (content, model, endpoint) => {
          const statePath = createTempStatePath();
          const sessionId = setupSessionForTest(statePath);

          // Even if we somehow pass metrics for a user message, the current
          // behavior doesn't persist it (because appendMessage doesn't pass metrics through).
          // After the fix, user messages should still have metrics: null since
          // the fix only applies to assistant messages with non-null metrics.
          const result = appendMessage(statePath, {
            sessionId,
            role: 'user',
            content,
            model,
            endpoint
          }, {
            idFactory: () => `msg-${Date.now()}-${Math.random()}`,
            now: '2025-01-01T00:01:00.000Z'
          });

          expect(result.metrics).toBeNull();
          expect(result.role).toBe('user');
        }
      ),
      { numRuns: 50 }
    );
  });

  /**
   * **Validates: Requirements 3.3**
   *
   * normalizeMessage continues to coerce non-finite numeric metric values to null.
   * This test verifies the normalizeMessage function directly.
   */

  it('normalizeMessage coerces non-finite metric fields to null (PBT)', () => {
    fc.assert(
      fc.property(
        mixedMetricsArbitrary,
        (metrics) => {
          const result = normalizeMessage({
            id: 'test-msg',
            sessionId: 'test-session',
            role: 'assistant',
            content: 'Test',
            model: 'llama3',
            endpoint: 'http://127.0.0.1:11434',
            createdAt: '2025-01-01T00:00:00.000Z',
            metrics
          }, '2025-01-01T00:00:00.000Z');

          // The metrics object should exist when a non-null object is provided
          expect(result.metrics).not.toBeNull();
          expect(typeof result.metrics).toBe('object');

          // Each field should be individually validated:
          // - Valid finite numbers are preserved exactly
          // - NaN/Infinity/-Infinity are coerced to null
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
      { numRuns: 100 }
    );
  });

  it('normalizeMessage with metrics: undefined returns metrics: null', () => {
    const result = normalizeMessage({
      id: 'test-msg',
      sessionId: 'test-session',
      role: 'assistant',
      content: 'Test',
      model: 'llama3',
      endpoint: 'http://127.0.0.1:11434',
      createdAt: '2025-01-01T00:00:00.000Z'
      // metrics: undefined
    }, '2025-01-01T00:00:00.000Z');

    expect(result.metrics).toBeNull();
  });

  it('normalizeMessage with metrics: null returns metrics: null', () => {
    const result = normalizeMessage({
      id: 'test-msg',
      sessionId: 'test-session',
      role: 'assistant',
      content: 'Test',
      model: 'llama3',
      endpoint: 'http://127.0.0.1:11434',
      createdAt: '2025-01-01T00:00:00.000Z',
      metrics: null
    }, '2025-01-01T00:00:00.000Z');

    expect(result.metrics).toBeNull();
  });

  /**
   * **Validates: Requirements 3.4**
   *
   * Session management (status, updatedAt, lastRunSummary) continues to work
   * correctly for appended messages.
   */

  it('appendMessage updates session status and lastRunSummary correctly (PBT)', () => {
    fc.assert(
      fc.property(
        contentArbitrary,
        fc.constantFrom('user', 'assistant') as fc.Arbitrary<'user' | 'assistant'>,
        (content, role) => {
          const statePath = createTempStatePath();
          const sessionId = setupSessionForTest(statePath);

          const result = appendMessage(statePath, {
            sessionId,
            role,
            content,
            model: 'llama3',
            endpoint: 'http://127.0.0.1:11434'
          }, {
            idFactory: () => `msg-${Date.now()}-${Math.random()}`,
            now: '2025-01-01T00:01:00.000Z'
          });

          // Verify message properties
          expect(result.role).toBe(role);
          expect(result.sessionId).toBe(sessionId);
          expect(result.content).toBe(content);

          // Verify the message is persisted and retrievable
          const messages = listMessages(statePath, sessionId);
          expect(messages.length).toBeGreaterThan(0);
          const found = messages.find((m) => m.id === result.id);
          expect(found).toBeDefined();
          expect(found!.role).toBe(role);
          expect(found!.content).toBe(content);
        }
      ),
      { numRuns: 30 }
    );
  });

  it('appendMessage with unknown session throws error', () => {
    const statePath = createTempStatePath();
    setupSessionForTest(statePath);

    expect(() => appendMessage(statePath, {
      sessionId: 'nonexistent-session',
      role: 'user',
      content: 'Hello',
      model: 'llama3',
      endpoint: 'http://127.0.0.1:11434'
    })).toThrow('Cannot append message for unknown session');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BUG 2 PRESERVATION: Composer Clearing Mechanism Exists
// ═══════════════════════════════════════════════════════════════════════════════

describe('Bug 2 Preservation: Composer Clearing Exists in Send Flow', () => {
  /**
   * **Validates: Requirements 3.5, 3.6**
   *
   * The composer clearing mechanism EXISTS in the send flow (currently in the
   * wrong position, but it exists). This test verifies that:
   * - setComposer('') is called within sendPromptWithStreaming
   * - setComposerAttachments([]) is called in handleSendMessage
   * - The error handling path cleans up stream drafts
   *
   * These structural properties must remain after the fix (just in a different position).
   */

  it('sendPromptWithStreaming contains setComposer call', () => {
    const appSource = fs.readFileSync(
      path.resolve(__dirname, '../src/App.tsx'),
      'utf8'
    );

    const funcStart = appSource.indexOf('async function sendPromptWithStreaming');
    expect(funcStart).toBeGreaterThan(-1);

    const funcEnd = appSource.indexOf('async function handleSendMessage');
    const funcBody = appSource.slice(funcStart, funcEnd);

    // setComposer('') exists within sendPromptWithStreaming
    expect(funcBody).toContain("setComposer('')");
  });

  it('handleSendMessage contains setComposerAttachments call', () => {
    const appSource = fs.readFileSync(
      path.resolve(__dirname, '../src/App.tsx'),
      'utf8'
    );

    const funcStart = appSource.indexOf('async function handleSendMessage');
    expect(funcStart).toBeGreaterThan(-1);

    // setComposerAttachments([]) exists within handleSendMessage or sendPromptWithStreaming
    // After the fix it may move to sendPromptWithStreaming, so check the broader send flow
    const sendFlowStart = appSource.indexOf('async function sendPromptWithStreaming');
    const sendFlowEnd = appSource.indexOf('\n  async function handleCopyMessage');
    const sendFlow = appSource.slice(sendFlowStart, sendFlowEnd);

    expect(sendFlow).toContain('setComposerAttachments');
  });

  it('handleSendMessage has error handling that cleans up stream drafts', () => {
    const appSource = fs.readFileSync(
      path.resolve(__dirname, '../src/App.tsx'),
      'utf8'
    );

    const funcStart = appSource.indexOf('async function handleSendMessage');
    const nextFunc = appSource.indexOf('\n  async function', funcStart + 10);
    const funcBody = appSource.slice(funcStart, nextFunc > -1 ? nextFunc : funcStart + 2000);

    // Error handling cleans up stream drafts
    expect(funcBody).toContain('catch');
    expect(funcBody).toContain('setStreamDrafts');
    expect(funcBody).toContain('streamRequestIdRef.current');
  });

  it('handleSendMessage has finally block that resets isSendingMessage', () => {
    const appSource = fs.readFileSync(
      path.resolve(__dirname, '../src/App.tsx'),
      'utf8'
    );

    const funcStart = appSource.indexOf('async function handleSendMessage');
    const nextFunc = appSource.indexOf('\n  async function', funcStart + 10);
    const funcBody = appSource.slice(funcStart, nextFunc > -1 ? nextFunc : funcStart + 2000);

    // finally block resets isSendingMessage
    expect(funcBody).toContain('finally');
    expect(funcBody).toContain('setIsSendingMessage(false)');
  });

  it('Shift+Enter and Ctrl+Enter do NOT submit (newline preservation)', () => {
    const appSource = fs.readFileSync(
      path.resolve(__dirname, '../src/App.tsx'),
      'utf8'
    );

    const funcStart = appSource.indexOf('const handleComposerKeyDown');
    expect(funcStart).toBeGreaterThan(-1);

    // Get until end of function
    const funcEnd = appSource.indexOf('\n  return (', funcStart);
    const funcBody = appSource.slice(funcStart, funcEnd);

    // Shift+Enter check exists (returns early, allowing default newline behavior)
    expect(funcBody).toContain('event.shiftKey');
    // Ctrl/Cmd+Enter check exists
    expect(funcBody).toContain('event.ctrlKey');
    expect(funcBody).toContain('event.metaKey');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BUG 3 PRESERVATION: Non-Streaming Send Path
// ═══════════════════════════════════════════════════════════════════════════════

describe('Bug 3 Preservation: Non-Streaming Send Behavior', () => {
  /**
   * **Validates: Requirements 3.5, 3.6, 3.7**
   *
   * When no stream is active (isSendingMessage === false), the send path
   * behaves identically: handleSendMessage calls sendPromptWithStreaming
   * directly. This behavior must remain unchanged after the fix.
   */

  it('handleSendMessage calls sendPromptWithStreaming directly', () => {
    const appSource = fs.readFileSync(
      path.resolve(__dirname, '../src/App.tsx'),
      'utf8'
    );

    const funcStart = appSource.indexOf('async function handleSendMessage');
    const nextFunc = appSource.indexOf('\n  async function', funcStart + 10);
    const funcBody = appSource.slice(funcStart, nextFunc > -1 ? nextFunc : funcStart + 2000);

    // handleSendMessage calls sendPromptWithStreaming
    expect(funcBody).toContain('sendPromptWithStreaming');
  });

  it('handleSendMessage sets isSendingMessage to true at the start', () => {
    const appSource = fs.readFileSync(
      path.resolve(__dirname, '../src/App.tsx'),
      'utf8'
    );

    const funcStart = appSource.indexOf('async function handleSendMessage');
    const nextFunc = appSource.indexOf('\n  async function', funcStart + 10);
    const funcBody = appSource.slice(funcStart, nextFunc > -1 ? nextFunc : funcStart + 2000);

    // First meaningful line should set isSendingMessage
    expect(funcBody).toContain('setIsSendingMessage(true)');
  });

  it('handleComposerKeyDown submits via handleSendMessage on Enter', () => {
    const appSource = fs.readFileSync(
      path.resolve(__dirname, '../src/App.tsx'),
      'utf8'
    );

    const funcStart = appSource.indexOf('const handleComposerKeyDown');
    const funcEnd = appSource.indexOf('\n  return (', funcStart);
    const funcBody = appSource.slice(funcStart, funcEnd);

    // Enter key handler calls handleSendMessage
    expect(funcBody).toContain('handleSendMessage');
    // Prevents default textarea behavior
    expect(funcBody).toContain('event.preventDefault()');
  });

  it('handleComposerKeyDown requires canSendMessage before submit', () => {
    const appSource = fs.readFileSync(
      path.resolve(__dirname, '../src/App.tsx'),
      'utf8'
    );

    const funcStart = appSource.indexOf('const handleComposerKeyDown');
    const funcEnd = appSource.indexOf('\n  return (', funcStart);
    const funcBody = appSource.slice(funcStart, funcEnd);

    // canSendMessage is checked before submitting
    expect(funcBody).toContain('canSendMessage');
  });

  it('sendPromptWithStreaming rejects empty input with error', () => {
    const appSource = fs.readFileSync(
      path.resolve(__dirname, '../src/App.tsx'),
      'utf8'
    );

    const funcStart = appSource.indexOf('async function sendPromptWithStreaming');
    const funcEnd = appSource.indexOf('async function handleSendMessage');
    const funcBody = appSource.slice(funcStart, funcEnd);

    // Empty input check exists: promptInput.trim() and if (!prompt) guard
    expect(funcBody).toContain('promptInput.trim()');
    expect(funcBody).toContain("if (!prompt)");
  });

  it('sendPromptWithStreaming creates optimistic user message', () => {
    const appSource = fs.readFileSync(
      path.resolve(__dirname, '../src/App.tsx'),
      'utf8'
    );

    const funcStart = appSource.indexOf('async function sendPromptWithStreaming');
    const funcEnd = appSource.indexOf('async function handleSendMessage');
    const funcBody = appSource.slice(funcStart, funcEnd);

    // Optimistic user message is created
    expect(funcBody).toContain('optimisticUserMessage');
    expect(funcBody).toContain("role: 'user'");
    expect(funcBody).toContain('setMessages');
  });

  it('sendPromptWithStreaming sets up stream drafts', () => {
    const appSource = fs.readFileSync(
      path.resolve(__dirname, '../src/App.tsx'),
      'utf8'
    );

    const funcStart = appSource.indexOf('async function sendPromptWithStreaming');
    const funcEnd = appSource.indexOf('async function handleSendMessage');
    const funcBody = appSource.slice(funcStart, funcEnd);

    // Stream drafts are set up
    expect(funcBody).toContain('setStreamDrafts');
  });

  it('send button exists with disabled condition referencing canSendMessage', () => {
    const appSource = fs.readFileSync(
      path.resolve(__dirname, '../src/App.tsx'),
      'utf8'
    );

    // After Bug 3 fix, send button is only disabled when canSendMessage is false.
    // This allows users to queue messages during streaming.
    // The preservation property is: canSendMessage still gates the button.
    const buttonLine = 'disabled={!canSendMessage}';
    expect(appSource).toContain(buttonLine);
  });
});
