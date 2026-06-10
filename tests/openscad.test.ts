import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compileOpenScad, normalizeOpenScadParameterMap } from '../mcp/lib/openscad.mjs';

describe('normalizeOpenScadParameterMap', () => {
  it('serializes number, boolean, and string parameters to -D args', () => {
    const args = normalizeOpenScadParameterMap({ width: 10, centered: true, label: 'demo' });
    expect(args).toContain('-Dwidth=10');
    expect(args).toContain('-Dcentered=true');
    expect(args).toContain('-Dlabel="demo"');
  });

  it('rejects invalid parameter names', () => {
    expect(() => normalizeOpenScadParameterMap({ 'bad-key': 1 })).toThrow(/Invalid parameter name/);
  });

  it('rejects unsupported value types', () => {
    expect(() => normalizeOpenScadParameterMap({ nested: { x: 1 } })).toThrow(/Unsupported parameter type/);
  });
});

describe('compileOpenScad validation', () => {
  it('requires exactly one source mode', async () => {
    const none = await compileOpenScad({});
    expect(none.ok).toBe(false);
    expect(none.errorCategory).toBe('VALIDATION_ERROR');

    const both = await compileOpenScad({ source: 'cube(1);', sourcePath: 'a.scad' });
    expect(both.ok).toBe(false);
    expect(both.errorCategory).toBe('VALIDATION_ERROR');
  });

  it('rejects invalid parameter payloads before runtime execution', async () => {
    const out = await compileOpenScad({ source: 'cube(2);', parameters: { 'not-valid-name': 1 } });
    expect(out.ok).toBe(false);
    expect(out.errorCategory).toBe('VALIDATION_ERROR');
  });

  it('rejects sourcePath mode when resolver is missing', async () => {
    const out = await compileOpenScad({ sourcePath: 'parts/cube.scad' });
    expect(out.ok).toBe(false);
    expect(out.errorCategory).toBe('VALIDATION_ERROR');
  });

  it('rejects non-.scad sourcePath targets', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openscad-test-'));
    const txtPath = path.join(tempDir, 'model.txt');
    fs.writeFileSync(txtPath, 'cube(1);', 'utf8');

    const out = await compileOpenScad(
      { sourcePath: 'model.txt' },
      {
        resolveSourcePath: () => ({ target: txtPath, relPath: 'model.txt' })
      }
    );

    expect(out.ok).toBe(false);
    expect(out.errorCategory).toBe('VALIDATION_ERROR');
  });
});
