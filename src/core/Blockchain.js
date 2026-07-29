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
      timestamp: 0,
      transactions: [],
      previousHash: '0',
    });
  }

  /**
   * Replace the local chain with a longer valid peer chain.
   * @param {Array<object|Block>} chainData
   * @returns {boolean}
   */
  replaceChain(chainData) {
    if (!Array.isArray(chainData) || chainData.length <= this.chain.length) {
      return false;
    }

    const candidate = chainData.map((block) =>
      typeof block?.calculateHash === 'function' ? block : Block.fromJSON(block),
    );

    const probe = new Blockchain({
      difficulty: this.difficulty,
      miningReward: this.miningReward,
    });
    probe.chain = candidate;

    if (!probe.isValidChain()) {
      return false;
    }

    this.chain = candidate;
    this.pendingTransactions = [];
    return true;
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

  validatePendingTransactions() {
    for (const tx of this.pendingTransactions) {
      if (!tx.isValid()) {
        throw new Error('Invalid pending transaction');
      }
    }

    const senders = new Set(
      this.pendingTransactions.map((tx) => tx.fromAddress),
    );
    for (const sender of senders) {
      if (this.getPendingSpend(sender) > this.getBalance(sender)) {
        throw new Error('Insufficient funds in pending transactions');
      }
    }
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

    this.validatePendingTransactions();

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

  /**
   * @param {import('../wallet/Transaction.js').Transaction[]} transactions
   * @returns {boolean}
   */
  validateBlockTransactions(transactions, { allowCoinbase = true } = {}) {
    let coinbaseCount = 0;

    for (let i = 0; i < transactions.length; i += 1) {
      const tx = transactions[i];

      if (tx.fromAddress === null) {
        if (!allowCoinbase) {
          return false;
        }
        coinbaseCount += 1;
        if (coinbaseCount > 1 || i !== 0) {
          return false;
        }
        if (tx.amount !== this.miningReward || !tx.isValid()) {
          return false;
        }
        continue;
      }

      if (!tx.isValid()) {
        return false;
      }
    }

    if (allowCoinbase) {
      if (transactions.length === 0 || coinbaseCount !== 1) {
        return false;
      }
    } else if (coinbaseCount > 0) {
      return false;
    }

    return true;
  }

  isValidChain() {
    if (this.chain.length === 0) {
      return false;
    }

    const target = '0'.repeat(this.difficulty);
    const balances = new Map();

    const applyTx = (tx, checkSpend) => {
      if (tx.fromAddress !== null && !tx.isValid()) {
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
        if (current.hash !== current.calculateHash()) {
          return false;
        }
        if (!this.validateBlockTransactions(current.transactions, {
          allowCoinbase: false,
        })) {
          return false;
        }
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
      if (!this.validateBlockTransactions(current.transactions, {
        allowCoinbase: true,
      })) {
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
