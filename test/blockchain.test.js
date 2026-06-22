import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Block } from '../src/core/Block.js';
import { Blockchain } from '../src/core/Blockchain.js';
import { meetsDifficulty, sha256 } from '../src/core/CryptoUtils.js';

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
  it('calculates a deterministic hash from its payload', () => {
    const block = new Block({
      index: 1,
      timestamp: 1_700_000_000_000,
      data: 'test',
      previousHash: 'abc',
      nonce: 0,
    });

    assert.equal(block.hash, block.calculateHash());
  });

  it('mines until the hash meets difficulty', () => {
    const block = new Block({
      index: 1,
      timestamp: Date.now(),
      data: 'mine me',
      previousHash: 'genesis',
    });

    block.mine(2);
    assert.ok(block.hash.startsWith('00'));
    assert.ok(block.nonce > 0);
  });
});

describe('Blockchain', () => {
  it('starts with a genesis block', () => {
    const chain = new Blockchain({ difficulty: 2 });
    assert.equal(chain.chain.length, 1);
    assert.equal(chain.chain[0].index, 0);
    assert.equal(chain.chain[0].previousHash, '0');
  });

  it('links new blocks to the previous block hash', () => {
    const chain = new Blockchain({ difficulty: 2 });
    const block = chain.addBlock('lucky transaction');

    assert.equal(block.index, 1);
    assert.equal(block.previousHash, chain.chain[0].hash);
  });

  it('validates a freshly built chain', () => {
    const chain = new Blockchain({ difficulty: 2 });
    chain.addBlock('block one');
    chain.addBlock('block two');
    assert.equal(chain.isValidChain(), true);
  });

  it('rejects a tampered block hash', () => {
    const chain = new Blockchain({ difficulty: 2 });
    chain.addBlock('block one');
    chain.chain[1].hash = 'tampered';
    assert.equal(chain.isValidChain(), false);
  });

  it('rejects a broken previousHash link', () => {
    const chain = new Blockchain({ difficulty: 2 });
    chain.addBlock('block one');
    chain.chain[1].previousHash = 'broken';
    assert.equal(chain.isValidChain(), false);
  });
});
