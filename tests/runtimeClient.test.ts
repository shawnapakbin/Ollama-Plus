import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runtimeClient, type RuntimeChatConfig } from '../src/services/runtimeClient';

describe('runtimeClient gateway bridge', () => {
  const originalWindow = globalThis.window;

  beforeEach(() => {
    (globalThis as typeof globalThis & { window?: Window }).window = {
      electronAPI: {
        mcpGatewayStatus: vi.fn().mockResolvedValue({ ok: true, data: { gateway: { ok: true } } }),
        mcpGatewayCall: vi.fn().mockResolvedValue({ ok: true, data: { sessionId: 'abc' } })
      }
    } as unknown as Window;
  });

  afterEach(() => {
    if (typeof originalWindow === 'undefined') {
      delete (globalThis as typeof globalThis & { window?: Window }).window;
    } else {
      (globalThis as typeof globalThis & { window?: Window }).window = originalWindow;
    }
  });

  it('exposes MCP gateway status and call helpers through the preload bridge', async () => {
    await expect(runtimeClient.mcpGatewayStatus()).resolves.toEqual({ ok: true, data: { gateway: { ok: true } } });
    await expect(runtimeClient.mcpGatewayCall({ server: 'browser', action: 'list_sessions' })).resolves.toEqual({ ok: true, data: { sessionId: 'abc' } });
  });
});

describe('runtimeClient chat config systemPrompt', () => {
  const originalWindow = globalThis.window;

  // A config object literal that includes systemPrompt must typecheck as RuntimeChatConfig.
  const persistedConfig: RuntimeChatConfig = {
    endpoint: 'http://127.0.0.1:11434',
    model: 'llama3',
    autoRenameEnabled: true,
    systemPrompt: 'You are a helpful assistant.'
  };

  let saveRuntimeChatConfig: ReturnType<typeof vi.fn>;
  let getRuntimeChatConfig: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Store simulates the normalized config that the main process persists and returns.
    let stored: RuntimeChatConfig = { ...persistedConfig };

    saveRuntimeChatConfig = vi.fn(async (input: Partial<RuntimeChatConfig>) => {
      stored = {
        endpoint: input.endpoint ?? stored.endpoint,
        model: input.model ?? stored.model,
        autoRenameEnabled: input.autoRenameEnabled ?? stored.autoRenameEnabled,
        systemPrompt: input.systemPrompt ?? stored.systemPrompt
      };
      return stored;
    });
    getRuntimeChatConfig = vi.fn(async () => stored);

    (globalThis as typeof globalThis & { window?: Window }).window = {
      electronAPI: {
        saveRuntimeChatConfig,
        getRuntimeChatConfig
      }
    } as unknown as Window;
  });

  afterEach(() => {
    if (typeof originalWindow === 'undefined') {
      delete (globalThis as typeof globalThis & { window?: Window }).window;
    } else {
      (globalThis as typeof globalThis & { window?: Window }).window = originalWindow;
    }
  });

  it('round-trips a systemPrompt value through saveChatConfig and getChatConfig', async () => {
    // Partial update carrying only systemPrompt must typecheck.
    const update: Partial<RuntimeChatConfig> = { systemPrompt: 'Stay concise and cite sources.' };

    const saved = (await runtimeClient.saveChatConfig(update)) as RuntimeChatConfig;
    expect(saveRuntimeChatConfig).toHaveBeenCalledWith(update);
    expect(saved.systemPrompt).toBe('Stay concise and cite sources.');

    const readBack = (await runtimeClient.getChatConfig()) as RuntimeChatConfig;
    expect(readBack.systemPrompt).toBe('Stay concise and cite sources.');
    // Existing fields are untouched by a systemPrompt-only update.
    expect(readBack.endpoint).toBe(persistedConfig.endpoint);
    expect(readBack.model).toBe(persistedConfig.model);
    expect(readBack.autoRenameEnabled).toBe(persistedConfig.autoRenameEnabled);
  });

  it('does not expose any master-prompt field on the chat config surface', async () => {
    const saved = (await runtimeClient.saveChatConfig(persistedConfig)) as Record<string, unknown>;
    const readBack = (await runtimeClient.getChatConfig()) as Record<string, unknown>;

    for (const config of [saved, readBack]) {
      const keys = Object.keys(config);
      expect(keys).toEqual(expect.arrayContaining(['endpoint', 'model', 'autoRenameEnabled', 'systemPrompt']));
      // No master-prompt key of any casing/variant is present.
      const masterKeys = keys.filter((key) => /master/i.test(key));
      expect(masterKeys).toEqual([]);
    }
  });
});
