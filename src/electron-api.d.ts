export {};

type OllamaStreamCallbacks = {
  onData: (chunk: string) => void;
  onEnd: () => void;
  onError: (error: string) => void;
};

type BrowserActionOptions = {
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
};

type ClockOptions = {
  timezone?: string;
  locale?: string;
};

type CalculatorPayload = {
  expression: string;
  scope?: Record<string, unknown>;
};

type ChatMessage = {
  role: string;
  content: string;
  [key: string]: unknown;
};

type PolicyDecisionOption = {
  id: string;
  label: string;
  description?: string;
  recommended?: boolean;
};

type PolicyDecisionRequest = {
  requestId: string;
  decisionToken?: string | null;
  title: string;
  markdown: string;
  options: PolicyDecisionOption[];
  createdAt: string;
};

type RunShellCommandResult = {
  ok: boolean;
  denied?: boolean;
  terminalId?: string;
  message: string;
  policy?: {
    decisionToken?: string | null;
    selectionId?: string;
  };
};

type McpTerminalSession = {
  id: string;
  shell: string;
  cwd: string;
  startedAt: string;
  lastActivityAt: string;
  exited: boolean;
  exitCode: number | null;
};

type McpTerminalExecuteResult = {
  blocked: boolean;
  reason?: string;
  session: McpTerminalSession;
  output?: string;
};

type McpPythonRunResult = {
  blocked: boolean;
  reason?: string;
  runId?: string;
  runDir?: string;
  image?: string;
  exitCode?: number | null;
  timedOut?: boolean;
  stdout?: string;
  stderr?: string;
  files?: Array<{ name: string; bytes: number }>;
};

type McpFolderRoot = {
  root: string;
  isCustom: boolean;
  canceled?: boolean;
};

type McpFolderEntry = {
  name: string;
  path: string;
  type: 'directory' | 'file';
  bytes: number;
  modifiedAt: string;
};

type McpWikiConfig = {
  root: string;
  isCustom: boolean;
  autonomyMode: 'auto' | 'review' | 'hybrid';
  knowledgePolicy: 'strict' | 'balanced' | 'aggressive';
  canceled?: boolean;
};

type ElectronAPI = {
  invokeOllama: (hostUrl: string, endpoint: string, data?: unknown, timeoutMs?: number) => Promise<unknown>;
  invokeOllamaStream: (
    hostUrl: string,
    endpoint: string,
    data: unknown,
    onData: OllamaStreamCallbacks['onData'],
    onEnd: OllamaStreamCallbacks['onEnd'],
    onError: OllamaStreamCallbacks['onError']
  ) => string;
  stopOllamaStream: (streamId: string) => void;
  unloadModels: (hostUrl: string) => Promise<void>;
  scanLanOllama: () => Promise<Array<{ host: string; address: string; models: Array<{ name: string }> }>>;
  spawnTerminal: (type: string) => Promise<string>;
  runShellCommand: (command: string) => Promise<RunShellCommandResult>;
  mcpGatewayCall: (request: { server: string; action: string; payload?: Record<string, unknown> }) => Promise<{ ok: boolean; data?: unknown; error?: string }>;
  mcpGatewayStatus: () => Promise<{ ok: boolean; data?: unknown; error?: string }>;
  terminalInput: (id: string, data: string) => void;
  onTerminalOutput: (callback: (id: string, data: string) => void) => () => void;
  createMcpTerminalSession: (options?: { shell?: string; args?: string[]; cwd?: string }) => Promise<McpTerminalSession>;
  listMcpTerminalSessions: () => Promise<McpTerminalSession[]>;
  readMcpTerminalOutput: (sessionId: string, maxChars?: number, clear?: boolean) => Promise<{ session: McpTerminalSession; output: string }>;
  writeMcpTerminalInput: (sessionId: string, input: string) => Promise<{ session: McpTerminalSession; acceptedChars: number; truncated: boolean }>;
  executeMcpTerminalCommand: (sessionId: string, command: string, options?: { timeoutMs?: number; settleMs?: number; approveRisky?: boolean }) => Promise<McpTerminalExecuteResult>;
  closeMcpTerminalSession: (sessionId: string) => Promise<{ id: string; closed: boolean }>;
  checkMcpPythonSandbox: () => Promise<{ ok: boolean; interpreter: string; shell: string; args: string[]; source: string; version: string; note: string }>;
  runMcpPythonSandbox: (payload: { code: string; timeoutSec?: number; image?: string; approveUnsafe?: boolean }) => Promise<McpPythonRunResult>;
  listMcpPythonSandboxRuns: (limit?: number) => Promise<Array<{ runId: string; runDir: string; createdAt: string }>>;
  readMcpPythonSandboxArtifact: (runId: string, fileName: string) => Promise<{ runId: string; fileName: string; bytes: number; mimeType: string; encoding: string; content: string }>;
  getMcpFolderRoot: () => Promise<McpFolderRoot>;
  selectMcpFolderRoot: () => Promise<McpFolderRoot>;
  clearMcpFolderRoot: () => Promise<McpFolderRoot>;
  listMcpFolder: (relativePath?: string) => Promise<{ root: string; path: string; entries: McpFolderEntry[] }>;
  readMcpFolderText: (relativePath: string) => Promise<{ root: string; path: string; bytes: number; content: string }>;
  writeMcpFolderText: (relativePath: string, content: string) => Promise<{ root: string; path: string; bytes: number }>;
  deleteMcpFolderPath: (relativePath: string) => Promise<{ deleted: boolean; missing?: boolean }>;
  renameMcpFolderPath: (fromPath: string, toPath: string) => Promise<{ from: string; to: string }>;
  createMcpFolderDir: (relativePath: string) => Promise<{ root: string; path: string }>;
  listMcpFolderModels: (relativePath?: string) => Promise<{ root: string; models: Array<{ path: string; name: string; ext: string; bytes: number; modifiedAt: string }> }>;
  readMcpFolderModel: (relativePath: string) => Promise<{ root: string; path: string; name: string; ext: string; bytes: number; base64: string }>;
  getMcpWikiConfig: () => Promise<McpWikiConfig>;
  setMcpWikiRoot: (path?: string) => Promise<McpWikiConfig>;
  clearMcpWikiRoot: () => Promise<McpWikiConfig>;
  setMcpWikiAutonomyMode: (mode: 'auto' | 'review' | 'hybrid') => Promise<McpWikiConfig>;
  setMcpWikiKnowledgePolicy: (level: 'strict' | 'balanced' | 'aggressive') => Promise<McpWikiConfig>;
  listMcpWiki: (path?: string) => Promise<{ root: string; path: string; files: string[] }>;
  readMcpWiki: (path: string) => Promise<{ root: string; path: string; content: string; exists: boolean; bytes?: number }>;
  upsertMcpWikiNote: (path: string, content: string, overwrite?: boolean, explicit?: boolean, category?: string) => Promise<{ ok: boolean; denied?: boolean; message?: string; reason?: string; root?: string; path?: string; bytes?: number; policy?: { decisionToken?: string | null; selectionId?: string } }>;
  appendMcpWikiEntry: (entry: string, path?: string, heading?: string, explicit?: boolean, category?: string) => Promise<{ ok: boolean; denied?: boolean; message?: string; reason?: string; root?: string; path?: string; bytes?: number; policy?: { decisionToken?: string | null; selectionId?: string } }>;
  searchMcpWiki: (query: string, maxResults?: number) => Promise<{ results: Array<{ path: string; snippet: string }> }>;
  deleteMcpWikiPath: (path: string) => Promise<{ deleted: boolean; missing?: boolean; denied?: boolean; policy?: { decisionToken?: string | null; selectionId?: string } }>;
  renameMcpWikiPath: (fromPath: string, toPath: string) => Promise<{ renamed: boolean; from?: string; to?: string; denied?: boolean; policy?: { decisionToken?: string | null; selectionId?: string } }>;
  reindexMcpWiki: () => Promise<{ indexedAt: string; fileCount: number }>;
  runPlaywright: (url: string, action: string) => Promise<unknown>;
  browserAction: (options: BrowserActionOptions) => Promise<unknown>;
  readWiki: (path: string) => Promise<string>;
  webSearch: (query: string) => Promise<string>;
  writeWiki: (path: string, content: string) => Promise<void>;
  listWiki: () => Promise<string[]>;
  saveChat: (id: string, messages: ChatMessage[]) => Promise<void>;
  loadChat: (id: string) => Promise<{ messages: ChatMessage[] } | null>;
  listChats: () => Promise<Array<{ id: string; title: string; updatedAt: string }>>;
  deleteChat: (id: string) => Promise<void>;
  renameChat: (id: string, title: string) => Promise<void>;
  parseFile: (filePath: string) => Promise<unknown>;
  parseFileBuffer: (ext: string, byteArray: number[]) => Promise<unknown>;
  getClock: (opts?: ClockOptions) => Promise<unknown>;
  engineeringCalculator: (payload: CalculatorPayload) => Promise<unknown>;
  onPolicyDecisionRequest: (callback: (request: PolicyDecisionRequest) => void) => () => void;
  respondPolicyDecision: (requestId: string, selectionId: string) => Promise<boolean>;
};

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
