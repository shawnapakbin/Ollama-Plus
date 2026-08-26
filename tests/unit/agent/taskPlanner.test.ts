import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  normalizePlan,
  extractJsonFromResponse,
  TaskPlanner,
  MAX_STEPS,
  MIN_STEPS,
  MAX_TITLE_LENGTH,
  SHORT_PLAN_TIMEOUT_MS,
  LONG_PLAN_TIMEOUT_MS,
  MAX_REPLAN_ATTEMPTS,
  VALID_RISK_LEVELS,
  VALID_TOOL_CATEGORIES
} from '../../../electron/runtime/agent/taskPlanner.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeValidStep(overrides: Record<string, unknown> = {}) {
  return {
    id: 'step-1',
    title: 'Read project configuration',
    description: 'Read the package.json to understand project structure',
    riskLevel: 'low',
    requiredTools: [{ name: 'folder', server: 'folder-server', category: 'folder' }],
    parallelSafe: false,
    timeout: 30000,
    dependsOn: [],
    ...overrides
  };
}

function makeValidPlan(stepOverrides: Record<string, unknown>[] = []) {
  const steps = stepOverrides.length > 0
    ? stepOverrides.map((o, i) => makeValidStep({ id: `step-${i + 1}`, ...o }))
    : [makeValidStep()];

  return {
    steps,
    reasoning: 'Plan generated based on task analysis.'
  };
}

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    instruction: 'Create a new React component for user authentication',
    workingDirectory: '/home/user/project',
    attachments: [],
    followUpInstructions: [],
    ...overrides
  };
}

function makeContext(overrides: Record<string, unknown> = {}) {
  return {
    systemPrompt: 'You are an agent',
    taskInstruction: 'Create a component',
    currentPlan: null,
    stepHistory: [],
    fileContents: [],
    memoryRecords: [],
    totalTokens: 500,
    ...overrides
  };
}

function makeMockFetch(responseData: unknown) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      message: { content: JSON.stringify(responseData) }
    })
  });
}

// ─── Unit Tests: normalizePlan ───────────────────────────────────────────────

describe('taskPlanner - normalizePlan', () => {
  it('normalizes a valid plan successfully', () => {
    const raw = makeValidPlan();
    const result = normalizePlan(raw);

    expect(result.valid).toBe(true);
    expect(result.plan).not.toBeNull();
    expect(result.plan!.steps).toHaveLength(1);
    expect(result.plan!.steps[0].title).toBe('Read project configuration');
    expect(result.plan!.steps[0].riskLevel).toBe('low');
  });

  it('rejects null input', () => {
    const result = normalizePlan(null);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Plan must be a non-null object');
  });

  it('rejects non-object input', () => {
    const result = normalizePlan('not an object');
    expect(result.valid).toBe(false);
  });

  it('rejects a plan with no steps array', () => {
    const result = normalizePlan({ reasoning: 'no steps' });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Plan must contain a "steps" array');
  });

  it('rejects a plan with empty steps array', () => {
    const result = normalizePlan({ steps: [] });
    expect(result.valid).toBe(false);
  });

  it('truncates plans exceeding MAX_STEPS', () => {
    const steps = Array.from({ length: 55 }, (_, i) => makeValidStep({ id: `step-${i + 1}` }));
    const result = normalizePlan({ steps, reasoning: 'big plan' });

    expect(result.valid).toBe(true);
    expect(result.plan!.steps).toHaveLength(MAX_STEPS);
  });

  it('generates IDs for steps without them', () => {
    const raw = { steps: [{ title: 'Test step', requiredTools: [{ name: 'terminal', server: 'ts', category: 'terminal' }] }] };
    const result = normalizePlan(raw);

    expect(result.valid).toBe(true);
    expect(result.plan!.steps[0].id).toBe('step-1');
  });

  it('truncates titles exceeding MAX_TITLE_LENGTH', () => {
    const longTitle = 'A'.repeat(200);
    const raw = makeValidPlan([{ title: longTitle }]);
    const result = normalizePlan(raw);

    expect(result.valid).toBe(true);
    expect(result.plan!.steps[0].title).toHaveLength(MAX_TITLE_LENGTH);
  });

  it('defaults risk level to medium for invalid values', () => {
    const raw = makeValidPlan([{ riskLevel: 'critical' }]);
    const result = normalizePlan(raw);

    expect(result.valid).toBe(true);
    expect(result.plan!.steps[0].riskLevel).toBe('medium');
  });

  it('infers tool category from step title when no tools provided', () => {
    const raw = { steps: [{ title: 'Run npm install', description: 'Install dependencies' }] };
    const result = normalizePlan(raw);

    expect(result.valid).toBe(true);
    expect(result.plan!.steps[0].requiredTools.length).toBeGreaterThan(0);
    expect(result.plan!.steps[0].requiredTools[0].category).toBe('terminal');
  });

  it('preserves parallelSafe flag', () => {
    const raw = makeValidPlan([{ parallelSafe: true }]);
    const result = normalizePlan(raw);

    expect(result.valid).toBe(true);
    expect(result.plan!.steps[0].parallelSafe).toBe(true);
  });

  it('defaults parallelSafe to false', () => {
    const raw = makeValidPlan([{}]);
    const result = normalizePlan(raw);

    expect(result.valid).toBe(true);
    expect(result.plan!.steps[0].parallelSafe).toBe(false);
  });

  it('removes self-dependencies', () => {
    const raw = makeValidPlan([{ id: 'step-1', dependsOn: ['step-1'] }]);
    const result = normalizePlan(raw);

    expect(result.valid).toBe(true);
    expect(result.plan!.steps[0].dependsOn).not.toContain('step-1');
  });

  it('removes dependencies on non-existent steps', () => {
    const raw = makeValidPlan([{ id: 'step-1', dependsOn: ['step-99'] }]);
    const result = normalizePlan(raw);

    expect(result.valid).toBe(true);
    expect(result.plan!.steps[0].dependsOn).not.toContain('step-99');
  });

  it('computes estimatedDuration from step timeouts', () => {
    const raw = makeValidPlan([
      { id: 'step-1', timeout: 30000 },
      { id: 'step-2', timeout: 60000 }
    ]);
    const result = normalizePlan(raw);

    expect(result.valid).toBe(true);
    expect(result.plan!.estimatedDuration).toBe(90000);
  });

  it('handles alternative field names (tasks instead of steps)', () => {
    const raw = { tasks: [makeValidStep()] };
    const result = normalizePlan(raw);

    expect(result.valid).toBe(true);
    expect(result.plan!.steps).toHaveLength(1);
  });

  it('handles nested plan.steps structure', () => {
    const raw = { plan: { steps: [makeValidStep()] } };
    const result = normalizePlan(raw);

    expect(result.valid).toBe(true);
    expect(result.plan!.steps).toHaveLength(1);
  });

  it('handles string-based tool references', () => {
    const raw = { steps: [{ title: 'Test', requiredTools: ['terminal', 'folder'] }] };
    const result = normalizePlan(raw);

    expect(result.valid).toBe(true);
    expect(result.plan!.steps[0].requiredTools).toHaveLength(2);
    expect(result.plan!.steps[0].requiredTools[0].category).toBe('terminal');
    expect(result.plan!.steps[0].requiredTools[1].category).toBe('folder');
  });

  it('uses explanation field as reasoning fallback', () => {
    const raw = { steps: [makeValidStep()], explanation: 'My reasoning' };
    const result = normalizePlan(raw);

    expect(result.valid).toBe(true);
    expect(result.plan!.reasoning).toBe('My reasoning');
  });

  it('assigns unique IDs when duplicates are detected', () => {
    const raw = { steps: [makeValidStep({ id: 'dup' }), makeValidStep({ id: 'dup' })] };
    const result = normalizePlan(raw);

    expect(result.valid).toBe(true);
    const ids = result.plan!.steps.map(s => s.id);
    expect(new Set(ids).size).toBe(2);
  });
});

// ─── Unit Tests: extractJsonFromResponse ─────────────────────────────────────

describe('taskPlanner - extractJsonFromResponse', () => {
  it('parses raw JSON directly', () => {
    const json = { steps: [{ title: 'test' }] };
    const result = extractJsonFromResponse(JSON.stringify(json));
    expect(result).toEqual(json);
  });

  it('extracts JSON from markdown code block', () => {
    const json = { steps: [{ title: 'test' }] };
    const text = `Here is the plan:\n\`\`\`json\n${JSON.stringify(json)}\n\`\`\``;
    const result = extractJsonFromResponse(text);
    expect(result).toEqual(json);
  });

  it('extracts JSON from bare code block (no language hint)', () => {
    const json = { steps: [{ title: 'test' }] };
    const text = `\`\`\`\n${JSON.stringify(json)}\n\`\`\``;
    const result = extractJsonFromResponse(text);
    expect(result).toEqual(json);
  });

  it('extracts JSON from surrounding text using braces', () => {
    const json = { steps: [{ title: 'test' }] };
    const text = `Here is my plan: ${JSON.stringify(json)} I hope this helps!`;
    const result = extractJsonFromResponse(text);
    expect(result).toEqual(json);
  });

  it('extracts array-style plans and wraps in object', () => {
    const steps = [{ title: 'step 1' }, { title: 'step 2' }];
    // Wrap in surrounding text so direct JSON.parse fails and we hit the array extraction path
    const text = `Here is my plan:\n[${JSON.stringify(steps[0])},${JSON.stringify(steps[1])}]\nDone.`;
    const result = extractJsonFromResponse(text);
    expect(result).toEqual({ steps });
  });

  it('returns null for empty string', () => {
    expect(extractJsonFromResponse('')).toBeNull();
  });

  it('returns null for non-string input', () => {
    expect(extractJsonFromResponse(null as unknown as string)).toBeNull();
    expect(extractJsonFromResponse(undefined as unknown as string)).toBeNull();
    expect(extractJsonFromResponse(123 as unknown as string)).toBeNull();
  });

  it('returns null for completely invalid text', () => {
    expect(extractJsonFromResponse('no json here at all')).toBeNull();
  });
});

// ─── Unit Tests: TaskPlanner class ───────────────────────────────────────────

describe('taskPlanner - TaskPlanner class', () => {
  let planner: InstanceType<typeof TaskPlanner>;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = makeMockFetch(makeValidPlan());
    planner = new TaskPlanner({
      endpoint: 'http://localhost:11434',
      modelId: 'llama3',
      fetchFn: mockFetch
    });
  });

  describe('generatePlan', () => {
    it('generates a plan from a valid task', async () => {
      const task = makeTask();
      const context = makeContext();

      const plan = await planner.generatePlan(task, context);

      expect(plan.steps).toHaveLength(1);
      expect(plan.steps[0].title).toBe('Read project configuration');
      expect(plan.reasoning).toBeDefined();
    });

    it('throws on empty instruction', async () => {
      const task = makeTask({ instruction: '' });
      const context = makeContext();

      await expect(planner.generatePlan(task, context)).rejects.toThrow(
        'Task instruction is required'
      );
    });

    it('throws on whitespace-only instruction', async () => {
      const task = makeTask({ instruction: '   \n\t  ' });
      const context = makeContext();

      await expect(planner.generatePlan(task, context)).rejects.toThrow(
        'Task instruction is required'
      );
    });

    it('throws when LLM returns unparseable response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: { content: 'No JSON here.' } })
      });

      const task = makeTask();
      const context = makeContext();

      await expect(planner.generatePlan(task, context)).rejects.toThrow(
        'Failed to parse plan from LLM response'
      );
    });

    it('throws when LLM returns invalid plan structure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: { content: JSON.stringify({ steps: [] }) } })
      });

      const task = makeTask();
      const context = makeContext();

      await expect(planner.generatePlan(task, context)).rejects.toThrow(
        'Plan validation failed'
      );
    });

    it('includes context items in the fetch request', async () => {
      const task = makeTask();
      const context = makeContext({
        fileContents: [{ path: '/project/src/App.tsx', content: 'export default App', tokenCount: 10 }],
        memoryRecords: [{ fact: 'Uses TypeScript', tags: ['typescript'], importanceScore: 80 }],
        stepHistory: [{ stepId: 'prev-1', title: 'Previous step', status: 'completed', output: 'Done' }]
      });

      await planner.generatePlan(task, context);

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      const userMessage = callBody.messages[1].content;

      expect(userMessage).toContain('/project/src/App.tsx');
      expect(userMessage).toContain('Uses TypeScript');
      expect(userMessage).toContain('Previous step');
    });

    it('handles fetch HTTP error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error'
      });

      const task = makeTask();
      const context = makeContext();

      await expect(planner.generatePlan(task, context)).rejects.toThrow(
        'Ollama API error (500)'
      );
    });

    it('handles fetch abort (timeout)', async () => {
      mockFetch.mockRejectedValueOnce(new DOMException('The operation was aborted', 'AbortError'));

      const task = makeTask();
      const context = makeContext();

      await expect(planner.generatePlan(task, context)).rejects.toThrow(
        'timed out'
      );
    });
  });

  describe('replan', () => {
    it('generates a new plan with constraints', async () => {
      const task = makeTask();
      const context = makeContext();
      const constraints = {
        excludedApproaches: ['direct file deletion'],
        deniedActions: [],
        errorContext: null,
        maxSteps: 10
      };

      const plan = await planner.replan(task, context, constraints);
      expect(plan.steps.length).toBeGreaterThan(0);
    });

    it('includes denied actions in the prompt', async () => {
      const task = makeTask();
      const context = makeContext();
      const constraints = {
        excludedApproaches: [],
        deniedActions: [{
          tool: 'terminal',
          action: 'delete',
          params: { path: '/etc/passwd' },
          reason: 'Too dangerous'
        }],
        errorContext: null,
        maxSteps: 50
      };

      await planner.replan(task, context, constraints);

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      const userMessage = callBody.messages[1].content;

      expect(userMessage).toContain('terminal');
      expect(userMessage).toContain('delete');
      expect(userMessage).toContain('Too dangerous');
    });

    it('includes error context in the prompt', async () => {
      const task = makeTask();
      const context = makeContext();
      const constraints = {
        excludedApproaches: [],
        deniedActions: [],
        errorContext: {
          type: 'ToolError',
          message: 'Command not found: npm',
          stepId: 'step-3',
          attemptCount: 2
        },
        maxSteps: 50
      };

      await planner.replan(task, context, constraints);

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      const userMessage = callBody.messages[1].content;

      expect(userMessage).toContain('Command not found: npm');
      expect(userMessage).toContain('step-3');
    });

    it('increments replan counter', async () => {
      const task = makeTask();
      const context = makeContext();
      const constraints = { excludedApproaches: [], deniedActions: [], errorContext: null, maxSteps: 50 };

      expect(planner.getReplanCount()).toBe(0);

      await planner.replan(task, context, constraints);
      expect(planner.getReplanCount()).toBe(1);

      await planner.replan(task, context, constraints);
      expect(planner.getReplanCount()).toBe(2);
    });

    it('throws when replan limit is exceeded', async () => {
      const task = makeTask();
      const context = makeContext();
      const constraints = { excludedApproaches: [], deniedActions: [], errorContext: null, maxSteps: 50 };

      // Exhaust replan budget
      await planner.replan(task, context, constraints);
      await planner.replan(task, context, constraints);
      await planner.replan(task, context, constraints);

      await expect(planner.replan(task, context, constraints)).rejects.toThrow(
        'Maximum re-plan attempts'
      );
    });

    it('removes steps that violate denied actions', async () => {
      // LLM returns a plan that includes a denied action
      const planWithDenied = {
        steps: [
          {
            id: 'step-1',
            title: 'Delete temporary files',
            description: 'Delete the tmp directory',
            riskLevel: 'high',
            requiredTools: [{ name: 'terminal', server: 'terminal-server', category: 'terminal' }],
            parallelSafe: false,
            timeout: 60000,
            dependsOn: []
          },
          makeValidStep({ id: 'step-2', title: 'Read config' })
        ],
        reasoning: 'Plan with deletion'
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: { content: JSON.stringify(planWithDenied) } })
      });

      const task = makeTask();
      const context = makeContext();
      const constraints = {
        excludedApproaches: [],
        deniedActions: [{
          tool: 'terminal',
          action: 'delete',
          params: {},
          reason: 'No deletions allowed'
        }],
        errorContext: null,
        maxSteps: 50
      };

      const plan = await planner.replan(task, context, constraints);

      // The step with 'delete' in title and terminal tool should be removed
      const hasDeleteStep = plan.steps.some(s =>
        s.title.toLowerCase().includes('delete') &&
        s.requiredTools.some(t => t.category === 'terminal')
      );
      expect(hasDeleteStep).toBe(false);
    });
  });

  describe('configuration', () => {
    it('resetReplanCount resets counter', async () => {
      const task = makeTask();
      const context = makeContext();
      const constraints = { excludedApproaches: [], deniedActions: [], errorContext: null, maxSteps: 50 };

      await planner.replan(task, context, constraints);
      expect(planner.getReplanCount()).toBe(1);

      planner.resetReplanCount();
      expect(planner.getReplanCount()).toBe(0);
    });

    it('setModelId updates model', () => {
      planner.setModelId('codellama');
      // Verify by making a call and checking the request
      const task = makeTask();
      const context = makeContext();
      planner.generatePlan(task, context);

      const callBody = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(callBody.model).toBe('codellama');
    });

    it('setEndpoint updates endpoint', async () => {
      planner.setEndpoint('http://remote:11434');
      const task = makeTask();
      const context = makeContext();
      await planner.generatePlan(task, context);

      expect(mockFetch.mock.calls[0][0]).toBe('http://remote:11434/api/chat');
    });

    it('getPlanningTimeout returns correct values', () => {
      expect(planner.getPlanningTimeout(5)).toBe(SHORT_PLAN_TIMEOUT_MS);
      expect(planner.getPlanningTimeout(9)).toBe(SHORT_PLAN_TIMEOUT_MS);
      expect(planner.getPlanningTimeout(10)).toBe(LONG_PLAN_TIMEOUT_MS);
      expect(planner.getPlanningTimeout(50)).toBe(LONG_PLAN_TIMEOUT_MS);
    });
  });

  describe('OllamaClient integration', () => {
    it('uses ollamaClient.chat when provided', async () => {
      const mockChat = vi.fn().mockResolvedValue({
        message: { content: JSON.stringify(makeValidPlan()) }
      });

      const clientPlanner = new TaskPlanner({
        ollamaClient: { chat: mockChat },
        modelId: 'llama3'
      });

      const task = makeTask();
      const context = makeContext();
      const plan = await clientPlanner.generatePlan(task, context);

      expect(mockChat).toHaveBeenCalledOnce();
      expect(plan.steps.length).toBeGreaterThan(0);
    });

    it('handles ollamaClient returning string directly', async () => {
      const mockChat = vi.fn().mockResolvedValue(JSON.stringify(makeValidPlan()));

      const clientPlanner = new TaskPlanner({
        ollamaClient: { chat: mockChat },
        modelId: 'llama3'
      });

      const task = makeTask();
      const context = makeContext();
      const plan = await clientPlanner.generatePlan(task, context);

      expect(plan.steps.length).toBeGreaterThan(0);
    });
  });
});

// ─── Unit Tests: Constants ───────────────────────────────────────────────────

describe('taskPlanner - Constants', () => {
  it('MAX_STEPS is 50', () => {
    expect(MAX_STEPS).toBe(50);
  });

  it('MIN_STEPS is 1', () => {
    expect(MIN_STEPS).toBe(1);
  });

  it('MAX_TITLE_LENGTH is 120', () => {
    expect(MAX_TITLE_LENGTH).toBe(120);
  });

  it('SHORT_PLAN_TIMEOUT_MS is 30 seconds', () => {
    expect(SHORT_PLAN_TIMEOUT_MS).toBe(30_000);
  });

  it('LONG_PLAN_TIMEOUT_MS is 60 seconds', () => {
    expect(LONG_PLAN_TIMEOUT_MS).toBe(60_000);
  });

  it('MAX_REPLAN_ATTEMPTS is 3', () => {
    expect(MAX_REPLAN_ATTEMPTS).toBe(3);
  });

  it('VALID_RISK_LEVELS contains expected values', () => {
    expect(VALID_RISK_LEVELS.has('low')).toBe(true);
    expect(VALID_RISK_LEVELS.has('medium')).toBe(true);
    expect(VALID_RISK_LEVELS.has('high')).toBe(true);
    expect(VALID_RISK_LEVELS.size).toBe(3);
  });

  it('VALID_TOOL_CATEGORIES contains expected values', () => {
    expect(VALID_TOOL_CATEGORIES.has('terminal')).toBe(true);
    expect(VALID_TOOL_CATEGORIES.has('folder')).toBe(true);
    expect(VALID_TOOL_CATEGORIES.has('browser')).toBe(true);
    expect(VALID_TOOL_CATEGORIES.has('python')).toBe(true);
    expect(VALID_TOOL_CATEGORIES.has('http')).toBe(true);
    expect(VALID_TOOL_CATEGORIES.size).toBe(5);
  });
});


// ─── Property-Based Tests (fast-check) ──────────────────────────────────────
// Feature: agent-client, Properties 3 and 13
// **Validates: Requirements 2.1, 2.2, 6.4**

import fc from 'fast-check';

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/**
 * Generates a random string title with length between 0 and 200
 * to test both valid and overflow cases.
 */
const randomTitleArb = fc.string({ minLength: 0, maxLength: 200 });

/**
 * Generates a random risk level — includes valid and invalid values.
 */
const randomRiskLevelArb = fc.oneof(
  { weight: 3, arbitrary: fc.constantFrom('low', 'medium', 'high') },
  { weight: 1, arbitrary: fc.constantFrom('critical', 'none', 'extreme', '', 'LOW', 'HIGH') }
);

/**
 * Generates a valid tool category string.
 */
const validCategoryArb = fc.constantFrom('terminal', 'folder', 'browser', 'python', 'http');

/**
 * Generates a random tool reference (may be string or object).
 */
const toolReferenceArb = fc.oneof(
  { weight: 2, arbitrary: validCategoryArb },
  { weight: 2, arbitrary: fc.record({
    name: fc.string({ minLength: 1, maxLength: 30 }),
    server: fc.string({ minLength: 1, maxLength: 30 }),
    category: validCategoryArb
  })},
  { weight: 1, arbitrary: fc.constantFrom('shell', 'file', 'web', 'cli', 'read', 'write') }
);

/**
 * Generates a random required tools array (possibly empty to test fallback).
 */
const randomToolsArrayArb = fc.oneof(
  { weight: 3, arbitrary: fc.array(toolReferenceArb, { minLength: 1, maxLength: 5 }) },
  { weight: 1, arbitrary: fc.constant([]) },
  { weight: 1, arbitrary: fc.constant(undefined) }
);

/**
 * Generates a random single step object.
 */
const randomStepArb = fc.record({
  id: fc.oneof(
    { weight: 3, arbitrary: fc.string({ minLength: 1, maxLength: 20 }).map(s => `step-${s.replace(/\s/g, '')}`) },
    { weight: 1, arbitrary: fc.constant(undefined) }
  ),
  title: randomTitleArb,
  description: fc.string({ minLength: 0, maxLength: 100 }),
  riskLevel: randomRiskLevelArb,
  requiredTools: randomToolsArrayArb,
  parallelSafe: fc.oneof(
    { weight: 2, arbitrary: fc.boolean() },
    { weight: 1, arbitrary: fc.constant(undefined) }
  ),
  timeout: fc.oneof(
    { weight: 3, arbitrary: fc.integer({ min: 1000, max: 300000 }) },
    { weight: 1, arbitrary: fc.constant(undefined) }
  ),
  dependsOn: fc.oneof(
    { weight: 2, arbitrary: fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 0, maxLength: 3 }) },
    { weight: 1, arbitrary: fc.constant(undefined) }
  )
});

/**
 * Generates a random plan object with 1-60 steps.
 */
const randomPlanArb = fc.record({
  steps: fc.array(randomStepArb, { minLength: 1, maxLength: 60 }),
  reasoning: fc.oneof(
    { weight: 3, arbitrary: fc.string({ minLength: 1, maxLength: 200 }) },
    { weight: 1, arbitrary: fc.constant(undefined) }
  )
});

/**
 * Generates a random tool+action pair representing a denied action.
 */
const deniedActionArb = fc.record({
  tool: fc.constantFrom('terminal', 'folder', 'browser', 'python', 'http'),
  action: fc.constantFrom('delete', 'remove', 'destroy', 'drop', 'kill', 'execute'),
  params: fc.constant({}),
  reason: fc.string({ minLength: 1, maxLength: 50 })
});

// ─── Property 3: Plan structure invariants ───────────────────────────────────

describe('Feature: agent-client, Property 3: Plan structure invariants', () => {
  /**
   * **Validates: Requirements 2.1, 2.2**
   *
   * For any plan produced by the Task Planner, the plan SHALL contain between
   * 1 and 50 steps, each step SHALL have a title of 1 to 120 characters,
   * a risk level in {low, medium, high}, and a non-empty list of required tools.
   */
  it('valid normalized plans always have 1–50 steps with valid titles, risk levels, and tools (PBT)', () => {
    fc.assert(
      fc.property(randomPlanArb, (rawPlan) => {
        const result = normalizePlan(rawPlan);

        // Only check invariants when normalization succeeds
        if (!result.valid || !result.plan) return;

        const { plan } = result;

        // Invariant: step count between 1 and MAX_STEPS (50)
        expect(plan.steps.length).toBeGreaterThanOrEqual(1);
        expect(plan.steps.length).toBeLessThanOrEqual(MAX_STEPS);

        for (const step of plan.steps) {
          // Invariant: title is 1–120 characters
          expect(step.title.length).toBeGreaterThanOrEqual(1);
          expect(step.title.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);

          // Invariant: risk level is one of the valid values
          expect(VALID_RISK_LEVELS.has(step.riskLevel)).toBe(true);

          // Invariant: requiredTools is a non-empty array
          expect(Array.isArray(step.requiredTools)).toBe(true);
          expect(step.requiredTools.length).toBeGreaterThan(0);

          // Invariant: each tool has a valid category
          for (const tool of step.requiredTools) {
            expect(VALID_TOOL_CATEGORIES.has(tool.category)).toBe(true);
            expect(typeof tool.name).toBe('string');
            expect(tool.name.length).toBeGreaterThan(0);
            expect(typeof tool.server).toBe('string');
            expect(tool.server.length).toBeGreaterThan(0);
          }
        }
      }),
      { numRuns: 150 }
    );
  });

  /**
   * **Validates: Requirements 2.1, 2.2**
   *
   * Plans with more than 50 steps are truncated to exactly 50.
   */
  it('plans exceeding MAX_STEPS are always truncated to 50 (PBT)', () => {
    const largePlanArb = fc.array(randomStepArb, { minLength: 51, maxLength: 60 })
      .map(steps => ({ steps, reasoning: 'Large plan' }));

    fc.assert(
      fc.property(largePlanArb, (rawPlan) => {
        const result = normalizePlan(rawPlan);

        if (!result.valid || !result.plan) return;

        expect(result.plan.steps.length).toBeLessThanOrEqual(MAX_STEPS);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 2.1, 2.2**
   *
   * All step IDs in a valid plan are unique (no duplicates).
   */
  it('valid plans always have unique step IDs (PBT)', () => {
    fc.assert(
      fc.property(randomPlanArb, (rawPlan) => {
        const result = normalizePlan(rawPlan);

        if (!result.valid || !result.plan) return;

        const ids = result.plan.steps.map(s => s.id);
        expect(new Set(ids).size).toBe(ids.length);
      }),
      { numRuns: 150 }
    );
  });

  /**
   * **Validates: Requirements 2.1, 2.2**
   *
   * dependsOn references are always valid (reference existing step IDs, no self-refs).
   */
  it('dependsOn references are always valid in normalized plans (PBT)', () => {
    fc.assert(
      fc.property(randomPlanArb, (rawPlan) => {
        const result = normalizePlan(rawPlan);

        if (!result.valid || !result.plan) return;

        const validIds = new Set(result.plan.steps.map(s => s.id));

        for (const step of result.plan.steps) {
          for (const dep of step.dependsOn) {
            // No self-dependencies
            expect(dep).not.toBe(step.id);
            // All dependencies reference existing steps
            expect(validIds.has(dep)).toBe(true);
          }
        }
      }),
      { numRuns: 150 }
    );
  });

  /**
   * **Validates: Requirements 2.1, 2.2**
   *
   * estimatedDuration is always a positive number equal to the sum of step timeouts.
   */
  it('estimatedDuration equals the sum of step timeouts (PBT)', () => {
    fc.assert(
      fc.property(randomPlanArb, (rawPlan) => {
        const result = normalizePlan(rawPlan);

        if (!result.valid || !result.plan) return;

        const expectedDuration = result.plan.steps.reduce((sum, s) => sum + s.timeout, 0);
        expect(result.plan.estimatedDuration).toBe(expectedDuration);
        expect(result.plan.estimatedDuration).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });
});

// ─── Property 13: Denied action exclusion from re-plans ──────────────────────

describe('Feature: agent-client, Property 13: Denied action exclusion from re-plans', () => {
  /**
   * **Validates: Requirements 6.4**
   *
   * For any action denied by the user at an Approval Gate, subsequent re-plans
   * for the same Task Session SHALL not contain any step that invokes the same
   * tool with the same action and equivalent parameters as the denied operation.
   */
  it('denied tool+action combinations are excluded from replan results (PBT)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(deniedActionArb, { minLength: 1, maxLength: 3 }),
        async (deniedActions) => {
          // Build a mock plan that includes steps matching each denied action
          const deniedSteps = deniedActions.map((denied, i) => ({
            id: `denied-step-${i + 1}`,
            title: `${denied.action} temporary files`,
            description: `Perform ${denied.action} operation using ${denied.tool}`,
            riskLevel: 'high',
            requiredTools: [{ name: denied.tool, server: `${denied.tool}-server`, category: denied.tool }],
            parallelSafe: false,
            timeout: 60000,
            dependsOn: []
          }));

          // Add a safe step that should survive filtering
          const safeStep = {
            id: 'safe-step-1',
            title: 'Read project configuration',
            description: 'Read the package.json file',
            riskLevel: 'low',
            requiredTools: [{ name: 'folder', server: 'folder-server', category: 'folder' }],
            parallelSafe: false,
            timeout: 30000,
            dependsOn: []
          };

          const mockPlanResponse = {
            steps: [...deniedSteps, safeStep],
            reasoning: 'Plan with denied actions included'
          };

          const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
              message: { content: JSON.stringify(mockPlanResponse) }
            })
          });

          const planner = new TaskPlanner({
            endpoint: 'http://localhost:11434',
            modelId: 'llama3',
            fetchFn: mockFetch
          });

          const task = makeTask();
          const context = makeContext();
          const constraints = {
            excludedApproaches: [],
            deniedActions,
            errorContext: null,
            maxSteps: 50
          };

          const plan = await planner.replan(task, context, constraints);

          // Verify none of the denied tool+action combos appear
          for (const denied of deniedActions) {
            const hasDeniedStep = plan.steps.some((step: { requiredTools: Array<{ name: string; category: string; server: string }>; title: string; description: string }) => {
              const toolMatch = step.requiredTools.some(
                t => t.name === denied.tool || t.category === denied.tool
              );
              const actionMatch = step.title.toLowerCase().includes(denied.action.toLowerCase()) ||
                step.description.toLowerCase().includes(denied.action.toLowerCase());
              return toolMatch && actionMatch;
            });

            expect(hasDeniedStep).toBe(false);
          }

          // The safe step should still be present (it doesn't match any denial)
          expect(plan.steps.length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 6.4**
   *
   * When all steps in a plan match denied actions and only denied steps remain,
   * the planner either throws an error or returns a plan with no violating steps.
   */
  it('replan removes or rejects plans when all steps match denied actions (PBT)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(deniedActionArb, { minLength: 1, maxLength: 3 }),
        async (deniedActions) => {
          // Build a mock plan where EVERY step matches a denied action
          const allDeniedSteps = deniedActions.map((denied, i) => ({
            id: `step-${i + 1}`,
            title: `${denied.action} files using ${denied.tool}`,
            description: `This step performs ${denied.action}`,
            riskLevel: 'high',
            requiredTools: [{ name: denied.tool, server: `${denied.tool}-server`, category: denied.tool }],
            parallelSafe: false,
            timeout: 60000,
            dependsOn: []
          }));

          const mockPlanResponse = {
            steps: allDeniedSteps,
            reasoning: 'All steps are denied'
          };

          const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
              message: { content: JSON.stringify(mockPlanResponse) }
            })
          });

          const planner = new TaskPlanner({
            endpoint: 'http://localhost:11434',
            modelId: 'llama3',
            fetchFn: mockFetch
          });

          const task = makeTask();
          const context = makeContext();
          const constraints = {
            excludedApproaches: [],
            deniedActions,
            errorContext: null,
            maxSteps: 50
          };

          try {
            const plan = await planner.replan(task, context, constraints);
            // If it succeeds, the remaining steps must not match denials
            for (const step of plan.steps) {
              for (const denied of deniedActions) {
                const toolMatch = step.requiredTools.some(
                  (t: { name: string; category: string }) =>
                    t.name === denied.tool || t.category === denied.tool
                );
                const actionMatch = step.title.toLowerCase().includes(denied.action.toLowerCase()) ||
                  step.description.toLowerCase().includes(denied.action.toLowerCase());
                // If tool+action both match, that step should have been filtered
                if (toolMatch && actionMatch) {
                  expect.fail('A denied action survived into the plan');
                }
              }
            }
          } catch (err: unknown) {
            // Expected: error about only denied steps remaining or cannot proceed
            expect((err as Error).message).toMatch(/denied|Cannot proceed/i);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 6.4**
   *
   * The replan count increments correctly and respects MAX_REPLAN_ATTEMPTS.
   */
  it('replan respects the MAX_REPLAN_ATTEMPTS budget (PBT)', async () => {
    const replanCountArb = fc.integer({ min: 1, max: 5 });

    await fc.assert(
      fc.asyncProperty(replanCountArb, async (attemptCount) => {
        const mockFetch = vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            message: { content: JSON.stringify(makeValidPlan()) }
          })
        });

        const planner = new TaskPlanner({
          endpoint: 'http://localhost:11434',
          modelId: 'llama3',
          fetchFn: mockFetch
        });

        const task = makeTask();
        const context = makeContext();
        const constraints = {
          excludedApproaches: [],
          deniedActions: [],
          errorContext: null,
          maxSteps: 50
        };

        for (let i = 0; i < attemptCount; i++) {
          if (i < MAX_REPLAN_ATTEMPTS) {
            await planner.replan(task, context, constraints);
            expect(planner.getReplanCount()).toBe(i + 1);
          } else {
            await expect(planner.replan(task, context, constraints)).rejects.toThrow(
              'Maximum re-plan attempts'
            );
          }
        }
      }),
      { numRuns: 100 }
    );
  });
});
