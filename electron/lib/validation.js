// Pure validators used by the Electron main process and the test suite.
// No Electron / Node-specific imports beyond `node:path` to keep tests fast
// and runnable without spinning up an Electron context.
import path from 'node:path';

const SHELL_RISKY_PATTERNS = [
  /(^|\s)(rm|rmdir|del|erase|format|shutdown|reboot|Restart-Computer)(\s|$)/i,
  /(^|\s)(Remove-Item|Set-ExecutionPolicy|reg\s+add|reg\s+delete|diskpart)(\s|$)/i,
  /(^|\s)(curl|Invoke-WebRequest|Invoke-Expression|iex)(\s|$)/i,
  /(^|\s)(Start-Process|Stop-Process|taskkill|sc\.exe)(\s|$)/i
];

export function isSafeHttpUrl(urlValue) {
  try {
    const parsed = new URL(urlValue);
    return ['http:', 'https:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

export function isRiskyCommand(command) {
  if (typeof command !== 'string') return false;
  const trimmed = command.trim();
  if (!trimmed) return false;
  return SHELL_RISKY_PATTERNS.some((pattern) => pattern.test(trimmed));
}

// Strict session id: only [A-Za-z0-9._-], 1-64 chars. Blocks path traversal
// and reserved path tokens that could escape userData/chats.
export function assertValidSessionId(sessionId) {
  if (typeof sessionId !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(sessionId)) {
    throw new Error('Invalid session id.');
  }
  if (sessionId === '.' || sessionId === '..') {
    throw new Error('Invalid session id.');
  }
  return sessionId;
}

export function resolveChatFile(userDataDir, sessionId) {
  assertValidSessionId(sessionId);
  const chatsRoot = path.resolve(path.join(userDataDir, 'chats'));
  const fullPath = path.resolve(path.join(chatsRoot, `${sessionId}.json`));
  if (!fullPath.startsWith(`${chatsRoot}${path.sep}`)) {
    throw new Error('Invalid session path.');
  }
  return { chatsRoot, fullPath };
}

export function sanitizeUserPath(inputPath) {
  if (typeof inputPath !== 'string' || !inputPath.trim()) {
    throw new Error('Path is required.');
  }
  if (inputPath.includes('\0')) {
    throw new Error('Invalid path.');
  }
  return inputPath.replace(/\\/g, '/').replace(/^\/+/, '');
}

export function resolveWikiPath(wikiRootDir, filePath) {
  const wikiRoot = path.resolve(wikiRootDir);
  const relative = sanitizeUserPath(filePath);
  const fullPath = path.resolve(path.join(wikiRoot, relative));
  if (fullPath !== wikiRoot && !fullPath.startsWith(`${wikiRoot}${path.sep}`)) {
    throw new Error('Access denied for path.');
  }
  return { wikiRoot, fullPath };
}
