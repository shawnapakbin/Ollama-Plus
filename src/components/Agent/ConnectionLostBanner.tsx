/**
 * ConnectionLostBanner Component
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 *
 * Displays an inline connection-lost banner at the bottom of the Agent Chat Stream
 * when the connection to the Ollama endpoint is lost during streaming.
 * Features a pulsing red dot, "Connection lost" text, and a "Retry" button.
 * Auto-dismisses on reconnection (parent sets isVisible to false).
 *
 * Requirements: 6.6, 11.6
 */
import './ConnectionLostBanner.css';

// ─── Props ───────────────────────────────────────────────────────────────────

export interface ConnectionLostBannerProps {
  /** Whether the banner is visible (connection is lost) */
  isVisible: boolean;
  /** Callback triggered when the user clicks Retry */
  onRetry: () => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ConnectionLostBanner({ isVisible, onRetry }: ConnectionLostBannerProps) {
  if (!isVisible) {
    return null;
  }

  return (
    <div
      className="connection-lost-banner"
      role="alert"
      aria-live="assertive"
    >
      {/* Pulsing red dot indicator */}
      <span className="connection-lost-banner__dot" aria-hidden="true" />

      {/* Status text */}
      <span className="connection-lost-banner__text">
        Connection lost
      </span>

      {/* Retry button */}
      <button
        className="connection-lost-banner__retry"
        onClick={onRetry}
        type="button"
        aria-label="Retry connection"
      >
        <span className="connection-lost-banner__retry-icon" aria-hidden="true">↻</span>
        Retry
      </button>
    </div>
  );
}
