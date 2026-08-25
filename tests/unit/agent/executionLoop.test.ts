import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  createExecutionLoop,
  LOOP_STATES,
  MAX_REPLAN_ATTEMPTS,
  DEFAULT_STEP_TIMEOUT_MS,
  DEFAULT_TASK_TIMEOUT_MS,
  PROGRESS_INTERVAL_MS
} from '../../../electron/runtime/agent/executionLoop.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeStep(overrides: Record<string, unknown> = {}) {
  return {
    id: `step-${Math.random().toString(36).slice(2, 8)}`,
    title: 'Test Step',
    description: 'A test step',
    riskLevel: 'low' as const,
    requiredTools: [{ name: 'terminal', server: 'terminal-server', category: 'terminal' as const }],
    parallelSafe: false,
    timeout: 60000,
    dependsOn: [] as string[],
    ...overrides
  };
}

function makePlan(steps?: any[]) {
  return {
    steps: steps || [makeStep({ id: 'step-1' }), makeStep({ id: 'step-2' }), makeStep({ id: 'step-3' })],
    estimatedDuration: 180000,
    reasoning: 'Test plan'
  };
}

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session-123',
    instruction: 'Test task instruction',
    status: 'planned' as const,
    workingDirectory: '/tmp/test',
    modelId: 'llama3',
    endpoint: 'http://localhost:11434',
    plan: null,
    attachments: [],
    artifacts: [],
    stepResults: [],
    replanCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    totalDuration: null,
    config: {
      stepTimeout: 120,
      taskTimeout: 900,
      retryCount: 3,
      autoApprovalLowRisk: false,
      customApprovalRules: [],
      toolTimeouts: { terminal: 60, file: 30, browser: 120, python: 60, http: 30 }
    },
    ...overrides
  };
}

function makeToolDispatcher(result?: { status: string; output: string; error: string | null }) {
  const dispatchResult = result || { status: 'success', output: 'done', error: null };
  return {
    dispatch: vi.fn().mockResolvedValue({
      id: 'tc_001',
      tool: 'terminal',
      server: 'terminal-server',
      action: 'execute',
      params: {},
      output: dispatchResult.output || '',
      status: dispatchResult.status,
      error: dispatchResult.error || null,
      duration: 100,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString()
    })
  };
}

function makeTaskPlanner(replanResult?: any) {
  return {
    replan: vi.fn().mockResolvedValue(replanResult || makePlan([makeStep({ id: 'replan-step-1' })]))
  };
}

function makeContextManager() {
  return {
    addStepResult: vi.fn(),
    summarizeIfNeeded: vi.fn(),
    buildPrompt: vi.fn().mockReturnValue({
      systemPrompt: '',
      taskInstruction: '',
      currentPlan: null,
      stepHistory: [],
      fileContents: [],
      memoryRecords: [],
      totalTokens: 0
    })
  };
}

function makeRetryPolicy() {
  return {
    shouldRetry: vi.fn().mockReturnValue({ action: 'replan', reason: 'No retry' }),
    classifyError: vi.fn().mockReturnValue('permanent')
  };
}

function makeRiskClassifier() {
  return {
    classify: vi.fn().mockReturnValue({ level: 'low', requiresApproval: false, reason: '' })
  };
}

/**
 * Helper to wait for all pending microtask/promise resolutions.
 * Used with real timers to let async code complete.
 */
function waitForAsync(ms = 50): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Helper to wait for an event to be emitted on a loop.
 */
function waitForEvent(loop: any, eventName: string, timeoutMs = 2000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for "${eventName}" event`)), timeoutMs);
    loop.on(eventName, (...args: any[]) => {
      clearTimeout(timer);
      resolve(args.length === 1 ? args[0] : args);
    });
  });
}

// ─── Unit Tests: Constants and Interface ─────────────────────────────────────

describe('executionLoop - createExecutionLoop', () => {
  it('exports LOOP_STATES constants', () => {
    expect(LOOP_STATES.IDLE).toBe('idle');
    expect(LOOP_STATES.RUNNING).toBe('running');
    expect(LOOP_STATES.PAUSED).toBe('paused');
    expect(LOOP_STATES.CANCELED).toBe('canceled');
    expect(LOOP_STATES.COMPLETED).toBe('completed');
    expect(LOOP_STATES.FAILED).toBe('failed');
  });

  it('exports constants with expected values', () => {
    expect(DEFAULT_STEP_TIMEOUT_MS).toBe(120_000);
    expect(DEFAULT_TASK_TIMEOUT_MS).toBe(1_800_000);
    expect(MAX_REPLAN_ATTEMPTS).toBe(3);
    expect(PROGRESS_INTERVAL_MS).toBe(1000);
  });

  it('creates an execution loop with the required interface', () => {
    const loop = createExecutionLoop({
      taskPlanner: makeTaskPlanner(),
      toolDispatcher: makeToolDispatcher(),
      contextManager: makeContextManager(),
      riskClassifier: makeRiskClassifier(),
      retryPolicy: makeRetryPolicy()
    });

    expect(typeof loop.start).toBe('function');
    expect(typeof loop.pause).toBe('function');
    expect(typeof loop.resume).toBe('function');
    expect(typeof loop.cancel).toBe('function');
    expect(typeof loop.on).toBe('function');
    expect(typeof loop.off).toBe('function');
    expect(typeof loop.getState).toBe('function');
    expect(typeof loop.getReplanCount).toBe('function');
    expect(typeof loop.getStepResults).toBe('function');
    expect(typeof loop.getCurrentPlan).toBe('function');
  });

  it('initial state is idle', () => {
    const loop = createExecutionLoop({
      taskPlanner: makeTaskPlanner(),
      toolDispatcher: makeToolDispatcher(),
      contextManager: makeContextManager(),
      riskClassifier: makeRiskClassifier(),
      retryPolicy: makeRetryPolicy()
    });

    expect(loop.getState()).toBe(LOOP_STATES.IDLE);
  });

  it('throws when starting without a valid session and plan', () => {
    const loop = createExecutionLoop({
      taskPlanner: makeTaskPlanner(),
      toolDispatcher: makeToolDispatcher(),
      contextManager: makeContextManager(),
      riskClassifier: makeRiskClassifier(),
      retryPolicy: makeRetryPolicy()
    });

    expect(() => loop.start(null as any, null as any)).toThrow();
    expect(() => loop.start(makeSession(), { steps: [], estimatedDuration: 0, reasoning: '' })).toThrow();
  });

  it('transitions to running state on start', () => {
    const loop = createExecutionLoop({
      taskPlanner: makeTaskPlanner(),
      toolDispatcher: makeToolDispatcher(),
      contextManager: makeContextManager(),
      riskClassifier: makeRiskClassifier(),
      retryPolicy: makeRetryPolicy()
    });

    loop.start(makeSession(), makePlan());
    expect(loop.getState()).toBe(LOOP_STATES.RUNNING);
  });

  it('cannot start when already running', () => {
    const loop = createExecutionLoop({
      taskPlanner: makeTaskPlanner(),
      toolDispatcher: makeToolDispatcher(),
      contextManager: makeContextManager(),
      riskClassifier: makeRiskClassifier(),
      retryPolicy: makeRetryPolicy()
    });

    loop.start(makeSession(), makePlan());
    expect(() => loop.start(makeSession(), makePlan())).toThrow();
  });
});

// ─── Sequential Execution ────────────────────────────────────────────────────

describe('executionLoop - sequential step execution', () => {
  it('executes steps and emits step-start events', async () => {
    const stepStartHandler = vi.fn();

    const loop = createExecutionLoop({
      taskPlanner: makeTaskPlanner(),
      toolDispatcher: makeToolDispatcher(),
      contextManager: makeContextManager(),
      riskClassifier: makeRiskClassifier(),
      retryPolicy: makeRetryPolicy()
    });

    loop.on('step-start', stepStartHandler);

    const plan = makePlan([
      makeStep({ id: 'step-1', title: 'First Step' }),
      makeStep({ id: 'step-2', title: 'Second Step' })
    ]);

    loop.start(makeSession(), plan);

    await waitForAsync(200);

    expect(stepStartHandler).toHaveBeenCalled();
    expect(stepStartHandler.mock.calls[0][0].id).toBe('step-1');
  });

  it('emits plan-generated event on start', () => {
    const planHandler = vi.fn();

    const loop = createExecutionLoop({
      taskPlanner: makeTaskPlanner(),
      toolDispatcher: makeToolDispatcher(),
      contextManager: makeContextManager(),
      riskClassifier: makeRiskClassifier(),
      retryPolicy: makeRetryPolicy()
    });

    loop.on('plan-generated', planHandler);
    const plan = makePlan();
    loop.start(makeSession(), plan);

    expect(planHandler).toHaveBeenCalledTimes(1);
    expect(planHandler.mock.calls[0][0].plan).toBe(plan);
  });

  it('emits complete event with summary after all steps succeed', async () => {
    const completeHandler = vi.fn();

    const loop = createExecutionLoop({
      taskPlanner: makeTaskPlanner(),
      toolDispatcher: makeToolDispatcher(),
      contextManager: makeContextManager(),
      riskClassifier: makeRiskClassifier(),
      retryPolicy: makeRetryPolicy()
    });

    loop.on('complete', completeHandler);

    const plan = makePlan([makeStep({ id: 'step-1', title: 'Only Step' })]);
    loop.start(makeSession(), plan);

    await waitForAsync(200);

    expect(completeHandler).toHaveBeenCalledTimes(1);
    const summary = completeHandler.mock.calls[0][0];
    expect(summary.sessionId).toBe('session-123');
    expect(summary.status).toBe('completed');
    expect(summary.stepsCompleted).toBe(1);
    expect(summary.stepsTotal).toBe(1);
    expect(typeof summary.totalDuration).toBe('number');
    expect(loop.getState()).toBe(LOOP_STATES.COMPLETED);
  });

  it('adds step results to context manager after each step', async () => {
    const contextManager = makeContextManager();

    const loop = createExecutionLoop({
      taskPlanner: makeTaskPlanner(),
      toolDispatcher: makeToolDispatcher(),
      contextManager,
      riskClassifier: makeRiskClassifier(),
      retryPolicy: makeRetryPolicy()
    });

    const plan = makePlan([makeStep({ id: 'step-1' })]);
    loop.start(makeSession(), plan);

    await waitForAsync(200);

    expect(contextManager.addStepResult).toHaveBeenCalledTimes(1);
  });

  it('calls summarizeIfNeeded on context manager after each step', async () => {
    const contextManager = makeContextManager();

    const loop = createExecutionLoop({
      taskPlanner: makeTaskPlanner(),
      toolDispatcher: makeToolDispatcher(),
      contextManager,
      riskClassifier: makeRiskClassifier(),
      retryPolicy: makeRetryPolicy()
    });

    const plan = makePlan([makeStep({ id: 'step-1' }), makeStep({ id: 'step-2' })]);
    loop.start(makeSession(), plan);

    await waitForAsync(200);

    expect(contextManager.summarizeIfNeeded).toHaveBeenCalled();
  });

  it('accumulates step results accessible via getStepResults()', async () => {
    const loop = createExecutionLoop({
      taskPlanner: makeTaskPlanner(),
      toolDispatcher: makeToolDispatcher(),
      contextManager: makeContextManager(),
      riskClassifier: makeRiskClassifier(),
      retryPolicy: makeRetryPolicy()
    });

    const plan = makePlan([
      makeStep({ id: 'step-1' }),
      makeStep({ id: 'step-2' })
    ]);
    loop.start(makeSession(), plan);

    await waitForAsync(200);

    const results = loop.getStepResults();
    expect(results.length).toBe(2);
    expect(results[0].stepId).toBe('step-1');
    expect(results[1].stepId).toBe('step-2');
    expect(results[0].status).toBe('completed');
    expect(results[1].status).toBe('completed');
  });
});

// ─── Parallel Execution ──────────────────────────────────────────────────────

describe('executionLoop - parallel step execution', () => {
  it('executes parallel-safe steps concurrently', async () => {
    const toolDispatcher = makeToolDispatcher();

    const loop = createExecutionLoop({
      taskPlanner: makeTaskPlanner(),
      toolDispatcher,
      contextManager: makeContextManager(),
      riskClassifier: makeRiskClassifier(),
      retryPolicy: makeRetryPolicy()
    });

    const plan = makePlan([
      makeStep({ id: 'step-1', parallelSafe: true }),
      makeStep({ id: 'step-2', parallelSafe: true }),
      makeStep({ id: 'step-3', parallelSafe: false })
    ]);

    loop.start(makeSession(), plan);

    await waitForAsync(300);

    // All three steps should have been dispatched (2 parallel + 1 sequential)
    expect(toolDispatcher.dispatch).toHaveBeenCalledTimes(3);
  });

  it('handles mix of parallel and sequential steps', async () => {
    const stepStartHandler = vi.fn();

    const loop = createExecutionLoop({
      taskPlanner: makeTaskPlanner(),
      toolDispatcher: makeToolDispatcher(),
      contextManager: makeContextManager(),
      riskClassifier: makeRiskClassifier(),
      retryPolicy: makeRetryPolicy()
    });

    loop.on('step-start', stepStartHandler);

    const plan = makePlan([
      makeStep({ id: 'step-1', parallelSafe: true }),
      makeStep({ id: 'step-2', parallelSafe: true }),
      makeStep({ id: 'step-3', parallelSafe: false })
    ]);

    loop.start(makeSession(), plan);

    await waitForAsync(300);

    // All steps should have started
    expect(stepStartHandler.mock.calls.length).toBe(3);
    expect(loop.getState()).toBe(LOOP_STATES.COMPLETED);
  });
});

// ─── Pause/Resume/Cancel ─────────────────────────────────────────────────────

describe('executionLoop - pause/resume/cancel', () => {
  it('pauses execution and emits task-paused event', async () => {
    const pauseHandler = vi.fn();

    // Create a long-running dispatch to allow pause between steps
    let resolveDispatch: (() => void) | null = null;
    const toolDispatcher = {
      dispatch: vi.fn().mockImplementation(() => {
        return new Promise(resolve => {
          resolveDispatch = () => resolve({
            id: 'tc_001', tool: 'terminal', server: 'terminal-server', action: 'execute',
            params: {}, output: 'done', status: 'success', error: null, duration: 5000,
            startedAt: new Date().toISOString(), completedAt: new Date().toISOString()
          });
        });
      })
    };

    const loop = createExecutionLoop({
      taskPlanner: makeTaskPlanner(),
      toolDispatcher,
      contextManager: makeContextManager(),
      riskClassifier: makeRiskClassifier(),
      retryPolicy: makeRetryPolicy()
    });

    loop.on('task-paused', pauseHandler);

    const plan = makePlan([
      makeStep({ id: 'step-1' }),
      makeStep({ id: 'step-2' })
    ]);
    loop.start(makeSession(), plan);

    await waitForAsync(50);

    // Pause while first step is running
    await loop.pause();
    expect(loop.getState()).toBe(LOOP_STATES.PAUSED);
    expect(pauseHandler).toHaveBeenCalled();

    // Clean up: resolve the pending dispatch so the loop can settle
    if (resolveDispatch) resolveDispatch();
    await waitForAsync(50);
  });

  it('cancels execution and emits task-canceled event', async () => {
    const cancelHandler = vi.fn();

    let resolveDispatch: (() => void) | null = null;
    const toolDispatcher = {
      dispatch: vi.fn().mockImplementation(() => {
        return new Promise(resolve => {
          resolveDispatch = () => resolve({
            id: 'tc_001', tool: 'terminal', server: 'terminal-server', action: 'execute',
            params: {}, output: '', status: 'success', error: null, duration: 0,
            startedAt: new Date().toISOString(), completedAt: new Date().toISOString()
          });
        });
      })
    };

    const loop = createExecutionLoop({
      taskPlanner: makeTaskPlanner(),
      toolDispatcher,
      contextManager: makeContextManager(),
      riskClassifier: makeRiskClassifier(),
      retryPolicy: makeRetryPolicy()
    });

    loop.on('task-canceled', cancelHandler);

    loop.start(makeSession(), makePlan([makeStep({ id: 'step-1' })]));
    await waitForAsync(50);

    await loop.cancel();
    expect(loop.getState()).toBe(LOOP_STATES.CANCELED);
    expect(cancelHandler).toHaveBeenCalled();

    // Clean up
    if (resolveDispatch) resolveDispatch();
    await waitForAsync(50);
  });

  it('cancel from paused state works', async () => {
    let resolveDispatch: (() => void) | null = null;
    const toolDispatcher = {
      dispatch: vi.fn().mockImplementation(() => {
        return new Promise(resolve => {
          resolveDispatch = () => resolve({
            id: 'tc_001', tool: 'terminal', server: 'terminal-server', action: 'execute',
            params: {}, output: '', status: 'success', error: null, duration: 0,
            startedAt: new Date().toISOString(), completedAt: new Date().toISOString()
          });
        });
      })
    };

    const loop = createExecutionLoop({
      taskPlanner: makeTaskPlanner(),
      toolDispatcher,
      contextManager: makeContextManager(),
      riskClassifier: makeRiskClassifier(),
      retryPolicy: makeRetryPolicy()
    });

    loop.start(makeSession(), makePlan([makeStep({ id: 'step-1' }), makeStep({ id: 'step-2' })]));
    await waitForAsync(50);

    await loop.pause();
    expect(loop.getState()).toBe(LOOP_STATES.PAUSED);

    await loop.cancel();
    expect(loop.getState()).toBe(LOOP_STATES.CANCELED);

    // Clean up
    if (resolveDispatch) resolveDispatch();
    await waitForAsync(50);
  });
});

// ─── Replan Handling ─────────────────────────────────────────────────────────

describe('executionLoop - replan handling', () => {
  it('triggers replan when step fails', async () => {
    const replanPlan = makePlan([makeStep({ id: 'replan-1', title: 'Recovery Step' })]);
    const taskPlanner = makeTaskPlanner(replanPlan);

    // First call fails, second succeeds
    let callCount = 0;
    const toolDispatcher = {
      dispatch: vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            id: 'tc_001', tool: 'terminal', server: 'terminal-server', action: 'execute',
            params: {}, output: '', status: 'error', error: 'Command failed', duration: 50,
            startedAt: new Date().toISOString(), completedAt: new Date().toISOString()
          };
        }
        return {
          id: 'tc_002', tool: 'terminal', server: 'terminal-server', action: 'execute',
          params: {}, output: 'success', status: 'success', error: null, duration: 50,
          startedAt: new Date().toISOString(), completedAt: new Date().toISOString()
        };
      })
    };

    const loop = createExecutionLoop({
      taskPlanner,
      toolDispatcher,
      contextManager: makeContextManager(),
      riskClassifier: makeRiskClassifier(),
      retryPolicy: makeRetryPolicy()
    });

    const plan = makePlan([makeStep({ id: 'step-1', title: 'Failing Step' })]);
    loop.start(makeSession(), plan);

    await waitForAsync(300);

    expect(taskPlanner.replan).toHaveBeenCalled();
    expect(loop.getReplanCount()).toBe(1);
    expect(loop.getState()).toBe(LOOP_STATES.COMPLETED);
  });

  it('halts execution after max replans exceeded', async () => {
    const errorHandler = vi.fn();

    // Always fails
    const toolDispatcher = {
      dispatch: vi.fn().mockResolvedValue({
        id: 'tc_001', tool: 'terminal', server: 'terminal-server', action: 'execute',
        params: {}, output: '', status: 'error', error: 'Always fails', duration: 50,
        startedAt: new Date().toISOString(), completedAt: new Date().toISOString()
      })
    };

    // Always returns a new plan with a failing step
    const taskPlanner = {
      replan: vi.fn().mockResolvedValue(makePlan([makeStep({ id: 'fail-step' })]))
    };

    const loop = createExecutionLoop({
      taskPlanner,
      toolDispatcher,
      contextManager: makeContextManager(),
      riskClassifier: makeRiskClassifier(),
      retryPolicy: makeRetryPolicy(),
      config: { maxReplans: 3 }
    });

    loop.on('error', errorHandler);

    loop.start(makeSession(), makePlan([makeStep({ id: 'step-1' })]));

    await waitForAsync(500);

    expect(loop.getState()).toBe(LOOP_STATES.FAILED);
    expect(errorHandler).toHaveBeenCalled();
    const lastError = errorHandler.mock.calls[errorHandler.mock.calls.length - 1][0];
    expect(lastError.type).toBe('replan_limit_exceeded');
  });

  it('emits replan event with old and new step information', async () => {
    const replanHandler = vi.fn();
    const replanPlan = makePlan([makeStep({ id: 'new-step-1', title: 'New approach' })]);
    const taskPlanner = makeTaskPlanner(replanPlan);

    let callCount = 0;
    const toolDispatcher = {
      dispatch: vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            id: 'tc_001', tool: 'terminal', server: 'terminal-server', action: 'execute',
            params: {}, output: '', status: 'error', error: 'Failed', duration: 50,
            startedAt: new Date().toISOString(), completedAt: new Date().toISOString()
          };
        }
        return {
          id: 'tc_002', tool: 'terminal', server: 'terminal-server', action: 'execute',
          params: {}, output: 'ok', status: 'success', error: null, duration: 50,
          startedAt: new Date().toISOString(), completedAt: new Date().toISOString()
        };
      })
    };

    const loop = createExecutionLoop({
      taskPlanner,
      toolDispatcher,
      contextManager: makeContextManager(),
      riskClassifier: makeRiskClassifier(),
      retryPolicy: makeRetryPolicy()
    });

    loop.on('replan', replanHandler);

    loop.start(makeSession(), makePlan([makeStep({ id: 'old-step-1' })]));

    await waitForAsync(300);

    expect(replanHandler).toHaveBeenCalled();
    const replanEvent = replanHandler.mock.calls[0][0];
    expect(replanEvent.oldSteps).toContain('old-step-1');
    expect(replanEvent.newSteps).toEqual(replanPlan.steps);
  });
});

// ─── Progress Events ─────────────────────────────────────────────────────────

describe('executionLoop - progress events', () => {
  it('emits progress events during execution', async () => {
    const progressHandler = vi.fn();

    // Create a dispatch that takes some time
    const toolDispatcher = {
      dispatch: vi.fn().mockImplementation(async () => {
        await new Promise(r => setTimeout(r, 1500)); // Takes 1.5s
        return {
          id: 'tc_001', tool: 'terminal', server: 'terminal-server', action: 'execute',
          params: {}, output: 'done', status: 'success', error: null, duration: 1500,
          startedAt: new Date().toISOString(), completedAt: new Date().toISOString()
        };
      })
    };

    const loop = createExecutionLoop({
      taskPlanner: makeTaskPlanner(),
      toolDispatcher,
      contextManager: makeContextManager(),
      riskClassifier: makeRiskClassifier(),
      retryPolicy: makeRetryPolicy()
    });

    loop.on('progress', progressHandler);

    loop.start(makeSession(), makePlan([makeStep({ id: 'step-1' })]));

    // Wait for more than 1 progress interval
    await waitForAsync(2500);

    // Should have at least 1 progress event (emitted at 1s interval)
    expect(progressHandler.mock.calls.length).toBeGreaterThanOrEqual(1);

    // Verify progress event shape
    const firstProgress = progressHandler.mock.calls[0][0];
    expect(firstProgress.sessionId).toBe('session-123');
    expect(typeof firstProgress.percentage).toBe('number');
    expect(typeof firstProgress.elapsedTime).toBe('number');
    expect(typeof firstProgress.stepsCompleted).toBe('number');
    expect(typeof firstProgress.stepsTotal).toBe('number');
  });
});

// ─── Outcome Classification ──────────────────────────────────────────────────

describe('executionLoop - outcome classification', () => {
  it('uses custom outcome classifier when provided', async () => {
    const completeHandler = vi.fn();
    const customClassifier = vi.fn().mockResolvedValue({ type: 'complete', output: 'Task done!' });

    const loop = createExecutionLoop({
      taskPlanner: makeTaskPlanner(),
      toolDispatcher: makeToolDispatcher(),
      contextManager: makeContextManager(),
      riskClassifier: makeRiskClassifier(),
      retryPolicy: makeRetryPolicy(),
      outcomeClassifier: customClassifier
    });

    loop.on('complete', completeHandler);

    const plan = makePlan([makeStep({ id: 'step-1' }), makeStep({ id: 'step-2' })]);
    loop.start(makeSession(), plan);

    await waitForAsync(200);

    expect(customClassifier).toHaveBeenCalled();
    expect(completeHandler).toHaveBeenCalled();
    expect(loop.getState()).toBe(LOOP_STATES.COMPLETED);
  });

  it('defaults to proceed for non-last steps', async () => {
    const stepCompleteHandler = vi.fn();

    const loop = createExecutionLoop({
      taskPlanner: makeTaskPlanner(),
      toolDispatcher: makeToolDispatcher(),
      contextManager: makeContextManager(),
      riskClassifier: makeRiskClassifier(),
      retryPolicy: makeRetryPolicy()
    });

    loop.on('step-complete', stepCompleteHandler);

    const plan = makePlan([
      makeStep({ id: 'step-1', title: 'First' }),
      makeStep({ id: 'step-2', title: 'Second' })
    ]);
    loop.start(makeSession(), plan);

    await waitForAsync(200);

    expect(stepCompleteHandler).toHaveBeenCalled();
    const firstOutcome = stepCompleteHandler.mock.calls[0][1];
    expect(firstOutcome.type).toBe('proceed');
  });

  it('defaults to complete for the last step', async () => {
    const stepCompleteHandler = vi.fn();
    const completeHandler = vi.fn();

    const loop = createExecutionLoop({
      taskPlanner: makeTaskPlanner(),
      toolDispatcher: makeToolDispatcher(),
      contextManager: makeContextManager(),
      riskClassifier: makeRiskClassifier(),
      retryPolicy: makeRetryPolicy()
    });

    loop.on('step-complete', stepCompleteHandler);
    loop.on('complete', completeHandler);

    const plan = makePlan([makeStep({ id: 'step-1', title: 'Only Step' })]);
    loop.start(makeSession(), plan);

    await waitForAsync(200);

    expect(stepCompleteHandler).toHaveBeenCalled();
    const outcome = stepCompleteHandler.mock.calls[0][1];
    expect(outcome.type).toBe('complete');
    expect(completeHandler).toHaveBeenCalled();
  });

  it('classifies failed steps as replan outcome', async () => {
    const stepCompleteHandler = vi.fn();

    const toolDispatcher = {
      dispatch: vi.fn().mockResolvedValue({
        id: 'tc_001', tool: 'terminal', server: 'terminal-server', action: 'execute',
        params: {}, output: '', status: 'error', error: 'Something failed', duration: 50,
        startedAt: new Date().toISOString(), completedAt: new Date().toISOString()
      })
    };

    const replanPlan = makePlan([makeStep({ id: 'recovery-1' })]);
    const taskPlanner = makeTaskPlanner(replanPlan);

    // On the replan step, succeed
    let calls = 0;
    toolDispatcher.dispatch = vi.fn().mockImplementation(async () => {
      calls++;
      if (calls === 1) {
        return {
          id: 'tc_001', tool: 'terminal', server: 'terminal-server', action: 'execute',
          params: {}, output: '', status: 'error', error: 'fail', duration: 50,
          startedAt: new Date().toISOString(), completedAt: new Date().toISOString()
        };
      }
      return {
        id: 'tc_002', tool: 'terminal', server: 'terminal-server', action: 'execute',
        params: {}, output: 'ok', status: 'success', error: null, duration: 50,
        startedAt: new Date().toISOString(), completedAt: new Date().toISOString()
      };
    });

    const loop = createExecutionLoop({
      taskPlanner,
      toolDispatcher,
      contextManager: makeContextManager(),
      riskClassifier: makeRiskClassifier(),
      retryPolicy: makeRetryPolicy()
    });

    loop.on('step-complete', stepCompleteHandler);

    loop.start(makeSession(), makePlan([makeStep({ id: 'step-1' })]));

    await waitForAsync(300);

    // First step-complete should have replan outcome
    const firstOutcome = stepCompleteHandler.mock.calls[0][1];
    expect(firstOutcome.type).toBe('replan');
  });
});

// ─── Dependency Handling ─────────────────────────────────────────────────────

describe('executionLoop - dependency handling', () => {
  it('respects step dependencies and executes in correct order', async () => {
    const executionOrder: string[] = [];
    const toolDispatcher = {
      dispatch: vi.fn().mockImplementation(async (_call: any, opts: any) => {
        executionOrder.push(opts.stepId);
        return {
          id: 'tc_001', tool: 'terminal', server: 'terminal-server', action: 'execute',
          params: {}, output: 'done', status: 'success', error: null, duration: 50,
          startedAt: new Date().toISOString(), completedAt: new Date().toISOString()
        };
      })
    };

    const loop = createExecutionLoop({
      taskPlanner: makeTaskPlanner(),
      toolDispatcher,
      contextManager: makeContextManager(),
      riskClassifier: makeRiskClassifier(),
      retryPolicy: makeRetryPolicy()
    });

    const plan = makePlan([
      makeStep({ id: 'step-1', title: 'First', dependsOn: [] }),
      makeStep({ id: 'step-2', title: 'Second', dependsOn: ['step-1'] }),
      makeStep({ id: 'step-3', title: 'Third', dependsOn: ['step-2'] })
    ]);

    loop.start(makeSession(), plan);

    await waitForAsync(300);

    expect(executionOrder.length).toBe(3);
    expect(executionOrder[0]).toBe('step-1');
    expect(executionOrder[1]).toBe('step-2');
    expect(executionOrder[2]).toBe('step-3');
  });
});

// ─── Risk Classifier Integration ─────────────────────────────────────────────

describe('executionLoop - risk classification', () => {
  it('emits approval-required event for high-risk steps', async () => {
    const approvalHandler = vi.fn();

    const riskClassifier = {
      classify: vi.fn().mockReturnValue({
        level: 'high',
        requiresApproval: true,
        reason: 'File deletion detected'
      })
    };

    const loop = createExecutionLoop({
      taskPlanner: makeTaskPlanner(),
      toolDispatcher: makeToolDispatcher(),
      contextManager: makeContextManager(),
      riskClassifier,
      retryPolicy: makeRetryPolicy()
    });

    loop.on('approval-required', approvalHandler);

    const plan = makePlan([makeStep({ id: 'step-1', riskLevel: 'high' })]);
    loop.start(makeSession(), plan);

    await waitForAsync(200);

    expect(approvalHandler).toHaveBeenCalled();
    const gate = approvalHandler.mock.calls[0][0];
    expect(gate.riskLevel).toBe('high');
    expect(gate.riskExplanation).toBe('File deletion detected');
  });
});
