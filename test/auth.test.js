import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

function openPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

test('secure auth baseline and 13-second ghosting', { timeout: 35_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'boomart-test-'));
  const port = await openPort();
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DB_PATH: join(directory, 'test.sqlite'), NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let serverOutput = '';
  child.stdout.on('data', chunk => { serverOutput += chunk.toString(); });
  child.stderr.on('data', chunk => { serverOutput += chunk.toString(); });
  const base = `http://127.0.0.1:${port}`;

  const jar = { cookie: '' };
  async function request(path, options = {}, target = jar) {
    const headers = { ...(options.headers || {}) };
    if (target.cookie) headers.Cookie = target.cookie;
    const response = await fetch(base + path, { ...options, headers });
    const cookie = response.headers.get('set-cookie');
    if (cookie) target.cookie = cookie.split(';')[0];
    const body = await response.json();
    return { response, body };
  }
  async function post(path, body, target = jar, withCsrf = true) {
    const headers = { 'Content-Type': 'application/json' };
    if (withCsrf) {
      const token = await request('/api/auth/csrf', {}, target);
      headers['X-CSRF-Token'] = token.body.csrfToken;
    }
    return request(path, { method: 'POST', headers, body: JSON.stringify(body) }, target);
  }

  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) break;
      try { const health = await fetch(base + '/health'); if (health.ok) { ready = true; break; } } catch {}
      await delay(100);
    }
    assert.ok(ready, `Server did not start. ${serverOutput}`);

    assert.equal((await request('/api/auth/me')).response.status, 401);
    assert.equal((await post('/api/auth/register', { username: 'ghost_guest', password: 'abcdefghijk' }, jar, false)).response.status, 403);
    assert.equal((await post('/api/auth/login', { username: 'chamharouch', password: 'admin123456' })).response.status, 401);
    assert.equal((await post('/api/auth/register', { username: 'aicha_kandisha', password: 'abcdefghijk' })).response.status, 409);
    assert.equal((await post('/api/auth/login', { username: 'hmar_lill', password: 'nightshift-13' })).response.status, 200);
    const user = await request('/api/auth/me');
    assert.equal(user.body.username, 'hmar_lill');
    assert.equal(user.body.role, 'customer');
    assert.equal(user.body.verified, false);

    const temp = { cookie: '' };
    assert.equal((await post('/api/auth/register', { username: 'ghost_guest', password: 'abcdefghijk' }, temp)).response.status, 201);
    assert.equal((await post('/api/auth/login', { username: 'ghost_guest', password: 'abcdefghijk' }, temp)).response.status, 200);
    const ghost = await request('/api/auth/me', {}, temp);
    assert.equal(ghost.body.ghosted, true);
    assert.equal(ghost.body.verified, false);
    assert.ok(ghost.body.expiresAt > Date.now());
    await delay(Math.max(0, ghost.body.expiresAt - Date.now()) + 450);
    assert.equal((await request('/api/auth/me', {}, temp)).response.status, 401);
    assert.equal((await post('/api/auth/login', { username: 'ghost_guest', password: 'abcdefghijk' }, temp)).response.status, 401);
    assert.equal((await request('/api/auth/me')).body.username, 'hmar_lill');
  } finally {
    const exited = child.exitCode === null
      ? new Promise(resolve => child.once('exit', resolve))
      : Promise.resolve();
    child.kill();
    await Promise.race([exited, delay(3000)]);
    rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
  }
});
