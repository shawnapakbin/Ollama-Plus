import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createRuntimeService } from '../electron/runtime/runtimeService.js';
import { getChatConfig, updateChatConfig } from '../electron/runtime/runtimeStore.js';
import { MAX_SYSTEM_PROMPT_LENGTH } from '../electron/runtime/stateSchema.js';
import { MASTER_PROMPT_ENV_VAR, resolveMasterPrompt } from '../electron/runtime/agent/masterPrompt.js';

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-plus-runtime-'));
  tempDirs.push(dir);
  return path.join(dir, 'state.json');
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

describe('runtimeService', () => {
  it('creates sessions and tracks status counters', () => {
    const service = createService();

    const before = service.getStatus();
    expect(before.sessionCount).toBe(0);

    const session = service.createSession('First session');
    const after = service.getStatus();

    expect(session.title).toBe('First session');
    expect(after.sessionCount).toBe(1);
    expect(after.runCount).toBe(0);
  });

  it('deletes a session and removes related artifacts', () => {
    const service = createService();
    const first = service.createSession('First');
    const second = service.createSession('Second');

    service.startRun('memory-ingest', first.id);
    service.startRun('core-chat', second.id);

    const deleted = service.deleteSession(first.id);

    expect(deleted).toMatchObject({ id: first.id, title: 'First' });
    expect(service.listSessions().map((session) => session.id)).toEqual([second.id]);
    expect(service.listRuns(first.id)).toHaveLength(0);
    expect(service.listMessages(first.id)).toHaveLength(0);
    expect(service.listMemoryRecords(first.id)).toHaveLength(0);
  });

  it('renames a session with AI using its conversation transcript', async () => {
    const fetchImpl = async (url: string) => {
      if (url.endsWith('/api/chat')) {
        return {
          ok: true,
          json: async () => ({
            message: { content: 'Title: Ollama LAN model setup checklist\n' },
            done: true,
            total_duration: 10,
            eval_count: 5
          })
        };
      }

      throw new Error(`Unexpected URL ${url}`);
    };

    const service = createService({ fetchImpl });
    const session = service.createSession('Untitled');
    await service.saveChatConfig({ endpoint: 'http://127.0.0.1:11434', model: 'llama3.1:8b' });

    await service.sendChatMessage({
      sessionId: session.id,
      content: 'Help me configure Ollama over LAN',
      endpoint: 'http://127.0.0.1:11434',
      model: 'llama3.1:8b'
    });

    const renamed = await service.renameSessionWithAi(session.id);

    expect(renamed.title).toBe('Ollama LAN model setup checklist');
    expect(service.listSessions()[0].title).toBe('Ollama LAN model setup checklist');
  });

  it('starts a planned run and updates the owning session', () => {
    const service = createService();
    const session = service.createSession('Core session');

    const run = service.startRun('core-chat', session.id);

    expect(run.graphId).toBe('core-chat');
    expect(run.status).toBe('planned');
    expect(run.checkpoints).toHaveLength(6);
    expect(service.listRuns()).toHaveLength(1);
    expect(service.listSessions()[0]).toMatchObject({
      id: session.id,
      status: 'queued',
      lastRunSummary: 'Prepared Core Chat Graph.'
    });
  });

  it('executes until approval is required and then can complete after approval', () => {
    const service = createService();
    const session = service.createSession('Execution session');
    const plannedRun = service.startRun('core-chat', session.id);

    const waitingRun = service.executeRun(plannedRun.id);

    expect(waitingRun.status).toBe('waiting_approval');
    expect(waitingRun.pendingApproval).toBeTruthy();
    expect(waitingRun.pendingApproval?.checkpointOrder).toBe(4);
    expect(waitingRun.pendingApproval?.approvalPolicyId).toBe('human-tool-routing-v1');
    expect(waitingRun.pendingApproval?.requiredApproverRole).toBe('runtime-reviewer');
    expect(waitingRun.checkpoints[3].status).toBe('waiting_approval');

    service.approveRun(plannedRun.id, {
      operator: 'qa-lead',
      operatorRole: 'runtime-reviewer',
      reason: 'Tool intent matches policy and scope.'
    });
    const executedRun = service.executeRun(plannedRun.id);

    expect(executedRun.status).toBe('completed');
    expect(executedRun.startedAt).toBeTruthy();
    expect(executedRun.completedAt).toBeTruthy();
    expect(executedRun.events.length).toBeGreaterThanOrEqual(7);
    expect(executedRun.events.some((event) => event.includes('Approval requested at checkpoint 4'))).toBe(true);
    expect(executedRun.events.some((event) => event.includes('operator=qa-lead'))).toBe(true);
    expect(executedRun.events.some((event) => event.includes('role=runtime-reviewer'))).toBe(true);
    expect(executedRun.events.some((event) => event.includes('reason=Tool intent matches policy and scope.'))).toBe(true);
    expect(executedRun.error).toBe('');
    expect(executedRun.output).toContain('Run finalized at');
    expect(executedRun.checkpoints.every((checkpoint) => checkpoint.status === 'completed')).toBe(true);
    expect(service.listSessions()[0]).toMatchObject({
      id: session.id,
      status: 'completed'
    });
  });

  it('advances a run one checkpoint at a time', () => {
    const service = createService();
    const session = service.createSession('Stepping session');
    const plannedRun = service.startRun('memory-ingest', session.id);

    const firstStep = service.stepRun(plannedRun.id);
    expect(firstStep.status).toBe('paused');
    expect(firstStep.events).toHaveLength(2);
    expect(firstStep.checkpoints[0].status).toBe('completed');
    expect(firstStep.checkpoints[1].status).toBe('ready');

    const secondStep = service.stepRun(plannedRun.id);
    expect(secondStep.status).toBe('paused');
    expect(secondStep.events.length).toBeGreaterThanOrEqual(4);

    service.stepRun(plannedRun.id);
    const finalStep = service.stepRun(plannedRun.id);
    expect(finalStep.status).toBe('completed');
    expect(finalStep.events.length).toBeGreaterThanOrEqual(8);
    expect(finalStep.completedAt).toBeTruthy();
    expect(Array.isArray(service.listMemoryRecords(session.id))).toBe(true);
  });

  it('cancels an in-flight run', () => {
    const service = createService();
    const session = service.createSession('Cancel session');
    const plannedRun = service.startRun('core-chat', session.id);

    service.resumeRun(plannedRun.id);
    const canceledRun = service.cancelRun(plannedRun.id);

    expect(canceledRun.status).toBe('canceled');
    expect(canceledRun.error).toBe('Canceled by operator.');
    expect(canceledRun.completedAt).toBeTruthy();
    expect(canceledRun.events[canceledRun.events.length - 1]).toContain('canceled');
    expect(service.listSessions()[0]).toMatchObject({
      id: session.id,
      status: 'canceled'
    });
  });

  it('fails a run when approval is denied', () => {
    const service = createService();
    const session = service.createSession('Denied approval session');
    const plannedRun = service.startRun('core-chat', session.id);

    const waitingRun = service.executeRun(plannedRun.id);
    expect(waitingRun.status).toBe('waiting_approval');

    const deniedRun = service.denyRun(plannedRun.id, {
      operator: 'safety-reviewer',
      operatorRole: 'runtime-reviewer',
      reason: 'Insufficient evidence for tool execution.'
    });
    expect(deniedRun.status).toBe('failed');
    expect(deniedRun.error).toContain('Approval denied');
    expect(deniedRun.completedAt).toBeTruthy();
    expect(deniedRun.checkpoints[3].status).toBe('failed');
    expect(deniedRun.events.some((event) => event.includes('operator=safety-reviewer'))).toBe(true);
    expect(deniedRun.events.some((event) => event.includes('role=runtime-reviewer'))).toBe(true);
    expect(deniedRun.events.some((event) => event.includes('reason=Insufficient evidence for tool execution.'))).toBe(true);
    expect(service.listSessions()[0]).toMatchObject({
      id: session.id,
      status: 'failed'
    });
  });

  it('rejects approval when reviewer role does not satisfy policy', () => {
    const service = createService();
    const session = service.createSession('Role mismatch session');
    const plannedRun = service.startRun('core-chat', session.id);

    const waitingRun = service.executeRun(plannedRun.id);
    expect(waitingRun.status).toBe('waiting_approval');

    expect(() => service.approveRun(plannedRun.id, {
      operator: 'developer-1',
      operatorRole: 'developer',
      reason: 'Looks okay to me.'
    })).toThrow(/Approval role mismatch/);
  });

  it('creates a default session when planning a run without one', () => {
    const service = createService();

    const run = service.startRun('memory-ingest');

    expect(run.graphId).toBe('memory-ingest');
    expect(run.status).toBe('planned');
    expect(service.listSessions()).toHaveLength(1);
    expect(service.getStatus().runCount).toBe(1);
  });

  it('persists LAN Ollama servers and reports their model health', async () => {
    const fetchImpl = async (url: string) => {
      expect(url).toBe('http://192.168.1.50:11434/api/tags');
      return {
        ok: true,
        json: async () => ({
          models: [
            { name: 'qwen3.5:9b', size: 123, modified_at: '2026-08-08T00:00:00.000Z' },
            { name: 'llama3.2:3b', size: 456, modified_at: '2026-08-07T00:00:00.000Z' }
          ]
        })
      };
    };
    const service = createService({ fetchImpl });

    const server = service.saveOllamaServer({
      label: 'Office GPU',
      endpoint: '192.168.1.50'
    });
    const health = await service.checkOllamaServer(server.id);

    expect(server).toMatchObject({
      label: 'Office GPU',
      endpoint: 'http://192.168.1.50:11434'
    });
    expect(service.listOllamaServers()).toHaveLength(1);
    expect(health).toMatchObject({
      status: 'online',
      endpoint: 'http://192.168.1.50:11434'
    });
    expect(health.models.map((model) => model.name)).toEqual(['qwen3.5:9b', 'llama3.2:3b']);

    const removed = service.removeOllamaServer(server.id);

    expect(removed).toMatchObject({ id: server.id, endpoint: 'http://192.168.1.50:11434' });
    expect(service.listOllamaServers()).toEqual([]);
  });

  it('reports an offline saved Ollama server without deleting it', async () => {
    const service = createService({
      fetchImpl: async () => {
        throw new Error('connect ECONNREFUSED');
      }
    });
    const server = service.saveOllamaServer({ endpoint: '10.0.0.8:11434' });

    const health = await service.checkOllamaServer(server.id);

    expect(health.status).toBe('offline');
    expect(health.models).toEqual([]);
    expect(health.error).toContain('ECONNREFUSED');
    expect(service.listOllamaServers()).toHaveLength(1);
  });

  it('sends a chat message through Ollama and persists the transcript', async () => {
    const fetchImpl = async (url: string) => {
      if (url.endsWith('/api/chat')) {
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

      if (url.endsWith('/api/tags')) {
        return {
          ok: true,
          json: async () => ({
            models: [{ name: 'llama3.1:8b', size: 1, modified_at: '2026-08-06T00:00:00.000Z' }]
          })
        };
      }

      throw new Error(`Unexpected URL ${url}`);
    };

    const service = createService({ fetchImpl, defaultOllamaEndpoint: 'http://127.0.0.1:11434' });
    const session = service.createSession('Chat session');
    await service.saveChatConfig({ endpoint: 'http://127.0.0.1:11434', model: 'llama3.1:8b' });

    const result = await service.sendChatMessage({
      sessionId: session.id,
      content: 'Hello there',
      endpoint: 'http://127.0.0.1:11434',
      model: 'llama3.1:8b'
    });

    expect(result.sessionId).toBe(session.id);
    expect(result.messages).toHaveLength(2);
    expect(result.userMessage.role).toBe('user');
    expect(result.assistantMessage.role).toBe('assistant');
    expect(service.listMessages(session.id)).toHaveLength(2);
  });

  it('streams a chat message through Ollama and emits token events', async () => {
    const encoder = new TextEncoder();
    const fetchImpl = async (url: string) => {
      if (url.endsWith('/api/chat')) {
        return {
          ok: true,
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(encoder.encode('{"message":{"content":"Hello"},"done":false}\n'));
              controller.enqueue(encoder.encode('{"message":{"content":" stream"},"done":false}\n'));
              controller.enqueue(encoder.encode('{"message":{"content":"ed"},"done":true}\n'));
              controller.close();
            }
          })
        };
      }

      throw new Error(`Unexpected URL ${url}`);
    };

    const service = createService({ fetchImpl, defaultOllamaEndpoint: 'http://127.0.0.1:11434' });
    const session = service.createSession('Streaming chat');
    await service.saveChatConfig({ endpoint: 'http://127.0.0.1:11434', model: 'llama3.1:8b' });

    const events: Array<Record<string, unknown>> = [];
    const result = await service.sendChatMessageStream({
      sessionId: session.id,
      content: 'Stream this',
      endpoint: 'http://127.0.0.1:11434',
      model: 'llama3.1:8b',
      requestId: 'req-1'
    }, (event) => {
      events.push(event);
    });

    expect(result.assistantMessage.content).toBe('Hello streamed');
    expect(events.map((event) => event.type)).toEqual(['started', 'token', 'token', 'token', 'completed']);
    expect(service.listMessages(session.id)).toHaveLength(2);
  });

  it('updates an existing user message content', async () => {
    const fetchImpl = async (url: string) => {
      if (url.endsWith('/api/chat')) {
        return {
          ok: true,
          json: async () => ({
            message: { content: 'Assistant response.' },
            done: true,
            total_duration: 10,
            eval_count: 5
          })
        };
      }

      throw new Error(`Unexpected URL ${url}`);
    };

    const service = createService({ fetchImpl });
    const session = service.createSession('Editable message session');
    await service.saveChatConfig({ endpoint: 'http://127.0.0.1:11434', model: 'llama3.1:8b' });
    await service.sendChatMessage({
      sessionId: session.id,
      content: 'Original prompt',
      endpoint: 'http://127.0.0.1:11434',
      model: 'llama3.1:8b'
    });

    const before = service.listMessages(session.id).find((entry) => entry.role === 'user');
    expect(before).toBeTruthy();

    const updated = service.updateMessage(before!.id, { content: 'Edited prompt content' });

    expect(updated.content).toBe('Edited prompt content');
    const after = service.listMessages(session.id).find((entry) => entry.id === updated.id);
    expect(after?.content).toBe('Edited prompt content');
  });

  it('deletes a message from transcript', async () => {
    const fetchImpl = async (url: string) => {
      if (url.endsWith('/api/chat')) {
        return {
          ok: true,
          json: async () => ({
            message: { content: 'Assistant response.' },
            done: true,
            total_duration: 10,
            eval_count: 5
          })
        };
      }

      throw new Error(`Unexpected URL ${url}`);
    };

    const service = createService({ fetchImpl });
    const session = service.createSession('Delete message session');
    await service.saveChatConfig({ endpoint: 'http://127.0.0.1:11434', model: 'llama3.1:8b' });
    await service.sendChatMessage({
      sessionId: session.id,
      content: 'Prompt to delete',
      endpoint: 'http://127.0.0.1:11434',
      model: 'llama3.1:8b'
    });

    const target = service.listMessages(session.id).find((entry) => entry.role === 'assistant');
    expect(target).toBeTruthy();
    const deleted = service.deleteMessage(target!.id);

    expect(deleted).toMatchObject({ id: target!.id, role: 'assistant' });
    const remainingIds = service.listMessages(session.id).map((entry) => entry.id);
    expect(remainingIds.includes(target!.id)).toBe(false);
    expect(service.listMessages(session.id)).toHaveLength(1);
  });
});

// Feature: auto-session-naming, Property 2: Config Persistence Round-Trip
describe('normalizeChatConfig – Property 2: Config Persistence Round-Trip', () => {
  /**
   * Validates: Requirements 1.4, 8.3
   *
   * For any valid RuntimeChatConfig object (with autoRenameEnabled set to either
   * true or false), saving the config via updateChatConfig and immediately reading
   * it back via getChatConfig SHALL produce an object where autoRenameEnabled
   * equals the original value.
   */

  it('preserves autoRenameEnabled boolean through save and read cycle', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        (autoRenameEnabled) => {
          const statePath = createTempStatePath();

          updateChatConfig(statePath, {
            endpoint: 'http://127.0.0.1:11434',
            model: 'llama3.2',
            autoRenameEnabled
          });

          const readBack = getChatConfig(statePath);
          expect(readBack.autoRenameEnabled).toBe(autoRenameEnabled);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('preserves autoRenameEnabled through updater function pattern', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        (autoRenameEnabled) => {
          const statePath = createTempStatePath();

          updateChatConfig(statePath, (current) => ({
            ...current,
            autoRenameEnabled
          }));

          const readBack = getChatConfig(statePath);
          expect(readBack.autoRenameEnabled).toBe(autoRenameEnabled);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('preserves autoRenameEnabled across multiple save/read cycles', () => {
    fc.assert(
      fc.property(
        fc.array(fc.boolean(), { minLength: 1, maxLength: 10 }),
        (booleans) => {
          const statePath = createTempStatePath();

          for (const value of booleans) {
            updateChatConfig(statePath, (current) => ({
              ...current,
              autoRenameEnabled: value
            }));
          }

          const readBack = getChatConfig(statePath);
          const lastValue = booleans[booleans.length - 1];
          expect(readBack.autoRenameEnabled).toBe(lastValue);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: agent-system-prompts, Property 3: System prompt persistence round-trip
describe('systemPrompt – Property 3: System prompt persistence round-trip', () => {
  /**
   * Validates: Requirements 2.5, 2.7, 6.2, 6.3
   *
   * For any normalized systemPrompt value, saving it via updateChatConfig (or
   * runtimeService.saveChatConfig) and reading it back via getChatConfig —
   * including through a read/normalize cycle from a state shape that predates
   * this feature — yields an equal systemPrompt.
   */

  /** Mirrors normalizeChatConfig: trim then bound to MAX_SYSTEM_PROMPT_LENGTH. */
  function normalizeSystemPrompt(value: string) {
    return value.trim().slice(0, MAX_SYSTEM_PROMPT_LENGTH);
  }

  it('round-trips systemPrompt through updateChatConfig and getChatConfig', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: MAX_SYSTEM_PROMPT_LENGTH + 500 }),
        (systemPrompt) => {
          const statePath = createTempStatePath();

          updateChatConfig(statePath, {
            endpoint: 'http://127.0.0.1:11434',
            model: 'llama3.2',
            systemPrompt
          });

          const readBack = getChatConfig(statePath);
          expect(readBack.systemPrompt).toBe(normalizeSystemPrompt(systemPrompt));
        }
      ),
      { numRuns: 100 }
    );
  });

  it('round-trips systemPrompt through runtimeService.saveChatConfig and getChatConfig', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ maxLength: MAX_SYSTEM_PROMPT_LENGTH + 500 }),
        async (systemPrompt) => {
          const statePath = createTempStatePath();
          const service = createService({ statePath });

          const saved = await service.saveChatConfig({
            endpoint: 'http://127.0.0.1:11434',
            model: 'llama3.2',
            systemPrompt
          });

          const expected = normalizeSystemPrompt(systemPrompt);
          expect(saved.systemPrompt).toBe(expected);

          const readBack = getChatConfig(statePath);
          expect(readBack.systemPrompt).toBe(expected);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('defaults systemPrompt to empty string when reading a pre-feature state shape', () => {
    fc.assert(
      fc.property(
        // Pre-feature chatConfig shapes carried only endpoint/model/autoRenameEnabled.
        fc.record({
          endpoint: fc.constant('http://127.0.0.1:11434'),
          model: fc.string({ maxLength: 40 }),
          autoRenameEnabled: fc.boolean()
        }),
        (legacyChatConfig) => {
          const statePath = createTempStatePath();

          // Write a raw state.json that predates the feature (no systemPrompt key).
          const legacyState = {
            sessions: [],
            runs: [],
            messages: [],
            ollamaServers: [],
            memoryRecords: [],
            chatConfig: legacyChatConfig
          };
          fs.mkdirSync(path.dirname(statePath), { recursive: true });
          fs.writeFileSync(statePath, JSON.stringify(legacyState, null, 2), 'utf8');

          const readBack = getChatConfig(statePath);
          expect(readBack.systemPrompt).toBe('');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('preserves a persisted systemPrompt across a pre-feature read/normalize/upgrade cycle', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 200 }),
        (systemPrompt) => {
          const statePath = createTempStatePath();

          // Simulate a legacy state that also happens to include a systemPrompt-like
          // value written by an older build; it must survive the normalize cycle.
          const legacyState = {
            sessions: [],
            runs: [],
            messages: [],
            ollamaServers: [],
            memoryRecords: [],
            chatConfig: {
              endpoint: 'http://127.0.0.1:11434',
              model: 'llama3.2',
              autoRenameEnabled: true,
              systemPrompt
            }
          };
          fs.mkdirSync(path.dirname(statePath), { recursive: true });
          fs.writeFileSync(statePath, JSON.stringify(legacyState, null, 2), 'utf8');

          const readBack = getChatConfig(statePath);
          expect(readBack.systemPrompt).toBe(normalizeSystemPrompt(systemPrompt));
        }
      ),
      { numRuns: 100 }
    );
  });
});

// Feature: agent-system-prompts, Task 6.1: master prompt not returned by chat-config bridge
describe('getChatConfig – master prompt is not exposed through the chat-config getter', () => {
  /**
   * Validates: Requirements 7.4, 1.4, 6.4
   *
   * The Master_Prompt is defined in the main process and applied at transcript
   * assembly time only. It must never be returned by the chat-config getter/bridge.
   * Even when the override env var (MASTER_PROMPT_ENV_VAR) is set to a recognizable
   * value and a chat config is saved, getChatConfig() must expose only the four
   * known chat-config keys and must not leak the master text.
   */

  const MASTER_TEXT = 'MASTER_PROMPT_SENTINEL_do_not_leak_9e3f7a';
  const originalMasterEnv = process.env[MASTER_PROMPT_ENV_VAR];

  afterEach(() => {
    if (originalMasterEnv === undefined) {
      delete process.env[MASTER_PROMPT_ENV_VAR];
    } else {
      process.env[MASTER_PROMPT_ENV_VAR] = originalMasterEnv;
    }
  });

  it('returns only the four known keys with no master-prompt key of any casing, and does not contain the master text', async () => {
    process.env[MASTER_PROMPT_ENV_VAR] = MASTER_TEXT;

    // Sanity check: the resolver actually surfaces the sentinel in the main process.
    expect(resolveMasterPrompt()).toBe(MASTER_TEXT);

    const statePath = createTempStatePath();
    const service = createService({ statePath });

    await service.saveChatConfig({
      endpoint: 'http://127.0.0.1:11434',
      model: 'llama3.2',
      systemPrompt: 'be concise'
    });

    // Read back via both the service getter and the store getter.
    const viaService = service.getChatConfig();
    const viaStore = getChatConfig(statePath);

    for (const config of [viaService, viaStore]) {
      // Exactly the four known chat-config keys — nothing more.
      expect(Object.keys(config).sort()).toEqual(
        ['autoRenameEnabled', 'endpoint', 'model', 'systemPrompt'].sort()
      );

      // No master-prompt key of any casing/spelling.
      const hasMasterKey = Object.keys(config).some((key) =>
        key.toLowerCase().replace(/[^a-z]/g, '').includes('masterprompt')
      );
      expect(hasMasterKey).toBe(false);

      // The serialized config must not contain the recognizable master text.
      expect(JSON.stringify(config)).not.toContain(MASTER_TEXT);
    }
  });
});

// Feature: agent-system-prompts, Property 9: The master prompt never reaches persisted state
describe('systemPrompt – Property 9: master prompt never reaches persisted state', () => {
  /**
   * Validates: Requirements 1.5 (also covers Req 7.5)
   *
   * For any master-prompt string (via the override env var) and any saved
   * systemPrompt, after saving the chat config the persisted state.json bytes do
   * not contain the master text and the persisted chatConfig object has no
   * master-prompt key.
   *
   * A recognizable sentinel prefix keeps the "master text absent" assertion
   * meaningful: the generated master string can never coincidentally be empty or
   * appear inside an unrelated systemPrompt, and the systemPrompt generator is
   * constrained so it never embeds the sentinel.
   */

  // Sentinel prefix guarantees the resolved master text is non-trivial and unique,
  // so its absence from the persisted bytes is a genuine signal (not a coincidence).
  const MASTER_SENTINEL = 'MASTER_PROMPT_SENTINEL_never_persist_7b1c9d::';
  const originalMasterEnv = process.env[MASTER_PROMPT_ENV_VAR];

  afterEach(() => {
    if (originalMasterEnv === undefined) {
      delete process.env[MASTER_PROMPT_ENV_VAR];
    } else {
      process.env[MASTER_PROMPT_ENV_VAR] = originalMasterEnv;
    }
  });

  it('does not write the master text or any master-prompt key to state.json for arbitrary master/systemPrompt inputs', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Arbitrary master body; the sentinel prefix is applied below so the
        // effective master text is always recognizable and non-empty.
        fc.string({ maxLength: 500 }),
        // Arbitrary systemPrompt. Guard: it must not contain the sentinel, so any
        // occurrence of the master text in the raw bytes can only come from a leak.
        fc.string({ maxLength: MAX_SYSTEM_PROMPT_LENGTH + 200 }).filter(
          (value) => !value.includes(MASTER_SENTINEL)
        ),
        async (masterBody, systemPrompt) => {
          const masterText = `${MASTER_SENTINEL}${masterBody}`;
          process.env[MASTER_PROMPT_ENV_VAR] = masterText;

          // Sanity: the resolver surfaces the sentinel in the main process, so the
          // master text is genuinely "in play" for this iteration.
          expect(resolveMasterPrompt()).toContain(MASTER_SENTINEL);

          const statePath = createTempStatePath();
          const service = createService({ statePath });

          await service.saveChatConfig({
            endpoint: 'http://127.0.0.1:11434',
            model: 'llama3.2',
            systemPrompt
          });

          // Read the raw persisted bytes exactly as they hit disk.
          const rawBytes = fs.readFileSync(statePath, 'utf8');

          // The recognizable master text must never appear in the persisted file.
          expect(rawBytes.includes(MASTER_SENTINEL)).toBe(false);
          expect(rawBytes.includes(masterText)).toBe(false);

          // The persisted chatConfig must carry no master-prompt key of any casing.
          const parsed = JSON.parse(rawBytes);
          const chatConfig = parsed.chatConfig ?? {};
          const hasMasterKey = Object.keys(chatConfig).some((key) =>
            key.toLowerCase().replace(/[^a-z]/g, '').includes('masterprompt')
          );
          expect(hasMasterKey).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});
