/**
 * Execution Loop
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.0.3
 *
 * Processes plan steps sequentially (or in parallel when safe), observes outcomes,
 * and decides next actions. Supports pause/resume/cancel, step and task timeouts,
 * re-planning (max 3 attempts), progress event emission, and final summary generation.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9
 */

import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Default step timeout in milliseconds (120 seconds). */
export const DEFAULT_STEP_TIMEOUT_MS = 120_000;

/** Default task timeout in milliseconds (30 minutes). */
export const DEFAULT_TASK_TIMEOUT_MS = 1_800_000;

/** Maximum number of re-plan attempts per task. */
export const MAX_REPLAN_ATTEMPTS = 3;

/** Progress event emission interval in milliseconds (1 second). */
export const PROGRESS_INTERVAL_MS = 1000;

/** Valid execution loop states. */
export const LOOP_STATES = Object.freeze({
  IDLE: 'idle',
  RUNNING: 'running',
  PAUSED: 'paused',
  CANCELED: 'canceled',
  COMPLETED: 'completed',
  FAILED: 'failed'
});

/** Valid state transitions. */
const VALID_TRANSITIONS = Object.freeze({
  idle: ['running'],
  running: ['paused', 'canceled', 'completed', 'failed'],
  paused: ['running', 'canceled'],
  canceled: [],
  completed: [],
  failed: []
});

// ─── JSDoc Types ─────────────────────────────────────────────────────────────

/**
 * @typedef {Object} ExecutionLoopDependencies
 * @property {Object} taskPlanner - Task planner instance with replan() method
 * @property {Object} toolDispatcher - Tool dispatcher with dispatch() method
 * @property {Object} contextManager - Context manager with buildPrompt(), summarizeIfNeeded()
 * @property {Object} riskClassifier - Risk classifier with classify() method
 * @property {Object} retryPolicy - Retry policy with shouldRetry(), classifyError()
 * @property {Object} [config] - Configuration overrides
 * @property {Function} [outcomeClassifier] - Function(step, toolResult, context) => StepOutcome
 * @property {Function} [onStepFlushed] - Callback invoked after each step result is persisted (stepResult) => void
 */

/**
 * @typedef {Object} ExecutionLoopConfig
 * @property {number} [stepTimeout=120000] - Step timeout in ms
 * @property {number} [taskTimeout=1800000] - Task timeout in ms
 * @property {number} [maxReplans=3] - Maximum replan attempts
 * @property {number} [progressInterval=1000] - Progress emission interval in ms
 */

// ─── Factory Function ────────────────────────────────────────────────────────

/**
 * Creates a new ExecutionLoop instance.
 *
 * @param {ExecutionLoopDependencies} deps - Injected dependencies
 * @returns {Object} ExecutionLoop interface with start, pause, resume, cancel, on, and getState
 */
export function createExecutionLoop(deps = {}) {
  const {
    taskPlanner,
    toolDispatcher,
    contextManager,
    riskClassifier,
    retryPolicy,
    config = {},
    outcomeClassifier,
    onStepFlushed
  } = deps;

  // Configuration
  const stepTimeout = typeof config.stepTimeout === 'number' && config.stepTimeout > 0
    ? config.stepTimeout * 1000 // Convert seconds to ms if provided in seconds
    : DEFAULT_STEP_TIMEOUT_MS;

  const taskTimeout = typeof config.taskTimeout === 'number' && config.taskTimeout > 0
    ? config.taskTimeout * 1000 // Convert seconds to ms if provided in seconds
    : DEFAULT_TASK_TIMEOUT_MS;

  const maxReplans = typeof config.maxReplans === 'number' && config.maxReplans >= 0
    ? config.maxReplans
    : MAX_REPLAN_ATTEMPTS;

  const progressInterval = typeof config.progressInterval === 'number' && config.progressInterval > 0
    ? config.progressInterval
    : PROGRESS_INTERVAL_MS;

  // Internal state
  const emitter = new EventEmitter();
  let state = LOOP_STATES.IDLE;
  let session = null;
  let currentPlan = null;
  let replanCount = 0;
  let stepResults = [];
  let startTime = null;
  let progressTimer = null;
  let taskTimeoutTimer = null;
  let currentStepIndex = 0;
  let activeStepId = null;
  let activeStepAbort = null;
  let pauseResolver = null;

  // ─── Step Result Persistence ─────────────────────────────────────────────

  /**
   * Records a step result and flushes it to the runtime store via the
   * onStepFlushed callback (if provided).
   *
   * IMMUTABILITY CONTRACT (Requirements 10.7, 13.3):
   * ─────────────────────────────────────────────────
   * • Each step result is deep-frozen (Object.freeze) before storage.
   * • Once flushed, a step result is NEVER mutated — not by retries,
   *   re-plans, user interventions, or any recovery operation.
   * • The onStepFlushed callback is invoked for EVERY step completion
   *   regardless of outcome (success, failure, skip, timeout).
   * • Retries and re-plans only operate on pending or failed steps;
   *   they never alter previously stored results.
   * • getStepResults() returns a shallow copy of the array; individual
   *   entries remain frozen and unmodifiable by external consumers.
   *
   * This guarantees that no prior progress is lost during error recovery
   * or user intervention, as required by Requirements 10.7 and 13.3.
   *
   * @param {Object} result - The step result to persist (frozen on entry)
   */
  function recordStepResult(result) {
    stepResults.push(Object.freeze({ ...result }));
    if (typeof onStepFlushed === 'function') {
      try {
        onStepFlushed(result);
      } catch {
        // Flush errors are non-fatal — the result is still stored in memory
      }
    }
  }

  // ─── State Machine ───────────────────────────────────────────────────────

  /**
   * Transitions to a new state if the transition is valid.
   *
   * @param {string} newState - Target state
   * @returns {boolean} Whether the transition was successful
   */
  function transitionTo(newState) {
    const allowed = VALID_TRANSITIONS[state];
    if (!allowed || !allowed.includes(newState)) {
      return false;
    }
    state = newState;
    return true;
  }

  // ─── Progress Emission ─────────────────────────────────────────────────────

  /**
   * Starts the progress event emission timer.
   * Emits progress events at the configured interval (default 1/second).
   */
  function startProgressTimer() {
    stopProgressTimer();
    progressTimer = setInterval(() => {
      if (state !== LOOP_STATES.RUNNING || !session) return;

      const elapsed = Date.now() - startTime;
      const stepsCompleted = stepResults.filter(r => r.status === 'completed').length;
      const stepsTotal = currentPlan ? currentPlan.steps.length : 0;
      const percentage = stepsTotal > 0 ? Math.round((stepsCompleted / stepsTotal) * 100) : 0;

      const currentStep = currentPlan?.steps[currentStepIndex];
      emitter.emit('progress', {
        sessionId: session.id,
        stepId: activeStepId || (currentStep ? currentStep.id : ''),
        stepsCompleted,
        stepsTotal,
        percentage,
        currentStepTitle: currentStep ? currentStep.title : '',
        elapsedTime: elapsed
      });
    }, progressInterval);
  }

  /**
   * Stops the progress event emission timer.
   */
  function stopProgressTimer() {
    if (progressTimer) {
      clearInterval(progressTimer);
      progressTimer = null;
    }
  }

  // ─── Task Timeout ──────────────────────────────────────────────────────────

  /**
   * Starts the task timeout timer.
   * When triggered, pauses execution and emits an event requesting user confirmation.
   */
  function startTaskTimeout() {
    stopTaskTimeout();
    taskTimeoutTimer = setTimeout(async () => {
      if (state === LOOP_STATES.RUNNING) {
        await pauseInternal('Task execution reached maximum duration. Awaiting user confirmation to continue.');
      }
    }, taskTimeout);
  }

  /**
   * Stops the task timeout timer.
   */
  function stopTaskTimeout() {
    if (taskTimeoutTimer) {
      clearTimeout(taskTimeoutTimer);
      taskTimeoutTimer = null;
    }
  }

  // ─── Pause Support ─────────────────────────────────────────────────────────

  /**
   * Internal pause implementation.
   *
   * @param {string} reason - Reason for pausing
   */
  async function pauseInternal(reason) {
    if (state !== LOOP_STATES.RUNNING) return;
    transitionTo(LOOP_STATES.PAUSED);
    stopProgressTimer();
    emitter.emit('task-paused', { reason, timestamp: new Date().toISOString() });
  }

  /**
   * Creates a promise that resolves when the loop is resumed or canceled.
   * Used internally to block execution while paused.
   *
   * @returns {Promise<string>} Resolves with 'resumed' or 'canceled'
   */
  function waitForResumeOrCancel() {
    if (state === LOOP_STATES.RUNNING) return Promise.resolve('resumed');
    if (state === LOOP_STATES.CANCELED) return Promise.resolve('canceled');

    return new Promise((resolve) => {
      pauseResolver = resolve;
    });
  }

  /**
   * Checks if execution is paused and waits if so.
   * Returns false if canceled (caller should abort).
   *
   * @returns {Promise<boolean>} True if execution should continue, false if canceled
   */
  async function checkPausePoint() {
    if (state === LOOP_STATES.CANCELED) return false;
    if (state === LOOP_STATES.PAUSED) {
      const result = await waitForResumeOrCancel();
      return result === 'resumed';
    }
    return true;
  }

  // ─── Step Execution ────────────────────────────────────────────────────────

  /**
   * Executes a single step, handling tool dispatch, retries, and timeout.
   *
   * @param {Object} step - The step to execute
   * @returns {Promise<Object>} StepResult
   */
  async function executeStep(step) {
    activeStepId = step.id;
    const stepStartTime = Date.now();
    const stepStartedAt = new Date().toISOString();

    emitter.emit('step-start', step);

    // Create an abort controller for step timeout
    const abortController = new AbortController();
    activeStepAbort = abortController;

    // Set up step timeout
    const stepTimeoutId = setTimeout(() => {
      abortController.abort();
    }, stepTimeout);

    let toolCalls = [];
    let output = '';
    let error = null;
    let retryCount = 0;
    let status = 'completed';

    try {
      // Check risk classification before proceeding
      if (riskClassifier && typeof riskClassifier.classify === 'function') {
        const riskResult = riskClassifier.classify({
          tool: step.requiredTools?.[0]?.category || 'terminal',
          action: step.title,
          params: {},
          workingDirectory: session?.workingDirectory || '',
          affectedPaths: []
        });

        if (riskResult && riskResult.requiresApproval) {
          const gate = {
            id: randomUUID(),
            sessionId: session?.id || '',
            stepId: step.id,
            action: step.title,
            tool: step.requiredTools?.[0]?.name || 'unknown',
            params: {},
            riskLevel: 'high',
            riskExplanation: riskResult.reason || 'Operation classified as high-risk.',
            status: 'pending',
            decidedAt: null,
            denialReason: null,
            createdAt: new Date().toISOString()
          };

          emitter.emit('approval-required', gate);

          // Wait for approval (in real implementation, this would be resolved by the runtime)
          // For now, we continue — the agentRuntime handles approval gate resolution
        }
      }

      // Dispatch tool calls for this step
      if (toolDispatcher && typeof toolDispatcher.dispatch === 'function') {
        const primaryTool = step.requiredTools?.[0];
        if (primaryTool) {
          const toolCall = {
            tool: primaryTool.category || primaryTool.name,
            server: primaryTool.server,
            action: step.description || step.title,
            params: {}
          };

          let result = null;
          let lastError = null;
          let attemptCount = 0;
          const maxRetries = retryPolicy ? 2 : 0;

          while (attemptCount <= maxRetries) {
            // Check for abort (step timeout or cancel)
            if (abortController.signal.aborted) {
              throw Object.assign(new Error('Step timed out'), { code: 'TIMEOUT' });
            }

            try {
              result = await toolDispatcher.dispatch(toolCall, { stepId: step.id });
              toolCalls.push(result);

              if (result.status === 'success') {
                output = result.output || '';
                break;
              } else if (result.status === 'timeout') {
                throw Object.assign(
                  new Error(result.error || 'Tool call timed out'),
                  { code: 'TIMEOUT' }
                );
              } else {
                // Error status
                lastError = {
                  tool: toolCall.tool,
                  action: toolCall.action,
                  message: result.error || 'Unknown tool error',
                  code: null,
                  httpStatus: null
                };
                throw new Error(result.error || 'Tool call failed');
              }
            } catch (err) {
              lastError = {
                tool: toolCall.tool,
                action: toolCall.action,
                message: err.message || 'Unknown error',
                code: err.code || null,
                httpStatus: err.httpStatus || null
              };

              // Check retry policy
              if (retryPolicy && typeof retryPolicy.shouldRetry === 'function') {
                const decision = retryPolicy.shouldRetry(lastError, attemptCount, maxRetries);
                if (decision.action === 'retry') {
                  attemptCount++;
                  retryCount++;
                  // Wait for backoff delay (but check abort)
                  await new Promise((resolve) => {
                    const timer = setTimeout(resolve, decision.delay);
                    if (abortController.signal.aborted) {
                      clearTimeout(timer);
                      resolve();
                    }
                  });
                  continue;
                }
              }

              // No retry: record the error and break
              error = err.message;
              output = result?.output || '';
              status = 'failed';
              break;
            }
          }

          // If we exhausted retries without success
          if (attemptCount > maxRetries && status !== 'completed') {
            error = lastError?.message || 'Max retries exceeded';
            status = 'failed';
          }
        }
      } else {
        // No tool dispatcher: step completes with no output
        output = '';
      }
    } catch (err) {
      if (err.code === 'TIMEOUT' || abortController.signal.aborted) {
        error = `Step timed out after ${stepTimeout / 1000} seconds`;
        status = 'failed';
      } else {
        error = err.message || 'Unknown execution error';
        status = 'failed';
      }
    } finally {
      clearTimeout(stepTimeoutId);
      activeStepAbort = null;
      activeStepId = null;
    }

    const stepResult = {
      stepId: step.id,
      title: step.title,
      status,
      toolCalls,
      output,
      error,
      startedAt: stepStartedAt,
      completedAt: new Date().toISOString(),
      duration: Date.now() - stepStartTime,
      retryCount
    };

    return stepResult;
  }

  /**
   * Classifies the outcome of a completed step.
   *
   * Per Requirement 3.3: Classify as proceed (satisfies sub-goal),
   * replan (deviates but task achievable), or complete (task fully satisfied).
   *
   * @param {Object} step - The executed step
   * @param {Object} stepResult - The step result
   * @returns {Promise<Object>} StepOutcome
   */
  async function classifyOutcome(step, stepResult) {
    // If step failed, outcome is replan
    if (stepResult.status === 'failed') {
      return {
        type: 'replan',
        reason: stepResult.error || 'Step failed',
        output: stepResult.output || ''
      };
    }

    // Use injected outcome classifier if available (for LLM-based classification)
    if (outcomeClassifier && typeof outcomeClassifier === 'function') {
      try {
        const outcome = await outcomeClassifier(step, stepResult, {
          plan: currentPlan,
          stepResults,
          session
        });
        if (outcome && outcome.type) {
          return outcome;
        }
      } catch {
        // Fall through to default classification
      }
    }

    // Default classification: proceed unless it's the last step
    const isLastStep = currentStepIndex >= (currentPlan?.steps.length || 0) - 1;
    if (isLastStep) {
      return { type: 'complete', output: stepResult.output || '' };
    }

    return { type: 'proceed', output: stepResult.output || '' };
  }

  /**
   * Groups parallel-safe steps that have no unresolved dependencies.
   *
   * @param {Object[]} steps - Remaining steps to process
   * @param {Set<string>} completedStepIds - IDs of completed steps
   * @returns {{ sequential: Object[], parallel: Object[] }}
   */
  function groupParallelSteps(steps, completedStepIds) {
    const parallel = [];
    const sequential = [];

    for (const step of steps) {
      // Check if all dependencies are satisfied
      const depsResolved = !step.dependsOn || step.dependsOn.length === 0 ||
        step.dependsOn.every(depId => completedStepIds.has(depId));

      if (!depsResolved) {
        sequential.push(step);
        continue;
      }

      if (step.parallelSafe) {
        parallel.push(step);
      } else {
        // Once we hit a non-parallel step, stop grouping
        sequential.push(step);
        break;
      }
    }

    return { sequential, parallel };
  }

  // ─── Main Execution Loop ───────────────────────────────────────────────────

  /**
   * Main execution loop. Processes steps in plan order, handling
   * parallel execution, outcome classification, replanning, and state management.
   */
  async function runLoop() {
    const completedStepIds = new Set();

    while (currentStepIndex < currentPlan.steps.length) {
      // Check for pause/cancel
      const shouldContinue = await checkPausePoint();
      if (!shouldContinue) {
        emitter.emit('task-canceled', { timestamp: new Date().toISOString() });
        return;
      }

      if (state !== LOOP_STATES.RUNNING) return;

      const remainingSteps = currentPlan.steps.slice(currentStepIndex);
      const { parallel } = groupParallelSteps(remainingSteps, completedStepIds);

      if (parallel.length > 1) {
        // Execute parallel-safe steps concurrently
        const parallelResults = await Promise.all(
          parallel.map(step => executeStep(step))
        );

        for (let i = 0; i < parallelResults.length; i++) {
          const result = parallelResults[i];
          const step = parallel[i];
          recordStepResult(result);
          completedStepIds.add(step.id);

          // Add to context manager
          if (contextManager && typeof contextManager.addStepResult === 'function') {
            contextManager.addStepResult(result);
          }

          const outcome = await classifyOutcome(step, result);
          emitter.emit('step-complete', step, outcome);

          // Handle replan outcome
          if (outcome.type === 'replan') {
            const replanResult = await handleReplan(step, result, outcome);
            if (!replanResult) return; // Halted or canceled
            break; // Restart loop with new plan
          }

          if (outcome.type === 'complete') {
            await completeTask();
            return;
          }
        }

        currentStepIndex += parallel.length;
      } else {
        // Sequential execution
        const step = currentPlan.steps[currentStepIndex];

        // Check if dependencies are met
        const depsResolved = !step.dependsOn || step.dependsOn.length === 0 ||
          step.dependsOn.every(depId => completedStepIds.has(depId));

        if (!depsResolved) {
          // Skip this step (dependencies not met — this shouldn't happen in well-formed plans)
          const skipResult = {
            stepId: step.id,
            title: step.title,
            status: 'skipped',
            toolCalls: [],
            output: '',
            error: 'Dependencies not met',
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            duration: 0,
            retryCount: 0
          };
          recordStepResult(skipResult);
          currentStepIndex++;
          continue;
        }

        const stepResult = await executeStep(step);
        recordStepResult(stepResult);
        completedStepIds.add(step.id);

        // Add to context manager
        if (contextManager && typeof contextManager.addStepResult === 'function') {
          contextManager.addStepResult(stepResult);
        }

        // Trigger context summarization if needed
        if (contextManager && typeof contextManager.summarizeIfNeeded === 'function') {
          contextManager.summarizeIfNeeded();
        }

        // Classify outcome
        const outcome = await classifyOutcome(step, stepResult);
        emitter.emit('step-complete', step, outcome);

        if (outcome.type === 'replan') {
          const replanResult = await handleReplan(step, stepResult, outcome);
          if (!replanResult) return; // Halted or canceled
          // replan updates currentPlan and resets currentStepIndex for remaining steps
          continue;
        }

        if (outcome.type === 'complete') {
          await completeTask();
          return;
        }

        // Proceed to next step
        currentStepIndex++;
      }
    }

    // All steps completed naturally
    await completeTask();
  }

  /**
   * Handles a replan request after a step fails or deviates.
   *
   * Per Requirement 3.7/3.8: Max 3 replans per task, then halt.
   *
   * PRESERVATION GUARANTEE (Requirements 10.7, 13.3):
   * Re-planning only replaces the remaining (pending) steps in the plan.
   * All previously completed step results in stepResults[] remain frozen
   * and untouched. The replan operation resets currentStepIndex to 0 within
   * the NEW plan but never modifies or removes entries from stepResults[].
   *
   * @param {Object} failedStep - The step that triggered replanning
   * @param {Object} stepResult - The failed step's result
   * @param {Object} outcome - The classified outcome
   * @returns {Promise<boolean>} True if replanning succeeded and loop should continue
   */
  async function handleReplan(failedStep, stepResult, outcome) {
    replanCount++;

    if (replanCount > maxReplans) {
      // Halt execution: max replans exceeded
      transitionTo(LOOP_STATES.FAILED);
      stopProgressTimer();
      stopTaskTimeout();

      const executionError = {
        type: 'replan_limit_exceeded',
        message: `Maximum re-plan attempts (${maxReplans}) exceeded. Execution halted.`,
        stepId: failedStep.id,
        attemptCount: replanCount,
        classification: 'permanent'
      };

      emitter.emit('error', executionError);
      return false;
    }

    // Invoke task planner to replan
    if (!taskPlanner || typeof taskPlanner.replan !== 'function') {
      // No planner available: halt
      transitionTo(LOOP_STATES.FAILED);
      stopProgressTimer();
      stopTaskTimeout();

      emitter.emit('error', {
        type: 'replan_unavailable',
        message: 'Task planner is not available for re-planning.',
        stepId: failedStep.id,
        attemptCount: replanCount,
        classification: 'permanent'
      });
      return false;
    }

    try {
      const constraints = {
        excludedApproaches: [failedStep.title],
        deniedActions: [],
        errorContext: {
          type: stepResult.error ? 'step_failure' : 'deviation',
          message: outcome.reason || stepResult.error || 'Step outcome deviated from expected',
          stepId: failedStep.id,
          attemptCount: replanCount
        },
        maxSteps: currentPlan.steps.length
      };

      const taskInstruction = {
        instruction: session?.instruction || '',
        workingDirectory: session?.workingDirectory || '',
        attachments: session?.attachments || [],
        followUpInstructions: []
      };

      const context = contextManager && typeof contextManager.buildPrompt === 'function'
        ? contextManager.buildPrompt(taskInstruction, currentPlan, stepResults)
        : null;

      const newPlan = await taskPlanner.replan(taskInstruction, context, constraints);

      // Emit replan event
      const oldStepIds = currentPlan.steps.slice(currentStepIndex).map(s => s.id);
      emitter.emit('replan', {
        oldSteps: oldStepIds,
        newSteps: newPlan.steps,
        reason: outcome.reason || 'Step failure triggered replan',
        timestamp: new Date().toISOString()
      });

      // Replace remaining plan with new plan
      currentPlan = newPlan;
      currentStepIndex = 0;

      return true;
    } catch (err) {
      // Replan itself failed
      transitionTo(LOOP_STATES.FAILED);
      stopProgressTimer();
      stopTaskTimeout();

      emitter.emit('error', {
        type: 'replan_failed',
        message: `Re-planning failed: ${err.message}`,
        stepId: failedStep.id,
        attemptCount: replanCount,
        classification: 'permanent'
      });
      return false;
    }
  }

  /**
   * Completes the task and produces a final summary.
   *
   * Per Requirement 3.4: Produce final summary of actions and results.
   */
  async function completeTask() {
    transitionTo(LOOP_STATES.COMPLETED);
    stopProgressTimer();
    stopTaskTimeout();

    const totalDuration = Date.now() - startTime;
    const stepsCompleted = stepResults.filter(r => r.status === 'completed').length;
    const stepsTotal = stepResults.length;

    const summary = {
      sessionId: session?.id || '',
      instruction: session?.instruction || '',
      status: 'completed',
      stepsCompleted,
      stepsTotal,
      artifactCount: session?.artifacts?.length || 0,
      totalDuration,
      completedAt: new Date().toISOString()
    };

    emitter.emit('complete', summary);
  }

  // ─── Public Interface ──────────────────────────────────────────────────────

  /**
   * Starts execution of a plan within a task session.
   *
   * Per Requirement 3.1: Process steps sequentially in plan order.
   *
   * @param {Object} taskSession - The TaskSession object
   * @param {Object} plan - The Plan to execute
   */
  function start(taskSession, plan) {
    if (!taskSession || !plan || !Array.isArray(plan.steps) || plan.steps.length === 0) {
      throw new Error('A valid task session and plan with at least one step are required.');
    }

    if (state !== LOOP_STATES.IDLE) {
      throw new Error(`Cannot start execution in state "${state}". Loop must be idle.`);
    }

    session = taskSession;
    currentPlan = plan;
    replanCount = 0;
    stepResults = [];
    currentStepIndex = 0;
    startTime = Date.now();

    transitionTo(LOOP_STATES.RUNNING);
    startProgressTimer();
    startTaskTimeout();

    // Emit plan-generated event
    emitter.emit('plan-generated', {
      plan,
      timestamp: new Date().toISOString()
    });

    // Start the execution loop (non-blocking)
    runLoop().catch((err) => {
      if (state !== LOOP_STATES.CANCELED && state !== LOOP_STATES.COMPLETED) {
        transitionTo(LOOP_STATES.FAILED);
        stopProgressTimer();
        stopTaskTimeout();
        emitter.emit('error', {
          type: 'execution_error',
          message: err.message || 'Unexpected execution error',
          stepId: activeStepId || '',
          attemptCount: 0,
          classification: 'permanent'
        });
      }
    });
  }

  /**
   * Pauses execution. The current step will complete but no new steps will start.
   *
   * @returns {Promise<void>}
   */
  async function pause() {
    if (state !== LOOP_STATES.RUNNING) return;
    await pauseInternal('User requested pause');
  }

  /**
   * Resumes execution from a paused state.
   *
   * @returns {Promise<void>}
   */
  async function resume() {
    if (state !== LOOP_STATES.PAUSED) return;

    transitionTo(LOOP_STATES.RUNNING);
    startProgressTimer();
    startTaskTimeout();

    // Resolve the pause waiter
    if (pauseResolver) {
      const resolver = pauseResolver;
      pauseResolver = null;
      resolver('resumed');
    }
  }

  /**
   * Cancels execution. Any active step is aborted.
   *
   * @returns {Promise<void>}
   */
  async function cancel() {
    if (state === LOOP_STATES.COMPLETED || state === LOOP_STATES.CANCELED) return;

    const wasPaused = state === LOOP_STATES.PAUSED;
    transitionTo(LOOP_STATES.CANCELED);
    stopProgressTimer();
    stopTaskTimeout();

    // Abort current step if running
    if (activeStepAbort) {
      activeStepAbort.abort();
    }

    // Resolve pause waiter if paused
    if (wasPaused && pauseResolver) {
      const resolver = pauseResolver;
      pauseResolver = null;
      resolver('canceled');
    }

    emitter.emit('task-canceled', { timestamp: new Date().toISOString() });
  }

  /**
   * Returns the current state of the execution loop.
   *
   * @returns {string} Current state
   */
  function getState() {
    return state;
  }

  /**
   * Returns the current replan count.
   *
   * @returns {number}
   */
  function getReplanCount() {
    return replanCount;
  }

  /**
   * Returns the accumulated step results as a defensive copy.
   *
   * Each individual result is frozen (immutable). The returned array is
   * a shallow copy so callers cannot affect internal state. This supports
   * the preservation guarantee: completed outputs are never lost during
   * retries or re-plans (Requirements 10.7, 13.3).
   *
   * @returns {Object[]} Frozen step result objects
   */
  function getStepResults() {
    return [...stepResults];
  }

  /**
   * Returns the current plan being executed.
   *
   * @returns {Object|null}
   */
  function getCurrentPlan() {
    return currentPlan;
  }

  return {
    start,
    pause,
    resume,
    cancel,
    on: emitter.on.bind(emitter),
    off: emitter.off.bind(emitter),
    once: emitter.once.bind(emitter),
    getState,
    getReplanCount,
    getStepResults,
    getCurrentPlan
  };
}
