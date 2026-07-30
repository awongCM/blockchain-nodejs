import { createServer } from 'node:http';
import { Blockchain } from './core/Blockchain.js';
import { Wallet } from './wallet/Wallet.js';
import { LuckCoinNode, normalizePeerUrl } from './network/Node.js';
import {
  handleLuckCoinApiRequest,
  sendJson,
} from './network/HttpServer.js';
import { renderDashboardPage } from './dashboard/page.js';

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';
const rawDifficulty = Number(process.env.LUCKCOIN_DIFFICULTY ?? 4);
const DIFFICULTY =
  Number.isFinite(rawDifficulty) && rawDifficulty > 0 ? rawDifficulty : 4;

const blockchain = new Blockchain({ difficulty: DIFFICULTY });
const minerWallet = Wallet.create();
const advertised =
  process.env.LUCKCOIN_URL ?? `http://127.0.0.1:${PORT}`;

const node = new LuckCoinNode({
  blockchain,
  url: normalizePeerUrl(advertised),
});

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if ((req.method ?? 'GET').toUpperCase() === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(
      renderDashboardPage({
        difficulty: DIFFICULTY,
        minerAddress: minerWallet.address,
      }),
    );
    return;
  }

  const handled = await handleLuckCoinApiRequest(node, req, res);
  if (!handled) {
    sendJson(res, 404, { error: 'Not found' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`🐱 LuckCoin dashboard listening on http://${HOST}:${PORT}`);
  console.log(`   Difficulty: ${DIFFICULTY}`);
  console.log(`   Demo miner: ${minerWallet.address.slice(0, 16)}…`);
  console.log('   JSON API: /chain /mine /transactions /validate /health');
});
