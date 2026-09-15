/**
 * SendInterceptPrompt — the send-time Send_Intercept_Prompt modal.
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 *
 * A modal dialog presented when the user attempts to send a chat message while
 * the configured endpoint is offline (Server_Unreachable). Instead of silently
 * dropping the prompt, Ollama + intercepts the send: it preserves the composed
 * content and any attachments (the parent owns that state and does NOT clear it)
 * and asks the user how to proceed.
 *
 *  • For a Local_Endpoint it offers a Start action + Cancel (R6.3). Choosing
 *    Start runs the start flow; on success the parent dispatches the preserved
 *    message (R6.5), on failure the parent retains the content and this dialog
 *    surfaces the failure via `startError` (R6.6).
 *  • For a Remote_Endpoint it explains that the server is not reachable and
 *    cannot be started by this app, offering Cancel only — no Start (R6.4).
 *
 * This component is presentational: it renders when `open` is true and reports
 * the user's choice upward through `onStart` / `onCancel`. The parent
 * (`App.tsx`) owns when to open it (offline send), the composer preservation,
 * and the actual start + dispatch flow.
 *
 * Requirements: 6.1, 6.3, 6.4, 6.6, 6.7
 */
import { useCallback, useEffect, useRef } from 'react';
import { Play, X } from 'lucide-react';
import './SendInterceptPrompt.css';

export type SendInterceptPromptProps = {
  /** Whether the modal is presented. */
  open: boolean;
  /**
   * Classification of the configured endpoint. Gates the Start affordance:
   * only a Local_Endpoint gets a Start action (R6.3); a Remote_Endpoint gets
   * Cancel only with an unreachable message (R6.4).
   */
  endpointKind?: EndpointKind | null;
  /** The (normalized) endpoint URL, shown for context. */
  endpoint?: string;
  /**
   * Reflects an in-flight start attempt. While busy the Start action is
   * disabled so the start is not triggered twice.
   */
  busy?: boolean;
  /**
   * A start failure to surface in the prompt when a start attempt failed so the
   * user understands why their message was not dispatched (R6.6).
   */
  startError?: string | null;
  /** Invoked when the user chooses to start the server (only meaningful for local) (R6.5/R6.6). */
  onStart: () => void;
  /** Invoked when the user chooses to cancel the send (R6.7). */
  onCancel: () => void;
};

export function SendInterceptPrompt({
  open,
  endpointKind,
  endpoint,
  busy = false,
  startError = null,
  onStart,
  onCancel,
}: SendInterceptPromptProps) {
  const primaryRef = useRef<HTMLButtonElement | null>(null);

  const isLocal = endpointKind === 'local';

  const handleCancel = useCallback(() => {
    if (busy) return;
    onCancel();
  }, [busy, onCancel]);

  // Dismiss on Escape (cancel) so the dialog is easily dismissible (unless a
  // start is in flight, in which case the user waits for the outcome).
  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleCancel();
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, handleCancel]);

  // Move focus to the primary action when the dialog opens.
  useEffect(() => {
    if (open) {
      primaryRef.current?.focus();
    }
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div className="send-intercept-overlay" onMouseDown={handleCancel}>
      <div
        className="send-intercept"
        role="dialog"
        aria-modal="true"
        aria-labelledby="send-intercept-title"
        aria-describedby="send-intercept-body"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="send-intercept-head">
          <h2 id="send-intercept-title" className="send-intercept-title">
            {isLocal ? 'Start the Ollama server to send?' : 'Ollama server is not reachable'}
          </h2>
          <button
            type="button"
            className="send-intercept-close"
            onClick={handleCancel}
            disabled={busy}
            aria-label="Cancel"
          >
            <X size={16} />
          </button>
        </div>

        <p id="send-intercept-body" className="send-intercept-body">
          {isLocal
            ? 'The local Ollama server is not running, so your message was not sent. Start the server to send it, or cancel to keep editing — your message is kept.'
            : 'The Ollama server at this endpoint is not reachable and cannot be started by this app. Your message was not sent and is kept in the composer.'}
        </p>

        {endpoint ? <span className="send-intercept-endpoint">{endpoint}</span> : null}

        {startError ? (
          <p className="send-intercept-error" role="alert">
            {startError}
          </p>
        ) : null}

        <div className="send-intercept-actions">
          <button
            ref={isLocal ? undefined : primaryRef}
            type="button"
            className="send-intercept-cancel"
            onClick={handleCancel}
            disabled={busy}
          >
            Cancel
          </button>
          {isLocal ? (
            <button
              ref={primaryRef}
              type="button"
              className="send-intercept-start"
              onClick={onStart}
              disabled={busy}
            >
              <Play size={14} />
              {busy ? 'Starting…' : 'Start and send'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
