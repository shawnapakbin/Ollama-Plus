/**
 * Output Formatter and Truncation Utility
 *
 * Handles truncation of tool outputs, unified diff formatting for code changes,
 * tool output metadata formatting, and collapse decisions for the Activity Stream.
 *
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.0.3
 */

/**
 * Maximum number of characters for tool output storage and display.
 * @type {number}
 */
export const MAX_OUTPUT_LENGTH = 10_000;

/**
 * Default line threshold for collapsing output in the Activity Stream.
 * @type {number}
 */
export const DEFAULT_COLLAPSE_THRESHOLD = 10;

/**
 * Truncates output to a maximum character length.
 *
 * Per Property 7: For any tool call output of length L characters,
 * the stored and displayed output SHALL have length min(L, maxLength).
 * If L > maxLength, the output SHALL be truncated to exactly maxLength characters.
 *
 * @param {string} output - The raw output string to truncate.
 * @param {number} [maxLength=10000] - Maximum allowed character length.
 * @returns {string} The truncated output (at most maxLength characters).
 */
export function truncateOutput(output, maxLength = MAX_OUTPUT_LENGTH) {
  if (typeof output !== 'string') {
    return '';
  }
  if (output.length <= maxLength) {
    return output;
  }
  return output.slice(0, maxLength);
}

/**
 * Generates a unified diff between before and after content for a file.
 *
 * Produces output in standard unified diff format with --- and +++ headers,
 * @@ hunk markers, and context lines around changes.
 *
 * @param {string} beforeContent - The original file content.
 * @param {string} afterContent - The modified file content.
 * @param {string} filePath - The file path to display in diff headers.
 * @param {number} [contextLines=3] - Number of context lines around each change.
 * @returns {string} Unified diff formatted string.
 */
export function formatDiff(beforeContent, afterContent, filePath, contextLines = 3) {
  const beforeLines = (beforeContent || '').split('\n');
  const afterLines = (afterContent || '').split('\n');

  const header = [
    `--- a/${filePath}`,
    `+++ b/${filePath}`
  ];

  const hunks = computeHunks(beforeLines, afterLines, contextLines);

  if (hunks.length === 0) {
    return '';
  }

  return [...header, ...hunks].join('\n');
}

/**
 * Formats a tool output with metadata for display in the Activity Stream.
 *
 * Includes the tool name, character count, and truncation indicator.
 * The output content is truncated to MAX_OUTPUT_LENGTH.
 *
 * @param {string} output - The raw tool output.
 * @param {string} toolName - The name of the tool that produced the output.
 * @returns {{ tool: string, output: string, length: number, truncated: boolean }} Formatted output with metadata.
 */
export function formatToolOutput(output, toolName) {
  const rawOutput = typeof output === 'string' ? output : '';
  const originalLength = rawOutput.length;
  const truncated = originalLength > MAX_OUTPUT_LENGTH;
  const content = truncateOutput(rawOutput);

  return {
    tool: toolName || 'unknown',
    output: content,
    length: originalLength,
    truncated
  };
}

/**
 * Determines whether tool output should be rendered in a collapsed state.
 *
 * Per Requirement 5.5: When a Tool output exceeds 10 lines, the Activity Stream
 * SHALL render it in a collapsed state.
 *
 * @param {string} output - The output string to evaluate.
 * @param {number} [lineThreshold=10] - Number of lines above which output should collapse.
 * @returns {boolean} True if the output exceeds the line threshold.
 */
export function shouldCollapse(output, lineThreshold = DEFAULT_COLLAPSE_THRESHOLD) {
  if (typeof output !== 'string' || output.length === 0) {
    return false;
  }
  const lineCount = output.split('\n').length;
  return lineCount > lineThreshold;
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

/**
 * Computes the longest common subsequence table for two arrays of lines.
 * Used internally by the diff algorithm.
 *
 * @param {string[]} a - First array of lines.
 * @param {string[]} b - Second array of lines.
 * @returns {number[][]} LCS length table.
 */
function lcsTable(a, b) {
  const m = a.length;
  const n = b.length;
  const table = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        table[i][j] = table[i - 1][j - 1] + 1;
      } else {
        table[i][j] = Math.max(table[i - 1][j], table[i][j - 1]);
      }
    }
  }

  return table;
}

/**
 * Produces diff operations from the LCS table via backtracking.
 *
 * @param {number[][]} table - LCS length table.
 * @param {string[]} a - Original lines.
 * @param {string[]} b - Modified lines.
 * @returns {Array<{ type: 'equal' | 'remove' | 'add', lineA: number, lineB: number, text: string }>} Operations list.
 */
function backtrack(table, a, b) {
  const ops = [];
  let i = a.length;
  let j = b.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      ops.push({ type: 'equal', lineA: i - 1, lineB: j - 1, text: a[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || table[i][j - 1] >= table[i - 1][j])) {
      ops.push({ type: 'add', lineA: i, lineB: j - 1, text: b[j - 1] });
      j--;
    } else {
      ops.push({ type: 'remove', lineA: i - 1, lineB: j, text: a[i - 1] });
      i--;
    }
  }

  return ops.reverse();
}

/**
 * Computes unified diff hunks with context lines.
 *
 * @param {string[]} beforeLines - Original file lines.
 * @param {string[]} afterLines - Modified file lines.
 * @param {number} contextLines - Number of context lines to include around changes.
 * @returns {string[]} Array of hunk strings including @@ markers and diff lines.
 */
function computeHunks(beforeLines, afterLines, contextLines) {
  const table = lcsTable(beforeLines, afterLines);
  const ops = backtrack(table, beforeLines, afterLines);

  // Find change regions (groups of non-equal ops with context)
  const changeIndices = [];
  for (let i = 0; i < ops.length; i++) {
    if (ops[i].type !== 'equal') {
      changeIndices.push(i);
    }
  }

  if (changeIndices.length === 0) {
    return [];
  }

  // Group changes into hunks (merge overlapping context regions)
  const groups = [];
  let currentGroup = { start: changeIndices[0], end: changeIndices[0] };

  for (let i = 1; i < changeIndices.length; i++) {
    if (changeIndices[i] - currentGroup.end <= contextLines * 2 + 1) {
      currentGroup.end = changeIndices[i];
    } else {
      groups.push({ ...currentGroup });
      currentGroup = { start: changeIndices[i], end: changeIndices[i] };
    }
  }
  groups.push(currentGroup);

  // Render each group as a hunk
  const hunkLines = [];

  for (const group of groups) {
    const hunkStart = Math.max(0, group.start - contextLines);
    const hunkEnd = Math.min(ops.length - 1, group.end + contextLines);

    let aStart = 0;
    let bStart = 0;
    let aCount = 0;
    let bCount = 0;
    const lines = [];

    // Calculate starting line numbers
    for (let i = 0; i < hunkStart; i++) {
      if (ops[i].type === 'equal' || ops[i].type === 'remove') aStart++;
      if (ops[i].type === 'equal' || ops[i].type === 'add') bStart++;
    }

    for (let i = hunkStart; i <= hunkEnd; i++) {
      const op = ops[i];
      if (op.type === 'equal') {
        lines.push(` ${op.text}`);
        aCount++;
        bCount++;
      } else if (op.type === 'remove') {
        lines.push(`-${op.text}`);
        aCount++;
      } else if (op.type === 'add') {
        lines.push(`+${op.text}`);
        bCount++;
      }
    }

    // Use 1-based line numbers in hunk headers
    const hunkHeader = `@@ -${aStart + 1},${aCount} +${bStart + 1},${bCount} @@`;
    hunkLines.push(hunkHeader, ...lines);
  }

  return hunkLines;
}
