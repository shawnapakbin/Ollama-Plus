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

export const ipcService = {
  invokeOllama(hostUrl: string, endpoint: string, data?: unknown) {
    return getElectronApi().invokeOllama(hostUrl, endpoint, data);
  },
  invokeOllamaStream(hostUrl: string, endpoint: string, data: unknown, handlers: StreamHandlers) {
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
    return getElectronApi().stopOllamaStream(streamId);
  },
  unloadModels(hostUrl: string) {
    return getElectronApi().unloadModels(hostUrl);
  },
  runShellCommand(command: string) {
    return getElectronApi().runShellCommand(command);
  },
  spawnTerminal(type: string) {
    return getElectronApi().spawnTerminal(type);
  },
  terminalInput(id: string, data: string) {
    return getElectronApi().terminalInput(id, data);
  },
  onTerminalOutput(callback: (id: string, data: string) => void) {
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
    return getElectronApi().browserAction(options);
  },
  readWiki(path: string) {
    return getElectronApi().readWiki(path);
  },
  writeWiki(path: string, content: string) {
    return getElectronApi().writeWiki(path, content);
  },
  listWiki() {
    return getElectronApi().listWiki();
  },
  webSearch(query: string) {
    return getElectronApi().webSearch(query);
  },
  saveChat(id: string, messages: Array<Record<string, unknown>>) {
    return getElectronApi().saveChat(id, messages);
  },
  loadChat(id: string) {
    return getElectronApi().loadChat(id);
  },
  listChats() {
    return getElectronApi().listChats();
  },
  deleteChat(id: string) {
    return getElectronApi().deleteChat(id);
  },
  renameChat(id: string, title: string) {
    return getElectronApi().renameChat(id, title);
  },
  parseFileBuffer(ext: string, byteArray: number[]) {
    return getElectronApi().parseFileBuffer(ext, byteArray);
  },
  getClock(opts?: { timezone?: string; locale?: string }) {
    return getElectronApi().getClock(opts);
  },
  engineeringCalculator(payload: { expression: string; scope?: Record<string, unknown> }) {
    return getElectronApi().engineeringCalculator(payload);
  },
  onPolicyDecisionRequest(callback: (request: PolicyDecisionRequest) => void) {
    return getElectronApi().onPolicyDecisionRequest(callback);
  },
  respondPolicyDecision(requestId: string, selectionId: string) {
    return getElectronApi().respondPolicyDecision(requestId, selectionId);
  }
};
