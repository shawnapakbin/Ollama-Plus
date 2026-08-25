import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  createToolDispatcher,
  DEFAULT_TOOL_TIMEOUTS,
  TOOL_SERVER_MAP
} from '../../../electron/runtime/agent/toolDispatcher.js';
import { MAX_OUTPUT_LENGTH } from '../../../electron/runtime/agent/outputFormatter.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Creates a mock MCP gateway that resolves with the provided output value.
 */
function createMockGateway(output: string | (() => string)) {
  return (_server: string, _action: string, _payload: object) =>
    Promise.resolve(typeof output === 'function' ? output() : output);
}

/**
 * Creates a mock MCP gateway that delays for a specified duration before resolving.
 */
function createDelayedGateway(delayMs: number, output = 'delayed-output') {
  return (_server: string, _action: string, _payload: object) =>
    new Promise<string>((resolve) => setTimeout(() => resolve(output), delayMs));
}

/**
 * Creates a mock sandbox enforcer that always accepts tool calls.
 */
function createAcceptingEnforcer() {
  return {
    validateToolCall: (call: any) => ({
      valid: true as const,
      sanitizedCall: call
    })
  };
}

/**
 * Creates a mock sandbox enforcer that always rejects tool calls.
 */
function createRejectingEnforcer(reason = 'Sandbox violation: path outside boundary') {
  return {
    validateToolCall: (_call: any) => ({
      valid: false as const,
      reason,
      requiresApproval: true
    })
  };
}

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/**
 * Generates a random string of a specified length range for output testing.
 */
const outputStringArb = fc.string({ minLength: 0, maxLength: 50000 });

/**
 * Generates a valid tool category name.
 */
const toolCategoryArb = fc.constantFrom('terminal', 'folder', 'file', 'browser', 'python', 'http');

/**
 * Generates a non-empty action string.
 */
const actionArb = fc.string({ minLength: 1, maxLength: 50 })
  .filter(s => s.trim().length > 0);

/**
 * Generates a random params object with string keys and string values.
 */
const paramsArb = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 20 }).filter(s => s.trim().length > 0),
  fc.oneof(
    fc.string({ maxLength: 100 }),
    fc.integer(),
    fc.boolean()
  ),
  { minKeys: 0, maxKeys: 5 }
);

/**
 * Generates a valid tool call object for testing buildMcpRequest.
 */
const toolCallArb = fc.record({
  tool: toolCategoryArb,
  action: actionArb,
  params: paramsArb
});

// ─── Property 7: Tool output truncation ──────────────────────────────────────

describe('Feature: agent-client, Property 7: Tool output truncation', () => {
  /**
   * **Validates: Requirements 4.3, 4.8**
   *
   * For any tool call output of length L characters, the stored and displayed
   * output SHALL have length min(L, 10000). If L > 10000, the output SHALL be
   * truncated to exactly 10,000 characters.
   */
  it('stored output length is min(L, 10000) for any output string (PBT)', async () => {
    await fc.assert(
      fc.asyncProperty(outputStringArb, async (rawOutput) => {
        const gateway = createMockGateway(rawOutput);
        const dispatcher = createToolDispatcher({ mcpGateway: gateway });

        const record = await dispatcher.dispatch({
          tool: 'terminal',
          action: 'exec',
          params: { command: 'echo test' }
        });

        const expectedLength = Math.min(rawOutput.length, MAX_OUTPUT_LENGTH);
        expect(record.output.length).toBe(expectedLength);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 4.3, 4.8**
   *
   * When output is truncated (L > 10000), the stored output is a prefix
   * of the original output string.
   */
  it('truncated output is always a prefix of the original (PBT)', async () => {
    await fc.assert(
      fc.asyncProperty(outputStringArb, async (rawOutput) => {
        const gateway = createMockGateway(rawOutput);
        const dispatcher = createToolDispatcher({ mcpGateway: gateway });

        const record = await dispatcher.dispatch({
          tool: 'folder',
          action: 'readFile',
          params: { path: '/test/file.ts' }
        });

        // The stored output must be a prefix of the original
        expect(rawOutput.startsWith(record.output)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 4.3, 4.8**
   *
   * Outputs at or below the max length are preserved unchanged.
   */
  it('outputs at or below MAX_OUTPUT_LENGTH are preserved unchanged (PBT)', async () => {
    const shortStringArb = fc.string({ minLength: 0, maxLength: MAX_OUTPUT_LENGTH });

    await fc.assert(
      fc.asyncProperty(shortStringArb, async (rawOutput) => {
        const gateway = createMockGateway(rawOutput);
        const dispatcher = createToolDispatcher({ mcpGateway: gateway });

        const record = await dispatcher.dispatch({
          tool: 'terminal',
          action: 'exec',
          params: { command: 'ls' }
        });

        expect(record.output).toBe(rawOutput);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 4.3, 4.8**
   *
   * Outputs exceeding MAX_OUTPUT_LENGTH are truncated to exactly 10,000 characters.
   */
  it('outputs exceeding MAX_OUTPUT_LENGTH are truncated to exactly 10000 chars (PBT)', async () => {
    const longStringArb = fc.string({ minLength: MAX_OUTPUT_LENGTH + 1, maxLength: 50000 });

    await fc.assert(
      fc.asyncProperty(longStringArb, async (rawOutput) => {
        const gateway = createMockGateway(rawOutput);
        const dispatcher = createToolDispatcher({ mcpGateway: gateway });

        const record = await dispatcher.dispatch({
          tool: 'python',
          action: 'execute',
          params: { code: 'print("hello")' }
        });

        expect(record.output.length).toBe(MAX_OUTPUT_LENGTH);
      }),
      { numRuns: 100 }
    );
  });
});

// ─── Property 8: MCP request schema conformance ──────────────────────────────

describe('Feature: agent-client, Property 8: MCP request schema conformance', () => {
  /**
   * **Validates: Requirements 4.2**
   *
   * For any tool call intent (specifying a tool name, action, and parameters),
   * the constructed MCP request SHALL contain a non-empty `server` string,
   * a non-empty `action` string, and a `payload` object whose keys match
   * the tool's declared parameter schema.
   */
  it('constructed MCP request has non-empty server, action, and matching payload keys (PBT)', () => {
    fc.assert(
      fc.property(toolCallArb, (toolCall) => {
        const gateway = createMockGateway('ok');
        const dispatcher = createToolDispatcher({ mcpGateway: gateway });

        const mcpRequest = dispatcher.buildMcpRequest(toolCall);

        // server must be a non-empty string
        expect(typeof mcpRequest.server).toBe('string');
        expect(mcpRequest.server.trim().length).toBeGreaterThan(0);

        // action must be a non-empty string
        expect(typeof mcpRequest.action).toBe('string');
        expect(mcpRequest.action.trim().length).toBeGreaterThan(0);

        // payload must be an object
        expect(typeof mcpRequest.payload).toBe('object');
        expect(mcpRequest.payload).not.toBeNull();

        // payload keys must match the params keys passed in
        const paramKeys = Object.keys(toolCall.params || {});
        const payloadKeys = Object.keys(mcpRequest.payload);
        expect(payloadKeys.sort()).toEqual(paramKeys.sort());
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 4.2**
   *
   * The server field maps correctly from tool category via TOOL_SERVER_MAP.
   */
  it('server field maps from tool category via TOOL_SERVER_MAP (PBT)', () => {
    fc.assert(
      fc.property(toolCallArb, (toolCall) => {
        const gateway = createMockGateway('ok');
        const dispatcher = createToolDispatcher({ mcpGateway: gateway });

        const mcpRequest = dispatcher.buildMcpRequest(toolCall);
        const expectedServer = TOOL_SERVER_MAP[toolCall.tool];

        expect(mcpRequest.server).toBe(expectedServer);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 4.2**
   *
   * The action field in the MCP request matches the action from the tool call.
   */
  it('action field in MCP request matches the tool call action (PBT)', () => {
    fc.assert(
      fc.property(toolCallArb, (toolCall) => {
        const gateway = createMockGateway('ok');
        const dispatcher = createToolDispatcher({ mcpGateway: gateway });

        const mcpRequest = dispatcher.buildMcpRequest(toolCall);

        expect(mcpRequest.action).toBe(toolCall.action.trim());
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 4.2**
   *
   * Explicit server override takes precedence over TOOL_SERVER_MAP.
   */
  it('explicit server override takes precedence over default mapping (PBT)', () => {
    const toolCallWithServerArb = fc.record({
      tool: toolCategoryArb,
      server: fc.string({ minLength: 1, maxLength: 30 }).filter(s => s.trim().length > 0),
      action: actionArb,
      params: paramsArb
    });

    fc.assert(
      fc.property(toolCallWithServerArb, (toolCall) => {
        const gateway = createMockGateway('ok');
        const dispatcher = createToolDispatcher({ mcpGateway: gateway });

        const mcpRequest = dispatcher.buildMcpRequest(toolCall);

        expect(mcpRequest.server).toBe(toolCall.server.trim());
      }),
      { numRuns: 100 }
    );
  });
});

// ─── Unit Tests: getToolTimeout ──────────────────────────────────────────────

describe('toolDispatcher - getToolTimeout', () => {
  it('returns correct timeout for terminal category', () => {
    const gateway = createMockGateway('ok');
    const dispatcher = createToolDispatcher({ mcpGateway: gateway });
    expect(dispatcher.getToolTimeout('terminal')).toBe(DEFAULT_TOOL_TIMEOUTS.terminal);
  });

  it('returns correct timeout for file category', () => {
    const gateway = createMockGateway('ok');
    const dispatcher = createToolDispatcher({ mcpGateway: gateway });
    expect(dispatcher.getToolTimeout('file')).toBe(DEFAULT_TOOL_TIMEOUTS.file);
  });

  it('returns correct timeout for folder category', () => {
    const gateway = createMockGateway('ok');
    const dispatcher = createToolDispatcher({ mcpGateway: gateway });
    expect(dispatcher.getToolTimeout('folder')).toBe(DEFAULT_TOOL_TIMEOUTS.folder);
  });

  it('returns correct timeout for browser category', () => {
    const gateway = createMockGateway('ok');
    const dispatcher = createToolDispatcher({ mcpGateway: gateway });
    expect(dispatcher.getToolTimeout('browser')).toBe(DEFAULT_TOOL_TIMEOUTS.browser);
  });

  it('returns correct timeout for python category', () => {
    const gateway = createMockGateway('ok');
    const dispatcher = createToolDispatcher({ mcpGateway: gateway });
    expect(dispatcher.getToolTimeout('python')).toBe(DEFAULT_TOOL_TIMEOUTS.python);
  });

  it('returns correct timeout for http category', () => {
    const gateway = createMockGateway('ok');
    const dispatcher = createToolDispatcher({ mcpGateway: gateway });
    expect(dispatcher.getToolTimeout('http')).toBe(DEFAULT_TOOL_TIMEOUTS.http);
  });

  it('returns terminal timeout as fallback for unknown category', () => {
    const gateway = createMockGateway('ok');
    const dispatcher = createToolDispatcher({ mcpGateway: gateway });
    expect(dispatcher.getToolTimeout('unknown')).toBe(DEFAULT_TOOL_TIMEOUTS.terminal);
  });

  it('returns terminal timeout for empty string', () => {
    const gateway = createMockGateway('ok');
    const dispatcher = createToolDispatcher({ mcpGateway: gateway });
    expect(dispatcher.getToolTimeout('')).toBe(DEFAULT_TOOL_TIMEOUTS.terminal);
  });

  it('respects custom timeout overrides', () => {
    const gateway = createMockGateway('ok');
    const dispatcher = createToolDispatcher({
      mcpGateway: gateway,
      config: { toolTimeouts: { terminal: 90_000 } }
    });
    expect(dispatcher.getToolTimeout('terminal')).toBe(90_000);
  });
});

// ─── Unit Tests: applyTimeout ────────────────────────────────────────────────

describe('toolDispatcher - applyTimeout', () => {
  it('resolves when promise completes before timeout', async () => {
    const gateway = createMockGateway('ok');
    const dispatcher = createToolDispatcher({ mcpGateway: gateway });

    const quickPromise = Promise.resolve('done');
    const result = await dispatcher.applyTimeout(quickPromise, 5000);
    expect(result).toBe('done');
  });

  it('rejects with TIMEOUT when promise exceeds timeout duration', async () => {
    const gateway = createMockGateway('ok');
    const dispatcher = createToolDispatcher({ mcpGateway: gateway });

    const slowPromise = new Promise((resolve) => setTimeout(resolve, 500, 'late'));

    await expect(dispatcher.applyTimeout(slowPromise, 50)).rejects.toMatchObject({
      code: 'TIMEOUT'
    });
  });

  it('rejects with error message containing timeout duration', async () => {
    const gateway = createMockGateway('ok');
    const dispatcher = createToolDispatcher({ mcpGateway: gateway });

    const slowPromise = new Promise((resolve) => setTimeout(resolve, 500, 'late'));

    await expect(dispatcher.applyTimeout(slowPromise, 50)).rejects.toThrow(/50ms/);
  });
});

// ─── Unit Tests: dispatch with sandbox enforcer ──────────────────────────────

describe('toolDispatcher - dispatch with sandbox enforcer', () => {
  it('returns error status when sandbox enforcer rejects', async () => {
    const gateway = createMockGateway('should not reach');
    const enforcer = createRejectingEnforcer('Path outside working directory');
    const dispatcher = createToolDispatcher({
      mcpGateway: gateway,
      sandboxEnforcer: enforcer
    });

    const record = await dispatcher.dispatch({
      tool: 'folder',
      action: 'writeFile',
      params: { path: '/etc/passwd', content: 'hacked' }
    });

    expect(record.status).toBe('error');
    expect(record.error).toContain('Sandbox validation failed');
    expect(record.error).toContain('Path outside working directory');
  });

  it('returns success when sandbox enforcer accepts', async () => {
    const gateway = createMockGateway('file content');
    const enforcer = createAcceptingEnforcer();
    const dispatcher = createToolDispatcher({
      mcpGateway: gateway,
      sandboxEnforcer: enforcer
    });

    const record = await dispatcher.dispatch({
      tool: 'folder',
      action: 'readFile',
      params: { path: '/project/src/index.ts' }
    });

    expect(record.status).toBe('success');
    expect(record.output).toBe('file content');
  });
});

// ─── Unit Tests: dispatch timeout handling ───────────────────────────────────

describe('toolDispatcher - dispatch timeout handling', () => {
  it('returns timeout status when gateway exceeds tool timeout', async () => {
    // Create a gateway that takes much longer than the timeout
    const gateway = createDelayedGateway(5000);
    const dispatcher = createToolDispatcher({
      mcpGateway: gateway,
      config: { toolTimeouts: { terminal: 50 } }
    });

    const record = await dispatcher.dispatch({
      tool: 'terminal',
      action: 'exec',
      params: { command: 'sleep 10' }
    });

    expect(record.status).toBe('timeout');
    expect(record.error).toContain('timed out');
  });

  it('includes duration in the returned record', async () => {
    const gateway = createMockGateway('fast result');
    const dispatcher = createToolDispatcher({ mcpGateway: gateway });

    const record = await dispatcher.dispatch({
      tool: 'terminal',
      action: 'exec',
      params: { command: 'echo hi' }
    });

    expect(typeof record.duration).toBe('number');
    expect(record.duration).toBeGreaterThanOrEqual(0);
  });

  it('includes timestamps in the returned record', async () => {
    const gateway = createMockGateway('result');
    const dispatcher = createToolDispatcher({ mcpGateway: gateway });

    const record = await dispatcher.dispatch({
      tool: 'http',
      action: 'get',
      params: { url: 'https://example.com' }
    });

    expect(record.startedAt).toBeTruthy();
    expect(record.completedAt).toBeTruthy();
    // Should be valid ISO strings
    expect(new Date(record.startedAt).toISOString()).toBe(record.startedAt);
    expect(new Date(record.completedAt).toISOString()).toBe(record.completedAt);
  });

  it('returns error status when gateway throws', async () => {
    const gateway = () => Promise.reject(new Error('Connection refused'));
    const dispatcher = createToolDispatcher({ mcpGateway: gateway });

    const record = await dispatcher.dispatch({
      tool: 'terminal',
      action: 'exec',
      params: { command: 'echo test' }
    });

    expect(record.status).toBe('error');
    expect(record.error).toContain('Connection refused');
  });
});
