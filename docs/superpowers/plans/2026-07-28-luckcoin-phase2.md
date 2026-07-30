# LuckCoin Phase 2 — Transactions & Wallets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add in-memory wallets, signed transactions, a mempool, and coinbase+mempool mining so LuckCoin is an account-based ledger.

**Architecture:** Extend `CryptoUtils` with ECDSA secp256k1 helpers; add `Wallet` and `Transaction`; change `Block` to hash a `transactions` array; evolve `Blockchain` with mempool, `getBalance`, and `minePendingTransactions`; update the CLI to Phase 2 commands. Pure Node stdlib; balances via chain replay.

**Tech Stack:** Node.js ≥18, ES modules, `node:crypto`, `node:test` / `node:assert/strict`

**Spec:** `docs/superpowers/specs/2026-07-28-luckcoin-phase2-design.md`

---

## File map

| File | Responsibility |
|---|---|
| `src/core/CryptoUtils.js` | SHA-256, PoW check, ECDSA keygen / sign / verify |
| `src/wallet/Wallet.js` | In-memory keypair; `address`; `sign(hash)` |
| `src/wallet/Transaction.js` | Transfer or coinbase tx; hash, sign, `isValid` |
| `src/core/Block.js` | Block with `transactions[]`; hash joins tx hashes |
| `src/core/Blockchain.js` | Chain, mempool, balances, mine pending + coinbase |
| `src/index.js` | Phase 2 CLI |
| `test/blockchain.test.js` | Update Phase 1-style block/chain tests for transactions |
| `test/wallet.test.js` | Wallet + Transaction + crypto ECDSA tests |
| `test/ledger.test.js` | Mempool, mining reward, send/mine balances, validation |
| `README.md` | Phase 2 docs + roadmap status |
| `docs/superpowers/specs/2026-07-28-luckcoin-phase2-design.md` | (read-only reference) |

**Address format:** SPKI DER public key as lowercase hex (no `0x`). Reconstructable with `createPublicKey({ key: Buffer.from(address, 'hex'), type: 'spki', format: 'der' })` so verify works from address alone. (Practical Node encoding of “public key as hex” from the spec.)

**Constants:** `miningReward = 100`; test `difficulty = 2`.

---

### Task 1: ECDSA helpers in CryptoUtils

**Files:**
- Modify: `src/core/CryptoUtils.js`
- Test: `test/wallet.test.js`

- [x] **Step 1: Write the failing test**

Create `test/wallet.test.js`:

```js
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
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test test/wallet.test.js`

Expected: FAIL — `generateKeyPair` / `signHash` / `verifySignature` not exported

- [x] **Step 3: Write minimal implementation**

Append to `src/core/CryptoUtils.js` (keep existing `sha256` / `meetsDifficulty`):

```js
import {
  createHash,
  generateKeyPairSync,
  createSign,
  createVerify,
  createPublicKey,
} from 'node:crypto';

// ... existing sha256, meetsDifficulty ...

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
```

Update the top import in `CryptoUtils.js` to include the new `node:crypto` symbols (replace the existing single `createHash` import).

- [x] **Step 4: Run test to verify it passes**

Run: `node --test test/wallet.test.js`

Expected: PASS (3 tests)

- [x] **Step 5: Commit**

```bash
git add src/core/CryptoUtils.js test/wallet.test.js
git commit -m "feat: add ECDSA secp256k1 helpers to CryptoUtils"
```

---

### Task 2: Wallet class

**Files:**
- Create: `src/wallet/Wallet.js`
- Modify: `test/wallet.test.js`

- [x] **Step 1: Write the failing test**

Append to `test/wallet.test.js`:

```js
import { Wallet } from '../src/wallet/Wallet.js';

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
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test test/wallet.test.js`

Expected: FAIL — cannot find module `Wallet.js`

- [x] **Step 3: Write minimal implementation**

Create `src/wallet/Wallet.js`:

```js
import { generateKeyPair, signHash } from '../core/CryptoUtils.js';

export class Wallet {
  constructor(privateKey, address) {
    Object.defineProperty(this, 'privateKey', {
      value: privateKey,
      enumerable: false,
      writable: false,
    });
    this.address = address;
  }

  static create() {
    const { privateKey, address } = generateKeyPair();
    return new Wallet(privateKey, address);
  }

  /**
   * @param {string} hash
   * @returns {string}
   */
  sign(hash) {
    return signHash(this.privateKey, hash);
  }
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `node --test test/wallet.test.js`

Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/wallet/Wallet.js test/wallet.test.js
git commit -m "feat: add in-memory Wallet with ECDSA signing"
```

---

### Task 3: Transaction class

**Files:**
- Create: `src/wallet/Transaction.js`
- Modify: `test/wallet.test.js`

- [x] **Step 1: Write the failing test**

Append to `test/wallet.test.js`:

```js
import { Transaction } from '../src/wallet/Transaction.js';

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
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test test/wallet.test.js`

Expected: FAIL — cannot find module `Transaction.js`

- [x] **Step 3: Write minimal implementation**

Create `src/wallet/Transaction.js`:

```js
import { sha256, verifySignature } from '../core/CryptoUtils.js';

export class Transaction {
  /**
   * @param {object} params
   * @param {string|null} params.fromAddress
   * @param {string} params.toAddress
   * @param {number} params.amount
   * @param {number} [params.timestamp]
   * @param {string|null} [params.signature]
   */
  constructor({
    fromAddress,
    toAddress,
    amount,
    timestamp = Date.now(),
    signature = null,
  }) {
    this.fromAddress = fromAddress;
    this.toAddress = toAddress;
    this.amount = amount;
    this.timestamp = timestamp;
    this.signature = signature;
  }

  calculateHash() {
    const from = this.fromAddress ?? '';
    return sha256(`${from}|${this.toAddress}|${this.amount}|${this.timestamp}`);
  }

  /**
   * @param {import('./Wallet.js').Wallet} wallet
   */
  sign(wallet) {
    if (this.fromAddress === null) {
      throw new Error('Cannot sign coinbase transaction');
    }
    if (wallet.address !== this.fromAddress) {
      throw new Error('Cannot sign transaction for another wallet');
    }
    this.signature = wallet.sign(this.calculateHash());
  }

  isValid() {
    if (typeof this.amount !== 'number' || !(this.amount > 0)) {
      return false;
    }
    if (!this.toAddress) {
      return false;
    }
    if (this.fromAddress === null) {
      return true;
    }
    if (!this.signature) {
      return false;
    }
    return verifySignature(
      this.fromAddress,
      this.calculateHash(),
      this.signature,
    );
  }

  toJSON() {
    return {
      fromAddress: this.fromAddress,
      toAddress: this.toAddress,
      amount: this.amount,
      timestamp: this.timestamp,
      signature: this.signature,
    };
  }
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `node --test test/wallet.test.js`

Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/wallet/Transaction.js test/wallet.test.js
git commit -m "feat: add Transaction with sign and isValid"
```

---

### Task 4: Block uses transactions array

**Files:**
- Modify: `src/core/Block.js`
- Modify: `test/blockchain.test.js`

- [x] **Step 1: Update blockchain tests for transactions (failing against old Block)**

Replace the `Block` and adjust `Blockchain` sections in `test/blockchain.test.js` so blocks use `transactions` instead of `data`. For this task, only change Block tests (Blockchain tests will fail until Task 5 — either update them in Task 5, or temporarily skip Blockchain describe). Prefer: rewrite Block tests now; leave Blockchain tests updated in the same edit to use transactions but expect failures until Task 5.

Update `describe('Block')` to:

```js
import { Transaction } from '../src/wallet/Transaction.js';
import { Wallet } from '../src/wallet/Wallet.js';

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
```

Also change existing Blockchain tests that call `addBlock('...')` — for now rewrite them to skip or comment that Task 5 will replace; simplest path: replace entire `describe('Blockchain')` body with a single placeholder `it.todo('phase2 ledger')` temporarily, then flesh out in Task 5. Prefer keeping CryptoUtils tests unchanged.

- [x] **Step 2: Run Block tests to verify failure**

Run: `node --test test/blockchain.test.js`

Expected: FAIL — `transactions` / old `data` mismatch

- [x] **Step 3: Write minimal Block implementation**

Replace `src/core/Block.js` with:

```js
import { sha256 } from './CryptoUtils.js';

export class Block {
  /**
   * @param {object} params
   * @param {number} params.index
   * @param {number} params.timestamp
   * @param {import('../wallet/Transaction.js').Transaction[]} [params.transactions]
   * @param {string} params.previousHash
   * @param {number} [params.nonce=0]
   * @param {string} [params.hash='']
   */
  constructor({
    index,
    timestamp,
    transactions = [],
    previousHash,
    nonce = 0,
    hash = '',
  }) {
    this.index = index;
    this.timestamp = timestamp;
    this.transactions = transactions;
    this.previousHash = previousHash;
    this.nonce = nonce;
    this.hash = hash || this.calculateHash();
  }

  getPayload() {
    const txHashes = this.transactions
      .map((tx) => tx.calculateHash())
      .join('');
    return `${this.index}${this.timestamp}${txHashes}${this.previousHash}${this.nonce}`;
  }

  calculateHash() {
    return sha256(this.getPayload());
  }

  mine(difficulty) {
    const target = '0'.repeat(difficulty);
    while (!this.hash.startsWith(target)) {
      this.nonce += 1;
      this.hash = this.calculateHash();
    }
    return this;
  }

  toJSON() {
    return {
      index: this.index,
      timestamp: this.timestamp,
      transactions: this.transactions.map((tx) =>
        typeof tx.toJSON === 'function' ? tx.toJSON() : tx,
      ),
      previousHash: this.previousHash,
      nonce: this.nonce,
      hash: this.hash,
    };
  }
}
```

- [x] **Step 4: Run tests**

Run: `node --test test/blockchain.test.js test/wallet.test.js`

Expected: Block + wallet tests PASS; Blockchain section may be todo/failing until Task 5

- [x] **Step 5: Commit**

```bash
git add src/core/Block.js test/blockchain.test.js
git commit -m "feat: hash Block from transactions array"
```

---

### Task 5: Blockchain mempool, balances, and mining

**Files:**
- Modify: `src/core/Blockchain.js`
- Create: `test/ledger.test.js`
- Modify: `test/blockchain.test.js` (restore Blockchain tests for genesis / validity)

- [x] **Step 1: Write failing ledger tests**

Create `test/ledger.test.js`:

```js
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

    assert.equal(chain.getBalance(alice.address), 160); // 100 + 100 - 40
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
```

Restore `describe('Blockchain')` in `test/blockchain.test.js` to genesis + `isValidChain` happy path using `minePendingTransactions` (no `addBlock`).

- [x] **Step 2: Run tests to verify they fail**

Run: `node --test test/ledger.test.js`

Expected: FAIL — missing `minePendingTransactions` / `getBalance` / `addTransaction`

- [x] **Step 3: Write minimal Blockchain implementation**

Replace `src/core/Blockchain.js` with:

```js
import { Block } from './Block.js';
import { Transaction } from '../wallet/Transaction.js';

export class Blockchain {
  /**
   * @param {object} [options]
   * @param {number} [options.difficulty=4]
   * @param {number} [options.miningReward=100]
   */
  constructor({ difficulty = 4, miningReward = 100 } = {}) {
    this.difficulty = difficulty;
    this.miningReward = miningReward;
    this.pendingTransactions = [];
    this.chain = [this.createGenesisBlock()];
  }

  createGenesisBlock() {
    return new Block({
      index: 0,
      timestamp: Date.now(),
      transactions: [],
      previousHash: '0',
    });
  }

  getLatestBlock() {
    return this.chain[this.chain.length - 1];
  }

  getBalance(address) {
    let balance = 0;
    for (const block of this.chain) {
      for (const tx of block.transactions) {
        if (tx.fromAddress === address) {
          balance -= tx.amount;
        }
        if (tx.toAddress === address) {
          balance += tx.amount;
        }
      }
    }
    return balance;
  }

  getPendingSpend(address) {
    return this.pendingTransactions
      .filter((tx) => tx.fromAddress === address)
      .reduce((sum, tx) => sum + tx.amount, 0);
  }

  /**
   * @param {Transaction} transaction
   */
  addTransaction(transaction) {
    if (transaction.fromAddress === null) {
      throw new Error('Cannot add coinbase transaction to mempool');
    }
    if (!transaction.isValid()) {
      throw new Error('Invalid transaction');
    }
    const available =
      this.getBalance(transaction.fromAddress) -
      this.getPendingSpend(transaction.fromAddress);
    if (transaction.amount > available) {
      throw new Error('Insufficient funds');
    }
    this.pendingTransactions.push(transaction);
  }

  /**
   * @param {string} minerAddress
   * @returns {Block}
   */
  minePendingTransactions(minerAddress) {
    if (!minerAddress) {
      throw new Error('Miner address required');
    }

    const rewardTx = new Transaction({
      fromAddress: null,
      toAddress: minerAddress,
      amount: this.miningReward,
    });

    const transactions = [rewardTx, ...this.pendingTransactions];
    const previousBlock = this.getLatestBlock();
    const block = new Block({
      index: previousBlock.index + 1,
      timestamp: Date.now(),
      transactions,
      previousHash: previousBlock.hash,
    });
    block.mine(this.difficulty);
    this.chain.push(block);
    this.pendingTransactions = [];
    return block;
  }

  isValidChain() {
    if (this.chain.length === 0) {
      return false;
    }

    const target = '0'.repeat(this.difficulty);
    const balances = new Map();

    const applyTx = (tx, checkSpend) => {
      if (!tx.isValid()) {
        return false;
      }
      if (tx.fromAddress !== null) {
        const fromBal = balances.get(tx.fromAddress) ?? 0;
        if (checkSpend && tx.amount > fromBal) {
          return false;
        }
        balances.set(tx.fromAddress, fromBal - tx.amount);
      }
      const toBal = balances.get(tx.toAddress) ?? 0;
      balances.set(tx.toAddress, toBal + tx.amount);
      return true;
    };

    for (let i = 0; i < this.chain.length; i += 1) {
      const current = this.chain[i];

      if (i === 0) {
        for (const tx of current.transactions) {
          if (!applyTx(tx, true)) {
            return false;
          }
        }
        continue;
      }

      const previous = this.chain[i - 1];

      if (current.hash !== current.calculateHash()) {
        return false;
      }
      if (current.previousHash !== previous.hash) {
        return false;
      }
      if (!current.hash.startsWith(target)) {
        return false;
      }

      for (const tx of current.transactions) {
        if (!applyTx(tx, true)) {
          return false;
        }
      }
    }

    return true;
  }

  toJSON() {
    return this.chain.map((block) => block.toJSON());
  }
}
```

- [x] **Step 4: Run all tests**

Run: `node --test`

Expected: ALL PASS

Fix balance assertion if off: after first mine Alice=100; send 40 pending; second mine Alice gets +100 reward and −40 = 160; Bob = 40.

- [x] **Step 5: Commit**

```bash
git add src/core/Blockchain.js test/ledger.test.js test/blockchain.test.js
git commit -m "feat: add mempool, balances, and coinbase mining"
```

---

### Task 6: Phase 2 CLI

**Files:**
- Modify: `src/index.js`

- [x] **Step 1: Write a smoke check script expectation (manual / light test)**

No separate CLI unit test required; after implementing, run a non-interactive smoke via stdin:

```bash
printf 'wallet create alice\nwallet create bob\nmine alice\nsend alice bob 25\nmine alice\nbalance alice\nbalance bob\nvalidate\nexit\n' | npm start
```

Expected: alice balance 175 (100+100-25), bob 25, chain valid.

- [x] **Step 2: Confirm current CLI is still Phase 1 (old commands)**

Run: `printf 'help\nexit\n' | npm start`

Expected: still shows `mine <data>` (pre-change baseline)

- [x] **Step 3: Implement Phase 2 CLI**

Replace `src/index.js` with Phase 2 commands:

```js
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { Blockchain } from './core/Blockchain.js';
import { Wallet } from './wallet/Wallet.js';
import { Transaction } from './wallet/Transaction.js';

const BANNER = `
  🐱 LuckCoin — Phase 2
  ─────────────────────
  Wallets, signed transactions, and mining rewards.
`;

const HELP = `
Commands:
  wallet create [name]     Create an in-memory wallet
  wallets                  List session wallets
  send <from> <to> <amt>   Sign and enqueue a transfer
  pending                  Show mempool
  mine <miner>             Mine coinbase + pending txs
  balance <name|address>   Show chain balance
  chain                    Show the full blockchain
  validate                 Check chain integrity
  help                     Show this help message
  exit                     Quit
`;

/** @type {Map<string, Wallet>} */
const walletsByName = new Map();
/** @type {Map<string, Wallet>} */
const walletsByAddress = new Map();

function registerWallet(name, wallet) {
  walletsByName.set(name, wallet);
  walletsByAddress.set(wallet.address, wallet);
}

function resolveWallet(nameOrAddress) {
  return (
    walletsByName.get(nameOrAddress) ||
    walletsByAddress.get(nameOrAddress) ||
    null
  );
}

function resolveAddress(nameOrAddress) {
  const wallet = resolveWallet(nameOrAddress);
  if (wallet) {
    return wallet.address;
  }
  if (/^[0-9a-f]+$/i.test(nameOrAddress) && nameOrAddress.length > 80) {
    return nameOrAddress.toLowerCase();
  }
  return null;
}

function shortAddr(address) {
  return `${address.slice(0, 10)}…${address.slice(-8)}`;
}

function printChain(blockchain) {
  for (const block of blockchain.chain) {
    console.log('');
    console.log(`Block #${block.index}`);
    console.log(`  Timestamp:     ${new Date(block.timestamp).toISOString()}`);
    console.log(`  Previous hash: ${block.previousHash}`);
    console.log(`  Nonce:         ${block.nonce}`);
    console.log(`  Hash:          ${block.hash}`);
    console.log(`  Transactions:  ${block.transactions.length}`);
    for (const tx of block.transactions) {
      const from = tx.fromAddress ? shortAddr(tx.fromAddress) : 'coinbase';
      console.log(
        `    - ${from} → ${shortAddr(tx.toAddress)} : ${tx.amount}`,
      );
    }
  }
  console.log('');
}

async function runCli() {
  const blockchain = new Blockchain();
  const rl = createInterface({ input, output });

  console.log(BANNER);
  console.log('Genesis block created. Type "help" for commands.\n');

  let running = true;
  let walletCounter = 1;

  while (running) {
    const line = (await rl.question('luckcoin> ')).trim();
    if (!line) {
      continue;
    }

    const [command, ...rest] = line.split(/\s+/);

    try {
      switch (command.toLowerCase()) {
        case 'wallet': {
          if (rest[0]?.toLowerCase() !== 'create') {
            console.log('Usage: wallet create [name]');
            break;
          }
          const name = rest[1] || `wallet${walletCounter++}`;
          if (walletsByName.has(name)) {
            console.log(`Wallet name already exists: ${name}`);
            break;
          }
          const wallet = Wallet.create();
          registerWallet(name, wallet);
          console.log(`Created wallet "${name}"`);
          console.log(`Address: ${wallet.address}`);
          break;
        }

        case 'wallets': {
          if (walletsByName.size === 0) {
            console.log('No wallets in this session.');
            break;
          }
          for (const [name, wallet] of walletsByName) {
            console.log(`${name}: ${wallet.address}`);
          }
          break;
        }

        case 'send': {
          const [fromRef, toRef, amountRaw] = rest;
          if (!fromRef || !toRef || amountRaw === undefined) {
            console.log('Usage: send <from> <to> <amount>');
            break;
          }
          const fromWallet = resolveWallet(fromRef);
          const toAddress = resolveAddress(toRef);
          const amount = Number(amountRaw);
          if (!fromWallet) {
            console.log(`Unknown from wallet: ${fromRef}`);
            break;
          }
          if (!toAddress) {
            console.log(`Unknown to wallet/address: ${toRef}`);
            break;
          }
          if (!Number.isFinite(amount) || amount <= 0) {
            console.log('Amount must be a positive number');
            break;
          }
          const tx = new Transaction({
            fromAddress: fromWallet.address,
            toAddress,
            amount,
          });
          tx.sign(fromWallet);
          blockchain.addTransaction(tx);
          console.log(`Queued transfer of ${amount} to ${shortAddr(toAddress)}`);
          break;
        }

        case 'pending': {
          if (blockchain.pendingTransactions.length === 0) {
            console.log('Mempool is empty.');
            break;
          }
          for (const tx of blockchain.pendingTransactions) {
            console.log(
              `${shortAddr(tx.fromAddress)} → ${shortAddr(tx.toAddress)} : ${tx.amount}`,
            );
          }
          break;
        }

        case 'mine': {
          const minerRef = rest.join(' ');
          if (!minerRef) {
            console.log('Usage: mine <miner name|address>');
            break;
          }
          const minerAddress = resolveAddress(minerRef);
          if (!minerAddress) {
            console.log(`Unknown miner: ${minerRef}`);
            break;
          }
          const start = Date.now();
          const block = blockchain.minePendingTransactions(minerAddress);
          console.log(
            `Mined block #${block.index} in ${Date.now() - start}ms (${block.transactions.length} txs)`,
          );
          console.log(`Hash: ${block.hash}`);
          break;
        }

        case 'balance': {
          const ref = rest[0];
          if (!ref) {
            console.log('Usage: balance <name|address>');
            break;
          }
          const address = resolveAddress(ref);
          if (!address) {
            console.log(`Unknown wallet/address: ${ref}`);
            break;
          }
          console.log(`Balance: ${blockchain.getBalance(address)}`);
          break;
        }

        case 'chain':
          printChain(blockchain);
          break;

        case 'validate':
          console.log(
            blockchain.isValidChain()
              ? '✓ Chain is valid'
              : '✗ Chain is invalid',
          );
          break;

        case 'help':
          console.log(HELP);
          break;

        case 'exit':
        case 'quit':
          running = false;
          break;

        default:
          console.log(`Unknown command: ${command}. Type "help" for commands.`);
      }
    } catch (error) {
      console.log(`Error: ${error.message}`);
    }
  }

  rl.close();
}

runCli().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [x] **Step 4: Run smoke + full tests**

Run:

```bash
node --test
printf 'wallet create alice\nwallet create bob\nmine alice\nsend alice bob 25\nmine alice\nbalance alice\nbalance bob\nvalidate\nexit\n' | npm start
```

Expected: tests PASS; balances 175 / 25; valid chain

- [x] **Step 5: Commit**

```bash
git add src/index.js
git commit -m "feat: Phase 2 CLI for wallets, send, and mining"
```

---

### Task 7: README + roadmap update

**Files:**
- Modify: `README.md`
- Modify: `.cursor/skills/repo-snapshot-guide/SKILL.md` (Phase notes only, if present)

- [x] **Step 1: Update README to Phase 2**

Replace Phase 1–centric sections with Phase 2: structure includes `src/wallet/`, CLI table matches new commands, roadmap marks Phase 2 current / Phase 1 done. Keep quick start `npm start` / `npm test`.

- [x] **Step 2: Update skill note**

In `.cursor/skills/repo-snapshot-guide/SKILL.md`, change LuckCoin-specific notes so Phase 2 on `cursor/luckcoin-phase2-3ad5` / master-after-merge includes wallets; Phase 1 was CLI+core only.

- [x] **Step 3: Run final verification**

```bash
node --test
printf 'help\nexit\n' | npm start
```

Expected: all tests pass; help shows Phase 2 commands

- [x] **Step 4: Commit**

```bash
git add README.md .cursor/skills/repo-snapshot-guide/SKILL.md
git commit -m "docs: update README and skill notes for Phase 2"
```

- [x] **Step 5: Push branch**

```bash
git push -u origin cursor/luckcoin-phase2-3ad5
```

---

## Self-review checklist (plan author)

| Spec requirement | Task |
|---|---|
| ECDSA CryptoUtils | Task 1 |
| Wallet in-memory | Task 2 |
| Transaction sign/isValid/coinbase | Task 3 |
| Block transactions hashing | Task 4 |
| Mempool, getBalance, mine+coinbase, isValidChain spends | Task 5 |
| Phase 2 CLI | Task 6 |
| README / success criteria docs | Task 7 |
| No persistence / no Docker branch work | Honored (out of scope) |

No TBD placeholders. Method names consistent: `minePendingTransactions`, `addTransaction`, `getBalance`, `Wallet.create()`, `Transaction.sign` / `isValid`.
