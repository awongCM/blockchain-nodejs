import { createServer } from 'node:http';
import {
  LuckCoinNode,
  normalizePeerUrl,
  readJsonBody,
  isAllowedPeerUrl,
} from './Node.js';

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {object} payload
 */
function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

/**
 * Start the LuckCoin HTTP API.
 *
 * @param {object} options
 * @param {LuckCoinNode} options.node
 * @param {number} [options.port]
 * @param {string} [options.host='0.0.0.0']
 * @returns {Promise<{ server: import('node:http').Server, port: number, host: string, close: () => Promise<void> }>}
 */
export function startHttpServer({
  node,
  port = Number(process.env.PORT ?? process.env.LUCKCOIN_PORT ?? 3001),
  host = '0.0.0.0',
}) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const { pathname } = url;
      const method = (req.method ?? 'GET').toUpperCase();

      if (method === 'GET' && pathname === '/') {
        sendJson(res, 200, {
          name: 'LuckCoin',
          phase: 4,
          url: node.url,
          peers: [...node.peers],
          length: node.blockchain.chain.length,
        });
        return;
      }

      if (method === 'GET' && pathname === '/contracts') {
        sendJson(res, 200, {
          contracts: node.blockchain.listContracts(),
        });
        return;
      }

      const contractMatch = pathname.match(/^\/contracts\/([0-9a-fA-F]+)$/);
      if (method === 'GET' && contractMatch) {
        const contract = node.blockchain.getContract(
          contractMatch[1].toLowerCase(),
        );
        if (!contract) {
          sendJson(res, 404, { error: 'Contract not found' });
          return;
        }
        sendJson(res, 200, contract);
        return;
      }

      if (method === 'GET' && pathname === '/chain') {
        sendJson(res, 200, {
          chain: node.blockchain.toJSON(),
          length: node.blockchain.chain.length,
        });
        return;
      }

      if (method === 'GET' && pathname === '/transactions') {
        sendJson(res, 200, {
          transactions: node.blockchain.pendingTransactions.map((tx) =>
            tx.toJSON(),
          ),
        });
        return;
      }

      if (method === 'POST' && pathname === '/transactions') {
        const body = await readJsonBody(req);
        const added = node.receiveTransaction(body);
        const origin = req.headers['x-luckcoin-origin'];
        if (added && origin !== node.url) {
          const tx = node.blockchain.pendingTransactions.at(-1);
          if (tx) {
            await node.broadcastTransaction(tx);
          }
        }
        sendJson(res, added ? 201 : 200, {
          message: added ? 'Transaction added' : 'Transaction already known',
        });
        return;
      }

      if (method === 'POST' && pathname === '/mine') {
        const body = await readJsonBody(req);
        const minerAddress = body.minerAddress;
        if (!minerAddress || typeof minerAddress !== 'string') {
          sendJson(res, 400, { error: 'minerAddress required' });
          return;
        }
        const block = node.blockchain.minePendingTransactions(minerAddress);
        await node.broadcastBlock(block);
        sendJson(res, 200, { block: block.toJSON() });
        return;
      }

      if (method === 'POST' && pathname === '/blocks') {
        const body = await readJsonBody(req);
        const accepted = node.receiveBlock(body);
        if (!accepted) {
          sendJson(res, 409, { error: 'Block rejected' });
          return;
        }
        sendJson(res, 200, { message: 'Block accepted' });
        return;
      }

      if (method === 'GET' && pathname.startsWith('/balance/')) {
        const address = decodeURIComponent(pathname.slice('/balance/'.length));
        if (!address) {
          sendJson(res, 400, { error: 'address required' });
          return;
        }
        let balance;
        try {
          balance = node.blockchain.getBalance(address);
        } catch {
          sendJson(res, 503, { error: 'Invalid chain state' });
          return;
        }
        sendJson(res, 200, {
          address,
          balance,
        });
        return;
      }

      if (method === 'GET' && pathname === '/nodes') {
        sendJson(res, 200, { nodes: [...node.peers] });
        return;
      }

      if (method === 'POST' && pathname === '/nodes/register') {
        const body = await readJsonBody(req);
        const list = Array.isArray(body.nodes)
          ? body.nodes
          : body.node
            ? [body.node]
            : [];
        const rejected = [];
        for (const peer of list) {
          if (!node.registerPeer(peer)) {
            rejected.push(peer);
          }
        }
        sendJson(res, 200, {
          nodes: [...node.peers],
          rejected,
        });
        return;
      }

      if (
        (method === 'GET' || method === 'POST') &&
        pathname === '/nodes/resolve'
      ) {
        const result = await node.resolveConflicts();
        sendJson(res, 200, result);
        return;
      }

      sendJson(res, 404, { error: 'Not found' });
    } catch (error) {
      if (error instanceof Error && error.code === 'PAYLOAD_TOO_LARGE') {
        sendJson(res, 413, { error: 'Payload too large' });
        return;
      }
      const message = error instanceof Error ? error.message : 'Bad request';
      sendJson(res, 400, { error: message });
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const address = server.address();
      const boundPort =
        typeof address === 'object' && address ? address.port : port;
      resolve({
        server,
        port: boundPort,
        host,
        close: () =>
          new Promise((closeResolve, closeReject) => {
            server.close((err) => (err ? closeReject(err) : closeResolve()));
          }),
      });
    });
  });
}

/**
 * Convenience: create node + server.
 * @param {object} options
 * @param {import('../core/Blockchain.js').Blockchain} options.blockchain
 * @param {string} [options.url]
 * @param {number} [options.port]
 * @param {string} [options.host]
 */
export async function createNodeServer({
  blockchain,
  url,
  port,
  host = '0.0.0.0',
}) {
  const resolvedPort = port ?? Number(process.env.PORT ?? process.env.LUCKCOIN_PORT ?? 3001);
  const advertised =
    url ??
    process.env.LUCKCOIN_URL ??
    `http://127.0.0.1:${resolvedPort === 0 ? '0' : resolvedPort}`;

  const node = new LuckCoinNode({
    blockchain,
    url: normalizePeerUrl(advertised),
  });

  const listening = await startHttpServer({ node, port: resolvedPort, host });

  if (!url && !process.env.LUCKCOIN_URL) {
    node.url = `http://127.0.0.1:${listening.port}`;
  }

  return { node, ...listening };
}

export { isAllowedPeerUrl };
