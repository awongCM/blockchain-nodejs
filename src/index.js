import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { Blockchain } from './core/Blockchain.js';

const BANNER = `
  🐱 LuckCoin — Phase 1
  ─────────────────────
  A proof-of-concept blockchain inspired by the Maneki-neko.
`;

const HELP = `
Commands:
  chain              Show the full blockchain
  mine <data>        Mine a new block with the given data
  validate           Check chain integrity
  help               Show this help message
  exit               Quit
`;

function printChain(blockchain) {
  for (const block of blockchain.chain) {
    console.log('');
    console.log(`Block #${block.index}`);
    console.log(`  Timestamp:     ${new Date(block.timestamp).toISOString()}`);
    console.log(`  Data:          ${block.data}`);
    console.log(`  Previous hash: ${block.previousHash}`);
    console.log(`  Nonce:         ${block.nonce}`);
    console.log(`  Hash:          ${block.hash}`);
  }
  console.log('');
}

async function runCli() {
  const blockchain = new Blockchain();
  const rl = createInterface({ input, output });

  console.log(BANNER);
  console.log('Genesis block created. Type "help" for commands.\n');

  let running = true;

  while (running) {
    const line = (await rl.question('luckcoin> ')).trim();
    if (!line) {
      continue;
    }

    const [command, ...rest] = line.split(/\s+/);
    const arg = rest.join(' ');

    switch (command.toLowerCase()) {
      case 'chain':
        printChain(blockchain);
        break;

      case 'mine': {
        if (!arg) {
          console.log('Usage: mine <data>');
          break;
        }
        const start = Date.now();
        const block = blockchain.addBlock(arg);
        const elapsed = Date.now() - start;
        console.log(`Mined block #${block.index} in ${elapsed}ms`);
        console.log(`Hash: ${block.hash}`);
        break;
      }

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
  }

  rl.close();
}

runCli().catch((error) => {
  console.error(error);
  process.exit(1);
});
