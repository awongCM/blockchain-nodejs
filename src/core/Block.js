import { sha256 } from './CryptoUtils.js';

export class Block {
  /**
   * @param {object} params
   * @param {number} params.index
   * @param {number} params.timestamp
   * @param {string} params.data
   * @param {string} params.previousHash
   * @param {number} [params.nonce=0]
   * @param {string} [params.hash='']
   */
  constructor({ index, timestamp, data, previousHash, nonce = 0, hash = '' }) {
    this.index = index;
    this.timestamp = timestamp;
    this.data = data;
    this.previousHash = previousHash;
    this.nonce = nonce;
    this.hash = hash || this.calculateHash();
  }

  /**
   * Serialize block fields into a deterministic string for hashing.
   * @returns {string}
   */
  getPayload() {
    return `${this.index}${this.timestamp}${this.data}${this.previousHash}${this.nonce}`;
  }

  /**
   * @returns {string}
   */
  calculateHash() {
    return sha256(this.getPayload());
  }

  /**
   * Mine this block until its hash meets the difficulty target.
   * @param {number} difficulty
   * @returns {this}
   */
  mine(difficulty) {
    const target = '0'.repeat(difficulty);

    while (!this.hash.startsWith(target)) {
      this.nonce += 1;
      this.hash = this.calculateHash();
    }

    return this;
  }

  /**
   * @returns {object}
   */
  toJSON() {
    return {
      index: this.index,
      timestamp: this.timestamp,
      data: this.data,
      previousHash: this.previousHash,
      nonce: this.nonce,
      hash: this.hash,
    };
  }
}
