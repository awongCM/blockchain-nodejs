# LuckCoin Phase 2 — Transactions & Wallets Design

**Date:** 2026-07-28  
**Status:** Approved for planning  
**Branch:** `cursor/luckcoin-phase2-3ad5`

## Goal

Turn LuckCoin from a free-form data chain into a real ledger: in-memory wallets, signed transactions, a mempool, and mining that pays a coinbase reward plus includes pending transfers.

## Decisions (locked)

| Decision | Choice |
|---|---|
| Mining model | Reward + mempool: coinbase to miner, then pending txs |
| Wallet storage | In-memory only (session); no file persistence |
| Ledger model | Account-based balances via chain replay |
| Dependencies | Node.js stdlib only (`crypto`) — no new npm packages |
| Approach | Minimal ledger layer on top of existing Block/Blockchain |

## Architecture

```
src/
├── core/
│   ├── Block.js          # data is a transactions array (JSON-serialized for hashing)
│   ├── Blockchain.js     # mempool, minePendingTransactions(), getBalance()
│   └── CryptoUtils.js    # SHA-256 + ECDSA keygen / sign / verify
├── wallet/
│   ├── Wallet.js         # in-memory keypair + address
│   └── Transaction.js    # from, to, amount, timestamp, signature
└── index.js              # Phase 2 CLI
```

### Flow

1. User creates wallets in the CLI session (e.g. Alice, Bob, miner).
2. `send` builds a signed transaction and adds it to the mempool (reject invalid signature or insufficient balance).
3. `mine <minerAddress>` creates a coinbase reward transaction to the miner, appends valid pending transactions, mines the block, and removes included txs from the mempool.
4. `balance <address>` replays mined blocks only to compute the account balance.

No consensus changes beyond treating block payload as transactions instead of free-form strings.

## Components

### Wallet (`src/wallet/Wallet.js`)

- ECDSA on `secp256k1` via Node `crypto`
- Address = uncompressed public key as hex string (no `0x` prefix), derived from the key pair and used as the canonical identity everywhere
- In-memory only for the CLI session
- API: `Wallet.create()` (or constructor that generates keys), expose `address`, `sign(hash)`, keep private key non-enumerable / not printed by default

### Transaction (`src/wallet/Transaction.js`)

| Field | Description |
|---|---|
| `fromAddress` | Sender address, or `null` for coinbase |
| `toAddress` | Recipient address |
| `amount` | Positive number |
| `timestamp` | Unix ms |
| `signature` | ECDSA signature hex (absent/unused for coinbase) |

Methods:

- `calculateHash()` — SHA-256 of `fromAddress|toAddress|amount|timestamp` (use empty string for null `fromAddress`)
- `sign(wallet)` — sign hash with wallet private key; reject if wallet address ≠ `fromAddress`
- `isValid()` — `amount > 0`; coinbase (`fromAddress === null`) skips signature; otherwise signature must verify

### CryptoUtils extensions (`src/core/CryptoUtils.js`)

Add helpers (stdlib only):

- Generate ECDSA `secp256k1` key pair
- Sign a hex/message hash with private key
- Verify signature with public key / address

Keep existing `sha256` and `meetsDifficulty`.

### Block (`src/core/Block.js`)

- `data` / `transactions` becomes a **transactions array** (property name: `transactions` on the Block; hashing uses that array)
- Hashing serializes deterministically by joining each transaction’s `calculateHash()` in order (empty array → empty string contribution), so payload is `${index}${timestamp}${txHashesJoined}${previousHash}${nonce}`
- `toJSON()` exposes the block including full transaction objects
- Free-form string `data` is removed on this branch; Phase 1 string blocks are not supported in Phase 2

### Blockchain (`src/core/Blockchain.js`)

| Concern | Behavior |
|---|---|
| Genesis | Index 0, empty `transactions` array (or no value transfers); `previousHash = '0'` |
| Mempool | `pendingTransactions` array |
| `addTransaction(tx)` | Reject if `!tx.isValid()`, or if sender’s spendable balance (chain balance minus pending spends from that address) is insufficient; coinbase must not be added via this path |
| `minePendingTransactions(minerAddress)` | Build coinbase tx (`fromAddress: null`, `amount: miningReward`, `toAddress: minerAddress`) → prepend → append pending → mine block → clear included pending |
| Empty mempool | Allowed: mine coinbase-only block (bootstrap balances) |
| `getBalance(address)` | Replay mined blocks only; sum incoming − outgoing; pending does not count |
| `miningReward` | Fixed **100** LuckCoin |
| `addBlock(data)` | Removed or replaced; mining goes through `minePendingTransactions` |
| `isValidChain()` | Existing hash / link / PoW checks; additionally each non-genesis block’s transactions must all `isValid()`, and no block may overspend relative to balances as of the previous block tip |

## CLI

Banner: Phase 2.

| Command | Action |
|---|---|
| `wallet create [name]` | Create in-memory wallet; print name + address |
| `wallets` | List session wallets (name → address) |
| `send <from> <to> <amount>` | Resolve names or addresses to wallets/addresses; sign; enqueue |
| `pending` | Show mempool |
| `mine <miner>` | Mine coinbase + pending for miner (name or address) |
| `balance <name\|address>` | Print chain balance |
| `chain` | Print blocks (including transactions) |
| `validate` | Run `isValidChain()` |
| `help` / `exit` | Unchanged purpose |

User-facing errors (no process crash): unknown wallet, bad amount, invalid signature, insufficient funds.

## Testing

Use Node’s built-in test runner; difficulty **2** in tests for speed.

Coverage:

1. Wallet key generation; sign and verify round-trip
2. Valid transaction accepted into mempool
3. Forged / wrong signature rejected
4. Insufficient balance rejected
5. Mine credits mining reward to miner
6. Send → mine → sender and recipient balances update
7. Tampered block / broken link still fails `isValidChain()`
8. Existing Phase 1 crypto/hash invariants still hold where applicable

## Out of scope

- Wallet file persistence (`wallets/` on disk)
- UTXO model
- P2P / multi-node (Phase 3)
- Smart contracts (Phase 4)
- Updating the Docker/web branch (`cursor/luckcoin-docker-cloud-a3b5`)

## Success criteria

- Alice and Bob can be created in one CLI session
- Miner mines a coinbase-only block and receives 100 LuckCoin
- Alice receives coins (via mining or transfer), sends to Bob with a valid signature
- Forged transactions and overspends are rejected
- `npm test` passes; `npm start` demos the flow via CLI
