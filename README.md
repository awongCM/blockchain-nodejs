# LuckCoin

A Node.js proof-of-concept blockchain inspired by the **Maneki-neko** (招き猫) — the beckoning lucky cat of East Asian tradition. LuckCoin is a learning project that implements core blockchain concepts step by step.

## Phase 4 — Simple Smart Contracts

- **Deploy / call txs** — typed transactions (`transfer` | `deploy` | `call`) with on-chain method programs
- **Tiny opcode VM** — straight-line stack programs (`push`, `load`, `store`, `add`, `transfer`, …)
- **Chain-derived state** — contract code and storage rebuilt by replaying the ledger (syncs with Phase 3 peers)
- **HTTP inspect** — `GET /contracts` and `GET /contracts/:address`
- **Wallets & network** — Phase 2/3 ledger and multi-node sync unchanged underneath

## Quick start

```bash
npm start
npm test
```

Set `LUCKCOIN_DIFFICULTY=2` for faster local mining (default is 4).

### Single-node CLI session

```
luckcoin> wallet create alice
luckcoin> mine alice
luckcoin> deploy alice 0 {"inc":[["load","n"],["push",1],["add"],["store","n"]]}
luckcoin> mine alice
luckcoin> contracts
luckcoin> call alice <contractAddress> inc
luckcoin> mine alice
luckcoin> contract <contractAddress>
luckcoin> validate
```

### Transfers (still supported)

```
luckcoin> wallet create bob
luckcoin> send alice bob 25
luckcoin> mine alice
luckcoin> balance alice
luckcoin> balance bob
```

### Two-node sync

Terminal A:

```bash
LUCKCOIN_DIFFICULTY=2 LUCKCOIN_PORT=3001 LUCKCOIN_LISTEN=1 npm start
```

```
luckcoin> wallet create alice
luckcoin> mine alice
```

Terminal B:

```bash
LUCKCOIN_DIFFICULTY=2 LUCKCOIN_PORT=3002 LUCKCOIN_URL=http://127.0.0.1:3002 LUCKCOIN_LISTEN=1 npm start
```

```
luckcoin> peers add http://127.0.0.1:3001
luckcoin> sync
luckcoin> chain
```

Or auto-listen with `npm start -- --listen`.

### Web dashboard + Docker

Run the Maneki-neko themed dashboard (Phase 3 ledger API under the hood):

```bash
npm run server          # → http://localhost:3000
npm run demo            # same, with LUCKCOIN_DIFFICULTY=2
docker compose up --build
```

| Endpoint | Description |
|---|---|
| `GET /` | Web dashboard (HTML) |
| `GET /health` | Health check for Docker/Render |
| `GET /validate` | Chain validity `{ valid }` |
| `GET /chain` | Full chain JSON |
| `POST /mine` | Body `{ "minerAddress" }` — coinbase + mempool |
| `GET /transactions` | Pending mempool |

See [AGENTS.md](AGENTS.md) for Cursor Cloud Agent setup with nested Docker.

### CLI commands

| Command | Description |
|---|---|
| `wallet create [name]` | Create an in-memory wallet |
| `wallets` | List session wallets |
| `send <from> <to> <amount>` | Sign and enqueue a transfer |
| `deploy <from> <amount> <codeJson>` | Deploy contract code (amount may be `0`) |
| `call <from> <contract> <method> [amount] [argsJson]` | Call a contract method |
| `contract <address>` | Show code, storage, and balance |
| `contracts` | List contract addresses on chain |
| `pending` | Show mempool |
| `mine <miner>` | Mine coinbase reward + pending transactions |
| `balance <name\|address>` | Show chain balance |
| `chain` | Print the full blockchain |
| `validate` | Check whether the chain is valid |
| `listen [port]` | Start HTTP API (`0.0.0.0`, honors `PORT`) |
| `peers` | List peer URLs |
| `peers add <url>` | Register a peer |
| `sync` | Resolve conflicts (longest valid chain) |
| `url` | Show this node's advertised URL |
| `help` | Show available commands |

### HTTP API

| Method | Path | Description |
|---|---|---|
| `GET` | `/chain` | Full chain + length |
| `GET` | `/transactions` | Pending mempool |
| `POST` | `/transactions` | Submit a signed transaction (including deploy/call) |
| `POST` | `/mine` | Body `{ "minerAddress" }` |
| `POST` | `/blocks` | Accept a tip-extension block |
| `GET` | `/balance/:address` | Account balance |
| `GET` | `/contracts` | List contract addresses |
| `GET` | `/contracts/:address` | Contract code, storage, balance |
| `GET` | `/nodes` | Peer list |
| `POST` | `/nodes/register` | Body `{ "nodes": ["http://..."] }` |
| `GET` | `/nodes/resolve` | Conflict resolution |

### Example contract

Increment a storage counter:

```json
{
  "inc": [
    ["load", "n"],
    ["push", 1],
    ["add"],
    ["store", "n"]
  ]
}
```

Contract addresses are 64-char SHA-256 hex (distinct from longer SPKI wallet addresses).

## Project structure

```
src/
├── core/
│   ├── Block.js
│   ├── Blockchain.js
│   └── CryptoUtils.js
├── wallet/
│   ├── Wallet.js
│   └── Transaction.js
├── contract/
│   ├── opcodes.js
│   ├── VirtualMachine.js
│   └── ContractAccount.js
├── network/
│   ├── Node.js
│   └── HttpServer.js
└── index.js
```

## Roadmap

1. **Phase 1** — Core chain ✓
2. **Phase 2** — Transactions and wallets ✓
3. **Phase 3** — Multi-node P2P network ✓
4. **Phase 4** — Simple smart contracts (current)

## Design docs

- Spec: `docs/superpowers/specs/2026-07-30-luckcoin-phase4-design.md`
- Plan: `docs/superpowers/plans/2026-07-30-luckcoin-phase4.md`

## Cursor skill

Use `/repo-snapshot-guide` in Agent chat for a repo snapshot and high-level run instructions. See `.cursor/skills/repo-snapshot-guide/SKILL.md`.

## License

MIT — see [LICENSE](LICENSE).
