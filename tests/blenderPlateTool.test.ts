import { afterEach, describe, expect, it, vi } from 'vitest';
import { runTool } from '../src/components/Chat/tools/registry';
import { ipcService } from '../src/services/ipcService';
import { clearScene, getSceneObjects } from '../src/services/sceneStore';

describe('blender_plate_generate tool', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearScene();
  });

  it('fails early when health check reports runtime unavailable', async () => {
    vi.spyOn(ipcService, 'mcpGatewayCall').mockResolvedValue({
      ok: true,
      data: { ok: false, note: 'Blender CLI not found.' }
    });

    const out = await runTool('blender_plate_generate', {
      action: 'build',
      source: 'import bpy\nbpy.ops.mesh.primitive_cube_add()'
    });

    expect(out).toContain('Blender Plate runtime unavailable');
    expect(getSceneObjects()).toHaveLength(0);
  });

  it('replaces existing model by sourceKey when createNew is false', async () => {
    const call = vi.spyOn(ipcService, 'mcpGatewayCall');
    call
      .mockResolvedValueOnce({ ok: true, data: { ok: true } })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          ok: true,
          format: 'glb',
          source: { sourceHash: 'abc123' },
          modelSourcePath: 'generated/blender_plate/abc123.glb',
          artifact: { name: 'first.glb' },
          payloadBase64: 'ZmFrZQ==',
          durationMs: 100
        }
      })
      .mockResolvedValueOnce({ ok: true, data: { ok: true } })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          ok: true,
          format: 'glb',
          source: { sourceHash: 'abc123' },
          modelSourcePath: 'generated/blender_plate/abc123.glb',
          artifact: { name: 'second.glb' },
          payloadBase64: 'ZmFrZTI=',
          durationMs: 120
        }
      });

    const first = await runTool('blender_plate_generate', {
      action: 'build',
      source: 'import bpy\nbpy.ops.mesh.primitive_cube_add()'
    });
    const second = await runTool('blender_plate_generate', {
      action: 'build',
      source: 'import bpy\nbpy.ops.mesh.primitive_cube_add()'
    });

    expect(first).toContain('Built Blender Plate model');
    expect(second).toContain('Replaced prior model(s)');

    const models = getSceneObjects().filter((obj) => obj.kind === 'model');
    expect(models).toHaveLength(1);
    expect(models[0].name).toBe('second.glb');
    expect(models[0].sourceKey).toBe('blender_plate:abc123:glb');
    expect(models[0].engineKind).toBe('blender_plate');
  });

  it('routes .scad sourcePath to OpenSCAD fallback by default', async () => {
    const call = vi.spyOn(ipcService, 'mcpGatewayCall');
    call
      .mockResolvedValueOnce({ ok: true, data: { ok: true } })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          ok: true,
          source: { sourceHash: 'scad1', paramsHash: 'p1' },
          modelSourcePath: 'generated/openscad/scad1-p1.stl',
          artifact: { name: 'fallback.stl' },
          payloadBase64: 'ZmFrZQ=='
        }
      });

    const out = await runTool('blender_plate_generate', {
      action: 'build',
      sourcePath: 'parts/bracket.scad'
    });

    expect(out).toContain('Blender Plate fallback ->');
    expect(out).toContain('Compiled OpenSCAD to STL');
  });

  it('falls back to OpenSCAD when Blender runtime is unavailable for SCAD-like inline source', async () => {
    const call = vi.spyOn(ipcService, 'mcpGatewayCall');
    call
      .mockResolvedValueOnce({ ok: true, data: { ok: false, note: 'Blender missing' } })
      .mockResolvedValueOnce({ ok: true, data: { ok: true } })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          ok: true,
          source: { sourceHash: 'scad2', paramsHash: 'p2' },
          modelSourcePath: 'generated/openscad/scad2-p2.stl',
          artifact: { name: 'fallback-inline.stl' },
          payloadBase64: 'ZmFrZQ=='
        }
      });

    const out = await runTool('blender_plate_generate', {
      action: 'build',
      source: 'cube([1,2,3]);'
    });

    expect(out).toContain('Blender Plate fallback (runtime unavailable) ->');
    expect(out).toContain('Compiled OpenSCAD to STL');
  });

  it('falls back to OpenSCAD when Blender build returns an error for SCAD-like inline source', async () => {
    const call = vi.spyOn(ipcService, 'mcpGatewayCall');
    call
      .mockResolvedValueOnce({ ok: true, data: { ok: true } })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          ok: false,
          errorCategory: 'COMPILE_ERROR',
          error: 'Blender compile failed'
        }
      })
      .mockResolvedValueOnce({ ok: true, data: { ok: true } })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          ok: true,
          source: { sourceHash: 'scad3', paramsHash: 'p3' },
          modelSourcePath: 'generated/openscad/scad3-p3.stl',
          artifact: { name: 'fallback-after-build-error.stl' },
          payloadBase64: 'ZmFrZQ=='
        }
      });

    const out = await runTool('blender_plate_generate', {
      action: 'build',
      source: 'sphere(r=3);'
    });

    expect(out).toContain('Blender Plate fallback (COMPILE_ERROR) ->');
    expect(out).toContain('Compiled OpenSCAD to STL');
  });

  it('does not fallback when fallbackToOpenScad is false', async () => {
    const call = vi.spyOn(ipcService, 'mcpGatewayCall');
    call
      .mockResolvedValueOnce({ ok: true, data: { ok: false, note: 'Blender disabled' } });

    const out = await runTool('blender_plate_generate', {
      action: 'build',
      source: 'cube(4);',
      fallbackToOpenScad: false
    });

    expect(out).toContain('Blender Plate runtime unavailable');
    expect(out).not.toContain('fallback');
  });

  it('reports disabled Blender runtime for non-SCAD source without fallback', async () => {
    const call = vi.spyOn(ipcService, 'mcpGatewayCall');
    call
      .mockResolvedValueOnce({ ok: true, data: { ok: false, note: 'Blender feature disabled' } });

    const out = await runTool('blender_plate_generate', {
      action: 'build',
      source: 'import bpy\nbpy.ops.mesh.primitive_cube_add()'
    });

    expect(out).toContain('Blender Plate runtime unavailable');
    expect(out).toContain('Blender feature disabled');
  });
});
