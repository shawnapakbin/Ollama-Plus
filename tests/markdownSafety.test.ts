import { describe, it, expect } from 'vitest';
import { safeMarkdownUrl } from '../src/services/markdownSafety';

describe('safeMarkdownUrl', () => {
  it('allows http(s), mailto, and tel', () => {
    expect(safeMarkdownUrl('https://example.com')).toBe('https://example.com');
    expect(safeMarkdownUrl('http://localhost:5173')).toBe('http://localhost:5173');
    expect(safeMarkdownUrl('mailto:user@example.com')).toBe('mailto:user@example.com');
    expect(safeMarkdownUrl('tel:+15551234')).toBe('tel:+15551234');
  });

  it('allows relative and fragment links', () => {
    expect(safeMarkdownUrl('#anchor')).toBe('#anchor');
    expect(safeMarkdownUrl('./local.md')).toBe('./local.md');
    expect(safeMarkdownUrl('../up.md')).toBe('../up.md');
    expect(safeMarkdownUrl('/root.md')).toBe('/root.md');
  });

  it('blocks dangerous schemes', () => {
    expect(safeMarkdownUrl('javascript:alert(1)')).toBe('');
    expect(safeMarkdownUrl('  JavaScript:alert(1)  ')).toBe('');
    expect(safeMarkdownUrl('data:text/html,<script>1</script>')).toBe('');
    expect(safeMarkdownUrl('vbscript:msgbox')).toBe('');
    expect(safeMarkdownUrl('file:///etc/passwd')).toBe('');
  });

  it('handles invalid input safely', () => {
    // @ts-expect-error testing runtime behaviour with non-string input
    expect(safeMarkdownUrl(null)).toBe('');
    // @ts-expect-error testing runtime behaviour with non-string input
    expect(safeMarkdownUrl(undefined)).toBe('');
    expect(safeMarkdownUrl('')).toBe('');
    expect(safeMarkdownUrl('   ')).toBe('');
  });
});
