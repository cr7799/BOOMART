import express from 'express';
import helmet from 'helmet';
import session from 'express-session';
import { rateLimit } from 'express-rate-limit';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { registerRoutes } from './routes.js';
import {
  db, initializeDatabase, SQLiteSessionStore, findUser, findUserById,
  createTemporaryUser, startGhosting, cleanExpiredAccounts,
  hashPassword, verifyPassword, PasswordWorkBusyError
} from './db.js';

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const production = process.env.NODE_ENV === 'production';

function loadSessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (production) throw new Error('Set SESSION_SECRET to at least 32 characters in production.');
  if (process.env.NODE_ENV === 'test') return randomBytes(48).toString('hex');

  const secretPath = fileURLToPath(new URL('../data/.dev-session-secret', import.meta.url));
  mkdirSync(dirname(secretPath), { recursive: true });
  try {
    writeFileSync(secretPath, randomBytes(48).toString('hex'), {
      encoding: 'utf8', mode: 0o600, flag: 'wx'
    });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  return readFileSync(secretPath, 'utf8').trim();
}
const sessionSecret = loadSessionSecret();
if (sessionSecret.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters.');

app.disable('x-powered-by');
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
app.use(helmet());
app.use(express.json({ limit: '16kb' }));
app.use((req, res, next) => {
  const honeyPrice = req.method === 'PUT' && /^\/api\/shop\/products\/[^/]+$/.test(req.path);
  if (req.method === 'TRACE' || req.get('X-HTTP-Method-Override') ||
      (req.method === 'PUT' && !honeyPrice)) {
    return res.status(405).set('Allow', 'GET, POST, PATCH, DELETE').json({
      error: 'NO_METHOD_SUMMONING',
      message: 'The clerk speaks real HTTP, not method-change spells. PUT is a pillow.'
    });
  }
  next();
});
app.use((req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  if (/^(?:application|text)\/(?:xml|[^;]+\+xml)(?:;|$)/i.test(req.get('Content-Type') || '')) {
    return res.status(415).json({ error: 'NO_XML_SEANCES',
      message: 'External entities are not allowed. The internal ones are in therapy.' });
  }
  next();
});
app.use(session({
  name: 'boomart.sid',
  secret: sessionSecret,
  store: new SQLiteSessionStore(),
  resave: false,
  saveUninitialized: false,
  rolling: false,
  cookie: {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.COOKIE_SECURE === '1',
    maxAge: 4 * 60 * 60 * 1000
  }
}));

function destroySession(req) {
  return new Promise((resolve, reject) => {
    req.session.destroy(error => error ? reject(error) : resolve());
  });
}

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate(error => error ? reject(error) : resolve());
  });
}

function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save(error => error ? reject(error) : resolve());
  });
}

app.use((req, res, next) => {
  if (/\b(sqlmap|nikto|gobuster)\b/i.test(req.get('User-Agent') || '')) {
    const sendJson = res.json.bind(res);
    res.json = body => {
      if (res.statusCode >= 400) {
        res.set('X-Old-Ghost', 'The database ghost has attended this party since 2006.');
      }
      return sendJson(body);
    };
  }
  next();
});

app.use((req, res, next) => {
  try {
    req.user = req.session.userId ? findUserById(req.session.userId) : null;
    if (req.user?.kind === 'temporary' && req.user.expires_at != null &&
        req.user.expires_at <= Date.now()) {
      cleanExpiredAccounts();
      req.user = findUserById(req.session.userId);
    }
    if (!req.user && req.session.userId) {
      return destroySession(req).then(() => {
        res.clearCookie('boomart.sid');
        next();
      }).catch(next);
    }
    if (req.user?.role === 'admin') {
      const outage = db.prepare('SELECT until_at FROM site_meltdowns WHERE staff_user_id = ?')
        .get(req.user.id);
      if (outage && outage.until_at > Date.now()) {
        res.set('Cache-Control', 'no-store');
        if (req.path === '/style.css' || req.path.startsWith('/assets/')) return next();
        if (req.path.startsWith('/api/')) {
          return res.status(503).json({
            error: 'EXECUTIVE_CRYPT_COLLAPSED',
            message: 'The executive crypt has collapsed. The building refuses to recognize your badge.'
          });
        }
        return res.status(503).type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>BOOMART | Corporate Ruins</title><link rel="stylesheet" href="/style.css"></head>
<body class="meltdown-page"><main class="meltdown-lock" role="main">
<div class="meltdown-symbol" aria-hidden="true">&#9760;</div>
<p class="eyebrow">THE OFFICE OF UNFINISHED BUSINESS</p>
<h1>THE EXECUTIVE CRYPT HAS FALLEN</h1>
<p>The building has filed a complaint against its occupants.</p>
<p class="meltdown-stamp">OFFICE TEMPORARILY CONDEMNED</p>
</main></body></html>`);
      }
      if (outage) db.prepare('DELETE FROM site_meltdowns WHERE staff_user_id = ?').run(req.user.id);
    }
    req.guest = req.session.guestRole === 'exorcist_intern' && !req.user;
    if (req.user?.kind === 'temporary' && req.path.startsWith('/api/') &&
        !['/api/auth/me', '/api/auth/csrf', '/api/auth/logout'].includes(req.path)) {
      return res.status(403).json({ error: 'GHOSTED_ACCOUNT' });
    }
    if (req.guest && req.path.startsWith('/api/') &&
        !['/api/auth/me', '/api/auth/csrf', '/api/auth/logout'].includes(req.path)) {
      return res.status(403).json({ error: 'INTERN_ACCESS_DENIED', message: 'Interns are only allowed to haunt the lobby.' });
    }
    if (req.user?.status === 'CURSED' && req.path.startsWith('/api/') &&
        !['/api/auth/me', '/api/auth/csrf', '/api/auth/logout',
          '/api/rituals/status', '/api/rituals/exorcise',
          '/api/rituals/manual-tap'].includes(req.path)) {
      return res.status(423).json({ error: 'ACCOUNT_CURSED', message: 'Your soul is locked. The ritual must be broken first.' });
    }
    next();
  } catch (error) { next(error); }
});

function objectContainsKey(value, badKeys, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 8) return false;
  if (Array.isArray(value)) return value.some(item => objectContainsKey(item, badKeys, depth + 1));
  return Object.entries(value).some(([key, item]) => badKeys.has(key) ||
    objectContainsKey(item, badKeys, depth + 1));
}
app.use((req, res, next) => {
  if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method) ||
      !req.path.startsWith('/api/') || !req.body || typeof req.body !== 'object') return next();
  if (objectContainsKey(req.body, new Set(['__proto__', 'constructor', 'prototype']))) {
    return res.status(400).json({ error: 'OBJECT_EXORCISED',
      message: 'Object.prototype was exorcised. Please do not summon it again.' });
  }
  if (objectContainsKey(req.body, new Set(['role', 'admin', 'verified', 'kind', 'balance'])) &&
      !req.path.startsWith('/api/auth/login') &&
      !req.path.startsWith('/api/shop/wallet/')) {
    return res.status(400).json({ error: 'SELF_PROMOTION_REJECTED',
      message: 'Titles are not self-service. HR filed your application under Delusions.' });
  }
  if (req.path !== '/api/auth/login' && req.path !== '/api/auth/register') {
    const values = [];
    function scan(node, depth = 0) {
      if (depth > 8 || values.length >= 100) return;
      if (typeof node === 'string') values.push(node);
      else if (Array.isArray(node)) node.forEach(v => scan(v, depth + 1));
      else if (node && typeof node === 'object') Object.values(node).forEach(v => scan(v, depth + 1));
    }
    scan(req.body);
    if (values.some(v => /\{\{\s*7\s*\*\s*7\s*\}\}|\$\{\s*7\s*\*\s*7\s*\}|<%=|\$\(id\)|`[^`]*`/.test(v))) {
      return res.status(400).json({ error: 'NO_TEMPLATE_ENGINE',
        message: 'The template engine here is a skeleton. It has no templates, only regrets.' });
    }
  }
  next();
});

const anonymousCsrfLimit = rateLimit({
  windowMs: 60_000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false,
  skip: req => Boolean(req.session?.csrfToken),
  handler: (_req, res) => res.status(429).json({
    error: 'TOO_MANY_RITUAL_SCROLLS',
    message: 'The notary has run out of blank protection scrolls.'
  })
});
app.get('/api/auth/csrf', anonymousCsrfLimit, (req, res) => {
  if (!req.session.csrfToken) req.session.csrfToken = randomBytes(32).toString('hex');
  res.set('Cache-Control', 'no-store');
  res.json({ csrfToken: req.session.csrfToken });
});

function requireCsrf(req, res, next) {
  const supplied = req.get('X-CSRF-Token') || '';
  const expected = req.session?.csrfToken || '';
  if (!/^[a-f0-9]{64}$/.test(supplied) || !/^[a-f0-9]{64}$/.test(expected) ||
      !timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(expected, 'hex'))) {
    return res.status(403).json({ error: 'INVALID_CSRF_TOKEN', message: 'The clerk wants the stamp, not a drawing of a stamp.' });
  }
  next();
}

function failedLoginMessage(username, password) {
  const name = username.trim().toLowerCase();
  const secret = password.trim().toLowerCase();
  if (name === 'gravekeeper' && password === 'midnight-1899') {
    return 'That badge belongs to a developer who has been dead since 1899. The crypt has archived your ambition.';
  }
  if ((name === 'admin' && secret === 'admin') ||
      (name === 'root' && (secret === 'root' || secret === 'toor')) ||
      (name === 'administrator' && secret === 'password')) {
    return 'The Great Default Password Plague ended centuries ago. Even our skeleton interns changed their locks.';
  }
  if (['chamharouch', 'aicha_kandisha', 'hmar_lill'].includes(name) &&
      ['chamharouch', 'password', 'hmar_lill'].includes(secret) ||
      ['qwerty', 'halloween'].includes(secret)) {
    return 'Even a ghost would not choose that password. Ghosts value their afterlife.';
  }
  const suspicious = `${username}\n${password}`;
  if (/(?:\bunion\s+(?:all\s+)?select\b|\b(?:or|and)\s+['"`]?\d+['"`]?\s*=\s*['"`]?\d+|\b(?:sleep|benchmark|pg_sleep)\s*\(|\bwaitfor\s+delay\b|['"`]\s*(?:--|#)|\/\*.*?\*\/)/i.test(suspicious)) {
    return 'The database ghost inspected your incantation and stamped it RETURN TO SENDER. The crypt uses prepared statements.';
  }
  if (/<\s*script\b|javascript\s*:|onerror\s*=/i.test(suspicious)) {
    return 'The mirror spirit refuses to perform your JavaScript. Try a less theatrical entrance.';
  }
  return 'The spirits do not recognize this soul. Wrong name or secret incantation.';
}

const loginLimit = rateLimit({ windowMs: 60_000, limit: 40, standardHeaders: 'draft-8', legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ error: 'TOO_MANY_INCANTATIONS',
    message: 'The chalk circle is spent. Even the fortieth incantation could not wake the porter.' }) });
const signupLimit = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false });

app.post('/api/auth/register', signupLimit, requireCsrf, async (req, res, next) => {
  try {
    if (req.user) return res.status(409).json({ error: 'SESSION_ALREADY_ACTIVE' });
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || !/^[a-z][a-z0-9_]{2,23}$/.test(username) ||
        typeof password !== 'string' || password.length < 4 || password.length > 128) {
      return res.status(400).json({ error: 'INVALID_REGISTRATION',
        message: typeof username === 'string' && /[\u0400-\u04ff\uff01-\uff5e\u0000]/u.test(username)
          ? 'Nice disguise. The gatekeeper reads every alphabet and trusts none.'
          : 'The crypt requires a 3–24 character username and a password of 4–128 characters.' });
    }
    if (username.toLowerCase() === 'gravekeeper') return res.status(409).json({ error: 'USERNAME_TAKEN' });
    if (findUser(username)) return res.status(409).json({ error: 'USERNAME_TAKEN' });
    const passwordHash = await hashPassword(password);
    let newUserId;
    try { newUserId = Number(createTemporaryUser(username, passwordHash).lastInsertRowid); }
    catch (error) {
      if (error.code?.startsWith('SQLITE_CONSTRAINT')) return res.status(409).json({ error: 'USERNAME_TAKEN' });
      throw error;
    }
    startGhosting(newUserId);
    await regenerateSession(req);
    req.session.userId = newUserId;
    await saveSession(req);
    res.set('Cache-Control', 'no-store');
    res.status(201).json({ ok: true, next: '/ghosted',
      ...(username.toLowerCase() === 'admin'
        ? { message: 'Welcome, Administrator. Your contract expires in thirteen seconds.' }
        : {}) });
  } catch (error) { next(error); }
});

app.post('/api/auth/login', loginLimit, requireCsrf, async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string' ||
        username.length > 128 || password.length > 128) {
      return res.status(400).json({ error: 'INVALID_LOGIN', message: 'The gatekeeper accepts a name and a secret, not an enchanted object.' });
    }
    if (username.trim().toLowerCase() === 'gravekeeper' && password === 'midnight-1899') {
      return res.status(401).json({
        error: 'PHANTOM_OPERATOR_TRAP', message: failedLoginMessage(username, password)
      });
    }
    if (/[\u0400-\u04ff\uff01-\uff5e\u0000]/u.test(username)) {
      return res.status(401).json({ error: 'SOUL_NOT_RECOGNIZED',
        message: 'Nice disguise. The gatekeeper reads every alphabet and trusts none.' });
    }
    const original = findUser(username);
    const referenceHash = original?.password_hash || findUser('hmar_lill').password_hash;
    const passwordMatches = await verifyPassword(password, referenceHash);
    if (!original || !passwordMatches) {
      const message = failedLoginMessage(username, password);
      return res.status(401).json({
        error: 'SOUL_NOT_RECOGNIZED', message,
        ghostTrial: /Default Password Plague|database ghost|mirror spirit/.test(message)
      });
    }

    if (original.kind === 'temporary' && original.expires_at != null &&
        original.expires_at <= Date.now()) {
      cleanExpiredAccounts();
      return res.status(401).json({ error: 'SOUL_NOT_RECOGNIZED',
        message: 'The spirits do not recognize this soul. Wrong name or secret incantation.' });
    }
    const user = findUserById(original.id);
    if (!user || !['ACTIVE', 'CURSED'].includes(user.status)) return res.status(401).json({ error: 'SOUL_NOT_RECOGNIZED', message: 'The spirits do not recognize this soul. Wrong name or secret incantation.' });
    if (user.kind === 'temporary') startGhosting(user.id);

    await regenerateSession(req);
    req.session.userId = user.id;
    await saveSession(req);
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, username: user.username, next: user.kind === 'temporary' ? '/ghosted' : user.status === 'CURSED' ? '/cursed' : user.role === 'admin' ? '/admin' : '/home',
      ...(user.status === 'CURSED' ? { message: 'The curse follows the soul, not the browser.' } : {}) });
  } catch (error) { next(error); }
});

app.post('/api/auth/guest', requireCsrf, async (req, res, next) => {
  try {
    if (req.user || req.guest) {
      return res.status(409).json({ error: 'SESSION_ALREADY_ACTIVE' });
    }
    await regenerateSession(req);
    req.session.guestRole = 'exorcist_intern';
    await saveSession(req);
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, next: '/intern' });
  } catch (error) { next(error); }
});

app.get('/api/auth/me', (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (req.guest) return res.json({ role: 'exorcist_intern', status: 'ACTIVE' });
  if (!req.user) {
    if (/(?:^|;\s*)boomart\.sid=/.test(req.get('Cookie') || '')) {
      res.set('X-Cookie-Monster', 'That cookie was baked in another oven.');
    }
    return res.status(401).json({ error: 'NOT_AUTHENTICATED' });
  }
  res.json({
    username: req.user.username,
    role: req.user.role,
    status: req.user.status,
    ghosted: req.user.kind === 'temporary',
    expiresAt: req.user.kind === 'temporary' ? req.user.expires_at : null
  });
});

app.post('/api/auth/logout', requireCsrf, async (req, res, next) => {
  try {
    await destroySession(req);
    res.clearCookie('boomart.sid');
    res.json({ ok: true });
  } catch (error) { next(error); }
});

app.use((req, res, next) => {
  if (!req.user && req.path.startsWith('/api/') && !req.path.startsWith('/api/auth/') &&
      /^Bearer\s+/i.test(req.get('Authorization') || '')) {
    return res.status(401).json({ error: 'UNSIGNED_GHOST',
      message: 'The crypt accepts cookies, not bearer tokens. Nobody has signed anything here since 1899.' });
  }
  const adminPath = req.path === '/admin' || req.path.startsWith('/api/admin/') || req.path.startsWith('/admin/');
  if (!adminPath || req.user?.role === 'admin') return next();
  const cookie = req.get('Cookie') || '';
  const fakeRole = req.get('X-Role') || req.get('X-Admin') || '';
  const proxyTrick = req.get('X-Original-URL') ||
    /^(?:127\.0\.0\.1|::1)(?:,|$)/.test(req.get('X-Forwarded-For') || '') ||
    /^(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(req.get('Host') || '') && req.get('X-Original-URL');
  if (proxyTrick) return res.status(403).json({ error: 'PAPER_BADGE_DENIED',
    message: 'The bouncer reads faces, not sticky notes. A very cozy loopback address, though.' });
  if (fakeRole || /(?:^|;\s*)role=admin(?:;|$)/i.test(cookie)) {
    return res.status(403).json({ error: 'PAPER_CROWN_DENIED',
      message: 'Roles live in the crypt, not in your pockets.' });
  }
  if (/^Bearer\s+/i.test(req.get('Authorization') || '')) {
    return res.status(401).json({ error: 'UNSIGNED_GHOST',
      message: 'The crypt accepts cookies, not bearer tokens. Nobody has signed anything here since 1899.' });
  }
  next();
});

registerRoutes(app, requireCsrf);

app.get('/health', (req, res) => res.json({ status: 'ok', application: 'BOOMART' }));

const publicDirectory = fileURLToPath(new URL('../public/', import.meta.url));
const viewDirectory = fileURLToPath(new URL('../views/', import.meta.url));
function sendPage(res, name, fromPublic = false) {
  res.set('Cache-Control', 'no-store');
  res.sendFile(name, { root: fromPublic ? publicDirectory : viewDirectory });
}
function sendShopPage(req, res, name) {
  const manager = req.user.role === 'admin';
  const nav = manager
    ? `<a href="/admin">Management</a><a class="${name === 'shop.html' ? 'current' : ''}" href="/shop">Shop</a>`
    : `<a href="/home">Home</a><a class="${name === 'shop.html' ? 'current' : ''}" href="/shop">Shop</a><a href="/support">Support</a>`;
  const currencyIcon = `<svg aria-hidden="true" viewBox="0 0 36 36" class="coin-icon"><defs><linearGradient id="coin-grad" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff3ad"/><stop offset=".5" stop-color="#df9f2f"/><stop offset="1" stop-color="#8e4b18"/></linearGradient></defs><circle cx="18" cy="18" r="15" fill="url(#coin-grad)" stroke="#ffe7a1" stroke-width="1.5"/><circle cx="18" cy="18" r="10.5" fill="none" stroke="#713e17" stroke-width="1.3"/><text x="18" y="23" text-anchor="middle" fill="#58300e" font-size="15" font-weight="900">B</text></svg>`;
  const cartIcon = `<svg aria-hidden="true" viewBox="0 0 24 24" class="cart-icon" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"><circle cx="9" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2 3h2l2.3 12h13L22 7H5"/></svg>`;
  const header = `<header class="site-header shop-site-header"><div class="site-header-inner">
    <a class="wordmark" href="${manager ? '/admin' : '/home'}">BOOMART</a>
    <nav aria-label="${manager ? 'Management navigation' : 'Store navigation'}">${nav}</nav>
    <div class="header-commerce"><div class="header-wallet" aria-label="Boo Bucks balance">${currencyIcon}<div><small>Boo Bucks</small><strong id="headerWalletBalance">—</strong></div></div>
    <a class="header-cart${name === 'cart.html' ? ' current' : ''}" href="/shop/cart" aria-label="Open basket">${cartIcon}<span class="header-cart-badge" id="headerCartCount" aria-label="Items in basket">0</span></a></div>
    <button class="signout" id="logout" type="button">Log out</button>
  </div></header>`;
  const html = readFileSync(`${viewDirectory}/${name}`, 'utf8').replace('<!--BOOMART_SHOP_HEADER-->', header);
  res.set('Cache-Control', 'no-store').type('html').send(html);
}
function destination(user) {
  if (user.kind === 'temporary') return '/ghosted';
  if (user.status === 'CURSED') return '/cursed';
  return user.role === 'admin' ? '/admin' : '/home';
}
function requirePage(role) {
  return (req, res, next) => {
    if (req.guest) return res.status(403).send('The exorcist intern is not allowed to leave the lobby.');
    if (!req.user) return res.redirect(303, '/');
    if (req.user.kind === 'temporary') return res.redirect(303, '/ghosted');
    if (req.user.status !== 'ACTIVE') return res.redirect(303, '/cursed');
    if (req.user.role !== role) return res.status(403).send('The spirits forbid you.');
    next();
  };
}
app.get('/', (req, res) => {
  if (req.guest) return res.redirect(303, '/intern');
  if (req.user) return res.redirect(303, destination(req.user));
  sendPage(res, 'index.html', true);
});
app.get('/index.html', (_req, res) => res.redirect(303, '/'));
app.get('/login', (_req, res) => res.redirect(303, '/'));
app.get('/register', (req, res) => {
  if (req.guest) return res.redirect(303, '/intern');
  if (req.user) return res.redirect(303, destination(req.user));
  sendPage(res, 'register.html');
});
app.get('/ghosted', (req, res) => {
  if (!req.user) return res.redirect(303, '/');
  if (req.user.kind !== 'temporary') return res.redirect(303, destination(req.user));
  sendPage(res, 'ghosted.html');
});
app.get('/intern', (req, res) => {
  if (!req.guest) return res.redirect(303, req.user ? destination(req.user) : '/');
  sendPage(res, 'intern.html');
});
app.get('/intern-client.js', (req, res) => {
  if (!req.guest) return res.status(403).end();
  sendPage(res, 'intern-client.js');
});
for (const name of ['home', 'support']) {
  app.get('/' + name, requirePage('customer'), (_req, res) => sendPage(res, name + '.html'));
}

function requireShoppingIdentity(req, res, next) {
  if (req.guest) return res.status(403).type('text').send('Interns may only haunt the lobby.');
  if (!req.user) return res.redirect(303, '/');
  if (req.user.kind !== 'seed') return res.redirect(303, '/ghosted');
  if (req.user.status !== 'ACTIVE') return res.redirect(303, '/cursed');
  next();
}
app.get('/shop', requireShoppingIdentity, (req, res) => sendShopPage(req, res, 'shop.html'));
app.get('/shop/cart', requireShoppingIdentity, (req, res) => sendShopPage(req, res, 'cart.html'));
app.get('/shop/orders/:id', requireShoppingIdentity, (_req, res) => {
  if (!/^[a-f0-9]{36}$/.test(_req.params.id)) return res.status(404).end();
  sendShopPage(_req, res, 'receipt.html');
});
app.get('/admin', requirePage('admin'), (_req, res) => sendPage(res, 'admin.html'));
app.get('/cursed', (req, res) => {
  if (!req.user) return res.redirect(303, '/');
  if (req.user.status !== 'CURSED') return res.redirect(303, destination(req.user));
  sendPage(res, 'cursed.html');
});
app.get('/cursed-client.js', (req, res) => {
  if (!req.user || req.user.status !== 'CURSED') return res.status(403).end();
  sendPage(res, 'cursed-client.js');
});
app.get('/admin-client.js', requirePage('admin'), (_req, res) => sendPage(res, 'admin-client.js'));
app.get('/ghosted-client.js', (req, res) => {
  if (!req.user || req.user.kind !== 'temporary') return res.status(403).end();
  sendPage(res, 'ghosted-client.js');
});
app.get('/robots.txt', (_req, res) => {
  res.set('Cache-Control', 'no-store').type('text/plain').send(
    '# BOOMART robot advisory — Please respect the deceased.\n' +
    'User-agent: *\n' +
    'Disallow: /do-not-enter-the-crypt/\n' +
    'Disallow: /wp-admin/\n' +
    'Disallow: /backup/\n' +
    'Disallow: /phpmyadmin/\n' +
    '# No living visitor has filed a complaint after entering the crypt.\n'
  );
});
app.get('/do-not-enter-the-crypt/', (_req, res) => sendPage(res, 'crypt.html'));

const deadEnds = new Map(Object.entries({
  '/wp-admin': ['WORDPRESS EXORCISM', 'The last WordPress priest resigned in 1897.'],
  '/wp-admin/': ['WORDPRESS EXORCISM', 'A ghost changed the locks on the blogging chamber.'],
  '/wp-login.php': ['THE OLD BLOGGER', 'The author has left this mortal publishing platform.'],
  '/xmlrpc.php': ['HAUNTED SIGNAL LOST', 'Our ghost refuses to answer remote incantations.'],
  '/admin.php': ['FALSE THRONE', 'Someone installed a cardboard crown behind this door.'],
  '/administrator': ['NO PALACE HERE', 'The caretaker misplaced the entire administration wing.'],
  '/phpmyadmin': ['CRYPT DATABASE', 'The skeleton DBA insists on an appointment.'],
  '/phpmyadmin/': ['CRYPT DATABASE', 'No SQL console survives the full moon.'],
  '/.env': ['SEALED VIAL', 'The alchemist locked every bottle before the haunting.'],
  '/.git/config': ['REVISION GRAVEYARD', 'Our ancestors committed their sins privately.'],
  '/.git/HEAD': ['REVISION GRAVEYARD', 'This branch is buried too deep for visitors.'],
  '/backup': ['BACKUP COFFIN', 'Only moths occupy the emergency coffin.'],
  '/backup/': ['BACKUP COFFIN', 'The backup box contains one disappointed spider.'],
  '/config': ['LOCKED SPELLBOOK', 'The configuration wizard never graduated.'],
  '/config.php': ['LOCKED SPELLBOOK', 'No PHP sorcery under this moon.'],
  '/server-status': ['THE SLEEPING SERVER', 'The server is awake. Its operator is not.'],
  '/actuator/health': ['OTHERWORLDLY MEDIC', 'No living heartbeat was detected, which is normal here.'],
  '/cgi-bin/': ['ARCHIVE OF DEAD SCRIPTS', 'These ancient scripts no longer dance.'],
  '/sitemap.xml': ['THE LOST MAP', 'All roads lead back to the checkout queue.'],
  '/security.txt': ['SECURITY CAT', 'Our security department is a cat that dislikes visitors.'],
  '/humans.txt': ['HUMAN RESOURCES', 'Our humans went missing during onboarding.'],
  '/ads.txt': ['ADVERTISEMENT DEPARTMENT', 'No ads. Only occasional possessions.'],
  '/readme.md': ['ANCIENT README', 'The owner read the instructions and immediately vanished.'],
  '/.well-known/security.txt': ['SECURITY CAT', 'The security cat is asleep at its post.']
}));

const extraDeadEnds = {
  '/package.json': ['BURIED SOURCE', 'The gravedigger charges by the meter.'],
  '/server.js': ['BURIED SOURCE', 'The source code is buried deeper than this URL.'],
  '/src/routes.js': ['BURIED SOURCE', 'The gravedigger charges by the meter.'],
  '/Dockerfile': ['BURIED SOURCE', 'The builders left only cobwebs.'],
  '/.DS_Store': ['BURIED SOURCE', 'The file index was eaten by a cellar moth.'],
  '/boomart.sqlite': ['CRYPT DATABASE', 'The skeleton DBA guards this ledger with a union card.'],
  '/data': ['CRYPT DATABASE', 'The skeleton DBA guards this ledger with a union card.'],
  '/data/': ['CRYPT DATABASE', 'The skeleton DBA guards this ledger with a union card.'],
  '/.dev-session-secret': ['CRYPT DATABASE', 'The keys have been swallowed by the archivist.'],
  '/etc/passwd': ['FALSE BASEMENT', 'There is no basement called /etc in this crypt.'],
  '/proc/self/environ': ['FALSE BASEMENT', 'The undertaker has never heard of this corridor.'],
  '/swagger.json': ['INVISIBLE API', 'The necromancer wrote the API documentation in invisible ink.'],
  '/openapi.json': ['INVISIBLE API', 'The necromancer wrote the API documentation in invisible ink.'],
  '/graphql': ['INVISIBLE API', 'The schema is attending its own funeral.'],
  '/metrics': ['INVISIBLE API', 'The ledger measures nothing but lost souls.'],
  '/actuator/env': ['INVISIBLE API', 'No Spring spirits inhabit this building.'],
  '/console': ['INVISIBLE API', 'The terminal operator has been dead since 1899.'],
  '/ws': ['SEANCE ONLY', 'Ghosts do not use WebSockets. They use séance.'],
  '/socket.io': ['SEANCE ONLY', 'Ghosts do not use WebSockets. They use séance.'],
  '/socket.io/': ['SEANCE ONLY', 'Ghosts do not use WebSockets. They use séance.'],
  '/flag': ['MISSING FLAG', 'The flag is not a resource. It is a consequence.'],
  '/flag.txt': ['MISSING FLAG', 'The flag is not a resource. It is a consequence.'],
  '/staff': ['STAFF STAIRS', 'The management wing is staff-only. The stairs are too.'],
  '/manager': ['STAFF STAIRS', 'The management wing is staff-only. The stairs are too.'],
  '/dashboard': ['STAFF STAIRS', 'The management wing is staff-only. The stairs are too.'],
  '/admin/login': ['STAFF STAIRS', 'This door opens for no one wearing a paper crown.']
};
for (const [path, value] of Object.entries(extraDeadEnds)) deadEnds.set(path, value);

const graveyardProbeLimit = rateLimit({
  windowMs: 60_000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ error: 'SECURITY_CAT_AWAKE',
    message: 'The archivist called security. Security is a cat. The cat has woken up. Come back in a minute.' })
});
function scannerNote(req, res) {
  if (/\b(sqlmap|nikto|gobuster)\b/i.test(req.get('User-Agent') || '')) {
    res.set('X-Old-Ghost', 'The database ghost has attended this party since 2006.');
  }
}
for (const [path, [heading, description]] of deadEnds) {
  app.get(path, graveyardProbeLimit, (req, res) => {
    scannerNote(req, res);
    const html = readFileSync(`${viewDirectory}/not-found.html`, 'utf8');
    res.status(404).set('Cache-Control', 'no-store').type('html').send(
      html.replace('This page moved to the other side.', heading).replace(
        'The archivist searched every coffin, broom closet, and forbidden aisle. There is no record of this address in either world.', description
      )
    );
  });
}
const apiDeadEnds = new Map(Object.entries({
  '/admin': 'The staff door is not an API shortcut, dear mortal.',
  '/debug': 'The debugging imp has taken early retirement.',
  '/config': 'Even the ghosts cannot read the locked configuration.',
  '/v1/admin': 'This throne room was closed for haunting repairs.',
  '/wallet/credit-now': 'The accounting bat says no free coins.'
}));
for (const [path, message] of apiDeadEnds) {
  app.all('/api' + path, graveyardProbeLimit, (req, res) => {
    scannerNote(req, res);
    res.status(404).json({ error: 'OTHERWORLDLY_ABSENCE', message });
  });
}
app.put('/api/shop/products/:id', (req, res) => res.status(req.user ? 403 : 401).json({
  error: 'PRICE_TAG_SEALED', message: 'The price tag is written in blood, and yours is the wrong type.'
}));
app.all(['/api/shop/orders/:id/refund', '/orders/:id/refund'], (req, res) => res.status(req.user ? 403 : 401).json({
  error: 'NO_MORTAL_REFUNDS', message: 'Refunds are processed in the next life.'
}));
app.use(express.static(publicDirectory, { index: false, dotfiles: 'ignore' }));

app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  if (req.path.startsWith('/api/')) return next();
  let suspectPath = req.path;
  try { suspectPath = decodeURIComponent(suspectPath); } catch {}
  const isTraversal = /(?:\.\.\/|\.\.\\|\/etc\/passwd|\/proc\/self\/environ)/i.test(suspectPath);
  const isSource = /\.(?:map|bak|backup|old|sql|sqlite)$/i.test(suspectPath) ||
    /\/(?:src|node_modules|data)(?:\/|$)/i.test(suspectPath);
  if (!isTraversal && !isSource) return next();
  return graveyardProbeLimit(req, res, () => {
    scannerNote(req, res);
    const html = readFileSync(`${viewDirectory}/not-found.html`, 'utf8');
    const heading = isTraversal ? 'THE FALSE BASEMENT' : 'BURIED SOURCE';
    const description = isTraversal
      ? 'There is no basement called /etc. The gravedigger charges extra for imaginary stairs.'
      : 'The source code is buried deeper than this URL. The gravedigger charges by the meter.';
    res.status(404).set('Cache-Control', 'no-store').type('html').send(
      html.replace('This page moved to the other side.', heading).replace(
        'The archivist searched every coffin, broom closet, and forbidden aisle. There is no record of this address in either world.', description)
    );
  });
});

app.use('/api', graveyardProbeLimit, (req, res) => {
  scannerNote(req, res);
  let message = 'The ghost clerk checked every shelf. This API moved to the other side.';
  if (/^\/flag(?:\.txt)?\/?$/i.test(req.path)) message = 'The flag is not a resource. It is a consequence.';
  else if (/\.(?:map|bak|old|sql|sqlite)$/i.test(req.path) || /\/(?:src|data)\//i.test(req.path))
    message = 'The source code is buried deeper than this URL. The gravedigger charges by the meter.';
  else if (/\/(?:swagger|openapi|graphql|metrics|actuator|socket\.io|ws)(?:\/|$|\.)/i.test(req.path))
    message = 'The IT necromancer drafted the API documentation in invisible ink.';
  res.status(404).json({ error: 'NOT_FOUND', message });
});
app.use(graveyardProbeLimit, (req, res) => {
  scannerNote(req, res);
  res.set('Cache-Control', 'no-store');
  if (req.method === 'GET' || req.method === 'HEAD') {
    return res.status(404).sendFile('not-found.html', { root: viewDirectory });
  }
  res.status(404).json({ error: 'NOT_FOUND', message: 'The afterlife does not accept this request.' });
});
app.use((error, _req, res, next) => {
  console.error('BOOMART request failed:', error.message);
  if (res.headersSent) return next(error);
  if (error instanceof PasswordWorkBusyError) {
    res.set('Retry-After', '1');
    return res.status(503).json({ error: 'GATEKEEPER_BUSY',
      message: 'Too many souls at the gate. The crypt needs a moment.' });
  }
  if (error.type === 'entity.too.large' || error.status === 413) {
    return res.status(413).json({ error: 'SCROLL_TOO_HEAVY',
      message: 'That scroll weighs more than the ghost carrying it.' });
  }
  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    return res.status(400).json({ error: 'UNREADABLE_SCROLL',
      message: 'The scribe cannot read your handwriting. Was it written with a claw?' });
  }
  res.status(500).json({ error: 'INTERNAL_ERROR' });
});

if (production && (!process.env.FLAG || process.env.FLAG.length > 256 ||
    /[\r\n]/.test(process.env.FLAG))) {
  throw new Error('Set a valid FLAG environment variable before deployment.');
}
await initializeDatabase();
cleanExpiredAccounts();
const cleanupInterval = setInterval(() => {
  try { cleanExpiredAccounts(); }
  catch (error) { console.error('BOOMART cleanup failed:', error.message); }
}, 1000);
cleanupInterval.unref();
app.listen(PORT, HOST, () => console.log(`BOOMART running at http://${HOST}:${PORT}`));
