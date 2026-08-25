/**
 * TaskReplayView Component
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 *
 * Renders the full Activity Stream as a read-only replay for a past Task Session.
 * Includes a summary card with duration, artifact count, step count, and final status.
 * Supports re-running a task and navigating back to history.
 *
 * Requirements: 9.3, 9.5, 9.6
 */
import { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  FileText,
  Layers,
  Loader,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import type {
  ActivityStreamEvent,
  Artifact,
  TaskSession,
  TaskSessionStatus,
} from '../../types/agent';
import { ActivityStream } from './ActivityStream';
import './TaskReplayView.css';

// ─── Props ───────────────────────────────────────────────────────────────────

export interface TaskReplayViewProps {
  /** The session ID to replay */
  sessionId: string;
  /** Callback to navigate back to history list */
  onBack: () => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDuration(ms: number | null): string {
  if (ms === null || ms === 0) return '--';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return '--';
  try {
    const date = new Date(iso);
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '--';
  }
}

const STATUS_LABELS: Record<TaskSessionStatus, string> = {
  planned: 'Planned',
  running: 'Running',
  paused: 'Paused',
  waiting_approval: 'Awaiting Approval',
  completed: 'Completed',
  failed: 'Failed',
  canceled: 'Canceled',
};

/**
 * Reconstruct ActivityStreamEvents from a completed TaskSession's data.
 * This allows rendering past sessions using the existing ActivityStream component.
 */
function reconstructEvents(session: TaskSession): ActivityStreamEvent[] {
  const events: ActivityStreamEvent[] = [];

  // Plan generation event
  if (session.plan) {
    events.push({
      type: 'plan-generated',
      plan: session.plan,
      timestamp: session.startedAt || session.createdAt,
    });
  }

  // Step results → step-started + tool-call + tool-result + step-completed events
  for (const result of session.stepResults) {
    events.push({
      type: 'step-started',
      stepId: result.stepId,
      title: result.title,
      timestamp: result.startedAt,
    });

    // Tool calls within the step
    for (const toolCall of result.toolCalls) {
      events.push({
        type: 'tool-call',
        stepId: result.stepId,
        tool: toolCall.tool,
        params: toolCall.params,
        timestamp: toolCall.startedAt,
      });

      events.push({
        type: 'tool-result',
        stepId: result.stepId,
        tool: toolCall.tool,
        output: toolCall.output,
        duration: toolCall.duration,
        timestamp: toolCall.completedAt,
      });
    }

    // Step completion
    const outcome = result.status === 'completed'
      ? { type: 'proceed' as const, output: result.output }
      : result.status === 'failed'
        ? { type: 'replan' as const, reason: result.error || 'Step failed', output: result.output }
        : { type: 'proceed' as const, output: result.output };

    events.push({
      type: 'step-completed',
      stepId: result.stepId,
      outcome,
      duration: result.duration,
      timestamp: result.completedAt,
    });
  }

  // Task completion event
  if (session.status === 'completed') {
    events.push({
      type: 'task-complete',
      summary: {
        sessionId: session.id,
        instruction: session.instruction,
        status: session.status,
        stepsCompleted: session.stepResults.filter(r => r.status === 'completed').length,
        stepsTotal: session.plan?.steps.length ?? session.stepResults.length,
        artifactCount: session.artifacts.length,
        totalDuration: session.totalDuration ?? 0,
        completedAt: session.completedAt || session.updatedAt,
      },
      timestamp: session.completedAt || session.updatedAt,
    });
  } else if (session.status === 'canceled') {
    events.push({
      type: 'task-canceled',
      timestamp: session.updatedAt,
    });
  } else if (session.status === 'failed') {
    const lastResult = session.stepResults[session.stepResults.length - 1];
    if (lastResult?.error) {
      events.push({
        type: 'error',
        stepId: lastResult.stepId,
        error: {
          type: 'execution_failure',
          message: lastResult.error,
          stepId: lastResult.stepId,
          attemptCount: lastResult.retryCount,
          classification: 'permanent',
        },
        timestamp: lastResult.completedAt,
      });
    }
  }

  return events;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function TaskReplayView({ sessionId, onBack }: TaskReplayViewProps) {
  const [session, setSession] = useState<TaskSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rerunning, setRerunning] = useState(false);
  const [rerunError, setRerunError] = useState<string | null>(null);

  const fetchSession = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.electronAPI!.getAgentSession(sessionId);
      if (!result) {
        setError('Session not found');
      } else {
        setSession(result);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load session');
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    void fetchSession();
  }, [fetchSession]);

  const handleRerun = useCallback(async () => {
    if (!session) return;
    setRerunning(true);
    setRerunError(null);
    try {
      const result = await window.electronAPI!.rerunAgentTask(sessionId);
      if (result.success) {
        // Navigate to the new session (or just go back — the parent can decide)
        onBack();
      } else {
        const errorMsg = result.error || result.errors?.join(', ') || 'Re-run failed';
        setRerunError(errorMsg);
      }
    } catch (err) {
      setRerunError(err instanceof Error ? err.message : 'Re-run failed');
    } finally {
      setRerunning(false);
    }
  }, [session, sessionId, onBack]);

  // ─── Loading State ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="task-replay" role="status" aria-label="Loading session replay">
        <div className="task-replay__loading">
          <Loader size={20} className="task-replay__spinner" />
          <span>Loading session...</span>
        </div>
      </div>
    );
  }

  // ─── Error State ───────────────────────────────────────────────────────────

  if (error || !session) {
    return (
      <div className="task-replay" role="alert">
        <div className="task-replay__error">
          <XCircle size={18} />
          <span>{error || 'Session not found'}</span>
          <button className="task-replay__back-btn" onClick={onBack} type="button">
            <ArrowLeft size={14} />
            Back to History
          </button>
        </div>
      </div>
    );
  }

  // ─── Reconstruct events from session data ──────────────────────────────────

  const events = reconstructEvents(session);
  const stepsCompleted = session.stepResults.filter(r => r.status === 'completed').length;
  const stepsTotal = session.plan?.steps.length ?? session.stepResults.length;

  return (
    <div className="task-replay">
      {/* Header with navigation and title */}
      <div className="task-replay__header">
        <button className="task-replay__back-btn" onClick={onBack} type="button">
          <ArrowLeft size={14} />
          Back to History
        </button>
        <div className="task-replay__header-info">
          <span className="task-replay__header-status">
            {STATUS_LABELS[session.status]}
          </span>
          <span className="task-replay__header-date">
            {formatTimestamp(session.createdAt)}
          </span>
        </div>
      </div>

      {/* Session instruction */}
      <div className="task-replay__instruction">
        {session.instruction}
      </div>

      {/* Activity stream replay */}
      <div className="task-replay__stream">
        <ActivityStream events={events} isConnected={true} />
      </div>

      {/* Summary card */}
      <div className="task-replay__summary">
        <div className="task-replay__summary-header">
          <CheckCircle2 size={16} />
          <span>Session Summary</span>
        </div>
        <div className="task-replay__summary-grid">
          <div className="task-replay__summary-item">
            <Layers size={14} />
            <span className="task-replay__summary-label">Steps</span>
            <span className="task-replay__summary-value">
              {stepsCompleted} / {stepsTotal}
            </span>
          </div>
          <div className="task-replay__summary-item">
            <FileText size={14} />
            <span className="task-replay__summary-label">Artifacts</span>
            <span className="task-replay__summary-value">
              {session.artifacts.length}
            </span>
          </div>
          <div className="task-replay__summary-item">
            <Clock size={14} />
            <span className="task-replay__summary-label">Duration</span>
            <span className="task-replay__summary-value">
              {formatDuration(session.totalDuration)}
            </span>
          </div>
          <div className="task-replay__summary-item">
            <CheckCircle2 size={14} />
            <span className="task-replay__summary-label">Status</span>
            <span className={`task-replay__summary-value task-replay__summary-value--${session.status}`}>
              {STATUS_LABELS[session.status]}
            </span>
          </div>
        </div>

        {/* Artifacts list */}
        {session.artifacts.length > 0 && (
          <div className="task-replay__artifacts">
            <span className="task-replay__artifacts-title">Artifacts Produced</span>
            <ul className="task-replay__artifacts-list">
              {session.artifacts.map((artifact: Artifact) => (
                <li key={artifact.id} className="task-replay__artifact-item">
                  <span className={`task-replay__artifact-op task-replay__artifact-op--${artifact.operation}`}>
                    {artifact.operation}
                  </span>
                  <span className="task-replay__artifact-path">{artifact.filePath}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Re-run button */}
        <div className="task-replay__actions">
          <button
            className="task-replay__rerun-btn"
            onClick={() => void handleRerun()}
            disabled={rerunning}
            type="button"
          >
            <RefreshCw size={14} className={rerunning ? 'task-replay__spinner' : ''} />
            {rerunning ? 'Re-running...' : 'Re-run Task'}
          </button>
          {rerunError && (
            <span className="task-replay__rerun-error">{rerunError}</span>
          )}
        </div>
      </div>
    </div>
  );
}
