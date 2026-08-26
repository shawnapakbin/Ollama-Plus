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
 * Integration test — Gateway List Tools (Task 5.3)
 *
 * Empty-catalog request body equality: when the Tool_Catalog is empty, the
 * outgoing /api/chat body must omit the `tools` field entirely and stay
 * byte-for-byte identical to the tool-less baseline. Two scenarios exercise
 * the two ways a catalog can be empty in production:
 *   (a) a real gateway created via createGateway() with NO routes registered
 *       (listTools() returns []), and
 *   (b) no gateway wired into the Agent path at all.
 * Both captured request bodies must contain no `tools` key and deep-equal
 * each other (the tool-less baseline body).
 *
 * Validates: Requirements 4.4, 5.6, 7.4
 */

// ─── Shared test types ───────────────────────────────────────────────────────

type IpcHandler = (...args: unknown[]) => unknown;
type StreamEvent = { type?: string; [key: string]: unknown };
type ChatChunk = Record<string, unknown>;
type FetchOptions = { body?: string; [key: string]: unknown };
type RequestBody = Record<string, unknown>;

// ─── Test Infrastructure (mirrors tests/agentChatHandlersTools.test.ts) ───────

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createTempStatePath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-plus-empty-catalog-'));
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
  const sentEvents: Array<{ channel: string; payload: StreamEvent }> = [];
  return {
    isDestroyed: () => false,
    webContents: {
      send(channel: string, payload: StreamEvent) {
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
 * Fake fetch that captures each /api/chat request body and returns a
 * terminating (tool-less) streamed response.
 */
function createScriptedFetch(turns: ChatChunk[][]) {
  const requestBodies: Array<RequestBody | null> = [];
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

/** A final text turn (no tool calls) — terminates the tool loop immediately. */
function finalTextTurn(text: string): ChatChunk[] {
  return [
    { message: { role: 'assistant', content: text }, done: false },
    { message: { role: 'assistant', content: '' }, done: true, eval_count: 5 }
  ];
}

/**
 * Wire the Agent handlers with the given gateway (which may be undefined),
 * send one message, and return the first captured /api/chat request body.
 */
async function captureFirstRequestBody(gateway: unknown): Promise<RequestBody> {
  const statePath = createTempStatePath();
  const ipcMain = createMockIpcMain();
  const window = createMockMainWindow();
  const scripted = createScriptedFetch([finalTextTurn('done')]);

  registerAgentChatHandlers(
    ipcMain as unknown as Parameters<typeof registerAgentChatHandlers>[0],
    window as unknown as Parameters<typeof registerAgentChatHandlers>[1],
    {
      statePath,
      fetchImpl: scripted.fetchImpl,
      defaultEndpoint: ENDPOINT,
      mcpGateway: gateway
    } as unknown as Parameters<typeof registerAgentChatHandlers>[2]
  );

  const sendHandler = ipcMain.getHandler(AGENT_CHAT_CHANNELS.SEND_MESSAGE)!;
  await sendHandler(
    {},
    { surface: 'agent', content: 'do the thing', model: MODEL, endpoint: ENDPOINT }
  );
  await waitForCompletion(window);

  return scripted.getRequestBodies()[0] as RequestBody;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Empty-catalog request body equality (Req 4.4, 5.6, 7.4)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Empty-catalog request body equality (Req 4.4, 5.6, 7.4)', () => {
  it('a gateway with no routes registered advertises no tools field', async () => {
    // A real gateway with zero routes: listTools() returns [].
    const emptyGateway = createGateway();
    expect(emptyGateway.listTools()).toEqual([]);

    const body = await captureFirstRequestBody(emptyGateway);

    // No `tools` key at all — not merely an empty array.
    expect(Object.keys(body)).not.toContain('tools');
    expect('tools' in body).toBe(false);
  });

  it('no gateway wired at all advertises no tools field', async () => {
    const body = await captureFirstRequestBody(undefined);

    expect(Object.keys(body)).not.toContain('tools');
    expect('tools' in body).toBe(false);
  });

  it('both empty-catalog bodies deep-equal the tool-less baseline', async () => {
    // (a) real empty gateway, (b) no gateway at all.
    const emptyGatewayBody = await captureFirstRequestBody(createGateway());
    const noGatewayBody = await captureFirstRequestBody(undefined);

    // Both bodies carry exactly the tool-less baseline keys and nothing else.
    const baselineKeys = ['messages', 'model', 'stream'].sort();
    expect(Object.keys(emptyGatewayBody).sort()).toEqual(baselineKeys);
    expect(Object.keys(noGatewayBody).sort()).toEqual(baselineKeys);

    // Byte-for-byte identical tool-less bodies: the empty-gateway body and the
    // no-gateway body deep-equal each other (Req 5.6).
    expect(emptyGatewayBody).toEqual(noGatewayBody);
  });
});
