import {
  Bot,
  BrainCircuit,
  CircleOff,
  Copy,
  ChevronLeft,
  ChevronRight,
  GitBranchPlus,
  Image as ImageIcon,
  MessageSquare,
  Network,
  Paperclip,
  PenSquare,
  FileText,
  Plus,
  RefreshCw,
  Server,
  Settings,
  SlidersHorizontal,
  Square,
  Trash,
  Trash2,
  Wrench,
  X,
  type LucideIcon
} from 'lucide-react';
import './App.css';
import {
  runtimeClient,
  type ApprovalDecision,
  type RuntimeBootstrapPlan,
  type RuntimeChatConfig,
  type RuntimeChatMessage,
  type RuntimeChatMetrics,
  type RuntimeGraphSummary,
  type RuntimeMemoryRecord,
  type RuntimeOllamaModel,
  type RuntimeOllamaServer,
  type RuntimeOllamaServerHealth,
  type RuntimeRunSummary,
  type RuntimeSessionSummary,
  type RuntimeStatus
} from './services/runtimeClient';
import { evaluateRenameGuard } from './services/renameGuard';
import { useMemo, useEffect, useRef, useState } from 'react';

const NAV_PREFERENCE_KEY = 'ollama-plus.nav-open';
const INSPECTOR_PREFERENCE_KEY = 'ollama-plus.inspector-sections';
const AUTO_SCROLL_PREFERENCE_KEY = 'ollama-plus.auto-scroll';
const SHOW_THINKING_PREFERENCE_KEY = 'ollama-plus.show-thinking';
const SEND_ON_ENTER_ONLY_PREFERENCE_KEY = 'ollama-plus.send-on-enter-only';


type InspectorSectionKey = 'runtime' | 'graphs' | 'runs' | 'policies' | 'events' | 'milestones';
type AppPage = 'chats' | 'settings' | 'models' | 'mcp' | 'agent';
type McpServerStatusTone = 'ok' | 'warn' | 'danger' | 'neutral';
type McpServerStatusRow = {
  id: string;
  label: string;
  state: string;
  tone: McpServerStatusTone;
  detail: string;
};
type ComposerAttachment = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: 'image' | 'document';
  markdown: string;
};

const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const MAX_DOCUMENT_PREVIEW_CHARS = 32_000;
const TEXT_ATTACHMENT_EXTENSIONS = new Set([
  'txt',
  'md',
  'markdown',
  'json',
  'csv',
  'tsv',
  'xml',
  'yaml',
  'yml',
  'html',
  'css',
  'js',
  'ts',
  'jsx',
  'tsx',
  'py',
  'java',
  'c',
  'cpp',
  'cs',
  'go',
  'rs',
  'sql',
  'log'
]);

const DEFAULT_INSPECTOR_OPEN: Record<InspectorSectionKey, boolean> = {
  runtime: false,
  graphs: true,
  runs: true,
  policies: false,
  events: false,
  milestones: false
};

const MCP_SERVER_CATALOG: Array<{ id: string; label: string; detail: string }> = [
  { id: 'gateway', label: 'MCP Gateway', detail: 'Electron main-process dispatcher' },
  { id: 'browser', label: 'Browser (Playwright)', detail: 'Browser automation runtime' },
  { id: 'terminal', label: 'Terminal', detail: 'Guarded terminal runtime' },
  { id: 'folder', label: 'Folder', detail: 'Rooted file operations runtime' },
  { id: 'python', label: 'Python sandbox', detail: 'Docker-isolated Python runtime' },
  { id: 'openscad', label: 'OpenSCAD', detail: 'OpenSCAD compile runtime' },
  { id: 'blender_plate', label: 'Blender Plate', detail: 'Blender build runtime' }
];

function defaultMcpServerRows(): McpServerStatusRow[] {
  return MCP_SERVER_CATALOG.map((entry) => ({
    id: entry.id,
    label: entry.label,
    state: 'unknown',
    tone: 'neutral',
    detail: entry.detail
  }));
}

function buildMcpServerRows(payload: unknown): McpServerStatusRow[] {
  const rows = defaultMcpServerRows();
  const rowById = new Map(rows.map((row) => [row.id, row]));

  if (!(payload && typeof payload === 'object' && !Array.isArray(payload))) {
    return rows;
  }

  const status = payload as {
    checkedAt?: string;
    gateway?: { ok?: unknown; note?: unknown };
    services?: Record<string, unknown>;
  };

  const gatewayRow = rowById.get('gateway');
  if (gatewayRow) {
    const gatewayOk = Boolean(status.gateway?.ok);
    gatewayRow.state = gatewayOk ? 'online' : 'offline';
    gatewayRow.tone = gatewayOk ? 'ok' : 'danger';
    if (typeof status.gateway?.note === 'string' && status.gateway.note.trim()) {
      gatewayRow.detail = status.gateway.note;
    }
  }

  const services = status.services && typeof status.services === 'object' ? status.services : {};
  for (const [serviceId, serviceValue] of Object.entries(services)) {
    const row = rowById.get(serviceId);
    if (!row || !serviceValue || typeof serviceValue !== 'object') continue;

    const service = serviceValue as {
      ok?: unknown;
      note?: unknown;
      root?: unknown;
      activeSessionCount?: unknown;
      executable?: unknown;
      docker?: unknown;
    };

    const ok = Boolean(service.ok);
    row.state = ok ? 'online' : 'offline';
    row.tone = ok ? 'ok' : 'danger';

    if (serviceId === 'browser') {
      const activeSessionCount = Number(service.activeSessionCount ?? 0);
      row.state = activeSessionCount > 0 ? 'active' : (ok ? 'ready' : 'offline');
      row.detail = `Active sessions: ${Number.isFinite(activeSessionCount) ? activeSessionCount : 0}`;
      row.tone = ok ? 'ok' : 'danger';
      continue;
    }

    if (typeof service.note === 'string' && service.note.trim()) {
      row.detail = service.note;
    } else if (typeof service.root === 'string' && service.root.trim()) {
      row.detail = `Root: ${service.root}`;
    }

    if (serviceId === 'python' && typeof service.docker === 'string' && service.docker.trim()) {
      row.detail = service.docker;
      if (ok) row.tone = 'ok';
      if (!ok) row.tone = 'warn';
    }

    if ((serviceId === 'openscad' || serviceId === 'blender_plate') && typeof service.executable === 'string' && service.executable.trim()) {
      row.detail = `${row.detail} (${service.executable})`;
    }
  }

  return rows;
}

function formatTimestamp(value: string | null): string {
  if (!value) return 'No timestamp';

  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function getRunStatusTone(status: string): 'ok' | 'warn' | 'danger' | 'neutral' {
  if (status === 'completed') return 'ok';
  if (status === 'waiting_approval' || status === 'paused' || status === 'running') return 'warn';
  if (status === 'failed' || status === 'canceled') return 'danger';
  return 'neutral';
}

function getMessageLabel(message: RuntimeChatMessage): string {
  if (message.role === 'user') return 'You';
  if (message.role === 'assistant') return message.model || 'Assistant';
  return 'System';
}

function nanosToMilliseconds(value: number | null | undefined): number | null {
  if (!Number.isFinite(Number(value))) return null;
  return Number(value) / 1_000_000;
}

function formatMilliseconds(value: number | null): string {
  if (value === null) return 'n/a';
  if (value >= 1000) return `${(value / 1000).toFixed(2)} s`;
  return `${value.toFixed(1)} ms`;
}

function formatCount(value: number | null | undefined): string {
  if (!Number.isFinite(Number(value))) return 'n/a';
  return `${Math.round(Number(value))}`;
}

function computeTokensPerSecond(tokens: number | null, durationNs: number | null): string {
  if (!Number.isFinite(Number(tokens)) || !Number.isFinite(Number(durationNs)) || Number(durationNs) <= 0) {
    return 'n/a';
  }

  const tokensPerSecond = Number(tokens) / (Number(durationNs) / 1_000_000_000);
  return `${tokensPerSecond.toFixed(2)} tok/s`;
}

function getMetricSections(metrics: RuntimeChatMetrics | null) {
  const ingestionDurationMs = nanosToMilliseconds(metrics?.promptEvalDuration ?? null);
  const generationDurationMs = nanosToMilliseconds(metrics?.evalDuration ?? null);
  const totalDurationMs = nanosToMilliseconds(metrics?.totalDuration ?? null);
  const loadDurationMs = nanosToMilliseconds(metrics?.loadDuration ?? null);

  return {
    ingestion: [
      { label: 'Prompt tokens', value: formatCount(metrics?.promptEvalCount ?? null) },
      { label: 'Ingestion duration', value: formatMilliseconds(ingestionDurationMs) },
      { label: 'Prompt throughput', value: computeTokensPerSecond(metrics?.promptEvalCount ?? null, metrics?.promptEvalDuration ?? null) },
      { label: 'Model load', value: formatMilliseconds(loadDurationMs) }
    ],
    generation: [
      { label: 'Generated tokens', value: formatCount(metrics?.evalCount ?? null) },
      { label: 'Generation duration', value: formatMilliseconds(generationDurationMs) },
      { label: 'Token throughput', value: computeTokensPerSecond(metrics?.evalCount ?? null, metrics?.evalDuration ?? null) },
      { label: 'Total duration', value: formatMilliseconds(totalDurationMs) }
    ]
  };
}

function buildPromptKey(content: string): string {
  return content.trim().replace(/\s+/g, ' ').toLowerCase();
}

function stripThinkingProcess(content: string): string {
  return content
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<think>[\s\S]*$/gi, '')
    .trim();
}

function isPendingMessageId(messageId: string): boolean {
  return messageId.startsWith('pending-user:');
}

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

function escapeTripleBackticks(content: string): string {
  return content.replace(/```/g, '``\\`');
}

function getFileExtension(name: string): string {
  const parts = name.toLowerCase().split('.');
  return parts.length > 1 ? parts[parts.length - 1] : '';
}

function isTextDocument(file: File): boolean {
  if (file.type.startsWith('text/')) return true;
  return TEXT_ATTACHMENT_EXTENSIONS.has(getFileExtension(file.name));
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Unable to read file ${file.name}.`));
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Unable to read file ${file.name}.`));
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.readAsText(file);
  });
}

async function buildAttachment(file: File): Promise<ComposerAttachment> {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`${file.name} is too large (${formatFileSize(file.size)}). Max size is ${formatFileSize(MAX_ATTACHMENT_BYTES)}.`);
  }

  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  if (file.type.startsWith('image/')) {
    const dataUrl = await readFileAsDataUrl(file);
    return {
      id,
      name: file.name,
      mimeType: file.type || 'image/*',
      size: file.size,
      kind: 'image',
      markdown: `![${file.name}](${dataUrl})`
    };
  }

  if (isTextDocument(file)) {
    const rawText = await readFileAsText(file);
    const trimmedText = rawText.length > MAX_DOCUMENT_PREVIEW_CHARS
      ? `${rawText.slice(0, MAX_DOCUMENT_PREVIEW_CHARS)}\n\n[Truncated to ${MAX_DOCUMENT_PREVIEW_CHARS} characters.]`
      : rawText;
    const languageHint = getFileExtension(file.name) || 'text';
    return {
      id,
      name: file.name,
      mimeType: file.type || 'text/plain',
      size: file.size,
      kind: 'document',
      markdown: [
        `### Attachment: ${file.name}`,
        '',
        `~~~${languageHint}`,
        escapeTripleBackticks(trimmedText),
        '~~~'
      ].join('\n')
    };
  }

  return {
    id,
    name: file.name,
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
    kind: 'document',
    markdown: [
      `### Attachment: ${file.name}`,
      '',
      `Binary file (${file.type || 'unknown type'}, ${formatFileSize(file.size)}).`,
      'This file type cannot be inlined as text. If you need model analysis, convert it to text or markdown first.'
    ].join('\n')
  };
}

function composePromptWithAttachments(promptInput: string, attachments: ComposerAttachment[]): string {
  const prompt = promptInput.trim();
  if (!attachments.length) return prompt;

  const attachmentSection = attachments.map((attachment) => attachment.markdown).join('\n\n');
  if (!prompt) return attachmentSection;
  return `${prompt}\n\n${attachmentSection}`;
}

function App() {
  const navToggleRef = useRef<HTMLButtonElement | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const [activePage, setActivePage] = useState<AppPage>('chats');
  const [isNavOpen, setIsNavOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;

    const savedPreference = window.localStorage.getItem(NAV_PREFERENCE_KEY);
    if (savedPreference === 'true') return true;
    if (savedPreference === 'false') return false;

    return !window.matchMedia('(max-width: 980px)').matches;
  });
  const [isNarrowLayout, setIsNarrowLayout] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(max-width: 980px)').matches;
  });
  const [inspectorOpen, setInspectorOpen] = useState<Record<InspectorSectionKey, boolean>>(() => {
    if (typeof window === 'undefined') return DEFAULT_INSPECTOR_OPEN;

    const raw = window.localStorage.getItem(INSPECTOR_PREFERENCE_KEY);
    if (!raw) return DEFAULT_INSPECTOR_OPEN;

    try {
      const parsed = JSON.parse(raw) as Partial<Record<InspectorSectionKey, boolean>>;
      return {
        runtime: typeof parsed.runtime === 'boolean' ? parsed.runtime : DEFAULT_INSPECTOR_OPEN.runtime,
        graphs: typeof parsed.graphs === 'boolean' ? parsed.graphs : DEFAULT_INSPECTOR_OPEN.graphs,
        runs: typeof parsed.runs === 'boolean' ? parsed.runs : DEFAULT_INSPECTOR_OPEN.runs,
        policies: typeof parsed.policies === 'boolean' ? parsed.policies : DEFAULT_INSPECTOR_OPEN.policies,
        events: typeof parsed.events === 'boolean' ? parsed.events : DEFAULT_INSPECTOR_OPEN.events,
        milestones: typeof parsed.milestones === 'boolean' ? parsed.milestones : DEFAULT_INSPECTOR_OPEN.milestones
      };
    } catch {
      return DEFAULT_INSPECTOR_OPEN;
    }
  });
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [plan, setPlan] = useState<RuntimeBootstrapPlan | null>(null);
  const [graphs, setGraphs] = useState<RuntimeGraphSummary[]>([]);
  const [sessions, setSessions] = useState<RuntimeSessionSummary[]>([]);
  const [runs, setRuns] = useState<RuntimeRunSummary[]>([]);
  const [memoryRecords, setMemoryRecords] = useState<RuntimeMemoryRecord[]>([]);
  const [messages, setMessages] = useState<RuntimeChatMessage[]>([]);
  const [chatConfig, setChatConfig] = useState<RuntimeChatConfig>({ endpoint: 'http://127.0.0.1:11434', model: '', autoRenameEnabled: true });
  const [availableModels, setAvailableModels] = useState<RuntimeOllamaModel[]>([]);
  const [ollamaServers, setOllamaServers] = useState<RuntimeOllamaServer[]>([]);
  const [ollamaServerHealth, setOllamaServerHealth] = useState<Record<string, RuntimeOllamaServerHealth>>({});
  const [serverDraft, setServerDraft] = useState({ label: '', endpoint: '' });
  const [activeSessionId, setActiveSessionId] = useState('');
  const [activeGraphId, setActiveGraphId] = useState('core-chat');
  const [composer, setComposer] = useState('');
  const [streamDrafts, setStreamDrafts] = useState<Record<string, { sessionId: string; content: string; model: string; endpoint: string }>>({});
  const [isAutoScrollEnabled, setIsAutoScrollEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    const saved = window.localStorage.getItem(AUTO_SCROLL_PREFERENCE_KEY);
    if (saved === 'false') return false;
    return true;
  });
  const [isThinkingProcessVisible, setIsThinkingProcessVisible] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    const saved = window.localStorage.getItem(SHOW_THINKING_PREFERENCE_KEY);
    if (saved === 'false') return false;
    return true;
  });
  const [isSendOnEnterOnly, setIsSendOnEnterOnly] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const saved = window.localStorage.getItem(SEND_ON_ENTER_ONLY_PREFERENCE_KEY);
    return saved === 'true';
  });
  const [error, setError] = useState('');
  const bridgeHealth = useMemo(() => runtimeClient.getBridgeHealth(), []);
  const bridgeWarning = useMemo(() => {
    if (bridgeHealth.ok) return '';

    const methodSample = bridgeHealth.missingMethods.slice(0, 4).join(', ');
    const suffix = bridgeHealth.missingMethods.length > 4 ? ', ...' : '';
    return `Desktop bridge is out of sync. Missing preload methods: ${methodSample}${suffix}. Fully restart the Electron app (stop all instances, then run npm run electron:debug).`;
  }, [bridgeHealth]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [isPlanningRun, setIsPlanningRun] = useState(false);
  const [isRefreshingModels, setIsRefreshingModels] = useState(false);
  const [isRefreshingMcpStatus, setIsRefreshingMcpStatus] = useState(false);
  const [isSavingServer, setIsSavingServer] = useState(false);
  const [checkingServerIds, setCheckingServerIds] = useState<Record<string, boolean>>({});
  const [removingServerId, setRemovingServerId] = useState<string | null>(null);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [actionRunId, setActionRunId] = useState<string | null>(null);
  const [approvalDrafts, setApprovalDrafts] = useState<Record<string, { operator: string; operatorRole: string; reason: string }>>({});
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState('');
  const [composerAttachments, setComposerAttachments] = useState<ComposerAttachment[]>([]);
  const [mcpServerRows, setMcpServerRows] = useState<McpServerStatusRow[]>(() => defaultMcpServerRows());
  const [mcpStatusError, setMcpStatusError] = useState('');

  const streamRequestIdRef = useRef<string | null>(null);
  const requestCounterRef = useRef(0);
  const autoRenameInProgressRef = useRef<Set<string>>(new Set());
  const activeStreamId = streamRequestIdRef.current;

  const createRequestId = () => {
    requestCounterRef.current += 1;
    return globalThis.crypto?.randomUUID?.() ?? `request-${requestCounterRef.current}`;
  };

  const closeNavigation = () => {
    setIsNavOpen(false);
    if (isNarrowLayout) {
      window.setTimeout(() => {
        navToggleRef.current?.focus();
      }, 0);
    }
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mediaQuery = window.matchMedia('(max-width: 980px)');
    const syncNarrowLayout = () => {
      setIsNarrowLayout(mediaQuery.matches);
      if (!window.localStorage.getItem(NAV_PREFERENCE_KEY)) {
        setIsNavOpen(!mediaQuery.matches);
      }
    };

    syncNarrowLayout();
    mediaQuery.addEventListener('change', syncNarrowLayout);

    return () => {
      mediaQuery.removeEventListener('change', syncNarrowLayout);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(NAV_PREFERENCE_KEY, String(isNavOpen));
  }, [isNavOpen]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(INSPECTOR_PREFERENCE_KEY, JSON.stringify(inspectorOpen));
  }, [inspectorOpen]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(AUTO_SCROLL_PREFERENCE_KEY, String(isAutoScrollEnabled));
  }, [isAutoScrollEnabled]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(SHOW_THINKING_PREFERENCE_KEY, String(isThinkingProcessVisible));
  }, [isThinkingProcessVisible]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(SEND_ON_ENTER_ONLY_PREFERENCE_KEY, String(isSendOnEnterOnly));
  }, [isSendOnEnterOnly]);

  useEffect(() => {
    if (activePage !== 'chats' || !isNarrowLayout || !isNavOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsNavOpen(false);
        window.setTimeout(() => {
          navToggleRef.current?.focus();
        }, 0);
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [activePage, isNarrowLayout, isNavOpen]);

  useEffect(() => {
    if (activePage !== 'chats' || !isNarrowLayout) return;

    document.body.style.overflow = isNavOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [activePage, isNarrowLayout, isNavOpen]);

  useEffect(() => {
    let alive = true;

    async function load() {
      setIsLoading(true);
      setError('');

      try {
        const [nextStatus, nextPlan, nextGraphs, nextSessions, nextConfig, nextOllamaServers] = await Promise.all([
          runtimeClient.getStatus(),
          runtimeClient.getBootstrapPlan(),
          runtimeClient.getGraphCatalog(),
          runtimeClient.listSessions(),
          runtimeClient.getChatConfig(),
          runtimeClient.listOllamaServers()
        ]);

        let modelCatalog = {
          endpoint: nextConfig.endpoint,
          model: nextConfig.model,
          availableModels: []
        };

        try {
          modelCatalog = await runtimeClient.listOllamaModels(nextConfig.endpoint);
        } catch (catalogError) {
          const message = catalogError instanceof Error ? catalogError.message : String(catalogError);
          setError(message);
        }

        const sessionId = nextSessions[0]?.id ?? '';
        const [nextMessages, nextRuns, nextMemoryRecords] = sessionId
          ? await Promise.all([
              runtimeClient.listMessages(sessionId),
              runtimeClient.listRuns(sessionId),
              runtimeClient.listMemoryRecords(sessionId)
            ])
          : [[], [], []];

        if (!alive) return;
        setStatus(nextStatus);
        setPlan(nextPlan);
        setGraphs(nextGraphs);
        setSessions(nextSessions);
        setChatConfig({ endpoint: modelCatalog.endpoint || nextConfig.endpoint, model: modelCatalog.model || nextConfig.model });
        setAvailableModels(modelCatalog.availableModels);
        setOllamaServers(nextOllamaServers);
        setActiveSessionId(sessionId);
        setMessages(nextMessages);
        setRuns(nextRuns);
        setMemoryRecords(nextMemoryRecords);

        void Promise.all(nextOllamaServers.map((server) => runtimeClient.checkOllamaServer(server.id)))
          .then((healthRows) => {
            if (!alive) return;
            setOllamaServerHealth(Object.fromEntries(healthRows.map((health) => [health.id, health])));
          });

        void refreshMcpServerStatus(true);
      } catch (loadError) {
        if (!alive) return;
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      } finally {
        if (alive) {
          setIsLoading(false);
        }
      }
    }

    void load();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (activePage !== 'mcp') return;
    void refreshMcpServerStatus(true);
  }, [activePage]);

  async function refreshSessionData(sessionId: string) {
    const [nextStatus, nextSessions, nextMessages, nextRuns, nextMemoryRecords] = await Promise.all([
      runtimeClient.getStatus(),
      runtimeClient.listSessions(),
      runtimeClient.listMessages(sessionId),
      runtimeClient.listRuns(sessionId),
      runtimeClient.listMemoryRecords(sessionId)
    ]);

    setStatus(nextStatus);
    setSessions(nextSessions);
    setMessages(nextMessages);
    setRuns(nextRuns);
    setMemoryRecords(nextMemoryRecords);
  }

  async function handleSelectSession(sessionId: string) {
    setActiveSessionId(sessionId);
    setError('');

    if (isNarrowLayout) {
      closeNavigation();
    }

    try {
      await refreshSessionData(sessionId);
    } catch (selectError) {
      setError(selectError instanceof Error ? selectError.message : String(selectError));
    }
  }

  async function handleCreateSession() {
    setIsCreatingSession(true);
    setError('');

    try {
      const session = await runtimeClient.createSession();
      setActiveSessionId(session.id);
      setActivePage('chats');
      await refreshSessionData(session.id);
      if (isNarrowLayout) {
        closeNavigation();
      }
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError));
    } finally {
      setIsCreatingSession(false);
    }
  }

  async function handleRenameSession(sessionId: string) {
    setRenamingSessionId(sessionId);
    setError('');

    try {
      const result = await runtimeClient.renameSessionWithAi(sessionId, {
        endpoint: chatConfig.endpoint,
        model: chatConfig.model
      });
      setSessions((current) => current.map((session) => (session.id === sessionId ? result.session : session)));
      setChatConfig((current) => ({ ...current, endpoint: result.endpoint, model: result.model }));
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : String(renameError));
    } finally {
      setRenamingSessionId(null);
    }
  }

  async function handleDeleteSession(sessionId: string) {
    setDeletingSessionId(sessionId);
    setError('');
    autoRenameInProgressRef.current.delete(sessionId);

    try {
      await runtimeClient.deleteSession(sessionId);
      const nextSessions = await runtimeClient.listSessions();
      setSessions(nextSessions);

      if (activeSessionId === sessionId) {
        const nextActiveSessionId = nextSessions[0]?.id ?? '';
        setActiveSessionId(nextActiveSessionId);
        if (nextActiveSessionId) {
          await refreshSessionData(nextActiveSessionId);
        } else {
          const nextStatus = await runtimeClient.getStatus();
          setStatus(nextStatus);
          setMessages([]);
          setRuns([]);
          setMemoryRecords([]);
        }
      } else {
        const nextStatus = await runtimeClient.getStatus();
        setStatus(nextStatus);
      }
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    } finally {
      setDeletingSessionId(null);
    }
  }

  async function handleRefreshModels() {
    setIsRefreshingModels(true);
    setError('');

    try {
      const catalog = await runtimeClient.listOllamaModels(chatConfig.endpoint);
      setAvailableModels(catalog.availableModels);
      setChatConfig({ endpoint: catalog.endpoint, model: catalog.model });
    } catch (modelError) {
      setError(modelError instanceof Error ? modelError.message : String(modelError));
    } finally {
      setIsRefreshingModels(false);
    }
  }

  async function refreshMcpServerStatus(silent = false) {
    setIsRefreshingMcpStatus(true);
    if (!silent) {
      setMcpStatusError('');
    }

    try {
      const statusResult = await runtimeClient.mcpGatewayStatus();
      if (!statusResult.ok) {
        throw new Error(statusResult.error || 'MCP gateway status request failed.');
      }

      setMcpServerRows(buildMcpServerRows(statusResult.data));
      setMcpStatusError('');
    } catch (statusError) {
      const message = statusError instanceof Error ? statusError.message : String(statusError);
      setMcpStatusError(message);
      setMcpServerRows(defaultMcpServerRows().map((row) => (
        row.id === 'gateway'
          ? { ...row, state: 'offline', tone: 'danger', detail: message }
          : row
      )));
      if (!silent) {
        setError(message);
      }
    } finally {
      setIsRefreshingMcpStatus(false);
    }
  }

  async function handleCheckOllamaServer(serverId: string) {
    setCheckingServerIds((current) => ({ ...current, [serverId]: true }));

    try {
      const health = await runtimeClient.checkOllamaServer(serverId);
      setOllamaServerHealth((current) => ({ ...current, [serverId]: health }));
    } catch (healthError) {
      setError(healthError instanceof Error ? healthError.message : String(healthError));
    } finally {
      setCheckingServerIds((current) => ({ ...current, [serverId]: false }));
    }
  }

  async function handleAddOllamaServer() {
    const endpoint = serverDraft.endpoint.trim();
    if (!endpoint) {
      setError('Enter an IP address and port for the Ollama server.');
      return;
    }

    setIsSavingServer(true);
    setError('');

    try {
      const saved = await runtimeClient.saveOllamaServer({
        label: serverDraft.label.trim() || undefined,
        endpoint
      });
      setOllamaServers((current) => [saved, ...current.filter((server) => server.id !== saved.id)]);
      setServerDraft({ label: '', endpoint: '' });
      await handleCheckOllamaServer(saved.id);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setIsSavingServer(false);
    }
  }

  async function handleRemoveOllamaServer(serverId: string) {
    setRemovingServerId(serverId);
    setError('');

    try {
      const removed = await runtimeClient.removeOllamaServer(serverId);
      setOllamaServers((current) => current.filter((server) => server.id !== serverId));
      setOllamaServerHealth((current) => {
        const next = { ...current };
        delete next[serverId];
        return next;
      });

      if (removed.endpoint === chatConfig.endpoint) {
        const nextConfig = await runtimeClient.getChatConfig();
        setChatConfig(nextConfig);
        setAvailableModels([]);
      }
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : String(removeError));
    } finally {
      setRemovingServerId(null);
    }
  }

  async function handleUseOllamaServer(server: RuntimeOllamaServer) {
    setIsRefreshingModels(true);
    setError('');

    try {
      const catalog = await runtimeClient.listOllamaModels(server.endpoint);
      setAvailableModels(catalog.availableModels);
      setChatConfig({ endpoint: catalog.endpoint, model: catalog.model });
      setOllamaServerHealth((current) => ({
        ...current,
        [server.id]: {
          ...server,
          endpoint: catalog.endpoint,
          status: 'online',
          models: catalog.availableModels,
          checkedAt: new Date().toISOString(),
          error: null
        }
      }));
    } catch (selectError) {
      setError(selectError instanceof Error ? selectError.message : String(selectError));
      await handleCheckOllamaServer(server.id);
    } finally {
      setIsRefreshingModels(false);
    }
  }

  async function handleSaveConfig(nextConfig: Partial<RuntimeChatConfig>) {
    setError('');

    try {
      const saved = await runtimeClient.saveChatConfig({
        endpoint: nextConfig.endpoint ?? chatConfig.endpoint,
        model: nextConfig.model ?? chatConfig.model
      });
      setChatConfig(saved);
    } catch (configError) {
      setError(configError instanceof Error ? configError.message : String(configError));
    }
  }

  async function handleStartRun(graphId: string) {
    setIsPlanningRun(true);
    setError('');

    try {
      const preferredSessionId = activeSessionId || sessions[0]?.id;
      const run = await runtimeClient.startRun(graphId, preferredSessionId);
      setActiveGraphId(run.graphId);
      await refreshSessionData(run.sessionId);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError));
    } finally {
      setIsPlanningRun(false);
    }
  }

  async function autoRenameAfterCompletion(sessionId: string): Promise<void> {
    try {
      const session = sessions.find(s => s.id === sessionId);
      if (!session) return;

      if (!evaluateRenameGuard(session, chatConfig, messages, autoRenameInProgressRef.current)) {
        return;
      }

      autoRenameInProgressRef.current.add(sessionId);

      const result = await runtimeClient.renameSessionWithAi(sessionId, {
        endpoint: chatConfig.endpoint,
        model: chatConfig.model
      });

      setSessions(current => current.map(s => s.id === sessionId ? result.session : s));
      setChatConfig(current => ({ ...current, endpoint: result.endpoint, model: result.model }));
    } catch (error) {
      console.warn('[auto-rename] Failed for session', sessionId, error);
    } finally {
      autoRenameInProgressRef.current.delete(sessionId);
    }
  }

  async function sendPromptWithStreaming(promptInput: string, preferredSessionId?: string) {
    const prompt = promptInput.trim();
    if (!prompt) {
      throw new Error('Enter a message before sending it to Ollama.');
    }

    let sessionId = preferredSessionId || activeSessionId;
    if (!sessionId) {
      const session = await runtimeClient.createSession();
      sessionId = session.id;
      setActiveSessionId(session.id);
    }

    const requestId = createRequestId();
    streamRequestIdRef.current = requestId;
    const optimisticUserMessage: RuntimeChatMessage = {
      id: `pending-user:${requestId}`,
      sessionId,
      role: 'user',
      content: prompt,
      model: chatConfig.model || null,
      endpoint: chatConfig.endpoint || null,
      createdAt: new Date().toISOString(),
      metrics: null
    };

    setMessages((current) => [...current, optimisticUserMessage]);
    setStreamDrafts((current) => ({
      ...current,
      [requestId]: {
        sessionId,
        content: '',
        model: chatConfig.model,
        endpoint: chatConfig.endpoint
      }
    }));

    const response = await runtimeClient.sendChatMessageStream({
      sessionId,
      content: prompt,
      endpoint: chatConfig.endpoint,
      model: chatConfig.model,
      requestId
    });

    setStreamDrafts((current) => {
      const existing = current[requestId];
      if (!existing) return current;

      return {
        ...current,
        [requestId]: {
          ...existing,
          content: response.assistantMessage.content
        }
      };
    });

    setStreamDrafts((current) => {
      const next = { ...current };
      delete next[requestId];
      return next;
    });
    streamRequestIdRef.current = null;
    setComposer('');
    setActiveSessionId(sessionId);
    const savedConfig = await runtimeClient.getChatConfig();
    await Promise.all([
      refreshSessionData(sessionId),
      handleSaveConfig({ endpoint: savedConfig.endpoint, model: savedConfig.model })
    ]);

    // Fire-and-forget auto-rename check
    void autoRenameAfterCompletion(sessionId);

    return sessionId;
  }

  async function handleSendMessage() {
    setIsSendingMessage(true);
    setError('');

    try {
      const promptWithAttachments = composePromptWithAttachments(composer, composerAttachments);
      await sendPromptWithStreaming(promptWithAttachments);
      setComposerAttachments([]);
      if (attachmentInputRef.current) {
        attachmentInputRef.current.value = '';
      }
    } catch (sendError) {
      if (streamRequestIdRef.current) {
        const failedRequestId = streamRequestIdRef.current;
        setStreamDrafts((current) => {
          const next = { ...current };
          delete next[failedRequestId];
          return next;
        });
      }
      streamRequestIdRef.current = null;
      setError(sendError instanceof Error ? sendError.message : String(sendError));
    } finally {
      setIsSendingMessage(false);
    }
  }

  async function handleCopyMessage(content: string) {
    try {
      await navigator.clipboard.writeText(content);
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : String(copyError));
    }
  }

  async function handleDeleteMessage(messageId: string) {
    setError('');

    if (isPendingMessageId(messageId)) {
      setMessages((current) => current.filter((message) => message.id !== messageId));
      if (editingMessageId === messageId) {
        setEditingMessageId(null);
        setEditingDraft('');
      }
      return;
    }

    try {
      await runtimeClient.deleteMessage(messageId);
      if (activeSessionId) {
        await refreshSessionData(activeSessionId);
      }
      if (editingMessageId === messageId) {
        setEditingMessageId(null);
        setEditingDraft('');
      }
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    }
  }

  async function handleSaveMessageEdit(messageId: string) {
    if (isPendingMessageId(messageId)) {
      setMessages((current) => current.map((message) => (
        message.id === messageId
          ? { ...message, content: editingDraft.trim() || message.content }
          : message
      )));
      setEditingMessageId(null);
      setEditingDraft('');
      return;
    }

    const content = editingDraft.trim();
    if (!content) {
      setError('Message content cannot be empty.');
      return;
    }

    setError('');
    try {
      await runtimeClient.updateMessage(messageId, { content });
      if (activeSessionId) {
        await refreshSessionData(activeSessionId);
      }
      setEditingMessageId(null);
      setEditingDraft('');
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : String(updateError));
    }
  }

  const assistantMessageContext = useMemo(() => {
    const byAssistantId = new Map<string, { userMessageId: string | null; retryCount: number }>();
    const assistantCountByPrompt = new Map<string, number>();
    let latestUserContext: { id: string; promptKey: string } | null = null;

    for (const message of messages) {
      if (message.role === 'user') {
        latestUserContext = {
          id: message.id,
          promptKey: buildPromptKey(message.content)
        };
        continue;
      }

      if (message.role !== 'assistant') continue;

      if (!latestUserContext) {
        byAssistantId.set(message.id, { userMessageId: null, retryCount: 0 });
        continue;
      }

      const promptKey = latestUserContext.promptKey;
      const current = assistantCountByPrompt.get(promptKey) ?? 0;
      const next = current + 1;
      assistantCountByPrompt.set(promptKey, next);
      byAssistantId.set(message.id, {
        userMessageId: latestUserContext.id,
        retryCount: Math.max(0, next - 1)
      });
    }

    return byAssistantId;
  }, [messages]);

  async function handleRetryAssistant(messageId: string) {
    const context = assistantMessageContext.get(messageId);
    if (!context?.userMessageId) {
      setError('Cannot retry because the linked user prompt was not found.');
      return;
    }

    const userMessage = messages.find((message) => message.id === context.userMessageId);
    if (!userMessage) {
      setError('Cannot retry because the linked user prompt was not found.');
      return;
    }

    setIsSendingMessage(true);
    setError('');
    try {
      await sendPromptWithStreaming(userMessage.content, activeSessionId || undefined);
    } catch (retryError) {
      if (streamRequestIdRef.current) {
        const failedRequestId = streamRequestIdRef.current;
        setStreamDrafts((current) => {
          const next = { ...current };
          delete next[failedRequestId];
          return next;
        });
      }
      streamRequestIdRef.current = null;
      setError(retryError instanceof Error ? retryError.message : String(retryError));
    } finally {
      setIsSendingMessage(false);
    }
  }

  async function handleBranchFromAssistant(messageId: string) {
    const context = assistantMessageContext.get(messageId);
    if (!context?.userMessageId) {
      setError('Cannot branch because the linked user prompt was not found.');
      return;
    }

    const userMessage = messages.find((message) => message.id === context.userMessageId);
    if (!userMessage) {
      setError('Cannot branch because the linked user prompt was not found.');
      return;
    }

    setIsSendingMessage(true);
    setError('');
    try {
      const newSession = await runtimeClient.createSession();
      setActiveSessionId(newSession.id);
      setActivePage('chats');
      await refreshSessionData(newSession.id);
      await sendPromptWithStreaming(userMessage.content, newSession.id);
      if (isNarrowLayout) {
        closeNavigation();
      }
    } catch (branchError) {
      if (streamRequestIdRef.current) {
        const failedRequestId = streamRequestIdRef.current;
        setStreamDrafts((current) => {
          const next = { ...current };
          delete next[failedRequestId];
          return next;
        });
      }
      streamRequestIdRef.current = null;
      setError(branchError instanceof Error ? branchError.message : String(branchError));
    } finally {
      setIsSendingMessage(false);
    }
  }

  async function handleRunAction(runId: string, action: 'execute' | 'resume' | 'step' | 'cancel' | 'approve' | 'deny') {
    setActionRunId(runId);
    setError('');

    try {
      const decision: ApprovalDecision | undefined = approvalDrafts[runId]
        ? {
            operator: approvalDrafts[runId].operator,
            operatorRole: approvalDrafts[runId].operatorRole,
            reason: approvalDrafts[runId].reason
          }
        : undefined;

      if (action === 'execute') {
        await runtimeClient.executeRun(runId);
      } else if (action === 'resume') {
        await runtimeClient.resumeRun(runId);
      } else if (action === 'step') {
        await runtimeClient.stepRun(runId);
      } else if (action === 'approve') {
        await runtimeClient.approveRun(runId, decision);
      } else if (action === 'deny') {
        await runtimeClient.denyRun(runId, decision);
      } else {
        await runtimeClient.cancelRun(runId);
      }

      if (activeSessionId) {
        await refreshSessionData(activeSessionId);
      }
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError));
    } finally {
      setActionRunId(null);
    }
  }

  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;
  const activeRuns = useMemo(() => runs.filter((run) => run.sessionId === activeSessionId), [runs, activeSessionId]);
  const activeDrafts = useMemo(() => Object.entries(streamDrafts)
    .filter(([, draft]) => draft.sessionId === activeSessionId)
    .map(([requestId, draft]) => ({ requestId, ...draft })), [streamDrafts, activeSessionId]);

  useEffect(() => {
    if (!isAutoScrollEnabled) return;
    if (activePage !== 'chats') return;

    const listEl = messageListRef.current;
    if (!listEl) return;
    listEl.scrollTop = listEl.scrollHeight;
  }, [messages, activeDrafts, activeSessionId, activePage, isAutoScrollEnabled]);

  const latestRun = activeRuns[0] ?? null;
  const isInspectorExpanded = (section: InspectorSectionKey) => !isNarrowLayout || inspectorOpen[section];

  const toggleInspectorSection = (section: InspectorSectionKey) => {
    if (!isNarrowLayout) return;

    setInspectorOpen((current) => ({
      ...current,
      [section]: !current[section]
    }));
  };

  const policyRows = useMemo(() => {
    const entries = new Map<string, { id: string; requiredApproverRole: string; actionScope: string; minRiskScore: number }>();

    for (const run of activeRuns) {
      for (const checkpoint of run.checkpoints) {
        if (!checkpoint.approvalPolicy) continue;
        entries.set(checkpoint.approvalPolicy.id, {
          id: checkpoint.approvalPolicy.id,
          requiredApproverRole: checkpoint.approvalPolicy.requiredApproverRole,
          actionScope: checkpoint.approvalPolicy.actionScope,
          minRiskScore: checkpoint.approvalPolicy.minRiskScore
        });
      }
    }

    return Array.from(entries.values());
  }, [activeRuns]);

  const appPages: Array<{ id: AppPage; label: string; description: string; icon: LucideIcon }> = [
    { id: 'chats', label: 'Chats', description: 'Chat sessions, streaming, and compose.', icon: MessageSquare },
    { id: 'agent', label: 'Agent', description: 'Graphs, approvals, and runtime runs.', icon: Bot },
    { id: 'models', label: 'Models', description: 'Model catalog and current selection.', icon: BrainCircuit },
    { id: 'mcp', label: 'MCP', description: 'Memory, policies, events, and tools.', icon: Wrench },
    { id: 'settings', label: 'Settings', description: 'Runtime and endpoint configuration.', icon: Settings }
  ];

  const activePageDefinition = appPages.find((page) => page.id === activePage) ?? appPages[0];

  const handlePageChange = (page: AppPage) => {
    setActivePage(page);
    if (isNarrowLayout) {
      closeNavigation();
    }
  };

  const canSendMessage = Boolean(composer.trim()) || composerAttachments.length > 0;

  const handlePickAttachments = () => {
    attachmentInputRef.current?.click();
  };

  const handleRemoveAttachment = (attachmentId: string) => {
    setComposerAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId));
  };

  const handleAttachmentInputChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) return;

    setError('');
    const nextAttachments: ComposerAttachment[] = [];
    const failures: string[] = [];

    for (const file of files) {
      try {
        const attachment = await buildAttachment(file);
        nextAttachments.push(attachment);
      } catch (attachmentError) {
        failures.push(attachmentError instanceof Error ? attachmentError.message : String(attachmentError));
      }
    }

    if (nextAttachments.length > 0) {
      setComposerAttachments((current) => [...current, ...nextAttachments]);
    }

    if (failures.length > 0) {
      setError(failures.join(' '));
    }

    event.target.value = '';
  };

  const handleComposerKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.isComposing || event.key !== 'Enter') return;

    if (isSendOnEnterOnly) {
      if (event.shiftKey) return;
      event.preventDefault();
      if (!isSendingMessage && canSendMessage) {
        void handleSendMessage();
      }
      return;
    }

    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      if (!isSendingMessage && canSendMessage) {
        void handleSendMessage();
      }
    }
  };

  return (
    <main className={`app-shell ${isNavOpen ? 'sidebar-open' : 'sidebar-collapsed'}`}>
      <aside id="application-sidebar" className="app-sidebar" aria-hidden={isNarrowLayout && !isNavOpen}>
        <div className="sidebar-brand">
          <div className="brand-mark" aria-hidden="true"><Server size={20} /></div>
          <div className="sidebar-labels">
            <strong>Ollama +</strong>
            <span>Local runtime</span>
          </div>
          <button
            className="icon-action sidebar-collapse"
            type="button"
            onClick={() => setIsNavOpen((current) => !current)}
            aria-label={isNavOpen ? 'Collapse sidebar' : 'Expand sidebar'}
            title={isNavOpen ? 'Collapse sidebar' : 'Expand sidebar'}
            data-tooltip={isNavOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            {isNavOpen ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
          </button>
        </div>

        <button className="sidebar-new-chat" type="button" onClick={() => void handleCreateSession()} disabled={isCreatingSession || isLoading}>
          <Plus size={18} />
          <span className="sidebar-labels">{isCreatingSession ? 'Creating...' : 'New chat'}</span>
        </button>

        <nav className="sidebar-nav" aria-label="Primary navigation">
          {appPages.filter((page) => page.id !== 'settings').map((page) => {
            const PageIcon = page.icon;
            return (
              <button
                key={page.id}
                className={`sidebar-nav-item ${activePage === page.id ? 'active' : ''}`}
                type="button"
                onClick={() => handlePageChange(page.id)}
                aria-current={activePage === page.id ? 'page' : undefined}
                title={page.label}
              >
                <PageIcon size={18} />
                <span className="sidebar-labels">{page.label}</span>
              </button>
            );
          })}
        </nav>

        {activePage === 'chats' ? (
          <section className="sidebar-conversations" aria-label="Conversations">
            <div className="sidebar-section-title sidebar-labels">
              <span>Recent chats</span>
              <span>{sessions.length}</span>
            </div>
            <div className="sidebar-conversation-list">
              {sessions.length === 0 ? <div className="sidebar-empty sidebar-labels">No chats yet.</div> : sessions.map((session) => (
                <div
                  key={session.id}
                  className={`sidebar-conversation ${session.id === activeSessionId ? 'active' : ''}`}
                >
                  <button
                    type="button"
                    className="sidebar-conversation-main"
                    onClick={() => void handleSelectSession(session.id)}
                    title={session.title}
                  >
                    <MessageSquare size={16} />
                    <span className="sidebar-labels">
                      <strong>{session.title}</strong>
                      <small>{session.lastRunSummary}</small>
                    </span>
                  </button>
                  <div className="sidebar-conversation-actions">
                    <button
                      className="icon-action sidebar-session-action"
                      type="button"
                      onClick={() => void handleRenameSession(session.id)}
                      disabled={renamingSessionId === session.id || deletingSessionId === session.id}
                      title="Generate a concise title from this chat"
                      aria-label={`Rename ${session.title}`}
                      data-tooltip="Rename chat"
                    >
                      {renamingSessionId === session.id ? <RefreshCw size={14} className="spinning" /> : <PenSquare size={14} />}
                    </button>
                    <button
                      className="icon-action sidebar-session-action danger-icon"
                      type="button"
                      onClick={() => void handleDeleteSession(session.id)}
                      disabled={deletingSessionId === session.id || renamingSessionId === session.id}
                      title="Delete this chat"
                      aria-label={`Delete ${session.title}`}
                      data-tooltip="Delete chat"
                    >
                      {deletingSessionId === session.id ? <RefreshCw size={14} className="spinning" /> : <Trash2 size={14} />}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <div className="sidebar-footer">
          <div className="runtime-indicator" title={`${status?.mode ?? 'loading'} runtime`}>
            <span className={`runtime-dot ${status ? 'online' : ''}`} />
            <span className="sidebar-labels">{status?.mode ?? 'Connecting'}</span>
          </div>
          <button
            className={`sidebar-nav-item ${activePage === 'settings' ? 'active' : ''}`}
            type="button"
            onClick={() => handlePageChange('settings')}
            aria-current={activePage === 'settings' ? 'page' : undefined}
            title="Settings"
          >
            <Settings size={18} />
            <span className="sidebar-labels">Settings</span>
          </button>
          <div className="developer-branding sidebar-labels" aria-label="Developer branding">
            <span>Shawna Pakbin</span>
            <span className="branding-separator" aria-hidden="true">|</span>
            <span>revDigit Studio</span>
            <span className="branding-separator" aria-hidden="true">|</span>
            <a href="https://revdigit.link" target="_blank" rel="noreferrer">revDigit.link</a>
          </div>
        </div>
      </aside>

      <section className="workspace-shell">
        <header className="workspace-header">
          <div className="workspace-title-row">
            <button
              className="icon-action workspace-sidebar-toggle"
              type="button"
              onClick={() => setIsNavOpen((current) => !current)}
              ref={navToggleRef}
              aria-label={isNavOpen ? 'Collapse sidebar' : 'Expand sidebar'}
              aria-expanded={isNavOpen}
              aria-controls="application-sidebar"
              title={isNavOpen ? 'Collapse sidebar' : 'Expand sidebar'}
              data-tooltip={isNavOpen ? 'Collapse sidebar' : 'Expand sidebar'}
            >
              {isNavOpen ? <ChevronLeft size={19} /> : <ChevronRight size={19} />}
            </button>
            <div>
              <h1>{activePage === 'chats' ? activeSession?.title ?? 'New chat' : activePageDefinition.label}</h1>
              <p>{activePageDefinition.description}</p>
            </div>
          </div>
          <div className="workspace-actions">
            <div className="model-chip" title={chatConfig.endpoint}>
              <BrainCircuit size={16} />
              <span>{chatConfig.model || 'Select model'}</span>
            </div>
            {activePage === 'models' ? (
              <button className="ghost-action compact-action" type="button" onClick={() => void handleRefreshModels()} disabled={isRefreshingModels || isLoading}>
                <RefreshCw size={16} /> {isRefreshingModels ? 'Refreshing...' : 'Refresh'}
              </button>
            ) : null}
            {activePage === 'agent' ? (
              <button className="primary-action compact-action" type="button" onClick={() => void handleStartRun(activeGraphId)} disabled={isPlanningRun || !activeSessionId}>
                <SlidersHorizontal size={16} /> {isPlanningRun ? 'Planning...' : 'Plan run'}
              </button>
            ) : null}
          </div>
        </header>

        <div className="workspace-body">
          {bridgeWarning ? <div className="callout warn workspace-callout">{bridgeWarning}</div> : null}
          {error ? <div className="callout error workspace-callout">{error}</div> : null}

          <div className={`workspace-content page-${activePage}`}>

      {activePage === 'chats' ? (
      <section className={`chat-layout ${isNavOpen ? 'nav-open' : 'nav-closed'}`}>
        <aside id="session-navigation" className="surface session-rail" hidden aria-hidden="true">
          <div className="panel-head">
            <h2>Chats</h2>
          </div>
          <div className="session-stack">
            {sessions.length === 0 ? <div className="empty-state">Create a chat session to begin.</div> : sessions.map((session) => (
              <button
                key={session.id}
                type="button"
                className={`session-item ${session.id === activeSessionId ? 'active' : ''}`}
                onClick={() => void handleSelectSession(session.id)}
              >
                <div>
                  <strong>{session.title}</strong>
                  <p>{session.lastRunSummary}</p>
                </div>
                <span className={`status-pill ${getRunStatusTone(session.status)}`}>{session.status}</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="surface chat-column">
          <div className="panel-head chat-panel-head">
            <div>
              <h2>{activeSession?.title ?? 'Chat'}</h2>
              <p>Send prompts to your selected Ollama endpoint and persist the conversation locally.</p>
            </div>
          </div>

          {isNarrowLayout && !isNavOpen ? (
            <div className="chat-context-strip" role="status" aria-live="polite">
              <button className="secondary-action" type="button" onClick={() => setIsNavOpen(true)}>
                Open chats
              </button>
              <div>
                <strong>{chatConfig.model || 'Model not selected'}</strong>
                <p>{chatConfig.endpoint}</p>
              </div>
            </div>
          ) : null}

          <div className="message-list" ref={messageListRef}>
            {messages.length === 0 ? <div className="empty-state">No messages yet. Send the first prompt to start the conversation.</div> : messages.map((message) => (
              <article key={message.id} className={`message-card ${message.role}`}>
                <div className="message-meta">
                  <strong>{getMessageLabel(message)}</strong>
                  <span>{formatTimestamp(message.createdAt)}</span>
                </div>
                {editingMessageId === message.id ? (
                  <div className="message-edit-panel">
                    <textarea
                      value={editingDraft}
                      onChange={(event) => setEditingDraft(event.target.value)}
                      rows={4}
                    />
                    <div className="message-actions">
                      <button className="secondary-action" type="button" onClick={() => void handleSaveMessageEdit(message.id)}>Save</button>
                      <button className="secondary-action" type="button" onClick={() => {
                        setEditingMessageId(null);
                        setEditingDraft('');
                      }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="message-content">
                    {isThinkingProcessVisible ? message.content : stripThinkingProcess(message.content)}
                  </div>
                )}
                {message.role === 'assistant' ? (
                  <div className="message-metrics" aria-label="System metrics">
                    <div className="message-metrics-group">
                      <h4>Ingestion</h4>
                      <ul>
                        {getMetricSections(message.metrics).ingestion.map((metric) => (
                          <li key={metric.label}>
                            <span>{metric.label}</span>
                            <strong>{metric.value}</strong>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="message-metrics-group">
                      <h4>Token generation</h4>
                      <ul>
                        {getMetricSections(message.metrics).generation.map((metric) => (
                          <li key={metric.label}>
                            <span>{metric.label}</span>
                            <strong>{metric.value}</strong>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ) : null}
                <div className="message-actions">
                  {message.role === 'assistant' ? (
                    <>
                      <button className="icon-action message-action-icon" type="button" onClick={() => void handleRetryAssistant(message.id)} title="Retry response" aria-label="Retry response" data-tooltip="Retry">
                        <RefreshCw size={14} />
                      </button>
                      <span className="retry-counter" title="Retry count for this prompt">{assistantMessageContext.get(message.id)?.retryCount ?? 0}</span>
                      <button className="icon-action message-action-icon" type="button" onClick={() => void handleBranchFromAssistant(message.id)} title="Branch to new chat" aria-label="Branch to new chat" data-tooltip="Branch">
                        <GitBranchPlus size={14} />
                      </button>
                      <button className="icon-action message-action-icon" type="button" onClick={() => void handleCopyMessage(message.content)} title="Copy response" aria-label="Copy response" data-tooltip="Copy">
                        <Copy size={14} />
                      </button>
                      <button className="icon-action message-action-icon danger-icon" type="button" onClick={() => void handleDeleteMessage(message.id)} title="Delete response" aria-label="Delete response" data-tooltip="Delete">
                        <Trash size={14} />
                      </button>
                    </>
                  ) : null}

                  {message.role === 'user' && editingMessageId !== message.id ? (
                    <>
                      <button className="icon-action message-action-icon" type="button" onClick={() => {
                        setEditingMessageId(message.id);
                        setEditingDraft(message.content);
                      }} title={isPendingMessageId(message.id) ? 'Edit local pending prompt' : 'Edit prompt'} aria-label="Edit prompt" data-tooltip="Edit">
                        <PenSquare size={14} />
                      </button>
                      <button className="icon-action message-action-icon" type="button" onClick={() => void handleCopyMessage(message.content)} title="Copy prompt" aria-label="Copy prompt" data-tooltip="Copy">
                        <Copy size={14} />
                      </button>
                      <button className="icon-action message-action-icon danger-icon" type="button" onClick={() => void handleDeleteMessage(message.id)} title={isPendingMessageId(message.id) ? 'Delete local pending prompt' : 'Delete prompt'} aria-label="Delete prompt" data-tooltip="Delete">
                        <Trash size={14} />
                      </button>
                    </>
                  ) : null}
                </div>
              </article>
            ))}
            {activeDrafts.map((draft) => (
              <article key={draft.requestId} className="message-card assistant streaming">
                <div className="message-meta">
                  <strong>{draft.model || 'Assistant'}</strong>
                  <span>Streaming...</span>
                </div>
                <div className="message-content">
                  {(isThinkingProcessVisible ? draft.content : stripThinkingProcess(draft.content)) || 'Waiting for first token...'}
                </div>
              </article>
            ))}
          </div>

          <div className="composer-card">
            <input
              ref={attachmentInputRef}
              className="composer-attachment-input"
              type="file"
              accept="image/*,.txt,.md,.markdown,.json,.csv,.tsv,.xml,.yaml,.yml,.html,.css,.js,.ts,.jsx,.tsx,.py,.java,.c,.cpp,.cs,.go,.rs,.sql,.log,.pdf,.doc,.docx"
              multiple
              onChange={(event) => void handleAttachmentInputChange(event)}
            />

            <textarea
              value={composer}
              onChange={(event) => setComposer(event.target.value)}
              onKeyDown={handleComposerKeyDown}
              placeholder="Ask your local or LAN Ollama service something useful..."
              rows={5}
            />
            {composerAttachments.length > 0 ? (
              <div className="composer-attachments" aria-label="Composer attachments">
                {composerAttachments.map((attachment) => (
                  <div key={attachment.id} className="attachment-chip" title={`${attachment.name} (${formatFileSize(attachment.size)})`}>
                    {attachment.kind === 'image' ? <ImageIcon size={14} /> : <FileText size={14} />}
                    <span>{attachment.name}</span>
                    <button
                      className="icon-action attachment-remove"
                      type="button"
                      onClick={() => handleRemoveAttachment(attachment.id)}
                      aria-label={`Remove attachment ${attachment.name}`}
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="composer-actions">
              <small>
                {chatConfig.endpoint} | {isSendOnEnterOnly ? 'Enter sends, Shift+Enter adds a new line' : 'Ctrl+Enter sends'}
                {composerAttachments.length > 0 ? ` | ${composerAttachments.length} attachment${composerAttachments.length === 1 ? '' : 's'}` : ''}
              </small>
              {isSendingMessage && activeStreamId ? (
                <button
                  className="icon-action run-action-icon danger-icon"
                  type="button"
                  onClick={() => { streamRequestIdRef.current = null; }}
                  title="Stop streaming"
                  aria-label="Stop streaming"
                  data-tooltip="Stop"
                >
                  <Square size={14} />
                </button>
              ) : null}
              <button className="secondary-action composer-attach-action" type="button" onClick={handlePickAttachments}>
                <Paperclip size={15} /> Attach
              </button>
              <button className="primary-action" type="button" onClick={() => void handleSendMessage()} disabled={isSendingMessage || !canSendMessage}>
                {isSendingMessage ? 'Sending...' : 'Send message'}
              </button>
            </div>
          </div>
        </section>

        <aside className="surface inspector-rail" hidden aria-hidden="true">
          <section className="inspector-section" data-inspector-section="runtime">
            <div className="panel-head section-head">
              <h2>
                Runtime inspector
                <span className="section-count">5</span>
              </h2>
              {isNarrowLayout ? (
                <button
                  className="secondary-action section-toggle"
                  type="button"
                  onClick={() => toggleInspectorSection('runtime')}
                  aria-expanded={isInspectorExpanded('runtime')}
                  aria-controls="inspector-runtime"
                >
                  {isInspectorExpanded('runtime') ? 'Collapse' : 'Expand'}
                </button>
              ) : null}
            </div>
            <div id="inspector-runtime" className={`inspector-section-content ${isInspectorExpanded('runtime') ? 'expanded' : 'collapsed'}`}>
              <ul className="meta-list">
                <li>Electron {status?.electronVersion ?? '-'}</li>
                <li>Node {status?.nodeVersion ?? '-'}</li>
                <li>Chrome {status?.chromeVersion ?? '-'}</li>
                <li>App {status?.appVersion ?? '-'}</li>
                <li className="bridge-health-row" title={bridgeHealth.ok ? 'Renderer and preload bridge are in sync.' : `Missing: ${bridgeHealth.missingMethods.join(', ')}`}>
                  <span>Bridge</span>
                  <span className={`bridge-health-pill ${bridgeHealth.ok ? 'ok' : 'warn'}`}>
                    {bridgeHealth.ok ? 'OK' : `Out of sync (${bridgeHealth.missingMethods.length})`}
                  </span>
                </li>
              </ul>
            </div>
          </section>

          <section className="inspector-section" data-inspector-section="graphs">
            <div className="panel-head split-head section-head">
              <div>
                <h2>
                  Graphs
                  <span className="section-count">{graphs.length}</span>
                </h2>
                <p>Plan runtime operations alongside chat sessions.</p>
              </div>
              {isNarrowLayout ? (
                <button
                  className="secondary-action section-toggle"
                  type="button"
                  onClick={() => toggleInspectorSection('graphs')}
                  aria-expanded={isInspectorExpanded('graphs')}
                  aria-controls="inspector-graphs"
                >
                  {isInspectorExpanded('graphs') ? 'Collapse' : 'Expand'}
                </button>
              ) : null}
            </div>
            <div id="inspector-graphs" className={`inspector-section-content ${isInspectorExpanded('graphs') ? 'expanded' : 'collapsed'}`}>
              <div className="graph-pills">
                {graphs.map((graph) => (
                  <button
                    key={graph.id}
                    type="button"
                    className={`graph-pill ${graph.id === activeGraphId ? 'active' : ''}`}
                    onClick={() => setActiveGraphId(graph.id)}
                  >
                    {graph.name}
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="inspector-section" data-inspector-section="runs">
            <div className="panel-head section-head">
              <h2>
                Runs
                <span className="section-count">{activeRuns.length}</span>
              </h2>
              {isNarrowLayout ? (
                <button
                  className="secondary-action section-toggle"
                  type="button"
                  onClick={() => toggleInspectorSection('runs')}
                  aria-expanded={isInspectorExpanded('runs')}
                  aria-controls="inspector-runs"
                >
                  {isInspectorExpanded('runs') ? 'Collapse' : 'Expand'}
                </button>
              ) : null}
            </div>
            <div id="inspector-runs" className={`inspector-section-content ${isInspectorExpanded('runs') ? 'expanded' : 'collapsed'}`}>
              {activeRuns.length === 0 ? <div className="empty-state">No runtime runs for this session.</div> : (
                <div className="run-list compact">
                  {activeRuns.map((run) => (
                    <article className="run-card" key={run.id}>
                      <header className="run-header">
                        <div>
                          <h3>{run.graphName}</h3>
                          <p>{run.summary}</p>
                        </div>
                        <span className={`status-pill ${getRunStatusTone(run.status)}`}>{run.status}</span>
                      </header>
                      <div className="run-actions">
                        {(run.status === 'planned' || run.status === 'paused') ? <button className="secondary-action" type="button" onClick={() => void handleRunAction(run.id, 'resume')} disabled={actionRunId === run.id}>Start</button> : null}
                        {(run.status === 'planned' || run.status === 'running' || run.status === 'paused') ? <button className="secondary-action" type="button" onClick={() => void handleRunAction(run.id, 'step')} disabled={actionRunId === run.id}>Step</button> : null}
                        {(run.status === 'planned' || run.status === 'paused') ? <button className="secondary-action" type="button" onClick={() => void handleRunAction(run.id, 'execute')} disabled={actionRunId === run.id}>Run all</button> : null}
                        {(run.status === 'planned' || run.status === 'running' || run.status === 'paused') ? (
                          <button
                            className="icon-action run-action-icon danger-icon"
                            type="button"
                            onClick={() => void handleRunAction(run.id, 'cancel')}
                            disabled={actionRunId === run.id}
                            title="Cancel run"
                            aria-label={`Cancel ${run.graphName} run`}
                            data-tooltip="Cancel run"
                          >
                            <X size={14} />
                          </button>
                        ) : null}
                      </div>
                      {run.status === 'waiting_approval' ? (
                        <>
                          <div className="approval-form">
                            <label>
                              Operator
                              <input
                                type="text"
                                value={approvalDrafts[run.id]?.operator ?? ''}
                                onChange={(event) => {
                                  const value = event.target.value;
                                  setApprovalDrafts((current) => ({
                                    ...current,
                                    [run.id]: {
                                      operator: value,
                                      operatorRole: current[run.id]?.operatorRole ?? 'runtime-reviewer',
                                      reason: current[run.id]?.reason ?? ''
                                    }
                                  }));
                                }}
                              />
                            </label>
                            <label>
                              Role
                              <input
                                type="text"
                                value={approvalDrafts[run.id]?.operatorRole ?? 'runtime-reviewer'}
                                onChange={(event) => {
                                  const value = event.target.value;
                                  setApprovalDrafts((current) => ({
                                    ...current,
                                    [run.id]: {
                                      operator: current[run.id]?.operator ?? '',
                                      operatorRole: value,
                                      reason: current[run.id]?.reason ?? ''
                                    }
                                  }));
                                }}
                              />
                            </label>
                            <label>
                              Reason
                              <input
                                type="text"
                                value={approvalDrafts[run.id]?.reason ?? ''}
                                onChange={(event) => {
                                  const value = event.target.value;
                                  setApprovalDrafts((current) => ({
                                    ...current,
                                    [run.id]: {
                                      operator: current[run.id]?.operator ?? '',
                                      operatorRole: current[run.id]?.operatorRole ?? 'runtime-reviewer',
                                      reason: value
                                    }
                                  }));
                                }}
                              />
                            </label>
                          </div>
                          <div className="run-actions">
                            <button className="secondary-action" type="button" onClick={() => void handleRunAction(run.id, 'approve')} disabled={actionRunId === run.id}>Approve</button>
                            <button
                              className="icon-action run-action-icon danger-icon"
                              type="button"
                              onClick={() => void handleRunAction(run.id, 'deny')}
                              disabled={actionRunId === run.id}
                              title="Deny approval"
                              aria-label={`Deny approval for ${run.graphName}`}
                              data-tooltip="Deny"
                            >
                              <CircleOff size={14} />
                            </button>
                          </div>
                        </>
                      ) : null}
                      {run.pendingApproval ? <div className="approval-banner">Approval needed: {run.pendingApproval.checkpointTitle} | role {run.pendingApproval.requiredApproverRole}</div> : null}
                    </article>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="inspector-section" data-inspector-section="policies">
            <div className="panel-head section-head">
              <h2>
                Policies
                <span className="section-count">{policyRows.length}</span>
              </h2>
              {isNarrowLayout ? (
                <button
                  className="secondary-action section-toggle"
                  type="button"
                  onClick={() => toggleInspectorSection('policies')}
                  aria-expanded={isInspectorExpanded('policies')}
                  aria-controls="inspector-policies"
                >
                  {isInspectorExpanded('policies') ? 'Collapse' : 'Expand'}
                </button>
              ) : null}
            </div>
            <div id="inspector-policies" className={`inspector-section-content ${isInspectorExpanded('policies') ? 'expanded' : 'collapsed'}`}>
              {policyRows.length === 0 ? <div className="empty-state">No approval policies active for this session.</div> : (
                <div className="policy-list">
                  {policyRows.map((policy) => (
                    <article key={policy.id} className="policy-card">
                      <strong>{policy.id}</strong>
                      <p>Role: {policy.requiredApproverRole}</p>
                      <p>Scope: {policy.actionScope}</p>
                      <p>Min risk: {policy.minRiskScore}</p>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="inspector-section" data-inspector-section="events">
            <div className="panel-head section-head">
              <h2>
                Latest events
                <span className="section-count">{latestRun?.events.length ?? 0}</span>
              </h2>
              {isNarrowLayout ? (
                <button
                  className="secondary-action section-toggle"
                  type="button"
                  onClick={() => toggleInspectorSection('events')}
                  aria-expanded={isInspectorExpanded('events')}
                  aria-controls="inspector-events"
                >
                  {isInspectorExpanded('events') ? 'Collapse' : 'Expand'}
                </button>
              ) : null}
            </div>
            <div id="inspector-events" className={`inspector-section-content ${isInspectorExpanded('events') ? 'expanded' : 'collapsed'}`}>
              {latestRun ? <ul className="event-list">{latestRun.events.slice(-6).reverse().map((event) => <li key={event}>{event}</li>)}</ul> : <div className="empty-state">No run events yet.</div>}
            </div>
          </section>

          <section className="inspector-section" data-inspector-section="milestones">
            <div className="panel-head section-head">
              <h2>
                Milestones
                <span className="section-count">{plan?.milestones.length ?? 0}</span>
              </h2>
              {isNarrowLayout ? (
                <button
                  className="secondary-action section-toggle"
                  type="button"
                  onClick={() => toggleInspectorSection('milestones')}
                  aria-expanded={isInspectorExpanded('milestones')}
                  aria-controls="inspector-milestones"
                >
                  {isInspectorExpanded('milestones') ? 'Collapse' : 'Expand'}
                </button>
              ) : null}
            </div>
            <div id="inspector-milestones" className={`inspector-section-content ${isInspectorExpanded('milestones') ? 'expanded' : 'collapsed'}`}>
              <ol className="milestone-list">
                {(plan?.milestones ?? []).map((milestone) => <li key={milestone}>{milestone}</li>)}
              </ol>
            </div>
          </section>
        </aside>
      </section>
      ) : null}

      {activePage === 'settings' ? (
        <section className="page-grid two-up">
          <article className="server-settings-panel">
            <div className="panel-head split-head">
              <div>
                <h2>LAN Ollama servers</h2>
                <p>Save local network endpoints and inspect their health and model catalogs.</p>
              </div>
              <span className="section-count">{ollamaServers.length}</span>
            </div>

            <div className="server-add-row">
              <label>
                Name
                <input
                  type="text"
                  value={serverDraft.label}
                  onChange={(event) => setServerDraft((current) => ({ ...current, label: event.target.value }))}
                  placeholder="Office GPU"
                />
              </label>
              <label>
                IP address and port
                <input
                  type="text"
                  value={serverDraft.endpoint}
                  onChange={(event) => setServerDraft((current) => ({ ...current, endpoint: event.target.value }))}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void handleAddOllamaServer();
                  }}
                  placeholder="192.168.1.50:11434"
                />
              </label>
              <button className="primary-action server-add-action" type="button" onClick={() => void handleAddOllamaServer()} disabled={isSavingServer}>
                <Plus size={16} /> {isSavingServer ? 'Saving...' : 'Add server'}
              </button>
            </div>

            <div className="server-card-grid">
              {ollamaServers.length === 0 ? <div className="empty-state">No LAN servers saved. Add an Ollama endpoint to begin monitoring it.</div> : ollamaServers.map((server) => {
                const health = ollamaServerHealth[server.id];
                const checking = checkingServerIds[server.id];
                const active = server.endpoint === chatConfig.endpoint;
                const healthState = checking ? 'checking' : health?.status ?? 'unknown';

                return (
                  <article key={server.id} className={`ollama-server-card ${active ? 'active' : ''}`}>
                    <header className="server-card-header">
                      <div className="server-identity">
                        <span className="server-icon"><Network size={18} /></span>
                        <div>
                          <strong>{server.label}</strong>
                          <p>{server.endpoint}</p>
                        </div>
                      </div>
                      <span className={`server-health-badge ${healthState}`}>
                        {healthState === 'offline' ? <CircleOff size={13} /> : <span className="server-health-dot" />}
                        {healthState}
                      </span>
                    </header>

                    <div className="server-models">
                      <span className="server-card-label">Available models</span>
                      {health?.models.length ? (
                        <div className="server-model-list">
                          {health.models.map((model) => <span key={model.name} className="server-model-chip">{model.name}</span>)}
                        </div>
                      ) : <p className="server-card-empty">{healthState === 'offline' ? 'Server unavailable.' : 'Refresh to load models.'}</p>}
                    </div>

                    {health?.error ? <p className="server-health-error">{health.error}</p> : null}

                    <footer className="server-card-footer">
                      <small>{health?.checkedAt ? `Checked ${formatTimestamp(health.checkedAt)}` : 'Not checked yet'}</small>
                      <div className="server-card-actions">
                        <button className="secondary-action" type="button" onClick={() => void handleUseOllamaServer(server)} disabled={active || isRefreshingModels}>
                          <Server size={15} /> {active ? 'In use' : 'Use for chat'}
                        </button>
                        <button className="icon-action" type="button" onClick={() => void handleCheckOllamaServer(server.id)} disabled={checking} aria-label={`Refresh ${server.label}`} title="Refresh health" data-tooltip="Refresh health">
                          <RefreshCw size={16} className={checking ? 'spinning' : ''} />
                        </button>
                        <button className="icon-action danger-icon" type="button" onClick={() => void handleRemoveOllamaServer(server.id)} disabled={removingServerId === server.id} aria-label={`Remove ${server.label}`} title="Remove server" data-tooltip="Remove server">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </footer>
                  </article>
                );
              })}
            </div>
          </article>

          <article className="surface">
            <div className="panel-head">
              <h2>Chat settings</h2>
            </div>
            <div className="composer-toolbar settings-grid">
              <label>
                Ollama endpoint
                <input
                  type="text"
                  value={chatConfig.endpoint}
                  onChange={(event) => setChatConfig((current) => ({ ...current, endpoint: event.target.value }))}
                  onBlur={() => void handleSaveConfig({ endpoint: chatConfig.endpoint })}
                  placeholder="http://127.0.0.1:11434"
                />
              </label>
              <div className="toggle-field" role="status" aria-live="polite">
                <span>Selected model</span>
                <strong>{chatConfig.model || 'None selected'}</strong>
              </div>
              <label className="toggle-field">
                <span>Auto-scroll chat</span>
                <input
                  type="checkbox"
                  checked={isAutoScrollEnabled}
                  onChange={(event) => setIsAutoScrollEnabled(event.target.checked)}
                />
              </label>
              <label className="toggle-field">
                <span>Show thinking process</span>
                <input
                  type="checkbox"
                  checked={isThinkingProcessVisible}
                  onChange={(event) => setIsThinkingProcessVisible(event.target.checked)}
                />
              </label>
              <label className="toggle-field">
                <span>Send message on Enter only</span>
                <input
                  type="checkbox"
                  checked={isSendOnEnterOnly}
                  onChange={(event) => setIsSendOnEnterOnly(event.target.checked)}
                />
              </label>
              <label className="toggle-field">
                <span>Auto-rename sessions</span>
                <input
                  type="checkbox"
                  checked={chatConfig.autoRenameEnabled}
                  onChange={(event) => {
                    const autoRenameEnabled = event.target.checked;
                    setChatConfig(current => ({ ...current, autoRenameEnabled }));
                    void handleSaveConfig({ autoRenameEnabled });
                  }}
                />
              </label>
            </div>
          </article>

          <article className="surface">
            <div className="panel-head">
              <h2>Runtime inspector</h2>
            </div>
            <ul className="meta-list">
              <li>Electron {status?.electronVersion ?? '-'}</li>
              <li>Node {status?.nodeVersion ?? '-'}</li>
              <li>Chrome {status?.chromeVersion ?? '-'}</li>
              <li>App {status?.appVersion ?? '-'}</li>
              <li>Runtime mode {status?.mode ?? '-'}</li>
              <li>LangSmith {status?.langsmith.mode ?? '-'}</li>
              <li className="bridge-health-row" title={bridgeHealth.ok ? 'Renderer and preload bridge are in sync.' : `Missing: ${bridgeHealth.missingMethods.join(', ')}`}>
                <span>Bridge</span>
                <span className={`bridge-health-pill ${bridgeHealth.ok ? 'ok' : 'warn'}`}>
                  {bridgeHealth.ok ? 'OK' : `Out of sync (${bridgeHealth.missingMethods.length})`}
                </span>
              </li>
            </ul>
          </article>
        </section>
      ) : null}

      {activePage === 'models' ? (
        <section className="page-grid">
          <article className="surface">
            <div className="panel-head">
              <h2>Available models</h2>
              <p>Click a model card to make it active for chat.</p>
            </div>
            <div className="model-grid">
              {availableModels.length === 0 ? <div className="empty-state">No models found. Refresh the catalog to load current endpoint models.</div> : availableModels.map((model) => (
                <button
                  key={model.name}
                  className={`policy-card model-card model-select-card ${chatConfig.model === model.name ? 'selected' : ''}`}
                  type="button"
                  onClick={() => {
                    if (chatConfig.model === model.name) return;
                    setChatConfig((current) => ({ ...current, model: model.name }));
                    void handleSaveConfig({ model: model.name });
                  }}
                  aria-pressed={chatConfig.model === model.name}
                >
                  <strong>{model.name}</strong>
                  <p>{chatConfig.model === model.name ? 'Selected model' : 'Click to select'}</p>
                </button>
              ))}
            </div>
          </article>
        </section>
      ) : null}

      {activePage === 'mcp' ? (
        <section className="page-grid two-up">
          <article className="surface">
            <div className="panel-head split-head">
              <div>
                <h2>MCP servers</h2>
                <p>Runtime status for in-app MCP server integrations.</p>
              </div>
              <button className="ghost-action compact-action" type="button" onClick={() => void refreshMcpServerStatus()} disabled={isRefreshingMcpStatus}>
                <RefreshCw size={16} className={isRefreshingMcpStatus ? 'spinning' : ''} /> {isRefreshingMcpStatus ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>
            {mcpStatusError ? <div className="callout warn">{mcpStatusError}</div> : null}
            <div className="mcp-server-list">
              {mcpServerRows.map((server) => (
                <article key={server.id} className="policy-card mcp-server-card">
                  <header className="run-header">
                    <strong>{server.label}</strong>
                    <span className={`status-pill ${server.tone}`}>{server.state}</span>
                  </header>
                  <p>{server.detail}</p>
                </article>
              ))}
            </div>
          </article>

          <article className="surface">
            <div className="panel-head">
              <h2>Policies</h2>
            </div>
            {policyRows.length === 0 ? <div className="empty-state">No approval policies active for this session.</div> : (
              <div className="policy-list">
                {policyRows.map((policy) => (
                  <article key={policy.id} className="policy-card">
                    <strong>{policy.id}</strong>
                    <p>Role: {policy.requiredApproverRole}</p>
                    <p>Scope: {policy.actionScope}</p>
                    <p>Min risk: {policy.minRiskScore}</p>
                  </article>
                ))}
              </div>
            )}
          </article>

          <article className="surface">
            <div className="panel-head">
              <h2>Latest events</h2>
            </div>
            {latestRun ? <ul className="event-list">{latestRun.events.slice(-12).reverse().map((event) => <li key={event}>{event}</li>)}</ul> : <div className="empty-state">No run events yet.</div>}
          </article>

          <article className="surface">
            <div className="panel-head">
              <h2>Milestones</h2>
            </div>
            <ol className="milestone-list">
              {(plan?.milestones ?? []).map((milestone) => <li key={milestone}>{milestone}</li>)}
            </ol>
          </article>

          <article className="surface">
            <div className="panel-head">
              <h2>Memory records</h2>
            </div>
            {memoryRecords.length === 0 ? <div className="empty-state">No memory records ingested for this session yet.</div> : (
              <div className="policy-list">
                {memoryRecords.slice(0, 24).map((record) => (
                  <article key={record.id} className="policy-card">
                    <strong>{record.fact}</strong>
                    <p>Importance: {record.importanceScore}</p>
                    <p>Retention: {record.retention}</p>
                    <p>Tags: {record.tags.length > 0 ? record.tags.join(', ') : 'none'}</p>
                    <p>Updated: {formatTimestamp(record.updatedAt)}</p>
                  </article>
                ))}
              </div>
            )}
          </article>
        </section>
      ) : null}

      {activePage === 'agent' ? (
        <section className="page-grid two-up">
          <article className="surface">
            <div className="panel-head split-head">
              <div>
                <h2>Graphs</h2>
                <p>Choose a graph before planning a run.</p>
              </div>
            </div>
            <div className="graph-pills">
              {graphs.map((graph) => (
                <button
                  key={graph.id}
                  type="button"
                  className={`graph-pill ${graph.id === activeGraphId ? 'active' : ''}`}
                  onClick={() => setActiveGraphId(graph.id)}
                >
                  {graph.name}
                </button>
              ))}
            </div>
          </article>

          <article className="surface">
            <div className="panel-head">
              <h2>Runs</h2>
            </div>
            {activeRuns.length === 0 ? <div className="empty-state">No runtime runs for this session.</div> : (
              <div className="run-list compact">
                {activeRuns.map((run) => (
                  <article className="run-card" key={run.id}>
                    <header className="run-header">
                      <div>
                        <h3>{run.graphName}</h3>
                        <p>{run.summary}</p>
                      </div>
                      <span className={`status-pill ${getRunStatusTone(run.status)}`}>{run.status}</span>
                    </header>
                    <div className="run-actions">
                      {(run.status === 'planned' || run.status === 'paused') ? <button className="secondary-action" type="button" onClick={() => void handleRunAction(run.id, 'resume')} disabled={actionRunId === run.id}>Start</button> : null}
                      {(run.status === 'planned' || run.status === 'running' || run.status === 'paused') ? <button className="secondary-action" type="button" onClick={() => void handleRunAction(run.id, 'step')} disabled={actionRunId === run.id}>Step</button> : null}
                      {(run.status === 'planned' || run.status === 'paused') ? <button className="secondary-action" type="button" onClick={() => void handleRunAction(run.id, 'execute')} disabled={actionRunId === run.id}>Run all</button> : null}
                      {(run.status === 'planned' || run.status === 'running' || run.status === 'paused') ? (
                        <button
                          className="icon-action run-action-icon danger-icon"
                          type="button"
                          onClick={() => void handleRunAction(run.id, 'cancel')}
                          disabled={actionRunId === run.id}
                          title="Cancel run"
                          aria-label={`Cancel ${run.graphName} run`}
                          data-tooltip="Cancel run"
                        >
                          <X size={14} />
                        </button>
                      ) : null}
                    </div>
                    {run.pendingApproval ? <div className="approval-banner">Approval needed: {run.pendingApproval.checkpointTitle} | role {run.pendingApproval.requiredApproverRole}</div> : null}
                  </article>
                ))}
              </div>
            )}
          </article>
        </section>
      ) : null}
          </div>
        </div>
      </section>

      {isNarrowLayout && isNavOpen ? (
        <button
          className="nav-backdrop"
          type="button"
          onClick={closeNavigation}
          aria-label="Close chat navigation"
        />
      ) : null}
    </main>
  );
}

export default App;
