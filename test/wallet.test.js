import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateKeyPair,
  signHash,
  verifySignature,
  sha256,
} from '../src/core/CryptoUtils.js';

describe('CryptoUtils ECDSA', () => {
  it('generateKeyPair returns address as hex SPKI public key', () => {
    const { address, privateKey } = generateKeyPair();
    assert.match(address, /^[0-9a-f]+$/);
    assert.ok(address.length > 80);
    assert.ok(privateKey);
  });

  it('signHash and verifySignature round-trip', () => {
    const { address, privateKey } = generateKeyPair();
    const hash = sha256('luckcoin-payload');
    const signature = signHash(privateKey, hash);
    assert.equal(verifySignature(address, hash, signature), true);
  });

  it('verifySignature rejects a bad signature', () => {
    const a = generateKeyPair();
    const b = generateKeyPair();
    const hash = sha256('payload');
    const signature = signHash(a.privateKey, hash);
    assert.equal(verifySignature(b.address, hash, signature), false);
  });
});
