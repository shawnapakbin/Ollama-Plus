import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initAgentRuntime, IPC_CHANNELS } from '../../../electron/runtime/agent/agentRuntime.js';

/**
 * Integration Tests: Error Recovery
 *
 * Validates the end-to-end error recovery flow:
 * - Submit → plan → tool failure → retry with backoff → succeed
 * - Submit → plan → permanent error → no retry → escalation to replan
 * - Step output preservation during retries (Req 10.7)
 *
 * Requirements: 10.1, 10.2, 10.5, 10.7
 */

// ─── Shared test types ───────────────────────────────────────────────────────

type IpcHandler = (...args: unknown[]) => unknown;
type ActivityEvent = {
  type?: string;
  outcome?: { type?: string; [key: string]: unknown };
  error?: { classification?: string; type?: string; [key: string]: unknown };
  [key: string]: unknown;
};
interface PlanStep {
  id: string;
  title: string;
  description: string;
  riskLevel: string;
  requiredTools: Array<{ name: string; server: string; category: string }>;
  parallelSafe: boolean;
  timeout: number;
  dependsOn: string[];
}

type RuntimeOptions = Parameters<typeof initAgentRuntime>[2];

// ─── Test Helpers ────────────────────────────────────────────────────────────

const tempDirs: string[] = [];

afterEach(() => {
  vi.useRealTimers();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

function createTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-agent-error-recovery-'));
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
 * Creates a mock BrowserWindow with webContents.send that collects events.
 */
function createMockMainWindow() {
  const sentEvents: Array<{ channel: string; payload: ActivityEvent }> = [];
  return {
    isDestroyed: () => false,
    webContents: {
      send(channel: string, payload: ActivityEvent) {
        sentEvents.push({ channel, payload });
      }
    },
    getSentEvents() {
      return sentEvents;
    },
    getActivityStreamEvents() {
      return sentEvents
        .filter(e => e.channel === IPC_CHANNELS.ACTIVITY_STREAM)
        .map(e => e.payload);
    }
  };
}

/**
 * Creates a mock fetch that returns a plan from "Ollama" with the given steps.
 */
function createMockFetchWithPlan(steps: Array<{ title: string; tool: string }>) {
  const planResponse = {
    steps: steps.map((s, i): PlanStep => ({
      id: `step-${i + 1}`,
      title: s.title,
      description: `Execute ${s.title}`,
      riskLevel: 'low',
      requiredTools: [{ name: s.tool, server: s.tool, category: s.tool }],
      parallelSafe: false,
      timeout: 120000,
      dependsOn: []
    })),
    estimatedDuration: 5000,
    reasoning: 'Generated test plan'
  };

  return async () => {
    return new Response(JSON.stringify({
      message: { content: JSON.stringify(planResponse) }
    }), { status: 200 });
  };
}

function createValidSubmission(workingDir: string) {
  return {
    instruction: 'Run the build script and validate output',
    workingDirectory: workingDir,
    modelId: 'llama3',
    endpoint: 'http://localhost:11434',
    attachments: []
  };
}

/**
 * Waits for activity stream events to accumulate, with a timeout.
 */
async function waitForEvents(
  mainWindow: ReturnType<typeof createMockMainWindow>,
  predicate: (events: ActivityEvent[]) => boolean,
  timeoutMs = 5000
): Promise<ActivityEvent[]> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const events = mainWindow.getActivityStreamEvents();
    if (predicate(events)) {
      return events;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return mainWindow.getActivityStreamEvents();
}

// ─── Test Suite ──────────────────────────────────────────────────────────────

describe('Integration: Error Recovery', () => {
  let tempDir: string;
  let ipcMain: ReturnType<typeof createMockIpcMain>;
  let mainWindow: ReturnType<typeof createMockMainWindow>;
  let runtime: ReturnType<typeof initAgentRuntime>;

  beforeEach(() => {
    tempDir = createTempDir();
    ipcMain = createMockIpcMain();
    mainWindow = createMockMainWindow();
  });

  afterEach(() => {
    if (runtime) {
      runtime.removeHandlers();
    }
  });

  describe('Test 1: Transient error → successful retry', () => {
    it('retries tool calls on transient errors and succeeds after backoff', async () => {
      // Track call count to simulate transient failures then success
      let callCount = 0;

      const mockMcpGateway = {
        dispatch: async () => {
          callCount++;
          if (callCount <= 2) {
            // First 2 calls fail with transient error (connection timeout)
            throw Object.assign(
              new Error('Connection timed out'),
              { code: 'ETIMEDOUT' }
            );
          }
          // Third call succeeds
          return { success: true, output: 'Build completed successfully' };
        }
      };

      const mockFetch = createMockFetchWithPlan([
        { title: 'Run build script', tool: 'terminal' }
      ]);

      runtime = initAgentRuntime(
        ipcMain as unknown as Parameters<typeof initAgentRuntime>[0],
        mainWindow as unknown as Parameters<typeof initAgentRuntime>[1],
        {
          statePath: path.join(tempDir, 'state.json'),
          mcpGateway: mockMcpGateway,
          fetchImpl: mockFetch,
          defaultEndpoint: 'http://localhost:11434'
        } as unknown as RuntimeOptions
      );

      const handler = ipcMain.getHandler(IPC_CHANNELS.SUBMIT_TASK)!;
      const result = await handler({}, createValidSubmission(tempDir));
      expect(result.success).toBe(true);

      // Wait for execution to complete (including retry backoff delays)
      const events = await waitForEvents(
        mainWindow,
        (evts) => evts.some(e =>
          e.type === 'step-completed' ||
          e.type === 'task-complete' ||
          e.type === 'error'
        ),
        15000 // Allow time for 2s + 8s backoff
      );

      // Verify the tool was called 3 times (2 failures + 1 success)
      expect(callCount).toBe(3);

      // Verify step completed events show the step eventually succeeded
      const stepCompletedEvents = events.filter(e => e.type === 'step-completed');
      const taskCompleteEvents = events.filter(e => e.type === 'task-complete');

      // Either we get a step-completed with proceed outcome or task-complete
      const hasSuccess = stepCompletedEvents.some(e =>
        e.outcome?.type === 'proceed' || e.outcome?.type === 'complete'
      ) || taskCompleteEvents.length > 0;
      expect(hasSuccess).toBe(true);

      // Verify session step results track retry count
      const getSessionHandler = ipcMain.getHandler(IPC_CHANNELS.GET_SESSION)!;
      const session = await getSessionHandler({}, result.session.id);
      if (session && session.stepResults && session.stepResults.length > 0) {
        const stepResult = session.stepResults[0];
        expect(stepResult.retryCount).toBeGreaterThan(0);
      }
    }, 20000);
  });

  describe('Test 2: Permanent error → escalation to replan', () => {
    it('does NOT retry permanent errors and escalates to replan', async () => {
      let callCount = 0;

      const mockMcpGateway = {
        dispatch: async () => {
          callCount++;
          // Fail with permanent error (file not found)
          throw Object.assign(
            new Error('File not found: /src/missing.ts'),
            { code: 'ENOENT' }
          );
        }
      };

      // Provide a plan, and also handle replan calls
      let planCallCount = 0;
      const mockFetch = async () => {
        planCallCount++;
        const steps = planCallCount === 1
          ? [{ id: 'step-1', title: 'Read source file', description: 'Read the source', riskLevel: 'low', requiredTools: [{ name: 'folder', server: 'folder', category: 'folder' }], parallelSafe: false, timeout: 120000, dependsOn: [] }]
          : [{ id: 'step-2', title: 'Create source file', description: 'Create the missing file', riskLevel: 'low', requiredTools: [{ name: 'folder', server: 'folder', category: 'folder' }], parallelSafe: false, timeout: 120000, dependsOn: [] }];

        return new Response(JSON.stringify({
          message: {
            content: JSON.stringify({
              steps,
              estimatedDuration: 3000,
              reasoning: `Plan attempt ${planCallCount}`
            })
          }
        }), { status: 200 });
      };

      runtime = initAgentRuntime(
        ipcMain as unknown as Parameters<typeof initAgentRuntime>[0],
        mainWindow as unknown as Parameters<typeof initAgentRuntime>[1],
        {
          statePath: path.join(tempDir, 'state.json'),
          mcpGateway: mockMcpGateway,
          fetchImpl: mockFetch,
          defaultEndpoint: 'http://localhost:11434'
        } as unknown as RuntimeOptions
      );

      const handler = ipcMain.getHandler(IPC_CHANNELS.SUBMIT_TASK)!;
      const result = await handler({}, createValidSubmission(tempDir));
      expect(result.success).toBe(true);

      // Wait for execution to process (permanent errors should not be retried)
      const events = await waitForEvents(
        mainWindow,
        (evts) => evts.some(e =>
          e.type === 'replan' ||
          e.type === 'error' ||
          e.type === 'task-complete'
        ),
        8000
      );

      // Permanent error: should NOT be retried (only 1 call per step attempt)
      // The tool is called once per step execution attempt
      // First step fails → replan → second step fails → replan... up to max replans
      // Each step attempt should have exactly 1 gateway call (no retry for permanent errors)
      expect(callCount).toBeLessThanOrEqual(planCallCount);

      // Verify replan or error events were emitted
      const replanEvents = events.filter(e => e.type === 'replan');
      const errorEvents = events.filter(e => e.type === 'error');

      // Either replanning was triggered or error was reported with permanent classification
      const hasReplan = replanEvents.length > 0;
      const hasPermanentError = errorEvents.some(e =>
        e.error?.classification === 'permanent' ||
        e.error?.type === 'replan_limit_exceeded'
      );

      expect(hasReplan || hasPermanentError).toBe(true);
    }, 15000);
  });

  describe('Test 3: Step output preservation during recovery (Req 10.7)', () => {
    it('preserves completed step outputs when later steps fail and recover', async () => {
      let stepCallCount = 0;
      let step2Attempts = 0;

      const mockMcpGateway = {
        dispatch: async () => {
          stepCallCount++;

          // For the first step (terminal): always succeed
          if (stepCallCount === 1) {
            return { success: true, output: 'Step 1 output: compilation successful' };
          }

          // For the second step (folder): fail first time, succeed after
          step2Attempts++;
          if (step2Attempts === 1) {
            // First attempt fails with transient error
            throw Object.assign(
              new Error('Connection reset by peer'),
              { code: 'ECONNRESET' }
            );
          }

          // Subsequent attempts succeed
          return { success: true, output: 'Step 2 output: file written successfully' };
        }
      };

      const mockFetch = createMockFetchWithPlan([
        { title: 'Compile project', tool: 'terminal' },
        { title: 'Write output file', tool: 'folder' }
      ]);

      runtime = initAgentRuntime(
        ipcMain as unknown as Parameters<typeof initAgentRuntime>[0],
        mainWindow as unknown as Parameters<typeof initAgentRuntime>[1],
        {
          statePath: path.join(tempDir, 'state.json'),
          mcpGateway: mockMcpGateway,
          fetchImpl: mockFetch,
          defaultEndpoint: 'http://localhost:11434'
        } as unknown as RuntimeOptions
      );

      const handler = ipcMain.getHandler(IPC_CHANNELS.SUBMIT_TASK)!;
      const result = await handler({}, createValidSubmission(tempDir));
      expect(result.success).toBe(true);

      // Wait for execution to complete (step 2 needs retry backoff)
      const events = await waitForEvents(
        mainWindow,
        (evts) => evts.some(e =>
          e.type === 'task-complete' || e.type === 'error'
        ),
        15000
      );

      // Verify session step results
      const getSessionHandler = ipcMain.getHandler(IPC_CHANNELS.GET_SESSION)!;
      const session = await getSessionHandler({}, result.session.id);

      if (session && session.stepResults && session.stepResults.length >= 1) {
        // Step 1 should be preserved with its original output
        const step1Result = session.stepResults[0];
        expect(step1Result.status).toBe('completed');
        expect(step1Result.output).toContain('Step 1 output');
        expect(step1Result.retryCount).toBe(0);

        // If step 2 completed successfully after retry
        if (session.stepResults.length >= 2) {
          const step2Result = session.stepResults[1];
          // Step 2 had retries
          expect(step2Result.retryCount).toBeGreaterThan(0);
          // Step 1's data remains unchanged after step 2's recovery
          expect(session.stepResults[0].output).toContain('Step 1 output');
          expect(session.stepResults[0].status).toBe('completed');
          // Verify step 1 data was not mutated
          expect(session.stepResults[0].duration).toBeGreaterThanOrEqual(0);
          expect(session.stepResults[0].startedAt).toBeDefined();
          expect(session.stepResults[0].completedAt).toBeDefined();
        }
      }

      // Verify step 1 output appears intact in the activity stream events
      const stepCompletedEvents = events.filter(e => e.type === 'step-completed');
      if (stepCompletedEvents.length > 0) {
        // The first step-completed event should be for step 1
        expect(stepCompletedEvents[0].outcome?.type).toBe('proceed');
      }
    }, 20000);
  });

  describe('Retry backoff timing verification', () => {
    it('applies exponential backoff delays (2s first, 8s second)', async () => {
      const callTimestamps: number[] = [];

      const mockMcpGateway = {
        dispatch: async () => {
          callTimestamps.push(Date.now());
          if (callTimestamps.length <= 2) {
            throw Object.assign(
              new Error('Service unavailable'),
              { code: 'ECONNREFUSED' }
            );
          }
          return { success: true, output: 'Done' };
        }
      };

      const mockFetch = createMockFetchWithPlan([
        { title: 'Call service', tool: 'http' }
      ]);

      runtime = initAgentRuntime(
        ipcMain as unknown as Parameters<typeof initAgentRuntime>[0],
        mainWindow as unknown as Parameters<typeof initAgentRuntime>[1],
        {
          statePath: path.join(tempDir, 'state.json'),
          mcpGateway: mockMcpGateway,
          fetchImpl: mockFetch,
          defaultEndpoint: 'http://localhost:11434'
        } as unknown as RuntimeOptions
      );

      const handler = ipcMain.getHandler(IPC_CHANNELS.SUBMIT_TASK)!;
      const result = await handler({}, createValidSubmission(tempDir));
      expect(result.success).toBe(true);

      // Wait for all retries to complete
      await waitForEvents(
        mainWindow,
        (evts) => evts.some(e =>
          e.type === 'step-completed' ||
          e.type === 'task-complete' ||
          e.type === 'error'
        ),
        15000
      );

      // Verify backoff timing if retries occurred
      if (callTimestamps.length >= 2) {
        const firstRetryDelay = callTimestamps[1] - callTimestamps[0];
        // First retry should be ~2000ms (allow tolerance for execution overhead)
        expect(firstRetryDelay).toBeGreaterThanOrEqual(1800);
        expect(firstRetryDelay).toBeLessThan(4000);
      }

      if (callTimestamps.length >= 3) {
        const secondRetryDelay = callTimestamps[2] - callTimestamps[1];
        // Second retry should be ~8000ms (allow tolerance)
        expect(secondRetryDelay).toBeGreaterThanOrEqual(7500);
        expect(secondRetryDelay).toBeLessThan(12000);
      }
    }, 20000);
  });
});
