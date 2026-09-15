/**
 * StartPrompt — the launch-time Start_Prompt modal.
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 *
 * A modal dialog presented when the launch reachability probe classifies the
 * configured endpoint as offline AND local. It asks the user whether to start
 * the local Ollama server, offering an affirmative action (Start) that triggers
 * the start flow and a negative action (Not now) that dismisses the dialog and
 * leaves the app usable (the header Status_Pill continues to reflect offline).
 *
 * This component is presentational: it renders when `open` is true and reports
 * the user's choice upward through `onConfirm` / `onDismiss`. The parent
 * (`App.tsx`) owns the decision of when to open it (offline+local on launch,
 * never online, never for a Remote_Endpoint) and the actual start flow.
 *
 * Requirements: 2.1, 2.4, 2.5, 4.3
 */
import { useCallback, useEffect, useRef } from 'react';
import { Play, X } from 'lucide-react';
import './StartPrompt.css';

export type StartPromptProps = {
  /** Whether the modal is presented. */
  open: boolean;
  /** The (normalized) endpoint URL, shown for context. */
  endpoint?: string;
  /** Invoked when the user chooses the affirmative (Start) action (R2.4). */
  onConfirm: () => void;
  /** Invoked when the user chooses the negative (dismiss) action (R2.5). */
  onDismiss: () => void;
  /**
   * Reflects an in-flight start attempt. While busy the affirmative action is
   * disabled so the start is not triggered twice (R4.3).
   */
  busy?: boolean;
};

export function StartPrompt({ open, endpoint, onConfirm, onDismiss, busy = false }: StartPromptProps) {
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  const handleDismiss = useCallback(() => {
    if (busy) return;
    onDismiss();
  }, [busy, onDismiss]);

  // Dismiss on Escape so the dialog is easily dismissible (unless a start is in
  // flight, in which case the user waits for the outcome).
  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleDismiss();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, handleDismiss]);

  // Move focus to the affirmative action when the dialog opens.
  useEffect(() => {
    if (open) {
      confirmRef.current?.focus();
    }
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div className="start-prompt-overlay" onMouseDown={handleDismiss}>
      <div
        className="start-prompt"
        role="dialog"
        aria-modal="true"
        aria-labelledby="start-prompt-title"
        aria-describedby="start-prompt-body"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="start-prompt-head">
          <h2 id="start-prompt-title" className="start-prompt-title">
            Start the Ollama server?
          </h2>
          <button
            type="button"
            className="start-prompt-close"
            onClick={handleDismiss}
            disabled={busy}
            aria-label="Dismiss"
          >
            <X size={16} />
          </button>
        </div>

        <p id="start-prompt-body" className="start-prompt-body">
          The local Ollama server is not running. Would you like Ollama&nbsp;+ to start it for you?
        </p>

        {endpoint ? <span className="start-prompt-endpoint">{endpoint}</span> : null}

        <div className="start-prompt-actions">
          <button type="button" className="start-prompt-dismiss" onClick={handleDismiss} disabled={busy}>
            Not now
          </button>
          <button
            ref={confirmRef}
            type="button"
            className="start-prompt-confirm"
            onClick={onConfirm}
            disabled={busy}
          >
            <Play size={14} />
            {busy ? 'Starting…' : 'Start server'}
          </button>
        </div>
      </div>
    </div>
  );
}
