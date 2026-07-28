import type { SteerPayload } from '../hooks/useSteerQueue';

interface AttachedFile {
  name: string;
  content: string | null;
  kind?: 'text' | 'image';
  mimeType?: string;
  imageBase64?: string | null;
  imagePath?: string | null;
  parsing?: boolean;
}

/**
 * Build the payload that represents a single user turn. The `displayContent`
 * is what's shown in the bubble (file names if no prompt was typed); the
 * `ollamaContent` is what's sent to the model (prompt + inlined file
 * contents).
 */
export function buildSteerPayload(textTrim: string, files: AttachedFile[]): SteerPayload {
  const textFiles = files.filter((f) => (f.kind || 'text') === 'text');
  const imageFiles = files.filter((f) => f.kind === 'image');
  const fileContext =
    textFiles.length > 0
      ? '\n\n' +
        textFiles
          .map(f => `--- Attached file: ${f.name} ---\n${f.content ?? ''}\n--- End of ${f.name} ---`)
          .join('\n\n')
      : '';

  const imageContext =
    imageFiles.length > 0
      ? `\n\nAttached images: ${imageFiles.map((f) => f.name).join(', ')}.`
      : '';

  const displayContent = textTrim || `📎 ${files.map(f => f.name).join(', ')}`;
  const ollamaContent = (textTrim || '') + fileContext + imageContext;
  const attachmentNames = files.map(f => f.name);
  const imagePayloads = imageFiles
    .map((f) => (f.imageBase64 || '').trim())
    .filter((v) => v.length > 0);
  const imageReferences = imageFiles
    .map((f) => (f.imagePath || '').trim())
    .filter((v) => v.length > 0);
  const preview = displayContent.length > 160 ? displayContent.slice(0, 157) + '…' : displayContent;
  return { displayContent, ollamaContent, attachmentNames, imagePayloads, imageReferences, preview };
}
