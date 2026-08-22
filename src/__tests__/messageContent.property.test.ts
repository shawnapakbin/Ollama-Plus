/**
 * Property-based tests for MessageContent component.
 *
 * Feature: chat-streaming-richtext-metrics
 * - Property 2: Whitespace-only content renders empty
 * - Property 3: HTML sanitization blocks executable content
 * - Property 4: Single newlines produce line breaks
 *
 * Validates: Requirements 1.3, 1.5, 1.7
 */

// @vitest-environment jsdom

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { render } from '@testing-library/react';
import { MessageContent } from '../components/Chat/MessageContent';

describe('Feature: chat-streaming-richtext-metrics, Property 2: Whitespace-only content renders empty', () => {
  /**
   * **Validates: Requirements 1.7**
   *
   * For any string composed entirely of whitespace characters (spaces, tabs,
   * newlines, carriage returns), rendering through MessageContent SHALL produce
   * a container with no visible text content and no markdown structural elements
   * (no <p>, <li>, <code> etc. with text).
   */
  it('whitespace-only content renders an empty container with no markdown structural elements', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[\s]+$/).filter(s => s.length > 0 && s.length <= 50),
        (whitespaceContent) => {
          const { container } = render(MessageContent({ content: whitespaceContent }) as any);
          const messageDiv = container.querySelector('.message-content');

          expect(messageDiv).not.toBeNull();

          // Should have no visible text content
          const textContent = messageDiv!.textContent || '';
          expect(textContent.trim()).toBe('');

          // Should have no markdown structural elements with text
          const structuralElements = messageDiv!.querySelectorAll('p, li, code, h1, h2, h3, h4, h5, h6, blockquote, pre, table, td, th');
          structuralElements.forEach((el) => {
            expect((el.textContent || '').trim()).toBe('');
          });
        }
      ),
      { numRuns: 100 }
    );
  });

  it('empty string renders an empty container', () => {
    const { container } = render(MessageContent({ content: '' }) as any);
    const messageDiv = container.querySelector('.message-content');
    expect(messageDiv).not.toBeNull();
    expect(messageDiv!.children.length).toBe(0);
  });
});

describe('Feature: chat-streaming-richtext-metrics, Property 3: HTML sanitization blocks executable content', () => {
  /**
   * **Validates: Requirements 1.5**
   *
   * For any message content string containing embedded HTML with executable vectors
   * (script tags, event handler attributes, javascript: URIs, data: URIs with script
   * MIME types), rendering through MessageContent SHALL produce output where the DOM
   * contains zero <script> elements, zero attributes matching on[a-z]+, and zero
   * href/src attributes starting with javascript:.
   */

  // Generator for XSS script tag payloads
  const scriptTagGen = fc.tuple(
    fc.lorem({ maxCount: 3 }),
    fc.constantFrom(
      '<script>alert("xss")</script>',
      '<script src="evil.js"></script>',
      '<SCRIPT>document.cookie</SCRIPT>',
      '<script type="text/javascript">fetch("/steal")</script>',
      '<script>window.location="http://evil.com"</script>'
    ),
    fc.lorem({ maxCount: 3 })
  ).map(([before, script, after]) => `${before}\n\n${script}\n\n${after}`);

  // Generator for event handler payloads
  const eventHandlerGen = fc.tuple(
    fc.lorem({ maxCount: 3 }),
    fc.constantFrom(
      '<div onclick="alert(1)">click me</div>',
      '<img onerror="alert(1)" src="x">',
      '<a onmouseover="alert(1)">hover</a>',
      '<body onload="alert(1)">text</body>',
      '<input onfocus="alert(1)" autofocus>'
    ),
    fc.lorem({ maxCount: 3 })
  ).map(([before, handler, after]) => `${before}\n\n${handler}\n\n${after}`);

  // Generator for javascript: URI payloads
  const jsUriGen = fc.tuple(
    fc.lorem({ maxCount: 3 }),
    fc.constantFrom(
      '<a href="javascript:alert(1)">click</a>',
      '<a href="javascript:void(0)">link</a>',
      '<a href="JAVASCRIPT:alert(document.domain)">xss</a>',
      '[click me](javascript:alert(1))'
    ),
    fc.lorem({ maxCount: 3 })
  ).map(([before, uri, after]) => `${before}\n\n${uri}\n\n${after}`);

  // Combined XSS vector generator
  const xssVectorGen = fc.oneof(scriptTagGen, eventHandlerGen, jsUriGen);

  it('rendered output contains zero <script> elements, zero on* event handlers, and zero javascript: URIs', () => {
    fc.assert(
      fc.property(xssVectorGen, (maliciousContent) => {
        const { container } = render(MessageContent({ content: maliciousContent }) as any);
        const messageDiv = container.querySelector('.message-content');

        expect(messageDiv).not.toBeNull();

        // Zero <script> elements
        const scripts = messageDiv!.querySelectorAll('script');
        expect(scripts.length).toBe(0);

        // Zero attributes matching on[a-z]+
        const allElements = messageDiv!.querySelectorAll('*');
        allElements.forEach((el) => {
          const attrs = el.getAttributeNames();
          attrs.forEach((attr) => {
            expect(attr).not.toMatch(/^on[a-z]+$/i);
          });
        });

        // Zero href/src attributes starting with javascript:
        const linksAndMedia = messageDiv!.querySelectorAll('[href], [src]');
        linksAndMedia.forEach((el) => {
          const href = el.getAttribute('href') || '';
          const src = el.getAttribute('src') || '';
          expect(href.toLowerCase()).not.toMatch(/^javascript:/);
          expect(src.toLowerCase()).not.toMatch(/^javascript:/);
        });
      }),
      { numRuns: 100 }
    );
  });
});

describe('Feature: chat-streaming-richtext-metrics, Property 4: Single newlines produce line breaks', () => {
  /**
   * **Validates: Requirements 1.3**
   *
   * For any string containing one or more single newline characters (not preceded
   * or followed by another newline), rendering through MessageContent SHALL produce
   * HTML output containing a <br> element for each single newline.
   */

  // Generator for lines of non-empty text separated by single newlines
  // Lines must not start with 4+ spaces (which Markdown treats as code blocks)
  const singleNewlineContentGen = fc
    .array(
      fc.stringMatching(/^[a-zA-Z0-9 ]{1,20}$/).filter(s => s.trim().length > 0 && !/^ {4,}/.test(s)),
      { minLength: 2, maxLength: 6 }
    )
    .map((lines) => lines.join('\n'));

  it('single newlines between text lines produce <br> elements', () => {
    fc.assert(
      fc.property(singleNewlineContentGen, (content) => {
        const { container } = render(MessageContent({ content }) as any);
        const messageDiv = container.querySelector('.message-content');

        expect(messageDiv).not.toBeNull();

        // Count expected single newlines (number of lines - 1)
        const lines = content.split('\n');
        const expectedBreaks = lines.length - 1;

        // Count <br> elements in the rendered output
        const brElements = messageDiv!.querySelectorAll('br');
        expect(brElements.length).toBeGreaterThanOrEqual(expectedBreaks);
      }),
      { numRuns: 100 }
    );
  });
});
