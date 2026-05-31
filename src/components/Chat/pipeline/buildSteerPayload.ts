import type { SteerPayload } from '../hooks/useSteerQueue';

interface AttachedFile {
  name: string;
  content: string | null;
  parsing?: boolean;
}

/**
 * Build the payload that represents a single user turn. The `displayContent`
 * is what's shown in the bubble (file names if no prompt was typed); the
 * `ollamaContent` is what's sent to the model (prompt + inlined file
 * contents).
 */
export function buildSteerPayload(textTrim: string, files: AttachedFile[]): SteerPayload {
  const fileContext =
    files.length > 0
      ? '\n\n' +
        files
          .map(f => `--- Attached file: ${f.name} ---\n${f.content ?? ''}\n--- End of ${f.name} ---`)
          .join('\n\n')
      : '';
  const displayContent = textTrim || `📎 ${files.map(f => f.name).join(', ')}`;
  const ollamaContent = (textTrim || '') + fileContext;
  const attachmentNames = files.map(f => f.name);
  const preview = displayContent.length > 160 ? displayContent.slice(0, 157) + '…' : displayContent;
  return { displayContent, ollamaContent, attachmentNames, preview };
}
