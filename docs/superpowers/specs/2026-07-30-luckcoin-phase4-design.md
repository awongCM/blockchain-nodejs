# LuckCoin Phase 4 — Simple Smart Contracts Design

**Date:** 2026-07-30  
**Status:** Approved for planning (locked from Phase 1–3 ledger + network)  
**Branch:** `cursor/luckcoin-phase4-docs-a9a8`

## Goal

Add a minimal, deterministic smart-contract layer on top of the Phase 2/3 account ledger: wallets can **deploy** on-chain programs, **call** named methods with optional value, and nodes rebuild identical contract storage by replaying the chain.

## Decisions (locked)

| Decision | Choice |
|---|---|
| Contract model | On-chain accounts with `code` + `storage` + balance (account-based, not UTXO) |
| Code format | Method map → straight-line opcode programs (no jumps / loops) |
| Runtime | Tiny deterministic stack VM in stdlib JS (`src/contract/`) |
| Transaction shape | Extend `Transaction` with `type` + `data` (`transfer` \| `deploy` \| `call`) |
| Contract address | 64-char SHA-256 hex of deploy identity fields (distinct from longer SPKI wallet addresses) |
| Value | `amount` on deploy/call credits the contract balance before execution |
| Persistence | Still in-memory / chain-replay only (no disk DB) |
| Dependencies | Node.js stdlib only — no new npm packages |
| Networking | Reuse Phase 3 HTTP + broadcast; typed txs travel as JSON through existing `/transactions` |
| Gas / metering | Max instruction steps per call (`maxSteps = 128`); reject on overrun |
| Out of scope | Solidity/EVM, `node:vm` JS eval, UTXO, wallet file persistence, formal ABI tooling |

## Approaches considered

1. **Hardcoded templates only** (escrow / crowdfund classes) — fastest, but weak as a “smart contracts” learning step.
2. **`node:vm` JavaScript contracts** — flexible, but non-portable risk, harder deterministic validation, security footguns.
3. **Tiny method-opcode VM (chosen)** — educational, deterministic, stdlib-only, fits existing replay validation.

## Architecture

```
src/
├── core/                 # Blockchain applies deploy/call during mine + isValidChain
├── wallet/               # Transaction gains type + data; hash includes both
├── contract/
│   ├── opcodes.js        # Instruction names + validation helpers
│   ├── VirtualMachine.js # Stack executor for one method call
│   └── ContractAccount.js# { address, code, storage, balance helpers }
├── network/              # Optional GET /contracts/:address; txs unchanged path
└── index.js              # Phase 4 CLI: deploy / call / contract inspect
```

### Flow

1. Alice funds herself via mining (unchanged).
2. `contract deploy alice 0 '{"inc":[["load","n"],["push",1],["add"],["store","n"]]}'`  
   → builds a signed `deploy` tx; contract address derived; mempool accepts if Alice can fund `amount`.
3. Mine → chain stores the deploy tx; all nodes rebuild a `ContractAccount` with that code and empty storage; `amount` credited to contract.
4. `contract call alice <addr> inc` → signed `call` tx; on apply, VM runs method `inc`, mutates storage.
5. `contract get <addr>` / `GET /contracts/:address` shows code + storage + balance.
6. Peer sync unchanged: longer valid chain wins; contract state is never gossiped separately — it is derived.

## Components

### Transaction extensions (`Transaction`)

| Field | Rules |
|---|---|
| `type` | `'transfer'` (default), `'deploy'`, or `'call'` |
| `data` | `null` for transfer; deploy/call payload object (see below) |
| `fromAddress` | Wallet SPKI hex; still `null` only for coinbase |
| `toAddress` | Transfer recipient **or** contract address for deploy/call |
| `amount` | Positive integer for transfer; non-negative integer for deploy/call (`0` allowed to deploy/call without funding) |

**Hash payload** (must change for all txs so old Phase 2 hashes are intentionally superseded on this PoC):

```
sha256(`${from}|${to}|${amount}|${timestamp}|${type}|${canonicalData}`)
```

Where `canonicalData` is `''` when `data` is null, else `JSON.stringify(data)` with stable key order for objects used in deploy/call constructors (constructors always build `data` in a fixed shape).

**Coinbase:** `type: 'transfer'` (or omit → default), `data: null`, `fromAddress: null` — unchanged validity rules.

#### Deploy `data`

```json
{
  "code": {
    "<methodName>": [ ["push", 1], ["store", "n"] ]
  }
}
```

- At least one method required.
- Method names: `/^[a-zA-Z_][a-zA-Z0-9_]*$/`, max 32 chars.
- Each method: non-empty array, max **32** instructions.
- Total methods ≤ **16**.

#### Call `data`

```json
{
  "method": "inc",
  "args": [1, "memo"]
}
```

- `method` required string.
- `args` optional array of numbers/strings only (max 8 args).
- Args are pushed onto the stack in order before instructions run.

### Contract address

Computed before signing a deploy:

```js
sha256(`${fromAddress}|${timestamp}|${JSON.stringify(code)}`)
```

- Result is 64 lowercase hex chars.
- `toAddress` on the deploy tx **must equal** this address (`isValid()` checks).
- Call txs: `toAddress` must be an existing contract when applied (mempool checks against chain + prior pending deploys).

### Opcode set (`src/contract/opcodes.js`)

Straight-line only (no `jmp` / `jz`). Stack holds numbers or strings.

| Op | Effect |
|---|---|
| `["push", value]` | Push number or string literal |
| `["load", key]` | Push `storage[key]` if set, else `0` |
| `["store", key]` | Pop one value into `storage[key]` |
| `["add"]` / `["sub"]` / `["mul"]` | Pop `b`, pop `a`; push number result (`sub`/`mul`/`add` require numbers) |
| `["eq"]` / `["lt"]` | Pop `b`, pop `a`; push `1` or `0` |
| `["dup"]` / `["pop"]` | Stack utilities |
| `["caller"]` | Push `tx.fromAddress` |
| `["value"]` | Push `tx.amount` |
| `["balance"]` | Push contract balance **after** crediting `tx.amount` |
| `["transfer"]` | Pop `amount`, pop `to`; append effect `{ to, amount }` if contract has funds |
| `["halt"]` | End method early (optional; end of list also halts) |

**Limits:** `maxSteps = 128`, max stack depth `64`, storage keys `/^[a-zA-Z_][a-zA-Z0-9_]*$/` max 32 chars, max **32** storage keys per contract. Integer amounts/results must be safe integers ≥ 0 for balances/transfers; arithmetic overflow → execution failure.

### VirtualMachine (`src/contract/VirtualMachine.js`)

```js
execute({ code, storage, balance, tx, method, args })
→ { storage, balance, effects, steps }
```

- Clone storage before mutate; on failure throw (caller rejects tx / invalidates chain).
- Credit `tx.amount` to `balance` first.
- Push `args` left-to-right, then run `code[method]`.
- Apply `transfer` effects by reducing contract `balance` during execution (fail if insufficient).
- Recipient credits from effects applied by `Blockchain` when committing the tx (EOA or contract address).

### ContractAccount

Plain structure used during replay:

```js
{
  address: string,
  code: Record<string, Instruction[]>,
  storage: Record<string, number|string>,
}
```

Balances for contracts live in the same balance map as wallets (`getBalance(contractAddress)` works).

### Blockchain integration

During `getBalance` / spend checks, treat contract addresses like any account (debits/credits from transfers, deploy value, call value, and VM `transfer` effects).

**Apply transaction** (shared helper used by `minePendingTransactions` commit path and `isValidChain` replay):

1. Validate signature / coinbase / type-specific shape (`tx.isValid()`).
2. If `transfer`: existing debit/credit rules (`amount > 0`).
3. If `deploy`:
   - `amount >= 0`; sender has funds (when `amount > 0`).
   - Contract address must not already exist.
   - Register `code`; credit `amount` to contract; debit sender.
4. If `call`:
   - Contract must exist; method must exist.
   - Debit sender `amount` (if > 0); run VM; credit effects to recipients.
   - Persist resulting storage on the contract account.

**Mempool (`addTransaction`):**

- `transfer`: unchanged (still require `amount > 0`).
- `deploy` / `call`: allow `amount === 0`; simulate against chain state + earlier pending txs (ordered) so insufficient funds / bad method / duplicate deploy fail before mining.
- Pending spend includes deploy/call amounts from the sender.

**`isValidChain`:** rebuild contracts + balances from genesis → tip; any apply failure → invalid.

**`replaceChain`:** clear pending (existing); contract state is not stored on `Blockchain` as durable fields — either rebuild lazily via `getContract(address)` replay or cache invalidated on chain mutate. **Choice: lazy replay helper `getContractsState()` / `getContract(address)`** with optional private cache cleared whenever `chain` or pending application view changes. Simplest: recompute on each inspect (PoC scale).

### HTTP API additions

| Method | Path | Action |
|---|---|---|
| `GET` | `/contracts/:address` | `{ address, code, storage, balance }` or 404 |
| `GET` | `/contracts` | List known contract addresses (from chain replay) |

Existing `POST /transactions` accepts deploy/call JSON (with `type` + `data`). No separate deploy endpoint required.

### CLI (Phase 4)

Banner: Phase 4. Keep Phase 2/3 commands. Add:

| Command | Action |
|---|---|
| `deploy <from> <amount> <codeJson>` | Create + sign + enqueue deploy (`amount` may be `0`) |
| `call <from> <contract> <method> [amount] [argsJson]` | Create + sign + enqueue call (default amount `0`, args `[]`) |
| `contract <address\|name>` | Show code, storage, balance |
| `contracts` | List contract addresses |

Optional: allow saving deploy address into a session alias map (`contractsByName`) when user passes `deploy alice 0 '{...}' as counter` — **skip aliases in v1** to reduce scope; users paste addresses (CLI may print full address after deploy).

## Testing

Node built-in test runner; difficulty **2**.

Coverage:

1. Transaction hash includes `type`/`data`; deploy address derivation stable
2. VM: `inc` method mutates storage; `transfer` effect moves value; step limit enforced
3. Ledger: deploy + mine → `getContract` returns code; call + mine updates storage
4. Invalid call method / redeploy same address / VM failure rejected by `addTransaction` or `isValidChain`
5. Transfer-only Phase 2 tests still pass with default `type: 'transfer'`
6. Network: deploy on node A, sync B, `GET /contracts/:addr` matches on B
7. CLI smoke: deploy → mine → call → mine → contract inspect

## Out of scope

- Jump opcodes, loops, recursion, inter-contract calls
- Events/logs bloom, ABI JSON files, compilers
- Paying gas to miners (only step limits)
- Upgrading contract code after deploy
- Docker/dashboard branch updates

## Success criteria

- A contract can be deployed, mined, called, and inspected via CLI
- Two nodes syncing a chain that includes deploy/call txs show identical contract storage
- `npm test` passes; README marks Phase 4 current and documents deploy/call
- Still stdlib-only; HTTP binds `0.0.0.0` / `PORT` unchanged
