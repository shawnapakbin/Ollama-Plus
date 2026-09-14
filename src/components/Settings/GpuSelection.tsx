/**
 * GpuSelection — Settings surface for viewing detected GPUs and choosing
 * which device(s) the app may use for local inference (or CPU-only).
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 *
 * Loads the reconciled GPU selection state on open, renders one row per
 * detected device with an allow/disallow toggle, supports single- and
 * multi-select plus a "CPU only" (deselect-all) affordance, and persists the
 * choice through the runtime client. It also renders every state message the
 * requirements call for: empty-success CPU note, detection error, unavailable
 * devices, per-device applied state, CPU-only indication, the unmanaged-server
 * note, and the applied-state retrieval problem / last-known-state messaging
 * that clears on the next successful load.
 *
 * Requirements: 1.5, 1.6, 1.7, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 5.4,
 * 6.1, 6.2, 6.3, 6.4, 6.5, 6.6
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Cpu, RefreshCw, Save, AlertTriangle, CircleAlert, Info, MonitorCog } from 'lucide-react';
import { runtimeClient } from '../../services/runtimeClient';
import type { DetectedGpu, GpuSelectionState } from '../../services/runtimeClient';
import './GpuSelection.css';

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * How often to poll the reconciled selection state so the displayed
 * allowed/disallowed state reflects applied-config changes within the 2s
 * window required by Requirement 6.2.
 */
const REFRESH_INTERVAL_MS = 2000;

// ─── Types ───────────────────────────────────────────────────────────────────

type SaveFeedback = {
  type: 'success' | 'info' | 'error';
  message: string;
} | null;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Derive the initially-checked device indices from a loaded selection state.
 * Mirrors the applied config: an explicit allowed set drives the toggles, while
 * the "allow all" sentinel (mode 'all') pre-checks every detected device so the
 * user sees the state that is actually in effect.
 */
function deriveSelectedIndices(state: GpuSelectionState): Set<number> {
  const detected = state.detection.ok ? state.detection.gpus.map((g) => g.index) : [];

  if (state.effective.mode === 'cpu-only') {
    return new Set();
  }

  if (state.effective.mode === 'all') {
    return new Set(detected);
  }

  // 'subset' — reflect the persisted allowed indices intersected with detected.
  const detectedSet = new Set(detected);
  const allowed = state.config.allowedIndices.filter((i) => detectedSet.has(i));
  return new Set(allowed);
}

function formatIndexList(indices: number[]): string {
  return indices.slice().sort((a, b) => a - b).join(', ');
}

// ─── Component ───────────────────────────────────────────────────────────────

export function GpuSelection() {
  // Last successfully loaded state. Retained across failed reloads so the UI can
  // keep showing the last good picture while flagging a retrieval problem
  // (Requirement 6.5 / 6.6).
  const [state, setState] = useState<GpuSelectionState | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  // True when the most recent retrieval could not determine the applied state
  // (either the load threw or appliedStateAvailable was false).
  const [retrievalProblem, setRetrievalProblem] = useState(false);
  const [feedback, setFeedback] = useState<SaveFeedback>(null);

  // Guard so a background refresh does not stomp on edits the user is making.
  const dirtyRef = useRef(false);

  // ── Load / reconcile selection state ───────────────────────────────────────
  const loadState = useCallback(async (opts: { syncSelection: boolean }) => {
    try {
      const next = await runtimeClient.getGpuSelectionState();

      if (next.appliedStateAvailable === false) {
        // Applied state could not be determined: retain the last displayed state
        // and surface a retrieval-problem indication (Requirement 6.5). We still
        // adopt the detection/config portion if we have nothing else to show.
        setRetrievalProblem(true);
        setState((prev) => prev ?? next);
        return;
      }

      // Successful retrieval clears any prior retrieval-problem messaging
      // (Requirement 6.6).
      setRetrievalProblem(false);
      setState(next);

      // Only sync the toggle selection from the server when explicitly asked
      // (initial load / manual refresh) or when the user has no pending edits.
      if (opts.syncSelection || !dirtyRef.current) {
        setSelected(deriveSelectedIndices(next));
        dirtyRef.current = false;
      }
    } catch {
      // Retrieval failed entirely: keep the last good state, flag the problem.
      setRetrievalProblem(true);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await loadState({ syncSelection: true });
      if (!cancelled) {
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadState]);

  // ── Poll so applied-config changes are reflected within 2s (R6.2) ──────────
  useEffect(() => {
    const timer = setInterval(() => {
      // Skip while the user is mid-edit or a save is in flight.
      if (dirtyRef.current || saving) {
        return;
      }
      void loadState({ syncSelection: false });
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [loadState, saving]);

  // ── Clear save feedback after 4s ───────────────────────────────────────────
  useEffect(() => {
    if (feedback) {
      const timer = setTimeout(() => setFeedback(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [feedback]);

  // ── Derived view data ──────────────────────────────────────────────────────
  const detection = state?.detection ?? null;
  const gpus = useMemo<DetectedGpu[]>(() => (detection?.ok ? detection.gpus : []), [detection]);
  // `unavailable` is the neutral, non-failure degraded state: no strategy could
  // run at all. It must NOT surface the hard "GPU detection failed" alert and
  // must keep the feature usable (Requirement 2.5).
  const detectionUnavailable = detection?.ok === false && detection.kind === 'unavailable';
  // Hard failures are only `timeout` and `failed` — these keep the role="alert"
  // block (Requirements 3.3, 3.4).
  const detectionFailed = detection?.ok === false && detection.kind !== 'unavailable';
  const emptySuccess = detection?.ok === true && gpus.length === 0;

  const unavailableIndices = state?.effective.unavailableIndices ?? [];
  const isCpuOnly = selected.size === 0 && gpus.length > 0;
  const appliedCpuOnly = state?.effective.mode === 'cpu-only';

  // The set of indices the applied config currently allows, for the per-device
  // "allowed / disallowed" badge (Requirement 6.1).
  const appliedAllowed = useMemo(() => {
    if (!state) {
      return new Set<number>();
    }
    if (state.effective.mode === 'all') {
      return new Set(gpus.map((g) => g.index));
    }
    if (state.effective.mode === 'cpu-only') {
      return new Set<number>();
    }
    return new Set(state.effective.availableIndices);
  }, [state, gpus]);

  // ── Toggle handlers ────────────────────────────────────────────────────────
  const toggleDevice = useCallback((index: number) => {
    dirtyRef.current = true;
    setFeedback(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  const chooseCpuOnly = useCallback(() => {
    dirtyRef.current = true;
    setFeedback(null);
    setSelected(new Set());
  }, []);

  // ── Save / confirm ─────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    setSaving(true);
    setFeedback(null);

    const allowedIndices = Array.from(selected).sort((a, b) => a - b);
    const cpuOnly = allowedIndices.length === 0;

    try {
      const result = await runtimeClient.saveGpuSelection({ allowedIndices, cpuOnly });

      if (result.ok) {
        dirtyRef.current = false;
        if (result.cpuOnly) {
          // Requirement 2.5: confirm CPU-only mode.
          setFeedback({ type: 'info', message: 'Saved. Inference will run in CPU-only mode.' });
        } else {
          // Requirement 2.6: successful save.
          setFeedback({ type: 'success', message: 'GPU selection saved.' });
        }
        // Re-sync from the newly persisted config.
        await loadState({ syncSelection: true });
      } else if (result.reason === 'unavailable-device') {
        // Requirement 2.7: one or more selected GPUs are no longer available.
        const list = result.unavailableIndices?.length
          ? ` (index ${formatIndexList(result.unavailableIndices)})`
          : '';
        setFeedback({
          type: 'error',
          message: `One or more selected GPUs are no longer available${list}. Selection was not changed.`,
        });
        // Refresh so the newly-detected reality is reflected.
        await loadState({ syncSelection: true });
      } else {
        // Requirement 2.8 / 3.3: persist failure.
        setFeedback({
          type: 'error',
          message: 'The GPU selection could not be saved. Your previous selection is unchanged.',
        });
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'The GPU selection could not be saved.',
      });
    } finally {
      setSaving(false);
    }
  }, [selected, loadState]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setFeedback(null);
    await loadState({ syncSelection: true });
    setRefreshing(false);
  }, [loadState]);

  // ── Loading state ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="gpu-selection">
        <div className="gpu-selection-header">
          <h2 className="gpu-selection-title">GPU Selection</h2>
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>Detecting GPUs…</p>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="gpu-selection" role="form" aria-label="GPU selection settings">
      <div className="gpu-selection-header">
        <h2 className="gpu-selection-title">GPU Selection</h2>
        <button
          className="gpu-selection-refresh"
          onClick={handleRefresh}
          disabled={refreshing || saving}
          type="button"
          aria-label="Re-detect GPUs"
        >
          <RefreshCw size={12} />
          {refreshing ? 'Detecting…' : 'Re-detect'}
        </button>
      </div>

      {/* ─── Applied-state retrieval problem (R6.5) ──────────────────────────── */}
      {retrievalProblem && (
        <div className="gpu-selection-notice warning" role="status">
          <AlertTriangle size={15} />
          <div className="gpu-selection-notice-body">
            <span className="gpu-selection-notice-title">Applied GPU state unavailable</span>
            <span>
              The current applied GPU state could not be retrieved. Showing the last known state until
              detection succeeds again.
            </span>
          </div>
        </div>
      )}

      {/* ─── Unmanaged-server note (R6.4) ────────────────────────────────────── */}
      <div className="gpu-selection-notice info" role="note">
        <Info size={15} />
        <div className="gpu-selection-notice-body">
          <span>
            GPU selection changes affect only the request options this app sends. Server-level device
            availability is controlled by the Ollama server.
          </span>
        </div>
      </div>

      {/* ─── Detection error (R1.7) ──────────────────────────────────────────── */}
      {detectionFailed && (
        <div className="gpu-selection-notice error" role="alert">
          <CircleAlert size={15} />
          <div className="gpu-selection-notice-body">
            <span className="gpu-selection-notice-title">GPU detection failed</span>
            <span>
              {detection && detection.ok === false && detection.error
                ? detection.error
                : 'The system could not enumerate GPUs. Check that your graphics drivers are installed and working.'}
            </span>
          </div>
        </div>
      )}

      {/* ─── Detection unavailable — neutral, usable state (R2.5) ────────────── */}
      {detectionUnavailable && (
        <div className="gpu-selection-notice muted" role="status">
          <Info size={15} />
          <div className="gpu-selection-notice-body">
            <span className="gpu-selection-notice-title">GPU detection unavailable</span>
            <span>
              No GPU detection tool was available on this system, so devices could not be listed
              automatically. GPU selection changes affect only the request options this app sends, so
              you can still continue — run on CPU below, and detection will retry on the next re-detect.
            </span>
          </div>
        </div>
      )}

      {/* ─── Empty-success CPU message (R1.6) ────────────────────────────────── */}
      {emptySuccess && (
        <div className="gpu-selection-notice muted" role="status">
          <Cpu size={15} />
          <div className="gpu-selection-notice-body">
            <span className="gpu-selection-notice-title">No GPU detected</span>
            <span>No GPU was detected on this system. Inference will run on CPU.</span>
          </div>
        </div>
      )}

      {/* ─── Unavailable-device list (R5.4) ──────────────────────────────────── */}
      {unavailableIndices.length > 0 && (
        <div className="gpu-selection-notice warning" role="status">
          <AlertTriangle size={15} />
          <div className="gpu-selection-notice-body">
            <span className="gpu-selection-notice-title">Previously selected GPUs unavailable</span>
            <span>
              These previously selected device {unavailableIndices.length === 1 ? 'index is' : 'indices are'} no
              longer detected: {formatIndexList(unavailableIndices)}.
            </span>
          </div>
        </div>
      )}

      {/* ─── CPU-only applied indication (R6.3) ──────────────────────────────── */}
      {appliedCpuOnly && (
        <div className="gpu-selection-notice info" role="status">
          <Cpu size={15} />
          <div className="gpu-selection-notice-body">
            <span>Inference is currently running in CPU-only mode.</span>
          </div>
        </div>
      )}

      {/* ─── Usable path for the unavailable state (R2.5) ────────────────────── */}
      {detectionUnavailable && (
        <section className="gpu-selection-section">
          <div className="gpu-selection-cpu-row">
            <button
              className="gpu-selection-cpu-btn active"
              onClick={chooseCpuOnly}
              type="button"
              aria-pressed={selected.size === 0}
            >
              <Cpu size={13} />
              CPU only (deselect all)
            </button>
            <span className="gpu-selection-device-status">
              <MonitorCog size={12} /> No GPU allowed — inference will run on CPU.
            </span>
          </div>
          <div className="gpu-selection-save-area">
            <button
              className="gpu-selection-save-btn"
              onClick={handleSave}
              disabled={saving}
              type="button"
            >
              <Save size={14} />
              {saving ? 'Saving…' : 'Save Selection'}
            </button>
            {feedback && (
              <span className={`gpu-selection-save-feedback ${feedback.type}`} role="status">
                {feedback.message}
              </span>
            )}
          </div>
        </section>
      )}

      {/* ─── Device list (R1.5, R2.1–2.4, R6.1) ──────────────────────────────── */}
      {gpus.length > 0 && (
        <section className="gpu-selection-section">
          <h3 className="gpu-selection-section-title">Detected GPUs</h3>
          <div className="gpu-selection-device-list">
            {gpus.map((gpu) => {
              const isSelected = selected.has(gpu.index);
              const isApplied = appliedAllowed.has(gpu.index);
              return (
                <div
                  className={`gpu-selection-device${isSelected ? ' allowed' : ''}`}
                  key={gpu.index}
                >
                  <span className="gpu-selection-device-index" aria-hidden="true">
                    #{gpu.index}
                  </span>
                  <div className="gpu-selection-device-info">
                    <span className="gpu-selection-device-name" title={gpu.name}>
                      {gpu.name}
                    </span>
                    <div className="gpu-selection-device-status">
                      <span>Index {gpu.index}</span>
                      <span
                        className={`gpu-selection-device-badge ${isApplied ? 'allowed' : 'disallowed'}`}
                      >
                        {isApplied ? 'Applied: allowed' : 'Applied: disallowed'}
                      </span>
                    </div>
                  </div>
                  <div
                    className="gpu-selection-toggle"
                    onClick={() => toggleDevice(gpu.index)}
                    role="switch"
                    aria-checked={isSelected}
                    aria-label={`Allow GPU ${gpu.index} (${gpu.name})`}
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggleDevice(gpu.index);
                      }
                    }}
                  >
                    <div className={`gpu-selection-toggle-track${isSelected ? ' active' : ''}`}>
                      <div className="gpu-selection-toggle-thumb" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* ─── CPU-only affordance (R2.4) ────────────────────────────────── */}
          <div className="gpu-selection-cpu-row">
            <button
              className={`gpu-selection-cpu-btn${isCpuOnly ? ' active' : ''}`}
              onClick={chooseCpuOnly}
              disabled={isCpuOnly}
              type="button"
              aria-pressed={isCpuOnly}
            >
              <Cpu size={13} />
              CPU only (deselect all)
            </button>
            {isCpuOnly && (
              <span className="gpu-selection-device-status">
                <MonitorCog size={12} /> No GPU allowed — inference will run on CPU.
              </span>
            )}
          </div>
        </section>
      )}

      {/* ─── Save / confirm (R2.5–2.8) ───────────────────────────────────────── */}
      {gpus.length > 0 && (
        <div className="gpu-selection-save-area">
          <button
            className="gpu-selection-save-btn"
            onClick={handleSave}
            disabled={saving}
            type="button"
          >
            <Save size={14} />
            {saving ? 'Saving…' : 'Save Selection'}
          </button>
          {feedback && (
            <span className={`gpu-selection-save-feedback ${feedback.type}`} role="status">
              {feedback.message}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
