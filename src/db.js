import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import session from 'express-session';

const scrypt = promisify(scryptCallback);
const dbPath = process.env.DB_PATH || fileURLToPath(new URL('../data/boomart.sqlite', import.meta.url));
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new DatabaseSync(dbPath, { timeout: 5000 });
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

const SCRYPT = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(password, Buffer.from(salt, 'hex'), 64, SCRYPT);
  return `scrypt$${salt}$${hash.toString('hex')}`;
}

export async function verifyPassword(password, storedHash) {
  const [algorithm, salt, hex] = (storedHash || '').split('$');
  if (algorithm !== 'scrypt' || !/^[a-f0-9]{32}$/.test(salt || '') || !/^[a-f0-9]{128}$/.test(hex || '')) {
    return false;
  }
  const computed = await scrypt(password, Buffer.from(salt, 'hex'), 64, SCRYPT);
  return timingSafeEqual(computed, Buffer.from(hex, 'hex'));
}

export const findUser = (username) => db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username);
export const findUserById = (id) => db.prepare('SELECT * FROM users WHERE id = ?').get(id);

export async function initializeDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
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
    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      sess TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      user_id INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  `);

  async function seed(username, password, role, verified) {
    if (findUser(username)) return;
    const passwordHash = await hashPassword(password);
    db.prepare(`INSERT INTO users (username, password_hash, role, verified, kind, created_at)
      VALUES (?, ?, ?, ?, 'seed', ?)`).run(username, passwordHash, role, verified, Date.now());
  }

  // Only this starting password will be published in the CTFd description.
  await seed('hmar_lill', process.env.STARTER_PASSWORD || 'nightshift-13', 'customer', 0);
  // The other two passwords are random and never logged or shipped as defaults.
  await seed('aicha_kandisha', randomBytes(32).toString('base64url'), 'customer', 1);
  await seed('chamharouch', randomBytes(32).toString('base64url'), 'admin', 0);

  db.prepare('UPDATE users SET linked_customer_id = ? WHERE username = ?')
    .run(findUser('aicha_kandisha').id, 'chamharouch');
}

export function createTemporaryUser(username, passwordHash) {
  return db.prepare(`INSERT INTO users (username, password_hash, role, verified, kind, created_at)
    VALUES (?, ?, 'customer', 0, 'temporary', ?)`).run(username, passwordHash, Date.now());
}

export function startGhosting(userId) {
  const expiresAt = Date.now() + 13_000;
  db.prepare(`UPDATE users SET expires_at = ? WHERE id = ? AND kind = 'temporary' AND expires_at IS NULL`)
    .run(expiresAt, userId);
  return findUserById(userId)?.expires_at;
}

export function cleanExpiredAccounts() {
  const now = Date.now();
  // Delete sessions first, so existing cookies cannot access removed accounts.
  db.prepare(`DELETE FROM sessions WHERE user_id IN (
    SELECT id FROM users WHERE kind = 'temporary' AND
      ((expires_at IS NOT NULL AND expires_at <= ?) OR
       (expires_at IS NULL AND created_at <= ?))
  )`).run(now, now - 60 * 60 * 1000);
  db.prepare(`DELETE FROM users WHERE kind = 'temporary' AND
      ((expires_at IS NOT NULL AND expires_at <= ?) OR
       (expires_at IS NULL AND created_at <= ?))`)
    .run(now, now - 60 * 60 * 1000);
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
}

// Minimal persistent express-session store, using the same SQLite database.
export class SQLiteSessionStore extends session.Store {
  get(sid, callback) {
    try {
      const row = db.prepare('SELECT sess FROM sessions WHERE sid = ? AND expires_at > ?')
        .get(sid, Date.now());
      callback(null, row ? JSON.parse(row.sess) : null);
    } catch (error) { callback(error); }
  }

  set(sid, data, callback = () => {}) {
    try {
      const expiry = new Date(data.cookie?.expires || Date.now() + 4 * 60 * 60 * 1000).getTime();
      db.prepare(`INSERT INTO sessions (sid, sess, expires_at, user_id) VALUES (?, ?, ?, ?)
        ON CONFLICT(sid) DO UPDATE SET sess=excluded.sess,
        expires_at=excluded.expires_at, user_id=excluded.user_id`)
        .run(sid, JSON.stringify(data), expiry, data.userId ?? null);
      callback(null);
    } catch (error) { callback(error); }
  }

  destroy(sid, callback = () => {}) {
    try {
      db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      callback(null);
    } catch (error) { callback(error); }
  }

  touch(sid, data, callback = () => {}) {
    try {
      const expiry = new Date(data.cookie?.expires || Date.now() + 4 * 60 * 60 * 1000).getTime();
      db.prepare('UPDATE sessions SET expires_at = ? WHERE sid = ?').run(expiry, sid);
      callback(null);
    } catch (error) { callback(error); }
  }
}
