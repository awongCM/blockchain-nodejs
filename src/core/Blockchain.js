import { Block } from './Block.js';
import { Transaction } from '../wallet/Transaction.js';

export class Blockchain {
  /**
   * @param {object} [options]
   * @param {number} [options.difficulty=4]
   * @param {number} [options.miningReward=100]
   */
  constructor({ difficulty = 4, miningReward = 100 } = {}) {
    this.difficulty = difficulty;
    this.miningReward = miningReward;
    this.pendingTransactions = [];
    this.chain = [this.createGenesisBlock()];
  }

  createGenesisBlock() {
    return new Block({
      index: 0,
      timestamp: Date.now(),
      transactions: [],
      previousHash: '0',
    });
  }

  getLatestBlock() {
    return this.chain[this.chain.length - 1];
  }

  getBalance(address) {
    let balance = 0;
    for (const block of this.chain) {
      for (const tx of block.transactions) {
        if (tx.fromAddress === address) {
          balance -= tx.amount;
        }
        if (tx.toAddress === address) {
          balance += tx.amount;
        }
      }
    }
    return balance;
  }

  getPendingSpend(address) {
    return this.pendingTransactions
      .filter((tx) => tx.fromAddress === address)
      .reduce((sum, tx) => sum + tx.amount, 0);
  }

  /**
   * @param {Transaction} transaction
   */
  addTransaction(transaction) {
    if (transaction.fromAddress === null) {
      throw new Error('Cannot add coinbase transaction to mempool');
    }
    if (!transaction.isValid()) {
      throw new Error('Invalid transaction');
    }
    const available =
      this.getBalance(transaction.fromAddress) -
      this.getPendingSpend(transaction.fromAddress);
    if (transaction.amount > available) {
      throw new Error('Insufficient funds');
    }
    this.pendingTransactions.push(transaction);
  }

  /**
   * @param {string} minerAddress
   * @returns {Block}
   */
  minePendingTransactions(minerAddress) {
    if (!minerAddress) {
      throw new Error('Miner address required');
    }

    const rewardTx = new Transaction({
      fromAddress: null,
      toAddress: minerAddress,
      amount: this.miningReward,
    });

    const transactions = [rewardTx, ...this.pendingTransactions];
    const previousBlock = this.getLatestBlock();
    const block = new Block({
      index: previousBlock.index + 1,
      timestamp: Date.now(),
      transactions,
      previousHash: previousBlock.hash,
    });
    block.mine(this.difficulty);
    this.chain.push(block);
    this.pendingTransactions = [];
    return block;
  }

  isValidChain() {
    if (this.chain.length === 0) {
      return false;
    }

    const target = '0'.repeat(this.difficulty);
    const balances = new Map();

    const applyTx = (tx, checkSpend) => {
      if (!tx.isValid()) {
        return false;
      }
      if (tx.fromAddress !== null) {
        const fromBal = balances.get(tx.fromAddress) ?? 0;
        if (checkSpend && tx.amount > fromBal) {
          return false;
        }
        balances.set(tx.fromAddress, fromBal - tx.amount);
      }
      const toBal = balances.get(tx.toAddress) ?? 0;
      balances.set(tx.toAddress, toBal + tx.amount);
      return true;
    };

    for (let i = 0; i < this.chain.length; i += 1) {
      const current = this.chain[i];

      if (i === 0) {
        for (const tx of current.transactions) {
          if (!applyTx(tx, true)) {
            return false;
          }
        }
        continue;
      }

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

      for (const tx of current.transactions) {
        if (!applyTx(tx, true)) {
          return false;
        }
      }
    }

    return true;
  }

  toJSON() {
    return this.chain.map((block) => block.toJSON());
  }
}
