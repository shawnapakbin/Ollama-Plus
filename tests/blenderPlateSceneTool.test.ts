import { afterEach, describe, expect, it, vi } from 'vitest';
import { runTool } from '../src/components/Chat/tools/registry';
import { ipcService } from '../src/services/ipcService';
import { addPrimitive, clearScene, getSceneObjects } from '../src/services/sceneStore';

describe('blender_plate_scene tool', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearScene();
  });

  it('adds and lists Blender-owned primitives', async () => {
    const addOut = await runTool('blender_plate_scene', {
      action: 'add',
      kind: 'sphere',
      color: '#00ff99'
    });

    expect(addOut).toContain('Blender Plate scene: added sphere');

    const listOut = await runTool('blender_plate_scene', { action: 'list' });
    const parsed = JSON.parse(listOut) as { engine: string; totalObjects: number; objects: Array<{ engineKind: string; kind: string }> };

    expect(parsed.engine).toBe('blender_plate');
    expect(parsed.totalObjects).toBe(1);
    expect(parsed.objects[0].engineKind).toBe('blender_plate');
    expect(parsed.objects[0].kind).toBe('sphere');
  });

  it('blocks transform/remove of non-Blender owned objects', async () => {
    const legacy = addPrimitive({ kind: 'box', engineKind: 'legacy_scene3d' });

    const transformOut = await runTool('blender_plate_scene', {
      action: 'transform',
      id: legacy.id,
      color: '#ff0000'
    });
    expect(transformOut).toContain('not Blender Plate-owned');

    const removeOut = await runTool('blender_plate_scene', {
      action: 'remove',
      id: legacy.id
    });
    expect(removeOut).toContain('not Blender Plate-owned');
  });

  it('delegates build action to Blender Plate generator handler', async () => {
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
          artifact: { name: 'scene.glb' },
          payloadBase64: 'ZmFrZQ=='
        }
      });

    const out = await runTool('blender_plate_scene', {
      action: 'build',
      source: 'import bpy\nbpy.ops.mesh.primitive_cube_add()'
    });

    expect(out).toContain('Blender Plate scene build ->');
    expect(out).toContain('Built Blender Plate model');

    const models = getSceneObjects().filter((obj) => obj.kind === 'model');
    expect(models).toHaveLength(1);
    expect(models[0].engineKind).toBe('blender_plate');
  });

  it('clear removes only Blender-owned objects', async () => {
    addPrimitive({ kind: 'box', engineKind: 'legacy_scene3d' });
    addPrimitive({ kind: 'sphere', engineKind: 'blender_plate' });
    addPrimitive({ kind: 'cone', engineKind: 'blender_plate' });

    const out = await runTool('blender_plate_scene', { action: 'clear' });
    expect(out).toContain('cleared 2 object(s)');

    const remaining = getSceneObjects();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].engineKind).toBe('legacy_scene3d');
  });

  it('list returns only Blender-owned objects in mixed scenes', async () => {
    addPrimitive({ kind: 'box', engineKind: 'legacy_scene3d', name: 'legacy-box' });
    addPrimitive({ kind: 'sphere', engineKind: 'blender_plate', name: 'blender-sphere' });
    addPrimitive({ kind: 'cone', engineKind: 'openscad', name: 'openscad-cone' });

    const out = await runTool('blender_plate_scene', { action: 'list' });
    const parsed = JSON.parse(out) as { totalObjects: number; objects: Array<{ engineKind: string; name: string }> };

    expect(parsed.totalObjects).toBe(1);
    expect(parsed.objects[0].engineKind).toBe('blender_plate');
    expect(parsed.objects[0].name).toBe('blender-sphere');
  });
});
