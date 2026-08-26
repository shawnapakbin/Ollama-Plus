/**
 * ApprovalGateBlock Component
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 *
 * Inline approval gate for the agent chat stream.
 * Displays a high-risk operation requiring user approval/denial
 * with four distinct zones: header, action summary, risk explanation,
 * and action buttons. Supports collapsible parameter viewing and
 * animated state transitions.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 9.6
 */

import { useState, useCallback } from 'react';
import type { ApprovalGateState } from '../../types/agentChat';
import { getCategoryColor } from '../../utils/agent/toolCategoryUtils';
import './ApprovalGateBlock.css';

export interface ApprovalGateBlockProps {
  gate: ApprovalGateState;
  onApprove: (gateId: string) => void;
  onDeny: (gateId: string) => void;
}

export function ApprovalGateBlock({ gate, onApprove, onDeny }: ApprovalGateBlockProps) {
  const [paramsExpanded, setParamsExpanded] = useState(false);

  const handleApprove = useCallback(() => {
    onApprove(gate.gateId);
  }, [gate.gateId, onApprove]);

  const handleDeny = useCallback(() => {
    onDeny(gate.gateId);
  }, [gate.gateId, onDeny]);

  const toggleParams = useCallback(() => {
    setParamsExpanded((prev) => !prev);
  }, []);

  const statusClass =
    gate.status === 'approved'
      ? 'approval-gate-block--approved'
      : gate.status === 'denied'
        ? 'approval-gate-block--denied'
        : '';

  const categoryColor = getCategoryColor(gate.category);
  const hasParams = gate.params && Object.keys(gate.params).length > 0;

  return (
    <div
      className={`approval-gate-block ${statusClass}`}
      role="alert"
      aria-live="assertive"
      aria-label={`Approval gate: ${gate.action}`}
    >
      {/* Zone 1: Header */}
      <div className="approval-gate-block__header">
        <span className="approval-gate-block__shield" aria-hidden="true">
          {gate.status === 'approved' ? '✓' : gate.status === 'denied' ? '✕' : '🛡️'}
        </span>
        <span className="approval-gate-block__title">
          {gate.status === 'approved'
            ? 'Approved'
            : gate.status === 'denied'
              ? 'Denied'
              : 'Approval Required'}
        </span>
        {gate.status === 'approved' && (
          <span className="approval-gate-block__status-badge approval-gate-block__status-badge--approved">
            ✓
          </span>
        )}
        {gate.status === 'denied' && (
          <span className="approval-gate-block__status-badge approval-gate-block__status-badge--denied">
            ✕
          </span>
        )}
      </div>

      {/* Zone 2: Action Summary */}
      <div className="approval-gate-block__action-summary">
        <span
          className="approval-gate-block__tool-badge"
          style={{ borderColor: categoryColor, color: categoryColor }}
        >
          {gate.tool}
        </span>
        <span className="approval-gate-block__action-desc">{gate.action}</span>
      </div>

      {/* Zone 3: Risk Explanation */}
      <div className="approval-gate-block__risk">
        <span className="approval-gate-block__risk-icon" aria-hidden="true">
          ⚠️
        </span>
        <span className="approval-gate-block__risk-text">{gate.riskExplanation}</span>
      </div>

      {/* Collapsible Parameters Section */}
      {hasParams && (
        <div className="approval-gate-block__params-section">
          <button
            className="approval-gate-block__params-toggle"
            onClick={toggleParams}
            aria-expanded={paramsExpanded}
            aria-controls={`params-${gate.gateId}`}
          >
            <span className={`approval-gate-block__params-chevron ${paramsExpanded ? 'expanded' : ''}`}>
              ▶
            </span>
            View parameters
          </button>
          {paramsExpanded && (
            <pre
              className="approval-gate-block__params-code"
              id={`params-${gate.gateId}`}
            >
              {JSON.stringify(gate.params, null, 2)}
            </pre>
          )}
        </div>
      )}

      {/* Zone 4: Action Buttons (only when pending) */}
      {gate.status === 'pending' && (
        <div className="approval-gate-block__actions">
          <button
            className="approval-gate-block__approve-btn"
            onClick={handleApprove}
            aria-label="Approve this operation"
          >
            Approve
          </button>
          <button
            className="approval-gate-block__deny-btn"
            onClick={handleDeny}
            aria-label="Deny this operation"
          >
            Deny
          </button>
        </div>
      )}
    </div>
  );
}
