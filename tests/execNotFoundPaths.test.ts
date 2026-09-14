/**
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.1.0
 *
 * Example (not property) tests for the executable-not-found paths of the
 * OpenSCAD and Blender Plate tools.
 *
 * Feature: mcp-tools-wiring, Task 9.3
 * Validates: Requirements 4.6 (OpenSCAD handler returns an executable-not-found
 * failure naming the missing executable and produces no artifact) and 5.4 (the
 * Blender Plate handler does the same).
 *
 * Approach: the least invasive, non-brittle path. Both libraries honor an
 * executable-override environment variable (MCP_OPENSCAD_BIN / MCP_BLENDER_BIN).
 * Pointing these at a bogus, non-existent binary forces the `--version` probe in
 * selectOpenScadExecutable / selectBlenderExecutable to fail, so the handler
 * short-circuits to EXEC_NOT_FOUND before ever writing an artifact. A dedicated,
 * empty temp root lets us assert no output artifact was produced.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { compileOpenScad } from '../mcp/lib/openscad.mjs';
import { buildBlenderPlate } from '../mcp/lib/blenderPlate.mjs';

// A path that cannot resolve to a runnable executable. The `.version` probe
// spawnSync against it fails (ENOENT), which is exactly the "cannot be located
// or fails its version probe" condition in Requirements 4.6 / 5.4.
const BOGUS_BIN = path.join(
  os.tmpdir(),
  'ollama-plus-nonexistent-binary-do-not-create-abc123'
);

let tempRoot: string;

const originalOpenScadBin = process.env.MCP_OPENSCAD_BIN;
const originalBlenderBin = process.env.MCP_BLENDER_BIN;
const originalOpenScadTmp = process.env.MCP_OPENSCAD_TMP_ROOT;
const originalBlenderTmp = process.env.MCP_BLENDER_TMP_ROOT;

function restoreEnv(key: string, previous: string | undefined) {
  if (previous === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = previous;
  }
}

/** Recursively collects every file path under `dir` (empty if it does not exist). */
function collectFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectFiles(full));
    else out.push(full);
  }
  return out;
}

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-plus-exec-not-found-'));
  // Guarantee the bogus binary really is absent.
  expect(fs.existsSync(BOGUS_BIN)).toBe(false);
});

afterEach(() => {
  restoreEnv('MCP_OPENSCAD_BIN', originalOpenScadBin);
  restoreEnv('MCP_BLENDER_BIN', originalBlenderBin);
  restoreEnv('MCP_OPENSCAD_TMP_ROOT', originalOpenScadTmp);
  restoreEnv('MCP_BLENDER_TMP_ROOT', originalBlenderTmp);
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe('compileOpenScad — executable not found (Requirement 4.6)', () => {
  it('returns EXEC_NOT_FOUND naming the missing executable and produces no artifact', async () => {
    process.env.MCP_OPENSCAD_BIN = BOGUS_BIN;
    process.env.MCP_OPENSCAD_TMP_ROOT = tempRoot;

    const result = await compileOpenScad(
      { source: 'cube([10, 10, 10]);' },
      { tempRoot }
    );

    // Flagged as failed and categorized as executable-not-found.
    expect(result.ok).toBe(false);
    expect(result.errorCategory).toBe('EXEC_NOT_FOUND');

    // Error text identifies the missing executable (the OpenSCAD CLI).
    expect(typeof result.error).toBe('string');
    expect(result.error).toMatch(/openscad/i);

    // No output artifact was produced.
    expect(result.artifact).toBeUndefined();
    expect(result.payloadBase64).toBeUndefined();
    const stlFiles = collectFiles(tempRoot).filter((f) => f.toLowerCase().endsWith('.stl'));
    expect(stlFiles).toEqual([]);
  });
});

describe('buildBlenderPlate — executable not found (Requirement 5.4)', () => {
  it('returns EXEC_NOT_FOUND naming the missing executable and produces no artifact', async () => {
    process.env.MCP_BLENDER_BIN = BOGUS_BIN;
    process.env.MCP_BLENDER_TMP_ROOT = tempRoot;

    const result = await buildBlenderPlate(
      { source: 'import bpy\nbpy.ops.mesh.primitive_cube_add()\n', format: 'glb' },
      { tempRoot }
    );

    // Flagged as failed and categorized as executable-not-found.
    expect(result.ok).toBe(false);
    expect(result.errorCategory).toBe('EXEC_NOT_FOUND');

    // Error text identifies the missing executable (the Blender CLI).
    expect(typeof result.error).toBe('string');
    expect(result.error).toMatch(/blender/i);

    // No output artifact was produced.
    expect(result.artifact).toBeUndefined();
    expect(result.payloadBase64).toBeUndefined();
    const modelFiles = collectFiles(tempRoot).filter((f) =>
      /\.(stl|obj|gltf|glb)$/i.test(f)
    );
    expect(modelFiles).toEqual([]);
  });
});
