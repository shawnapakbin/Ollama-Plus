import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectProject } from '../../../electron/runtime/agent/projectDetector.js';

let tempDir: string;
const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-project-detect-'));
  tempDirs.push(dir);
  return dir;
}

beforeEach(() => {
  tempDir = createTempDir();
});

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('detectProject', () => {
  describe('invalid inputs', () => {
    it('returns detected: false for null input', () => {
      const result = detectProject(null as any);
      expect(result.detected).toBe(false);
      expect(result.configFiles).toEqual([]);
    });

    it('returns detected: false for empty string', () => {
      const result = detectProject('');
      expect(result.detected).toBe(false);
      expect(result.configFiles).toEqual([]);
    });

    it('returns detected: false for non-existent directory', () => {
      const result = detectProject(path.join(tempDir, 'non-existent'));
      expect(result.detected).toBe(false);
      expect(result.configFiles).toEqual([]);
    });
  });

  describe('empty directory (no config files)', () => {
    it('returns detected: false with all null fields', () => {
      const result = detectProject(tempDir);
      expect(result.detected).toBe(false);
      expect(result.language).toBeNull();
      expect(result.buildSystem).toBeNull();
      expect(result.testRunner).toBeNull();
      expect(result.testCommand).toBeNull();
      expect(result.lintCommand).toBeNull();
      expect(result.buildCommand).toBeNull();
      expect(result.configFiles).toEqual([]);
    });
  });

  describe('JavaScript/Node.js projects (package.json)', () => {
    it('detects a basic npm project with scripts', () => {
      fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({
        name: 'test-project',
        scripts: {
          test: 'vitest run',
          lint: 'eslint .',
          build: 'tsc'
        },
        devDependencies: {
          vitest: '^1.0.0'
        }
      }));

      const result = detectProject(tempDir);
      expect(result.detected).toBe(true);
      expect(result.language).toBe('JavaScript');
      expect(result.buildSystem).toBe('npm');
      expect(result.testRunner).toBe('vitest');
      expect(result.testCommand).toBe('npm run test');
      expect(result.lintCommand).toBe('npm run lint');
      expect(result.buildCommand).toBe('npm run build');
      expect(result.configFiles).toContain(path.join(tempDir, 'package.json'));
    });

    it('detects yarn as package manager from yarn.lock', () => {
      fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({
        name: 'yarn-project',
        scripts: { test: 'jest', build: 'webpack' }
      }));
      fs.writeFileSync(path.join(tempDir, 'yarn.lock'), '');

      const result = detectProject(tempDir);
      expect(result.buildSystem).toBe('yarn');
      expect(result.testCommand).toBe('yarn test');
      expect(result.buildCommand).toBe('yarn build');
    });

    it('detects pnpm as package manager from pnpm-lock.yaml', () => {
      fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({
        name: 'pnpm-project',
        scripts: { test: 'vitest', lint: 'eslint .' }
      }));
      fs.writeFileSync(path.join(tempDir, 'pnpm-lock.yaml'), '');

      const result = detectProject(tempDir);
      expect(result.buildSystem).toBe('pnpm');
      expect(result.testCommand).toBe('pnpm test');
      expect(result.lintCommand).toBe('pnpm lint');
    });

    it('detects jest from devDependencies', () => {
      fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({
        name: 'jest-project',
        scripts: { test: 'jest' },
        devDependencies: { jest: '^29.0.0' }
      }));

      const result = detectProject(tempDir);
      expect(result.testRunner).toBe('jest');
    });

    it('detects mocha from devDependencies', () => {
      fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({
        name: 'mocha-project',
        scripts: { test: 'mocha' },
        devDependencies: { mocha: '^10.0.0' }
      }));

      const result = detectProject(tempDir);
      expect(result.testRunner).toBe('mocha');
    });

    it('handles package.json without scripts gracefully', () => {
      fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({
        name: 'minimal-project'
      }));

      const result = detectProject(tempDir);
      expect(result.detected).toBe(true);
      expect(result.language).toBe('JavaScript');
      expect(result.testCommand).toBeNull();
      expect(result.lintCommand).toBeNull();
      expect(result.buildCommand).toBeNull();
    });

    it('handles malformed package.json gracefully', () => {
      fs.writeFileSync(path.join(tempDir, 'package.json'), 'not valid json{{{');

      const result = detectProject(tempDir);
      // Should not crash, just not detect it
      expect(result.configFiles).not.toContain(path.join(tempDir, 'package.json'));
    });
  });

  describe('TypeScript projects (tsconfig.json)', () => {
    it('upgrades language to TypeScript when tsconfig.json exists', () => {
      fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({
        name: 'ts-project',
        scripts: { test: 'vitest run' },
        devDependencies: { vitest: '^1.0.0', typescript: '^5.0.0' }
      }));
      fs.writeFileSync(path.join(tempDir, 'tsconfig.json'), JSON.stringify({
        compilerOptions: { strict: true }
      }));

      const result = detectProject(tempDir);
      expect(result.language).toBe('TypeScript');
      expect(result.configFiles).toContain(path.join(tempDir, 'tsconfig.json'));
    });

    it('detects TypeScript even without package.json', () => {
      fs.writeFileSync(path.join(tempDir, 'tsconfig.json'), JSON.stringify({
        compilerOptions: {}
      }));

      const result = detectProject(tempDir);
      expect(result.detected).toBe(true);
      expect(result.language).toBe('TypeScript');
    });
  });

  describe('ESLint detection', () => {
    it('detects .eslintrc.json and provides lint command', () => {
      fs.writeFileSync(path.join(tempDir, '.eslintrc.json'), JSON.stringify({ rules: {} }));

      const result = detectProject(tempDir);
      expect(result.detected).toBe(true);
      expect(result.lintCommand).toBe('npx eslint .');
      expect(result.configFiles).toContain(path.join(tempDir, '.eslintrc.json'));
    });

    it('detects eslint.config.js (flat config)', () => {
      fs.writeFileSync(path.join(tempDir, 'eslint.config.js'), 'export default [];');

      const result = detectProject(tempDir);
      expect(result.detected).toBe(true);
      expect(result.lintCommand).toBe('npx eslint .');
    });

    it('does not override package.json lint script with eslint detection', () => {
      fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({
        name: 'project',
        scripts: { lint: 'eslint --fix .' }
      }));
      fs.writeFileSync(path.join(tempDir, '.eslintrc.js'), 'module.exports = {};');

      const result = detectProject(tempDir);
      // package.json lint script takes priority
      expect(result.lintCommand).toBe('npm run lint');
    });
  });

  describe('Rust projects (Cargo.toml)', () => {
    it('detects a Rust project', () => {
      fs.writeFileSync(path.join(tempDir, 'Cargo.toml'), '[package]\nname = "my-crate"\nversion = "0.1.0"');

      const result = detectProject(tempDir);
      expect(result.detected).toBe(true);
      expect(result.language).toBe('Rust');
      expect(result.buildSystem).toBe('cargo');
      expect(result.testRunner).toBe('cargo test');
      expect(result.testCommand).toBe('cargo test');
      expect(result.lintCommand).toBe('cargo clippy');
      expect(result.buildCommand).toBe('cargo build');
      expect(result.configFiles).toContain(path.join(tempDir, 'Cargo.toml'));
    });
  });

  describe('Go projects (go.mod)', () => {
    it('detects a Go project', () => {
      fs.writeFileSync(path.join(tempDir, 'go.mod'), 'module example.com/myapp\n\ngo 1.21');

      const result = detectProject(tempDir);
      expect(result.detected).toBe(true);
      expect(result.language).toBe('Go');
      expect(result.buildSystem).toBe('go');
      expect(result.testRunner).toBe('go test');
      expect(result.testCommand).toBe('go test ./...');
      expect(result.lintCommand).toBe('golangci-lint run');
      expect(result.buildCommand).toBe('go build');
      expect(result.configFiles).toContain(path.join(tempDir, 'go.mod'));
    });
  });

  describe('Python projects', () => {
    it('detects a poetry project from pyproject.toml', () => {
      fs.writeFileSync(path.join(tempDir, 'pyproject.toml'), `
[tool.poetry]
name = "my-app"
version = "1.0.0"

[tool.pytest.ini_options]
testpaths = ["tests"]
`);

      const result = detectProject(tempDir);
      expect(result.detected).toBe(true);
      expect(result.language).toBe('Python');
      expect(result.buildSystem).toBe('poetry');
      expect(result.testRunner).toBe('pytest');
      expect(result.testCommand).toBe('poetry run pytest');
      expect(result.configFiles).toContain(path.join(tempDir, 'pyproject.toml'));
    });

    it('detects a pip project from requirements.txt', () => {
      fs.writeFileSync(path.join(tempDir, 'requirements.txt'), 'flask==2.0\npytest==7.0');

      const result = detectProject(tempDir);
      expect(result.detected).toBe(true);
      expect(result.language).toBe('Python');
      expect(result.buildSystem).toBe('pip');
      expect(result.testCommand).toBe('pytest');
    });

    it('detects setup.py', () => {
      fs.writeFileSync(path.join(tempDir, 'setup.py'), 'from setuptools import setup\nsetup()');

      const result = detectProject(tempDir);
      expect(result.detected).toBe(true);
      expect(result.language).toBe('Python');
    });

    it('detects ruff as linter from pyproject.toml', () => {
      fs.writeFileSync(path.join(tempDir, 'pyproject.toml'), `
[tool.ruff]
line-length = 100
`);

      const result = detectProject(tempDir);
      expect(result.lintCommand).toBe('ruff check .');
    });

    it('uses poetry run prefix for lint commands in poetry projects', () => {
      fs.writeFileSync(path.join(tempDir, 'pyproject.toml'), `
[tool.poetry]
name = "my-app"

[tool.ruff]
line-length = 100
`);

      const result = detectProject(tempDir);
      expect(result.lintCommand).toBe('poetry run ruff check .');
    });
  });

  describe('Makefile projects', () => {
    it('detects Makefile with test and lint targets', () => {
      fs.writeFileSync(path.join(tempDir, 'Makefile'), `
.PHONY: test lint build

test:
\t./run-tests.sh

lint:
\tshellcheck *.sh

build:
\tgcc -o app main.c
`);

      const result = detectProject(tempDir);
      expect(result.detected).toBe(true);
      expect(result.buildSystem).toBe('make');
      expect(result.testCommand).toBe('make test');
      expect(result.lintCommand).toBe('make lint');
      expect(result.buildCommand).toBe('make build');
      expect(result.configFiles).toContain(path.join(tempDir, 'Makefile'));
    });

    it('detects lowercase makefile', () => {
      fs.writeFileSync(path.join(tempDir, 'makefile'), `
test:
\techo "testing"
`);

      const result = detectProject(tempDir);
      expect(result.detected).toBe(true);
      expect(result.testCommand).toBe('make test');
    });

    it('uses default make build when no build target found', () => {
      fs.writeFileSync(path.join(tempDir, 'Makefile'), `
all:
\techo "all"
`);

      const result = detectProject(tempDir);
      expect(result.buildCommand).toBe('make');
    });
  });

  describe('multi-config projects', () => {
    it('detects Node+TypeScript project with both configs', () => {
      fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({
        name: 'fullstack',
        scripts: { test: 'vitest run', lint: 'eslint .', build: 'tsc && vite build' },
        devDependencies: { vitest: '^1.0.0', typescript: '^5.0.0' }
      }));
      fs.writeFileSync(path.join(tempDir, 'tsconfig.json'), '{}');
      fs.writeFileSync(path.join(tempDir, '.eslintrc.json'), '{}');

      const result = detectProject(tempDir);
      expect(result.detected).toBe(true);
      expect(result.language).toBe('TypeScript');
      expect(result.buildSystem).toBe('npm');
      expect(result.testRunner).toBe('vitest');
      expect(result.testCommand).toBe('npm run test');
      expect(result.lintCommand).toBe('npm run lint');
      expect(result.buildCommand).toBe('npm run build');
      expect(result.configFiles.length).toBeGreaterThanOrEqual(3);
    });

    it('package.json takes priority when multiple ecosystems co-exist', () => {
      // A project with both package.json and Makefile
      fs.writeFileSync(path.join(tempDir, 'package.json'), JSON.stringify({
        name: 'mixed',
        scripts: { test: 'jest', build: 'webpack' },
        devDependencies: { jest: '^29.0.0' }
      }));
      fs.writeFileSync(path.join(tempDir, 'Makefile'), `
test:
\tmake run-test
`);

      const result = detectProject(tempDir);
      expect(result.language).toBe('JavaScript');
      expect(result.buildSystem).toBe('npm');
      expect(result.testRunner).toBe('jest');
      expect(result.testCommand).toBe('npm run test');
    });
  });
});
