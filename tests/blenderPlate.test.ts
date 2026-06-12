import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildBlenderPlate } from '../mcp/lib/blenderPlate.mjs';

describe('buildBlenderPlate validation', () => {
  it('requires exactly one source mode', async () => {
    const none = await buildBlenderPlate({});
    expect(none.ok).toBe(false);
    expect(none.errorCategory).toBe('VALIDATION_ERROR');

    const both = await buildBlenderPlate({ source: 'import bpy', sourcePath: 'script.py' });
    expect(both.ok).toBe(false);
    expect(both.errorCategory).toBe('VALIDATION_ERROR');
  });

  it('rejects unsupported formats', async () => {
    const out = await buildBlenderPlate({ source: 'import bpy', format: 'fbx' });
    expect(out.ok).toBe(false);
    expect(out.errorCategory).toBe('VALIDATION_ERROR');
  });

  it('rejects blocked python patterns', async () => {
    const out = await buildBlenderPlate({ source: 'import subprocess\nprint("bad")' });
    expect(out.ok).toBe(false);
    expect(out.errorCategory).toBe('VALIDATION_ERROR');
  });

  it('rejects sourcePath mode when resolver is missing', async () => {
    const out = await buildBlenderPlate({ sourcePath: 'scripts/cube.py' });
    expect(out.ok).toBe(false);
    expect(out.errorCategory).toBe('VALIDATION_ERROR');
  });

  it('rejects empty inline source', async () => {
    const out = await buildBlenderPlate({ source: '   ' });
    expect(out.ok).toBe(false);
    expect(out.errorCategory).toBe('VALIDATION_ERROR');
  });

  it('rejects non-.py sourcePath targets', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blender-plate-test-'));
    const txtPath = path.join(tempDir, 'script.txt');
    fs.writeFileSync(txtPath, 'import bpy', 'utf8');

    const out = await buildBlenderPlate(
      { sourcePath: 'script.txt' },
      {
        resolveSourcePath: () => ({ target: txtPath, relPath: 'script.txt' })
      }
    );

    expect(out.ok).toBe(false);
    expect(out.errorCategory).toBe('VALIDATION_ERROR');
  });
});
