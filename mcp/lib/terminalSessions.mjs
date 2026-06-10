import os from 'os';
import pty from 'node-pty';
import {
  clampNumber,
  commandMatchesAllowlist,
  getTerminalRoot,
  isRiskyCommand,
  randomId,
  resolveInsideRoot,
  sanitizeEnv,
  shellDefaults,
  trimOutput
} from './security.mjs';

const MAX_BUFFER = 512_000;
const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const WRITE_MAX_CHARS = 8_000;

const sessions = new Map();

function trimBuffer(text) {
  return text.length > MAX_BUFFER ? text.slice(-MAX_BUFFER) : text;
}

function nowIso() {
  return new Date().toISOString();
}

function getSession(id) {
  const session = sessions.get(id);
  if (!session) {
    throw new Error(`Unknown session: ${id}`);
  }
  return session;
}

function sessionSummary(session) {
  return {
    id: session.id,
    shell: session.shell,
    cwd: session.cwd,
    startedAt: session.startedAt,
    lastActivityAt: session.lastActivityAt,
    exited: session.exited,
    exitCode: session.exitCode
  };
}

export function createTerminalSession(params = {}) {
  const { shell, args, cwd } = params;
  const defaults = shellDefaults();
  const root = getTerminalRoot();
  const safeCwd = resolveInsideRoot(root, cwd || '.');

  const shellCommand = typeof shell === 'string' && shell.trim() ? shell.trim() : defaults.shell;
  const shellArgs = Array.isArray(args) ? args.filter((a) => typeof a === 'string').slice(0, 12) : defaults.args;

  const ptyProcess = pty.spawn(shellCommand, shellArgs, {
    name: 'xterm-color',
    cols: 120,
    rows: 35,
    cwd: safeCwd,
    env: sanitizeEnv(process.env)
  });

  const id = randomId('term');
  const session = {
    id,
    shell: shellCommand,
    cwd: safeCwd,
    pty: ptyProcess,
    buffer: '',
    unread: '',
    startedAt: nowIso(),
    lastActivityAt: nowIso(),
    exited: false,
    exitCode: null
  };

  ptyProcess.onData((chunk) => {
    session.lastActivityAt = nowIso();
    session.buffer = trimBuffer(session.buffer + chunk);
    session.unread = trimBuffer(session.unread + chunk);
  });

  ptyProcess.onExit(({ exitCode }) => {
    session.exited = true;
    session.exitCode = exitCode;
    session.lastActivityAt = nowIso();
  });

  sessions.set(id, session);
  return sessionSummary(session);
}

export function listTerminalSessions() {
  return Array.from(sessions.values()).map(sessionSummary);
}

export function readTerminalOutput(id, maxChars = 32_000, clear = true) {
  const session = getSession(id);
  const limit = clampNumber(maxChars, 1, 64_000, 32_000);
  const output = trimOutput(session.unread, limit);
  if (clear) {
    session.unread = '';
  }
  return {
    session: sessionSummary(session),
    output
  };
}

export function writeTerminalInput(id, input) {
  const session = getSession(id);
  if (session.exited) {
    throw new Error(`Session has exited: ${id}`);
  }
  if (typeof input !== 'string' || input.length === 0) {
    throw new Error('Input must be a non-empty string.');
  }

  const safeInput = input.slice(0, WRITE_MAX_CHARS);
  session.pty.write(safeInput);
  session.lastActivityAt = nowIso();

  return {
    session: sessionSummary(session),
    acceptedChars: safeInput.length,
    truncated: safeInput.length !== input.length
  };
}

export async function executeTerminalCommand(id, command, options = {}) {
  const session = getSession(id);
  if (session.exited) {
    throw new Error(`Session has exited: ${id}`);
  }
  if (typeof command !== 'string' || !command.trim()) {
    throw new Error('Command is required.');
  }

  const allowRisky = process.env.MCP_ALLOW_RISKY_COMMANDS === '1' || options.approveRisky === true;
  if (!commandMatchesAllowlist(command)) {
    return {
      blocked: true,
      reason: 'Command did not match MCP_TERMINAL_ALLOWLIST.',
      session: sessionSummary(session)
    };
  }
  if (isRiskyCommand(command) && !allowRisky) {
    return {
      blocked: true,
      reason: 'Command matched risky pattern. Set approveRisky=true or MCP_ALLOW_RISKY_COMMANDS=1 to override.',
      session: sessionSummary(session)
    };
  }

  const timeoutMs = clampNumber(options.timeoutMs, 100, 60_000, 8_000);
  const settleMs = clampNumber(options.settleMs, 50, 5_000, 350);

  session.unread = '';
  session.pty.write(command + os.EOL);
  session.lastActivityAt = nowIso();

  await new Promise((resolve) => setTimeout(resolve, settleMs));

  let elapsed = settleMs;
  while (elapsed < timeoutMs) {
    const before = session.unread.length;
    await new Promise((resolve) => setTimeout(resolve, settleMs));
    elapsed += settleMs;
    const after = session.unread.length;
    if (after === before) break;
  }

  return {
    blocked: false,
    session: sessionSummary(session),
    output: trimOutput(session.unread, 64_000)
  };
}

export function closeTerminalSession(id) {
  const session = getSession(id);
  if (!session.exited) {
    try {
      session.pty.kill();
    } catch {
      // ignore kill failures
    }
  }
  sessions.delete(id);
  return { id, closed: true };
}

export function sweepIdleTerminalSessions() {
  const timeoutMs = clampNumber(process.env.MCP_TERMINAL_IDLE_TIMEOUT_MS, 60_000, 24 * 60 * 60 * 1000, DEFAULT_IDLE_TIMEOUT_MS);
  const now = Date.now();
  const closed = [];

  for (const [id, session] of sessions.entries()) {
    const last = Date.parse(session.lastActivityAt);
    if (!Number.isFinite(last)) continue;
    if (now - last < timeoutMs) continue;

    try {
      if (!session.exited) session.pty.kill();
    } catch {
      // ignore kill failures
    }
    sessions.delete(id);
    closed.push(id);
  }

  return closed;
}

export function closeAllSessions() {
  const ids = [];
  for (const [id, session] of sessions.entries()) {
    try {
      if (!session.exited) session.pty.kill();
    } catch {
      // ignore kill failures
    }
    ids.push(id);
    sessions.delete(id);
  }
  return ids;
}
