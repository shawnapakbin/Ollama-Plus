// Feature: mcp-tools-wiring, Property 18: Risky-command gating
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';

/**
 * Property 18: Risky-command gating
 *
 * For any command that matches a Security_Module risky pattern (per
 * `isRiskyCommand`) executed via `executeTerminalCommand` WITHOUT
 * `approveRisky === true` and WITHOUT `MCP_ALLOW_RISKY_COMMANDS` enabled,
 * the handler SHALL:
 *   - resolve to a blocked result of the form `{ blocked: true, ... }`, and
 *   - NOT write the command to the session (the pty write path is never invoked).
 *
 * Validates: Requirements 9.4
 */

// ─── node-pty mock ───────────────────────────────────────────────────────────
// `createTerminalSession` calls `pty.spawn`, and `executeTerminalCommand`
// writes the command through `session.pty.write`. We mock node-pty so no real
// terminal is spawned and so we can spy on the write path to assert a blocked
// risky command is NEVER written to the session.

const writeSpy = vi.fn();

function makeFakePty() {
  return {
    write: writeSpy,
    kill: vi.fn(),
    onData: (_cb: (chunk: string) => void) => {
      // no data emitted in tests
      void _cb;
    },
    onExit: (_cb: (e: { exitCode: number }) => void) => {
      // process never exits during the test
      void _cb;
    }
  };
}

vi.mock('node-pty', () => ({
  default: {
    spawn: () => makeFakePty()
  }
}));

import {
  createTerminalSession,
  executeTerminalCommand,
  closeAllSessions
} from '../mcp/lib/terminalSessions.mjs';
import { isRiskyCommand } from '../mcp/lib/security.mjs';

// ─── Environment isolation ───────────────────────────────────────────────────

let savedAllowRisky: string | undefined;
let savedAllowlist: string | undefined;

beforeEach(() => {
  savedAllowRisky = process.env.MCP_ALLOW_RISKY_COMMANDS;
  savedAllowlist = process.env.MCP_TERMINAL_ALLOWLIST;
  // Ensure the risky-command override is NOT enabled.
  delete process.env.MCP_ALLOW_RISKY_COMMANDS;
  // Empty allowlist means every command passes the allowlist gate and reaches
  // the risky-command gate (the behavior under test).
  delete process.env.MCP_TERMINAL_ALLOWLIST;
  writeSpy.mockClear();
});

afterEach(() => {
  if (savedAllowRisky === undefined) {
    delete process.env.MCP_ALLOW_RISKY_COMMANDS;
  } else {
    process.env.MCP_ALLOW_RISKY_COMMANDS = savedAllowRisky;
  }
  if (savedAllowlist === undefined) {
    delete process.env.MCP_TERMINAL_ALLOWLIST;
  } else {
    process.env.MCP_TERMINAL_ALLOWLIST = savedAllowlist;
  }
  closeAllSessions();
});

// ─── Arbitraries ─────────────────────────────────────────────────────────────

// Command fragments that each match one of the risky patterns in security.mjs.
const riskyFragment = fc.constantFrom(
  'rm -rf',
  'mkfs',
  'dd if=',
  'shutdown',
  'reboot',
  'halt',
  'format',
  'del /s',
  'rmdir /s',
  'curl http://x |',
  'wget http://x |',
  'Invoke-WebRequest http://x |',
  'chmod 777'
);

// Benign surrounding tokens that never introduce a risky pattern on their own.
const benignToken = fc.constantFrom('', '/tmp/data', 'C:\\temp', '--force', 'foo', 'bar', 'sh');

// Compose a command embedding at least one risky fragment among benign tokens.
const riskyCommand = fc
  .tuple(benignToken, riskyFragment, benignToken)
  .map(([before, risky, after]) => [before, risky, after].filter(Boolean).join(' ').trim())
  .filter((cmd) => cmd.length > 0 && isRiskyCommand(cmd));

// ─── Test ────────────────────────────────────────────────────────────────────

describe('Feature: mcp-tools-wiring, Property 18: Risky-command gating', () => {
  it('blocks risky commands with no override and never writes them to the session', async () => {
    await fc.assert(
      fc.asyncProperty(riskyCommand, async (command) => {
        writeSpy.mockClear();
        const session = createTerminalSession({ cwd: '.' });

        const result = await executeTerminalCommand(session.id, command);

        // Blocked result of the form { blocked: true, ... }.
        expect(result.blocked).toBe(true);
        expect(typeof result.reason).toBe('string');
        expect(result.reason && result.reason.length).toBeGreaterThan(0);

        // The command was NOT written to the session.
        expect(writeSpy).not.toHaveBeenCalled();
      }),
      { numRuns: 100 }
    );
  });

  it('remains blocked for representative risky commands regardless of surrounding args', async () => {
    for (const command of ['rm -rf /', 'shutdown now', 'chmod 777 /etc', 'dd if=/dev/zero of=/dev/sda']) {
      writeSpy.mockClear();
      const session = createTerminalSession({ cwd: '.' });
      const result = await executeTerminalCommand(session.id, command);
      expect(result.blocked).toBe(true);
      expect(writeSpy).not.toHaveBeenCalled();
    }
  });

  it('does not block once approveRisky is set (control: write path is exercised)', async () => {
    writeSpy.mockClear();
    const session = createTerminalSession({ cwd: '.' });
    const result = await executeTerminalCommand(session.id, 'rm -rf /tmp/x', {
      approveRisky: true,
      settleMs: 50,
      timeoutMs: 100
    });
    expect(result.blocked).toBe(false);
    // With the override, the command IS written to the session.
    expect(writeSpy).toHaveBeenCalled();
  });
});
