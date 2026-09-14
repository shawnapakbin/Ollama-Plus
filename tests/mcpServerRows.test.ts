// Feature: mcp-tools-wiring, Task 13.2: Status UI row mapping example tests
// Validates: Requirements 11.4, 11.5

import { describe, expect, it } from 'vitest';
import {
  applyMcpGatewayStatusFailure,
  buildMcpServerRows,
  defaultMcpServerRows,
  type McpServerStatusRow
} from '../src/lib/mcpServerRows';

/**
 * Example tests for the Status UI row mapping (src/lib/mcpServerRows.ts).
 *
 * These verify the two behaviours the design requires of the Status UI:
 *  1. A full probe result maps to exactly seven rows with the correct
 *     availability state, tone, and note for the gateway and each of the six
 *     services (browser, terminal, folder, python, openscad, blender_plate),
 *     including the python.docker / openscad.executable / blender_plate.executable
 *     detail mapping. (Requirement 11.4)
 *  2. On an mcpGatewayStatus() request failure only the gateway row is forced
 *     offline while the other six rows preserve their last-known values.
 *     (Requirement 11.5)
 */

const SEVEN_IDS = ['gateway', 'browser', 'terminal', 'folder', 'python', 'openscad', 'blender_plate'];

function rowById(rows: McpServerStatusRow[], id: string): McpServerStatusRow {
  const row = rows.find((r) => r.id === id);
  if (!row) throw new Error(`row not found: ${id}`);
  return row;
}

describe('buildMcpServerRows — full probe result mapping (Requirement 11.4)', () => {
  const probe = {
    checkedAt: '2024-01-01T00:00:00.000Z',
    gateway: { ok: true, note: 'Gateway online: 20 routes registered' },
    services: {
      browser: { ok: true, activeSessionCount: 2 },
      terminal: { ok: true, note: 'Terminal ready' },
      folder: { ok: false, note: 'File root unreachable' },
      python: { ok: true, note: 'Python sandbox ready', docker: 'Docker version 24.0.7' },
      openscad: { ok: true, note: 'OpenSCAD available', executable: 'openscad' },
      blender_plate: { ok: false, note: 'Blender not found', executable: 'blender' }
    }
  };

  const rows = buildMcpServerRows(probe);

  it('yields exactly seven rows for the gateway plus six services', () => {
    expect(rows).toHaveLength(7);
    expect(rows.map((r) => r.id)).toEqual(SEVEN_IDS);
  });

  it('maps the gateway availability and note', () => {
    const gateway = rowById(rows, 'gateway');
    expect(gateway.state).toBe('online');
    expect(gateway.tone).toBe('ok');
    expect(gateway.detail).toBe('Gateway online: 20 routes registered');
  });

  it('maps the browser row from its active session count', () => {
    const browser = rowById(rows, 'browser');
    expect(browser.state).toBe('active');
    expect(browser.tone).toBe('ok');
    expect(browser.detail).toBe('Active sessions: 2');
  });

  it('maps an available service (terminal) with its note', () => {
    const terminal = rowById(rows, 'terminal');
    expect(terminal.state).toBe('online');
    expect(terminal.tone).toBe('ok');
    expect(terminal.detail).toBe('Terminal ready');
  });

  it('maps an unavailable service (folder) as offline/danger with its note', () => {
    const folder = rowById(rows, 'folder');
    expect(folder.state).toBe('offline');
    expect(folder.tone).toBe('danger');
    expect(folder.detail).toBe('File root unreachable');
  });

  it('maps python using its docker detail and ok tone when available', () => {
    const python = rowById(rows, 'python');
    expect(python.state).toBe('online');
    expect(python.tone).toBe('ok');
    expect(python.detail).toBe('Docker version 24.0.7');
  });

  it('maps openscad note and appends its executable', () => {
    const openscad = rowById(rows, 'openscad');
    expect(openscad.state).toBe('online');
    expect(openscad.tone).toBe('ok');
    expect(openscad.detail).toBe('OpenSCAD available (openscad)');
  });

  it('maps an unavailable blender_plate as offline with note and executable', () => {
    const blender = rowById(rows, 'blender_plate');
    expect(blender.state).toBe('offline');
    expect(blender.tone).toBe('danger');
    expect(blender.detail).toBe('Blender not found (blender)');
  });

  it('marks python with a warn tone when docker is reported but the service is down', () => {
    const downRows = buildMcpServerRows({
      gateway: { ok: true },
      services: {
        python: { ok: false, docker: 'Docker unavailable' }
      }
    });
    const python = rowById(downRows, 'python');
    expect(python.state).toBe('offline');
    expect(python.tone).toBe('warn');
    expect(python.detail).toBe('Docker unavailable');
  });
});

describe('applyMcpGatewayStatusFailure — request failure (Requirement 11.5)', () => {
  it('forces only the gateway row offline and preserves the other six rows', () => {
    // Establish a last-known state from a successful probe.
    const priorRows = buildMcpServerRows({
      gateway: { ok: true, note: 'Gateway online' },
      services: {
        browser: { ok: true, activeSessionCount: 1 },
        terminal: { ok: true, note: 'Terminal ready' },
        folder: { ok: true, note: 'Folder ready' },
        python: { ok: true, note: 'Python ready', docker: 'Docker version 24.0.7' },
        openscad: { ok: true, note: 'OpenSCAD available', executable: 'openscad' },
        blender_plate: { ok: true, note: 'Blender available', executable: 'blender' }
      }
    });

    const message = 'MCP gateway status request failed.';
    const nextRows = applyMcpGatewayStatusFailure(priorRows, message);

    // Same seven-row shape and identity ordering.
    expect(nextRows).toHaveLength(7);
    expect(nextRows.map((r) => r.id)).toEqual(SEVEN_IDS);

    // Only the gateway row goes offline, carrying the failure message.
    const gateway = rowById(nextRows, 'gateway');
    expect(gateway.state).toBe('offline');
    expect(gateway.tone).toBe('danger');
    expect(gateway.detail).toBe(message);

    // Every non-gateway row retains its prior values exactly.
    for (const id of SEVEN_IDS.filter((x) => x !== 'gateway')) {
      expect(rowById(nextRows, id)).toEqual(rowById(priorRows, id));
    }
  });

  it('does not force other rows offline even when they were previously offline', () => {
    const priorRows = defaultMcpServerRows().map((row) =>
      row.id === 'terminal'
        ? { ...row, state: 'online', tone: 'ok' as const, detail: 'Terminal ready' }
        : row
    );

    const nextRows = applyMcpGatewayStatusFailure(priorRows, 'boom');

    const terminal = rowById(nextRows, 'terminal');
    expect(terminal.state).toBe('online');
    expect(terminal.tone).toBe('ok');
    expect(terminal.detail).toBe('Terminal ready');

    expect(rowById(nextRows, 'gateway').state).toBe('offline');
  });
});
