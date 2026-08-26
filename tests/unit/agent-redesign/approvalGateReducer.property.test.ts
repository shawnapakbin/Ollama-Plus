/**
 * Property-based tests for approval gate state transitions.
 *
 * Feature: agent-page-redesign, Property 7: Approval gate state transitions are deterministic
 *
 * Validates: Requirements 4.4, 4.5
 *
 * For any ApprovalGateBlock in 'pending' state, clicking Approve SHALL transition it to
 * 'approved' state, and clicking Deny SHALL transition it to 'denied' state. No other
 * state transitions are possible from 'pending', and 'approved'/'denied' are terminal states.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { reduceGateAction } from '../../../src/utils/agent/approvalGateReducer';
import type { ApprovalGateState } from '../../../src/types/agentChat';

/**
 * Arbitrary for generating a valid ApprovalGateState with configurable status.
 */
const approvalGateStateArb = (status: 'pending' | 'approved' | 'denied') =>
  fc.record({
    gateId: fc.uuid(),
    action: fc.string({ minLength: 1, maxLength: 30 }),
    tool: fc.string({ minLength: 1, maxLength: 30 }),
    category: fc.constantFrom('file' as const, 'terminal' as const, 'browser' as const, 'http' as const, 'python' as const),
    params: fc.dictionary(fc.string({ minLength: 1, maxLength: 10 }), fc.jsonValue()),
    riskExplanation: fc.string({ minLength: 1, maxLength: 100 }),
    status: fc.constant(status),
    timestamp: fc.date({ min: new Date('2000-01-01'), max: new Date('2030-12-31'), noInvalidDate: true }).map((d) => d.toISOString()),
    afterMessageId: fc.oneof(fc.uuid(), fc.constant(null)),
  }) as fc.Arbitrary<ApprovalGateState>;

/**
 * Arbitrary for generating any action type.
 */
const actionArb = fc.constantFrom('approve' as const, 'deny' as const);

describe('Feature: agent-page-redesign, Property 7: Approval gate state transitions are deterministic', () => {
  /**
   * **Validates: Requirements 4.4**
   *
   * For any pending state, the 'approve' action SHALL transition it to 'approved'.
   */
  it('pending + approve → approved state', () => {
    fc.assert(
      fc.property(
        approvalGateStateArb('pending'),
        (state) => {
          const result = reduceGateAction(state, 'approve');
          expect(result.status).toBe('approved');
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 4.5**
   *
   * For any pending state, the 'deny' action SHALL transition it to 'denied'.
   */
  it('pending + deny → denied state', () => {
    fc.assert(
      fc.property(
        approvalGateStateArb('pending'),
        (state) => {
          const result = reduceGateAction(state, 'deny');
          expect(result.status).toBe('denied');
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 4.4, 4.5**
   *
   * For any approved state + any action, the state SHALL remain 'approved' (terminal).
   */
  it('approved state + any action → stays approved (terminal)', () => {
    fc.assert(
      fc.property(
        approvalGateStateArb('approved'),
        actionArb,
        (state, action) => {
          const result = reduceGateAction(state, action);
          expect(result.status).toBe('approved');
          // Terminal states return the same reference
          expect(result).toBe(state);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 4.4, 4.5**
   *
   * For any denied state + any action, the state SHALL remain 'denied' (terminal).
   */
  it('denied state + any action → stays denied (terminal)', () => {
    fc.assert(
      fc.property(
        approvalGateStateArb('denied'),
        actionArb,
        (state, action) => {
          const result = reduceGateAction(state, action);
          expect(result.status).toBe('denied');
          // Terminal states return the same reference
          expect(result).toBe(state);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 4.4, 4.5**
   *
   * For any pending state + any action, only the 'status' field SHALL change;
   * all other fields remain identical.
   */
  it('only status field changes; all other fields remain identical', () => {
    fc.assert(
      fc.property(
        approvalGateStateArb('pending'),
        actionArb,
        (state, action) => {
          const result = reduceGateAction(state, action);

          // All non-status fields should be preserved
          expect(result.gateId).toBe(state.gateId);
          expect(result.action).toBe(state.action);
          expect(result.tool).toBe(state.tool);
          expect(result.category).toBe(state.category);
          expect(result.params).toEqual(state.params);
          expect(result.riskExplanation).toBe(state.riskExplanation);
          expect(result.timestamp).toBe(state.timestamp);
          expect(result.afterMessageId).toBe(state.afterMessageId);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 4.4, 4.5**
   *
   * The function is pure: same inputs always produce same output (deterministic).
   */
  it('function is pure — same inputs always produce same output', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          approvalGateStateArb('pending'),
          approvalGateStateArb('approved'),
          approvalGateStateArb('denied')
        ),
        actionArb,
        (state, action) => {
          const result1 = reduceGateAction(state, action);
          const result2 = reduceGateAction(state, action);

          // Same inputs → same output
          expect(result1).toEqual(result2);
        }
      ),
      { numRuns: 100 }
    );
  });
});
