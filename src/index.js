import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { Blockchain } from './core/Blockchain.js';
import { Wallet } from './wallet/Wallet.js';
import { Transaction } from './wallet/Transaction.js';

const BANNER = `
  🐱 LuckCoin — Phase 2
  ─────────────────────
  Wallets, signed transactions, and mining rewards.
`;

const HELP = `
Commands:
  wallet create [name]     Create an in-memory wallet
  wallets                  List session wallets
  send <from> <to> <amt>   Sign and enqueue a transfer
  pending                  Show mempool
  mine <miner>             Mine coinbase + pending txs
  balance <name|address>   Show chain balance
  chain                    Show the full blockchain
  validate                 Check chain integrity
  help                     Show this help message
  exit                     Quit
`;

/** @type {Map<string, Wallet>} */
const walletsByName = new Map();
/** @type {Map<string, Wallet>} */
const walletsByAddress = new Map();

function registerWallet(name, wallet) {
  walletsByName.set(name, wallet);
  walletsByAddress.set(wallet.address, wallet);
}

function resolveWallet(nameOrAddress) {
  return (
    walletsByName.get(nameOrAddress) ||
    walletsByAddress.get(nameOrAddress) ||
    null
  );
}

function resolveAddress(nameOrAddress) {
  const wallet = resolveWallet(nameOrAddress);
  if (wallet) {
    return wallet.address;
  }
  if (/^[0-9a-f]+$/i.test(nameOrAddress) && nameOrAddress.length > 80) {
    return nameOrAddress.toLowerCase();
  }
  return null;
}

function shortAddr(address) {
  return `${address.slice(0, 10)}…${address.slice(-8)}`;
}

function printChain(blockchain) {
  for (const block of blockchain.chain) {
    console.log('');
    console.log(`Block #${block.index}`);
    console.log(`  Timestamp:     ${new Date(block.timestamp).toISOString()}`);
    console.log(`  Previous hash: ${block.previousHash}`);
    console.log(`  Nonce:         ${block.nonce}`);
    console.log(`  Hash:          ${block.hash}`);
    console.log(`  Transactions:  ${block.transactions.length}`);
    for (const tx of block.transactions) {
      const from = tx.fromAddress ? shortAddr(tx.fromAddress) : 'coinbase';
      console.log(
        `    - ${from} → ${shortAddr(tx.toAddress)} : ${tx.amount}`,
      );
    }
  }
  console.log('');
}

async function runCli() {
  const difficulty = Number(process.env.LUCKCOIN_DIFFICULTY ?? 4);
  const blockchain = new Blockchain({
    difficulty: Number.isFinite(difficulty) && difficulty > 0 ? difficulty : 4,
  });
  const rl = createInterface({ input, output });

  console.log(BANNER);
  console.log('Genesis block created. Type "help" for commands.\n');

  let running = true;
  let walletCounter = 1;

  while (running) {
    const line = (await rl.question('luckcoin> ')).trim();
    if (!line) {
      continue;
    }

    const [command, ...rest] = line.split(/\s+/);

    try {
      switch (command.toLowerCase()) {
        case 'wallet': {
          if (rest[0]?.toLowerCase() !== 'create') {
            console.log('Usage: wallet create [name]');
            break;
          }
          const name = rest[1] || `wallet${walletCounter++}`;
          if (walletsByName.has(name)) {
            console.log(`Wallet name already exists: ${name}`);
            break;
          }
          const wallet = Wallet.create();
          registerWallet(name, wallet);
          console.log(`Created wallet "${name}"`);
          console.log(`Address: ${wallet.address}`);
          break;
        }

        case 'wallets': {
          if (walletsByName.size === 0) {
            console.log('No wallets in this session.');
            break;
          }
          for (const [name, wallet] of walletsByName) {
            console.log(`${name}: ${wallet.address}`);
          }
          break;
        }

        case 'send': {
          const [fromRef, toRef, amountRaw] = rest;
          if (!fromRef || !toRef || amountRaw === undefined) {
            console.log('Usage: send <from> <to> <amount>');
            break;
          }
          const fromWallet = resolveWallet(fromRef);
          const toAddress = resolveAddress(toRef);
          const amount = Number(amountRaw);
          if (!fromWallet) {
            console.log(`Unknown from wallet: ${fromRef}`);
            break;
          }
          if (!toAddress) {
            console.log(`Unknown to wallet/address: ${toRef}`);
            break;
          }
          if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount <= 0) {
            console.log('Amount must be a positive whole number');
            break;
          }
          const tx = new Transaction({
            fromAddress: fromWallet.address,
            toAddress,
            amount,
          });
          tx.sign(fromWallet);
          blockchain.addTransaction(tx);
          console.log(`Queued transfer of ${amount} to ${shortAddr(toAddress)}`);
          break;
        }

        case 'pending': {
          if (blockchain.pendingTransactions.length === 0) {
            console.log('Mempool is empty.');
            break;
          }
          for (const tx of blockchain.pendingTransactions) {
            console.log(
              `${shortAddr(tx.fromAddress)} → ${shortAddr(tx.toAddress)} : ${tx.amount}`,
            );
          }
          break;
        }

        case 'mine': {
          const minerRef = rest.join(' ');
          if (!minerRef) {
            console.log('Usage: mine <miner name|address>');
            break;
          }
          const minerAddress = resolveAddress(minerRef);
          if (!minerAddress) {
            console.log(`Unknown miner: ${minerRef}`);
            break;
          }
          const start = Date.now();
          const block = blockchain.minePendingTransactions(minerAddress);
          console.log(
            `Mined block #${block.index} in ${Date.now() - start}ms (${block.transactions.length} txs)`,
          );
          console.log(`Hash: ${block.hash}`);
          break;
        }

        case 'balance': {
          const ref = rest[0];
          if (!ref) {
            console.log('Usage: balance <name|address>');
            break;
          }
          const address = resolveAddress(ref);
          if (!address) {
            console.log(`Unknown wallet/address: ${ref}`);
            break;
          }
          console.log(`Balance: ${blockchain.getBalance(address)}`);
          break;
        }

        case 'chain':
          printChain(blockchain);
          break;

        case 'validate':
          console.log(
            blockchain.isValidChain()
              ? '✓ Chain is valid'
              : '✗ Chain is invalid',
          );
          break;

        case 'help':
          console.log(HELP);
          break;

        case 'exit':
        case 'quit':
          running = false;
          break;

        default:
          console.log(`Unknown command: ${command}. Type "help" for commands.`);
      }
    } catch (error) {
      console.log(`Error: ${error.message}`);
    }
  }

  rl.close();
}

runCli().catch((error) => {
  console.error(error);
  process.exit(1);
});
