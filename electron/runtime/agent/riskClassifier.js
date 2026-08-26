/**
 * Risk Classifier
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.0.3
 *
 * Classifies operations as low, medium, or high risk based on default criteria
 * and user-configured custom approval rules. Custom rules take precedence over
 * default classifications.
 *
 * Default high-risk criteria (Requirement 6.5):
 *   - File deletion operations
 *   - Shell command execution targeting a path outside the working directory
 *   - Network requests to hosts not in a user-configured allowlist
 *   - Operations modifying more than 5 files simultaneously
 *
 * Custom rules (Requirement 6.6):
 *   - Glob patterns matched against tool+action+params description
 *   - Regex patterns matched against tool+action+params description
 *   - Custom rules take precedence: if a custom rule matches, approval is required
 *     regardless of default classification
 *
 * Requirements: 6.1, 6.5, 6.6
 */
import path from 'node:path';

/**
 * @typedef {Object} Operation
 * @property {string} tool - Tool name (terminal, folder, browser, python, http)
 * @property {string} action - Action being performed (e.g., 'delete', 'execute', 'write')
 * @property {Record<string, unknown>} params - Tool call parameters
 * @property {string} workingDirectory - Authorized working directory
 * @property {string[]} [affectedPaths] - Paths affected by this operation
 */

/**
 * @typedef {Object} ApprovalRule
 * @property {string} id
 * @property {string} pattern - Glob or regex pattern (max 500 chars)
 * @property {'glob' | 'regex'} type
 * @property {string} description
 */

/**
 * @typedef {Object} RiskClassification
 * @property {'low' | 'medium' | 'high'} level
 * @property {boolean} requiresApproval
 * @property {string} reason
 */

/**
 * @typedef {Object} RiskConfig
 * @property {ApprovalRule[]} [customApprovalRules] - User-configured custom rules
 * @property {string[]} [allowedHosts] - Hosts allowed for network requests without approval
 * @property {boolean} [autoApprovalLowRisk] - Whether low-risk operations skip approval gates
 */

/** Maximum number of files before an operation is classified as high-risk. */
const MAX_SAFE_FILE_COUNT = 5;

/** Actions that constitute file deletion. */
const DELETION_ACTIONS = ['delete', 'remove', 'unlink', 'rm', 'rmdir'];

/** Tools that perform network requests. */
const NETWORK_TOOLS = ['http', 'browser'];

/** Default allowed hosts that don't trigger high-risk classification. */
const DEFAULT_ALLOWED_HOSTS = ['localhost', '127.0.0.1', '::1'];

/**
 * Converts a glob pattern to a regular expression.
 * Supports *, **, and ? wildcards.
 *
 * Since we're matching against operation description strings (not file paths),
 * `*` matches any sequence of characters (including slashes and spaces).
 * `?` matches any single character.
 *
 * If the pattern contains no wildcards, it is used as a substring match.
 * If the pattern contains wildcards, the full string must match.
 *
 * @param {string} glob - Glob pattern
 * @returns {RegExp}
 */
function globToRegex(glob) {
  const hasWildcards = /[*?[\]]/.test(glob);

  let regex = '';
  let i = 0;

  while (i < glob.length) {
    const char = glob[i];

    if (char === '*') {
      if (glob[i + 1] === '*') {
        // ** matches everything (same as * for operation strings)
        regex += '.*';
        i += 2;
        // Skip a following slash if present
        if (glob[i] === '/' || glob[i] === '\\') {
          i++;
        }
      } else {
        // * matches any sequence of characters (operation strings, not file paths)
        regex += '.*';
        i++;
      }
    } else if (char === '?') {
      regex += '.';
      i++;
    } else if (char === '[') {
      // Character class — pass through
      const closingBracket = glob.indexOf(']', i + 1);
      if (closingBracket === -1) {
        regex += '\\[';
        i++;
      } else {
        regex += glob.slice(i, closingBracket + 1);
        i = closingBracket + 1;
      }
    } else if ('.+^${}()|\\'.includes(char)) {
      // Escape regex special characters
      regex += '\\' + char;
      i++;
    } else {
      regex += char;
      i++;
    }
  }

  // If no wildcards, use substring matching; otherwise anchor the full match
  if (hasWildcards) {
    return new RegExp(`^${regex}$`, 'i');
  }
  return new RegExp(regex, 'i');
}

/**
 * Builds a matchable string from an operation for rule matching.
 * Format: "tool:action params_key=params_value ..."
 *
 * @param {Operation} operation
 * @returns {string}
 */
function buildOperationString(operation) {
  const parts = [`${operation.tool}:${operation.action}`];

  if (operation.params) {
    for (const [key, value] of Object.entries(operation.params)) {
      if (value !== undefined && value !== null) {
        parts.push(`${key}=${String(value)}`);
      }
    }
  }

  if (operation.affectedPaths && operation.affectedPaths.length > 0) {
    parts.push(`paths=${operation.affectedPaths.join(',')}`);
  }

  return parts.join(' ');
}

/**
 * Checks whether an operation matches a single approval rule.
 *
 * @param {Operation} operation
 * @param {ApprovalRule} rule
 * @returns {boolean}
 */
function matchesSingleRule(operation, rule) {
  const operationString = buildOperationString(operation);

  if (rule.type === 'regex') {
    try {
      const regex = new RegExp(rule.pattern, 'i');
      return regex.test(operationString);
    } catch {
      // Invalid regex pattern — treat as non-matching
      return false;
    }
  }

  if (rule.type === 'glob') {
    const regex = globToRegex(rule.pattern);
    return regex.test(operationString);
  }

  return false;
}

/**
 * Checks whether an operation matches any of the provided custom approval rules.
 *
 * @param {Operation} operation - The operation to check
 * @param {ApprovalRule[]} rules - Custom approval rules to match against
 * @returns {{ matched: boolean, rule: ApprovalRule | null }}
 */
export function matchesCustomRule(operation, rules) {
  if (!operation || !rules || !Array.isArray(rules)) {
    return { matched: false, rule: null };
  }

  for (const rule of rules) {
    if (!rule || !rule.pattern || !rule.type) {
      continue;
    }
    if (matchesSingleRule(operation, rule)) {
      return { matched: true, rule };
    }
  }

  return { matched: false, rule: null };
}

/**
 * Checks if an operation is a file deletion.
 *
 * @param {Operation} operation
 * @returns {boolean}
 */
function isFileDeletion(operation) {
  const action = (operation.action || '').toLowerCase();
  return DELETION_ACTIONS.includes(action);
}

/**
 * Checks if a command targets a path outside the working directory.
 *
 * @param {Operation} operation
 * @returns {boolean}
 */
function isCommandOutsideWorkingDir(operation) {
  if (operation.tool !== 'terminal') {
    return false;
  }

  const workingDir = operation.workingDirectory;
  if (!workingDir) {
    return false;
  }

  const normalizedWorkingDir = normalizePath(path.resolve(workingDir));

  // Check params that indicate a target directory/path
  const targetKeys = ['cwd', 'workingDirectory', 'dir', 'path', 'target'];
  for (const key of targetKeys) {
    const value = operation.params?.[key];
    if (typeof value === 'string' && value.length > 0) {
      const resolved = path.isAbsolute(value)
        ? normalizePath(path.resolve(value))
        : normalizePath(path.resolve(workingDir, value));

      if (!isDescendantOf(resolved, normalizedWorkingDir)) {
        return true;
      }
    }
  }

  // Check the command string for absolute paths outside working dir
  const command = operation.params?.command || operation.params?.cmd || '';
  if (typeof command === 'string' && command.length > 0) {
    // Extract potential absolute paths from the command
    const absolutePathPattern = process.platform === 'win32'
      ? /[A-Za-z]:[\\\/][^\s"']+/g
      : /\/[^\s"']+/g;

    const matches = command.match(absolutePathPattern) || [];
    for (const match of matches) {
      const normalizedMatch = normalizePath(path.resolve(match));
      if (!isDescendantOf(normalizedMatch, normalizedWorkingDir)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Checks if a network request targets a non-allowlisted host.
 *
 * @param {Operation} operation
 * @param {string[]} allowedHosts - Hosts that are allowed without approval
 * @returns {boolean}
 */
function isNetworkToDisallowedHost(operation, allowedHosts) {
  if (!NETWORK_TOOLS.includes(operation.tool)) {
    return false;
  }

  const allAllowed = [...DEFAULT_ALLOWED_HOSTS, ...(allowedHosts || [])];

  // Extract host from URL params
  const urlKeys = ['url', 'href', 'endpoint', 'host', 'uri'];
  for (const key of urlKeys) {
    const value = operation.params?.[key];
    if (typeof value === 'string' && value.length > 0) {
      const host = extractHost(value);
      if (host && !allAllowed.includes(host.toLowerCase())) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Checks if an operation modifies more than MAX_SAFE_FILE_COUNT files.
 *
 * @param {Operation} operation
 * @returns {boolean}
 */
function isMultiFileModification(operation) {
  if (operation.affectedPaths && Array.isArray(operation.affectedPaths)) {
    return operation.affectedPaths.length > MAX_SAFE_FILE_COUNT;
  }
  return false;
}

/**
 * Classifies the risk level of an operation.
 *
 * Custom rules take precedence over default classifications (Requirement 6.6):
 * If a custom rule matches, the operation requires approval regardless of
 * what the default classification would be.
 *
 * @param {Operation} operation - The operation to classify
 * @param {RiskConfig} [config] - Risk configuration including custom rules and allowlists
 * @returns {RiskClassification}
 */
export function classifyRisk(operation, config = {}) {
  if (!operation || typeof operation !== 'object') {
    return { level: 'low', requiresApproval: false, reason: 'Invalid operation object.' };
  }

  const customRules = config.customApprovalRules || [];
  const allowedHosts = config.allowedHosts || [];

  // Custom rules take precedence (Requirement 6.6)
  const customMatch = matchesCustomRule(operation, customRules);
  if (customMatch.matched) {
    const description = customMatch.rule?.description || customMatch.rule?.pattern || 'custom rule';
    return {
      level: 'high',
      requiresApproval: true,
      reason: `Matches custom approval rule: ${description}`
    };
  }

  // Default high-risk checks (Requirement 6.5)

  // 1. File deletion
  if (isFileDeletion(operation)) {
    return {
      level: 'high',
      requiresApproval: true,
      reason: 'File deletion operation requires approval.'
    };
  }

  // 2. Shell command outside working directory
  if (isCommandOutsideWorkingDir(operation)) {
    return {
      level: 'high',
      requiresApproval: true,
      reason: 'Shell command targets a path outside the authorized working directory.'
    };
  }

  // 3. Network request to non-allowlisted host
  if (isNetworkToDisallowedHost(operation, allowedHosts)) {
    return {
      level: 'high',
      requiresApproval: true,
      reason: 'Network request to a host not in the configured allowlist.'
    };
  }

  // 4. Operations modifying more than 5 files simultaneously
  if (isMultiFileModification(operation)) {
    return {
      level: 'high',
      requiresApproval: true,
      reason: `Operation modifies more than ${MAX_SAFE_FILE_COUNT} files simultaneously.`
    };
  }

  // No high-risk criteria matched — classify as low risk
  return {
    level: 'low',
    requiresApproval: false,
    reason: 'Operation does not match any high-risk criteria.'
  };
}

/**
 * Extracts hostname from a URL string.
 *
 * @param {string} urlString
 * @returns {string | null}
 */
function extractHost(urlString) {
  try {
    // Handle cases with protocol
    if (urlString.includes('://')) {
      const url = new URL(urlString);
      return url.hostname || null;
    }
    // Handle host:port or plain host
    const hostPart = urlString.split('/')[0].split(':')[0];
    return hostPart || null;
  } catch {
    // If URL parsing fails, try basic extraction
    const hostPart = urlString.split('/')[0].split(':')[0];
    return hostPart || null;
  }
}

/**
 * Normalizes a path for comparison: resolves, lowercases drive letters on Windows,
 * uses OS separators, and removes trailing separators.
 *
 * @param {string} p - Path to normalize
 * @returns {string}
 */
function normalizePath(p) {
  let normalized = p.replace(/[/\\]/g, path.sep);

  // Normalize drive letter to lowercase on Windows
  if (process.platform === 'win32' && /^[A-Z]:/.test(normalized)) {
    normalized = normalized[0].toLowerCase() + normalized.slice(1);
  }

  // Remove trailing separator unless root
  if (normalized.length > 1 && normalized.endsWith(path.sep)) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

/**
 * Checks if targetPath is equal to or a descendant of basePath.
 *
 * @param {string} targetPath - Normalized absolute path
 * @param {string} basePath - Normalized absolute base path
 * @returns {boolean}
 */
function isDescendantOf(targetPath, basePath) {
  if (targetPath === basePath) {
    return true;
  }

  const baseWithSep = basePath.endsWith(path.sep) ? basePath : basePath + path.sep;
  return targetPath.startsWith(baseWithSep);
}
