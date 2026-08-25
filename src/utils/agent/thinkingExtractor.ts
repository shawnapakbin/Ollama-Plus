/**
 * Thinking Content Extractor
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 *
 * Parses <think>...</think> tags from assistant message content,
 * extracting thinking/reasoning blocks into a separate field
 * for collapsible display in the chat stream.
 *
 * Handles:
 * - Single <think>...</think> blocks
 * - Multiple blocks (concatenated with double newline)
 * - Missing closing tags (treats rest of content as thinking)
 * - Nested <think> inside <think> (treated as plain text within thinking)
 * - Case-insensitive tag matching
 */

export interface ExtractThinkingResult {
  mainContent: string;
  thinkingContent: string | null;
}

/**
 * Extracts thinking/reasoning content from `<think>...</think>` tags.
 *
 * @param content - The raw assistant message content potentially containing think tags
 * @returns An object with `mainContent` (cleaned of think tags) and `thinkingContent` (extracted thinking or null)
 */
export function extractThinking(content: string): ExtractThinkingResult {
  if (!content) {
    return { mainContent: '', thinkingContent: null };
  }

  const thinkingBlocks: string[] = [];
  let mainContent = content;

  // First, extract all complete <think>...</think> blocks (non-greedy, case-insensitive).
  // This regex matches the outermost <think>...</think> pairs. Nested <think> tags
  // inside are captured as plain text within the thinking content.
  const completeBlockRegex = /<think>([\s\S]*?)<\/think>/gi;
  let match: RegExpExecArray | null;

  // Collect all complete blocks
  const completeBlocks: Array<{ fullMatch: string; content: string }> = [];
  while ((match = completeBlockRegex.exec(content)) !== null) {
    completeBlocks.push({
      fullMatch: match[0],
      content: match[1],
    });
  }

  // Remove complete blocks from main content and collect thinking
  for (const block of completeBlocks) {
    mainContent = mainContent.replace(block.fullMatch, '');
    const trimmedBlock = block.content.trim();
    if (trimmedBlock.length > 0) {
      thinkingBlocks.push(trimmedBlock);
    }
  }

  // Handle unclosed <think> tag (missing closing tag) — treat rest as thinking
  const unclosedRegex = /<think>([\s\S]*)$/i;
  const unclosedMatch = unclosedRegex.exec(mainContent);
  if (unclosedMatch) {
    mainContent = mainContent.slice(0, unclosedMatch.index);
    const trimmedUnclosed = unclosedMatch[1].trim();
    if (trimmedUnclosed.length > 0) {
      thinkingBlocks.push(trimmedUnclosed);
    }
  }

  // Trim the final main content to remove whitespace left by tag removal
  mainContent = mainContent.trim();

  // Concatenate multiple thinking blocks with double newline separator
  const thinkingContent = thinkingBlocks.length > 0
    ? thinkingBlocks.join('\n\n')
    : null;

  return { mainContent, thinkingContent };
}
