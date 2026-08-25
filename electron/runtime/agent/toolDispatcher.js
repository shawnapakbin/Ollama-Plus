/**
 * Tool Dispatcher
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.0.3
 *
 * Constructs MCP-conformant requests, validates tool calls through the sandbox
 * enforcer, dispatches to the MCP gateway with per-tool timeouts, and truncates
 * output to 10,000 characters.
 *
 * Supports tool categories: terminal, folder, browser/Playwright, Python sandbox, HTTP.
 */

import { truncateOutput, MAX_OUTPUT_LENGTH } from './outputFormatter.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Default per-tool timeout values in milliseconds.
 * @type {Record<string, number>}
 */
export const DEFAULT_TOOL_TIMEOUTS = {
  terminal: 60_000,
  file: 30_000,
  folder: 30_000,
  browser: 120_000,
  python: 60_000,
  http: 30_000
};

/**
 * Maps tool category names to their corresponding MCP server identifiers.
 * @type {Record<string, string>}
 */
export const TOOL_SERVER_MAP = {
  terminal: 'terminal',
  folder: 'folder',
  file: 'folder',
  browser: 'browser',
  python: 'python',
  http: 'http'
};

// ─── Tool Dispatcher ─────────────────────────────────────────────────────────

/**
 * Creates a new ToolDispatcher instance.
 *
 * @param {Object} options
 * @param {Function} options.mcpGateway - Gateway function: (server, action, payload) => Promise<result>
 * @param {Object} [options.sandboxEnforcer] - Sandbox enforcer instance (from createSandboxEnforcer)
 * @param {Object} [options.config] - Configuration with toolTimeouts
 * @param {Record<string, number>} [options.config.toolTimeouts] - Per-tool timeout overrides
 * @returns {Object} ToolDispatcher interface
 */
export function createToolDispatcher({ mcpGateway, sandboxEnforcer, config } = {}) {
  if (typeof mcpGateway !== 'function') {
    throw new Error('mcpGateway must be a function: (server, action, payload) => Promise<result>');
  }

  const toolTimeouts = {
    ...DEFAULT_TOOL_TIMEOUTS,
    ...(config && config.toolTimeouts ? config.toolTimeouts : {})
  };

  /**
   * Returns the configured timeout for a tool category.
   *
   * @param {string} tool - Tool category name (terminal, folder, browser, python, http)
   * @returns {number} Timeout in milliseconds
   */
  function getToolTimeout(tool) {
    if (!tool || typeof tool !== 'string') {
      return DEFAULT_TOOL_TIMEOUTS.terminal; // Safe fallback
    }
    const normalized = tool.toLowerCase();
    return toolTimeouts[normalized] !== undefined
      ? toolTimeouts[normalized]
      : DEFAULT_TOOL_TIMEOUTS.terminal;
  }

  /**
   * Constructs an MCP-conformant request object from a tool call intent.
   *
   * Per Property 8: The constructed MCP request SHALL contain a non-empty
   * `server` string, a non-empty `action` string, and a `payload` object
   * whose keys match the tool's declared parameter schema.
   *
   * @param {Object} toolCall - Tool call intent
   * @param {string} toolCall.tool - Tool category (terminal, folder, browser, python, http)
   * @param {string} [toolCall.server] - Explicit server override
   * @param {string} toolCall.action - Action to perform
   * @param {Record<string, unknown>} [toolCall.params] - Parameters for the action
   * @returns {Object} MCP request object with { server, action, payload }
   * @throws {Error} If server or action cannot be determined
   */
  function buildMcpRequest(toolCall) {
    if (!toolCall || typeof toolCall !== 'object') {
      throw new Error('Tool call must be an object.');
    }

    // Determine server: explicit override takes precedence, then map from tool category
    const server = toolCall.server
      || TOOL_SERVER_MAP[toolCall.tool]
      || '';

    if (!server || typeof server !== 'string' || server.trim().length === 0) {
      throw new Error(`Cannot determine MCP server for tool: "${toolCall.tool}". Provide a valid tool category or explicit server.`);
    }

    // Determine action
    const action = toolCall.action || '';
    if (!action || typeof action !== 'string' || action.trim().length === 0) {
      throw new Error('Tool call must include a non-empty action string.');
    }

    // Build payload from params
    const payload = toolCall.params && typeof toolCall.params === 'object'
      ? { ...toolCall.params }
      : {};

    return {
      server: server.trim(),
      action: action.trim(),
      payload
    };
  }

  /**
   * Wraps a promise with a timeout. If the promise does not resolve or reject
   * within the specified duration, the returned promise rejects with a timeout error.
   *
   * @param {Promise} promise - The promise to wrap
   * @param {number} timeoutMs - Timeout in milliseconds
   * @returns {Promise} Resolved value or rejection
   */
  function applyTimeout(promise, timeoutMs) {
    if (!promise || typeof promise.then !== 'function') {
      return Promise.reject(new Error('First argument must be a promise.'));
    }

    if (typeof timeoutMs !== 'number' || timeoutMs <= 0) {
      return promise;
    }

    let timer;
    const timeoutPromise = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(Object.assign(
          new Error(`Tool call timed out after ${timeoutMs}ms`),
          { code: 'TIMEOUT', timeoutMs }
        ));
      }, timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]).finally(() => {
      clearTimeout(timer);
    });
  }

  /**
   * Dispatches a tool call through the full pipeline:
   * 1. Validates via sandbox enforcer (if available)
   * 2. Constructs MCP request
   * 3. Dispatches to MCP gateway with timeout
   * 4. Truncates output to 10,000 characters
   * 5. Returns a ToolCallRecord
   *
   * @param {Object} toolCall - Tool call intent
   * @param {string} toolCall.tool - Tool category
   * @param {string} [toolCall.server] - Explicit server override
   * @param {string} toolCall.action - Action to perform
   * @param {Record<string, unknown>} [toolCall.params] - Parameters
   * @param {Object} [options] - Dispatch options
   * @param {string} [options.stepId] - Associated step ID for tracking
   * @returns {Promise<Object>} ToolCallRecord with status, output, duration, etc.
   */
  async function dispatch(toolCall, options = {}) {
    const startedAt = new Date().toISOString();
    const startTime = Date.now();
    const callId = generateId();
    const stepId = options.stepId || '';

    try {
      // Step 1: Sandbox validation (if enforcer is available)
      let validatedCall = toolCall;
      if (sandboxEnforcer && typeof sandboxEnforcer.validateToolCall === 'function') {
        const validation = sandboxEnforcer.validateToolCall(toolCall);
        if (!validation.valid) {
          const duration = Date.now() - startTime;
          return buildRecord({
            id: callId,
            tool: toolCall.tool || 'unknown',
            server: toolCall.server || TOOL_SERVER_MAP[toolCall.tool] || 'unknown',
            action: toolCall.action || '',
            params: toolCall.params || {},
            output: '',
            status: 'error',
            error: `Sandbox validation failed: ${validation.reason}`,
            duration,
            startedAt,
            completedAt: new Date().toISOString()
          });
        }
        // Use sanitized call from enforcer
        validatedCall = validation.sanitizedCall || toolCall;
      }

      // Step 2: Build MCP request
      const mcpRequest = buildMcpRequest(validatedCall);

      // Step 3: Determine timeout and dispatch
      const timeoutMs = getToolTimeout(validatedCall.tool || toolCall.tool);
      const gatewayPromise = mcpGateway(mcpRequest.server, mcpRequest.action, mcpRequest.payload);
      const result = await applyTimeout(gatewayPromise, timeoutMs);

      // Step 4: Extract and truncate output
      const rawOutput = extractOutput(result);
      const truncatedOutput = truncateOutput(rawOutput, MAX_OUTPUT_LENGTH);

      const duration = Date.now() - startTime;
      return buildRecord({
        id: callId,
        tool: mcpRequest.server,
        server: mcpRequest.server,
        action: mcpRequest.action,
        params: mcpRequest.payload,
        output: truncatedOutput,
        status: 'success',
        error: null,
        duration,
        startedAt,
        completedAt: new Date().toISOString()
      });
    } catch (err) {
      const duration = Date.now() - startTime;
      const isTimeout = err.code === 'TIMEOUT';

      return buildRecord({
        id: callId,
        tool: toolCall.tool || 'unknown',
        server: toolCall.server || TOOL_SERVER_MAP[toolCall.tool] || 'unknown',
        action: toolCall.action || '',
        params: toolCall.params || {},
        output: truncateOutput(err.partialOutput || '', MAX_OUTPUT_LENGTH),
        status: isTimeout ? 'timeout' : 'error',
        error: err.message || String(err),
        duration,
        startedAt,
        completedAt: new Date().toISOString()
      });
    }
  }

  return {
    dispatch,
    buildMcpRequest,
    applyTimeout,
    getToolTimeout
  };
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

/**
 * Extracts a string output from an MCP gateway result.
 * Handles various result shapes: string, { data }, { output }, { result }, etc.
 *
 * @param {unknown} result - Raw gateway result
 * @returns {string} Extracted output as a string
 */
function extractOutput(result) {
  if (result === null || result === undefined) {
    return '';
  }

  if (typeof result === 'string') {
    return result;
  }

  if (typeof result === 'object') {
    // Common MCP response shapes
    if (typeof result.data === 'string') return result.data;
    if (typeof result.output === 'string') return result.output;
    if (typeof result.result === 'string') return result.result;
    if (typeof result.stdout === 'string') return result.stdout;
    if (typeof result.content === 'string') return result.content;

    // If data is an object, serialize it
    if (result.data !== undefined) {
      return typeof result.data === 'object' ? JSON.stringify(result.data) : String(result.data);
    }

    // Fallback: serialize the whole result
    try {
      return JSON.stringify(result);
    } catch {
      return String(result);
    }
  }

  return String(result);
}

/**
 * Builds a ToolCallRecord object.
 *
 * @param {Object} fields - Record fields
 * @returns {Object} ToolCallRecord
 */
function buildRecord(fields) {
  return {
    id: fields.id,
    tool: fields.tool,
    server: fields.server,
    action: fields.action,
    params: fields.params,
    output: fields.output,
    status: fields.status,
    error: fields.error,
    duration: fields.duration,
    startedAt: fields.startedAt,
    completedAt: fields.completedAt
  };
}

/**
 * Generates a simple unique identifier for tool call records.
 *
 * @returns {string} UUID-like identifier
 */
function generateId() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return `tc_${timestamp}_${random}`;
}
