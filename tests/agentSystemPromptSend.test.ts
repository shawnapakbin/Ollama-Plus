import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  registerAgentChatHandlers,
  AGENT_CHAT_CHANNELS
} from '../electron/runtime/agent/agentChatHandlers.js';

/**
 * Example test — Combined_System_Message injection on send (Task 5.3)
 *
 * Drives `registerAgentChatHandlers` with a stub `fetchImpl` that captures the
 * outgoing /api/chat request body and returns a single non-streaming final
 * text turn. The `getChatConfig` and `resolveMaster` options are injected so
 * the test does not depend on env vars or the persisted store.
 *
 * Asserts the outgoing transcript prepends exactly one `role:'system'` message,
 * that it sits at index 0, and that its content carries the Master_Prompt (and
 * the System_Prompt when set).
 *
 * Validates: Requirements 7.2, 4.1, 4.2
 */

// ─── Shared test types ───────────────────────────────────────────────────────

type IpcHandler = (...args: unknown[]) => unknown;
type StreamEvent = { type?: string; [key: string]: unknown };
type ChatChunk = Record<string, unknown>;
type FetchOptions = { body?: string; [key: string]: unknown };
type ChatMessage = { role?: string; content?: string; [key: string]: unknown };

// ─── Test Infrastructure (mirrors agentChatHandlersTools.test.ts) ─────────────

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createTempStatePath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-plus-sysprompt-send-'));
  tempDirs.push(dir);
  return path.join(dir, 'state.json');
}

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

/** Scripted fetch returning a single final text turn; captures request bodies. */
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
  return { fetchImpl, getRequestBodies: () => requestBodies };
}

async function waitForCompletion(
  window: ReturnType<typeof createMockMainWindow>,
  timeoutMs = 3000
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

const MODEL = 'qwen3.5:9b';
const ENDPOINT = 'http://localhost:11434';

/** A final text turn (no tool calls). */
function finalTextTurn(text: string): ChatChunk[] {
  return [
    { message: { role: 'assistant', content: text }, done: false },
    { message: { role: 'assistant', content: '' }, done: true, eval_count: 5 }
  ];
}

function setup(opts: { master?: string; system?: string } = {}) {
  const statePath = createTempStatePath();
  const ipcMain = createMockIpcMain();
  const window = createMockMainWindow();
  const scripted = createScriptedFetch([finalTextTurn('final answer')]);
  const api = registerAgentChatHandlers(
    ipcMain as unknown as Parameters<typeof registerAgentChatHandlers>[0],
    window as unknown as Parameters<typeof registerAgentChatHandlers>[1],
    {
    statePath,
    fetchImpl: scripted.fetchImpl,
    defaultEndpoint: ENDPOINT,
    // No gateway: keeps the tool catalog empty and the body minimal.
    mcpGateway: null,
    // Inject config + master so we don't depend on env/store.
    getChatConfig: () => ({ systemPrompt: opts.system ?? '' }),
    resolveMaster: () => opts.master ?? ''
    }
  );
  const sendHandler = ipcMain.getHandler(AGENT_CHAT_CHANNELS.SEND_MESSAGE)!;
  return { window, scripted, api, sendHandler };
}

async function send(sendHandler: IpcHandler, content = 'hello there') {
  return sendHandler({}, { surface: 'agent', content, model: MODEL, endpoint: ENDPOINT });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Combined_System_Message injection (Req 7.2, 4.1, 4.2)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Combined_System_Message on send (Req 7.2, 4.1, 4.2)', () => {
  it('prepends exactly one system message containing the master when only master is set', async () => {
    const master = 'You are a careful assistant. Always be concise.';
    const { window, scripted, sendHandler } = setup({ master, system: '' });

    await send(sendHandler);
    await waitForCompletion(window);

    const messages = scripted.getRequestBodies()[0]!.messages as ChatMessage[];
    const systemMessages = messages.filter((m) => m.role === 'system');

    // Exactly one system entry (Req 4.4), positioned first (Req 4.1).
    expect(systemMessages).toHaveLength(1);
    expect(messages[0].role).toBe('system');
    // Content carries the master text (Req 7.2, 4.2).
    expect(messages[0].content).toContain(master);
  });

  it('prepends one system message containing both master and system text, master first', async () => {
    const master = 'MASTER: baseline rules the user cannot see.';
    const system = 'SYSTEM: speak like a pirate.';
    const { window, scripted, sendHandler } = setup({ master, system });

    await send(sendHandler);
    await waitForCompletion(window);

    const messages = scripted.getRequestBodies()[0]!.messages as ChatMessage[];
    const systemMessages = messages.filter((m) => m.role === 'system');

    // Exactly one leading system message (Req 4.1, 4.4).
    expect(systemMessages).toHaveLength(1);
    expect(messages[0].role).toBe('system');

    // Content contains both layers (Req 7.2), master before system (Req 4.2).
    const content = messages[0].content ?? '';
    expect(content).toContain(master);
    expect(content).toContain(system);
    expect(content.indexOf(master)).toBeLessThan(content.indexOf(system));

    // The user message follows the single system entry, unchanged.
    expect(messages[1]).toMatchObject({ role: 'user', content: 'hello there' });
  });

  it('omits the system message entirely when both layers are empty', async () => {
    const { window, scripted, sendHandler } = setup({ master: '', system: '' });

    await send(sendHandler);
    await waitForCompletion(window);

    const messages = scripted.getRequestBodies()[0]!.messages as ChatMessage[];
    expect(messages.some((m) => m.role === 'system')).toBe(false);
    expect(messages[0]).toMatchObject({ role: 'user', content: 'hello there' });
  });
});
