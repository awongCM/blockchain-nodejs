---
name: repo-snapshot-guide
description: Show a code snapshot of the repository and high-level instructions for how the app is structured and run. Use when the user asks for a repo overview, code snapshot, project tour, architecture summary, or how to run/start the app.
disable-model-invocation: true
---

# Repo Snapshot & Run Guide

Produce a concise **code snapshot** and **high-level run guide** for this repository. Keep it readable — the user wants orientation, not a full file dump.

## When to use

- User asks for a repo snapshot, overview, tour, or "how does this work?"
- User asks how to run, start, test, or deploy the app
- User returns after time away and needs a refresher

## Workflow

### 1. Run the snapshot script

From the **repository root**:

```bash
bash .cursor/skills/repo-snapshot-guide/scripts/snapshot.sh
```

Use the output as ground truth for file layout, scripts, and config presence.

### 2. Read key files (only if needed)

After the script, read selectively — do not dump entire files:

| File | Why |
|---|---|
| `package.json` | Scripts, entry point, Node version |
| `README.md` | Official quick start |
| `docker-compose.yml` | Container run flow |
| `render.yaml` | Cloud deploy |
| `.cursor/environment.json` | Cloud Agent setup |
| `src/index.js` or main entry | CLI / app bootstrap |

### 3. Present the snapshot to the user

Use this structure:

#### A. One-line summary

What the project is (e.g. "LuckCoin — Node.js PoC blockchain, Phase 3 multi-node HTTP network").

#### B. Architecture snapshot

A compact tree or bullet list of the **important** paths only:

```
src/core/      Block, Blockchain, CryptoUtils
src/wallet/    Wallet, Transaction
src/network/   LuckCoinNode, HttpServer
src/index.js   Interactive CLI (+ optional HTTP listen)
test/          Node test runner
```

Explain how pieces connect in 2–4 sentences (ledger → HTTP peers → longest-chain sync → CLI).

#### C. How to run (high level)

List every applicable run path discovered in the repo. For **this project** (LuckCoin), typical modes are:

| Mode | Command | What you get |
|---|---|---|
| **CLI** | `npm start` | Interactive `luckcoin>` prompt — wallets, mine, peers, sync |
| **HTTP node** | `LUCKCOIN_LISTEN=1 npm start` | CLI + REST API on `0.0.0.0:$PORT` |
| **Tests** | `npm test` | Node built-in test runner |
| **Web server** | `npm run server` | Dashboard at http://localhost:3000 *(if `src/server.js` exists on branch)* |
| **Demo** | `npm run demo` | Non-interactive mining demo *(if script exists)* |
| **Docker** | `docker compose up --build` | Containerized app on port 3000 *(if compose file exists)* |
| **Cloud Agent** | Start agent on branch with `.cursor/environment.json` | Remote dev with port forwarding *(if configured)* |

Only include rows that exist on the **current branch**. Note if richer features live on another branch (e.g. `cursor/luckcoin-docker-cloud-a3b5`).

#### D. Prerequisites

- Node.js >= 18 (from `package.json` engines)
- No install step required — pure Node stdlib through Phase 3

#### E. Key CLI commands *(if CLI app)*

| Command | Action |
|---|---|
| `wallet create [name]` | Create in-memory wallet |
| `send` / `mine` / `balance` | Ledger ops |
| `listen` / `peers` / `sync` | Multi-node HTTP |
| `chain` / `validate` | Inspect integrity |
| `exit` | Quit |

### 4. Optional — show code highlights

If the user wants code detail, cite **short** snippets (≤15 lines) from:

- `src/core/Block.js` — hash + mine
- `src/core/Blockchain.js` — genesis, addBlock, isValidChain
- `src/index.js` — CLI loop

Use code citation format: ` ```startLine:endLine:filepath `

### 5. Roadmap pointer

If `README.md` lists phases/roadmap, mention current phase and what's next in one sentence.

## Output rules

- **Concise** — aim for scannable sections, not walls of text
- **Branch-aware** — state which branch you're describing
- **Actionable** — every run mode needs the exact command
- **Honest** — if a feature is on another branch, say so
- Do **not** start servers or tunnels unless the user asks

## LuckCoin-specific notes

- **Phase 1 (`cursor/luckcoin-phase1-a3b5`)**: CLI + core chain only (free-form block data)
- **Phase 2 (`cursor/luckcoin-phase2-3ad5` / master)**: wallets, signed transactions, mempool, coinbase mining rewards
- **Phase 3 (`cursor/luckcoin-phase3-8426` / master after merge)**: HTTP multi-node sync, peer register/resolve, longest valid chain
- **Extended branch (`cursor/luckcoin-docker-cloud-a3b5`)**: Phase 1 web dashboard + Docker + Render + Cloud Agent config (not yet updated for Phase 2/3)
- Mining uses Proof of Work; default difficulty is 4 (slower). Tests use difficulty 2
