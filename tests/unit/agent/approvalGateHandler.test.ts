import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  createApprovalGateHandler,
  GATE_STATUS,
  GATE_PRESENTATION_DEADLINE_MS,
  APPROVAL_PROCEED_DEADLINE_MS
} from '../../../electron/runtime/agent/approvalGateHandler.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeHighRiskOperation(overrides: Record<string, unknown> = {}) {
  return {
    tool: 'folder',
    action: 'delete',
    params: { path: '/project/src/file.ts' },
    workingDirectory: '/project',
    affectedPaths: ['/project/src/file.ts'],
    ...overrides
  };
}

function makeLowRiskOperation(overrides: Record<string, unknown> = {}) {
  return {
    tool: 'folder',
    action: 'read',
    params: { path: '/project/src/file.ts' },
    workingDirectory: '/project',
    affectedPaths: [],
    ...overrides
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('approvalGateHandler', () => {
  let handler: ReturnType<typeof createApprovalGateHandler>;
  let onGateCreated: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onGateCreated = vi.fn();
    handler = createApprovalGateHandler({ onGateCreated });
  });

  describe('evaluateOperation', () => {
    it('creates a gate for high-risk operations', () => {
      const operation = makeHighRiskOperation();
      const result = handler.evaluateOperation(operation, 'session-1', 'step-1');

      expect(result.required).toBe(true);
      expect(result.gate).not.toBeNull();
      expect(result.gate!.sessionId).toBe('session-1');
      expect(result.gate!.stepId).toBe('step-1');
      expect(result.gate!.status).toBe(GATE_STATUS.PENDING);
      expect(result.gate!.riskLevel).toBe('high');
    });

    it('does not create a gate for low-risk operations', () => {
      const operation = makeLowRiskOperation();
      const result = handler.evaluateOperation(operation, 'session-1', 'step-1');

      expect(result.required).toBe(false);
      expect(result.gate).toBeNull();
    });

    it('emits onGateCreated callback when gate is created (Req 6.1)', () => {
      const operation = makeHighRiskOperation();
      handler.evaluateOperation(operation, 'session-1', 'step-1');

      expect(onGateCreated).toHaveBeenCalledTimes(1);
      const gate = onGateCreated.mock.calls[0][0];
      expect(gate.sessionId).toBe('session-1');
      expect(gate.status).toBe(GATE_STATUS.PENDING);
    });

    it('gate includes proposed action, tool, params, and risk explanation (Req 6.2)', () => {
      const operation = makeHighRiskOperation({
        action: 'delete',
        tool: 'folder',
        params: { path: '/project/important.ts' }
      });
      const result = handler.evaluateOperation(operation, 'session-1', 'step-1');

      expect(result.gate!.action).toBe('delete');
      expect(result.gate!.tool).toBe('folder');
      expect(result.gate!.params).toEqual({ path: '/project/important.ts' });
      expect(result.gate!.riskExplanation).toBeTruthy();
      expect(result.gate!.riskExplanation.length).toBeGreaterThan(0);
    });

    it('applies custom approval rules from config', () => {
      const handlerWithRules = createApprovalGateHandler({
        onGateCreated,
        config: {
          customApprovalRules: [
            { id: 'rule-1', pattern: 'terminal:execute', type: 'glob', description: 'Block all terminal executions' }
          ]
        }
      });

      const operation = {
        tool: 'terminal',
        action: 'execute',
        params: { command: 'echo hello' },
        workingDirectory: '/project',
        affectedPaths: []
      };

      const result = handlerWithRules.evaluateOperation(operation, 'session-1', 'step-1');
      expect(result.required).toBe(true);
      expect(result.gate!.riskExplanation).toContain('custom approval rule');
    });

    it('gate presentation occurs within 500ms deadline (Req 6.1)', () => {
      const start = Date.now();
      const operation = makeHighRiskOperation();
      handler.evaluateOperation(operation, 'session-1', 'step-1');
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(GATE_PRESENTATION_DEADLINE_MS);
      expect(onGateCreated).toHaveBeenCalledTimes(1);
    });
  });

  describe('createGate', () => {
    it('creates a gate with specified data', () => {
      const gate = handler.createGate({
        sessionId: 'session-2',
        stepId: 'step-5',
        action: 'rm -rf node_modules',
        tool: 'terminal',
        params: { command: 'rm -rf node_modules' },
        riskExplanation: 'Deleting directory.'
      });

      expect(gate.id).toBeTruthy();
      expect(gate.sessionId).toBe('session-2');
      expect(gate.stepId).toBe('step-5');
      expect(gate.action).toBe('rm -rf node_modules');
      expect(gate.tool).toBe('terminal');
      expect(gate.status).toBe(GATE_STATUS.PENDING);
      expect(gate.riskExplanation).toBe('Deleting directory.');
      expect(gate.createdAt).toBeTruthy();
    });

    it('emits onGateCreated callback', () => {
      handler.createGate({
        sessionId: 'session-2',
        stepId: 'step-5',
        action: 'delete',
        tool: 'folder',
        params: {},
        riskExplanation: 'High risk.'
      });

      expect(onGateCreated).toHaveBeenCalledTimes(1);
    });
  });

  describe('approve', () => {
    it('marks gate as approved with timestamp (Req 6.3)', () => {
      const { gate } = handler.evaluateOperation(makeHighRiskOperation(), 'session-1', 'step-1');
      const result = handler.approve(gate!.id);

      expect(result.action).toBe('proceed');
      expect(result.gate.status).toBe(GATE_STATUS.APPROVED);
      expect(result.gate.decidedAt).toBeTruthy();
      expect(result.deniedAction).toBeNull();
    });

    it('resolves pending waitForDecision promise on approval', async () => {
      const { gate } = handler.evaluateOperation(makeHighRiskOperation(), 'session-1', 'step-1');

      // Start waiting
      const decisionPromise = handler.waitForDecision(gate!.id);

      // Approve the gate
      handler.approve(gate!.id);

      const result = await decisionPromise;
      expect(result.action).toBe('proceed');
      expect(result.gate.status).toBe(GATE_STATUS.APPROVED);
    });

    it('throws if gate not found', () => {
      expect(() => handler.approve('nonexistent')).toThrow('Gate not found');
    });

    it('throws if gate already decided', () => {
      const { gate } = handler.evaluateOperation(makeHighRiskOperation(), 'session-1', 'step-1');
      handler.approve(gate!.id);

      expect(() => handler.approve(gate!.id)).toThrow('already decided');
    });
  });

  describe('deny', () => {
    it('marks gate as denied with reason (Req 6.4)', () => {
      const { gate } = handler.evaluateOperation(makeHighRiskOperation(), 'session-1', 'step-1');
      const result = handler.deny(gate!.id, 'Too dangerous');

      expect(result.action).toBe('replan');
      expect(result.gate.status).toBe(GATE_STATUS.DENIED);
      expect(result.gate.decidedAt).toBeTruthy();
      expect(result.gate.denialReason).toBe('Too dangerous');
    });

    it('records denied action for replan exclusion (Property 13)', () => {
      const { gate } = handler.evaluateOperation(makeHighRiskOperation(), 'session-1', 'step-1');
      handler.deny(gate!.id, 'Not allowed');

      const deniedActions = handler.getDeniedActions();
      expect(deniedActions).toHaveLength(1);
      expect(deniedActions[0].tool).toBe('folder');
      expect(deniedActions[0].action).toBe('delete');
      expect(deniedActions[0].reason).toBe('Not allowed');
    });

    it('returns deniedAction in result for execution loop replan', () => {
      const { gate } = handler.evaluateOperation(makeHighRiskOperation(), 'session-1', 'step-1');
      const result = handler.deny(gate!.id, 'Blocked');

      expect(result.deniedAction).not.toBeNull();
      expect(result.deniedAction!.tool).toBe('folder');
      expect(result.deniedAction!.action).toBe('delete');
      expect(result.deniedAction!.reason).toBe('Blocked');
    });

    it('resolves pending waitForDecision promise on denial', async () => {
      const { gate } = handler.evaluateOperation(makeHighRiskOperation(), 'session-1', 'step-1');

      const decisionPromise = handler.waitForDecision(gate!.id);
      handler.deny(gate!.id, 'Denied by user');

      const result = await decisionPromise;
      expect(result.action).toBe('replan');
      expect(result.gate.status).toBe(GATE_STATUS.DENIED);
      expect(result.deniedAction!.reason).toBe('Denied by user');
    });

    it('allows denial without a reason', () => {
      const { gate } = handler.evaluateOperation(makeHighRiskOperation(), 'session-1', 'step-1');
      const result = handler.deny(gate!.id);

      expect(result.gate.denialReason).toBeNull();
      expect(result.deniedAction!.reason).toBeNull();
    });

    it('throws if gate not found', () => {
      expect(() => handler.deny('nonexistent')).toThrow('Gate not found');
    });

    it('throws if gate already decided', () => {
      const { gate } = handler.evaluateOperation(makeHighRiskOperation(), 'session-1', 'step-1');
      handler.deny(gate!.id);

      expect(() => handler.deny(gate!.id)).toThrow('already decided');
    });
  });

  describe('waitForDecision (Req 6.7 - indefinite wait)', () => {
    it('resolves immediately if gate is already approved', async () => {
      const { gate } = handler.evaluateOperation(makeHighRiskOperation(), 'session-1', 'step-1');
      handler.approve(gate!.id);

      const result = await handler.waitForDecision(gate!.id);
      expect(result.action).toBe('proceed');
    });

    it('resolves immediately if gate is already denied', async () => {
      const { gate } = handler.evaluateOperation(makeHighRiskOperation(), 'session-1', 'step-1');
      handler.deny(gate!.id, 'No way');

      const result = await handler.waitForDecision(gate!.id);
      expect(result.action).toBe('replan');
    });

    it('remains pending indefinitely without timeout (Req 6.7)', async () => {
      const { gate } = handler.evaluateOperation(makeHighRiskOperation(), 'session-1', 'step-1');

      // Create a race between the gate decision and a timeout
      let resolved = false;
      const decisionPromise = handler.waitForDecision(gate!.id).then((r) => {
        resolved = true;
        return r;
      });

      // Wait 50ms — should NOT have resolved (no auto-timeout)
      await new Promise(resolve => setTimeout(resolve, 50));
      expect(resolved).toBe(false);

      // Now approve to clean up
      handler.approve(gate!.id);
      await decisionPromise;
      expect(resolved).toBe(true);
    });

    it('rejects if gate does not exist', async () => {
      await expect(handler.waitForDecision('bad-id')).rejects.toThrow('Gate not found');
    });
  });

  describe('isDeniedAction (Property 13)', () => {
    it('returns true for a matching denied tool call', () => {
      const { gate } = handler.evaluateOperation(makeHighRiskOperation(), 'session-1', 'step-1');
      handler.deny(gate!.id, 'Blocked');

      const isBlocked = handler.isDeniedAction({
        tool: 'folder',
        action: 'delete',
        params: { path: '/project/src/file.ts' }
      });
      expect(isBlocked).toBe(true);
    });

    it('returns false for a different tool', () => {
      const { gate } = handler.evaluateOperation(makeHighRiskOperation(), 'session-1', 'step-1');
      handler.deny(gate!.id, 'Blocked');

      const isBlocked = handler.isDeniedAction({
        tool: 'terminal',
        action: 'delete',
        params: { path: '/project/src/file.ts' }
      });
      expect(isBlocked).toBe(false);
    });

    it('returns false for a different action', () => {
      const { gate } = handler.evaluateOperation(makeHighRiskOperation(), 'session-1', 'step-1');
      handler.deny(gate!.id, 'Blocked');

      const isBlocked = handler.isDeniedAction({
        tool: 'folder',
        action: 'read',
        params: { path: '/project/src/file.ts' }
      });
      expect(isBlocked).toBe(false);
    });

    it('returns false for different params', () => {
      const { gate } = handler.evaluateOperation(makeHighRiskOperation(), 'session-1', 'step-1');
      handler.deny(gate!.id, 'Blocked');

      const isBlocked = handler.isDeniedAction({
        tool: 'folder',
        action: 'delete',
        params: { path: '/project/src/other.ts' }
      });
      expect(isBlocked).toBe(false);
    });

    it('returns false when no actions have been denied', () => {
      const isBlocked = handler.isDeniedAction({
        tool: 'folder',
        action: 'delete',
        params: { path: '/project/src/file.ts' }
      });
      expect(isBlocked).toBe(false);
    });

    it('returns false for null/undefined input', () => {
      expect(handler.isDeniedAction(null as any)).toBe(false);
      expect(handler.isDeniedAction(undefined as any)).toBe(false);
    });

    it('tracks multiple denied actions', () => {
      // Deny first gate
      const { gate: gate1 } = handler.evaluateOperation(
        makeHighRiskOperation({ params: { path: '/project/file1.ts' } }),
        'session-1', 'step-1'
      );
      handler.deny(gate1!.id, 'First block');

      // Deny second gate
      const { gate: gate2 } = handler.evaluateOperation(
        makeHighRiskOperation({ action: 'rm', params: { path: '/project/file2.ts' } }),
        'session-1', 'step-2'
      );
      handler.deny(gate2!.id, 'Second block');

      expect(handler.getDeniedActions()).toHaveLength(2);
    });
  });

  describe('getGate / getGatesForSession / getPendingGates', () => {
    it('getGate returns gate by ID', () => {
      const { gate } = handler.evaluateOperation(makeHighRiskOperation(), 'session-1', 'step-1');
      const retrieved = handler.getGate(gate!.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(gate!.id);
      expect(retrieved!.sessionId).toBe('session-1');
    });

    it('getGate returns null for unknown ID', () => {
      expect(handler.getGate('nonexistent')).toBeNull();
    });

    it('getGatesForSession returns all gates for a session', () => {
      handler.evaluateOperation(makeHighRiskOperation(), 'session-1', 'step-1');
      handler.evaluateOperation(makeHighRiskOperation(), 'session-1', 'step-2');
      handler.evaluateOperation(makeHighRiskOperation(), 'session-2', 'step-3');

      const session1Gates = handler.getGatesForSession('session-1');
      expect(session1Gates).toHaveLength(2);

      const session2Gates = handler.getGatesForSession('session-2');
      expect(session2Gates).toHaveLength(1);
    });

    it('getPendingGates returns only undecided gates', () => {
      const { gate: gate1 } = handler.evaluateOperation(makeHighRiskOperation(), 'session-1', 'step-1');
      handler.evaluateOperation(makeHighRiskOperation(), 'session-1', 'step-2');
      handler.approve(gate1!.id);

      const pending = handler.getPendingGates();
      expect(pending).toHaveLength(1);
      expect(pending[0].stepId).toBe('step-2');
    });
  });

  describe('reset', () => {
    it('clears all gates and denied actions', () => {
      const { gate } = handler.evaluateOperation(makeHighRiskOperation(), 'session-1', 'step-1');
      handler.deny(gate!.id, 'Blocked');

      handler.reset();

      expect(handler.getGatesForSession('session-1')).toHaveLength(0);
      expect(handler.getDeniedActions()).toHaveLength(0);
      expect(handler.getPendingGates()).toHaveLength(0);
    });

    it('resolves pending waiters with skip action on reset', async () => {
      const { gate } = handler.evaluateOperation(makeHighRiskOperation(), 'session-1', 'step-1');
      const decisionPromise = handler.waitForDecision(gate!.id);

      handler.reset();

      const result = await decisionPromise;
      expect(result.action).toBe('skip');
    });
  });

  describe('Req 6.8 - Activity Stream indication on denial', () => {
    it('deny result includes sufficient data for Activity Stream display', () => {
      const { gate } = handler.evaluateOperation(makeHighRiskOperation(), 'session-1', 'step-1');
      const result = handler.deny(gate!.id, 'User said no');

      // The Activity Stream needs: confirmation that action was skipped + replan info
      expect(result.action).toBe('replan');
      expect(result.gate.status).toBe(GATE_STATUS.DENIED);
      expect(result.gate.denialReason).toBe('User said no');
      expect(result.deniedAction).not.toBeNull();
    });
  });

  describe('edge cases', () => {
    it('handles onGateCreated callback that throws', () => {
      const throwingHandler = createApprovalGateHandler({
        onGateCreated: () => { throw new Error('Callback error'); }
      });

      // Should not throw
      const result = throwingHandler.evaluateOperation(makeHighRiskOperation(), 'session-1', 'step-1');
      expect(result.required).toBe(true);
      expect(result.gate).not.toBeNull();
    });

    it('handles no onGateCreated callback provided', () => {
      const noCallbackHandler = createApprovalGateHandler();
      const result = noCallbackHandler.evaluateOperation(makeHighRiskOperation(), 'session-1', 'step-1');
      expect(result.required).toBe(true);
    });

    it('gate IDs are unique across multiple gates', () => {
      const { gate: gate1 } = handler.evaluateOperation(makeHighRiskOperation(), 'session-1', 'step-1');
      const { gate: gate2 } = handler.evaluateOperation(makeHighRiskOperation(), 'session-1', 'step-2');
      const { gate: gate3 } = handler.evaluateOperation(makeHighRiskOperation(), 'session-1', 'step-3');

      const ids = new Set([gate1!.id, gate2!.id, gate3!.id]);
      expect(ids.size).toBe(3);
    });
  });
});
