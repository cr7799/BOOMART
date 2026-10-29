import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import session from 'express-session';

const nativeScrypt = promisify(scryptCallback);
const MAX_ACTIVE_SCRYPT = 2;
let activeScrypt = 0;
export class PasswordWorkBusyError extends Error {
  constructor() {
    super('The gatekeeper is already consulting the crypt.');
    this.code = 'PASSWORD_WORK_BUSY';
  }
}
async function boundedScrypt(...args) {
  if (activeScrypt >= MAX_ACTIVE_SCRYPT) throw new PasswordWorkBusyError();
  activeScrypt++;
  try { return await nativeScrypt(...args); }
  finally { activeScrypt--; }
}
const dbPath = process.env.DB_PATH || fileURLToPath(new URL('../data/boomart.sqlite', import.meta.url));
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new DatabaseSync(dbPath, { timeout: 5000 });
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

const SCRYPT = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await boundedScrypt(password, Buffer.from(salt, 'hex'), 64, SCRYPT);
  return `scrypt$${salt}$${hash.toString('hex')}`;
}

export async function verifyPassword(password, storedHash) {
  const [algorithm, salt, hex] = (storedHash || '').split('$');
  if (algorithm !== 'scrypt' || !/^[a-f0-9]{32}$/.test(salt || '') || !/^[a-f0-9]{128}$/.test(hex || '')) {
    return false;
  }
  const computed = await boundedScrypt(password, Buffer.from(salt, 'hex'), 64, SCRYPT);
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

    CREATE TABLE IF NOT EXISTS support_tickets (
      id INTEGER PRIMARY KEY,
      owner_user_id INTEGER NOT NULL REFERENCES users(id),
      subject TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('OPEN', 'CLOSED', 'APPROVED')),
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ticket_owner ON support_tickets(owner_user_id);

    CREATE TABLE IF NOT EXISTS access_approvals (
      approval_ref TEXT PRIMARY KEY,
      ticket_id INTEGER NOT NULL UNIQUE REFERENCES support_tickets(id),
      claimant_user_id INTEGER NOT NULL REFERENCES users(id),
      status TEXT NOT NULL CHECK (status IN ('APPROVED', 'REVOKED')),
      redeemed_at INTEGER,
      redeemed_by_user_id INTEGER REFERENCES users(id),
      last_issued_at INTEGER,
      reissue_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS ghost_profiles (
      id INTEGER PRIMARY KEY,
      owner_user_id INTEGER NOT NULL REFERENCES users(id),
      nickname TEXT NOT NULL,
      haunt_level INTEGER NOT NULL,
      favorite_food TEXT NOT NULL,
      epitaph TEXT NOT NULL,
      is_assigned INTEGER NOT NULL DEFAULT 0 CHECK (is_assigned IN (0, 1))
    );

    CREATE TABLE IF NOT EXISTS staff_shift_seals (
      staff_user_id INTEGER PRIMARY KEY REFERENCES users(id),
      seal TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      used_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS rituals (
      ritual_id TEXT PRIMARY KEY,
      staff_user_id INTEGER NOT NULL REFERENCES users(id),
      manual_taps INTEGER NOT NULL DEFAULT 0 CHECK (manual_taps >= 0),
      manual_energy REAL NOT NULL DEFAULT 0 CHECK (manual_energy BETWEEN 0 AND 100),
      manual_updated_at INTEGER,
      manual_last_tap_at INTEGER,
      started_at INTEGER NOT NULL,
      cleared_at INTEGER,
      method TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_active_staff_ritual
      ON rituals(staff_user_id) WHERE cleared_at IS NULL;

    -- Individual administrative sessions can damage their own office for a
    -- short while. Keep this isolated per staff account rather than global.
    CREATE TABLE IF NOT EXISTS site_meltdowns (
      staff_user_id INTEGER PRIMARY KEY REFERENCES users(id),
      until_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      price INTEGER NOT NULL CHECK (price >= 0),
      coupon_eligible INTEGER NOT NULL CHECK (coupon_eligible IN (0, 1))
    );

    -- Wallets and checkout are server-authoritative. A basket can hold many
    -- products, but the one-off heritage voucher is restricted to one relic.
    CREATE TABLE IF NOT EXISTS carts (
      id INTEGER PRIMARY KEY,
      owner_user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
      version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
      active_quote_id TEXT,
      delivery_mode TEXT NOT NULL DEFAULT 'standard' CHECK (delivery_mode IN ('standard', 'express', 'reserve'))
    );
    CREATE TABLE IF NOT EXISTS cart_items (
      id INTEGER PRIMARY KEY,
      cart_id INTEGER NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL REFERENCES products(id),
      quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 99),
      UNIQUE (cart_id, product_id)
    );
    CREATE TABLE IF NOT EXISTS checkout_quotes (
      id TEXT PRIMARY KEY,
      cart_id INTEGER NOT NULL REFERENCES carts(id),
      owner_user_id INTEGER NOT NULL REFERENCES users(id),
      coupon_code TEXT NOT NULL,
      product_at_validation TEXT NOT NULL REFERENCES products(id),
      cart_version INTEGER NOT NULL,
      total INTEGER NOT NULL CHECK (total >= 0),
      created_at INTEGER NOT NULL,
      consumed_at INTEGER,
      delivery_mode_at_validation TEXT NOT NULL DEFAULT 'standard'
    );
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      owner_user_id INTEGER NOT NULL REFERENCES users(id),
      product_id TEXT NOT NULL REFERENCES products(id),
      regular_price INTEGER NOT NULL CHECK (regular_price >= 0),
      charged INTEGER NOT NULL CHECK (charged >= 0),
      coupon_code TEXT,
      flag_awarded INTEGER NOT NULL DEFAULT 0 CHECK (flag_awarded IN (0, 1)),
      created_at INTEGER NOT NULL,
      delivery_mode TEXT NOT NULL DEFAULT 'standard'
    );
    CREATE INDEX IF NOT EXISTS idx_orders_owner ON orders(owner_user_id);
    CREATE TABLE IF NOT EXISTS order_items (
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL REFERENCES products(id),
      quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 99),
      unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
      PRIMARY KEY (order_id, product_id)
    );
    CREATE TABLE IF NOT EXISTS wallets (
      owner_user_id INTEGER PRIMARY KEY REFERENCES users(id),
      balance INTEGER NOT NULL CHECK (balance >= 0)
    );
    -- Each instance has a random, non-guessable voucher. It can only be
    -- exposed by successfully clearing Chamharouch's curse.
    CREATE TABLE IF NOT EXISTS ritual_voucher (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      code TEXT NOT NULL UNIQUE,
      unlocked_at INTEGER
    );
  `);

  const lineSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='cart_items'").get()?.sql || '';
  const lineColumns = db.prepare('PRAGMA table_info(cart_items)').all();
  if (!lineColumns.some(col => col.name === 'quantity') ||
      /cart_id\s+INTEGER\s+NOT\s+NULL\s+UNIQUE/i.test(lineSql)) {
    const hasQuantity = lineColumns.some(col => col.name === 'quantity');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`
        CREATE TABLE cart_items_upgrade (
          id INTEGER PRIMARY KEY,
          cart_id INTEGER NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
          product_id TEXT NOT NULL REFERENCES products(id),
          quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 99),
          UNIQUE (cart_id, product_id)
        );
        INSERT INTO cart_items_upgrade(id, cart_id, product_id, quantity)
          SELECT id, cart_id, product_id, ${hasQuantity ? 'quantity' : '1'} FROM cart_items;
        DROP TABLE cart_items;
        ALTER TABLE cart_items_upgrade RENAME TO cart_items;
      `);
      db.exec('COMMIT');
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw error;
    }
  }

  const ensureColumn = (table, name, definition) => {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some(col => col.name === name)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
    }
  };
  const oldCart = !db.prepare('PRAGMA table_info(carts)').all().some(col => col.name === 'delivery_mode');
  ensureColumn('carts', 'delivery_mode', "TEXT NOT NULL DEFAULT 'standard'");
  ensureColumn('checkout_quotes', 'delivery_mode_at_validation', "TEXT NOT NULL DEFAULT 'standard'");
  ensureColumn('orders', 'delivery_mode', "TEXT NOT NULL DEFAULT 'standard'");
  if (oldCart) {
    db.exec(`UPDATE carts SET active_quote_id = NULL;
      UPDATE checkout_quotes SET consumed_at = COALESCE(consumed_at, 1)
      WHERE coupon_code = 'BOO-NIGHT';
      UPDATE orders SET flag_awarded = 0 WHERE coupon_code = 'BOO-NIGHT';`);
  }

  const ritualColumns = db.prepare('PRAGMA table_info(rituals)').all();
  for (const [name, definition] of [
    ['manual_energy', 'REAL NOT NULL DEFAULT 0'],
    ['manual_updated_at', 'INTEGER'],
    ['manual_last_tap_at', 'INTEGER']
  ]) {
    if (!ritualColumns.some(column => column.name === name)) {
      db.exec(`ALTER TABLE rituals ADD COLUMN ${name} ${definition}`);
    }
  }

  const ritualTableSql = db.prepare(`SELECT sql FROM sqlite_master
    WHERE type = 'table' AND name = 'rituals'`).get()?.sql || '';
  if (/CHECK\s*\(\s*manual_taps\s+BETWEEN\s+0\s+AND\s+100\s*\)/i.test(ritualTableSql)) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`
        CREATE TABLE rituals_new (
          ritual_id TEXT PRIMARY KEY,
          staff_user_id INTEGER NOT NULL REFERENCES users(id),
          manual_taps INTEGER NOT NULL DEFAULT 0 CHECK (manual_taps >= 0),
          manual_energy REAL NOT NULL DEFAULT 0 CHECK (manual_energy BETWEEN 0 AND 100),
          manual_updated_at INTEGER,
          manual_last_tap_at INTEGER,
          started_at INTEGER NOT NULL,
          cleared_at INTEGER,
          method TEXT
        );
        INSERT INTO rituals_new (
          ritual_id, staff_user_id, manual_taps, manual_energy,
          manual_updated_at, manual_last_tap_at, started_at, cleared_at, method
        ) SELECT
          ritual_id, staff_user_id, manual_taps, manual_energy,
          manual_updated_at, manual_last_tap_at, started_at, cleared_at, method
        FROM rituals;
        DROP TABLE rituals;
        ALTER TABLE rituals_new RENAME TO rituals;
        CREATE UNIQUE INDEX idx_active_staff_ritual
          ON rituals(staff_user_id) WHERE cleared_at IS NULL;
      `);
      db.exec('COMMIT');
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw error;
    }
  }

  const ghostColumns = db.prepare('PRAGMA table_info(ghost_profiles)').all();
  if (!ghostColumns.some(column => column.name === 'is_assigned')) {
    db.exec('ALTER TABLE ghost_profiles ADD COLUMN is_assigned INTEGER NOT NULL DEFAULT 0 CHECK (is_assigned IN (0, 1))');
  }


  const approvalColumns = db.prepare('PRAGMA table_info(access_approvals)').all();
  if (!approvalColumns.some(column => column.name === 'redeemed_by_user_id')) {
    db.exec('ALTER TABLE access_approvals ADD COLUMN redeemed_by_user_id INTEGER REFERENCES users(id)');
  }
  if (!approvalColumns.some(column => column.name === 'last_issued_at')) {
    db.exec('ALTER TABLE access_approvals ADD COLUMN last_issued_at INTEGER');
  }
  if (!approvalColumns.some(column => column.name === 'reissue_count')) {
    db.exec('ALTER TABLE access_approvals ADD COLUMN reissue_count INTEGER NOT NULL DEFAULT 0');
  }

  async function seed(username, password, role, verified) {
    if (findUser(username)) return;
    const passwordHash = await hashPassword(password);
    db.prepare(`INSERT INTO users (username, password_hash, role, verified, kind, created_at)
      VALUES (?, ?, ?, ?, 'seed', ?)`).run(username, passwordHash, role, verified, Date.now());
  }

  await seed('hmar_lill', process.env.STARTER_PASSWORD || 'nightshift-13', 'customer', 0);
  await seed('aicha_kandisha', randomBytes(32).toString('base64url'), 'customer', 1);
  await seed('chamharouch', randomBytes(32).toString('base64url'), 'admin', 0);

  db.prepare('UPDATE users SET linked_customer_id = ? WHERE username = ?')
    .run(findUser('aicha_kandisha').id, 'chamharouch');
  db.prepare(`INSERT OR IGNORE INTO staff_shift_seals (staff_user_id, seal, created_at)
    VALUES (?, ?, ?)`).run(findUser('chamharouch').id, randomBytes(18).toString('hex'), Date.now());

  const ticket = db.prepare(`INSERT OR IGNORE INTO support_tickets
    (id, owner_user_id, subject, message, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`);
  const now = Date.now();
  ticket.run(3108, findUser('hmar_lill').id,
    'My night shift never ends',
    'At thirteen chimes, the clock froze at 03:33. I carried a sealed envelope to the OLD archive, not the current ticket desk. Scratched into the wax were the words: The bells enter before the hands; even silence keeps its place. By dawn, the envelope had vanished.',
    'OPEN', now);
  ticket.run(3109, findUser('chamharouch').id,
    'The candle budget crisis',
    'Management ordered 300 candles. The accountant counted 301 shadows. Case closed.',
    'CLOSED', now);
  ticket.run(3110, findUser('aicha_kandisha').id,
    'My carrots are making noises',
    'Customer support said this is a feature, not a defect.',
    'CLOSED', now);
  ticket.run(130333, findUser('chamharouch').id,
    'Sealed personnel recovery slip',
    'Approved management recovery request. This confidential slip was meant for the night manager, not the customer desk.',
    'APPROVED', now);

  db.exec('BEGIN IMMEDIATE');
  try {
    const oldApproval = db.prepare('SELECT approval_ref FROM access_approvals WHERE ticket_id = 3109').get();
    if (oldApproval) {
      db.prepare('UPDATE access_approvals SET ticket_id = 130333 WHERE ticket_id = 3109')
        .run();
    }
    db.prepare(`UPDATE support_tickets SET
      subject = ?, message = ?, status = 'CLOSED'
      WHERE id = 3109`).run('The candle budget crisis',
      'Management ordered 300 candles. The accountant counted 301 shadows. Case closed.');
    db.prepare(`UPDATE support_tickets SET
      subject = ?, message = ?, status = 'OPEN'
      WHERE id = 3108`).run('My night shift never ends',
      'At thirteen chimes, the clock froze at 03:33. I carried a sealed envelope to the OLD archive, not the current ticket desk. Scratched into the wax were the words: The bells enter before the hands; even silence keeps its place. By dawn, the envelope had vanished.');
    db.exec('COMMIT');
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }

  const existingApproval = db.prepare('SELECT approval_ref FROM access_approvals WHERE ticket_id = ?').get(130333);
  if (!existingApproval) {
    db.prepare(`INSERT INTO access_approvals
      (approval_ref, ticket_id, claimant_user_id, status)
      VALUES (?, ?, ?, 'APPROVED')`)
      .run(randomBytes(12).toString('hex'), 130333, findUser('chamharouch').id);
  }
  db.prepare(`UPDATE access_approvals SET redeemed_by_user_id = ?,
    last_issued_at = COALESCE(last_issued_at, redeemed_at)
    WHERE ticket_id = 130333 AND redeemed_at IS NOT NULL
      AND redeemed_by_user_id IS NULL`).run(findUser('hmar_lill').id);

  const ghost = db.prepare(`INSERT OR IGNORE INTO ghost_profiles
    (id, owner_user_id, nickname, haunt_level, favorite_food, epitaph)
    VALUES (?, ?, ?, ?, ?, ?)`);
  ghost.run(41, findUser('hmar_lill').id, 'Casper Jr.', 2, 'Cold mint tea',
    'A ghost who filed 108 complaints about overtime.');
  ghost.run(42, findUser('chamharouch').id, 'Slimer II', 9, 'Expired couscous',
    "Some archived files use old ledger numbers, not today's sequential ticket numbers. Ghosts have owners; tickets should too.");
  ghost.run(43, findUser('aicha_kandisha').id, 'Lady Booington', 7, 'Invisible rfissa',
    'I reviewed the socks. Great for feet you cannot see.');
  ghost.run(7, findUser('hmar_lill').id, 'The Lucky Spectre', 7, 'Seven olives',
    'Lucky number seven. Seven doors, zero useful keys.');
  ghost.run(13, findUser('chamharouch').id, 'Sidi Thirteen', 13, 'Thirteen almonds',
    'The personnel clerk laughed at the word RESET: You cannot reset a sealed slip, habibi. Approved slips are REDEEMED. Then he vanished during lunch.');
  db.prepare('UPDATE ghost_profiles SET epitaph = ? WHERE id = 13').run(
    'The personnel clerk laughed at the word RESET: You cannot reset a sealed slip, habibi. Approved slips are REDEEMED. Then he vanished during lunch.');
  ghost.run(3, findUser('hmar_lill').id, 'Three Knocks', 3, 'Cold msemen',
    'Knock thrice. On the fourth knock the ghost calls the police.');
  ghost.run(33, findUser('chamharouch').id, 'The Third Hour', 3, 'Dark coffee',
    '3:33 is not bedtime. It is the accounting department lunch break.');
  ghost.run(69, findUser('hmar_lill').id, 'El Fantasma', 6, 'Popcorn',
    'An immature number for a very mature ghost.');
  ghost.run(111, findUser('chamharouch').id, 'One One One', 1, 'Mint tea',
    'Three knocks, one complaint, no answers.');
  ghost.run(333, findUser('hmar_lill').id, 'The Half-Beast', 3, 'Cursed dates',
    'The other half of the apocalypse was postponed until Monday.');
  ghost.run(444, findUser('chamharouch').id, 'Fourfold Shadow', 4, 'Burnt bread',
    'Four is unlucky in some worlds. Here, the bad luck is customer service.');
  ghost.run(1313, findUser('hmar_lill').id, 'Double Thirteen', 13, 'Black olives',
    'Twice the superstition and twice the paperwork.');
  ghost.run(1337, findUser('chamharouch').id, 'Elite Poltergeist', 7, 'RGB-flavored air',
    'I typed sudo boo. The computer politely refused.');
  ghost.run(66, findUser('hmar_lill').id, 'Half the Beast', 6, 'Harira after midnight',
    'I lost the final digit and my dignity.');
  ghost.run(404, findUser('aicha_kandisha').id, 'Not Found', 4, 'Missing biscuits',
    'Ghost found. Desk not found. I was told the archive counter has its own index; everyone keeps knocking on the wrong window.');
  ghost.run(666, findUser('chamharouch').id, 'The Accountant of Doom', 66, 'Burned invoices',
    'You summoned the accounting department. That is somehow worse.');
  ghost.run(777, findUser('hmar_lill').id, 'Lucky Cousin', 7, 'Seven mint teas',
    'Three sevens! One disappointment!');
  ghost.run(999, findUser('chamharouch').id, 'The Almost-Legend', 99, 'Golden carrots',
    'You found a large number and a small amount of meaning.');
  db.prepare('UPDATE ghost_profiles SET epitaph = ? WHERE id = 13').run(
    'The personnel clerk laughed at the word RESET: You cannot reset a sealed slip, habibi. Approved slips are REDEEMED. Then he vanished during lunch.');
  db.prepare('UPDATE ghost_profiles SET epitaph = ? WHERE id = 42').run(
    "Some archived files use old ledger numbers, not today's sequential ticket numbers. Ghosts have owners; tickets should too.");
  db.prepare('UPDATE ghost_profiles SET epitaph = ? WHERE id = 404').run(
    'Ghost found. Desk not found. I was told the archive counter has its own index; everyone keeps knocking on the wrong window.');

  db.prepare(`UPDATE ghost_profiles SET is_assigned =
    CASE WHEN id IN (41, 42, 43) THEN 1 ELSE 0 END`).run();
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_one_assigned_ghost
    ON ghost_profiles(owner_user_id) WHERE is_assigned = 1;`);

  const seedWallet = db.prepare('INSERT OR IGNORE INTO wallets (owner_user_id, balance) VALUES (?, ?)');
  seedWallet.run(findUser('hmar_lill').id, 85);
  seedWallet.run(findUser('chamharouch').id, 998);
  seedWallet.run(findUser('aicha_kandisha').id, 120);
  db.prepare('INSERT OR IGNORE INTO ritual_voucher (id, code) VALUES (1, ?)')
    .run(`WISP-${randomBytes(14).toString('hex').toUpperCase()}`);

  const product = db.prepare(`INSERT OR IGNORE INTO products
    (id, name, description, price, coupon_eligible) VALUES (?, ?, ?, ?, ?)`);
  product.run('spectral-socks', 'Spectral Socks',
    'Perfect for cold feet, including the ones you no longer have.', 20, 1);
  product.run('haunted-mug', 'Possessed Tea Mug',
    'Refills itself with mint tea. Complains about the service.', 45, 1);
  product.run('golden-carrot', 'Golden Carrot of Eternal Life',
    'Management insists it is priceless. Accounting says 999 Boo Bucks.', 999, 0);
  const extras = [
    ['graveyard-candle', 'Graveyard Candle', 'Guaranteed to attract at least one unpaid spirit.', 13, 1],
    ['haunted-fern', 'Haunted Potted Fern', 'The leaves move whenever management mentions overtime.', 18, 1],
    ['jinn-teapot', 'Jinn Tea Service', 'Three wishes and one extremely salty mint tea.', 55, 1],
    ['cursed-spellbook', 'Cursed Spellbook', 'A forbidden guide to complaints from the underworld.', 72, 1],
    ['moonstone-lantern', 'Moonstone Lantern', 'Illuminates the corridor nobody dares to enter.', 110, 1],
    ['ectoplasm-cleaner', 'Ectoplasm Cleaner', 'Removes ghost slime but not your unpaid invoices.', 36, 1],
    ['phantom-headphones', 'Phantom Headphones', 'Hear the silent screams of the customer support queue.', 210, 1]
  ];
  for (const item of extras) product.run(...item);

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
