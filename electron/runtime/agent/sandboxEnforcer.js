/**
 * Sandbox Path Enforcer
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.0.3
 *
 * Validates and constrains tool calls to authorized boundaries.
 * Resolves symbolic links and relative paths to canonical form, ensures all
 * file operations target descendants of the authorized working directory,
 * and maintains a file modification audit log.
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * @typedef {Object} ToolCall
 * @property {string} tool - Tool name (terminal, folder, browser, python, http)
 * @property {string} server - MCP server identifier
 * @property {string} action - Action to perform
 * @property {Record<string, unknown>} params - Tool call parameters
 */

/**
 * @typedef {Object} FileModification
 * @property {string} sessionId
 * @property {'create' | 'modify' | 'delete' | 'rename'} operation
 * @property {string} path
 * @property {string} timestamp - ISO 8601 timestamp
 */

/**
 * @typedef {{ valid: true; sanitizedCall: ToolCall }} ValidResult
 * @typedef {{ valid: false; reason: string; requiresApproval: boolean }} InvalidResult
 * @typedef {ValidResult | InvalidResult} ValidationResult
 */

/** Parameters that commonly contain file paths in tool calls. */
const PATH_PARAM_KEYS = [
  'path', 'filePath', 'file', 'target', 'destination', 'source',
  'dir', 'directory', 'cwd', 'workingDirectory', 'from', 'to'
];

/**
 * Creates a new SandboxEnforcer instance.
 *
 * @returns {Object} SandboxEnforcer interface
 */
export function createSandboxEnforcer() {
  /** @type {string | null} */
  let workingDirectory = null;

  /** @type {FileModification[]} */
  const modificationLog = [];

  /**
   * Sets the authorized working directory.
   * All file paths will be validated against this boundary.
   *
   * @param {string} dir - Absolute path to the authorized working directory
   */
  function setWorkingDirectory(dir) {
    if (!dir || typeof dir !== 'string') {
      throw new Error('Working directory must be a non-empty string.');
    }
    const resolved = path.resolve(dir);
    workingDirectory = normalizePathSeparators(resolved);
  }

  /**
   * Returns the current working directory.
   *
   * @returns {string | null}
   */
  function getWorkingDirectory() {
    return workingDirectory;
  }

  /**
   * Resolves a relative or absolute path to its canonical form.
   * Resolves `..`, `.`, and normalizes separators.
   * Attempts to resolve symbolic links when the path exists on disk.
   *
   * @param {string} relativePath - Path to resolve (relative or absolute)
   * @returns {string} Canonical absolute path
   */
  function resolvePath(relativePath) {
    if (!relativePath || typeof relativePath !== 'string') {
      throw new Error('Path must be a non-empty string.');
    }

    let basePath;
    if (path.isAbsolute(relativePath)) {
      basePath = path.resolve(relativePath);
    } else {
      if (!workingDirectory) {
        throw new Error('Working directory not set. Call setWorkingDirectory first.');
      }
      basePath = path.resolve(workingDirectory, relativePath);
    }

    // Attempt symlink resolution for existing paths
    try {
      const realPath = fs.realpathSync(basePath);
      return normalizePathSeparators(realPath);
    } catch {
      // Path does not exist yet (e.g., creating a new file)
      // Fall back to logical resolution
      return normalizePathSeparators(basePath);
    }
  }

  /**
   * Checks whether an absolute path is a descendant of (or equal to)
   * the authorized working directory.
   *
   * @param {string} absolutePath - Absolute path to check
   * @returns {boolean} True if the path is within the sandbox boundary
   */
  function isPathAuthorized(absolutePath) {
    if (!workingDirectory) {
      return false;
    }

    if (!absolutePath || typeof absolutePath !== 'string') {
      return false;
    }

    const normalizedTarget = normalizePathSeparators(path.resolve(absolutePath));
    const normalizedBase = workingDirectory;

    // Path is authorized if it equals or is a descendant of the working directory
    if (normalizedTarget === normalizedBase) {
      return true;
    }

    // Ensure the path starts with workingDir + separator
    const baseWithSep = normalizedBase.endsWith(path.sep)
      ? normalizedBase
      : normalizedBase + path.sep;

    return normalizedTarget.startsWith(baseWithSep);
  }

  /**
   * Validates a tool call against sandbox boundaries.
   * Extracts path parameters, resolves them, and checks authorization.
   *
   * @param {ToolCall} call - The tool call to validate
   * @returns {ValidationResult}
   */
  function validateToolCall(call) {
    if (!call || typeof call !== 'object') {
      return { valid: false, reason: 'Tool call must be an object.', requiresApproval: false };
    }

    if (!workingDirectory) {
      return { valid: false, reason: 'Working directory not set.', requiresApproval: false };
    }

    const params = call.params || {};
    const sanitizedParams = { ...params };
    const violations = [];

    // Check each parameter that might contain a file path
    for (const key of PATH_PARAM_KEYS) {
      const value = params[key];
      if (value !== undefined && value !== null && typeof value === 'string' && value.length > 0) {
        const resolved = resolvePath(value);

        if (!isPathAuthorized(resolved)) {
          violations.push(`Parameter "${key}" resolves to "${resolved}" which is outside the authorized working directory.`);
        } else {
          // Replace with resolved canonical path
          sanitizedParams[key] = resolved;
        }
      }
    }

    if (violations.length > 0) {
      return {
        valid: false,
        reason: violations.join(' '),
        requiresApproval: true
      };
    }

    return {
      valid: true,
      sanitizedCall: {
        tool: call.tool,
        server: call.server,
        action: call.action,
        params: sanitizedParams
      }
    };
  }

  /**
   * Records a file modification in the audit log.
   *
   * @param {FileModification} modification
   */
  function logFileModification(modification) {
    if (!modification || typeof modification !== 'object') {
      throw new Error('Modification must be an object.');
    }

    const validOperations = ['create', 'modify', 'delete', 'rename'];
    if (!validOperations.includes(modification.operation)) {
      throw new Error(`Invalid operation: "${modification.operation}". Must be one of: ${validOperations.join(', ')}.`);
    }

    if (!modification.path || typeof modification.path !== 'string') {
      throw new Error('Modification path must be a non-empty string.');
    }

    if (!modification.sessionId || typeof modification.sessionId !== 'string') {
      throw new Error('Modification sessionId must be a non-empty string.');
    }

    const record = {
      sessionId: modification.sessionId,
      operation: modification.operation,
      path: modification.path,
      timestamp: modification.timestamp || new Date().toISOString()
    };

    modificationLog.push(record);
  }

  /**
   * Retrieves all file modification records for a given session.
   *
   * @param {string} sessionId
   * @returns {FileModification[]}
   */
  function getModificationLog(sessionId) {
    if (!sessionId || typeof sessionId !== 'string') {
      return [];
    }
    return modificationLog.filter(entry => entry.sessionId === sessionId);
  }

  /**
   * Clears the modification log for a specific session.
   * Useful for cleanup after session completion.
   *
   * @param {string} sessionId
   */
  function clearModificationLog(sessionId) {
    for (let i = modificationLog.length - 1; i >= 0; i--) {
      if (modificationLog[i].sessionId === sessionId) {
        modificationLog.splice(i, 1);
      }
    }
  }

  return {
    setWorkingDirectory,
    getWorkingDirectory,
    resolvePath,
    isPathAuthorized,
    validateToolCall,
    logFileModification,
    getModificationLog,
    clearModificationLog
  };
}

/**
 * Normalizes path separators to the OS default and lowercases drive letters on Windows.
 *
 * @param {string} p - Path to normalize
 * @returns {string}
 */
function normalizePathSeparators(p) {
  // Normalize to OS path separator
  let normalized = p.replace(/[/\\]/g, path.sep);

  // On Windows, normalize drive letter to lowercase for consistent comparison
  if (process.platform === 'win32' && /^[A-Z]:/.test(normalized)) {
    normalized = normalized[0].toLowerCase() + normalized.slice(1);
  }

  // Remove trailing separator (unless it's the root)
  if (normalized.length > 1 && normalized.endsWith(path.sep)) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}
