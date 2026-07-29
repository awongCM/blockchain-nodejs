# LuckCoin Phase 3 — Multi-Node Network Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an HTTP multi-node layer so LuckCoin nodes can register peers, share transactions/blocks, and resolve conflicts with longest-valid-chain consensus.

**Architecture:** Keep the Phase 2 ledger; make genesis deterministic; add JSON hydration helpers; introduce `network/Node.js` (peers, broadcast, resolve) and `network/HttpServer.js` (`node:http` REST); extend the CLI with listen/peers/sync.

**Tech Stack:** Node.js ≥18, ES modules, `node:http`, `node:crypto`, `node:test` / `node:assert/strict` — no new npm packages.

**Spec:** `docs/superpowers/specs/2026-07-29-luckcoin-phase3-design.md`

## Global Constraints

- Stdlib only (no Express)
- Bind HTTP to `0.0.0.0` and honor `process.env.PORT`
- Difficulty in tests: `2`; mining reward: `100`
- Deterministic genesis: `timestamp: 0`, empty txs, `previousHash: '0'`

---

## File map

| File | Responsibility |
|---|---|
| `src/core/Blockchain.js` | Deterministic genesis; `replaceChain`; optional hydrate |
| `src/core/Block.js` | `Block.fromJSON` |
| `src/wallet/Transaction.js` | `Transaction.fromJSON` |
| `src/network/Node.js` | Peers, broadcast, resolveConflicts, receiveBlock |
| `src/network/HttpServer.js` | REST API |
| `src/index.js` | Phase 3 CLI |
| `test/network.test.js` | Node + HTTP multi-node tests |
| `test/blockchain.test.js` / `ledger.test.js` | Genesis timestamp expectations |
| `README.md` | Phase 3 docs + multi-node quick start |

---

### Task 1: Deterministic genesis + JSON hydration + replaceChain

**Files:**
- Modify: `src/wallet/Transaction.js`, `src/core/Block.js`, `src/core/Blockchain.js`
- Test: `test/network.test.js` (start), update existing tests if genesis assertions break

- [ ] **Step 1: Write failing tests**

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Blockchain } from '../src/core/Blockchain.js';
import { Block } from '../src/core/Block.js';
import { Transaction } from '../src/wallet/Transaction.js';
import { Wallet } from '../src/wallet/Wallet.js';

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
    assert.equal(b.replaceChain(a.chain.map((block) => block.toJSON())), true);
    assert.equal(b.chain.length, a.chain.length);
    assert.equal(b.replaceChain([b.chain[0].toJSON()]), false);
  });

  it('Transaction.fromJSON preserves validity', () => {
    const from = Wallet.create();
    const to = Wallet.create();
    // fund via coinbase on a throwaway chain then transfer — or build signed tx after mining in test helper
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
```

- [ ] **Step 2: Implement**

`Transaction.fromJSON(data)` — construct with fields from JSON.

`Block.fromJSON(data)` — map `transactions` through `Transaction.fromJSON`.

`Blockchain.createGenesisBlock()` — `timestamp: 0`.

`replaceChain(chainData)`:
- Map through `Block.fromJSON` if plain objects
- Reject if `newChain.length <= this.chain.length`
- Build a temporary `Blockchain` with same difficulty/reward, set `chain` to new blocks, require `isValidChain()`
- On success assign `this.chain = newChain` (and clear pending or leave pending — **clear pending** on replace for simplicity)
- Return boolean

- [ ] **Step 3: Fix existing tests** that assumed non-zero genesis timestamp (if any)

- [ ] **Step 4: Run tests; commit**

```bash
node --test
git add src/wallet/Transaction.js src/core/Block.js src/core/Blockchain.js test
git commit -m "feat: deterministic genesis and chain replace helpers"
```

---

### Task 2: Network Node (peers, broadcast, resolve, receiveBlock)

**Files:**
- Create: `src/network/Node.js`
- Test: `test/network.test.js`

**Interfaces:**
- `new LuckCoinNode({ blockchain, url })`
- `registerPeer(peerUrl): void`
- `async resolveConflicts(): Promise<{ replaced: boolean, length: number }>`
- `async broadcastTransaction(tx): Promise<void>`
- `async broadcastBlock(block): Promise<void>`
- `receiveBlock(blockData): boolean`

Use global `fetch` (Node 18+) for peer HTTP.

- [ ] **Step 1: Tests with two in-process blockchains** (resolve can use injectible `fetchChain(url)` for unit tests, or spin real HTTP in Task 3)

For Task 2 unit-level: test `receiveBlock` append logic and `registerPeer` normalization without HTTP:

```js
describe('LuckCoinNode', () => {
  it('receiveBlock appends a valid extension', () => {
    const a = new Blockchain({ difficulty: 2 });
    const b = new Blockchain({ difficulty: 2 });
    const miner = Wallet.create();
    const block = a.minePendingTransactions(miner.address);
    const nodeB = new LuckCoinNode({ blockchain: b, url: 'http://127.0.0.1:3002' });
    assert.equal(nodeB.receiveBlock(block.toJSON()), true);
    assert.equal(b.chain.length, 2);
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
});
```

- [ ] **Step 2: Implement `LuckCoinNode`**

Normalize URLs: strip trailing slash.

`receiveBlock`: hydrate block; if `previousHash === tip.hash` and `index === tip.index + 1`, temporarily push and run validation of new tip (hash/PoW/txs/overspend via full `isValidChain()`); on failure pop; on success remove matching pending txs by hash.

`resolveConflicts`: for each peer `GET ${peer}/chain`, parse, `replaceChain` candidate if longer; track best.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: add LuckCoinNode peer registry and block receive"
```

---

### Task 3: HTTP server

**Files:**
- Create: `src/network/HttpServer.js`
- Test: `test/network.test.js`

- [ ] **Step 1: Integration tests** starting two servers on ephemeral ports

```js
import { startHttpServer } from '../src/network/HttpServer.js';

// helper: listen on port 0, return { server, port, node, baseUrl, close }
```

Cases:
- GET `/chain` length 1
- POST `/mine` then peer `/nodes/resolve` syncs
- POST `/transactions` after funding
- POST bad tx → 400

- [ ] **Step 2: Implement router**

Bind `0.0.0.0`, port from args / `PORT` / `LUCKCOIN_PORT` / 3001.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat: add HTTP API for chain, txs, mine, and peers"
```

---

### Task 4: Phase 3 CLI

**Files:**
- Modify: `src/index.js`

- [ ] **Step 1: Banner Phase 3; add listen / peers / sync / url**
- [ ] **Step 2: Wire `LuckCoinNode` + optional auto-listen via env**
- [ ] **Step 3: Smoke manually or scripted; commit**

```bash
git commit -m "feat: Phase 3 CLI with listen, peers, and sync"
```

---

### Task 5: README + skill notes

**Files:**
- Modify: `README.md`, `.cursor/skills/repo-snapshot-guide/SKILL.md`

- [ ] Mark Phase 2 done, Phase 3 current
- [ ] Multi-node quick start (two terminals)
- [ ] Commit, push, open PR

---

## Self-review checklist

| Concern | Task |
|---|---|
| Deterministic genesis | Task 1 |
| replaceChain / fromJSON | Task 1 |
| receiveBlock / peers | Task 2 |
| HTTP REST + PORT bind | Task 3 |
| CLI | Task 4 |
| Docs | Task 5 |
