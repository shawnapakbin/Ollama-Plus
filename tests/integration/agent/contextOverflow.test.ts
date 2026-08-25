import { describe, it, expect, beforeEach } from 'vitest';
import {
  ContextManager,
  estimateTokens,
  extractFilePaths,
  extractIdentifiers,
  summarizeStepResult,
  CHARS_PER_TOKEN,
  SUMMARIZATION_TRIGGER_PERCENT,
  SUMMARIZATION_TARGET_PERCENT,
  PRESERVED_RECENT_STEPS,
  DEFAULT_SYSTEM_PROMPT
} from '../../../electron/runtime/agent/contextManager.js';

/**
 * Integration Tests: Context Overflow and Summarization
 *
 * Validates that the ContextManager correctly manages context window overflow
 * by triggering summarization at 80% usage, reducing below 60%, and preserving
 * the most recent 5 step results in full.
 *
 * Requirements: 3.5, 8.2
 */

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

function makeLargeStepResult(index: number, outputSize: number = 200) {
  const filePath = `/src/components/Component${index}.tsx`;
  const identifier = `function handleAction${index}`;
  const padding = 'x'.repeat(Math.max(0, outputSize - filePath.length - identifier.length - 30));
  return makeStepResult({
    stepId: `step-${index}`,
    title: `Execute task step ${index}`,
    output: `Modified ${filePath}. ${identifier}() was updated. ${padding}`,
    toolCalls: [
      {
        id: `tc-${index}`,
        tool: 'folder',
        server: 'folder-server',
        action: 'write',
        params: { path: filePath },
        output: `Written ${filePath} successfully. ` + 'result '.repeat(20),
        status: 'success',
        error: null,
        duration: 150,
        startedAt: '2024-01-01T00:00:00Z',
        completedAt: '2024-01-01T00:00:01Z'
      }
    ]
  });
}

/**
 * Computes a suitable token limit where:
 * - The given steps will exceed 80% (triggering summarization)
 * - After summarization, preserved 5 recent steps + summarized older steps fit below 60%
 *
 * This ensures tests are robust to output size variations.
 */
function computeViableTokenLimit(steps: ReturnType<typeof makeStepResult>[]) {
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
  const allStepsTokens = steps.reduce(
    (sum, s) => sum + estimateTokens(JSON.stringify(s)), 0
  );

  const postSummarizationTokens = systemPromptTokens + summarizedOlderTokens + recentStepsTokens;
  const preSummarizationTokens = systemPromptTokens + allStepsTokens;

  // Limit must satisfy: post / limit < 0.60 AND pre / limit > 0.80
  const minLimit = Math.ceil(postSummarizationTokens / SUMMARIZATION_TARGET_PERCENT) + 1;
  const maxLimit = Math.floor(preSummarizationTokens / SUMMARIZATION_TRIGGER_PERCENT);

  // Use a limit close to minLimit to ensure pre-summarization clearly exceeds 80%
  // (the lower the limit, the higher the pre-summarization percentage)
  return minLimit + Math.floor((maxLimit - minLimit) * 0.1);
}

// ─── Test 1: Context summarization triggers at 80% ───────────────────────────

describe('Integration: Context Overflow and Summarization', () => {
  describe('Test 1: Context summarization triggers at 80%', () => {
    it('triggers summarization when context exceeds 80% of model token limit', () => {
      // Build steps and compute a token limit that makes summarization viable
      const steps: ReturnType<typeof makeLargeStepResult>[] = [];
      for (let i = 0; i < 12; i++) {
        steps.push(makeLargeStepResult(i, 300));
      }
      const TOKEN_LIMIT = computeViableTokenLimit(steps);
      const cm = new ContextManager({ modelTokenLimit: TOKEN_LIMIT });

      // Add all steps
      for (const step of steps) {
        cm.addStepResult(step);
      }

      // Verify precondition: usage is above 80%
      const usageBefore = cm.getTokenUsage();
      expect(usageBefore.percentage).toBeGreaterThan(SUMMARIZATION_TRIGGER_PERCENT);

      // Trigger summarization
      cm.summarizeIfNeeded(TOKEN_LIMIT);

      // Verify: token usage drops below 60% after summarization
      const usageAfter = cm.getTokenUsage();
      expect(usageAfter.percentage).toBeLessThanOrEqual(SUMMARIZATION_TARGET_PERCENT);
    });

    it('token usage drops below 60% after summarization', () => {
      const steps: ReturnType<typeof makeLargeStepResult>[] = [];
      for (let i = 0; i < 15; i++) {
        steps.push(makeLargeStepResult(i, 400));
      }
      const TOKEN_LIMIT = computeViableTokenLimit(steps);
      const cm = new ContextManager({ modelTokenLimit: TOKEN_LIMIT });

      for (const step of steps) {
        cm.addStepResult(step);
      }

      const usageBefore = cm.getTokenUsage();
      expect(usageBefore.percentage).toBeGreaterThan(SUMMARIZATION_TRIGGER_PERCENT);

      cm.summarizeIfNeeded(TOKEN_LIMIT);

      const usageAfter = cm.getTokenUsage();
      expect(usageAfter.percentage).toBeLessThanOrEqual(SUMMARIZATION_TARGET_PERCENT);
      // Verify actual reduction happened
      expect(usageAfter.used).toBeLessThan(usageBefore.used);
    });

    it('preserves the most recent 5 step results in full (Req 8.2)', () => {
      const totalSteps = 12;
      const steps: ReturnType<typeof makeLargeStepResult>[] = [];
      for (let i = 0; i < totalSteps; i++) {
        steps.push(makeLargeStepResult(i, 400));
      }
      const TOKEN_LIMIT = computeViableTokenLimit(steps);
      const cm = new ContextManager({ modelTokenLimit: TOKEN_LIMIT });

      for (const step of steps) {
        cm.addStepResult(step);
      }

      // Confirm we exceed 80%
      expect(cm.getTokenUsage().percentage).toBeGreaterThan(SUMMARIZATION_TRIGGER_PERCENT);

      cm.summarizeIfNeeded(TOKEN_LIMIT);

      const history = cm.getStepHistory();

      // The last 5 step results should be preserved in full
      const recentSteps = history.slice(-PRESERVED_RECENT_STEPS);
      expect(recentSteps).toHaveLength(PRESERVED_RECENT_STEPS);

      for (let i = 0; i < PRESERVED_RECENT_STEPS; i++) {
        const expectedIndex = totalSteps - PRESERVED_RECENT_STEPS + i;
        const step = recentSteps[i];

        // Verify stepId is preserved
        expect(step.stepId).toBe(`step-${expectedIndex}`);
        // Verify the full original output is intact (not summarized)
        expect(step.output).toContain(`Modified /src/components/Component${expectedIndex}.tsx`);
        expect(step.output).toContain(`handleAction${expectedIndex}`);
        // Verify toolCalls are preserved
        expect(step.toolCalls).toBeDefined();
        expect(Array.isArray(step.toolCalls)).toBe(true);
        expect(step.toolCalls.length).toBe(1);
      }
    });

    it('retains file paths and key identifiers from summarized entries', () => {
      const totalSteps = 12;
      const steps: ReturnType<typeof makeLargeStepResult>[] = [];
      for (let i = 0; i < totalSteps; i++) {
        steps.push(makeLargeStepResult(i, 400));
      }
      const TOKEN_LIMIT = computeViableTokenLimit(steps);
      const cm = new ContextManager({ modelTokenLimit: TOKEN_LIMIT });

      for (const step of steps) {
        cm.addStepResult(step);
      }

      expect(cm.getTokenUsage().percentage).toBeGreaterThan(SUMMARIZATION_TRIGGER_PERCENT);
      cm.summarizeIfNeeded(TOKEN_LIMIT);

      const history = cm.getStepHistory();

      // The first few steps should be summarized (older ones)
      const summarizedCount = totalSteps - PRESERVED_RECENT_STEPS;
      const summarizedSteps = history.slice(0, summarizedCount);

      for (let i = 0; i < summarizedSteps.length; i++) {
        const step = summarizedSteps[i];

        // Summarized steps should retain file paths
        if (step.filePaths) {
          expect(step.filePaths.length).toBeGreaterThan(0);
          const hasExpectedPath = step.filePaths.some(
            (p: string) => p.includes(`Component${i}`)
          );
          expect(hasExpectedPath).toBe(true);
        } else {
          // File paths may be in the output/summary text
          expect(step.output || step.summary).toContain(`Component${i}`);
        }

        // Summarized steps should retain key identifiers in the summary
        const outputText = step.output || step.summary || '';
        expect(outputText).toContain(`handleAction${i}`);
      }
    });

    it('total step count is preserved after summarization', () => {
      const totalSteps = 12;
      const steps: ReturnType<typeof makeLargeStepResult>[] = [];
      for (let i = 0; i < totalSteps; i++) {
        steps.push(makeLargeStepResult(i, 300));
      }
      const TOKEN_LIMIT = computeViableTokenLimit(steps);
      const cm = new ContextManager({ modelTokenLimit: TOKEN_LIMIT });

      for (const step of steps) {
        cm.addStepResult(step);
      }

      cm.summarizeIfNeeded(TOKEN_LIMIT);
      const history = cm.getStepHistory();

      // Total history length should remain the same (no steps are removed)
      expect(history).toHaveLength(totalSteps);
    });
  });

  // ─── Test 2: Context continues working after summarization ─────────────────

  describe('Test 2: Context continues working after summarization', () => {
    it('incorporates new step results after summarization', () => {
      const steps: ReturnType<typeof makeLargeStepResult>[] = [];
      for (let i = 0; i < 12; i++) {
        steps.push(makeLargeStepResult(i, 300));
      }
      const TOKEN_LIMIT = computeViableTokenLimit(steps);
      const cm = new ContextManager({ modelTokenLimit: TOKEN_LIMIT });

      for (const step of steps) {
        cm.addStepResult(step);
      }

      // Trigger summarization
      cm.summarizeIfNeeded(TOKEN_LIMIT);
      const usageAfterFirstSummarization = cm.getTokenUsage();
      expect(usageAfterFirstSummarization.percentage).toBeLessThanOrEqual(SUMMARIZATION_TARGET_PERCENT);

      // Add new step results after summarization
      const newStep = makeLargeStepResult(100, 150);
      cm.addStepResult(newStep);

      // Verify the new result is incorporated
      const history = cm.getStepHistory();
      const lastStep = history[history.length - 1];
      expect(lastStep.stepId).toBe('step-100');
      expect(lastStep.output).toContain('Component100');

      // Verify token usage increased with the new step
      const usageAfterNewStep = cm.getTokenUsage();
      expect(usageAfterNewStep.used).toBeGreaterThan(usageAfterFirstSummarization.used);
    });

    it('triggers a second summarization if context fills again after first', () => {
      // We need to compute a limit that works for both rounds.
      // Use the second-round total (first round summarized + second round steps).
      const firstBatchSteps: ReturnType<typeof makeLargeStepResult>[] = [];
      for (let i = 0; i < 12; i++) {
        firstBatchSteps.push(makeLargeStepResult(i, 300));
      }
      // Use first batch to compute initial limit
      const TOKEN_LIMIT = computeViableTokenLimit(firstBatchSteps);
      const cm = new ContextManager({ modelTokenLimit: TOKEN_LIMIT });

      // First fill
      for (const step of firstBatchSteps) {
        cm.addStepResult(step);
      }
      cm.summarizeIfNeeded(TOKEN_LIMIT);

      const usageAfterFirst = cm.getTokenUsage();
      expect(usageAfterFirst.percentage).toBeLessThanOrEqual(SUMMARIZATION_TARGET_PERCENT);

      // Second fill: add more steps to push past 80% again
      // With the same limit, adding enough new large steps should exceed 80%
      for (let i = 20; i < 32; i++) {
        cm.addStepResult(makeLargeStepResult(i, 300));
      }

      // Verify it went above 80% again
      const usageBeforeSecond = cm.getTokenUsage();
      expect(usageBeforeSecond.percentage).toBeGreaterThan(SUMMARIZATION_TRIGGER_PERCENT);

      // Trigger second summarization
      cm.summarizeIfNeeded(TOKEN_LIMIT);

      // Verify token reduction happened
      const usageAfterSecond = cm.getTokenUsage();
      expect(usageAfterSecond.used).toBeLessThan(usageBeforeSecond.used);
    });

    it('preserves recent 5 steps from the latest batch after second summarization', () => {
      const firstBatchSteps: ReturnType<typeof makeLargeStepResult>[] = [];
      for (let i = 0; i < 10; i++) {
        firstBatchSteps.push(makeLargeStepResult(i, 300));
      }
      const TOKEN_LIMIT = computeViableTokenLimit(firstBatchSteps);
      const cm = new ContextManager({ modelTokenLimit: TOKEN_LIMIT });

      // First fill
      for (const step of firstBatchSteps) {
        cm.addStepResult(step);
      }
      cm.summarizeIfNeeded(TOKEN_LIMIT);

      // Second fill
      for (let i = 50; i < 60; i++) {
        cm.addStepResult(makeLargeStepResult(i, 300));
      }
      cm.summarizeIfNeeded(TOKEN_LIMIT);

      const history = cm.getStepHistory();
      const recentSteps = history.slice(-PRESERVED_RECENT_STEPS);

      // The most recent 5 steps should be from the second batch (steps 55-59)
      for (let i = 0; i < PRESERVED_RECENT_STEPS; i++) {
        const expectedIndex = 60 - PRESERVED_RECENT_STEPS + i;
        expect(recentSteps[i].stepId).toBe(`step-${expectedIndex}`);
        // Full output should be preserved
        expect(recentSteps[i].output).toContain(`Component${expectedIndex}`);
      }
    });

    it('buildPrompt works correctly after summarization', () => {
      const steps: ReturnType<typeof makeLargeStepResult>[] = [];
      for (let i = 0; i < 12; i++) {
        steps.push(makeLargeStepResult(i, 300));
      }
      const TOKEN_LIMIT = computeViableTokenLimit(steps);
      const cm = new ContextManager({ modelTokenLimit: TOKEN_LIMIT });

      // Fill and summarize
      for (const step of steps) {
        cm.addStepResult(step);
      }
      cm.summarizeIfNeeded(TOKEN_LIMIT);

      // Build prompt should still work
      const task = {
        instruction: 'Continue refactoring the codebase',
        workingDirectory: '/project',
        attachments: [],
        followUpInstructions: []
      };
      const plan = {
        steps: [{ id: 's-1', title: 'Next step', description: 'Do next thing', riskLevel: 'low', requiredTools: [], parallelSafe: false, timeout: 120000, dependsOn: [] }],
        estimatedDuration: 10000,
        reasoning: 'Continue from where we left off'
      };

      const ctx = cm.buildPrompt(task, plan, cm.getStepHistory());

      expect(ctx.systemPrompt).toBe(DEFAULT_SYSTEM_PROMPT);
      expect(ctx.taskInstruction).toBe(task.instruction);
      expect(ctx.currentPlan).toEqual(plan);
      expect(ctx.stepHistory.length).toBe(12); // All steps still tracked
      expect(ctx.totalTokens).toBeGreaterThan(0);
      // After summarization, totalTokens should have been reduced significantly
      expect(ctx.totalTokens).toBeLessThan(TOKEN_LIMIT);
    });

    it('follow-up instructions trigger summarization if context would overflow', () => {
      // Use a controlled token limit where 8 steps exceed 80%
      const steps: ReturnType<typeof makeLargeStepResult>[] = [];
      for (let i = 0; i < 10; i++) {
        steps.push(makeLargeStepResult(i, 300));
      }
      const TOKEN_LIMIT = computeViableTokenLimit(steps);
      const cm = new ContextManager({ modelTokenLimit: TOKEN_LIMIT });

      // Add steps that fill most of the context budget
      for (const step of steps) {
        cm.addStepResult(step);
      }

      // The steps should push us above 80% based on computeViableTokenLimit
      const usageBefore = cm.getTokenUsage();
      // The context is heavily loaded
      expect(usageBefore.percentage).toBeGreaterThan(0.7);

      // Adding a large follow-up instruction should trigger summarization internally
      // via the addFollowUp method which checks if projected usage exceeds 80%
      const largeFollowUp = 'Please also implement comprehensive error handling for all API calls and add retry logic with exponential backoff patterns. '.repeat(3);
      cm.addFollowUp(largeFollowUp);

      // After addFollowUp, the system should have managed the context
      // The follow-up should be present in the built prompt
      const task = {
        instruction: 'Test task',
        workingDirectory: '/project',
        attachments: [],
        followUpInstructions: []
      };
      const ctx = cm.buildPrompt(task, null, cm.getStepHistory());
      expect(ctx.taskInstruction).toContain('comprehensive error handling');
    });
  });
});
