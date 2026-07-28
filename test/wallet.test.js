import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateKeyPair,
  signHash,
  verifySignature,
  sha256,
} from '../src/core/CryptoUtils.js';
import { Wallet } from '../src/wallet/Wallet.js';
import { Transaction } from '../src/wallet/Transaction.js';

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

describe('Wallet', () => {
  it('create() yields a unique address and can sign a hash', () => {
    const wallet = Wallet.create();
    assert.match(wallet.address, /^[0-9a-f]+$/);
    const hash = sha256('tx-payload');
    const signature = wallet.sign(hash);
    assert.equal(verifySignature(wallet.address, hash, signature), true);
  });

  it('does not expose privateKey on JSON serialization', () => {
    const wallet = Wallet.create();
    const json = JSON.stringify(wallet);
    assert.equal(json.includes('private'), false);
  });
});

describe('Transaction', () => {
  it('signs and validates a transfer', () => {
    const alice = Wallet.create();
    const bob = Wallet.create();
    const tx = new Transaction({
      fromAddress: alice.address,
      toAddress: bob.address,
      amount: 10,
      timestamp: 1_700_000_000_000,
    });
    tx.sign(alice);
    assert.equal(tx.isValid(), true);
  });

  it('rejects signature from the wrong wallet', () => {
    const alice = Wallet.create();
    const bob = Wallet.create();
    const tx = new Transaction({
      fromAddress: alice.address,
      toAddress: bob.address,
      amount: 10,
      timestamp: 1_700_000_000_000,
    });
    assert.throws(() => tx.sign(bob), /cannot sign/i);
  });

  it('coinbase transaction is valid without signature', () => {
    const miner = Wallet.create();
    const tx = new Transaction({
      fromAddress: null,
      toAddress: miner.address,
      amount: 100,
      timestamp: 1_700_000_000_000,
    });
    assert.equal(tx.isValid(), true);
  });

  it('rejects non-positive amount', () => {
    const alice = Wallet.create();
    const bob = Wallet.create();
    const tx = new Transaction({
      fromAddress: alice.address,
      toAddress: bob.address,
      amount: 0,
      timestamp: 1_700_000_000_000,
    });
    tx.sign(alice);
    assert.equal(tx.isValid(), false);
  });

  it('rejects non-integer amount', () => {
    const alice = Wallet.create();
    const bob = Wallet.create();
    const tx = new Transaction({
      fromAddress: alice.address,
      toAddress: bob.address,
      amount: 1.5,
      timestamp: 1_700_000_000_000,
    });
    tx.sign(alice);
    assert.equal(tx.isValid(), false);
  });

  it('rejects forged signature', () => {
    const alice = Wallet.create();
    const bob = Wallet.create();
    const tx = new Transaction({
      fromAddress: alice.address,
      toAddress: bob.address,
      amount: 5,
      timestamp: 1_700_000_000_000,
    });
    tx.sign(alice);
    tx.signature = '00'.repeat(64);
    assert.equal(tx.isValid(), false);
  });
});
