import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  registerAgentChatHandlers,
  composeCombinedContent,
  AGENT_CHAT_CHANNELS
} from '../electron/runtime/agent/agentChatHandlers.js';

/**
 * Property-based test for Property 8 of the agent-system-prompts feature.
 *
 * The Combined_System_Message that is prepended to the outgoing /api/chat
 * transcript is transient: it must never be written back to the persisted
 * session store, so stored history stays user/assistant-only and never exposes
 * the master or system content (Req 5.6).
 */

// Feature: agent-system-prompts, Property 8: The combined system message is never persisted as a session message
// For any master and system strings, after a completed Conversational_Agent_Path turn the persisted
// session's `messages` contain only `user` and `assistant` roles and no entry whose content is the
// combined system message.
// Validates: Requirements 5.6

// ─── Test Infrastructure (mirrors tests/agentChatHandlersTools.test.ts) ───────

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createTempStatePath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-plus-sysprompt-persist-'));
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

/** A final text turn (no tool calls) — completes the loop in one round. */
function finalTextTurn(text: string): any[] {
  return [
    { message: { role: 'assistant', content: text }, done: false },
    { message: { role: 'assistant', content: '' }, done: true, eval_count: 5 }
  ];
}

function createScriptedFetch(turns: any[][]) {
  let turnIndex = 0;
  const fetchImpl = async (_url: string, _options: any) => {
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
  return { fetchImpl };
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

/** Prompt/content strings, biased toward whitespace/empty edge cases. */
const promptString = fc.oneof(
  fc.string(),
  fc.constant(''),
  fc.constantFrom(' ', '   ', '\n', '\t  \n'),
  fc.string({ minLength: 1 })
);

describe('Property 8: The combined system message is never persisted as a session message', () => {
  it('persists only user/assistant messages and never the combined system content', async () => {
    await fc.assert(
      fc.asyncProperty(
        promptString, // master
        promptString, // system
        promptString, // user content
        async (master, system, rawUserContent) => {
          // The send path requires non-empty user content; ensure a valid message.
          const userContent = rawUserContent.trim() ? rawUserContent : 'do the thing';

          const statePath = createTempStatePath();
          const ipcMain = createMockIpcMain();
          const window = createMockMainWindow();
          const scripted = createScriptedFetch([finalTextTurn('the final answer')]);

          const api = registerAgentChatHandlers(ipcMain as any, window as any, {
            statePath,
            fetchImpl: scripted.fetchImpl,
            defaultEndpoint: ENDPOINT,
            mcpGateway: null,
            // Inject the two system-prompt layers under test.
            getChatConfig: () => ({ systemPrompt: system }),
            resolveMaster: () => master
          });

          const sendHandler = ipcMain.getHandler(AGENT_CHAT_CHANNELS.SEND_MESSAGE)!;
          const result: any = await sendHandler(
            {},
            { surface: 'agent', content: userContent, model: MODEL, endpoint: ENDPOINT }
          );

          const terminal = await waitForCompletion(window);
          expect(terminal?.type).toBe('chat-completed');

          // Read the PERSISTED session back from the store (loads from disk).
          const session = api.getSessionStore().get(result.sessionId);
          expect(session).toBeTruthy();

          const messages = session.messages as Array<{ role: string; content: string }>;

          // Req 5.6: persisted messages contain only user/assistant roles.
          expect(messages.every((m) => m.role === 'user' || m.role === 'assistant')).toBe(true);
          expect(messages.some((m) => m.role === 'system')).toBe(false);

          // No persisted message content equals the combined system content.
          const combined = composeCombinedContent(master, system);
          if (combined) {
            expect(messages.some((m) => m.content === combined)).toBe(false);
          }

          // Sanity: the turn produced the expected user + assistant pair.
          expect(messages.filter((m) => m.role === 'user')).toHaveLength(1);
          expect(messages.filter((m) => m.role === 'assistant')).toHaveLength(1);
        }
      ),
      { numRuns: 100 }
    );
  });
});
