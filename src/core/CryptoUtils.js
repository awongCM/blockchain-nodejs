import {
  createHash,
  generateKeyPairSync,
  createSign,
  createVerify,
  createPublicKey,
} from 'node:crypto';

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

/**
 * @returns {{ privateKey: import('node:crypto').KeyObject, address: string }}
 */
export function generateKeyPair() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'secp256k1',
  });
  const address = publicKey
    .export({ type: 'spki', format: 'der' })
    .toString('hex');
  return { privateKey, address };
}

/**
 * @param {import('node:crypto').KeyObject} privateKey
 * @param {string} hash hex or utf8 message string to sign (treated as utf8 bytes of the string)
 * @returns {string} signature hex
 */
export function signHash(privateKey, hash) {
  const signer = createSign('SHA256');
  signer.update(hash);
  signer.end();
  return signer.sign(privateKey, 'hex');
}

/**
 * @param {string} address SPKI DER hex
 * @param {string} hash
 * @param {string} signatureHex
 * @returns {boolean}
 */
export function verifySignature(address, hash, signatureHex) {
  try {
    const publicKey = createPublicKey({
      key: Buffer.from(address, 'hex'),
      type: 'spki',
      format: 'der',
    });
    const verifier = createVerify('SHA256');
    verifier.update(hash);
    verifier.end();
    return verifier.verify(publicKey, signatureHex, 'hex');
  } catch {
    return false;
  }
}
