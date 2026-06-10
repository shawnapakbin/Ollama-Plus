import { describe, expect, it, vi } from 'vitest';

const runToolMock = vi.fn();

vi.mock('../src/components/Chat/tools/registry', () => ({
  runTool: runToolMock
}));

describe('useToolRunner', () => {
  it('parses string arguments and returns a tool-role message', async () => {
    runToolMock.mockResolvedValueOnce('ok');
    const { useToolRunner } = await import('../src/components/Chat/hooks/useToolRunner');

    const { run } = useToolRunner();
    const out = await run({
      function: {
        name: 'scene_3d',
        arguments: '{"action":"list"}'
      }
    });

    expect(runToolMock).toHaveBeenCalledWith('scene_3d', { action: 'list' });
    expect(out).toEqual({ role: 'tool', content: 'ok', name: 'scene_3d' });
  });

  it('passes object arguments through without parsing', async () => {
    runToolMock.mockResolvedValueOnce('done');
    const { useToolRunner } = await import('../src/components/Chat/hooks/useToolRunner');

    const { run } = useToolRunner();
    await run({
      function: {
        name: 'web_search',
        arguments: { query: 'cats' }
      }
    });

    expect(runToolMock).toHaveBeenCalledWith('web_search', { query: 'cats' });
  });
});
