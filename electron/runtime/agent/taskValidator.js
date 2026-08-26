/**
 * Task Submission Validator
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.0.3
 *
 * Validates task submissions before they are accepted by the Agent Runtime.
 * Checks instruction content, attachment constraints, and working directory accessibility.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Maximum allowed instruction length in characters. */
export const MAX_INSTRUCTION_LENGTH = 50_000;

/** Maximum number of file attachments per task submission. */
export const MAX_ATTACHMENT_COUNT = 10;

/** Maximum total attachment size in bytes (50 MB). */
export const MAX_ATTACHMENT_TOTAL_BYTES = 52_428_800;

/**
 * @typedef {Object} Attachment
 * @property {string} id
 * @property {string} filename
 * @property {string} [mimeType]
 * @property {number} size - Size in bytes
 * @property {string} [content]
 */

/**
 * @typedef {Object} TaskSubmission
 * @property {string} instruction - Natural language task description
 * @property {Attachment[]} [attachments] - Optional file attachments
 * @property {string} [workingDirectory] - Optional working directory path
 * @property {string} [modelId] - Selected model identifier
 * @property {string} [endpoint] - Ollama endpoint
 */

/**
 * @typedef {Object} ValidationError
 * @property {string} field - The field that failed validation
 * @property {string} message - Human-readable error description
 */

/**
 * @typedef {Object} ValidationResult
 * @property {boolean} valid - Whether the submission passed all checks
 * @property {ValidationError[]} errors - List of validation failures (empty if valid)
 */

/**
 * Validates the task instruction field.
 * Must be 1–50,000 characters and not composed entirely of whitespace.
 *
 * @param {string} instruction
 * @returns {ValidationError[]}
 */
function validateInstruction(instruction) {
  const errors = [];

  if (instruction === undefined || instruction === null) {
    errors.push({
      field: 'instruction',
      message: 'Task instruction is required.'
    });
    return errors;
  }

  if (typeof instruction !== 'string') {
    errors.push({
      field: 'instruction',
      message: 'Task instruction must be a string.'
    });
    return errors;
  }

  if (instruction.length === 0) {
    errors.push({
      field: 'instruction',
      message: 'Task instruction cannot be empty.'
    });
    return errors;
  }

  if (instruction.trim().length === 0) {
    errors.push({
      field: 'instruction',
      message: 'Task instruction cannot be whitespace only.'
    });
    return errors;
  }

  if (instruction.length > MAX_INSTRUCTION_LENGTH) {
    errors.push({
      field: 'instruction',
      message: `Task instruction exceeds maximum length of ${MAX_INSTRUCTION_LENGTH} characters (got ${instruction.length}).`
    });
  }

  return errors;
}

/**
 * Validates the attachments array.
 * Max 10 attachments, total size max 50 MB (52,428,800 bytes).
 *
 * @param {Attachment[]} [attachments]
 * @returns {ValidationError[]}
 */
function validateAttachments(attachments) {
  const errors = [];

  if (attachments === undefined || attachments === null) {
    return errors;
  }

  if (!Array.isArray(attachments)) {
    errors.push({
      field: 'attachments',
      message: 'Attachments must be an array.'
    });
    return errors;
  }

  if (attachments.length > MAX_ATTACHMENT_COUNT) {
    errors.push({
      field: 'attachments',
      message: `Too many attachments: maximum is ${MAX_ATTACHMENT_COUNT}, got ${attachments.length}.`
    });
  }

  let totalBytes = 0;
  for (const attachment of attachments) {
    const size = typeof attachment?.size === 'number' ? attachment.size : 0;
    totalBytes += size;
  }

  if (totalBytes > MAX_ATTACHMENT_TOTAL_BYTES) {
    errors.push({
      field: 'attachments',
      message: `Total attachment size exceeds 50 MB limit (got ${totalBytes} bytes).`
    });
  }

  return errors;
}

/**
 * Validates that the working directory exists and is accessible.
 *
 * @param {string} [workingDirectory]
 * @returns {ValidationError[]}
 */
function validateWorkingDirectory(workingDirectory) {
  const errors = [];

  if (workingDirectory === undefined || workingDirectory === null) {
    return errors;
  }

  if (typeof workingDirectory !== 'string' || workingDirectory.trim().length === 0) {
    errors.push({
      field: 'workingDirectory',
      message: 'Working directory must be a non-empty string.'
    });
    return errors;
  }

  const resolved = path.resolve(workingDirectory);

  try {
    fs.accessSync(resolved, fs.constants.R_OK);
  } catch {
    errors.push({
      field: 'workingDirectory',
      message: `Working directory is not accessible: ${resolved}`
    });
    return errors;
  }

  try {
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      errors.push({
        field: 'workingDirectory',
        message: `Path is not a directory: ${resolved}`
      });
    }
  } catch {
    errors.push({
      field: 'workingDirectory',
      message: `Unable to stat working directory: ${resolved}`
    });
  }

  return errors;
}

/**
 * Validates a complete task submission.
 *
 * @param {TaskSubmission} submission
 * @returns {ValidationResult}
 */
export function validateTaskSubmission(submission) {
  if (!submission || typeof submission !== 'object') {
    return {
      valid: false,
      errors: [{ field: 'submission', message: 'Task submission must be an object.' }]
    };
  }

  const errors = [
    ...validateInstruction(submission.instruction),
    ...validateAttachments(submission.attachments),
    ...validateWorkingDirectory(submission.workingDirectory)
  ];

  return {
    valid: errors.length === 0,
    errors
  };
}
