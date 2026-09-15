/**
 * Component + App-level Tests: send-time Send_Intercept_Prompt (Task 8.2)
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 *
 * Two layers of coverage for the send interception behavior of Requirement 6:
 *
 * 1. Direct component tests of `src/components/ServerStatus/SendInterceptPrompt.tsx`:
 *    open/closed rendering, the local (Start + Cancel) vs remote (Cancel only,
 *    unreachable message) affordances, the choice callbacks (Start/Cancel/close/
 *    Escape), the surfaced `startError`, and the busy state.
 *
 * 2. App-level integration by rendering <App /> with a mocked runtimeClient
 *    (matching tests/appLaunchStartPrompt.test.tsx). The launch reachability
 *    probe resolves offline+local so `serverStatus` becomes offline; typing into
 *    the composer and clicking Send exercises the offline guard:
 *      • the intercept opens and NO chat message is dispatched (R6.1),
 *      • the composer content is preserved (R6.2),
 *      • local offers Start + Cancel (R6.3), remote offers Cancel only (R6.4),
 *      • Start success dispatches the preserved message (R6.5),
 *      • Start failure retains the content unsent and surfaces the failure (R6.6),
 *      • Cancel dismisses without dispatch and retains the content (R6.7).
 *
 * Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7
 */

// @vitest-environment jsdom

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import type { RuntimeChatConfig } from '../src/services/runtimeClient';

// ─── Component: SendInterceptPrompt (direct) ─────────────────────────────────
// The component imports a CSS file; stub it so jsdom doesn't choke.
vi.mock('../src/components/ServerStatus/SendInterceptPrompt.css', () => ({}));

import { SendInterceptPrompt } from '../src/components/ServerStatus';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SendInterceptPrompt component', () => {
  it('renders nothing when open is false; a modal dialog when open', () => {
    const { rerender } = render(
      <SendInterceptPrompt open={false} onStart={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();

    rerender(
      <SendInterceptPrompt open endpointKind="local" onStart={vi.fn()} onCancel={vi.fn()} />,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('offers Start + Cancel for a local endpoint (R6.3)', () => {
    render(
      <SendInterceptPrompt open endpointKind="local" onStart={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByText(/start the ollama server to send\?/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /start and send/i })).toBeTruthy();
    // There is at least one Cancel affordance (the action button + the header close).
    expect(screen.getAllByRole('button', { name: /cancel/i }).length).toBeGreaterThan(0);
  });

  it('offers Cancel only with an unreachable message for a remote endpoint (R6.4)', () => {
    render(
      <SendInterceptPrompt open endpointKind="remote" onStart={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByText(/ollama server is not reachable/i)).toBeTruthy();
    // The body explains it cannot be started by this app.
    expect(screen.getByText(/cannot be started by this app/i)).toBeTruthy();
    // No Start action for a remote endpoint.
    expect(screen.queryByRole('button', { name: /start and send/i })).toBeNull();
    // Cancel is still offered.
    expect(screen.getAllByRole('button', { name: /cancel/i }).length).toBeGreaterThan(0);
  });

  it('calls onStart when the Start action is clicked (R6.5)', () => {
    const onStart = vi.fn();
    render(
      <SendInterceptPrompt open endpointKind="local" onStart={onStart} onCancel={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /start and send/i }));
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('calls onCancel via the Cancel button, the header close, and Escape (R6.7)', () => {
    const onCancel = vi.fn();
    const { rerender } = render(
      <SendInterceptPrompt open endpointKind="local" onStart={vi.fn()} onCancel={onCancel} />,
    );

    // The action-row Cancel button is the last "Cancel"-labelled button.
    const cancels = screen.getAllByRole('button', { name: /cancel/i });
    fireEvent.click(cancels[cancels.length - 1]);
    expect(onCancel).toHaveBeenCalledTimes(1);

    rerender(
      <SendInterceptPrompt open endpointKind="local" onStart={vi.fn()} onCancel={onCancel} />,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('dismisses (onCancel) on a backdrop mousedown', () => {
    const onCancel = vi.fn();
    render(
      <SendInterceptPrompt open endpointKind="local" onStart={vi.fn()} onCancel={onCancel} />,
    );
    const dialog = screen.getByRole('dialog');
    const overlay = dialog.parentElement as HTMLElement;
    fireEvent.mouseDown(overlay);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('surfaces a start failure through a role="alert" element (R6.6)', () => {
    render(
      <SendInterceptPrompt
        open
        endpointKind="local"
        startError="The Ollama executable could not be found on this system."
        onStart={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toMatch(/could not be found/i);
  });

  it('shows a busy label and disables the actions while busy', () => {
    const onStart = vi.fn();
    const onCancel = vi.fn();
    render(
      <SendInterceptPrompt open endpointKind="local" busy onStart={onStart} onCancel={onCancel} />,
    );

    const start = screen.getByRole('button', { name: /starting…/i }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    const cancels = screen.getAllByRole('button', { name: /cancel/i }) as HTMLButtonElement[];
    cancels.forEach((btn) => expect(btn.disabled).toBe(true));

    // Escape is suppressed while busy.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
  });
});

// ─── App-level integration ───────────────────────────────────────────────────
// Replace every runtimeClient method with a controllable stub while keeping the
// real non-method exports (constants/types) intact.

const {
  getChatConfig,
  probeOllamaReachability,
  startOllamaServer,
  listOllamaModels,
  createSession,
  sendChatMessageStream,
} = vi.hoisted(() => ({
  getChatConfig: vi.fn(),
  probeOllamaReachability: vi.fn(),
  startOllamaServer: vi.fn(),
  listOllamaModels: vi.fn(),
  createSession: vi.fn(),
  sendChatMessageStream: vi.fn(),
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
      createSession,
      sendChatMessageStream,
      mcpGatewayStatus: vi.fn(async () => ({ ok: true, data: {} })),
      mcpGatewayCall: vi.fn(async () => ({ ok: true, data: {} })),
      onChatStream: vi.fn(() => () => {}),
      getBridgeHealth: vi.fn(() => ({ ok: true, missingMethods: [], availableMethods: [] })),
    },
  };
});

// Import App AFTER the mock is registered.
import App from '../src/App';

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
  createSession.mockReset();
  sendChatMessageStream.mockReset();

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

  createSession.mockResolvedValue({ id: 'session-1' });
  sendChatMessageStream.mockResolvedValue({
    assistantMessage: { id: 'assistant-1', content: 'ok' },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

const COMPOSER_PLACEHOLDER = 'Ask your local or LAN Ollama service something useful...';
const PRESERVED_TEXT = 'Please summarize the meeting notes';

/** Render App and wait for the initial config load to complete. */
async function renderApp() {
  render(<App />);
  await waitFor(() => {
    expect(getChatConfig).toHaveBeenCalled();
  });
}

/** The send-time Send_Intercept_Prompt dialog (open) or null (closed). */
function interceptDialog(): HTMLElement | null {
  const local = screen.queryByText(/start the ollama server to send\?/i);
  const remote = screen.queryByText(/ollama server is not reachable/i);
  const title = local ?? remote;
  return title ? (title.closest('[role="dialog"]') as HTMLElement | null) : null;
}

function composer(): HTMLTextAreaElement {
  return screen.getByPlaceholderText(COMPOSER_PLACEHOLDER) as HTMLTextAreaElement;
}

/** Type into the composer and dispatch a send via the Send button. */
function typeAndSend(text: string) {
  fireEvent.change(composer(), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: /send message/i }));
}

/** Wait until serverStatus resolves to offline (pill reflects offline). */
async function waitForOffline() {
  await waitFor(() => {
    const pill = screen.getByRole('button', { name: /ollama server status/i });
    expect(pill.textContent).toMatch(/offline/i);
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('App send interception (offline)', () => {
  it('opens the intercept and does NOT dispatch; composer content preserved (R6.1, R6.2)', async () => {
    probeOllamaReachability.mockResolvedValue({
      reachable: false,
      kind: 'local',
      normalizedEndpoint: LOCAL_ENDPOINT,
      reason: 'refused',
    });

    await renderApp();
    await waitForOffline();

    typeAndSend(PRESERVED_TEXT);

    // The intercept opens.
    await waitFor(() => {
      expect(interceptDialog()).not.toBeNull();
    });
    // R6.1 — no chat message was dispatched.
    expect(sendChatMessageStream).not.toHaveBeenCalled();
    // R6.2 — the composed content is preserved in the composer.
    expect(composer().value).toBe(PRESERVED_TEXT);
  });

  it('shows Start + Cancel for a local endpoint (R6.3)', async () => {
    probeOllamaReachability.mockResolvedValue({
      reachable: false,
      kind: 'local',
      normalizedEndpoint: LOCAL_ENDPOINT,
      reason: 'refused',
    });

    await renderApp();
    await waitForOffline();
    typeAndSend(PRESERVED_TEXT);

    await waitFor(() => {
      expect(interceptDialog()).not.toBeNull();
    });
    expect(screen.getByRole('button', { name: /start and send/i })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /cancel/i }).length).toBeGreaterThan(0);
  });

  it('shows Cancel only (no Start) for a remote endpoint (R6.4)', async () => {
    getChatConfig.mockResolvedValue({
      endpoint: REMOTE_ENDPOINT,
      model: '',
      autoRenameEnabled: true,
      systemPrompt: '',
    } satisfies RuntimeChatConfig);
    listOllamaModels.mockResolvedValue({
      endpoint: REMOTE_ENDPOINT,
      model: '',
      availableModels: [],
    });
    probeOllamaReachability.mockResolvedValue({
      reachable: false,
      kind: 'remote',
      normalizedEndpoint: REMOTE_ENDPOINT,
      reason: 'refused',
    });

    await renderApp();
    await waitForOffline();
    typeAndSend(PRESERVED_TEXT);

    await waitFor(() => {
      expect(interceptDialog()).not.toBeNull();
    });
    expect(screen.queryByRole('button', { name: /start and send/i })).toBeNull();
    expect(screen.getByText(/cannot be started by this app/i)).toBeTruthy();
    expect(sendChatMessageStream).not.toHaveBeenCalled();
  });

  it('dispatches the preserved message after a successful start (R6.5)', async () => {
    probeOllamaReachability.mockResolvedValue({
      reachable: false,
      kind: 'local',
      normalizedEndpoint: LOCAL_ENDPOINT,
      reason: 'refused',
    });
    startOllamaServer.mockResolvedValue({ ok: true });

    await renderApp();
    await waitForOffline();
    typeAndSend(PRESERVED_TEXT);

    await waitFor(() => {
      expect(interceptDialog()).not.toBeNull();
    });

    fireEvent.click(screen.getByRole('button', { name: /start and send/i }));

    // The start flow runs.
    await waitFor(() => {
      expect(startOllamaServer).toHaveBeenCalledWith(LOCAL_ENDPOINT);
    });
    // R6.5 — on success the preserved content is dispatched.
    await waitFor(() => {
      expect(sendChatMessageStream).toHaveBeenCalledTimes(1);
    });
    expect(sendChatMessageStream.mock.calls[0][0]).toMatchObject({
      content: PRESERVED_TEXT,
    });
    // The prompt closes once dispatched.
    await waitFor(() => {
      expect(interceptDialog()).toBeNull();
    });
  });

  it('retains the unsent content and does NOT dispatch when the start fails (R6.6)', async () => {
    probeOllamaReachability.mockResolvedValue({
      reachable: false,
      kind: 'local',
      normalizedEndpoint: LOCAL_ENDPOINT,
      reason: 'refused',
    });
    startOllamaServer.mockResolvedValue({ ok: false, reason: 'binary-not-found' });

    await renderApp();
    await waitForOffline();
    typeAndSend(PRESERVED_TEXT);

    await waitFor(() => {
      expect(interceptDialog()).not.toBeNull();
    });

    fireEvent.click(screen.getByRole('button', { name: /start and send/i }));

    await waitFor(() => {
      expect(startOllamaServer).toHaveBeenCalledWith(LOCAL_ENDPOINT);
    });
    // R6.6 — no dispatch on a failed start.
    expect(sendChatMessageStream).not.toHaveBeenCalled();
    // The failure is surfaced in the prompt (still open) and the content is retained.
    await waitFor(() => {
      const dialog = interceptDialog();
      expect(dialog).not.toBeNull();
      expect(dialog!.textContent).toMatch(/could not be found/i);
    });
    expect(composer().value).toBe(PRESERVED_TEXT);
  });

  it('cancel dismisses the prompt without dispatch and retains the content (R6.7)', async () => {
    probeOllamaReachability.mockResolvedValue({
      reachable: false,
      kind: 'local',
      normalizedEndpoint: LOCAL_ENDPOINT,
      reason: 'refused',
    });

    await renderApp();
    await waitForOffline();
    typeAndSend(PRESERVED_TEXT);

    await waitFor(() => {
      expect(interceptDialog()).not.toBeNull();
    });

    // Click the action-row Cancel (the last Cancel-labelled button).
    const cancels = screen.getAllByRole('button', { name: /cancel/i });
    fireEvent.click(cancels[cancels.length - 1]);

    // R6.7 — the prompt closes, nothing is dispatched, and the content is retained.
    await waitFor(() => {
      expect(interceptDialog()).toBeNull();
    });
    expect(sendChatMessageStream).not.toHaveBeenCalled();
    expect(composer().value).toBe(PRESERVED_TEXT);
  });
});
