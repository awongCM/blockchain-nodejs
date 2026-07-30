import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { executeMethod } from '../src/contract/VirtualMachine.js';

const incCode = {
  inc: [
    ['load', 'n'],
    ['push', 1],
    ['add'],
    ['store', 'n'],
  ],
  payout: [
    ['push', 'recipient'],
    ['push', 5],
    ['transfer'],
  ],
};

describe('VirtualMachine', () => {
  it('increments storage via inc', () => {
    const result = executeMethod({
      code: incCode,
      storage: {},
      balance: 0,
      fromAddress: 'caller',
      amount: 0,
      method: 'inc',
      args: [],
    });
    assert.equal(result.storage.n, 1);
    assert.equal(result.balance, 0);
  });

  it('credits value then transfers from contract balance', () => {
    const result = executeMethod({
      code: {
        payout: [
          ['caller'],
          ['value'],
          ['transfer'],
        ],
      },
      storage: {},
      balance: 0,
      fromAddress: 'alice',
      amount: 10,
      method: 'payout',
      args: [],
    });
    assert.equal(result.balance, 0);
    assert.deepEqual(result.effects, [{ to: 'alice', amount: 10 }]);
  });

  it('throws when method missing', () => {
    assert.throws(
      () =>
        executeMethod({
          code: incCode,
          storage: {},
          balance: 0,
          fromAddress: 'x',
          amount: 0,
          method: 'nope',
          args: [],
        }),
      /method/i,
    );
  });

  it('rejects forbidden storage keys at runtime', () => {
    assert.throws(
      () =>
        executeMethod({
          code: {
            bad: [['push', 1], ['store', '__proto__']],
          },
          storage: {},
          balance: 0,
          fromAddress: 'x',
          amount: 0,
          method: 'bad',
          args: [],
        }),
      /method|invalid storage key/i,
    );
  });
});
