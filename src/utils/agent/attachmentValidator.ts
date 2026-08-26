/**
 * Attachment Validator
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 *
 * Validates file attachments for the Agent Composer.
 * Enforces file count and total size limits before submission.
 *
 * Requirements: 7.5
 */

/** Maximum number of files allowed per message */
export const MAX_FILE_COUNT = 10;

/** Maximum total size of all attachments in bytes (50 MB) */
export const MAX_TOTAL_SIZE = 52_428_800;

export interface AttachmentValidationResult {
  /** Whether the attachment set passes validation */
  valid: boolean;
  /** Error message if validation fails, null otherwise */
  error: string | null;
}

/**
 * Validates a set of file attachments against count and size constraints.
 *
 * - Checks file count first: rejects if more than 10 files
 * - Checks total size second: rejects if sum of all file sizes exceeds 50 MB (52,428,800 bytes)
 * - Returns valid if both constraints are satisfied
 *
 * @param files - Array of objects with a `size` property (in bytes)
 * @returns Validation result with `valid` flag and optional `error` message
 */
export function validateAttachments(
  files: Array<{ size: number }>
): AttachmentValidationResult {
  if (files.length > MAX_FILE_COUNT) {
    return { valid: false, error: 'Maximum 10 files allowed' };
  }

  const totalSize = files.reduce((sum, file) => sum + file.size, 0);

  if (totalSize > MAX_TOTAL_SIZE) {
    return { valid: false, error: 'Total file size exceeds 50 MB limit' };
  }

  return { valid: true, error: null };
}
