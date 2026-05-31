import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
  isSafeHttpUrl,
  isRiskyCommand,
  assertValidSessionId,
  resolveChatFile,
  resolveWikiPath,
  sanitizeUserPath
} from '../electron/lib/validation.js';

describe('isSafeHttpUrl', () => {
  it('accepts http and https', () => {
    expect(isSafeHttpUrl('http://localhost:11434')).toBe(true);
    expect(isSafeHttpUrl('https://example.com/api')).toBe(true);
  });
  it('rejects dangerous and unknown schemes', () => {
    for (const u of [
      'javascript:alert(1)',
      'file:///etc/passwd',
      'data:text/html,<script>1</script>',
      'ftp://example.com',
      'not a url',
      ''
    ]) {
      expect(isSafeHttpUrl(u)).toBe(false);
    }
  });
});

describe('isRiskyCommand', () => {
  it('flags risky shell commands', () => {
    for (const c of [
      'rm -rf /',
      'Remove-Item C:\\foo',
      'Invoke-WebRequest https://x',
      'iex (something)',
      'shutdown /s /t 0',
      'taskkill /F /IM explorer.exe'
    ]) {
      expect(isRiskyCommand(c)).toBe(true);
    }
  });
  it('does not flag benign commands', () => {
    for (const c of ['ls', 'Get-ChildItem', 'echo hi', 'node --version', '']) {
      expect(isRiskyCommand(c)).toBe(false);
    }
  });
  it('handles non-strings safely', () => {
    expect(isRiskyCommand(null)).toBe(false);
    expect(isRiskyCommand(undefined)).toBe(false);
  });
});

describe('assertValidSessionId', () => {
  it('accepts short alphanumeric ids', () => {
    expect(assertValidSessionId('abc123')).toBe('abc123');
    expect(assertValidSessionId('my-chat_01.v2')).toBe('my-chat_01.v2');
  });
  it('rejects path traversal and other invalid ids', () => {
    for (const id of ['..', '.', '../foo', 'foo/bar', 'foo\\bar', 'foo bar', '', '\0', 'a'.repeat(65)]) {
      expect(() => assertValidSessionId(id)).toThrow(/Invalid session id/);
    }
  });
  it('rejects non-strings', () => {
    expect(() => assertValidSessionId(123)).toThrow();
    expect(() => assertValidSessionId(null)).toThrow();
  });
});

describe('resolveChatFile', () => {
  const base = path.resolve('/tmp/userdata-test');
  it('resolves to a json file inside chats/', () => {
    const { chatsRoot, fullPath } = resolveChatFile(base, 'abc123');
    expect(chatsRoot).toBe(path.resolve(path.join(base, 'chats')));
    expect(fullPath).toBe(path.resolve(path.join(base, 'chats', 'abc123.json')));
  });
  it('rejects traversal attempts via id', () => {
    expect(() => resolveChatFile(base, '../escape')).toThrow();
    expect(() => resolveChatFile(base, '..')).toThrow();
  });
});

describe('resolveWikiPath', () => {
  const base = path.resolve('/tmp/wiki-root');
  it('resolves within the wiki root', () => {
    const { fullPath } = resolveWikiPath(base, 'notes/index.md');
    expect(fullPath.startsWith(base)).toBe(true);
  });
  it('rejects traversal outside the wiki root', () => {
    expect(() => resolveWikiPath(base, '../../etc/passwd')).toThrow(/Access denied/);
  });
  it('rejects null bytes and empty input', () => {
    expect(() => resolveWikiPath(base, '')).toThrow();
    expect(() => resolveWikiPath(base, 'foo\0bar')).toThrow();
  });
});

describe('sanitizeUserPath', () => {
  it('normalizes backslashes and strips leading slashes', () => {
    expect(sanitizeUserPath('\\foo\\bar')).toBe('foo/bar');
    expect(sanitizeUserPath('/leading/slash')).toBe('leading/slash');
  });
  it('rejects empty and null-byte paths', () => {
    expect(() => sanitizeUserPath('')).toThrow();
    expect(() => sanitizeUserPath('foo\0bar')).toThrow();
  });
});
