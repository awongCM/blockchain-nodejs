# LuckCoin

A Node.js proof-of-concept blockchain inspired by the **Maneki-neko** (招き猫) — the beckoning lucky cat of East Asian tradition. LuckCoin is a learning project that implements core blockchain concepts step by step.

## Phase 2 — Transactions & Wallets

- **Wallet** — in-memory ECDSA secp256k1 keypairs with addresses
- **Transaction** — signed transfers and coinbase rewards
- **Mempool** — pending transactions validated before mining
- **Blockchain** — account balances via chain replay; mining pays 100 LuckCoin + pending txs
- **CLI** — create wallets, send coins, mine, and check balances

## Quick start

```bash
npm start
npm test
```

Set `LUCKCOIN_DIFFICULTY=2` for faster local mining (default is 4).

### Example session

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
| `help` | Show available commands |

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
└── index.js
```

## Roadmap

1. **Phase 1** — Core chain ✓
2. **Phase 2** — Transactions and wallets (current)
3. **Phase 3** — Multi-node P2P network
4. **Phase 4** — Simple smart contracts

## Cursor skill

Use `/repo-snapshot-guide` in Agent chat for a repo snapshot and high-level run instructions. See `.cursor/skills/repo-snapshot-guide/SKILL.md`.

## License

MIT — see [LICENSE](LICENSE).
