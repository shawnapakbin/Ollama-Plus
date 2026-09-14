/**
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.1.0
 *
 * Example (not property) test for the 5.1.0 version bump.
 *
 * Feature: mcp-tools-wiring, Task 14.3
 * Validates: Requirements 12.1, 12.2, 12.3 (package.json version and affected
 * source header strings read 5.1.0 with no prior 5.0.3 occurrences) and
 * Requirements 13.1, 13.2, 13.3 (root README.md and mcp/README.md state 5.1.0
 * with no previous-version occurrences).
 *
 * Approach: read the actual files from disk and assert against the real
 * contents. The affected source headers are the files updated in task 14.1 that
 * carry a version header ("vX.Y.Z" per the revDigit convention).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const CURRENT_VERSION = '5.1.0';
const PREVIOUS_VERSION = '5.0.3';

function readRepoFile(relPath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
}

// Source files updated during the version bump (task 14.1). Only files that
// carry a version header string are asserted for the "v5.1.0" header.
const AFFECTED_SOURCE_HEADER_FILES = [
  'electron/runtime/agent/toolDispatcher.js',
  'electron/runtime/agent/outputFormatter.js',
  'electron/main.js'
];

const README_FILES = ['README.md', 'mcp/README.md'];

describe('version bump to 5.1.0', () => {
  it('sets package.json version to 5.1.0', () => {
    const pkg = JSON.parse(readRepoFile('package.json')) as { version: string };
    expect(pkg.version).toBe(CURRENT_VERSION);
  });

  it.each(AFFECTED_SOURCE_HEADER_FILES)(
    'source header of %s contains 5.1.0 and no 5.0.3',
    (relPath) => {
      const contents = readRepoFile(relPath);
      expect(contents).toContain(`v${CURRENT_VERSION}`);
      expect(contents).not.toContain(PREVIOUS_VERSION);
    }
  );

  it.each(README_FILES)(
    '%s states 5.1.0 and has no previous-version occurrences',
    (relPath) => {
      const contents = readRepoFile(relPath);
      expect(contents).toContain(CURRENT_VERSION);
      expect(contents).not.toContain(PREVIOUS_VERSION);
    }
  );
});
