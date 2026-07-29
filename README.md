# LuckCoin

A Node.js proof-of-concept blockchain inspired by the **Maneki-neko** (招き猫) — the beckoning lucky cat of East Asian tradition. LuckCoin is a learning project that implements core blockchain concepts step by step.

## Phase 3 — Multi-Node Network

- **HTTP API** — stdlib `node:http` REST endpoints for chain, mempool, mine, and peers
- **Peer sync** — register nodes, broadcast transactions/blocks, resolve with longest valid chain
- **Shared genesis** — deterministic genesis block so fresh nodes share a common root
- **Wallets & ledger** — Phase 2 signed transfers, mempool, and coinbase rewards (still in-memory per process)

## Quick start

```bash
npm start
npm test
```

Set `LUCKCOIN_DIFFICULTY=2` for faster local mining (default is 4).

### Single-node CLI session

```
luckcoin> wallet create alice
luckcoin> wallet create bob
luckcoin> mine alice
luckcoin> send alice bob 25
luckcoin> mine alice
luckcoin> balance alice
luckcoin> balance bob
luckcoin> validate
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

### CLI commands

| Command | Description |
|---|---|
| `wallet create [name]` | Create an in-memory wallet |
| `wallets` | List session wallets |
| `send <from> <to> <amount>` | Sign and enqueue a transfer |
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
| `POST` | `/transactions` | Submit a signed transaction |
| `POST` | `/mine` | Body `{ "minerAddress" }` |
| `POST` | `/blocks` | Accept a tip-extension block |
| `GET` | `/balance/:address` | Account balance |
| `GET` | `/nodes` | Peer list |
| `POST` | `/nodes/register` | Body `{ "nodes": ["http://..."] }` |
| `GET` | `/nodes/resolve` | Conflict resolution |

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
├── network/
│   ├── Node.js
│   └── HttpServer.js
└── index.js
```

## Roadmap

1. **Phase 1** — Core chain ✓
2. **Phase 2** — Transactions and wallets ✓
3. **Phase 3** — Multi-node P2P network (current)
4. **Phase 4** — Simple smart contracts

## Cursor skill

Use `/repo-snapshot-guide` in Agent chat for a repo snapshot and high-level run instructions. See `.cursor/skills/repo-snapshot-guide/SKILL.md`.

## License

MIT — see [LICENSE](LICENSE).
