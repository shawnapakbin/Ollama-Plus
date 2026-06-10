import { afterEach, describe, expect, it, vi } from 'vitest';
import { runTool } from '../src/components/Chat/tools/registry';
import { ipcService } from '../src/services/ipcService';

describe('wiki tools', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses deterministic profile path for wiki_maintain upsert_note when category=profile', async () => {
    const spy = vi.spyOn(ipcService, 'upsertMcpWikiNote').mockResolvedValue({
      ok: true,
      path: 'profile/preferences.md'
    });

    const out = await runTool('wiki_maintain', {
      action: 'upsert_note',
      category: 'profile',
      content: '- likes concise answers',
      explicit: true
    });

    expect(spy).toHaveBeenCalledWith(
      'profile/preferences.md',
      '- likes concise answers',
      false,
      true,
      'profile'
    );
    expect(out).toContain('Saved wiki note to profile/preferences.md');
  });

  it('returns policy reason when wiki upsert is denied', async () => {
    vi.spyOn(ipcService, 'upsertMcpWikiNote').mockResolvedValue({
      ok: false,
      denied: true,
      reason: 'Knowledge policy is strict: write operations require explicit user intent.'
    });

    const out = await runTool('wiki_maintain', {
      action: 'upsert_note',
      category: 'knowledge',
      content: 'some inferred fact',
      explicit: false
    });

    expect(out).toContain('Wiki update denied by policy');
    expect(out).toContain('strict');
  });

  it('uses monthly journal default path for append_entry', async () => {
    const spy = vi.spyOn(ipcService, 'appendMcpWikiEntry').mockResolvedValue({
      ok: true,
      path: 'journal/2026-06.md'
    });

    const out = await runTool('wiki_maintain', {
      action: 'append_entry',
      entry: 'Added summary of research results.',
      category: 'journal',
      explicit: true
    });

    const call = spy.mock.calls[0];
    expect(call[0]).toBe('Added summary of research results.');
    expect(call[1]).toMatch(/^journal\/\d{4}-\d{2}\.md$/);
    expect(call[3]).toBe(true);
    expect(call[4]).toBe('journal');
    expect(out).toContain('Appended wiki entry');
  });

  it('routes update_user_memory through wiki MCP and surfaces deny result', async () => {
    vi.spyOn(ipcService, 'appendMcpWikiEntry').mockResolvedValue({
      ok: false,
      denied: true,
      reason: 'Knowledge policy is strict: write operations require explicit user intent.'
    });

    const out = await runTool('update_user_memory', {
      content: 'User likes terse output.'
    });

    expect(out).toContain('Memory update denied by wiki policy');
    expect(out).toContain('strict');
  });
});
