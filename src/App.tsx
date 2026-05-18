import React, { useRef, useState, useEffect } from 'react';
import { Settings, MessageSquare, Terminal as TerminalIcon, Book, RefreshCw, ListTodo, Box, LayoutPanelLeft, Columns2, X } from 'lucide-react';
import Chat from './components/Chat';
import TerminalView from './components/TerminalView';
import Wiki from './components/Wiki';
import TaskBoard from './components/TaskBoard';
import Viewer3D from './components/Viewer3D';
import MarkdownDecisionForm from './components/MarkdownDecisionForm';
import MarkdownInputForm from './components/MarkdownInputForm';
import { ipcService } from './services/ipcService';
import logo from './assets/logo.png';
import './App.css';

const PANEL_IDS = ['chat', 'terminal', 'wiki', 'tasks', 'viewer3d'] as const;

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

const DEFAULT_LAYOUTS: WorkspaceLayout[] = [
  { id: 'layout-chat', name: 'Chat Focus', primary: 'chat' },
  { id: 'layout-agent', name: 'Agent + Tasks', primary: 'chat', secondary: 'tasks' },
  { id: 'layout-research', name: 'Research', primary: 'wiki', secondary: 'terminal' },
  { id: 'layout-3d', name: '3D Studio', primary: 'viewer3d', secondary: 'chat' }
];

const PANEL_CONFIG: PanelConfig[] = [
  { id: 'chat', label: 'Chat', Icon: MessageSquare },
  { id: 'terminal', label: 'Terminals', Icon: TerminalIcon },
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

export default function App() {
  const [models, setModels] = useState<ModelTag[]>([]);
  const [selectedModel, setSelectedModel] = useState('');
  const [status, setStatus] = useState('Checking Ollama...');

  const [showSettings, setShowSettings] = useState(false);
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'dark');
  const [hostUrl, setHostUrl] = useState(localStorage.getItem('hostUrl') || 'http://127.0.0.1:11434');
  const [keepAlive, setKeepAlive] = useState(localStorage.getItem('keepAlive') === 'true');

  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState(localStorage.getItem('currentSessionId') || '');
  const [editingSessionId, setEditingSessionId] = useState('');
  const [editingTitle, setEditingTitle] = useState('');
  const [layouts, setLayouts] = useState<WorkspaceLayout[]>(() => loadLayouts());
  const [activeLayoutId, setActiveLayoutId] = useState(localStorage.getItem('activeLayoutId') || 'layout-chat');
  const [pendingDecisions, setPendingDecisions] = useState<PendingDecision[]>([]);
  const [pendingInputs, setPendingInputs] = useState<PendingInput[]>([]);
  const localDecisionHandlers = useRef(new Map<string, (selectionId: string) => void>());
  const localInputHandlers = useRef(new Map<string, (value: string | null) => void>());

  const activeLayout = layouts.find((layout) => layout.id === activeLayoutId) || layouts[0] || DEFAULT_LAYOUTS[0];
  const activeChatLayout = activeLayout.primary === 'chat' || activeLayout.secondary === 'chat';

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('workspaceLayouts', JSON.stringify(layouts));
  }, [layouts]);

  useEffect(() => {
    if (!activeLayoutId && layouts.length > 0) {
      setActiveLayoutId(layouts[0].id);
      return;
    }

    if (!layouts.find((layout) => layout.id === activeLayoutId)) {
      setActiveLayoutId(layouts[0]?.id || DEFAULT_LAYOUTS[0].id);
    }
  }, [layouts, activeLayoutId]);

  useEffect(() => {
    localStorage.setItem('activeLayoutId', activeLayoutId);
  }, [activeLayoutId]);

  useEffect(() => {
    localStorage.setItem('hostUrl', hostUrl);
    localStorage.setItem('keepAlive', keepAlive.toString());
    fetchModels();
    refreshSessions();
  }, [hostUrl, keepAlive]);

  useEffect(() => {
    localStorage.setItem('currentSessionId', currentSessionId);
  }, [currentSessionId]);

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

  const refreshSessions = async () => {
    try {
      const chatList = await ipcService.listChats();
      setSessions(chatList);
      if (chatList.length > 0 && !currentSessionId) {
        setCurrentSessionId(chatList[0].id);
      } else if (chatList.length === 0 && !currentSessionId) {
        createNewSession();
      }
    } catch (error) {
      console.error('Failed to refresh sessions:', error);
    }
  };

  const createNewSession = () => {
    const newId = Math.random().toString(36).substring(7);
    setCurrentSessionId(newId);
    setSessions(prev => [{ id: newId, title: 'New Chat', updatedAt: new Date().toISOString() }, ...prev]);
  };

  const deleteSession = async (e, id) => {
    e.stopPropagation();
    try {
      await ipcService.deleteChat(id);
      const updated = sessions.filter(s => s.id !== id);
      setSessions(updated);
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

  const fetchModels = async () => {
    setStatus('Loading models...');
    try {
      const res = await ipcService.invokeOllama(hostUrl, '/api/tags');
      const m = res.models || [];
      setModels(m);
      
      if (m.length > 0) {
        // If no model is selected, or the currently selected model is no longer in the list, select the first one
        if (!selectedModel || !m.find((model: ModelTag) => model.name === selectedModel)) {
          setSelectedModel(m[0].name);
        }
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
  };

  const setSecondaryPanel = (panelId?: PanelId) => {
    updateActiveLayout((layout) => ({
      ...layout,
      secondary: panelId && panelId !== layout.primary ? panelId : undefined
    }));
  };

  const saveCurrentLayout = () => {
    const requestId = `local-layout-name-${Math.random().toString(36).slice(2, 10)}`;
    localInputHandlers.current.set(requestId, (value) => {
      const name = (value || '').trim();
      if (!name) return;

      const id = `layout-${Math.random().toString(36).slice(2, 10)}`;
      const layout: WorkspaceLayout = {
        id,
        name,
        primary: activeLayout.primary,
        secondary: activeLayout.secondary
      };

      setLayouts((prev) => [layout, ...prev]);
      setActiveLayoutId(id);
    });

    setPendingInputs((prev) => [
      ...prev,
      {
        requestId,
        title: 'Save Workspace Preset',
        markdown: '### Name your layout preset\n\nProvide a clear, short name so it is easy to reuse later.',
        defaultValue: `Preset ${layouts.length + 1}`,
        placeholder: 'Enter preset name',
        confirmLabel: 'Save Preset',
        cancelLabel: 'Cancel',
        createdAt: new Date().toISOString()
      }
    ]);
  };

  const deleteCurrentLayout = () => {
    if (layouts.length <= 1) return;
    const requestId = `local-delete-layout-${Math.random().toString(36).slice(2, 10)}`;
    localDecisionHandlers.current.set(requestId, (selectionId) => {
      if (selectionId !== 'delete') return;
      const updated = layouts.filter((layout) => layout.id !== activeLayout.id);
      setLayouts(updated);
      setActiveLayoutId(updated[0].id);
    });

    setPendingDecisions((prev) => [
      ...prev,
      {
        requestId,
        source: 'local',
        title: 'Delete Workspace Preset',
        markdown: `### Confirm preset deletion\n\nYou are about to delete this preset:\n\n- **${activeLayout.name}**\n\nThis action cannot be undone.`,
        options: [
          { id: 'cancel', label: 'Cancel', description: 'Keep this preset.', recommended: true },
          { id: 'delete', label: 'Delete Preset', description: 'Remove this preset permanently.' }
        ],
        createdAt: new Date().toISOString()
      }
    ]);
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
    switch (panelId) {
      case 'chat':
        return (
          <Chat
            selectedModel={selectedModel}
            hostUrl={hostUrl}
            keepAlive={keepAlive}
            sessionId={currentSessionId}
            sessionTitle={sessions.find((s) => s.id === currentSessionId)?.title}
            onSessionUpdate={refreshSessions}
          />
        );
      case 'terminal':
        return <TerminalView />;
      case 'wiki':
        return <Wiki />;
      case 'tasks':
        return <TaskBoard />;
      case 'viewer3d':
        return <Viewer3D />;
      default:
        return <Chat selectedModel={selectedModel} hostUrl={hostUrl} keepAlive={keepAlive} sessionId={currentSessionId} sessionTitle={sessions.find((s) => s.id === currentSessionId)?.title} onSessionUpdate={refreshSessions} />;
    }
  };

  return (
    <div className="app-container">
      <div className="titlebar-drag" />
      
      <aside className="sidebar glass-panel">
        <div className="brand">
          <img src={logo} alt="Ollama +" className="app-logo" />
          <h2>Ollama +</h2>
          <span className={`status-badge ${status.includes('offline') ? 'offline' : 'online'}`}>
            {status}
          </span>
        </div>

        <div className="model-selector">
          <label>Model</label>
          <div className="model-select-row">
            <select aria-label="Select model" value={selectedModel} onChange={e => setSelectedModel(e.target.value)}>
              {models.map((m) => (
                <option key={m.name} value={m.name}>{m.name}</option>
              ))}
              {models.length === 0 && <option value="">No models</option>}
            </select>
            <button className="icon-only-btn" onClick={fetchModels} title="Refresh Models" aria-label="Refresh models">
              <RefreshCw size={16} />
            </button>
          </div>
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

        <div className="workspace-controls">
          <div className="workspace-controls-header">
            <LayoutPanelLeft size={14} />
            <span>Workspace</span>
          </div>
          <select aria-label="Select workspace preset" value={activeLayout.id} onChange={(e) => setActiveLayoutId(e.target.value)}>
            {layouts.map((layout) => (
              <option key={layout.id} value={layout.id}>{layout.name}</option>
            ))}
          </select>
          <select
            aria-label="Select secondary panel"
            value={activeLayout.secondary || ''}
            onChange={(e) => setSecondaryPanel((e.target.value || undefined) as PanelId | undefined)}
          >
            <option value="">No secondary panel</option>
            {PANEL_CONFIG.filter((panel) => panel.id !== activeLayout.primary).map((panel) => (
              <option key={panel.id} value={panel.id}>{panel.label}</option>
            ))}
          </select>
          <div className="workspace-controls-actions">
            <button onClick={saveCurrentLayout}>Save Preset</button>
            <button onClick={deleteCurrentLayout} disabled={layouts.length <= 1} aria-label="Delete current workspace preset" title="Delete preset">
              <X size={14} />
            </button>
          </div>
        </div>

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
        
        <div className="settings-btn">
          <button className="nav-item" onClick={() => setShowSettings(true)}>
            <Settings size={18} /> Settings
          </button>
        </div>
      </aside>

      <main className="main-content">
        <div className={`workspace-grid ${activeLayout.secondary ? 'split' : ''}`}>
          <section className="workspace-panel primary-panel">{renderPanel(activeLayout.primary)}</section>
          {activeLayout.secondary && (
            <section className="workspace-panel secondary-panel">{renderPanel(activeLayout.secondary)}</section>
          )}
        </div>

        {showSettings && (
          <div className="modal-overlay">
            <div className="modal-content glass-panel">
              <h3>Settings</h3>
              
              <div className="setting-group">
                <label>Theme</label>
                <select aria-label="Select theme" value={theme} onChange={(e) => setTheme(e.target.value)}>
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                  <option value="colorblind">Color Blind (High Contrast)</option>
                  <option value="solarized">Solarized Dark</option>
                </select>
              </div>

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

              <div className="setting-group setting-group-spaced">
                <button 
                  className="nav-item" 
                  onClick={handleUnloadModels}
                  id="flush-vram-btn"
                >
                  🧹 Flush VRAM (Unload All Models)
                </button>
              </div>

              <div className="modal-actions">
                <button className="primary" onClick={() => setShowSettings(false)}>Close</button>
              </div>
            </div>
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
      </main>
    </div>
  );
}
