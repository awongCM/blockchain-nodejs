import { sha256, verifySignature } from '../core/CryptoUtils.js';

export class Transaction {
  /**
   * @param {object} params
   * @param {string|null} params.fromAddress
   * @param {string} params.toAddress
   * @param {number} params.amount
   * @param {number} [params.timestamp]
   * @param {string|null} [params.signature]
   */
  constructor({
    fromAddress,
    toAddress,
    amount,
    timestamp = Date.now(),
    signature = null,
  }) {
    this.fromAddress = fromAddress;
    this.toAddress = toAddress;
    this.amount = amount;
    this.timestamp = timestamp;
    this.signature = signature;
  }

  calculateHash() {
    const from = this.fromAddress ?? '';
    return sha256(`${from}|${this.toAddress}|${this.amount}|${this.timestamp}`);
  }

  /**
   * @param {import('./Wallet.js').Wallet} wallet
   */
  sign(wallet) {
    if (this.fromAddress === null) {
      throw new Error('Cannot sign coinbase transaction');
    }
    if (wallet.address !== this.fromAddress) {
      throw new Error('Cannot sign transaction for another wallet');
    }
    this.signature = wallet.sign(this.calculateHash());
  }

  isValid() {
    if (typeof this.amount !== 'number' || !Number.isInteger(this.amount) || !(this.amount > 0)) {
      return false;
    }
    if (!this.toAddress) {
      return false;
    }
    if (this.fromAddress === null) {
      return true;
    }
    if (!this.signature) {
      return false;
    }
    return verifySignature(
      this.fromAddress,
      this.calculateHash(),
      this.signature,
    );
  }

  toJSON() {
    return {
      fromAddress: this.fromAddress,
      toAddress: this.toAddress,
      amount: this.amount,
      timestamp: this.timestamp,
      signature: this.signature,
    };
  }
}
