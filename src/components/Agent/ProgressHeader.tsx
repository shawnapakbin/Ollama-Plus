/**
 * ProgressHeader Component
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 *
 * Displays task execution progress with step counter, percentage,
 * elapsed time, paused-state indicators, and completion summary.
 *
 * Requirements: 12.1, 12.2, 12.3, 12.4, 12.6
 */
import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  Loader,
  MessageSquare,
  Timer,
} from 'lucide-react';
import type { TaskSessionStatus } from '../../types/agent';
import './ProgressHeader.css';

// ─── Props ───────────────────────────────────────────────────────────────────

export interface ProgressHeaderProps {
  /** Number of steps completed */
  completedSteps: number;
  /** Total planned steps (null = indeterminate) */
  totalSteps: number | null;
  /** Title of the currently executing step */
  currentStepTitle?: string;
  /** Current task session status */
  status: TaskSessionStatus;
  /** Reason for pause (when status is paused/waiting_approval) */
  pauseReason?: 'approval' | 'error' | 'input';
  /** ISO timestamp when execution started */
  startedAt?: string;
  /** ISO timestamp when task completed */
  completedAt?: string;
  /** Total duration in milliseconds (for completion card) */
  totalDuration?: number;
  /** Number of artifacts produced (for completion card) */
  artifactCount?: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Format a duration in milliseconds to a human-readable string (Xm Ys).
 */
function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

/**
 * Calculate elapsed milliseconds from an ISO timestamp to now.
 */
function getElapsedMs(startedAt: string): number {
  const start = new Date(startedAt).getTime();
  return Math.max(0, Date.now() - start);
}

// ─── Pause Reason Config ─────────────────────────────────────────────────────

const PAUSE_REASONS = {
  approval: {
    icon: Clock,
    label: 'Waiting for approval',
    className: 'approval',
  },
  error: {
    icon: AlertTriangle,
    label: 'Error occurred',
    className: 'error',
  },
  input: {
    icon: MessageSquare,
    label: 'Input needed',
    className: 'input',
  },
} as const;

// ─── Component ───────────────────────────────────────────────────────────────

export function ProgressHeader({
  completedSteps,
  totalSteps,
  currentStepTitle,
  status,
  pauseReason,
  startedAt,
  completedAt,
  totalDuration,
  artifactCount,
}: ProgressHeaderProps) {
  const [elapsedMs, setElapsedMs] = useState<number>(
    startedAt ? getElapsedMs(startedAt) : 0
  );

  // Live elapsed time updater — ticks every 1 second while running
  useEffect(() => {
    if (status !== 'running' || !startedAt) return;

    // Immediately sync
    setElapsedMs(getElapsedMs(startedAt));

    const interval = setInterval(() => {
      setElapsedMs(getElapsedMs(startedAt));
    }, 1000);

    return () => clearInterval(interval);
  }, [status, startedAt]);

  // ─── Completed State ─────────────────────────────────────────────────────

  if (status === 'completed') {
    const duration = totalDuration ?? (startedAt && completedAt
      ? new Date(completedAt).getTime() - new Date(startedAt).getTime()
      : 0);

    return (
      <div
        className="progress-header progress-header--completed"
        role="status"
        aria-label="Task completed"
      >
        <div className="progress-header__completion">
          <CheckCircle2
            size={20}
            className="progress-header__completion-icon"
            aria-hidden="true"
          />
          <div className="progress-header__completion-details">
            <span className="progress-header__completion-label">Completed</span>
            <span className="progress-header__completion-stat">
              <Timer size={14} aria-hidden="true" />
              {formatDuration(duration)}
            </span>
            {artifactCount != null && artifactCount > 0 && (
              <span className="progress-header__completion-stat">
                <FileText size={14} aria-hidden="true" />
                {artifactCount} artifact{artifactCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ─── Paused State ────────────────────────────────────────────────────────

  if ((status === 'paused' || status === 'waiting_approval') && pauseReason) {
    const reason = PAUSE_REASONS[pauseReason];
    const Icon = reason.icon;

    return (
      <div
        className="progress-header progress-header--paused"
        role="status"
        aria-label={reason.label}
      >
        <div
          className={`progress-header__paused-indicator progress-header__paused-indicator--${reason.className}`}
        >
          <Icon size={18} aria-hidden="true" />
          <span>{reason.label}</span>
        </div>
        {currentStepTitle && (
          <span className="progress-header__step-title">{currentStepTitle}</span>
        )}
        {startedAt && (
          <span className="progress-header__elapsed">{formatDuration(elapsedMs)}</span>
        )}
      </div>
    );
  }

  // ─── Running / Indeterminate State ───────────────────────────────────────

  const isIndeterminate = totalSteps === null;
  const percentage = isIndeterminate ? 0 : Math.round((completedSteps / totalSteps) * 100);

  return (
    <div
      className="progress-header"
      role="status"
      aria-label={
        isIndeterminate
          ? `${completedSteps} steps completed`
          : `${completedSteps} of ${totalSteps} steps completed, ${percentage}%`
      }
    >
      {/* Step counter */}
      <div className="progress-header__counter">
        {isIndeterminate ? (
          <>
            <Loader size={16} aria-hidden="true" />
            <span className="progress-header__counter-text">
              {completedSteps} step{completedSteps !== 1 ? 's' : ''} completed
            </span>
          </>
        ) : (
          <>
            <span className="progress-header__counter-text">
              {completedSteps} / {totalSteps}
            </span>
            <span className="progress-header__percentage">{percentage}%</span>
          </>
        )}
      </div>

      {/* Progress bar */}
      <div
        className={`progress-header__bar${isIndeterminate ? ' progress-header__bar--indeterminate' : ''}`}
        role="progressbar"
        aria-valuenow={isIndeterminate ? undefined : percentage}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="progress-header__bar-fill"
          style={{ width: isIndeterminate ? undefined : `${percentage}%` }}
        />
      </div>

      {/* Current step title */}
      {currentStepTitle && (
        <span className="progress-header__step-title">{currentStepTitle}</span>
      )}

      {/* Elapsed time */}
      {startedAt && (
        <span className="progress-header__elapsed">{formatDuration(elapsedMs)}</span>
      )}
    </div>
  );
}
