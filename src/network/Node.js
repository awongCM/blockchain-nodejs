import { Blockchain } from '../core/Blockchain.js';
import { Block } from '../core/Block.js';
import { Transaction } from '../wallet/Transaction.js';

export const MAX_PEERS = 32;
export const FETCH_TIMEOUT_MS = 5000;
const MAX_BODY_BYTES = 1024 * 1024;

/**
 * Normalize a peer base URL (no trailing slash).
 * @param {string} url
 * @returns {string}
 */
export function normalizePeerUrl(url) {
  return String(url).trim().replace(/\/+$/, '');
}

/**
 * @param {string} url
 * @returns {boolean}
 */
export function isAllowedPeerUrl(url) {
  try {
    const parsed = new URL(normalizePeerUrl(url));
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    if (parsed.username || parsed.password) {
      return false;
    }

    const host = parsed.hostname.toLowerCase();
    if (host === 'localhost' || host === '::1' || host.endsWith('.localhost')) {
      return true;
    }
    if (host === '169.254.169.254') {
      return false;
    }

    const ipv4Match = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (ipv4Match) {
      const [, a, b] = ipv4Match.map(Number);
      if (a === 127) {
        return true;
      }
      if (a === 10) {
        return true;
      }
      if (a === 192 && b === 168) {
        return true;
      }
      if (a === 172 && b >= 16 && b <= 31) {
        return true;
      }
      return false;
    }

    // Non-IP hostnames are blocked for the PoC to avoid SSRF to internal DNS names.
    return false;
  } catch {
    return false;
  }
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @param {number} [maxBytes]
 * @returns {Promise<any>}
 */
export async function readJsonBody(req, maxBytes = MAX_BODY_BYTES) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      const error = new Error('Payload too large');
      error.code = 'PAYLOAD_TOO_LARGE';
      throw error;
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) {
    return {};
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) {
    return {};
  }
  return JSON.parse(raw);
}

export class LuckCoinNode {
  /**
   * @param {object} options
   * @param {import('../core/Blockchain.js').Blockchain} options.blockchain
   * @param {string} options.url Advertised base URL for this node
   * @param {(input: string, init?: RequestInit) => Promise<Response>} [options.fetchImpl]
   * @param {number} [options.fetchTimeoutMs]
   */
  constructor({
    blockchain,
    url,
    fetchImpl = globalThis.fetch.bind(globalThis),
    fetchTimeoutMs = FETCH_TIMEOUT_MS,
  }) {
    this.blockchain = blockchain;
    this.url = normalizePeerUrl(url);
    this.peers = new Set();
    this.fetchImpl = fetchImpl;
    this.fetchTimeoutMs = fetchTimeoutMs;
  }

  /**
   * @param {string} peerUrl
   * @param {RequestInit} [init]
   */
  fetchPeer(peerUrl, init = {}) {
    return this.fetchImpl(peerUrl, {
      ...init,
      signal: AbortSignal.timeout(this.fetchTimeoutMs),
    });
  }

  /**
   * @param {string} peerUrl
   * @returns {boolean}
   */
  registerPeer(peerUrl) {
    const normalized = normalizePeerUrl(peerUrl);
    if (!normalized || normalized === this.url) {
      return false;
    }
    if (!isAllowedPeerUrl(normalized)) {
      return false;
    }
    if (this.peers.size >= MAX_PEERS && !this.peers.has(normalized)) {
      return false;
    }
    this.peers.add(normalized);
    return true;
  }

  /**
   * Try to append a block that extends the local tip.
   * @param {object|import('../core/Block.js').Block} blockData
   * @returns {boolean}
   */
  receiveBlock(blockData) {
    const block =
      typeof blockData?.calculateHash === 'function'
        ? blockData
        : Block.fromJSON(blockData);

    const tip = this.blockchain.getLatestBlock();
    if (block.previousHash !== tip.hash || block.index !== tip.index + 1) {
      return false;
    }

    this.blockchain.chain.push(block);
    if (!this.blockchain.isValidChain()) {
      this.blockchain.chain.pop();
      return false;
    }

    const included = new Set(
      block.transactions.map((tx) => tx.calculateHash()),
    );
    this.blockchain.pendingTransactions =
      this.blockchain.pendingTransactions.filter(
        (tx) => !included.has(tx.calculateHash()),
      );

    return true;
  }

  /**
   * @param {import('../wallet/Transaction.js').Transaction|object} txData
   * @returns {boolean} true if newly added
   */
  receiveTransaction(txData) {
    const tx =
      typeof txData?.calculateHash === 'function'
        ? txData
        : Transaction.fromJSON(txData);

    try {
      this.blockchain.addTransaction(tx);
      return true;
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === 'Transaction already pending' ||
          error.message === 'Transaction already mined')
      ) {
        return false;
      }
      throw error;
    }
  }

  /**
   * @param {import('../wallet/Transaction.js').Transaction} tx
   */
  async broadcastTransaction(tx) {
    const body = JSON.stringify(tx.toJSON());
    await Promise.allSettled(
      [...this.peers].map((peer) =>
        this.fetchPeer(`${peer}/transactions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-luckcoin-origin': this.url,
          },
          body,
        }),
      ),
    );
  }

  /**
   * @param {import('../core/Block.js').Block} block
   */
  async broadcastBlock(block) {
    const body = JSON.stringify(block.toJSON());
    await Promise.allSettled(
      [...this.peers].map((peer) =>
        this.fetchPeer(`${peer}/blocks`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-luckcoin-origin': this.url,
          },
          body,
        }),
      ),
    );
  }

  /**
   * Pull peer chains and adopt the longest valid one.
   * @returns {Promise<{ replaced: boolean, length: number }>}
   */
  async resolveConflicts() {
    let bestChain = null;
    let bestLength = this.blockchain.chain.length;

    await Promise.all(
      [...this.peers].map(async (peer) => {
        try {
          const response = await this.fetchPeer(`${peer}/chain`);
          if (!response.ok) {
            return;
          }
          const payload = await response.json();
          const chain = payload.chain ?? payload;
          if (!Array.isArray(chain) || chain.length <= bestLength) {
            return;
          }

          const temp = new Blockchain({
            difficulty: this.blockchain.difficulty,
            miningReward: this.blockchain.miningReward,
          });
          temp.chain = chain.map((block) => Block.fromJSON(block));
          if (
            temp.chain[0].hash === this.blockchain.chain[0].hash &&
            temp.isValidChain() &&
            temp.chain.length > bestLength
          ) {
            bestLength = temp.chain.length;
            bestChain = chain;
          }
        } catch {
          // Ignore unreachable / malformed peers.
        }
      }),
    );

    if (!bestChain) {
      return { replaced: false, length: this.blockchain.chain.length };
    }

    const replaced = this.blockchain.replaceChain(bestChain);
    return { replaced, length: this.blockchain.chain.length };
  }
}
