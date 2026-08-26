/**
 * (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
 * v5.0.3
 */
import { createHash } from 'node:crypto';

/**
 * Compute the SHA-512 hash of the given data buffer.
 * @param {Buffer | Uint8Array} data - The raw bytes to hash
 * @returns {string} Hex-encoded SHA-512 hash
 */
export function computeSha512(data) {
  return createHash('sha512').update(data).digest('hex');
}

/**
 * Verify the integrity of data by comparing its SHA-512 hash against an expected value.
 * This is a pure predicate: returns true iff the computed hash matches the expected hash.
 *
 * electron-updater performs this check internally on downloaded updates (via
 * verifyUpdateCodeSignature and blockmap checksums). This function extracts the
 * pure verification logic for testability.
 *
 * @param {Buffer | Uint8Array} data - The raw update artifact bytes
 * @param {string} expectedHash - The expected hex-encoded SHA-512 hash
 * @returns {boolean} Whether the computed hash matches the expected hash
 */
export function verifyIntegrity(data, expectedHash) {
  const computedHash = computeSha512(data);
  return computedHash === expectedHash.toLowerCase();
}
