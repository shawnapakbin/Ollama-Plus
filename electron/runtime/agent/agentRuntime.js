/**
 * Agent Runtime
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.0.3
 *
 * Top-level orchestrator for the autonomous agent client. Registers all IPC handlers,
 * coordinates task planning, execution loop, context management, memory management,
 * and sandbox enforcement. Streams ActivityStreamEvents to the renderer via IPC.
 *
 * Requirements: 1.3, 1.7, 6.1, 6.3, 6.4, 6.7, 6.8, 9.1, 9.6, 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 14.6
 */

import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';

import { validateTaskSubmission } from './taskValidator.js';
import { TaskPlanner } from './taskPlanner.js';
import { createExecutionLoop, LOOP_STATES } from './executionLoop.js';
import { ContextManager } from './contextManager.js';
import { MemoryManager } from './memoryManager.js';
import { createSandboxEnforcer } from './sandboxEnforcer.js';
import { classifyRisk } from './riskClassifier.js';
import { shouldRetry, classifyError, getBackoffDelay } from './retryPolicy.js';
import { createToolDispatcher } from './toolDispatcher.js';
import { truncateOutput } from './outputFormatter.js';
import {
  loadAgentConfig,
  saveAgentConfig,
  DEFAULT_AGENT_CONFIG
} from './agentConfig.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Maximum time to persist a session after submission (ms). Requirement 1.3: within 1 second. */
const SESSION_PERSIST_DEADLINE_MS = 1000;

/** Maximum time to apply config changes (ms). Requirement 14.6: within 2 seconds. */
const CONFIG_APPLY_DEADLINE_MS = 2000;

/** Page size for session listing. */
const DEFAULT_PAGE_SIZE = 20;

/** Approval gate timeout: keep paused indefinitely (Requirement 6.7). */
const APPROVAL_GATE_NO_TIMEOUT = true;

/** Maximum time for pause completion (ms). Requirement 13.2: within 10 seconds. */
const PAUSE_COMPLETION_DEADLINE_MS = 10_000;

/** Cancel deadline (ms). Requirement 12.7: within 2 seconds. */
const CANCEL_DEADLINE_MS = 2000;

// ─── IPC Channel Constants ───────────────────────────────────────────────────

export const IPC_CHANNELS = Object.freeze({
  SUBMIT_TASK: 'agent:submit-task',
  PAUSE_TASK: 'agent:pause-task',
  RESUME_TASK: 'agent:resume-task',
  CANCEL_TASK: 'agent:cancel-task',
  SUBMIT_FOLLOW_UP: 'agent:submit-follow-up',
  SUBMIT_FEEDBACK: 'agent:submit-feedback',
  APPROVE_GATE: 'agent:approve-gate',
  DENY_GATE: 'agent:deny-gate',
  GET_CONFIG: 'agent:get-config',
  SAVE_CONFIG: 'agent:save-config',
  LIST_SESSIONS: 'agent:list-sessions',
  GET_SESSION: 'agent:get-session',
  RERUN_TASK: 'agent:rerun-task',
  // Streaming event channel (main → renderer)
  ACTIVITY_STREAM: 'agent:activity-stream'
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Creates a fresh TaskSession object from a validated submission.
 *
 * @param {object} submission - Validated task submission
 * @param {object} config - Current agent config snapshot
 * @returns {object} TaskSession
 */
function createTaskSession(submission, config) {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    instruction: submission.instruction,
    status: 'planned',
    workingDirectory: submission.workingDirectory,
    modelId: submission.modelId,
    endpoint: submission.endpoint,
    plan: null,
    attachments: submission.attachments || [],
    artifacts: [],
    stepResults: [],
    replanCount: 0,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    completedAt: null,
    totalDuration: null,
    config: {
      stepTimeout: config.stepTimeout,
      taskTimeout: config.taskTimeout,
      retryCount: config.retryCount,
      autoApprovalLowRisk: config.autoApprovalLowRisk,
      customApprovalRules: config.customApprovalRules || [],
      toolTimeouts: { ...(config.toolTimeouts || DEFAULT_AGENT_CONFIG.toolTimeouts) }
    }
  };
}

/**
 * Generates a timestamp in ISO 8601 format.
 * @returns {string}
 */
function timestamp() {
  return new Date().toISOString();
}

// ─── Agent Runtime Factory ───────────────────────────────────────────────────

/**
 * Initializes the Agent Runtime, registering all IPC handlers on ipcMain.
 *
 * @param {Electron.IpcMain} ipcMain - Electron IPC main process handle
 * @param {Electron.BrowserWindow} mainWindow - The main browser window for sending events
 * @param {object} dependencies - External dependencies
 * @param {string} dependencies.statePath - Path to runtime state storage directory
 * @param {Function} [dependencies.mcpGateway] - MCP gateway dispatch function
 * @param {Function} [dependencies.fetchImpl] - Custom fetch implementation
 * @param {string} [dependencies.defaultEndpoint] - Default Ollama endpoint
 * @returns {object} AgentRuntime public interface
 */
export function initAgentRuntime(ipcMain, mainWindow, dependencies = {}) {
  const {
    statePath,
    mcpGateway,
    fetchImpl = globalThis.fetch,
    defaultEndpoint = 'http://localhost:11434'
  } = dependencies;

  // ─── Storage paths ─────────────────────────────────────────────────────────
  const agentDir = path.join(path.dirname(statePath), 'agent');
  const sessionsPath = path.join(agentDir, 'sessions.json');
  const configPath = path.join(agentDir, 'agent-config.json');
  const memoryPath = path.join(agentDir, 'memory.json');

  // Ensure agent directory exists
  fs.mkdirSync(agentDir, { recursive: true });

  // ─── Active Sessions Map ───────────────────────────────────────────────────
  // Maps sessionId -> { session, executionLoop, contextManager, sandboxEnforcer, planner, pendingGates }
  const activeSessions = new Map();

  // ─── Persistence ───────────────────────────────────────────────────────────

  /**
   * Loads all persisted sessions from disk.
   * @returns {object[]}
   */
  function loadSessions() {
    if (!fs.existsSync(sessionsPath)) {
      return [];
    }
    try {
      const raw = JSON.parse(fs.readFileSync(sessionsPath, 'utf8'));
      return Array.isArray(raw) ? raw : [];
    } catch {
      return [];
    }
  }

  /**
   * Persists the sessions array to disk.
   * @param {object[]} sessions
   */
  function saveSessions(sessions) {
    fs.writeFileSync(sessionsPath, JSON.stringify(sessions, null, 2), 'utf8');
  }

  /**
   * Persists a single session (upserts by id).
   * Requirement 1.3: Must persist within 1 second.
   * @param {object} session
   */
  function persistSession(session) {
    const sessions = loadSessions();
    const index = sessions.findIndex(s => s.id === session.id);
    if (index >= 0) {
      sessions[index] = session;
    } else {
      sessions.push(session);
    }
    saveSessions(sessions);
  }

  /**
   * Retrieves a session by ID from disk.
   * @param {string} sessionId
   * @returns {object|null}
   */
  function getSessionFromStore(sessionId) {
    const sessions = loadSessions();
    return sessions.find(s => s.id === sessionId) || null;
  }

  // ─── Memory Manager ────────────────────────────────────────────────────────
  const memoryManager = new MemoryManager(memoryPath);

  // ─── Event Streaming ───────────────────────────────────────────────────────

  /**
   * Sends an ActivityStreamEvent to the renderer.
   * @param {object} event - The event payload
   */
  function streamEvent(event) {
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.ACTIVITY_STREAM, event);
      }
    } catch {
      // Window may be closed; swallow errors
    }
  }

  // ─── Execution Orchestration ───────────────────────────────────────────────

  /**
   * Sets up and starts the execution lifecycle for a session.
   * Coordinates: validate → plan → execute → stream → complete
   *
   * @param {object} session - The TaskSession
   */
  async function startExecution(session) {
    const config = loadAgentConfig(configPath);

    // Create subsystems
    const sandboxEnforcer = createSandboxEnforcer();
    sandboxEnforcer.setWorkingDirectory(session.workingDirectory);

    // Wrap mcpGateway to match toolDispatcher's expected signature:
    // (server, action, payload) => Promise<result>
    const gatewayFn = mcpGateway
      ? async (server, action, payload) => {
          const result = await mcpGateway.dispatch({ server, action, payload });
          return result;
        }
      : async () => { throw new Error('MCP gateway not configured'); };

    const toolDispatcher = createToolDispatcher({
      mcpGateway: gatewayFn,
      sandboxEnforcer,
      config: { toolTimeouts: session.config.toolTimeouts }
    });

    const contextManager = new ContextManager({
      modelTokenLimit: 128000, // Default large context; adjusted per model if needed
      systemPrompt: undefined  // Use default
    });

    const taskPlanner = new TaskPlanner({
      endpoint: session.endpoint || defaultEndpoint,
      modelId: session.modelId,
      fetchFn: fetchImpl
    });

    const executionLoop = createExecutionLoop({
      taskPlanner,
      toolDispatcher,
      contextManager,
      riskClassifier: { classify: classifyRisk },
      retryPolicy: { shouldRetry, classifyError, getBackoffDelay },
      config: {
        stepTimeout: session.config.stepTimeout,
        taskTimeout: session.config.taskTimeout,
        maxReplans: 3,
        progressInterval: 1000
      },
      onStepFlushed: (stepResult) => {
        // Persist step results to session
        const activeEntry = activeSessions.get(session.id);
        if (activeEntry) {
          activeEntry.session.stepResults.push(stepResult);
          activeEntry.session.updatedAt = timestamp();
          persistSession(activeEntry.session);
        }
      }
    });

    // Store active session context
    const activeEntry = {
      session,
      executionLoop,
      contextManager,
      sandboxEnforcer,
      taskPlanner,
      toolDispatcher,
      pendingGates: new Map() // gateId -> { resolve, gate }
    };
    activeSessions.set(session.id, activeEntry);

    // ─── Wire up events from execution loop to Activity Stream ─────────────

    executionLoop.on('plan-generated', (event) => {
      activeEntry.session.plan = event.plan;
      activeEntry.session.status = 'running';
      activeEntry.session.startedAt = activeEntry.session.startedAt || timestamp();
      activeEntry.session.updatedAt = timestamp();
      persistSession(activeEntry.session);
      streamEvent({ type: 'plan-generated', plan: event.plan, timestamp: event.timestamp });
    });

    executionLoop.on('step-start', (step) => {
      streamEvent({ type: 'step-started', stepId: step.id, title: step.title, timestamp: timestamp() });
    });

    executionLoop.on('step-complete', (step, outcome) => {
      streamEvent({
        type: 'step-completed',
        stepId: step.id,
        outcome,
        duration: 0, // Duration tracked in step result
        timestamp: timestamp()
      });
    });

    executionLoop.on('progress', (progress) => {
      streamEvent({ type: 'step-progress', stepId: progress.stepId, output: `${progress.percentage}%`, timestamp: timestamp() });
    });

    executionLoop.on('tool-call', (data) => {
      streamEvent({ type: 'tool-call', stepId: data.stepId, tool: data.tool, params: data.params || {}, timestamp: timestamp() });
    });

    executionLoop.on('tool-result', (data) => {
      const output = truncateOutput(data.output || '');
      streamEvent({ type: 'tool-result', stepId: data.stepId, tool: data.tool, output, duration: data.duration || 0, timestamp: timestamp() });
    });

    executionLoop.on('reasoning', (data) => {
      streamEvent({ type: 'reasoning', stepId: data.stepId, content: data.content, timestamp: timestamp() });
    });

    executionLoop.on('token', (data) => {
      streamEvent({ type: 'token', stepId: data.stepId, delta: data.delta, timestamp: timestamp() });
    });

    executionLoop.on('error', (error) => {
      streamEvent({ type: 'error', stepId: error.stepId || '', error, recovery: error.recovery || undefined, timestamp: timestamp() });
    });

    executionLoop.on('approval-required', async (gate) => {
      // Requirement 6.1: Pause and present Approval_Gate within 500ms
      const gateId = gate.id || randomUUID();
      const approvalGate = {
        id: gateId,
        sessionId: session.id,
        stepId: gate.stepId || '',
        action: gate.action || '',
        tool: gate.tool || '',
        params: gate.params || {},
        riskLevel: 'high',
        riskExplanation: gate.riskExplanation || gate.reason || 'This operation is classified as high-risk.',
        status: 'pending',
        decidedAt: null,
        denialReason: null,
        createdAt: timestamp()
      };

      activeEntry.session.status = 'waiting_approval';
      activeEntry.session.updatedAt = timestamp();
      persistSession(activeEntry.session);

      // Emit approval gate event to renderer
      streamEvent({
        type: 'approval-gate',
        gateId: approvalGate.id,
        action: approvalGate.action,
        tool: approvalGate.tool,
        params: approvalGate.params,
        riskExplanation: approvalGate.riskExplanation,
        timestamp: timestamp()
      });

      // Store pending gate with a promise resolver for the execution loop to await
      // Requirement 6.7: No timeout — keep paused indefinitely
      return new Promise((resolve) => {
        activeEntry.pendingGates.set(gateId, { resolve, gate: approvalGate });
      });
    });

    executionLoop.on('replan', (data) => {
      activeEntry.session.replanCount = executionLoop.getReplanCount();
      activeEntry.session.updatedAt = timestamp();
      persistSession(activeEntry.session);
      streamEvent({
        type: 'replan',
        oldSteps: data.oldSteps || [],
        newSteps: data.newSteps || [],
        reason: data.reason || '',
        timestamp: timestamp()
      });
    });

    executionLoop.on('context-summary', (data) => {
      streamEvent({ type: 'context-summary', summarized: data.summarized || 0, retained: data.retained || 0, timestamp: timestamp() });
    });

    executionLoop.on('task-paused', (data) => {
      activeEntry.session.status = 'paused';
      activeEntry.session.updatedAt = timestamp();
      persistSession(activeEntry.session);
      streamEvent({ type: 'task-paused', reason: data.reason || '', timestamp: data.timestamp || timestamp() });
    });

    executionLoop.on('task-canceled', (data) => {
      activeEntry.session.status = 'canceled';
      activeEntry.session.completedAt = timestamp();
      activeEntry.session.updatedAt = timestamp();
      if (activeEntry.session.startedAt) {
        activeEntry.session.totalDuration = Date.now() - new Date(activeEntry.session.startedAt).getTime();
      }
      persistSession(activeEntry.session);
      streamEvent({ type: 'task-canceled', timestamp: data.timestamp || timestamp() });
    });

    executionLoop.on('complete', (summary) => {
      activeEntry.session.status = 'completed';
      activeEntry.session.completedAt = timestamp();
      activeEntry.session.updatedAt = timestamp();
      if (activeEntry.session.startedAt) {
        activeEntry.session.totalDuration = Date.now() - new Date(activeEntry.session.startedAt).getTime();
      }
      activeEntry.session.stepResults = executionLoop.getStepResults();
      persistSession(activeEntry.session);
      streamEvent({ type: 'task-complete', summary: buildTaskSummary(activeEntry.session), timestamp: timestamp() });
    });

    // ─── Generate Plan & Start ─────────────────────────────────────────────

    try {
      // Retrieve relevant memory for context (Requirement 8.4)
      const memoryRecords = memoryManager.retrieveRelevant(session.instruction, 20);

      // Build initial context
      const taskInstruction = {
        instruction: session.instruction,
        workingDirectory: session.workingDirectory,
        attachments: session.attachments,
        followUpInstructions: []
      };

      const contextWindow = contextManager.buildPrompt(taskInstruction, null, []);

      // Generate plan (Requirement 2.1)
      const plan = await taskPlanner.generatePlan(taskInstruction, contextWindow);

      activeEntry.session.plan = plan;
      activeEntry.session.updatedAt = timestamp();
      persistSession(activeEntry.session);

      // Start execution
      executionLoop.start(session, plan);
    } catch (err) {
      // Planning failed
      activeEntry.session.status = 'failed';
      activeEntry.session.updatedAt = timestamp();
      persistSession(activeEntry.session);
      streamEvent({
        type: 'error',
        stepId: '',
        error: {
          type: 'planning_error',
          message: err.message || 'Task planning failed',
          stepId: '',
          attemptCount: 0,
          classification: 'permanent'
        },
        timestamp: timestamp()
      });
    }
  }

  /**
   * Builds a TaskSummary from a completed session.
   * @param {object} session
   * @returns {object}
   */
  function buildTaskSummary(session) {
    return {
      sessionId: session.id,
      instruction: session.instruction,
      status: session.status,
      stepsCompleted: (session.stepResults || []).filter(r => r.status === 'completed').length,
      stepsTotal: session.plan ? session.plan.steps.length : 0,
      artifactCount: (session.artifacts || []).length,
      totalDuration: session.totalDuration || 0,
      completedAt: session.completedAt || timestamp()
    };
  }

  // ─── IPC Handlers ──────────────────────────────────────────────────────────

  /**
   * agent:submit-task
   * Creates a new TaskSession from the submission, persists it, and starts execution.
   * Requirement 1.3: Create and persist within 1 second.
   */
  ipcMain.handle(IPC_CHANNELS.SUBMIT_TASK, async (_event, submission) => {
    // Validate submission
    const validation = validateTaskSubmission(submission);
    if (!validation.valid) {
      return { success: false, errors: validation.errors };
    }

    // Load current config
    const config = loadAgentConfig(configPath);

    // Create session (Requirement 1.3)
    const session = createTaskSession(submission, config);

    // Persist immediately
    persistSession(session);

    // Start execution asynchronously (non-blocking for the IPC response)
    setImmediate(() => {
      startExecution(session).catch((err) => {
        // If startup fails entirely, update session state
        session.status = 'failed';
        session.updatedAt = timestamp();
        persistSession(session);
        streamEvent({
          type: 'error',
          stepId: '',
          error: {
            type: 'runtime_error',
            message: err.message || 'Failed to start execution',
            stepId: '',
            attemptCount: 0,
            classification: 'permanent'
          },
          timestamp: timestamp()
        });
      });
    });

    return { success: true, session };
  });

  /**
   * agent:pause-task
   * Pauses execution of an active session.
   * Requirement 13.2: Complete current tool call or cancel within 5s, halt within 10s.
   */
  ipcMain.handle(IPC_CHANNELS.PAUSE_TASK, async (_event, sessionId) => {
    const activeEntry = activeSessions.get(sessionId);
    if (!activeEntry) {
      return { success: false, error: 'No active session found' };
    }

    const loop = activeEntry.executionLoop;
    if (loop.getState() !== LOOP_STATES.RUNNING) {
      return { success: false, error: `Cannot pause session in state: ${loop.getState()}` };
    }

    await loop.pause();

    activeEntry.session.status = 'paused';
    activeEntry.session.updatedAt = timestamp();
    persistSession(activeEntry.session);

    return { success: true };
  });

  /**
   * agent:resume-task
   * Resumes a paused session.
   * Requirement 13.5: Continue from the exact step where execution was halted.
   */
  ipcMain.handle(IPC_CHANNELS.RESUME_TASK, async (_event, sessionId) => {
    const activeEntry = activeSessions.get(sessionId);
    if (!activeEntry) {
      return { success: false, error: 'No active session found' };
    }

    const loop = activeEntry.executionLoop;
    if (loop.getState() !== LOOP_STATES.PAUSED) {
      return { success: false, error: `Cannot resume session in state: ${loop.getState()}` };
    }

    await loop.resume();

    activeEntry.session.status = 'running';
    activeEntry.session.updatedAt = timestamp();
    persistSession(activeEntry.session);

    // Emit resumed indicator (Requirement 13.5)
    streamEvent({ type: 'step-progress', stepId: '', output: 'Resumed', timestamp: timestamp() });

    return { success: true };
  });

  /**
   * agent:cancel-task
   * Cancels execution of an active session.
   * Requirement 12.7 / 13.4: Halt within 2 seconds, preserve all partial results.
   */
  ipcMain.handle(IPC_CHANNELS.CANCEL_TASK, async (_event, sessionId) => {
    const activeEntry = activeSessions.get(sessionId);
    if (!activeEntry) {
      // Try to cancel a stored session that's in paused/waiting state
      const stored = getSessionFromStore(sessionId);
      if (stored && (stored.status === 'paused' || stored.status === 'waiting_approval' || stored.status === 'running')) {
        stored.status = 'canceled';
        stored.completedAt = timestamp();
        stored.updatedAt = timestamp();
        persistSession(stored);
        return { success: true };
      }
      return { success: false, error: 'No active session found' };
    }

    const loop = activeEntry.executionLoop;
    await loop.cancel();

    activeEntry.session.status = 'canceled';
    activeEntry.session.completedAt = timestamp();
    activeEntry.session.updatedAt = timestamp();
    if (activeEntry.session.startedAt) {
      activeEntry.session.totalDuration = Date.now() - new Date(activeEntry.session.startedAt).getTime();
    }
    persistSession(activeEntry.session);

    // Clean up pending gates
    for (const [gateId, pending] of activeEntry.pendingGates) {
      pending.resolve({ approved: false, reason: 'Task canceled' });
    }
    activeEntry.pendingGates.clear();

    return { success: true };
  });

  /**
   * agent:submit-follow-up
   * Handles follow-up instructions during active execution.
   * Requirement 1.7: Allow follow-up instructions that modify or extend the current Task.
   * Requirement 13.3: Treat as intervention that triggers re-plan while preserving completed results.
   */
  ipcMain.handle(IPC_CHANNELS.SUBMIT_FOLLOW_UP, async (_event, sessionId, instruction) => {
    if (!instruction || typeof instruction !== 'string' || instruction.trim().length === 0) {
      return { success: false, error: 'Follow-up instruction must be a non-empty string' };
    }

    const activeEntry = activeSessions.get(sessionId);
    if (!activeEntry) {
      return { success: false, error: 'No active session found' };
    }

    // Add follow-up to context (Requirement 8.6)
    activeEntry.contextManager.addFollowUp(instruction.trim());

    // If running, the execution loop will pick up the re-plan on next step boundary
    // If paused, queue it for when resumed
    activeEntry.session.updatedAt = timestamp();
    persistSession(activeEntry.session);

    streamEvent({
      type: 'reasoning',
      stepId: '',
      content: `Follow-up instruction received: "${instruction.trim()}"`,
      timestamp: timestamp()
    });

    return { success: true };
  });

  /**
   * agent:submit-feedback
   * Handles corrective feedback on a specific step's output.
   * Requirement 13.6: Incorporate feedback and re-execute the affected step.
   */
  ipcMain.handle(IPC_CHANNELS.SUBMIT_FEEDBACK, async (_event, sessionId, stepId, feedback) => {
    if (!feedback || typeof feedback !== 'string' || feedback.trim().length === 0) {
      return { success: false, error: 'Feedback must be a non-empty string' };
    }

    const activeEntry = activeSessions.get(sessionId);
    if (!activeEntry) {
      return { success: false, error: 'No active session found' };
    }

    // Add feedback to context for re-execution consideration
    activeEntry.contextManager.addFollowUp(
      `Corrective feedback for step ${stepId}: ${feedback.trim()}`
    );

    activeEntry.session.updatedAt = timestamp();
    persistSession(activeEntry.session);

    streamEvent({
      type: 'reasoning',
      stepId: stepId || '',
      content: `Corrective feedback received for step ${stepId}. Agent will incorporate feedback.`,
      timestamp: timestamp()
    });

    return { success: true, stepId };
  });

  /**
   * agent:approve-gate
   * Approves a pending approval gate.
   * Requirement 6.3: Proceed within 1 second of approval.
   */
  ipcMain.handle(IPC_CHANNELS.APPROVE_GATE, async (_event, sessionId, gateId) => {
    const activeEntry = activeSessions.get(sessionId);
    if (!activeEntry) {
      return { success: false, error: 'No active session found' };
    }

    const pendingGate = activeEntry.pendingGates.get(gateId);
    if (!pendingGate) {
      return { success: false, error: 'No pending approval gate found with that ID' };
    }

    // Resolve the gate as approved
    pendingGate.gate.status = 'approved';
    pendingGate.gate.decidedAt = timestamp();
    pendingGate.resolve({ approved: true });
    activeEntry.pendingGates.delete(gateId);

    // Update session status back to running
    activeEntry.session.status = 'running';
    activeEntry.session.updatedAt = timestamp();
    persistSession(activeEntry.session);

    return { success: true };
  });

  /**
   * agent:deny-gate
   * Denies a pending approval gate.
   * Requirement 6.4: Skip denied action, record reason, re-plan with exclusion.
   * Requirement 6.8: Display confirmation in Activity Stream.
   */
  ipcMain.handle(IPC_CHANNELS.DENY_GATE, async (_event, sessionId, gateId, reason) => {
    const activeEntry = activeSessions.get(sessionId);
    if (!activeEntry) {
      return { success: false, error: 'No active session found' };
    }

    const pendingGate = activeEntry.pendingGates.get(gateId);
    if (!pendingGate) {
      return { success: false, error: 'No pending approval gate found with that ID' };
    }

    // Resolve the gate as denied
    pendingGate.gate.status = 'denied';
    pendingGate.gate.decidedAt = timestamp();
    pendingGate.gate.denialReason = reason || null;
    pendingGate.resolve({ approved: false, reason: reason || 'User denied' });
    activeEntry.pendingGates.delete(gateId);

    // Update session status back to running (re-plan will be triggered by execution loop)
    activeEntry.session.status = 'running';
    activeEntry.session.updatedAt = timestamp();
    persistSession(activeEntry.session);

    // Requirement 6.8: Display confirmation in Activity Stream
    streamEvent({
      type: 'reasoning',
      stepId: pendingGate.gate.stepId || '',
      content: `Action denied by user${reason ? `: ${reason}` : ''}. Agent is re-planning with the denied action excluded.`,
      timestamp: timestamp()
    });

    return { success: true };
  });

  /**
   * agent:get-config
   * Returns the current agent configuration.
   */
  ipcMain.handle(IPC_CHANNELS.GET_CONFIG, async () => {
    return loadAgentConfig(configPath);
  });

  /**
   * agent:save-config
   * Saves and applies configuration changes.
   * Requirement 14.6: Apply to active sessions within 2 seconds without restart.
   */
  ipcMain.handle(IPC_CHANNELS.SAVE_CONFIG, async (_event, config) => {
    const result = saveAgentConfig(configPath, config);

    // Requirement 14.6: Apply changes to active sessions
    if (result.valid || result.savedConfig) {
      const newConfig = result.savedConfig || loadAgentConfig(configPath);

      // Apply to all active sessions
      for (const [sessionId, entry] of activeSessions) {
        entry.session.config = {
          stepTimeout: newConfig.stepTimeout,
          taskTimeout: newConfig.taskTimeout,
          retryCount: newConfig.retryCount,
          autoApprovalLowRisk: newConfig.autoApprovalLowRisk,
          customApprovalRules: newConfig.customApprovalRules || [],
          toolTimeouts: { ...(newConfig.toolTimeouts || DEFAULT_AGENT_CONFIG.toolTimeouts) }
        };
        entry.session.updatedAt = timestamp();
        persistSession(entry.session);
      }
    }

    return result;
  });

  /**
   * agent:list-sessions
   * Returns paginated list of task sessions in reverse chronological order.
   * Requirement 9.1: Persist every TaskSession.
   */
  ipcMain.handle(IPC_CHANNELS.LIST_SESSIONS, async (_event, options = {}) => {
    const page = Math.max(1, parseInt(options.page, 10) || 1);
    const pageSize = Math.max(1, Math.min(100, parseInt(options.pageSize, 10) || DEFAULT_PAGE_SIZE));

    const allSessions = loadSessions()
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const total = allSessions.length;
    const totalPages = Math.ceil(total / pageSize);
    const start = (page - 1) * pageSize;
    const items = allSessions.slice(start, start + pageSize);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages
    };
  });

  /**
   * agent:get-session
   * Retrieves a specific task session by ID.
   */
  ipcMain.handle(IPC_CHANNELS.GET_SESSION, async (_event, sessionId) => {
    // Check active sessions first
    const activeEntry = activeSessions.get(sessionId);
    if (activeEntry) {
      return activeEntry.session;
    }
    // Fall back to persisted store
    return getSessionFromStore(sessionId);
  });

  /**
   * agent:rerun-task
   * Re-runs a past task with the same instruction in a new session.
   * Requirement 9.6: Support re-running past tasks.
   * Requirement 9.7: Note missing artifacts from original session.
   */
  ipcMain.handle(IPC_CHANNELS.RERUN_TASK, async (_event, sessionId) => {
    const originalSession = getSessionFromStore(sessionId);
    if (!originalSession) {
      return { success: false, error: 'Original session not found' };
    }

    // Check for missing artifacts (Requirement 9.7)
    const missingArtifacts = [];
    if (originalSession.artifacts && originalSession.artifacts.length > 0) {
      for (const artifact of originalSession.artifacts) {
        if (artifact.filePath && !fs.existsSync(artifact.filePath)) {
          missingArtifacts.push(artifact.filePath);
        }
      }
    }

    // Create new submission from original
    const submission = {
      instruction: originalSession.instruction,
      workingDirectory: originalSession.workingDirectory,
      modelId: originalSession.modelId,
      endpoint: originalSession.endpoint,
      attachments: originalSession.attachments || []
    };

    // Validate
    const validation = validateTaskSubmission(submission);
    if (!validation.valid) {
      return { success: false, errors: validation.errors };
    }

    const config = loadAgentConfig(configPath);
    const newSession = createTaskSession(submission, config);

    // Persist immediately
    persistSession(newSession);

    // If there are missing artifacts, add a note to the context
    if (missingArtifacts.length > 0) {
      const note = `Note: The following files from the original task session are no longer available: ${missingArtifacts.join(', ')}`;
      // We'll add this as a follow-up instruction so the context manager picks it up
      newSession._missingArtifactNote = note;
    }

    // Start execution
    setImmediate(() => {
      startExecution(newSession).catch((err) => {
        newSession.status = 'failed';
        newSession.updatedAt = timestamp();
        persistSession(newSession);
      });
    });

    return { success: true, session: newSession, missingArtifacts };
  });

  // ─── Public Interface ──────────────────────────────────────────────────────

  const runtime = {
    /**
     * Gets the current state of a session's execution loop.
     * @param {string} sessionId
     * @returns {string|null}
     */
    getSessionState(sessionId) {
      const entry = activeSessions.get(sessionId);
      return entry ? entry.executionLoop.getState() : null;
    },

    /**
     * Gets the active sessions map (for testing/inspection).
     * @returns {Map}
     */
    getActiveSessions() {
      return activeSessions;
    },

    /**
     * Shuts down all active sessions gracefully.
     */
    async shutdown() {
      for (const [sessionId, entry] of activeSessions) {
        try {
          const state = entry.executionLoop.getState();
          if (state === LOOP_STATES.RUNNING || state === LOOP_STATES.PAUSED) {
            await entry.executionLoop.cancel();
            entry.session.status = 'paused';
            entry.session.updatedAt = timestamp();
            persistSession(entry.session);
          }
        } catch {
          // Best-effort shutdown
        }
      }
      activeSessions.clear();
    },

    /**
     * Removes all IPC handlers (for testing/cleanup).
     */
    removeHandlers() {
      Object.values(IPC_CHANNELS).forEach(channel => {
        if (channel !== IPC_CHANNELS.ACTIVITY_STREAM) {
          ipcMain.removeHandler(channel);
        }
      });
    }
  };

  return runtime;
}
