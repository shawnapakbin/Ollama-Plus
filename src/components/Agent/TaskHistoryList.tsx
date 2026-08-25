/**
 * TaskHistoryList Component
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 *
 * Paginated list of past Task Sessions in reverse chronological order.
 * Shows instruction (truncated), status badge, creation timestamp, and duration.
 *
 * Requirements: 9.2
 */
import { useCallback, useEffect, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  History,
  Loader,
} from 'lucide-react';
import type { TaskSession, TaskSessionStatus } from '../../types/agent';
import './TaskHistoryList.css';

// ─── Props ───────────────────────────────────────────────────────────────────

export interface TaskHistoryListProps {
  /** Callback when a session is selected */
  onSelectSession: (sessionId: string) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

function formatTimestamp(iso: string): string {
  try {
    const date = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / 86_400_000);

    if (diffDays === 0) {
      return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    }
    if (diffDays === 1) {
      return 'Yesterday';
    }
    if (diffDays < 7) {
      return `${diffDays}d ago`;
    }
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return '--';
  }
}

function formatDuration(ms: number | null): string {
  if (ms === null || ms === 0) return '--';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function truncateInstruction(instruction: string, maxLength = 80): string {
  if (instruction.length <= maxLength) return instruction;
  return instruction.slice(0, maxLength).trimEnd() + '...';
}

const STATUS_CONFIG: Record<TaskSessionStatus, { label: string; className: string }> = {
  planned: { label: 'Planned', className: 'planned' },
  running: { label: 'Running', className: 'running' },
  paused: { label: 'Paused', className: 'paused' },
  waiting_approval: { label: 'Awaiting', className: 'waiting' },
  completed: { label: 'Completed', className: 'completed' },
  failed: { label: 'Failed', className: 'failed' },
  canceled: { label: 'Canceled', className: 'canceled' },
};

// ─── Component ───────────────────────────────────────────────────────────────

export function TaskHistoryList({ onSelectSession }: TaskHistoryListProps) {
  const [sessions, setSessions] = useState<TaskSession[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSessions = useCallback(async (pageNum: number) => {
    setLoading(true);
    setError(null);
    try {
      const result = await window.electronAPI!.listAgentSessions({
        page: pageNum,
        pageSize: PAGE_SIZE,
      });
      setSessions(result.items);
      setTotalPages(result.totalPages);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load task history');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSessions(page);
  }, [page, fetchSessions]);

  const handlePrevPage = useCallback(() => {
    if (page > 1) setPage(p => p - 1);
  }, [page]);

  const handleNextPage = useCallback(() => {
    if (page < totalPages) setPage(p => p + 1);
  }, [page, totalPages]);

  // ─── Loading State ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="task-history" role="status" aria-label="Loading task history">
        <div className="task-history__loading">
          <Loader size={20} className="task-history__spinner" />
          <span>Loading task history...</span>
        </div>
      </div>
    );
  }

  // ─── Error State ───────────────────────────────────────────────────────────

  if (error) {
    return (
      <div className="task-history" role="alert">
        <div className="task-history__error">
          <span>{error}</span>
          <button
            className="task-history__retry-btn"
            onClick={() => void fetchSessions(page)}
            type="button"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // ─── Empty State ───────────────────────────────────────────────────────────

  if (sessions.length === 0) {
    return (
      <div className="task-history">
        <div className="task-history__empty">
          <History size={32} />
          <span>No past task sessions found</span>
        </div>
      </div>
    );
  }

  // ─── List ──────────────────────────────────────────────────────────────────

  return (
    <div className="task-history">
      {/* Header */}
      <div className="task-history__header">
        <History size={16} />
        <span className="task-history__header-title">Task History</span>
        <span className="task-history__header-count">{total} session{total !== 1 ? 's' : ''}</span>
      </div>

      {/* Session list */}
      <div className="task-history__list" role="list" aria-label="Task sessions">
        {sessions.map(session => {
          const statusConfig = STATUS_CONFIG[session.status];
          return (
            <button
              key={session.id}
              className="task-history__item"
              onClick={() => onSelectSession(session.id)}
              type="button"
              role="listitem"
              aria-label={`Task: ${truncateInstruction(session.instruction, 50)}, Status: ${statusConfig.label}`}
            >
              <div className="task-history__item-main">
                <span className="task-history__item-instruction">
                  {truncateInstruction(session.instruction)}
                </span>
                <div className="task-history__item-meta">
                  <span className={`task-history__status-badge task-history__status-badge--${statusConfig.className}`}>
                    {statusConfig.label}
                  </span>
                  <span className="task-history__item-timestamp">
                    {formatTimestamp(session.createdAt)}
                  </span>
                  <span className="task-history__item-duration">
                    <Clock size={11} />
                    {formatDuration(session.totalDuration)}
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="task-history__pagination" role="navigation" aria-label="Pagination">
          <button
            className="task-history__page-btn"
            onClick={handlePrevPage}
            disabled={page <= 1}
            type="button"
            aria-label="Previous page"
          >
            <ChevronLeft size={16} />
            Prev
          </button>
          <span className="task-history__page-info">
            Page {page} of {totalPages}
          </span>
          <button
            className="task-history__page-btn"
            onClick={handleNextPage}
            disabled={page >= totalPages}
            type="button"
            aria-label="Next page"
          >
            Next
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
