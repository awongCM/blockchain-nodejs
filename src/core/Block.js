import { sha256 } from './CryptoUtils.js';
import { Transaction } from '../wallet/Transaction.js';

export class Block {
  /**
   * @param {object} params
   * @param {number} params.index
   * @param {number} params.timestamp
   * @param {import('../wallet/Transaction.js').Transaction[]} [params.transactions]
   * @param {string} params.previousHash
   * @param {number} [params.nonce=0]
   * @param {string} [params.hash='']
   */
  constructor({
    index,
    timestamp,
    transactions = [],
    previousHash,
    nonce = 0,
    hash = '',
  }) {
    this.index = index;
    this.timestamp = timestamp;
    this.transactions = transactions;
    this.previousHash = previousHash;
    this.nonce = nonce;
    this.hash = hash || this.calculateHash();
  }

  getPayload() {
    const txHashes = this.transactions
      .map((tx) => tx.calculateHash())
      .join('');
    return `${this.index}${this.timestamp}${txHashes}${this.previousHash}${this.nonce}`;
  }

  calculateHash() {
    return sha256(this.getPayload());
  }

  mine(difficulty) {
    const target = '0'.repeat(difficulty);
    while (!this.hash.startsWith(target)) {
      this.nonce += 1;
      this.hash = this.calculateHash();
    }
    return this;
  }

  toJSON() {
    return {
      index: this.index,
      timestamp: this.timestamp,
      transactions: this.transactions.map((tx) =>
        typeof tx.toJSON === 'function' ? tx.toJSON() : tx,
      ),
      previousHash: this.previousHash,
      nonce: this.nonce,
      hash: this.hash,
    };
  }

  /**
   * @param {object} data
   * @returns {Block}
   */
  static fromJSON(data) {
    return new Block({
      index: data.index,
      timestamp: data.timestamp,
      transactions: (data.transactions ?? []).map((tx) =>
        typeof tx?.calculateHash === 'function' ? tx : Transaction.fromJSON(tx),
      ),
      previousHash: data.previousHash,
      nonce: data.nonce ?? 0,
      hash: data.hash ?? '',
    });
  }
}
