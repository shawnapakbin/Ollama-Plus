/**
 * Approval Gate Handler
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.0.3
 *
 * Manages human-in-the-loop approval gates for high-risk operations.
 * Creates gates, processes approvals/denials, tracks denied actions for
 * exclusion from subsequent replans, and handles indefinite pause on timeout.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.7, 6.8
 */

import { randomUUID } from 'node:crypto';
import { classifyRisk } from './riskClassifier.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Maximum time to present an approval gate after risk classification (500ms). */
export const GATE_PRESENTATION_DEADLINE_MS = 500;

/** Maximum time to proceed after approval (1000ms). */
export const APPROVAL_PROCEED_DEADLINE_MS = 1000;

/** Gate status values. */
export const GATE_STATUS = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  DENIED: 'denied'
});

// ─── JSDoc Types ─────────────────────────────────────────────────────────────

/**
 * @typedef {Object} ApprovalGate
 * @property {string} id - Unique gate identifier (UUID)
 * @property {string} sessionId - Task session ID
 * @property {string} stepId - Step that triggered the gate
 * @property {string} action - Description of the proposed action
 * @property {string} tool - Tool to be invoked
 * @property {Record<string, unknown>} params - Input parameters for the tool call
 * @property {'high'} riskLevel - Always 'high' for approval gates
 * @property {string} riskExplanation - Why the operation is classified as high-risk
 * @property {'pending' | 'approved' | 'denied'} status - Current gate status
 * @property {string | null} decidedAt - ISO timestamp of decision
 * @property {string | null} denialReason - Reason for denial (if denied)
 * @property {string} createdAt - ISO timestamp of gate creation
 */

/**
 * @typedef {Object} DeniedAction
 * @property {string} tool - Tool that was denied
 * @property {string} action - Action that was denied
 * @property {Record<string, unknown>} params - Parameters that were denied
 * @property {string | null} reason - Reason for denial
 */

/**
 * @typedef {Object} GateHandlerConfig
 * @property {import('./riskClassifier.js').ApprovalRule[]} [customApprovalRules] - Custom approval rules
 * @property {string[]} [allowedHosts] - Allowed network hosts
 * @property {boolean} [autoApprovalLowRisk] - Whether low-risk operations auto-approve
 */

/**
 * @typedef {Object} GateDecisionResult
 * @property {'proceed' | 'skip' | 'replan'} action - What the execution loop should do
 * @property {ApprovalGate} gate - The resolved gate
 * @property {DeniedAction | null} deniedAction - Denied action info (for replan exclusion)
 */

// ─── Factory Function ────────────────────────────────────────────────────────

/**
 * Creates an ApprovalGateHandler instance.
 *
 * @param {Object} [options] - Configuration options
 * @param {Function} [options.onGateCreated] - Callback when a gate is created (gate) => void
 * @param {GateHandlerConfig} [options.config] - Risk classification config
 * @returns {Object} ApprovalGateHandler interface
 */
export function createApprovalGateHandler(options = {}) {
  const { onGateCreated, config = {} } = options;

  /** @type {Map<string, ApprovalGate>} Active gates indexed by gate ID */
  const gates = new Map();

  /** @type {Map<string, { resolve: Function }>} Pending gate resolvers indexed by gate ID */
  const pendingResolvers = new Map();

  /** @type {DeniedAction[]} Denied actions for this session (for replan exclusion) */
  const deniedActions = [];

  // ─── Gate Creation ───────────────────────────────────────────────────────

  /**
   * Evaluates whether an operation requires an approval gate.
   * If it does, creates the gate and emits the event within 500ms (Req 6.1).
   *
   * @param {Object} operation - The operation to evaluate
   * @param {string} operation.tool - Tool name
   * @param {string} operation.action - Action description
   * @param {Record<string, unknown>} operation.params - Tool parameters
   * @param {string} operation.workingDirectory - Authorized working directory
   * @param {string[]} [operation.affectedPaths] - Paths affected
   * @param {string} sessionId - Current task session ID
   * @param {string} stepId - Current step ID
   * @returns {{ required: boolean, gate: ApprovalGate | null }} Whether approval is required
   */
  function evaluateOperation(operation, sessionId, stepId) {
    const classificationStart = Date.now();

    const riskResult = classifyRisk(operation, {
      customApprovalRules: config.customApprovalRules || [],
      allowedHosts: config.allowedHosts || [],
      autoApprovalLowRisk: config.autoApprovalLowRisk || false
    });

    if (!riskResult.requiresApproval) {
      return { required: false, gate: null };
    }

    // Create the approval gate (Req 6.2: display action, tool, params, risk explanation)
    const gate = {
      id: randomUUID(),
      sessionId,
      stepId,
      action: operation.action || '',
      tool: operation.tool || '',
      params: operation.params || {},
      riskLevel: 'high',
      riskExplanation: riskResult.reason || 'Operation classified as high-risk.',
      status: GATE_STATUS.PENDING,
      decidedAt: null,
      denialReason: null,
      createdAt: new Date().toISOString()
    };

    gates.set(gate.id, gate);

    // Emit gate event within 500ms deadline (Req 6.1)
    const elapsed = Date.now() - classificationStart;
    if (elapsed < GATE_PRESENTATION_DEADLINE_MS) {
      // Still within deadline — emit immediately
      emitGateCreated(gate);
    } else {
      // Emit immediately regardless (best effort)
      emitGateCreated(gate);
    }

    return { required: true, gate };
  }

  /**
   * Creates an approval gate directly from a pre-classified operation.
   * Used when the risk classification has already been performed externally.
   *
   * @param {Object} gateData - Gate data
   * @param {string} gateData.sessionId
   * @param {string} gateData.stepId
   * @param {string} gateData.action
   * @param {string} gateData.tool
   * @param {Record<string, unknown>} gateData.params
   * @param {string} gateData.riskExplanation
   * @returns {ApprovalGate} The created gate
   */
  function createGate(gateData) {
    const gate = {
      id: randomUUID(),
      sessionId: gateData.sessionId || '',
      stepId: gateData.stepId || '',
      action: gateData.action || '',
      tool: gateData.tool || '',
      params: gateData.params || {},
      riskLevel: 'high',
      riskExplanation: gateData.riskExplanation || 'Operation classified as high-risk.',
      status: GATE_STATUS.PENDING,
      decidedAt: null,
      denialReason: null,
      createdAt: new Date().toISOString()
    };

    gates.set(gate.id, gate);
    emitGateCreated(gate);

    return gate;
  }

  /**
   * Emits the gate created event via the configured callback.
   *
   * @param {ApprovalGate} gate
   */
  function emitGateCreated(gate) {
    if (typeof onGateCreated === 'function') {
      try {
        onGateCreated(gate);
      } catch {
        // Non-fatal: gate is still tracked internally
      }
    }
  }

  // ─── Gate Resolution ─────────────────────────────────────────────────────

  /**
   * Waits for a gate to be resolved (approved or denied).
   * The gate will remain pending indefinitely if no decision is made (Req 6.7).
   *
   * @param {string} gateId - The gate ID to wait on
   * @returns {Promise<GateDecisionResult>} Resolves when the gate is decided
   */
  function waitForDecision(gateId) {
    const gate = gates.get(gateId);
    if (!gate) {
      return Promise.reject(new Error(`Gate not found: ${gateId}`));
    }

    // If already decided, return immediately
    if (gate.status === GATE_STATUS.APPROVED) {
      return Promise.resolve({
        action: 'proceed',
        gate,
        deniedAction: null
      });
    }

    if (gate.status === GATE_STATUS.DENIED) {
      const deniedAction = {
        tool: gate.tool,
        action: gate.action,
        params: gate.params,
        reason: gate.denialReason
      };
      return Promise.resolve({
        action: 'replan',
        gate,
        deniedAction
      });
    }

    // Gate is pending — wait indefinitely (Req 6.7: no timeout escalation)
    return new Promise((resolve) => {
      pendingResolvers.set(gateId, { resolve });
    });
  }

  /**
   * Approves a pending gate. The execution loop should proceed within 1 second (Req 6.3).
   *
   * @param {string} gateId - Gate to approve
   * @returns {GateDecisionResult} Decision result
   * @throws {Error} If gate not found or already decided
   */
  function approve(gateId) {
    const gate = gates.get(gateId);
    if (!gate) {
      throw new Error(`Gate not found: ${gateId}`);
    }
    if (gate.status !== GATE_STATUS.PENDING) {
      throw new Error(`Gate already decided: ${gate.status}`);
    }

    // Mark as approved (Req 6.3: proceed within 1s)
    gate.status = GATE_STATUS.APPROVED;
    gate.decidedAt = new Date().toISOString();

    const result = {
      action: 'proceed',
      gate: { ...gate },
      deniedAction: null
    };

    // Resolve any pending waiters
    const resolver = pendingResolvers.get(gateId);
    if (resolver) {
      pendingResolvers.delete(gateId);
      resolver.resolve(result);
    }

    return result;
  }

  /**
   * Denies a pending gate. Records the denial reason and adds to denied actions
   * list for replan exclusion (Req 6.4, Property 13).
   *
   * @param {string} gateId - Gate to deny
   * @param {string} [reason] - Reason for denial
   * @returns {GateDecisionResult} Decision result with denied action info
   * @throws {Error} If gate not found or already decided
   */
  function deny(gateId, reason = null) {
    const gate = gates.get(gateId);
    if (!gate) {
      throw new Error(`Gate not found: ${gateId}`);
    }
    if (gate.status !== GATE_STATUS.PENDING) {
      throw new Error(`Gate already decided: ${gate.status}`);
    }

    // Mark as denied (Req 6.4: skip denied action, record reason, allow replan)
    gate.status = GATE_STATUS.DENIED;
    gate.decidedAt = new Date().toISOString();
    gate.denialReason = reason;

    // Track denied action for replan exclusion (Property 13)
    const deniedAction = {
      tool: gate.tool,
      action: gate.action,
      params: { ...gate.params },
      reason
    };
    deniedActions.push(deniedAction);

    const result = {
      action: 'replan',
      gate: { ...gate },
      deniedAction
    };

    // Resolve any pending waiters
    const resolver = pendingResolvers.get(gateId);
    if (resolver) {
      pendingResolvers.delete(gateId);
      resolver.resolve(result);
    }

    return result;
  }

  // ─── Query Interface ─────────────────────────────────────────────────────

  /**
   * Gets a gate by its ID.
   *
   * @param {string} gateId
   * @returns {ApprovalGate | null}
   */
  function getGate(gateId) {
    const gate = gates.get(gateId);
    return gate ? { ...gate } : null;
  }

  /**
   * Gets all gates for a given session.
   *
   * @param {string} sessionId
   * @returns {ApprovalGate[]}
   */
  function getGatesForSession(sessionId) {
    const result = [];
    for (const gate of gates.values()) {
      if (gate.sessionId === sessionId) {
        result.push({ ...gate });
      }
    }
    return result;
  }

  /**
   * Gets all pending (undecided) gates.
   *
   * @returns {ApprovalGate[]}
   */
  function getPendingGates() {
    const result = [];
    for (const gate of gates.values()) {
      if (gate.status === GATE_STATUS.PENDING) {
        result.push({ ...gate });
      }
    }
    return result;
  }

  /**
   * Returns the list of all denied actions recorded in this handler instance.
   * Used by the Task Planner to exclude denied operations from subsequent replans
   * (Property 13: Denied action exclusion from re-plans).
   *
   * @returns {DeniedAction[]}
   */
  function getDeniedActions() {
    return [...deniedActions];
  }

  /**
   * Checks whether a proposed tool call matches any previously denied action.
   * This is used during replan validation to ensure denied actions are not
   * reintroduced (Property 13).
   *
   * Two actions are considered equivalent if they have the same tool, same action,
   * and deeply equal parameters.
   *
   * @param {Object} toolCall - Proposed tool call
   * @param {string} toolCall.tool - Tool name
   * @param {string} toolCall.action - Action name
   * @param {Record<string, unknown>} toolCall.params - Parameters
   * @returns {boolean} True if the tool call matches a denied action
   */
  function isDeniedAction(toolCall) {
    if (!toolCall) return false;

    for (const denied of deniedActions) {
      if (denied.tool === toolCall.tool && denied.action === toolCall.action) {
        // Check parameter equivalence
        if (paramsEqual(denied.params, toolCall.params)) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Clears all gates and denied actions. Used when a session ends.
   */
  function reset() {
    // Reject any pending waiters
    for (const [gateId, resolver] of pendingResolvers.entries()) {
      resolver.resolve({
        action: 'skip',
        gate: gates.get(gateId) || null,
        deniedAction: null
      });
    }
    pendingResolvers.clear();
    gates.clear();
    deniedActions.length = 0;
  }

  // ─── Public Interface ──────────────────────────────────────────────────────

  return {
    evaluateOperation,
    createGate,
    waitForDecision,
    approve,
    deny,
    getGate,
    getGatesForSession,
    getPendingGates,
    getDeniedActions,
    isDeniedAction,
    reset
  };
}

// ─── Utility Functions ───────────────────────────────────────────────────────

/**
 * Deep equality check for parameters objects.
 * Used to determine if two tool calls have equivalent parameters.
 *
 * @param {Record<string, unknown>} a
 * @param {Record<string, unknown>} b
 * @returns {boolean}
 */
function paramsEqual(a, b) {
  if (a === b) return true;
  if (!a || !b) return a === b;

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);

  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;

    const valA = a[key];
    const valB = b[key];

    if (typeof valA === 'object' && valA !== null && typeof valB === 'object' && valB !== null) {
      if (!paramsEqual(valA, valB)) return false;
    } else if (valA !== valB) {
      return false;
    }
  }

  return true;
}
