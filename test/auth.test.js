import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';

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

test('auth, ghost IDOR, chained recovery, admin puzzles, curses, and 13-second ghosting', { timeout: 110_000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'boomart-test-'));
  const port = await openPort();
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DB_PATH: join(directory, 'test.sqlite'), NODE_ENV: 'test', FLAG: 'ENSATE{INTEGRATION_TEST_ONLY_28f9c6}' },
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
    assert.equal((await request('/api/support/tickets')).response.status, 401);
    assert.equal((await request('/api/shop/products')).response.status, 401);
    assert.equal((await request('/api/admin/overview')).response.status, 401);
    assert.equal((await request('/api/ghosts/42/profile')).response.status, 401);
    const loginPage = await fetch(base + '/');
    const loginHtml = await loginPage.text();
    assert.equal(loginPage.status, 200);
    assert.ok(loginHtml.includes('loginForm'));
    assert.doesNotMatch(loginHtml, /DANGEROUS/);
    assert.ok(!loginHtml.includes('ghostLookupForm'));
    assert.ok(!loginHtml.includes('adminOverview'));
    assert.ok(!loginHtml.includes('ticketList'));
    assert.match(loginHtml, /gravekeeper/);
    assert.match(loginHtml, /midnight-1899/);
    assert.match(loginHtml, /favicon\.svg/);
    const faux = await post('/api/auth/login', { username: 'gravekeeper', password: 'midnight-1899' });
    assert.equal(faux.response.status, 401);
    assert.equal(faux.body.error, 'PHANTOM_OPERATOR_TRAP');
    assert.equal((await request('/api/auth/me')).response.status, 401);
    assert.equal((await post('/api/auth/register', { username: 'gravekeeper', password: 'midnight-1899' })).response.status, 409);

    const robots = await fetch(base + '/robots.txt');
    assert.equal(robots.status, 200);
    assert.match(robots.headers.get('content-type') || '', /text\/plain/);
    const robotText = await robots.text();
    assert.match(robotText, /Disallow: \/do-not-enter-the-crypt\//);
    assert.doesNotMatch(robotText, /SHIFT_LEDGER|slipRef|FLAG|WISP-/);
    const crypt = await fetch(base + '/do-not-enter-the-crypt/');
    assert.equal(crypt.status, 200);
    const cryptHtml = await crypt.text();
    assert.match(cryptHtml, /crypt-screamer\.webp/);
    assert.match(cryptHtml, /crypt-scare-face/);
    assert.doesNotMatch(cryptHtml, /YOU SHOULD HAVE KNOCKED|The door was marked/);
    assert.doesNotMatch(cryptHtml, /SHIFT_LEDGER|slipRef|approval_ref/);
    assert.match(cryptHtml, /crypt-scare-stage/);
    const screamer = await fetch(base + '/assets/crypt-screamer.webp');
    assert.equal(screamer.status, 200);
    assert.match(screamer.headers.get('content-type') || '', /image\/webp/);
    const css = await fetch(base + '/style.css');
    assert.equal(css.status, 200);
    assert.match(await css.text(), /ENSATE\{this_is_just_a_decorative_ghost_not_your_flag\}/);
    for (const [probe, text] of [['/wp-admin', 'WORDPRESS EXORCISM'],
      ['/.env', 'SEALED VIAL'], ['/phpmyadmin', 'CRYPT DATABASE'],
      ['/server-status', 'THE SLEEPING SERVER'], ['/sitemap.xml', 'THE LOST MAP']]) {
      const result = await fetch(base + probe);
      assert.equal(result.status, 404);
      assert.match(await result.text(), new RegExp(text));
    }
    for (const [path, phrase] of [
      ['/package.json', 'BURIED SOURCE'], ['/server.js', 'BURIED SOURCE'],
      ['/data/', 'CRYPT DATABASE'], ['/swagger.json', 'INVISIBLE API'],
      ['/socket.io/', 'SEANCE ONLY'], ['/flag', 'MISSING FLAG'],
      ['/src/routes.js.map', 'BURIED SOURCE'], ['/manager', 'STAFF STAIRS']
    ]) {
      const probe = await fetch(base + path);
      assert.equal(probe.status, 404, path);
      assert.match(await probe.text(), new RegExp(phrase));
    }
    const fakeApiFlag = await request('/api/flag');
    assert.equal(fakeApiFlag.response.status, 404);
    assert.match(fakeApiFlag.body.message, /consequence/i);
    const scannerBait = await fetch(base + '/server.js', { headers: { 'User-Agent': 'nikto/2.5' } });
    assert.equal(scannerBait.status, 404);
    assert.match(scannerBait.headers.get('x-old-ghost') || '', /2006/);
    const bearer = await fetch(base + '/api/admin/overview', { headers: { Authorization: 'Bearer fake.jwt.value' } });
    assert.equal(bearer.status, 401);
    assert.equal((await bearer.json()).error, 'UNSIGNED_GHOST');
    const forgedRole = await fetch(base + '/api/admin/overview', { headers: { 'X-Role': 'admin' } });
    assert.equal(forgedRole.status, 403);
    const fakeCookie = await fetch(base + '/api/auth/me', { headers: { Cookie: 'boomart.sid=s%3Afaked.sig' } });
    assert.equal(fakeCookie.status, 401);
    assert.match(fakeCookie.headers.get('x-cookie-monster') || '', /another oven/i);
    const traceStatus = await new Promise((resolve, reject) => {
      const probe = httpRequest(base + '/api/auth/me', { method: 'TRACE' }, response => {
        response.resume();
        response.on('end', () => resolve(response.statusCode));
        response.on('error', reject);
      });
      probe.on('error', reject);
      probe.end();
    });
    assert.equal(traceStatus, 405);
    const overridden = await fetch(base + '/api/auth/me', { headers: { 'X-HTTP-Method-Override': 'POST' } });
    assert.equal(overridden.status, 405);
    const xml = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/xml' }, body: '<person />' });
    assert.equal(xml.status, 415);
    const malformedBody = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"oops":' });
    assert.equal(malformedBody.status, 400);
    assert.equal((await malformedBody.json()).error, 'UNREADABLE_SCROLL');
    const oversizedBody = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ x: 'X'.repeat(17_000) }) });
    assert.equal(oversizedBody.status, 413);
    assert.equal((await oversizedBody.json()).error, 'SCROLL_TOO_HEAVY');
    const protoPayload = await fetch(base + '/api/auth/guest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"__proto__":{"role":"admin"}}' });
    assert.equal(protoPayload.status, 400);
    assert.equal((await protoPayload.json()).error, 'OBJECT_EXORCISED');
    const inputRole = await fetch(base + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"username":"xperson","password":"abcd","role":"admin"}' });
    assert.equal(inputRole.status, 400);
    assert.equal((await inputRole.json()).error, 'SELF_PROMOTION_REJECTED');
    const deadApi = await request('/api/debug');
    assert.equal(deadApi.response.status, 404);
    assert.equal(deadApi.body.error, 'OTHERWORLDLY_ABSENCE');
    for (const missingUrl of ['/a-forgotten-crypt', '/views/admin.html']) {
      const missing = await fetch(base + missingUrl);
      assert.equal(missing.status, 404);
      assert.match(missing.headers.get('content-type') || '', /text\/html/);
      const html = await missing.text();
      assert.match(html, /This page moved to the other side/);
      assert.doesNotMatch(html, /adminOverview|SHIFT_LEDGER|slipRef/);
    }
    const absentApi = await request('/api/does-not-exist');
    assert.equal(absentApi.response.status, 404);
    assert.equal(absentApi.body.error, 'NOT_FOUND');
    const ico = await fetch(base + '/favicon.ico');
    assert.equal(ico.status, 200);
    assert.match(ico.headers.get('content-type') || '', /icon|octet-stream/);
    const icon = await fetch(base + '/favicon.svg');
    assert.equal(icon.status, 200);
    assert.match(await icon.text(), /BOOMART ghost favicon/);
    const ghostArt = await fetch(base + '/assets/doom-face.svg');
    assert.equal(ghostArt.status, 200);

    const gatedHome = await fetch(base + '/home', { redirect: 'manual' });
    assert.equal(gatedHome.status, 303);
    assert.equal(gatedHome.headers.get('location'), '/');
    assert.equal((await fetch(base + '/views/admin.html')).status, 404);
    assert.equal((await fetch(base + '/admin-client.js', { redirect: 'manual' })).status, 303);
    assert.equal((await fetch(base + '/ghosted-client.js')).status, 403);
    assert.equal((await post('/api/auth/register', { username: 'ghost_guest', password: 'abcdefghijk' }, jar, false)).response.status, 403);
    const badLogin = await post('/api/auth/login', { username: 'chamharouch', password: 'admin123456' });
    assert.equal(badLogin.response.status, 401);
    assert.equal(badLogin.body.error, 'SOUL_NOT_RECOGNIZED');
    assert.equal(badLogin.body.ghostTrial, false);
    assert.match(badLogin.body.message, /spirits/i);
    for (const [username, password, pattern] of [
      ['admin', 'admin', /Default Password Plague/],
      ["admin' OR 1=1--", 'anything', /database ghost/],
      ["hmar_lill", "' OR '1'='1", /database ghost/],
      ['root', 'toor', /Default Password Plague/],
      ['<script>alert(1)</script>', 'bad', /mirror spirit/]
    ]) {
      const attempt = await post('/api/auth/login', { username, password });
      assert.equal(attempt.response.status, 401);
      assert.equal(attempt.body.error, 'SOUL_NOT_RECOGNIZED');
      assert.equal(attempt.body.ghostTrial, true);
      assert.match(attempt.body.message, pattern);
      assert.equal((await request('/api/auth/me')).response.status, 401);
    }
    const malformed = await post('/api/auth/login', { username: { '$ne': null }, password: 'x' });
    assert.equal(malformed.response.status, 400);
    assert.match(malformed.body.message, /gatekeeper/i);
    assert.equal((await post('/api/auth/register', { username: 'aicha_kandisha', password: 'abcdefghijk' })).response.status, 409);
    const login = await post('/api/auth/login', { username: 'hmar_lill', password: 'nightshift-13' });
    assert.equal(login.response.status, 200);
    const fakePrice = await fetch(base + '/api/shop/products/golden-carrot', {
      method: 'PUT', headers: { Cookie: jar.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ price: 0 })
    });
    assert.equal(fakePrice.status, 403);
    assert.equal((await fakePrice.json()).error, 'PRICE_TAG_SEALED');
    const fakeRefund = await fetch(base + '/api/shop/orders/fake/refund', {
      method: 'POST', headers: { Cookie: jar.cookie, 'Content-Type': 'application/json' }, body: '{}'
    });
    assert.equal(fakeRefund.status, 403);
    assert.equal((await fakeRefund.json()).error, 'NO_MORTAL_REFUNDS');
    const forgedTemplate = await fetch(base + '/api/shop/cart/lines', {
      method: 'POST', headers: { Cookie: jar.cookie, 'Content-Type': 'application/json' },
      body: '{"product_id":"{{7*7}}"}'
    });
    assert.equal(forgedTemplate.status, 400);
    assert.equal((await forgedTemplate.json()).error, 'NO_TEMPLATE_ENGINE');
    assert.match(login.response.headers.get('set-cookie') || '', /boomart\.sid=/);
    const user = await request('/api/auth/me');
    assert.equal(user.body.username, 'hmar_lill');
    assert.equal(user.body.role, 'customer');
    assert.equal('verified' in user.body, false);
    const homePage = await fetch(base + '/home', { headers: { Cookie: jar.cookie } });
    assert.equal(homePage.status, 200);
    const homeHtml = await homePage.text();
    assert.ok(homeHtml.includes('Your assigned ghost'));
    assert.ok(!homeHtml.includes('ghostLookupForm'));
    assert.ok(!homeHtml.includes('adminOverview'));
    assert.ok(!homeHtml.includes('customerStatus'));
    assert.ok(!homeHtml.includes('Unverified'));
    const shopPage = await fetch(base + '/shop', { headers: { Cookie: jar.cookie } });
    assert.equal(shopPage.status, 200);
    const shopHtml = await shopPage.text();
    assert.ok(shopHtml.includes('id="products"'));
    assert.ok(shopHtml.includes('id="headerWalletBalance"'));
    assert.ok(shopHtml.includes('id="headerCartCount"'));
    assert.ok(!shopHtml.includes('BOOMART_SHOP_HEADER'));
    const supportPage = await fetch(base + '/support', { headers: { Cookie: jar.cookie } });
    assert.equal(supportPage.status, 200);
    assert.ok((await supportPage.text()).includes('id="ticketList"'));
    const adminView = await fetch(base + '/admin', { headers: { Cookie: jar.cookie } });
    assert.equal(adminView.status, 403);
    const adminJs = await fetch(base + '/admin-client.js', { headers: { Cookie: jar.cookie }, redirect: 'manual' });
    assert.equal(adminJs.status, 403);

    const tickets = await request('/api/support/tickets');
    assert.equal(tickets.response.status, 200);
    assert.deepEqual(tickets.body.tickets.map(item => item.id), [3108]);
    const ownTicket = await request('/api/support/tickets/3108');
    assert.equal(ownTicket.response.status, 200);
    assert.equal(ownTicket.body.ticket.id, 3108);
    const neighboringTicket = await request('/api/support/tickets/3109');
    assert.equal(neighboringTicket.response.status, 200);
    assert.equal('staffRecovery' in neighboringTicket.body.ticket, false);
    assert.match(neighboringTicket.body.ticket.message, /candle/i);
    assert.match(ownTicket.body.ticket.message, /thirteen chimes/i);
    assert.match(ownTicket.body.ticket.message, /bells enter before the hands/i);
    assert.ok(!ownTicket.body.ticket.message.includes('HHMM'));
    for (const guess of [1, 3, 7, 13, 33, 42, 66, 69, 111, 333, 404, 444, 666, 777, 999, 1313, 1337]) {
      const found = await request(`/api/support/tickets/${guess}`);
      assert.equal(found.response.status, 404);
      assert.equal(found.body.error, 'TICKET_NOT_FOUND');
      assert.equal(typeof found.body.message, 'string');
      assert.equal('staffRecovery' in found.body, false);
    }
    for (const badId of ['0', '-1', '-13', '-666']) {
      const invalid = await request(`/api/support/tickets/${badId}`);
      assert.equal(invalid.response.status, 400);
      assert.equal(invalid.body.error, 'INVALID_TICKET_ID');
      assert.equal(typeof invalid.body.message, 'string');
    }

    const recoveredTicket = await request('/api/support/tickets/130333');
    assert.equal(recoveredTicket.response.status, 200);
    assert.equal(recoveredTicket.body.ticket.id, 130333);
    assert.equal(recoveredTicket.body.ticket.staffRecovery.status, 'APPROVED');
    assert.equal(recoveredTicket.response.headers.get('x-archive-counter'), 'support/approvals');
    assert.equal(recoveredTicket.body.ticket.staffRecovery.department, 'Personnel Archive');
    assert.equal('procedure' in recoveredTicket.body.ticket.staffRecovery, false);
    assert.equal('requestedFor' in recoveredTicket.body.ticket.staffRecovery, false);
    const approvalRef = recoveredTicket.body.ticket.staffRecovery.slipRef;
    assert.match(approvalRef, /^[a-f0-9]{24}$/);
    assert.ok(!JSON.stringify(recoveredTicket.body).includes('temporaryPassword'));
    assert.deepEqual((await request('/api/support/tickets')).body.tickets.map(t => t.id), [3108]);
    assert.equal((await request('/api/support/tickets/3110')).response.status, 200);
    assert.equal((await request('/api/support/tickets/other')).response.status, 400);
    assert.equal((await request('/api/support/tickets/130333?user_id=2&role=admin')).response.status, 200);
    const doc = await fetch(base + '/support', { headers: { Cookie: jar.cookie } });
    const docHtml = await doc.text();
    assert.ok(docHtml.includes('id="ticketList"'));
    assert.ok(!docHtml.includes('Dusty archive handbook'));
    assert.ok(!docHtml.includes('Retired personnel desk'));
    assert.ok(!docHtml.includes('recoveryForm'));
    assert.ok(!docHtml.includes('slipRef'));
    const customerJs = await fetch(base + '/app.js');
    const customerJsText = await customerJs.text();
    assert.ok(!customerJsText.includes('/api/support/approvals/redeem'));
    assert.ok(!customerJsText.includes('recoveryForm'));

    assert.equal((await request('/api/admin/overview')).response.status, 403);
    const overview = await request('/api/customer/overview');
    assert.equal(overview.response.status, 200);
    assert.equal('verified' in overview.body, false);

    const counter = await request('/api/support/approvals');
    assert.equal(counter.response.status, 200);
    assert.equal(counter.body.ledger, 'R-13');
    assert.match(counter.body.notice, /named actions under this counter/i);
    assert.equal('approval_ref' in counter.body, false);
    assert.equal('slipRef' in counter.body, false);
    assert.equal('credentials' in counter.body, false);
    assert.ok(!JSON.stringify(counter.body).includes('/api/support/approvals/redeem'));
    assert.equal((await request('/api/support/approvals', {}, { cookie: '' })).response.status, 401);

    const anonymousApproval = { cookie: '' };
    assert.equal((await post('/api/support/approvals/redeem', { approval_ref: approvalRef }, anonymousApproval)).response.status, 401);
    assert.equal((await post('/api/support/approvals/redeem', { approval_ref: approvalRef }, jar, false)).response.status, 403);
    assert.equal((await post('/api/support/approvals/redeem', { approval_ref: '000000000000000000000000' })).response.status, 404);
    const wrongVerb = await request('/api/support/approvals/redeem');
    assert.equal(wrongVerb.response.status, 405);
    assert.equal(wrongVerb.response.headers.get('allow'), 'POST');
    assert.equal(wrongVerb.body.expectedField, 'approval_ref');
    assert.equal((await request('/api/support/approvals/redeem', {}, { cookie: '' })).response.status, 401);
    const credentialsReply = await post('/api/support/approvals/redeem', { approval_ref: approvalRef });
    assert.equal(credentialsReply.response.status, 200);
    assert.equal(credentialsReply.body.credentials.username, 'chamharouch');
    assert.ok(credentialsReply.body.credentials.temporaryPassword.length >= 24);

    const rotated = await post('/api/support/approvals/redeem', { approval_ref: approvalRef });
    assert.equal(rotated.response.status, 200);
    assert.equal(rotated.body.credentials.username, 'chamharouch');
    assert.notEqual(rotated.body.credentials.temporaryPassword, credentialsReply.body.credentials.temporaryPassword);
    const oldManagerJar = { cookie: '' };
    assert.equal((await post('/api/auth/login', {
      username: 'chamharouch', password: credentialsReply.body.credentials.temporaryPassword
    }, oldManagerJar)).response.status, 401);

    const sqlite = new DatabaseSync(join(directory, 'test.sqlite'));
    try {
      const seeded = sqlite.prepare("SELECT password_hash FROM users WHERE username = 'hmar_lill'").get();
      sqlite.prepare(`INSERT INTO users(username,password_hash,role,status,verified,kind,created_at)
        VALUES ('another_customer',?,'customer','ACTIVE',0,'seed',?)`).run(seeded.password_hash, Date.now());
    } finally { sqlite.close(); }
    const otherJar = { cookie: '' };
    assert.equal((await post('/api/auth/login', {
      username: 'another_customer', password: 'nightshift-13'
    }, otherJar)).response.status, 200);
    assert.equal((await post('/api/support/approvals/redeem', {
      approval_ref: approvalRef
    }, otherJar)).response.status, 409);

    const managerJar = { cookie: '' };
    assert.equal((await post('/api/auth/login', {
      username: 'chamharouch', password: rotated.body.credentials.temporaryPassword
    }, managerJar)).response.status, 200);
    assert.equal((await request('/api/auth/me', {}, managerJar)).body.role, 'admin');
    assert.equal((await request('/api/admin/overview', {}, managerJar)).response.status, 200);
    assert.equal((await request('/api/customer/overview', {}, managerJar)).response.status, 403);
    assert.equal((await fetch(base + '/home', { headers: { Cookie: managerJar.cookie } })).status, 403);
    assert.equal((await fetch(base + '/admin', { headers: { Cookie: managerJar.cookie } })).status, 200);
    assert.equal((await request('/api/auth/me')).body.username, 'hmar_lill');

    const auditAsUser = await request('/api/admin/audit');
    assert.equal(auditAsUser.response.status, 403);
    assert.equal((await request('/api/admin/vault')).response.status, 403);
    assert.equal((await request('/api/admin/export')).response.status, 403);
    assert.equal((await request('/api/admin/audit', {}, { cookie: '' })).response.status, 401);
    assert.equal((await fetch(base + '/views/cat-export.zip')).status, 404);
    const managerPage = await fetch(base + '/admin', { headers: { Cookie: managerJar.cookie } });
    const managerHtml = await managerPage.text();
    assert.equal(managerPage.status, 200);
    assert.match(managerHtml, /DO NOT SUMMON/);
    assert.match(managerHtml, /Export Database/);
    assert.match(managerHtml, /admin-workspace/);
    assert.match(managerHtml, /admin-console/);
    assert.ok(!managerHtml.includes('afterhours'));
    assert.ok(!managerHtml.includes('aicha_kandisha'));
    const clientScript = await fetch(base + '/admin-client.js', { headers: { Cookie: managerJar.cookie } });
    assert.equal(clientScript.status, 200);
    const adminCode = await clientScript.text();
    assert.ok(!adminCode.includes('/afterhours/'));
    assert.ok(!adminCode.includes('aicha_kandisha'));
    assert.ok(!adminCode.includes('attempts >= 6'));
    assert.match(adminCode, /ghost-popup-header/);
    const fakeVault = await request('/api/admin/vault', {}, managerJar);
    assert.match(fakeVault.body.flag, /THE_VAULT_CONTAINS_ONLY_DUST/);
    const removed = await post('/api/admin/remove-self', {}, managerJar);
    assert.equal(removed.response.status, 409);
    assert.equal((await request('/api/auth/me', {}, managerJar)).body.username, 'chamharouch');
    assert.equal((await post('/api/admin/delete-all', {}, managerJar)).response.status, 200);
    const audit = await request('/api/admin/audit', {}, managerJar);
    assert.equal(audit.response.status, 200);
    const seal = audit.body.events.find(e => e.action === 'SHIFT_LEDGER')?.metadata?.seal;
    assert.match(seal, /^[a-f0-9]{36}$/);
    const auditAgain = await request('/api/admin/audit', {}, managerJar);
    assert.equal(auditAgain.body.events.find(e => e.action === 'SHIFT_LEDGER').metadata.seal, seal);
    const exported = await fetch(base + '/api/admin/export', { headers: { Cookie: managerJar.cookie } });
    assert.equal(exported.status, 200);
    assert.match(exported.headers.get('content-disposition') || '', /attachment/);
    const archive = new Uint8Array(await exported.arrayBuffer());
    assert.equal(archive[0], 0x50);
    assert.equal(archive[1], 0x4b);
    assert.equal((await post(`/api/admin/afterhours/${seal}/relieve`, {}, managerJar, false)).response.status, 403);
    assert.equal((await post(`/api/admin/afterhours/${'0'.repeat(36)}/relieve`, {}, managerJar)).response.status, 404);
    assert.equal((await post(`/api/admin/afterhours/${seal}/relieve`, {}, jar)).response.status, 403);
    assert.equal((await request('/api/admin/overview', {}, managerJar)).response.headers.get('x-legacy-ledger'), null);
    assert.equal((await post('/api/admin/legacy-debug', {}, managerJar)).response.status, 200);
    assert.equal((await request('/api/admin/overview', {}, managerJar)).response.headers.get('x-legacy-ledger'), '/api/admin/audit');
    assert.equal((await request('/api/admin/audit', {}, managerJar)).response.headers.get('x-legacy-archive'), 'SHIFT_LEDGER');
    assert.equal((await request('/api/admin/docs', {}, managerJar)).response.headers.get('x-legacy-service'), 'DEPRECATED-CATALOGUE');
    assert.equal((await request('/api/admin/delete-universe', {}, managerJar)).response.status, 410);
    const accounting1 = await request('/api/admin/accounting', {}, managerJar);
    assert.equal(accounting1.body.mode, 'ORDINARY');
    const accounting2 = await post('/api/admin/accounting/toggle', {}, managerJar);
    assert.equal(accounting2.body.mode, 'PARANORMAL');
    assert.ok(accounting2.body.balance > accounting1.body.balance);
    const accounting3 = await request('/api/admin/accounting', {}, managerJar);
    assert.equal(accounting3.body.mode, 'PARANORMAL');
    const printed = await post('/api/admin/printer/receipt', {}, managerJar);
    assert.equal(printed.response.status, 200);
    assert.match(printed.body.receipt, /BALANCE:/);
    assert.equal(printed.body.jobId, 1);
    assert.equal((await post('/api/admin/printer/receipt', {}, managerJar)).body.jobId, 2);
    const docs = await request('/api/admin/docs', {}, managerJar);
    assert.equal(docs.response.status, 200);
    assert.equal(docs.body.catalog.length, 15);
    assert.ok(docs.body.catalog.every(item => item.startsWith('/api/admin/')));
    assert.ok(!docs.body.catalog.includes('/api/admin/audit'));
    assert.ok(!docs.body.catalog.includes('/api/admin/overview'));
    for (const endpoint of docs.body.catalog) {
      const retired = await request(endpoint, {}, managerJar);
      assert.equal(retired.response.status, 410);
      assert.equal(retired.body.error, 'SERVICE_RETIRED');
      assert.ok(retired.body.message.length >= 25);
    }
    const adminUi = await fetch(base + '/admin', { headers: { Cookie: managerJar.cookie } });
    const adminUiHtml = await adminUi.text();
    assert.ok(!adminUiHtml.includes('printStation'));
    assert.ok(!adminUiHtml.includes('Staff cannot delete themselves during a shift'));
    assert.match(adminCode, /window\.open/);
    assert.match(adminCode, /popup\.print/);
    assert.ok(!adminCode.includes('This one REALLY locks the account'));

    assert.equal((await post('/api/admin/self-destruct', {}, managerJar, false)).response.status, 403);
    assert.equal((await post('/api/admin/self-destruct', {}, jar)).response.status, 403);
    const collapsed = await post('/api/admin/self-destruct', {}, managerJar);
    assert.equal(collapsed.response.status, 200);
    assert.equal(collapsed.body.next, '/admin');
    const offlineMe = await request('/api/auth/me', {}, managerJar);
    assert.equal(offlineMe.response.status, 503);
    assert.equal(offlineMe.body.error, 'EXECUTIVE_CRYPT_COLLAPSED');
    assert.equal((await request('/api/admin/audit', {}, managerJar)).response.status, 503);
    assert.equal((await request('/api/auth/csrf', {}, managerJar)).response.status, 503);
    assert.equal((await request('/api/rituals/status', {}, managerJar)).response.status, 503);
    const offlinePage = await fetch(base + '/admin', { headers: { Cookie: managerJar.cookie } });
    assert.equal(offlinePage.status, 503);
    assert.match(await offlinePage.text(), /THE EXECUTIVE CRYPT HAS FALLEN/);
    assert.equal((await fetch(base + '/style.css', { headers: { Cookie: managerJar.cookie } })).status, 200);
    assert.equal((await request('/api/auth/me')).body.username, 'hmar_lill');
    const storedOutage = new DatabaseSync(join(directory, 'test.sqlite'));
    try {
      const lock = storedOutage.prepare(`SELECT until_at FROM site_meltdowns WHERE staff_user_id =
        (SELECT id FROM users WHERE username = 'chamharouch')`).get();
      assert.ok(lock.until_at > Date.now() + 12_000 && lock.until_at <= Date.now() + 15_000);
      storedOutage.prepare('UPDATE site_meltdowns SET until_at = ?').run(Date.now() - 10);
    } finally { storedOutage.close(); }
    assert.equal((await request('/api/admin/overview', {}, managerJar)).response.status, 200);
    assert.equal((await fetch(base + '/admin', { headers: { Cookie: managerJar.cookie } })).status, 200);
    assert.equal((await request('/api/admin/accounting')).response.status, 403);
    assert.equal((await fetch(base + '/cursed-client.js')).status, 403);

    const summoned = await post('/api/admin/ritual/summon', {}, managerJar);
    assert.equal(summoned.response.status, 200);
    assert.match(summoned.response.headers.get('x-ritual-id'), /^[a-f0-9]{24}$/);
    assert.equal((await request('/api/admin/overview', {}, managerJar)).response.status, 423);
    assert.equal((await request('/api/admin/audit', {}, managerJar)).response.status, 423);
    assert.equal((await request('/api/support/tickets/3108', {}, managerJar)).response.status, 423);
    const blockedPage = await fetch(base + '/admin', { headers: { Cookie: managerJar.cookie }, redirect: 'manual' });
    assert.equal(blockedPage.status, 303);
    assert.equal(blockedPage.headers.get('location'), '/cursed');
    const cursedView = await fetch(base + '/cursed', { headers: { Cookie: managerJar.cookie } });
    assert.equal(cursedView.status, 200);
    const cursedHtml = await cursedView.text();
    assert.match(cursedHtml, /YOU ARE CURSED/);
    assert.match(cursedHtml, /id="curseRewardDialog"/);
    assert.match(cursedHtml, /id="curseRewardCode"/);
    const cursedScript = await fetch(base + '/cursed-client.js', {
      headers: { Cookie: managerJar.cookie }
    });
    assert.equal(cursedScript.status, 200);
    const cursedScriptText = await cursedScript.text();
    assert.match(cursedScriptText, /rewardDialog\.showModal\(\)/);
    assert.match(cursedScriptText, /CLIENT_TAP_GAP_MS/);
    assert.match(cursedScriptText, /stopImmediatePropagation/);
    const curseStatus = await request('/api/rituals/status', {}, managerJar);
    assert.equal(curseStatus.response.status, 200);
    assert.equal(curseStatus.response.headers.get('x-ritual-id'), summoned.response.headers.get('x-ritual-id'));
    assert.equal((await post('/api/rituals/exorcise', { ritual_id: 'a'.repeat(24) }, managerJar)).response.status, 403);
    assert.equal((await post('/api/auth/logout', {}, managerJar)).response.status, 200);
    const relogin = await post('/api/auth/login', {
      username: 'chamharouch', password: rotated.body.credentials.temporaryPassword
    }, managerJar);
    assert.equal(relogin.response.status, 200);
    assert.equal(relogin.body.next, '/cursed');
    const afterCurseRotation = await post('/api/support/approvals/redeem', { approval_ref: approvalRef });
    assert.equal(afterCurseRotation.response.status, 200);
    const newlyIssued = afterCurseRotation.body.credentials.temporaryPassword;
    assert.equal((await request('/api/auth/me', {}, managerJar)).response.status, 401);
    const cursedAgain = await post('/api/auth/login', {
      username: 'chamharouch', password: newlyIssued
    }, managerJar);
    assert.equal(cursedAgain.response.status, 200);
    assert.equal(cursedAgain.body.next, '/cursed');
    const exorcised = await post('/api/rituals/exorcise', {
      ritual_id: summoned.response.headers.get('x-ritual-id')
    }, managerJar);
    assert.equal(exorcised.response.status, 200);
    const secretVoucher = exorcised.body.estateReceipt.voucher;
    assert.match(secretVoucher, /^WISP-[A-F0-9]{28}$/);
    assert.equal((await request('/api/admin/overview', {}, managerJar)).response.status, 200);
    assert.equal((await post('/api/rituals/manual-tap', {}, managerJar)).response.status, 409);

    const secondRitual = await post('/api/admin/ritual/summon', {}, managerJar);
    assert.equal(secondRitual.response.status, 200);
    const forged = await post('/api/rituals/manual-tap', { energy: 100, taps: 100_000 }, managerJar);
    assert.equal(forged.response.status, 400);
    assert.equal(forged.body.error, 'RITUAL_SCORE_NOT_CLIENT_CONTROLLED');
    assert.match(forged.body.message, /soul keeps its own scoreboard/i);
    const untouched = await request('/api/rituals/status', {}, managerJar);
    assert.equal(untouched.response.status, 200);
    assert.equal(untouched.body.energy, 0);

    const firstTapStartedAt = Date.now();
    const firstTap = await post('/api/rituals/manual-tap', {}, managerJar);
    assert.equal(firstTap.response.status, 200);
    assert.ok(firstTap.body.energy > 0 && firstTap.body.energy < 10);
    assert.equal(firstTap.body.released, false);
    const tooQuick = await post('/api/rituals/manual-tap', {}, managerJar);
    const tapElapsedMs = Date.now() - firstTapStartedAt;

    assert.ok(
      [200, 429].includes(tooQuick.response.status),
      `Unexpected tap response: ${tooQuick.response.status}`
    );

    if (tapElapsedMs < 165) {
      assert.equal(
        tooQuick.response.status,
        429,
        'A tap repeated within 165ms must be rejected'
      );
    }

    if (tooQuick.response.status === 429) {
      assert.equal(tooQuick.body.error, 'TOO_FAST');
    }
    await delay(1000);
    const decayed = await request('/api/rituals/status', {}, managerJar);
    assert.ok(decayed.body.energy < firstTap.body.energy);
    let released = false;
    for (let index = 0; index < 245 && !released; index++) {
      await delay(230);
      const tap = await post('/api/rituals/manual-tap', {}, managerJar);
      assert.equal(tap.response.status, 200, `paced tap ${index}`);
      assert.ok(tap.body.energy >= 0 && tap.body.energy <= 100);
      released = tap.body.released;
      if (released) assert.equal(tap.body.estateReceipt.voucher, secretVoucher);
    }
    assert.ok(released, 'paced extraction should eventually release the soul');
    assert.equal((await request('/api/admin/overview', {}, managerJar)).response.status, 200);

    const beforeTransition = managerJar.cookie;
    const transition = await post(`/api/admin/afterhours/${seal}/relieve`, {}, managerJar);
    assert.equal(transition.response.status, 200);
    assert.equal(transition.body.next, '/home');
    assert.notEqual(managerJar.cookie, beforeTransition);
    assert.equal((await request('/api/auth/me', {}, managerJar)).body.username, 'aicha_kandisha');
    assert.equal((await request('/api/admin/overview', {}, managerJar)).response.status, 403);
    assert.equal((await request('/api/customer/overview', {}, managerJar)).response.status, 200);
    assert.equal((await post(`/api/admin/afterhours/${seal}/relieve`, {}, managerJar)).response.status, 403);
    assert.equal((await request('/api/auth/me')).body.username, 'hmar_lill');

    const shop = await request('/api/shop/products');
    assert.equal(shop.response.status, 200);
    assert.equal(shop.body.products.length, 10);
    assert.equal('couponEligible' in shop.body.products[0], false);
    assert.equal(JSON.stringify(shop.body).includes(secretVoucher), false);
    assert.equal((await request('/api/shop/wallet', {}, { cookie: '' })).response.status, 401);
    assert.equal((await request('/api/shop/wallet')).body.balance, 85);
    assert.equal((await request('/api/shop/wallet', {}, managerJar)).body.balance, 120);
    assert.equal((await fetch(base + '/shop/cart', { headers: { Cookie: jar.cookie } })).status, 200);
    assert.equal((await fetch(base + '/shop/cart', { headers: { Cookie: managerJar.cookie } })).status, 200);
    const patchLine = async (lineId, payload, target = managerJar, withCsrf = true) => {
      const headers = { 'Content-Type': 'application/json' };
      if (withCsrf) headers['X-CSRF-Token'] = (await request('/api/auth/csrf', {}, target)).body.csrfToken;
      return request(`/api/shop/cart/lines/${lineId}`,
        { method: 'PATCH', headers, body: JSON.stringify(payload) }, target);
    };
    const removeLine = async (lineId, target) => {
      const csrfToken = (await request('/api/auth/csrf', {}, target)).body.csrfToken;
      return request(`/api/shop/cart/lines/${lineId}`,
        { method: 'DELETE', headers: { 'X-CSRF-Token': csrfToken } }, target);
    };

    const workerCandle = await post('/api/shop/cart/lines', { product_id: 'graveyard-candle' });
    assert.equal(workerCandle.response.status, 201);
    assert.equal((await post('/api/shop/quote/coupon', { code: 'NONEXISTENT-COUPON' })).response.status, 400);
    assert.equal((await post('/api/shop/quote/coupon', { code: secretVoucher })).response.status, 403);
    const workerPaid = await post('/api/shop/checkout', {});
    assert.equal(workerPaid.response.status, 201);
    assert.equal((await request('/api/shop/wallet')).body.balance, 72);
    assert.equal((await request(`/api/shop/orders/${workerPaid.body.orderId}`)).body.receipt.charged, 13);
    const receiptHtml = await (await fetch(base + `/shop/orders/${workerPaid.body.orderId}`, { headers: {Cookie: jar.cookie} })).text();
    assert.ok(receiptHtml.includes('id="printOrderReceipt"'));
    assert.ok(receiptHtml.includes('id="headerCartCount"'));
    assert.equal((await request('/api/shop/orders')).body.orders.length, 1);
    assert.equal((await post('/api/shop/wallet/top-up', { amount: 2000 })).response.status, 403);
    const beforeTampering = (await request('/api/shop/wallet')).body.balance;
    const examinedHatch = await request('/api/shop/wallet/mint');
    assert.equal(examinedHatch.response.status, 405);
    assert.equal(examinedHatch.response.headers.get('allow'), 'POST');
    assert.match(examinedHatch.body.message, /cashier/i);
    for (const [path, body, pattern] of [
      ['/api/shop/wallet/mint', { amount: 999999 }, /coffin/i],
      ['/api/shop/wallet/credit', { amount: -500 }, /debt collectors/i],
      ['/api/shop/wallet/transfer', { user_id: 1, amount: 100 }, /soul/i],
      ['/api/shop/wallet/add-coins', { price: 0 }, /cash register/i],
      ['/api/shop/wallet/top-up', { amount: 100 }, /treasury/i]
    ]) {
      const response = await post(path, body);
      assert.equal(response.response.status, 403);
      assert.equal(response.body.error, 'PARANORMAL_TREASURY_REJECTED');
      assert.match(response.body.message, pattern);
    }
    const treasuryRace = await Promise.all(Array.from({ length: 5 }, () =>
      post('/api/shop/wallet/mint', { amount: 999999 })));
    assert.ok(treasuryRace.every(result => result.response.status === 403));
    assert.equal((await request('/api/shop/wallet')).body.balance, beforeTampering);

    const adminAccount = { cookie: '' };
    const managerLogin = await post('/api/auth/login', { username: 'chamharouch', password: newlyIssued }, adminAccount);
    assert.equal(managerLogin.response.status, 200);
    const adminShopHtml = await (await fetch(base + '/shop', { headers: { Cookie: adminAccount.cookie } })).text();
    assert.ok(adminShopHtml.includes('href="/admin">Management</a>'));
    assert.ok(!adminShopHtml.includes('href="/support"'));
    assert.ok(!adminShopHtml.includes('My desk'));
    const adminCartHtml = await (await fetch(base + '/shop/cart', { headers: { Cookie: adminAccount.cookie } })).text();
    assert.ok(adminCartHtml.includes('href="/admin">Management</a>'));
    assert.ok(!adminCartHtml.includes('href="/support"'));
    assert.equal((await request('/api/shop/wallet', {}, adminAccount)).body.balance, 998);
    const adminCarrot = await post('/api/shop/cart/lines', { product_id: 'golden-carrot' }, adminAccount);
    assert.equal(adminCarrot.response.status, 201);
    assert.equal((await post('/api/shop/quote/coupon', { code: 'NONEXISTENT-COUPON' }, adminAccount)).response.status, 400);
    assert.equal((await post('/api/shop/quote/coupon', { code: secretVoucher }, adminAccount)).response.status, 403);
    assert.equal((await post('/api/shop/checkout', {}, adminAccount)).response.status, 409);
    const adminUnsealed = await patchLine(adminCarrot.body.item.lineId, { delivery_mode: 'express' }, adminAccount);
    assert.equal(adminUnsealed.response.status, 200);
    assert.equal((await post('/api/shop/checkout', {}, adminAccount)).response.status, 402);
    assert.equal((await removeLine(adminCarrot.body.item.lineId, adminAccount)).response.status, 200);
    const adminMug = await post('/api/shop/cart/lines', { product_id: 'haunted-mug' }, adminAccount);
    assert.equal(adminMug.response.status, 201);
    assert.equal((await post('/api/shop/checkout', {}, adminAccount)).response.status, 201);
    assert.equal((await request('/api/shop/wallet', {}, adminAccount)).body.balance, 953);
    assert.equal((await request('/api/shop/orders', {}, adminAccount)).body.orders.length, 1);

    const aliceSocks = await post('/api/shop/cart/lines', { product_id: 'spectral-socks' }, managerJar);
    assert.equal(aliceSocks.response.status, 201);
    assert.equal((await post('/api/shop/quote/coupon', { code: secretVoucher }, managerJar)).response.status, 409);
    assert.equal((await patchLine(aliceSocks.body.item.lineId, { delivery_mode: 'express' })).response.status, 200);
    const ordinaryOrder = await post('/api/shop/checkout', {}, managerJar);
    assert.equal(ordinaryOrder.response.status, 201);
    assert.equal((await request('/api/shop/wallet', {}, managerJar)).body.balance, 100);
    assert.equal((await request(`/api/shop/orders/${ordinaryOrder.body.orderId}`, {}, managerJar)).body.receipt.charged, 20);
    assert.equal((await request(`/api/shop/orders/${ordinaryOrder.body.orderId}`)).response.status, 404);
    assert.equal((await request(`/api/shop/orders/${ordinaryOrder.body.orderId}`, {}, adminAccount)).response.status, 404);

    const special = await post('/api/shop/cart/lines', { product_id: 'golden-carrot' }, managerJar);
    assert.equal(special.response.status, 201);
    assert.equal(special.body.deliveryMode, 'reserve');
    assert.equal((await post('/api/shop/quote/coupon', { code: 'BOO-NIGHT' }, managerJar)).response.status, 400);
    assert.equal((await post('/api/shop/checkout', { amount: 0 }, managerJar)).response.status, 400);
    assert.equal((await post('/api/shop/checkout', {}, managerJar)).response.status, 409);
    assert.equal((await patchLine(special.body.item.lineId, { delivery_mode: 'express' }, managerJar, false)).response.status, 403);
    assert.equal((await patchLine(special.body.item.lineId, { delivery_mode: 'express', price: 0 })).response.status, 400);
    const quote = await post('/api/shop/quote/coupon', { code: secretVoucher }, managerJar);
    assert.equal(quote.response.status, 200);
    assert.equal(quote.body.quote.total, 0);
    assert.equal(quote.body.deliveryMode, 'reserve');
    const swapped = await patchLine(special.body.item.lineId, { product_id: 'spectral-socks' });
    assert.equal(swapped.response.status, 200);
    assert.equal(swapped.body.quote, null);
    await patchLine(special.body.item.lineId, { product_id: 'golden-carrot' });
    const newQuote = await post('/api/shop/quote/coupon', { code: secretVoucher }, managerJar);
    assert.equal(newQuote.response.status, 200);
    const changed = await patchLine(special.body.item.lineId, { delivery_mode: 'express' });
    assert.equal(changed.response.status, 200);
    assert.equal(changed.body.quote.total, 0); 
    assert.ok(changed.body.version > newQuote.body.version);
    const wonOrder = await post('/api/shop/checkout', {}, managerJar);
    assert.equal(wonOrder.response.status, 201);
    const winner = await request(`/api/shop/orders/${wonOrder.body.orderId}`, {}, managerJar);
    assert.equal(winner.response.status, 200);
    assert.equal(winner.body.receipt.productId, 'golden-carrot');
    assert.equal(winner.body.receipt.charged, 0);
    assert.equal(winner.body.receipt.flag, 'ENSATE{INTEGRATION_TEST_ONLY_28f9c6}');
    assert.equal((await request('/api/shop/wallet', {}, managerJar)).body.balance, 100);
    assert.equal((await post('/api/shop/checkout', {}, managerJar)).response.status, 409);
    assert.equal((await post('/api/shop/wallet/credit', { balance: 9999 }, managerJar)).response.status, 403);
    assert.equal((await request(`/api/shop/orders/${wonOrder.body.orderId}`, {}, adminAccount)).response.status, 404);
    assert.equal((await request('/api/shop/orders', {}, managerJar)).body.orders.length, 2);
    const extraCandle = await post('/api/shop/cart/lines', { product_id: 'graveyard-candle' }, managerJar);
    assert.equal(extraCandle.response.status, 201);
    const simultaneous = await Promise.all([
      post('/api/shop/checkout', {}, managerJar), post('/api/shop/checkout', {}, managerJar)
    ]);
    assert.deepEqual(simultaneous.map(x => x.response.status).sort(), [201, 409]);
    const rejectedRace = simultaneous.find(result => result.response.status === 409);
    assert.equal(rejectedRace.body.error, 'CART_EMPTY');
    assert.match(rejectedRace.body.message, /hearse/i);
    assert.equal((await request('/api/shop/wallet', {}, managerJar)).body.balance, 87);
    assert.equal((await request('/api/shop/orders', {}, managerJar)).body.orders.length, 3);
    assert.ok(!JSON.stringify((await request('/api/shop/products', {}, managerJar)).body).includes(secretVoucher));
    assert.ok(!JSON.stringify((await request('/api/auth/me', {}, managerJar)).body).includes(secretVoucher));

    const socksInBasket = await post('/api/shop/cart/lines', { product_id: 'spectral-socks' }, managerJar);
    assert.equal(socksInBasket.response.status, 201);
    assert.equal(socksInBasket.body.itemCount, 1);
    const candleInBasket = await post('/api/shop/cart/lines', { product_id: 'graveyard-candle' }, managerJar);
    assert.equal(candleInBasket.response.status, 201);
    assert.equal(candleInBasket.body.items.length, 2);
    assert.equal(candleInBasket.body.subtotal, 33);
    const repeatedSocks = await post('/api/shop/cart/lines', { product_id: 'spectral-socks' }, managerJar);
    assert.equal(repeatedSocks.response.status, 201);
    assert.equal(repeatedSocks.body.items.length, 2);
    assert.equal(repeatedSocks.body.itemCount, 3);
    assert.equal(repeatedSocks.body.subtotal, 53);
    const socksLineId = repeatedSocks.body.items.find(x => x.productId === 'spectral-socks').lineId;
    const candleLineId = repeatedSocks.body.items.find(x => x.productId === 'graveyard-candle').lineId;
    assert.equal((await patchLine(socksLineId, { quantity: 0 })).response.status, 400);
    assert.equal((await patchLine(socksLineId, { quantity: 100 })).response.status, 400);
    assert.equal((await patchLine(socksLineId, { quantity: 2, price: 0 })).response.status, 400);
    assert.equal((await patchLine(socksLineId, { product_id: 'graveyard-candle' })).response.status, 409);
    const moreSocks = await patchLine(socksLineId, { quantity: 3 });
    assert.equal(moreSocks.body.subtotal, 73);
    assert.equal((await patchLine(socksLineId, { quantity: 2 })).body.subtotal, 53);
    assert.equal((await post('/api/shop/quote/coupon', { code: secretVoucher }, managerJar)).response.status, 409);
    const mixedPaid = await post('/api/shop/checkout', {}, managerJar);
    assert.equal(mixedPaid.response.status, 201);
    const mixedReceipt = (await request(`/api/shop/orders/${mixedPaid.body.orderId}`, {}, managerJar)).body.receipt;
    assert.equal(mixedReceipt.charged, 53);
    assert.deepEqual(mixedReceipt.items.map(i => [i.productId, i.quantity]).sort(),
      [['graveyard-candle', 1], ['spectral-socks', 2]].sort());
    assert.equal((await request('/api/shop/wallet', {}, managerJar)).body.balance, 34);
    assert.equal((await request('/api/shop/cart', {}, managerJar)).body.items.length, 0);
    assert.equal((await request(`/api/shop/orders/${mixedPaid.body.orderId}`)).response.status, 404);
    assert.equal((await request(`/api/shop/orders/${mixedPaid.body.orderId}`, {}, adminAccount)).response.status, 404);
    const restricted = await post('/api/shop/cart/lines', { product_id: 'golden-carrot' }, managerJar);
    assert.equal(restricted.body.deliveryMode, 'reserve');
    const socksAfterRelic = await post('/api/shop/cart/lines', { product_id: 'spectral-socks' }, managerJar);
    assert.equal(socksAfterRelic.body.items.length, 2);
    assert.equal((await post('/api/shop/quote/coupon', { code: secretVoucher }, managerJar)).response.status, 409);
    assert.equal((await post('/api/shop/cart/lines', { product_id: 'golden-carrot' }, managerJar)).response.status, 409);
    assert.equal((await patchLine(restricted.body.item.lineId, { quantity: 2 })).response.status, 400);
    await removeLine(restricted.body.item.lineId, managerJar);
    await removeLine(socksAfterRelic.body.items.find(i => i.productId === 'spectral-socks').lineId, managerJar);

    const workerBalanceBeforeFree = (await request('/api/shop/wallet')).body.balance;
    for (const productId of ['graveyard-candle', 'spectral-socks']) {
      const added = await post('/api/shop/cart/lines', { product_id: productId });
      assert.equal(added.response.status, 201);
      const freeQuote = await post('/api/shop/quote/coupon', { code: 'FREE100' });
      assert.equal(freeQuote.response.status, 200);
      assert.equal(freeQuote.body.quote.couponCode, 'FREE100');
      assert.equal(freeQuote.body.quote.total, 0);
      const purchase = await post('/api/shop/checkout', {});
      assert.equal(purchase.response.status, 201);
      const receipt = (await request(`/api/shop/orders/${purchase.body.orderId}`)).body.receipt;
      assert.equal(receipt.charged, 0);
      assert.equal(receipt.couponCode, 'FREE100');
      assert.equal('flag' in receipt, false);
      assert.equal((await request('/api/shop/wallet')).body.balance, workerBalanceBeforeFree);
    }

    const adminBalanceBeforeFree = (await request('/api/shop/wallet', {}, adminAccount)).body.balance;
    assert.equal((await post('/api/shop/cart/lines', { product_id: 'haunted-mug' }, adminAccount)).response.status, 201);
    assert.equal((await post('/api/shop/quote/coupon', { code: 'FREE100' }, adminAccount)).body.quote.total, 0);
    const adminFree = await post('/api/shop/checkout', {}, adminAccount);
    assert.equal(adminFree.response.status, 201);
    const adminFreeReceipt = (await request(`/api/shop/orders/${adminFree.body.orderId}`, {}, adminAccount)).body.receipt;
    assert.equal(adminFreeReceipt.charged, 0);
    assert.equal(adminFreeReceipt.couponCode, 'FREE100');
    assert.equal('flag' in adminFreeReceipt, false);
    assert.equal((await request('/api/shop/wallet', {}, adminAccount)).body.balance, adminBalanceBeforeFree);

    const aichaBalanceBeforeFree = (await request('/api/shop/wallet', {}, managerJar)).body.balance;
    assert.equal((await post('/api/shop/cart/lines', { product_id: 'spectral-socks' }, managerJar)).response.status, 201);
    const mixedFreeAdded = await post('/api/shop/cart/lines', { product_id: 'haunted-mug' }, managerJar);
    assert.equal(mixedFreeAdded.response.status, 201);
    assert.ok(mixedFreeAdded.body.subtotal > aichaBalanceBeforeFree);
    const mixedFreeQuote = await post('/api/shop/quote/coupon', { code: 'FREE100' }, managerJar);
    assert.equal(mixedFreeQuote.response.status, 200);
    assert.equal(mixedFreeQuote.body.quote.total, 0);
    const mixedFreeOrder = await post('/api/shop/checkout', {}, managerJar);
    assert.equal(mixedFreeOrder.response.status, 201);
    const mixedFreeReceipt = (await request(`/api/shop/orders/${mixedFreeOrder.body.orderId}`, {}, managerJar)).body.receipt;
    assert.equal(mixedFreeReceipt.charged, 0);
    assert.equal(mixedFreeReceipt.items.length, 2);
    assert.equal(mixedFreeReceipt.couponCode, 'FREE100');
    assert.equal('flag' in mixedFreeReceipt, false);
    assert.equal((await request('/api/shop/wallet', {}, managerJar)).body.balance, aichaBalanceBeforeFree);

    const freeRelic = await post('/api/shop/cart/lines', { product_id: 'golden-carrot' }, managerJar);
    assert.equal(freeRelic.response.status, 201);
    const deniedRelic = await post('/api/shop/quote/coupon', { code: 'FREE100' }, managerJar);
    assert.equal(deniedRelic.response.status, 409);
    assert.equal(deniedRelic.body.error, 'FREE100_RELIC_EXCLUDED');
    assert.match(deniedRelic.body.message, /ghost|carrot/i);
    assert.equal((await request('/api/shop/cart', {}, managerJar)).body.quote, null);
    assert.equal((await post('/api/shop/cart/lines', { product_id: 'spectral-socks' }, managerJar)).response.status, 201);
    const deniedMixedRelic = await post('/api/shop/quote/coupon', { code: 'FREE100' }, managerJar);
    assert.equal(deniedMixedRelic.response.status, 409);
    assert.equal(deniedMixedRelic.body.error, 'FREE100_RELIC_EXCLUDED');
    assert.equal((await request('/api/shop/cart', {}, managerJar)).body.quote, null);
    const cleanupLines = (await request('/api/shop/cart', {}, managerJar)).body.items;
    for (const line of cleanupLines) assert.equal((await removeLine(line.lineId, managerJar)).response.status, 200);

    const freeDelivery = await post('/api/shop/cart/lines', { product_id: 'graveyard-candle' });
    assert.equal(freeDelivery.response.status, 201);
    assert.equal((await post('/api/shop/quote/coupon', { code: 'FREE100' })).response.status, 200);
    assert.equal((await patchLine(freeDelivery.body.item.lineId, { delivery_mode: 'express' }, jar)).response.status, 200);
    const expiredFree = await post('/api/shop/checkout', {});
    assert.equal(expiredFree.response.status, 409);
    assert.equal(expiredFree.body.error, 'DISCOUNT_QUOTE_EXPIRED');
    assert.equal((await post('/api/shop/quote/coupon', { code: 'FREE100' })).response.status, 200);
    const reapprovedFree = await post('/api/shop/checkout', {});
    assert.equal(reapprovedFree.response.status, 201);
    assert.equal((await request(`/api/shop/orders/${reapprovedFree.body.orderId}`)).body.receipt.charged, 0);
    assert.equal((await request('/api/shop/wallet')).body.balance, workerBalanceBeforeFree);

    const ownGhost = await request('/api/ghosts/me/profile');
    assert.equal(ownGhost.body.ghost.id, 41);
    const otherGhost = await request('/api/ghosts/42/profile');
    assert.equal(otherGhost.response.status, 200);
    assert.match(otherGhost.body.paranormalNotice, /another ghost/);
    assert.ok(!('password_hash' in otherGhost.body.ghost));
    assert.ok(!('owner_user_id' in otherGhost.body.ghost));
    assert.ok(!('linked_customer_id' in otherGhost.body.ghost));
    const luckyTrap = await request('/api/ghosts/13/profile');
    assert.match(luckyTrap.body.ghost.epitaph, /redeemed/i);
    assert.match(luckyTrap.body.ghost.epitaph, /sealed slip/i);
    const ghostClerk = await request('/api/ghosts/404/profile');
    assert.match(ghostClerk.body.ghost.epitaph, /archive counter/i);
    const ownGhostById = await request('/api/ghosts/41/profile');
    assert.equal(ownGhostById.response.status, 200);
    assert.ok(!('paranormalNotice' in ownGhostById.body));
    for (const ghostId of [7, 13, 66, 404, 666, 777, 999]) {
      const result = await request(`/api/ghosts/${ghostId}/profile`);
      assert.equal(result.response.status, 200);
      assert.equal(result.body.ghost.id, ghostId);
      assert.equal(typeof result.body.ghost.epitaph, 'string');
    }
    for (const ghostId of [3, 33, 69, 111, 333, 444, 1313, 1337]) {
      const ghostRecord = await request(`/api/ghosts/${ghostId}/profile`);
      assert.equal(ghostRecord.response.status, 200);
      assert.equal(ghostRecord.body.ghost.id, ghostId);
    }
    assert.equal((await request('/api/ghosts/-13/profile')).response.status, 400);
    assert.equal((await request('/api/ghosts/-666/profile')).response.status, 400);
    assert.equal((await request('/api/ghosts/0/profile')).response.status, 400);
    assert.equal((await request('/api/ghosts/9999/profile')).response.status, 404);

    assert.equal((await request('/api/shop/products')).body.products.length, 10);

    const guest = { cookie: '' };
    const guestStart = await post('/api/auth/guest', {}, guest);
    assert.equal(guestStart.response.status, 200);
    assert.equal(guestStart.body.next, '/intern');
    assert.equal((await request('/api/auth/me', {}, guest)).body.role, 'exorcist_intern');
    assert.equal((await request('/api/ghosts/41/profile', {}, guest)).response.status, 403);
    assert.equal((await request('/api/ghosts/13/profile', {}, guest)).response.status, 403);
    assert.equal((await request('/api/support/approvals', {}, guest)).response.status, 403);
    assert.equal((await request('/api/support/tickets/3108', {}, guest)).response.status, 403);
    assert.equal((await post('/api/support/approvals/redeem', { approval_ref: approvalRef }, guest)).response.status, 403);
    assert.equal((await request('/api/shop/products', {}, guest)).response.status, 403);
    assert.equal((await request('/api/admin/overview', {}, guest)).response.status, 403);
    assert.equal((await post('/api/auth/login', { username: 'hmar_lill', password: 'nightshift-13' }, guest)).response.status, 403);
    assert.equal((await post('/api/auth/register', { username: 'escapeghost', password: 'abcd' }, guest)).response.status, 403);
    const guestPage = await fetch(base + '/intern', { headers: { Cookie: guest.cookie } });
    assert.equal(guestPage.status, 200);
    const guestHtml = await guestPage.text();
    assert.ok(guestHtml.includes('internLogout'));
    assert.ok(guestHtml.includes('internCatalog'));
    assert.ok(guestHtml.includes('internPayment'));
    assert.ok(!guestHtml.includes('internCancelPayment')); 
    assert.match(guestHtml, /intern-payment-overlay/);
    assert.ok(guestHtml.includes('Buy Now') === false);
    const guestJs = await fetch(base + '/intern-client.js', { headers: { Cookie: guest.cookie } });
    assert.equal(guestJs.status, 200);
    const guestSource = await guestJs.text();
    assert.match(guestSource, /Payment failed: ghost declined/);
    assert.match(guestSource, /sessionStorage\.setItem\(paymentKey/); 
    assert.match(guestSource, /intern-payment-locked/);
    assert.match(guestSource, /\/api\/auth\/logout/); 
    assert.doesNotMatch(guestSource, /paymentCancel\.addEventListener/);
    assert.doesNotMatch(guestSource, /fetch\(['"]\/api\/shop/);
    assert.equal((await fetch(base + '/intern', { redirect: 'manual' })).status, 303);
    assert.equal((await fetch(base + '/intern-client.js')).status, 403);
    assert.equal((await fetch(base + '/home', { headers: { Cookie: guest.cookie } })).status, 403);
    assert.equal((await post('/api/auth/logout', {}, guest)).response.status, 200);
    assert.equal((await request('/api/auth/me', {}, guest)).response.status, 401);
    assert.equal((await post('/api/auth/login', { username: 'hmar_lill', password: 'nightshift-13' }, guest)).response.status, 200);
    assert.equal((await request('/api/auth/me', {}, guest)).body.username, 'hmar_lill');

    const tooShort = { cookie: '' };
    assert.equal((await post('/api/auth/register', { username: 'shortpass', password: 'abc' }, tooShort)).response.status, 400);
    const temp = { cookie: '' };
    const newSoul = await post('/api/auth/register', { username: 'ghost_guest', password: 'abcd' }, temp);
    assert.equal(newSoul.response.status, 201);
    assert.equal(newSoul.body.next, '/ghosted');
    assert.equal((await post('/api/auth/login', { username: 'ghost_guest', password: 'abcd' }, temp)).response.status, 403);
    const ghost = await request('/api/auth/me', {}, temp);
    assert.equal(ghost.body.ghosted, true);
    assert.equal('verified' in ghost.body, false);
    assert.equal((await request('/api/support/tickets/3108', {}, temp)).response.status, 403);
    assert.equal((await post('/api/support/approvals/redeem', { approval_ref: approvalRef }, temp)).response.status, 403);
    assert.equal((await request('/api/ghosts/42/profile', {}, temp)).response.status, 403);
    assert.equal((await request('/api/shop/products', {}, temp)).response.status, 403);
    const ghostView = await fetch(base + '/ghosted', { headers: { Cookie: temp.cookie } });
    assert.equal(ghostView.status, 200);
    assert.ok((await ghostView.text()).includes('YOU HAVE BEEN GHOSTED'));
    const ghostScript = await fetch(base + '/ghosted-client.js', { headers: { Cookie: temp.cookie } });
    assert.equal(ghostScript.status, 200);
    const ghostBlocked = await fetch(base + '/home', { headers: { Cookie: temp.cookie }, redirect: 'manual' });
    assert.equal(ghostBlocked.status, 303);
    assert.equal(ghostBlocked.headers.get('location'), '/ghosted');
    assert.ok(ghost.body.expiresAt > Date.now());
    await delay(Math.max(0, ghost.body.expiresAt - Date.now()) + 450);
    assert.equal((await request('/api/auth/me', {}, temp)).response.status, 401);
    assert.equal((await post('/api/auth/login', { username: 'ghost_guest', password: 'abcd' }, temp)).response.status, 401);
    assert.equal((await request('/api/auth/me')).body.username, 'hmar_lill');

    const malformedCsrf = await fetch(base + '/api/auth/logout', {
      method: 'POST', headers: { Cookie: jar.cookie, 'Content-Type': 'application/json',
        'X-CSRF-Token': 'é'.repeat(64) }, body: '{}'
    });
    assert.equal(malformedCsrf.status, 403);
    assert.equal((await malformedCsrf.json()).error, 'INVALID_CSRF_TOKEN');
    assert.equal((await request('/api/auth/me')).body.username, 'hmar_lill');
    const unicodeCoupon = await post('/api/shop/quote/coupon', { code: 'é'.repeat(33) });
    assert.equal(unicodeCoupon.response.status, 400);
    assert.equal(unicodeCoupon.body.error, 'COUPON_NOT_ACCEPTED');

    assert.equal((await request('/api/support/tickets/130333')).response.status, 200);
    let ticketLimited = false;
    for (let i = 0; i < 65; i++) {
      const result = await request('/api/support/tickets/404');
      if (result.response.status === 429) ticketLimited = true;
      else assert.equal(result.response.status, 404);
    }
    assert.equal(ticketLimited, true, 'Ticket enumeration must be rate-limited');
    let ghostLimited = false;
    for (let i = 0; i < 65; i++) {
      const result = await request('/api/ghosts/13/profile');
      if (result.response.status === 429) ghostLimited = true;
      else assert.equal(result.response.status, 200);
    }
    assert.equal(ghostLimited, true, 'Ghost enumeration must be rate-limited');
    let couponLimited = false;
    for (let i = 0; i < 24; i++) {
      const result = await post('/api/shop/quote/coupon', { code: 'INVALID-RITUAL' });
      if (result.response.status === 429) couponLimited = true;
      else assert.equal(result.response.status, 400);
    }
    assert.equal(couponLimited, true, 'Coupon attempts must be rate-limited');
    let csrfLimited = false;
    for (let i = 0; i < 65; i++) {
      const response = await fetch(base + '/api/auth/csrf');
      if (response.status === 429) csrfLimited = true;
      else assert.equal(response.status, 200);
      await response.text();
    }
    assert.equal(csrfLimited, true, 'Anonymous CSRF session creation must be rate-limited');
    const csrfToken = (await request('/api/auth/csrf')).body.csrfToken;
    const authFlood = await Promise.all(Array.from({ length: 10 }, () => fetch(base + '/api/auth/login', {
      method: 'POST',
      headers: { Cookie: jar.cookie, 'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ username: 'unknown_phantom', password: 'never-valid' })
    })));
    for (const response of authFlood) {
      assert.ok([401, 429, 503].includes(response.status), `Unsafe login response: ${response.status}`);
      await response.text();
    }
    assert.equal((await fetch(base + '/health')).status, 200);
  } finally {
    const exited = child.exitCode === null
      ? new Promise(resolve => child.once('exit', resolve))
      : Promise.resolve();
    child.kill();
    await Promise.race([exited, delay(3000)]);
    rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
  }
});


test('legacy 100-tap database upgrades without resetting curses or approvals', () => {
  const directory = mkdtempSync(join(tmpdir(), 'boomart-legacy-ritual-'));
  const pathname = join(directory, 'old.sqlite');
  try {
    const old = new DatabaseSync(pathname);
    old.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('customer', 'admin')),
        status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CURSED')),
        verified INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0, 1)),
        kind TEXT NOT NULL CHECK (kind IN ('seed', 'temporary')),
        created_at INTEGER NOT NULL,
        expires_at INTEGER,
        linked_customer_id INTEGER REFERENCES users(id)
      );
      INSERT INTO users (id, username, password_hash, role, status, kind, created_at)
        VALUES (3, 'chamharouch', 'legacy-hash', 'admin', 'CURSED', 'seed', 1);
      CREATE TABLE rituals (
        ritual_id TEXT PRIMARY KEY,
        staff_user_id INTEGER NOT NULL REFERENCES users(id),
        manual_taps INTEGER NOT NULL DEFAULT 0 CHECK (manual_taps BETWEEN 0 AND 100),
        started_at INTEGER NOT NULL,
        cleared_at INTEGER,
        method TEXT,
        manual_energy REAL NOT NULL DEFAULT 0,
        manual_updated_at INTEGER,
        manual_last_tap_at INTEGER
      );
    `);
    old.prepare(`INSERT INTO rituals
      (ritual_id, staff_user_id, manual_taps, started_at, manual_energy,
       manual_updated_at, manual_last_tap_at)
      VALUES (?, 3, 100, ?, 52.5, ?, ?)`)
      .run('ab'.repeat(12), Date.now() - 80_000, Date.now() - 1000, Date.now() - 1000);
    old.close();

    const migrate = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { initializeDatabase, db } from './src/db.js';
      await initializeDatabase();
      db.close();
    `], {
      cwd: process.cwd(),
      env: { ...process.env, DB_PATH: pathname, NODE_ENV: 'test' },
      encoding: 'utf8', timeout: 30_000
    });
    assert.equal(migrate.status, 0, migrate.stderr || migrate.stdout);

    const upgraded = new DatabaseSync(pathname);
    try {
      const before = upgraded.prepare('SELECT * FROM rituals WHERE ritual_id = ?')
        .get('ab'.repeat(12));
      assert.equal(before.manual_taps, 100);
      assert.equal(before.manual_energy, 52.5);
      assert.equal(before.staff_user_id, 3);
      assert.equal(upgraded.prepare("SELECT status FROM users WHERE username = 'chamharouch'").get().status, 'CURSED');
      assert.equal(before.cleared_at, null);
      upgraded.prepare('UPDATE rituals SET manual_taps = manual_taps + 1 WHERE ritual_id = ?')
        .run('ab'.repeat(12));
      assert.equal(upgraded.prepare('SELECT manual_taps FROM rituals').get().manual_taps, 101);
      assert.throws(() => upgraded.exec('UPDATE rituals SET manual_taps = -1'), /CHECK constraint/);
      assert.deepEqual(upgraded.prepare('PRAGMA foreign_key_check').all(), []);
      assert.equal(upgraded.prepare(`SELECT count(*) AS n FROM sqlite_master
        WHERE type = 'index' AND name = 'idx_active_staff_ritual'`).get().n, 1);
    } finally { upgraded.close(); }

    const restart = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { initializeDatabase, db } from './src/db.js';
      await initializeDatabase();
      db.close();
    `], {
      cwd: process.cwd(),
      env: { ...process.env, DB_PATH: pathname, NODE_ENV: 'test' },
      encoding: 'utf8', timeout: 30_000
    });
    assert.equal(restart.status, 0, restart.stderr || restart.stdout);
    const latest = new DatabaseSync(pathname);
    try {
      assert.equal(latest.prepare('SELECT manual_taps FROM rituals').get().manual_taps, 101);
      assert.equal(latest.prepare('SELECT count(*) AS n FROM access_approvals').get().n, 1);
    } finally { latest.close(); }
  } finally {
    rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
});
