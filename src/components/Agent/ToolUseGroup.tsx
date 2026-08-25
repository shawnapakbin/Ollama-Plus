/**
 * ToolUseGroup Component
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 *
 * Groups 2+ sequential tool calls under a single collapsible
 * "Agent Actions" container with a count badge. When expanded,
 * reveals individual ToolUseBlock elements with vertical spacing.
 *
 * Requirements: 2.7
 */
import { useState } from 'react';
import type { ToolUseBlockState } from '../../types/agentChat';
import { ToolUseBlock } from './ToolUseBlock';
import './ToolUseGroup.css';

interface ToolUseGroupProps {
  blocks: ToolUseBlockState[];
  defaultExpanded?: boolean;
}

export function ToolUseGroup({ blocks, defaultExpanded = false }: ToolUseGroupProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  return (
    <div className="tool-use-group" role="region" aria-label="Agent Actions group">
      {/* Group Header */}
      <button
        className="tool-use-group__header"
        onClick={() => setIsExpanded((prev) => !prev)}
        aria-expanded={isExpanded}
        aria-controls="tool-use-group-content"
      >
        <span
          className={`tool-use-group__chevron ${isExpanded ? 'tool-use-group__chevron--expanded' : ''}`}
          aria-hidden="true"
        >
          ›
        </span>

        <span className="tool-use-group__label">Agent Actions</span>

        <span className="tool-use-group__count-badge" aria-label={`${blocks.length} tool calls`}>
          {blocks.length}
        </span>
      </button>

      {/* Expandable Content */}
      {isExpanded && (
        <div className="tool-use-group__content" id="tool-use-group-content">
          {blocks.map((block) => (
            <ToolUseBlock key={block.id} block={block} />
          ))}
        </div>
      )}
    </div>
  );
}
