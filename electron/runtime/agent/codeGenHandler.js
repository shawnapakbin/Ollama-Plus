/**
 * Code Generation Step Handler
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.0.3
 *
 * Extends the execution loop to handle code generation steps.
 * Writes new files, edits existing files (with unified diff generation),
 * validates syntax via project lint/compile, auto-runs tests after code changes,
 * and retries fixes up to 3 attempts on failure.
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.8, 11.9
 */

import { formatDiff, truncateOutput, MAX_OUTPUT_LENGTH } from './outputFormatter.js';
import { detectProject } from './projectDetector.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Maximum number of lint/compile fix attempts. */
export const MAX_SYNTAX_FIX_ATTEMPTS = 3;

/** Maximum number of test fix attempts. */
export const MAX_TEST_FIX_ATTEMPTS = 3;

/** Default timeout for lint/compile validation commands (ms). */
export const DEFAULT_LINT_TIMEOUT_MS = 60_000;

/** Default timeout for test commands (ms). */
export const DEFAULT_TEST_TIMEOUT_MS = 120_000;

// ─── Factory Function ────────────────────────────────────────────────────────

/**
 * Creates a new CodeGenHandler instance.
 *
 * @param {Object} deps - Injected dependencies
 * @param {Object} deps.toolDispatcher - Tool dispatcher with dispatch() method
 * @param {Object} [deps.sandboxEnforcer] - Sandbox enforcer for path validation
 * @param {Object} [deps.contextManager] - Context manager for adding error context
 * @param {Object} [deps.config] - Configuration overrides
 * @param {number} [deps.config.lintTimeout] - Timeout for lint/compile commands (ms)
 * @param {number} [deps.config.testTimeout] - Timeout for test commands (ms)
 * @returns {Object} CodeGenHandler interface
 */
export function createCodeGenHandler(deps = {}) {
  const {
    toolDispatcher,
    sandboxEnforcer,
    contextManager,
    config = {}
  } = deps;

  if (!toolDispatcher || typeof toolDispatcher.dispatch !== 'function') {
    throw new Error('toolDispatcher with a dispatch() method is required.');
  }

  const lintTimeout = typeof config.lintTimeout === 'number' && config.lintTimeout > 0
    ? config.lintTimeout
    : DEFAULT_LINT_TIMEOUT_MS;

  const testTimeout = typeof config.testTimeout === 'number' && config.testTimeout > 0
    ? config.testTimeout
    : DEFAULT_TEST_TIMEOUT_MS;

  // ─── File Operations ───────────────────────────────────────────────────────

  /**
   * Writes a new file via the Folder Tool.
   *
   * Per Requirement 11.1: Use the Folder Tool to write files to the authorized
   * working directory.
   *
   * @param {Object} step - The step being executed
   * @param {string} filePath - Absolute or relative path to write
   * @param {string} content - File content to write
   * @returns {Promise<Object>} Result with status, output, and diff
   */
  async function handleCodeWrite(step, filePath, content) {
    if (!filePath || typeof filePath !== 'string') {
      return {
        status: 'error',
        output: '',
        error: 'File path must be a non-empty string.',
        diff: ''
      };
    }

    if (typeof content !== 'string') {
      return {
        status: 'error',
        output: '',
        error: 'Content must be a string.',
        diff: ''
      };
    }

    // Validate path via sandbox enforcer
    if (sandboxEnforcer && typeof sandboxEnforcer.isPathAuthorized === 'function') {
      let resolvedPath = filePath;
      if (typeof sandboxEnforcer.resolvePath === 'function') {
        try {
          resolvedPath = sandboxEnforcer.resolvePath(filePath);
        } catch (err) {
          return {
            status: 'error',
            output: '',
            error: `Path resolution failed: ${err.message}`,
            diff: ''
          };
        }
      }

      if (!sandboxEnforcer.isPathAuthorized(resolvedPath)) {
        return {
          status: 'error',
          output: '',
          error: `Path "${filePath}" is outside the authorized working directory.`,
          diff: ''
        };
      }
    }

    // Dispatch write via Folder Tool
    const result = await toolDispatcher.dispatch({
      tool: 'folder',
      action: 'writeFile',
      params: {
        path: filePath,
        content
      }
    }, { stepId: step?.id || '' });

    if (result.status === 'success') {
      // Generate diff for display (new file: empty → content)
      const diff = formatDiff('', content, filePath);

      // Log file modification if sandbox enforcer is available
      if (sandboxEnforcer && typeof sandboxEnforcer.logFileModification === 'function') {
        sandboxEnforcer.logFileModification({
          sessionId: step?.sessionId || 'unknown',
          operation: 'create',
          path: filePath,
          timestamp: new Date().toISOString()
        });
      }

      return {
        status: 'success',
        output: result.output || '',
        error: null,
        diff
      };
    }

    return {
      status: 'error',
      output: result.output || '',
      error: result.error || 'Failed to write file.',
      diff: ''
    };
  }

  /**
   * Edits an existing file: reads current content, computes unified diff,
   * and writes new content via the Folder Tool.
   *
   * Per Requirement 11.2: Read the current file content, generate a unified diff,
   * and apply the changes through the Folder Tool.
   *
   * @param {Object} step - The step being executed
   * @param {string} filePath - Absolute or relative path to edit
   * @param {string} newContent - Updated file content
   * @returns {Promise<Object>} Result with status, output, diff, and beforeContent
   */
  async function handleCodeEdit(step, filePath, newContent) {
    if (!filePath || typeof filePath !== 'string') {
      return {
        status: 'error',
        output: '',
        error: 'File path must be a non-empty string.',
        diff: '',
        beforeContent: ''
      };
    }

    if (typeof newContent !== 'string') {
      return {
        status: 'error',
        output: '',
        error: 'New content must be a string.',
        diff: '',
        beforeContent: ''
      };
    }

    // Validate path via sandbox enforcer
    if (sandboxEnforcer && typeof sandboxEnforcer.isPathAuthorized === 'function') {
      let resolvedPath = filePath;
      if (typeof sandboxEnforcer.resolvePath === 'function') {
        try {
          resolvedPath = sandboxEnforcer.resolvePath(filePath);
        } catch (err) {
          return {
            status: 'error',
            output: '',
            error: `Path resolution failed: ${err.message}`,
            diff: '',
            beforeContent: ''
          };
        }
      }

      if (!sandboxEnforcer.isPathAuthorized(resolvedPath)) {
        return {
          status: 'error',
          output: '',
          error: `Path "${filePath}" is outside the authorized working directory.`,
          diff: '',
          beforeContent: ''
        };
      }
    }

    // Step 1: Read current file content
    const readResult = await toolDispatcher.dispatch({
      tool: 'folder',
      action: 'readFile',
      params: { path: filePath }
    }, { stepId: step?.id || '' });

    const beforeContent = readResult.status === 'success'
      ? (readResult.output || '')
      : '';

    if (readResult.status !== 'success') {
      return {
        status: 'error',
        output: readResult.output || '',
        error: readResult.error || `Failed to read file: ${filePath}`,
        diff: '',
        beforeContent: ''
      };
    }

    // Step 2: Generate unified diff
    const diff = formatDiff(beforeContent, newContent, filePath);

    // Step 3: Write updated content
    const writeResult = await toolDispatcher.dispatch({
      tool: 'folder',
      action: 'writeFile',
      params: {
        path: filePath,
        content: newContent
      }
    }, { stepId: step?.id || '' });

    if (writeResult.status === 'success') {
      // Log file modification
      if (sandboxEnforcer && typeof sandboxEnforcer.logFileModification === 'function') {
        sandboxEnforcer.logFileModification({
          sessionId: step?.sessionId || 'unknown',
          operation: 'modify',
          path: filePath,
          timestamp: new Date().toISOString()
        });
      }

      return {
        status: 'success',
        output: writeResult.output || '',
        error: null,
        diff,
        beforeContent
      };
    }

    return {
      status: 'error',
      output: writeResult.output || '',
      error: writeResult.error || 'Failed to write file.',
      diff: '',
      beforeContent
    };
  }

  // ─── Validation ────────────────────────────────────────────────────────────

  /**
   * Validates syntax by running the project's lint or compile step.
   *
   * Per Requirement 11.8: Validate syntax by running the project's lint or
   * compile step before marking the Step as complete.
   *
   * @param {string} workingDir - Project working directory
   * @returns {Promise<Object>} Result with pass (boolean), output, and command used
   */
  async function validateSyntax(workingDir) {
    if (!workingDir || typeof workingDir !== 'string') {
      return { pass: true, output: '', command: null, skipped: true };
    }

    const projectInfo = detectProject(workingDir);

    if (!projectInfo.detected) {
      // Per Requirement 11.7: If no config found, skip automatic validation
      return { pass: true, output: '', command: null, skipped: true };
    }

    // Prefer lint command, then build command for syntax validation
    const command = projectInfo.lintCommand || projectInfo.buildCommand;

    if (!command) {
      return { pass: true, output: '', command: null, skipped: true };
    }

    const result = await toolDispatcher.dispatch({
      tool: 'terminal',
      action: 'execute',
      params: {
        command,
        cwd: workingDir
      }
    }, { stepId: 'syntax-validation' });

    const output = truncateOutput(result.output || '', MAX_OUTPUT_LENGTH);

    if (result.status === 'success') {
      return { pass: true, output, command, skipped: false };
    }

    return { pass: false, output, command, skipped: false, error: result.error || '' };
  }

  /**
   * Runs the project's test command.
   *
   * Per Requirement 11.4: Invoke the Terminal Tool with the project's test command
   * and capture the full output.
   *
   * @param {string} workingDir - Project working directory
   * @returns {Promise<Object>} Result with pass (boolean), output, and command used
   */
  async function runTests(workingDir) {
    if (!workingDir || typeof workingDir !== 'string') {
      return { pass: true, output: '', command: null, skipped: true };
    }

    const projectInfo = detectProject(workingDir);

    if (!projectInfo.detected) {
      return { pass: true, output: '', command: null, skipped: true };
    }

    const command = projectInfo.testCommand;

    if (!command) {
      return { pass: true, output: '', command: null, skipped: true };
    }

    const result = await toolDispatcher.dispatch({
      tool: 'terminal',
      action: 'execute',
      params: {
        command,
        cwd: workingDir
      }
    }, { stepId: 'test-run' });

    const output = truncateOutput(result.output || '', MAX_OUTPUT_LENGTH);

    if (result.status === 'success') {
      return { pass: true, output, command, skipped: false };
    }

    return { pass: false, output, command, skipped: false, error: result.error || '' };
  }

  // ─── Orchestration ─────────────────────────────────────────────────────────

  /**
   * Executes a full code generation step with validation and testing.
   *
   * Orchestrates: write/edit → validate syntax → run tests,
   * with up to 3 retry attempts for lint/compile fixes and
   * up to 3 retry attempts for test fixes.
   *
   * Per Requirements 11.5, 11.8, 11.9:
   * - Validate syntax by running lint/compile before marking step complete
   * - Retry syntax fix up to 3 attempts on lint/compile failure
   * - Auto-run tests after code changes; retry test fixes up to 3 attempts
   *
   * @param {Object} step - The step being executed
   * @param {string} workingDir - Project working directory
   * @param {Object} [options] - Execution options
   * @param {string} [options.operation] - 'write' or 'edit'
   * @param {string} [options.filePath] - Target file path
   * @param {string} [options.content] - File content (for write or edit)
   * @param {Function} [options.fixGenerator] - Async function(errorOutput, attempt) => string (new content)
   * @returns {Promise<Object>} Full result with code, syntax, and test outcomes
   */
  async function executeCodeGenStep(step, workingDir, options = {}) {
    const {
      operation = 'write',
      filePath,
      content,
      fixGenerator
    } = options;

    const result = {
      status: 'success',
      codeResult: null,
      syntaxResult: null,
      testResult: null,
      syntaxAttempts: 0,
      testAttempts: 0,
      errors: [],
      diff: ''
    };

    if (!filePath || !content) {
      result.status = 'error';
      result.errors.push('filePath and content are required for code generation steps.');
      return result;
    }

    // ─── Step 1: Write or edit the file ──────────────────────────────────────

    let currentContent = content;
    let codeResult;

    if (operation === 'edit') {
      codeResult = await handleCodeEdit(step, filePath, currentContent);
    } else {
      codeResult = await handleCodeWrite(step, filePath, currentContent);
    }

    result.codeResult = codeResult;
    result.diff = codeResult.diff || '';

    if (codeResult.status !== 'success') {
      result.status = 'error';
      result.errors.push(codeResult.error || 'Code write/edit failed.');
      return result;
    }

    // ─── Step 2: Validate syntax (up to 3 fix attempts) ─────────────────────

    let syntaxResult = await validateSyntax(workingDir);
    result.syntaxResult = syntaxResult;
    result.syntaxAttempts = 1;

    if (!syntaxResult.pass && !syntaxResult.skipped) {
      // Add error to context for fixing
      if (contextManager && typeof contextManager.addStepResult === 'function') {
        contextManager.addStepResult({
          stepId: step?.id || '',
          title: 'Syntax validation failed',
          status: 'failed',
          output: syntaxResult.output || '',
          error: syntaxResult.error || 'Lint/compile failed'
        });
      }

      // Retry syntax fix up to MAX_SYNTAX_FIX_ATTEMPTS times
      for (let attempt = 1; attempt <= MAX_SYNTAX_FIX_ATTEMPTS && !syntaxResult.pass; attempt++) {
        result.syntaxAttempts = attempt + 1;

        if (typeof fixGenerator === 'function') {
          try {
            const fixedContent = await fixGenerator(syntaxResult.output || syntaxResult.error || '', attempt);

            if (fixedContent && typeof fixedContent === 'string') {
              currentContent = fixedContent;

              // Re-write the file with the fix
              const fixResult = operation === 'edit'
                ? await handleCodeEdit(step, filePath, currentContent)
                : await handleCodeWrite(step, filePath, currentContent);

              if (fixResult.status !== 'success') {
                result.errors.push(`Syntax fix attempt ${attempt}: file write failed - ${fixResult.error}`);
                continue;
              }

              result.diff = fixResult.diff || result.diff;

              // Re-validate syntax
              syntaxResult = await validateSyntax(workingDir);
              result.syntaxResult = syntaxResult;
            } else {
              result.errors.push(`Syntax fix attempt ${attempt}: fixGenerator returned no content.`);
            }
          } catch (err) {
            result.errors.push(`Syntax fix attempt ${attempt}: ${err.message}`);
          }
        } else {
          // No fix generator available — cannot auto-fix
          result.errors.push(`Syntax validation failed. No fixGenerator provided for auto-fix attempt ${attempt}.`);
          break;
        }
      }

      if (!syntaxResult.pass) {
        result.status = 'error';
        result.errors.push(
          `Syntax validation failed after ${result.syntaxAttempts} attempt(s). ` +
          `Command: ${syntaxResult.command}. Output: ${truncateOutput(syntaxResult.output || '', 500)}`
        );
        return result;
      }
    }

    // ─── Step 3: Run tests (up to 3 fix attempts) ───────────────────────────

    let testResult = await runTests(workingDir);
    result.testResult = testResult;
    result.testAttempts = 1;

    if (!testResult.pass && !testResult.skipped) {
      // Add test failure to context
      if (contextManager && typeof contextManager.addStepResult === 'function') {
        contextManager.addStepResult({
          stepId: step?.id || '',
          title: 'Tests failed after code changes',
          status: 'failed',
          output: testResult.output || '',
          error: testResult.error || 'Tests failed'
        });
      }

      // Retry test fixes up to MAX_TEST_FIX_ATTEMPTS times
      for (let attempt = 1; attempt <= MAX_TEST_FIX_ATTEMPTS && !testResult.pass; attempt++) {
        result.testAttempts = attempt + 1;

        if (typeof fixGenerator === 'function') {
          try {
            const fixedContent = await fixGenerator(testResult.output || testResult.error || '', attempt);

            if (fixedContent && typeof fixedContent === 'string') {
              currentContent = fixedContent;

              // Re-write the file with the fix
              const fixResult = operation === 'edit'
                ? await handleCodeEdit(step, filePath, currentContent)
                : await handleCodeWrite(step, filePath, currentContent);

              if (fixResult.status !== 'success') {
                result.errors.push(`Test fix attempt ${attempt}: file write failed - ${fixResult.error}`);
                continue;
              }

              result.diff = fixResult.diff || result.diff;

              // Re-validate syntax first (make sure fix didn't break syntax)
              const revalidate = await validateSyntax(workingDir);
              if (!revalidate.pass && !revalidate.skipped) {
                result.errors.push(`Test fix attempt ${attempt}: introduced syntax errors.`);
                continue;
              }

              // Re-run tests
              testResult = await runTests(workingDir);
              result.testResult = testResult;
            } else {
              result.errors.push(`Test fix attempt ${attempt}: fixGenerator returned no content.`);
            }
          } catch (err) {
            result.errors.push(`Test fix attempt ${attempt}: ${err.message}`);
          }
        } else {
          // No fix generator: cannot auto-fix tests
          result.errors.push(`Tests failed. No fixGenerator provided for auto-fix attempt ${attempt}.`);
          break;
        }
      }

      if (!testResult.pass) {
        result.status = 'error';
        result.errors.push(
          `Tests failed after ${result.testAttempts} attempt(s). ` +
          `Command: ${testResult.command}. Output: ${truncateOutput(testResult.output || '', 500)}`
        );
        return result;
      }
    }

    // All steps passed
    result.status = 'success';
    return result;
  }

  // ─── Public Interface ──────────────────────────────────────────────────────

  return {
    handleCodeWrite,
    handleCodeEdit,
    validateSyntax,
    runTests,
    executeCodeGenStep
  };
}
