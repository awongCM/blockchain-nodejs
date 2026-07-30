/**
 * Render the LuckCoin web dashboard HTML (Phase 4 ledger + contracts API).
 *
 * @param {object} config
 * @param {number} config.difficulty
 * @param {string} config.minerAddress
 * @returns {string}
 */
export function renderDashboardPage({ difficulty, minerAddress }) {
  const configJson = JSON.stringify({ difficulty, minerAddress });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>LuckCoin</title>
  <style>
    :root {
      color-scheme: light dark;
      --accent: #c41e3a;
      --bg: #fff8f0;
      --card: #ffffff;
      --text: #1a1a1a;
      --muted: #666;
      --border: #f0d9c8;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #1a1210;
        --card: #261915;
        --text: #f5ebe0;
        --muted: #b8a89a;
        --border: #4a3028;
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: system-ui, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
    }
    header {
      padding: 2rem 1.5rem 1rem;
      text-align: center;
      border-bottom: 1px solid var(--border);
    }
    header h1 { margin: 0; font-size: 2rem; }
    header p { margin: 0.5rem 0 0; color: var(--muted); }
    main { max-width: 860px; margin: 0 auto; padding: 1.5rem; }
    .panel {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 1.25rem;
      margin-bottom: 1rem;
    }
    .status {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      border-radius: 999px;
      font-size: 0.875rem;
      font-weight: 600;
    }
    .status.valid { background: #d4edda; color: #155724; }
    .status.invalid { background: #f8d7da; color: #721c24; }
    @media (prefers-color-scheme: dark) {
      .status.valid { background: #1e3d28; color: #8fd4a0; }
      .status.invalid { background: #4a2020; color: #f5a0a0; }
    }
    button {
      padding: 0.625rem 1rem;
      border: none;
      border-radius: 8px;
      background: var(--accent);
      color: white;
      font-weight: 600;
      cursor: pointer;
    }
    button:disabled { opacity: 0.6; cursor: wait; }
    .block {
      border-top: 1px solid var(--border);
      padding: 1rem 0;
    }
    .block:first-child { border-top: none; padding-top: 0; }
    .block h3 { margin: 0 0 0.5rem; }
    .hash {
      font-family: ui-monospace, monospace;
      font-size: 0.8rem;
      word-break: break-all;
      color: var(--muted);
    }
    .meta { font-size: 0.875rem; color: var(--muted); }
    .tx { margin: 0.25rem 0 0.25rem 1rem; font-size: 0.875rem; }
    #message { min-height: 1.25rem; color: var(--muted); font-size: 0.875rem; }
  </style>
</head>
<body>
  <header>
    <h1>🐱 LuckCoin</h1>
    <p>Phase 4 — ledger dashboard (coinbase + mempool mining + contracts)</p>
  </header>
  <main>
    <div class="panel">
      <p>Chain status: <span id="status" class="status">…</span></p>
      <p class="meta">Difficulty: <span id="difficulty"></span> · Blocks: <span id="block-count">0</span> · Mempool: <span id="mempool-count">0</span></p>
      <p class="meta hash">Demo miner: <span id="miner-address"></span></p>
    </div>
    <div class="panel">
      <button type="button" id="mine-btn">Mine coinbase block</button>
      <p id="message"></p>
    </div>
    <div class="panel">
      <h2 style="margin-top:0">Blockchain</h2>
      <div id="chain"></div>
    </div>
  </main>
  <script type="application/json" id="luckcoin-config">${configJson}</script>
  <script>
    const config = JSON.parse(document.getElementById('luckcoin-config').textContent);
    const statusEl = document.getElementById('status');
    const chainEl = document.getElementById('chain');
    const blockCountEl = document.getElementById('block-count');
    const mempoolCountEl = document.getElementById('mempool-count');
    const messageEl = document.getElementById('message');
    const mineBtn = document.getElementById('mine-btn');
    document.getElementById('difficulty').textContent = String(config.difficulty);
    document.getElementById('miner-address').textContent = config.minerAddress;

    function shortAddr(address) {
      if (!address) return 'coinbase';
      return address.slice(0, 10) + '…' + address.slice(-8);
    }

    function appendText(parent, tag, text, className) {
      const el = document.createElement(tag);
      el.textContent = text;
      if (className) el.className = className;
      parent.appendChild(el);
      return el;
    }

    function renderChain(chain) {
      chainEl.replaceChildren();
      for (const block of chain) {
        const blockEl = document.createElement('div');
        blockEl.className = 'block';
        appendText(blockEl, 'h3', 'Block #' + block.index);
        appendText(
          blockEl,
          'p',
          new Date(block.timestamp).toLocaleString() + ' · nonce ' + block.nonce,
          'meta',
        );
        appendText(blockEl, 'p', 'Transactions: ' + block.transactions.length, 'meta');
        for (const tx of block.transactions) {
          const type = tx.type || 'transfer';
          const from = tx.fromAddress ? shortAddr(tx.fromAddress) : 'coinbase';
          const line = '[' + type + '] ' + from + ' → ' + shortAddr(tx.toAddress) + ' : ' + tx.amount;
          appendText(blockEl, 'p', line, 'tx');
        }
        appendText(blockEl, 'p', 'Hash: ' + block.hash, 'hash');
        appendText(blockEl, 'p', 'Previous: ' + block.previousHash, 'hash');
        chainEl.appendChild(blockEl);
      }
    }

    async function refresh() {
      const [chainRes, validateRes, mempoolRes] = await Promise.all([
        fetch('/chain'),
        fetch('/validate'),
        fetch('/transactions'),
      ]);
      const chainBody = await chainRes.json();
      const validateBody = await validateRes.json();
      const mempoolBody = await mempoolRes.json();

      statusEl.textContent = validateBody.valid ? 'Valid' : 'Invalid';
      statusEl.className = 'status ' + (validateBody.valid ? 'valid' : 'invalid');
      blockCountEl.textContent = String(chainBody.length);
      mempoolCountEl.textContent = String(mempoolBody.transactions.length);
      renderChain(chainBody.chain);
    }

    mineBtn.addEventListener('click', async () => {
      mineBtn.disabled = true;
      messageEl.textContent = 'Mining… (Proof of Work in progress)';
      const start = Date.now();

      try {
        const res = await fetch('/mine', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ minerAddress: config.minerAddress }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || 'Mining failed');
        messageEl.textContent = 'Mined block #' + body.block.index + ' in ' + (Date.now() - start) + 'ms';
        await refresh();
      } catch (error) {
        messageEl.textContent = error.message;
      } finally {
        mineBtn.disabled = false;
      }
    });

    refresh();
  </script>
</body>
</html>`;
}
