import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Blockchain } from '../src/core/Blockchain.js';
import { Wallet } from '../src/wallet/Wallet.js';
import { Transaction } from '../src/wallet/Transaction.js';

describe('Ledger', () => {
  it('starts with genesis and zero balances', () => {
    const chain = new Blockchain({ difficulty: 2 });
    const alice = Wallet.create();
    assert.equal(chain.chain.length, 1);
    assert.equal(chain.chain[0].transactions.length, 0);
    assert.equal(chain.getBalance(alice.address), 0);
  });

  it('credits mining reward to the miner', () => {
    const chain = new Blockchain({ difficulty: 2 });
    const miner = Wallet.create();
    chain.minePendingTransactions(miner.address);
    assert.equal(chain.getBalance(miner.address), 100);
  });

  it('accepts a valid transfer after the sender has funds', () => {
    const chain = new Blockchain({ difficulty: 2 });
    const alice = Wallet.create();
    const bob = Wallet.create();
    chain.minePendingTransactions(alice.address);

    const tx = new Transaction({
      fromAddress: alice.address,
      toAddress: bob.address,
      amount: 40,
    });
    tx.sign(alice);
    chain.addTransaction(tx);
    chain.minePendingTransactions(alice.address);

    assert.equal(chain.getBalance(alice.address), 160);
    assert.equal(chain.getBalance(bob.address), 40);
  });

  it('rejects insufficient funds', () => {
    const chain = new Blockchain({ difficulty: 2 });
    const alice = Wallet.create();
    const bob = Wallet.create();
    const tx = new Transaction({
      fromAddress: alice.address,
      toAddress: bob.address,
      amount: 1,
    });
    tx.sign(alice);
    assert.throws(() => chain.addTransaction(tx), /insufficient/i);
  });

  it('rejects invalid signature via addTransaction', () => {
    const chain = new Blockchain({ difficulty: 2 });
    const alice = Wallet.create();
    const bob = Wallet.create();
    chain.minePendingTransactions(alice.address);
    const tx = new Transaction({
      fromAddress: alice.address,
      toAddress: bob.address,
      amount: 1,
    });
    tx.sign(alice);
    tx.signature = 'ab'.repeat(32);
    assert.throws(() => chain.addTransaction(tx), /invalid/i);
  });

  it('rejects coinbase via addTransaction', () => {
    const chain = new Blockchain({ difficulty: 2 });
    const miner = Wallet.create();
    const tx = new Transaction({
      fromAddress: null,
      toAddress: miner.address,
      amount: 100,
    });
    assert.throws(() => chain.addTransaction(tx), /coinbase/i);
  });

  it('detects tampered hash and broken links', () => {
    const chain = new Blockchain({ difficulty: 2 });
    const miner = Wallet.create();
    chain.minePendingTransactions(miner.address);
    assert.equal(chain.isValidChain(), true);
    chain.chain[1].hash = 'tampered';
    assert.equal(chain.isValidChain(), false);

    const chain2 = new Blockchain({ difficulty: 2 });
    chain2.minePendingTransactions(miner.address);
    chain2.chain[1].previousHash = 'broken';
    assert.equal(chain2.isValidChain(), false);
  });
});
