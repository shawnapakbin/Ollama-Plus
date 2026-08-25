/**
 * Step Output Preserver
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.0.3
 *
 * Provides a dedicated interface for step output preservation during recovery
 * operations (retries, re-plans, user interventions). Enforces the immutability
 * contract specified by Requirements 10.7 and 13.3:
 *
 * - All completed step outputs remain unchanged during error recovery sequences.
 * - The runtime store is flushed after each step completion.
 * - Retries and re-plans only affect pending or failed steps.
 *
 * This module can be used by the agentRuntime to wrap the execution loop's
 * step results with additional verification and persistence guarantees.
 *
 * Requirements: 10.7, 13.3
 */

// ─── Constants ───────────────────────────────────────────────────────────────

/** Immutable step result statuses that indicate completion. */
export const COMPLETED_STATUSES = Object.freeze(['completed', 'failed', 'skipped']);

// ─── Factory Function ────────────────────────────────────────────────────────

/**
 * Creates a StepOutputPreserver instance.
 *
 * The preserver wraps a runtime store (or any persistence layer) and provides:
 * - Immediate flush of each step result on completion
 * - A read-only snapshot of all preserved results
 * - Verification that no previously stored result has been mutated
 *
 * @param {Object} [deps] - Injected dependencies
 * @param {Object} [deps.runtimeStore] - Store with set(key, value) and get(key) methods
 * @param {string} [deps.sessionId] - The task session ID for namespacing stored results
 * @returns {Object} StepOutputPreserver interface
 */
export function createStepOutputPreserver(deps = {}) {
  const { runtimeStore, sessionId = '' } = deps;

  /** @type {ReadonlyArray<Object>} Internal frozen results array */
  let preservedResults = [];

  /** @type {Map<string, string>} Checksums for integrity verification */
  const checksums = new Map();

  // ─── Internal Helpers ────────────────────────────────────────────────────

  /**
   * Computes a simple structural checksum for a step result.
   * Used for integrity verification (detecting unexpected mutation).
   *
   * @param {Object} result - A frozen step result
   * @returns {string} JSON-based checksum string
   */
  function computeChecksum(result) {
    return JSON.stringify({
      stepId: result.stepId,
      status: result.status,
      output: result.output,
      error: result.error,
      startedAt: result.startedAt,
      completedAt: result.completedAt
    });
  }

  /**
   * Persists a result to the runtime store if available.
   *
   * @param {Object} result - The step result to persist
   */
  function flushToStore(result) {
    if (!runtimeStore || typeof runtimeStore.set !== 'function') return;

    const storeKey = `agent:session:${sessionId}:step:${result.stepId}`;
    try {
      runtimeStore.set(storeKey, result);
    } catch {
      // Store errors are non-fatal — result is preserved in memory
    }
  }

  // ─── Public Interface ──────────────────────────────────────────────────────

  /**
   * Records and preserves a step result.
   *
   * The result is frozen (if not already), stored in the internal array,
   * checksummed for integrity verification, and flushed to the runtime store.
   *
   * This is the onStepFlushed callback intended to be passed to createExecutionLoop.
   *
   * @param {Object} result - The step result to preserve
   */
  function preserve(result) {
    const frozen = Object.isFrozen(result) ? result : Object.freeze({ ...result });
    preservedResults = [...preservedResults, frozen];
    checksums.set(frozen.stepId, computeChecksum(frozen));
    flushToStore(frozen);
  }

  /**
   * Returns a read-only snapshot of all preserved step results.
   *
   * The returned array is a defensive copy. Individual results are frozen
   * and cannot be mutated by consumers.
   *
   * @returns {ReadonlyArray<Object>} Array of frozen step results
   */
  function getPreservedResults() {
    return [...preservedResults];
  }

  /**
   * Returns only completed (successful, failed, or skipped) step results.
   * These are the results guaranteed to be immutable during recovery.
   *
   * @returns {ReadonlyArray<Object>} Array of frozen completed step results
   */
  function getCompletedResults() {
    return preservedResults.filter(r => COMPLETED_STATUSES.includes(r.status));
  }

  /**
   * Verifies the integrity of all preserved step results.
   *
   * Checks that no result has been mutated since preservation by comparing
   * current structural checksums against stored checksums.
   *
   * @returns {{ valid: boolean, violations: string[] }} Verification result
   */
  function verifyIntegrity() {
    const violations = [];

    for (const result of preservedResults) {
      const storedChecksum = checksums.get(result.stepId);
      const currentChecksum = computeChecksum(result);

      if (storedChecksum !== currentChecksum) {
        violations.push(
          `Step "${result.stepId}" integrity violation: stored checksum does not match current state`
        );
      }

      if (!Object.isFrozen(result)) {
        violations.push(
          `Step "${result.stepId}" is not frozen — immutability contract violated`
        );
      }
    }

    return {
      valid: violations.length === 0,
      violations
    };
  }

  /**
   * Returns the count of preserved results.
   *
   * @returns {number}
   */
  function count() {
    return preservedResults.length;
  }

  /**
   * Retrieves a specific preserved result by step ID.
   *
   * @param {string} stepId - The step ID to look up
   * @returns {Object|null} The frozen step result, or null if not found
   */
  function getByStepId(stepId) {
    return preservedResults.find(r => r.stepId === stepId) || null;
  }

  return {
    preserve,
    getPreservedResults,
    getCompletedResults,
    verifyIntegrity,
    count,
    getByStepId
  };
}
