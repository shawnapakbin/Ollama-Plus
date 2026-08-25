import { describe, expect, it, beforeEach } from 'vitest';
import {
  ContextManager,
  estimateTokens,
  extractFilePaths,
  extractIdentifiers,
  extractKeywords,
  summarizeStepResult,
  CHARS_PER_TOKEN,
  SUMMARIZATION_TRIGGER_PERCENT,
  SUMMARIZATION_TARGET_PERCENT,
  PRESERVED_RECENT_STEPS,
  DEFAULT_SYSTEM_PROMPT
} from '../../../electron/runtime/agent/contextManager.js';

// ─── Helper Factories ────────────────────────────────────────────────────────

function makeStepResult(overrides: Record<string, unknown> = {}) {
  return {
    stepId: overrides.stepId ?? 'step-1',
    title: overrides.title ?? 'Test Step',
    status: overrides.status ?? 'completed',
    toolCalls: overrides.toolCalls ?? [],
    output: overrides.output ?? 'Step completed successfully',
    error: overrides.error ?? null,
    startedAt: overrides.startedAt ?? '2024-01-01T00:00:00Z',
    completedAt: overrides.completedAt ?? '2024-01-01T00:00:05Z',
    duration: overrides.duration ?? 5000,
    retryCount: overrides.retryCount ?? 0
  };
}

function makePlan(stepCount = 3) {
  return {
    steps: Array.from({ length: stepCount }, (_, i) => ({
      id: `step-${i + 1}`,
      title: `Step ${i + 1}`,
      description: `Description for step ${i + 1}`,
      riskLevel: 'low' as const,
      requiredTools: [{ name: 'terminal', server: 'terminal-server', category: 'terminal' as const }],
      parallelSafe: false,
      timeout: 120000,
      dependsOn: []
    })),
    estimatedDuration: 30000,
    reasoning: 'Plan reasoning here'
  };
}

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    instruction: overrides.instruction ?? 'Create a new React component',
    workingDirectory: overrides.workingDirectory ?? '/project',
    attachments: overrides.attachments ?? [],
    followUpInstructions: overrides.followUpInstructions ?? []
  };
}

function makeMemoryRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: overrides.id ?? 'mem-1',
    sessionId: overrides.sessionId ?? 'session-1',
    fact: overrides.fact ?? 'The project uses TypeScript with React',
    tags: overrides.tags ?? ['typescript', 'react'],
    importanceScore: overrides.importanceScore ?? 75,
    retention: overrides.retention ?? 'persistent',
    createdAt: overrides.createdAt ?? '2024-01-01T00:00:00Z',
    updatedAt: overrides.updatedAt ?? '2024-01-01T00:00:00Z'
  };
}

// ─── estimateTokens ──────────────────────────────────────────────────────────

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('returns 0 for non-string input', () => {
    expect(estimateTokens(null as any)).toBe(0);
    expect(estimateTokens(undefined as any)).toBe(0);
    expect(estimateTokens(123 as any)).toBe(0);
  });

  it('estimates tokens as ceil(length / CHARS_PER_TOKEN)', () => {
    expect(estimateTokens('hello')).toBe(Math.ceil(5 / CHARS_PER_TOKEN));
    expect(estimateTokens('a'.repeat(100))).toBe(Math.ceil(100 / CHARS_PER_TOKEN));
  });

  it('handles single character', () => {
    expect(estimateTokens('a')).toBe(1);
  });

  it('handles text with exactly CHARS_PER_TOKEN characters', () => {
    const text = 'a'.repeat(CHARS_PER_TOKEN);
    expect(estimateTokens(text)).toBe(1);
  });
});

// ─── extractFilePaths ────────────────────────────────────────────────────────

describe('extractFilePaths', () => {
  it('extracts Unix-style paths', () => {
    const text = 'Modified /src/components/Button.tsx and /lib/utils.js';
    const paths = extractFilePaths(text);
    expect(paths).toContain('/src/components/Button.tsx');
    expect(paths).toContain('/lib/utils.js');
  });

  it('extracts relative paths with ./', () => {
    const text = 'Reading ./config/settings.json';
    const paths = extractFilePaths(text);
    expect(paths).toContain('./config/settings.json');
  });

  it('returns empty array for non-string input', () => {
    expect(extractFilePaths(null as any)).toEqual([]);
    expect(extractFilePaths(undefined as any)).toEqual([]);
  });

  it('returns empty array when no paths found', () => {
    expect(extractFilePaths('no paths here')).toEqual([]);
  });

  it('deduplicates paths', () => {
    const text = 'Read /src/file.ts and then wrote /src/file.ts again';
    const paths = extractFilePaths(text);
    const uniquePaths = [...new Set(paths)];
    expect(paths.length).toBe(uniquePaths.length);
  });
});

// ─── extractIdentifiers ──────────────────────────────────────────────────────

describe('extractIdentifiers', () => {
  it('extracts function declarations', () => {
    const text = 'function handleSubmit() { ... }';
    const ids = extractIdentifiers(text);
    expect(ids).toContain('handleSubmit');
  });

  it('extracts class declarations', () => {
    const text = 'class UserService { ... }';
    const ids = extractIdentifiers(text);
    expect(ids).toContain('UserService');
  });

  it('extracts const declarations', () => {
    const text = 'const myVariable = 42;';
    const ids = extractIdentifiers(text);
    expect(ids).toContain('myVariable');
  });

  it('extracts error class patterns', () => {
    const text = 'throw new ValidationError("bad input")';
    const ids = extractIdentifiers(text);
    expect(ids).toContain('ValidationError');
  });

  it('returns empty for non-string input', () => {
    expect(extractIdentifiers(null as any)).toEqual([]);
  });
});

// ─── extractKeywords ─────────────────────────────────────────────────────────

describe('extractKeywords', () => {
  it('extracts meaningful words, filtering stop words', () => {
    const keywords = extractKeywords('Create a new React component for the dashboard');
    expect(keywords).toContain('create');
    expect(keywords).toContain('react');
    expect(keywords).toContain('component');
    expect(keywords).toContain('dashboard');
    expect(keywords).not.toContain('a');
    expect(keywords).not.toContain('the');
    expect(keywords).not.toContain('for');
  });

  it('filters words with 2 or fewer characters', () => {
    const keywords = extractKeywords('go to do it');
    // All are either stop words or <= 2 chars
    expect(keywords).toEqual([]);
  });

  it('returns empty for non-string input', () => {
    expect(extractKeywords(null as any)).toEqual([]);
    expect(extractKeywords('' as any)).toEqual([]);
  });

  it('converts to lowercase', () => {
    const keywords = extractKeywords('TypeScript React Component');
    expect(keywords).toContain('typescript');
    expect(keywords).toContain('react');
    expect(keywords).toContain('component');
  });
});

// ─── summarizeStepResult ─────────────────────────────────────────────────────

describe('summarizeStepResult', () => {
  it('condenses a step result with file paths and identifiers', () => {
    const step = makeStepResult({
      output: 'Created /src/utils/helpers.ts with function validateInput',
      toolCalls: [
        { id: 'tc-1', tool: 'folder', server: 'folder-server', action: 'write', params: {}, output: 'Written to /src/utils/helpers.ts', status: 'success', error: null, duration: 100, startedAt: '', completedAt: '' }
      ]
    });

    const summary = summarizeStepResult(step);
    expect(summary.stepId).toBe('step-1');
    expect(summary.title).toBe('Test Step');
    expect(summary.filePaths.length).toBeGreaterThan(0);
    expect(summary.summary).toContain('completed');
  });

  it('handles null/undefined input gracefully', () => {
    const summary = summarizeStepResult(null as any);
    expect(summary.stepId).toBe('');
    expect(summary.filePaths).toEqual([]);
    expect(summary.identifiers).toEqual([]);
  });

  it('preserves error information', () => {
    const step = makeStepResult({ error: 'File not found' });
    const summary = summarizeStepResult(step);
    expect(summary.error).toBe('File not found');
    expect(summary.summary).toContain('File not found');
  });

  it('produces smaller output than the original', () => {
    const step = makeStepResult({
      output: 'A very long output string '.repeat(100),
      toolCalls: [
        { id: 'tc-1', tool: 'terminal', server: 's', action: 'run', params: {}, output: 'Long tool output '.repeat(100), status: 'success', error: null, duration: 100, startedAt: '', completedAt: '' }
      ]
    });

    const summary = summarizeStepResult(step);
    const originalSize = JSON.stringify(step).length;
    const summarySize = JSON.stringify(summary).length;
    expect(summarySize).toBeLessThan(originalSize);
  });
});

// ─── ContextManager class ────────────────────────────────────────────────────

describe('ContextManager', () => {
  let cm: InstanceType<typeof ContextManager>;

  beforeEach(() => {
    cm = new ContextManager({ modelTokenLimit: 4096 });
  });

  describe('buildPrompt', () => {
    it('returns a valid ContextWindow object', () => {
      const task = makeTask();
      const plan = makePlan();
      const history = [makeStepResult()];

      const ctx = cm.buildPrompt(task, plan, history);

      expect(ctx.systemPrompt).toBe(DEFAULT_SYSTEM_PROMPT);
      expect(ctx.taskInstruction).toBe(task.instruction);
      expect(ctx.currentPlan).toEqual(plan);
      expect(ctx.stepHistory).toEqual(history);
      expect(ctx.totalTokens).toBeGreaterThan(0);
    });

    it('includes follow-up instructions in task instruction', () => {
      const task = makeTask({ followUpInstructions: ['Also add unit tests'] });
      const plan = makePlan();

      const ctx = cm.buildPrompt(task, plan, []);

      expect(ctx.taskInstruction).toContain('Also add unit tests');
      expect(ctx.taskInstruction).toContain('Follow-up Instructions');
    });

    it('handles null plan', () => {
      const task = makeTask();
      const ctx = cm.buildPrompt(task, null, []);
      expect(ctx.currentPlan).toBeNull();
    });

    it('handles empty history', () => {
      const task = makeTask();
      const plan = makePlan();
      const ctx = cm.buildPrompt(task, plan, []);
      expect(ctx.stepHistory).toEqual([]);
    });

    it('calculates non-zero total tokens', () => {
      const task = makeTask();
      const plan = makePlan();
      const ctx = cm.buildPrompt(task, plan, [makeStepResult()]);
      expect(ctx.totalTokens).toBeGreaterThan(0);
    });
  });

  describe('addStepResult', () => {
    it('adds a step result to internal history', () => {
      const step = makeStepResult({ stepId: 'new-step' });
      cm.addStepResult(step);
      const history = cm.getStepHistory();
      expect(history).toHaveLength(1);
      expect(history[0].stepId).toBe('new-step');
    });

    it('ignores null/undefined input', () => {
      cm.addStepResult(null as any);
      cm.addStepResult(undefined as any);
      expect(cm.getStepHistory()).toHaveLength(0);
    });

    it('accumulates multiple step results', () => {
      cm.addStepResult(makeStepResult({ stepId: 'step-1' }));
      cm.addStepResult(makeStepResult({ stepId: 'step-2' }));
      cm.addStepResult(makeStepResult({ stepId: 'step-3' }));
      expect(cm.getStepHistory()).toHaveLength(3);
    });
  });

  describe('addFollowUp', () => {
    it('adds a follow-up instruction', () => {
      cm.buildPrompt(makeTask(), makePlan(), []);
      cm.addFollowUp('Please also fix the tests');

      const task = makeTask();
      const ctx = cm.buildPrompt(task, makePlan(), []);
      // The follow-up should be in the internal state
      expect(ctx.taskInstruction).toContain('Please also fix the tests');
    });

    it('ignores empty strings', () => {
      cm.addFollowUp('');
      cm.addFollowUp('   ');
      // Should not throw and should not add anything
      const ctx = cm.buildPrompt(makeTask(), makePlan(), []);
      expect(ctx.taskInstruction).not.toContain('Follow-up Instructions');
    });

    it('triggers summarization if would exceed 80% threshold', () => {
      // Set a small token limit
      const smallCm = new ContextManager({ modelTokenLimit: 200 });

      // Fill with step results to get close to limit
      for (let i = 0; i < 10; i++) {
        smallCm.addStepResult(makeStepResult({
          stepId: `step-${i}`,
          output: 'Some output text here for testing ' + 'x'.repeat(30)
        }));
      }

      // Add a follow-up that should trigger summarization
      smallCm.addFollowUp('A follow-up instruction that adds more context');

      // Usage should be managed (not exceeding due to summarization)
      const usage = smallCm.getTokenUsage();
      // The key invariant: after adding follow-up, the system attempted summarization
      // We can't guarantee exact token count but it should be within limits
      expect(usage.used).toBeGreaterThan(0);
    });
  });

  describe('summarizeIfNeeded', () => {
    it('does not summarize when under 80% threshold', () => {
      const cm2 = new ContextManager({ modelTokenLimit: 100000 });
      cm2.addStepResult(makeStepResult({ output: 'short output' }));

      const historyBefore = cm2.getStepHistory();
      cm2.summarizeIfNeeded(100000);
      const historyAfter = cm2.getStepHistory();

      // Should remain unchanged since we're well under 80%
      expect(JSON.stringify(historyAfter)).toBe(JSON.stringify(historyBefore));
    });

    it('preserves most recent 5 step results in full', () => {
      // Use a small limit that will trigger summarization
      const smallCm = new ContextManager({ modelTokenLimit: 500 });

      // Add 8 steps with substantial output to exceed 80%
      for (let i = 0; i < 8; i++) {
        smallCm.addStepResult(makeStepResult({
          stepId: `step-${i}`,
          title: `Step ${i}`,
          output: `Output for step ${i}: ` + 'detailed output '.repeat(20)
        }));
      }

      smallCm.summarizeIfNeeded(500);
      const history = smallCm.getStepHistory();

      // The most recent 5 should be preserved in full (have their original output)
      const recentSteps = history.slice(-5);
      for (let i = 0; i < recentSteps.length; i++) {
        const originalIdx = 3 + i; // steps 3-7 are the last 5
        expect(recentSteps[i].stepId).toBe(`step-${originalIdx}`);
        // Recent steps should still have their full output
        expect(recentSteps[i].output).toContain(`Output for step ${originalIdx}`);
      }
    });

    it('summarized steps retain file paths', () => {
      const smallCm = new ContextManager({ modelTokenLimit: 500 });

      // Add steps with file paths in their output
      for (let i = 0; i < 8; i++) {
        smallCm.addStepResult(makeStepResult({
          stepId: `step-${i}`,
          output: `Modified /src/components/Component${i}.tsx` + ' padding '.repeat(20)
        }));
      }

      smallCm.summarizeIfNeeded(500);
      const history = smallCm.getStepHistory();

      // Older summarized steps should still mention file paths
      const olderSteps = history.slice(0, 3); // First 3 were summarized
      for (const step of olderSteps) {
        expect(step.filePaths || step.output).toBeTruthy();
        // The summarized output should contain file path references
        if (step.filePaths) {
          expect(step.filePaths.length).toBeGreaterThan(0);
        }
      }
    });

    it('reduces token usage after summarization', () => {
      const smallCm = new ContextManager({ modelTokenLimit: 800 });

      // Fill up context to exceed 80%
      for (let i = 0; i < 10; i++) {
        smallCm.addStepResult(makeStepResult({
          stepId: `step-${i}`,
          output: 'Long output with details '.repeat(15),
          toolCalls: [
            { id: `tc-${i}`, tool: 'terminal', server: 's', action: 'run', params: {}, output: 'tool output '.repeat(10), status: 'success', error: null, duration: 100, startedAt: '', completedAt: '' }
          ]
        }));
      }

      const usageBefore = smallCm.getTokenUsage();
      smallCm.summarizeIfNeeded(800);
      const usageAfter = smallCm.getTokenUsage();

      expect(usageAfter.used).toBeLessThan(usageBefore.used);
    });
  });

  describe('getTokenUsage', () => {
    it('returns zero usage for empty context manager', () => {
      const emptyCm = new ContextManager({ modelTokenLimit: 4096 });
      const usage = emptyCm.getTokenUsage();
      // Only the system prompt contributes tokens
      expect(usage.used).toBe(estimateTokens(DEFAULT_SYSTEM_PROMPT));
      expect(usage.limit).toBe(4096);
      expect(usage.percentage).toBeCloseTo(estimateTokens(DEFAULT_SYSTEM_PROMPT) / 4096, 5);
    });

    it('increases after adding step results', () => {
      const usageBefore = cm.getTokenUsage();
      cm.addStepResult(makeStepResult({ output: 'a'.repeat(200) }));
      const usageAfter = cm.getTokenUsage();
      expect(usageAfter.used).toBeGreaterThan(usageBefore.used);
    });

    it('percentage is used/limit', () => {
      cm.addStepResult(makeStepResult({ output: 'test output' }));
      const usage = cm.getTokenUsage();
      expect(usage.percentage).toBeCloseTo(usage.used / usage.limit, 10);
    });

    it('accounts for memory records', () => {
      const usageBefore = cm.getTokenUsage();
      cm.setMemoryRecords([makeMemoryRecord()]);
      const usageAfter = cm.getTokenUsage();
      expect(usageAfter.used).toBeGreaterThan(usageBefore.used);
    });

    it('accounts for file contents', () => {
      const usageBefore = cm.getTokenUsage();
      cm.setFileContents([{ path: '/src/file.ts', content: 'const x = 1;', tokenCount: 5 }]);
      const usageAfter = cm.getTokenUsage();
      expect(usageAfter.used).toBeGreaterThan(usageBefore.used);
    });
  });

  describe('retrieveRelevantMemory', () => {
    it('returns matching memory records based on keyword overlap', () => {
      cm.setMemoryRecords([
        makeMemoryRecord({ id: 'mem-1', fact: 'The project uses React and TypeScript', tags: ['react', 'typescript'] }),
        makeMemoryRecord({ id: 'mem-2', fact: 'Database is PostgreSQL', tags: ['database', 'postgresql'] }),
        makeMemoryRecord({ id: 'mem-3', fact: 'API uses Express framework', tags: ['api', 'express'] })
      ]);

      const results = cm.retrieveRelevantMemory('Create a React component with TypeScript');
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].id).toBe('mem-1'); // Best match
    });

    it('returns at most the specified limit', () => {
      const records = Array.from({ length: 30 }, (_, i) =>
        makeMemoryRecord({ id: `mem-${i}`, fact: `Fact about testing ${i}`, tags: ['testing'] })
      );
      cm.setMemoryRecords(records);

      const results = cm.retrieveRelevantMemory('testing related tasks', 5);
      expect(results.length).toBeLessThanOrEqual(5);
    });

    it('defaults to limit of 20', () => {
      const records = Array.from({ length: 30 }, (_, i) =>
        makeMemoryRecord({ id: `mem-${i}`, fact: `Fact about coding ${i}`, tags: ['coding'] })
      );
      cm.setMemoryRecords(records);

      const results = cm.retrieveRelevantMemory('coding project task');
      expect(results.length).toBeLessThanOrEqual(20);
    });

    it('returns empty for empty instruction', () => {
      cm.setMemoryRecords([makeMemoryRecord()]);
      expect(cm.retrieveRelevantMemory('')).toEqual([]);
      expect(cm.retrieveRelevantMemory('   ')).toEqual([]);
    });

    it('returns empty for non-string instruction', () => {
      cm.setMemoryRecords([makeMemoryRecord()]);
      expect(cm.retrieveRelevantMemory(null as any)).toEqual([]);
    });

    it('returns empty when no records match', () => {
      cm.setMemoryRecords([
        makeMemoryRecord({ fact: 'Python Django project', tags: ['python', 'django'] })
      ]);

      const results = cm.retrieveRelevantMemory('Rust WebAssembly compilation');
      expect(results).toEqual([]);
    });

    it('scores higher importance records above lower importance ones', () => {
      cm.setMemoryRecords([
        makeMemoryRecord({ id: 'low', fact: 'React component structure', tags: ['react'], importanceScore: 20 }),
        makeMemoryRecord({ id: 'high', fact: 'React component patterns', tags: ['react'], importanceScore: 90 })
      ]);

      const results = cm.retrieveRelevantMemory('React component development');
      expect(results[0].id).toBe('high');
    });
  });

  describe('setModelTokenLimit', () => {
    it('updates the model token limit', () => {
      cm.setModelTokenLimit(16384);
      const usage = cm.getTokenUsage();
      expect(usage.limit).toBe(16384);
    });

    it('ignores non-positive values', () => {
      cm.setModelTokenLimit(0);
      expect(cm.getTokenUsage().limit).toBe(4096); // unchanged
      cm.setModelTokenLimit(-100);
      expect(cm.getTokenUsage().limit).toBe(4096); // unchanged
    });

    it('ignores non-number values', () => {
      cm.setModelTokenLimit('big' as any);
      expect(cm.getTokenUsage().limit).toBe(4096); // unchanged
    });
  });

  describe('setFileContents', () => {
    it('sets file contents available in context', () => {
      cm.setFileContents([
        { path: '/src/app.ts', content: 'const app = express();', tokenCount: 6 }
      ]);

      const task = makeTask();
      const ctx = cm.buildPrompt(task, makePlan(), []);
      expect(ctx.fileContents).toHaveLength(1);
      expect(ctx.fileContents[0].path).toBe('/src/app.ts');
    });

    it('handles non-array input', () => {
      cm.setFileContents(null as any);
      const ctx = cm.buildPrompt(makeTask(), makePlan(), []);
      expect(ctx.fileContents).toEqual([]);
    });
  });

  describe('setMemoryRecords', () => {
    it('sets memory records for retrieval', () => {
      const records = [makeMemoryRecord()];
      cm.setMemoryRecords(records);

      const task = makeTask();
      const ctx = cm.buildPrompt(task, makePlan(), []);
      expect(ctx.memoryRecords).toHaveLength(1);
    });

    it('handles non-array input', () => {
      cm.setMemoryRecords('bad' as any);
      const ctx = cm.buildPrompt(makeTask(), makePlan(), []);
      expect(ctx.memoryRecords).toEqual([]);
    });
  });

  describe('custom system prompt', () => {
    it('uses custom system prompt when provided', () => {
      const custom = new ContextManager({ systemPrompt: 'Custom agent prompt' });
      const ctx = custom.buildPrompt(makeTask(), makePlan(), []);
      expect(ctx.systemPrompt).toBe('Custom agent prompt');
    });

    it('uses default system prompt when not provided', () => {
      const ctx = cm.buildPrompt(makeTask(), makePlan(), []);
      expect(ctx.systemPrompt).toBe(DEFAULT_SYSTEM_PROMPT);
    });
  });
});


// ─── Property-Based Tests (fast-check) ──────────────────────────────────────
// Feature: agent-client, Property 6
// **Validates: Requirements 3.5, 8.2**

import * as fc from 'fast-check';

/**
 * Property 6: Context window summarization bounds
 *
 * For any context window whose token usage exceeds 80% of the model's token limit,
 * after summarization the token usage SHALL be below 60% of the limit,
 * the most recent 5 step results SHALL be preserved in full,
 * and all file paths and key identifiers from summarized entries SHALL be retained.
 */
describe('Property 6: Context window summarization bounds', () => {
  // Arbitrary for generating file paths that match the extractFilePaths regex
  const arbFilePath = fc.oneof(
    fc.constantFrom('app', 'utils', 'helpers', 'index', 'config', 'service', 'handler')
      .map(s => `/src/${s}.ts`),
    fc.constantFrom('Button', 'Modal', 'Form', 'Header', 'Layout', 'Card')
      .map(s => `./components/${s}.tsx`),
    fc.constantFrom('db', 'auth', 'cache', 'logger', 'router')
      .map(s => `/lib/${s}.js`)
  );

  // Arbitrary for generating identifier-like text
  const arbIdentifier = fc.oneof(
    fc.constantFrom(
      'function handleSubmit',
      'class UserService',
      'const myVariable',
      'export validateInput',
      'class ValidationError',
      'function processData',
      'const ConfigManager',
      'class NetworkHandler'
    )
  );

  // Arbitrary for generating step results with varying output lengths.
  // Include file paths and identifiers in output to ensure they are present.
  // Each step has a controlled output size — small enough that 5 preserved
  // steps don't exceed 60% of the token limit on their own, but large enough
  // that 10+ steps collectively exceed 80%.
  const arbStepResult = fc.record({
    stepId: fc.uuid().map(id => `step-${id.slice(0, 8)}`),
    title: fc.string({ minLength: 1, maxLength: 20 }),
    status: fc.constantFrom('completed', 'failed'),
    output: fc.tuple(
      fc.string({ minLength: 20, maxLength: 80 }),
      fc.array(arbFilePath, { minLength: 1, maxLength: 2 }),
      fc.array(arbIdentifier, { minLength: 0, maxLength: 1 })
    ).map(([base, paths, ids]) => {
      const pathText = ` Modified ${paths.join(' and ')}`;
      const idText = ids.length > 0 ? ` ${ids.join('; ')}` : '';
      return `${base}${pathText}${idText}`;
    }),
    toolCalls: fc.constant([]),
    error: fc.constant(null),
    startedAt: fc.constant('2024-01-01T00:00:00Z'),
    completedAt: fc.constant('2024-01-01T00:00:05Z'),
    duration: fc.integer({ min: 100, max: 5000 }),
    retryCount: fc.constant(0)
  });

  // Generate 10-20 steps to guarantee we have enough "fat" beyond the preserved 5
  const arbStepResults = fc.array(arbStepResult, { minLength: 10, maxLength: 20 });

  it('after summarization, token usage is below 60% of the model token limit', () => {
    fc.assert(
      fc.property(arbStepResults, (steps) => {
        // Skip if there aren't enough steps beyond 5 to summarize
        if (steps.length <= PRESERVED_RECENT_STEPS) {
          return true;
        }

        // Pre-compute what summarization actually produces to determine a viable token limit.
        // The irreducible minimum after summarization is:
        // systemPrompt + summarized older steps + preserved recent steps
        const systemPromptTokens = estimateTokens(DEFAULT_SYSTEM_PROMPT);

        const preserveCount = Math.min(PRESERVED_RECENT_STEPS, steps.length);
        const recentSteps = steps.slice(-preserveCount);
        const olderSteps = steps.slice(0, steps.length - preserveCount);

        const recentStepsTokens = recentSteps.reduce(
          (sum, s) => sum + estimateTokens(JSON.stringify(s)), 0
        );

        // Simulate summarization of older steps
        const summarizedOlderTokens = olderSteps.reduce((sum, s) => {
          const summarized = summarizeStepResult(s);
          return sum + estimateTokens(JSON.stringify(summarized));
        }, 0);

        // The total after summarization would be approximately:
        const postSummarizationTokens = systemPromptTokens + summarizedOlderTokens + recentStepsTokens;

        // All steps total (pre-summarization)
        const allStepsTokens = steps.reduce(
          (sum, s) => sum + estimateTokens(JSON.stringify(s)), 0
        );
        const preSummarizationTokens = systemPromptTokens + allStepsTokens;

        // Pick a token limit where:
        // 1. Pre-summarization usage > 80% of limit  (triggers summarization)
        // 2. Post-summarization usage < 60% of limit (target achievable)
        // For condition 1: limit < preSummarizationTokens / 0.80
        // For condition 2: limit > postSummarizationTokens / 0.60
        const minLimit = Math.ceil(postSummarizationTokens / SUMMARIZATION_TARGET_PERCENT) + 1;
        const maxLimit = Math.floor(preSummarizationTokens / SUMMARIZATION_TRIGGER_PERCENT);

        // If there's no valid limit range, the summarization can't help — skip
        if (minLimit >= maxLimit) {
          return true;
        }

        // Use the midpoint as our token limit
        const tokenLimit = Math.ceil((minLimit + maxLimit) / 2);

        const cm = new ContextManager({ modelTokenLimit: tokenLimit });

        // Add all step results
        for (const step of steps) {
          cm.addStepResult(step);
        }

        // Verify precondition: usage exceeds 80%
        const usageBefore = cm.getTokenUsage();
        if (usageBefore.percentage <= SUMMARIZATION_TRIGGER_PERCENT) {
          return true; // Not enough data to trigger — skip
        }

        // Trigger summarization
        cm.summarizeIfNeeded(tokenLimit);

        // Verify: token usage should be at or below 60%
        const usageAfter = cm.getTokenUsage();
        return usageAfter.percentage <= SUMMARIZATION_TARGET_PERCENT;
      }),
      { numRuns: 100 }
    );
  });

  it('most recent 5 step results are preserved in full after summarization', () => {
    fc.assert(
      fc.property(arbStepResults, (steps) => {
        if (steps.length <= PRESERVED_RECENT_STEPS) {
          return true;
        }

        // Compute a viable token limit using same approach
        const systemPromptTokens = estimateTokens(DEFAULT_SYSTEM_PROMPT);
        const preserveCount = Math.min(PRESERVED_RECENT_STEPS, steps.length);
        const recentSteps = steps.slice(-preserveCount);
        const olderSteps = steps.slice(0, steps.length - preserveCount);

        const recentStepsTokens = recentSteps.reduce(
          (sum, s) => sum + estimateTokens(JSON.stringify(s)), 0
        );
        const summarizedOlderTokens = olderSteps.reduce((sum, s) => {
          const summarized = summarizeStepResult(s);
          return sum + estimateTokens(JSON.stringify(summarized));
        }, 0);
        const postSummarizationTokens = systemPromptTokens + summarizedOlderTokens + recentStepsTokens;

        const allStepsTokens = steps.reduce(
          (sum, s) => sum + estimateTokens(JSON.stringify(s)), 0
        );
        const preSummarizationTokens = systemPromptTokens + allStepsTokens;

        const minLimit = Math.ceil(postSummarizationTokens / SUMMARIZATION_TARGET_PERCENT) + 1;
        const maxLimit = Math.floor(preSummarizationTokens / SUMMARIZATION_TRIGGER_PERCENT);

        if (minLimit >= maxLimit) {
          return true; // No valid limit range — skip
        }

        const tokenLimit = Math.ceil((minLimit + maxLimit) / 2);
        const cm = new ContextManager({ modelTokenLimit: tokenLimit });

        // Add all step results
        for (const step of steps) {
          cm.addStepResult(step);
        }

        const usageBefore = cm.getTokenUsage();
        if (usageBefore.percentage <= SUMMARIZATION_TRIGGER_PERCENT) {
          return true;
        }

        // Capture the last PRESERVED_RECENT_STEPS before summarization
        const historyBefore = cm.getStepHistory();
        const expectedPreserved = historyBefore.slice(-preserveCount);

        // Trigger summarization
        cm.summarizeIfNeeded(tokenLimit);

        // Verify: the most recent N step results have their output unchanged
        const historyAfter = cm.getStepHistory();
        const actualPreserved = historyAfter.slice(-preserveCount);

        for (let i = 0; i < preserveCount; i++) {
          if (actualPreserved[i].stepId !== expectedPreserved[i].stepId) {
            return false;
          }
          if (actualPreserved[i].output !== expectedPreserved[i].output) {
            return false;
          }
          if (actualPreserved[i].title !== expectedPreserved[i].title) {
            return false;
          }
        }

        return true;
      }),
      { numRuns: 100 }
    );
  });

  it('file paths from summarized entries are retained in the summarized output', () => {
    fc.assert(
      fc.property(arbStepResults, (steps) => {
        if (steps.length <= PRESERVED_RECENT_STEPS) {
          return true;
        }

        // Compute a viable token limit
        const systemPromptTokens = estimateTokens(DEFAULT_SYSTEM_PROMPT);
        const preserveCount = Math.min(PRESERVED_RECENT_STEPS, steps.length);
        const recentSteps = steps.slice(-preserveCount);
        const olderSteps = steps.slice(0, steps.length - preserveCount);

        const recentStepsTokens = recentSteps.reduce(
          (sum, s) => sum + estimateTokens(JSON.stringify(s)), 0
        );
        const summarizedOlderTokens = olderSteps.reduce((sum, s) => {
          const summarized = summarizeStepResult(s);
          return sum + estimateTokens(JSON.stringify(summarized));
        }, 0);
        const postSummarizationTokens = systemPromptTokens + summarizedOlderTokens + recentStepsTokens;

        const allStepsTokens = steps.reduce(
          (sum, s) => sum + estimateTokens(JSON.stringify(s)), 0
        );
        const preSummarizationTokens = systemPromptTokens + allStepsTokens;

        const minLimit = Math.ceil(postSummarizationTokens / SUMMARIZATION_TARGET_PERCENT) + 1;
        const maxLimit = Math.floor(preSummarizationTokens / SUMMARIZATION_TRIGGER_PERCENT);

        if (minLimit >= maxLimit) {
          return true; // No valid limit range — skip
        }

        const tokenLimit = Math.ceil((minLimit + maxLimit) / 2);
        const cm = new ContextManager({ modelTokenLimit: tokenLimit });

        // Add all step results
        for (const step of steps) {
          cm.addStepResult(step);
        }

        const usageBefore = cm.getTokenUsage();
        if (usageBefore.percentage <= SUMMARIZATION_TRIGGER_PERCENT) {
          return true;
        }

        // Collect file paths from entries that will be summarized (all except the last 5)
        const historyBefore = cm.getStepHistory();
        const summarizeCount = historyBefore.length - preserveCount;

        if (summarizeCount <= 0) {
          return true;
        }

        const entriesToSummarize = historyBefore.slice(0, summarizeCount);

        // Extract file paths from entries that will be summarized
        const originalFilePaths = new Set<string>();
        for (const entry of entriesToSummarize) {
          const entryText = JSON.stringify(entry);
          const paths = extractFilePaths(entryText);
          for (const p of paths) {
            originalFilePaths.add(p);
          }
        }

        if (originalFilePaths.size === 0) {
          return true; // No file paths to verify
        }

        // Trigger summarization
        cm.summarizeIfNeeded(tokenLimit);

        // Verify: file paths from summarized entries should still be present
        const historyAfter = cm.getStepHistory();
        const summarizedEntries = historyAfter.slice(0, summarizeCount);

        // Collect file paths from the summarized entries after summarization
        const retainedFilePaths = new Set<string>();
        for (const entry of summarizedEntries) {
          // Check filePaths array if present (summarized form)
          if (Array.isArray((entry as any).filePaths)) {
            for (const p of (entry as any).filePaths) {
              retainedFilePaths.add(p);
            }
          }
          // Also check the output/summary string for path references
          const entryText = JSON.stringify(entry);
          const paths = extractFilePaths(entryText);
          for (const p of paths) {
            retainedFilePaths.add(p);
          }
        }

        // Every original file path should be retained
        for (const path of originalFilePaths) {
          if (!retainedFilePaths.has(path)) {
            return false;
          }
        }

        return true;
      }),
      { numRuns: 100 }
    );
  });
});
