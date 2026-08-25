/**
 * AgentPage — Top-level page integrating all Agent client UI components.
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 *
 * Layout: ProgressHeader at top, ActivityStream in center, InspectorPanel as
 * collapsible right sidebar, AgentComposer at bottom.
 * Manages IPC streaming, user actions, and view switching.
 *
 * Requirements: 1.7, 5.1, 12.7, 13.2, 13.3, 13.5, 13.6
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { History, Play, Settings as SettingsIcon } from 'lucide-react';
import type {
  ActivityStreamEvent,
  AgentConfig,
  TaskSession,
  TaskSessionStatus,
} from '../../types/agent';
import { ActivityStream } from './ActivityStream';
import { AgentComposer } from './AgentComposer';
import { AgentSettings } from './AgentSettings';
import { ApprovalGateCard } from './ApprovalGateCard';
import { InspectorPanel } from './InspectorPanel';
import { ProgressHeader } from './ProgressHeader';
import { TaskControls } from './TaskControls';
import { TaskHistoryList } from './TaskHistoryList';
import { TaskReplayView } from './TaskReplayView';
import './AgentPage.css';

// ─── Types ───────────────────────────────────────────────────────────────────

type ViewMode = 'active' | 'history' | 'settings' | 'replay';

interface ApprovalGateState {
  gateId: string;
  action: string;
  tool: string;
  params: Record<string, unknown>;
  riskExplanation: string;
  status: 'pending' | 'approved' | 'denied';
}

// ─── Component ───────────────────────────────────────────────────────────────

export function AgentPage() {
  // ─── Core State ──────────────────────────────────────────────────────────
  const [viewMode, setViewMode] = useState<ViewMode>('active');
  const [session, setSession] = useState<TaskSession | null>(null);
  const [events, setEvents] = useState<ActivityStreamEvent[]>([]);
  const [isConnected, setIsConnected] = useState(true);
  const [lastEventAt, setLastEventAt] = useState<string | undefined>();
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [replaySessionId, setReplaySessionId] = useState<string | null>(null);

  // ─── Model/Config State ──────────────────────────────────────────────────
  const [modelId, setModelId] = useState<string | undefined>();
  const [endpoint, setEndpoint] = useState<string | undefined>();

  // ─── Approval Gate State ─────────────────────────────────────────────────
  const [pendingGates, setPendingGates] = useState<ApprovalGateState[]>([]);

  // ─── Resumed indicator ───────────────────────────────────────────────────
  const [showResumed, setShowResumed] = useState(false);
  const resumedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── Derived State ───────────────────────────────────────────────────────
  const sessionStatus: TaskSessionStatus = session?.status ?? 'planned';
  const isActive = sessionStatus === 'running' || sessionStatus === 'paused' || sessionStatus === 'waiting_approval';

  const completedStepIds = useMemo(() => {
    return events
      .filter((e) => e.type === 'step-completed')
      .map((e) => (e as { stepId: string }).stepId);
  }, [events]);

  const activeStepId = useMemo(() => {
    const startedEvents = events.filter((e) => e.type === 'step-started');
    if (startedEvents.length === 0) return undefined;
    const lastStarted = startedEvents[startedEvents.length - 1] as { stepId: string };
    // Only active if not yet completed
    if (completedStepIds.includes(lastStarted.stepId)) return undefined;
    return lastStarted.stepId;
  }, [events, completedStepIds]);

  const currentStepTitle = useMemo(() => {
    if (!activeStepId) return undefined;
    const stepEvent = events.find(
      (e) => e.type === 'step-started' && (e as { stepId: string }).stepId === activeStepId
    ) as { title: string } | undefined;
    return stepEvent?.title;
  }, [events, activeStepId]);

  const totalSteps = session?.plan?.steps.length ?? null;
  const completedSteps = completedStepIds.length;

  const pauseReason = useMemo((): 'approval' | 'error' | 'input' | undefined => {
    if (sessionStatus === 'waiting_approval') return 'approval';
    if (sessionStatus !== 'paused') return undefined;
    // Check last event for reason
    const lastPaused = [...events].reverse().find((e) => e.type === 'task-paused');
    if (!lastPaused) return undefined;
    const reason = (lastPaused as { reason: string }).reason.toLowerCase();
    if (reason.includes('error')) return 'error';
    if (reason.includes('input') || reason.includes('user')) return 'input';
    return undefined;
  }, [sessionStatus, events]);

  // ─── Load Model/Endpoint Config on Mount ─────────────────────────────────
  useEffect(() => {
    async function loadConfig() {
      if (!window.electronAPI) return;
      try {
        // Try agent config first for defaults
        const agentConfig: AgentConfig = await window.electronAPI.getAgentConfig();
        if (agentConfig) {
          // Agent config doesn't have model/endpoint, fall back to chat config
        }
      } catch {
        // Ignore, fall through to chat config
      }
      try {
        const chatConfig = await window.electronAPI.getRuntimeChatConfig();
        if (chatConfig) {
          setModelId(chatConfig.model || undefined);
          setEndpoint(chatConfig.endpoint || undefined);
        }
      } catch {
        // No config available
      }
    }
    void loadConfig();
  }, []);

  // ─── IPC Stream Subscription ─────────────────────────────────────────────
  useEffect(() => {
    if (!window.electronAPI) return;

    const unsubscribe = window.electronAPI.onAgentStream((event: ActivityStreamEvent) => {
      setIsConnected(true);
      setLastEventAt(event.timestamp);

      // Append event to stream
      setEvents((prev) => [...prev, event]);

      // Handle specific event types
      switch (event.type) {
        case 'task-complete':
          setSession((prev) =>
            prev ? { ...prev, status: 'completed', completedAt: event.timestamp } : prev
          );
          break;

        case 'task-paused':
          setSession((prev) => (prev ? { ...prev, status: 'paused' } : prev));
          break;

        case 'task-canceled':
          setSession((prev) => (prev ? { ...prev, status: 'canceled' } : prev));
          break;

        case 'approval-gate':
          setPendingGates((prev) => [
            ...prev,
            {
              gateId: event.gateId,
              action: event.action,
              tool: event.tool,
              params: event.params,
              riskExplanation: event.riskExplanation,
              status: 'pending',
            },
          ]);
          setSession((prev) => (prev ? { ...prev, status: 'waiting_approval' } : prev));
          break;

        case 'plan-generated':
          setSession((prev) => (prev ? { ...prev, plan: event.plan, status: 'running' } : prev));
          break;

        case 'connection-lost':
          setIsConnected(false);
          break;

        default:
          break;
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // ─── Connection heartbeat — detect lost connection ───────────────────────
  useEffect(() => {
    if (!isActive) return;

    const interval = setInterval(() => {
      if (lastEventAt) {
        const lastTime = new Date(lastEventAt).getTime();
        const elapsed = Date.now() - lastTime;
        // If no event received in 30 seconds during active task, mark disconnected
        if (elapsed > 30_000) {
          setIsConnected(false);
        }
      }
    }, 10_000);

    return () => clearInterval(interval);
  }, [isActive, lastEventAt]);

  // ─── Task Submission Handler ─────────────────────────────────────────────
  const handleTaskSubmitted = useCallback((newSession: TaskSession) => {
    setSession(newSession);
    setEvents([]);
    setPendingGates([]);
    setShowResumed(false);
    setViewMode('active');
    setIsConnected(true);
  }, []);

  // ─── Task Control Handlers ───────────────────────────────────────────────
  const handleStatusChange = useCallback((newStatus: string) => {
    setSession((prev) => {
      if (!prev) return prev;
      return { ...prev, status: newStatus as TaskSessionStatus };
    });

    // Show "Resumed" indicator when resuming (Requirement 13.5)
    if (newStatus === 'running' && sessionStatus === 'paused') {
      setShowResumed(true);
      // Clear the "Resumed" indicator after 3 seconds
      if (resumedTimerRef.current) clearTimeout(resumedTimerRef.current);
      resumedTimerRef.current = setTimeout(() => setShowResumed(false), 3000);
    }
  }, [sessionStatus]);

  // ─── Approval Gate Handlers ──────────────────────────────────────────────
  const handleGateApproved = useCallback((gateId: string) => {
    setPendingGates((prev) =>
      prev.map((g) => (g.gateId === gateId ? { ...g, status: 'approved' as const } : g))
    );
    setSession((prev) => (prev ? { ...prev, status: 'running' } : prev));
  }, []);

  const handleGateDenied = useCallback((gateId: string) => {
    setPendingGates((prev) =>
      prev.map((g) => (g.gateId === gateId ? { ...g, status: 'denied' as const } : g))
    );
    setSession((prev) => (prev ? { ...prev, status: 'running' } : prev));
  }, []);

  // ─── Corrective Feedback Handler (Requirement 13.6) ──────────────────────
  const handleFeedback = useCallback(
    async (stepId: string, feedback: string) => {
      if (!session || !window.electronAPI) return;
      try {
        await window.electronAPI.submitAgentFeedback(session.id, stepId, feedback);
      } catch {
        // Error will appear in the Activity Stream via events
      }
    },
    [session]
  );

  // ─── History Navigation ──────────────────────────────────────────────────
  const handleSelectHistorySession = useCallback((sessionId: string) => {
    setReplaySessionId(sessionId);
    setViewMode('replay');
  }, []);

  const handleBackFromReplay = useCallback(() => {
    setReplaySessionId(null);
    setViewMode('history');
  }, []);

  // ─── View Tab Handlers ───────────────────────────────────────────────────
  const handleViewActive = useCallback(() => setViewMode('active'), []);
  const handleViewHistory = useCallback(() => setViewMode('history'), []);
  const handleViewSettings = useCallback(() => setViewMode('settings'), []);

  // ─── Render ──────────────────────────────────────────────────────────────

  // Events + inline approval gate cards for the ActivityStream
  const enrichedEvents = useMemo(() => events, [events]);

  return (
    <div className="agent-page">
      {/* ─── Navigation Tabs ──────────────────────────────────────────── */}
      <nav className="agent-page__nav" role="tablist" aria-label="Agent views">
        <button
          className={`agent-page__nav-tab${viewMode === 'active' ? ' agent-page__nav-tab--active' : ''}`}
          onClick={handleViewActive}
          role="tab"
          aria-selected={viewMode === 'active'}
          aria-controls="agent-view-active"
          type="button"
        >
          <Play size={14} />
          <span>Active Task</span>
        </button>
        <button
          className={`agent-page__nav-tab${viewMode === 'history' || viewMode === 'replay' ? ' agent-page__nav-tab--active' : ''}`}
          onClick={handleViewHistory}
          role="tab"
          aria-selected={viewMode === 'history' || viewMode === 'replay'}
          aria-controls="agent-view-history"
          type="button"
        >
          <History size={14} />
          <span>History</span>
        </button>
        <button
          className={`agent-page__nav-tab${viewMode === 'settings' ? ' agent-page__nav-tab--active' : ''}`}
          onClick={handleViewSettings}
          role="tab"
          aria-selected={viewMode === 'settings'}
          aria-controls="agent-view-settings"
          type="button"
        >
          <SettingsIcon size={14} />
          <span>Settings</span>
        </button>
      </nav>

      {/* ─── Active Task View ─────────────────────────────────────────── */}
      {viewMode === 'active' && (
        <div className="agent-page__active" id="agent-view-active" role="tabpanel">
          {/* Header area: Progress + Controls */}
          <div className="agent-page__header">
            <ProgressHeader
              completedSteps={completedSteps}
              totalSteps={totalSteps}
              currentStepTitle={currentStepTitle}
              status={sessionStatus}
              pauseReason={pauseReason}
              startedAt={session?.startedAt ?? undefined}
              completedAt={session?.completedAt ?? undefined}
              totalDuration={session?.totalDuration ?? undefined}
              artifactCount={session?.artifacts.length}
            />
            {session && (
              <TaskControls
                sessionId={session.id}
                status={sessionStatus}
                onStatusChange={handleStatusChange}
              />
            )}
            {/* Resumed indicator (Requirement 13.5) */}
            {showResumed && (
              <div className="agent-page__resumed-indicator" role="status" aria-live="polite">
                <Play size={12} />
                <span>Resumed</span>
              </div>
            )}
          </div>

          {/* Main area: ActivityStream + InspectorPanel */}
          <div className="agent-page__main">
            <div className="agent-page__stream-area">
              <ActivityStream
                events={enrichedEvents}
                isConnected={isConnected}
                lastEventAt={lastEventAt}
              />

              {/* Inline Approval Gate Cards */}
              {pendingGates
                .filter((g) => g.status === 'pending')
                .map((gate) => (
                  <ApprovalGateCard
                    key={gate.gateId}
                    gateId={gate.gateId}
                    sessionId={session?.id ?? ''}
                    action={gate.action}
                    tool={gate.tool}
                    params={gate.params}
                    riskExplanation={gate.riskExplanation}
                    status={gate.status}
                    onApproved={() => handleGateApproved(gate.gateId)}
                    onDenied={() => handleGateDenied(gate.gateId)}
                  />
                ))}
            </div>

            <InspectorPanel
              plan={session?.plan ?? undefined}
              activeStepId={activeStepId}
              completedStepIds={completedStepIds}
              artifacts={session?.artifacts}
              collapsed={inspectorCollapsed}
              onToggleCollapse={() => setInspectorCollapsed((prev) => !prev)}
            />
          </div>

          {/* Footer area: AgentComposer */}
          <div className="agent-page__footer">
            <AgentComposer
              modelId={modelId}
              endpoint={endpoint}
              isActive={isActive}
              activeSessionId={session?.id}
              onTaskSubmitted={handleTaskSubmitted}
            />
          </div>
        </div>
      )}

      {/* ─── History View ─────────────────────────────────────────────── */}
      {viewMode === 'history' && (
        <div className="agent-page__history" id="agent-view-history" role="tabpanel">
          <TaskHistoryList onSelectSession={handleSelectHistorySession} />
        </div>
      )}

      {/* ─── Replay View ──────────────────────────────────────────────── */}
      {viewMode === 'replay' && replaySessionId && (
        <div className="agent-page__replay" id="agent-view-history" role="tabpanel">
          <TaskReplayView sessionId={replaySessionId} onBack={handleBackFromReplay} />
        </div>
      )}

      {/* ─── Settings View ────────────────────────────────────────────── */}
      {viewMode === 'settings' && (
        <div className="agent-page__settings" id="agent-view-settings" role="tabpanel">
          <AgentSettings />
        </div>
      )}
    </div>
  );
}
