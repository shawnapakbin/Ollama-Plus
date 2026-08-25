/**
 * ActivityStream Component
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 *
 * Real-time chronological feed rendering all ActivityStreamEvents from the agent runtime.
 * Supports auto-scroll, token streaming, collapsible outputs, and connection state display.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9
 */
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Copy,
  MessageSquare,
  Pause,
  Play,
  RefreshCw,
  Square,
  Unplug,
  Wrench,
  XCircle
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActivityStreamEvent, Step, StepOutcome, TaskSummary } from '../../types/agent';
import './ActivityStream.css';

// ─── Props ───────────────────────────────────────────────────────────────────

export interface ActivityStreamProps {
  events: ActivityStreamEvent[];
  isConnected?: boolean;
  lastEventAt?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTime(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
  } catch {
    return '--:--:--';
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function truncateOutput(output: string, maxLines: number): { lines: string[]; isTruncated: boolean } {
  const allLines = output.split('\n');
  if (allLines.length <= maxLines) {
    return { lines: allLines, isTruncated: false };
  }
  return { lines: allLines, isTruncated: true };
}

function isCodeOutput(output: string): boolean {
  // Heuristic: detect code-like output
  const codeIndicators = ['{', '}', '=>', 'function ', 'const ', 'import ', 'export ', 'class ', 'def ', 'return '];
  return codeIndicators.some(indicator => output.includes(indicator));
}

// ─── Sub-Components ──────────────────────────────────────────────────────────

function CodeBlock({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [content]);

  return (
    <div className="activity-code-block">
      <pre><code>{content}</code></pre>
      <button
        className="activity-code-copy-btn"
        onClick={handleCopy}
        type="button"
        aria-label="Copy code to clipboard"
      >
        <Copy size={11} style={{ marginRight: 3 }} />
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

function CollapsibleOutput({ output }: { output: string }) {
  const [expanded, setExpanded] = useState(false);
  const { lines, isTruncated } = truncateOutput(output, 10);

  if (!isTruncated) {
    return isCodeOutput(output) ? (
      <CodeBlock content={output} />
    ) : (
      <div className="activity-entry-content">{output}</div>
    );
  }

  const summaryLine = lines[0] || '(output)';

  return (
    <div className="activity-collapsed-output">
      {expanded ? (
        <>
          {isCodeOutput(output) ? (
            <CodeBlock content={output} />
          ) : (
            <div className="activity-entry-content">
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 'inherit' }}>
                {output}
              </pre>
            </div>
          )}
          <button
            className="activity-expand-btn"
            onClick={() => setExpanded(false)}
            type="button"
          >
            Show less
          </button>
        </>
      ) : (
        <>
          <div className="activity-collapsed-summary">{summaryLine}</div>
          <button
            className="activity-expand-btn"
            onClick={() => setExpanded(true)}
            type="button"
          >
            Show more ({lines.length} lines)
          </button>
        </>
      )}
    </div>
  );
}

function ParamsDisplay({ params }: { params: Record<string, unknown> }) {
  const text = JSON.stringify(params, null, 2);
  if (text.length > 200) {
    return <CollapsibleOutput output={text} />;
  }
  return <div className="activity-params">{text}</div>;
}

function SummaryCard({ summary }: { summary: TaskSummary }) {
  return (
    <div className="activity-summary-card">
      <div className="activity-summary-stat">
        <span className="activity-summary-stat-label">Steps</span>
        <span>{summary.stepsCompleted} / {summary.stepsTotal}</span>
      </div>
      <div className="activity-summary-stat">
        <span className="activity-summary-stat-label">Artifacts</span>
        <span>{summary.artifactCount}</span>
      </div>
      <div className="activity-summary-stat">
        <span className="activity-summary-stat-label">Duration</span>
        <span>{formatDuration(summary.totalDuration)}</span>
      </div>
      <div className="activity-summary-stat">
        <span className="activity-summary-stat-label">Status</span>
        <span>{summary.status}</span>
      </div>
    </div>
  );
}

// ─── Entry Renderers ─────────────────────────────────────────────────────────

function renderEntry(event: ActivityStreamEvent, index: number) {
  switch (event.type) {
    case 'reasoning':
      return (
        <div key={`${event.type}-${index}`} className="activity-entry activity-entry--reasoning">
          <div className="activity-entry-icon">
            <MessageSquare size={14} />
          </div>
          <div className="activity-entry-body">
            <div className="activity-entry-header">
              <span className="activity-entry-label">Reasoning</span>
              <span className="activity-entry-timestamp">{formatTime(event.timestamp)}</span>
            </div>
            <div className="activity-entry-content">{event.content}</div>
          </div>
        </div>
      );

    case 'tool-call':
      return (
        <div key={`${event.type}-${index}`} className="activity-entry activity-entry--tool-call">
          <div className="activity-entry-icon">
            <Wrench size={14} />
          </div>
          <div className="activity-entry-body">
            <div className="activity-entry-header">
              <span className="activity-entry-label">Tool Call</span>
              <span className="activity-entry-timestamp">{formatTime(event.timestamp)}</span>
            </div>
            <div className="activity-entry-content">
              Calling <strong>{event.tool}</strong>...
            </div>
            <ParamsDisplay params={event.params} />
          </div>
        </div>
      );

    case 'tool-result':
      return (
        <div key={`${event.type}-${index}`} className="activity-entry activity-entry--tool-result">
          <div className="activity-entry-icon">
            <CheckCircle2 size={14} />
          </div>
          <div className="activity-entry-body">
            <div className="activity-entry-header">
              <span className="activity-entry-label">{event.tool} Result</span>
              <span className="activity-duration">{formatDuration(event.duration)}</span>
              <span className="activity-entry-timestamp">{formatTime(event.timestamp)}</span>
            </div>
            <CollapsibleOutput output={event.output} />
          </div>
        </div>
      );

    case 'step-started':
      return (
        <div key={`${event.type}-${index}`} className="activity-entry activity-entry--step-started">
          <div className="activity-entry-icon">
            <Circle size={14} />
          </div>
          <div className="activity-entry-body">
            <div className="activity-entry-header">
              <span className="activity-entry-label">Step Started</span>
              <span className="activity-entry-timestamp">{formatTime(event.timestamp)}</span>
            </div>
            <div className="activity-entry-content">{event.title}</div>
          </div>
        </div>
      );

    case 'step-completed':
      return (
        <div key={`${event.type}-${index}`} className="activity-entry activity-entry--step-completed">
          <div className="activity-entry-icon">
            <CheckCircle2 size={14} />
          </div>
          <div className="activity-entry-body">
            <div className="activity-entry-header">
              <span className="activity-entry-label">Step Completed</span>
              <span className="activity-duration">{formatDuration(event.duration)}</span>
              <span className="activity-entry-timestamp">{formatTime(event.timestamp)}</span>
            </div>
            <div className="activity-entry-content">
              {renderStepOutcome(event.outcome)}
            </div>
          </div>
        </div>
      );

    case 'step-progress':
      return (
        <div key={`${event.type}-${index}`} className="activity-entry activity-entry--tool-result">
          <div className="activity-entry-icon">
            <Play size={14} />
          </div>
          <div className="activity-entry-body">
            <div className="activity-entry-header">
              <span className="activity-entry-label">Progress</span>
              <span className="activity-entry-timestamp">{formatTime(event.timestamp)}</span>
            </div>
            <div className="activity-entry-content">{event.output}</div>
          </div>
        </div>
      );

    case 'error':
      return (
        <div key={`${event.type}-${index}`} className="activity-entry activity-entry--error">
          <div className="activity-entry-icon">
            <XCircle size={14} />
          </div>
          <div className="activity-entry-body">
            <div className="activity-entry-header">
              <span className="activity-entry-label">Error</span>
              <span className="activity-entry-timestamp">{formatTime(event.timestamp)}</span>
            </div>
            <div className="activity-entry-content">
              <strong>{event.error.type}</strong>: {event.error.message}
              {event.error.attemptCount > 0 && (
                <span className="activity-duration">Attempt {event.error.attemptCount}</span>
              )}
            </div>
            {event.recovery && (
              <div className="activity-entry-recovery">{event.recovery}</div>
            )}
          </div>
        </div>
      );

    case 'token':
      return (
        <div key={`${event.type}-${index}`} className="activity-entry activity-entry--token">
          <div className="activity-entry-body">
            <div className="activity-entry-content">{event.delta}</div>
          </div>
        </div>
      );

    case 'approval-gate':
      return (
        <div key={`${event.type}-${index}`} className="activity-entry activity-entry--approval-gate">
          <div className="activity-entry-icon">
            <AlertTriangle size={14} />
          </div>
          <div className="activity-entry-body">
            <div className="activity-entry-header">
              <span className="activity-entry-label">Approval Required</span>
              <span className="activity-entry-timestamp">{formatTime(event.timestamp)}</span>
            </div>
            <div className="activity-entry-content">
              <strong>{event.action}</strong> via {event.tool}
            </div>
            <div className="activity-entry-content" style={{ marginTop: 4, opacity: 0.75 }}>
              {event.riskExplanation}
            </div>
          </div>
        </div>
      );

    case 'replan':
      return (
        <div key={`${event.type}-${index}`} className="activity-entry activity-entry--replan">
          <div className="activity-entry-icon">
            <RefreshCw size={14} />
          </div>
          <div className="activity-entry-body">
            <div className="activity-entry-header">
              <span className="activity-entry-label">Re-planning</span>
              <span className="activity-entry-timestamp">{formatTime(event.timestamp)}</span>
            </div>
            <div className="activity-entry-content">{event.reason}</div>
            {event.newSteps.length > 0 && (
              <div className="activity-params">
                {event.newSteps.map((step: Step) => step.title).join('\n')}
              </div>
            )}
          </div>
        </div>
      );

    case 'plan-generated':
      return (
        <div key={`${event.type}-${index}`} className="activity-entry activity-entry--step-started">
          <div className="activity-entry-icon">
            <Circle size={14} />
          </div>
          <div className="activity-entry-body">
            <div className="activity-entry-header">
              <span className="activity-entry-label">Plan Generated</span>
              <span className="activity-entry-timestamp">{formatTime(event.timestamp)}</span>
            </div>
            <div className="activity-entry-content">
              {event.plan.steps.length} steps &mdash; {event.plan.reasoning}
            </div>
            <div className="activity-params">
              {event.plan.steps.map((step: Step, i: number) => `${i + 1}. ${step.title}`).join('\n')}
            </div>
          </div>
        </div>
      );

    case 'context-summary':
      return (
        <div key={`${event.type}-${index}`} className="activity-entry activity-entry--reasoning">
          <div className="activity-entry-icon">
            <RefreshCw size={12} />
          </div>
          <div className="activity-entry-body">
            <div className="activity-entry-header">
              <span className="activity-entry-label">Context Summarized</span>
              <span className="activity-entry-timestamp">{formatTime(event.timestamp)}</span>
            </div>
            <div className="activity-entry-content">
              Summarized {event.summarized} entries, retained {event.retained}
            </div>
          </div>
        </div>
      );

    case 'task-complete':
      return (
        <div key={`${event.type}-${index}`} className="activity-entry activity-entry--task-complete">
          <div className="activity-entry-icon">
            <CheckCircle2 size={14} />
          </div>
          <div className="activity-entry-body">
            <div className="activity-entry-header">
              <span className="activity-entry-label">Task Complete</span>
              <span className="activity-entry-timestamp">{formatTime(event.timestamp)}</span>
            </div>
            <SummaryCard summary={event.summary} />
          </div>
        </div>
      );

    case 'task-paused':
      return (
        <div key={`${event.type}-${index}`} className="activity-entry activity-entry--task-paused">
          <div className="activity-entry-icon">
            <Pause size={14} />
          </div>
          <div className="activity-entry-body">
            <div className="activity-entry-header">
              <span className="activity-entry-label">Paused</span>
              <span className="activity-entry-timestamp">{formatTime(event.timestamp)}</span>
            </div>
            <div className="activity-entry-content">{event.reason}</div>
          </div>
        </div>
      );

    case 'task-canceled':
      return (
        <div key={`${event.type}-${index}`} className="activity-entry activity-entry--task-canceled">
          <div className="activity-entry-icon">
            <Square size={14} />
          </div>
          <div className="activity-entry-body">
            <div className="activity-entry-header">
              <span className="activity-entry-label">Canceled</span>
              <span className="activity-entry-timestamp">{formatTime(event.timestamp)}</span>
            </div>
          </div>
        </div>
      );

    case 'connection-lost':
      return (
        <div key={`${event.type}-${index}`} className="activity-entry activity-entry--connection-lost">
          <div className="activity-entry-icon">
            <Unplug size={14} />
          </div>
          <div className="activity-entry-body">
            <div className="activity-entry-header">
              <span className="activity-entry-label">Connection Lost</span>
              <span className="activity-entry-timestamp">{formatTime(event.timestamp)}</span>
            </div>
            <div className="activity-entry-content">
              Last event received at {formatTime(event.lastEventAt)}
            </div>
          </div>
        </div>
      );

    default:
      return null;
  }
}

function renderStepOutcome(outcome: StepOutcome): string {
  switch (outcome.type) {
    case 'proceed':
      return outcome.output || 'Step completed, proceeding...';
    case 'replan':
      return `Re-plan triggered: ${outcome.reason}`;
    case 'complete':
      return outcome.output || 'Task goal achieved.';
    default:
      return '';
  }
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function ActivityStream({ events, isConnected = true, lastEventAt }: ActivityStreamProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const userScrolledRef = useRef(false);
  const lastEventCountRef = useRef(0);

  // Auto-scroll: scroll to bottom when new events arrive, unless user scrolled up
  useEffect(() => {
    if (!autoScroll || !containerRef.current) return;
    if (events.length > lastEventCountRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
    lastEventCountRef.current = events.length;
  }, [events, autoScroll]);

  // Detect user scroll: pause auto-scroll when scrolled up, resume at bottom
  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;

    const threshold = 40; // pixels from bottom considered "at bottom"
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;

    if (atBottom) {
      userScrolledRef.current = false;
      setAutoScroll(true);
    } else {
      userScrolledRef.current = true;
      setAutoScroll(false);
    }
  }, []);

  // Empty state
  if (events.length === 0 && isConnected) {
    return (
      <div className="activity-stream">
        <div className="activity-stream-empty">
          Waiting for agent activity...
        </div>
      </div>
    );
  }

  return (
    <div
      className="activity-stream"
      ref={containerRef}
      onScroll={handleScroll}
      role="log"
      aria-live="polite"
      aria-label="Agent activity stream"
    >
      {/* Connection lost banner */}
      {!isConnected && (
        <div className="activity-connection-banner" role="alert">
          <Unplug size={14} className="activity-connection-banner-icon" />
          <span className="activity-connection-banner-text">
            Connection lost{lastEventAt ? ` — last event at ${formatTime(lastEventAt)}` : ''}
          </span>
        </div>
      )}

      {/* Event entries */}
      {events.map((event, index) => renderEntry(event, index))}
    </div>
  );
}
