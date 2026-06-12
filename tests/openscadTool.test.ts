import { afterEach, describe, expect, it, vi } from 'vitest';
import { runTool } from '../src/components/Chat/tools/registry';
import { ipcService } from '../src/services/ipcService';
import { clearScene, getSceneObjects } from '../src/services/sceneStore';

describe('openscad_generate tool', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearScene();
  });

  it('fails early when health check reports runtime unavailable', async () => {
    vi.spyOn(ipcService, 'mcpGatewayCall').mockResolvedValue({
      ok: true,
      data: { ok: false, note: 'OpenSCAD CLI not found.' }
    });

    const out = await runTool('openscad_generate', {
      action: 'compile',
      source: 'cube(1);'
    });

    expect(out).toContain('OpenSCAD runtime unavailable');
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
          source: { sourceHash: 'abc123', paramsHash: 'p1' },
          modelSourcePath: 'generated/openscad/abc123-p1.stl',
          artifact: { name: 'first.stl' },
          payloadBase64: 'ZmFrZQ==',
          durationMs: 100
        }
      })
      .mockResolvedValueOnce({ ok: true, data: { ok: true } })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          ok: true,
          source: { sourceHash: 'abc123', paramsHash: 'p1' },
          modelSourcePath: 'generated/openscad/abc123-p1.stl',
          artifact: { name: 'second.stl' },
          payloadBase64: 'ZmFrZTI=',
          durationMs: 120
        }
      });

    const first = await runTool('openscad_generate', { action: 'compile', source: 'cube(1);' });
    const second = await runTool('openscad_generate', { action: 'compile', source: 'cube(1);' });

    expect(first).toContain('Compiled OpenSCAD to STL');
    expect(second).toContain('Replaced prior model(s)');

    const models = getSceneObjects().filter((obj) => obj.kind === 'model');
    expect(models).toHaveLength(1);
    expect(models[0].name).toBe('second.stl');
    expect(models[0].sourceKey).toBe('openscad:abc123:p1');
    expect(models[0].engineKind).toBe('openscad');
  });

  it('keeps prior models when createNew is true', async () => {
    const call = vi.spyOn(ipcService, 'mcpGatewayCall');
    call
      .mockResolvedValueOnce({ ok: true, data: { ok: true } })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          ok: true,
          source: { sourceHash: 'abc123', paramsHash: 'p1' },
          modelSourcePath: 'generated/openscad/abc123-p1.stl',
          artifact: { name: 'first.stl' },
          payloadBase64: 'ZmFrZQ=='
        }
      })
      .mockResolvedValueOnce({ ok: true, data: { ok: true } })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          ok: true,
          source: { sourceHash: 'abc123', paramsHash: 'p1' },
          modelSourcePath: 'generated/openscad/abc123-p1.stl',
          artifact: { name: 'second.stl' },
          payloadBase64: 'ZmFrZTI='
        }
      });

    await runTool('openscad_generate', { action: 'compile', source: 'cube(1);' });
    const out = await runTool('openscad_generate', { action: 'compile', source: 'cube(1);', createNew: true });

    expect(out).toContain('Created a new model entry.');
    const models = getSceneObjects().filter((obj) => obj.kind === 'model');
    expect(models).toHaveLength(2);
  });
});
