import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  registerAgentChatHandlers,
  AGENT_CHAT_CHANNELS
} from '../electron/runtime/agent/agentChatHandlers.js';

/**
 * Fail-safe enumeration — Gateway List Tools (Task 5.4)
 *
 * `buildToolCatalog` is a module-private helper in agentChatHandlers.js, so its
 * fail-safe behavior is exercised via the public path: a stub gateway whose
 * `listTools` throws is wired into `registerAgentChatHandlers`, a message is
 * sent with a fake `fetch` capturing the outgoing /api/chat body, and we assert
 * the body carries no `tools` field (the Agent proceeds tool-less) and that no
 * error is surfaced to the user.
 *
 * The stub gateway also exposes a working `dispatch` so the internal
 * toolDispatcher is constructed and `buildToolCatalog` is actually invoked
 * (the catalog is only built when a dispatcher exists).
 *
 * Validates: Requirements 6.3
 */

// ─── Test Infrastructure (mirrors existing agent chat handler tests) ─────────

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createTempStatePath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-plus-gw-failsafe-'));
  tempDirs.push(dir);
  return path.join(dir, 'state.json');
}

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

/**
 * Stub gateway whose `listTools` always throws. It also exposes a working
 * `dispatch` so the toolDispatcher (and therefore buildToolCatalog) is wired.
 */
function createThrowingListToolsGateway() {
  let listToolsCalls = 0;
  return {
    dispatch: async () => ({ output: 'unused' }),
    listTools: () => {
      listToolsCalls += 1;
      throw new Error('boom');
    },
    getListToolsCalls: () => listToolsCalls
  };
}

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
  return { fetchImpl, getRequestBodies: () => requestBodies };
}

async function waitForCompletion(
  window: ReturnType<typeof createMockMainWindow>,
  timeoutMs = 3000
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

const MODEL = 'qwen3.5:9b';
const ENDPOINT = 'http://localhost:11434';

function finalTextTurn(text: string): any[] {
  return [
    { message: { role: 'assistant', content: text }, done: false },
    { message: { role: 'assistant', content: '' }, done: true, eval_count: 5 }
  ];
}

function setup(turns: any[][], gateway: any) {
  const statePath = createTempStatePath();
  const ipcMain = createMockIpcMain();
  const window = createMockMainWindow();
  const scripted = createScriptedFetch(turns);
  const api = registerAgentChatHandlers(ipcMain as any, window as any, {
    statePath,
    fetchImpl: scripted.fetchImpl,
    defaultEndpoint: ENDPOINT,
    mcpGateway: gateway
  });
  const sendHandler = ipcMain.getHandler(AGENT_CHAT_CHANNELS.SEND_MESSAGE)!;
  return { statePath, ipcMain, window, scripted, api, sendHandler };
}

async function send(sendHandler: Function, content = 'do the thing') {
  return sendHandler({}, { surface: 'agent', content, model: MODEL, endpoint: ENDPOINT });
}

// ═══════════════════════════════════════════════════════════════════════════════
// buildToolCatalog fails safe when listTools throws (Req 6.3)
// ═══════════════════════════════════════════════════════════════════════════════

describe('buildToolCatalog fails safe when listTools throws (Req 6.3)', () => {
  it('omits the tools field and proceeds tool-less without surfacing an error', async () => {
    const gateway = createThrowingListToolsGateway();
    const { window, sendHandler, scripted } = setup([finalTextTurn('done')], gateway);

    await send(sendHandler);
    const terminal = await waitForCompletion(window);

    // listTools was actually consulted (the throw path was exercised).
    expect(gateway.getListToolsCalls()).toBeGreaterThan(0);

    // The outgoing /api/chat body carries no `tools` field (tool-less request).
    const body = scripted.getRequestBodies()[0];
    expect('tools' in body).toBe(false);
    expect(Object.keys(body).sort()).toEqual(['messages', 'model', 'stream'].sort());

    // No error is surfaced to the user; the chat completes normally.
    expect(terminal).toBeTruthy();
    expect(terminal.type).toBe('chat-completed');
    expect(terminal.assistantMessage.content).toBe('done');

    // Defensive: no chat-error stream event was emitted.
    const errorEvent = window
      .getStreamEvents()
      .find((e) => e.type === 'chat-error');
    expect(errorEvent).toBeFalsy();
  });
});
