/**
 * ApprovalGateCard Component
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 *
 * Displays an approval gate for high-risk agent operations.
 * Shows proposed action, tool, parameters, and risk explanation.
 * Supports approve/deny workflows with optional denial reason.
 *
 * Requirements: 6.2, 6.3, 6.4, 6.8
 */
import { useState, useCallback } from 'react';
import './ApprovalGateCard.css';

type ApprovalGateCardProps = {
  gateId: string;
  sessionId: string;
  action: string;
  tool: string;
  params: Record<string, unknown>;
  riskExplanation: string;
  status?: 'pending' | 'approved' | 'denied';
  onApproved?: () => void;
  onDenied?: (reason?: string) => void;
};

export function ApprovalGateCard({
  gateId,
  sessionId,
  action,
  tool,
  params,
  riskExplanation,
  status = 'pending',
  onApproved,
  onDenied,
}: ApprovalGateCardProps) {
  const [loading, setLoading] = useState(false);
  const [showDenialForm, setShowDenialForm] = useState(false);
  const [denialReason, setDenialReason] = useState('');

  const handleApprove = useCallback(async () => {
    setLoading(true);
    try {
      const result = await window.electronAPI?.approveAgentGate(sessionId, gateId);
      if (result?.success) {
        onApproved?.();
      }
    } finally {
      setLoading(false);
    }
  }, [sessionId, gateId, onApproved]);

  const handleDenyClick = useCallback(() => {
    setShowDenialForm(true);
  }, []);

  const handleCancelDeny = useCallback(() => {
    setShowDenialForm(false);
    setDenialReason('');
  }, []);

  const handleConfirmDeny = useCallback(async () => {
    setLoading(true);
    try {
      const reason = denialReason.trim() || undefined;
      const result = await window.electronAPI?.denyAgentGate(sessionId, gateId, reason);
      if (result?.success) {
        onDenied?.(reason);
      }
    } finally {
      setLoading(false);
    }
  }, [sessionId, gateId, denialReason, onDenied]);

  const statusClass = status !== 'pending' ? `status-${status}` : '';

  return (
    <div className={`approval-gate-card ${statusClass}`} role="alert" aria-live="assertive">
      {/* Header */}
      <div className="approval-gate-header">
        <span className="approval-gate-icon" aria-hidden="true">
          {status === 'approved' ? '✓' : status === 'denied' ? '✕' : '⚠'}
        </span>
        <h4 className="approval-gate-title">
          {status === 'approved'
            ? 'Approved'
            : status === 'denied'
              ? 'Action Denied'
              : 'Approval Required — High-Risk Operation'}
        </h4>
      </div>

      {/* Action & Tool */}
      <div className="approval-gate-action-section">
        <span className="approval-gate-label">Proposed Action</span>
        <span className="approval-gate-action">{action}</span>
        <span className="approval-gate-tool">Tool: {tool}</span>
      </div>

      {/* Parameters */}
      <div className="approval-gate-params">
        <pre>{formatParams(params)}</pre>
      </div>

      {/* Risk Explanation */}
      <div className="approval-gate-risk">
        <span className="approval-gate-risk-icon" aria-hidden="true">⚠</span>
        <span>{riskExplanation}</span>
      </div>

      {/* Status-specific content */}
      {status === 'pending' && !showDenialForm && (
        <div className="approval-gate-actions">
          <button
            className="approval-gate-approve"
            onClick={handleApprove}
            disabled={loading}
            aria-label="Approve this operation"
          >
            Approve
          </button>
          <button
            className="approval-gate-deny"
            onClick={handleDenyClick}
            disabled={loading}
            aria-label="Deny this operation"
          >
            Deny
          </button>
        </div>
      )}

      {status === 'pending' && showDenialForm && (
        <div className="approval-gate-denial-form">
          <input
            className="approval-gate-denial-input"
            type="text"
            placeholder="Reason for denial (optional)"
            value={denialReason}
            onChange={(e) => setDenialReason(e.target.value)}
            disabled={loading}
            aria-label="Denial reason"
          />
          <div className="approval-gate-denial-actions">
            <button
              className="approval-gate-confirm-deny"
              onClick={handleConfirmDeny}
              disabled={loading}
            >
              Confirm Deny
            </button>
            <button
              className="approval-gate-cancel-deny"
              onClick={handleCancelDeny}
              disabled={loading}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {status === 'approved' && (
        <div className="approval-gate-confirmation approved" aria-live="polite">
          <span className="approval-gate-confirmation-icon" aria-hidden="true">✓</span>
          <span>Approved — proceeding...</span>
        </div>
      )}

      {status === 'denied' && (
        <div className="approval-gate-confirmation denied" aria-live="polite">
          <span className="approval-gate-confirmation-icon" aria-hidden="true">✕</span>
          <span>Action skipped — agent is re-planning</span>
        </div>
      )}
    </div>
  );
}

/**
 * Format parameters object for display.
 * Shows key-value pairs in a readable format.
 */
function formatParams(params: Record<string, unknown>): string {
  const entries = Object.entries(params);
  if (entries.length === 0) return '(no parameters)';

  return entries
    .map(([key, value]) => {
      const formatted = typeof value === 'string'
        ? value
        : JSON.stringify(value, null, 2);
      return `${key}: ${formatted}`;
    })
    .join('\n');
}
