import { describe, expect, it } from 'vitest';
import { runTool } from '../src/components/Chat/tools/registry';

describe('scene_3d tool', () => {
  it('rejects direct .scad import and suggests OpenSCAD compile', async () => {
    const out = await runTool('scene_3d', {
      action: 'import_model',
      sourcePath: 'parts/bracket.scad'
    });

    expect(out).toContain('must be compiled');
    expect(out).toContain('openscad_generate');
  });
});
