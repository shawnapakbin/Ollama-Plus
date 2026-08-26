import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  DEFAULT_AGENT_CONFIG,
  validateAgentConfig,
  loadAgentConfig,
  saveAgentConfig
} from '../../../electron/runtime/agent/agentConfig.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

function createTempConfigPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-agent-prop-'));
  tempDirs.push(dir);
  return path.join(dir, 'agent-config.json');
}

// ─── Range constants matching agentConfig.js ─────────────────────────────────

const STEP_TIMEOUT_MIN = 30;
const STEP_TIMEOUT_MAX = 600;
const TASK_TIMEOUT_MIN = 60;
const TASK_TIMEOUT_MAX = 3600;
const RETRY_COUNT_MIN = 0;
const RETRY_COUNT_MAX = 10;
const MAX_APPROVAL_RULES = 50;
const MAX_PATTERN_LENGTH = 500;

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Generates a stepTimeout within the valid range [30, 600] */
const validStepTimeoutArb = fc.integer({ min: STEP_TIMEOUT_MIN, max: STEP_TIMEOUT_MAX });

/** Generates a stepTimeout outside the valid range */
const invalidStepTimeoutArb = fc.oneof(
  fc.integer({ min: -10000, max: STEP_TIMEOUT_MIN - 1 }),
  fc.integer({ min: STEP_TIMEOUT_MAX + 1, max: 100000 })
);

/** Generates a taskTimeout within the valid range [60, 3600] */
const validTaskTimeoutArb = fc.integer({ min: TASK_TIMEOUT_MIN, max: TASK_TIMEOUT_MAX });

/** Generates a taskTimeout outside the valid range */
const invalidTaskTimeoutArb = fc.oneof(
  fc.integer({ min: -10000, max: TASK_TIMEOUT_MIN - 1 }),
  fc.integer({ min: TASK_TIMEOUT_MAX + 1, max: 100000 })
);

/** Generates a retryCount within the valid range [0, 10] */
const validRetryCountArb = fc.integer({ min: RETRY_COUNT_MIN, max: RETRY_COUNT_MAX });

/** Generates a retryCount outside the valid range */
const invalidRetryCountArb = fc.oneof(
  fc.integer({ min: -10000, max: RETRY_COUNT_MIN - 1 }),
  fc.integer({ min: RETRY_COUNT_MAX + 1, max: 100000 })
);

/** Generates a valid approval rule type */
const validRuleTypeArb = fc.constantFrom('glob', 'regex');

/** Generates a valid approval rule pattern (1-500 chars, non-empty) */
const validPatternArb = fc.string({ minLength: 1, maxLength: MAX_PATTERN_LENGTH });

/** Generates an invalid pattern (too long, >500 chars) */
const invalidPatternArb = fc.string({ minLength: MAX_PATTERN_LENGTH + 1, maxLength: MAX_PATTERN_LENGTH + 100 });

/** Generates a single valid approval rule */
const validRuleArb = fc.record({
  id: fc.string({ minLength: 1, maxLength: 36 }),
  pattern: validPatternArb,
  type: validRuleTypeArb,
  description: fc.string({ minLength: 0, maxLength: 100 })
});

/** Generates a valid set of approval rules (0-50) */
const validRulesArrayArb = fc.array(validRuleArb, { minLength: 0, maxLength: MAX_APPROVAL_RULES });

/** Generates an invalid set with too many rules (51-60) */
const tooManyRulesArrayArb = fc.array(validRuleArb, { minLength: MAX_APPROVAL_RULES + 1, maxLength: MAX_APPROVAL_RULES + 10 });

/** Generates a complete valid config */
const validConfigArb = fc.record({
  stepTimeout: validStepTimeoutArb,
  taskTimeout: validTaskTimeoutArb,
  retryCount: validRetryCountArb
});

// ─── Property-Based Tests: Property 17 ──────────────────────────────────────

describe('agentConfig - Property 17: Configuration range validation', () => {
  /**
   * **Validates: Requirements 14.1, 14.4**
   *
   * For any configuration update, values outside permitted ranges SHALL be
   * rejected: stepTimeout must be in [30, 600], taskTimeout in [60, 3600],
   * retryCount in [0, 10], custom approval rules count in [0, 50], and each
   * rule pattern length in [1, 500]. When a value is rejected, the previous
   * valid value SHALL be retained.
   */

  // ─── Property 17a: Valid numeric values are always accepted ─────────────────

  it('accepts all stepTimeout values within [30, 600]', () => {
    fc.assert(
      fc.property(validStepTimeoutArb, (stepTimeout) => {
        const { valid, errors, sanitizedConfig } = validateAgentConfig({ stepTimeout });
        expect(valid).toBe(true);
        expect(errors).toHaveLength(0);
        expect(sanitizedConfig.stepTimeout).toBe(stepTimeout);
      }),
      { numRuns: 100 }
    );
  });

  it('accepts all taskTimeout values within [60, 3600]', () => {
    fc.assert(
      fc.property(validTaskTimeoutArb, (taskTimeout) => {
        const { valid, errors, sanitizedConfig } = validateAgentConfig({ taskTimeout });
        expect(valid).toBe(true);
        expect(errors).toHaveLength(0);
        expect(sanitizedConfig.taskTimeout).toBe(taskTimeout);
      }),
      { numRuns: 100 }
    );
  });

  it('accepts all retryCount values within [0, 10]', () => {
    fc.assert(
      fc.property(validRetryCountArb, (retryCount) => {
        const { valid, errors, sanitizedConfig } = validateAgentConfig({ retryCount });
        expect(valid).toBe(true);
        expect(errors).toHaveLength(0);
        expect(sanitizedConfig.retryCount).toBe(retryCount);
      }),
      { numRuns: 100 }
    );
  });

  // ─── Property 17b: Out-of-range numeric values are always rejected ──────────

  it('rejects all stepTimeout values outside [30, 600] and retains previous', () => {
    fc.assert(
      fc.property(
        invalidStepTimeoutArb,
        validStepTimeoutArb,
        (invalidValue, previousValue) => {
          const previous = { ...DEFAULT_AGENT_CONFIG, stepTimeout: previousValue };
          const { valid, errors, sanitizedConfig } = validateAgentConfig(
            { stepTimeout: invalidValue },
            previous
          );
          expect(valid).toBe(false);
          expect(errors.length).toBeGreaterThan(0);
          expect(errors.some(e => e.includes('stepTimeout'))).toBe(true);
          // Previous valid value is retained
          expect(sanitizedConfig.stepTimeout).toBe(previousValue);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('rejects all taskTimeout values outside [60, 3600] and retains previous', () => {
    fc.assert(
      fc.property(
        invalidTaskTimeoutArb,
        validTaskTimeoutArb,
        (invalidValue, previousValue) => {
          const previous = { ...DEFAULT_AGENT_CONFIG, taskTimeout: previousValue };
          const { valid, errors, sanitizedConfig } = validateAgentConfig(
            { taskTimeout: invalidValue },
            previous
          );
          expect(valid).toBe(false);
          expect(errors.length).toBeGreaterThan(0);
          expect(errors.some(e => e.includes('taskTimeout'))).toBe(true);
          expect(sanitizedConfig.taskTimeout).toBe(previousValue);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('rejects all retryCount values outside [0, 10] and retains previous', () => {
    fc.assert(
      fc.property(
        invalidRetryCountArb,
        validRetryCountArb,
        (invalidValue, previousValue) => {
          const previous = { ...DEFAULT_AGENT_CONFIG, retryCount: previousValue };
          const { valid, errors, sanitizedConfig } = validateAgentConfig(
            { retryCount: invalidValue },
            previous
          );
          expect(valid).toBe(false);
          expect(errors.length).toBeGreaterThan(0);
          expect(errors.some(e => e.includes('retryCount'))).toBe(true);
          expect(sanitizedConfig.retryCount).toBe(previousValue);
        }
      ),
      { numRuns: 100 }
    );
  });

  // ─── Property 17c: Custom approval rules count constraint ───────────────────

  it('accepts any set of 0-50 valid approval rules', () => {
    fc.assert(
      fc.property(validRulesArrayArb, (rules) => {
        const { valid, sanitizedConfig } = validateAgentConfig({ customApprovalRules: rules });
        expect(valid).toBe(true);
        expect(sanitizedConfig.customApprovalRules.length).toBe(rules.length);
      }),
      { numRuns: 100 }
    );
  });

  it('rejects any set exceeding 50 approval rules', () => {
    fc.assert(
      fc.property(tooManyRulesArrayArb, (rules) => {
        const { valid, errors } = validateAgentConfig({ customApprovalRules: rules });
        expect(valid).toBe(false);
        expect(errors.some(e => e.includes('50'))).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  // ─── Property 17d: Rule pattern length constraint ───────────────────────────

  it('accepts any rule pattern of length 1-500', () => {
    fc.assert(
      fc.property(validPatternArb, validRuleTypeArb, (pattern, type) => {
        const rules = [{ id: 'test-rule', pattern, type, description: '' }];
        const { valid } = validateAgentConfig({ customApprovalRules: rules });
        expect(valid).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('rejects any rule pattern exceeding 500 characters', () => {
    fc.assert(
      fc.property(invalidPatternArb, validRuleTypeArb, (pattern, type) => {
        const rules = [{ id: 'test-rule', pattern, type, description: '' }];
        const { valid, errors } = validateAgentConfig({ customApprovalRules: rules });
        expect(valid).toBe(false);
        expect(errors.some(e => e.includes('500'))).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  // ─── Property 17e: Combined valid config is always accepted ─────────────────

  it('accepts any configuration where all values are within permitted ranges', () => {
    fc.assert(
      fc.property(validConfigArb, (config) => {
        const { valid, errors, sanitizedConfig } = validateAgentConfig(config);
        expect(valid).toBe(true);
        expect(errors).toHaveLength(0);
        expect(sanitizedConfig.stepTimeout).toBe(config.stepTimeout);
        expect(sanitizedConfig.taskTimeout).toBe(config.taskTimeout);
        expect(sanitizedConfig.retryCount).toBe(config.retryCount);
      }),
      { numRuns: 100 }
    );
  });

  // ─── Property 17f: Rejected values never corrupt persisted config ───────────

  it('rejected values never corrupt the persisted configuration (save/load round-trip)', () => {
    fc.assert(
      fc.property(
        validConfigArb,
        invalidStepTimeoutArb,
        (validConfig, invalidStep) => {
          const configPath = createTempConfigPath();

          // Save a valid config first
          const { savedConfig: initial } = saveAgentConfig(configPath, validConfig);
          expect(initial.stepTimeout).toBe(validConfig.stepTimeout);
          expect(initial.taskTimeout).toBe(validConfig.taskTimeout);
          expect(initial.retryCount).toBe(validConfig.retryCount);

          // Attempt to save invalid stepTimeout
          const { valid, savedConfig } = saveAgentConfig(configPath, { stepTimeout: invalidStep });
          expect(valid).toBe(false);
          // The saved config should retain the previous valid stepTimeout
          expect(savedConfig.stepTimeout).toBe(validConfig.stepTimeout);

          // Loading from disk should confirm persistence of valid values
          const loaded = loadAgentConfig(configPath);
          expect(loaded.stepTimeout).toBe(validConfig.stepTimeout);
          expect(loaded.taskTimeout).toBe(validConfig.taskTimeout);
          expect(loaded.retryCount).toBe(validConfig.retryCount);
        }
      ),
      { numRuns: 100 }
    );
  });

  // ─── Property 17g: Valid fields in a mixed config are accepted while invalid are rejected ──

  it('valid fields are accepted even when other fields in the same config are invalid', () => {
    fc.assert(
      fc.property(
        validStepTimeoutArb,
        invalidTaskTimeoutArb,
        validRetryCountArb,
        (stepTimeout, taskTimeout, retryCount) => {
          const { valid, errors, sanitizedConfig } = validateAgentConfig({
            stepTimeout,
            taskTimeout,
            retryCount
          });
          // Overall config is invalid due to taskTimeout
          expect(valid).toBe(false);
          expect(errors.some(e => e.includes('taskTimeout'))).toBe(true);
          // But valid fields are still accepted
          expect(sanitizedConfig.stepTimeout).toBe(stepTimeout);
          expect(sanitizedConfig.retryCount).toBe(retryCount);
          // Invalid taskTimeout retains the default
          expect(sanitizedConfig.taskTimeout).toBe(DEFAULT_AGENT_CONFIG.taskTimeout);
        }
      ),
      { numRuns: 100 }
    );
  });
});
