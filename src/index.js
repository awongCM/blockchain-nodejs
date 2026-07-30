import { stdin as input, stdout as output } from 'node:process';
import { Blockchain } from './core/Blockchain.js';
import { Wallet } from './wallet/Wallet.js';
import { Transaction } from './wallet/Transaction.js';
import { LuckCoinNode, normalizePeerUrl } from './network/Node.js';
import { startHttpServer } from './network/HttpServer.js';

/**
 * Line reader that does not fight node:crypto over stdin (readline can lose
 * buffered input when ECDSA keygen runs between prompts on a pipe).
 * @param {NodeJS.ReadableStream} stream
 */
async function* linesOf(stream) {
  stream.setEncoding('utf8');
  let buffer = '';
  for await (const chunk of stream) {
    buffer += chunk;
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline).replace(/\r$/, '');
      buffer = buffer.slice(newline + 1);
      yield line;
      newline = buffer.indexOf('\n');
    }
  }
  if (buffer.length > 0) {
    yield buffer.replace(/\r$/, '');
  }
}

const BANNER = `
  🐱 LuckCoin — Phase 4
  ─────────────────────
  Simple smart contracts with deploy, call, and sync.
`;

const HELP = `
Commands:
  wallet create [name]     Create an in-memory wallet
  wallets                  List session wallets
  send <from> <to> <amt>   Sign and enqueue a transfer
  deploy <from> <amt> <codeJson>   Deploy contract code JSON
  call <from> <contract> <method> [amount] [argsJson]
  contract <address>       Show contract code/storage/balance
  contracts                List contract addresses
  pending                  Show mempool
  mine <miner>             Mine coinbase + pending txs
  balance <name|address>   Show chain balance
  chain                    Show the full blockchain
  validate                 Check chain integrity
  listen [port]            Start HTTP API (default 3001 / PORT)
  peers                    List peer URLs
  peers add <url>          Register a peer (and announce self)
  sync                     Resolve conflicts with peers
  url                      Show this node's advertised URL
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
  if (
    /^[0-9a-f]+$/i.test(nameOrAddress) &&
    (nameOrAddress.length === 64 || nameOrAddress.length > 80)
  ) {
    return nameOrAddress.toLowerCase();
  }
  return null;
}

function parseCodeJson(codeJson) {
  const parsed = JSON.parse(codeJson);
  if (parsed && typeof parsed === 'object' && parsed.code) {
    return parsed.code;
  }
  return parsed;
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

function defaultPort() {
  const raw = process.env.PORT ?? process.env.LUCKCOIN_PORT ?? '3001';
  const port = Number(raw);
  return Number.isFinite(port) && port >= 0 ? port : 3001;
}

async function runCli() {
  const difficulty = Number(process.env.LUCKCOIN_DIFFICULTY ?? 4);
  const blockchain = new Blockchain({
    difficulty: Number.isFinite(difficulty) && difficulty > 0 ? difficulty : 4,
  });

  const initialPort = defaultPort();
  const advertised =
    process.env.LUCKCOIN_URL ?? `http://127.0.0.1:${initialPort}`;
  const node = new LuckCoinNode({
    blockchain,
    url: normalizePeerUrl(advertised),
  });

  /** @type {{ close: () => Promise<void>, port: number } | null} */
  let http = null;

  async function ensureListening(port = defaultPort()) {
    if (http) {
      console.log(`Already listening on ${node.url}`);
      return;
    }
    http = await startHttpServer({
      node,
      port,
      host: '0.0.0.0',
    });
    if (!process.env.LUCKCOIN_URL) {
      node.url = `http://127.0.0.1:${http.port}`;
    }
    console.log(`HTTP API listening on 0.0.0.0:${http.port}`);
    console.log(`Advertised URL: ${node.url}`);
  }

  console.log(BANNER);
  console.log('Genesis block created. Type "help" for commands.\n');

  const autoListen =
    process.env.LUCKCOIN_LISTEN === '1' ||
    process.argv.includes('--listen');
  if (autoListen) {
    await ensureListening();
  }

  let running = true;
  let walletCounter = 1;
  const incoming = linesOf(input);

  while (running) {
    output.write('luckcoin> ');
    const next = await incoming.next();
    if (next.done) {
      break;
    }
    const line = next.value.trim();
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
          await node.broadcastTransaction(tx);
          console.log(`Queued transfer of ${amount} to ${shortAddr(toAddress)}`);
          break;
        }

        case 'deploy': {
          const [fromRef, amountRaw, ...codeParts] = rest;
          const codeJson = codeParts.join(' ');
          if (!fromRef || amountRaw === undefined || !codeJson) {
            console.log('Usage: deploy <from> <amount> <codeJson>');
            break;
          }
          const fromWallet = resolveWallet(fromRef);
          const amount = Number(amountRaw);
          if (!fromWallet) {
            console.log(`Unknown from wallet: ${fromRef}`);
            break;
          }
          if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount < 0) {
            console.log('Amount must be a non-negative whole number');
            break;
          }
          let code;
          try {
            code = parseCodeJson(codeJson);
          } catch {
            console.log('Invalid code JSON');
            break;
          }
          const timestamp = Date.now();
          const toAddress = Transaction.deployAddress(
            fromWallet.address,
            timestamp,
            code,
          );
          const tx = new Transaction({
            fromAddress: fromWallet.address,
            toAddress,
            amount,
            timestamp,
            type: 'deploy',
            data: { code },
          });
          tx.sign(fromWallet);
          blockchain.addTransaction(tx);
          await node.broadcastTransaction(tx);
          console.log(`Deploy queued. Contract: ${toAddress}`);
          break;
        }

        case 'call': {
          const [fromRef, contractRef, method, amountOrArgs, ...argsParts] = rest;
          if (!fromRef || !contractRef || !method) {
            console.log(
              'Usage: call <from> <contract> <method> [amount] [argsJson]',
            );
            break;
          }
          const fromWallet = resolveWallet(fromRef);
          const contractAddress = resolveAddress(contractRef);
          if (!fromWallet) {
            console.log(`Unknown from wallet: ${fromRef}`);
            break;
          }
          if (!contractAddress) {
            console.log(`Unknown contract address: ${contractRef}`);
            break;
          }

          let amount = 0;
          let args = [];
          if (amountOrArgs !== undefined) {
            if (amountOrArgs.startsWith('[')) {
              try {
                args = JSON.parse([amountOrArgs, ...argsParts].join(' '));
              } catch {
                console.log('Invalid args JSON');
                break;
              }
            } else {
              amount = Number(amountOrArgs);
              if (
                !Number.isFinite(amount) ||
                !Number.isInteger(amount) ||
                amount < 0
              ) {
                console.log('Amount must be a non-negative whole number');
                break;
              }
              if (argsParts.length > 0) {
                try {
                  args = JSON.parse(argsParts.join(' '));
                } catch {
                  console.log('Invalid args JSON');
                  break;
                }
              }
            }
          }
          if (!Array.isArray(args)) {
            console.log('Args must be a JSON array');
            break;
          }

          const tx = new Transaction({
            fromAddress: fromWallet.address,
            toAddress: contractAddress,
            amount,
            type: 'call',
            data: { method, args },
          });
          tx.sign(fromWallet);
          blockchain.addTransaction(tx);
          await node.broadcastTransaction(tx);
          console.log(
            `Call queued: ${method} on ${shortAddr(contractAddress)} (value ${amount})`,
          );
          break;
        }

        case 'contract': {
          const ref = rest[0];
          if (!ref) {
            console.log('Usage: contract <address>');
            break;
          }
          const address = resolveAddress(ref);
          if (!address) {
            console.log(`Unknown contract address: ${ref}`);
            break;
          }
          const contract = blockchain.getContract(address);
          if (!contract) {
            console.log('Contract not found');
            break;
          }
          console.log(JSON.stringify(contract, null, 2));
          break;
        }

        case 'contracts': {
          const addresses = blockchain.listContracts();
          if (addresses.length === 0) {
            console.log('No contracts on chain.');
            break;
          }
          for (const address of addresses) {
            console.log(address);
          }
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
          await node.broadcastBlock(block);
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

        case 'listen': {
          const portRaw = rest[0];
          const port = portRaw === undefined ? defaultPort() : Number(portRaw);
          if (!Number.isFinite(port) || port < 0) {
            console.log('Usage: listen [port]');
            break;
          }
          await ensureListening(port);
          break;
        }

        case 'peers': {
          if (rest[0]?.toLowerCase() === 'add') {
            const peerUrl = rest[1];
            if (!peerUrl) {
              console.log('Usage: peers add <url>');
              break;
            }
            const normalized = normalizePeerUrl(peerUrl);
            if (!node.registerPeer(normalized)) {
              console.log(
                `Peer rejected (self, invalid, disallowed, or limit reached): ${peerUrl}`,
              );
              break;
            }
            try {
              await fetch(`${normalized}/nodes/register`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ node: node.url }),
              });
            } catch {
              console.log('Peer registered locally (remote announce failed)');
            }
            console.log(`Peer added: ${normalized}`);
            break;
          }
          if (node.peers.size === 0) {
            console.log('No peers registered.');
            break;
          }
          for (const peer of node.peers) {
            console.log(peer);
          }
          break;
        }

        case 'sync': {
          const result = await node.resolveConflicts();
          console.log(
            result.replaced
              ? `Chain replaced. Length: ${result.length}`
              : `Chain unchanged. Length: ${result.length}`,
          );
          break;
        }

        case 'url':
          console.log(node.url);
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

  if (http) {
    await http.close();
  }
}

runCli().catch((error) => {
  console.error(error);
  process.exit(1);
});
