import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  saveSession,
  getSession,
  listSessions,
  deleteSession,
  addArtifact,
  getArtifacts,
  rerunSession
} from '../../../electron/runtime/agent/sessionStore.js';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

function createTempStorePath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-session-store-'));
  tempDirs.push(dir);
  return path.join(dir, 'agent-sessions.json');
}

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session-1',
    instruction: 'Build a REST API',
    status: 'planned',
    workingDirectory: '/tmp/project',
    modelId: 'llama3',
    endpoint: 'http://localhost:11434',
    plan: null,
    attachments: [],
    artifacts: [],
    stepResults: [],
    replanCount: 0,
    createdAt: '2024-01-15T10:00:00.000Z',
    updatedAt: '2024-01-15T10:00:00.000Z',
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

// ─── saveSession ─────────────────────────────────────────────────────────────

describe('saveSession', () => {
  it('creates a new session and persists it to disk', () => {
    const storePath = createTempStorePath();
    const session = makeSession();

    const result = saveSession(storePath, session);

    expect(result.id).toBe('session-1');
    expect(result.instruction).toBe('Build a REST API');
    expect(result.status).toBe('planned');

    // Verify persistence
    const raw = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    expect(raw.sessions).toHaveLength(1);
    expect(raw.sessions[0].id).toBe('session-1');
  });

  it('generates an ID if none is provided', () => {
    const storePath = createTempStorePath();
    const session = makeSession({ id: '' });

    const result = saveSession(storePath, session, { idFactory: () => 'generated-id' });

    expect(result.id).toBe('generated-id');
  });

  it('updates an existing session when IDs match', () => {
    const storePath = createTempStorePath();
    saveSession(storePath, makeSession({ status: 'planned' }));

    const updated = saveSession(storePath, makeSession({ status: 'running' }));

    expect(updated.status).toBe('running');
    const raw = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    expect(raw.sessions).toHaveLength(1);
  });

  it('persists full session data including plan, stepResults, and config', () => {
    const storePath = createTempStorePath();
    const session = makeSession({
      plan: { steps: [{ id: 's1', title: 'Step 1' }], estimatedDuration: 5000, reasoning: 'test' },
      stepResults: [{ stepId: 's1', title: 'Step 1', status: 'completed', output: 'done' }],
      config: { stepTimeout: 300, taskTimeout: 1800, retryCount: 5, autoApprovalLowRisk: true, customApprovalRules: [], toolTimeouts: { terminal: 60, file: 30, browser: 120, python: 60, http: 30 } }
    });

    const result = saveSession(storePath, session);

    expect(result.plan).not.toBeNull();
    expect(result.plan.steps).toHaveLength(1);
    expect(result.stepResults).toHaveLength(1);
    expect(result.config.stepTimeout).toBe(300);
  });

  it('normalizes invalid status to planned', () => {
    const storePath = createTempStorePath();
    const result = saveSession(storePath, makeSession({ status: 'invalid_status' }));
    expect(result.status).toBe('planned');
  });
});

// ─── getSession ──────────────────────────────────────────────────────────────

describe('getSession', () => {
  it('returns a session by ID', () => {
    const storePath = createTempStorePath();
    saveSession(storePath, makeSession({ id: 'find-me' }));

    const result = getSession(storePath, 'find-me');

    expect(result).not.toBeNull();
    expect(result!.id).toBe('find-me');
    expect(result!.instruction).toBe('Build a REST API');
  });

  it('returns null for non-existent session', () => {
    const storePath = createTempStorePath();
    const result = getSession(storePath, 'does-not-exist');
    expect(result).toBeNull();
  });

  it('returns null when store file does not exist', () => {
    const storePath = createTempStorePath();
    const result = getSession(storePath, 'any-id');
    expect(result).toBeNull();
  });
});

// ─── listSessions ────────────────────────────────────────────────────────────

describe('listSessions', () => {
  it('returns paginated results in reverse chronological order', () => {
    const storePath = createTempStorePath();

    saveSession(storePath, makeSession({ id: 's1', createdAt: '2024-01-01T00:00:00.000Z' }));
    saveSession(storePath, makeSession({ id: 's2', createdAt: '2024-01-02T00:00:00.000Z' }));
    saveSession(storePath, makeSession({ id: 's3', createdAt: '2024-01-03T00:00:00.000Z' }));

    const result = listSessions(storePath, { page: 1, pageSize: 20 });

    expect(result.items).toHaveLength(3);
    expect(result.items[0].id).toBe('s3');
    expect(result.items[1].id).toBe('s2');
    expect(result.items[2].id).toBe('s1');
    expect(result.total).toBe(3);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
    expect(result.totalPages).toBe(1);
  });

  it('defaults to page 1 with page size 20', () => {
    const storePath = createTempStorePath();
    saveSession(storePath, makeSession());

    const result = listSessions(storePath);

    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(20);
  });

  it('paginates correctly across multiple pages', () => {
    const storePath = createTempStorePath();

    for (let i = 0; i < 5; i++) {
      saveSession(storePath, makeSession({
        id: `s${i}`,
        createdAt: `2024-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`
      }));
    }

    const page1 = listSessions(storePath, { page: 1, pageSize: 2 });
    expect(page1.items).toHaveLength(2);
    expect(page1.items[0].id).toBe('s4'); // most recent
    expect(page1.items[1].id).toBe('s3');
    expect(page1.totalPages).toBe(3);

    const page2 = listSessions(storePath, { page: 2, pageSize: 2 });
    expect(page2.items).toHaveLength(2);
    expect(page2.items[0].id).toBe('s2');
    expect(page2.items[1].id).toBe('s1');

    const page3 = listSessions(storePath, { page: 3, pageSize: 2 });
    expect(page3.items).toHaveLength(1);
    expect(page3.items[0].id).toBe('s0');
  });

  it('returns empty items when page is beyond total pages', () => {
    const storePath = createTempStorePath();
    saveSession(storePath, makeSession());

    const result = listSessions(storePath, { page: 5, pageSize: 20 });
    expect(result.items).toHaveLength(0);
    expect(result.total).toBe(1);
  });

  it('returns empty list for empty store', () => {
    const storePath = createTempStorePath();
    const result = listSessions(storePath);
    expect(result.items).toHaveLength(0);
    expect(result.total).toBe(0);
    expect(result.totalPages).toBe(1);
  });
});

// ─── deleteSession ───────────────────────────────────────────────────────────

describe('deleteSession', () => {
  it('removes a session and its artifacts from the store', () => {
    const storePath = createTempStorePath();
    saveSession(storePath, makeSession({ id: 'to-delete' }));
    addArtifact(storePath, 'to-delete', {
      filePath: '/tmp/file.txt',
      operation: 'create',
      size: 100
    });

    const deleted = deleteSession(storePath, 'to-delete');

    expect(deleted.id).toBe('to-delete');
    expect(getSession(storePath, 'to-delete')).toBeNull();
    expect(getArtifacts(storePath, 'to-delete')).toHaveLength(0);
  });

  it('throws for non-existent session', () => {
    const storePath = createTempStorePath();
    expect(() => deleteSession(storePath, 'ghost')).toThrow('Cannot delete unknown session: ghost');
  });
});

// ─── addArtifact ─────────────────────────────────────────────────────────────

describe('addArtifact', () => {
  it('adds an artifact to a session', () => {
    const storePath = createTempStorePath();
    saveSession(storePath, makeSession({ id: 'art-session' }));

    const artifact = addArtifact(storePath, 'art-session', {
      filePath: '/tmp/project/src/main.ts',
      operation: 'create',
      afterContent: 'console.log("hello");',
      size: 22
    });

    expect(artifact.id).toBeTruthy();
    expect(artifact.sessionId).toBe('art-session');
    expect(artifact.filePath).toBe('/tmp/project/src/main.ts');
    expect(artifact.operation).toBe('create');
  });

  it('stores before/after content for modifications under 1 MB', () => {
    const storePath = createTempStorePath();
    saveSession(storePath, makeSession({ id: 'mod-session' }));

    const smallContent = 'x'.repeat(1000);
    const artifact = addArtifact(storePath, 'mod-session', {
      filePath: '/tmp/project/file.txt',
      operation: 'modify',
      beforeContent: smallContent,
      afterContent: smallContent + ' modified',
      size: 1000
    });

    expect(artifact.beforeContent).toBe(smallContent);
    expect(artifact.afterContent).toBe(smallContent + ' modified');
  });

  it('nullifies content exceeding 1 MB', () => {
    const storePath = createTempStorePath();
    saveSession(storePath, makeSession({ id: 'big-session' }));

    const bigContent = 'x'.repeat(1_048_577); // 1 byte over 1 MB
    const artifact = addArtifact(storePath, 'big-session', {
      filePath: '/tmp/project/large.bin',
      operation: 'modify',
      beforeContent: bigContent,
      afterContent: bigContent,
      size: 1_048_577
    });

    expect(artifact.beforeContent).toBeNull();
    expect(artifact.afterContent).toBeNull();
  });

  it('throws for non-existent session', () => {
    const storePath = createTempStorePath();
    expect(() =>
      addArtifact(storePath, 'ghost', { filePath: '/file.txt', operation: 'create', size: 10 })
    ).toThrow('Cannot add artifact to unknown session: ghost');
  });

  it('updates session artifacts array', () => {
    const storePath = createTempStorePath();
    saveSession(storePath, makeSession({ id: 'art-check' }));

    addArtifact(storePath, 'art-check', {
      filePath: '/tmp/a.txt',
      operation: 'create',
      size: 5
    });
    addArtifact(storePath, 'art-check', {
      filePath: '/tmp/b.txt',
      operation: 'create',
      size: 10
    });

    const session = getSession(storePath, 'art-check');
    expect(session!.artifacts).toHaveLength(2);
  });
});

// ─── getArtifacts ────────────────────────────────────────────────────────────

describe('getArtifacts', () => {
  it('returns all artifacts for a session', () => {
    const storePath = createTempStorePath();
    saveSession(storePath, makeSession({ id: 'get-arts' }));

    addArtifact(storePath, 'get-arts', { filePath: '/a.txt', operation: 'create', size: 5 });
    addArtifact(storePath, 'get-arts', { filePath: '/b.txt', operation: 'modify', size: 10 });

    const artifacts = getArtifacts(storePath, 'get-arts');
    expect(artifacts).toHaveLength(2);
    expect(artifacts[0].filePath).toBe('/a.txt');
    expect(artifacts[1].filePath).toBe('/b.txt');
  });

  it('returns empty array for session with no artifacts', () => {
    const storePath = createTempStorePath();
    saveSession(storePath, makeSession({ id: 'no-arts' }));
    expect(getArtifacts(storePath, 'no-arts')).toHaveLength(0);
  });

  it('returns empty array for non-existent session', () => {
    const storePath = createTempStorePath();
    expect(getArtifacts(storePath, 'ghost')).toHaveLength(0);
  });
});

// ─── rerunSession ────────────────────────────────────────────────────────────

describe('rerunSession', () => {
  it('creates a new session with same instruction and config', () => {
    const storePath = createTempStorePath();
    saveSession(storePath, makeSession({
      id: 'original',
      instruction: 'Deploy the service',
      status: 'completed',
      workingDirectory: '/projects/api',
      modelId: 'codestral',
      endpoint: 'http://localhost:11434',
      config: { stepTimeout: 200, taskTimeout: 1000, retryCount: 2, autoApprovalLowRisk: true, customApprovalRules: [], toolTimeouts: { terminal: 60, file: 30, browser: 120, python: 60, http: 30 } }
    }));

    const { session, missingArtifacts } = rerunSession(storePath, 'original', {
      idFactory: () => 'new-session-id'
    });

    expect(session.id).toBe('new-session-id');
    expect(session.instruction).toBe('Deploy the service');
    expect(session.status).toBe('planned');
    expect(session.workingDirectory).toBe('/projects/api');
    expect(session.modelId).toBe('codestral');
    expect(session.config.stepTimeout).toBe(200);
    expect(session.plan).toBeNull();
    expect(session.stepResults).toHaveLength(0);
    expect(session.artifacts).toHaveLength(0);
    expect(missingArtifacts).toHaveLength(0);
  });

  it('reports missing artifacts when files no longer exist', () => {
    const storePath = createTempStorePath();
    saveSession(storePath, makeSession({ id: 'with-arts' }));
    addArtifact(storePath, 'with-arts', {
      filePath: '/nonexistent/path/file1.txt',
      operation: 'create',
      size: 100
    });
    addArtifact(storePath, 'with-arts', {
      filePath: '/nonexistent/path/file2.txt',
      operation: 'modify',
      size: 200
    });

    const { missingArtifacts } = rerunSession(storePath, 'with-arts', {
      idFactory: () => 'rerun-id'
    });

    expect(missingArtifacts).toContain('/nonexistent/path/file1.txt');
    expect(missingArtifacts).toContain('/nonexistent/path/file2.txt');
  });

  it('does not report deleted artifacts as missing', () => {
    const storePath = createTempStorePath();
    saveSession(storePath, makeSession({ id: 'del-arts' }));
    addArtifact(storePath, 'del-arts', {
      filePath: '/nonexistent/path/deleted.txt',
      operation: 'delete',
      size: 0
    });

    const { missingArtifacts } = rerunSession(storePath, 'del-arts', {
      idFactory: () => 'rerun-del'
    });

    expect(missingArtifacts).not.toContain('/nonexistent/path/deleted.txt');
  });

  it('does not report artifacts that still exist on disk', () => {
    const storePath = createTempStorePath();
    // Use the store file itself as an artifact that exists
    saveSession(storePath, makeSession({ id: 'exists-arts' }));

    // Create a temp file to use as existing artifact
    const tempDir = path.dirname(storePath);
    const existingFile = path.join(tempDir, 'existing.txt');
    fs.writeFileSync(existingFile, 'content');

    addArtifact(storePath, 'exists-arts', {
      filePath: existingFile,
      operation: 'create',
      size: 7
    });

    const { missingArtifacts } = rerunSession(storePath, 'exists-arts', {
      idFactory: () => 'rerun-exists'
    });

    expect(missingArtifacts).not.toContain(existingFile);
  });

  it('throws for non-existent session', () => {
    const storePath = createTempStorePath();
    expect(() => rerunSession(storePath, 'ghost')).toThrow('Cannot re-run unknown session: ghost');
  });

  it('persists the new session to the store', () => {
    const storePath = createTempStorePath();
    saveSession(storePath, makeSession({ id: 'persist-check' }));

    rerunSession(storePath, 'persist-check', { idFactory: () => 'new-persist' });

    const found = getSession(storePath, 'new-persist');
    expect(found).not.toBeNull();
    expect(found!.instruction).toBe('Build a REST API');
  });
});

// ─── Persistence round-trip (Property 15 support) ───────────────────────────

describe('session persistence round-trip', () => {
  it('preserves all session fields through save and retrieve', () => {
    const storePath = createTempStorePath();
    const session = makeSession({
      id: 'round-trip',
      instruction: 'Complex task with special chars: "quotes" & <angles>',
      status: 'completed',
      plan: {
        steps: [{ id: 's1', title: 'First', description: 'Do first thing', riskLevel: 'low', requiredTools: [], parallelSafe: false, timeout: 60000, dependsOn: [] }],
        estimatedDuration: 10000,
        reasoning: 'Simple plan'
      },
      stepResults: [{
        stepId: 's1',
        title: 'First',
        status: 'completed',
        toolCalls: [{
          id: 'tc1', tool: 'terminal', server: 'terminal-mcp', action: 'run',
          params: { command: 'echo hello' }, output: 'hello\n',
          status: 'success', error: null, duration: 150,
          startedAt: '2024-01-15T10:01:00.000Z', completedAt: '2024-01-15T10:01:00.150Z'
        }],
        output: 'Step completed',
        error: null,
        startedAt: '2024-01-15T10:01:00.000Z',
        completedAt: '2024-01-15T10:01:01.000Z',
        duration: 1000,
        retryCount: 0
      }],
      replanCount: 1,
      startedAt: '2024-01-15T10:00:01.000Z',
      completedAt: '2024-01-15T10:05:00.000Z',
      totalDuration: 299000
    });

    saveSession(storePath, session);
    const retrieved = getSession(storePath, 'round-trip');

    expect(retrieved).not.toBeNull();
    expect(retrieved!.instruction).toBe(session.instruction);
    expect(retrieved!.status).toBe(session.status);
    expect(retrieved!.plan).toEqual(session.plan);
    expect(retrieved!.stepResults).toEqual(session.stepResults);
    expect(retrieved!.replanCount).toBe(1);
    expect(retrieved!.startedAt).toBe(session.startedAt);
    expect(retrieved!.completedAt).toBe(session.completedAt);
    expect(retrieved!.totalDuration).toBe(299000);
    expect(retrieved!.config).toEqual(session.config);
  });
});
