/**
 * Unit tests for thinkingExtractor
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 *
 * Tests the extractThinking utility that parses <think>...</think> tags
 * from assistant messages for collapsible display.
 *
 * Validates: Requirements 1.7
 */

import { describe, it, expect } from 'vitest';
import { extractThinking } from '../../../src/utils/agent/thinkingExtractor';

describe('extractThinking', () => {
  describe('no think tags', () => {
    it('returns content unchanged when no think tags present', () => {
      const result = extractThinking('Hello, this is a normal message.');
      expect(result.mainContent).toBe('Hello, this is a normal message.');
      expect(result.thinkingContent).toBeNull();
    });

    it('returns empty string for empty input', () => {
      const result = extractThinking('');
      expect(result.mainContent).toBe('');
      expect(result.thinkingContent).toBeNull();
    });

    it('handles whitespace-only content', () => {
      const result = extractThinking('   \n\t  ');
      expect(result.mainContent).toBe('');
      expect(result.thinkingContent).toBeNull();
    });
  });

  describe('single think block', () => {
    it('extracts a single think block', () => {
      const input = 'Before <think>some reasoning here</think> After';
      const result = extractThinking(input);
      expect(result.mainContent).toBe('Before  After');
      expect(result.thinkingContent).toBe('some reasoning here');
    });

    it('handles think block at the start', () => {
      const input = '<think>reasoning</think>Main content here';
      const result = extractThinking(input);
      expect(result.mainContent).toBe('Main content here');
      expect(result.thinkingContent).toBe('reasoning');
    });

    it('handles think block at the end', () => {
      const input = 'Main content here<think>reasoning</think>';
      const result = extractThinking(input);
      expect(result.mainContent).toBe('Main content here');
      expect(result.thinkingContent).toBe('reasoning');
    });

    it('handles multiline thinking content', () => {
      const input = 'Hello<think>line1\nline2\nline3</think>World';
      const result = extractThinking(input);
      expect(result.mainContent).toBe('HelloWorld');
      expect(result.thinkingContent).toBe('line1\nline2\nline3');
    });

    it('trims whitespace from extracted thinking content', () => {
      const input = 'Content<think>  \n  reasoning  \n  </think>more';
      const result = extractThinking(input);
      expect(result.thinkingContent).toBe('reasoning');
    });
  });

  describe('multiple think blocks', () => {
    it('concatenates multiple think blocks with double newline', () => {
      const input = 'A<think>first</think>B<think>second</think>C';
      const result = extractThinking(input);
      expect(result.mainContent).toBe('ABC');
      expect(result.thinkingContent).toBe('first\n\nsecond');
    });

    it('handles three think blocks', () => {
      const input = '<think>one</think>text<think>two</think>more<think>three</think>';
      const result = extractThinking(input);
      expect(result.mainContent).toBe('textmore');
      expect(result.thinkingContent).toBe('one\n\ntwo\n\nthree');
    });

    it('skips empty think blocks', () => {
      const input = 'A<think></think>B<think>valid</think>C<think>   </think>D';
      const result = extractThinking(input);
      expect(result.mainContent).toBe('ABCD');
      expect(result.thinkingContent).toBe('valid');
    });
  });

  describe('missing closing tags', () => {
    it('treats content after unclosed think tag as thinking', () => {
      const input = 'Before <think>thinking without end';
      const result = extractThinking(input);
      expect(result.mainContent).toBe('Before');
      expect(result.thinkingContent).toBe('thinking without end');
    });

    it('handles unclosed think tag at very start', () => {
      const input = '<think>all thinking no close';
      const result = extractThinking(input);
      expect(result.mainContent).toBe('');
      expect(result.thinkingContent).toBe('all thinking no close');
    });

    it('handles complete block followed by unclosed block', () => {
      const input = 'A<think>closed</think>B<think>unclosed rest';
      const result = extractThinking(input);
      expect(result.mainContent).toBe('AB');
      expect(result.thinkingContent).toBe('closed\n\nunclosed rest');
    });
  });

  describe('case insensitivity', () => {
    it('handles uppercase THINK tags', () => {
      const input = 'Before<THINK>reasoning</THINK>After';
      const result = extractThinking(input);
      expect(result.mainContent).toBe('BeforeAfter');
      expect(result.thinkingContent).toBe('reasoning');
    });

    it('handles mixed case Think tags', () => {
      const input = 'Before<Think>reasoning</Think>After';
      const result = extractThinking(input);
      expect(result.mainContent).toBe('BeforeAfter');
      expect(result.thinkingContent).toBe('reasoning');
    });

    it('handles mixed case unclosed tag', () => {
      const input = 'Before<THINK>unclosed thinking';
      const result = extractThinking(input);
      expect(result.mainContent).toBe('Before');
      expect(result.thinkingContent).toBe('unclosed thinking');
    });
  });

  describe('nested tags', () => {
    it('treats nested <think> inside think block as plain text', () => {
      const input = 'Content<think>outer <think>inner</think> text</think>End';
      const result = extractThinking(input);
      // The non-greedy regex matches the first </think>, so:
      // First match: "outer <think>inner"
      // Then remaining text has " text</think>End" which doesn't have an opening <think>
      expect(result.mainContent).toContain('End');
      expect(result.thinkingContent).not.toBeNull();
    });
  });

  describe('trimming behavior', () => {
    it('trims leading/trailing whitespace from main content after extraction', () => {
      const input = '   <think>thinking</think>   content   ';
      const result = extractThinking(input);
      expect(result.mainContent).toBe('content');
    });

    it('trims whitespace created by removing middle think blocks', () => {
      const input = '<think>thinking</think>\n\nActual content';
      const result = extractThinking(input);
      expect(result.mainContent).toBe('Actual content');
    });
  });
});
