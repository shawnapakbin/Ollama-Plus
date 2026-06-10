import { describe, expect, it } from 'vitest';
import { createGateway } from '../mcp/lib/gateway.mjs';

describe('createGateway', () => {
  it('dispatches registered handlers', async () => {
    const gateway = createGateway();
    gateway.register('terminal', 'list', async () => ({ items: [1, 2] }));

    const res = await gateway.dispatchSafe({ server: 'terminal', action: 'list' });

    expect(res.ok).toBe(true);
    expect(res.data).toEqual({ items: [1, 2] });
  });

  it('normalizes unknown route errors', async () => {
    const gateway = createGateway({ sanitizeError: () => 'sanitized' });

    const res = await gateway.dispatchSafe({ server: 'missing', action: 'noop' });

    expect(res.ok).toBe(false);
    expect(res.error).toBe('sanitized');
  });

  it('returns status from provider', async () => {
    const gateway = createGateway();
    gateway.setStatusProvider(async () => ({ healthy: true }));

    const status = await gateway.statusSafe();

    expect(status.ok).toBe(true);
    expect(status.data).toEqual({ healthy: true });
  });

  it('dispatches wiki route handlers', async () => {
    const gateway = createGateway();
    gateway.register('wiki', 'upsert_note', async (payload) => ({ ok: true, path: payload.path }));

    const res = await gateway.dispatchSafe({
      server: 'wiki',
      action: 'upsert_note',
      payload: { path: 'knowledge/topics/general.md' }
    });

    expect(res.ok).toBe(true);
    expect(res.data).toEqual({ ok: true, path: 'knowledge/topics/general.md' });
  });
});
