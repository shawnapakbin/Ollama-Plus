import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  registerAgentChatHandlers,
  AGENT_CHAT_CHANNELS
} from '../electron/runtime/agent/agentChatHandlers.js';
import { createGateway } from '../mcp/lib/gateway.mjs';

/**
 * Integration test — Gateway List Tools (Task 5.1)
 *
 * Non-empty tool advertisement: build a REAL gateway (createGateway) with
 * backfilled routes carrying metadata, wire it into registerAgentChatHandlers,
 * send a message with a fake fetch that captures the outgoing /api/chat body,
 * and assert the body has a non-empty `tools` array whose function names match
 * the names returned by the gateway's own listTools().
 *
 * Validates: Requirements 4.1, 7.3
 */

// ─── Test Infrastructure (mirrors tests/agentChatHandlersTools.test.ts) ───────

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createTempStatePath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-plus-gw-advertise-'));
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

/** A final text turn (no tool calls) so the tool-execution loop terminates. */
function finalTextTurn(text: string): any[] {
  return [
    { message: { role: 'assistant', content: text }, done: false },
    { message: { role: 'assistant', content: '' }, done: true, eval_count: 5 }
  ];
}

/**
 * Build a real gateway with a couple of backfilled routes carrying real
 * Tool_Metadata (description + JSON-schema parameters), matching the shape
 * the electron/main.js Registration_Sites use.
 */
function buildRealGateway() {
  const gateway = createGateway();
  gateway.register('browser', 'list_sessions', async () => ({ sessions: [] }), {
    description: 'List active browser sessions.',
    parameters: { type: 'object', properties: {} }
  });
  gateway.register(
    'browser',
    'close_session',
    async () => ({ closed: true }),
    {
      description: 'Close a browser session by id.',
      parameters: {
        type: 'object',
        properties: { sessionId: { type: 'string' } },
        required: ['sessionId']
      }
    }
  );
  return gateway;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Non-empty tool advertisement (Req 4.1, 7.3)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Non-empty tool advertisement with a real gateway (Req 4.1, 7.3)', () => {
  it('advertises a non-empty tools array whose names match gateway.listTools()', async () => {
    const gateway = buildRealGateway();
    const statePath = createTempStatePath();
    const ipcMain = createMockIpcMain();
    const window = createMockMainWindow();
    const scripted = createScriptedFetch([finalTextTurn('all done')]);

    registerAgentChatHandlers(ipcMain as any, window as any, {
      statePath,
      fetchImpl: scripted.fetchImpl,
      defaultEndpoint: ENDPOINT,
      mcpGateway: gateway
    });

    const sendHandler = ipcMain.getHandler(AGENT_CHAT_CHANNELS.SEND_MESSAGE)!;
    await sendHandler(
      {},
      { surface: 'agent', content: 'do the thing', model: MODEL, endpoint: ENDPOINT }
    );
    await waitForCompletion(window);

    const body = scripted.getRequestBodies()[0];

    // The outgoing /api/chat body advertises a non-empty tools array.
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.tools.length).toBeGreaterThan(0);

    // Every advertised tool is an OpenAI/Ollama-style function descriptor.
    for (const tool of body.tools) {
      expect(tool.type).toBe('function');
      expect(typeof tool.function.name).toBe('string');
    }

    // The advertised function names equal the gateway's own listTools() names
    // (which follow the <server>_<action> convention).
    const listedNames = gateway.listTools().map((t: any) => t.name).sort();
    const advertisedNames = body.tools.map((t: any) => t.function.name).sort();

    expect(advertisedNames).toEqual(listedNames);
    expect(advertisedNames).toContain('browser_list_sessions');
    expect(advertisedNames).toContain('browser_close_session');
  });
});
