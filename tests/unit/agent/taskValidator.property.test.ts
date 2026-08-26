/**
 * Property-Based Tests: Task Submission Validator (Properties 1, 2)
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.0.3
 *
 * Feature: agent-client
 * - Property 1: Task input length boundary
 * - Property 2: Attachment set validation
 *
 * Validates: Requirements 1.1, 1.2, 1.4
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  validateTaskSubmission,
  MAX_INSTRUCTION_LENGTH,
  MAX_ATTACHMENT_COUNT,
  MAX_ATTACHMENT_TOTAL_BYTES
} from '../../../electron/runtime/agent/taskValidator.js';

// ─── Arbitraries (Generators) ────────────────────────────────────────────────

/**
 * Generates a string that is NOT composed entirely of whitespace.
 * Constrains length to [1, maxLen] to stay within valid range.
 */
function nonWhitespaceStringArb(minLen = 1, maxLen = 500) {
  return fc.string({ minLength: minLen, maxLength: maxLen }).filter(s => s.trim().length > 0);
}

/**
 * Generates a string composed entirely of whitespace characters.
 */
const whitespaceOnlyArb = fc
  .array(fc.constantFrom(' ', '\t', '\n', '\r'), { minLength: 1, maxLength: 200 })
  .map(chars => chars.join(''));

/**
 * Generates a valid attachment object with a given size constraint.
 */
function attachmentArb(maxSize: number) {
  return fc.record({
    id: fc.uuid(),
    filename: fc.string({ minLength: 1, maxLength: 50 }).map(s => s.replace(/[/\\]/g, '_') + '.txt'),
    mimeType: fc.constantFrom('text/plain', 'application/json', 'image/png', 'application/pdf'),
    size: fc.nat({ max: maxSize }),
    content: fc.constant('base64data')
  });
}

// ─── Property 1: Task input length boundary ──────────────────────────────────

describe('Property 1: Task input length boundary', () => {
  /**
   * **Validates: Requirements 1.1, 1.2**
   *
   * For any string of length L, the task submission validator SHALL accept it
   * if and only if 1 <= L <= 50,000 and the string is not composed entirely
   * of whitespace characters.
   */

  it('accepts any non-whitespace string with length in [1, 50000]', () => {
    fc.assert(
      fc.property(
        nonWhitespaceStringArb(1, 500),
        (instruction) => {
          // Instruction is non-whitespace and within length bounds
          const result = validateTaskSubmission({ instruction });
          expect(result.valid).toBe(true);
          expect(result.errors).toHaveLength(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('accepts non-whitespace strings at large valid lengths (near 50000)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 49_900, max: MAX_INSTRUCTION_LENGTH }),
        (length) => {
          // Pad with 'x' to ensure non-whitespace and exact length
          const instruction = 'x'.repeat(length);
          const result = validateTaskSubmission({ instruction });
          expect(result.valid).toBe(true);
          expect(result.errors).toHaveLength(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('rejects empty strings (length 0)', () => {
    const result = validateTaskSubmission({ instruction: '' });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].field).toBe('instruction');
  });

  it('rejects any whitespace-only string regardless of length', () => {
    fc.assert(
      fc.property(whitespaceOnlyArb, (instruction) => {
        const result = validateTaskSubmission({ instruction });
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors[0].field).toBe('instruction');
      }),
      { numRuns: 100 }
    );
  });

  it('rejects any string longer than 50,000 characters', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: MAX_INSTRUCTION_LENGTH + 1, max: MAX_INSTRUCTION_LENGTH + 5000 }),
        (length) => {
          const instruction = 'a'.repeat(length);
          const result = validateTaskSubmission({ instruction });
          expect(result.valid).toBe(false);
          expect(result.errors.some(e => e.field === 'instruction')).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('boundary: accepts exactly at MAX_INSTRUCTION_LENGTH', () => {
    const instruction = 'z'.repeat(MAX_INSTRUCTION_LENGTH);
    const result = validateTaskSubmission({ instruction });
    expect(result.valid).toBe(true);
  });

  it('boundary: rejects at MAX_INSTRUCTION_LENGTH + 1', () => {
    const instruction = 'z'.repeat(MAX_INSTRUCTION_LENGTH + 1);
    const result = validateTaskSubmission({ instruction });
    expect(result.valid).toBe(false);
  });

  it('accepts strings with mixed content and whitespace (not all whitespace)', () => {
    fc.assert(
      fc.property(
        fc.tuple(
          fc.string({ minLength: 1, maxLength: 100 }).filter(s => s.trim().length > 0),
          fc.array(fc.constantFrom(' ', '\t', '\n', '\r'), { minLength: 0, maxLength: 50 })
        ),
        ([nonWs, wsChars]) => {
          // Combine non-whitespace with whitespace padding
          const instruction = wsChars.join('') + nonWs + wsChars.join('');
          if (instruction.length > MAX_INSTRUCTION_LENGTH) return; // skip oversized
          const result = validateTaskSubmission({ instruction });
          expect(result.valid).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// ─── Property 2: Attachment set validation ───────────────────────────────────

describe('Property 2: Attachment set validation', () => {
  /**
   * **Validates: Requirements 1.4**
   *
   * For any set of file attachments, the submission validator SHALL accept the set
   * if and only if the attachment count is <= 10 AND the total byte size is
   * <= 50 MB (52,428,800 bytes).
   */

  it('accepts any attachment set with count <= 10 and total size <= 50 MB', () => {
    // Generate 0-10 attachments where each is at most 5 MB, then filter total
    fc.assert(
      fc.property(
        fc.array(attachmentArb(5_242_880), { minLength: 0, maxLength: MAX_ATTACHMENT_COUNT }),
        (attachments) => {
          const totalSize = attachments.reduce((sum, a) => sum + a.size, 0);
          // Only test cases within the 50 MB limit
          fc.pre(totalSize <= MAX_ATTACHMENT_TOTAL_BYTES);

          const result = validateTaskSubmission({
            instruction: 'valid task instruction',
            attachments
          });
          expect(result.valid).toBe(true);
          expect(result.errors).toHaveLength(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('rejects any attachment set with count > 10 (regardless of size)', () => {
    fc.assert(
      fc.property(
        fc.array(attachmentArb(1000), { minLength: MAX_ATTACHMENT_COUNT + 1, maxLength: 15 }),
        (attachments) => {
          const result = validateTaskSubmission({
            instruction: 'valid task instruction',
            attachments
          });
          expect(result.valid).toBe(false);
          expect(result.errors.some(e => e.field === 'attachments')).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('rejects any attachment set with total size > 50 MB (even if count <= 10)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: MAX_ATTACHMENT_COUNT }),
        fc.integer({ min: MAX_ATTACHMENT_TOTAL_BYTES + 1, max: MAX_ATTACHMENT_TOTAL_BYTES + 20_000_000 }),
        (count, totalSize) => {
          // Distribute total size across count attachments
          const perFile = Math.ceil(totalSize / count);
          const attachments = Array.from({ length: count }, (_, i) => ({
            id: `att-${i}`,
            filename: `file${i}.bin`,
            mimeType: 'application/octet-stream',
            size: i === 0 ? totalSize - perFile * (count - 1) : perFile,
            content: 'base64data'
          }));
          // Ensure total exceeds limit
          const actualTotal = attachments.reduce((sum, a) => sum + a.size, 0);
          fc.pre(actualTotal > MAX_ATTACHMENT_TOTAL_BYTES);

          const result = validateTaskSubmission({
            instruction: 'valid task instruction',
            attachments
          });
          expect(result.valid).toBe(false);
          expect(result.errors.some(e => e.field === 'attachments')).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('boundary: accepts exactly 10 attachments totaling exactly 50 MB', () => {
    const sizePerFile = Math.floor(MAX_ATTACHMENT_TOTAL_BYTES / MAX_ATTACHMENT_COUNT);
    const remainder = MAX_ATTACHMENT_TOTAL_BYTES - sizePerFile * MAX_ATTACHMENT_COUNT;
    const attachments = Array.from({ length: MAX_ATTACHMENT_COUNT }, (_, i) => ({
      id: `att-${i}`,
      filename: `file${i}.bin`,
      mimeType: 'application/octet-stream',
      size: i === 0 ? sizePerFile + remainder : sizePerFile,
      content: 'base64data'
    }));
    const total = attachments.reduce((sum, a) => sum + a.size, 0);
    expect(total).toBe(MAX_ATTACHMENT_TOTAL_BYTES);

    const result = validateTaskSubmission({
      instruction: 'valid task instruction',
      attachments
    });
    expect(result.valid).toBe(true);
  });

  it('boundary: rejects 11 attachments even with tiny sizes', () => {
    const attachments = Array.from({ length: 11 }, (_, i) => ({
      id: `att-${i}`,
      filename: `file${i}.txt`,
      mimeType: 'text/plain',
      size: 1,
      content: 'base64data'
    }));
    const result = validateTaskSubmission({
      instruction: 'valid task instruction',
      attachments
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'attachments')).toBe(true);
  });

  it('accepts empty attachment array', () => {
    const result = validateTaskSubmission({
      instruction: 'valid task instruction',
      attachments: []
    });
    expect(result.valid).toBe(true);
  });

  it('accepts when attachments field is omitted', () => {
    const result = validateTaskSubmission({
      instruction: 'valid task instruction'
    });
    expect(result.valid).toBe(true);
  });

  it('rejects when both count > 10 and size > 50 MB simultaneously', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: MAX_ATTACHMENT_COUNT + 1, max: 15 }),
        (count) => {
          // Each attachment over 5 MB ensures total exceeds 50 MB with > 10 files
          const sizePerFile = Math.ceil((MAX_ATTACHMENT_TOTAL_BYTES + 1_000_000) / count);
          const attachments = Array.from({ length: count }, (_, i) => ({
            id: `att-${i}`,
            filename: `file${i}.bin`,
            mimeType: 'application/octet-stream',
            size: sizePerFile,
            content: 'base64data'
          }));

          const result = validateTaskSubmission({
            instruction: 'valid task instruction',
            attachments
          });
          expect(result.valid).toBe(false);
          expect(result.errors.some(e => e.field === 'attachments')).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});
