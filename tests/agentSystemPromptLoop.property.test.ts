import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  registerAgentChatHandlers,
  AGENT_CHAT_CHANNELS
} from '../electron/runtime/agent/agentChatHandlers.js';

/**
 * Agent System Prompts — System Message Position Across the Tool Loop
 *
 * Property 6: System message stays first across the tool-execution loop.
 *
 * For any scripted sequence of tool-call rounds followed by a final text turn,
 * every outgoing /api/chat request body has messages[0].role === 'system' and
 * contains exactly one role:'system' entry. This also covers the Req 7.3
 * re-invocation example: the Combined_System_Message remains first across every
 * tool-loop re-invocation.
 *
 * Validates: Requirements 4.5 (and covers Req 7.3)
 */

// Feature: agent-system-prompts, Property 6: For any scripted sequence of tool-call
// rounds followed by a final text turn, every outgoing /api/chat request body has
// messages[0].role === 'system' and contains exactly one role:'system' entry.

// ─── Shared test types ───────────────────────────────────────────────────────

type IpcHandler = (...args: unknown[]) => unknown;
type StreamEvent = { type?: string; [key: string]: unknown };
type ChatChunk = Record<string, unknown>;
type FetchOptions = { body?: string; [key: string]: unknown };

// ─── Test Infrastructure (mirrors agentMcpTools*.property.test.ts) ───────────

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-plus-sysprompt-loop-'));
  tempDirs.push(dir);
  return path.join(dir, 'state.json');
}

/** Mock ipcMain capturing registered handlers. */
function createMockIpcMain() {
  const handlers = new Map<string, IpcHandler>();
  return {
    handle(channel: string, handler: IpcHandler) {
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
  const sentEvents: Array<{ channel: string; payload: unknown }> = [];
  return {
    isDestroyed: () => false,
    webContents: {
      send(channel: string, payload: unknown) {
        sentEvents.push({ channel, payload });
      }
    },
    getStreamEvents(): StreamEvent[] {
      return sentEvents
        .filter((e) => e.channel === AGENT_CHAT_CHANNELS.STREAM)
        .map((e) => e.payload as StreamEvent);
    }
  };
}

/**
 * Mock MCP gateway that dispatches tool calls. Advertises a single tool so the
 * tool-execution loop is engaged whenever the model emits tool_calls.
 */
function createMockMcpGateway() {
  const calls: Array<{ server: string; action: string; payload: unknown }> = [];
  return {
    dispatch: async (request: { server: string; action: string; payload?: unknown }) => {
      calls.push({ server: request.server, action: request.action, payload: request.payload });
      return { output: 'tool output' };
    },
    getCalls: () => calls,
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
function createScriptedFetch(turns: ChatChunk[][]) {
  const requestBodies: Array<Record<string, unknown> | null> = [];
  let turnIndex = 0;

  const fetchImpl = async (_url: string, options: FetchOptions) => {
    try {
      requestBodies.push(JSON.parse(options.body ?? ''));
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
): Promise<StreamEvent | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const events = window.getStreamEvents();
    const terminal = events.find(
      (e) => e.type === 'chat-completed' || e.type === 'chat-error'
    );
    if (terminal) return terminal;
    await new Promise((r) => setTimeout(r, 5));
  }
  return null;
}

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
  { message: { role: 'assistant', content: 'Here is the final answer.' }, done: false },
  {
    message: { role: 'assistant', content: '' },
    done: true,
    total_duration: 42,
    eval_count: 7
  }
];

/**
 * Builds a scripted turn sequence: `rounds` tool-call turns followed by a final
 * text turn. Fresh copies avoid shared mutable state between fast-check runs.
 */
function scriptTurns(rounds: number): ChatChunk[][] {
  const turns: ChatChunk[][] = [];
  for (let i = 0; i < rounds; i += 1) {
    turns.push(JSON.parse(JSON.stringify(TOOL_CALL_TURN)));
  }
  turns.push(JSON.parse(JSON.stringify(FINAL_TEXT_TURN)));
  return turns;
}

function setup(turns: ChatChunk[][], master: string, systemPrompt: string) {
  const statePath = createTempStatePath();
  const ipcMain = createMockIpcMain();
  const window = createMockMainWindow();
  const gateway = createMockMcpGateway();
  const scripted = createScriptedFetch(turns);

  const api = registerAgentChatHandlers(ipcMain as unknown as Parameters<typeof registerAgentChatHandlers>[0], window as unknown as Parameters<typeof registerAgentChatHandlers>[1], {
    statePath,
    fetchImpl: scripted.fetchImpl,
    defaultEndpoint: ENDPOINT,
    mcpGateway: gateway,
    // Inject the persisted System_Prompt accessor and the Master_Prompt resolver.
    getChatConfig: () => ({ systemPrompt }),
    resolveMaster: () => master
  });

  const sendHandler = ipcMain.getHandler(AGENT_CHAT_CHANNELS.SEND_MESSAGE)!;

  return { statePath, ipcMain, window, gateway, scripted, api, sendHandler };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Property 6: System message stays first across the tool-execution loop
// ═══════════════════════════════════════════════════════════════════════════════

describe('Agent System Prompts — system message first across tool loop (Property 6)', () => {
  it('every /api/chat body has messages[0].role === system and exactly one system entry (Req 4.5, 7.3)', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Vary the Master_Prompt (kept non-empty so a system message is always
        // produced — Property 6 concerns the loop's positioning of that message).
        fc.string({ minLength: 1, maxLength: 40 }).filter((s) => s.trim().length > 0),
        // Vary the user-editable System_Prompt (may be empty).
        fc.string({ maxLength: 40 }),
        // Vary the number of tool rounds before the final text turn.
        fc.integer({ min: 1, max: 6 }),
        async (master, systemPrompt, rounds) => {
          const turns = scriptTurns(rounds);
          const { window, sendHandler, scripted } = setup(turns, master, systemPrompt);

          await sendHandler({}, {
            surface: 'agent',
            content: 'run the tools and answer',
            model: MODEL,
            endpoint: ENDPOINT
          });

          const terminal = await waitForCompletion(window);
          expect(terminal?.type).toBe('chat-completed');

          const bodies = scripted.getRequestBodies();
          // One /api/chat POST per tool round plus one for the final text turn.
          expect(bodies).toHaveLength(rounds + 1);

          for (const body of bodies) {
            const messages: Array<{ role?: string }> = Array.isArray(body?.messages)
              ? body.messages
              : [];
            // The Combined_System_Message must be first on every invocation.
            expect(messages[0]?.role).toBe('system');
            // Exactly one system entry — no re-prepend, no duplicate inside the loop.
            const systemEntries = messages.filter((m) => m?.role === 'system');
            expect(systemEntries).toHaveLength(1);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
