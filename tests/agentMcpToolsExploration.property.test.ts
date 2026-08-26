import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  registerAgentChatHandlers,
  AGENT_CHAT_CHANNELS
} from '../electron/runtime/agent/agentChatHandlers.js';

/**
 * Bug Condition Exploration Tests — Agent MCP Tools Not Accessible
 *
 * These tests encode the EXPECTED (correct) behavior for the bug described in
 * `.kiro/specs/agent-mcp-tools-not-accessible`. They are written BEFORE any fix
 * is implemented and are EXPECTED TO FAIL on unfixed code, confirming the bug
 * exists.
 *
 * Bug Condition (isBugCondition):
 *   input.surface == 'agent'
 *   AND availableMcpToolCount(endpoint) > 0
 *   AND modelSupportsToolCalling(model)
 *   AND (requestOmitsToolCatalog(input) OR modelToolCallIntentDiscarded(input))
 *
 * Property 1 (Expected Behavior): the conversational path SHALL advertise the
 * MCP tool catalog in the /api/chat request, honor message.tool_calls by
 * dispatching them through the MCP gateway, append each tool result as a
 * role:'tool' message, and re-invoke the model with the augmented transcript.
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-plus-mcp-tools-'));
  tempDirs.push(dir);
  return path.join(dir, 'state.json');
}

/** Mock ipcMain capturing registered handlers. */
function createMockIpcMain() {
  const handlers = new Map<string, Function>();
  return {
    handle(channel: string, handler: Function) {
      handlers.set(channel, handler);
    },
    removeHandler(channel: string) {
      handlers.delete(channel);
    },
    getHandler(channel: string) {
      return handlers.get(channel);
    }
  };
}

/** Mock BrowserWindow capturing streamed events. */
function createMockMainWindow() {
  const sentEvents: Array<{ channel: string; payload: any }> = [];
  return {
    isDestroyed: () => false,
    webContents: {
      send(channel: string, payload: any) {
        sentEvents.push({ channel, payload });
      }
    },
    getStreamEvents() {
      return sentEvents
        .filter((e) => e.channel === AGENT_CHAT_CHANNELS.STREAM)
        .map((e) => e.payload);
    }
  };
}

/** Mock MCP gateway recording dispatch calls. */
function createMockMcpGateway() {
  const calls: Array<{ server: string; action: string; payload: any }> = [];
  return {
    dispatch: async (request: { server: string; action: string; payload?: any }) => {
      calls.push({
        server: request.server,
        action: request.action,
        payload: request.payload
      });
      return { output: 'FILE CONTENTS: version 5.0.3' };
    },
    getCalls: () => calls,
    // Simulate an available MCP tool catalog for the conversational path.
    listTools: async () => [
      {
        name: 'folder_read_file',
        description: 'Read a file from the workspace folder',
        parameters: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path']
        }
      }
    ]
  };
}

/**
 * Builds a fake fetchImpl that returns scripted /api/chat streaming payloads.
 * Each element of `turns` is an array of NDJSON chunk objects for one model
 * invocation. Successive /api/chat POSTs consume successive turns.
 *
 * Records every outgoing request body for assertion.
 */
function createScriptedFetch(turns: any[][]) {
  const requestBodies: any[] = [];
  let turnIndex = 0;

  const fetchImpl = async (_url: string, options: any) => {
    try {
      requestBodies.push(JSON.parse(options.body));
    } catch {
      requestBodies.push(null);
    }

    const chunks = turns[Math.min(turnIndex, turns.length - 1)] || [];
    turnIndex += 1;

    const encoder = new TextEncoder();
    return {
      ok: true,
      body: new ReadableStream({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(encoder.encode(JSON.stringify(chunk) + '\n'));
          }
          controller.close();
        }
      })
    };
  };

  return {
    fetchImpl,
    getRequestBodies: () => requestBodies,
    getTurnCount: () => turnIndex
  };
}

/** Waits until a terminal chat event (completed or error) is observed. */
async function waitForCompletion(
  window: ReturnType<typeof createMockMainWindow>,
  timeoutMs = 2000
): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const events = window.getStreamEvents();
    const terminal = events.find(
      (e) => e.type === 'chat-completed' || e.type === 'chat-error'
    );
    if (terminal) return terminal;
    await new Promise((r) => setTimeout(r, 10));
  }
  return null;
}

// ─── Shared fixtures ─────────────────────────────────────────────────────────

const MODEL = 'qwen3.5:9b'; // tool-capable model
const ENDPOINT = 'http://localhost:11434';

/** A model turn that emits a tool call (no text content). */
const TOOL_CALL_TURN = [
  {
    message: {
      role: 'assistant',
      content: '',
      tool_calls: [
        {
          function: {
            name: 'folder_read_file',
            arguments: { path: 'package.json' }
          }
        }
      ]
    },
    done: false
  },
  { message: { role: 'assistant', content: '' }, done: true }
];

/** A final text turn (no tool calls). */
const FINAL_TEXT_TURN = [
  { message: { role: 'assistant', content: 'The version is 5.0.3.' }, done: false },
  {
    message: { role: 'assistant', content: '' },
    done: true,
    total_duration: 42,
    eval_count: 7
  }
];

function setup(turns: any[][]) {
  const statePath = createTempStatePath();
  const ipcMain = createMockIpcMain();
  const window = createMockMainWindow();
  const gateway = createMockMcpGateway();
  const scripted = createScriptedFetch(turns);

  const api = registerAgentChatHandlers(ipcMain as any, window as any, {
    statePath,
    fetchImpl: scripted.fetchImpl,
    defaultEndpoint: ENDPOINT,
    // The fix threads the gateway through here; on unfixed code this is ignored.
    mcpGateway: gateway
  });

  const sendHandler = ipcMain.getHandler(AGENT_CHAT_CHANNELS.SEND_MESSAGE)!;

  return { statePath, ipcMain, window, gateway, scripted, api, sendHandler };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Property 1: Bug Condition — MCP Tools Advertised, Invoked, and Fed Back
// ═══════════════════════════════════════════════════════════════════════════════

describe('Agent MCP Tools Exploration (Property 1)', () => {
  // 1. Catalog Advertised Test
  it('Catalog Advertised: outgoing /api/chat body includes a tools array (Req 1.1, 2.1)', async () => {
    const { window, sendHandler, scripted } = setup([FINAL_TEXT_TURN]);

    await sendHandler({}, {
      surface: 'agent',
      content: 'read package.json and tell me the version',
      model: MODEL,
      endpoint: ENDPOINT
    });

    const terminal = await waitForCompletion(window);
    expect(terminal, 'expected a terminal chat event').not.toBeNull();

    const bodies = scripted.getRequestBodies();
    expect(bodies.length).toBeGreaterThan(0);

    // EXPECTED BEHAVIOR: the model must be told which tools are available.
    // On unfixed code the body is only { model, stream, messages } — no tools.
    expect(Array.isArray(bodies[0].tools)).toBe(true);
    expect(bodies[0].tools.length).toBeGreaterThan(0);
  });

  // 2. Tool Call Honored Test
  it('Tool Call Honored: scripted message.tool_calls dispatch through the gateway (Req 1.2, 1.3, 2.2, 2.3)', async () => {
    const { window, gateway, sendHandler } = setup([TOOL_CALL_TURN, FINAL_TEXT_TURN]);

    await sendHandler({}, {
      surface: 'agent',
      content: 'read package.json and tell me the version',
      model: MODEL,
      endpoint: ENDPOINT
    });

    await waitForCompletion(window);

    // EXPECTED BEHAVIOR: the model's tool_calls are honored and dispatched.
    // On unfixed code tool_calls are discarded → zero gateway dispatches.
    const calls = gateway.getCalls();
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]).toMatchObject({
      server: 'folder',
      action: 'read_file'
    });
    expect(calls[0].payload).toMatchObject({ path: 'package.json' });
  });

  // 3. Tool Result Fed Back Test
  it('Tool Result Fed Back: a role:tool message is appended and the model is re-invoked (Req 2.3, 2.4)', async () => {
    const { window, sendHandler, scripted } = setup([TOOL_CALL_TURN, FINAL_TEXT_TURN]);

    await sendHandler({}, {
      surface: 'agent',
      content: 'read package.json and tell me the version',
      model: MODEL,
      endpoint: ENDPOINT
    });

    await waitForCompletion(window);

    const bodies = scripted.getRequestBodies();

    // EXPECTED BEHAVIOR: after a tool call, the model is re-invoked with the
    // augmented transcript. On unfixed code there is only ONE invocation and no
    // tool message is ever appended.
    expect(bodies.length).toBeGreaterThanOrEqual(2);

    const secondTurnMessages = bodies[1].messages || [];
    const toolMessages = secondTurnMessages.filter((m: any) => m.role === 'tool');
    expect(toolMessages.length).toBeGreaterThan(0);
  });

  // 4. Gateway Wiring Test
  it('Gateway Wiring: an action requiring a tool actually invokes the MCP tool (Req 1.4, 2.2)', async () => {
    const { window, gateway, sendHandler } = setup([TOOL_CALL_TURN, FINAL_TEXT_TURN]);

    const result = await sendHandler({}, {
      surface: 'agent',
      content: 'read the file and summarize it',
      model: MODEL,
      endpoint: ENDPOINT
    });

    expect(result).toMatchObject({ sessionId: expect.any(String) });

    const terminal = await waitForCompletion(window);
    expect(terminal?.type).toBe('chat-completed');

    // EXPECTED BEHAVIOR: performing a tool-requiring action results in at least
    // one MCP tool invocation. On unfixed code the gateway is never wired into
    // the conversational path, so no dispatch occurs.
    expect(gateway.getCalls().length).toBeGreaterThan(0);
  });
});
