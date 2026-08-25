/**
 * InspectorPanel Component
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 *
 * Sidebar panel displaying the full execution plan with step states,
 * produced artifacts, and memory records with edit/delete capabilities.
 *
 * Requirements: 8.5, 12.5
 */
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  FileText,
  Loader,
  Pencil,
  Trash2,
} from 'lucide-react';
import type { Artifact, MemoryRecord, Plan } from '../../types/agent';
import './InspectorPanel.css';

// ─── Props ───────────────────────────────────────────────────────────────────

export interface InspectorPanelProps {
  /** The current execution plan */
  plan?: Plan;
  /** ID of the currently executing step */
  activeStepId?: string;
  /** IDs of completed steps */
  completedStepIds?: string[];
  /** Artifacts produced during the session */
  artifacts?: Artifact[];
  /** Memory records for the session */
  memoryRecords?: MemoryRecord[];
  /** Callback to edit a memory record */
  onEditMemory?: (record: MemoryRecord) => void;
  /** Callback to delete a memory record */
  onDeleteMemory?: (recordId: string) => void;
  /** Whether the panel is collapsed */
  collapsed?: boolean;
  /** Toggle collapse callback */
  onToggleCollapse?: () => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTimestamp(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  } catch {
    return '--:--';
  }
}

type StepState = 'completed' | 'active' | 'pending';

function getStepState(
  stepId: string,
  activeStepId?: string,
  completedStepIds?: string[]
): StepState {
  if (completedStepIds?.includes(stepId)) return 'completed';
  if (stepId === activeStepId) return 'active';
  return 'pending';
}

// ─── Sub-Components ──────────────────────────────────────────────────────────

function StepIcon({ state }: { state: StepState }) {
  switch (state) {
    case 'completed':
      return (
        <div className="inspector-panel__step-icon inspector-panel__step-icon--completed">
          <CheckCircle2 size={16} aria-hidden="true" />
        </div>
      );
    case 'active':
      return (
        <div className="inspector-panel__step-icon inspector-panel__step-icon--active">
          <Loader size={16} aria-hidden="true" />
        </div>
      );
    case 'pending':
      return (
        <div className="inspector-panel__step-icon inspector-panel__step-icon--pending">
          <Circle size={16} aria-hidden="true" />
        </div>
      );
  }
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function InspectorPanel({
  plan,
  activeStepId,
  completedStepIds,
  artifacts,
  memoryRecords,
  onEditMemory,
  onDeleteMemory,
  collapsed = false,
  onToggleCollapse,
}: InspectorPanelProps) {
  const steps = plan?.steps ?? [];

  return (
    <aside
      className={`inspector-panel${collapsed ? ' inspector-panel--collapsed' : ''}`}
      aria-label="Inspector panel"
    >
      {/* Collapse toggle */}
      <button
        className="inspector-panel__toggle"
        onClick={onToggleCollapse}
        type="button"
        aria-label={collapsed ? 'Expand inspector panel' : 'Collapse inspector panel'}
      >
        {collapsed ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
      </button>

      {/* Panel content - hidden when collapsed */}
      {!collapsed && (
        <div className="inspector-panel__content">
          {/* ─── Plan View ──────────────────────────────────────────────── */}
          <section className="inspector-panel__section" aria-label="Execution plan">
            <div className="inspector-panel__section-header">
              <span className="inspector-panel__section-title">Plan</span>
              {steps.length > 0 && (
                <span className="inspector-panel__section-count">{steps.length}</span>
              )}
            </div>

            {steps.length === 0 ? (
              <div className="inspector-panel__empty">No plan generated yet</div>
            ) : (
              <div className="inspector-panel__steps" role="list" aria-label="Plan steps">
                {steps.map((step) => {
                  const state = getStepState(step.id, activeStepId, completedStepIds);
                  return (
                    <div
                      key={step.id}
                      className={`inspector-panel__step inspector-panel__step--${state}`}
                      role="listitem"
                    >
                      <StepIcon state={state} />
                      <div className="inspector-panel__step-body">
                        <div className="inspector-panel__step-title">{step.title}</div>
                        <div className="inspector-panel__step-meta">
                          <span className={`inspector-panel__step-status inspector-panel__step-status--${state}`}>
                            {state === 'completed' ? 'Completed' : state === 'active' ? 'Active' : 'Pending'}
                          </span>
                          <span className={`inspector-panel__step-risk inspector-panel__step-risk--${step.riskLevel}`}>
                            {step.riskLevel}
                          </span>
                        </div>
                        {step.requiredTools.length > 0 && (
                          <div className="inspector-panel__step-tools">
                            {step.requiredTools.map((tool) => (
                              <span key={`${step.id}-${tool.name}`} className="inspector-panel__step-tool">
                                {tool.name}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* ─── Artifacts Section ──────────────────────────────────────── */}
          <section className="inspector-panel__section" aria-label="Artifacts">
            <div className="inspector-panel__section-header">
              <span className="inspector-panel__section-title">Artifacts</span>
              {artifacts && artifacts.length > 0 && (
                <span className="inspector-panel__section-count">{artifacts.length}</span>
              )}
            </div>

            {!artifacts || artifacts.length === 0 ? (
              <div className="inspector-panel__empty">No artifacts produced</div>
            ) : (
              <div className="inspector-panel__artifacts" role="list" aria-label="Produced artifacts">
                {artifacts.map((artifact) => (
                  <div key={artifact.id} className="inspector-panel__artifact" role="listitem">
                    <FileText size={14} className="inspector-panel__artifact-icon" aria-hidden="true" />
                    <div className="inspector-panel__artifact-body">
                      <div className="inspector-panel__artifact-path">{artifact.filePath}</div>
                      <div className="inspector-panel__artifact-meta">
                        <span className={`inspector-panel__artifact-operation inspector-panel__artifact-operation--${artifact.operation}`}>
                          {artifact.operation}
                        </span>
                        <span className="inspector-panel__artifact-size">
                          {formatFileSize(artifact.size)}
                        </span>
                        <span className="inspector-panel__artifact-time">
                          {formatTimestamp(artifact.timestamp)}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ─── Memory Records Section ─────────────────────────────────── */}
          <section className="inspector-panel__section" aria-label="Memory records">
            <div className="inspector-panel__section-header">
              <span className="inspector-panel__section-title">Memory</span>
              {memoryRecords && memoryRecords.length > 0 && (
                <span className="inspector-panel__section-count">{memoryRecords.length}</span>
              )}
            </div>

            {!memoryRecords || memoryRecords.length === 0 ? (
              <div className="inspector-panel__empty">No memory records</div>
            ) : (
              <div className="inspector-panel__memory-records" role="list" aria-label="Memory records">
                {memoryRecords.map((record) => (
                  <div key={record.id} className="inspector-panel__memory-record" role="listitem">
                    <div className="inspector-panel__memory-body">
                      <div className="inspector-panel__memory-fact">{record.fact}</div>
                      <div className="inspector-panel__memory-meta">
                        {record.tags.map((tag) => (
                          <span key={`${record.id}-${tag}`} className="inspector-panel__memory-tag">
                            {tag}
                          </span>
                        ))}
                        <span className="inspector-panel__memory-score">
                          {record.importanceScore}
                        </span>
                      </div>
                    </div>
                    <div className="inspector-panel__memory-actions">
                      {onEditMemory && (
                        <button
                          className="inspector-panel__memory-action-btn"
                          onClick={() => onEditMemory(record)}
                          type="button"
                          aria-label={`Edit memory record: ${record.fact.slice(0, 30)}`}
                        >
                          <Pencil size={13} />
                        </button>
                      )}
                      {onDeleteMemory && (
                        <button
                          className="inspector-panel__memory-action-btn inspector-panel__memory-action-btn--delete"
                          onClick={() => onDeleteMemory(record.id)}
                          type="button"
                          aria-label={`Delete memory record: ${record.fact.slice(0, 30)}`}
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </aside>
  );
}
