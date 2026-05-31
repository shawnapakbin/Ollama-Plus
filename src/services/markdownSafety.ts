// Strict URL transform for ReactMarkdown.
// Allows only http(s), mailto, tel, and same-document fragment/relative links.
// Returns an empty string for anything else (which causes react-markdown to render plain text instead of a link).
export function safeMarkdownUrl(url: string): string {
  if (typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('#') || trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../')) {
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed, 'http://local.invalid/');
    const allowed = new Set(['http:', 'https:', 'mailto:', 'tel:']);
    if (!allowed.has(parsed.protocol)) return '';
    return trimmed;
  } catch {
    return '';
  }
}
