import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initAgentRuntime, IPC_CHANNELS } from '../electron/runtime/agent/agentRuntime.js';

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-agent-runtime-'));
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
 * Creates a mock BrowserWindow with webContents.send.
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
    }
  };
}

/**
 * Creates a mock MCP gateway.
 */
function createMockMcpGateway() {
  const calls: Array<{ server: string; action: string; payload: unknown }> = [];
  return {
    dispatch: async (request: { server: string; action: string; payload?: unknown }) => {
      calls.push({ server: request.server, action: request.action, payload: request.payload });
      return { success: true, output: 'mock output' };
    },
    getCalls: () => calls
  };
}

function createValidSubmission(workingDir: string) {
  return {
    instruction: 'Create a hello world file',
    workingDirectory: workingDir,
    modelId: 'llama3',
    endpoint: 'http://localhost:11434',
    attachments: []
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('agentRuntime', () => {
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

    runtime = initAgentRuntime(ipcMain as any, mainWindow as any, {
      statePath: path.join(tempDir, 'state.json'),
      mcpGateway,
      fetchImpl: async () => new Response(JSON.stringify({ message: { content: '{}' } })),
      defaultEndpoint: 'http://localhost:11434'
    });
  });

  afterEach(() => {
    runtime.removeHandlers();
  });

  describe('IPC handler registration', () => {
    it('registers all required IPC channels', () => {
      const expectedChannels = [
        'agent:submit-task',
        'agent:pause-task',
        'agent:resume-task',
        'agent:cancel-task',
        'agent:submit-follow-up',
        'agent:submit-feedback',
        'agent:approve-gate',
        'agent:deny-gate',
        'agent:get-config',
        'agent:save-config',
        'agent:list-sessions',
        'agent:get-session',
        'agent:rerun-task'
      ];

      const registeredHandlers = ipcMain.getHandlers();
      for (const channel of expectedChannels) {
        expect(registeredHandlers.has(channel), `Handler for "${channel}" should be registered`).toBe(true);
      }
    });

    it('does not register the streaming channel as a handler (it uses send)', () => {
      const registeredHandlers = ipcMain.getHandlers();
      expect(registeredHandlers.has('agent:activity-stream')).toBe(false);
    });
  });

  describe('agent:submit-task', () => {
    it('rejects an invalid submission with empty instruction', async () => {
      const handler = ipcMain.getHandler(IPC_CHANNELS.SUBMIT_TASK)!;
      const result = await handler({}, { instruction: '', workingDirectory: tempDir, modelId: 'llama3', endpoint: 'http://localhost:11434', attachments: [] });
      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('creates and persists a TaskSession for a valid submission', async () => {
      const handler = ipcMain.getHandler(IPC_CHANNELS.SUBMIT_TASK)!;
      const submission = createValidSubmission(tempDir);

      const result = await handler({}, submission);

      expect(result.success).toBe(true);
      expect(result.session).toBeDefined();
      expect(result.session.id).toBeDefined();
      expect(result.session.instruction).toBe(submission.instruction);
      expect(result.session.status).toBe('planned');
      expect(result.session.workingDirectory).toBe(tempDir);
      expect(result.session.modelId).toBe('llama3');
      expect(result.session.config).toBeDefined();
      expect(result.session.config.stepTimeout).toBe(120);
      expect(result.session.config.taskTimeout).toBe(900);
    });

    it('persists the session to disk within deadline', async () => {
      const handler = ipcMain.getHandler(IPC_CHANNELS.SUBMIT_TASK)!;
      const submission = createValidSubmission(tempDir);

      const before = Date.now();
      const result = await handler({}, submission);
      const after = Date.now();

      // Session should be persisted (requirement 1.3: within 1 second)
      expect(after - before).toBeLessThan(1000);

      // Verify session is on disk
      const sessionsPath = path.join(path.dirname(path.join(tempDir, 'state.json')), 'agent', 'sessions.json');
      expect(fs.existsSync(sessionsPath)).toBe(true);
      const persisted = JSON.parse(fs.readFileSync(sessionsPath, 'utf8'));
      expect(persisted.length).toBe(1);
      expect(persisted[0].id).toBe(result.session.id);
    });
  });

  describe('agent:get-config', () => {
    it('returns default config when none is saved', async () => {
      const handler = ipcMain.getHandler(IPC_CHANNELS.GET_CONFIG)!;
      const config = await handler({});

      expect(config.stepTimeout).toBe(120);
      expect(config.taskTimeout).toBe(900);
      expect(config.retryCount).toBe(3);
      expect(config.autoApprovalLowRisk).toBe(false);
    });
  });

  describe('agent:save-config', () => {
    it('saves valid configuration and returns it', async () => {
      const saveHandler = ipcMain.getHandler(IPC_CHANNELS.SAVE_CONFIG)!;
      const result = await saveHandler({}, { stepTimeout: 200, retryCount: 5 });

      expect(result.savedConfig.stepTimeout).toBe(200);
      expect(result.savedConfig.retryCount).toBe(5);

      // Verify config is loaded correctly
      const getHandler = ipcMain.getHandler(IPC_CHANNELS.GET_CONFIG)!;
      const loaded = await getHandler({});
      expect(loaded.stepTimeout).toBe(200);
      expect(loaded.retryCount).toBe(5);
    });

    it('rejects invalid configuration values', async () => {
      const handler = ipcMain.getHandler(IPC_CHANNELS.SAVE_CONFIG)!;
      const result = await handler({}, { stepTimeout: 10000 }); // Exceeds max 600

      // Should retain default value
      expect(result.savedConfig.stepTimeout).toBe(120);
    });
  });

  describe('agent:list-sessions', () => {
    it('returns empty paginated result when no sessions exist', async () => {
      const handler = ipcMain.getHandler(IPC_CHANNELS.LIST_SESSIONS)!;
      const result = await handler({}, {});

      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
      expect(result.totalPages).toBe(0);
    });

    it('returns sessions in reverse chronological order', async () => {
      // Submit two tasks to create sessions
      const submitHandler = ipcMain.getHandler(IPC_CHANNELS.SUBMIT_TASK)!;
      await submitHandler({}, createValidSubmission(tempDir));
      // Small delay to ensure different timestamps
      await new Promise(r => setTimeout(r, 10));
      await submitHandler({}, { ...createValidSubmission(tempDir), instruction: 'Second task' });

      const listHandler = ipcMain.getHandler(IPC_CHANNELS.LIST_SESSIONS)!;
      const result = await listHandler({}, {});

      expect(result.total).toBe(2);
      expect(result.items.length).toBe(2);
      // Most recent first
      expect(result.items[0].instruction).toBe('Second task');
    });

    it('paginates correctly', async () => {
      const submitHandler = ipcMain.getHandler(IPC_CHANNELS.SUBMIT_TASK)!;
      for (let i = 0; i < 3; i++) {
        await submitHandler({}, { ...createValidSubmission(tempDir), instruction: `Task ${i}` });
      }

      const listHandler = ipcMain.getHandler(IPC_CHANNELS.LIST_SESSIONS)!;
      const page1 = await listHandler({}, { page: 1, pageSize: 2 });
      expect(page1.items.length).toBe(2);
      expect(page1.totalPages).toBe(2);

      const page2 = await listHandler({}, { page: 2, pageSize: 2 });
      expect(page2.items.length).toBe(1);
    });
  });

  describe('agent:get-session', () => {
    it('returns null for non-existent session', async () => {
      const handler = ipcMain.getHandler(IPC_CHANNELS.GET_SESSION)!;
      const result = await handler({}, 'non-existent-id');
      expect(result).toBeNull();
    });

    it('retrieves a submitted session', async () => {
      const submitHandler = ipcMain.getHandler(IPC_CHANNELS.SUBMIT_TASK)!;
      const { session } = await submitHandler({}, createValidSubmission(tempDir));

      const getHandler = ipcMain.getHandler(IPC_CHANNELS.GET_SESSION)!;
      const retrieved = await getHandler({}, session.id);

      expect(retrieved).not.toBeNull();
      expect(retrieved.id).toBe(session.id);
      expect(retrieved.instruction).toBe('Create a hello world file');
    });
  });

  describe('agent:cancel-task', () => {
    it('cancels a stored session in paused state', async () => {
      // Create a session via submit
      const submitHandler = ipcMain.getHandler(IPC_CHANNELS.SUBMIT_TASK)!;
      const { session } = await submitHandler({}, createValidSubmission(tempDir));

      // Manually update stored session to paused state (simulating)
      const sessionsPath = path.join(path.dirname(path.join(tempDir, 'state.json')), 'agent', 'sessions.json');
      const sessions = JSON.parse(fs.readFileSync(sessionsPath, 'utf8'));
      sessions[0].status = 'paused';
      fs.writeFileSync(sessionsPath, JSON.stringify(sessions, null, 2), 'utf8');

      const cancelHandler = ipcMain.getHandler(IPC_CHANNELS.CANCEL_TASK)!;
      const result = await cancelHandler({}, session.id);

      expect(result.success).toBe(true);

      // Verify it's now canceled in store
      const updated = JSON.parse(fs.readFileSync(sessionsPath, 'utf8'));
      expect(updated[0].status).toBe('canceled');
      expect(updated[0].completedAt).not.toBeNull();
    });

    it('returns error for non-existent session', async () => {
      const handler = ipcMain.getHandler(IPC_CHANNELS.CANCEL_TASK)!;
      const result = await handler({}, 'non-existent');
      expect(result.success).toBe(false);
    });
  });

  describe('agent:submit-follow-up', () => {
    it('rejects empty follow-up instruction', async () => {
      const handler = ipcMain.getHandler(IPC_CHANNELS.SUBMIT_FOLLOW_UP)!;
      const result = await handler({}, 'some-session', '');
      expect(result.success).toBe(false);
    });

    it('rejects when no active session exists', async () => {
      const handler = ipcMain.getHandler(IPC_CHANNELS.SUBMIT_FOLLOW_UP)!;
      const result = await handler({}, 'non-existent', 'some follow-up');
      expect(result.success).toBe(false);
    });
  });

  describe('agent:submit-feedback', () => {
    it('rejects empty feedback', async () => {
      const handler = ipcMain.getHandler(IPC_CHANNELS.SUBMIT_FEEDBACK)!;
      const result = await handler({}, 'some-session', 'step-1', '');
      expect(result.success).toBe(false);
    });

    it('rejects when no active session exists', async () => {
      const handler = ipcMain.getHandler(IPC_CHANNELS.SUBMIT_FEEDBACK)!;
      const result = await handler({}, 'non-existent', 'step-1', 'some feedback');
      expect(result.success).toBe(false);
    });
  });

  describe('agent:approve-gate and agent:deny-gate', () => {
    it('returns error when session is not active', async () => {
      const approveHandler = ipcMain.getHandler(IPC_CHANNELS.APPROVE_GATE)!;
      const result = await approveHandler({}, 'non-existent', 'gate-1');
      expect(result.success).toBe(false);
    });

    it('deny returns error when session is not active', async () => {
      const denyHandler = ipcMain.getHandler(IPC_CHANNELS.DENY_GATE)!;
      const result = await denyHandler({}, 'non-existent', 'gate-1', 'Too dangerous');
      expect(result.success).toBe(false);
    });
  });

  describe('agent:rerun-task', () => {
    it('returns error for non-existent original session', async () => {
      const handler = ipcMain.getHandler(IPC_CHANNELS.RERUN_TASK)!;
      const result = await handler({}, 'non-existent-id');
      expect(result.success).toBe(false);
    });

    it('creates a new session from an existing one', async () => {
      // First create a session
      const submitHandler = ipcMain.getHandler(IPC_CHANNELS.SUBMIT_TASK)!;
      const { session: original } = await submitHandler({}, createValidSubmission(tempDir));

      // Re-run it
      const rerunHandler = ipcMain.getHandler(IPC_CHANNELS.RERUN_TASK)!;
      const result = await rerunHandler({}, original.id);

      expect(result.success).toBe(true);
      expect(result.session).toBeDefined();
      expect(result.session.id).not.toBe(original.id);
      expect(result.session.instruction).toBe(original.instruction);
    });
  });

  describe('runtime interface', () => {
    it('exposes getActiveSessions', () => {
      expect(runtime.getActiveSessions()).toBeInstanceOf(Map);
    });

    it('getSessionState returns null for unknown sessions', () => {
      expect(runtime.getSessionState('non-existent')).toBeNull();
    });

    it('removeHandlers cleans up IPC registrations', () => {
      runtime.removeHandlers();
      const handlers = ipcMain.getHandlers();
      // All agent channels should be removed
      expect(handlers.has(IPC_CHANNELS.SUBMIT_TASK)).toBe(false);
      expect(handlers.has(IPC_CHANNELS.GET_CONFIG)).toBe(false);
    });
  });
});
