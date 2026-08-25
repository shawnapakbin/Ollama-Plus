/**
 * Task Controls Component
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 *
 * Renders pause, resume, and cancel buttons for active agent task sessions.
 * Visible without scrolling during execution per Requirement 13.1.
 */
import { useState, useCallback } from 'react';
import type { TaskSessionStatus } from '../../types/agent';
import './TaskControls.css';

export type TaskControlsProps = {
  sessionId: string;
  status: TaskSessionStatus;
  onStatusChange?: (newStatus: string) => void;
};

/**
 * TaskControls provides the primary execution control surface for an agent task.
 *
 * - Pause: visible when status is 'running', calls pauseAgentTask
 * - Resume: visible when status is 'paused', calls resumeAgentTask
 * - Cancel: visible when status is 'running' or 'paused', calls cancelAgentTask
 */
export function TaskControls({ sessionId, status, onStatusChange }: TaskControlsProps) {
  const [loading, setLoading] = useState<'pause' | 'resume' | 'cancel' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isRunning = status === 'running';
  const isPaused = status === 'paused';
  const isActive = isRunning || isPaused || status === 'waiting_approval';

  const clearError = useCallback(() => setError(null), []);

  const handlePause = useCallback(async () => {
    if (!window.electronAPI) return;
    setLoading('pause');
    setError(null);
    try {
      const result = await window.electronAPI.pauseAgentTask(sessionId);
      if (result.success) {
        onStatusChange?.('paused');
      } else {
        setError(result.error || 'Failed to pause task');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to pause task');
    } finally {
      setLoading(null);
    }
  }, [sessionId, onStatusChange]);

  const handleResume = useCallback(async () => {
    if (!window.electronAPI) return;
    setLoading('resume');
    setError(null);
    try {
      const result = await window.electronAPI.resumeAgentTask(sessionId);
      if (result.success) {
        onStatusChange?.('running');
      } else {
        setError(result.error || 'Failed to resume task');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resume task');
    } finally {
      setLoading(null);
    }
  }, [sessionId, onStatusChange]);

  const handleCancel = useCallback(async () => {
    if (!window.electronAPI) return;
    setLoading('cancel');
    setError(null);
    try {
      const result = await window.electronAPI.cancelAgentTask(sessionId);
      if (result.success) {
        onStatusChange?.('canceled');
      } else {
        setError(result.error || 'Failed to cancel task');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to cancel task');
    } finally {
      setLoading(null);
    }
  }, [sessionId, onStatusChange]);

  // Only render controls when the session is in an active state
  if (!isActive) return null;

  return (
    <div className="task-controls" role="toolbar" aria-label="Task execution controls">
      {/* Pause button — visible during running state */}
      {isRunning && (
        <button
          className="task-controls__btn task-controls__btn--pause"
          onClick={handlePause}
          disabled={loading !== null}
          aria-label="Pause task execution"
        >
          {loading === 'pause' ? 'Pausing\u2026' : 'Pause'}
        </button>
      )}

      {/* Resume button — visible during paused state */}
      {isPaused && (
        <button
          className="task-controls__btn task-controls__btn--resume"
          onClick={handleResume}
          disabled={loading !== null}
          aria-label="Resume task execution"
        >
          {loading === 'resume' ? 'Resuming\u2026' : 'Resume'}
        </button>
      )}

      {/* Cancel button — always visible during active execution */}
      <button
        className="task-controls__btn task-controls__btn--cancel"
        onClick={handleCancel}
        disabled={loading !== null}
        aria-label="Cancel task execution"
      >
        {loading === 'cancel' ? 'Canceling\u2026' : 'Cancel'}
      </button>

      {/* Brief error message */}
      {error && (
        <span
          className="task-controls__error"
          role="alert"
          onClick={clearError}
          title="Click to dismiss"
        >
          {error}
        </span>
      )}
    </div>
  );
}
