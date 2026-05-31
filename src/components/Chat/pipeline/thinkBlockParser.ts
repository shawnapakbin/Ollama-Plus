import type { ThinkBlockSegment } from '../types';

/**
 * Split assistant content into ordered segments of plain text and `<think>` blocks.
 * Handles streaming where the trailing `<think>` may be unclosed; that segment is
 * returned with `streaming: true` so the renderer can mark it accordingly.
 */
export function parseThinkBlocks(content: string): ThinkBlockSegment[] {
  const segments: ThinkBlockSegment[] = [];
  if (!content) return segments;

  const fullThinkRegex = /<think>([\s\S]*?)<\/think>/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = fullThinkRegex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ kind: 'text', value: content.substring(lastIndex, match.index) });
    }
    segments.push({ kind: 'think', value: match[1] });
    lastIndex = fullThinkRegex.lastIndex;
  }

  const tail = content.substring(lastIndex);
  const partial = tail.match(/<think>([\s\S]*)$/);
  if (partial) {
    const before = tail.replace(/<think>[\s\S]*$/, '');
    if (before) segments.push({ kind: 'text', value: before });
    segments.push({ kind: 'think', value: partial[1], streaming: true });
  } else if (tail) {
    segments.push({ kind: 'text', value: tail });
  }

  return segments;
}
