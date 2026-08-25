/**
 * Property-Based Tests: Attachment Validator (Property 12)
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.0.3
 *
 * Feature: agent-page-redesign, Property 12: Attachment validation constraints
 *
 * Validates: Requirements 7.5
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  validateAttachments,
  MAX_FILE_COUNT,
  MAX_TOTAL_SIZE
} from '../../../src/utils/agent/attachmentValidator';

// ─── Arbitraries (Generators) ────────────────────────────────────────────────

/** Generator for a single file attachment with a size up to 60 MB */
const fileArb = fc.record({ size: fc.nat({ max: 60_000_000 }) });

/** Generator for an array of file attachments (up to 15 files) */
const filesArb = fc.array(fileArb, { maxLength: 15 });

/**
 * Generator for a valid set of attachments:
 * - count <= 10
 * - total size <= 52,428,800 bytes
 */
const validFilesArb = fc
  .array(fc.record({ size: fc.nat({ max: 5_242_880 }) }), { minLength: 0, maxLength: 10 })
  .filter((files) => files.reduce((sum, f) => sum + f.size, 0) <= MAX_TOTAL_SIZE);

/** Generator for attachments exceeding the file count limit (11-15 files) */
const tooManyFilesArb = fc.array(fileArb, { minLength: 11, maxLength: 15 });

/**
 * Generator for attachments exceeding the total size limit
 * while keeping count <= 10
 */
const tooLargeFilesArb = fc
  .array(
    fc.record({ size: fc.integer({ min: 6_000_000, max: 60_000_000 }) }),
    { minLength: 1, maxLength: 10 }
  )
  .filter((files) => files.reduce((sum, f) => sum + f.size, 0) > MAX_TOTAL_SIZE);

// ─── Property 12: Attachment validation constraints ──────────────────────────

describe('Property 12: Attachment validation constraints', () => {
  /**
   * **Validates: Requirements 7.5**
   *
   * For any set of file attachments, the composer SHALL accept the set if and only if
   * attachment count <= 10 AND total size <= 50 MB (52,428,800 bytes).
   * Exceeding either limit SHALL prevent submission and display an error.
   */

  it('accepts attachments when count <= 10 AND total size <= 52,428,800 bytes', () => {
    fc.assert(
      fc.property(validFilesArb, (files) => {
        const result = validateAttachments(files);
        expect(result.valid).toBe(true);
        expect(result.error).toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  it('rejects attachments when count > 10', () => {
    fc.assert(
      fc.property(tooManyFilesArb, (files) => {
        const result = validateAttachments(files);
        expect(result.valid).toBe(false);
        expect(result.error).not.toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  it('rejects attachments when total size > 52,428,800 bytes (count <= 10)', () => {
    fc.assert(
      fc.property(tooLargeFilesArb, (files) => {
        const result = validateAttachments(files);
        expect(result.valid).toBe(false);
        expect(result.error).not.toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  it('always accepts an empty attachment array', () => {
    const result = validateAttachments([]);
    expect(result.valid).toBe(true);
    expect(result.error).toBeNull();
  });

  it('error is null when valid is true, non-null when valid is false', () => {
    fc.assert(
      fc.property(filesArb, (files) => {
        const result = validateAttachments(files);
        if (result.valid) {
          expect(result.error).toBeNull();
        } else {
          expect(result.error).not.toBeNull();
          expect(typeof result.error).toBe('string');
          expect(result.error!.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('validation is a pure function (same input produces same result)', () => {
    fc.assert(
      fc.property(filesArb, (files) => {
        const result1 = validateAttachments(files);
        const result2 = validateAttachments(files);
        expect(result1.valid).toBe(result2.valid);
        expect(result1.error).toBe(result2.error);
      }),
      { numRuns: 100 }
    );
  });

  it('biconditional: valid === (count <= 10 AND totalSize <= 52,428,800)', () => {
    fc.assert(
      fc.property(filesArb, (files) => {
        const totalSize = files.reduce((sum, f) => sum + f.size, 0);
        const shouldBeValid = files.length <= MAX_FILE_COUNT && totalSize <= MAX_TOTAL_SIZE;
        const result = validateAttachments(files);
        expect(result.valid).toBe(shouldBeValid);
      }),
      { numRuns: 100 }
    );
  });
});
