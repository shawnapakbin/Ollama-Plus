import React, { Suspense, useRef, useState, useEffect, useCallback } from 'react';
import { Settings, MessageSquare, Terminal as TerminalIcon, Book, ListTodo, Box, Columns2, PanelLeftClose, PanelLeftOpen, Radar, FileText, ShieldCheck, RefreshCcw } from 'lucide-react';
import ModelSelector, { type ModelEntry } from './components/ModelSelector';
import ThemeSelector from './components/ThemeSelector';
import { ipcService, isElectronAvailable } from './services/ipcService';
import { onOpenViewer3D } from './services/workspaceEvents';
import logo from './assets/logo.png';
import { getStoredTheme, type ThemeName } from './theme';
import './App.css';

const Chat = React.lazy(() => import('./components/Chat/Chat'));
const Wiki = React.lazy(() => import('./components/Wiki'));
const TaskBoard = React.lazy(() => import('./components/TaskBoard'));
const Viewer3D = React.lazy(() => import('./components/Viewer3D'));
const MarkdownDecisionForm = React.lazy(() => import('./components/MarkdownDecisionForm'));
const MarkdownInputForm = React.lazy(() => import('./components/MarkdownInputForm'));

const PANEL_IDS = ['chat', 'wiki', 'tasks', 'viewer3d', 'systemMessage'] as const;

type PanelId = typeof PANEL_IDS[number];

type PanelConfig = {
  id: PanelId;
  label: string;
  Icon: React.ComponentType<{ size?: number }>;
};

type Session = {
  id: string;
  title: string;
  updatedAt: string;
};

type ModelTag = {
  name: string;
};

type WorkspaceLayout = {
  id: string;
  name: string;
  primary: PanelId;
  secondary?: PanelId;
};

type DecisionOption = {
  id: string;
  label: string;
  description?: string;
  recommended?: boolean;
};

type PendingDecision = {
  requestId: string;
  title: string;
  markdown: string;
  options: DecisionOption[];
  createdAt: string;
  source?: 'ipc' | 'local';
};

type PendingInput = {
  requestId: string;
  title: string;
  markdown: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  createdAt: string;
};

type McpRuntimeStatus = {
  terminalSessionCount: number | null;
  pythonReady: boolean | null;
  pythonInterpreter: string;
  pythonVersion: string;
  pythonSource: string;
  pythonNote: string;
  folderRoot: string;
  folderCustom: boolean;
  browserSessionCount: number | null;
  lastCheckedAt: string;
};

type SavedSystemMessage = {
  id: string;
  content: string;
  updatedAt: string;
};

type AppToast = {
  id: number;
  message: string;
  kind: 'info' | 'warn' | 'error';
};

const SAVED_SYSTEM_MESSAGES_KEY = 'savedSystemMessages';
const GLOBAL_SYSTEM_MESSAGE_KEY = 'globalSystemMessage';
const CHAT_SYSTEM_MESSAGE_OVERRIDES_KEY = 'chatSystemMessageOverrides';
const AUTO_INJECT_DATETIME_KEY = 'autoInjectDateTime';
const RESEARCH_TURN_LIMIT_KEY = 'researchTurnLimit';

function loadResearchTurnLimit(): number {
  const raw = localStorage.getItem(RESEARCH_TURN_LIMIT_KEY);
  if (raw === null || raw === '') return 0;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

const DEFAULT_LAYOUTS: WorkspaceLayout[] = [
  { id: 'layout-chat', name: 'Chat Focus', primary: 'chat' },
  { id: 'layout-agent', name: 'Agent + Tasks', primary: 'chat', secondary: 'tasks' },
  { id: 'layout-research', name: 'Research', primary: 'wiki', secondary: 'tasks' },
  { id: 'layout-3d', name: '3D Studio', primary: 'viewer3d', secondary: 'chat' }
];

const PANEL_CONFIG: PanelConfig[] = [
  { id: 'chat', label: 'Chat', Icon: MessageSquare },
  { id: 'wiki', label: 'Knowledge Wiki', Icon: Book },
  { id: 'tasks', label: 'Task Board', Icon: ListTodo },
  { id: 'viewer3d', label: '3D Workspace', Icon: Box }
];

function loadLayouts(): WorkspaceLayout[] {
  const raw = localStorage.getItem('workspaceLayouts');
  if (!raw) return DEFAULT_LAYOUTS;

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_LAYOUTS;

    const safeLayouts = parsed
      .filter((layout) => layout && typeof layout.id === 'string' && typeof layout.name === 'string')
      .map((layout) => {
        const primary = PANEL_IDS.includes(layout.primary) ? layout.primary : 'chat';
        const secondary = PANEL_IDS.includes(layout.secondary) && layout.secondary !== primary ? layout.secondary : undefined;
        return {
          id: layout.id,
          name: layout.name,
          primary,
          secondary
        };
      });

    return safeLayouts.length > 0 ? safeLayouts : DEFAULT_LAYOUTS;
  } catch {
    return DEFAULT_LAYOUTS;
  }
}

function shortHostLabel(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.host || url;
  } catch {
    return url;
  }
}

function loadSavedSystemMessages(): SavedSystemMessage[] {
  const raw = localStorage.getItem(SAVED_SYSTEM_MESSAGES_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry) => entry && typeof entry.id === 'string' && typeof entry.content === 'string')
      .map((entry) => ({
        id: entry.id,
        content: entry.content,
        updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : new Date().toISOString()
      }));
  } catch {
    return [];
  }
}

function loadChatSystemMessageOverrides(): Record<string, string> {
  const raw = localStorage.getItem(CHAT_SYSTEM_MESSAGE_OVERRIDES_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([key, value]) => typeof key === 'string' && typeof value === 'string'
      )
    );
  } catch {
    return {};
  }
}

export default function App() {
  const [models, setModels] = useState<ModelTag[]>([]);
  const [selectedModel, setSelectedModel] = useState(localStorage.getItem('selectedModel') || '');
  const [selectedHost, setSelectedHost] = useState(localStorage.getItem('selectedHost') || localStorage.getItem('hostUrl') || 'http://127.0.0.1:11434');
  const [status, setStatus] = useState('Checking Ollama...');

  const [showSettings, setShowSettings] = useState(false);
  const [lanPickerOpenSignal, setLanPickerOpenSignal] = useState(0);
  const [theme, setTheme] = useState<ThemeName>(() => getStoredTheme(localStorage.getItem('theme')));
  const [hostUrl, setHostUrl] = useState(localStorage.getItem('hostUrl') || 'http://127.0.0.1:11434');
  const [keepAlive, setKeepAlive] = useState(localStorage.getItem('keepAlive') === 'true');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(localStorage.getItem('sidebarCollapsed') === 'true');
  const [autoCollapseSidebar, setAutoCollapseSidebar] = useState(localStorage.getItem('autoCollapseSidebar') === 'true');
  const [savedSystemMessages, setSavedSystemMessages] = useState<SavedSystemMessage[]>(() => loadSavedSystemMessages());
  const [globalSystemMessage, setGlobalSystemMessage] = useState(localStorage.getItem(GLOBAL_SYSTEM_MESSAGE_KEY) || '');
  const [chatSystemMessageOverrides, setChatSystemMessageOverrides] = useState<Record<string, string>>(() => loadChatSystemMessageOverrides());
  const [autoInjectDateTime, setAutoInjectDateTime] = useState(localStorage.getItem(AUTO_INJECT_DATETIME_KEY) !== 'false');
  const [researchTurnLimit, setResearchTurnLimit] = useState<number>(() => loadResearchTurnLimit());
  const [systemMessageDraft, setSystemMessageDraft] = useState('');
  const [toast, setToast] = useState<AppToast | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState(localStorage.getItem('currentSessionId') || '');
  const [editingSessionId, setEditingSessionId] = useState('');
  const [editingTitle, setEditingTitle] = useState('');
  const [layouts, setLayouts] = useState<WorkspaceLayout[]>(() => loadLayouts());
  const [activeLayoutId] = useState(localStorage.getItem('activeLayoutId') || 'layout-chat');
  const [pendingDecisions, setPendingDecisions] = useState<PendingDecision[]>([]);
  const [pendingInputs, setPendingInputs] = useState<PendingInput[]>([]);
  const [mcpStatus, setMcpStatus] = useState<McpRuntimeStatus>({
    terminalSessionCount: null,
    pythonReady: null,
    pythonInterpreter: 'Unknown',
    pythonVersion: '',
    pythonSource: '',
    pythonNote: '',
    folderRoot: '',
    folderCustom: false,
    browserSessionCount: null,
    lastCheckedAt: ''
  });
  const [mcpActionError, setMcpActionError] = useState('');
  const localDecisionHandlers = useRef(new Map<string, (selectionId: string) => void>());
  const localInputHandlers = useRef(new Map<string, (value: string | null) => void>());

  const activeLayout = layouts.find((layout) => layout.id === activeLayoutId) || layouts[0] || DEFAULT_LAYOUTS[0];
  const activeChatLayout = activeLayout.primary === 'chat' || activeLayout.secondary === 'chat';
  const activeHasSystemMessageOverride = Boolean(currentSessionId && Object.prototype.hasOwnProperty.call(chatSystemMessageOverrides, currentSessionId));
  const effectiveSystemMessage = activeHasSystemMessageOverride
    ? chatSystemMessageOverrides[currentSessionId] || ''
    : globalSystemMessage;

  const showToast = useCallback((message: string, kind: AppToast['kind'] = 'info') => {
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    setToast({ id: Date.now(), message, kind });
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 5000);
  }, []);

  const refreshMcpStatus = async () => {
    const checkedAt = new Date().toLocaleTimeString();

    if (!isElectronAvailable()) {
      setMcpStatus({
        terminalSessionCount: 0,
        pythonReady: false,
        pythonInterpreter: 'Electron required',
        pythonVersion: '',
        pythonSource: '',
        pythonNote: 'Open the app in Electron to use terminal-backed Python sessions.',
        folderRoot: '',
        folderCustom: false,
        browserSessionCount: 0,
        lastCheckedAt: checkedAt
      });
      return;
    }

    try {
      const gateway = await ipcService.mcpGatewayStatus();
      if (!gateway.ok || !gateway.data) {
        throw new Error(gateway.error || 'Failed to read MCP gateway status.');
      }

      const data = gateway.data as {
        terminalSessionCount?: number;
        pythonReady?: boolean;
        pythonInterpreter?: string;
        pythonVersion?: string;
        pythonSource?: string;
        pythonNote?: string;
        folderRoot?: string;
        folderCustom?: boolean;
        browserSessionCount?: number;
      };

      setMcpStatus({
        terminalSessionCount: typeof data.terminalSessionCount === 'number' ? data.terminalSessionCount : null,
        pythonReady: Boolean(data.pythonReady),
        pythonInterpreter: data.pythonInterpreter || 'Unavailable',
        pythonVersion: data.pythonVersion || '',
        pythonSource: data.pythonSource || '',
        pythonNote: data.pythonNote || '',
        folderRoot: data.folderRoot || '',
        folderCustom: Boolean(data.folderCustom),
        browserSessionCount: typeof data.browserSessionCount === 'number' ? data.browserSessionCount : null,
        lastCheckedAt: checkedAt
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to read MCP status.';
      setMcpActionError(message);
      setMcpStatus((prev) => ({ ...prev, lastCheckedAt: checkedAt }));
    }
  };

  const handleSelectMcpFolderRoot = async () => {
    if (!isElectronAvailable()) {
      setMcpActionError('Folder selection is only available in the Electron app.');
      return;
    }

    try {
      setMcpActionError('');
      await ipcService.selectMcpFolderRoot();
      await refreshMcpStatus();
    } catch (err) {
      console.error('Failed to select MCP folder root:', err);
      const message = err instanceof Error ? err.message : 'Unknown error selecting folder root.';
      setMcpActionError(message);
    }
  };

  const handleClearMcpFolderRoot = async () => {
    if (!isElectronAvailable()) {
      setMcpActionError('Folder selection is only available in the Electron app.');
      return;
    }

    try {
      setMcpActionError('');
      await ipcService.clearMcpFolderRoot();
      await refreshMcpStatus();
    } catch (err) {
      console.error('Failed to clear MCP folder root:', err);
      const message = err instanceof Error ? err.message : 'Unknown error clearing folder root.';
      setMcpActionError(message);
    }
  };

  const createNewSession = useCallback(() => {
    const newId = Math.random().toString(36).substring(7);
    setCurrentSessionId(newId);
    setSessions((prev) => [{ id: newId, title: 'New Chat', updatedAt: new Date().toISOString() }, ...prev]);
  }, []);

  const refreshSessions = useCallback(async () => {
    try {
      const chatList = await ipcService.listChats();
      setSessions(chatList);
      if (chatList.length > 0) {
        setCurrentSessionId((prev) => prev || chatList[0].id);
      } else {
        createNewSession();
      }
    } catch (error) {
      console.error('Failed to refresh sessions:', error);
    }
  }, [createNewSession]);

  const fetchModels = useCallback(async () => {
    setStatus('Loading models...');
    try {
      const res = await ipcService.invokeOllama(hostUrl, '/api/tags');
      const m = res.models || [];
      setModels(m);

      if (m.length > 0) {
        const firstNamed = m.find((model: ModelTag) => model.name);
        if (!firstNamed) {
          setStatus('Ready (0 models)');
          return;
        }
        setSelectedModel((prev) => prev || firstNamed.name);
        setSelectedHost((prev) => prev || hostUrl);
      }

      setStatus(`Ready (${m.length} models)`);
    } catch (err) {
      console.error(err);
      if (err instanceof Error && err.message.includes('Electron API')) {
        setStatus('Error: Open via Electron, not Browser');
      } else {
        setStatus('Ollama offline (Check Host URL or start Ollama)');
      }
    }
  }, [hostUrl]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshMcpStatus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (showSettings) {
      const timer = window.setTimeout(() => {
        void refreshMcpStatus();
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [showSettings]);

  useEffect(() => {
    localStorage.setItem('workspaceLayouts', JSON.stringify(layouts));
  }, [layouts]);

  useEffect(() => {
    localStorage.setItem('activeLayoutId', activeLayoutId);
  }, [activeLayoutId]);

  useEffect(() => {
    localStorage.setItem('sidebarCollapsed', String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  useEffect(() => {
    localStorage.setItem('autoCollapseSidebar', String(autoCollapseSidebar));
  }, [autoCollapseSidebar]);

  useEffect(() => {
    localStorage.setItem('hostUrl', hostUrl);
    localStorage.setItem('keepAlive', keepAlive.toString());
    const timer = window.setTimeout(() => {
      void fetchModels();
      void refreshSessions();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [hostUrl, keepAlive, fetchModels, refreshSessions]);

  useEffect(() => {
    localStorage.setItem('selectedModel', selectedModel);
    localStorage.setItem('selectedHost', selectedHost);
  }, [selectedHost, selectedModel]);

  useEffect(() => {
    localStorage.setItem('currentSessionId', currentSessionId);
  }, [currentSessionId]);

  useEffect(() => {
    localStorage.setItem(SAVED_SYSTEM_MESSAGES_KEY, JSON.stringify(savedSystemMessages));
  }, [savedSystemMessages]);

  useEffect(() => {
    localStorage.setItem(GLOBAL_SYSTEM_MESSAGE_KEY, globalSystemMessage);
  }, [globalSystemMessage]);

  useEffect(() => {
    localStorage.setItem(CHAT_SYSTEM_MESSAGE_OVERRIDES_KEY, JSON.stringify(chatSystemMessageOverrides));
  }, [chatSystemMessageOverrides]);

  useEffect(() => {
    localStorage.setItem(AUTO_INJECT_DATETIME_KEY, String(autoInjectDateTime));
  }, [autoInjectDateTime]);

  useEffect(() => {
    localStorage.setItem(RESEARCH_TURN_LIMIT_KEY, String(researchTurnLimit));
  }, [researchTurnLimit]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSystemMessageDraft(effectiveSystemMessage);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [effectiveSystemMessage, currentSessionId]);

  useEffect(() => () => {
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = ipcService.onPolicyDecisionRequest((request) => {
      setPendingDecisions((prev) => {
        if (prev.some((entry) => entry.requestId === request.requestId)) {
          return prev;
        }
        return [...prev, { ...(request as PendingDecision), source: 'ipc' }];
      });
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    return onOpenViewer3D(() => {
      setLayouts((prev) =>
        prev.map((layout) =>
          layout.id === activeLayout.id
            ? {
                ...layout,
                primary: 'viewer3d',
                secondary: layout.secondary === 'viewer3d' ? undefined : layout.secondary
              }
            : layout
        )
      );
      if (autoCollapseSidebar) setSidebarCollapsed(true);
    });
  }, [activeLayout.id, autoCollapseSidebar]);

  const deleteSession = async (e, id) => {
    e.stopPropagation();
    try {
      await ipcService.deleteChat(id);
      const updated = sessions.filter(s => s.id !== id);
      setSessions(updated);
      setChatSystemMessageOverrides((prev) => {
        if (!Object.prototype.hasOwnProperty.call(prev, id)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
      if (currentSessionId === id) {
        if (updated.length > 0) setCurrentSessionId(updated[0].id);
        else createNewSession();
      }
    } catch (error) {
      console.error('Failed to delete session:', error);
    }
  };

  const handleRename = async (id: string, title: string) => {
    if (title.trim()) {
      await ipcService.renameChat(id, title.trim());
      setEditingSessionId('');
      refreshSessions();
    } else {
      setEditingSessionId('');
    }
  };

  const startEditing = (e: React.MouseEvent<HTMLSpanElement>, session: Session) => {
    e.stopPropagation();
    setEditingSessionId(session.id);
    setEditingTitle(session.title);
  };

  const handleModelSelect = (entry: ModelEntry) => {
    setSelectedModel(entry.name);
    setSelectedHost(entry.host);
  };

  const handleUnloadModels = async () => {
    setStatus('Unloading models...');
    await ipcService.unloadModels(hostUrl);
    setStatus('VRAM Flushed');
    setTimeout(() => setStatus(`Ready (${models.length} models)`), 2000);
  };

  const updateActiveLayout = (updater: (layout: WorkspaceLayout) => WorkspaceLayout) => {
    setLayouts((prev) => prev.map((layout) => (layout.id === activeLayout.id ? updater(layout) : layout)));
  };

  const setPrimaryPanel = (panelId: PanelId) => {
    updateActiveLayout((layout) => ({
      ...layout,
      primary: panelId,
      secondary: layout.secondary === panelId ? undefined : layout.secondary
    }));
    if (autoCollapseSidebar) setSidebarCollapsed(true);
  };

  const handleSaveSystemMessage = () => {
    const trimmed = systemMessageDraft.trim();
    if (!trimmed) return;

    const now = new Date().toISOString();
    setSavedSystemMessages((prev) => {
      const existing = prev.find((entry) => entry.content === trimmed);
      if (existing) {
        const withoutExisting = prev.filter((entry) => entry.id !== existing.id);
        return [{ ...existing, updatedAt: now }, ...withoutExisting];
      }
      return [{ id: Math.random().toString(36).slice(2), content: trimmed, updatedAt: now }, ...prev];
    });

    setGlobalSystemMessage(trimmed);
    if (currentSessionId) {
      setChatSystemMessageOverrides((prev) => ({
        ...prev,
        [currentSessionId]: trimmed
      }));
    }
    setSystemMessageDraft(trimmed);
  };

  const handleClearSystemMessage = () => {
    setSystemMessageDraft('');
    setGlobalSystemMessage('');
    if (currentSessionId) {
      setChatSystemMessageOverrides((prev) => {
        if (!Object.prototype.hasOwnProperty.call(prev, currentSessionId)) return prev;
        const next = { ...prev };
        delete next[currentSessionId];
        return next;
      });
    }
  };

  const handleSelectSavedSystemMessage = (content: string) => {
    setSystemMessageDraft(content);
    setGlobalSystemMessage(content);
    if (currentSessionId) {
      setChatSystemMessageOverrides((prev) => ({
        ...prev,
        [currentSessionId]: content
      }));
    }
  };

  const handleDeleteSavedSystemMessage = (id: string) => {
    setSavedSystemMessages((prev) => prev.filter((entry) => entry.id !== id));
  };

  const activeDecision = pendingDecisions[0];
  const activeInput = pendingInputs[0];

  const handleDecisionSelect = async (selectionId: string) => {
    if (!activeDecision) return;
    if (activeDecision.source === 'ipc') {
      await ipcService.respondPolicyDecision(activeDecision.requestId, selectionId);
    } else {
      const handler = localDecisionHandlers.current.get(activeDecision.requestId);
      localDecisionHandlers.current.delete(activeDecision.requestId);
      handler?.(selectionId);
    }
    setPendingDecisions((prev) => prev.filter((entry) => entry.requestId !== activeDecision.requestId));
  };

  const resolveActiveInput = (value: string | null) => {
    if (!activeInput) return;
    const handler = localInputHandlers.current.get(activeInput.requestId);
    localInputHandlers.current.delete(activeInput.requestId);
    handler?.(value);
    setPendingInputs((prev) => prev.filter((entry) => entry.requestId !== activeInput.requestId));
  };

  const renderPanel = (panelId: PanelId) => {
    const effectiveHost = selectedHost || hostUrl;
    switch (panelId) {
      case 'chat':
        return (
          <Chat
            selectedModel={selectedModel}
            hostUrl={effectiveHost}
            keepAlive={keepAlive}
            sessionId={currentSessionId}
            sessionTitle={sessions.find((s) => s.id === currentSessionId)?.title}
            onSessionUpdate={refreshSessions}
            effectiveSystemMessage={effectiveSystemMessage}
            autoInjectDateTime={autoInjectDateTime}
            researchTurnLimit={researchTurnLimit}
            onResearchTurnLimitHit={showToast}
          />
        );
      case 'wiki':
        return <Wiki />;
      case 'tasks':
        return <TaskBoard />;
      case 'viewer3d':
        return (
          <Viewer3D
            selectedModel={selectedModel}
            hostUrl={effectiveHost}
            keepAlive={keepAlive}
            sessionId={currentSessionId}
            sessionTitle={sessions.find((s) => s.id === currentSessionId)?.title}
            effectiveSystemMessage={effectiveSystemMessage}
            autoInjectDateTime={autoInjectDateTime}
            researchTurnLimit={researchTurnLimit}
            onResearchTurnLimitHit={showToast}
            onSessionUpdate={refreshSessions}
          />
        );
      case 'systemMessage':
        return (
          <section className="system-message-page">
            <div className="system-message-header">
              <h2>System Message</h2>
              <p>
                Set behavior instructions for the assistant. The current chat can use its own override,
                otherwise the global default is used.
              </p>
            </div>

            <div className="system-message-status">
              Active mode: {activeHasSystemMessageOverride ? 'Per-chat override' : 'Global default'}
            </div>

            <textarea
              className="system-message-editor"
              value={systemMessageDraft}
              onChange={(e) => setSystemMessageDraft(e.target.value)}
              placeholder="Write instructions for how the assistant should behave in this chat..."
              rows={10}
            />

            <div className="system-message-actions">
              <button className="primary" type="button" onClick={handleSaveSystemMessage}>Save</button>
              <button className="secondary-button" type="button" onClick={handleClearSystemMessage}>Clear</button>
              <button
                className={`system-message-toggle-link ${autoInjectDateTime ? 'active' : ''}`}
                type="button"
                onClick={() => setAutoInjectDateTime((prev) => !prev)}
              >
                Auto inject current date/time: {autoInjectDateTime ? 'On' : 'Off'}
              </button>
            </div>

            <div className="system-message-saved-list">
              <h3>Saved System Messages</h3>
              {savedSystemMessages.length === 0 ? (
                <p className="system-message-empty">No saved system messages yet.</p>
              ) : (
                <ul>
                  {savedSystemMessages.map((entry) => (
                    <li key={entry.id} className="system-message-saved-item">
                      <button
                        type="button"
                        className="system-message-select"
                        onClick={() => handleSelectSavedSystemMessage(entry.content)}
                        title={entry.content}
                      >
                        {entry.content.slice(0, 120)}
                      </button>
                      <button
                        type="button"
                        className="system-message-delete"
                        onClick={() => handleDeleteSavedSystemMessage(entry.id)}
                        aria-label="Delete saved system message"
                      >
                        Delete
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        );
      default:
        return (
          <Chat
            selectedModel={selectedModel}
            hostUrl={effectiveHost}
            keepAlive={keepAlive}
            sessionId={currentSessionId}
            sessionTitle={sessions.find((s) => s.id === currentSessionId)?.title}
            onSessionUpdate={refreshSessions}
            effectiveSystemMessage={effectiveSystemMessage}
            autoInjectDateTime={autoInjectDateTime}
            researchTurnLimit={researchTurnLimit}
            onResearchTurnLimitHit={showToast}
          />
        );
    }
  };

  return (
    <div className="app-container">
      <div className="titlebar-drag" />
      
      <aside className={`sidebar glass-panel${sidebarCollapsed ? ' collapsed' : ''}`}>
        <button
          type="button"
          className="sidebar-toggle"
          onClick={() => setSidebarCollapsed((v) => !v)}
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
        <div className="brand">
          <img src={logo} alt="Ollama +" className="app-logo" />
          <h2>Ollama +</h2>
          <span className={`status-badge ${status.includes('offline') ? 'offline' : 'online'}`}>
            {status}
          </span>
        </div>

        <nav className="nav-menu">
          {PANEL_CONFIG.map(({ id, label, Icon }) => (
            <button
              key={id}
              className={`nav-item ${activeLayout.primary === id ? 'active' : ''}`}
              onClick={() => setPrimaryPanel(id)}
            >
              <Icon size={18} />
              <span>{label}</span>
              {activeLayout.secondary === id && <Columns2 size={14} className="panel-secondary-icon" title="Open as secondary" />}
            </button>
          ))}
        </nav>

        <ModelSelector
          localHostUrl={hostUrl}
          localModels={models}
          selectedModel={selectedModel}
          selectedHost={selectedHost}
          status={status}
          onSelect={handleModelSelect}
          onRefreshLocal={fetchModels}
          lanPickerOpenSignal={lanPickerOpenSignal}
        />

        <section className="workspace-controls model-summary">
          <div className="workspace-controls-header">
            <span className="mcp-summary-title">
              <TerminalIcon size={14} />
              <span>Last Used LLM</span>
            </span>
          </div>
          <div className="mcp-summary-root">
            <MessageSquare size={14} />
            <span>{selectedModel || 'No model selected'}</span>
          </div>
          <div className="model-summary-host">
            <span className={`mcp-status-chip ${selectedModel ? 'ready' : 'unknown'}`}>
              {selectedModel ? (selectedHost === hostUrl ? 'Local' : 'Remote') : 'Unset'}
            </span>
            <span>{selectedModel ? shortHostLabel(selectedHost || hostUrl) : 'Choose a model from the dropdown'}</span>
          </div>
        </section>

        <section className="workspace-controls mcp-summary">
          <div className="workspace-controls-header">
            <span className="mcp-summary-title">
              <ShieldCheck size={14} />
              <span>MCP Servers</span>
            </span>
            <button type="button" className="mcp-summary-refresh" onClick={() => void refreshMcpStatus()}>
              <RefreshCcw size={14} /> Refresh
            </button>
          </div>
          <div className="mcp-summary-quick">
            <span className={`mcp-status-chip ${mcpStatus.folderCustom ? 'ready' : 'error'}`}>
              {mcpStatus.folderCustom ? 'Folder Set' : 'Set Folder'}
            </span>
            <span className={`mcp-status-chip ${mcpStatus.terminalSessionCount === null ? 'unknown' : 'ready'}`}>
              Terminal {mcpStatus.terminalSessionCount === null ? 'Unknown' : `${mcpStatus.terminalSessionCount} Active`}
            </span>
            <span className={`mcp-status-chip ${mcpStatus.pythonReady ? 'ready' : mcpStatus.pythonReady === false ? 'warn' : 'unknown'}`}>
              Python {mcpStatus.pythonReady ? 'Ready' : mcpStatus.pythonReady === false ? 'Unavailable' : 'Unknown'}
            </span>
            <span className={`mcp-status-chip ${mcpStatus.browserSessionCount === null ? 'unknown' : 'ready'}`}>
              Browser {mcpStatus.browserSessionCount === null ? 'Unknown' : `${mcpStatus.browserSessionCount} Active`}
            </span>
          </div>
          <div className="mcp-summary-root">
            <FileText size={14} />
            <span>{mcpStatus.folderRoot || 'No folder selected'}</span>
          </div>
        </section>

        {activeChatLayout && (
          <div className="sessions-list">
            <div className="sessions-header">
              <span>Recent Chats</span>
              <button onClick={createNewSession} className="new-chat-btn">+</button>
            </div>
            <div className="sessions-scroll">
              {sessions.map(s => (
                <div 
                  key={s.id} 
                  className={`session-item ${currentSessionId === s.id ? 'active' : ''}`}
                  onClick={() => setCurrentSessionId(s.id)}
                >
                  <MessageSquare size={14} />
                  {editingSessionId === s.id ? (
                    <input
                      aria-label="Rename chat session"
                      className="session-title-input"
                      value={editingTitle}
                      onChange={e => setEditingTitle(e.target.value)}
                      onBlur={() => handleRename(s.id, editingTitle)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleRename(s.id, editingTitle);
                        if (e.key === 'Escape') setEditingSessionId('');
                      }}
                      autoFocus
                      onClick={e => e.stopPropagation()}
                    />
                  ) : (
                    <span className="session-title" onClick={(e) => startEditing(e, s)}>{s.title}</span>
                  )}
                  <button className="delete-session-btn" onClick={(e) => deleteSession(e, s.id)}>×</button>
                </div>
              ))}
            </div>
          </div>
        )}
        
        <div className="spacer" />

        <div className="sidebar-lower-actions">
          <div className="system-message-launch">
            <button
              className={`nav-item ${activeLayout.primary === 'systemMessage' ? 'active' : ''}`}
              onClick={() => setPrimaryPanel('systemMessage')}
              title="Open system message page"
              aria-label="Open system message page"
            >
              <FileText size={18} /> Sys Message
            </button>
          </div>

          <div className="lan-scan-launch">
            <button
              className="nav-item"
              onClick={() => setLanPickerOpenSignal((v) => v + 1)}
              title="Open LAN model scanner"
              aria-label="Open LAN model scanner"
            >
              <Radar size={18} /> LAN Scan
            </button>
          </div>

          <div className="settings-btn">
            <button className="nav-item" onClick={() => setShowSettings(true)}>
              <Settings size={18} /> Settings
            </button>
          </div>
        </div>
      </aside>

      <main className="main-content">
        {!isElectronAvailable() && (
          <div className="non-electron-banner" role="alert">
            Running outside Electron — Ollama, terminals, wiki, and shell tools are disabled. Launch with <code>npm run electron:dev</code> (or <code>electron:debug</code>) for the full app.
          </div>
        )}
        <Suspense fallback={<div className="workspace-loading">Loading workspace…</div>}>
          <div className={`workspace-grid ${activeLayout.secondary ? 'split' : ''}`}>
            <section className="workspace-panel primary-panel">{renderPanel(activeLayout.primary)}</section>
            {activeLayout.secondary && (
              <section className="workspace-panel secondary-panel">{renderPanel(activeLayout.secondary)}</section>
            )}
          </div>
        </Suspense>

        {showSettings && (
          <div className="modal-overlay">
            <Suspense fallback={<div className="workspace-loading">Loading dialog…</div>}>
              <div className="modal-content glass-panel">
              <h3>Settings</h3>

              <section className="mcp-settings-section">
                <div className="mcp-settings-header">
                  <div>
                    <div className="mcp-settings-title">
                      <ShieldCheck size={16} />
                      <span>MCP Servers</span>
                    </div>
                    <p className="mcp-settings-subtitle">
                      Runtime status and controls for local MCP servers.
                    </p>
                  </div>
                  <button type="button" className="mcp-refresh-btn" onClick={() => void refreshMcpStatus()}>
                    <RefreshCcw size={14} /> Refresh
                  </button>
                </div>

                <div className="mcp-settings-grid">
                  <article className="mcp-card">
                    <div className="mcp-card-head">
                      <FileText size={16} />
                      <strong>Folder MCP</strong>
                      <span className={`mcp-status-chip ${mcpStatus.folderCustom ? 'ready' : 'error'}`}>{mcpStatus.folderCustom ? 'Folder Set' : 'Set Folder'}</span>
                    </div>
                    <p>Read/write access inside the selected root and its subfolders.</p>
                    <ul>
                      <li>list, read, write, create, delete, rename</li>
                      <li>traversal protection enabled</li>
                      <li>current root: {mcpStatus.folderRoot || 'not set'}</li>
                    </ul>
                    <div className="mcp-card-actions">
                      <button type="button" className="secondary-button" onClick={handleSelectMcpFolderRoot} disabled={!isElectronAvailable()}>Select Folder</button>
                      <button type="button" className="secondary-button" onClick={handleClearMcpFolderRoot} disabled={!isElectronAvailable()}>Clear</button>
                    </div>
                    {mcpActionError && <p className="mcp-action-error" role="alert">{mcpActionError}</p>}
                  </article>

                  <article className="mcp-card">
                    <div className="mcp-card-head">
                      <TerminalIcon size={16} />
                      <strong>Terminal MCP</strong>
                      <span className={`mcp-status-chip ${mcpStatus.terminalSessionCount === null ? 'unknown' : 'ready'}`}>{mcpStatus.terminalSessionCount === null ? 'Unknown' : 'Ready'}</span>
                    </div>
                    <p>Persistent shell sessions with policy checks.</p>
                    <p>session count: {mcpStatus.terminalSessionCount === null ? '...' : mcpStatus.terminalSessionCount}</p>
                  </article>

                  <article className="mcp-card">
                    <div className="mcp-card-head">
                      <TerminalIcon size={16} />
                      <strong>Python Terminal Session</strong>
                      <span className={`mcp-status-chip ${mcpStatus.pythonReady ? 'ready' : mcpStatus.pythonReady === false ? 'warn' : 'unknown'}`}>{mcpStatus.pythonReady ? 'Ready' : mcpStatus.pythonReady === false ? 'Unavailable' : 'Unknown'}</span>
                    </div>
                    <p>Persistent local Python session for scripts, modeling, and rendering.</p>
                    <p>{mcpStatus.pythonInterpreter}</p>
                    {mcpStatus.pythonVersion && <p>{mcpStatus.pythonVersion}</p>}
                    {mcpStatus.pythonSource && <p>Source: {mcpStatus.pythonSource}</p>}
                    {mcpStatus.pythonNote && <p>{mcpStatus.pythonNote}</p>}
                  </article>
                </div>
                <p className="mcp-settings-footnote">Last checked: {mcpStatus.lastCheckedAt || 'not yet checked'}</p>
              </section>
              
              <ThemeSelector value={theme} onChange={setTheme} />

              <div className="setting-group">
                <label>Ollama Host URL</label>
                <input 
                  type="text" 
                  value={hostUrl} 
                  onChange={(e) => setHostUrl(e.target.value)} 
                  placeholder="http://127.0.0.1:11434"
                />
              </div>

              <div className="setting-group setting-group-inline">
                <input 
                  type="checkbox" 
                  id="keepAliveToggle"
                  checked={keepAlive} 
                  onChange={(e) => setKeepAlive(e.target.checked)} 
                />
                <label htmlFor="keepAliveToggle" className="checkbox-label">Keep Model Loaded in Memory (Faster responses)</label>
              </div>

              <div className="setting-group setting-group-inline">
                <input
                  type="checkbox"
                  id="autoCollapseSidebarToggle"
                  checked={autoCollapseSidebar}
                  onChange={(e) => setAutoCollapseSidebar(e.target.checked)}
                />
                <label htmlFor="autoCollapseSidebarToggle" className="checkbox-label">Auto-collapse sidebar when switching panels</label>
              </div>

              <div className="setting-group">
                <label htmlFor="researchTurnLimitInput">Research turn limit</label>
                <input
                  id="researchTurnLimitInput"
                  type="number"
                  min="0"
                  step="1"
                  value={researchTurnLimit}
                  onChange={(e) => setResearchTurnLimit(Math.max(0, Number(e.target.value) || 0))}
                  aria-describedby="researchTurnLimitHelp"
                />
                <p id="researchTurnLimitHelp" className="setting-help-text">
                  0 = unlimited turns. When the limit is hit during research, the assistant stops and shows a toast.
                </p>
              </div>

              <div className="setting-group setting-group-spaced">
                <button 
                  className="nav-item" 
                  onClick={handleUnloadModels}
                  id="flush-vram-btn"
                >
                  Flush VRAM (Unload All Models)
                </button>
              </div>

              <div className="modal-actions">
                <button className="primary" onClick={() => setShowSettings(false)}>Close</button>
              </div>
              </div>
            </Suspense>
          </div>
        )}

        {activeDecision && (
          <div className="decision-overlay">
            <MarkdownDecisionForm request={activeDecision} onSelect={handleDecisionSelect} />
          </div>
        )}

        {!activeDecision && activeInput && (
          <div className="input-overlay">
            <MarkdownInputForm
              title={activeInput.title}
              markdown={activeInput.markdown}
              defaultValue={activeInput.defaultValue}
              placeholder={activeInput.placeholder}
              confirmLabel={activeInput.confirmLabel}
              cancelLabel={activeInput.cancelLabel}
              onSubmit={(value) => resolveActiveInput(value)}
              onCancel={() => resolveActiveInput(null)}
            />
          </div>
        )}

        {toast && (
          <div className={`app-toast ${toast.kind}`} role={toast.kind === 'error' ? 'alert' : 'status'} aria-live="polite">
            {toast.message}
          </div>
        )}
      </main>
    </div>
  );
}
