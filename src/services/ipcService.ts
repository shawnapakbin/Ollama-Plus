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
  scanLanOllama() {
    if (!isElectronAvailable()) return rejected('scanLanOllama');
    const api = getElectronApi() as typeof window.electronAPI & { scanLanOllama?: () => Promise<Array<{ host: string; address: string; models: Array<{ name: string }> }>> };
    if (typeof api.scanLanOllama !== 'function') {
      return Promise.reject(
        new Error('LAN scan bridge is outdated. Restart the Electron app to load the updated preload script.')
      );
    }
    return api.scanLanOllama();
  },
  runShellCommand(command: string) {
    if (!isElectronAvailable()) return rejected('runShellCommand');
    return getElectronApi().runShellCommand(command);
  },
  mcpGatewayCall(request: { server: string; action: string; payload?: Record<string, unknown> }) {
    if (!isElectronAvailable()) return rejected('mcpGatewayCall');
    const api = getElectronApi() as typeof window.electronAPI & {
      mcpGatewayCall?: (request: { server: string; action: string; payload?: Record<string, unknown> }) => Promise<{ ok: boolean; data?: unknown; error?: string }>;
    };
    if (typeof api.mcpGatewayCall !== 'function') {
      return Promise.reject(new Error('MCP gateway bridge is unavailable. Restart Electron to load the latest preload script.'));
    }
    return api.mcpGatewayCall(request);
  },
  mcpGatewayStatus() {
    if (!isElectronAvailable()) return rejected('mcpGatewayStatus');
    const api = getElectronApi() as typeof window.electronAPI & {
      mcpGatewayStatus?: () => Promise<{ ok: boolean; data?: unknown; error?: string }>;
    };
    if (typeof api.mcpGatewayStatus !== 'function') {
      return Promise.reject(new Error('MCP gateway status bridge is unavailable. Restart Electron to load the latest preload script.'));
    }
    return api.mcpGatewayStatus();
  },
  spawnTerminal(type: string) {
    if (!isElectronAvailable()) return rejected('spawnTerminal');
    return getElectronApi().spawnTerminal(type);
  },
  createMcpTerminalSession(options?: { shell?: string; args?: string[]; cwd?: string }) {
    if (!isElectronAvailable()) return rejected('createMcpTerminalSession');
    return getElectronApi().createMcpTerminalSession(options);
  },
  listMcpTerminalSessions() {
    if (!isElectronAvailable()) return rejected('listMcpTerminalSessions');
    return getElectronApi().listMcpTerminalSessions();
  },
  readMcpTerminalOutput(sessionId: string, maxChars?: number, clear?: boolean) {
    if (!isElectronAvailable()) return rejected('readMcpTerminalOutput');
    return getElectronApi().readMcpTerminalOutput(sessionId, maxChars, clear);
  },
  writeMcpTerminalInput(sessionId: string, input: string) {
    if (!isElectronAvailable()) return rejected('writeMcpTerminalInput');
    return getElectronApi().writeMcpTerminalInput(sessionId, input);
  },
  executeMcpTerminalCommand(sessionId: string, command: string, options?: { timeoutMs?: number; settleMs?: number; approveRisky?: boolean }) {
    if (!isElectronAvailable()) return rejected('executeMcpTerminalCommand');
    return getElectronApi().executeMcpTerminalCommand(sessionId, command, options);
  },
  closeMcpTerminalSession(sessionId: string) {
    if (!isElectronAvailable()) return rejected('closeMcpTerminalSession');
    return getElectronApi().closeMcpTerminalSession(sessionId);
  },
  checkMcpPythonSandbox() {
    if (!isElectronAvailable()) return rejected('checkMcpPythonSandbox');
    return getElectronApi().checkMcpPythonSandbox();
  },
  runMcpPythonSandbox(payload: { code: string; timeoutSec?: number; image?: string; approveUnsafe?: boolean }) {
    if (!isElectronAvailable()) return rejected('runMcpPythonSandbox');
    return getElectronApi().runMcpPythonSandbox(payload);
  },
  listMcpPythonSandboxRuns(limit?: number) {
    if (!isElectronAvailable()) return rejected('listMcpPythonSandboxRuns');
    return getElectronApi().listMcpPythonSandboxRuns(limit);
  },
  readMcpPythonSandboxArtifact(runId: string, fileName: string) {
    if (!isElectronAvailable()) return rejected('readMcpPythonSandboxArtifact');
    return getElectronApi().readMcpPythonSandboxArtifact(runId, fileName);
  },
  getMcpFolderRoot() {
    if (!isElectronAvailable()) return rejected('getMcpFolderRoot');
    return getElectronApi().getMcpFolderRoot();
  },
  selectMcpFolderRoot() {
    if (!isElectronAvailable()) return rejected('selectMcpFolderRoot');
    return getElectronApi().selectMcpFolderRoot();
  },
  clearMcpFolderRoot() {
    if (!isElectronAvailable()) return rejected('clearMcpFolderRoot');
    return getElectronApi().clearMcpFolderRoot();
  },
  listMcpFolder(relativePath?: string) {
    if (!isElectronAvailable()) return rejected('listMcpFolder');
    return getElectronApi().listMcpFolder(relativePath);
  },
  readMcpFolderText(relativePath: string) {
    if (!isElectronAvailable()) return rejected('readMcpFolderText');
    return getElectronApi().readMcpFolderText(relativePath);
  },
  writeMcpFolderText(relativePath: string, content: string) {
    if (!isElectronAvailable()) return rejected('writeMcpFolderText');
    return getElectronApi().writeMcpFolderText(relativePath, content);
  },
  deleteMcpFolderPath(relativePath: string) {
    if (!isElectronAvailable()) return rejected('deleteMcpFolderPath');
    return getElectronApi().deleteMcpFolderPath(relativePath);
  },
  renameMcpFolderPath(fromPath: string, toPath: string) {
    if (!isElectronAvailable()) return rejected('renameMcpFolderPath');
    return getElectronApi().renameMcpFolderPath(fromPath, toPath);
  },
  createMcpFolderDir(relativePath: string) {
    if (!isElectronAvailable()) return rejected('createMcpFolderDir');
    return getElectronApi().createMcpFolderDir(relativePath);
  },
  listMcpFolderModels(relativePath?: string) {
    if (!isElectronAvailable()) return rejected('listMcpFolderModels');
    return getElectronApi().listMcpFolderModels(relativePath);
  },
  readMcpFolderModel(relativePath: string) {
    if (!isElectronAvailable()) return rejected('readMcpFolderModel');
    return getElectronApi().readMcpFolderModel(relativePath);
  },
  getMcpWikiConfig() {
    if (!isElectronAvailable()) return rejected('getMcpWikiConfig');
    return getElectronApi().getMcpWikiConfig();
  },
  setMcpWikiRoot(path?: string) {
    if (!isElectronAvailable()) return rejected('setMcpWikiRoot');
    return getElectronApi().setMcpWikiRoot(path);
  },
  clearMcpWikiRoot() {
    if (!isElectronAvailable()) return rejected('clearMcpWikiRoot');
    return getElectronApi().clearMcpWikiRoot();
  },
  setMcpWikiAutonomyMode(mode: 'auto' | 'review' | 'hybrid') {
    if (!isElectronAvailable()) return rejected('setMcpWikiAutonomyMode');
    return getElectronApi().setMcpWikiAutonomyMode(mode);
  },
  setMcpWikiKnowledgePolicy(level: 'strict' | 'balanced' | 'aggressive') {
    if (!isElectronAvailable()) return rejected('setMcpWikiKnowledgePolicy');
    return getElectronApi().setMcpWikiKnowledgePolicy(level);
  },
  listMcpWiki(path?: string) {
    if (!isElectronAvailable()) return rejected('listMcpWiki');
    return getElectronApi().listMcpWiki(path);
  },
  readMcpWiki(path: string) {
    if (!isElectronAvailable()) return rejected('readMcpWiki');
    return getElectronApi().readMcpWiki(path);
  },
  upsertMcpWikiNote(path: string, content: string, overwrite?: boolean, explicit?: boolean, category?: string) {
    if (!isElectronAvailable()) return rejected('upsertMcpWikiNote');
    return getElectronApi().upsertMcpWikiNote(path, content, overwrite, explicit, category);
  },
  appendMcpWikiEntry(entry: string, path?: string, heading?: string, explicit?: boolean, category?: string) {
    if (!isElectronAvailable()) return rejected('appendMcpWikiEntry');
    return getElectronApi().appendMcpWikiEntry(entry, path, heading, explicit, category);
  },
  searchMcpWiki(query: string, maxResults?: number) {
    if (!isElectronAvailable()) return rejected('searchMcpWiki');
    return getElectronApi().searchMcpWiki(query, maxResults);
  },
  deleteMcpWikiPath(path: string) {
    if (!isElectronAvailable()) return rejected('deleteMcpWikiPath');
    return getElectronApi().deleteMcpWikiPath(path);
  },
  renameMcpWikiPath(fromPath: string, toPath: string) {
    if (!isElectronAvailable()) return rejected('renameMcpWikiPath');
    return getElectronApi().renameMcpWikiPath(fromPath, toPath);
  },
  reindexMcpWiki() {
    if (!isElectronAvailable()) return rejected('reindexMcpWiki');
    return getElectronApi().reindexMcpWiki();
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
    sessionId?: string;
    pageId?: string;
    url?: string;
    selector?: string;
    text?: string;
    key?: string;
    wait_for?: string;
    script?: string;
    timeoutMs?: number;
    fullPage?: boolean;
    headers?: Record<string, string>;
    cookies?: Array<Record<string, unknown>>;
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
