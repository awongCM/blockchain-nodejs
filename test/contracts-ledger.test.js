import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Blockchain } from '../src/core/Blockchain.js';
import { Wallet } from '../src/wallet/Wallet.js';
import { Transaction } from '../src/wallet/Transaction.js';

const INC = {
  inc: [
    ['load', 'n'],
    ['push', 1],
    ['add'],
    ['store', 'n'],
  ],
};

function deployTx(wallet, code, amount = 0, timestamp = 1_700_000_000_001) {
  const toAddress = Transaction.deployAddress(wallet.address, timestamp, code);
  const tx = new Transaction({
    fromAddress: wallet.address,
    toAddress,
    amount,
    timestamp,
    type: 'deploy',
    data: { code },
  });
  tx.sign(wallet);
  return tx;
}

describe('Contracts ledger', () => {
  it('deploys a contract and exposes code via getContract', () => {
    const chain = new Blockchain({ difficulty: 2 });
    const alice = Wallet.create();
    chain.minePendingTransactions(alice.address);
    const tx = deployTx(alice, INC, 0, 1_700_000_000_010);
    chain.addTransaction(tx);
    chain.minePendingTransactions(alice.address);
    const contract = chain.getContract(tx.toAddress);
    assert.ok(contract);
    assert.deepEqual(contract.code, INC);
    assert.deepEqual(contract.storage, {});
    assert.equal(contract.balance, 0);
  });

  it('calls a method and persists storage', () => {
    const chain = new Blockchain({ difficulty: 2 });
    const alice = Wallet.create();
    chain.minePendingTransactions(alice.address);
    const deploy = deployTx(alice, INC, 0, 1_700_000_000_020);
    chain.addTransaction(deploy);
    chain.minePendingTransactions(alice.address);

    const call = new Transaction({
      fromAddress: alice.address,
      toAddress: deploy.toAddress,
      amount: 0,
      type: 'call',
      data: { method: 'inc', args: [] },
    });
    call.sign(alice);
    chain.addTransaction(call);
    chain.minePendingTransactions(alice.address);

    assert.equal(chain.getContract(deploy.toAddress).storage.n, 1);
    assert.equal(chain.isValidChain(), true);
  });

  it('rejects call to missing contract', () => {
    const chain = new Blockchain({ difficulty: 2 });
    const alice = Wallet.create();
    chain.minePendingTransactions(alice.address);
    const call = new Transaction({
      fromAddress: alice.address,
      toAddress: 'ab'.repeat(32),
      amount: 0,
      type: 'call',
      data: { method: 'inc', args: [] },
    });
    call.sign(alice);
    assert.throws(() => chain.addTransaction(call), /contract/i);
  });
});
