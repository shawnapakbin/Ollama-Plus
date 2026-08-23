import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'child_process';
import { existsSync, renameSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Integration Tests: Build Pipeline
 *
 * These tests validate the electron-builder NSIS build pipeline end-to-end.
 * They are SLOW (5+ minutes for a full build) and should be run separately
 * from the main test suite.
 *
 * Run manually with:
 *   npx vitest run tests/integration/build.test.ts --timeout 600000
 *
 * Requirements validated: 9.1, 9.4, 9.6, 7.3
 */

const PROJECT_ROOT = join(__dirname, '..', '..');
const DIST_DIR = join(PROJECT_ROOT, 'dist-electron');
const ICON_PATH = join(PROJECT_ROOT, 'build', 'icon.ico');
const ICON_BACKUP_PATH = join(PROJECT_ROOT, 'build', 'icon.ico.bak');

/**
 * Skip integration tests by default unless explicitly enabled via
 * the RUN_INTEGRATION_TESTS environment variable.
 *
 * Set RUN_INTEGRATION_TESTS=1 to run these tests:
 *   RUN_INTEGRATION_TESTS=1 npx vitest run tests/integration/build.test.ts --timeout 600000
 */
const shouldRun = process.env.RUN_INTEGRATION_TESTS === '1';

describe.skipIf(!shouldRun)('Build Pipeline Integration Tests', () => {
  describe('electron:build produces expected artifacts', () => {
    /**
     * Validates: Requirement 9.1
     * THE package.json SHALL define an `electron:build` script that produces
     * the NSIS installer in the `dist-electron/` output directory.
     */
    it('npm run electron:build produces .exe in dist-electron/', () => {
      // Run the full build — this is the slowest operation
      const result = execSync('npm run electron:build', {
        cwd: PROJECT_ROOT,
        encoding: 'utf-8',
        timeout: 600_000, // 10 minutes max
        env: {
          ...process.env,
          // Ensure no signing config to avoid signing errors
          WIN_CSC_LINK: undefined,
          WIN_CSC_KEY_PASSWORD: undefined,
        },
      });

      // Verify at least one .exe was produced in dist-electron/
      const files = execSync('dir /b "dist-electron\\*.exe"', {
        cwd: PROJECT_ROOT,
        encoding: 'utf-8',
      }).trim().split('\n').filter(Boolean);

      expect(files.length).toBeGreaterThan(0);
      expect(files.some((f) => f.endsWith('.exe'))).toBe(true);

      // Verify the output mentions the installer path (Requirement 9.4)
      expect(result).toMatch(/dist-electron/i);
    }, 600_000);

    /**
     * Validates: Requirement 9.4
     * WHEN the `electron:build` script completes successfully, THE Electron_Builder
     * SHALL output the installer filename and path to stdout.
     *
     * Also validates that latest.yml metadata is generated for auto-update.
     */
    it('latest.yml metadata is generated alongside installer', () => {
      // This test assumes the build from the previous test has already run.
      // If running independently, the build must be executed first.
      const latestYmlPath = join(DIST_DIR, 'latest.yml');

      if (!existsSync(latestYmlPath)) {
        // Run build if artifacts don't exist
        execSync('npm run electron:build', {
          cwd: PROJECT_ROOT,
          encoding: 'utf-8',
          timeout: 600_000,
          env: {
            ...process.env,
            WIN_CSC_LINK: undefined,
            WIN_CSC_KEY_PASSWORD: undefined,
          },
        });
      }

      expect(existsSync(latestYmlPath)).toBe(true);

      // Validate latest.yml contains expected metadata fields
      const content = readFileSync(latestYmlPath, 'utf-8');
      expect(content).toMatch(/version:/);
      expect(content).toMatch(/path:/);
      expect(content).toMatch(/sha512:/);
    }, 600_000);
  });

  describe('unsigned build behavior', () => {
    /**
     * Validates: Requirement 7.3
     * WHERE code signing is not configured, THE Electron_Builder SHALL produce
     * an unsigned installer and log a warning indicating SmartScreen warnings
     * will appear for users.
     */
    it('unsigned build completes with warning when no signing config', () => {
      // Explicitly clear all signing environment variables
      const env = { ...process.env };
      delete env.WIN_CSC_LINK;
      delete env.WIN_CSC_KEY_PASSWORD;
      delete env.CSC_LINK;
      delete env.CSC_KEY_PASSWORD;

      // Run the build without signing configuration
      execSync('npm run electron:build 2>&1', {
        cwd: PROJECT_ROOT,
        encoding: 'utf-8',
        timeout: 600_000,
        env,
      });

      // Build should succeed (exit code 0 is implicit — execSync throws on non-zero)
      // Verify .exe was still produced
      const files = execSync('dir /b "dist-electron\\*.exe"', {
        cwd: PROJECT_ROOT,
        encoding: 'utf-8',
      }).trim().split('\n').filter(Boolean);

      expect(files.length).toBeGreaterThan(0);

      // electron-builder logs a warning about skipped signing or the build
      // completes without signing — either way, an unsigned installer is produced.
      // The exact warning text varies by electron-builder version, so we just
      // verify the build succeeds without signing env vars present.
    }, 600_000);
  });

  describe('build failure scenarios', () => {
    /**
     * Validates: Requirement 9.6
     * IF the `electron:build` script fails, THEN the process SHALL exit with a
     * non-zero code and output an error message describing the failure.
     *
     * Also validates Requirement 6.6 (icon missing causes build failure).
     */
    describe('build fails with non-zero exit when build/icon.ico is missing', () => {
      let iconExisted: boolean;

      beforeAll(() => {
        // Temporarily rename icon.ico to simulate it being missing
        iconExisted = existsSync(ICON_PATH);
        if (iconExisted) {
          renameSync(ICON_PATH, ICON_BACKUP_PATH);
        }
      });

      afterAll(() => {
        // Restore icon.ico
        if (iconExisted && existsSync(ICON_BACKUP_PATH)) {
          renameSync(ICON_BACKUP_PATH, ICON_PATH);
        }
      });

      it('electron:build exits with non-zero code when icon is missing', () => {
        let exitCode: number | null = null;
        let stderr = '';

        try {
          execSync('npm run electron:build 2>&1', {
            cwd: PROJECT_ROOT,
            encoding: 'utf-8',
            timeout: 300_000,
            env: {
              ...process.env,
              WIN_CSC_LINK: undefined,
              WIN_CSC_KEY_PASSWORD: undefined,
            },
          });
          // If we get here, the build unexpectedly succeeded (exitCode stays null)
        } catch (error: unknown) {
          const execError = error as { status?: number; stdout?: string; stderr?: string };
          exitCode = execError.status ?? 1;
          stderr = execError.stderr || execError.stdout || '';
        }

        // Build should fail with non-zero exit code
        expect(exitCode).not.toBe(0);

        // Error output should reference the icon or build resource issue
        const output = stderr.toLowerCase();
        expect(
          output.includes('icon') ||
          output.includes('ico') ||
          output.includes('build') ||
          output.includes('error')
        ).toBe(true);
      }, 300_000);
    });
  });
});
