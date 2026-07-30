export class ContractAccount {
  /**
   * @param {object} params
   * @param {string} params.address
   * @param {Record<string, any[][]>} params.code
   * @param {Record<string, number|string>} [params.storage]
   */
  constructor({ address, code, storage = {} }) {
    this.address = address;
    this.code = code;
    this.storage = storage;
  }

  toJSON() {
    return {
      address: this.address,
      code: this.code,
      storage: this.storage,
    };
  }
}
