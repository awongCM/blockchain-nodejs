import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { Block } from '../src/core/Block.js';
import { Blockchain } from '../src/core/Blockchain.js';
import { Transaction } from '../src/wallet/Transaction.js';
import { Wallet } from '../src/wallet/Wallet.js';
import {
  LuckCoinNode,
  isAllowedPeerUrl,
} from '../src/network/Node.js';
import { createNodeServer } from '../src/network/HttpServer.js';

describe('Phase 3 chain sync primitives', () => {
  it('two fresh chains share the same genesis hash', () => {
    const a = new Blockchain({ difficulty: 2 });
    const b = new Blockchain({ difficulty: 2 });
    assert.equal(a.chain[0].hash, b.chain[0].hash);
    assert.equal(a.chain[0].timestamp, 0);
  });

  it('replaceChain accepts a longer valid chain and rejects shorter', () => {
    const a = new Blockchain({ difficulty: 2 });
    const b = new Blockchain({ difficulty: 2 });
    const miner = Wallet.create();
    a.minePendingTransactions(miner.address);
    assert.equal(
      b.replaceChain(a.chain.map((block) => block.toJSON())),
      true,
    );
    assert.equal(b.chain.length, a.chain.length);
    assert.equal(b.replaceChain([b.chain[0].toJSON()]), false);
  });

  it('replaceChain rejects a chain with a different genesis', () => {
    const local = new Blockchain({ difficulty: 2 });
    const altGenesis = new Block({
      index: 0,
      timestamp: 999,
      transactions: [],
      previousHash: '0',
    });
    assert.notEqual(altGenesis.hash, local.chain[0].hash);

    const altChain = new Blockchain({ difficulty: 2 });
    altChain.chain[0] = altGenesis;
    const miner = Wallet.create();
    altChain.minePendingTransactions(miner.address);

    assert.equal(
      local.replaceChain(altChain.chain.map((block) => block.toJSON())),
      false,
    );
    assert.equal(local.chain.length, 1);
  });

  it('replaceChain rejects a longer invalid chain', () => {
    const a = new Blockchain({ difficulty: 2 });
    const b = new Blockchain({ difficulty: 2 });
    const miner = Wallet.create();
    a.minePendingTransactions(miner.address);
    const tampered = a.chain.map((block) => block.toJSON());
    tampered[1].hash = '0'.repeat(64);
    assert.equal(b.replaceChain(tampered), false);
    assert.equal(b.chain.length, 1);
  });

  it('rejects replaying a transaction already in the chain', () => {
    const chain = new Blockchain({ difficulty: 2 });
    const alice = Wallet.create();
    const bob = Wallet.create();
    chain.minePendingTransactions(alice.address);
    const tx = new Transaction({
      fromAddress: alice.address,
      toAddress: bob.address,
      amount: 25,
    });
    tx.sign(alice);
    chain.addTransaction(tx);
    chain.minePendingTransactions(alice.address);
    assert.throws(
      () => chain.addTransaction(Transaction.fromJSON(tx.toJSON())),
      /Transaction already mined/,
    );
    assert.equal(chain.getBalance(bob.address), 25);
  });

  it('Transaction.fromJSON preserves validity', () => {
    const from = Wallet.create();
    const to = Wallet.create();
    const chain = new Blockchain({ difficulty: 2 });
    chain.minePendingTransactions(from.address);
    const tx = new Transaction({
      fromAddress: from.address,
      toAddress: to.address,
      amount: 10,
    });
    tx.sign(from);
    const copy = Transaction.fromJSON(tx.toJSON());
    assert.equal(copy.isValid(), true);
    assert.equal(copy.calculateHash(), tx.calculateHash());
  });
});

describe('LuckCoinNode', () => {
  it('receiveBlock appends a valid extension', () => {
    const a = new Blockchain({ difficulty: 2 });
    const b = new Blockchain({ difficulty: 2 });
    const miner = Wallet.create();
    const block = a.minePendingTransactions(miner.address);
    const nodeB = new LuckCoinNode({
      blockchain: b,
      url: 'http://127.0.0.1:3002',
    });
    assert.equal(nodeB.receiveBlock(block.toJSON()), true);
    assert.equal(b.chain.length, 2);
    assert.equal(b.getBalance(miner.address), 100);
  });

  it('registerPeer ignores self and dedupes', () => {
    const node = new LuckCoinNode({
      blockchain: new Blockchain({ difficulty: 2 }),
      url: 'http://127.0.0.1:3001',
    });
    node.registerPeer('http://127.0.0.1:3001/');
    node.registerPeer('http://127.0.0.1:3002');
    node.registerPeer('http://127.0.0.1:3002/');
    assert.deepEqual([...node.peers], ['http://127.0.0.1:3002']);
  });

  it('registerPeer rejects disallowed URLs', () => {
    const node = new LuckCoinNode({
      blockchain: new Blockchain({ difficulty: 2 }),
      url: 'http://127.0.0.1:3001',
    });
    assert.equal(isAllowedPeerUrl('http://169.254.169.254/latest/meta-data'), false);
    assert.equal(node.registerPeer('http://169.254.169.254'), false);
    assert.equal(node.registerPeer('ftp://127.0.0.1:3002'), false);
    assert.equal(node.peers.size, 0);
  });
});

describe('HTTP multi-node', () => {
  /** @type {Awaited<ReturnType<typeof createNodeServer>>[]} */
  let servers = [];

  after(async () => {
    await Promise.all(servers.map((s) => s.close()));
    servers = [];
  });

  async function startNode() {
    const blockchain = new Blockchain({ difficulty: 2 });
    const started = await createNodeServer({
      blockchain,
      port: 0,
      host: '127.0.0.1',
    });
    servers.push(started);
    return started;
  }

  it('GET /chain returns genesis', async () => {
    const a = await startNode();
    const response = await fetch(`http://127.0.0.1:${a.port}/chain`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.length, 1);
    assert.equal(body.chain[0].timestamp, 0);
  });

  it('mine on A then resolve on B syncs the chain', async () => {
    const a = await startNode();
    const b = await startNode();
    const miner = Wallet.create();

    a.node.registerPeer(b.node.url);
    b.node.registerPeer(a.node.url);

    const mineRes = await fetch(`http://127.0.0.1:${a.port}/mine`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ minerAddress: miner.address }),
    });
    assert.equal(mineRes.status, 200);

    // Broadcast may have already appended; resolve as the sync path.
    const resolveRes = await fetch(
      `http://127.0.0.1:${b.port}/nodes/resolve`,
    );
    assert.equal(resolveRes.status, 200);
    const resolved = await resolveRes.json();
    assert.equal(b.node.blockchain.chain.length, 2);
    assert.ok(resolved.length === 2);
    assert.equal(b.node.blockchain.getBalance(miner.address), 100);
  });

  it('broadcasts a funded transaction to a peer mempool', async () => {
    const a = await startNode();
    const b = await startNode();
    const alice = Wallet.create();
    const bob = Wallet.create();

    a.node.registerPeer(b.node.url);
    b.node.registerPeer(a.node.url);

    await fetch(`http://127.0.0.1:${a.port}/mine`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ minerAddress: alice.address }),
    });
    await fetch(`http://127.0.0.1:${b.port}/nodes/resolve`);

    const tx = new Transaction({
      fromAddress: alice.address,
      toAddress: bob.address,
      amount: 25,
    });
    tx.sign(alice);

    const txRes = await fetch(`http://127.0.0.1:${a.port}/transactions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(tx.toJSON()),
    });
    assert.equal(txRes.status, 201);

    const deadline = Date.now() + 2000;
    let pendingB = { transactions: [] };
    while (Date.now() < deadline) {
      pendingB = await fetch(
        `http://127.0.0.1:${b.port}/transactions`,
      ).then((r) => r.json());
      if (pendingB.transactions.length === 1) {
        break;
      }
      await new Promise((r) => setTimeout(r, 25));
    }

    assert.equal(pendingB.transactions.length, 1);
    assert.equal(pendingB.transactions[0].amount, 25);
  });

  it('rejects an invalid transaction with 400', async () => {
    const a = await startNode();
    const response = await fetch(`http://127.0.0.1:${a.port}/transactions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fromAddress: 'deadbeef',
        toAddress: 'cafebabe',
        amount: 1,
        timestamp: Date.now(),
        signature: '00',
      }),
    });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.ok(body.error);
  });

  it('rejects an invalid block extension with 409', async () => {
    const a = await startNode();
    const response = await fetch(`http://127.0.0.1:${a.port}/blocks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        index: 99,
        timestamp: Date.now(),
        transactions: [],
        previousHash: 'not-the-tip',
        nonce: 0,
        hash: '0'.repeat(64),
      }),
    });
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.error, 'Block rejected');
  });

  it('rejects disallowed peer registration over HTTP', async () => {
    const a = await startNode();
    const response = await fetch(`http://127.0.0.1:${a.port}/nodes/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ node: 'http://169.254.169.254' }),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.nodes, []);
    assert.deepEqual(body.rejected, ['http://169.254.169.254']);
  });

  it('GET /contracts/unknown returns 404', async () => {
    const a = await startNode();
    const response = await fetch(
      `http://127.0.0.1:${a.port}/contracts/${'ab'.repeat(32)}`,
    );
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.error, 'Contract not found');
  });

  it('syncs contract state across nodes after deploy', async () => {
    const a = await startNode();
    const b = await startNode();
    const alice = Wallet.create();
    const code = {
      inc: [
        ['load', 'n'],
        ['push', 1],
        ['add'],
        ['store', 'n'],
      ],
    };

    a.node.registerPeer(b.node.url);
    b.node.registerPeer(a.node.url);

    await fetch(`http://127.0.0.1:${a.port}/mine`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ minerAddress: alice.address }),
    });
    await fetch(`http://127.0.0.1:${b.port}/nodes/resolve`);

    const timestamp = 1_700_000_000_100;
    const toAddress = Transaction.deployAddress(alice.address, timestamp, code);
    const deploy = new Transaction({
      fromAddress: alice.address,
      toAddress,
      amount: 0,
      timestamp,
      type: 'deploy',
      data: { code },
    });
    deploy.sign(alice);

    const deployRes = await fetch(`http://127.0.0.1:${a.port}/transactions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(deploy.toJSON()),
    });
    assert.equal(deployRes.status, 201);

    await fetch(`http://127.0.0.1:${a.port}/mine`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ minerAddress: alice.address }),
    });
    await fetch(`http://127.0.0.1:${b.port}/nodes/resolve`);

    const listRes = await fetch(`http://127.0.0.1:${b.port}/contracts`);
    assert.equal(listRes.status, 200);
    const list = await listRes.json();
    assert.deepEqual(list.contracts, [toAddress]);

    const contractRes = await fetch(
      `http://127.0.0.1:${b.port}/contracts/${toAddress}`,
    );
    assert.equal(contractRes.status, 200);
    const contract = await contractRes.json();
    assert.deepEqual(contract.code, code);
    assert.deepEqual(contract.storage, {});
    assert.equal(contract.balance, 0);
  });
});
