import { createHash } from 'node:crypto';

/**
 * Compute a SHA-256 hex digest for the given input.
 * @param {string} input
 * @returns {string}
 */
export function sha256(input) {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Check whether a hash meets the Proof of Work difficulty target.
 * @param {string} hash
 * @param {number} difficulty Number of leading zero hex characters required
 * @returns {boolean}
 */
export function meetsDifficulty(hash, difficulty) {
  return hash.startsWith('0'.repeat(difficulty));
}
