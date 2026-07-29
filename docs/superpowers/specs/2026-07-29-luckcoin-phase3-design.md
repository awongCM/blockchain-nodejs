# LuckCoin Phase 3 — Multi-Node Network Design

**Date:** 2026-07-29  
**Status:** Approved for planning (locked from Phase 1 roadmap + Phase 2 ledger)  
**Branch:** `cursor/luckcoin-phase3-8426`

## Goal

Turn a single-process LuckCoin ledger into a small multi-node network: each node exposes an HTTP API, peers can register each other, broadcast pending transactions and mined blocks, and resolve conflicts with **longest valid chain** consensus.

## Decisions (locked)

| Decision | Choice |
|---|---|
| Transport | HTTP REST over Node.js built-in `node:http` (no Express/Fastify; stay stdlib-only) |
| Consensus | Proof of Work + **longest valid chain** (length; all blocks must pass `isValidChain()`) |
| Peer discovery | Explicit register (`POST /nodes/register`); no DHT / gossip discovery |
| Sync model | Pull on resolve + push on mine/tx (best-effort broadcast to known peers) |
| WebSockets | Out of scope (HTTP only this phase) |
| Dependencies | Node.js stdlib only — no new npm packages |
| Genesis | Deterministic shared genesis (`timestamp: 0`, empty txs, `previousHash: '0'`) so fresh nodes share a common root |
| Wallets | Still in-memory per process (Phase 2); not synced across nodes |

## Architecture

```
src/
├── core/                 # unchanged ledger rules (plus genesis + hydrate helpers)
├── wallet/               # unchanged Transaction/Wallet (+ fromJSON)
├── network/
│   ├── HttpServer.js     # REST API bound to 0.0.0.0:$PORT (or configured port)
│   └── Node.js           # peer registry, broadcast, resolve/replaceChain
└── index.js              # Phase 3 CLI (+ optional HTTP listen)
```

### Flow

1. Start node A on port 3001 and node B on port 3002 (same difficulty / mining reward).
2. On B: `peers add http://127.0.0.1:3001` (registers B with A and A with B, or one-way + resolve).
3. Mine on A → A broadcasts the new block (or full chain tip) to peers; B may pull via resolve.
4. Submit a signed tx on A → mempool + broadcast to peers’ mempools.
5. `POST /nodes/resolve` (or CLI `sync`) fetches peer chains and replaces local chain if a longer **valid** chain is found.

## Components

### Deterministic genesis (`Blockchain`)

- Genesis block always uses `timestamp: 0`, `transactions: []`, `previousHash: '0'`.
- Breaking change vs Phase 2 sessions that used `Date.now()` genesis — acceptable for this PoC branch; document in README.

### Hydration helpers

Remote JSON must become live objects with methods:

- `Transaction.fromJSON(obj)` → `Transaction`
- `Block.fromJSON(obj)` → `Block` with `Transaction` instances
- `Blockchain.replaceChain(newChainBlocks)` — accept array of block JSON or Blocks; rebuild / validate; reject if not longer or not valid
- Optional: `Blockchain.fromJSON({ difficulty, miningReward, chain, pendingTransactions })` for tests

### Network node (`src/network/Node.js`)

Holds:

- `blockchain: Blockchain`
- `peers: Set<string>` of base URLs (no trailing slash)
- `url: string` this node’s advertised base URL

Methods:

| Method | Behavior |
|---|---|
| `registerPeer(peerUrl)` | Normalize URL; add to set; ignore self |
| `broadcastTransaction(tx)` | `POST /transactions` to each peer (ignore failures) |
| `broadcastBlock` / chain tip | After mine: notify peers — either `POST /blocks` with block JSON or ask peers to resolve; **choice: `POST /blocks` for the new block**, peers append if valid extension else ignore and may resolve |
| `resolveConflicts()` | `GET /chain` from each peer; pick longest chain that rehydrates and passes `isValidChain()` with same difficulty/reward; replace local if strictly longer; return `{ replaced, length }` |

**Block append rule:** If received block’s `previousHash` equals local tip hash and index is tip+1 and the block (as a one-block extension) is valid under chain rules, append and clear any included pending txs from local mempool. Otherwise skip (caller can `resolveConflicts`).

### HTTP API (`src/network/HttpServer.js`)

Bind `0.0.0.0` and `process.env.PORT` when set (Render-friendly); otherwise `LUCKCOIN_PORT` or default `3001`.

| Method | Path | Action |
|---|---|---|
| `GET` | `/` | Short service info + phase |
| `GET` | `/chain` | JSON `{ chain, length }` |
| `GET` | `/transactions` | Pending mempool as JSON |
| `POST` | `/transactions` | Body: transaction JSON; validate + `addTransaction`; broadcast to peers (skip echo loops via optional header or “already have” check) |
| `POST` | `/mine` | Body: `{ minerAddress }`; mine; broadcast new block; return block |
| `GET` | `/balance/:address` | Chain balance |
| `GET` | `/nodes` | Peer URL list |
| `POST` | `/nodes/register` | Body: `{ nodes: string[] }` or `{ node: string }`; register peers |
| `GET` | `/nodes/resolve` | Run `resolveConflicts()`; return result |
| `POST` | `/blocks` | Body: block JSON; try append as extension |

JSON responses; `4xx` with `{ error: string }` on validation failures. Never crash the process on bad peer input.

### CLI (Phase 3)

Banner: Phase 3.

Keep all Phase 2 wallet/ledger commands. Add:

| Command | Action |
|---|---|
| `listen [port]` | Start HTTP server (default from env / 3001) |
| `peers` | List peer URLs |
| `peers add <url>` | Register peer (and optionally POST register self to them) |
| `sync` | Run conflict resolution against peers |
| `url` | Print this node’s advertised base URL |

On startup, if `LUCKCOIN_LISTEN=1` or `--listen`, auto-start HTTP.

Advertised URL: `LUCKCOIN_URL` or `http://127.0.0.1:<port>`.

## Testing

Node built-in test runner; difficulty **2**.

Coverage:

1. Deterministic genesis identical across two `Blockchain` instances
2. `fromJSON` / `replaceChain` accepts longer valid chain; rejects shorter / invalid
3. HTTP `GET /chain` returns genesis
4. Two nodes: register peers → mine on A → resolve on B → B length matches A
5. Broadcast transaction: tx on A appears in B mempool (or after POST)
6. Invalid tx / invalid block rejected with 4xx
7. Existing Phase 2 ledger tests still pass (update genesis expectations)

## Out of scope

- WebSockets / real P2P sockets
- UTXO, wallet persistence, smart contracts (Phase 4)
- Authenticating peers / TLS between nodes
- Transaction nonce / chain ID (noted risk from Phase 2 review; defer unless sync demos collide)
- Docker/dashboard branch updates

## Success criteria

- Two local processes can register as peers
- Mining on one node and `sync` on the other yields the same valid longer chain
- Signed transfers can be submitted over HTTP and mined
- `npm test` passes; README documents multi-node quick start
- HTTP server binds `0.0.0.0` when `PORT` is set (cloud-friendly)
