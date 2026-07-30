import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Transaction } from '../src/wallet/Transaction.js';
import { Wallet } from '../src/wallet/Wallet.js';

describe('Phase 4 Transaction', () => {
  it('defaults to transfer with null data', () => {
    const alice = Wallet.create();
    const bob = Wallet.create();
    const tx = new Transaction({
      fromAddress: alice.address,
      toAddress: bob.address,
      amount: 5,
      timestamp: 1_700_000_000_000,
    });
    assert.equal(tx.type, 'transfer');
    assert.equal(tx.data, null);
    tx.sign(alice);
    assert.equal(tx.isValid(), true);
  });

  it('derives a stable 64-char contract address for deploy', () => {
    const code = { inc: [['load', 'n'], ['push', 1], ['add'], ['store', 'n']] };
    const addr = Transaction.deployAddress('aa', 1_700_000_000_000, code);
    assert.match(addr, /^[0-9a-f]{64}$/);
    assert.equal(Transaction.deployAddress('aa', 1_700_000_000_000, code), addr);
  });

  it('validates a signed deploy transaction', () => {
    const alice = Wallet.create();
    const code = { inc: [['load', 'n'], ['push', 1], ['add'], ['store', 'n']] };
    const timestamp = 1_700_000_000_000;
    const toAddress = Transaction.deployAddress(alice.address, timestamp, code);
    const tx = new Transaction({
      fromAddress: alice.address,
      toAddress,
      amount: 0,
      timestamp,
      type: 'deploy',
      data: { code },
    });
    tx.sign(alice);
    assert.equal(tx.isValid(), true);
  });

  it('rejects deploy when toAddress does not match derivation', () => {
    const alice = Wallet.create();
    const code = { inc: [['push', 1], ['store', 'n']] };
    const tx = new Transaction({
      fromAddress: alice.address,
      toAddress: 'ff'.repeat(32),
      amount: 0,
      timestamp: 1_700_000_000_000,
      type: 'deploy',
      data: { code },
    });
    tx.sign(alice);
    assert.equal(tx.isValid(), false);
  });

  it('allows amount 0 for call but requires method', () => {
    const alice = Wallet.create();
    const tx = new Transaction({
      fromAddress: alice.address,
      toAddress: 'ab'.repeat(32),
      amount: 0,
      timestamp: 1_700_000_000_000,
      type: 'call',
      data: { method: 'inc', args: [] },
    });
    tx.sign(alice);
    assert.equal(tx.isValid(), true);
  });
});
