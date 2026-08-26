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
 * Property 7 — Agent System Prompts: tool advertisement is independent of the
 * combined system message.
 *
 * For any master/system strings, the `tools` field of the outgoing /api/chat
 * body is identical whether or not a combined system message is prepended, and
 * when both layers are empty the outgoing body carries no role:'system' entry.
 *
 * This drives `registerAgentChatHandlers` twice per iteration with an identical
 * stub mcpGateway (so buildToolCatalog produces the same tools): once with
 * non-empty master/system (via injected getChatConfig + resolveMaster) and once
 * with both layers empty. It captures each outgoing body's `tools` field and
 * asserts they are deep-equal, and that the both-empty run has no system entry.
 *
 * Feature: agent-system-prompts, Property 7: Tool advertisement is independent
 * of the system message — the outgoing /api/chat `tools` field is identical
 * with and without a system message, and when both layers are empty the
 * outgoing body carries no role:'system' entry.
 *
 * Validates: Requirements 5.3, 5.4 (also covers Req 7.6 preservation)
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-plus-tool-isolation-'));
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

/** A stub MCP gateway advertising a fixed catalog of tools. */
function createStubMcpGateway(tools: any[]) {
  return {
    dispatch: async () => ({ output: 'ok' }),
    listTools: async () => tools
  };
}

function finalTextTurn(text: string): any[] {
  return [
    { message: { role: 'assistant', content: text }, done: false },
    { message: { role: 'assistant', content: '' }, done: true, eval_count: 3 }
  ];
}

/** A fetch impl that captures each outgoing body and returns a single text turn. */
function createCapturingFetch() {
  const requestBodies: any[] = [];
  const fetchImpl = async (_url: string, options: any) => {
    try { requestBodies.push(JSON.parse(options.body)); } catch { requestBodies.push(null); }
    const encoder = new TextEncoder();
    const chunks = finalTextTurn('answer');
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
  return { fetchImpl, getRequestBodies: () => requestBodies };
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

// A fixed catalog shared by both runs so buildToolCatalog produces the same tools.
const CATALOG = [
  { name: 'folder_read_file', description: 'read a file', parameters: { type: 'object', properties: {} } },
  { name: 'terminal_run', description: 'run a command', parameters: { type: 'object', properties: {} } },
  { name: 'http_fetch', description: 'fetch a url', parameters: { type: 'object', properties: {} } }
];

/**
 * Drives one send through a freshly-registered handler with the given master
 * and system prompts, returning the single captured outgoing /api/chat body.
 */
async function captureOutgoingBody(master: string, system: string): Promise<any> {
  const statePath = createTempStatePath();
  const ipcMain = createMockIpcMain();
  const window = createMockMainWindow();
  const capturing = createCapturingFetch();
  const gateway = createStubMcpGateway(CATALOG);

  registerAgentChatHandlers(ipcMain as any, window as any, {
    statePath,
    fetchImpl: capturing.fetchImpl,
    defaultEndpoint: ENDPOINT,
    mcpGateway: gateway,
    // Inject the two layers directly so no env/state mutation is required.
    getChatConfig: () => ({ systemPrompt: system }),
    resolveMaster: () => master
  });

  const sendHandler = ipcMain.getHandler(AGENT_CHAT_CHANNELS.SEND_MESSAGE)!;
  await sendHandler({}, { surface: 'agent', content: 'hello', model: MODEL, endpoint: ENDPOINT });
  await waitForCompletion(window);

  const bodies = capturing.getRequestBodies();
  expect(bodies.length).toBeGreaterThanOrEqual(1);
  return bodies[0];
}

// ═══════════════════════════════════════════════════════════════════════════════
// Property 7: tool advertisement is independent of the system message
// ═══════════════════════════════════════════════════════════════════════════════

describe('Property 7: tool advertisement is independent of the system message (Req 5.3, 5.4)', () => {
  it('tools field is deep-equal with and without a system message; both-empty run has no system entry', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ maxLength: 200 }),
        fc.string({ maxLength: 200 }),
        async (master, system) => {
          // Run 1: non-empty master/system layers (a system message is prepended
          // only when the composed content is non-empty; the generators above may
          // produce whitespace-only strings, but the tools field must match
          // regardless).
          const withBody = await captureOutgoingBody(master, system);

          // Run 2: both layers empty → no system message prepended.
          const withoutBody = await captureOutgoingBody('', '');

          // The tools field must be identical between the two runs, i.e. the
          // system message never influences tool advertisement (Req 5.4).
          expect(withBody.tools).toEqual(withoutBody.tools);

          // Both-empty run carries no role:'system' entry (Req 5.3).
          const systemEntries = (withoutBody.messages || []).filter(
            (m: any) => m.role === 'system'
          );
          expect(systemEntries).toHaveLength(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('with a definitively non-empty master the system message is present yet tools are unchanged', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Ensure a non-empty (post-trim) master so a system message is definitely prepended.
        fc.string({ minLength: 1, maxLength: 100 }).map((s) => `M-${s}`),
        fc.string({ maxLength: 100 }),
        async (master, system) => {
          const withBody = await captureOutgoingBody(master, system);
          const withoutBody = await captureOutgoingBody('', '');

          // A system message must lead the transcript when master is non-empty.
          expect(withBody.messages[0].role).toBe('system');
          const systemEntries = withBody.messages.filter((m: any) => m.role === 'system');
          expect(systemEntries).toHaveLength(1);

          // Yet the advertised tools are byte-identical to the system-less run.
          expect(withBody.tools).toEqual(withoutBody.tools);
        }
      ),
      { numRuns: 100 }
    );
  });
});
