export {};

type OllamaStreamCallbacks = {
  onData: (chunk: string) => void;
  onEnd: () => void;
  onError: (error: string) => void;
};

type BrowserActionOptions = {
  action: string;
  url?: string;
  selector?: string;
  text?: string;
  key?: string;
  wait_for?: string;
  script?: string;
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

type ElectronAPI = {
  invokeOllama: (hostUrl: string, endpoint: string, data?: unknown) => Promise<any>;
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
  spawnTerminal: (type: string) => Promise<string>;
  runShellCommand: (command: string) => Promise<RunShellCommandResult>;
  terminalInput: (id: string, data: string) => void;
  onTerminalOutput: (callback: (id: string, data: string) => void) => () => void;
  runPlaywright: (url: string, action: string) => Promise<unknown>;
  browserAction: (options: BrowserActionOptions) => Promise<any>;
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
