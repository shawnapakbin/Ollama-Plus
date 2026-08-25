/**
 * InspectorPanel Component
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 *
 * Collapsible right sidebar displaying the full execution plan (with connected
 * vertical timeline), produced artifacts, and memory records. Synchronizes
 * with the Agent Chat Stream — clicking a step scrolls the chat to the
 * corresponding tool-use or reasoning block.
 *
 * Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6
 */
import { useState } from 'react';
import {
  Brain,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  ClipboardList,
  FileText,
  FolderOpen,
  Loader,
  PanelRight,
} from 'lucide-react';
import type { Artifact, MemoryRecord, Plan } from '../../types/agent';
import './InspectorPanel.css';

// ─── Props ───────────────────────────────────────────────────────────────────

export interface InspectorPanelProps {
  /** The current execution plan */
  plan: Plan | null;
  /** ID of the currently executing step */
  activeStepId: string | undefined;
  /** IDs of completed steps */
  completedStepIds: string[];
  /** Artifacts produced during the session */
  artifacts: Array<{ id: string; name: string; path: string; type: string }>;
  /** Memory records for the session */
  memoryRecords: Array<{ id: string; key: string; value: string }>;
  /** Whether the panel is collapsed */
  collapsed: boolean;
  /** Toggle collapse callback */
  onToggleCollapse: () => void;
  /** Callback when a step is clicked — scrolls chat to corresponding block */
  onStepClick: (stepId: string) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

type StepState = 'completed' | 'active' | 'pending';

function getStepState(
  stepId: string,
  activeStepId: string | undefined,
  completedStepIds: string[]
): StepState {
  if (completedStepIds.includes(stepId)) return 'completed';
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

// ─── Section Header (collapsible) ────────────────────────────────────────────

interface SectionHeaderProps {
  title: string;
  count?: number;
  expanded: boolean;
  onToggle: () => void;
}

function SectionHeader({ title, count, expanded, onToggle }: SectionHeaderProps) {
  return (
    <button
      className="inspector-panel__section-header"
      onClick={onToggle}
      type="button"
      aria-expanded={expanded}
    >
      <span className="inspector-panel__section-title">{title}</span>
      {count !== undefined && count > 0 && (
        <span className="inspector-panel__section-count">{count}</span>
      )}
      <span
        className={`inspector-panel__section-chevron${expanded ? ' inspector-panel__section-chevron--open' : ''}`}
      >
        <ChevronRight size={12} />
      </span>
    </button>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function InspectorPanel({
  plan,
  activeStepId,
  completedStepIds,
  artifacts,
  memoryRecords,
  collapsed,
  onToggleCollapse,
  onStepClick,
}: InspectorPanelProps) {
  const steps = plan?.steps ?? [];

  // Section expand/collapse state
  const [planExpanded, setPlanExpanded] = useState(true);
  const [artifactsExpanded, setArtifactsExpanded] = useState(true);
  const [memoryExpanded, setMemoryExpanded] = useState(true);

  return (
    <>
      {/* Floating toggle for small viewports (below 768px) */}
      <button
        className="inspector-panel__floating-toggle"
        onClick={onToggleCollapse}
        type="button"
        aria-label="Toggle inspector panel"
      >
        <PanelRight size={18} />
      </button>

      <aside
        className={`inspector-panel${collapsed ? ' inspector-panel--collapsed' : ''}`}
        aria-label="Inspector panel"
      >
        {/* ─── Collapsed Icon Strip ─────────────────────────────────────── */}
        {collapsed && (
          <div className="inspector-panel__icon-strip">
            <button
              className="inspector-panel__icon-strip-btn"
              onClick={onToggleCollapse}
              type="button"
              aria-label="Expand inspector panel"
              title="Expand"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              className="inspector-panel__icon-strip-btn"
              onClick={onToggleCollapse}
              type="button"
              aria-label="Show plan"
              title="Plan"
            >
              <ClipboardList size={16} />
            </button>
            <button
              className="inspector-panel__icon-strip-btn"
              onClick={onToggleCollapse}
              type="button"
              aria-label="Show artifacts"
              title="Artifacts"
            >
              <FolderOpen size={16} />
            </button>
            <button
              className="inspector-panel__icon-strip-btn"
              onClick={onToggleCollapse}
              type="button"
              aria-label="Show memory"
              title="Memory"
            >
              <Brain size={16} />
            </button>
          </div>
        )}

        {/* ─── Expanded Panel Content ───────────────────────────────────── */}
        {!collapsed && (
          <div className="inspector-panel__content">
            {/* Collapse toggle at top */}
            <button
              className="inspector-panel__toggle"
              onClick={onToggleCollapse}
              type="button"
              aria-label="Collapse inspector panel"
            >
              <ChevronRight size={16} />
              <span className="inspector-panel__toggle-label">Inspector</span>
            </button>

            {/* ─── Plan Section ────────────────────────────────────────── */}
            <section className="inspector-panel__section" aria-label="Execution plan">
              <SectionHeader
                title="Plan"
                count={steps.length}
                expanded={planExpanded}
                onToggle={() => setPlanExpanded((v) => !v)}
              />

              {planExpanded && (
                <div className="inspector-panel__section-body">
                  {steps.length === 0 ? (
                    <div className="inspector-panel__empty">No plan generated yet</div>
                  ) : (
                    <div className="inspector-panel__steps" role="list" aria-label="Plan steps">
                      {steps.map((step) => {
                        const state = getStepState(step.id, activeStepId, completedStepIds);
                        return (
                          <button
                            key={step.id}
                            className={`inspector-panel__step inspector-panel__step--${state}`}
                            role="listitem"
                            type="button"
                            onClick={() => onStepClick(step.id)}
                            aria-label={`Step: ${step.title} (${state})`}
                          >
                            <StepIcon state={state} />
                            <div className="inspector-panel__step-body">
                              <div className="inspector-panel__step-title">{step.title}</div>
                              <div className="inspector-panel__step-status-label">
                                {state === 'completed'
                                  ? 'Completed'
                                  : state === 'active'
                                    ? 'Running...'
                                    : 'Pending'}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* ─── Artifacts Section ───────────────────────────────────── */}
            <section className="inspector-panel__section" aria-label="Artifacts">
              <SectionHeader
                title="Artifacts"
                count={artifacts.length}
                expanded={artifactsExpanded}
                onToggle={() => setArtifactsExpanded((v) => !v)}
              />

              {artifactsExpanded && (
                <div className="inspector-panel__section-body">
                  {artifacts.length === 0 ? (
                    <div className="inspector-panel__empty">No artifacts produced</div>
                  ) : (
                    <div
                      className="inspector-panel__artifacts"
                      role="list"
                      aria-label="Produced artifacts"
                    >
                      {artifacts.map((artifact) => (
                        <div
                          key={artifact.id}
                          className="inspector-panel__artifact"
                          role="listitem"
                        >
                          <FileText
                            size={14}
                            className="inspector-panel__artifact-icon"
                            aria-hidden="true"
                          />
                          <div className="inspector-panel__artifact-body">
                            <div className="inspector-panel__artifact-name">{artifact.name}</div>
                            <div className="inspector-panel__artifact-path">{artifact.path}</div>
                          </div>
                          <span className="inspector-panel__artifact-type">{artifact.type}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* ─── Memory Section ──────────────────────────────────────── */}
            <section className="inspector-panel__section" aria-label="Memory records">
              <SectionHeader
                title="Memory"
                count={memoryRecords.length}
                expanded={memoryExpanded}
                onToggle={() => setMemoryExpanded((v) => !v)}
              />

              {memoryExpanded && (
                <div className="inspector-panel__section-body">
                  {memoryRecords.length === 0 ? (
                    <div className="inspector-panel__empty">No memory records</div>
                  ) : (
                    <div
                      className="inspector-panel__memory-records"
                      role="list"
                      aria-label="Memory records"
                    >
                      {memoryRecords.map((record) => (
                        <div
                          key={record.id}
                          className="inspector-panel__memory-record"
                          role="listitem"
                        >
                          <div className="inspector-panel__memory-key">{record.key}</div>
                          <div className="inspector-panel__memory-value">{record.value}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>
          </div>
        )}
      </aside>
    </>
  );
}
