# Agent instructions

## Cursor Cloud specific instructions

LuckCoin can run inside a **Cursor Cloud Agent** with Docker enabled via `.cursor/environment.json`.

### How it works

1. Cursor builds the **agent environment** from `.cursor/Dockerfile` (Ubuntu + Node 22 + Docker).
2. On startup, `start` launches the Docker daemon.
3. The **LuckCoin** terminal runs `docker compose up --build`, which builds and starts the app container from the repo root `Dockerfile`.
4. Port **3000** is forwarded so you can open the web dashboard from the Cloud Agent UI.

The dashboard uses the **Phase 3** HTTP API (`POST /mine` with `{ "minerAddress" }`, `GET /chain`, etc.) — not the legacy Phase 1 `{ "data" }` mine payload.

### Starting a cloud session

1. Commit and push a branch that includes `.cursor/environment.json`.
2. Start a **normal Cloud Agent** on that branch — do **not** use the interactive "Set up agent" snapshot flow if you want Dockerfile mode (that flow ignores `build.dockerfile`).
3. If you previously saved a snapshot for this repo, delete it in **Dashboard → Cloud Agents → Environments** so Cursor rebuilds from the Dockerfile.
4. Once the agent is running, open the **LuckCoin** terminal and visit port **3000** to see the dashboard.

### Verify without a browser

```bash
curl -s http://127.0.0.1:3000/health
curl -s http://127.0.0.1:3000/validate
curl -s http://127.0.0.1:3000/chain | head -c 200
```

Mine requires a wallet address (the dashboard uses an in-process demo miner; for curl, generate one in Node or copy from the dashboard page):

```bash
MINER=$(node --input-type=module -e "import {Wallet} from './src/wallet/Wallet.js'; console.log(Wallet.create().address)")
curl -s -X POST http://127.0.0.1:3000/mine \
  -H 'Content-Type: application/json' \
  -d "{\"minerAddress\":\"$MINER\"}"
```

### Simpler fallback (no nested Docker)

If Docker-in-Docker has issues, run the dashboard directly in a terminal:

```bash
LUCKCOIN_DIFFICULTY=2 npm run server
```

This avoids nested containers and is often faster for PoC testing.
