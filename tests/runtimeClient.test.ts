import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runtimeClient } from '../src/services/runtimeClient';

describe('runtimeClient gateway bridge', () => {
  const originalWindow = globalThis.window;

  beforeEach(() => {
    (globalThis as typeof globalThis & { window?: Window }).window = {
      electronAPI: {
        mcpGatewayStatus: vi.fn().mockResolvedValue({ ok: true, data: { gateway: { ok: true } } }),
        mcpGatewayCall: vi.fn().mockResolvedValue({ ok: true, data: { sessionId: 'abc' } })
      }
    } as unknown as Window;
  });

  afterEach(() => {
    if (typeof originalWindow === 'undefined') {
      delete (globalThis as typeof globalThis & { window?: Window }).window;
    } else {
      (globalThis as typeof globalThis & { window?: Window }).window = originalWindow;
    }
  });

  it('exposes MCP gateway status and call helpers through the preload bridge', async () => {
    await expect(runtimeClient.mcpGatewayStatus()).resolves.toEqual({ ok: true, data: { gateway: { ok: true } } });
    await expect(runtimeClient.mcpGatewayCall({ server: 'browser', action: 'list_sessions' })).resolves.toEqual({ ok: true, data: { sessionId: 'abc' } });
  });
});
