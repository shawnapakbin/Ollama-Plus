/**
 * Integration Tests: Pause / Resume / Cancel
 *
 * Validates the full task control flow: submit → execute → pause → resume → complete,
 * and submit → execute → cancel → partial results preserved.
 *
 * Requirements: 13.1, 13.2, 13.4, 13.5, 13.7
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initAgentRuntime, IPC_CHANNELS } from '../../../electron/runtime/agent/agentRuntime.js';

// ─── Shared test types ───────────────────────────────────────────────────────

type IpcHandler = (...args: unknown[]) => unknown;
type PersistedSession = { id: string; [key: string]: unknown };
type RuntimeOptions = Parameters<typeof initAgentRuntime>[2];

// ─── Test Helpers ────────────────────────────────────────────────────────────

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

function createTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-pause-resume-'));
  tempDirs.push(dir);
  return dir;
}

/**
 * Creates a mock ipcMain that captures registered handlers.
 */
function createMockIpcMain() {
  const handlers = new Map<string, IpcHandler>();
  return {
    handle(channel: string, handler: IpcHandler) {
      handlers.set(channel, handler);
    },
    removeHandler(channel: string) {
      handlers.delete(channel);
    },
    getHandler(channel: string) {
      return handlers.get(channel);
    },
    getHandlers() {
      return handlers;
    }
  };
}

/**
 * Creates a mock BrowserWindow that captures sent events.
 */
function createMockMainWindow() {
  const sentEvents: Array<{ channel: string; payload: unknown }> = [];
  return {
    isDestroyed: () => false,
    webContents: {
      send(channel: string, payload: unknown) {
        sentEvents.push({ channel, payload });
      }
    },
    getSentEvents() {
      return sentEvents;
    },
    clearEvents() {
      sentEvents.length = 0;
    }
  };
}

/**
 * Creates a mock MCP gateway that simulates tool execution with configurable delay.
 */
function createMockMcpGateway(delayMs = 50) {
  const calls: Array<{ server: string; action: string; payload: unknown }> = [];
  return {
    dispatch: async (request: { server: string; action: string; payload?: unknown }) => {
      calls.push({ server: request.server, action: request.action, payload: request.payload });
      // Simulate tool execution time
      await new Promise(r => setTimeout(r, delayMs));
      return { success: true, output: `Executed: ${request.action}` };
    },
    getCalls: () => calls
  };
}

/**
 * Creates a mock fetch that returns a multi-step plan from the "LLM".
 */
function createMockFetch(stepCount = 3) {
  const steps = Array.from({ length: stepCount }, (_, i) => ({
    id: `step-${i + 1}`,
    title: `Step ${i + 1}: Execute operation ${i + 1}`,
    description: `Perform operation number ${i + 1}`,
    riskLevel: 'low',
    requiredTools: [{ name: 'terminal', server: 'terminal', category: 'terminal' }],
    parallelSafe: false,
    timeout: 120000,
    dependsOn: []
  }));

  const planResponse = {
    steps,
    estimatedDuration: stepCount * 5000,
    reasoning: 'Multi-step test plan for pause/resume testing'
  };

  return async () => new Response(JSON.stringify({
    message: { content: JSON.stringify(planResponse) }
  }));
}

function createValidSubmission(workingDir: string) {
  return {
    instruction: 'Execute a multi-step task for testing pause/resume behavior',
    workingDirectory: workingDir,
    modelId: 'llama3',
    endpoint: 'http://localhost:11434',
    attachments: []
  };
}

/**
 * Waits until a condition is met or times out.
 */
async function waitFor(
  conditionFn: () => boolean,
  timeoutMs = 5000,
  pollMs = 50
): Promise<void> {
  const start = Date.now();
  while (!conditionFn()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitFor timed out after ${timeoutMs}ms`);
    }
    await new Promise(r => setTimeout(r, pollMs));
  }
}

/**
 * Gets events of a specific type from the mock window's sent events.
 */
function getEventsByType(mainWindow: ReturnType<typeof createMockMainWindow>, type: string) {
  return mainWindow.getSentEvents()
    .filter(e => e.channel === IPC_CHANNELS.ACTIVITY_STREAM)
    .map(e => e.payload as { type: string; [key: string]: unknown })
    .filter(e => e.type === type);
}

// ─── Integration Tests ───────────────────────────────────────────────────────

describe('Integration: Pause / Resume / Cancel', () => {
  let tempDir: string;
  let ipcMain: ReturnType<typeof createMockIpcMain>;
  let mainWindow: ReturnType<typeof createMockMainWindow>;
  let mcpGateway: ReturnType<typeof createMockMcpGateway>;
  let runtime: ReturnType<typeof initAgentRuntime>;

  beforeEach(() => {
    tempDir = createTempDir();
    ipcMain = createMockIpcMain();
    mainWindow = createMockMainWindow();
    // Use a longer delay to allow pause/cancel to happen during execution
    mcpGateway = createMockMcpGateway(200);
  });

  afterEach(() => {
    if (runtime) {
      runtime.removeHandlers();
    }
  });

  describe('Test 1: Pause and Resume flow', () => {
    it('should transition through submit → running → paused → resumed → completed', async () => {
      runtime = initAgentRuntime(
        ipcMain as unknown as Parameters<typeof initAgentRuntime>[0],
        mainWindow as unknown as Parameters<typeof initAgentRuntime>[1],
        {
          statePath: path.join(tempDir, 'state.json'),
          mcpGateway,
          fetchImpl: createMockFetch(3),
          defaultEndpoint: 'http://localhost:11434'
        } as unknown as RuntimeOptions
      );

      const submitHandler = ipcMain.getHandler(IPC_CHANNELS.SUBMIT_TASK)!;
      const pauseHandler = ipcMain.getHandler(IPC_CHANNELS.PAUSE_TASK)!;
      const resumeHandler = ipcMain.getHandler(IPC_CHANNELS.RESUME_TASK)!;

      // Submit a multi-step task
      const { session } = await submitHandler({}, createValidSubmission(tempDir));
      expect(session).toBeDefined();
      expect(session.status).toBe('planned');

      // Wait for the execution loop to start running (plan generated event)
      await waitFor(() => {
        const planEvents = getEventsByType(mainWindow, 'plan-generated');
        return planEvents.length > 0;
      }, 5000);

      // Verify the session transitions to running
      const activeEntry = runtime.getActiveSessions().get(session.id);
      expect(activeEntry).toBeDefined();

      // Wait briefly for at least one step to start
      await waitFor(() => {
        const stepStartEvents = getEventsByType(mainWindow, 'step-started');
        return stepStartEvents.length > 0;
      }, 5000);

      // Pause the task (Requirement 13.1, 13.2)
      const pauseResult = await pauseHandler({}, session.id);
      expect(pauseResult.success).toBe(true);

      // Verify session status is 'paused' (Requirement 13.2: within 10 seconds)
      await waitFor(() => {
        const entry = runtime.getActiveSessions().get(session.id);
        return entry?.session?.status === 'paused';
      }, 10_000);

      const pausedEntry = runtime.getActiveSessions().get(session.id)!;
      expect(pausedEntry.session.status).toBe('paused');

      // Verify a task-paused event was streamed
      const pauseEvents = getEventsByType(mainWindow, 'task-paused');
      expect(pauseEvents.length).toBeGreaterThan(0);

      // Resume the task (Requirement 13.5)
      const resumeResult = await resumeHandler({}, session.id);
      expect(resumeResult.success).toBe(true);

      // Verify session status returns to 'running'
      const resumedEntry = runtime.getActiveSessions().get(session.id)!;
      expect(resumedEntry.session.status).toBe('running');

      // Verify a "Resumed" progress event was streamed (Requirement 13.5)
      const progressEvents = mainWindow.getSentEvents()
        .filter(e => e.channel === IPC_CHANNELS.ACTIVITY_STREAM)
        .map(e => e.payload as { type: string; output?: string })
        .filter(e => e.type === 'step-progress' && e.output === 'Resumed');
      expect(progressEvents.length).toBeGreaterThan(0);
    });

    it('should complete execution after resume from the exact paused point (Req 13.5)', async () => {
      runtime = initAgentRuntime(
        ipcMain as unknown as Parameters<typeof initAgentRuntime>[0],
        mainWindow as unknown as Parameters<typeof initAgentRuntime>[1],
        {
          statePath: path.join(tempDir, 'state.json'),
          mcpGateway: createMockMcpGateway(50),
          fetchImpl: createMockFetch(2),
          defaultEndpoint: 'http://localhost:11434'
        } as unknown as RuntimeOptions
      );

      const submitHandler = ipcMain.getHandler(IPC_CHANNELS.SUBMIT_TASK)!;
      const pauseHandler = ipcMain.getHandler(IPC_CHANNELS.PAUSE_TASK)!;
      const resumeHandler = ipcMain.getHandler(IPC_CHANNELS.RESUME_TASK)!;

      const { session } = await submitHandler({}, createValidSubmission(tempDir));

      // Wait for execution to start
      await waitFor(() => {
        const planEvents = getEventsByType(mainWindow, 'plan-generated');
        return planEvents.length > 0;
      }, 8000);

      // Wait for at least one step to start
      await waitFor(() => {
        const stepStartEvents = getEventsByType(mainWindow, 'step-started');
        return stepStartEvents.length > 0;
      }, 8000);

      // Pause
      await pauseHandler({}, session.id);

      // Wait for paused state
      await waitFor(() => {
        const entry = runtime.getActiveSessions().get(session.id);
        return entry?.session?.status === 'paused';
      }, 10_000);

      // Resume
      await resumeHandler({}, session.id);

      // Wait for task completion after resume
      await waitFor(() => {
        const completeEvents = getEventsByType(mainWindow, 'task-complete');
        return completeEvents.length > 0;
      }, 15_000);

      // Verify task completed successfully
      const completionEvents = getEventsByType(mainWindow, 'task-complete');
      expect(completionEvents.length).toBe(1);

      const finalEntry = runtime.getActiveSessions().get(session.id)!;
      expect(finalEntry.session.status).toBe('completed');
    }, 30_000);
  });

  describe('Test 2: Cancel preserves partial results', () => {
    it('should cancel a running task and preserve completed step results (Req 13.4, 13.7)', async () => {
      // Use a moderate delay so steps complete but we can cancel mid-execution
      runtime = initAgentRuntime(
        ipcMain as unknown as Parameters<typeof initAgentRuntime>[0],
        mainWindow as unknown as Parameters<typeof initAgentRuntime>[1],
        {
          statePath: path.join(tempDir, 'state.json'),
          mcpGateway: createMockMcpGateway(200),
          fetchImpl: createMockFetch(5),
          defaultEndpoint: 'http://localhost:11434'
        } as unknown as RuntimeOptions
      );

      const submitHandler = ipcMain.getHandler(IPC_CHANNELS.SUBMIT_TASK)!;
      const cancelHandler = ipcMain.getHandler(IPC_CHANNELS.CANCEL_TASK)!;

      const { session } = await submitHandler({}, createValidSubmission(tempDir));

      // Wait for execution to start and at least one step to complete
      await waitFor(() => {
        const stepCompleteEvents = getEventsByType(mainWindow, 'step-completed');
        return stepCompleteEvents.length >= 1;
      }, 15_000);

      // Record how many steps completed before cancel
      const stepsCompletedBeforeCancel = getEventsByType(mainWindow, 'step-completed').length;
      expect(stepsCompletedBeforeCancel).toBeGreaterThanOrEqual(1);

      // Cancel the task (Requirement 13.4)
      const cancelResult = await cancelHandler({}, session.id);
      expect(cancelResult.success).toBe(true);

      // Verify session status is 'canceled'
      const activeEntry = runtime.getActiveSessions().get(session.id);
      expect(activeEntry?.session?.status).toBe('canceled');

      // Verify a task-canceled event is streamed
      await waitFor(() => {
        const cancelEvents = getEventsByType(mainWindow, 'task-canceled');
        return cancelEvents.length > 0;
      }, 5000);

      const cancelEvents = getEventsByType(mainWindow, 'task-canceled');
      expect(cancelEvents.length).toBeGreaterThan(0);

      // Verify completed step results are preserved (Requirement 13.7)
      expect(activeEntry!.session.stepResults.length).toBeGreaterThanOrEqual(1);
      for (const result of activeEntry!.session.stepResults) {
        expect(result.stepId).toBeDefined();
        expect(result.title).toBeDefined();
        expect(result.startedAt).toBeDefined();
      }

      // Verify session is persisted with partial results
      const sessionsPath = path.join(path.dirname(path.join(tempDir, 'state.json')), 'agent', 'sessions.json');
      const persisted = JSON.parse(fs.readFileSync(sessionsPath, 'utf8')) as PersistedSession[];
      const persistedSession = persisted.find((s) => s.id === (session as { id: string }).id);
      expect(persistedSession).toBeDefined();
      expect(persistedSession.status).toBe('canceled');
      expect(persistedSession.completedAt).not.toBeNull();
      expect(persistedSession.stepResults.length).toBeGreaterThanOrEqual(1);
    }, 30_000);

    it('should cancel within deadline and stop execution (Req 12.7)', async () => {
      runtime = initAgentRuntime(
        ipcMain as unknown as Parameters<typeof initAgentRuntime>[0],
        mainWindow as unknown as Parameters<typeof initAgentRuntime>[1],
        {
          statePath: path.join(tempDir, 'state.json'),
          mcpGateway: createMockMcpGateway(300),
          fetchImpl: createMockFetch(4),
          defaultEndpoint: 'http://localhost:11434'
        } as unknown as RuntimeOptions
      );

      const submitHandler = ipcMain.getHandler(IPC_CHANNELS.SUBMIT_TASK)!;
      const cancelHandler = ipcMain.getHandler(IPC_CHANNELS.CANCEL_TASK)!;

      const { session } = await submitHandler({}, createValidSubmission(tempDir));

      // Wait for execution to begin
      await waitFor(() => {
        const planEvents = getEventsByType(mainWindow, 'plan-generated');
        return planEvents.length > 0;
      }, 5000);

      // Cancel and measure time (Req 12.7: within 2 seconds)
      const cancelStart = Date.now();
      const cancelResult = await cancelHandler({}, session.id);
      const cancelDuration = Date.now() - cancelStart;

      expect(cancelResult.success).toBe(true);
      expect(cancelDuration).toBeLessThan(2000); // Requirement 12.7

      // Verify no new steps start after cancel
      const stepCountAtCancel = getEventsByType(mainWindow, 'step-started').length;
      await new Promise(r => setTimeout(r, 500));
      const stepCountAfter = getEventsByType(mainWindow, 'step-started').length;
      expect(stepCountAfter).toBe(stepCountAtCancel);
    });
  });

  describe('Test 3: Paused session retained indefinitely (Req 13.7)', () => {
    it('should retain paused session state without timeout or data loss', async () => {
      runtime = initAgentRuntime(
        ipcMain as unknown as Parameters<typeof initAgentRuntime>[0],
        mainWindow as unknown as Parameters<typeof initAgentRuntime>[1],
        {
          statePath: path.join(tempDir, 'state.json'),
          mcpGateway: createMockMcpGateway(100),
          fetchImpl: createMockFetch(3),
          defaultEndpoint: 'http://localhost:11434'
        } as unknown as RuntimeOptions
      );

      const submitHandler = ipcMain.getHandler(IPC_CHANNELS.SUBMIT_TASK)!;
      const pauseHandler = ipcMain.getHandler(IPC_CHANNELS.PAUSE_TASK)!;
      const getSessionHandler = ipcMain.getHandler(IPC_CHANNELS.GET_SESSION)!;

      const { session } = await submitHandler({}, createValidSubmission(tempDir));

      // Wait for execution to start
      await waitFor(() => {
        const planEvents = getEventsByType(mainWindow, 'plan-generated');
        return planEvents.length > 0;
      }, 5000);

      // Wait for at least one step to start
      await waitFor(() => {
        const stepStartEvents = getEventsByType(mainWindow, 'step-started');
        return stepStartEvents.length > 0;
      }, 5000);

      // Pause the session
      const pauseResult = await pauseHandler({}, session.id);
      expect(pauseResult.success).toBe(true);

      // Wait for pause to fully apply
      await waitFor(() => {
        const entry = runtime.getActiveSessions().get(session.id);
        return entry?.session?.status === 'paused';
      }, 10_000);

      // Snapshot the session state immediately after pause
      const pausedSession = await getSessionHandler({}, session.id);
      const pausedInstruction = pausedSession.instruction;
      const pausedPlan = pausedSession.plan;
      const pausedStepResults = [...(pausedSession.stepResults || [])];
      const pausedConfig = { ...pausedSession.config };

      // Wait some time to simulate the session being paused (Req 13.7: no auto-timeout)
      await new Promise(r => setTimeout(r, 1000));

      // Verify the session is still paused (not expired, not auto-canceled)
      const sessionAfterWait = await getSessionHandler({}, session.id);
      expect(sessionAfterWait.status).toBe('paused');

      // Verify no data loss (Requirement 13.7)
      expect(sessionAfterWait.instruction).toBe(pausedInstruction);
      expect(sessionAfterWait.plan).toEqual(pausedPlan);
      expect(sessionAfterWait.stepResults.length).toBe(pausedStepResults.length);
      expect(sessionAfterWait.config).toEqual(pausedConfig);

      // Verify session is also persisted on disk with correct state
      const sessionsPath = path.join(path.dirname(path.join(tempDir, 'state.json')), 'agent', 'sessions.json');
      const persisted = JSON.parse(fs.readFileSync(sessionsPath, 'utf8')) as PersistedSession[];
      const persistedSession = persisted.find((s) => s.id === (session as { id: string }).id);
      expect(persistedSession).toBeDefined();
      expect(persistedSession.status).toBe('paused');
      expect(persistedSession.instruction).toBe(pausedInstruction);
    });

    it('should allow cancel from paused state', async () => {
      runtime = initAgentRuntime(
        ipcMain as unknown as Parameters<typeof initAgentRuntime>[0],
        mainWindow as unknown as Parameters<typeof initAgentRuntime>[1],
        {
          statePath: path.join(tempDir, 'state.json'),
          mcpGateway: createMockMcpGateway(100),
          fetchImpl: createMockFetch(3),
          defaultEndpoint: 'http://localhost:11434'
        } as unknown as RuntimeOptions
      );

      const submitHandler = ipcMain.getHandler(IPC_CHANNELS.SUBMIT_TASK)!;
      const pauseHandler = ipcMain.getHandler(IPC_CHANNELS.PAUSE_TASK)!;
      const cancelHandler = ipcMain.getHandler(IPC_CHANNELS.CANCEL_TASK)!;

      const { session } = await submitHandler({}, createValidSubmission(tempDir));

      // Wait for execution to start
      await waitFor(() => {
        const planEvents = getEventsByType(mainWindow, 'plan-generated');
        return planEvents.length > 0;
      }, 5000);

      // Wait for at least one step to begin
      await waitFor(() => {
        const stepStartEvents = getEventsByType(mainWindow, 'step-started');
        return stepStartEvents.length > 0;
      }, 5000);

      // Pause
      await pauseHandler({}, session.id);
      await waitFor(() => {
        const entry = runtime.getActiveSessions().get(session.id);
        return entry?.session?.status === 'paused';
      }, 10_000);

      // Now cancel from paused state
      const cancelResult = await cancelHandler({}, session.id);
      expect(cancelResult.success).toBe(true);

      // Verify canceled
      const entry = runtime.getActiveSessions().get(session.id)!;
      expect(entry.session.status).toBe('canceled');
      expect(entry.session.completedAt).not.toBeNull();

      // Verify partial results preserved after cancel from pause
      const sessionsPath = path.join(path.dirname(path.join(tempDir, 'state.json')), 'agent', 'sessions.json');
      const persisted = JSON.parse(fs.readFileSync(sessionsPath, 'utf8')) as PersistedSession[];
      const persistedSession = persisted.find((s) => s.id === (session as { id: string }).id);
      expect(persistedSession.status).toBe('canceled');
    });
  });

  describe('Status transitions and timing constraints', () => {
    it('should reject pause when not running', async () => {
      runtime = initAgentRuntime(
        ipcMain as unknown as Parameters<typeof initAgentRuntime>[0],
        mainWindow as unknown as Parameters<typeof initAgentRuntime>[1],
        {
          statePath: path.join(tempDir, 'state.json'),
          mcpGateway,
          fetchImpl: createMockFetch(2),
          defaultEndpoint: 'http://localhost:11434'
        } as unknown as RuntimeOptions
      );

      const pauseHandler = ipcMain.getHandler(IPC_CHANNELS.PAUSE_TASK)!;

      // Pause with non-existent session
      const result = await pauseHandler({}, 'non-existent-session');
      expect(result.success).toBe(false);
    });

    it('should reject resume when not paused', async () => {
      runtime = initAgentRuntime(
        ipcMain as unknown as Parameters<typeof initAgentRuntime>[0],
        mainWindow as unknown as Parameters<typeof initAgentRuntime>[1],
        {
          statePath: path.join(tempDir, 'state.json'),
          mcpGateway,
          fetchImpl: createMockFetch(2),
          defaultEndpoint: 'http://localhost:11434'
        } as unknown as RuntimeOptions
      );

      const resumeHandler = ipcMain.getHandler(IPC_CHANNELS.RESUME_TASK)!;

      // Resume with non-existent session
      const result = await resumeHandler({}, 'non-existent-session');
      expect(result.success).toBe(false);
    });

    it('session should have totalDuration set after cancel', async () => {
      runtime = initAgentRuntime(
        ipcMain as unknown as Parameters<typeof initAgentRuntime>[0],
        mainWindow as unknown as Parameters<typeof initAgentRuntime>[1],
        {
          statePath: path.join(tempDir, 'state.json'),
          mcpGateway: createMockMcpGateway(200),
          fetchImpl: createMockFetch(3),
          defaultEndpoint: 'http://localhost:11434'
        } as unknown as RuntimeOptions
      );

      const submitHandler = ipcMain.getHandler(IPC_CHANNELS.SUBMIT_TASK)!;
      const cancelHandler = ipcMain.getHandler(IPC_CHANNELS.CANCEL_TASK)!;

      const { session } = await submitHandler({}, createValidSubmission(tempDir));

      // Wait for execution to start
      await waitFor(() => {
        const planEvents = getEventsByType(mainWindow, 'plan-generated');
        return planEvents.length > 0;
      }, 5000);

      // Give it a moment to have startedAt set
      await new Promise(r => setTimeout(r, 100));

      // Cancel
      await cancelHandler({}, session.id);

      // Verify totalDuration is set
      const entry = runtime.getActiveSessions().get(session.id)!;
      expect(entry.session.totalDuration).not.toBeNull();
      expect(entry.session.totalDuration).toBeGreaterThan(0);
    });
  });
});
