# LuckCoin

A Node.js proof-of-concept blockchain inspired by the **Maneki-neko** (招き猫) — the beckoning lucky cat of East Asian tradition. LuckCoin is a learning project that implements core blockchain concepts step by step.

## Phase 1 — Core Chain

- **Block** — linked-list node with index, timestamp, data, previous hash, nonce, and hash
- **Blockchain** — genesis block, block creation, Proof of Work mining, chain validation
- **CLI** — inspect the chain, mine blocks, and validate integrity

## Quick start

```bash
npm start
```

### CLI commands

| Command | Description |
|---|---|
| `chain` | Print the full blockchain |
| `mine <data>` | Mine a new block containing `<data>` |
| `validate` | Check whether the chain is valid |
| `help` | Show available commands |

## Project structure

```
src/
├── core/
│   ├── Block.js
│   ├── Blockchain.js
│   └── CryptoUtils.js
└── index.js
```

## Roadmap

1. **Phase 1** — Core chain (current)
2. **Phase 2** — Transactions and wallets
3. **Phase 3** — Multi-node P2P network
4. **Phase 4** — Simple smart contracts

## Cursor skill

Use `/repo-snapshot-guide` in Agent chat for a repo snapshot and high-level run instructions. See `.cursor/skills/repo-snapshot-guide/SKILL.md`.

## License

MIT — see [LICENSE](LICENSE).
