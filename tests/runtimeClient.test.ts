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

// Feature: gpu-selection, Task 8.4: IPC round-trip and bridge-health tests
//
// These tests verify the GPU IPC transport wiring (Requirements 1.1, 2.6, 6.1),
// not the pure GPU logic (which is covered by the runtimeService/gpuService
// property and unit tests). They exercise the renderer `runtimeClient` methods
// end-to-end against a real `runtimeService`, simulating the preload bridge by
// pointing `window.electronAPI` at handlers that delegate to the service the
// same way the Main-process IPC handlers do.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRuntimeService } from '../electron/runtime/runtimeService.js';
import { getGpuConfig } from '../electron/runtime/runtimeStore.js';

describe('runtimeClient GPU IPC round-trip', () => {
  const originalWindow = globalThis.window;
  const tempDirs: string[] = [];

  function createTempStatePath() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-plus-gpu-ipc-'));
    tempDirs.push(dir);
    return path.join(dir, 'state.json');
  }

  /**
   * Build a real runtimeService over a temp state file with an injected GPU
   * enumeration implementation reporting `detected`, then expose the three GPU
   * bridge methods on `window.electronAPI` exactly as the preload bridge does:
   * each renderer channel delegates to the corresponding service method.
   */
  function wireBridge(statePath: string, detected: Array<{ index: number; name: string }>) {
    const service = createRuntimeService({
      statePath,
      appVersion: '0.0.1-test',
      mode: 'development',
      workspaceRoot: 'C:/workspace',
      versions: { electron: '41.0.0', chrome: '141.0.0', node: '24.0.0' },
      langsmithConfigured: false,
      enumerateGpusImpl: async () => ({ ok: true, gpus: detected })
    });

    (globalThis as typeof globalThis & { window?: Window }).window = {
      electronAPI: {
        listDetectedGpus: () => service.getDetectedGpus(),
        getGpuSelectionState: () => service.getGpuSelectionState(),
        saveGpuSelection: (input: unknown) => service.saveGpuSelection(input as { allowedIndices: number[]; cpuOnly?: boolean })
      }
    } as unknown as Window;

    return service;
  }

  afterEach(() => {
    if (typeof originalWindow === 'undefined') {
      delete (globalThis as typeof globalThis & { window?: Window }).window;
    } else {
      (globalThis as typeof globalThis & { window?: Window }).window = originalWindow;
    }

    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it('routes saveGpuSelection through the bridge to the service and persists the change', async () => {
    const statePath = createTempStatePath();
    wireBridge(statePath, [
      { index: 0, name: 'GPU 0' },
      { index: 1, name: 'GPU 1' }
    ]);

    const result = await runtimeClient.saveGpuSelection({ allowedIndices: [1] });

    // The save reached the service and succeeded for a detected index.
    expect(result).toMatchObject({ ok: true, cpuOnly: false });

    // The persisted config in the runtime state store reflects the change.
    const persisted = getGpuConfig(statePath);
    expect(persisted.allowedIndices).toEqual([1]);
    expect(persisted.cpuOnly).toBe(false);
  });

  it('persists an intentional CPU-only selection through the bridge', async () => {
    const statePath = createTempStatePath();
    wireBridge(statePath, [{ index: 0, name: 'GPU 0' }]);

    const result = await runtimeClient.saveGpuSelection({ allowedIndices: [] });

    expect(result).toMatchObject({ ok: true, cpuOnly: true });

    const persisted = getGpuConfig(statePath);
    expect(persisted.allowedIndices).toEqual([]);
    expect(persisted.cpuOnly).toBe(true);
  });

  it('returns a well-formed GpuSelectionState through getGpuSelectionState', async () => {
    const statePath = createTempStatePath();
    wireBridge(statePath, [
      { index: 0, name: 'GPU 0' },
      { index: 1, name: 'GPU 1' }
    ]);

    // Persist a selection first so the effective state is a concrete subset.
    await runtimeClient.saveGpuSelection({ allowedIndices: [1] });

    const state = await runtimeClient.getGpuSelectionState();

    // detection: discriminated success result carrying the detected devices.
    expect(state.detection).toEqual({
      ok: true,
      gpus: [
        { index: 0, name: 'GPU 0' },
        { index: 1, name: 'GPU 1' }
      ]
    });

    // config: the persisted, normalized selection reported verbatim.
    expect(state.config).toEqual({ allowedIndices: [1], cpuOnly: false });

    // effective: reconciled against detected devices (stored ∩ detected).
    expect(state.effective.mode).toBe('subset');
    expect(state.effective.availableIndices).toEqual([1]);
    expect(state.effective.unavailableIndices).toEqual([]);

    // appliedStateAvailable: the state was fully determined this retrieval.
    expect(state.appliedStateAvailable).toBe(true);
  });
});

describe('runtimeClient getBridgeHealth – GPU bridge methods', () => {
  const originalWindow = globalThis.window;

  // The full set of methods the required-bridge check expects to be present.
  // Mirrors REQUIRED_RUNTIME_BRIDGE_METHODS in runtimeClient.ts.
  const REQUIRED_METHODS = [
    'getRuntimeStatus',
    'getRuntimeBootstrapPlan',
    'getGraphCatalog',
    'listRuntimeSessions',
    'createRuntimeSession',
    'renameRuntimeSession',
    'renameRuntimeSessionWithAi',
    'deleteRuntimeSession',
    'getRuntimeChatConfig',
    'saveRuntimeChatConfig',
    'listDetectedGpus',
    'getGpuSelectionState',
    'saveGpuSelection',
    'listRuntimeOllamaModels',
    'listRuntimeOllamaServers',
    'saveRuntimeOllamaServer',
    'removeRuntimeOllamaServer',
    'checkRuntimeOllamaServer',
    'listRuntimeMessages',
    'updateRuntimeMessage',
    'deleteRuntimeMessage',
    'sendRuntimeChatMessage',
    'sendRuntimeChatMessageStream',
    'onRuntimeChatStream',
    'listRuntimeRuns',
    'listRuntimeMemoryRecords',
    'startRuntimeRun',
    'executeRuntimeRun',
    'resumeRuntimeRun',
    'stepRuntimeRun',
    'cancelRuntimeRun',
    'approveRuntimeRun',
    'denyRuntimeRun',
    'mcpGatewayCall',
    'mcpGatewayStatus'
  ] as const;

  const NEW_GPU_METHODS = ['listDetectedGpus', 'getGpuSelectionState', 'saveGpuSelection'] as const;

  function makeBridge(methodNames: readonly string[]) {
    const api: Record<string, unknown> = {};
    for (const name of methodNames) {
      api[name] = vi.fn();
    }
    (globalThis as typeof globalThis & { window?: Window }).window = {
      electronAPI: api
    } as unknown as Window;
  }

  afterEach(() => {
    if (typeof originalWindow === 'undefined') {
      delete (globalThis as typeof globalThis & { window?: Window }).window;
    } else {
      (globalThis as typeof globalThis & { window?: Window }).window = originalWindow;
    }
  });

  it('treats the new GPU methods as required and reports ok when all required methods are present', () => {
    makeBridge(REQUIRED_METHODS);

    const health = runtimeClient.getBridgeHealth();

    expect(health.ok).toBe(true);
    expect(health.missingMethods).toEqual([]);
    // The new GPU methods are among the available bridge methods.
    for (const method of NEW_GPU_METHODS) {
      expect(health.availableMethods).toContain(method);
    }
  });

  it.each(NEW_GPU_METHODS)('reports %s in missingMethods when the bridge omits that GPU method', (missing) => {
    makeBridge(REQUIRED_METHODS.filter((name) => name !== missing));

    const health = runtimeClient.getBridgeHealth();

    expect(health.ok).toBe(false);
    expect(health.missingMethods).toContain(missing);
  });
});
