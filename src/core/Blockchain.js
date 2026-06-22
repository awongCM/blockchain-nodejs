import { Block } from './Block.js';

const GENESIS_DATA = 'LuckCoin Genesis — Maneki-neko welcomes you 🐱';

export class Blockchain {
  /**
   * @param {object} [options]
   * @param {number} [options.difficulty=4]
   */
  constructor({ difficulty = 4 } = {}) {
    this.difficulty = difficulty;
    this.chain = [this.createGenesisBlock()];
  }

  /**
   * @returns {Block}
   */
  createGenesisBlock() {
    return new Block({
      index: 0,
      timestamp: Date.now(),
      data: GENESIS_DATA,
      previousHash: '0',
    });
  }

  /**
   * @returns {Block}
   */
  getLatestBlock() {
    return this.chain[this.chain.length - 1];
  }

  /**
   * Create and mine a new block linked to the current chain tip.
   * @param {string} data
   * @returns {Block}
   */
  addBlock(data) {
    const previousBlock = this.getLatestBlock();
    const block = new Block({
      index: previousBlock.index + 1,
      timestamp: Date.now(),
      data,
      previousHash: previousBlock.hash,
    });

    block.mine(this.difficulty);
    this.chain.push(block);
    return block;
  }

  /**
   * Verify hash integrity, linkage, and Proof of Work for every block.
   * @returns {boolean}
   */
  isValidChain() {
    if (this.chain.length === 0) {
      return false;
    }

    const target = '0'.repeat(this.difficulty);

    for (let i = 1; i < this.chain.length; i += 1) {
      const current = this.chain[i];
      const previous = this.chain[i - 1];

      if (current.hash !== current.calculateHash()) {
        return false;
      }

      if (current.previousHash !== previous.hash) {
        return false;
      }

      if (!current.hash.startsWith(target)) {
        return false;
      }
    }

    return true;
  }

  /**
   * @returns {object[]}
   */
  toJSON() {
    return this.chain.map((block) => block.toJSON());
  }
}
