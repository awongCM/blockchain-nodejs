import { sha256, verifySignature } from '../core/CryptoUtils.js';

const METHOD_NAME = /^[a-zA-Z_][a-zA-Z0-9_]{0,31}$/;

function canonicalData(data) {
  if (data === null || data === undefined) {
    return '';
  }
  return JSON.stringify(data);
}

/**
 * @param {Record<string, unknown>} code
 * @returns {boolean}
 */
export function isValidCode(code) {
  if (!code || typeof code !== 'object' || Array.isArray(code)) {
    return false;
  }
  const methods = Object.keys(code);
  if (methods.length === 0 || methods.length > 16) {
    return false;
  }
  for (const name of methods) {
    if (!METHOD_NAME.test(name)) {
      return false;
    }
    const body = code[name];
    if (!Array.isArray(body) || body.length === 0 || body.length > 32) {
      return false;
    }
    for (const inst of body) {
      if (!Array.isArray(inst) || inst.length === 0 || typeof inst[0] !== 'string') {
        return false;
      }
    }
  }
  return true;
}

export class Transaction {
  /**
   * @param {object} params
   * @param {string|null} params.fromAddress
   * @param {string|null} params.toAddress
   * @param {number} params.amount
   * @param {number} [params.timestamp]
   * @param {string|null} [params.signature]
   * @param {'transfer'|'deploy'|'call'} [params.type]
   * @param {object|null} [params.data]
   */
  constructor({
    fromAddress,
    toAddress,
    amount,
    timestamp = Date.now(),
    signature = null,
    type = 'transfer',
    data = null,
  }) {
    this.fromAddress = fromAddress;
    this.toAddress = toAddress;
    this.amount = amount;
    this.timestamp = timestamp;
    this.signature = signature;
    this.type = type;
    this.data = data;
  }

  /**
   * @param {string} fromAddress
   * @param {number} timestamp
   * @param {Record<string, unknown[]>} code
   * @returns {string}
   */
  static deployAddress(fromAddress, timestamp, code) {
    return sha256(`${fromAddress}|${timestamp}|${JSON.stringify(code)}`);
  }

  calculateHash() {
    const from = this.fromAddress ?? '';
    const to = this.toAddress ?? '';
    return sha256(
      `${from}|${to}|${this.amount}|${this.timestamp}|${this.type}|${canonicalData(this.data)}`,
    );
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
    if (typeof this.amount !== 'number' || !Number.isInteger(this.amount)) {
      return false;
    }
    if (!['transfer', 'deploy', 'call'].includes(this.type)) {
      return false;
    }

    if (this.fromAddress === null) {
      return (
        this.type === 'transfer' &&
        this.data === null &&
        this.amount > 0 &&
        Boolean(this.toAddress)
      );
    }

    if (!this.signature) {
      return false;
    }

    if (this.type === 'transfer') {
      if (this.data !== null) {
        return false;
      }
      if (!(this.amount > 0) || !this.toAddress) {
        return false;
      }
    } else if (this.type === 'deploy') {
      if (this.amount < 0 || !this.toAddress || !this.data?.code) {
        return false;
      }
      if (!isValidCode(this.data.code)) {
        return false;
      }
      const expected = Transaction.deployAddress(
        this.fromAddress,
        this.timestamp,
        this.data.code,
      );
      if (this.toAddress !== expected) {
        return false;
      }
    } else if (this.type === 'call') {
      if (this.amount < 0 || !this.toAddress || !this.data?.method) {
        return false;
      }
      if (!METHOD_NAME.test(this.data.method)) {
        return false;
      }
      const args = this.data.args ?? [];
      if (!Array.isArray(args) || args.length > 8) {
        return false;
      }
      if (!args.every((a) => typeof a === 'number' || typeof a === 'string')) {
        return false;
      }
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
      type: this.type,
      data: this.data,
    };
  }

  /**
   * @param {object} data
   * @returns {Transaction}
   */
  static fromJSON(data) {
    return new Transaction({
      fromAddress: data.fromAddress ?? null,
      toAddress: data.toAddress ?? null,
      amount: data.amount,
      timestamp: data.timestamp,
      signature: data.signature ?? null,
      type: data.type ?? 'transfer',
      data: data.data ?? null,
    });
  }
}
