/**
 * MCP Tools Wiring — Sandbox output truncation property test
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.1.0
 *
 * Property-based test asserting that the Python sandbox output truncation
 * helper (`truncateToByteLimit`) confines captured output to at most
 * SANDBOX_OUTPUT_LIMIT (65536) UTF-8 bytes and flags truncation exactly when
 * the original captured output exceeded that limit. Byte-length semantics are
 * exercised with both ASCII and multibyte UTF-8 inputs so char length vs byte
 * length is properly accounted for.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  truncateToByteLimit,
  SANDBOX_OUTPUT_LIMIT
} from '../../../mcp/lib/pythonSandbox.mjs';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** UTF-8 byte length of a string (never char/code-unit length). */
const byteLength = (s: string): number => Buffer.byteLength(s, 'utf8');

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/**
 * General-purpose strings spanning the full unicode range (ASCII, multibyte
 * BMP characters, and astral/emoji surrogate pairs), sized to straddle the
 * 65536-byte limit on both sides.
 */
const generalStringArb = fc.string({ minLength: 0, maxLength: 90_000 });

/**
 * Multibyte-heavy strings: each unit is a multi-byte UTF-8 character, so char
 * length diverges sharply from byte length. This ensures the property holds
 * when byte length far exceeds character count.
 */
const multibyteStringArb = fc
  .array(fc.constantFrom('é', 'ü', 'ñ', '中', '日', '本', '🚀', '😀', '𝕏'), {
    minLength: 0,
    maxLength: 40_000
  })
  .map((chars) => chars.join(''));

/**
 * Boundary-focused strings whose byte length lands near SANDBOX_OUTPUT_LIMIT
 * (just under, exactly at, and just over) so the iff condition is stressed at
 * the exact threshold. Built from single-byte 'a' plus optional multibyte tail
 * to also cover splitting a multibyte sequence at the byte boundary.
 */
const boundaryStringArb = fc
  .integer({ min: SANDBOX_OUTPUT_LIMIT - 4, max: SANDBOX_OUTPUT_LIMIT + 8 })
  .chain((targetBytes) =>
    fc.boolean().map((withMultibyteTail) => {
      if (!withMultibyteTail) return 'a'.repeat(Math.max(0, targetBytes));
      // '€' is 3 UTF-8 bytes; place a few at the tail so truncation can split it.
      const tail = '€€€'; // 9 bytes
      const head = 'a'.repeat(Math.max(0, targetBytes - 9));
      return head + tail;
    })
  );

const anyOutputArb = fc.oneof(generalStringArb, multibyteStringArb, boundaryStringArb);

// Feature: mcp-tools-wiring, Property 15: Sandbox output truncation to 65536 bytes
describe('Feature: mcp-tools-wiring, Property 15: Sandbox output truncation to 65536 bytes', () => {
  /**
   * **Validates: Requirements 10.6**
   *
   * For any captured sandbox output, the returned output SHALL have a byte
   * length no greater than 65536, and the truncation indicator SHALL be true
   * if and only if the original captured output exceeded 65536 bytes.
   */
  it('returned output is <= 65536 bytes and truncated iff original exceeded the limit (PBT)', () => {
    fc.assert(
      fc.property(anyOutputArb, (text) => {
        const originalBytes = byteLength(text);
        const result = truncateToByteLimit(text);

        // Returned output byte length never exceeds the limit.
        expect(byteLength(result.text)).toBeLessThanOrEqual(SANDBOX_OUTPUT_LIMIT);

        // Truncation indicator true iff the original exceeded the limit.
        expect(result.truncated).toBe(originalBytes > SANDBOX_OUTPUT_LIMIT);

        // When not truncated, the text is returned unchanged.
        if (!result.truncated) {
          expect(result.text).toBe(text);
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 10.6**
   *
   * Byte-length semantics: a multibyte string whose char length is well below
   * the limit but whose byte length exceeds it is still truncated, confirming
   * the limit is measured in bytes rather than characters.
   */
  it('measures the limit in bytes, not characters, for multibyte output', () => {
    // 30,000 '€' characters = 90,000 bytes (>65536) but only 30,000 chars.
    const text = '€'.repeat(30_000);
    expect(text.length).toBeLessThan(SANDBOX_OUTPUT_LIMIT); // char length under limit
    expect(byteLength(text)).toBeGreaterThan(SANDBOX_OUTPUT_LIMIT); // byte length over limit

    const result = truncateToByteLimit(text);

    expect(result.truncated).toBe(true);
    expect(byteLength(result.text)).toBeLessThanOrEqual(SANDBOX_OUTPUT_LIMIT);
  });

  /**
   * **Validates: Requirements 10.6**
   *
   * Output exactly at the limit is not flagged as truncated and is returned
   * verbatim.
   */
  it('output exactly at the limit is not truncated', () => {
    const text = 'a'.repeat(SANDBOX_OUTPUT_LIMIT);
    expect(byteLength(text)).toBe(SANDBOX_OUTPUT_LIMIT);

    const result = truncateToByteLimit(text);

    expect(result.truncated).toBe(false);
    expect(result.text).toBe(text);
  });
});
