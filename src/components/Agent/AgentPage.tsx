/**
 * AgentPage — Conversational chat interface with inline agentic capabilities.
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 *
 * Layout: Three-tab navigation (Active, History, Settings) with pill-shaped tabs.
 * Active tab: AgentChatStream + InspectorPanel (collapsible) + AgentComposer.
 * History tab: session list with title, status, timestamp, message count, duration.
 * Settings tab: AgentSettings configuration panel.
 *
 * Glassmorphism theme: border-radius 18px, backdrop-filter blur(16px), gradient borders.
 * Responsive: icons-only tabs below 640px, inspector hidden below 768px.
 *
 * Requirements: 1.1, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 9.1, 9.4, 9.5, 10.1, 10.2, 10.3, 12.1
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Clock,
  History,
  MessageSquare,
  Settings as SettingsIcon,
} from 'lucide-react';
import type { AgentSessionSummary } from '../../types/agentChat';
import { useAgentChat } from '../../hooks/useAgentChat';
import { useSessionStorage } from '../../hooks/useSessionStorage';
import { AgentChatStream } from './AgentChatStream';
import { AgentComposer } from './AgentComposer';
import { AgentSettings } from './AgentSettings';
import { InspectorPanel } from './InspectorPanel';
import './AgentPage.css';

// ─── Types ───────────────────────────────────────────────────────────────────

type TabId = 'active' | 'history' | 'settings';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Formats a relative timestamp from an ISO string.
 */
function formatRelativeTime(isoDate: string): string {
  const date = new Date(isoDate);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffDay > 0) return `${diffDay}d ago`;
  if (diffHr > 0) return `${diffHr}h ago`;
  if (diffMin > 0) return `${diffMin}m ago`;
  return 'Just now';
}

/**
 * Formats duration in seconds to a readable string.
 */
function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds === 0) return '—';
  if (seconds < 60) return `${seconds}s`;
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  return sec > 0 ? `${min}m ${sec}s` : `${min}m`;
}

/**
 * Returns a CSS class suffix for a session status badge.
 */
function statusBadgeClass(status: string): string {
  switch (status) {
    case 'active':
      return 'agent-page__status-badge--active';
    case 'completed':
      return 'agent-page__status-badge--completed';
    case 'failed':
      return 'agent-page__status-badge--failed';
    default:
      return 'agent-page__status-badge--idle';
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export function AgentPage() {
  // ─── Tab State ───────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<TabId>('active');
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);

  // ─── Model/Config State ──────────────────────────────────────────────────
  const [modelId, setModelId] = useState<string | undefined>();
  const [endpoint, setEndpoint] = useState<string | undefined>();

  // ─── Load Model/Endpoint Config on Mount ─────────────────────────────────
  useEffect(() => {
    async function loadConfig() {
      if (!window.electronAPI?.getRuntimeChatConfig) return;
      try {
        const chatConfig = await window.electronAPI.getRuntimeChatConfig();
        if (chatConfig) {
          setModelId(chatConfig.model || undefined);
          setEndpoint(chatConfig.endpoint || undefined);
        }
      } catch {
        // No config available — composer will show disabled state
      }
    }
    void loadConfig();
  }, []);

  // ─── Primary Chat Hook ───────────────────────────────────────────────────
  const agentChat = useAgentChat({
    model: modelId ?? '',
    endpoint: endpoint ?? '',
  });

  // ─── Session Storage Hook (for History tab) ──────────────────────────────
  const sessionStorage = useSessionStorage();

  // ─── Restore last active session on mount (Req 5.6) ──────────────────────
  useEffect(() => {
    async function restoreSession() {
      const lastSession = await sessionStorage.getLastActiveSession();
      if (lastSession) {
        await agentChat.loadSession(lastSession.id);
      }
    }
    void restoreSession();
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Actions ─────────────────────────────────────────────────────────────

  const handleSendMessage = useCallback(
    (content: string, attachments: import('../../types/agentChat').AttachmentFile[]) => {
      agentChat.sendMessage(content, attachments);
    },
    [agentChat]
  );

  const handleStopGeneration = useCallback(() => {
    agentChat.stopGeneration();
  }, [agentChat]);

  const handleApproveGate = useCallback(
    (gateId: string) => {
      agentChat.approveGate(gateId);
    },
    [agentChat]
  );

  const handleDenyGate = useCallback(
    (gateId: string) => {
      agentChat.denyGate(gateId);
    },
    [agentChat]
  );

  const handleRetry = useCallback(() => {
    agentChat.retryLastMessage();
  }, [agentChat]);

  const handleScrollToBlock = useCallback((_blockId: string) => {
    // Scroll-to-block is handled by the AgentChatStream internally
    // This callback can be extended for inspector→stream synchronization
  }, []);

  const handleStepClick = useCallback((_stepId: string) => {
    // Inspector step click → scroll chat to corresponding block
    // Implementation deferred to integration pass
  }, []);

  // ─── Session Resume (History → Active) ───────────────────────────────────
  const handleSelectSession = useCallback(
    async (sessionId: string) => {
      await agentChat.loadSession(sessionId);
      setActiveTab('active');
    },
    [agentChat]
  );

  // ─── New Session ─────────────────────────────────────────────────────────
  const handleNewSession = useCallback(() => {
    agentChat.startNewSession();
  }, [agentChat]);

  // ─── Inspector derived data ──────────────────────────────────────────────
  const plan = agentChat.session?.plan ?? null;
  const artifacts = agentChat.session?.artifacts ?? [];
  const memoryRecords = agentChat.session?.memoryRecords ?? [];

  const completedStepIds = useMemo(() => {
    if (!plan) return [];
    return plan.steps
      .filter((s: { status: string }) => s.status === 'completed')
      .map((s: { id: string }) => s.id);
  }, [plan]);

  const activeStepId = useMemo(() => {
    if (!plan) return undefined;
    const active = plan.steps.find((s: { status: string }) => s.status === 'active');
    return active?.id;
  }, [plan]);

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="agent-page">
      {/* ─── Navigation Tabs ──────────────────────────────────────────── */}
      <nav className="agent-page__tabs" role="tablist" aria-label="Agent views">
        <button
          className={`agent-page__tab${activeTab === 'active' ? ' agent-page__tab--active' : ''}`}
          onClick={() => setActiveTab('active')}
          role="tab"
          aria-selected={activeTab === 'active'}
          aria-controls="agent-panel-active"
          type="button"
        >
          <MessageSquare size={14} aria-hidden="true" />
          <span className="agent-page__tab-label">Active</span>
        </button>
        <button
          className={`agent-page__tab${activeTab === 'history' ? ' agent-page__tab--active' : ''}`}
          onClick={() => setActiveTab('history')}
          role="tab"
          aria-selected={activeTab === 'history'}
          aria-controls="agent-panel-history"
          type="button"
        >
          <History size={14} aria-hidden="true" />
          <span className="agent-page__tab-label">History</span>
        </button>
        <button
          className={`agent-page__tab${activeTab === 'settings' ? ' agent-page__tab--active' : ''}`}
          onClick={() => setActiveTab('settings')}
          role="tab"
          aria-selected={activeTab === 'settings'}
          aria-controls="agent-panel-settings"
          type="button"
        >
          <SettingsIcon size={14} aria-hidden="true" />
          <span className="agent-page__tab-label">Settings</span>
        </button>

        {/* New Session button */}
        {activeTab === 'active' && (
          <button
            className="agent-page__new-session-btn"
            onClick={handleNewSession}
            title="Start new session"
            type="button"
          >
            + New
          </button>
        )}
      </nav>

      {/* ─── Active Tab ───────────────────────────────────────────────── */}
      {activeTab === 'active' && (
        <div className="agent-page__body" id="agent-panel-active" role="tabpanel">
          <div className="agent-page__chat-area">
            <AgentChatStream
              messages={agentChat.messages}
              streamingMessage={agentChat.streamingMessage}
              toolBlocks={agentChat.toolBlocks}
              reasoningBlocks={agentChat.reasoningBlocks}
              approvalGates={agentChat.approvalGates}
              completionSummary={agentChat.completionSummary}
              isConnected={agentChat.isConnected}
              onScrollToBlock={handleScrollToBlock}
              onApprove={handleApproveGate}
              onDeny={handleDenyGate}
              onRetry={handleRetry}
              onStop={handleStopGeneration}
            />

            <AgentComposer
              modelId={modelId}
              endpoint={endpoint}
              isConnected={agentChat.isConnected}
              isStreaming={agentChat.isStreaming}
              isPendingApproval={agentChat.isPendingApproval}
              onSend={handleSendMessage}
              onStop={handleStopGeneration}
            />
          </div>

          <InspectorPanel
            plan={plan}
            activeStepId={activeStepId}
            completedStepIds={completedStepIds}
            artifacts={artifacts.map((a) => ({
              id: a.id,
              name: a.name,
              path: a.path,
              type: a.type,
            }))}
            memoryRecords={memoryRecords.map((m) => ({
              id: m.id,
              key: m.key,
              value: m.value,
            }))}
            collapsed={inspectorCollapsed}
            onToggleCollapse={() => setInspectorCollapsed((prev) => !prev)}
            onStepClick={handleStepClick}
          />
        </div>
      )}

      {/* ─── History Tab ──────────────────────────────────────────────── */}
      {activeTab === 'history' && (
        <div className="agent-page__history" id="agent-panel-history" role="tabpanel">
          <div className="agent-page__history-header">
            <h2 className="agent-page__history-title">Session History</h2>
          </div>

          {sessionStorage.sessions.length === 0 ? (
            <div className="agent-page__history-empty">
              <History size={32} aria-hidden="true" />
              <p>No past sessions yet. Start a conversation on the Active tab.</p>
            </div>
          ) : (
            <ul className="agent-page__session-list" role="list">
              {sessionStorage.sessions.map((session: AgentSessionSummary) => (
                <li key={session.id} className="agent-page__session-item">
                  <button
                    className="agent-page__session-btn"
                    onClick={() => handleSelectSession(session.id)}
                    type="button"
                    aria-label={`Load session: ${session.title}`}
                  >
                    <div className="agent-page__session-info">
                      <span className="agent-page__session-title">{session.title}</span>
                      <span
                        className={`agent-page__status-badge ${statusBadgeClass(session.status)}`}
                      >
                        {session.status}
                      </span>
                    </div>
                    <div className="agent-page__session-meta">
                      <span className="agent-page__session-time">
                        <Clock size={12} aria-hidden="true" />
                        {formatRelativeTime(session.createdAt)}
                      </span>
                      <span className="agent-page__session-messages">
                        <MessageSquare size={12} aria-hidden="true" />
                        {session.messageCount} messages
                      </span>
                      <span className="agent-page__session-duration">
                        {formatDuration(session.totalDuration)}
                      </span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* ─── Settings Tab ─────────────────────────────────────────────── */}
      {activeTab === 'settings' && (
        <div className="agent-page__settings" id="agent-panel-settings" role="tabpanel">
          <AgentSettings />
        </div>
      )}
    </div>
  );
}
