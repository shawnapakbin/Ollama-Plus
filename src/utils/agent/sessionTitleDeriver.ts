/**
 * Session Title Deriver
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 *
 * Derives a session title from the first user message.
 * Truncates to 60 characters at a word boundary with an ellipsis if needed.
 */

const MAX_TITLE_LENGTH = 60;

/**
 * Derives a session title from the first user message content.
 *
 * - Trims the input first
 * - If trimmed length <= 60, returns as-is
 * - If longer, finds the last space at or before index 60, truncates there,
 *   and appends an ellipsis ("...")
 * - If no space is found within 60 chars (single very long word), truncates
 *   at 60 chars and appends ellipsis
 *
 * @param firstMessage - The content of the first user message in a session
 * @returns The derived session title (max 60 chars + optional ellipsis)
 */
export function deriveSessionTitle(firstMessage: string): string {
  const trimmed = firstMessage.trim();

  if (trimmed.length <= MAX_TITLE_LENGTH) {
    return trimmed;
  }

  // Find the last space at or before the max length position
  const lastSpaceIndex = trimmed.lastIndexOf(' ', MAX_TITLE_LENGTH);

  if (lastSpaceIndex > 0) {
    // Truncate at word boundary and append ellipsis
    return trimmed.slice(0, lastSpaceIndex) + '...';
  }

  // No space found — single long word, truncate at max length
  return trimmed.slice(0, MAX_TITLE_LENGTH) + '...';
}
