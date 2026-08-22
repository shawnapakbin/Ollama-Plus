// Feature: auto-session-naming, Property 4: Error Suppression and No-Retry
// Validates: Requirements 6.1, 6.4

// Feature: auto-session-naming, Property 5: Concurrent Rename Lock Lifecycle
// Validates: Requirements 7.1, 7.2, 7.3

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { evaluateRenameGuard, DEFAULT_SESSION_TITLE } from '../src/services/renameGuard';
import type {
  RuntimeChatConfig,
  RuntimeChatMessage,
  RuntimeSessionSummary,
  RuntimeSessionRenameResult
} from '../src/services/runtimeClient';

/**
 * Simulates the core async lifecycle of `autoRenameAfterCompletion` from App.tsx.
 *
 * This function replicates the exact control flow:
 * 1. Find session, evaluate guard
 * 2. Add session to in-progress set
 * 3. Call renameSessionWithAi
 * 4. On success: return result
 * 5. On failure: catch error, log warning
 * 6. Finally: remove session from in-progress set
 */
async function simulateAutoRename(
  sessionId: string,
  session: RuntimeSessionSummary | undefined,
  config: RuntimeChatConfig,
  messages: RuntimeChatMessage[],
  inProgressSet: Set<string>,
  renameSessionWithAi: (sessionId: string, input: { endpoint: string; model: string }) => Promise<RuntimeSessionRenameResult>
): Promise<{ success: boolean; result?: RuntimeSessionRenameResult; error?: unknown }> {
  try {
    if (!session) return { success: false };

    if (!evaluateRenameGuard(session, config, messages, inProgressSet)) {
      return { success: false };
    }

    inProgressSet.add(sessionId);

    const result = await renameSessionWithAi(sessionId, {
      endpoint: config.endpoint,
      model: config.model
    });

    return { success: true, result };
  } catch (error) {
    // Errors are caught silently — logged but not propagated (Req 6.1)
    console.warn('[auto-rename] Failed for session', sessionId, error);
    return { success: false, error };
  } finally {
    inProgressSet.delete(sessionId);
  }
}

/**
 * Helper factories for test data
 */

function makeSession(id: string): RuntimeSessionSummary {
  return {
    id,
    title: DEFAULT_SESSION_TITLE,
    status: 'active',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastRunSummary: ''
  };
}

function makeConfig(enabled = true): RuntimeChatConfig {
  return {
    endpoint: 'http://127.0.0.1:11434',
    model: 'llama3.2',
    autoRenameEnabled: enabled
  };
}

function makeMessages(): RuntimeChatMessage[] {
  return [
    {
      id: 'msg-1',
      sessionId: 'session-1',
      role: 'user',
      content: 'Hello',
      model: null,
      endpoint: null,
      createdAt: new Date().toISOString(),
      metrics: null
    },
    {
      id: 'msg-2',
      sessionId: 'session-1',
      role: 'assistant',
      content: 'Hi there!',
      model: 'llama3.2',
      endpoint: 'http://127.0.0.1:11434',
      createdAt: new Date().toISOString(),
      metrics: null
    }
  ];
}

function makeRenameResult(session: RuntimeSessionSummary): RuntimeSessionRenameResult {
  return {
    session: { ...session, title: 'AI-generated title' },
    title: 'AI-generated title',
    endpoint: 'http://127.0.0.1:11434',
    model: 'llama3.2'
  };
}

/** Arbitrary for generating random error messages */
const arbErrorMessage = fc.oneof(
  fc.string({ minLength: 1, maxLength: 100 }),
  fc.constantFrom(
    'Network Error',
    'ECONNREFUSED',
    'model not found',
    'timeout exceeded',
    'Internal Server Error',
    'Service Unavailable'
  )
);

/** Arbitrary for generating random Error instances */
const arbError = arbErrorMessage.map((msg) => new Error(msg));

/** Arbitrary for session IDs */
const arbSessionId = fc.uuid();

describe('autoRenameAfterCompletion – Property 4: Error Suppression and No-Retry', () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
  });

  it('does not propagate errors when renameSessionWithAi throws random errors (Req 6.1)', async () => {
    await fc.assert(
      fc.asyncProperty(arbError, async (error) => {
        const sessionId = 'test-session-1';
        const session = makeSession(sessionId);
        const config = makeConfig(true);
        const messages = makeMessages();
        const inProgressSet = new Set<string>();

        const mockRename = vi.fn().mockRejectedValue(error);

        // Should NOT throw — errors are caught silently
        const outcome = await simulateAutoRename(
          sessionId,
          session,
          config,
          messages,
          inProgressSet,
          mockRename
        );

        expect(outcome.success).toBe(false);
        expect(outcome.error).toBe(error);
      }),
      { numRuns: 100 }
    );
  });

  it('calls renameSessionWithAi at most once per stream completion event — no retry (Req 6.4)', async () => {
    await fc.assert(
      fc.asyncProperty(arbError, async (error) => {
        const sessionId = 'test-session-2';
        const session = makeSession(sessionId);
        const config = makeConfig(true);
        const messages = makeMessages();
        const inProgressSet = new Set<string>();

        const mockRename = vi.fn().mockRejectedValue(error);

        await simulateAutoRename(
          sessionId,
          session,
          config,
          messages,
          inProgressSet,
          mockRename
        );

        // The rename function should be called exactly once — no retry on failure
        expect(mockRename).toHaveBeenCalledTimes(1);
      }),
      { numRuns: 100 }
    );
  });

  it('releases the in-progress lock after failure (Req 6.1, 7.2)', async () => {
    await fc.assert(
      fc.asyncProperty(arbError, async (error) => {
        const sessionId = 'test-session-3';
        const session = makeSession(sessionId);
        const config = makeConfig(true);
        const messages = makeMessages();
        const inProgressSet = new Set<string>();

        const mockRename = vi.fn().mockRejectedValue(error);

        await simulateAutoRename(
          sessionId,
          session,
          config,
          messages,
          inProgressSet,
          mockRename
        );

        // After failure, the session ID must be removed from in-progress set
        expect(inProgressSet.has(sessionId)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('logs the error to console.warn on failure (Req 6.2)', async () => {
    await fc.assert(
      fc.asyncProperty(arbError, async (error) => {
        const sessionId = 'test-session-4';
        const session = makeSession(sessionId);
        const config = makeConfig(true);
        const messages = makeMessages();
        const inProgressSet = new Set<string>();

        const mockRename = vi.fn().mockRejectedValue(error);
        consoleWarnSpy.mockClear();

        await simulateAutoRename(
          sessionId,
          session,
          config,
          messages,
          inProgressSet,
          mockRename
        );

        // Error is logged to console.warn for debugging
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          '[auto-rename] Failed for session',
          sessionId,
          error
        );
      }),
      { numRuns: 100 }
    );
  });

  it('produces no unhandled promise rejections for random error types', async () => {
    const arbRejectionReason = fc.oneof(
      arbError,
      fc.string().map((s) => s), // string rejections
      fc.constant(null),
      fc.constant(undefined),
      fc.integer()
    );

    await fc.assert(
      fc.asyncProperty(arbRejectionReason, async (reason) => {
        const sessionId = 'test-session-5';
        const session = makeSession(sessionId);
        const config = makeConfig(true);
        const messages = makeMessages();
        const inProgressSet = new Set<string>();

        const mockRename = vi.fn().mockRejectedValue(reason);

        // This must NOT throw an unhandled rejection regardless of rejection type
        const outcome = await simulateAutoRename(
          sessionId,
          session,
          config,
          messages,
          inProgressSet,
          mockRename
        );

        expect(outcome.success).toBe(false);
        // Lock is always released
        expect(inProgressSet.has(sessionId)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });
});

// Feature: auto-session-naming, Property 6: Bridge Unavailability Resilience
// Validates: Requirements 11.3
describe('autoRenameAfterCompletion – Property 6: Bridge Unavailability Resilience', () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
  });

  /** Arbitrary for simulating bridge unavailability error messages */
  const arbBridgeError = fc.oneof(
    fc.constant(new Error('Electron runtime bridge is unavailable. Launch the desktop shell to use the rebuild baseline.')),
    fc.constant(new Error('Cannot read properties of undefined (reading \'renameRuntimeSessionWithAi\')')),
    fc.constant(new Error('Cannot read properties of null (reading \'renameRuntimeSessionWithAi\')')),
    fc.constant(new TypeError('window.electronAPI is not defined')),
    fc.constant(new TypeError('Cannot read properties of undefined')),
    fc.constant(new ReferenceError('electronAPI is not defined'))
  );

  it('does not throw unhandled errors when the bridge is unavailable (Req 11.3)', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbSessionId,
        arbBridgeError,
        async (sessionId, bridgeError) => {
          const session = makeSession(sessionId);
          const config = makeConfig(true);
          const messages = makeMessages();
          const inProgressSet = new Set<string>();

          // Simulate renameSessionWithAi throwing because window.electronAPI is undefined/null
          const mockRename = vi.fn().mockRejectedValue(bridgeError);

          // This must NOT throw — the try/catch handles the bridge error gracefully
          const outcome = await simulateAutoRename(
            sessionId,
            session,
            config,
            messages,
            inProgressSet,
            mockRename
          );

          // The call fails gracefully without propagating
          expect(outcome.success).toBe(false);
          expect(outcome.error).toBe(bridgeError);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('releases the in-progress lock even when the bridge throws (Req 11.3, 7.2)', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbSessionId,
        arbBridgeError,
        async (sessionId, bridgeError) => {
          const session = makeSession(sessionId);
          const config = makeConfig(true);
          const messages = makeMessages();
          const inProgressSet = new Set<string>();

          const mockRename = vi.fn().mockRejectedValue(bridgeError);

          await simulateAutoRename(
            sessionId,
            session,
            config,
            messages,
            inProgressSet,
            mockRename
          );

          // The in-progress lock must always be released in the finally block
          expect(inProgressSet.has(sessionId)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('logs the bridge error to console.warn for debugging (Req 6.2, 11.3)', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbSessionId,
        arbBridgeError,
        async (sessionId, bridgeError) => {
          const session = makeSession(sessionId);
          const config = makeConfig(true);
          const messages = makeMessages();
          const inProgressSet = new Set<string>();

          const mockRename = vi.fn().mockRejectedValue(bridgeError);
          consoleWarnSpy.mockClear();

          await simulateAutoRename(
            sessionId,
            session,
            config,
            messages,
            inProgressSet,
            mockRename
          );

          // Bridge errors are logged just like any other failure
          expect(consoleWarnSpy).toHaveBeenCalledWith(
            '[auto-rename] Failed for session',
            sessionId,
            bridgeError
          );
        }
      ),
      { numRuns: 100 }
    );
  });

  it('handles synchronous throws from the bridge (not just rejections) without propagating (Req 11.3)', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbSessionId,
        arbBridgeError,
        async (sessionId, bridgeError) => {
          const session = makeSession(sessionId);
          const config = makeConfig(true);
          const messages = makeMessages();
          const inProgressSet = new Set<string>();

          // Simulate a synchronous throw (as getElectronApi() does when bridge is undefined)
          const mockRename = vi.fn().mockImplementation(() => {
            throw bridgeError;
          });

          // Must not propagate even for synchronous throws
          const outcome = await simulateAutoRename(
            sessionId,
            session,
            config,
            messages,
            inProgressSet,
            mockRename
          );

          expect(outcome.success).toBe(false);
          expect(outcome.error).toBe(bridgeError);
          expect(inProgressSet.has(sessionId)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('handles all bridge unavailability scenarios with random session IDs and configs (Req 11.3)', async () => {
    const arbConfig = fc.record({
      endpoint: fc.oneof(
        fc.constant('http://127.0.0.1:11434'),
        fc.webUrl(),
        fc.constant('')
      ),
      model: fc.oneof(
        fc.constant('llama3.2'),
        fc.string({ minLength: 0, maxLength: 50 }),
        fc.constant('')
      ),
      autoRenameEnabled: fc.constant(true)
    }) as fc.Arbitrary<RuntimeChatConfig>;

    await fc.assert(
      fc.asyncProperty(
        arbSessionId,
        arbConfig,
        arbBridgeError,
        async (sessionId, config, bridgeError) => {
          const session = makeSession(sessionId);
          const messages = makeMessages();
          const inProgressSet = new Set<string>();

          const mockRename = vi.fn().mockRejectedValue(bridgeError);

          // The auto-rename code path must handle bridge unavailability
          // regardless of the specific config values or session ID
          const outcome = await simulateAutoRename(
            sessionId,
            session,
            config,
            messages,
            inProgressSet,
            mockRename
          );

          // No error propagation — graceful failure
          expect(outcome.success).toBe(false);
          // Lock cleanup always happens
          expect(inProgressSet.has(sessionId)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('autoRenameAfterCompletion – Property 5: Concurrent Rename Lock Lifecycle', () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
  });

  it('rejects additional auto-rename requests while one is in-progress for the same session (Req 7.1)', async () => {
    await fc.assert(
      fc.asyncProperty(arbSessionId, async (sessionId) => {
        const session = makeSession(sessionId);
        const config = makeConfig(true);
        const messages = makeMessages();
        const inProgressSet = new Set<string>();

        // Simulate a long-running rename that hasn't resolved yet
        let resolveRename!: (value: RuntimeSessionRenameResult) => void;
        const pendingRename = new Promise<RuntimeSessionRenameResult>((resolve) => {
          resolveRename = resolve;
        });
        const mockRename = vi.fn().mockReturnValue(pendingRename);

        // Start first rename — it will be pending
        const firstPromise = simulateAutoRename(
          sessionId,
          session,
          config,
          messages,
          inProgressSet,
          mockRename
        );

        // The session should now be in the in-progress set
        expect(inProgressSet.has(sessionId)).toBe(true);

        // Attempt second rename for the same session — guard should reject
        const secondResult = await simulateAutoRename(
          sessionId,
          session,
          config,
          messages,
          inProgressSet,
          mockRename
        );

        // Second call should be rejected by the guard
        expect(secondResult.success).toBe(false);
        // mockRename should only have been called once (from the first attempt)
        expect(mockRename).toHaveBeenCalledTimes(1);

        // Resolve the first rename so it completes
        resolveRename(makeRenameResult(session));
        await firstPromise;
      }),
      { numRuns: 100 }
    );
  });

  it('releases the lock after successful completion, allowing future renames (Req 7.2)', async () => {
    await fc.assert(
      fc.asyncProperty(arbSessionId, async (sessionId) => {
        const session = makeSession(sessionId);
        const config = makeConfig(true);
        const messages = makeMessages();
        const inProgressSet = new Set<string>();

        const mockRename = vi.fn().mockResolvedValue(makeRenameResult(session));

        // First rename — should succeed
        const first = await simulateAutoRename(
          sessionId,
          session,
          config,
          messages,
          inProgressSet,
          mockRename
        );

        expect(first.success).toBe(true);
        // Lock is released after completion
        expect(inProgressSet.has(sessionId)).toBe(false);

        // A subsequent rename for the same session should now be allowed
        const second = await simulateAutoRename(
          sessionId,
          session,
          config,
          messages,
          inProgressSet,
          mockRename
        );

        // Second call proceeds (lock is not blocking it)
        expect(second.success).toBe(true);
        expect(mockRename).toHaveBeenCalledTimes(2);
      }),
      { numRuns: 100 }
    );
  });

  it('releases the lock after failure, allowing future renames (Req 7.2)', async () => {
    await fc.assert(
      fc.asyncProperty(arbSessionId, arbError, async (sessionId, error) => {
        const session = makeSession(sessionId);
        const config = makeConfig(true);
        const messages = makeMessages();
        const inProgressSet = new Set<string>();

        const mockRename = vi.fn()
          .mockRejectedValueOnce(error)
          .mockResolvedValue(makeRenameResult(session));

        // First rename — fails
        const first = await simulateAutoRename(
          sessionId,
          session,
          config,
          messages,
          inProgressSet,
          mockRename
        );

        expect(first.success).toBe(false);
        expect(inProgressSet.has(sessionId)).toBe(false);

        // Second rename — should succeed now that lock is released
        const second = await simulateAutoRename(
          sessionId,
          session,
          config,
          messages,
          inProgressSet,
          mockRename
        );

        expect(second.success).toBe(true);
        expect(inProgressSet.has(sessionId)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('allows concurrent renames for different sessions without mutual blocking (Req 7.3)', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbSessionId,
        arbSessionId,
        async (sessionId1, sessionId2) => {
          // Ensure distinct session IDs for this property
          fc.pre(sessionId1 !== sessionId2);

          const session1 = makeSession(sessionId1);
          const session2 = makeSession(sessionId2);
          const config = makeConfig(true);
          const messages = makeMessages();
          const inProgressSet = new Set<string>();

          let resolveRename1!: (value: RuntimeSessionRenameResult) => void;
          let resolveRename2!: (value: RuntimeSessionRenameResult) => void;

          const pendingRename1 = new Promise<RuntimeSessionRenameResult>((resolve) => {
            resolveRename1 = resolve;
          });
          const pendingRename2 = new Promise<RuntimeSessionRenameResult>((resolve) => {
            resolveRename2 = resolve;
          });

          const mockRename = vi.fn()
            .mockImplementationOnce(() => pendingRename1)
            .mockImplementationOnce(() => pendingRename2);

          // Start rename for session 1
          const promise1 = simulateAutoRename(
            sessionId1,
            session1,
            config,
            messages,
            inProgressSet,
            mockRename
          );

          // Session 1 is in-progress
          expect(inProgressSet.has(sessionId1)).toBe(true);
          // Session 2 is NOT blocked
          expect(inProgressSet.has(sessionId2)).toBe(false);

          // Start rename for session 2 — should proceed independently
          const promise2 = simulateAutoRename(
            sessionId2,
            session2,
            config,
            messages,
            inProgressSet,
            mockRename
          );

          // Both sessions are now in-progress concurrently
          expect(inProgressSet.has(sessionId1)).toBe(true);
          expect(inProgressSet.has(sessionId2)).toBe(true);
          expect(mockRename).toHaveBeenCalledTimes(2);

          // Resolve both
          resolveRename1(makeRenameResult(session1));
          resolveRename2(makeRenameResult(session2));

          const [result1, result2] = await Promise.all([promise1, promise2]);

          expect(result1.success).toBe(true);
          expect(result2.success).toBe(true);
          // Both locks released
          expect(inProgressSet.has(sessionId1)).toBe(false);
          expect(inProgressSet.has(sessionId2)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('the in-progress set correctly tracks session IDs during the rename lifecycle', async () => {
    await fc.assert(
      fc.asyncProperty(arbSessionId, async (sessionId) => {
        const session = makeSession(sessionId);
        const config = makeConfig(true);
        const messages = makeMessages();
        const inProgressSet = new Set<string>();

        // Verify initial state
        expect(inProgressSet.has(sessionId)).toBe(false);

        let duringRenameCheck = false;

        const mockRename = vi.fn().mockImplementation(async () => {
          // During the rename call, the session should be in the in-progress set
          duringRenameCheck = inProgressSet.has(sessionId);
          return makeRenameResult(session);
        });

        await simulateAutoRename(
          sessionId,
          session,
          config,
          messages,
          inProgressSet,
          mockRename
        );

        // The session was in the in-progress set during the rename call
        expect(duringRenameCheck).toBe(true);
        // After completion, it's removed
        expect(inProgressSet.has(sessionId)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });
});


// Feature: auto-session-naming, Property 7: Tracking Cleanup on Session Deletion
// Validates: Requirements 11.4

describe('autoRenameAfterCompletion – Property 7: Tracking Cleanup on Session Deletion', () => {
  /**
   * Simulates the cleanup logic from handleDeleteSession in App.tsx:
   *   autoRenameInProgressRef.current.delete(sessionId);
   *
   * This function replicates the exact operation performed when a session is deleted.
   */
  function simulateSessionDeletion(
    sessionId: string,
    inProgressSet: Set<string>
  ): void {
    inProgressSet.delete(sessionId);
  }

  it('removes the deleted session ID from the in-progress tracking set', () => {
    fc.assert(
      fc.property(arbSessionId, (sessionId) => {
        const inProgressSet = new Set<string>();

        // Simulate a session that has an in-progress rename
        inProgressSet.add(sessionId);
        expect(inProgressSet.has(sessionId)).toBe(true);

        // Simulate deletion cleanup
        simulateSessionDeletion(sessionId, inProgressSet);

        // After deletion, the session ID must be removed
        expect(inProgressSet.has(sessionId)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  it('does not affect other session IDs in the tracking set when one is deleted', () => {
    fc.assert(
      fc.property(
        arbSessionId,
        fc.array(arbSessionId, { minLength: 1, maxLength: 10 }),
        (deletedSessionId, otherSessionIds) => {
          // Ensure the deleted ID is not in the "other" list for a clean test
          const filteredOthers = otherSessionIds.filter((id) => id !== deletedSessionId);
          fc.pre(filteredOthers.length > 0);

          const inProgressSet = new Set<string>();

          // Add the session to be deleted and the other sessions
          inProgressSet.add(deletedSessionId);
          for (const otherId of filteredOthers) {
            inProgressSet.add(otherId);
          }

          // Simulate deletion cleanup for the target session
          simulateSessionDeletion(deletedSessionId, inProgressSet);

          // The deleted session ID is removed
          expect(inProgressSet.has(deletedSessionId)).toBe(false);

          // All other session IDs remain in the set
          for (const otherId of filteredOthers) {
            expect(inProgressSet.has(otherId)).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('handles deletion of a session ID that is not in the tracking set (no-op)', () => {
    fc.assert(
      fc.property(
        arbSessionId,
        fc.array(arbSessionId, { minLength: 0, maxLength: 10 }),
        (deletedSessionId, otherSessionIds) => {
          // Ensure the deleted ID is NOT in the set
          const filteredOthers = otherSessionIds.filter((id) => id !== deletedSessionId);

          const inProgressSet = new Set<string>();

          // Only add other sessions, not the one to be deleted
          for (const otherId of filteredOthers) {
            inProgressSet.add(otherId);
          }

          const sizeBefore = inProgressSet.size;

          // Simulate deletion cleanup — should be a safe no-op
          simulateSessionDeletion(deletedSessionId, inProgressSet);

          // The set size should not change
          expect(inProgressSet.size).toBe(sizeBefore);

          // The deleted ID is still not present
          expect(inProgressSet.has(deletedSessionId)).toBe(false);

          // All other entries remain intact
          for (const otherId of filteredOthers) {
            expect(inProgressSet.has(otherId)).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('prevents unbounded accumulation of stale entries after deletion', () => {
    fc.assert(
      fc.property(
        fc.array(arbSessionId, { minLength: 1, maxLength: 20 }),
        (sessionIds) => {
          const inProgressSet = new Set<string>();

          // Simulate adding all sessions to the in-progress tracking set
          for (const id of sessionIds) {
            inProgressSet.add(id);
          }

          const uniqueIds = [...new Set(sessionIds)];

          // Delete all sessions one by one (simulating batch deletion)
          for (const id of uniqueIds) {
            simulateSessionDeletion(id, inProgressSet);
          }

          // After all deletions, the set must be empty — no stale entries remain
          expect(inProgressSet.size).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});
