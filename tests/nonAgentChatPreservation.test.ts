import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createRuntimeService } from '../electron/runtime/runtimeService.js';
import { getChatConfig } from '../electron/runtime/runtimeStore.js';

/**
 * Task 10.1 — Preservation test for the non-Agent chat surface.
 *
 * Validates: Requirements 5.2, 5.5
 *
 * The agent-system-prompts feature prepends a single Combined_System_Message to
 * the transcript exclusively in the Conversational_Agent_Path
 * (electron/runtime/agent/agentChatHandlers.js). The standard, non-Agent chat
 * surface is runtimeService.sendChatMessage / sendChatMessageStream, which is a
 * separate send path. These tests confirm the non-Agent path is unaffected:
 *   - it never prepends a role:'system' message from this feature, even when a
 *     systemPrompt is persisted in the chat config (Req 5.2), and
 *   - the existing chat-config fields (endpoint/model/autoRenameEnabled) and
 *     session persistence behavior are unchanged (Req 5.5, 5.1).
 */

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

function createTempStatePath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-plus-non-agent-'));
  tempDirs.push(dir);
  return path.join(dir, 'state.json');
}

/**
 * Builds a fetchImpl that captures every outgoing /api/chat request body and
 * returns a canned assistant reply. Captured bodies are pushed into `captured`.
 */
function createCapturingFetch(captured: Array<Record<string, unknown>>) {
  return async (url: string, init?: { body?: string }) => {
    if (url.endsWith('/api/chat')) {
      if (typeof init?.body === 'string') {
        captured.push(JSON.parse(init.body));
      }
      return {
        ok: true,
        json: async () => ({
          message: { content: 'Assistant reply from local Ollama.' },
          done: true,
          total_duration: 10,
          eval_count: 5
        })
      };
    }
    throw new Error(`Unexpected URL ${url}`);
  };
}

/** Streaming variant: captures the body then streams a single done chunk. */
function createCapturingStreamFetch(captured: Array<Record<string, unknown>>) {
  const encoder = new TextEncoder();
  return async (url: string, init?: { body?: string }) => {
    if (url.endsWith('/api/chat')) {
      if (typeof init?.body === 'string') {
        captured.push(JSON.parse(init.body));
      }
      return {
        ok: true,
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode('{"message":{"content":"Assistant reply"},"done":true}\n')
            );
            controller.close();
          }
        })
      };
    }
    throw new Error(`Unexpected URL ${url}`);
  };
}

function createService(overrides: Record<string, unknown> = {}) {
  return createRuntimeService({
    statePath: createTempStatePath(),
    appVersion: '0.0.1-test',
    mode: 'development',
    workspaceRoot: 'C:/workspace',
    versions: {
      electron: '41.0.0',
      chrome: '141.0.0',
      node: '24.0.0'
    },
    langsmithConfigured: false,
    ...overrides
  });
}

describe('non-Agent chat surface preservation (agent-system-prompts)', () => {
  it('sendChatMessage does not prepend a system message even when a systemPrompt is persisted', async () => {
    const captured: Array<Record<string, unknown>> = [];
    const statePath = createTempStatePath();
    const service = createService({ statePath, fetchImpl: createCapturingFetch(captured) });

    const session = service.createSession('Non-agent chat session');
    // Persist a non-empty systemPrompt via the standard chat-config save path.
    await service.saveChatConfig({
      endpoint: 'http://127.0.0.1:11434',
      model: 'llama3.1:8b',
      systemPrompt: 'You are a terse assistant. Never use lists.'
    });

    await service.sendChatMessage({
      sessionId: session.id,
      content: 'Hello there',
      endpoint: 'http://127.0.0.1:11434',
      model: 'llama3.1:8b'
    });

    expect(captured).toHaveLength(1);
    const messages = captured[0].messages as Array<{ role: string; content: string }>;

    // The non-Agent path assembles the transcript from persisted session
    // messages only; this feature adds no Combined_System_Message here.
    const systemEntries = messages.filter((message) => message.role === 'system');
    expect(systemEntries).toHaveLength(0);

    // The transcript is exactly the single user turn — unchanged by the feature.
    expect(messages).toEqual([{ role: 'user', content: 'Hello there' }]);

    // The persisted systemPrompt is not leaked into the outgoing request body.
    expect(JSON.stringify(captured[0])).not.toContain('terse assistant');
  });

  it('sendChatMessageStream does not prepend a system message even when a systemPrompt is persisted', async () => {
    const captured: Array<Record<string, unknown>> = [];
    const statePath = createTempStatePath();
    const service = createService({ statePath, fetchImpl: createCapturingStreamFetch(captured) });

    const session = service.createSession('Non-agent streaming session');
    await service.saveChatConfig({
      endpoint: 'http://127.0.0.1:11434',
      model: 'llama3.1:8b',
      systemPrompt: 'You are a terse assistant. Never use lists.'
    });

    await service.sendChatMessageStream(
      {
        sessionId: session.id,
        content: 'Stream this',
        endpoint: 'http://127.0.0.1:11434',
        model: 'llama3.1:8b',
        requestId: 'req-1'
      },
      () => {
        /* ignore emitted events */
      }
    );

    expect(captured).toHaveLength(1);
    const messages = captured[0].messages as Array<{ role: string; content: string }>;

    const systemEntries = messages.filter((message) => message.role === 'system');
    expect(systemEntries).toHaveLength(0);
    expect(messages).toEqual([{ role: 'user', content: 'Stream this' }]);
    expect(JSON.stringify(captured[0])).not.toContain('terse assistant');
  });

  it('leaves existing chat-config field behavior (endpoint/model/autoRenameEnabled) unchanged after a non-Agent send', async () => {
    const captured: Array<Record<string, unknown>> = [];
    const statePath = createTempStatePath();
    const service = createService({ statePath, fetchImpl: createCapturingFetch(captured) });

    const session = service.createSession('Config preservation session');
    await service.saveChatConfig({
      endpoint: 'http://127.0.0.1:11434',
      model: 'llama3.1:8b'
    });

    // The three pre-existing chat-config fields keep their current defaults and
    // coercion behavior — this feature is additive and does not touch them.
    const config = getChatConfig(statePath);
    expect(config).toMatchObject({
      endpoint: 'http://127.0.0.1:11434',
      model: 'llama3.1:8b'
    });
    expect(config.autoRenameEnabled).toBe(true); // normalized default preserved
    // The new field is present and defaults to '' when never set (additive).
    expect(config.systemPrompt).toBe('');

    await service.sendChatMessage({
      sessionId: session.id,
      content: 'Hello there',
      endpoint: 'http://127.0.0.1:11434',
      model: 'llama3.1:8b'
    });

    // The non-Agent send path continues to persist endpoint/model from the
    // response exactly as before this feature — behavior is unchanged (Req 5.1).
    const after = getChatConfig(statePath);
    expect(after.endpoint).toBe('http://127.0.0.1:11434');
    expect(after.model).toBe('llama3.1:8b');
    expect(after.autoRenameEnabled).toBe(true);

    // The transcript persisted for the session is the standard user/assistant
    // pair — no system message is stored (session history unchanged, Req 5.5/5.6).
    const persistedRoles = service.listMessages(session.id).map((message) => message.role);
    expect(persistedRoles).toEqual(['user', 'assistant']);
  });
});
