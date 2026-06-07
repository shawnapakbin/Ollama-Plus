type StreamHandlers = {
  onData: (chunk: string) => void;
  onEnd: () => void;
  onError: (error: string) => void;
};

type PolicyDecisionRequest = {
  requestId: string;
  decisionToken?: string | null;
  title: string;
  markdown: string;
  options: Array<{
    id: string;
    label: string;
    description?: string;
    recommended?: boolean;
  }>;
  createdAt: string;
};

function getElectronApi() {
  if (!window.electronAPI) {
    throw new Error('Electron API is unavailable. Open the app in Electron.');
  }

  return window.electronAPI;
}

/**
 * True when running inside the real Electron renderer (preload bridge present).
 * When false, the UI is being served from Vite into Simple Browser or a regular
 * browser tab where IPC-backed features cannot work.
 */
export const isElectronAvailable = (): boolean =>
  typeof window !== 'undefined' && Boolean(window.electronAPI);

const noopUnsubscribe = () => { /* no-op */ };

function rejected(method: string): Promise<never> {
  return Promise.reject(new Error(`Electron API unavailable (${method}). Open the app via Electron.`));
}

export const ipcService = {
  invokeOllama(hostUrl: string, endpoint: string, data?: unknown) {
    if (!isElectronAvailable()) return rejected('invokeOllama');
    return getElectronApi().invokeOllama(hostUrl, endpoint, data);
  },
  invokeOllamaStream(hostUrl: string, endpoint: string, data: unknown, handlers: StreamHandlers) {
    if (!isElectronAvailable()) {
      queueMicrotask(() => handlers.onError('Electron API unavailable. Open the app via Electron.'));
      return '';
    }
    return getElectronApi().invokeOllamaStream(
      hostUrl,
      endpoint,
      data,
      handlers.onData,
      handlers.onEnd,
      handlers.onError
    );
  },
  stopOllamaStream(streamId: string) {
    if (!isElectronAvailable()) return;
    return getElectronApi().stopOllamaStream(streamId);
  },
  unloadModels(hostUrl: string) {
    if (!isElectronAvailable()) return rejected('unloadModels');
    return getElectronApi().unloadModels(hostUrl);
  },
  runShellCommand(command: string) {
    if (!isElectronAvailable()) return rejected('runShellCommand');
    return getElectronApi().runShellCommand(command);
  },
  spawnTerminal(type: string) {
    if (!isElectronAvailable()) return rejected('spawnTerminal');
    return getElectronApi().spawnTerminal(type);
  },
  terminalInput(id: string, data: string) {
    if (!isElectronAvailable()) return;
    return getElectronApi().terminalInput(id, data);
  },
  onTerminalOutput(callback: (id: string, data: string) => void) {
    if (!isElectronAvailable()) return noopUnsubscribe;
    return getElectronApi().onTerminalOutput(callback);
  },
  browserAction(options: {
    action: string;
    url?: string;
    selector?: string;
    text?: string;
    key?: string;
    wait_for?: string;
    script?: string;
  }) {
    if (!isElectronAvailable()) return rejected('browserAction');
    return getElectronApi().browserAction(options);
  },
  readWiki(path: string) {
    if (!isElectronAvailable()) return rejected('readWiki');
    return getElectronApi().readWiki(path);
  },
  writeWiki(path: string, content: string) {
    if (!isElectronAvailable()) return rejected('writeWiki');
    return getElectronApi().writeWiki(path, content);
  },
  listWiki() {
    if (!isElectronAvailable()) return rejected('listWiki');
    return getElectronApi().listWiki();
  },
  webSearch(query: string) {
    if (!isElectronAvailable()) return rejected('webSearch');
    return getElectronApi().webSearch(query);
  },
  saveChat(id: string, messages: Array<Record<string, unknown>>) {
    if (!isElectronAvailable()) return rejected('saveChat');
    return getElectronApi().saveChat(id, messages);
  },
  loadChat(id: string) {
    if (!isElectronAvailable()) return rejected('loadChat');
    return getElectronApi().loadChat(id);
  },
  listChats() {
    if (!isElectronAvailable()) return Promise.resolve([]);
    return getElectronApi().listChats();
  },
  deleteChat(id: string) {
    if (!isElectronAvailable()) return rejected('deleteChat');
    return getElectronApi().deleteChat(id);
  },
  renameChat(id: string, title: string) {
    if (!isElectronAvailable()) return rejected('renameChat');
    return getElectronApi().renameChat(id, title);
  },
  parseFileBuffer(ext: string, byteArray: number[]) {
    if (!isElectronAvailable()) return rejected('parseFileBuffer');
    return getElectronApi().parseFileBuffer(ext, byteArray);
  },
  getClock(opts?: { timezone?: string; locale?: string }) {
    if (!isElectronAvailable()) return rejected('getClock');
    return getElectronApi().getClock(opts);
  },
  engineeringCalculator(payload: { expression: string; scope?: Record<string, unknown> }) {
    if (!isElectronAvailable()) return rejected('engineeringCalculator');
    return getElectronApi().engineeringCalculator(payload);
  },
  onPolicyDecisionRequest(callback: (request: PolicyDecisionRequest) => void) {
    if (!isElectronAvailable()) return noopUnsubscribe;
    return getElectronApi().onPolicyDecisionRequest(callback);
  },
  respondPolicyDecision(requestId: string, selectionId: string) {
    if (!isElectronAvailable()) return rejected('respondPolicyDecision');
    return getElectronApi().respondPolicyDecision(requestId, selectionId);
  }
};
