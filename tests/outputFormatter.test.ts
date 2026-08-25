import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  truncateOutput,
  formatDiff,
  formatToolOutput,
  shouldCollapse,
  MAX_OUTPUT_LENGTH,
  DEFAULT_COLLAPSE_THRESHOLD
} from '../electron/runtime/agent/outputFormatter.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Property-Based Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('Property 7: Tool output truncation', () => {
  /**
   * **Validates: Requirements 4.3, 4.8**
   *
   * For any tool call output of length L characters, the stored and displayed
   * output SHALL have length min(L, 10000). If L > 10000, the output SHALL
   * be truncated to exactly 10,000 characters.
   */
  it('truncateOutput length equals min(L, 10000) for all strings', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 50_000 }),
        (output) => {
          const result = truncateOutput(output);
          const expectedLength = Math.min(output.length, MAX_OUTPUT_LENGTH);
          expect(result.length).toBe(expectedLength);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('truncated output is always a prefix of the original', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 50_000 }),
        (output) => {
          const result = truncateOutput(output);
          expect(output.startsWith(result)).toBe(true);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('output shorter than or equal to maxLength is returned unchanged', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: MAX_OUTPUT_LENGTH }),
        (output) => {
          const result = truncateOutput(output);
          expect(result).toBe(output);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('output longer than maxLength is truncated to exactly maxLength', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: MAX_OUTPUT_LENGTH + 1, maxLength: 50_000 }),
        (output) => {
          const result = truncateOutput(output);
          expect(result.length).toBe(MAX_OUTPUT_LENGTH);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('custom maxLength is respected for all positive lengths', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 5000 }),
        fc.integer({ min: 1, max: 5000 }),
        (output, maxLen) => {
          const result = truncateOutput(output, maxLen);
          expect(result.length).toBe(Math.min(output.length, maxLen));
        }
      ),
      { numRuns: 200 }
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Unit Tests: truncateOutput
// ═══════════════════════════════════════════════════════════════════════════════

describe('truncateOutput', () => {
  it('returns empty string for non-string input', () => {
    expect(truncateOutput(null as unknown as string)).toBe('');
    expect(truncateOutput(undefined as unknown as string)).toBe('');
    expect(truncateOutput(123 as unknown as string)).toBe('');
  });

  it('returns empty string unchanged', () => {
    expect(truncateOutput('')).toBe('');
  });

  it('returns short strings unchanged', () => {
    expect(truncateOutput('hello')).toBe('hello');
  });

  it('returns string of exactly MAX_OUTPUT_LENGTH unchanged', () => {
    const exact = 'x'.repeat(MAX_OUTPUT_LENGTH);
    expect(truncateOutput(exact)).toBe(exact);
    expect(truncateOutput(exact).length).toBe(MAX_OUTPUT_LENGTH);
  });

  it('truncates string one character over the limit', () => {
    const over = 'y'.repeat(MAX_OUTPUT_LENGTH + 1);
    const result = truncateOutput(over);
    expect(result.length).toBe(MAX_OUTPUT_LENGTH);
    expect(result).toBe('y'.repeat(MAX_OUTPUT_LENGTH));
  });

  it('preserves content up to the truncation point', () => {
    const input = 'abcdefghij'.repeat(2000); // 20,000 chars
    const result = truncateOutput(input);
    expect(result).toBe(input.slice(0, MAX_OUTPUT_LENGTH));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Unit Tests: formatDiff
// ═══════════════════════════════════════════════════════════════════════════════

describe('formatDiff', () => {
  it('returns empty string when content is identical', () => {
    const content = 'line1\nline2\nline3';
    expect(formatDiff(content, content, 'test.js')).toBe('');
  });

  it('generates correct diff headers', () => {
    const result = formatDiff('old', 'new', 'src/file.ts');
    expect(result).toContain('--- a/src/file.ts');
    expect(result).toContain('+++ b/src/file.ts');
  });

  it('marks removed lines with minus prefix', () => {
    const result = formatDiff('removed line\n', 'new line\n', 'file.js');
    expect(result).toContain('-removed line');
  });

  it('marks added lines with plus prefix', () => {
    const result = formatDiff('old line\n', 'new line\n', 'file.js');
    expect(result).toContain('+new line');
  });

  it('includes @@ hunk markers', () => {
    const result = formatDiff('a\n', 'b\n', 'file.js');
    expect(result).toMatch(/@@ -\d+,\d+ \+\d+,\d+ @@/);
  });

  it('handles empty before content (new file)', () => {
    const result = formatDiff('', 'line1\nline2', 'new.js');
    expect(result).toContain('+line1');
    expect(result).toContain('+line2');
  });

  it('handles empty after content (deleted file)', () => {
    const result = formatDiff('line1\nline2', '', 'deleted.js');
    expect(result).toContain('-line1');
    expect(result).toContain('-line2');
  });

  it('handles null/undefined inputs gracefully', () => {
    const result = formatDiff(null as unknown as string, 'content', 'file.js');
    expect(result).toContain('+content');
  });

  it('shows context lines around changes', () => {
    const before = 'line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8';
    const after = 'line1\nline2\nline3\nCHANGED\nline5\nline6\nline7\nline8';
    const result = formatDiff(before, after, 'file.js');
    // Context lines are prefixed with a space
    expect(result).toContain(' line3');
    expect(result).toContain('-line4');
    expect(result).toContain('+CHANGED');
    expect(result).toContain(' line5');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Unit Tests: formatToolOutput
// ═══════════════════════════════════════════════════════════════════════════════

describe('formatToolOutput', () => {
  it('returns correct metadata for short output', () => {
    const result = formatToolOutput('hello world', 'terminal');
    expect(result.tool).toBe('terminal');
    expect(result.output).toBe('hello world');
    expect(result.length).toBe(11);
    expect(result.truncated).toBe(false);
  });

  it('truncates long output and sets truncated flag', () => {
    const longOutput = 'x'.repeat(15_000);
    const result = formatToolOutput(longOutput, 'terminal');
    expect(result.output.length).toBe(MAX_OUTPUT_LENGTH);
    expect(result.length).toBe(15_000);
    expect(result.truncated).toBe(true);
  });

  it('uses "unknown" for missing tool name', () => {
    const result = formatToolOutput('output', '');
    expect(result.tool).toBe('unknown');
  });

  it('handles non-string output gracefully', () => {
    const result = formatToolOutput(null as unknown as string, 'tool');
    expect(result.output).toBe('');
    expect(result.length).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it('preserves exact output when at boundary', () => {
    const exact = 'a'.repeat(MAX_OUTPUT_LENGTH);
    const result = formatToolOutput(exact, 'file');
    expect(result.output).toBe(exact);
    expect(result.truncated).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Unit Tests: shouldCollapse
// ═══════════════════════════════════════════════════════════════════════════════

describe('shouldCollapse', () => {
  it('returns false for empty string', () => {
    expect(shouldCollapse('')).toBe(false);
  });

  it('returns false for non-string input', () => {
    expect(shouldCollapse(null as unknown as string)).toBe(false);
    expect(shouldCollapse(undefined as unknown as string)).toBe(false);
  });

  it('returns false for output with exactly threshold lines', () => {
    const lines = Array.from({ length: DEFAULT_COLLAPSE_THRESHOLD }, (_, i) => `line${i}`).join('\n');
    expect(shouldCollapse(lines)).toBe(false);
  });

  it('returns true for output exceeding threshold lines', () => {
    const lines = Array.from({ length: DEFAULT_COLLAPSE_THRESHOLD + 1 }, (_, i) => `line${i}`).join('\n');
    expect(shouldCollapse(lines)).toBe(true);
  });

  it('returns false for single-line output', () => {
    expect(shouldCollapse('single line output')).toBe(false);
  });

  it('supports custom line threshold', () => {
    const fiveLines = 'a\nb\nc\nd\ne\nf'; // 6 lines
    expect(shouldCollapse(fiveLines, 5)).toBe(true);
    expect(shouldCollapse(fiveLines, 6)).toBe(false);
    expect(shouldCollapse(fiveLines, 10)).toBe(false);
  });

  it('counts trailing newlines as additional lines', () => {
    // "a\nb\n" splits into ["a", "b", ""] = 3 lines
    const twoLinesTrailing = 'a\nb\n';
    expect(shouldCollapse(twoLinesTrailing, 2)).toBe(true);
  });
});
