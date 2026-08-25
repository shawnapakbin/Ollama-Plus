/**
 * Agent Composer Logic Utilities
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 *
 * Pure functions for the Agent Composer input behavior:
 * message validation and keyboard submission handling.
 */

/**
 * Validates whether a message has meaningful content for submission.
 * Rejects empty strings and strings composed entirely of whitespace.
 *
 * @param content - The message content to validate
 * @returns true if the message contains non-whitespace characters
 */
export function isValidMessage(content: string): boolean {
  return content.trim().length > 0;
}

/**
 * Determines whether a keydown event should trigger message submission.
 * Enter (without Shift) submits; Shift+Enter allows newline insertion.
 *
 * @param e - Object with key and shiftKey properties from the keyboard event
 * @returns true if the event should trigger submission
 */
export function shouldSubmitOnKeyDown(e: { key: string; shiftKey: boolean }): boolean {
  return e.key === 'Enter' && !e.shiftKey;
}
