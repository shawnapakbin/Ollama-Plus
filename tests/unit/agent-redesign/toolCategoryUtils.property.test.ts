/**
 * Property-Based Tests: Tool Category Utils (Property 4)
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.0.3
 *
 * Feature: agent-page-redesign, Property 4: Tool use blocks display correct category accent color
 *
 * Validates: Requirements 2.2, 9.3
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { getCategoryColor, getCategoryIcon } from '../../../src/utils/agent/toolCategoryUtils';
import type { ToolCategory } from '../../../src/types/agentChat';

// ─── Expected Mappings ───────────────────────────────────────────────────────

const EXPECTED_COLORS: Record<ToolCategory, string> = {
  file: '#64d28c',
  terminal: '#6cb4f8',
  browser: '#c0a0f0',
  http: '#f0c83c',
  python: '#a78bfa'
};

const ALL_CATEGORIES: ToolCategory[] = ['file', 'terminal', 'browser', 'http', 'python'];

// ─── Arbitraries (Generators) ────────────────────────────────────────────────

const categoryArb = fc.constantFrom<ToolCategory>(...ALL_CATEGORIES);

// ─── Property 4: Tool use blocks display correct category accent color ───────

describe('Property 4: Tool use blocks display correct category accent color', () => {
  /**
   * **Validates: Requirements 2.2, 9.3**
   *
   * For any tool use block with a category in {file, terminal, browser, http, python},
   * the rendered block SHALL apply the category-specific accent color:
   * green (#64d28c) for file, blue (#6cb4f8) for terminal, purple (#c0a0f0) for browser,
   * amber (#f0c83c) for http, and violet (#a78bfa) for python.
   */

  it('maps every category to its expected hex color', () => {
    fc.assert(
      fc.property(categoryArb, (category) => {
        const color = getCategoryColor(category);
        expect(color).toBe(EXPECTED_COLORS[category]);
      }),
      { numRuns: 100 }
    );
  });

  it('returns a valid 7-character hex color string for every category', () => {
    fc.assert(
      fc.property(categoryArb, (category) => {
        const color = getCategoryColor(category);
        expect(color).toMatch(/^#[0-9a-fA-F]{6}$/);
      }),
      { numRuns: 100 }
    );
  });

  it('returns distinct colors for every pair of categories', () => {
    fc.assert(
      fc.property(
        categoryArb,
        categoryArb,
        (categoryA, categoryB) => {
          fc.pre(categoryA !== categoryB);
          const colorA = getCategoryColor(categoryA);
          const colorB = getCategoryColor(categoryB);
          expect(colorA).not.toBe(colorB);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('is a pure function (same input always yields same output)', () => {
    fc.assert(
      fc.property(categoryArb, (category) => {
        const color1 = getCategoryColor(category);
        const color2 = getCategoryColor(category);
        expect(color1).toBe(color2);
      }),
      { numRuns: 100 }
    );
  });
});

// ─── getCategoryIcon: supplementary property tests ───────────────────────────

describe('Property 4 (supplementary): getCategoryIcon returns valid icon names', () => {
  /**
   * **Validates: Requirements 2.2, 9.3**
   *
   * For any valid tool category, getCategoryIcon SHALL return a non-empty string
   * representing a valid icon name.
   */

  it('returns a non-empty string for every category', () => {
    fc.assert(
      fc.property(categoryArb, (category) => {
        const icon = getCategoryIcon(category);
        expect(icon).toBeTruthy();
        expect(typeof icon).toBe('string');
        expect(icon.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });

  it('is a pure function (same input always yields same output)', () => {
    fc.assert(
      fc.property(categoryArb, (category) => {
        const icon1 = getCategoryIcon(category);
        const icon2 = getCategoryIcon(category);
        expect(icon1).toBe(icon2);
      }),
      { numRuns: 100 }
    );
  });
});
