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

const PAYOUT = {
  payout: [
    ['caller'],
    ['push', 10],
    ['transfer'],
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
    assert.equal(Object.keys(contract.storage).length, 0);
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

  it('applyTransaction rejects duplicate deploy to the same address', () => {
    const chain = new Blockchain({ difficulty: 2 });
    const alice = Wallet.create();
    const tx = deployTx(alice, INC, 0, 1_700_000_000_030);
    const balances = new Map();
    const contracts = new Map();
    chain.applyTransaction(tx, balances, contracts);
    assert.throws(
      () => chain.applyTransaction(tx, balances, contracts),
      /already exists/i,
    );
  });

  it('applies VM transfer effects to recipient balances', () => {
    const chain = new Blockchain({ difficulty: 2 });
    const alice = Wallet.create();
    const bob = Wallet.create();
    chain.minePendingTransactions(alice.address);

    const deploy = deployTx(alice, PAYOUT, 50, 1_700_000_000_040);
    chain.addTransaction(deploy);
    chain.minePendingTransactions(alice.address);

    const call = new Transaction({
      fromAddress: alice.address,
      toAddress: deploy.toAddress,
      amount: 0,
      type: 'call',
      data: { method: 'payout', args: [] },
    });
    call.sign(alice);
    chain.addTransaction(call);
    chain.minePendingTransactions(alice.address);

    assert.equal(chain.getContract(deploy.toAddress).balance, 40);
    assert.equal(chain.getBalance(bob.address), 0);
    assert.equal(chain.getBalance(alice.address), 260);
  });

  it('rejects call when VM transfer exceeds contract balance', () => {
    const chain = new Blockchain({ difficulty: 2 });
    const alice = Wallet.create();
    chain.minePendingTransactions(alice.address);

    const deploy = deployTx(alice, PAYOUT, 5, 1_700_000_000_050);
    chain.addTransaction(deploy);
    chain.minePendingTransactions(alice.address);

    const call = new Transaction({
      fromAddress: alice.address,
      toAddress: deploy.toAddress,
      amount: 0,
      type: 'call',
      data: { method: 'payout', args: [] },
    });
    call.sign(alice);
    assert.throws(
      () => chain.addTransaction(call),
      /insufficient contract balance/i,
    );
  });

  it('getContract returns null when chain replay fails', () => {
    const chain = new Blockchain({ difficulty: 2 });
    const alice = Wallet.create();
    const bob = Wallet.create();
    chain.minePendingTransactions(alice.address);
    const overspend = new Transaction({
      fromAddress: alice.address,
      toAddress: bob.address,
      amount: 101,
    });
    overspend.sign(alice);
    chain.chain[1].transactions.push(overspend);
    assert.equal(chain.getContract('ab'.repeat(32)), null);
    assert.throws(() => chain.getBalance(alice.address), /invalid chain state/i);
    assert.deepEqual(chain.listContracts(), []);
  });
});
