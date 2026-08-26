import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createRuntimeService } from '../electron/runtime/runtimeService.js';
import { getChatConfig, updateChatConfig } from '../electron/runtime/runtimeStore.js';

/**
 * chat-config-field-reset — Task 1: Bug condition exploration test.
 *
 * Property 1: Bug Condition — Field Preservation Across Chat Operations
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4
 *
 * Four non-Agent chat operations in electron/runtime/runtimeService.js persist
 * the current endpoint/model by calling updateChatConfig(statePath, { endpoint,
 * model }) with a PLAIN OBJECT. Because updateChatConfig runs every candidate
 * through normalizeChatConfig, a plain object that omits systemPrompt /
 * autoRenameEnabled causes those fields to be reset to their defaults
 * (systemPrompt -> '', autoRenameEnabled -> true).
 *
 * The bug condition (design isBugCondition) holds when the persisted config has
 * systemPrompt !== '' OR autoRenameEnabled === false.
 *
 * These tests encode the EXPECTED (fixed) behavior: after each operation the
 * prior systemPrompt/autoRenameEnabled must be preserved. On the UNFIXED code
 * they are EXPECTED TO FAIL — the failure confirms the bug exists.
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-plus-field-reset-'));
  tempDirs.push(dir);
  return path.join(dir, 'state.json');
}

/**
 * Seed a persisted chat config directly through the store so that
 * autoRenameEnabled (which runtimeService.saveChatConfig does not accept) is
 * reliably persisted. This is the "saveChatConfig" seeding step described by
 * the task, using the store's updater form so every field is set explicitly.
 */
function saveChatConfig(
  statePath: string,
  config: {
    endpoint: string;
    model: string;
    systemPrompt?: string;
    autoRenameEnabled?: boolean;
  }
) {
  return updateChatConfig(statePath, (current) => ({
    ...current,
    endpoint: config.endpoint,
    model: config.model,
    systemPrompt: config.systemPrompt ?? current.systemPrompt ?? '',
    autoRenameEnabled:
      typeof config.autoRenameEnabled === 'boolean'
        ? config.autoRenameEnabled
        : current.autoRenameEnabled
  }));
}

const ENDPOINT = 'http://127.0.0.1:11434';
const MODEL = 'llama3.1:8b';

/** Canned /api/chat reply (non-streaming). Also serves /api/tags for models. */
function createChatFetch(chatContent = 'Assistant reply from local Ollama.') {
  const encoder = new TextEncoder();
  return async (url: string, init?: { body?: string }) => {
    if (url.endsWith('/api/chat')) {
      // If the caller supplied a streaming body handler, provide a stream; the
      // client inspects response.body for the stream path.
      return {
        ok: true,
        json: async () => ({
          message: { content: chatContent },
          done: true,
          total_duration: 10,
          eval_count: 5
        }),
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                `${JSON.stringify({ message: { content: chatContent }, done: true })}\n`
              )
            );
            controller.close();
          }
        })
      };
    }

    if (url.endsWith('/api/tags')) {
      return {
        ok: true,
        json: async () => ({
          models: [{ name: MODEL, size: 1, modified_at: '2026-08-06T00:00:00.000Z' }]
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

const SEED = {
  endpoint: ENDPOINT,
  model: MODEL,
  systemPrompt: 'You are a helpful assistant.',
  autoRenameEnabled: false
};

describe('chat-config-field-reset — Property 1: Bug Condition (field preservation)', () => {
  it('sendChatMessage preserves systemPrompt and autoRenameEnabled', async () => {
    const statePath = createTempStatePath();
    const service = createService({ statePath, fetchImpl: createChatFetch() });

    const session = service.createSession('Field reset — send');
    saveChatConfig(statePath, SEED);

    await service.sendChatMessage({
      sessionId: session.id,
      content: 'Hello there',
      endpoint: ENDPOINT,
      model: MODEL
    });

    const after = getChatConfig(statePath);
    expect(after.systemPrompt).toBe(SEED.systemPrompt);
    expect(after.autoRenameEnabled).toBe(SEED.autoRenameEnabled);
  });

  it('sendChatMessageStream preserves systemPrompt and autoRenameEnabled', async () => {
    const statePath = createTempStatePath();
    const service = createService({ statePath, fetchImpl: createChatFetch() });

    const session = service.createSession('Field reset — stream');
    saveChatConfig(statePath, SEED);

    await service.sendChatMessageStream(
      {
        sessionId: session.id,
        content: 'Stream this',
        endpoint: ENDPOINT,
        model: MODEL,
        requestId: 'req-1'
      },
      () => {
        /* ignore emitted events */
      }
    );

    const after = getChatConfig(statePath);
    expect(after.systemPrompt).toBe(SEED.systemPrompt);
    expect(after.autoRenameEnabled).toBe(SEED.autoRenameEnabled);
  });

  it('renameSessionWithAi preserves systemPrompt and autoRenameEnabled', async () => {
    const statePath = createTempStatePath();
    const service = createService({
      statePath,
      fetchImpl: createChatFetch('Title: Ollama LAN model setup checklist\n')
    });

    const session = service.createSession('Untitled');
    saveChatConfig(statePath, SEED);

    await service.renameSessionWithAi(session.id);

    const after = getChatConfig(statePath);
    expect(after.systemPrompt).toBe(SEED.systemPrompt);
    expect(after.autoRenameEnabled).toBe(SEED.autoRenameEnabled);
  });

  it('listOllamaModels preserves systemPrompt and autoRenameEnabled', async () => {
    const statePath = createTempStatePath();
    const service = createService({ statePath, fetchImpl: createChatFetch() });

    saveChatConfig(statePath, SEED);

    await service.listOllamaModels(ENDPOINT);

    const after = getChatConfig(statePath);
    expect(after.systemPrompt).toBe(SEED.systemPrompt);
    expect(after.autoRenameEnabled).toBe(SEED.autoRenameEnabled);
  });

  it('preserves fields across all four operations for arbitrary bug-condition configs', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          systemPrompt: fc.string({ maxLength: 200 }),
          autoRenameEnabled: fc.boolean()
        }),
        async (raw) => {
          // Constrain to inputs where the bug condition holds:
          //   systemPrompt !== '' OR autoRenameEnabled === false
          // (mirrors normalizeChatConfig: systemPrompt is trimmed on persist).
          const seededSystemPrompt = raw.systemPrompt.trim();
          const isBugCondition =
            seededSystemPrompt !== '' || raw.autoRenameEnabled === false;
          fc.pre(isBugCondition);

          const seed = {
            endpoint: ENDPOINT,
            model: MODEL,
            systemPrompt: seededSystemPrompt,
            autoRenameEnabled: raw.autoRenameEnabled
          };

          // sendChatMessage
          {
            const statePath = createTempStatePath();
            const service = createService({ statePath, fetchImpl: createChatFetch() });
            const session = service.createSession('prop — send');
            saveChatConfig(statePath, seed);
            await service.sendChatMessage({
              sessionId: session.id,
              content: 'Hello',
              endpoint: ENDPOINT,
              model: MODEL
            });
            const after = getChatConfig(statePath);
            expect(after.systemPrompt).toBe(seed.systemPrompt);
            expect(after.autoRenameEnabled).toBe(seed.autoRenameEnabled);
          }

          // sendChatMessageStream
          {
            const statePath = createTempStatePath();
            const service = createService({ statePath, fetchImpl: createChatFetch() });
            const session = service.createSession('prop — stream');
            saveChatConfig(statePath, seed);
            await service.sendChatMessageStream(
              {
                sessionId: session.id,
                content: 'Hello',
                endpoint: ENDPOINT,
                model: MODEL,
                requestId: 'prop-req'
              },
              () => {}
            );
            const after = getChatConfig(statePath);
            expect(after.systemPrompt).toBe(seed.systemPrompt);
            expect(after.autoRenameEnabled).toBe(seed.autoRenameEnabled);
          }

          // renameSessionWithAi
          {
            const statePath = createTempStatePath();
            const service = createService({
              statePath,
              fetchImpl: createChatFetch('Title: Generated Title\n')
            });
            const session = service.createSession('prop — rename');
            saveChatConfig(statePath, seed);
            await service.renameSessionWithAi(session.id);
            const after = getChatConfig(statePath);
            expect(after.systemPrompt).toBe(seed.systemPrompt);
            expect(after.autoRenameEnabled).toBe(seed.autoRenameEnabled);
          }

          // listOllamaModels
          {
            const statePath = createTempStatePath();
            const service = createService({ statePath, fetchImpl: createChatFetch() });
            saveChatConfig(statePath, seed);
            await service.listOllamaModels(ENDPOINT);
            const after = getChatConfig(statePath);
            expect(after.systemPrompt).toBe(seed.systemPrompt);
            expect(after.autoRenameEnabled).toBe(seed.autoRenameEnabled);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

/**
 * chat-config-field-reset — Task 2: Preservation property tests.
 *
 * Property 2: Preservation — Default Configs and Endpoint/Model Behavior
 * Unchanged.
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5
 *
 * Observation-first methodology: these tests capture the BASELINE behavior that
 * must remain identical for non-buggy inputs (NOT isBugCondition), plus the
 * endpoint/model update and return-shape behavior that must hold for all
 * inputs. They are EXPECTED TO PASS on the current UNFIXED code (they encode
 * the behavior to preserve).
 *
 * A "default" seed leaves systemPrompt === '' and autoRenameEnabled === true,
 * i.e. NOT isBugCondition. These fields must stay at their defaults after each
 * of the four operations — the plain-object normalization the fix targets
 * happens to leave defaults at their defaults, so this holds before and after
 * the fix.
 */
describe('chat-config-field-reset — Property 2: Preservation (defaults + endpoint/model)', () => {
  it('sendChatMessage leaves a default config at its defaults and updates endpoint/model', async () => {
    const statePath = createTempStatePath();
    const service = createService({ statePath, fetchImpl: createChatFetch() });

    const session = service.createSession('Preservation — send default');
    // Default seed: systemPrompt === '' and autoRenameEnabled === true.
    saveChatConfig(statePath, { endpoint: ENDPOINT, model: MODEL });

    const result = await service.sendChatMessage({
      sessionId: session.id,
      content: 'Hello there',
      endpoint: ENDPOINT,
      model: MODEL
    });

    const after = getChatConfig(statePath);
    // Default fields unchanged. (Req 3.4)
    expect(after.systemPrompt).toBe('');
    expect(after.autoRenameEnabled).toBe(true);
    // Endpoint/model persisted to the resolved values. (Req 3.1)
    expect(after.endpoint).toBe(result.endpoint);
    expect(after.model).toBe(result.model);
    // Return shape unchanged. (Req 3.5)
    expect(result.sessionId).toBe(session.id);
    expect(result.endpoint).toBe(ENDPOINT);
    expect(result.model).toBe(MODEL);
    expect(result.userMessage).toBeTruthy();
    expect(result.assistantMessage).toBeTruthy();
    expect(Array.isArray(result.messages)).toBe(true);
  });

  it('sendChatMessageStream leaves a default config at its defaults and updates endpoint/model', async () => {
    const statePath = createTempStatePath();
    const service = createService({ statePath, fetchImpl: createChatFetch() });

    const session = service.createSession('Preservation — stream default');
    saveChatConfig(statePath, { endpoint: ENDPOINT, model: MODEL });

    const result = await service.sendChatMessageStream(
      {
        sessionId: session.id,
        content: 'Stream this',
        endpoint: ENDPOINT,
        model: MODEL,
        requestId: 'preserve-req-1'
      },
      () => {
        /* ignore emitted events */
      }
    );

    const after = getChatConfig(statePath);
    // Default fields unchanged. (Req 3.4)
    expect(after.systemPrompt).toBe('');
    expect(after.autoRenameEnabled).toBe(true);
    // Endpoint/model persisted to the resolved values. (Req 3.1)
    expect(after.endpoint).toBe(result.endpoint);
    expect(after.model).toBe(result.model);
    // Return shape unchanged. (Req 3.5)
    expect(result.sessionId).toBe(session.id);
    expect(result.requestId).toBe('preserve-req-1');
    expect(result.endpoint).toBe(ENDPOINT);
    expect(result.model).toBe(MODEL);
    expect(result.userMessage).toBeTruthy();
    expect(result.assistantMessage).toBeTruthy();
    expect(Array.isArray(result.messages)).toBe(true);
  });

  it('renameSessionWithAi leaves a default config at its defaults and updates endpoint/model', async () => {
    const statePath = createTempStatePath();
    const service = createService({
      statePath,
      fetchImpl: createChatFetch('Title: Ollama LAN model setup checklist\n')
    });

    const session = service.createSession('Untitled');
    saveChatConfig(statePath, { endpoint: ENDPOINT, model: MODEL });

    const result = await service.renameSessionWithAi(session.id);

    const after = getChatConfig(statePath);
    // Default fields unchanged. (Req 3.4)
    expect(after.systemPrompt).toBe('');
    expect(after.autoRenameEnabled).toBe(true);
    // Endpoint/model persisted to the resolved values. (Req 3.1)
    expect(after.endpoint).toBe(result.endpoint);
    expect(after.model).toBe(result.model);
    // Return shape unchanged. (Req 3.5)
    expect(result.session).toBeTruthy();
    expect(result.title).toBe(result.session.title);
    expect(result.endpoint).toBe(ENDPOINT);
    expect(result.model).toBe(MODEL);
  });

  it('listOllamaModels leaves a default config at its defaults and returns normalized config + availableModels', async () => {
    const statePath = createTempStatePath();
    const service = createService({ statePath, fetchImpl: createChatFetch() });

    saveChatConfig(statePath, { endpoint: ENDPOINT, model: MODEL });

    const result = await service.listOllamaModels(ENDPOINT);

    const after = getChatConfig(statePath);
    // Default fields unchanged. (Req 3.4)
    expect(after.systemPrompt).toBe('');
    expect(after.autoRenameEnabled).toBe(true);
    // Endpoint/model persisted to the resolved values. (Req 3.1)
    expect(after.endpoint).toBe(result.endpoint);
    expect(after.model).toBe(result.model);
    // Return shape unchanged: normalized config spread with availableModels. (Req 3.5)
    expect(result.endpoint).toBe(ENDPOINT);
    expect(result.model).toBe(MODEL);
    expect(result.systemPrompt).toBe('');
    expect(result.autoRenameEnabled).toBe(true);
    expect(Array.isArray(result.availableModels)).toBe(true);
    expect(result.availableModels).toEqual([
      { name: MODEL, size: 1, modifiedAt: '2026-08-06T00:00:00.000Z' }
    ]);
  });

  it('endpoint/model are still updated for a non-default (bug-condition) seeded config', async () => {
    // Cover the endpoint/model-still-updated requirement for a NON-default seed
    // too (Req 3.1). Field preservation for this seed is asserted by Property 1;
    // here we only assert the endpoint/model persistence + return shape, which
    // hold on both unfixed and fixed code.
    const statePath = createTempStatePath();
    const service = createService({ statePath, fetchImpl: createChatFetch() });

    const session = service.createSession('Preservation — send non-default');
    saveChatConfig(statePath, SEED);

    const result = await service.sendChatMessage({
      sessionId: session.id,
      content: 'Hello there',
      endpoint: ENDPOINT,
      model: MODEL
    });

    const after = getChatConfig(statePath);
    expect(after.endpoint).toBe(result.endpoint);
    expect(after.model).toBe(result.model);
    expect(result.endpoint).toBe(ENDPOINT);
    expect(result.model).toBe(MODEL);
  });

  it('saveChatConfig round-trips endpoint/model/systemPrompt through getChatConfig', async () => {
    // Req 3.2: saveChatConfig continues to persist endpoint/model/systemPrompt
    // via its updater-function form. Verified by round-trip.
    const statePath = createTempStatePath();
    const service = createService({ statePath, fetchImpl: createChatFetch() });

    const saved = service.saveChatConfig({
      endpoint: ENDPOINT,
      model: MODEL,
      systemPrompt: 'You are a helpful assistant.'
    });

    const after = getChatConfig(statePath);
    expect(after.endpoint).toBe(ENDPOINT);
    expect(after.model).toBe(MODEL);
    expect(after.systemPrompt).toBe('You are a helpful assistant.');
    // Returned object matches what is persisted.
    expect(saved.endpoint).toBe(after.endpoint);
    expect(saved.model).toBe(after.model);
    expect(saved.systemPrompt).toBe(after.systemPrompt);
  });

  it('persists resolved endpoint/model identically regardless of seeded systemPrompt/autoRenameEnabled', async () => {
    // Property-based: for arbitrary seeded systemPrompt / autoRenameEnabled and
    // arbitrary resolved model values, the endpoint/model that each operation
    // resolves are persisted identically (Req 3.1, 3.3). This holds for both
    // buggy and non-buggy seeds and does not depend on the fix.
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          systemPrompt: fc.string({ maxLength: 200 }),
          autoRenameEnabled: fc.boolean(),
          model: fc
            .string({ minLength: 1, maxLength: 40 })
            .map((value) => value.trim())
            .filter((value) => value.length > 0)
        }),
        async (raw) => {
          const seed = {
            endpoint: ENDPOINT,
            model: raw.model,
            systemPrompt: raw.systemPrompt.trim(),
            autoRenameEnabled: raw.autoRenameEnabled
          };

          // sendChatMessage — resolved endpoint/model persisted exactly.
          {
            const statePath = createTempStatePath();
            const service = createService({ statePath, fetchImpl: createChatFetch() });
            const session = service.createSession('prop — endpoint/model send');
            saveChatConfig(statePath, seed);
            const result = await service.sendChatMessage({
              sessionId: session.id,
              content: 'Hello',
              endpoint: ENDPOINT,
              model: raw.model
            });
            const after = getChatConfig(statePath);
            expect(after.endpoint).toBe(result.endpoint);
            expect(after.model).toBe(result.model);
            expect(result.endpoint).toBe(ENDPOINT);
            expect(result.model).toBe(raw.model);
          }

          // sendChatMessageStream — resolved endpoint/model persisted exactly.
          {
            const statePath = createTempStatePath();
            const service = createService({ statePath, fetchImpl: createChatFetch() });
            const session = service.createSession('prop — endpoint/model stream');
            saveChatConfig(statePath, seed);
            const result = await service.sendChatMessageStream(
              {
                sessionId: session.id,
                content: 'Hello',
                endpoint: ENDPOINT,
                model: raw.model,
                requestId: 'prop-endpoint-req'
              },
              () => {}
            );
            const after = getChatConfig(statePath);
            expect(after.endpoint).toBe(result.endpoint);
            expect(after.model).toBe(result.model);
            expect(result.endpoint).toBe(ENDPOINT);
            expect(result.model).toBe(raw.model);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
