/**
 * Approval Gate Reducer
 *
 * Handles deterministic state transitions for approval gate blocks.
 * Pending gates can transition to approved or denied.
 * Approved and denied are terminal states — no further transitions are possible.
 */

import type { ApprovalGateState } from '../../types/agentChat';

/**
 * Reduces an approval gate action into a new state.
 *
 * State transitions:
 * - pending + approve → approved
 * - pending + deny → denied
 * - approved + any → approved (unchanged, terminal)
 * - denied + any → denied (unchanged, terminal)
 */
export function reduceGateAction(
  state: ApprovalGateState,
  action: 'approve' | 'deny'
): ApprovalGateState {
  // Terminal states are immutable — return unchanged
  if (state.status !== 'pending') {
    return state;
  }

  if (action === 'approve') {
    return { ...state, status: 'approved' };
  }

  return { ...state, status: 'denied' };
}
