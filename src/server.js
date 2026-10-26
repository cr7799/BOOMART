import express from 'express';
import helmet from 'helmet';
import session from 'express-session';
import { rateLimit } from 'express-rate-limit';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  initializeDatabase, SQLiteSessionStore, findUser, findUserById,
  createTemporaryUser, startGhosting, cleanExpiredAccounts,
  hashPassword, verifyPassword
} from './db.js';

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const production = process.env.NODE_ENV === 'production';
const sessionSecret = process.env.SESSION_SECRET || (production ? '' : randomBytes(48).toString('hex'));
if (sessionSecret.length < 32) throw new Error('Set SESSION_SECRET to at least 32 characters in production.');

app.disable('x-powered-by');
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
app.use(helmet());
app.use(express.json({ limit: '16kb' }));
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

// Every request re-checks the actual database account, not a role in a cookie.
app.use((req, res, next) => {
  try {
    cleanExpiredAccounts();
    req.user = req.session.userId ? findUserById(req.session.userId) : null;
    if (!req.user && req.session.userId) {
      return destroySession(req).then(() => {
        res.clearCookie('boomart.sid');
        next();
      }).catch(next);
    }
    // Temporary signups are traps, never normal CTF participants.
    if (req.user?.kind === 'temporary' && req.path.startsWith('/api/') &&
        !['/api/auth/me', '/api/auth/csrf', '/api/auth/logout'].includes(req.path)) {
      return res.status(403).json({ error: 'GHOSTED_ACCOUNT' });
    }
    // Cursed-account restrictions will be integrated with the ritual feature.
    next();
  } catch (error) { next(error); }
});

app.get('/api/auth/csrf', (req, res) => {
  if (!req.session.csrfToken) req.session.csrfToken = randomBytes(32).toString('hex');
  res.set('Cache-Control', 'no-store');
  res.json({ csrfToken: req.session.csrfToken });
});

function requireCsrf(req, res, next) {
  const supplied = req.get('X-CSRF-Token') || '';
  const expected = req.session?.csrfToken || '';
  if (supplied.length !== 64 || expected.length !== 64 ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
    return res.status(403).json({ error: 'INVALID_CSRF_TOKEN' });
  }
  next();
}

const loginLimit = rateLimit({ windowMs: 60_000, limit: 40, standardHeaders: 'draft-8', legacyHeaders: false });
const signupLimit = rateLimit({ windowMs: 60_000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false });

app.post('/api/auth/register', signupLimit, requireCsrf, async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || !/^[a-z][a-z0-9_]{2,23}$/.test(username) ||
        typeof password !== 'string' || password.length < 10 || password.length > 128) {
      return res.status(400).json({ error: 'INVALID_REGISTRATION', message: 'Use a 3–24 character username and a password of 10–128 characters.' });
    }
    if (findUser(username)) return res.status(409).json({ error: 'USERNAME_TAKEN' });
    const passwordHash = await hashPassword(password);
    try { createTemporaryUser(username, passwordHash); }
    catch (error) {
      if (error.code?.startsWith('SQLITE_CONSTRAINT')) return res.status(409).json({ error: 'USERNAME_TAKEN' });
      throw error;
    }
    res.status(201).json({ message: 'Your employment contract with the afterlife is ready. Please log in.' });
  } catch (error) { next(error); }
});

app.post('/api/auth/login', loginLimit, requireCsrf, async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (typeof username !== 'string' || typeof password !== 'string' ||
        username.length > 128 || password.length > 128) {
      return res.status(400).json({ error: 'INVALID_LOGIN' });
    }
    const original = findUser(username);
    // Use a real seeded hash as a dummy to reduce username timing differences.
    const referenceHash = original?.password_hash || findUser('hmar_lill').password_hash;
    const passwordMatches = await verifyPassword(password, referenceHash);
    if (!original || !passwordMatches) return res.status(401).json({ error: 'INVALID_CREDENTIALS' });

    cleanExpiredAccounts();
    const user = findUserById(original.id);
    if (!user || user.status !== 'ACTIVE') return res.status(401).json({ error: 'INVALID_CREDENTIALS' });
    if (user.kind === 'temporary') startGhosting(user.id);

    await regenerateSession(req);
    req.session.userId = user.id;
    await saveSession(req);
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, username: user.username });
  } catch (error) { next(error); }
});

app.get('/api/auth/me', (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!req.user) return res.status(401).json({ error: 'NOT_AUTHENTICATED' });
  res.json({
    username: req.user.username,
    role: req.user.role,
    status: req.user.status,
    verified: Boolean(req.user.verified),
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

app.get('/health', (req, res) => res.json({ status: 'ok', application: 'BOOMART' }));
app.use(express.static(fileURLToPath(new URL('../public/', import.meta.url)), { index: 'index.html' }));
app.use('/api', (_req, res) => res.status(404).json({ error: 'NOT_FOUND' }));
app.use((error, _req, res, _next) => {
  console.error('BOOMART request failed:', error.message);
  res.status(500).json({ error: 'INTERNAL_ERROR' });
});

await initializeDatabase();
cleanExpiredAccounts();
const cleanupInterval = setInterval(cleanExpiredAccounts, 1000);
cleanupInterval.unref();
app.listen(PORT, HOST, () => console.log(`BOOMART running at http://${HOST}:${PORT}`));
