/**
 * Integration Test: Full Task Lifecycle
 *
 * Tests the complete agent runtime lifecycle:
 * submit → plan → execute → complete
 *
 * Validates: Requirements 1.3, 2.1, 3.4, 9.1, 9.5
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initAgentRuntime, IPC_CHANNELS } from '../../../electron/runtime/agent/agentRuntime.js';

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-agent-lifecycle-'));
  tempDirs.push(dir);
  return dir;
}

/**
 * Creates a mock ipcMain that captures registered handlers.
 */
function createMockIpcMain() {
  const handlers = new Map<string, Function>();
  return {
    handle(channel: string, handler: Function) {
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
 * Creates a mock BrowserWindow with webContents.send that captures streamed events.
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
    getEventsByType(type: string) {
      return sentEvents
        .filter(e => e.channel === IPC_CHANNELS.ACTIVITY_STREAM)
        .filter(e => (e.payload as any)?.type === type);
    }
  };
}

/**
 * Creates a mock MCP gateway that returns success for all tool calls.
 */
function createMockMcpGateway() {
  const calls: Array<{ server: string; action: string; payload: unknown }> = [];
  return {
    dispatch: async (request: { server: string; action: string; payload?: unknown }) => {
      calls.push({ server: request.server, action: request.action, payload: request.payload });
      return { success: true, output: `Completed: ${request.action}` };
    },
    getCalls: () => calls
  };
}

/**
 * Creates a mock fetch implementation that returns a plan with the specified steps.
 * The plan mimics the Ollama chat API response: { message: { content: JSON.stringify(plan) } }
 */
function createMockFetch(plan: object) {
  return async (_url: string, _options?: any) => {
    return new Response(JSON.stringify({
      message: {
        content: JSON.stringify(plan)
      }
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };
}

/**
 * A simple plan with 2 steps for testing the full lifecycle.
 */
function createSimplePlan() {
  return {
    steps: [
      {
        id: 'step-1',
        title: 'Read project configuration',
        description: 'Read the package.json file to understand project structure',
        riskLevel: 'low',
        requiredTools: [{ name: 'folder', category: 'folder', server: 'folder-server' }],
        parallelSafe: false,
        timeout: 30000,
        dependsOn: []
      },
      {
        id: 'step-2',
        title: 'Create hello world file',
        description: 'Write a hello world file to the working directory',
        riskLevel: 'low',
        requiredTools: [{ name: 'folder', category: 'folder', server: 'folder-server' }],
        parallelSafe: false,
        timeout: 30000,
        dependsOn: ['step-1']
      }
    ],
    estimatedDuration: 60000,
    reasoning: 'Simple two-step plan to create a hello world file.'
  };
}

/**
 * Waits for a condition to become true, polling at intervals.
 */
async function waitFor(
  conditionFn: () => boolean,
  { timeout = 10000, interval = 50 } = {}
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (conditionFn()) return;
    await new Promise(r => setTimeout(r, interval));
  }
  throw new Error(`waitFor timed out after ${timeout}ms`);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Integration: Full Task Lifecycle', () => {
  let tempDir: string;
  let ipcMain: ReturnType<typeof createMockIpcMain>;
  let mainWindow: ReturnType<typeof createMockMainWindow>;
  let mcpGateway: ReturnType<typeof createMockMcpGateway>;
  let runtime: ReturnType<typeof initAgentRuntime>;

  beforeEach(() => {
    tempDir = createTempDir();
    ipcMain = createMockIpcMain();
    mainWindow = createMockMainWindow();
    mcpGateway = createMockMcpGateway();
  });

  afterEach(() => {
    if (runtime) {
      runtime.removeHandlers();
    }
  });

  it('completes the full submit → plan → execute → complete lifecycle', async () => {
    const plan = createSimplePlan();
    const mockFetch = createMockFetch(plan);

    runtime = initAgentRuntime(ipcMain as any, mainWindow as any, {
      statePath: path.join(tempDir, 'state.json'),
      mcpGateway,
      fetchImpl: mockFetch,
      defaultEndpoint: 'http://localhost:11434'
    });

    // ─── Step 1: Submit task ─────────────────────────────────────────────────

    const submitHandler = ipcMain.getHandler(IPC_CHANNELS.SUBMIT_TASK)!;
    const beforeSubmit = Date.now();

    const result = await submitHandler({}, {
      instruction: 'Create a hello world file in the working directory',
      workingDirectory: tempDir,
      modelId: 'llama3',
      endpoint: 'http://localhost:11434',
      attachments: []
    });

    const afterSubmit = Date.now();

    // ─── Verify: Session created and persisted within 1 second (Req 1.3) ────

    expect(result.success).toBe(true);
    expect(result.session).toBeDefined();
    expect(result.session.id).toBeDefined();
    expect(result.session.instruction).toBe('Create a hello world file in the working directory');
    expect(result.session.status).toBe('planned');
    expect(result.session.workingDirectory).toBe(tempDir);
    expect(result.session.modelId).toBe('llama3');

    // Session must be persisted within 1 second
    expect(afterSubmit - beforeSubmit).toBeLessThan(1000);

    // Verify session is persisted on disk
    const sessionsPath = path.join(path.dirname(path.join(tempDir, 'state.json')), 'agent', 'sessions.json');
    expect(fs.existsSync(sessionsPath)).toBe(true);
    const persistedSessions = JSON.parse(fs.readFileSync(sessionsPath, 'utf8'));
    expect(persistedSessions.length).toBe(1);
    expect(persistedSessions[0].id).toBe(result.session.id);

    // ─── Step 2: Wait for execution to complete ──────────────────────────────
    // The runtime starts execution asynchronously via setImmediate.
    // Wait for the session to reach 'completed' status.

    const sessionId = result.session.id;

    await waitFor(() => {
      const sessions = JSON.parse(fs.readFileSync(sessionsPath, 'utf8'));
      const session = sessions.find((s: any) => s.id === sessionId);
      return session?.status === 'completed';
    }, { timeout: 15000, interval: 100 });

    // ─── Verify: Plan was generated (Req 2.1) ───────────────────────────────

    const planEvents = mainWindow.getEventsByType('plan-generated');
    expect(planEvents.length).toBeGreaterThanOrEqual(1);

    const planEvent = planEvents[0].payload as any;
    expect(planEvent.plan).toBeDefined();
    expect(planEvent.plan.steps).toBeDefined();
    expect(planEvent.plan.steps.length).toBe(2);
    expect(planEvent.plan.steps[0].title).toBe('Read project configuration');
    expect(planEvent.plan.steps[1].title).toBe('Create hello world file');

    // ─── Verify: Session reaches completed status (Req 3.4) ──────────────────

    const completedSessions = JSON.parse(fs.readFileSync(sessionsPath, 'utf8'));
    const completedSession = completedSessions.find((s: any) => s.id === sessionId);

    expect(completedSession).toBeDefined();
    expect(completedSession.status).toBe('completed');
    expect(completedSession.completedAt).not.toBeNull();
    expect(completedSession.plan).not.toBeNull();
    expect(completedSession.plan.steps.length).toBe(2);

    // ─── Verify: Step results are persisted (Req 9.1) ────────────────────────

    expect(completedSession.stepResults).toBeDefined();
    expect(completedSession.stepResults.length).toBe(2);

    for (const stepResult of completedSession.stepResults) {
      expect(stepResult.stepId).toBeDefined();
      expect(stepResult.title).toBeDefined();
      expect(stepResult.status).toBe('completed');
      expect(stepResult.startedAt).toBeDefined();
      expect(stepResult.completedAt).toBeDefined();
      expect(stepResult.duration).toBeGreaterThanOrEqual(0);
    }

    // ─── Verify: Events were streamed to mainWindow (activity stream) ────────

    const allStreamEvents = mainWindow.getSentEvents()
      .filter(e => e.channel === IPC_CHANNELS.ACTIVITY_STREAM);

    // Should have plan-generated, step-started, step-completed events, and task-complete
    const stepStartEvents = mainWindow.getEventsByType('step-started');
    const stepCompleteEvents = mainWindow.getEventsByType('step-completed');
    const taskCompleteEvents = mainWindow.getEventsByType('task-complete');

    expect(stepStartEvents.length).toBe(2);
    expect(stepCompleteEvents.length).toBe(2);
    expect(taskCompleteEvents.length).toBe(1);

    // ─── Verify: Final summary contains artifact count (Req 9.5) ─────────────

    const taskCompletePayload = taskCompleteEvents[0].payload as any;
    expect(taskCompletePayload.summary).toBeDefined();
    expect(taskCompletePayload.summary.sessionId).toBe(sessionId);
    expect(taskCompletePayload.summary.status).toBe('completed');
    expect(taskCompletePayload.summary.stepsCompleted).toBe(2);
    expect(taskCompletePayload.summary.stepsTotal).toBe(2);
    expect(typeof taskCompletePayload.summary.artifactCount).toBe('number');
    expect(taskCompletePayload.summary.totalDuration).toBeGreaterThan(0);
    expect(taskCompletePayload.summary.completedAt).toBeDefined();
  });

  it('persists session with complete config snapshot at submission time', async () => {
    const plan = createSimplePlan();
    const mockFetch = createMockFetch(plan);

    runtime = initAgentRuntime(ipcMain as any, mainWindow as any, {
      statePath: path.join(tempDir, 'state.json'),
      mcpGateway,
      fetchImpl: mockFetch,
      defaultEndpoint: 'http://localhost:11434'
    });

    const submitHandler = ipcMain.getHandler(IPC_CHANNELS.SUBMIT_TASK)!;
    const result = await submitHandler({}, {
      instruction: 'Run unit tests for the project',
      workingDirectory: tempDir,
      modelId: 'llama3',
      endpoint: 'http://localhost:11434',
      attachments: []
    });

    expect(result.success).toBe(true);

    // Verify config snapshot is included in the session
    expect(result.session.config).toBeDefined();
    expect(result.session.config.stepTimeout).toBe(120);
    expect(result.session.config.taskTimeout).toBe(900);
    expect(result.session.config.retryCount).toBe(3);
    expect(result.session.config.autoApprovalLowRisk).toBe(false);
  });

  it('MCP gateway receives correct tool dispatch calls during execution', async () => {
    const plan = createSimplePlan();
    const mockFetch = createMockFetch(plan);

    runtime = initAgentRuntime(ipcMain as any, mainWindow as any, {
      statePath: path.join(tempDir, 'state.json'),
      mcpGateway,
      fetchImpl: mockFetch,
      defaultEndpoint: 'http://localhost:11434'
    });

    const submitHandler = ipcMain.getHandler(IPC_CHANNELS.SUBMIT_TASK)!;
    const result = await submitHandler({}, {
      instruction: 'Create a hello world file',
      workingDirectory: tempDir,
      modelId: 'llama3',
      endpoint: 'http://localhost:11434',
      attachments: []
    });

    const sessionId = result.session.id;
    const sessionsPath = path.join(path.dirname(path.join(tempDir, 'state.json')), 'agent', 'sessions.json');

    // Wait for execution to complete
    await waitFor(() => {
      const sessions = JSON.parse(fs.readFileSync(sessionsPath, 'utf8'));
      const session = sessions.find((s: any) => s.id === sessionId);
      return session?.status === 'completed';
    }, { timeout: 15000, interval: 100 });

    // Verify MCP gateway was called for each step's tool
    const calls = mcpGateway.getCalls();
    expect(calls.length).toBe(2);
    expect(calls[0].server).toBe('folder-server');
    expect(calls[1].server).toBe('folder-server');
  });

  it('session is retrievable via get-session handler after completion', async () => {
    const plan = createSimplePlan();
    const mockFetch = createMockFetch(plan);

    runtime = initAgentRuntime(ipcMain as any, mainWindow as any, {
      statePath: path.join(tempDir, 'state.json'),
      mcpGateway,
      fetchImpl: mockFetch,
      defaultEndpoint: 'http://localhost:11434'
    });

    const submitHandler = ipcMain.getHandler(IPC_CHANNELS.SUBMIT_TASK)!;
    const result = await submitHandler({}, {
      instruction: 'Retrieve session test',
      workingDirectory: tempDir,
      modelId: 'llama3',
      endpoint: 'http://localhost:11434',
      attachments: []
    });

    const sessionId = result.session.id;
    const sessionsPath = path.join(path.dirname(path.join(tempDir, 'state.json')), 'agent', 'sessions.json');

    // Wait for completion
    await waitFor(() => {
      const sessions = JSON.parse(fs.readFileSync(sessionsPath, 'utf8'));
      const session = sessions.find((s: any) => s.id === sessionId);
      return session?.status === 'completed';
    }, { timeout: 15000, interval: 100 });

    // Retrieve via get-session handler
    const getSessionHandler = ipcMain.getHandler(IPC_CHANNELS.GET_SESSION)!;
    const retrieved = await getSessionHandler({}, sessionId);

    expect(retrieved).not.toBeNull();
    expect(retrieved.id).toBe(sessionId);
    expect(retrieved.instruction).toBe('Retrieve session test');
    expect(retrieved.status).toBe('completed');
    expect(retrieved.stepResults.length).toBe(2);
    expect(retrieved.plan).not.toBeNull();
  });

  it('list-sessions shows completed sessions in reverse chronological order', async () => {
    const plan = createSimplePlan();
    const mockFetch = createMockFetch(plan);

    runtime = initAgentRuntime(ipcMain as any, mainWindow as any, {
      statePath: path.join(tempDir, 'state.json'),
      mcpGateway,
      fetchImpl: mockFetch,
      defaultEndpoint: 'http://localhost:11434'
    });

    const submitHandler = ipcMain.getHandler(IPC_CHANNELS.SUBMIT_TASK)!;
    const sessionsPath = path.join(path.dirname(path.join(tempDir, 'state.json')), 'agent', 'sessions.json');

    // Submit first task
    const result1 = await submitHandler({}, {
      instruction: 'First task',
      workingDirectory: tempDir,
      modelId: 'llama3',
      endpoint: 'http://localhost:11434',
      attachments: []
    });

    // Wait for first to complete
    await waitFor(() => {
      const sessions = JSON.parse(fs.readFileSync(sessionsPath, 'utf8'));
      const session = sessions.find((s: any) => s.id === result1.session.id);
      return session?.status === 'completed';
    }, { timeout: 15000, interval: 100 });

    // Small delay to ensure different timestamps
    await new Promise(r => setTimeout(r, 50));

    // Submit second task
    const result2 = await submitHandler({}, {
      instruction: 'Second task',
      workingDirectory: tempDir,
      modelId: 'llama3',
      endpoint: 'http://localhost:11434',
      attachments: []
    });

    // Wait for second to complete
    await waitFor(() => {
      const sessions = JSON.parse(fs.readFileSync(sessionsPath, 'utf8'));
      const session = sessions.find((s: any) => s.id === result2.session.id);
      return session?.status === 'completed';
    }, { timeout: 15000, interval: 100 });

    // List sessions
    const listHandler = ipcMain.getHandler(IPC_CHANNELS.LIST_SESSIONS)!;
    const listResult = await listHandler({}, {});

    expect(listResult.total).toBe(2);
    expect(listResult.items.length).toBe(2);
    // Most recent first (reverse chronological)
    expect(listResult.items[0].instruction).toBe('Second task');
    expect(listResult.items[1].instruction).toBe('First task');
  });
});
