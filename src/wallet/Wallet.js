import { generateKeyPair, signHash } from '../core/CryptoUtils.js';

export class Wallet {
  constructor(privateKey, address) {
    Object.defineProperty(this, 'privateKey', {
      value: privateKey,
      enumerable: false,
      writable: false,
    });
    this.address = address;
  }

  static create() {
    const { privateKey, address } = generateKeyPair();
    return new Wallet(privateKey, address);
  }

  /**
   * @param {string} hash
   * @returns {string}
   */
  sign(hash) {
    return signHash(this.privateKey, hash);
  }
}
