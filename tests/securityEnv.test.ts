import { describe, expect, it } from 'vitest';
import { sanitizeEnv } from '../mcp/lib/security.mjs';

describe('sanitizeEnv', () => {
  it('preserves Windows Path-cased variables used for command resolution', () => {
    const clean = sanitizeEnv({
      Path: 'C:/Program Files/Blender Foundation/Blender',
      PATHEXT: '.EXE;.CMD',
      SYSTEMROOT: 'C:/Windows',
      COMSPEC: 'C:/Windows/System32/cmd.exe',
      WINDIR: 'C:/Windows',
      SECRET_TOKEN: 'should-not-pass'
    });

    expect(clean.Path).toContain('Blender');
    expect(clean.PATHEXT).toContain('.EXE');
    expect(clean.SYSTEMROOT).toBe('C:/Windows');
    expect(clean.COMSPEC).toContain('cmd.exe');
    expect(clean.WINDIR).toBe('C:/Windows');
    expect(clean.SECRET_TOKEN).toBeUndefined();
    expect(clean.MCP_SANDBOXED).toBe('1');
  });
});
