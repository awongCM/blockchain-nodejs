import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Block } from '../src/core/Block.js';
import { Blockchain } from '../src/core/Blockchain.js';
import { meetsDifficulty, sha256 } from '../src/core/CryptoUtils.js';
import { Wallet } from '../src/wallet/Wallet.js';
import { Transaction } from '../src/wallet/Transaction.js';

describe('CryptoUtils', () => {
  it('sha256 produces a 64-character hex digest', () => {
    const hash = sha256('luckcoin');
    assert.equal(hash.length, 64);
    assert.match(hash, /^[0-9a-f]+$/);
  });

  it('meetsDifficulty checks leading zeros', () => {
    assert.equal(meetsDifficulty('000abc', 3), true);
    assert.equal(meetsDifficulty('00abc', 3), false);
  });
});

describe('Block', () => {
  it('calculates a deterministic hash from transaction hashes', () => {
    const block = new Block({
      index: 1,
      timestamp: 1_700_000_000_000,
      transactions: [],
      previousHash: 'abc',
      nonce: 0,
    });

    assert.equal(block.hash, block.calculateHash());
  });

  it('mines until the hash meets difficulty', () => {
    const block = new Block({
      index: 1,
      timestamp: Date.now(),
      transactions: [],
      previousHash: 'genesis',
    });

    block.mine(2);
    assert.ok(block.hash.startsWith('00'));
    assert.ok(block.nonce > 0);
  });

  it('includes transaction hashes in the payload', () => {
    const alice = Wallet.create();
    const bob = Wallet.create();
    const tx = new Transaction({
      fromAddress: alice.address,
      toAddress: bob.address,
      amount: 1,
      timestamp: 1_700_000_000_000,
    });
    tx.sign(alice);

    const withTx = new Block({
      index: 1,
      timestamp: 1_700_000_000_000,
      transactions: [tx],
      previousHash: 'abc',
      nonce: 0,
    });
    const empty = new Block({
      index: 1,
      timestamp: 1_700_000_000_000,
      transactions: [],
      previousHash: 'abc',
      nonce: 0,
    });

    assert.notEqual(withTx.hash, empty.hash);
  });
});

describe('Blockchain', () => {
  it('starts with a genesis block', () => {
    const chain = new Blockchain({ difficulty: 2 });
    assert.equal(chain.chain.length, 1);
    assert.equal(chain.chain[0].index, 0);
    assert.equal(chain.chain[0].previousHash, '0');
    assert.equal(chain.chain[0].transactions.length, 0);
  });

  it('validates a freshly built chain after mining', () => {
    const chain = new Blockchain({ difficulty: 2 });
    const miner = Wallet.create();
    chain.minePendingTransactions(miner.address);
    chain.minePendingTransactions(miner.address);
    assert.equal(chain.isValidChain(), true);
  });

  it('rejects a tampered block hash', () => {
    const chain = new Blockchain({ difficulty: 2 });
    const miner = Wallet.create();
    chain.minePendingTransactions(miner.address);
    chain.chain[1].hash = 'tampered';
    assert.equal(chain.isValidChain(), false);
  });

  it('rejects a broken previousHash link', () => {
    const chain = new Blockchain({ difficulty: 2 });
    const miner = Wallet.create();
    chain.minePendingTransactions(miner.address);
    chain.chain[1].previousHash = 'broken';
    assert.equal(chain.isValidChain(), false);
  });
});
