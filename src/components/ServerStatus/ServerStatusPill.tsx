/**
 * ServerStatusPill — the header Status_Pill and its dismissible Status_Popup.
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 *
 * A centered header indicator that communicates the current Ollama server
 * reachability state (checking / starting / online / offline). Activating the
 * pill opens a small, non-modal, dismissible popup that describes the current
 * state and — only for an offline Local_Endpoint — offers a Start action wired
 * to a caller-provided `onStartServer` handler. For an offline Remote_Endpoint
 * the popup explains the server is not reachable and offers no start action.
 *
 * This component is presentational: it renders whatever `status` /
 * `endpointKind` it is given and reports the Start intent upward. The launch
 * reachability probe (task 6.2) and the actual start flow (task 7.1) are wired
 * by the parent (`App.tsx`) through props.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, CircleOff, Loader2, Play, X } from 'lucide-react';
import './ServerStatusPill.css';

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Renderer-only view state derived from a ReachabilityResult and any in-flight
 * start attempt. Kept in sync with the `ServerStatus` type in design.md.
 */
export type ServerStatus = 'checking' | 'starting' | 'online' | 'offline';

export type ServerStatusPillProps = {
  /** Current reachability / start view state. */
  status: ServerStatus;
  /**
   * Kind of the configured endpoint. Gates the Start affordance: only a
   * `'local'` endpoint that is offline gets a Start action (R5.7 / R5.8).
   * `null` when the kind is not yet known (e.g. before the first probe).
   */
  endpointKind?: EndpointKind | null;
  /** The (normalized) endpoint URL, shown in the popup for context. */
  endpoint?: string;
  /**
   * Invoked when the user activates the Start action for an offline local
   * endpoint. The parent owns the real start flow (task 7.1); this component
   * only surfaces the intent.
   */
  onStartServer?: () => void;
  /** Optional failure message to surface in the popup (e.g. a failed start). */
  startError?: string | null;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

type StatePresentation = {
  label: string;
  title: string;
  body: string;
};

function describeState(status: ServerStatus, endpointKind: EndpointKind | null | undefined): StatePresentation {
  switch (status) {
    case 'checking':
      return {
        label: 'Checking…',
        title: 'Checking server',
        body: 'Checking whether the Ollama server is reachable.',
      };
    case 'starting':
      return {
        label: 'Starting…',
        title: 'Starting server',
        body: 'Starting the local Ollama server and waiting for it to become reachable.',
      };
    case 'online':
      return {
        label: 'Online',
        title: 'Server online',
        body: 'The Ollama server is reachable.',
      };
    case 'offline':
    default:
      return {
        label: 'Offline',
        title: 'Server offline',
        body:
          endpointKind === 'remote'
            ? 'The remote Ollama server is not reachable. This app cannot start a server on another machine — check that the remote server is running and the endpoint is correct.'
            : 'The local Ollama server is not running.',
      };
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ServerStatusPill({
  status,
  endpointKind = null,
  endpoint,
  onStartServer,
  startError = null,
}: ServerStatusPillProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const presentation = describeState(status, endpointKind);

  // Offer the Start action only for an offline Local_Endpoint (R5.7 / R5.8).
  const canStart = status === 'offline' && endpointKind === 'local' && typeof onStartServer === 'function';

  const closePopup = useCallback(() => setOpen(false), []);
  const togglePopup = useCallback(() => setOpen((current) => !current), []);

  // Dismiss on outside click / Escape so the popup is easily dismissible (R5.6).
  useEffect(() => {
    if (!open) {
      return;
    }
    const handlePointer = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const handleStart = useCallback(() => {
    onStartServer?.();
  }, [onStartServer]);

  const inProgress = status === 'checking' || status === 'starting';

  return (
    <div className="server-status" ref={containerRef}>
      <button
        type="button"
        className={`server-status-pill ${status}`}
        onClick={togglePopup}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Ollama server status: ${presentation.label}. Show details.`}
        title={presentation.title}
      >
        {inProgress ? (
          <Loader2 size={13} className="spinning" aria-hidden="true" />
        ) : status === 'online' ? (
          <CheckCircle2 size={13} aria-hidden="true" />
        ) : (
          <CircleOff size={13} aria-hidden="true" />
        )}
        <span>{presentation.label}</span>
      </button>

      {open ? (
        <div className="server-status-popup" role="dialog" aria-label="Ollama server status details">
          <div className="server-status-popup-head">
            <h3 className="server-status-popup-title">{presentation.title}</h3>
            <button
              type="button"
              className="server-status-popup-close"
              onClick={closePopup}
              aria-label="Dismiss"
            >
              <X size={15} />
            </button>
          </div>

          <p className="server-status-popup-body">{presentation.body}</p>

          {endpoint ? <span className="server-status-popup-endpoint">{endpoint}</span> : null}

          {startError ? <p className="server-status-popup-body">{startError}</p> : null}

          {canStart ? (
            <button
              type="button"
              className="server-status-popup-start"
              onClick={handleStart}
              disabled={status === 'starting'}
            >
              <Play size={14} />
              Start local server
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
