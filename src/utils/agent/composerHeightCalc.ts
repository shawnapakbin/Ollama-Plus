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

/** Maximum number of text lines the composer expands to before scrolling. */
export const MAX_COMPOSER_LINES = 4;

/**
 * Calculates the appropriate composer textarea height based on content,
 * line height, and viewport dimensions.
 *
 * - Counts newlines in content to determine line count
 * - Multiplies line count by lineHeight for raw height
 * - Clamps between minimum (1 line = lineHeight) and a maximum of 4 lines
 *   (further reduced on small viewports < 600px height)
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
  // Cap at 4 lines; on short viewports allow fewer to preserve space.
  const maxLines = viewportHeight < 600 ? Math.min(3, MAX_COMPOSER_LINES) : MAX_COMPOSER_LINES;
  const maxHeight = maxLines * lineHeight;

  return Math.max(lineHeight, Math.min(rawHeight, maxHeight));
}
