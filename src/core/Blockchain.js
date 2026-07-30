import { Block } from './Block.js';
import { Transaction, isValidCode } from '../wallet/Transaction.js';
import { ContractAccount } from '../contract/ContractAccount.js';
import { executeMethod } from '../contract/VirtualMachine.js';

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

    if (candidate[0].hash !== this.chain[0].hash) {
      return false;
    }

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

  /**
   * @param {Transaction} transaction
   * @returns {boolean}
   */
  hasTransactionInChain(transaction) {
    const hash = transaction.calculateHash();
    for (const block of this.chain) {
      for (const tx of block.transactions) {
        if (tx.calculateHash() === hash) {
          return true;
        }
      }
    }
    return false;
  }

  getLatestBlock() {
    return this.chain[this.chain.length - 1];
  }

  /**
   * @param {Map<string, ContractAccount>} contracts
   * @returns {Map<string, ContractAccount>}
   */
  static cloneContracts(contracts) {
    const copy = new Map();
    for (const [address, contract] of contracts) {
      copy.set(
        address,
        new ContractAccount({
          address: contract.address,
          code: contract.code,
          storage: { ...contract.storage },
        }),
      );
    }
    return copy;
  }

  /**
   * Apply one transaction to mutable balance/contract maps.
   * @param {Transaction} tx
   * @param {Map<string, number>} balances
   * @param {Map<string, ContractAccount>} contracts
   */
  applyTransaction(tx, balances, contracts) {
    const type = tx.type ?? 'transfer';

    if (tx.fromAddress === null) {
      if (type !== 'transfer' || tx.data !== null) {
        throw new Error('Invalid coinbase transaction');
      }
      if (typeof tx.amount !== 'number' || !(tx.amount > 0) || !tx.toAddress) {
        throw new Error('Invalid coinbase transaction');
      }
      balances.set(tx.toAddress, (balances.get(tx.toAddress) ?? 0) + tx.amount);
      return;
    }

    if (!tx.isValid()) {
      throw new Error('Invalid transaction');
    }

    if (type === 'transfer') {
      const fromBal = balances.get(tx.fromAddress) ?? 0;
      if (tx.amount > fromBal) {
        throw new Error('Insufficient funds');
      }
      balances.set(tx.fromAddress, fromBal - tx.amount);
      balances.set(tx.toAddress, (balances.get(tx.toAddress) ?? 0) + tx.amount);
      return;
    }

    if (type === 'deploy') {
      if (!isValidCode(tx.data?.code)) {
        throw new Error('Invalid contract code');
      }
      if (contracts.has(tx.toAddress)) {
        throw new Error('Contract already exists');
      }
      const fromBal = balances.get(tx.fromAddress) ?? 0;
      if (tx.amount > fromBal) {
        throw new Error('Insufficient funds');
      }
      balances.set(tx.fromAddress, fromBal - tx.amount);
      contracts.set(
        tx.toAddress,
        new ContractAccount({
          address: tx.toAddress,
          code: tx.data.code,
          storage: {},
        }),
      );
      balances.set(tx.toAddress, (balances.get(tx.toAddress) ?? 0) + tx.amount);
      return;
    }

    if (type === 'call') {
      const contract = contracts.get(tx.toAddress);
      if (!contract) {
        throw new Error('Unknown contract');
      }
      const fromBal = balances.get(tx.fromAddress) ?? 0;
      if (tx.amount > fromBal) {
        throw new Error('Insufficient funds');
      }
      balances.set(tx.fromAddress, fromBal - tx.amount);

      const result = executeMethod({
        code: contract.code,
        storage: contract.storage,
        balance: balances.get(tx.toAddress) ?? 0,
        fromAddress: tx.fromAddress,
        amount: tx.amount,
        method: tx.data.method,
        args: tx.data.args ?? [],
      });

      contract.storage = result.storage;
      balances.set(tx.toAddress, result.balance);
      for (const effect of result.effects) {
        balances.set(effect.to, (balances.get(effect.to) ?? 0) + effect.amount);
      }
      return;
    }

    throw new Error(`Unknown transaction type: ${type}`);
  }

  /**
   * @param {object} [options]
   * @param {boolean} [options.includePending=false]
   * @returns {{ balances: Map<string, number>, contracts: Map<string, ContractAccount> }}
   */
  replayState({ includePending = false } = {}) {
    /** @type {Map<string, number>} */
    const balances = new Map();
    /** @type {Map<string, ContractAccount>} */
    const contracts = new Map();

    for (const block of this.chain) {
      for (const tx of block.transactions) {
        this.applyTransaction(tx, balances, contracts);
      }
    }

    if (includePending) {
      for (const tx of this.pendingTransactions) {
        this.applyTransaction(tx, balances, contracts);
      }
    }

    return { balances, contracts };
  }

  getBalance(address) {
    const { balances } = this.replayState();
    return balances.get(address) ?? 0;
  }

  /**
   * @param {string} address
   * @returns {{ address: string, code: object, storage: object, balance: number } | null}
   */
  getContract(address) {
    const { balances, contracts } = this.replayState();
    const contract = contracts.get(address);
    if (!contract) {
      return null;
    }
    return {
      ...contract.toJSON(),
      balance: balances.get(address) ?? 0,
    };
  }

  /**
   * @returns {string[]}
   */
  listContracts() {
    const { contracts } = this.replayState();
    return [...contracts.keys()].sort();
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

    const { balances, contracts } = this.replayState();
    const workingBalances = new Map(balances);
    const workingContracts = Blockchain.cloneContracts(contracts);

    for (const tx of this.pendingTransactions) {
      this.applyTransaction(tx, workingBalances, workingContracts);
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
    const hash = transaction.calculateHash();
    if (this.hasTransactionInChain(transaction)) {
      throw new Error('Transaction already mined');
    }
    if (
      this.pendingTransactions.some(
        (pending) => pending.calculateHash() === hash,
      )
    ) {
      throw new Error('Transaction already pending');
    }

    const { balances, contracts } = this.replayState();
    const workingBalances = new Map(balances);
    const workingContracts = Blockchain.cloneContracts(contracts);

    for (const pending of this.pendingTransactions) {
      this.applyTransaction(pending, workingBalances, workingContracts);
    }

    this.applyTransaction(transaction, workingBalances, workingContracts);
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
    /** @type {Map<string, number>} */
    const balances = new Map();
    /** @type {Map<string, ContractAccount>} */
    const contracts = new Map();

    for (let i = 0; i < this.chain.length; i += 1) {
      const current = this.chain[i];

      if (i === 0) {
        if (current.index !== 0 || current.previousHash !== '0') {
          return false;
        }
        if (current.hash !== current.calculateHash()) {
          return false;
        }
        if (
          !this.validateBlockTransactions(current.transactions, {
            allowCoinbase: false,
          })
        ) {
          return false;
        }
        try {
          for (const tx of current.transactions) {
            this.applyTransaction(tx, balances, contracts);
          }
        } catch {
          return false;
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
      if (
        !this.validateBlockTransactions(current.transactions, {
          allowCoinbase: true,
        })
      ) {
        return false;
      }

      try {
        for (const tx of current.transactions) {
          this.applyTransaction(tx, balances, contracts);
        }
      } catch {
        return false;
      }
    }

    return true;
  }

  toJSON() {
    return this.chain.map((block) => block.toJSON());
  }
}
