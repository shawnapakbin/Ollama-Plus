/**
 * MCP Tools Wiring — Sandbox enforcer ordering property test
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.1.0
 *
 * Property-based test asserting that the Tool_Dispatcher runs the
 * Sandbox_Enforcer's validation before any gateway dispatch. When validation
 * fails the dispatcher returns an `error` record with a non-null message and
 * never touches the gateway; when validation succeeds the dispatcher proceeds
 * to dispatch, and the enforcer is always invoked before the gateway.
 */
import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import {
  createToolDispatcher,
  TOOL_SERVER_MAP
} from '../../../electron/runtime/agent/toolDispatcher.js';

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/**
 * Tool categories that resolve to a real server via TOOL_SERVER_MAP, so a
 * successful validation can proceed all the way to dispatch.
 */
const mappedToolArb = fc.constantFrom(...Object.keys(TOOL_SERVER_MAP));

const actionArb = fc
  .string({ minLength: 1, maxLength: 50 })
  .filter((s) => s.trim().length > 0);

const paramsArb = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
  fc.oneof(fc.string({ maxLength: 100 }), fc.integer(), fc.boolean()),
  { minKeys: 0, maxKeys: 5 }
);

const toolCallArb = fc.record({
  tool: mappedToolArb,
  action: actionArb,
  params: paramsArb
});

/** Non-empty rejection reasons the enforcer might surface. */
const reasonArb = fc
  .string({ minLength: 1, maxLength: 80 })
  .filter((s) => s.trim().length > 0);

// Feature: mcp-tools-wiring, Property 16: Sandbox enforcer validates before dispatch
describe('Feature: mcp-tools-wiring, Property 16: Sandbox enforcer validates before dispatch', () => {
  /**
   * **Validates: Requirements 9.1, 9.2**
   *
   * When the enforcer rejects the tool call, the dispatcher SHALL return a
   * record with status `error` and a non-null message, and SHALL NOT dispatch
   * to the gateway.
   */
  it('rejection yields an error record with a non-null message and no dispatch (PBT)', async () => {
    await fc.assert(
      fc.asyncProperty(toolCallArb, reasonArb, async (toolCall, reason) => {
        const mcpGateway = vi.fn(() => Promise.resolve('gateway-output'));
        const validateToolCall = vi.fn(() => ({
          valid: false,
          reason,
          requiresApproval: false
        }));
        const dispatcher = createToolDispatcher({
          mcpGateway,
          sandboxEnforcer: { validateToolCall }
        });

        const record = await dispatcher.dispatch(toolCall);

        // Enforcer was consulted exactly once with the original tool call.
        expect(validateToolCall).toHaveBeenCalledTimes(1);
        expect(validateToolCall).toHaveBeenCalledWith(toolCall);

        // Rejection short-circuits before any dispatch.
        expect(mcpGateway).not.toHaveBeenCalled();

        // The record reports an error with a non-null, non-empty message.
        expect(record.status).toBe('error');
        expect(record.error).not.toBeNull();
        expect(typeof record.error).toBe('string');
        expect((record.error as string).length).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 9.1, 9.2**
   *
   * When the enforcer passes, the dispatcher SHALL dispatch to the gateway,
   * and the enforcer SHALL have been invoked before the gateway.
   */
  it('successful validation proceeds to dispatch, enforcer invoked before the gateway (PBT)', async () => {
    await fc.assert(
      fc.asyncProperty(toolCallArb, async (toolCall) => {
        const mcpGateway = vi.fn(() => Promise.resolve('gateway-output'));
        const validateToolCall = vi.fn((call) => ({
          valid: true,
          sanitizedCall: call
        }));
        const dispatcher = createToolDispatcher({
          mcpGateway,
          sandboxEnforcer: { validateToolCall }
        });

        const record = await dispatcher.dispatch(toolCall);

        // Both the enforcer and the gateway ran exactly once.
        expect(validateToolCall).toHaveBeenCalledTimes(1);
        expect(mcpGateway).toHaveBeenCalledTimes(1);

        // Ordering: the enforcer's invocation preceded the gateway's.
        const enforcerOrder = validateToolCall.mock.invocationCallOrder[0];
        const gatewayOrder = mcpGateway.mock.invocationCallOrder[0];
        expect(enforcerOrder).toBeLessThan(gatewayOrder);

        // A passing validation reaches a successful dispatch record.
        expect(record.status).toBe('success');
        expect(record.error).toBeNull();
      }),
      { numRuns: 100 }
    );
  });
});
