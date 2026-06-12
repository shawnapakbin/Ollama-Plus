import fs from 'fs';
import os from 'os';
import path from 'path';

export const DEFAULT_OUTPUT_LIMIT = 64_000;

export function isWindows() {
  return process.platform === 'win32';
}

export function getWorkspaceRoot() {
  return process.cwd();
}

export function getTerminalRoot() {
  const root = process.env.MCP_TERMINAL_ROOT || getWorkspaceRoot();
  return path.resolve(root);
}

export function getSandboxRoot() {
  const root = process.env.MCP_PY_SANDBOX_ROOT || path.join(getWorkspaceRoot(), '.sandbox', 'python-runs');
  return path.resolve(root);
}

export function getFileRoot() {
  const root = process.env.MCP_FILE_ROOT || getWorkspaceRoot();
  return path.resolve(root);
}

export function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function trimOutput(text, maxLen = DEFAULT_OUTPUT_LIMIT) {
  if (typeof text !== 'string') return '';
  if (text.length <= maxLen) return text;
  return text.slice(-maxLen);
}

export function sanitizeEnv(baseEnv = process.env) {
  const allow = new Set([
    'PATH',
    'Path',
    'PATHEXT',
    'HOME',
    'USERPROFILE',
    'SystemRoot',
    'SYSTEMROOT',
    'windir',
    'WINDIR',
    'ComSpec',
    'COMSPEC',
    'TMP',
    'TEMP',
    'TERM',
    'LANG'
  ]);
  const clean = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (!allow.has(key)) continue;
    if (typeof value === 'string') clean[key] = value;
  }
  clean.MCP_SANDBOXED = '1';
  return clean;
}

export function resolveInsideRoot(root, candidate) {
  const absRoot = path.resolve(root);
  const absCandidate = path.resolve(absRoot, candidate || '.');
  const rel = path.relative(absRoot, absCandidate);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path escapes allowed root: ${candidate}`);
  }
  return absCandidate;
}

export function shellDefaults() {
  if (isWindows()) {
    return {
      shell: process.env.COMSPEC || 'powershell.exe',
      args: ['-NoLogo', '-NoProfile']
    };
  }
  return {
    shell: process.env.SHELL || '/bin/bash',
    args: ['-i']
  };
}

export function shellNewline() {
  return os.EOL;
}

export function parseAllowlist(value) {
  if (typeof value !== 'string' || !value.trim()) return [];
  return value
    .split(/[\n,;]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function commandMatchesAllowlist(command, allowlistValue = process.env.MCP_TERMINAL_ALLOWLIST) {
  const allowlist = parseAllowlist(allowlistValue);
  if (allowlist.length === 0) return true;
  if (typeof command !== 'string') return false;

  const normalized = command.trim().toLowerCase();
  return allowlist.some((entry) => normalized.startsWith(entry.toLowerCase()));
}

// Block clearly dangerous commands by default. Set MCP_ALLOW_RISKY_COMMANDS=1 to bypass.
const riskyPatterns = [
  /\brm\s+-rf\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bhalt\b/i,
  /\bformat\b/i,
  /\bdel\s+\/s\b/i,
  /\brmdir\s+\/s\b/i,
  /\bcurl\b.*\|/i,
  /\bwget\b.*\|/i,
  /\bInvoke-WebRequest\b.*\|/i,
  /\bchmod\s+777\b/i
];

export function isRiskyCommand(command) {
  if (typeof command !== 'string') return false;
  return riskyPatterns.some((pattern) => pattern.test(command));
}

// For Python code, we still enforce container isolation; this catches obvious abuse early.
const pythonBlockedPatterns = [
  /\bsubprocess\b/,
  /\bsocket\b/,
  /\bctypes\b/,
  /\bos\.system\b/,
  /\beval\s*\(/,
  /\bexec\s*\(/,
  /__import__\s*\(/,
  /\brequests\b/,
  /\burllib\b/
];

export function hasBlockedPythonPattern(code) {
  if (typeof code !== 'string') return false;
  return pythonBlockedPatterns.some((pattern) => pattern.test(code));
}

export function randomId(prefix = 'id') {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}
