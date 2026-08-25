/**
 * Composer Height Calculator
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 *
 * Calculates the auto-expanding height of the Agent Composer textarea
 * based on content line count, line height, and viewport constraints.
 *
 * The composer grows monotonically with content length until a maximum
 * height is reached. On small viewports (< 600px height), the maximum
 * is reduced to preserve screen space.
 *
 * Requirements: 7.1, 10.6
 */

/**
 * Calculates the appropriate composer textarea height based on content,
 * line height, and viewport dimensions.
 *
 * - Counts newlines in content to determine line count
 * - Multiplies line count by lineHeight for raw height
 * - Clamps between minimum (1 line = lineHeight) and maximum (200px, or 100px on small viewports)
 * - The height grows monotonically with content length until the max is reached
 *
 * @param content - The current textarea content string
 * @param lineHeight - The height of a single line in pixels
 * @param viewportHeight - The current viewport height in pixels
 * @returns The calculated height in pixels
 */
export function calculateComposerHeight(
  content: string,
  lineHeight: number,
  viewportHeight: number
): number {
  const lineCount = content.split('\n').length;
  const rawHeight = lineCount * lineHeight;
  const maxHeight = viewportHeight < 600 ? 100 : 200;

  return Math.max(lineHeight, Math.min(rawHeight, maxHeight));
}
