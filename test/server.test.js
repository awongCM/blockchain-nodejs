import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { Wallet } from '../src/wallet/Wallet.js';

const TEST_PORT = 3456;
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

/** @type {import('node:child_process').ChildProcessWithoutNullStreams} */
let serverProcess;

function waitForServer(timeoutMs = 8000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = async () => {
      try {
        const res = await fetch(`${BASE_URL}/health`);
        if (res.ok) {
          resolve(undefined);
          return;
        }
      } catch {
        // retry
      }

      if (Date.now() - start > timeoutMs) {
        reject(new Error('Server did not start in time'));
        return;
      }

      setTimeout(check, 100);
    };

    check();
  });
}

describe('Dashboard HTTP server', () => {
  before(async () => {
    serverProcess = spawn('node', ['src/server.js'], {
      env: {
        ...process.env,
        PORT: String(TEST_PORT),
        HOST: '127.0.0.1',
        LUCKCOIN_DIFFICULTY: '2',
      },
      stdio: 'pipe',
    });

    await waitForServer();
  });

  after(async () => {
    serverProcess.kill('SIGTERM');
    await new Promise((resolve) => serverProcess.once('exit', resolve));
  });

  it('GET /health returns ok', async () => {
    const res = await fetch(`${BASE_URL}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.blocks, 1);
    assert.equal(body.phase, 4);
  });

  it('GET /chain returns genesis block', async () => {
    const res = await fetch(`${BASE_URL}/chain`);
    const body = await res.json();
    assert.equal(body.length, 1);
    assert.equal(body.chain[0].index, 0);
    assert.equal(body.chain[0].timestamp, 0);
  });

  it('POST /mine mines a coinbase block', async () => {
    const miner = Wallet.create();
    const res = await fetch(`${BASE_URL}/mine`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ minerAddress: miner.address }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.block.index, 1);
    assert.ok(body.block.hash.startsWith('00'));
    assert.equal(body.block.transactions[0].fromAddress, null);
  });

  it('GET /validate confirms chain integrity', async () => {
    const res = await fetch(`${BASE_URL}/validate`);
    const body = await res.json();
    assert.equal(body.valid, true);
  });

  it('GET / serves HTML dashboard without reflecting user input', async () => {
    const res = await fetch(`${BASE_URL}/`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /LuckCoin/);
    assert.match(html, /Phase 3/);
    assert.match(html, /createElement/);
    assert.doesNotMatch(html, /innerHTML\s*=/);
  });
});
