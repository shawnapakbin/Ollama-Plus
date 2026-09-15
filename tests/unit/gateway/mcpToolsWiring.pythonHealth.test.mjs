// Feature: mcp-tools-wiring, Task 15.3: Health-check example test
//
// Exercises the actual `python::health` handler registered by
// registerGatewayRoutes (the importable seam extracted from electron/main.js).
// The handler adapts the injected checkDockerAvailable dependency:
//   - on success it returns { ok: true, docker: <detected version string> }
//   - on failure it returns { ok: false, error: <message> }
//
// This is an example test (specific cases), not a property test: it registers
// routes on a fresh gateway with a stubbed checkDockerAvailable and dispatches
// python::health for both the available and unavailable paths.
//
// Validates: Requirements 3.7, 10.3

import { describe, expect, it, vi } from 'vitest';
import { createGateway } from '../../../mcp/lib/gateway.mjs';
import { registerGatewayRoutes } from '../../../mcp/lib/registerGatewayRoutes.mjs';

// ─── Stub dependencies ───────────────────────────────────────────────────────
//
// The python::health handler only touches checkDockerAvailable; every other
// dependency is a no-op stub. Path helpers return benign values so registration
// (which never invokes handlers) stays side-effect free.
const noop = () => undefined;

function makeStubDeps(overrides = {}) {
  return {
    // Browser
    createBrowserSession: noop,
    listBrowserSessions: noop,
    closeBrowserSession: noop,
    createBrowserPage: noop,
    listBrowserPages: noop,
    activateBrowserPage: noop,
    closeBrowserPage: noop,
    executeBrowserSessionAction: noop,
    // Terminal
    createTerminalSession: noop,
    listTerminalSessions: noop,
    readTerminalOutput: noop,
    writeTerminalInput: noop,
    executeTerminalCommand: noop,
    closeTerminalSession: noop,
    // Folder
    listDirectory: noop,
    readTextFile: noop,
    writeTextFile: noop,
    createTextFile: noop,
    deletePath: noop,
    renamePath: noop,
    // Python sandbox — checkDockerAvailable is the dependency under test.
    checkDockerAvailable: noop,
    runSandboxedPython: noop,
    listSandboxRuns: noop,
    readRunArtifact: noop,
    // OpenSCAD
    checkOpenScadHealth: noop,
    compileOpenScad: noop,
    // Blender Plate
    checkBlenderPlateHealth: noop,
    buildBlenderPlate: noop,
    // Path confinement
    getFileRoot: () => '/tmp/file-root',
    resolveInsideRoot: (_root, rel) => `/tmp/file-root/${String(rel || '')}`,
    relativePath: (_from, to) => String(to || ''),
    ...overrides
  };
}

/**
 * Register routes on a fresh gateway with a specific checkDockerAvailable stub
 * and return the gateway so the caller can dispatch python::health.
 */
function makeGatewayWith(checkDockerAvailable) {
  const gateway = createGateway();
  registerGatewayRoutes(gateway, makeStubDeps({ checkDockerAvailable }));
  return gateway;
}

describe('Feature: mcp-tools-wiring, Task 15.3: python::health handler', () => {
  /**
   * **Validates: Requirements 3.7, 10.3**
   *
   * Available path: checkDockerAvailable resolves the detected Docker version
   * string, so the health handler reports ok:true and echoes that exact version
   * under `docker`.
   */
  it('reports ok:true with the detected Docker version when Docker is available', async () => {
    const detectedVersion = 'Docker version 27.1.1, build 6312585';
    const checkDockerAvailable = vi.fn().mockResolvedValue(detectedVersion);
    const gateway = makeGatewayWith(checkDockerAvailable);

    const result = await gateway.dispatch({ server: 'python', action: 'health' });

    expect(checkDockerAvailable).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    expect(result.docker).toBe(detectedVersion);
    // The available path carries no error field.
    expect(result.error).toBeUndefined();
  });

  /**
   * **Validates: Requirements 3.7, 10.3**
   *
   * Unavailable path: checkDockerAvailable rejects (Docker not installed / not
   * on PATH / probe failed), so the handler reports ok:false with a non-null
   * error message indicating Docker is unavailable, and no `docker` version.
   */
  it('reports ok:false with a Docker-unavailable error when Docker is unavailable', async () => {
    const checkDockerAvailable = vi
      .fn()
      .mockRejectedValue(new Error('Docker unavailable: spawn docker ENOENT'));
    const gateway = makeGatewayWith(checkDockerAvailable);

    const result = await gateway.dispatch({ server: 'python', action: 'health' });

    expect(checkDockerAvailable).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    expect(result.error).not.toBeNull();
    expect(result.error).not.toBeUndefined();
    expect(result.error).toMatch(/docker unavailable/i);
    // The failure path carries no detected version.
    expect(result.docker).toBeUndefined();
  });

  /**
   * A non-Error rejection is still surfaced as a non-null error string, so the
   * unavailable contract holds regardless of what checkDockerAvailable throws.
   */
  it('coerces a non-Error rejection into a non-null error string', async () => {
    const checkDockerAvailable = vi.fn().mockRejectedValue('docker missing');
    const gateway = makeGatewayWith(checkDockerAvailable);

    const result = await gateway.dispatch({ server: 'python', action: 'health' });

    expect(result.ok).toBe(false);
    expect(typeof result.error).toBe('string');
    expect(result.error).toBe('docker missing');
  });
});
