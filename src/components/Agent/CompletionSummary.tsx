/**
 * CompletionSummary Component
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 *
 * Displays a task completion summary inline in the Agent Chat Stream.
 * Shows a green-tinted glassmorphism card with checkmark icon,
 * "Task completed" heading, stats row (steps, duration, artifacts),
 * and the outcome description.
 *
 * Requirements: 3.6, 12.4
 */
import type { CompletionSummaryData } from '../../types/agentChat';
import './CompletionSummary.css';

// ─── Props ───────────────────────────────────────────────────────────────────

export interface CompletionSummaryProps {
  data: CompletionSummaryData;
}

// ─── Duration Formatter ──────────────────────────────────────────────────────

/**
 * Formats a duration in milliseconds to a human-readable string.
 * Examples: "1.2s", "45s", "2m 30s", "1h 5m"
 */
function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }

  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  if (minutes > 0) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }

  // Show one decimal for durations under 10s
  if (totalSeconds < 10) {
    const precise = (ms / 1000).toFixed(1);
    return `${precise}s`;
  }

  return `${seconds}s`;
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function CompletionSummary({ data }: CompletionSummaryProps) {
  const {
    stepsCompleted,
    totalSteps,
    duration,
    artifactCount,
    outcome,
  } = data;

  return (
    <div
      className="completion-summary"
      role="status"
      aria-label="Task completed"
    >
      {/* Header Row */}
      <div className="completion-summary__header">
        <span className="completion-summary__icon" aria-hidden="true">
          ✓
        </span>
        <h3 className="completion-summary__heading">Task completed</h3>
      </div>

      {/* Stats Row */}
      <div className="completion-summary__stats" aria-label="Task statistics">
        <span className="completion-summary__stat">
          <span className="completion-summary__stat-value">
            {stepsCompleted}/{totalSteps}
          </span>
          <span className="completion-summary__stat-label">steps</span>
        </span>

        <span className="completion-summary__stat-divider" aria-hidden="true" />

        <span className="completion-summary__stat">
          <span className="completion-summary__stat-value">
            {formatDuration(duration)}
          </span>
          <span className="completion-summary__stat-label">duration</span>
        </span>

        <span className="completion-summary__stat-divider" aria-hidden="true" />

        <span className="completion-summary__stat">
          <span className="completion-summary__stat-value">
            {artifactCount}
          </span>
          <span className="completion-summary__stat-label">
            {artifactCount === 1 ? 'artifact' : 'artifacts'}
          </span>
        </span>
      </div>

      {/* Outcome Description */}
      {outcome && (
        <p className="completion-summary__outcome">{outcome}</p>
      )}
    </div>
  );
}
