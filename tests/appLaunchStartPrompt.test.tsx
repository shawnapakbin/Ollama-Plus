/**
 * App-launch Tests: launch Start_Prompt gating + start flow (Task 7.2)
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 *
 * Renders <App /> with a mocked runtimeClient (matching the pattern in
 * tests/appSystemPromptSettings.test.tsx) so the launch reachability probe runs
 * and drives the launch-time Start_Prompt. The probe classification decides
 * whether the modal appears; the user's choice drives the start flow.
 *
 * Coverage:
 * - offline + local  -> prompt appears on launch (R2.1)
 * - online           -> no prompt (R2.2)
 * - offline + remote  -> no prompt; pill reflects offline (R2.3)
 * - affirmative -> startOllamaServer called; on success refreshes models (R2.4, R4.7)
 * - negative -> prompt dismissed; pill stays offline (R2.5)
 * - start failure -> surfaced through the Status_Popup as a startError (R4.7 fail path)
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 4.7
 */

// @vitest-environment jsdom

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import type { RuntimeChatConfig } from '../src/services/runtimeClient';

// ─── Module mock ─────────────────────────────────────────────────────────────
// Replace every runtimeClient method with a controllable stub while keeping the
// real non-method exports (constants/types) intact.

const {
  getChatConfig,
  probeOllamaReachability,
  startOllamaServer,
  listOllamaModels,
} = vi.hoisted(() => ({
  getChatConfig: vi.fn(),
  probeOllamaReachability: vi.fn(),
  startOllamaServer: vi.fn(),
  listOllamaModels: vi.fn(),
}));

vi.mock('../src/services/runtimeClient', async () => {
  const actual = await vi.importActual<typeof import('../src/services/runtimeClient')>(
    '../src/services/runtimeClient',
  );
  const emptyStatus = {
    appVersion: '0.0.0',
    electronVersion: '0.0.0',
    chromeVersion: '0.0.0',
    nodeVersion: '0.0.0',
    mode: 'development',
    workspaceRoot: '/tmp',
    runtimeStoragePath: '/tmp/state.json',
    langsmith: { configured: false, mode: 'optional-disabled' },
    capabilities: {
      offlineFirst: true,
      langGraphRuntime: '',
      langChainAdapters: '',
      langFlowSurface: '',
      approvalCheckpoints: '',
      durableRuns: '',
    },
    sessionCount: 0,
    latestSessionAt: null,
    runCount: 0,
  };
  return {
    ...actual,
    runtimeClient: {
      getStatus: vi.fn(async () => emptyStatus),
      getBootstrapPlan: vi.fn(async () => ({ pillars: [], milestones: [] })),
      getGraphCatalog: vi.fn(async () => []),
      listSessions: vi.fn(async () => []),
      getChatConfig,
      listOllamaServers: vi.fn(async () => []),
      listOllamaModels,
      listMessages: vi.fn(async () => []),
      listRuns: vi.fn(async () => []),
      listMemoryRecords: vi.fn(async () => []),
      checkOllamaServer: vi.fn(async () => ({})),
      saveChatConfig: vi.fn(async (input: Partial<RuntimeChatConfig>) => ({
        endpoint: 'http://127.0.0.1:11434',
        model: '',
        autoRenameEnabled: true,
        systemPrompt: input.systemPrompt ?? '',
      })),
      probeOllamaReachability,
      startOllamaServer,
      mcpGatewayStatus: vi.fn(async () => ({ ok: true, data: {} })),
      mcpGatewayCall: vi.fn(async () => ({ ok: true, data: {} })),
      onChatStream: vi.fn(() => () => {}),
      getBridgeHealth: vi.fn(() => ({ ok: true, missingMethods: [], availableMethods: [] })),
    },
  };
});

// Import App AFTER the mock is registered.
import App from '../src/App';

// ─── jsdom environment shims ─────────────────────────────────────────────────

const LOCAL_ENDPOINT = 'http://127.0.0.1:11434';
const REMOTE_ENDPOINT = 'http://192.168.1.50:11434';

beforeEach(() => {
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }
  window.localStorage.clear();

  getChatConfig.mockReset();
  probeOllamaReachability.mockReset();
  startOllamaServer.mockReset();
  listOllamaModels.mockReset();

  getChatConfig.mockResolvedValue({
    endpoint: LOCAL_ENDPOINT,
    model: '',
    autoRenameEnabled: true,
    systemPrompt: '',
  } satisfies RuntimeChatConfig);

  listOllamaModels.mockResolvedValue({
    endpoint: LOCAL_ENDPOINT,
    model: '',
    availableModels: [],
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Render App and wait for the initial config load to complete. */
async function renderApp() {
  render(<App />);
  await waitFor(() => {
    expect(getChatConfig).toHaveBeenCalled();
  });
}

/** The launch Start_Prompt dialog, identified by its title. */
function startPromptDialog(): HTMLElement | null {
  const title = screen.queryByText(/start the ollama server\?/i);
  return title ? (title.closest('[role="dialog"]') as HTMLElement | null) : null;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('App launch Start_Prompt gating', () => {
  it('presents the Start_Prompt when the launch probe is offline + local (R2.1)', async () => {
    probeOllamaReachability.mockResolvedValue({
      reachable: false,
      kind: 'local',
      normalizedEndpoint: LOCAL_ENDPOINT,
      reason: 'refused',
    });

    await renderApp();

    await waitFor(() => {
      expect(startPromptDialog()).not.toBeNull();
    });
  });

  it('does NOT present the Start_Prompt when the launch probe is online (R2.2)', async () => {
    probeOllamaReachability.mockResolvedValue({
      reachable: true,
      kind: 'local',
      normalizedEndpoint: LOCAL_ENDPOINT,
      status: 200,
    });

    await renderApp();

    // Let the probe resolve and any state settle.
    await waitFor(() => {
      expect(probeOllamaReachability).toHaveBeenCalled();
    });
    await Promise.resolve();
    expect(startPromptDialog()).toBeNull();
  });

  it('does NOT present the Start_Prompt when the launch probe is offline + remote (R2.3)', async () => {
    getChatConfig.mockResolvedValue({
      endpoint: REMOTE_ENDPOINT,
      model: '',
      autoRenameEnabled: true,
      systemPrompt: '',
    } satisfies RuntimeChatConfig);
    probeOllamaReachability.mockResolvedValue({
      reachable: false,
      kind: 'remote',
      normalizedEndpoint: REMOTE_ENDPOINT,
      reason: 'refused',
    });

    await renderApp();

    await waitFor(() => {
      expect(probeOllamaReachability).toHaveBeenCalled();
    });
    await Promise.resolve();
    // No launch prompt for a remote endpoint.
    expect(startPromptDialog()).toBeNull();
    // The pill reflects offline instead.
    await waitFor(() => {
      const p = screen.getByRole('button', { name: /ollama server status/i });
      expect(p.textContent).toMatch(/offline/i);
    });
  });

  it('affirmative triggers startOllamaServer and refreshes models on success (R2.4, R4.7)', async () => {
    probeOllamaReachability.mockResolvedValue({
      reachable: false,
      kind: 'local',
      normalizedEndpoint: LOCAL_ENDPOINT,
      reason: 'refused',
    });
    startOllamaServer.mockResolvedValue({ ok: true });
    listOllamaModels.mockResolvedValue({
      endpoint: LOCAL_ENDPOINT,
      model: 'llama3',
      availableModels: ['llama3'],
    });

    await renderApp();

    await waitFor(() => {
      expect(startPromptDialog()).not.toBeNull();
    });

    // The launch probe on mount calls listOllamaModels 0 times here; record the
    // baseline so we can assert the start flow refreshes the catalog.
    const modelsBefore = listOllamaModels.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: /start server/i }));

    await waitFor(() => {
      expect(startOllamaServer).toHaveBeenCalledWith(LOCAL_ENDPOINT);
    });
    // R4.7: a successful start refreshes the model catalog for the endpoint.
    await waitFor(() => {
      expect(listOllamaModels.mock.calls.length).toBeGreaterThan(modelsBefore);
      expect(listOllamaModels).toHaveBeenCalledWith(LOCAL_ENDPOINT);
    });
    // The prompt closes once the start flow runs.
    await waitFor(() => {
      expect(startPromptDialog()).toBeNull();
    });
    // The pill reflects online after a successful start.
    await waitFor(() => {
      const p = screen.getByRole('button', { name: /ollama server status/i });
      expect(p.textContent).toMatch(/online/i);
    });
  });

  it('negative dismisses the prompt and leaves the pill offline (R2.5)', async () => {
    probeOllamaReachability.mockResolvedValue({
      reachable: false,
      kind: 'local',
      normalizedEndpoint: LOCAL_ENDPOINT,
      reason: 'refused',
    });

    await renderApp();

    await waitFor(() => {
      expect(startPromptDialog()).not.toBeNull();
    });

    fireEvent.click(screen.getByRole('button', { name: /not now/i }));

    await waitFor(() => {
      expect(startPromptDialog()).toBeNull();
    });
    // The start flow was never invoked.
    expect(startOllamaServer).not.toHaveBeenCalled();
    // The pill continues to reflect offline.
    const p = screen.getByRole('button', { name: /ollama server status/i });
    expect(p.textContent).toMatch(/offline/i);
  });

  it('surfaces a start failure through the Status_Popup (R4.7 failure path)', async () => {
    probeOllamaReachability.mockResolvedValue({
      reachable: false,
      kind: 'local',
      normalizedEndpoint: LOCAL_ENDPOINT,
      reason: 'refused',
    });
    startOllamaServer.mockResolvedValue({ ok: false, reason: 'binary-not-found' });

    await renderApp();

    await waitFor(() => {
      expect(startPromptDialog()).not.toBeNull();
    });

    fireEvent.click(screen.getByRole('button', { name: /start server/i }));

    await waitFor(() => {
      expect(startOllamaServer).toHaveBeenCalledWith(LOCAL_ENDPOINT);
    });

    // The prompt closes and the pill returns to offline.
    await waitFor(() => {
      expect(startPromptDialog()).toBeNull();
    });
    const pill = await screen.findByRole('button', { name: /ollama server status/i });
    await waitFor(() => {
      expect(pill.textContent).toMatch(/offline/i);
    });

    // Activating the pill opens the Status_Popup, which surfaces the failure.
    fireEvent.click(pill);
    const popup = await screen.findByRole('dialog');
    expect(popup.textContent).toMatch(/could not be found/i);
  });
});
