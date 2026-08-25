/**
 * ReasoningIndicator Component
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 *
 * Displays the agent's reasoning/planning process inline in the chat stream.
 * Supports four variant types:
 * - plan: Numbered step list with brain icon and progress indicators
 * - thinking: Animated "Thinking..." indicator
 * - replan: Shows removed (strikethrough) and new (highlighted) steps
 * - completion: Checkmark with summary text
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6
 */
import { useState } from 'react';
import type { ReasoningBlockState, PlanStep } from '../../types/agentChat';
import './ReasoningIndicator.css';

// ─── Props ───────────────────────────────────────────────────────────────────

export interface ReasoningIndicatorProps {
  block: ReasoningBlockState;
}

// ─── Step Status Icon ────────────────────────────────────────────────────────

function StepStatusIcon({ status }: { status: PlanStep['status'] }) {
  switch (status) {
    case 'completed':
      return (
        <span
          className="reasoning-step-icon reasoning-step-icon--completed"
          aria-label="Completed"
        >
          ✓
        </span>
      );
    case 'active':
      return (
        <span
          className="reasoning-step-icon reasoning-step-icon--active"
          aria-label="In progress"
        >
          <span className="reasoning-step-spinner" aria-hidden="true" />
        </span>
      );
    case 'pending':
    default:
      return (
        <span
          className="reasoning-step-icon reasoning-step-icon--pending"
          aria-label="Pending"
        >
          ○
        </span>
      );
  }
}

// ─── Plan Variant ────────────────────────────────────────────────────────────

function PlanVariant({ block }: { block: ReasoningBlockState }) {
  const steps = block.steps ?? [];

  return (
    <div className="reasoning-indicator__body">
      {block.content && (
        <p className="reasoning-indicator__plan-summary">{block.content}</p>
      )}
      {steps.length > 0 && (
        <ol className="reasoning-indicator__step-list" aria-label="Plan steps">
          {steps.map((step, index) => (
            <li
              key={step.id}
              className={`reasoning-indicator__step reasoning-indicator__step--${step.status}`}
            >
              <StepStatusIcon status={step.status} />
              <span className="reasoning-indicator__step-number">{index + 1}.</span>
              <span className="reasoning-indicator__step-title">{step.title}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ─── Thinking Variant ────────────────────────────────────────────────────────

function ThinkingVariant() {
  return (
    <div className="reasoning-indicator__body reasoning-indicator__body--thinking">
      <span className="reasoning-indicator__thinking-text">
        Thinking<span className="reasoning-indicator__ellipsis" aria-hidden="true" />
      </span>
    </div>
  );
}

// ─── Replan Variant ──────────────────────────────────────────────────────────

function ReplanVariant({ block }: { block: ReasoningBlockState }) {
  const removedSteps = block.removedSteps ?? [];
  const newSteps = block.newSteps ?? [];

  return (
    <div className="reasoning-indicator__body">
      {block.content && (
        <p className="reasoning-indicator__plan-summary">{block.content}</p>
      )}
      {removedSteps.length > 0 && (
        <div className="reasoning-indicator__replan-section">
          <span className="reasoning-indicator__replan-label reasoning-indicator__replan-label--removed">
            Removed
          </span>
          <ul className="reasoning-indicator__replan-list" aria-label="Removed steps">
            {removedSteps.map((step, index) => (
              <li key={`removed-${index}`} className="reasoning-indicator__replan-item reasoning-indicator__replan-item--removed">
                <span className="reasoning-indicator__strikethrough">{step}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {newSteps.length > 0 && (
        <div className="reasoning-indicator__replan-section">
          <span className="reasoning-indicator__replan-label reasoning-indicator__replan-label--added">
            Added
          </span>
          <ol className="reasoning-indicator__step-list" aria-label="New steps">
            {newSteps.map((step, index) => (
              <li
                key={step.id}
                className={`reasoning-indicator__step reasoning-indicator__step--new reasoning-indicator__step--${step.status}`}
              >
                <StepStatusIcon status={step.status} />
                <span className="reasoning-indicator__step-number">{index + 1}.</span>
                <span className="reasoning-indicator__step-title">{step.title}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

// ─── Completion Variant ──────────────────────────────────────────────────────

function CompletionVariant({ block }: { block: ReasoningBlockState }) {
  return (
    <div className="reasoning-indicator__body reasoning-indicator__body--completion">
      <span className="reasoning-indicator__completion-icon" aria-hidden="true">✓</span>
      <span className="reasoning-indicator__completion-text">{block.content}</span>
    </div>
  );
}

// ─── Header Icon ─────────────────────────────────────────────────────────────

function HeaderIcon({ type }: { type: ReasoningBlockState['type'] }) {
  switch (type) {
    case 'plan':
      return <span className="reasoning-indicator__header-icon" aria-hidden="true">🧠</span>;
    case 'thinking':
      return <span className="reasoning-indicator__header-icon" aria-hidden="true">💭</span>;
    case 'replan':
      return <span className="reasoning-indicator__header-icon" aria-hidden="true">🔄</span>;
    case 'completion':
      return <span className="reasoning-indicator__header-icon" aria-hidden="true">✅</span>;
    default:
      return null;
  }
}

// ─── Header Title ────────────────────────────────────────────────────────────

function getHeaderTitle(type: ReasoningBlockState['type']): string {
  switch (type) {
    case 'plan':
      return 'Plan';
    case 'thinking':
      return 'Reasoning';
    case 'replan':
      return 'Updated Plan';
    case 'completion':
      return 'Completed';
    default:
      return 'Reasoning';
  }
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function ReasoningIndicator({ block }: ReasoningIndicatorProps) {
  const [isExpanded, setIsExpanded] = useState(block.isExpanded);

  // Thinking variant is always compact, no collapse
  const isCollapsible = block.type !== 'thinking';

  const handleToggle = () => {
    if (isCollapsible) {
      setIsExpanded((prev) => !prev);
    }
  };

  return (
    <div
      className={`reasoning-indicator reasoning-indicator--${block.type}`}
      role="region"
      aria-label={`Agent ${getHeaderTitle(block.type)}`}
    >
      {/* Header */}
      <button
        className="reasoning-indicator__header"
        onClick={handleToggle}
        disabled={!isCollapsible}
        aria-expanded={isCollapsible ? isExpanded : undefined}
        type="button"
      >
        <HeaderIcon type={block.type} />
        <span className="reasoning-indicator__header-title">
          {getHeaderTitle(block.type)}
        </span>
        {isCollapsible && (
          <span
            className={`reasoning-indicator__chevron ${isExpanded ? 'reasoning-indicator__chevron--open' : ''}`}
            aria-hidden="true"
          >
            ›
          </span>
        )}
      </button>

      {/* Body — conditionally rendered based on expanded state */}
      {(isExpanded || block.type === 'thinking') && (
        <div className="reasoning-indicator__content">
          {block.type === 'plan' && <PlanVariant block={block} />}
          {block.type === 'thinking' && <ThinkingVariant />}
          {block.type === 'replan' && <ReplanVariant block={block} />}
          {block.type === 'completion' && <CompletionVariant block={block} />}
        </div>
      )}
    </div>
  );
}
