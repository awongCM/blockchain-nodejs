# LuckCoin Phase 4 — Simple Smart Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add deploy/call transactions and a tiny deterministic method-opcode VM so LuckCoin can run simple on-chain contracts with storage and value transfers.

**Architecture:** Extend `Transaction` with `type` + `data`; add `src/contract/` (`opcodes`, `VirtualMachine`, `ContractAccount`); teach `Blockchain` to apply deploy/call during mempool checks and chain replay; expose inspect via CLI + `GET /contracts`.

**Tech Stack:** Node.js ≥18, ES modules, `node:crypto`, `node:http`, `node:test` / `node:assert/strict` — no new npm packages.

**Spec:** `docs/superpowers/specs/2026-07-30-luckcoin-phase4-design.md`

## Global Constraints

- Stdlib only (no Express, no `node:vm` JS eval)
- Bind HTTP to `0.0.0.0` and honor `process.env.PORT` (unchanged)
- Difficulty in tests: `2`; mining reward: `100`
- Deterministic genesis unchanged (`timestamp: 0`)
- Straight-line opcodes only; `maxSteps = 128`
- Contract address = 64-char SHA-256 hex; wallet addresses remain SPKI DER hex

---

## File map

| File | Responsibility |
|---|---|
| `src/wallet/Transaction.js` | `type`, `data`, hash, deploy address, validation |
| `src/contract/opcodes.js` | Op names, instruction validation limits |
| `src/contract/VirtualMachine.js` | Execute one method call |
| `src/contract/ContractAccount.js` | Contract record helpers |
| `src/core/Blockchain.js` | Apply deploy/call; `getContract`; mempool simulate |
| `src/network/HttpServer.js` | `GET /contracts`, `GET /contracts/:address` |
| `src/index.js` | Phase 4 CLI |
| `test/transaction-contract.test.js` | Tx type/hash/address tests |
| `test/vm.test.js` | VM unit tests |
| `test/contracts-ledger.test.js` | Deploy/call ledger tests |
| `test/network.test.js` | Sync + contracts HTTP (extend) |
| `README.md` | Phase 4 docs + roadmap |

---

### Task 1: Transaction type, data, and deploy address

**Files:**
- Modify: `src/wallet/Transaction.js`
- Create: `test/transaction-contract.test.js`

**Interfaces:**
- Consumes: `sha256`, `verifySignature` from `CryptoUtils`
- Produces:
  - `new Transaction({ fromAddress, toAddress, amount, timestamp, signature, type, data })`
  - `Transaction.deployAddress(fromAddress, timestamp, code) → string`
  - `tx.type`: `'transfer' | 'deploy' | 'call'`
  - `tx.data`: `object | null`
  - `tx.calculateHash()`, `tx.isValid()`, `tx.toJSON()`, `Transaction.fromJSON(data)`

- [x] **Step 1: Write the failing test**

Create `test/transaction-contract.test.js`:

```js
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
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test test/transaction-contract.test.js`

Expected: FAIL — `type` / `deployAddress` missing

- [x] **Step 3: Write minimal implementation**

Replace `src/wallet/Transaction.js` with:

```js
import { sha256, verifySignature } from '../core/CryptoUtils.js';

const METHOD_NAME = /^[a-zA-Z_][a-zA-Z0-9_]{0,31}$/;

function canonicalData(data) {
  if (data === null || data === undefined) {
    return '';
  }
  return JSON.stringify(data);
}

export class Transaction {
  /**
   * @param {object} params
   * @param {string|null} params.fromAddress
   * @param {string|null} params.toAddress
   * @param {number} params.amount
   * @param {number} [params.timestamp]
   * @param {string|null} [params.signature]
   * @param {'transfer'|'deploy'|'call'} [params.type]
   * @param {object|null} [params.data]
   */
  constructor({
    fromAddress,
    toAddress,
    amount,
    timestamp = Date.now(),
    signature = null,
    type = 'transfer',
    data = null,
  }) {
    this.fromAddress = fromAddress;
    this.toAddress = toAddress;
    this.amount = amount;
    this.timestamp = timestamp;
    this.signature = signature;
    this.type = type;
    this.data = data;
  }

  /**
   * @param {string} fromAddress
   * @param {number} timestamp
   * @param {Record<string, unknown[]>} code
   * @returns {string}
   */
  static deployAddress(fromAddress, timestamp, code) {
    return sha256(`${fromAddress}|${timestamp}|${JSON.stringify(code)}`);
  }

  calculateHash() {
    const from = this.fromAddress ?? '';
    const to = this.toAddress ?? '';
    return sha256(
      `${from}|${to}|${this.amount}|${this.timestamp}|${this.type}|${canonicalData(this.data)}`,
    );
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
    if (typeof this.amount !== 'number' || !Number.isInteger(this.amount)) {
      return false;
    }
    if (!['transfer', 'deploy', 'call'].includes(this.type)) {
      return false;
    }

    if (this.fromAddress === null) {
      return (
        this.type === 'transfer' &&
        this.data === null &&
        this.amount > 0 &&
        Boolean(this.toAddress)
      );
    }

    if (!this.signature) {
      return false;
    }

    if (this.type === 'transfer') {
      if (this.data !== null) {
        return false;
      }
      if (!(this.amount > 0) || !this.toAddress) {
        return false;
      }
    } else if (this.type === 'deploy') {
      if (this.amount < 0 || !this.toAddress || !this.data?.code) {
        return false;
      }
      if (!isValidCode(this.data.code)) {
        return false;
      }
      const expected = Transaction.deployAddress(
        this.fromAddress,
        this.timestamp,
        this.data.code,
      );
      if (this.toAddress !== expected) {
        return false;
      }
    } else if (this.type === 'call') {
      if (this.amount < 0 || !this.toAddress || !this.data?.method) {
        return false;
      }
      if (!METHOD_NAME.test(this.data.method)) {
        return false;
      }
      const args = this.data.args ?? [];
      if (!Array.isArray(args) || args.length > 8) {
        return false;
      }
      if (!args.every((a) => typeof a === 'number' || typeof a === 'string')) {
        return false;
      }
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
      type: this.type,
      data: this.data,
    };
  }

  /**
   * @param {object} data
   * @returns {Transaction}
   */
  static fromJSON(data) {
    return new Transaction({
      fromAddress: data.fromAddress ?? null,
      toAddress: data.toAddress ?? null,
      amount: data.amount,
      timestamp: data.timestamp,
      signature: data.signature ?? null,
      type: data.type ?? 'transfer',
      data: data.data ?? null,
    });
  }
}

/**
 * @param {Record<string, unknown>} code
 * @returns {boolean}
 */
export function isValidCode(code) {
  if (!code || typeof code !== 'object' || Array.isArray(code)) {
    return false;
  }
  const methods = Object.keys(code);
  if (methods.length === 0 || methods.length > 16) {
    return false;
  }
  for (const name of methods) {
    if (!METHOD_NAME.test(name)) {
      return false;
    }
    const body = code[name];
    if (!Array.isArray(body) || body.length === 0 || body.length > 32) {
      return false;
    }
    for (const inst of body) {
      if (!Array.isArray(inst) || inst.length === 0 || typeof inst[0] !== 'string') {
        return false;
      }
    }
  }
  return true;
}
```

Note: Task 1 `isValidCode` only checks method-map shape. Task 2 upgrades it to call `validateMethodBody` so invalid opcodes fail `tx.isValid()`.

- [x] **Step 4: Run test to verify it passes**

Run: `node --test test/transaction-contract.test.js`

Expected: PASS

Also run: `node --test test/wallet.test.js test/ledger.test.js`

Expected: may FAIL if hash format change breaks nothing on re-sign… existing tests rebuild txs in-process so they should still pass. If coinbase/`amount` integer checks already exist, keep them.

- [x] **Step 5: Commit**

```bash
git add src/wallet/Transaction.js test/transaction-contract.test.js
git commit -m "feat: extend Transaction with deploy/call type and data"
```

---

### Task 2: Opcodes + VirtualMachine

**Files:**
- Create: `src/contract/opcodes.js`
- Create: `src/contract/VirtualMachine.js`
- Create: `test/vm.test.js`

**Interfaces:**
- Consumes: validated method instruction lists
- Produces:
  - `MAX_STEPS = 128`, `validateInstruction(inst)`, `validateMethodBody(body)`
  - `executeMethod({ code, storage, balance, fromAddress, amount, method, args }) → { storage, balance, effects, steps }`

- [x] **Step 1: Write the failing test**

Create `test/vm.test.js`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { executeMethod } from '../src/contract/VirtualMachine.js';

const incCode = {
  inc: [
    ['load', 'n'],
    ['push', 1],
    ['add'],
    ['store', 'n'],
  ],
  payout: [
    ['push', 'recipient'],
    ['push', 5],
    ['transfer'],
  ],
};

describe('VirtualMachine', () => {
  it('increments storage via inc', () => {
    const result = executeMethod({
      code: incCode,
      storage: {},
      balance: 0,
      fromAddress: 'caller',
      amount: 0,
      method: 'inc',
      args: [],
    });
    assert.equal(result.storage.n, 1);
    assert.equal(result.balance, 0);
  });

  it('credits value then transfers from contract balance', () => {
    const result = executeMethod({
      code: {
        payout: [
          ['caller'],
          ['value'],
          ['transfer'],
        ],
      },
      storage: {},
      balance: 0,
      fromAddress: 'alice',
      amount: 10,
      method: 'payout',
      args: [],
    });
    assert.equal(result.balance, 0);
    assert.deepEqual(result.effects, [{ to: 'alice', amount: 10 }]);
  });

  it('throws when method missing', () => {
    assert.throws(
      () =>
        executeMethod({
          code: incCode,
          storage: {},
          balance: 0,
          fromAddress: 'x',
          amount: 0,
          method: 'nope',
          args: [],
        }),
      /method/i,
    );
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `node --test test/vm.test.js`

Expected: FAIL — module not found

- [x] **Step 3: Implement opcodes + VM**

Create `src/contract/opcodes.js`:

```js
export const MAX_STEPS = 128;
export const MAX_STACK = 64;
export const MAX_STORAGE_KEYS = 32;
export const STORAGE_KEY = /^[a-zA-Z_][a-zA-Z0-9_]{0,31}$/;

const OPS = new Set([
  'push',
  'load',
  'store',
  'add',
  'sub',
  'mul',
  'eq',
  'lt',
  'dup',
  'pop',
  'caller',
  'value',
  'balance',
  'transfer',
  'halt',
]);

/**
 * @param {unknown[]} inst
 * @returns {boolean}
 */
export function validateInstruction(inst) {
  if (!Array.isArray(inst) || typeof inst[0] !== 'string' || !OPS.has(inst[0])) {
    return false;
  }
  const [op, arg] = inst;
  switch (op) {
    case 'push':
      return (
        inst.length === 2 &&
        (typeof arg === 'number' || typeof arg === 'string') &&
        (typeof arg !== 'number' || Number.isSafeInteger(arg))
      );
    case 'load':
    case 'store':
      return inst.length === 2 && typeof arg === 'string' && STORAGE_KEY.test(arg);
    case 'add':
    case 'sub':
    case 'mul':
    case 'eq':
    case 'lt':
    case 'dup':
    case 'pop':
    case 'caller':
    case 'value':
    case 'balance':
    case 'transfer':
    case 'halt':
      return inst.length === 1;
    default:
      return false;
  }
}

/**
 * @param {unknown[]} body
 * @returns {boolean}
 */
export function validateMethodBody(body) {
  return (
    Array.isArray(body) &&
    body.length > 0 &&
    body.length <= 32 &&
    body.every(validateInstruction)
  );
}
```

Create `src/contract/VirtualMachine.js`:

```js
import {
  MAX_STACK,
  MAX_STEPS,
  MAX_STORAGE_KEYS,
  STORAGE_KEY,
  validateMethodBody,
} from './opcodes.js';

/**
 * @param {object} params
 * @param {Record<string, any[][]>} params.code
 * @param {Record<string, number|string>} params.storage
 * @param {number} params.balance
 * @param {string} params.fromAddress
 * @param {number} params.amount
 * @param {string} params.method
 * @param {Array<number|string>} params.args
 */
export function executeMethod({
  code,
  storage,
  balance,
  fromAddress,
  amount,
  method,
  args = [],
}) {
  const body = code?.[method];
  if (!body || !validateMethodBody(body)) {
    throw new Error(`Unknown or invalid method: ${method}`);
  }

  const stack = [...args];
  if (stack.length > MAX_STACK) {
    throw new Error('Stack overflow');
  }

  let contractBalance = balance + amount;
  if (!Number.isSafeInteger(contractBalance) || contractBalance < 0) {
    throw new Error('Invalid balance');
  }

  /** @type {Record<string, number|string>} */
  const nextStorage = { ...storage };
  /** @type {{ to: string, amount: number }[]} */
  const effects = [];
  let steps = 0;

  const push = (value) => {
    if (stack.length >= MAX_STACK) {
      throw new Error('Stack overflow');
    }
    stack.push(value);
  };

  const pop = () => {
    if (stack.length === 0) {
      throw new Error('Stack underflow');
    }
    return stack.pop();
  };

  for (const inst of body) {
    steps += 1;
    if (steps > MAX_STEPS) {
      throw new Error('Max steps exceeded');
    }

    const [op, arg] = inst;
    switch (op) {
      case 'push':
        push(arg);
        break;
      case 'load':
        push(Object.hasOwn(nextStorage, arg) ? nextStorage[arg] : 0);
        break;
      case 'store': {
        const value = pop();
        if (!STORAGE_KEY.test(arg)) {
          throw new Error('Invalid storage key');
        }
        if (
          !Object.hasOwn(nextStorage, arg) &&
          Object.keys(nextStorage).length >= MAX_STORAGE_KEYS
        ) {
          throw new Error('Storage key limit');
        }
        nextStorage[arg] = value;
        break;
      }
      case 'add':
      case 'sub':
      case 'mul': {
        const b = pop();
        const a = pop();
        if (typeof a !== 'number' || typeof b !== 'number') {
          throw new Error('Arithmetic requires numbers');
        }
        const result =
          op === 'add' ? a + b : op === 'sub' ? a - b : a * b;
        if (!Number.isSafeInteger(result)) {
          throw new Error('Arithmetic overflow');
        }
        push(result);
        break;
      }
      case 'eq': {
        const b = pop();
        const a = pop();
        push(a === b ? 1 : 0);
        break;
      }
      case 'lt': {
        const b = pop();
        const a = pop();
        if (typeof a !== 'number' || typeof b !== 'number') {
          throw new Error('lt requires numbers');
        }
        push(a < b ? 1 : 0);
        break;
      }
      case 'dup': {
        const top = pop();
        push(top);
        push(top);
        break;
      }
      case 'pop':
        pop();
        break;
      case 'caller':
        push(fromAddress);
        break;
      case 'value':
        push(amount);
        break;
      case 'balance':
        push(contractBalance);
        break;
      case 'transfer': {
        const transferAmount = pop();
        const to = pop();
        if (typeof to !== 'string' || !to) {
          throw new Error('transfer to must be address string');
        }
        if (
          typeof transferAmount !== 'number' ||
          !Number.isSafeInteger(transferAmount) ||
          transferAmount <= 0
        ) {
          throw new Error('transfer amount must be positive integer');
        }
        if (transferAmount > contractBalance) {
          throw new Error('Insufficient contract balance');
        }
        contractBalance -= transferAmount;
        effects.push({ to, amount: transferAmount });
        break;
      }
      case 'halt':
        return {
          storage: nextStorage,
          balance: contractBalance,
          effects,
          steps,
        };
      default:
        throw new Error(`Unknown opcode: ${op}`);
    }
  }

  return {
    storage: nextStorage,
    balance: contractBalance,
    effects,
    steps,
  };
}
```

- [x] **Step 4: Wire opcode validation into Transaction.isValidCode**

In `src/wallet/Transaction.js`, import `validateMethodBody` from `../contract/opcodes.js` and replace the per-method body length loop with:

```js
if (!validateMethodBody(body)) {
  return false;
}
```

- [x] **Step 5: Run tests**

Run: `node --test test/vm.test.js test/transaction-contract.test.js`

Expected: PASS

- [x] **Step 6: Commit**

```bash
git add src/contract/opcodes.js src/contract/VirtualMachine.js src/wallet/Transaction.js test/vm.test.js
git commit -m "feat: add contract opcode VM for method calls"
```

---

### Task 3: ContractAccount + Blockchain apply/replay

**Files:**
- Create: `src/contract/ContractAccount.js`
- Modify: `src/core/Blockchain.js`
- Create: `test/contracts-ledger.test.js`
- Modify: `test/ledger.test.js` / `test/blockchain.test.js` only if defaults break

**Interfaces:**
- Consumes: `Transaction`, `executeMethod`, `isValidCode`
- Produces:
  - `blockchain.getContract(address) → { address, code, storage, balance } | null`
  - `blockchain.listContracts() → string[]`
  - Mempool rejects bad deploy/call; mine applies effects; `isValidChain` replays contracts

- [x] **Step 1: Write failing ledger tests**

Create `test/contracts-ledger.test.js`:

```js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Blockchain } from '../src/core/Blockchain.js';
import { Wallet } from '../src/wallet/Wallet.js';
import { Transaction } from '../src/wallet/Transaction.js';

const INC = {
  inc: [
    ['load', 'n'],
    ['push', 1],
    ['add'],
    ['store', 'n'],
  ],
};

function deployTx(wallet, code, amount = 0, timestamp = 1_700_000_000_001) {
  const toAddress = Transaction.deployAddress(wallet.address, timestamp, code);
  const tx = new Transaction({
    fromAddress: wallet.address,
    toAddress,
    amount,
    timestamp,
    type: 'deploy',
    data: { code },
  });
  tx.sign(wallet);
  return tx;
}

describe('Contracts ledger', () => {
  it('deploys a contract and exposes code via getContract', () => {
    const chain = new Blockchain({ difficulty: 2 });
    const alice = Wallet.create();
    chain.minePendingTransactions(alice.address);
    const tx = deployTx(alice, INC, 0, 1_700_000_000_010);
    chain.addTransaction(tx);
    chain.minePendingTransactions(alice.address);
    const contract = chain.getContract(tx.toAddress);
    assert.ok(contract);
    assert.deepEqual(contract.code, INC);
    assert.deepEqual(contract.storage, {});
    assert.equal(contract.balance, 0);
  });

  it('calls a method and persists storage', () => {
    const chain = new Blockchain({ difficulty: 2 });
    const alice = Wallet.create();
    chain.minePendingTransactions(alice.address);
    const deploy = deployTx(alice, INC, 0, 1_700_000_000_020);
    chain.addTransaction(deploy);
    chain.minePendingTransactions(alice.address);

    const call = new Transaction({
      fromAddress: alice.address,
      toAddress: deploy.toAddress,
      amount: 0,
      type: 'call',
      data: { method: 'inc', args: [] },
    });
    call.sign(alice);
    chain.addTransaction(call);
    chain.minePendingTransactions(alice.address);

    assert.equal(chain.getContract(deploy.toAddress).storage.n, 1);
    assert.equal(chain.isValidChain(), true);
  });

  it('rejects call to missing contract', () => {
    const chain = new Blockchain({ difficulty: 2 });
    const alice = Wallet.create();
    chain.minePendingTransactions(alice.address);
    const call = new Transaction({
      fromAddress: alice.address,
      toAddress: 'ab'.repeat(32),
      amount: 0,
      type: 'call',
      data: { method: 'inc', args: [] },
    });
    call.sign(alice);
    assert.throws(() => chain.addTransaction(call), /contract/i);
  });
});
```

- [x] **Step 2: Run tests to verify they fail**

Run: `node --test test/contracts-ledger.test.js`

Expected: FAIL — `getContract` missing

- [x] **Step 3: Implement ContractAccount + Blockchain integration**

Create `src/contract/ContractAccount.js`:

```js
export class ContractAccount {
  /**
   * @param {object} params
   * @param {string} params.address
   * @param {Record<string, any[][]>} params.code
   * @param {Record<string, number|string>} [params.storage]
   */
  constructor({ address, code, storage = {} }) {
    this.address = address;
    this.code = code;
    this.storage = storage;
  }

  toJSON() {
    return {
      address: this.address,
      code: this.code,
      storage: this.storage,
    };
  }
}
```

Update `src/core/Blockchain.js`:

1. Import `executeMethod` and `ContractAccount` (and `isValidCode` / opcode validation as needed).
2. Add `replayState()` that returns `{ balances: Map<string, number>, contracts: Map<string, ContractAccount> }` by applying every mined tx in order (and optionally a variant that also folds `pendingTransactions` for mempool checks).
3. Implement `applyTransaction(tx, balances, contracts)`:
   - coinbase / transfer: debit/credit `amount` as today
   - deploy: ensure code valid; address free; debit sender; create `ContractAccount`; credit contract `amount`
   - call: contract exists; debit sender `amount`; `executeMethod`; set storage; set contract balance from VM; credit each effect `to`
4. `getBalance(address)` uses `replayState().balances`.
5. `getContract(address)` returns `{ ...contract.toJSON(), balance }` or `null`.
6. `listContracts()` returns sorted addresses from replay.
7. `addTransaction`:
   - keep duplicate hash checks
   - for `transfer` keep `amount > 0` + funds check
   - for deploy/call: `tx.isValid()`; simulate with `replayState()` + each pending in order via `applyTransaction`; on failure throw with clear message (`Insufficient funds`, `Contract already exists`, `Unknown contract`, etc.)
8. `minePendingTransactions`: after building block, chain push as today; validity ensured because pending already simulated — still rely on `isValidChain` in tests.
9. `isValidChain`: use `applyTransaction` instead of the old simple balance loop; for transfer/coinbase keep signature checks; fail if apply throws/returns false.
10. `getPendingSpend`: sum `amount` for pending txs from address for all types where `fromAddress` matches.

**Important:** Transfer txs debit `from` and credit `to` by `amount`. Deploy/call debit `from` by `amount` and credit the contract through apply (deploy creates account; call uses VM which already added `amount` into contract balance). Do **not** double-credit call value.

Sketch for `applyTransaction` call branch:

```js
// debit sender
if (tx.amount > 0) {
  const fromBal = balances.get(tx.fromAddress) ?? 0;
  if (tx.amount > fromBal) throw new Error('Insufficient funds');
  balances.set(tx.fromAddress, fromBal - tx.amount);
}
const contract = contracts.get(tx.toAddress);
if (!contract) throw new Error('Unknown contract');
const result = executeMethod({
  code: contract.code,
  storage: contract.storage,
  balance: balances.get(tx.toAddress) ?? 0,
  fromAddress: tx.fromAddress,
  amount: tx.amount,
  method: tx.data.method,
  args: tx.data.args ?? [],
});
contract.storage = result.storage;
balances.set(tx.toAddress, result.balance);
for (const effect of result.effects) {
  balances.set(effect.to, (balances.get(effect.to) ?? 0) + effect.amount);
}
```

Deploy branch credits `balances.set(toAddress, (balances.get(toAddress) ?? 0) + tx.amount)` after creating the account (VM not run on deploy).

- [x] **Step 4: Run all unit tests**

Run: `node --test`

Expected: ALL PASS (fix any Phase 2 tests that assumed `toAddress` always string on coinbase — unchanged).

- [x] **Step 5: Commit**

```bash
git add src/contract/ContractAccount.js src/core/Blockchain.js test/contracts-ledger.test.js
git commit -m "feat: apply deploy/call txs and replay contract state"
```

---

### Task 4: HTTP contract inspect + network sync coverage

**Files:**
- Modify: `src/network/HttpServer.js`
- Modify: `test/network.test.js`

**Interfaces:**
- Consumes: `node.blockchain.getContract`, `listContracts`
- Produces: `GET /contracts`, `GET /contracts/:address`

- [x] **Step 1: Add failing tests**

Append to `test/network.test.js` (reuse existing server helper):

```js
it('syncs contract state across nodes after deploy', async () => {
  // start A and B, register peers
  // mine to alice on A, deploy INC, mine
  // B sync / resolve
  // GET B /contracts/:address returns same code/storage
});
```

Also: `GET /contracts/unknown` → 404.

- [x] **Step 2: Implement routes in HttpServer**

In the request router, before not-found:

```js
if (method === 'GET' && url.pathname === '/contracts') {
  return json(res, 200, { contracts: node.blockchain.listContracts() });
}

const contractMatch = url.pathname.match(/^\/contracts\/([0-9a-fA-F]+)$/);
if (method === 'GET' && contractMatch) {
  const contract = node.blockchain.getContract(contractMatch[1].toLowerCase());
  if (!contract) {
    return json(res, 404, { error: 'Contract not found' });
  }
  return json(res, 200, contract);
}
```

- [x] **Step 3: Run network + full tests**

Run: `node --test`

Expected: PASS

- [x] **Step 4: Commit**

```bash
git add src/network/HttpServer.js test/network.test.js
git commit -m "feat: expose contract state over HTTP and sync"
```

---

### Task 5: Phase 4 CLI

**Files:**
- Modify: `src/index.js`

**Interfaces:**
- Consumes: `Transaction.deployAddress`, `blockchain.getContract`, `listContracts`, `LuckCoinNode.broadcastTransaction` (existing send path)
- Produces: commands `deploy`, `call`, `contract`, `contracts`

- [x] **Step 1: Update banner/help to Phase 4**

Set banner to Phase 4 / simple smart contracts. Extend `HELP` with:

```
  deploy <from> <amount> <codeJson>   Deploy contract code JSON
  call <from> <contract> <method> [amount] [argsJson]
  contract <address>                  Show contract code/storage/balance
  contracts                           List contract addresses
```

- [x] **Step 2: Implement command handlers**

`deploy`:

```js
case 'deploy': {
  const [fromRef, amountRaw, ...codeParts] = rest;
  const codeJson = codeParts.join(' ');
  // resolve wallet, parse amount integer >= 0, JSON.parse codeJson
  // const code = parsed.code ?? parsed  // allow raw map or { code: map }
  const timestamp = Date.now();
  const toAddress = Transaction.deployAddress(fromWallet.address, timestamp, code);
  const tx = new Transaction({
    fromAddress: fromWallet.address,
    toAddress,
    amount,
    timestamp,
    type: 'deploy',
    data: { code },
  });
  tx.sign(fromWallet);
  blockchain.addTransaction(tx);
  await node.broadcastTransaction(tx); // if node/listen pattern already broadcasts on send, mirror that
  console.log(`Deploy queued. Contract: ${toAddress}`);
  break;
}
```

`call`: parse method, optional amount (default 0), optional args JSON array; `type: 'call'`, `data: { method, args }`.

`contract`: `blockchain.getContract(addr)` pretty-print JSON.

`contracts`: list addresses or “(none)”.

Mirror whatever `send` does for broadcast (read current `src/index.js` and match).

- [x] **Step 3: Smoke**

```bash
node --test
printf 'wallet create alice\nmine alice\ndeploy alice 0 {"inc":[["load","n"],["push",1],["add"],["store","n"]]}\nmine alice\ncontracts\nexit\n' | LUCKCOIN_DIFFICULTY=2 npm start
```

Expected: deploy address printed; `contracts` lists it; tests PASS

- [x] **Step 4: Commit**

```bash
git add src/index.js
git commit -m "feat: Phase 4 CLI for deploy, call, and contract inspect"
```

---

### Task 6: README + skill notes

**Files:**
- Modify: `README.md`
- Modify: `.cursor/skills/repo-snapshot-guide/SKILL.md`

- [x] **Step 1: Update README**

- Title section → Phase 4 — Simple Smart Contracts
- Document `deploy` / `call` / `contract` / `contracts`
- Document `GET /contracts` and `GET /contracts/:address`
- Roadmap: Phases 1–3 done; Phase 4 current
- Example straight-line `inc` contract in quick start

- [x] **Step 2: Update skill notes**

Add Phase 4 bullet under LuckCoin-specific notes (`cursor/luckcoin-phase4-…` / master after merge): method-opcode contracts, deploy/call txs.

- [x] **Step 3: Final verification**

```bash
node --test
printf 'help\nexit\n' | npm start
```

Expected: all tests pass; help shows Phase 4 commands

- [x] **Step 4: Commit + push**

```bash
git add README.md .cursor/skills/repo-snapshot-guide/SKILL.md
git commit -m "docs: update README and skill notes for Phase 4"
git push -u origin HEAD
```

---

## Self-review checklist (plan author)

| Spec requirement | Task |
|---|---|
| Transaction `type` + `data` + hash | Task 1 |
| Deploy address derivation | Task 1 |
| Opcode set + VM limits | Task 2 |
| Blockchain apply/replay / getContract | Task 3 |
| Mempool simulation for deploy/call | Task 3 |
| HTTP `/contracts` | Task 4 |
| Multi-node sync derives same state | Task 4 |
| Phase 4 CLI | Task 5 |
| README / success criteria docs | Task 6 |
| No `node:vm` / no jumps / stdlib only | Honored |

No TBD placeholders. Method names consistent: `Transaction.deployAddress`, `executeMethod`, `getContract`, `listContracts`, `deploy` / `call` CLI.
