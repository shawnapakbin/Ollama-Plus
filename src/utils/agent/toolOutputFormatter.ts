/**
 * Tool Output Formatter
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 *
 * Formats tool output for display in the Agent Chat Stream.
 * Truncates output to a configurable number of lines for the collapsed view,
 * while providing metadata about overflow and total line count.
 *
 * Requirements: 2.5
 */

export interface FormattedToolOutput {
  /** The truncated output (first maxLines lines) or the full output if no overflow */
  truncated: string;
  /** Whether the output exceeds maxLines */
  isOverflow: boolean;
  /** Total number of lines in the original output */
  totalLines: number;
}

/**
 * Formats tool output by truncating to a maximum number of visible lines.
 *
 * - Splits output by newline characters
 * - If totalLines <= maxLines: returns output as-is with isOverflow = false
 * - If totalLines > maxLines: returns first maxLines lines joined by '\n' with isOverflow = true
 * - Empty string is treated as a single empty line (totalLines = 1, isOverflow = false)
 *
 * @param output - The raw tool output string
 * @param maxLines - Maximum number of lines to show in collapsed view (default: 10)
 * @returns Formatted output with truncation metadata
 */
export function formatToolOutput(
  output: string,
  maxLines: number = 10
): FormattedToolOutput {
  const lines = output.split('\n');
  const totalLines = lines.length;

  if (totalLines <= maxLines) {
    return {
      truncated: output,
      isOverflow: false,
      totalLines,
    };
  }

  return {
    truncated: lines.slice(0, maxLines).join('\n'),
    isOverflow: true,
    totalLines,
  };
}
