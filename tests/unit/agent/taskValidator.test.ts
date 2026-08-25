import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  validateTaskSubmission,
  MAX_INSTRUCTION_LENGTH,
  MAX_ATTACHMENT_COUNT,
  MAX_ATTACHMENT_TOTAL_BYTES
} from '../../../electron/runtime/agent/taskValidator.js';

// ─── Test Infrastructure ─────────────────────────────────────────────────────

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

function createTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ollama-plus-task-validator-'));
  tempDirs.push(dir);
  return dir;
}

// ─── Unit Tests ──────────────────────────────────────────────────────────────

describe('taskValidator - instruction validation', () => {
  it('accepts a valid instruction', () => {
    const result = validateTaskSubmission({
      instruction: 'Build a REST API for user management'
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects null submission', () => {
    const result = validateTaskSubmission(null as any);
    expect(result.valid).toBe(false);
    expect(result.errors[0].field).toBe('submission');
  });

  it('rejects undefined submission', () => {
    const result = validateTaskSubmission(undefined as any);
    expect(result.valid).toBe(false);
    expect(result.errors[0].field).toBe('submission');
  });

  it('rejects missing instruction', () => {
    const result = validateTaskSubmission({} as any);
    expect(result.valid).toBe(false);
    expect(result.errors[0].field).toBe('instruction');
  });

  it('rejects empty instruction', () => {
    const result = validateTaskSubmission({ instruction: '' });
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain('empty');
  });

  it('rejects whitespace-only instruction', () => {
    const result = validateTaskSubmission({ instruction: '   \t\n  ' });
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain('whitespace');
  });

  it('rejects instruction exceeding 50,000 characters', () => {
    const instruction = 'a'.repeat(50_001);
    const result = validateTaskSubmission({ instruction });
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain('50000');
  });

  it('accepts instruction at exactly 50,000 characters', () => {
    const instruction = 'a'.repeat(50_000);
    const result = validateTaskSubmission({ instruction });
    expect(result.valid).toBe(true);
  });

  it('accepts a single character instruction', () => {
    const result = validateTaskSubmission({ instruction: 'x' });
    expect(result.valid).toBe(true);
  });

  it('rejects non-string instruction', () => {
    const result = validateTaskSubmission({ instruction: 123 } as any);
    expect(result.valid).toBe(false);
    expect(result.errors[0].field).toBe('instruction');
  });
});

describe('taskValidator - attachment validation', () => {
  it('accepts submission with no attachments', () => {
    const result = validateTaskSubmission({ instruction: 'test task' });
    expect(result.valid).toBe(true);
  });

  it('accepts up to 10 attachments within size limit', () => {
    const attachments = Array.from({ length: 10 }, (_, i) => ({
      id: `att-${i}`,
      filename: `file${i}.txt`,
      size: 1_000_000 // 1 MB each = 10 MB total
    }));
    const result = validateTaskSubmission({ instruction: 'test', attachments });
    expect(result.valid).toBe(true);
  });

  it('rejects more than 10 attachments', () => {
    const attachments = Array.from({ length: 11 }, (_, i) => ({
      id: `att-${i}`,
      filename: `file${i}.txt`,
      size: 100
    }));
    const result = validateTaskSubmission({ instruction: 'test', attachments });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'attachments' && e.message.includes('10'))).toBe(true);
  });

  it('rejects attachments exceeding 50 MB total', () => {
    const attachments = [
      { id: 'big', filename: 'large.bin', size: MAX_ATTACHMENT_TOTAL_BYTES + 1 }
    ];
    const result = validateTaskSubmission({ instruction: 'test', attachments });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'attachments' && e.message.includes('50 MB'))).toBe(true);
  });

  it('accepts attachments at exactly 50 MB total', () => {
    const attachments = [
      { id: 'exact', filename: 'exact.bin', size: MAX_ATTACHMENT_TOTAL_BYTES }
    ];
    const result = validateTaskSubmission({ instruction: 'test', attachments });
    expect(result.valid).toBe(true);
  });

  it('rejects non-array attachments', () => {
    const result = validateTaskSubmission({ instruction: 'test', attachments: 'invalid' } as any);
    expect(result.valid).toBe(false);
    expect(result.errors[0].field).toBe('attachments');
  });
});

describe('taskValidator - working directory validation', () => {
  it('accepts valid existing directory', () => {
    const dir = createTempDir();
    const result = validateTaskSubmission({
      instruction: 'test task',
      workingDirectory: dir
    });
    expect(result.valid).toBe(true);
  });

  it('rejects non-existent directory', () => {
    const result = validateTaskSubmission({
      instruction: 'test task',
      workingDirectory: '/this/path/does/not/exist/at/all'
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0].field).toBe('workingDirectory');
  });

  it('rejects a file path as working directory', () => {
    const dir = createTempDir();
    const filePath = path.join(dir, 'notadir.txt');
    fs.writeFileSync(filePath, 'hello');
    const result = validateTaskSubmission({
      instruction: 'test task',
      workingDirectory: filePath
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain('not a directory');
  });

  it('accepts when workingDirectory is omitted', () => {
    const result = validateTaskSubmission({ instruction: 'test task' });
    expect(result.valid).toBe(true);
  });

  it('rejects empty string working directory', () => {
    const result = validateTaskSubmission({
      instruction: 'test task',
      workingDirectory: '   '
    });
    expect(result.valid).toBe(false);
    expect(result.errors[0].field).toBe('workingDirectory');
  });
});

describe('taskValidator - combined validation', () => {
  it('reports multiple errors at once', () => {
    const result = validateTaskSubmission({
      instruction: '',
      attachments: Array.from({ length: 11 }, (_, i) => ({
        id: `att-${i}`,
        filename: `file${i}.txt`,
        size: 100
      })),
      workingDirectory: '/nonexistent/path'
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── Property-Based Tests ────────────────────────────────────────────────────

describe('taskValidator - Property 1: Task input length boundary', () => {
  /**
   * **Validates: Requirements 1.1, 1.2**
   *
   * For any string of length L, the task submission validator SHALL accept it
   * if and only if 1 <= L <= 50,000 and the string is not composed entirely
   * of whitespace characters.
   */
  it('accepts any non-whitespace string with length 1–50,000', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 500 }).filter(s => s.trim().length > 0),
        (instruction) => {
          const result = validateTaskSubmission({ instruction });
          expect(result.valid).toBe(true);
          expect(result.errors).toHaveLength(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('rejects any string that is empty or whitespace-only', () => {
    const whitespaceArb = fc
      .array(fc.constantFrom(' ', '\t', '\n', '\r'), { minLength: 0, maxLength: 100 })
      .map(chars => chars.join(''));

    fc.assert(
      fc.property(whitespaceArb, (instruction) => {
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
        fc.integer({ min: MAX_INSTRUCTION_LENGTH + 1, max: MAX_INSTRUCTION_LENGTH + 1000 }),
        (length) => {
          const instruction = 'a'.repeat(length);
          const result = validateTaskSubmission({ instruction });
          expect(result.valid).toBe(false);
          expect(result.errors[0].field).toBe('instruction');
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('taskValidator - Property 2: Attachment set validation', () => {
  /**
   * **Validates: Requirements 1.4**
   *
   * For any set of file attachments, the submission validator SHALL accept
   * the set if and only if the attachment count is <= 10 AND the total byte
   * size is <= 50 MB (52,428,800 bytes).
   */
  it('accepts any attachment set with count <= 10 and total size <= 50 MB', () => {
    const attachmentArb = fc.record({
      id: fc.string({ minLength: 1, maxLength: 10 }),
      filename: fc.string({ minLength: 1, maxLength: 50 }),
      size: fc.nat({ max: 5_242_880 }) // Up to 5 MB per file
    });

    fc.assert(
      fc.property(
        fc.array(attachmentArb, { minLength: 0, maxLength: MAX_ATTACHMENT_COUNT }),
        (attachments) => {
          const totalSize = attachments.reduce((sum, a) => sum + a.size, 0);
          // Only test cases within the size limit
          fc.pre(totalSize <= MAX_ATTACHMENT_TOTAL_BYTES);

          const result = validateTaskSubmission({
            instruction: 'valid task',
            attachments
          });
          expect(result.valid).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('rejects any attachment set with count > 10', () => {
    const attachmentArb = fc.record({
      id: fc.string({ minLength: 1, maxLength: 10 }),
      filename: fc.string({ minLength: 1, maxLength: 50 }),
      size: fc.nat({ max: 1000 })
    });

    fc.assert(
      fc.property(
        fc.array(attachmentArb, { minLength: MAX_ATTACHMENT_COUNT + 1, maxLength: 15 }),
        (attachments) => {
          const result = validateTaskSubmission({
            instruction: 'valid task',
            attachments
          });
          expect(result.valid).toBe(false);
          expect(result.errors.some(e => e.field === 'attachments')).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('rejects any attachment set with total size > 50 MB', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: MAX_ATTACHMENT_TOTAL_BYTES + 1, max: MAX_ATTACHMENT_TOTAL_BYTES + 10_000_000 }),
        (totalSize) => {
          const attachments = [
            { id: 'big', filename: 'big.bin', size: totalSize }
          ];
          const result = validateTaskSubmission({
            instruction: 'valid task',
            attachments
          });
          expect(result.valid).toBe(false);
          expect(result.errors.some(e => e.field === 'attachments' && e.message.includes('50 MB'))).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });
});
