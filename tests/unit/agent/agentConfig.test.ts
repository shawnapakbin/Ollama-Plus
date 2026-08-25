import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_AGENT_CONFIG,
  validateAgentConfig,
  loadAgentConfig,
  saveAgentConfig
} from '../../../electron/runtime/agent/agentConfig.js';

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-agent-config-'));
  tempDirs.push(dir);
  return path.join(dir, 'agent-config.json');
}

describe('DEFAULT_AGENT_CONFIG', () => {
  it('has the correct default values per Requirement 14.1/14.8', () => {
    expect(DEFAULT_AGENT_CONFIG.stepTimeout).toBe(120);
    expect(DEFAULT_AGENT_CONFIG.taskTimeout).toBe(900);
    expect(DEFAULT_AGENT_CONFIG.retryCount).toBe(3);
    expect(DEFAULT_AGENT_CONFIG.autoApprovalLowRisk).toBe(false);
    expect(DEFAULT_AGENT_CONFIG.defaultWorkingDirectory).toBe('');
    expect(DEFAULT_AGENT_CONFIG.customApprovalRules).toEqual([]);
    expect(DEFAULT_AGENT_CONFIG.toolTimeouts).toEqual({
      terminal: 60,
      file: 30,
      browser: 120,
      python: 60,
      http: 30
    });
  });

  it('is frozen and cannot be mutated', () => {
    expect(Object.isFrozen(DEFAULT_AGENT_CONFIG)).toBe(true);
    expect(Object.isFrozen(DEFAULT_AGENT_CONFIG.toolTimeouts)).toBe(true);
  });
});

describe('validateAgentConfig', () => {
  describe('stepTimeout validation', () => {
    it('accepts value at lower boundary (30)', () => {
      const { valid, errors, sanitizedConfig } = validateAgentConfig({ stepTimeout: 30 });
      expect(valid).toBe(true);
      expect(errors).toHaveLength(0);
      expect(sanitizedConfig.stepTimeout).toBe(30);
    });

    it('accepts value at upper boundary (600)', () => {
      const { valid, errors, sanitizedConfig } = validateAgentConfig({ stepTimeout: 600 });
      expect(valid).toBe(true);
      expect(sanitizedConfig.stepTimeout).toBe(600);
    });

    it('rejects value below minimum and retains previous', () => {
      const previous = { ...DEFAULT_AGENT_CONFIG, stepTimeout: 100 };
      const { valid, errors, sanitizedConfig } = validateAgentConfig({ stepTimeout: 29 }, previous);
      expect(valid).toBe(false);
      expect(errors[0]).toContain('stepTimeout');
      expect(errors[0]).toContain('30');
      expect(errors[0]).toContain('600');
      expect(sanitizedConfig.stepTimeout).toBe(100); // retains previous
    });

    it('rejects value above maximum and retains previous', () => {
      const { valid, errors, sanitizedConfig } = validateAgentConfig({ stepTimeout: 601 });
      expect(valid).toBe(false);
      expect(errors[0]).toContain('stepTimeout');
      expect(sanitizedConfig.stepTimeout).toBe(DEFAULT_AGENT_CONFIG.stepTimeout);
    });

    it('rejects non-number types', () => {
      const { valid, errors } = validateAgentConfig({ stepTimeout: '120' as any });
      expect(valid).toBe(false);
      expect(errors[0]).toContain('finite number');
    });

    it('rejects NaN', () => {
      const { valid, errors } = validateAgentConfig({ stepTimeout: NaN });
      expect(valid).toBe(false);
      expect(errors[0]).toContain('finite number');
    });

    it('rejects Infinity', () => {
      const { valid, errors } = validateAgentConfig({ stepTimeout: Infinity });
      expect(valid).toBe(false);
      expect(errors[0]).toContain('finite number');
    });
  });

  describe('taskTimeout validation', () => {
    it('accepts value at lower boundary (60)', () => {
      const { valid, sanitizedConfig } = validateAgentConfig({ taskTimeout: 60 });
      expect(valid).toBe(true);
      expect(sanitizedConfig.taskTimeout).toBe(60);
    });

    it('accepts value at upper boundary (3600)', () => {
      const { valid, sanitizedConfig } = validateAgentConfig({ taskTimeout: 3600 });
      expect(valid).toBe(true);
      expect(sanitizedConfig.taskTimeout).toBe(3600);
    });

    it('rejects value below minimum', () => {
      const { valid, errors, sanitizedConfig } = validateAgentConfig({ taskTimeout: 59 });
      expect(valid).toBe(false);
      expect(errors[0]).toContain('taskTimeout');
      expect(sanitizedConfig.taskTimeout).toBe(DEFAULT_AGENT_CONFIG.taskTimeout);
    });

    it('rejects value above maximum', () => {
      const { valid, errors } = validateAgentConfig({ taskTimeout: 3601 });
      expect(valid).toBe(false);
      expect(errors[0]).toContain('taskTimeout');
    });
  });

  describe('retryCount validation', () => {
    it('accepts value at lower boundary (0)', () => {
      const { valid, sanitizedConfig } = validateAgentConfig({ retryCount: 0 });
      expect(valid).toBe(true);
      expect(sanitizedConfig.retryCount).toBe(0);
    });

    it('accepts value at upper boundary (10)', () => {
      const { valid, sanitizedConfig } = validateAgentConfig({ retryCount: 10 });
      expect(valid).toBe(true);
      expect(sanitizedConfig.retryCount).toBe(10);
    });

    it('rejects negative values', () => {
      const { valid, errors, sanitizedConfig } = validateAgentConfig({ retryCount: -1 });
      expect(valid).toBe(false);
      expect(errors[0]).toContain('retryCount');
      expect(sanitizedConfig.retryCount).toBe(DEFAULT_AGENT_CONFIG.retryCount);
    });

    it('rejects values above maximum', () => {
      const { valid, errors } = validateAgentConfig({ retryCount: 11 });
      expect(valid).toBe(false);
      expect(errors[0]).toContain('retryCount');
    });
  });

  describe('customApprovalRules validation', () => {
    it('accepts valid rules', () => {
      const rules = [
        { id: 'rule-1', pattern: 'rm -rf *', type: 'glob', description: 'Block rm -rf' }
      ];
      const { valid, sanitizedConfig } = validateAgentConfig({ customApprovalRules: rules });
      expect(valid).toBe(true);
      expect(sanitizedConfig.customApprovalRules).toHaveLength(1);
      expect(sanitizedConfig.customApprovalRules[0].pattern).toBe('rm -rf *');
    });

    it('rejects more than 50 rules', () => {
      const rules = Array.from({ length: 51 }, (_, i) => ({
        id: `rule-${i}`,
        pattern: `pattern-${i}`,
        type: 'glob',
        description: ''
      }));
      const { valid, errors } = validateAgentConfig({ customApprovalRules: rules });
      expect(valid).toBe(false);
      expect(errors[0]).toContain('50');
    });

    it('accepts exactly 50 rules', () => {
      const rules = Array.from({ length: 50 }, (_, i) => ({
        id: `rule-${i}`,
        pattern: `pattern-${i}`,
        type: 'glob',
        description: ''
      }));
      const { valid } = validateAgentConfig({ customApprovalRules: rules });
      expect(valid).toBe(true);
    });

    it('rejects rule with pattern exceeding 500 characters', () => {
      const rules = [
        { id: 'rule-1', pattern: 'x'.repeat(501), type: 'glob', description: '' }
      ];
      const { valid, errors } = validateAgentConfig({ customApprovalRules: rules });
      expect(valid).toBe(false);
      expect(errors[0]).toContain('500');
    });

    it('accepts rule with pattern of exactly 500 characters', () => {
      const rules = [
        { id: 'rule-1', pattern: 'x'.repeat(500), type: 'regex', description: '' }
      ];
      const { valid } = validateAgentConfig({ customApprovalRules: rules });
      expect(valid).toBe(true);
    });

    it('rejects rule with empty pattern', () => {
      const rules = [
        { id: 'rule-1', pattern: '', type: 'glob', description: '' }
      ];
      const { valid, errors } = validateAgentConfig({ customApprovalRules: rules });
      expect(valid).toBe(false);
      expect(errors[0]).toContain('non-empty string');
    });

    it('rejects rule with invalid type', () => {
      const rules = [
        { id: 'rule-1', pattern: 'test', type: 'invalid', description: '' }
      ];
      const { valid, errors } = validateAgentConfig({ customApprovalRules: rules as any });
      expect(valid).toBe(false);
      expect(errors[0]).toContain('type');
    });

    it('rejects non-array customApprovalRules', () => {
      const { valid, errors } = validateAgentConfig({ customApprovalRules: 'not-array' as any });
      expect(valid).toBe(false);
      expect(errors[0]).toContain('array');
    });

    it('assigns generated id when rule has no id', () => {
      const rules = [
        { pattern: 'test', type: 'glob', description: 'desc' }
      ];
      const { valid, sanitizedConfig } = validateAgentConfig({ customApprovalRules: rules as any });
      expect(valid).toBe(true);
      expect(sanitizedConfig.customApprovalRules[0].id).toBeTruthy();
      expect(typeof sanitizedConfig.customApprovalRules[0].id).toBe('string');
    });
  });

  describe('autoApprovalLowRisk validation', () => {
    it('accepts true', () => {
      const { valid, sanitizedConfig } = validateAgentConfig({ autoApprovalLowRisk: true });
      expect(valid).toBe(true);
      expect(sanitizedConfig.autoApprovalLowRisk).toBe(true);
    });

    it('accepts false', () => {
      const { valid, sanitizedConfig } = validateAgentConfig({ autoApprovalLowRisk: false });
      expect(valid).toBe(true);
      expect(sanitizedConfig.autoApprovalLowRisk).toBe(false);
    });

    it('rejects non-boolean', () => {
      const { valid, errors } = validateAgentConfig({ autoApprovalLowRisk: 'yes' as any });
      expect(valid).toBe(false);
      expect(errors[0]).toContain('boolean');
    });
  });

  describe('toolTimeouts validation', () => {
    it('accepts valid tool timeouts', () => {
      const { valid, sanitizedConfig } = validateAgentConfig({
        toolTimeouts: { terminal: 90, file: 45 }
      });
      expect(valid).toBe(true);
      expect(sanitizedConfig.toolTimeouts.terminal).toBe(90);
      expect(sanitizedConfig.toolTimeouts.file).toBe(45);
      // Other tool timeouts retain defaults
      expect(sanitizedConfig.toolTimeouts.browser).toBe(120);
    });

    it('rejects non-positive tool timeouts', () => {
      const { valid, errors } = validateAgentConfig({
        toolTimeouts: { terminal: 0 }
      });
      expect(valid).toBe(false);
      expect(errors[0]).toContain('terminal');
    });

    it('rejects non-object toolTimeouts', () => {
      const { valid, errors } = validateAgentConfig({ toolTimeouts: 'bad' as any });
      expect(valid).toBe(false);
      expect(errors[0]).toContain('object');
    });
  });

  describe('general validation', () => {
    it('rejects null config', () => {
      const { valid, errors } = validateAgentConfig(null as any);
      expect(valid).toBe(false);
      expect(errors[0]).toContain('object');
    });

    it('rejects undefined config', () => {
      const { valid, errors } = validateAgentConfig(undefined as any);
      expect(valid).toBe(false);
      expect(errors[0]).toContain('object');
    });

    it('accepts empty object (all defaults retained)', () => {
      const { valid, sanitizedConfig } = validateAgentConfig({});
      expect(valid).toBe(true);
      expect(sanitizedConfig).toEqual(DEFAULT_AGENT_CONFIG);
    });

    it('collects multiple errors for multiple invalid fields', () => {
      const { valid, errors } = validateAgentConfig({
        stepTimeout: -1,
        taskTimeout: 99999,
        retryCount: 'bad' as any
      });
      expect(valid).toBe(false);
      expect(errors.length).toBe(3);
    });

    it('accepts valid partial updates', () => {
      const { valid, sanitizedConfig } = validateAgentConfig({
        stepTimeout: 200,
        retryCount: 5
      });
      expect(valid).toBe(true);
      expect(sanitizedConfig.stepTimeout).toBe(200);
      expect(sanitizedConfig.retryCount).toBe(5);
      expect(sanitizedConfig.taskTimeout).toBe(DEFAULT_AGENT_CONFIG.taskTimeout);
    });
  });
});

describe('loadAgentConfig', () => {
  it('returns defaults when file does not exist', () => {
    const configPath = createTempConfigPath();
    const config = loadAgentConfig(configPath);
    expect(config.stepTimeout).toBe(120);
    expect(config.taskTimeout).toBe(900);
    expect(config.retryCount).toBe(3);
    expect(config.autoApprovalLowRisk).toBe(false);
    expect(config.toolTimeouts.terminal).toBe(60);
  });

  it('returns defaults when file is corrupted JSON', () => {
    const configPath = createTempConfigPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, '{not valid json!!!', 'utf8');
    const config = loadAgentConfig(configPath);
    expect(config.stepTimeout).toBe(120);
    expect(config.taskTimeout).toBe(900);
  });

  it('loads valid persisted config', () => {
    const configPath = createTempConfigPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      stepTimeout: 200,
      taskTimeout: 1800,
      retryCount: 5
    }), 'utf8');
    const config = loadAgentConfig(configPath);
    expect(config.stepTimeout).toBe(200);
    expect(config.taskTimeout).toBe(1800);
    expect(config.retryCount).toBe(5);
  });

  it('ignores out-of-range values in persisted file and uses defaults', () => {
    const configPath = createTempConfigPath();
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      stepTimeout: 9999,
      retryCount: 2
    }), 'utf8');
    const config = loadAgentConfig(configPath);
    expect(config.stepTimeout).toBe(120); // default, because 9999 is out of range
    expect(config.retryCount).toBe(2); // valid, so accepted
  });
});

describe('saveAgentConfig', () => {
  it('persists valid config to disk', () => {
    const configPath = createTempConfigPath();
    const { valid, savedConfig } = saveAgentConfig(configPath, {
      stepTimeout: 300,
      retryCount: 7
    });
    expect(valid).toBe(true);
    expect(savedConfig.stepTimeout).toBe(300);
    expect(savedConfig.retryCount).toBe(7);

    // Verify it was written
    const loaded = loadAgentConfig(configPath);
    expect(loaded.stepTimeout).toBe(300);
    expect(loaded.retryCount).toBe(7);
  });

  it('retains previous values when invalid values are submitted', () => {
    const configPath = createTempConfigPath();

    // First save a valid config
    saveAgentConfig(configPath, { stepTimeout: 200 });

    // Then try to save an invalid value
    const { valid, errors, savedConfig } = saveAgentConfig(configPath, { stepTimeout: 9999 });
    expect(valid).toBe(false);
    expect(errors[0]).toContain('stepTimeout');
    // Previous valid value is retained
    expect(savedConfig.stepTimeout).toBe(200);

    // Verify persisted state
    const loaded = loadAgentConfig(configPath);
    expect(loaded.stepTimeout).toBe(200);
  });

  it('merges partial updates with existing config', () => {
    const configPath = createTempConfigPath();

    saveAgentConfig(configPath, { stepTimeout: 200, retryCount: 5 });
    saveAgentConfig(configPath, { taskTimeout: 1200 });

    const loaded = loadAgentConfig(configPath);
    expect(loaded.stepTimeout).toBe(200); // from first save
    expect(loaded.retryCount).toBe(5); // from first save
    expect(loaded.taskTimeout).toBe(1200); // from second save
  });

  it('persists custom approval rules', () => {
    const configPath = createTempConfigPath();
    const rules = [
      { id: 'r1', pattern: 'rm -rf', type: 'glob', description: 'Dangerous delete' },
      { id: 'r2', pattern: '^sudo', type: 'regex', description: 'Root commands' }
    ];
    const { valid, savedConfig } = saveAgentConfig(configPath, { customApprovalRules: rules });
    expect(valid).toBe(true);
    expect(savedConfig.customApprovalRules).toHaveLength(2);

    const loaded = loadAgentConfig(configPath);
    expect(loaded.customApprovalRules).toHaveLength(2);
    expect(loaded.customApprovalRules[0].pattern).toBe('rm -rf');
    expect(loaded.customApprovalRules[1].type).toBe('regex');
  });

  it('returns errors but still persists the sanitized config', () => {
    const configPath = createTempConfigPath();
    const { valid, errors, savedConfig } = saveAgentConfig(configPath, {
      stepTimeout: 200,
      retryCount: 99 // invalid
    });
    expect(valid).toBe(false);
    expect(errors.length).toBeGreaterThan(0);
    // Valid field was accepted
    expect(savedConfig.stepTimeout).toBe(200);
    // Invalid field uses default
    expect(savedConfig.retryCount).toBe(DEFAULT_AGENT_CONFIG.retryCount);
  });
});
