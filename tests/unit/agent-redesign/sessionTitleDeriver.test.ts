/**
 * Unit tests for sessionTitleDeriver
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 *
 * Tests the session title derivation logic:
 * - Short messages returned as-is (trimmed)
 * - Long messages truncated at word boundary with ellipsis
 * - Very long single words truncated at 60 chars with ellipsis
 */

import { describe, it, expect } from 'vitest';
import { deriveSessionTitle } from '../../../src/utils/agent/sessionTitleDeriver';

describe('deriveSessionTitle', () => {
  it('returns short messages as-is after trimming', () => {
    expect(deriveSessionTitle('Hello world')).toBe('Hello world');
  });

  it('trims leading and trailing whitespace', () => {
    expect(deriveSessionTitle('  Hello world  ')).toBe('Hello world');
  });

  it('returns exactly 60 character messages unchanged', () => {
    const msg = 'a'.repeat(50) + ' ' + 'b'.repeat(8); // 60 chars
    expect(deriveSessionTitle(msg)).toBe(msg);
  });

  it('truncates at word boundary for messages longer than 60 chars', () => {
    // "This is a test message" repeated to exceed 60 chars
    const msg = 'This is a test message that definitely exceeds sixty characters in total length';
    const result = deriveSessionTitle(msg);
    // Should not exceed 60 chars + ellipsis
    expect(result.endsWith('...')).toBe(true);
    // The part before ellipsis should be <= 60 chars
    const withoutEllipsis = result.slice(0, -3);
    expect(withoutEllipsis.length).toBeLessThanOrEqual(60);
    // Should truncate at a space
    expect(msg.charAt(withoutEllipsis.length)).toBe(' ');
  });

  it('truncates at 60 chars for a single long word with no spaces', () => {
    const longWord = 'a'.repeat(100);
    const result = deriveSessionTitle(longWord);
    expect(result).toBe('a'.repeat(60) + '...');
  });

  it('handles empty string', () => {
    expect(deriveSessionTitle('')).toBe('');
  });

  it('handles whitespace-only string', () => {
    expect(deriveSessionTitle('   \t\n  ')).toBe('');
  });

  it('handles message exactly at boundary with space at position 60', () => {
    // 60 chars + space + more
    const before = 'a'.repeat(60);
    const msg = before + ' extra words here';
    const result = deriveSessionTitle(msg);
    // lastIndexOf(' ', 60) would find the space at index 60
    expect(result).toBe(before + '...');
  });

  it('does not break mid-word', () => {
    const msg = 'short words ' + 'x'.repeat(60); // space at index 11, then 60 chars of 'x'
    const result = deriveSessionTitle(msg);
    expect(result).toBe('short words...');
  });

  it('preserves message with exactly 60 chars after trim', () => {
    const msg = '  ' + 'a'.repeat(60) + '  ';
    const result = deriveSessionTitle(msg);
    expect(result).toBe('a'.repeat(60));
  });
});
