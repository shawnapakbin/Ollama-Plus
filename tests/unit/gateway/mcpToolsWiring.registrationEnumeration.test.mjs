// Feature: mcp-tools-wiring, Task 15.1: Registration-enumeration example test
//
// Asserts the exact set of Gateway_Routes registered by registerGatewayRoutes
// (the importable seam extracted from electron/main.js) for each wired server:
//
//   terminal      -> 6 actions
//   folder        -> 6 actions
//   python        -> 4 actions
//   openscad      -> 2 actions (health, compile)
//   blender_plate -> 2 actions (health, build)
//
// matching the Browser registration pattern (8 actions) and requiring every
// route to carry valid metadata (non-empty description string, parameters object
// of type 'object'), exactly as the gateway's listTools reports.
//
// Validates: Requirements 1.1, 2.1, 3.1, 4.1, 5.1

import { describe, expect, it } from 'vitest';
import { createGateway } from '../../../mcp/lib/gateway.mjs';
import { registerGatewayRoutes } from '../../../mcp/lib/registerGatewayRoutes.mjs';

// ─── Stub dependencies ───────────────────────────────────────────────────────
//
// registerGatewayRoutes only wires handlers; it never invokes them at
// registration time. Each dependency is a no-op stub so the registration is
// pure and side-effect free. Path helpers return benign values.
const noop = () => undefined;

function makeStubDeps() {
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
    // Python sandbox
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
    relativePath: (_from, to) => String(to || '')
  };
}

/**
 * Register routes on a fresh gateway while recording every (server, action)
 * pair. The gateway keys routes as `${server}::${action}` and exposes them via
 * listTools with a name of `${server}_${action}`; because `blender_plate`
 * itself contains an underscore, we capture the segments directly by wrapping
 * `register` rather than parsing the composed name.
 */
function registerAndCapture() {
  const gateway = createGateway();
  const registered = [];
  const originalRegister = gateway.register;
  gateway.register = (server, action, handler, metadata) => {
    registered.push({ server: String(server), action: String(action) });
    return originalRegister(server, action, handler, metadata);
  };

  registerGatewayRoutes(gateway, makeStubDeps());
  gateway.register = originalRegister;

  return { gateway, registered };
}

/** Collect the set of actions registered under a given server. */
function actionsForServer(registered, server) {
  return registered
    .filter((entry) => entry.server === server)
    .map((entry) => entry.action);
}

// The expected route sets per server (the authoritative surface for this task).
const EXPECTED_ROUTES = {
  browser: ['create_session', 'list_sessions', 'close_session', 'create_page', 'list_pages', 'activate_page', 'close_page', 'action'],
  terminal: ['create_session', 'list_sessions', 'read_output', 'write_input', 'execute_command', 'close_session'],
  folder: ['list', 'read', 'write', 'create', 'delete', 'rename'],
  python: ['health', 'run', 'list_runs', 'read_artifact'],
  openscad: ['health', 'compile'],
  blender_plate: ['health', 'build']
};

describe('Feature: mcp-tools-wiring, Task 15.1: Registration enumeration', () => {
  /**
   * **Validates: Requirements 1.1, 2.1, 3.1, 4.1, 5.1**
   *
   * Each wired server exposes exactly its expected action set — no more, no
   * fewer — matching the Browser registration pattern.
   */
  it('registers exactly the expected action set for each wired server', () => {
    const { registered } = registerAndCapture();

    for (const [server, expected] of Object.entries(EXPECTED_ROUTES)) {
      const actual = actionsForServer(registered, server);

      // Exact count.
      expect(actual.length, `route count for server "${server}"`).toBe(expected.length);

      // Exact set (order-independent), with no duplicates.
      expect(new Set(actual)).toEqual(new Set(expected));
      expect(actual.length, `no duplicate actions for server "${server}"`).toBe(new Set(actual).size);
    }
  });

  it('registers the exact per-server route counts: terminal 6, folder 6, python 4, openscad 2, blender_plate 2', () => {
    const { registered } = registerAndCapture();

    expect(actionsForServer(registered, 'terminal').length).toBe(6);
    expect(actionsForServer(registered, 'folder').length).toBe(6);
    expect(actionsForServer(registered, 'python').length).toBe(4);
    expect(actionsForServer(registered, 'openscad').length).toBe(2);
    expect(actionsForServer(registered, 'blender_plate').length).toBe(2);

    // OpenSCAD and Blender Plate expose specifically health + compile/build.
    expect(new Set(actionsForServer(registered, 'openscad'))).toEqual(new Set(['health', 'compile']));
    expect(new Set(actionsForServer(registered, 'blender_plate'))).toEqual(new Set(['health', 'build']));
  });

  it('registers no routes for servers outside the expected set', () => {
    const { registered } = registerAndCapture();

    const registeredServers = new Set(registered.map((entry) => entry.server));
    const expectedServers = new Set(Object.keys(EXPECTED_ROUTES));
    expect(registeredServers).toEqual(expectedServers);
  });

  /**
   * Every enumerated route carries valid metadata: a non-empty description
   * string and a parameters object whose `type` is `'object'`.
   */
  it('gives every registered route valid metadata (non-empty description, parameters type "object")', () => {
    const { gateway } = registerAndCapture();
    const tools = gateway.listTools();

    // One tool entry per registered route across all six servers.
    const expectedTotal = Object.values(EXPECTED_ROUTES).reduce((sum, actions) => sum + actions.length, 0);
    expect(tools.length).toBe(expectedTotal);

    for (const tool of tools) {
      expect(typeof tool.description, `description type for ${tool.name}`).toBe('string');
      expect(tool.description.length, `description non-empty for ${tool.name}`).toBeGreaterThan(0);

      expect(tool.parameters, `parameters present for ${tool.name}`).toBeTypeOf('object');
      expect(tool.parameters).not.toBeNull();
      expect(Array.isArray(tool.parameters)).toBe(false);
      expect(tool.parameters.type, `parameters.type for ${tool.name}`).toBe('object');
    }
  });
});
