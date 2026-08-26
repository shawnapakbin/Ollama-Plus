/**
 * ToolUseBlock Component
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 *
 * Displays a tool invocation inline in the Agent Chat Stream.
 * Shows tool name, category-colored badge, execution status,
 * and expandable params/output sections.
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 9.3
 */
import { useState, useCallback } from 'react';
import { getCategoryColor, getCategoryIcon } from '../../utils/agent/toolCategoryUtils';
import { formatToolOutput } from '../../utils/agent/toolOutputFormatter';
import type { ToolUseBlockState } from '../../types/agentChat';
import './ToolUseBlock.css';

interface ToolUseBlockProps {
  block: ToolUseBlockState;
}

export function ToolUseBlock({ block }: ToolUseBlockProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showFullOutput, setShowFullOutput] = useState(false);

  const categoryColor = getCategoryColor(block.category);
  const categoryIcon = getCategoryIcon(block.category);

  const toggleExpanded = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  const toggleFullOutput = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setShowFullOutput((prev) => !prev);
  }, []);

  const formattedOutput = block.output ? formatToolOutput(block.output) : null;

  const statusClass =
    block.status === 'running'
      ? 'tool-use-block--running'
      : block.status === 'error'
        ? 'tool-use-block--error'
        : 'tool-use-block--success';

  return (
    <div
      className={`tool-use-block ${statusClass}`}
      role="region"
      aria-label={`Tool: ${block.tool} — ${block.status}`}
    >
      {/* Header Row */}
      <button
        className="tool-use-block__header"
        onClick={toggleExpanded}
        aria-expanded={isExpanded}
        aria-controls={`tool-use-details-${block.id}`}
      >
        {/* Category Icon */}
        <span
          className="tool-use-block__icon"
          style={{ color: categoryColor }}
          aria-hidden="true"
        >
          <CategoryIcon name={categoryIcon} />
        </span>

        {/* Tool Name Badge */}
        <span
          className="tool-use-block__name-badge"
          style={{
            backgroundColor: `${categoryColor}1a`,
            borderColor: `${categoryColor}40`,
            color: categoryColor,
          }}
        >
          {block.tool}
        </span>

        {/* Status Indicator */}
        <span className="tool-use-block__status">
          {block.status === 'running' && (
            <>
              <span className="tool-use-block__spinner" aria-hidden="true" />
              <span className="tool-use-block__status-text">Executing...</span>
            </>
          )}
          {block.status === 'success' && (
            <>
              <span className="tool-use-block__checkmark" aria-hidden="true">
                ✓
              </span>
              {block.duration !== null && (
                <span className="tool-use-block__duration">
                  {formatDuration(block.duration)}
                </span>
              )}
            </>
          )}
          {block.status === 'error' && (
            <span className="tool-use-block__error-icon" aria-hidden="true">
              ✗
            </span>
          )}
        </span>

        {/* Expand/Collapse Chevron */}
        <span
          className={`tool-use-block__chevron ${isExpanded ? 'tool-use-block__chevron--open' : ''}`}
          aria-hidden="true"
        >
          ▸
        </span>
      </button>

      {/* Expandable Details */}
      <div
        id={`tool-use-details-${block.id}`}
        className={`tool-use-block__details ${isExpanded ? 'tool-use-block__details--open' : ''}`}
      >
        {isExpanded && (
          <>
            {/* Parameters Section */}
            {block.params && Object.keys(block.params).length > 0 && (
              <div className="tool-use-block__params">
                <span className="tool-use-block__section-label">Parameters</span>
                <pre className="tool-use-block__params-code">
                  {JSON.stringify(block.params, null, 2)}
                </pre>
              </div>
            )}

            {/* Output Section (Success) */}
            {block.status === 'success' && formattedOutput && (
              <div className="tool-use-block__output">
                <span className="tool-use-block__section-label">Output</span>
                <pre className="tool-use-block__output-code">
                  {showFullOutput ? block.output : formattedOutput.truncated}
                </pre>
                {formattedOutput.isOverflow && (
                  <button
                    className="tool-use-block__show-more"
                    onClick={toggleFullOutput}
                  >
                    {showFullOutput
                      ? 'Show less'
                      : `Show more (${formattedOutput.totalLines} lines)`}
                  </button>
                )}
              </div>
            )}

            {/* Error Section */}
            {block.status === 'error' && block.error && (
              <div className="tool-use-block__error-details">
                <div className="tool-use-block__error-message">
                  {block.error.message}
                </div>
                <div className="tool-use-block__error-meta">
                  <span className="tool-use-block__error-classification">
                    {block.error.classification}
                  </span>
                  {block.error.retryInfo && (
                    <span className="tool-use-block__retry-info">
                      {block.error.retryInfo}
                    </span>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ─── Sub-Components ──────────────────────────────────────────────────────── */

/**
 * Renders an inline SVG icon for the tool category.
 */
function CategoryIcon({ name }: { name: string }) {
  const props = {
    width: 14,
    height: 14,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  switch (name) {
    case 'folder':
      return (
        <svg {...props}>
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
      );
    case 'terminal':
      return (
        <svg {...props}>
          <polyline points="4 17 10 11 4 5" />
          <line x1="12" y1="19" x2="20" y2="19" />
        </svg>
      );
    case 'globe':
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="10" />
          <line x1="2" y1="12" x2="22" y2="12" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
      );
    case 'wifi':
      return (
        <svg {...props}>
          <path d="M5 12.55a11 11 0 0 1 14.08 0" />
          <path d="M1.42 9a16 16 0 0 1 21.16 0" />
          <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
          <line x1="12" y1="20" x2="12.01" y2="20" />
        </svg>
      );
    case 'code':
      return (
        <svg {...props}>
          <polyline points="16 18 22 12 16 6" />
          <polyline points="8 6 2 12 8 18" />
        </svg>
      );
    default:
      return (
        <svg {...props}>
          <circle cx="12" cy="12" r="10" />
        </svg>
      );
  }
}

/**
 * Format a duration in milliseconds to a human-readable string.
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = (ms / 1000).toFixed(1);
  return `${seconds}s`;
}
