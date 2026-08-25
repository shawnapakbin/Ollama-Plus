/**
 * AgentSettings — Configuration panel for the Agent client.
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 *
 * Manages: working directory, timeouts, retry count, auto-approval,
 * per-tool timeout overrides, and custom approval rules.
 * Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7
 */
import { useCallback, useEffect, useState } from 'react';
import { Save, Plus, Pencil, Trash2, Check, X } from 'lucide-react';
import type { AgentConfig, ApprovalRule, ToolTimeouts } from '../../types/agent';
import './AgentSettings.css';

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULTS: AgentConfig = {
  defaultWorkingDirectory: '',
  stepTimeout: 120,
  taskTimeout: 900,
  retryCount: 3,
  autoApprovalLowRisk: false,
  customApprovalRules: [],
  toolTimeouts: {
    terminal: 60,
    file: 30,
    browser: 120,
    python: 60,
    http: 30,
  },
};

const RANGES = {
  stepTimeout: { min: 30, max: 600 },
  taskTimeout: { min: 60, max: 3600 },
  retryCount: { min: 0, max: 10 },
} as const;

const MAX_RULES = 50;
const MAX_RULE_PATTERN_LENGTH = 500;

const TOOL_TIMEOUT_LABELS: Record<keyof ToolTimeouts, string> = {
  terminal: 'Terminal',
  file: 'File',
  browser: 'Browser',
  python: 'Python',
  http: 'HTTP',
};

// ─── Types ───────────────────────────────────────────────────────────────────

type FieldErrors = Record<string, string>;

type RuleFormState = {
  pattern: string;
  type: 'glob' | 'regex';
  description: string;
};

type SaveFeedback = {
  type: 'success' | 'error';
  message: string;
} | null;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function validateConfig(config: AgentConfig): FieldErrors {
  const errors: FieldErrors = {};

  if (config.stepTimeout < RANGES.stepTimeout.min || config.stepTimeout > RANGES.stepTimeout.max) {
    errors.stepTimeout = `Step timeout must be between ${RANGES.stepTimeout.min} and ${RANGES.stepTimeout.max} seconds.`;
  }

  if (config.taskTimeout < RANGES.taskTimeout.min || config.taskTimeout > RANGES.taskTimeout.max) {
    errors.taskTimeout = `Task timeout must be between ${RANGES.taskTimeout.min} and ${RANGES.taskTimeout.max} seconds.`;
  }

  if (config.retryCount < RANGES.retryCount.min || config.retryCount > RANGES.retryCount.max) {
    errors.retryCount = `Retry count must be between ${RANGES.retryCount.min} and ${RANGES.retryCount.max}.`;
  }

  if (config.customApprovalRules.length > MAX_RULES) {
    errors.rules = `Maximum ${MAX_RULES} custom approval rules allowed.`;
  }

  // Validate tool timeouts are positive numbers
  for (const [key, value] of Object.entries(config.toolTimeouts)) {
    if (typeof value !== 'number' || value <= 0 || !Number.isFinite(value)) {
      errors[`toolTimeout_${key}`] = `${TOOL_TIMEOUT_LABELS[key as keyof ToolTimeouts]} timeout must be a positive number.`;
    }
  }

  return errors;
}

function validateRuleForm(form: RuleFormState): FieldErrors {
  const errors: FieldErrors = {};

  if (!form.pattern.trim()) {
    errors.rulePattern = 'Pattern is required.';
  } else if (form.pattern.length > MAX_RULE_PATTERN_LENGTH) {
    errors.rulePattern = `Pattern must be ${MAX_RULE_PATTERN_LENGTH} characters or fewer.`;
  }

  return errors;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function AgentSettings() {
  // ── State ──────────────────────────────────────────────────────────────────
  const [config, setConfig] = useState<AgentConfig>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [feedback, setFeedback] = useState<SaveFeedback>(null);

  // Rule editor state
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [showRuleForm, setShowRuleForm] = useState(false);
  const [ruleForm, setRuleForm] = useState<RuleFormState>({ pattern: '', type: 'glob', description: '' });
  const [ruleFormErrors, setRuleFormErrors] = useState<FieldErrors>({});

  // ── Load config on mount ───────────────────────────────────────────────────
  useEffect(() => {
    async function loadConfig() {
      try {
        const savedConfig = await window.electronAPI!.getAgentConfig();
        setConfig({ ...DEFAULTS, ...savedConfig });
      } catch {
        // Use defaults if loading fails
        setConfig(DEFAULTS);
      } finally {
        setLoading(false);
      }
    }
    loadConfig();
  }, []);

  // ── Clear feedback after 4s ────────────────────────────────────────────────
  useEffect(() => {
    if (feedback) {
      const timer = setTimeout(() => setFeedback(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [feedback]);

  // ── Field update helpers ───────────────────────────────────────────────────
  const updateField = useCallback(<K extends keyof AgentConfig>(field: K, value: AgentConfig[K]) => {
    setConfig((prev) => ({ ...prev, [field]: value }));
    // Clear field-level error when user edits
    setErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
    setFeedback(null);
  }, []);

  const updateToolTimeout = useCallback((tool: keyof ToolTimeouts, value: number) => {
    setConfig((prev) => ({
      ...prev,
      toolTimeouts: { ...prev.toolTimeouts, [tool]: value },
    }));
    setErrors((prev) => {
      const next = { ...prev };
      delete next[`toolTimeout_${tool}`];
      return next;
    });
    setFeedback(null);
  }, []);

  // ── Save config ────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    const validationErrors = validateConfig(config);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      setFeedback({ type: 'error', message: 'Please fix the errors before saving.' });
      return;
    }

    setSaving(true);
    setErrors({});
    setFeedback(null);

    try {
      const result = await window.electronAPI!.saveAgentConfig(config);
      if (result.errors && result.errors.length > 0) {
        setFeedback({ type: 'error', message: result.errors.join('; ') });
      } else {
        setFeedback({ type: 'success', message: 'Configuration saved. Applied without restart.' });
        if (result.savedConfig) {
          setConfig(result.savedConfig);
        }
      }
    } catch (err) {
      setFeedback({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to save configuration.',
      });
    } finally {
      setSaving(false);
    }
  }, [config]);

  // ── Rule management ────────────────────────────────────────────────────────
  const openAddRule = useCallback(() => {
    setRuleForm({ pattern: '', type: 'glob', description: '' });
    setRuleFormErrors({});
    setEditingRuleId(null);
    setShowRuleForm(true);
  }, []);

  const openEditRule = useCallback((rule: ApprovalRule) => {
    setRuleForm({ pattern: rule.pattern, type: rule.type, description: rule.description });
    setRuleFormErrors({});
    setEditingRuleId(rule.id);
    setShowRuleForm(true);
  }, []);

  const cancelRuleForm = useCallback(() => {
    setShowRuleForm(false);
    setEditingRuleId(null);
    setRuleForm({ pattern: '', type: 'glob', description: '' });
    setRuleFormErrors({});
  }, []);

  const saveRule = useCallback(() => {
    const formErrors = validateRuleForm(ruleForm);
    if (Object.keys(formErrors).length > 0) {
      setRuleFormErrors(formErrors);
      return;
    }

    setConfig((prev) => {
      let newRules: ApprovalRule[];
      if (editingRuleId) {
        // Update existing rule
        newRules = prev.customApprovalRules.map((r) =>
          r.id === editingRuleId
            ? { ...r, pattern: ruleForm.pattern.trim(), type: ruleForm.type, description: ruleForm.description.trim() }
            : r
        );
      } else {
        // Add new rule
        const newRule: ApprovalRule = {
          id: generateId(),
          pattern: ruleForm.pattern.trim(),
          type: ruleForm.type,
          description: ruleForm.description.trim(),
        };
        newRules = [...prev.customApprovalRules, newRule];
      }
      return { ...prev, customApprovalRules: newRules };
    });

    cancelRuleForm();
    setFeedback(null);
  }, [ruleForm, editingRuleId, cancelRuleForm]);

  const deleteRule = useCallback((ruleId: string) => {
    setConfig((prev) => ({
      ...prev,
      customApprovalRules: prev.customApprovalRules.filter((r) => r.id !== ruleId),
    }));
    setFeedback(null);
  }, []);

  // ── Loading state ──────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="agent-settings">
        <h2 className="agent-settings-title">Agent Configuration</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>Loading configuration...</p>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="agent-settings" role="form" aria-label="Agent configuration settings">
      <h2 className="agent-settings-title">Agent Configuration</h2>

      {/* ─── General Settings ──────────────────────────────────────────────── */}
      <section className="agent-settings-section">
        <h3 className="agent-settings-section-title">General</h3>

        <div className="agent-settings-field">
          <label htmlFor="agent-default-workdir">Default Working Directory</label>
          <input
            id="agent-default-workdir"
            type="text"
            value={config.defaultWorkingDirectory}
            onChange={(e) => updateField('defaultWorkingDirectory', e.target.value)}
            placeholder="/path/to/default/project"
            autoComplete="off"
          />
        </div>

        <div className="agent-settings-field">
          <label htmlFor="agent-step-timeout">Step Timeout (seconds)</label>
          <input
            id="agent-step-timeout"
            type="number"
            min={RANGES.stepTimeout.min}
            max={RANGES.stepTimeout.max}
            value={config.stepTimeout}
            onChange={(e) => updateField('stepTimeout', Number(e.target.value))}
            className={errors.stepTimeout ? 'field-error' : ''}
            aria-invalid={!!errors.stepTimeout}
            aria-describedby={errors.stepTimeout ? 'err-step-timeout' : undefined}
          />
          <span className="agent-settings-field-hint">Range: {RANGES.stepTimeout.min}–{RANGES.stepTimeout.max}s (default: 120s)</span>
          {errors.stepTimeout && (
            <span className="agent-settings-field-error" id="err-step-timeout" role="alert">{errors.stepTimeout}</span>
          )}
        </div>

        <div className="agent-settings-field">
          <label htmlFor="agent-task-timeout">Task Timeout (seconds)</label>
          <input
            id="agent-task-timeout"
            type="number"
            min={RANGES.taskTimeout.min}
            max={RANGES.taskTimeout.max}
            value={config.taskTimeout}
            onChange={(e) => updateField('taskTimeout', Number(e.target.value))}
            className={errors.taskTimeout ? 'field-error' : ''}
            aria-invalid={!!errors.taskTimeout}
            aria-describedby={errors.taskTimeout ? 'err-task-timeout' : undefined}
          />
          <span className="agent-settings-field-hint">Range: {RANGES.taskTimeout.min}–{RANGES.taskTimeout.max}s (default: 900s)</span>
          {errors.taskTimeout && (
            <span className="agent-settings-field-error" id="err-task-timeout" role="alert">{errors.taskTimeout}</span>
          )}
        </div>

        <div className="agent-settings-field">
          <label htmlFor="agent-retry-count">Retry Count</label>
          <input
            id="agent-retry-count"
            type="number"
            min={RANGES.retryCount.min}
            max={RANGES.retryCount.max}
            value={config.retryCount}
            onChange={(e) => updateField('retryCount', Number(e.target.value))}
            className={errors.retryCount ? 'field-error' : ''}
            aria-invalid={!!errors.retryCount}
            aria-describedby={errors.retryCount ? 'err-retry-count' : undefined}
          />
          <span className="agent-settings-field-hint">Range: {RANGES.retryCount.min}–{RANGES.retryCount.max} (default: 3)</span>
          {errors.retryCount && (
            <span className="agent-settings-field-error" id="err-retry-count" role="alert">{errors.retryCount}</span>
          )}
        </div>

        <div className="agent-settings-field">
          <div
            className="agent-settings-toggle"
            onClick={() => updateField('autoApprovalLowRisk', !config.autoApprovalLowRisk)}
            role="switch"
            aria-checked={config.autoApprovalLowRisk}
            aria-label="Auto-approve low-risk operations"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                updateField('autoApprovalLowRisk', !config.autoApprovalLowRisk);
              }
            }}
          >
            <div className={`agent-settings-toggle-track${config.autoApprovalLowRisk ? ' active' : ''}`}>
              <div className="agent-settings-toggle-thumb" />
            </div>
            <span className="agent-settings-toggle-label">Auto-approve low-risk operations</span>
          </div>
          <span className="agent-settings-field-hint">
            When enabled, read-only file access, searches, and non-destructive commands proceed without approval.
            Custom approval rules still take precedence.
          </span>
        </div>
      </section>

      {/* ─── Per-Tool Timeouts ─────────────────────────────────────────────── */}
      <section className="agent-settings-section">
        <h3 className="agent-settings-section-title">Tool Timeouts (seconds)</h3>
        <div className="agent-settings-tool-grid">
          {(Object.keys(TOOL_TIMEOUT_LABELS) as Array<keyof ToolTimeouts>).map((tool) => (
            <div className="agent-settings-tool-item" key={tool}>
              <label htmlFor={`agent-tool-timeout-${tool}`}>{TOOL_TIMEOUT_LABELS[tool]}</label>
              <input
                id={`agent-tool-timeout-${tool}`}
                type="number"
                min={1}
                value={config.toolTimeouts[tool]}
                onChange={(e) => updateToolTimeout(tool, Number(e.target.value))}
                className={errors[`toolTimeout_${tool}`] ? 'field-error' : ''}
                aria-invalid={!!errors[`toolTimeout_${tool}`]}
              />
              {errors[`toolTimeout_${tool}`] && (
                <span className="agent-settings-field-error" role="alert">{errors[`toolTimeout_${tool}`]}</span>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ─── Custom Approval Rules ─────────────────────────────────────────── */}
      <section className="agent-settings-section">
        <div className="agent-settings-rules-header">
          <h3 className="agent-settings-section-title" style={{ border: 'none', paddingBottom: 0 }}>
            Custom Approval Rules
          </h3>
          <span className="agent-settings-rules-count">
            {config.customApprovalRules.length} / {MAX_RULES}
          </span>
          <button
            className="agent-settings-add-rule"
            onClick={openAddRule}
            disabled={config.customApprovalRules.length >= MAX_RULES}
            type="button"
            aria-label="Add approval rule"
          >
            <Plus size={12} />
            Add Rule
          </button>
        </div>

        {errors.rules && (
          <span className="agent-settings-field-error" role="alert">{errors.rules}</span>
        )}

        {/* Rule form (add or edit) */}
        {showRuleForm && (
          <div className="agent-settings-rule-form" aria-label={editingRuleId ? 'Edit approval rule' : 'Add approval rule'}>
            <div className="agent-settings-rule-form-row">
              <div className="agent-settings-rule-form-field">
                <label htmlFor="rule-pattern-input">Pattern</label>
                <input
                  id="rule-pattern-input"
                  type="text"
                  value={ruleForm.pattern}
                  onChange={(e) => {
                    setRuleForm((f) => ({ ...f, pattern: e.target.value }));
                    setRuleFormErrors((prev) => { const n = { ...prev }; delete n.rulePattern; return n; });
                  }}
                  placeholder="e.g. rm -rf * or /deploy.*/i"
                  maxLength={MAX_RULE_PATTERN_LENGTH}
                  aria-invalid={!!ruleFormErrors.rulePattern}
                />
                {ruleFormErrors.rulePattern && (
                  <span className="agent-settings-field-error" role="alert">{ruleFormErrors.rulePattern}</span>
                )}
              </div>
              <div className="agent-settings-rule-form-field">
                <label htmlFor="rule-type-select">Type</label>
                <select
                  id="rule-type-select"
                  value={ruleForm.type}
                  onChange={(e) => setRuleForm((f) => ({ ...f, type: e.target.value as 'glob' | 'regex' }))}
                >
                  <option value="glob">Glob</option>
                  <option value="regex">Regex</option>
                </select>
              </div>
            </div>
            <div className="agent-settings-rule-form-field">
              <label htmlFor="rule-description-input">Description (optional)</label>
              <input
                id="rule-description-input"
                type="text"
                value={ruleForm.description}
                onChange={(e) => setRuleForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Why this rule requires approval..."
              />
            </div>
            <div className="agent-settings-rule-form-actions">
              <button className="agent-settings-rule-form-cancel" onClick={cancelRuleForm} type="button">
                <X size={12} /> Cancel
              </button>
              <button
                className="agent-settings-rule-form-save"
                onClick={saveRule}
                disabled={!ruleForm.pattern.trim()}
                type="button"
              >
                <Check size={12} /> {editingRuleId ? 'Update' : 'Add'}
              </button>
            </div>
          </div>
        )}

        {/* Rules list */}
        {config.customApprovalRules.length === 0 && !showRuleForm ? (
          <div className="agent-settings-rules-empty">
            No custom approval rules configured. Add rules to require approval for specific command patterns.
          </div>
        ) : (
          <div className="agent-settings-rules-list">
            {config.customApprovalRules.map((rule) => (
              <div className="agent-settings-rule-item" key={rule.id}>
                <div className="agent-settings-rule-info">
                  <span className="agent-settings-rule-pattern" title={rule.pattern}>{rule.pattern}</span>
                  <div className="agent-settings-rule-meta">
                    <span className="agent-settings-rule-type">{rule.type}</span>
                    {rule.description && <span>{rule.description}</span>}
                  </div>
                </div>
                <div className="agent-settings-rule-actions">
                  <button
                    className="agent-settings-rule-btn"
                    onClick={() => openEditRule(rule)}
                    aria-label={`Edit rule: ${rule.pattern}`}
                    type="button"
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    className="agent-settings-rule-btn delete"
                    onClick={() => deleteRule(rule.id)}
                    aria-label={`Delete rule: ${rule.pattern}`}
                    type="button"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ─── Save Button ───────────────────────────────────────────────────── */}
      <div className="agent-settings-save-area">
        <button
          className="agent-settings-save-btn"
          onClick={handleSave}
          disabled={saving}
          type="button"
        >
          <Save size={14} />
          {saving ? 'Saving...' : 'Save Configuration'}
        </button>
        {feedback && (
          <span className={`agent-settings-save-feedback ${feedback.type}`} role="status">
            {feedback.message}
          </span>
        )}
      </div>
    </div>
  );
}
