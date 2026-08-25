/**
 * Agent Configuration Validator and Persistence
 * Validates range constraints, custom approval rules, and persists config
 * via the existing runtimeStore.js pattern.
 *
 * Requirements: 14.1, 14.4, 14.5, 14.7, 14.8
 */
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Default agent configuration values (Requirement 14.8)
 */
export const DEFAULT_AGENT_CONFIG = Object.freeze({
  defaultWorkingDirectory: '',
  stepTimeout: 120,
  taskTimeout: 900,
  retryCount: 3,
  autoApprovalLowRisk: false,
  customApprovalRules: [],
  toolTimeouts: Object.freeze({
    terminal: 60,
    file: 30,
    browser: 120,
    python: 60,
    http: 30
  })
});

/**
 * Validation constraints for numeric config fields (Requirement 14.1)
 */
const RANGE_CONSTRAINTS = {
  stepTimeout: { min: 30, max: 600 },
  taskTimeout: { min: 60, max: 3600 },
  retryCount: { min: 0, max: 10 }
};

/**
 * Maximum number of custom approval rules (Requirement 14.4)
 */
const MAX_APPROVAL_RULES = 50;

/**
 * Maximum pattern length for a single approval rule (Requirement 14.4)
 */
const MAX_PATTERN_LENGTH = 500;

/**
 * Valid approval rule types
 */
const VALID_RULE_TYPES = ['glob', 'regex'];

/**
 * Validates a single numeric field against its range constraint.
 * Returns an error string if invalid, null if valid.
 */
function validateNumericField(fieldName, value, constraints) {
  if (value === undefined || value === null) {
    return null; // field not provided, will use previous/default
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return `${fieldName} must be a finite number, got: ${typeof value}`;
  }
  if (value < constraints.min || value > constraints.max) {
    return `${fieldName} must be between ${constraints.min} and ${constraints.max}, got: ${value}`;
  }
  return null;
}

/**
 * Validates a single approval rule.
 * Returns an error string if invalid, null if valid.
 */
function validateApprovalRule(rule, index) {
  if (!rule || typeof rule !== 'object') {
    return `customApprovalRules[${index}]: rule must be an object`;
  }
  if (typeof rule.pattern !== 'string' || rule.pattern.length === 0) {
    return `customApprovalRules[${index}]: pattern must be a non-empty string`;
  }
  if (rule.pattern.length > MAX_PATTERN_LENGTH) {
    return `customApprovalRules[${index}]: pattern must be at most ${MAX_PATTERN_LENGTH} characters, got: ${rule.pattern.length}`;
  }
  if (!VALID_RULE_TYPES.includes(rule.type)) {
    return `customApprovalRules[${index}]: type must be one of: ${VALID_RULE_TYPES.join(', ')}`;
  }
  return null;
}

/**
 * Validates a partial or complete agent configuration update.
 * Returns { valid, errors, sanitizedConfig } where sanitizedConfig merges
 * valid new values with the previous config (Requirement 14.7: rejected values retain previous).
 *
 * @param {object} config - The configuration values to validate
 * @param {object} [previousConfig] - The previous valid config (defaults to DEFAULT_AGENT_CONFIG)
 * @returns {{ valid: boolean, errors: string[], sanitizedConfig: object }}
 */
export function validateAgentConfig(config, previousConfig = DEFAULT_AGENT_CONFIG) {
  const errors = [];
  const sanitized = { ...previousConfig };

  if (!config || typeof config !== 'object') {
    return {
      valid: false,
      errors: ['Configuration must be an object'],
      sanitizedConfig: { ...previousConfig }
    };
  }

  // Validate numeric range fields
  for (const [field, constraints] of Object.entries(RANGE_CONSTRAINTS)) {
    if (field in config) {
      const error = validateNumericField(field, config[field], constraints);
      if (error) {
        errors.push(error);
        // Retain previous valid value (Requirement 14.7)
      } else {
        sanitized[field] = config[field];
      }
    }
  }

  // Validate defaultWorkingDirectory
  if ('defaultWorkingDirectory' in config) {
    if (typeof config.defaultWorkingDirectory === 'string') {
      sanitized.defaultWorkingDirectory = config.defaultWorkingDirectory;
    } else {
      errors.push('defaultWorkingDirectory must be a string');
    }
  }

  // Validate autoApprovalLowRisk
  if ('autoApprovalLowRisk' in config) {
    if (typeof config.autoApprovalLowRisk === 'boolean') {
      sanitized.autoApprovalLowRisk = config.autoApprovalLowRisk;
    } else {
      errors.push('autoApprovalLowRisk must be a boolean');
    }
  }

  // Validate customApprovalRules (Requirement 14.4)
  if ('customApprovalRules' in config) {
    if (!Array.isArray(config.customApprovalRules)) {
      errors.push('customApprovalRules must be an array');
    } else if (config.customApprovalRules.length > MAX_APPROVAL_RULES) {
      errors.push(`customApprovalRules must contain at most ${MAX_APPROVAL_RULES} rules, got: ${config.customApprovalRules.length}`);
    } else {
      const ruleErrors = [];
      const validRules = [];
      for (let i = 0; i < config.customApprovalRules.length; i++) {
        const rule = config.customApprovalRules[i];
        const ruleError = validateApprovalRule(rule, i);
        if (ruleError) {
          ruleErrors.push(ruleError);
        } else {
          validRules.push({
            id: (typeof rule.id === 'string' && rule.id.trim()) ? rule.id.trim() : randomUUID(),
            pattern: rule.pattern,
            type: rule.type,
            description: typeof rule.description === 'string' ? rule.description : ''
          });
        }
      }
      if (ruleErrors.length > 0) {
        errors.push(...ruleErrors);
        // Retain previous rules since the set is invalid
      } else {
        sanitized.customApprovalRules = validRules;
      }
    }
  }

  // Validate toolTimeouts
  if ('toolTimeouts' in config) {
    if (!config.toolTimeouts || typeof config.toolTimeouts !== 'object') {
      errors.push('toolTimeouts must be an object');
    } else {
      const validTimeouts = { ...sanitized.toolTimeouts };
      const validToolKeys = ['terminal', 'file', 'browser', 'python', 'http'];
      for (const key of validToolKeys) {
        if (key in config.toolTimeouts) {
          const value = config.toolTimeouts[key];
          if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
            validTimeouts[key] = value;
          } else {
            errors.push(`toolTimeouts.${key} must be a positive finite number`);
          }
        }
      }
      sanitized.toolTimeouts = validTimeouts;
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    sanitizedConfig: sanitized
  };
}

/**
 * Ensures the agent config directory exists.
 */
function ensureConfigDir(configPath) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
}

/**
 * Loads the agent configuration from disk.
 * Returns DEFAULT_AGENT_CONFIG merged with any persisted values (Requirement 14.8).
 *
 * @param {string} configPath - Path to the agent config JSON file
 * @returns {object} The loaded and normalized agent configuration
 */
export function loadAgentConfig(configPath) {
  ensureConfigDir(configPath);

  if (!fs.existsSync(configPath)) {
    return { ...DEFAULT_AGENT_CONFIG, toolTimeouts: { ...DEFAULT_AGENT_CONFIG.toolTimeouts } };
  }

  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const { sanitizedConfig } = validateAgentConfig(raw, DEFAULT_AGENT_CONFIG);
    return sanitizedConfig;
  } catch {
    // Corrupted file — return defaults (Requirement 14.8)
    return { ...DEFAULT_AGENT_CONFIG, toolTimeouts: { ...DEFAULT_AGENT_CONFIG.toolTimeouts } };
  }
}

/**
 * Saves agent configuration to disk, validating first.
 * Only valid values are persisted; invalid values retain previous values (Requirement 14.7).
 *
 * @param {string} configPath - Path to the agent config JSON file
 * @param {object} config - The configuration values to save
 * @returns {{ valid: boolean, errors: string[], savedConfig: object }}
 */
export function saveAgentConfig(configPath, config) {
  const previousConfig = loadAgentConfig(configPath);
  const { valid, errors, sanitizedConfig } = validateAgentConfig(config, previousConfig);

  ensureConfigDir(configPath);
  fs.writeFileSync(configPath, JSON.stringify(sanitizedConfig, null, 2), 'utf8');

  return {
    valid,
    errors,
    savedConfig: sanitizedConfig
  };
}
