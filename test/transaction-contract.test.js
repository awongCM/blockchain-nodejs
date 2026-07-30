import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Transaction } from '../src/wallet/Transaction.js';
import { Wallet } from '../src/wallet/Wallet.js';
import { Blockchain } from '../src/core/Blockchain.js';
import { validateInstruction } from '../src/contract/opcodes.js';

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

  it('rejects non-finite and non-integer call args', () => {
    const alice = Wallet.create();
    const addr = 'ab'.repeat(32);
    for (const args of [[NaN], [Infinity], [1.5], [null]]) {
      const tx = new Transaction({
        fromAddress: alice.address,
        toAddress: addr,
        amount: 0,
        timestamp: 1_700_000_000_000,
        type: 'call',
        data: { method: 'inc', args },
      });
      tx.sign(alice);
      assert.equal(tx.isValid(), false, `expected invalid for ${String(args)}`);
    }
  });

  it('call args survive JSON wire round-trip and stay valid', () => {
    const alice = Wallet.create();
    const addr = 'cd'.repeat(32);
    const tx = new Transaction({
      fromAddress: alice.address,
      toAddress: addr,
      amount: 0,
      timestamp: 1_700_000_000_000,
      type: 'call',
      data: { method: 'inc', args: [42, 'memo'] },
    });
    tx.sign(alice);
    const copy = Transaction.fromJSON(JSON.parse(JSON.stringify(tx.toJSON())));
    assert.equal(copy.isValid(), true);
    assert.equal(copy.calculateHash(), tx.calculateHash());
  });

  it('rejects deploy code that stores to __proto__', () => {
    assert.equal(
      validateInstruction(['store', '__proto__']),
      false,
    );
    const alice = Wallet.create();
    const code = { bad: [['push', 1], ['store', '__proto__']] };
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
    assert.equal(tx.isValid(), false);
  });
});

describe('Phase 4 wire sync', () => {
  it('rejects peer replace when a mined call used invalid args locally', () => {
    const CODE = { set: [['store', 'n']] };
    const a = new Blockchain({ difficulty: 2 });
    const b = new Blockchain({ difficulty: 2 });
    const alice = Wallet.create();
    a.minePendingTransactions(alice.address);

    const ts = 1_700_000_000_500;
    const addr = Transaction.deployAddress(alice.address, ts, CODE);
    const deploy = new Transaction({
      fromAddress: alice.address,
      toAddress: addr,
      amount: 0,
      timestamp: ts,
      type: 'deploy',
      data: { code: CODE },
    });
    deploy.sign(alice);
    a.addTransaction(deploy);
    a.minePendingTransactions(alice.address);

    const call = new Transaction({
      fromAddress: alice.address,
      toAddress: addr,
      amount: 0,
      timestamp: 1_700_000_000_600,
      type: 'call',
      data: { method: 'set', args: [NaN] },
    });
    call.sign(alice);
    assert.equal(call.isValid(), false);
    assert.throws(() => a.addTransaction(call), /invalid/i);
    assert.equal(
      b.replaceChain(JSON.parse(JSON.stringify(a.toJSON()))),
      true,
    );
  });
});
