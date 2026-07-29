import { Blockchain } from '../core/Blockchain.js';
import { Block } from '../core/Block.js';
import { Transaction } from '../wallet/Transaction.js';

/**
 * Normalize a peer base URL (no trailing slash).
 * @param {string} url
 * @returns {string}
 */
export function normalizePeerUrl(url) {
  return String(url).trim().replace(/\/+$/, '');
}

export class LuckCoinNode {
  /**
   * @param {object} options
   * @param {import('../core/Blockchain.js').Blockchain} options.blockchain
   * @param {string} options.url Advertised base URL for this node
   * @param {(input: string, init?: RequestInit) => Promise<Response>} [options.fetchImpl]
   */
  constructor({ blockchain, url, fetchImpl = globalThis.fetch.bind(globalThis) }) {
    this.blockchain = blockchain;
    this.url = normalizePeerUrl(url);
    this.peers = new Set();
    this.fetchImpl = fetchImpl;
  }

  /**
   * @param {string} peerUrl
   */
  registerPeer(peerUrl) {
    const normalized = normalizePeerUrl(peerUrl);
    if (!normalized || normalized === this.url) {
      return;
    }
    this.peers.add(normalized);
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

    const hash = tx.calculateHash();
    if (
      this.blockchain.pendingTransactions.some(
        (pending) => pending.calculateHash() === hash,
      )
    ) {
      return false;
    }

    this.blockchain.addTransaction(tx);
    return true;
  }

  /**
   * @param {import('../wallet/Transaction.js').Transaction} tx
   */
  async broadcastTransaction(tx) {
    const body = JSON.stringify(tx.toJSON());
    await Promise.allSettled(
      [...this.peers].map((peer) =>
        this.fetchImpl(`${peer}/transactions`, {
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
        this.fetchImpl(`${peer}/blocks`, {
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
          const response = await this.fetchImpl(`${peer}/chain`);
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
          if (temp.isValidChain() && temp.chain.length > bestLength) {
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
