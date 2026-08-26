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
 * Preservation Property Tests — Agent MCP Tools Not Accessible
 *
 * Property 2 (Preservation): For any input where the bug condition does NOT
 * hold — a tool-less Agent message, an empty tool catalog, a non-tool-capable
 * model, or a message on the standard non-Agent chat surface — the code SHALL
 * produce the same observable result: the outgoing /api/chat body contains no
 * `tools` field, the model's text response streams token by token, thinking
 * content is separated identically, and sessions persist / derive titles
 * identically, with no error introduced by the tool machinery.
 *
 * OBSERVATION-FIRST: these tests were written by first observing the actual
 * behavior of the UNFIXED code and recording it as the baseline that must be
 * preserved. They are EXPECTED TO PASS on unfixed code and must continue to
 * pass after the fix.
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5
 */

// ─── Test Infrastructure (mirrors Task 1 conventions) ────────────────────────

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-plus-mcp-preserve-'));
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
    },
    getTokenDeltas() {
      return sentEvents
        .filter((e) => e.channel === AGENT_CHAT_CHANNELS.STREAM && e.payload?.type === 'chat-token')
        .map((e) => e.payload.delta);
    }
  };
}

/**
 * Mock MCP gateway. In the non-bug (preservation) domain the gateway must
 * never be dispatched to. It is wired in to prove that even when a gateway is
 * present, tool-less / empty-catalog inputs never touch it.
 */
function createMockMcpGateway() {
  const calls: Array<{ server: string; action: string; payload: any }> = [];
  return {
    dispatch: async (request: { server: string; action: string; payload?: any }) => {
      calls.push({ server: request.server, action: request.action, payload: request.payload });
      return { output: 'unexpected tool output' };
    },
    getCalls: () => calls,
    listTools: async () => []
  };
}

/**
 * Builds a fake fetchImpl returning scripted /api/chat streaming payloads.
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
    await new Promise((r) => setTimeout(r, 5));
  }
  return null;
}

const ENDPOINT = 'http://localhost:11434';

/** Builds a text-only model turn from an array of content chunks. */
function textTurn(chunks: string[]): any[] {
  const messages = chunks.map((c) => ({
    message: { role: 'assistant', content: c },
    done: false
  }));
  messages.push({
    message: { role: 'assistant', content: '' },
    done: true,
    total_duration: 100,
    eval_count: chunks.length
  } as any);
  return messages;
}

function setup(turns: any[][], opts: { withGateway?: boolean } = {}) {
  const statePath = createTempStatePath();
  const ipcMain = createMockIpcMain();
  const window = createMockMainWindow();
  const gateway = createMockMcpGateway();
  const scripted = createScriptedFetch(turns);

  const registerOptions: any = {
    statePath,
    fetchImpl: scripted.fetchImpl,
    defaultEndpoint: ENDPOINT
  };
  // Prove that even with a gateway wired, non-bug inputs never dispatch tools.
  if (opts.withGateway) {
    registerOptions.mcpGateway = gateway;
  }

  const api = registerAgentChatHandlers(ipcMain as any, window as any, registerOptions);
  const sendHandler = ipcMain.getHandler(AGENT_CHAT_CHANNELS.SEND_MESSAGE)!;

  return { statePath, ipcMain, window, gateway, scripted, api, sendHandler };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Property 2: Preservation — Non-Tool and Non-Agent Behavior Unchanged
// ═══════════════════════════════════════════════════════════════════════════════

describe('Agent MCP Tools Preservation (Property 2)', () => {
  // ── Req 3.2 / 3.1: outgoing body is { model, stream, messages } only ────────
  it('Empty catalog: outgoing /api/chat body omits `tools` entirely (Req 3.2)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 40 }).filter((s) => s.trim().length > 0),
        fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0),
        fc.array(fc.string({ minLength: 1, maxLength: 8 }), { minLength: 1, maxLength: 4 }),
        async (content, model, answerChunks) => {
          const { window, sendHandler, scripted } = setup([textTurn(answerChunks)], {
            withGateway: false
          });

          await sendHandler({}, {
            surface: 'agent',
            content,
            model,
            endpoint: ENDPOINT
          });

          const terminal = await waitForCompletion(window);
          expect(terminal?.type).toBe('chat-completed');

          const bodies = scripted.getRequestBodies();
          expect(bodies.length).toBe(1);

          const body = bodies[0];
          // Observed baseline: no `tools` field is ever attached.
          expect('tools' in body).toBe(false);
          // Observed baseline: body shape is exactly { model, stream, messages }.
          expect(Object.keys(body).sort()).toEqual(['messages', 'model', 'stream'].sort());
          expect(body.stream).toBe(true);
          expect(body.model).toBe(model.trim());
        }
      ),
      { numRuns: 25 }
    );
  });

  // ── Req 3.1: text streams token by token; deltas equal model content ────────
  it('Tool-less streaming: streamed token deltas equal the model content chunks (Req 3.1)', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Non-empty content chunks with no <think> markers.
        fc.array(
          fc.string({ minLength: 1, maxLength: 12 }).filter((s) => !s.includes('<') && s.trim().length > 0),
          { minLength: 1, maxLength: 5 }
        ),
        async (answerChunks) => {
          const { window, sendHandler } = setup([textTurn(answerChunks)], { withGateway: true });

          await sendHandler({}, {
            surface: 'agent',
            content: 'a tool-less question',
            model: 'llama3',
            endpoint: ENDPOINT
          });

          const terminal = await waitForCompletion(window);
          expect(terminal?.type).toBe('chat-completed');

          // Observed baseline: each non-empty content chunk becomes one token delta,
          // in order, and their concatenation equals the assistant message content.
          const deltas = window.getTokenDeltas();
          expect(deltas).toEqual(answerChunks);
          expect(terminal.assistantMessage.content).toBe(answerChunks.join(''));
          expect(terminal.assistantMessage.thinkingContent).toBeNull();
        }
      ),
      { numRuns: 25 }
    );
  });

  // ── Req 3.5: model with no tool_calls yields plain text without error ───────
  it('Non-tool-capable model: no tool_calls yields plain text answer without error (Req 3.5)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
        async (answer) => {
          const { window, gateway, sendHandler } = setup([textTurn([answer])], {
            withGateway: true
          });

          await sendHandler({}, {
            surface: 'agent',
            content: 'please answer',
            model: 'plain-model',
            endpoint: ENDPOINT
          });

          const terminal = await waitForCompletion(window);
          expect(terminal?.type).toBe('chat-completed');
          expect(terminal.assistantMessage.content).toBe(answer);
          // No tool_calls in the response => the gateway is never dispatched.
          expect(gateway.getCalls().length).toBe(0);
        }
      ),
      { numRuns: 20 }
    );
  });

  // ── Req 3.4: <think> separation is preserved ────────────────────────────────
  it('Thinking separation: <think>...</think> is extracted from the reply (Req 3.4)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 20 }).filter((s) => !s.includes('<') && s.trim().length > 0),
        fc.string({ minLength: 1, maxLength: 20 }).filter((s) => !s.includes('<') && s.trim().length > 0),
        async (thinking, reply) => {
          const full = `<think>${thinking}</think>${reply}`;
          const { window, sendHandler } = setup([textTurn([full])], { withGateway: true });

          await sendHandler({}, {
            surface: 'agent',
            content: 'think then answer',
            model: 'reasoning-model',
            endpoint: ENDPOINT
          });

          const terminal = await waitForCompletion(window);
          expect(terminal?.type).toBe('chat-completed');

          // Observed baseline: thinking content is separated out and the visible
          // message content has the <think> block removed.
          expect(terminal.assistantMessage.thinkingContent).toBe(thinking.trim());
          expect(terminal.assistantMessage.content).toBe(reply.trim());
        }
      ),
      { numRuns: 20 }
    );
  });

  // ── Req 3.4: session persistence and title derivation are preserved ─────────
  it('Session persistence & deriveTitle: session stores messages and derives a title (Req 3.4)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 120 }).filter((s) => s.trim().length > 0),
        fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
        async (content, answer) => {
          const { window, sendHandler, api } = setup([textTurn([answer])], {
            withGateway: true
          });

          const result: any = await sendHandler({}, {
            surface: 'agent',
            content,
            model: 'some-model',
            endpoint: ENDPOINT
          });

          const terminal = await waitForCompletion(window);
          expect(terminal?.type).toBe('chat-completed');

          const store = api.getSessionStore();
          const session = store.get(result.sessionId);
          expect(session).not.toBeNull();

          // Observed baseline: user + assistant messages persisted (count 2).
          expect(session.messageCount).toBe(2);
          expect(session.messages[0].role).toBe('user');
          expect(session.messages[0].content).toBe(content.trim());
          expect(session.messages[1].role).toBe('assistant');
          expect(session.messages[1].content).toBe(answer);

          // Observed baseline: title derived from first user message,
          // truncated to <= 63 chars (60 + "...") at a word boundary.
          const trimmed = content.trim();
          if (trimmed.length <= 60) {
            expect(session.title).toBe(trimmed);
          } else {
            expect(session.title.length).toBeLessThanOrEqual(63);
            expect(session.title.endsWith('...')).toBe(true);
          }
        }
      ),
      { numRuns: 25 }
    );
  });

  // ── Req 3.3: standard non-Agent chat surface is unchanged ───────────────────
  it('Non-Agent chat surface: agent-chat handlers do not register lang-runtime channels (Req 3.3)', () => {
    const { ipcMain } = setup([textTurn(['hi'])], { withGateway: true });

    // Observed baseline: registering agent-chat handlers touches only the
    // agent-chat:* channels. The standard chat surface lives entirely on the
    // lang-runtime:* channels via runtimeService and is never registered here.
    expect(ipcMain.getHandler('lang-runtime:send-chat-message')).toBeUndefined();
    expect(ipcMain.getHandler('lang-runtime:send-chat-message-stream')).toBeUndefined();

    // The agent-chat channels ARE registered.
    expect(typeof ipcMain.getHandler(AGENT_CHAT_CHANNELS.SEND_MESSAGE)).toBe('function');
  });
});
