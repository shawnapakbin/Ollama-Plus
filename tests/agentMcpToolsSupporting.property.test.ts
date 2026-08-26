import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  registerAgentChatHandlers,
  AGENT_CHAT_CHANNELS
} from '../electron/runtime/agent/agentChatHandlers.js';
import { requestOllamaChatStream } from '../electron/runtime/ollamaClient.js';

/**
 * Supporting property-based tests — Agent MCP Tools Not Accessible (Task 4)
 *
 *  1. Random transcripts + tool catalogs: the outgoing /api/chat body includes
 *     exactly the advertised tools when the catalog is non-empty, and omits
 *     `tools` entirely when empty.
 *  2. Random sequences of scripted model turns (mix of tool-call and final-text
 *     turns): every tool call is dispatched exactly once and the loop
 *     terminates at the first tool-less turn.
 *  3. Random non-tool inputs: the fixed send routine's outgoing request and
 *     streamed output equal the original's (no `tools` field, identical tokens).
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 3.1, 3.2
 */

// ─── Infrastructure ──────────────────────────────────────────────────────────

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createTempStatePath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-plus-mcp-supporting-'));
  tempDirs.push(dir);
  return path.join(dir, 'state.json');
}

function createMockIpcMain() {
  const handlers = new Map<string, Function>();
  return {
    handle(channel: string, handler: Function) { handlers.set(channel, handler); },
    removeHandler(channel: string) { handlers.delete(channel); },
    getHandler(channel: string) { return handlers.get(channel); }
  };
}

function createMockMainWindow() {
  const sentEvents: Array<{ channel: string; payload: any }> = [];
  return {
    isDestroyed: () => false,
    webContents: {
      send(channel: string, payload: any) { sentEvents.push({ channel, payload }); }
    },
    getStreamEvents() {
      return sentEvents
        .filter((e) => e.channel === AGENT_CHAT_CHANNELS.STREAM)
        .map((e) => e.payload);
    }
  };
}

function createMockMcpGateway(tools: any[]) {
  const calls: Array<{ server: string; action: string; payload: any }> = [];
  return {
    dispatch: async (request: { server: string; action: string; payload?: any }) => {
      calls.push({ server: request.server, action: request.action, payload: request.payload });
      return { output: 'ok' };
    },
    getCalls: () => calls,
    listTools: async () => tools
  };
}

function createScriptedFetch(turns: any[][]) {
  const requestBodies: any[] = [];
  let turnIndex = 0;
  const fetchImpl = async (_url: string, options: any) => {
    try { requestBodies.push(JSON.parse(options.body)); } catch { requestBodies.push(null); }
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
  return { fetchImpl, getRequestBodies: () => requestBodies, getTurnCount: () => turnIndex };
}

async function waitForCompletion(
  window: ReturnType<typeof createMockMainWindow>,
  timeoutMs = 4000
): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const events = window.getStreamEvents();
    const terminal = events.find((e) => e.type === 'chat-completed' || e.type === 'chat-error');
    if (terminal) return terminal;
    await new Promise((r) => setTimeout(r, 5));
  }
  return null;
}

const ENDPOINT = 'http://localhost:11434';
const MODEL = 'qwen3.5:9b';

function finalTextTurn(text: string): any[] {
  return [
    { message: { role: 'assistant', content: text }, done: false },
    { message: { role: 'assistant', content: '' }, done: true, eval_count: 3 }
  ];
}

function toolCallTurn(toolName: string): any[] {
  return [
    {
      message: {
        role: 'assistant',
        content: '',
        tool_calls: [{ function: { name: toolName, arguments: {} } }]
      },
      done: false
    },
    { message: { role: 'assistant', content: '' }, done: true }
  ];
}

// ─── Generators ──────────────────────────────────────────────────────────────

/** Arbitrary for a valid <server>_<action> MCP tool name. */
const toolNameArb = fc
  .tuple(
    fc.constantFrom('folder', 'terminal', 'browser', 'python', 'http'),
    fc.stringMatching(/^[a-z][a-z_]{0,10}$/)
  )
  .map(([server, action]) => `${server}_${action}`);

/** Arbitrary for a tool catalog (list of MCP tool descriptors) of given size. */
function catalogArb(minLength: number, maxLength: number) {
  return fc
    .uniqueArray(toolNameArb, { minLength, maxLength })
    .map((names) =>
      names.map((name) => ({
        name,
        description: `tool ${name}`,
        parameters: { type: 'object', properties: {} }
      }))
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Property A: outgoing body advertises exactly the catalog when non-empty,
// and omits `tools` entirely when empty (Req 2.1, 3.2)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Property A: advertised tools match the catalog exactly (Req 2.1, 3.2)', () => {
  it('non-empty catalog: body.tools names equal the catalog names', async () => {
    await fc.assert(
      fc.asyncProperty(
        catalogArb(1, 5),
        fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0),
        async (catalog, content) => {
          const gateway = createMockMcpGateway(catalog);
          const statePath = createTempStatePath();
          const ipcMain = createMockIpcMain();
          const window = createMockMainWindow();
          const scripted = createScriptedFetch([finalTextTurn('answer')]);
          registerAgentChatHandlers(ipcMain as any, window as any, {
            statePath,
            fetchImpl: scripted.fetchImpl,
            defaultEndpoint: ENDPOINT,
            mcpGateway: gateway
          });
          const sendHandler = ipcMain.getHandler(AGENT_CHAT_CHANNELS.SEND_MESSAGE)!;

          await sendHandler({}, { surface: 'agent', content, model: MODEL, endpoint: ENDPOINT });
          await waitForCompletion(window);

          const body = scripted.getRequestBodies()[0];
          expect(Array.isArray(body.tools)).toBe(true);
          const advertised = body.tools.map((t: any) => t.function.name).sort();
          const expected = catalog.map((t) => t.name).sort();
          expect(advertised).toEqual(expected);
        }
      ),
      { numRuns: 20 }
    );
  });

  it('empty catalog: body omits tools entirely', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0),
        async (content) => {
          const gateway = createMockMcpGateway([]);
          const statePath = createTempStatePath();
          const ipcMain = createMockIpcMain();
          const window = createMockMainWindow();
          const scripted = createScriptedFetch([finalTextTurn('answer')]);
          registerAgentChatHandlers(ipcMain as any, window as any, {
            statePath,
            fetchImpl: scripted.fetchImpl,
            defaultEndpoint: ENDPOINT,
            mcpGateway: gateway
          });
          const sendHandler = ipcMain.getHandler(AGENT_CHAT_CHANNELS.SEND_MESSAGE)!;

          await sendHandler({}, { surface: 'agent', content, model: MODEL, endpoint: ENDPOINT });
          await waitForCompletion(window);

          const body = scripted.getRequestBodies()[0];
          expect('tools' in body).toBe(false);
        }
      ),
      { numRuns: 20 }
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Property B: every tool call dispatched exactly once; loop terminates at the
// first tool-less turn (Req 2.2, 2.3)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Property B: tool calls dispatched once; loop stops at first tool-less turn (Req 2.2, 2.3)', () => {
  it('dispatches exactly one call per preceding tool-call turn and stops at the final turn', async () => {
    await fc.assert(
      fc.asyncProperty(
        // A sequence of tool names, each becomes one tool-call turn, then a final text turn.
        fc.array(toolNameArb, { minLength: 0, maxLength: 5 }),
        async (toolNames) => {
          // Advertise the union of tool names so the catalog is non-empty when there are calls.
          const catalog = Array.from(new Set(toolNames)).map((name) => ({
            name,
            description: name,
            parameters: { type: 'object', properties: {} }
          }));
          // If no tool calls, advertise a dummy tool so the loop is enabled but never entered.
          if (catalog.length === 0) {
            catalog.push({ name: 'folder_noop', description: 'noop', parameters: { type: 'object', properties: {} } });
          }
          const gateway = createMockMcpGateway(catalog);

          const turns: any[][] = toolNames.map((n) => toolCallTurn(n));
          turns.push(finalTextTurn('final answer'));

          const statePath = createTempStatePath();
          const ipcMain = createMockIpcMain();
          const window = createMockMainWindow();
          const scripted = createScriptedFetch(turns);
          registerAgentChatHandlers(ipcMain as any, window as any, {
            statePath,
            fetchImpl: scripted.fetchImpl,
            defaultEndpoint: ENDPOINT,
            mcpGateway: gateway
          });
          const sendHandler = ipcMain.getHandler(AGENT_CHAT_CHANNELS.SEND_MESSAGE)!;

          await sendHandler({}, { surface: 'agent', content: 'go', model: MODEL, endpoint: ENDPOINT });
          const terminal = await waitForCompletion(window);

          expect(terminal?.type).toBe('chat-completed');
          // Exactly one dispatch per tool-call turn.
          expect(gateway.getCalls()).toHaveLength(toolNames.length);
          // Model invoked once per tool-call turn plus the final tool-less turn.
          expect(scripted.getTurnCount()).toBe(toolNames.length + 1);
          // Final answer is the tool-less turn's text.
          expect(terminal.assistantMessage.content).toBe('final answer');
        }
      ),
      { numRuns: 20 }
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Property C: non-tool inputs — fixed send routine matches the original's
// outgoing request and streamed output (Req 3.1, 3.2)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Property C: non-tool inputs — request and stream match the no-tools baseline (Req 3.1, 3.2)', () => {
  it('outgoing body and streamed tokens are identical to a direct tool-less requestOllamaChatStream', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.string({ minLength: 1, maxLength: 10 }).filter((s) => !s.includes('<') && s.trim().length > 0),
          { minLength: 1, maxLength: 5 }
        ),
        fc.string({ minLength: 1, maxLength: 30 }).filter((s) => s.trim().length > 0),
        async (answerChunks, content) => {
          // Build a single text turn from the answer chunks.
          const turn = [
            ...answerChunks.map((c) => ({ message: { role: 'assistant', content: c }, done: false })),
            { message: { role: 'assistant', content: '' }, done: true, eval_count: answerChunks.length }
          ];

          // ── Baseline: call requestOllamaChatStream directly with NO tools. ──
          const baselineBodies: any[] = [];
          const baselineDeltas: string[] = [];
          const baselineFetch = async (_url: string, options: any) => {
            baselineBodies.push(JSON.parse(options.body));
            const encoder = new TextEncoder();
            return {
              ok: true,
              body: new ReadableStream({
                start(controller) {
                  for (const chunk of turn) {
                    controller.enqueue(encoder.encode(JSON.stringify(chunk) + '\n'));
                  }
                  controller.close();
                }
              })
            };
          };
          await requestOllamaChatStream(
            baselineFetch,
            { endpoint: ENDPOINT, model: MODEL, messages: [{ role: 'user', content: content.trim() }] },
            { onToken: (d: string) => baselineDeltas.push(d) }
          );

          // ── Fixed path: send through the handler with an EMPTY catalog. ──
          const gateway = createMockMcpGateway([]);
          const statePath = createTempStatePath();
          const ipcMain = createMockIpcMain();
          const window = createMockMainWindow();
          const scripted = createScriptedFetch([turn]);
          registerAgentChatHandlers(ipcMain as any, window as any, {
            statePath,
            fetchImpl: scripted.fetchImpl,
            defaultEndpoint: ENDPOINT,
            mcpGateway: gateway
          });
          const sendHandler = ipcMain.getHandler(AGENT_CHAT_CHANNELS.SEND_MESSAGE)!;

          await sendHandler({}, { surface: 'agent', content, model: MODEL, endpoint: ENDPOINT });
          const terminal = await waitForCompletion(window);

          const fixedBody = scripted.getRequestBodies()[0];
          const fixedDeltas = window
            .getStreamEvents()
            .filter((e) => e.type === 'chat-token')
            .map((e) => e.delta);

          // Same outgoing body shape (no tools field), same messages.
          expect('tools' in fixedBody).toBe(false);
          expect(Object.keys(fixedBody).sort()).toEqual(Object.keys(baselineBodies[0]).sort());
          expect(fixedBody.messages).toEqual(baselineBodies[0].messages);
          // Same streamed tokens in the same order.
          expect(fixedDeltas).toEqual(baselineDeltas);
          // No tool dispatch happened for the non-tool input.
          expect(gateway.getCalls()).toHaveLength(0);
          expect(terminal.assistantMessage.content).toBe(answerChunks.join(''));
        }
      ),
      { numRuns: 20 }
    );
  });
});
