import { describe, it, expect, afterEach } from 'vitest';
import { execSync, ExecSyncOptions } from 'child_process';
import { existsSync, renameSync } from 'fs';
import { resolve } from 'path';

/**
 * Integration tests for the Windows preflight script.
 * These tests run the actual PowerShell preflight script and verify
 * exit codes and output messages for various prerequisite states.
 *
 * Validates: Requirements 9.2, 9.5
 */

const projectRoot = resolve(__dirname, '..', '..');
const scriptPath = resolve(projectRoot, 'scripts', 'check-electron-win-prereqs.ps1');
const iconPath = resolve(projectRoot, 'build', 'icon.ico');
const licensePath = resolve(projectRoot, 'build', 'license.txt');

const iconBackup = `${iconPath}.bak`;
const licenseBackup = `${licensePath}.bak`;

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

/** Runs the preflight script with optional env overrides and returns { status, stdout, stderr }. */
function runPreflight(envOverrides: Record<string, string | undefined> = {}): RunResult {
  const cmd = `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`;
  const opts: ExecSyncOptions = {
    cwd: projectRoot,
    timeout: 30_000,
    env: { ...process.env, ...envOverrides },
    encoding: 'utf-8' as BufferEncoding,
  };

  try {
    const stdout = execSync(cmd, { ...opts, stdio: ['pipe', 'pipe', 'pipe'] }) as unknown as string;
    return { status: 0, stdout: stdout ?? '', stderr: '' };
  } catch (err: unknown) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return {
      status: e.status ?? 1,
      stdout: (e.stdout ?? '') as string,
      stderr: (e.stderr ?? '') as string,
    };
  }
}

// Skip entire suite on non-Windows platforms
describe.skipIf(process.platform !== 'win32')('Integration: preflight script (check-electron-win-prereqs.ps1)', () => {
  // Safety: restore any renamed files after each test
  afterEach(() => {
    if (existsSync(iconBackup)) {
      renameSync(iconBackup, iconPath);
    }
    if (existsSync(licenseBackup)) {
      renameSync(licenseBackup, licensePath);
    }
  });

  it('exits 0 when all prerequisites are present', () => {
    // Ensure baseline files exist
    expect(existsSync(iconPath)).toBe(true);
    expect(existsSync(licensePath)).toBe(true);

    const result = runPreflight();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('All preflight checks passed');
  }, 30_000);

  it('exits 1 and identifies missing icon file', () => {
    // Temporarily rename icon.ico to simulate absence
    renameSync(iconPath, iconBackup);

    const result = runPreflight();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('icon.ico');
  }, 30_000);

  it('exits 1 and identifies missing license file', () => {
    // Temporarily rename license.txt to simulate absence
    renameSync(licensePath, licenseBackup);

    const result = runPreflight();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('license.txt');
  }, 30_000);

  it('exits 1 when signing config exists but WIN_CSC_KEY_PASSWORD is missing', () => {
    // Set WIN_CSC_LINK but omit WIN_CSC_KEY_PASSWORD
    const result = runPreflight({
      WIN_CSC_LINK: 'C:\\fake\\cert.pfx',
      WIN_CSC_KEY_PASSWORD: undefined,
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('WIN_CSC_LINK');
    expect(result.stdout).toContain('WIN_CSC_KEY_PASSWORD');
  }, 30_000);

  it('exits 1 when electron-builder is not available', () => {
    // Simulate electron-builder being unavailable by stripping Node.js and npm
    // paths from PATH so that `npx electron-builder --version` fails entirely.
    // We keep only Windows system paths (System32, etc.) plus PowerShell itself.
    const pathSep = ';';
    const pathDirs = (process.env.PATH ?? '').split(pathSep);
    const filteredPath = pathDirs
      .filter((dir) => {
        const lower = dir.toLowerCase();
        // Remove any path containing node, npm, nvm, or the project itself
        return (
          !lower.includes('node') &&
          !lower.includes('npm') &&
          !lower.includes('nvm') &&
          !lower.includes('nodejs') &&
          !lower.includes('ollama-plus')
        );
      })
      .join(pathSep);

    const result = runPreflight({ PATH: filteredPath });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain('electron-builder');
  }, 30_000);
});
