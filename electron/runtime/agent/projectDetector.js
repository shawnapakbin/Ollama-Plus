/**
 * Project Detector
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.0.3
 *
 * Detects the project's language, build system, test runner, and provides
 * relevant commands (test, lint, build) to the execution loop by examining
 * configuration files in the working directory.
 *
 * If no recognized configuration file is found, informs the caller that
 * manual commands may be required.
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * @typedef {Object} ProjectInfo
 * @property {boolean} detected - Whether a recognized config was found
 * @property {string | null} language - Primary language (JavaScript, TypeScript, Rust, Python, Go, etc.)
 * @property {string | null} buildSystem - Build system (npm, yarn, pnpm, cargo, make, poetry, pip, go)
 * @property {string | null} testRunner - Test runner (vitest, jest, pytest, cargo test, go test, etc.)
 * @property {string | null} testCommand - Full test command to run
 * @property {string | null} lintCommand - Full lint command to run
 * @property {string | null} buildCommand - Full build command to run
 * @property {string[]} configFiles - List of detected config file paths
 */

/**
 * Checks if a file exists at the given path.
 *
 * @param {string} filePath
 * @returns {boolean}
 */
function fileExists(filePath) {
  return fs.existsSync(filePath);
}

/**
 * Safely reads and parses a JSON file. Returns null on failure.
 *
 * @param {string} filePath
 * @returns {object | null}
 */
function readJsonFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Safely reads a text file. Returns null on failure.
 *
 * @param {string} filePath
 * @returns {string | null}
 */
function readTextFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Determines the package manager by checking for lock files.
 *
 * @param {string} dir - Working directory
 * @returns {'pnpm' | 'yarn' | 'npm'}
 */
function detectPackageManager(dir) {
  if (fileExists(path.join(dir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fileExists(path.join(dir, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

/**
 * Detects test runner from package.json devDependencies and scripts.
 *
 * @param {object} pkg - Parsed package.json
 * @returns {string | null}
 */
function detectTestRunnerFromPackageJson(pkg) {
  const devDeps = pkg.devDependencies || {};
  const deps = pkg.dependencies || {};
  const allDeps = { ...deps, ...devDeps };

  if (allDeps.vitest) return 'vitest';
  if (allDeps.jest) return 'jest';
  if (allDeps.mocha) return 'mocha';
  if (allDeps.ava) return 'ava';
  if (allDeps.tap) return 'tap';

  // Infer from test script content
  const testScript = pkg.scripts?.test || '';
  if (testScript.includes('vitest')) return 'vitest';
  if (testScript.includes('jest')) return 'jest';
  if (testScript.includes('mocha')) return 'mocha';
  if (testScript.includes('ava')) return 'ava';
  if (testScript.includes('tap')) return 'tap';

  return null;
}

/**
 * Detects project info from package.json.
 *
 * @param {string} dir - Working directory
 * @param {string[]} configFiles - Mutable list of detected config file paths
 * @returns {Partial<ProjectInfo> | null}
 */
function detectFromPackageJson(dir, configFiles) {
  const pkgPath = path.join(dir, 'package.json');
  if (!fileExists(pkgPath)) return null;

  const pkg = readJsonFile(pkgPath);
  if (!pkg) return null;

  configFiles.push(pkgPath);

  const packageManager = detectPackageManager(dir);
  const runPrefix = packageManager === 'npm' ? 'npm run' : packageManager;
  const testRunner = detectTestRunnerFromPackageJson(pkg);

  // Determine test command
  let testCommand = null;
  if (pkg.scripts?.test) {
    testCommand = `${runPrefix} test`;
  }

  // Determine lint command
  let lintCommand = null;
  if (pkg.scripts?.lint) {
    lintCommand = `${runPrefix} lint`;
  }

  // Determine build command
  let buildCommand = null;
  if (pkg.scripts?.build) {
    buildCommand = `${runPrefix} build`;
  }

  // Determine language
  let language = 'JavaScript';

  return {
    language,
    buildSystem: packageManager,
    testRunner,
    testCommand,
    lintCommand,
    buildCommand
  };
}

/**
 * Detects TypeScript from tsconfig.json.
 * Upgrades language to TypeScript if found alongside package.json.
 *
 * @param {string} dir - Working directory
 * @param {string[]} configFiles - Mutable list of detected config file paths
 * @returns {boolean}
 */
function detectTypeScript(dir, configFiles) {
  const tsconfigPath = path.join(dir, 'tsconfig.json');
  if (fileExists(tsconfigPath)) {
    configFiles.push(tsconfigPath);
    return true;
  }
  return false;
}

/**
 * Detects ESLint configuration files.
 *
 * @param {string} dir - Working directory
 * @param {string[]} configFiles - Mutable list of detected config file paths
 * @returns {string | null} - ESLint lint command if found, null otherwise
 */
function detectEslint(dir, configFiles) {
  const eslintConfigs = [
    '.eslintrc',
    '.eslintrc.js',
    '.eslintrc.cjs',
    '.eslintrc.json',
    '.eslintrc.yml',
    '.eslintrc.yaml',
    'eslint.config.js',
    'eslint.config.mjs',
    'eslint.config.cjs',
    'eslint.config.ts'
  ];

  for (const config of eslintConfigs) {
    const configPath = path.join(dir, config);
    if (fileExists(configPath)) {
      configFiles.push(configPath);
      return 'npx eslint .';
    }
  }
  return null;
}

/**
 * Detects project info from Cargo.toml (Rust).
 *
 * @param {string} dir - Working directory
 * @param {string[]} configFiles - Mutable list of detected config file paths
 * @returns {Partial<ProjectInfo> | null}
 */
function detectFromCargoToml(dir, configFiles) {
  const cargoPath = path.join(dir, 'Cargo.toml');
  if (!fileExists(cargoPath)) return null;

  configFiles.push(cargoPath);

  return {
    language: 'Rust',
    buildSystem: 'cargo',
    testRunner: 'cargo test',
    testCommand: 'cargo test',
    lintCommand: 'cargo clippy',
    buildCommand: 'cargo build'
  };
}

/**
 * Detects project info from go.mod (Go).
 *
 * @param {string} dir - Working directory
 * @param {string[]} configFiles - Mutable list of detected config file paths
 * @returns {Partial<ProjectInfo> | null}
 */
function detectFromGoMod(dir, configFiles) {
  const goModPath = path.join(dir, 'go.mod');
  if (!fileExists(goModPath)) return null;

  configFiles.push(goModPath);

  return {
    language: 'Go',
    buildSystem: 'go',
    testRunner: 'go test',
    testCommand: 'go test ./...',
    lintCommand: 'golangci-lint run',
    buildCommand: 'go build'
  };
}

/**
 * Detects project info from Python config files.
 *
 * @param {string} dir - Working directory
 * @param {string[]} configFiles - Mutable list of detected config file paths
 * @returns {Partial<ProjectInfo> | null}
 */
function detectFromPython(dir, configFiles) {
  const pyprojectPath = path.join(dir, 'pyproject.toml');
  const setupPyPath = path.join(dir, 'setup.py');
  const requirementsPath = path.join(dir, 'requirements.txt');

  let found = false;
  let buildSystem = 'pip';
  let testRunner = 'pytest';
  let lintCommand = 'flake8';

  if (fileExists(pyprojectPath)) {
    configFiles.push(pyprojectPath);
    found = true;

    // Check if it uses poetry or other build backend
    const content = readTextFile(pyprojectPath);
    if (content) {
      if (content.includes('[tool.poetry]') || content.includes('poetry-core')) {
        buildSystem = 'poetry';
      }

      // Detect test runner from pyproject.toml
      if (content.includes('[tool.pytest]') || content.includes('pytest')) {
        testRunner = 'pytest';
      }

      // Detect linter
      if (content.includes('[tool.ruff]') || content.includes('ruff')) {
        lintCommand = 'ruff check .';
      } else if (content.includes('[tool.flake8]') || content.includes('flake8')) {
        lintCommand = 'flake8';
      } else if (content.includes('[tool.pylint]') || content.includes('pylint')) {
        lintCommand = 'pylint';
      }
    }
  }

  if (fileExists(setupPyPath)) {
    configFiles.push(setupPyPath);
    found = true;
  }

  if (fileExists(requirementsPath)) {
    configFiles.push(requirementsPath);
    found = true;
  }

  if (!found) return null;

  const testCommand = buildSystem === 'poetry'
    ? 'poetry run pytest'
    : 'pytest';

  const finalLintCommand = buildSystem === 'poetry'
    ? `poetry run ${lintCommand}`
    : lintCommand;

  return {
    language: 'Python',
    buildSystem,
    testRunner,
    testCommand,
    lintCommand: finalLintCommand,
    buildCommand: null
  };
}

/**
 * Detects project info from Makefile.
 *
 * @param {string} dir - Working directory
 * @param {string[]} configFiles - Mutable list of detected config file paths
 * @returns {Partial<ProjectInfo> | null}
 */
function detectFromMakefile(dir, configFiles) {
  const makefilePaths = ['Makefile', 'makefile', 'GNUmakefile'];

  let makefilePath = null;
  for (const name of makefilePaths) {
    const fullPath = path.join(dir, name);
    if (fileExists(fullPath)) {
      makefilePath = fullPath;
      break;
    }
  }

  if (!makefilePath) return null;

  configFiles.push(makefilePath);

  const content = readTextFile(makefilePath);
  let testCommand = null;
  let lintCommand = null;
  let buildCommand = 'make';

  if (content) {
    // Look for common targets
    if (/^test\s*:/m.test(content)) {
      testCommand = 'make test';
    }
    if (/^lint\s*:/m.test(content)) {
      lintCommand = 'make lint';
    }
    if (/^build\s*:/m.test(content)) {
      buildCommand = 'make build';
    }
  }

  return {
    language: null,
    buildSystem: 'make',
    testRunner: testCommand ? 'make' : null,
    testCommand,
    lintCommand,
    buildCommand
  };
}

/**
 * Detects the project's language, build system, test runner, and provides
 * relevant commands by examining configuration files in the working directory.
 *
 * @param {string} workingDirectory - Absolute path to the project's working directory
 * @returns {ProjectInfo}
 */
export function detectProject(workingDirectory) {
  if (!workingDirectory || typeof workingDirectory !== 'string') {
    return {
      detected: false,
      language: null,
      buildSystem: null,
      testRunner: null,
      testCommand: null,
      lintCommand: null,
      buildCommand: null,
      configFiles: []
    };
  }

  const dir = path.resolve(workingDirectory);

  if (!fs.existsSync(dir)) {
    return {
      detected: false,
      language: null,
      buildSystem: null,
      testRunner: null,
      testCommand: null,
      lintCommand: null,
      buildCommand: null,
      configFiles: []
    };
  }

  /** @type {string[]} */
  const configFiles = [];

  // Result object built up from detectors
  let language = null;
  let buildSystem = null;
  let testRunner = null;
  let testCommand = null;
  let lintCommand = null;
  let buildCommand = null;

  // --- Detect from primary config files (in priority order) ---

  // 1. package.json (JavaScript/TypeScript ecosystem)
  const nodeResult = detectFromPackageJson(dir, configFiles);
  if (nodeResult) {
    language = nodeResult.language || language;
    buildSystem = nodeResult.buildSystem || buildSystem;
    testRunner = nodeResult.testRunner || testRunner;
    testCommand = nodeResult.testCommand || testCommand;
    lintCommand = nodeResult.lintCommand || lintCommand;
    buildCommand = nodeResult.buildCommand || buildCommand;
  }

  // 2. tsconfig.json upgrades language to TypeScript
  if (detectTypeScript(dir, configFiles)) {
    if (language === 'JavaScript' || language === null) {
      language = 'TypeScript';
    }
  }

  // 3. ESLint config — provides lint command if no scripts.lint was found
  const eslintLint = detectEslint(dir, configFiles);
  if (eslintLint && !lintCommand) {
    lintCommand = eslintLint;
  }

  // 4. Cargo.toml (Rust)
  const rustResult = detectFromCargoToml(dir, configFiles);
  if (rustResult) {
    language = language || rustResult.language;
    buildSystem = buildSystem || rustResult.buildSystem;
    testRunner = testRunner || rustResult.testRunner;
    testCommand = testCommand || rustResult.testCommand;
    lintCommand = lintCommand || rustResult.lintCommand;
    buildCommand = buildCommand || rustResult.buildCommand;
  }

  // 5. go.mod (Go)
  const goResult = detectFromGoMod(dir, configFiles);
  if (goResult) {
    language = language || goResult.language;
    buildSystem = buildSystem || goResult.buildSystem;
    testRunner = testRunner || goResult.testRunner;
    testCommand = testCommand || goResult.testCommand;
    lintCommand = lintCommand || goResult.lintCommand;
    buildCommand = buildCommand || goResult.buildCommand;
  }

  // 6. Python configs (pyproject.toml, setup.py, requirements.txt)
  const pyResult = detectFromPython(dir, configFiles);
  if (pyResult) {
    language = language || pyResult.language;
    buildSystem = buildSystem || pyResult.buildSystem;
    testRunner = testRunner || pyResult.testRunner;
    testCommand = testCommand || pyResult.testCommand;
    lintCommand = lintCommand || pyResult.lintCommand;
    buildCommand = buildCommand || pyResult.buildCommand;
  }

  // 7. Makefile (generic, fills gaps)
  const makeResult = detectFromMakefile(dir, configFiles);
  if (makeResult) {
    buildSystem = buildSystem || makeResult.buildSystem;
    testRunner = testRunner || makeResult.testRunner;
    testCommand = testCommand || makeResult.testCommand;
    lintCommand = lintCommand || makeResult.lintCommand;
    buildCommand = buildCommand || makeResult.buildCommand;
  }

  const detected = configFiles.length > 0;

  return {
    detected,
    language,
    buildSystem,
    testRunner,
    testCommand,
    lintCommand,
    buildCommand,
    configFiles
  };
}
