import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { rateLimit } from 'express-rate-limit';
import { db, findUserById, hashPassword } from './db.js';

function requireAccount(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'NOT_AUTHENTICATED' });
  if (req.user.status !== 'ACTIVE') {
    return res.status(423).json({ error: 'ACCOUNT_CURSED', message: 'The spirits have locked your soul.' });
  }
  if (req.user.kind !== 'seed') {
    return res.status(403).json({ error: 'GHOSTED_ACCOUNT' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'ADMIN_ONLY', message: 'The spirits forbid you.' });
  }
  next();
}

function numericId(value) {
  if (!/^[1-9][0-9]{0,9}$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

const ticketNumberLore = new Map([
  [1, 'Case one was filed before the store was built. Even the walls deny it.'],
  [3, 'Three knocks were heard. The complaint form remained blank.'],
  [7, 'Seven lucky candles, zero useful documents.'],
  [13, 'Thirteen bells rang. No case was filed under the bell count alone.'],
  [33, 'At 3:33 the archivist went on break. This is not a shelf number.'],
  [42, 'The answer to everything is apparently not a support ticket.'],
  [66, 'Two-thirds of a demon answered the phone. Nobody filed a ticket.'],
  [69, 'The skeletons giggled and refused to explain why.'],
  [111, 'Three identical knocks. Still nobody at the customer service desk.'],
  [333, 'The clock is half haunted. The case is completely absent.'],
  [404, 'You summoned case 404. Naturally it was not found.'],
  [444, 'Four doors, four curses, four hundred and forty-four unanswered complaints.'],
  [666, 'Satan picked up the phone. He says even he has no file under 666.'],
  [777, 'A jackpot! Unfortunately your prize is an empty filing cabinet.'],
  [999, 'Nine hundred ninety-nine souls queued here. None filed this case.'],
  [1313, 'Two unlucky thirteens. The archivist refuses to stamp either.'],
  [1337, 'Legendary hacker. Tragically ordinary missing ticket.']
]);

function invalidNumberMessage(raw, name) {
  if (/^(?:1e5|0x1f|nan|-0)$/i.test(raw)) {
    return 'Scientific notation belongs to scientists. Ghosts file by thumb count.';
  }
  if (/^-?0+$/.test(raw)) return `${name} zero is reserved for the ghost who invented nothing.`;
  if (/^-[0-9]+$/.test(raw)) {
    if (raw === '-13') return 'Thirteen steps below the crypt. The old archives do not use negative shelves.';
    if (raw === '-666') return 'The underworld rejects negative demon numbers. It has enough debt.';
    return `Negative ${name.toLowerCase()} numbers point beneath the basement, not into the archive.`;
  }
  return `The ${name.toLowerCase()} clerk cannot file that reference.`;
}

export function registerRoutes(app, requireCsrf) {
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  app.get('/api/customer/overview', requireAccount, (req, res) => {
    if (req.user.role !== 'customer') {
      return res.status(403).json({ error: 'CUSTOMER_ONLY' });
    }
    const count = db.prepare('SELECT COUNT(*) AS total FROM support_tickets WHERE owner_user_id = ?')
      .get(req.user.id).total;
    res.json({
      username: req.user.username,
      openTickets: count,
      notice: 'Your shift records are being reviewed by the afterlife.'
    });
  });

  app.get('/api/shop/products', requireAccount, (_req, res) => {
    const products = db.prepare(`SELECT id, name, description, price FROM products ORDER BY price`).all();
    res.json({ currency: 'Boo Bucks', products });
  });

  app.get('/api/support/tickets', requireAccount, (req, res) => {
    const tickets = db.prepare(`SELECT id, subject, status, created_at AS createdAt
      FROM support_tickets WHERE owner_user_id = ? ORDER BY id`).all(req.user.id);
    res.json({ tickets });
  });

  const archiveLookupLimit = rateLimit({
    windowMs: 60_000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false,
    keyGenerator: req => `archive-${req.user.id}`,
    handler: (_req, res) => res.status(429).json({ error: 'ARCHIVE_CLERK_OVERWHELMED',
      message: 'The archive clerk fetches only so many folders per minute.' })
  });
  app.get('/api/support/tickets/:id', requireAccount, archiveLookupLimit, (req, res) => {
    const id = numericId(req.params.id);
    if (id === null) return res.status(400).json({ error: 'INVALID_TICKET_ID', message: invalidNumberMessage(req.params.id, 'Ticket') });
    const ticket = db.prepare(`SELECT id, subject, message, status, created_at AS createdAt
      FROM support_tickets WHERE id = ?`).get(id);
    if (!ticket) return res.status(404).json({ error: 'TICKET_NOT_FOUND', message: ticketNumberLore.get(id) || 'The spirits searched the filing cabinet. Nothing but dust.' });
    const approval = db.prepare(`SELECT approval_ref AS approvalRef, status
      FROM access_approvals WHERE ticket_id = ?`).get(id);
    if (approval) {
      res.set('X-Archive-Counter', 'support/approvals');
      ticket.staffRecovery = {
        department: 'Personnel Archive',
        slipRef: approval.approvalRef,
        status: approval.status
      };
    }
    res.json({ ticket });
  });

  app.get('/api/support/approvals', requireAccount, (_req, res) => {
    res.json({
      counter: 'Retired Personnel Approvals',
      ledger: 'R-13',
      notice: 'No passwords live in this ledger. Approved slips have named actions under this counter; the old clerk remembers the verb.',
      caretaker: 'Sidi Thirteen'
    });
  });

  app.get('/api/support/approvals/redeem', requireAccount, (req, res) => {
    res.set('Allow', 'POST');
    res.status(405).json({
      error: 'WRONG_RITUAL_VERB',
      message: 'This counter accepts approved recovery slips only through POST.',
      expectedField: 'approval_ref'
    });
  });

  const redeemLimit = rateLimit({
    windowMs: 60_000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false
  });
  app.post('/api/support/approvals/redeem', requireAccount, requireCsrf, redeemLimit,
    async (req, res, next) => {
      try {
        if (req.user.role !== 'customer') {
          return res.status(403).json({ error: 'CUSTOMER_ONLY' });
        }
        if (req.body && ['user_id', 'claimant', 'beneficiary'].some(key =>
          Object.hasOwn(req.body, key))) {
          return res.status(400).json({ error: 'NO_BENEFICIARY_SUGGESTIONS',
            message: 'The clerk does not accept beneficiary suggestions.' });
        }
        const ref = req.body?.approval_ref;
        if (typeof ref !== 'string' || !/^[a-f0-9]{24}$/.test(ref)) {
          return res.status(400).json({ error: 'INVALID_APPROVAL_REFERENCE' });
        }
        const approval = db.prepare(`SELECT approval_ref, claimant_user_id, status, redeemed_at, redeemed_by_user_id
          FROM access_approvals WHERE approval_ref = ?`).get(ref);
        if (!approval) {
          const obviousSlip = /^(?:0{24}|f{24}|(?:deadbeef){3}|(?:123456){4})$/i.test(ref);
          return res.status(404).json({ error: 'APPROVAL_NOT_FOUND',
            ...(obviousSlip ? { message: 'The clerk checks the obvious slips first. Sidi Thirteen is laughing.' } : {}) });
        }
        if (approval.status !== 'APPROVED') {
          return res.status(409).json({ error: 'APPROVAL_REVOKED' });
        }
        if (approval.redeemed_at !== null && approval.redeemed_by_user_id !== req.user.id) {
          return res.status(409).json({ error: 'APPROVAL_ALREADY_CLAIMED' });
        }
        const beneficiary = findUserById(approval.claimant_user_id);
        if (!beneficiary || beneficiary.username !== 'chamharouch' || beneficiary.role !== 'admin' ||
            beneficiary.kind !== 'seed' || !['ACTIVE', 'CURSED'].includes(beneficiary.status)) {
          return res.status(409).json({ error: 'STAFF_RECOVERY_UNAVAILABLE' });
        }

        const temporaryPassword = randomBytes(24).toString('base64url');
        const newHash = await hashPassword(temporaryPassword);
        db.exec('BEGIN IMMEDIATE');
        try {
          const current = db.prepare(`SELECT status, redeemed_at, redeemed_by_user_id
            FROM access_approvals WHERE approval_ref = ?`).get(ref);
          if (!current || current.status !== 'APPROVED' ||
              (current.redeemed_at !== null && current.redeemed_by_user_id !== req.user.id)) {
            db.exec('ROLLBACK');
            return res.status(409).json({ error: 'APPROVAL_ALREADY_CLAIMED' });
          }
          const issuedAt = Date.now();
          db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, beneficiary.id);
          db.prepare(`UPDATE access_approvals SET
            redeemed_at = COALESCE(redeemed_at, ?),
            redeemed_by_user_id = COALESCE(redeemed_by_user_id, ?),
            last_issued_at = ?,
            reissue_count = reissue_count + ?
            WHERE approval_ref = ?`).run(issuedAt, req.user.id, issuedAt,
              current.redeemed_at === null ? 0 : 1, ref);
          db.prepare('DELETE FROM sessions WHERE user_id = ?').run(beneficiary.id);
          db.exec('COMMIT');
        } catch (error) {
          if (db.isTransaction) db.exec('ROLLBACK');
          throw error;
        }
        res.json({
          message: 'The night manager has been summoned. HR regrets this decision.',
          credentials: { username: beneficiary.username, temporaryPassword },
          notice: 'Only the newest temporary password works. If lost, the original claimant may submit the same slip again.'
        });
      } catch (error) { next(error); }
    });

  app.get('/api/ghosts/me/profile', requireAccount, (req, res) => {
    const ghost = db.prepare(`SELECT id, nickname, haunt_level AS hauntLevel,
      favorite_food AS favoriteFood, epitaph FROM ghost_profiles WHERE owner_user_id = ? AND is_assigned = 1
      LIMIT 1`).get(req.user.id);
    if (!ghost) return res.status(404).json({ error: 'GHOST_NOT_FOUND' });
    res.json({ ghost });
  });

  const ghostLookupLimit = rateLimit({
    windowMs: 60_000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false,
    keyGenerator: req => `ghost-${req.user.id}`,
    handler: (_req, res) => res.status(429).json({ error: 'GHOST_REGISTRY_BUSY',
      message: 'The spectral librarian refuses to alphabetize any more souls.' })
  });
  app.get('/api/ghosts/:id/profile', requireAccount, ghostLookupLimit, (req, res) => {
    const id = numericId(req.params.id);
    if (id === null) return res.status(400).json({ error: 'INVALID_GHOST_ID', message: invalidNumberMessage(req.params.id, 'Ghost') });
    const ghost = db.prepare(`SELECT id, nickname, haunt_level AS hauntLevel,
      favorite_food AS favoriteFood, epitaph FROM ghost_profiles WHERE id = ?`).get(id);
    if (!ghost) return res.status(404).json({ error: 'GHOST_NOT_FOUND', message: ticketNumberLore.get(id) || 'Even the dead have never heard of that ghost.' });
    const owned = db.prepare('SELECT 1 FROM ghost_profiles WHERE id = ? AND owner_user_id = ?')
      .get(id, req.user.id);
    res.json({
      ghost,
      ...(owned ? {} : { paranormalNotice: "This file belongs to another ghost. Congratulations: you stole their biography, and somehow it is still less useful than your night-shift payslip." })
    });
  });

  const staffOnly = [requireAccount, requireAdmin];

  app.get('/api/admin/audit', ...staffOnly, (req, res) => {
    if (req.session.legacyDebug) res.set('X-Legacy-Archive', 'SHIFT_LEDGER');
    const entry = db.prepare('SELECT seal FROM staff_shift_seals WHERE staff_user_id = ?')
      .get(req.user.id);
    res.json({ events: [
      { at: '03:33', action: 'LOGIN', text: 'Manager arrived from 666.666.666.666. Geolocation unavailable.' },
      { at: '03:34', action: 'PAYROLL', text: 'The carrots received a performance bonus.' },
      { at: '03:35', action: 'SHIFT_LEDGER', text: 'Personnel keeps the relief receipt off the books.',
        metadata: { seal: entry?.seal } },
      { at: '03:36', action: 'ACCESS', text: 'The CEO of the cemetery forgot which grave was his.' },
      { at: '03:37', action: 'ALERT', text: 'Security team went for mint tea. Never returned.' }
    ] });
  });

  app.get('/api/admin/vault', ...staffOnly, (_req, res) => {
    res.json({ title: 'TOP SECRET ADMIN VAULT',
      flag: 'HAUNTED{THE_VAULT_CONTAINS_ONLY_DUST}',
      warning: 'The vault was last audited by a blind bat. Complaints are accepted in triplicate.' });
  });

  app.get('/api/admin/docs', ...staffOnly, (req, res) => {
    if (req.session.legacyDebug) res.set('X-Legacy-Service', 'DEPRECATED-CATALOGUE');
    res.json({
      catalog: ['summon-carrot','resurrect-payroll','unhaunt-printer','delete-universe',
        'unseal-coffin','restore-coffee','rotate-coffin','archive-moon','teleport-cat','ghost-refund',
        'reverse-gravity','polish-horns','summon-auditor','vacuum-souls','last-living-dev']
        .map(name => `/api/admin/${name}`),
      message: 'Network operations catalogue — handwritten by the IT necromancer in 1899.'
    });
  });

  const retiredEntries = new Map([
    ['summon-carrot', 'The carrot refused to attend its own summoning.'],
    ['resurrect-payroll', 'The payslips rose from the grave, demanding overtime.'],
    ['unhaunt-printer', 'The printer is unionized with the poltergeists.'],
    ['delete-universe', 'Universe deletion requires three signatures from dead directors.'],
    ['unseal-coffin', 'The coffin is sealed until its occupant pays storage fees.'],
    ['restore-coffee', 'The coffee machine is possessed by a decaf demon.'],
    ['rotate-coffin', 'The coffin completed a full rotation. Nobody was impressed.'],
    ['archive-moon', 'The lunar filing service no longer accepts earthly paperwork.'],
    ['teleport-cat', 'The cat teleported to accounting and took the receipts.'],
    ['ghost-refund', 'The cashier tried to refund a customer who died twice.'],
    ['reverse-gravity', 'Gravity filed a resignation notice. The ceiling refused.'],
    ['polish-horns', 'The horn polishing department has run out of cursed wax.'],
    ['summon-auditor', 'The auditor arrived, saw the books, and left this plane.'],
    ['vacuum-souls', 'The vacuum bag is full of unpaid interns.'],
    ['last-living-dev', 'The final developer turned off their pager in 1899.']
  ]);
  app.get('/api/admin/:legacyFeature', ...staffOnly, (req, res, next) => {
    const message = retiredEntries.get(req.params.legacyFeature);
    if (!message) return next();
    res.status(410).json({ error: 'SERVICE_RETIRED', message,
      service: req.params.legacyFeature, stamped: 'DEPARTMENT OF UNFINISHED BUSINESS' });
  });

  app.post('/api/admin/remove-self', ...staffOnly, requireCsrf, (_req, res) => {
    res.status(409).json({ error: 'PAYROLL_LOCK',
      message: 'Staff cannot delete themselves during a shift. HR files relief, not deletion. The cats ate the manual.' });
  });
  app.post('/api/admin/self-destruct', ...staffOnly, requireCsrf, (req, res) => {
    const until = Date.now() + 15_000;
    db.prepare(`INSERT INTO site_meltdowns (staff_user_id, until_at)
      VALUES (?, ?) ON CONFLICT(staff_user_id) DO UPDATE SET until_at = excluded.until_at`)
      .run(req.user.id, until);
    res.json({ ok: true, next: '/admin' });
  });

  app.post('/api/admin/delete-all', ...staffOnly, requireCsrf, (_req, res) => {
    res.json({ ok: false, message: 'Deleting 404 ghosts... Failed: even the database refuses to die.' });
  });
  app.post('/api/admin/legacy-debug', ...staffOnly, requireCsrf, (req, res) => {
    req.session.legacyDebug = !req.session.legacyDebug;
    res.json({ enabled: Boolean(req.session.legacyDebug),
      notice: req.session.legacyDebug ? 'The antique stamp is back on the books.' : 'The ink has gone dry.' });
  });

  const accounts = Object.freeze([
    { item: 'Spectral sock sales', credit: 420, debit: 0 },
    { item: 'Mint tea for night watch', credit: 0, debit: 37 },
    { item: 'Ghost overtime', credit: 0, debit: 133 },
    { item: 'Bat insurance reimbursements', credit: 88, debit: 0 }
  ]);
  function accountingLedger(req) {
    const paranormal = Boolean(req.session.paranormalAccounting);
    const entries = [...accounts];
    if (paranormal) entries.push({ item: 'Uncollected ethereal rent', credit: 666, debit: 0 });
    const totalCredit = entries.reduce((sum, row) => sum + row.credit, 0);
    const totalDebit = entries.reduce((sum, row) => sum + row.debit, 0);
    return { department: 'Accounting Office', mode: paranormal ? 'PARANORMAL' : 'ORDINARY',
      currency: 'Boo Bucks', entries, totalCredit, totalDebit, balance: totalCredit - totalDebit };
  }
  app.get('/api/admin/accounting', ...staffOnly, (req, res) => {
    res.json(accountingLedger(req));
  });
  app.post('/api/admin/accounting/toggle', ...staffOnly, requireCsrf, (req, res) => {
    req.session.paranormalAccounting = !req.session.paranormalAccounting;
    res.json(accountingLedger(req));
  });
  app.post('/api/admin/printer/receipt', ...staffOnly, requireCsrf, (req, res) => {
    req.session.printerJobs = (Number(req.session.printerJobs) || 0) + 1;
    const report = accountingLedger(req);
    const lines = [
      'BOOMART | HAUNTED PRINTING OFFICE',
      '------------------------------',
      `JOB NO. ${String(req.session.printerJobs).padStart(4, '0')}`,
      `MODE: ${report.mode}`,
      ...report.entries.map(line => `${line.item}: +${line.credit} / -${line.debit}`),
      '------------------------------',
      `BALANCE: ${report.balance} ${report.currency}`,
      'PRINTER STATUS: THE INK IS SCREAMING',
      '*** END OF TRANSMISSION ***'
    ];
    res.json({ jobId: req.session.printerJobs, receipt: lines.join('\n'), state: 'READY' });
  });

  app.get('/api/admin/export', ...staffOnly, (_req, res) => {
    res.download(fileURLToPath(new URL('../views/cat-export.zip', import.meta.url)),
      'database-export-not-really.zip');
  });

  const reliefLimit = rateLimit({ windowMs: 60_000, limit: 15,
    standardHeaders: 'draft-8', legacyHeaders: false });
  app.post('/api/admin/afterhours/:seal/relieve', ...staffOnly, requireCsrf, reliefLimit,
    async (req, res, next) => {
      try {
        const seal = req.params.seal;
        if (typeof seal !== 'string' || !/^[a-f0-9]{36}$/.test(seal)) {
          return res.status(404).json({ error: 'SHIFT_RECORD_NOT_FOUND' });
        }
        const staff = req.user;
        if (staff.username !== 'chamharouch' || staff.kind !== 'seed' || staff.status !== 'ACTIVE') {
          return res.status(403).json({ error: 'MANAGEMENT_ONLY' });
        }
        const record = db.prepare('SELECT seal FROM staff_shift_seals WHERE staff_user_id = ?')
          .get(staff.id);
        const valid = record && timingSafeEqual(Buffer.from(record.seal, 'hex'), Buffer.from(seal, 'hex'));
        if (!valid) return res.status(404).json({ error: 'SHIFT_RECORD_NOT_FOUND' });
        const civilian = findUserById(staff.linked_customer_id);
        if (!civilian || civilian.username !== 'aicha_kandisha' || civilian.role !== 'customer' ||
            civilian.kind !== 'seed' || civilian.status !== 'ACTIVE' || civilian.verified !== 1) {
          return res.status(409).json({ error: 'LINKED_IDENTITY_UNAVAILABLE' });
        }
        await new Promise((resolve, reject) => req.session.regenerate(err => err ? reject(err) : resolve()));
        req.session.userId = civilian.id;
        await new Promise((resolve, reject) => req.session.save(err => err ? reject(err) : resolve()));
        res.json({ ok: true, next: '/home',
          message: 'Shift finished. Aicha Kandisha has returned to the world of customers.' });
      } catch (error) { next(error); }
    });

  app.post('/api/admin/ritual/summon', ...staffOnly, requireCsrf, (req, res) => {
    if (req.user.username !== 'chamharouch') return res.status(403).json({ error: 'MANAGER_ONLY' });
    const ritualId = randomBytes(12).toString('hex');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(`INSERT INTO rituals (ritual_id, staff_user_id, started_at)
        VALUES (?, ?, ?)`).run(ritualId, req.user.id, Date.now());
      db.prepare("UPDATE users SET status = 'CURSED' WHERE id = ? AND status = 'ACTIVE'")
        .run(req.user.id);
      db.exec('COMMIT');
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw error;
    }
    res.set('X-Ritual-Id', ritualId);
    res.json({ error: 'SUMMONING_SUCCEEDED', message: 'You have been promoted to furniture.', next: '/cursed' });
  });

  function requireCursed(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'NOT_AUTHENTICATED' });
    if (req.user.status !== 'CURSED') return res.status(409).json({ error: 'NOT_CURSED' });
    next();
  }
  const SOUL_TARGET = 100;
  const SOUL_GAIN = 1.6;
  const SOUL_DECAY_PER_SECOND = 4.1;
  const MIN_TAP_GAP_MS = 165;
  const MIN_RITUAL_AGE_MS = 16_000;
  const soulEnergy = (ritual, now) => Math.max(0, Math.min(SOUL_TARGET,
    Number(ritual.manual_energy || 0) -
    SOUL_DECAY_PER_SECOND * Math.max(0, now - (ritual.manual_updated_at || ritual.started_at)) / 1000
  ));
  app.get('/api/rituals/status', requireCursed, (req, res) => {
    const ritual = db.prepare(`SELECT ritual_id, manual_energy, manual_updated_at, started_at
      FROM rituals WHERE staff_user_id = ? AND cleared_at IS NULL`).get(req.user.id);
    if (!ritual) return res.status(409).json({ error: 'RITUAL_MISSING' });
    res.set('X-Ritual-Id', ritual.ritual_id);
    res.json({ energy: soulEnergy(ritual, Date.now()), target: SOUL_TARGET,
      decayPerSecond: SOUL_DECAY_PER_SECOND,
      inscription: 'CBFG /ncv/evghnyf/rkbepvfr',
      message: 'Filed under: unscheduled transformations.' });
  });
  function awardRitualVoucher() {
    db.prepare(`UPDATE ritual_voucher SET unlocked_at = COALESCE(unlocked_at, ?)
      WHERE id = 1`).run(Date.now());
    return db.prepare('SELECT code FROM ritual_voucher WHERE id = 1').get()?.code;
  }
  function clearRitual(userId, ritualId, method) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const ritual = db.prepare(`SELECT ritual_id FROM rituals
        WHERE staff_user_id = ? AND ritual_id = ? AND cleared_at IS NULL`).get(userId, ritualId);
      if (!ritual) { db.exec('ROLLBACK'); return false; }
      db.prepare('UPDATE rituals SET cleared_at = ?, method = ? WHERE ritual_id = ?')
        .run(Date.now(), method, ritualId);
      db.prepare("UPDATE users SET status = 'ACTIVE' WHERE id = ? AND status = 'CURSED'")
        .run(userId);
      db.exec('COMMIT');
      return true;
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw error;
    }
  }
  app.post('/api/rituals/exorcise', requireCursed, requireCsrf, (req, res) => {
    const ritualId = req.body?.ritual_id;
    if (typeof ritualId !== 'string' || !/^[a-f0-9]{24}$/.test(ritualId)) {
      return res.status(400).json({ error: 'INVALID_RITUAL' });
    }
    if (!clearRitual(req.user.id, ritualId, 'header')) {
      return res.status(403).json({ error: 'WRONG_RITUAL' });
    }
    const voucher = awardRitualVoucher();
    res.json({ ok: true, next: '/admin', message: 'The spirits have released you.',
      estateReceipt: { title: 'Unclaimed inheritance of the night', voucher,
        note: 'The customer clerk is not the management clerk. Keep this paper.' } });
  });
  const tapLimit = rateLimit({ windowMs: 60_000, limit: 260,
    standardHeaders: 'draft-8', legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({
      error: 'SPECTRAL_TAP_QUOTA',
      message: 'The unionized ghosts confiscated the tap counter. Let the clock strike again before continuing.'
    }) });
  app.post('/api/rituals/manual-tap', requireCursed, requireCsrf, tapLimit, (req, res, next) => {
    try {
      if (req.body && typeof req.body === 'object' && Object.keys(req.body).length) {
        return res.status(400).json({ error: 'RITUAL_SCORE_NOT_CLIENT_CONTROLLED',
          message: ['energy', 'taps', 'released'].some(k => Object.hasOwn(req.body, k))
            ? 'The soul keeps its own scoreboard.' : 'The soul is not a vending machine.' });
      }
      let result;
      db.exec('BEGIN IMMEDIATE');
      try {
        const ritual = db.prepare(`SELECT ritual_id, manual_energy, manual_updated_at,
          manual_last_tap_at, manual_taps, started_at FROM rituals
          WHERE staff_user_id = ? AND cleared_at IS NULL`).get(req.user.id);
        if (!ritual) { db.exec('ROLLBACK'); return res.status(409).json({ error: 'RITUAL_MISSING' }); }
        const now = Date.now();
        const energy = soulEnergy(ritual, now);
        if (ritual.manual_last_tap_at && now - ritual.manual_last_tap_at < MIN_TAP_GAP_MS) {
          db.exec('ROLLBACK');
          return res.status(429).json({ error: 'TOO_FAST', energy, target: SOUL_TARGET,
            decayPerSecond: SOUL_DECAY_PER_SECOND });
        }
        const nextEnergy = Math.min(SOUL_TARGET, energy + SOUL_GAIN);
        const released = nextEnergy >= SOUL_TARGET && now - ritual.started_at >= MIN_RITUAL_AGE_MS;
        db.prepare(`UPDATE rituals SET manual_energy = ?, manual_updated_at = ?,
          manual_last_tap_at = ?, manual_taps = manual_taps + 1
          WHERE ritual_id = ? AND cleared_at IS NULL`).run(nextEnergy, now, now, ritual.ritual_id);
        if (released) {
          db.prepare('UPDATE rituals SET cleared_at = ?, method = ? WHERE ritual_id = ?')
            .run(now, 'manual', ritual.ritual_id);
          db.prepare("UPDATE users SET status = 'ACTIVE' WHERE id = ? AND status = 'CURSED'")
            .run(req.user.id);
        }
        db.exec('COMMIT');
        result = { energy: nextEnergy, target: SOUL_TARGET,
          ...(ritual.manual_taps + 1 >= 80 && !released
            ? { message: 'Your finger requests hazard pay.' } : {}),
          decayPerSecond: SOUL_DECAY_PER_SECOND, released,
          stabilizing: nextEnergy >= SOUL_TARGET && !released,
          ...(released ? { next: '/admin' } : {}) };
      } catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error; }
      if (result.released) result.estateReceipt = {
        title: 'Unclaimed inheritance of the night', voucher: awardRitualVoucher(),
        note: 'The customer clerk is not the management clerk. Keep this paper.'
      };
      res.json(result);
    } catch (error) { next(error); }
  });

  app.get('/api/admin/overview', requireAccount, requireAdmin, (req, res) => {
    if (req.session.legacyDebug) res.set('X-Legacy-Ledger', '/api/admin/audit');
    res.json({
      department: 'Management of the Damned',
      activeLivingStaff: 0,
      ghostComplaints: 404,
      shoppingPolicy: 'Management buys on credit. The Golden Carrot remains beyond the payroll.',
      notice: 'The admin vault is currently full of extremely classified nothing.'
    });
  });

  const receiptFlag = process.env.FLAG || `HAUNTED{DEV_${randomBytes(16).toString('hex')}}`;
  function requireShopper(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'NOT_AUTHENTICATED' });
    if (req.user.status !== 'ACTIVE') return res.status(423).json({ error: 'ACCOUNT_CURSED' });
    if (req.user.kind !== 'seed') return res.status(403).json({ error: 'GHOSTED_ACCOUNT' });
    next();
  }
  const buyerOnly = [requireAccount, requireShopper];
  const checkoutLimit = rateLimit({ windowMs: 60_000, limit: 25,
    standardHeaders: 'draft-8', legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ error: 'SPECTRAL_CHECKOUT_BUSY',
      message: 'The cashier has counted too many resurrections. Come back after the haunting subsides.' }) });
  function walletBalance(ownerId) {
    return db.prepare('SELECT balance FROM wallets WHERE owner_user_id = ?').get(ownerId)?.balance ?? 0;
  }
  function getCart(ownerId) {
    db.prepare('INSERT OR IGNORE INTO carts (owner_user_id) VALUES (?)').run(ownerId);
    return db.prepare('SELECT id, version, active_quote_id, delivery_mode FROM carts WHERE owner_user_id = ?').get(ownerId);
  }
  function cartLines(cartId) {
    return db.prepare(`SELECT ci.id AS lineId, p.id AS productId, p.name,
      p.description, p.price, ci.quantity, (p.price * ci.quantity) AS lineTotal
      FROM cart_items ci JOIN products p ON p.id = ci.product_id
      WHERE ci.cart_id = ? ORDER BY ci.id`).all(cartId);
  }
  function cartSummary(ownerId) {
    const cart = getCart(ownerId);
    const items = cartLines(cart.id);
    const quote = cart.active_quote_id ? db.prepare(`SELECT coupon_code AS couponCode, total
      FROM checkout_quotes WHERE id = ? AND cart_id = ? AND owner_user_id = ? AND consumed_at IS NULL`)
      .get(cart.active_quote_id, cart.id, ownerId) : null;
    return { items, item: items.length === 1 ? items[0] : null,
      itemCount: items.reduce((n, line) => n + line.quantity, 0),
      subtotal: items.reduce((n, line) => n + line.lineTotal, 0),
      quote: quote || null, version: cart.version,
      deliveryMode: cart.delivery_mode, balance: walletBalance(ownerId), currency: 'Boo Bucks' };
  }
  function validProduct(id) {
    if (typeof id !== 'string' || !/^[a-z][a-z0-9-]{1,40}$/.test(id)) return null;
    return db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  }
  function exactly(body, fields) {
    return body && typeof body === 'object' && !Array.isArray(body) &&
      Object.keys(body).length === fields.length && fields.every(k => Object.hasOwn(body, k));
  }
  app.get('/api/shop/wallet', ...buyerOnly, (req, res) => {
    res.json({ balance: walletBalance(req.user.id), currency: 'Boo Bucks' });
  });
  const treasuryLimit = rateLimit({ windowMs: 60_000, limit: 40,
    standardHeaders: 'draft-8', legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ error: 'TREASURY_DOOR_JAMMED',
      message: 'Forty knocks on the vault door and the accountant still refuses to rise from the grave.' }) });
  function treasuryDenial(req, res) {
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const rawAmount = body.amount ?? body.coins ?? body.balance ?? body.value;
    let message = 'The treasury does not accept handwritten fortunes. The undead accountant has the only key.';
    if (typeof rawAmount === 'number' && rawAmount < 0) {
      message = 'Negative Boo Bucks? The debt collectors from the underworld are already circling.';
    } else if (typeof rawAmount === 'number' && rawAmount > 500) {
      message = 'An enormous donation from thin air! The accountant checked the coffin. It was empty.';
    } else if ('user_id' in body || 'owner_user_id' in body || 'role' in body) {
      message = 'The treasury clerk reads the name on your soul, not the name scribbled on the envelope.';
    } else if ('price' in body || 'total' in body || 'discount' in body) {
      message = 'The cash register refuses unsolicited arithmetic from the living.';
    }
    res.status(403).json({ error: 'PARANORMAL_TREASURY_REJECTED', message });
  }
  for (const name of ['/api/shop/wallet/top-up', '/api/shop/wallet/credit',
    '/api/shop/wallet/transfer', '/api/shop/wallet/mint', '/api/shop/wallet/add-coins']) {
    app.get(name, ...buyerOnly, (_req, res) => {
      res.set('Allow', 'POST');
      res.status(405).json({ error: 'TREASURY_WINDOW_CLOSED',
        message: 'You may examine the treasury hatch, but the dead cashier does not hand out free coins.' });
    });
    app.post(name, ...buyerOnly, requireCsrf, treasuryLimit, treasuryDenial);
  }
  app.get('/api/shop/orders', ...buyerOnly, (req, res) => {
    const orders = db.prepare(`SELECT o.id, o.product_id AS productId, p.name AS productName,
      o.charged, o.created_at AS createdAt,
      COALESCE((SELECT SUM(oi.quantity) FROM order_items oi WHERE oi.order_id = o.id), 1) AS itemCount
      FROM orders o JOIN products p ON p.id = o.product_id
      WHERE o.owner_user_id = ? ORDER BY o.created_at DESC LIMIT 15`).all(req.user.id);
    res.json({ orders, currency: 'Boo Bucks' });
  });
  app.get('/api/shop/cart', ...buyerOnly, (req, res) => res.json(cartSummary(req.user.id)));
  app.post('/api/shop/cart/lines', ...buyerOnly, requireCsrf, (req, res) => {
    const product = exactly(req.body, ['product_id']) ? validProduct(req.body.product_id) : null;
    if (!product) return res.status(400).json({ error: 'INVALID_PRODUCT' });
    const cart = getCart(req.user.id);
    db.exec('BEGIN IMMEDIATE');
    try {
      const existing = db.prepare('SELECT id, quantity FROM cart_items WHERE cart_id = ? AND product_id = ?')
        .get(cart.id, product.id);
      if (existing && (existing.quantity >= 99 || product.id === 'golden-carrot')) {
        db.exec('ROLLBACK'); return res.status(409).json({ error: 'ITEM_LIMIT',
          message: product.id === 'golden-carrot' ? 'The relic cabinet holds only one Golden Carrot.' :
            'Ninety-nine is enough even for an immortal shopper.' });
      }
      if (existing) {
        db.prepare('UPDATE cart_items SET quantity = quantity + 1 WHERE id = ?').run(existing.id);
      } else {
        db.prepare('INSERT INTO cart_items (cart_id, product_id, quantity) VALUES (?, ?, 1)')
          .run(cart.id, product.id);
      }
      const containsRelic = !!db.prepare(`SELECT 1 FROM cart_items WHERE cart_id = ?
        AND product_id = 'golden-carrot'`).get(cart.id);
      db.prepare(`UPDATE carts SET version = version + 1, active_quote_id = NULL,
        delivery_mode = CASE WHEN ? THEN 'reserve' ELSE delivery_mode END WHERE id = ?`)
        .run(containsRelic ? 1 : 0, cart.id);
      db.exec('COMMIT');
    } catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error; }
    res.status(201).json(cartSummary(req.user.id));
  });
  app.delete('/api/shop/cart/lines/:lineId', ...buyerOnly, requireCsrf, (req, res) => {
    const cart = getCart(req.user.id);
    const lineId = numericId(req.params.lineId);
    if (!lineId || !db.prepare('SELECT id FROM cart_items WHERE id = ? AND cart_id = ?').get(lineId, cart.id)) {
      return res.status(404).json({ error: 'CART_LINE_NOT_FOUND' });
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('DELETE FROM cart_items WHERE id = ? AND cart_id = ?').run(lineId, cart.id);
      const hasRelic = !!db.prepare(`SELECT 1 FROM cart_items WHERE cart_id = ?
        AND product_id = 'golden-carrot'`).get(cart.id);
      db.prepare(`UPDATE carts SET version = version + 1, active_quote_id = NULL,
        delivery_mode = ? WHERE id = ?`).run(hasRelic ? 'reserve' : 'standard', cart.id);
      db.exec('COMMIT');
    } catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error; }
    res.json(cartSummary(req.user.id));
  });
  app.patch('/api/shop/cart/lines/:lineId', ...buyerOnly, requireCsrf, (req, res) => {
    const lineId = numericId(req.params.lineId);
    const cart = getCart(req.user.id);
    const existing = lineId && db.prepare(`SELECT ci.id, ci.product_id, ci.quantity
      FROM cart_items ci WHERE ci.id = ? AND ci.cart_id = ?`).get(lineId, cart.id);
    if (!existing) return res.status(404).json({ error: 'CART_LINE_NOT_FOUND' });
    if (exactly(req.body, ['quantity'])) {
      const quantity = req.body.quantity;
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99 ||
          (existing.product_id === 'golden-carrot' && quantity !== 1)) {
        return res.status(400).json({ error: 'INVALID_QUANTITY',
          message: typeof quantity === 'number' && quantity < 0
            ? 'Negative carrots? The debt collectors are already circling.'
            : typeof quantity === 'number' && !Number.isInteger(quantity)
              ? 'Half a carrot is a vegetable crime.'
              : 'The stockroom counts whole objects, and only one sealed relic.' });
      }
      if (quantity === existing.quantity) return res.json(cartSummary(req.user.id));
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('UPDATE cart_items SET quantity = ? WHERE id = ? AND cart_id = ?')
          .run(quantity, lineId, cart.id);
        db.prepare('UPDATE carts SET version = version + 1, active_quote_id = NULL WHERE id = ?').run(cart.id);
        db.exec('COMMIT');
      } catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error; }
      return res.json(cartSummary(req.user.id));
    }
    if (exactly(req.body, ['product_id'])) {
      const product = validProduct(req.body.product_id);
      if (!product || (product.id === 'golden-carrot' && existing.quantity !== 1)) {
        return res.status(400).json({ error: 'INVALID_CART_CHANGE' });
      }
      if (existing.product_id === product.id) return res.json(cartSummary(req.user.id));
      if (db.prepare('SELECT 1 FROM cart_items WHERE cart_id = ? AND product_id = ?')
        .get(cart.id, product.id)) return res.status(409).json({ error: 'ITEM_ALREADY_PRESENT',
        message: 'That item is already in your basket. Adjust its quantity instead.' });
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('UPDATE cart_items SET product_id = ? WHERE id = ? AND cart_id = ?')
          .run(product.id, lineId, cart.id);
        const hasRelic = !!db.prepare(`SELECT 1 FROM cart_items WHERE cart_id = ?
          AND product_id = 'golden-carrot'`).get(cart.id);
        db.prepare(`UPDATE carts SET version = version + 1, active_quote_id = NULL,
          delivery_mode = ? WHERE id = ?`).run(hasRelic ? 'reserve' : 'standard', cart.id);
        db.exec('COMMIT');
      } catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error; }
      return res.json(cartSummary(req.user.id));
    }
    if (!exactly(req.body, ['delivery_mode']) || !['standard', 'express', 'reserve'].includes(req.body.delivery_mode)) {
      return res.status(400).json({ error: 'INVALID_CART_CHANGE',
        message: 'The dispatch office accepts a delivery mode, not a financial prophecy.' });
    }
    const hasRelic = !!db.prepare(`SELECT 1 FROM cart_items WHERE cart_id = ?
      AND product_id = 'golden-carrot'`).get(cart.id);
    if (hasRelic && existing.product_id !== 'golden-carrot') {
      return res.status(409).json({ error: 'SEALED_RELIC_DISPATCH',
        message: 'Ordinary parcel clerks cannot alter the relic dispatch docket.' });
    }
    if (cart.delivery_mode === req.body.delivery_mode) return res.json(cartSummary(req.user.id));
    if (req.body.delivery_mode === 'reserve' && existing.product_id !== 'golden-carrot') {
      return res.status(409).json({ error: 'RESERVATION_NOT_REQUIRED' });
    }
    db.prepare('UPDATE carts SET delivery_mode = ?, version = version + 1 WHERE id = ?')
      .run(req.body.delivery_mode, cart.id);
    res.json(cartSummary(req.user.id));
  });
  const couponLimit = rateLimit({
    windowMs: 60_000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false,
    keyGenerator: req => `coupon-${req.user.id}`,
    handler: (_req, res) => res.status(429).json({ error: 'COUPON_CLERK_OVERWHELMED',
      message: 'The coupon ghost has run out of ink for this minute.' })
  });
  app.post('/api/shop/quote/coupon', ...buyerOnly, requireCsrf, couponLimit, (req, res) => {
    if (!exactly(req.body, ['code']) || typeof req.body.code !== 'string' || req.body.code.length > 64) {
      return res.status(400).json({ error: 'INVALID_COUPON' });
    }
    const submitted = req.body.code;
    if (submitted === 'FREE100') {
      const cart = getCart(req.user.id);
      const lines = cartLines(cart.id);
      if (!lines.length) return res.status(409).json({ error: 'CART_EMPTY' });
      if (lines.some(line => line.productId === 'golden-carrot')) {
        return res.status(409).json({ error: 'FREE100_RELIC_EXCLUDED',
          message: 'The coupon ghost pays for ordinary hauntings, not royal relics. One Golden Carrot curses the whole basket.' });
      }
      const quoteId = randomBytes(18).toString('hex');
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare(`INSERT INTO checkout_quotes (id, cart_id, owner_user_id, coupon_code,
          product_at_validation, cart_version, total, created_at, delivery_mode_at_validation)
          VALUES (?, ?, ?, 'FREE100', ?, ?, 0, ?, ?)`).run(quoteId, cart.id, req.user.id,
            lines[0].productId, cart.version, Date.now(), cart.delivery_mode);
        db.prepare('UPDATE carts SET active_quote_id = ? WHERE id = ?').run(quoteId, cart.id);
        db.exec('COMMIT');
      } catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error; }
      return res.json(cartSummary(req.user.id));
    }
    const voucher = db.prepare('SELECT code, unlocked_at FROM ritual_voucher WHERE id = 1').get();
    const knownCode = Boolean(voucher?.unlocked_at &&
      /^WISP-[A-F0-9]{28}$/.test(submitted) &&
      /^WISP-[A-F0-9]{28}$/.test(voucher.code) &&
      timingSafeEqual(Buffer.from(submitted, 'ascii'), Buffer.from(voucher.code, 'ascii')));
    if (!knownCode) {
      const phrases = [
        'The registrar cannot locate this incantation in the ledger.',
        'The discount ghost just stared at that code and drifted away.',
        'No such voucher was ever buried in our filing cabinet.',
        'The coupon clerk stamped this paper with a tiny skull.'
      ];
      const choice = createHash('sha256').update(submitted).digest()[0] % phrases.length;
      return res.status(400).json({ error: 'COUPON_NOT_ACCEPTED', message: phrases[choice] });
    }
    if (req.user.username !== 'aicha_kandisha' || req.user.role !== 'customer' || req.user.verified !== 1) {
      return res.status(403).json({ error: 'PERSONNEL_VOUCHER_REJECTED',
        message: req.user.role === 'admin'
          ? 'This voucher was issued to a specific soul. Unfortunately, Chamharouch, your name is not written on it. Even the King of Jinn cannot spend someone else\'s inheritance.'
          : 'Nice try, night-shift worker. This inheritance was addressed to another soul. The dead take coupon ownership very seriously.' });
    }
    const cart = getCart(req.user.id);
    const lines = cartLines(cart.id);
    if (!lines.length) return res.status(409).json({ error: 'CART_EMPTY' });
    if (lines.length !== 1 || lines[0].productId !== 'golden-carrot' || lines[0].quantity !== 1) {
      return res.status(409).json({ error: 'ARTIFACT_ONLY',
        message: 'The inheritance is bound to one sealed artifact, without other cargo.' });
    }
    const current = { id: lines[0].productId, price: lines[0].price };
    if (cart.delivery_mode !== 'reserve') return res.status(409).json({ error: 'RESERVATION_REQUIRED',
      message: 'The notary approves inheritances held in custody, never express deliveries.' });
    const quoteId = randomBytes(18).toString('hex');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(`INSERT INTO checkout_quotes (id, cart_id, owner_user_id, coupon_code,
        product_at_validation, cart_version, total, created_at, delivery_mode_at_validation)
        VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`).run(quoteId, cart.id, req.user.id,
          voucher.code, current.id, cart.version, Date.now(), cart.delivery_mode);
      db.prepare('UPDATE carts SET active_quote_id = ? WHERE id = ?').run(quoteId, cart.id);
      db.exec('COMMIT');
    } catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error; }
    res.json(cartSummary(req.user.id));
  });
  app.post('/api/shop/checkout', ...buyerOnly, requireCsrf, checkoutLimit, (req, res) => {
    if (!exactly(req.body, [])) return res.status(400).json({ error: 'UNEXPECTED_CHECKOUT_FIELDS',
      message: 'Boo Bucks are counted by the cashier, not supplied in your request.' });
    const cart = getCart(req.user.id);
    let orderId;
    db.exec('BEGIN IMMEDIATE');
    try {
      const lines = cartLines(cart.id);
      if (!lines.length) { db.exec('ROLLBACK'); return res.status(409).json({ error: 'CART_EMPTY',
        message: 'That hearse has already departed with the basket. It refuses to carry the same order twice.' }); }
      const hasRelic = lines.some(line => line.productId === 'golden-carrot');
      if (cart.delivery_mode === 'reserve' || (hasRelic && cart.delivery_mode !== 'express')) {
        db.exec('ROLLBACK'); return res.status(409).json({ error: 'RESERVATION_PENDING',
          message: 'The carrot is under glass. The delivery office has not released it.' });
      }
      const subtotal = lines.reduce((total, line) => total + line.lineTotal, 0);
      const current = { id: lines[0].productId, price: lines[0].price };
      const quote = cart.active_quote_id ? db.prepare(`SELECT * FROM checkout_quotes
        WHERE id = ? AND cart_id = ? AND owner_user_id = ? AND consumed_at IS NULL`)
        .get(cart.active_quote_id, cart.id, req.user.id) : null;
      const eligibleQuotedCart = lines.length === 1 && lines[0].productId === 'golden-carrot' &&
        lines[0].quantity === 1 && quote?.product_at_validation === 'golden-carrot';
      const free100QuotedCart = quote?.coupon_code === 'FREE100' && !hasRelic &&
        lines.length > 0 && quote.cart_version === cart.version &&
        quote.delivery_mode_at_validation === cart.delivery_mode &&
        quote.product_at_validation === lines[0].productId;
      if (quote?.coupon_code === 'FREE100' && !free100QuotedCart) {
        db.exec('ROLLBACK');
        return res.status(409).json({ error: 'DISCOUNT_QUOTE_EXPIRED',
          message: 'The coupon ghost needs to restamp this changed delivery docket.' });
      }
      const charged = (free100QuotedCart || (quote && eligibleQuotedCart)) ? quote.total : subtotal;
      const deducted = db.prepare(`UPDATE wallets SET balance = balance - ?
        WHERE owner_user_id = ? AND balance >= ?`).run(charged, req.user.id, charged);
      if (deducted.changes !== 1) {
        db.exec('ROLLBACK'); return res.status(402).json({ error: 'INSUFFICIENT_BOO_BUCKS',
          message: `The cashier counts ${walletBalance(req.user.id)} Boo Bucks. No amount of racing the clock mints another.` });
      }
      orderId = randomBytes(18).toString('hex');
      const voucher = db.prepare('SELECT code, unlocked_at FROM ritual_voucher WHERE id = 1').get();
      const won = req.user.username === 'aicha_kandisha' && req.user.role === 'customer' &&
        req.user.kind === 'seed' && req.user.verified === 1 && eligibleQuotedCart &&
        quote?.coupon_code !== 'FREE100' &&
        cart.delivery_mode === 'express' && quote?.product_at_validation === 'golden-carrot' &&
        quote.delivery_mode_at_validation === 'reserve' && quote.cart_version !== cart.version &&
        voucher?.unlocked_at && quote.coupon_code === voucher.code && charged === 0;
      db.prepare(`INSERT INTO orders (id, owner_user_id, product_id, regular_price,
        charged, coupon_code, flag_awarded, created_at, delivery_mode)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(orderId, req.user.id,
          current.id, subtotal, charged, (free100QuotedCart || eligibleQuotedCart) ? quote?.coupon_code || null : null, won ? 1 : 0,
          Date.now(), cart.delivery_mode);
      const insertOrderItem = db.prepare(`INSERT INTO order_items
        (order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)`);
      for (const line of lines) insertOrderItem.run(orderId, line.productId, line.quantity, line.price);
      if (quote) db.prepare('UPDATE checkout_quotes SET consumed_at = ? WHERE id = ?').run(Date.now(), quote.id);
      db.prepare('DELETE FROM cart_items WHERE cart_id = ?').run(cart.id);
      db.prepare(`UPDATE carts SET version = version + 1, active_quote_id = NULL,
        delivery_mode = 'standard' WHERE id = ?`).run(cart.id);
      db.exec('COMMIT');
    } catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error; }
    res.status(201).json({ ok: true, orderId, next: `/shop/orders/${orderId}` });
  });

  app.get('/api/shop/orders/:id', ...buyerOnly, (req, res) => {
    if (!/^[a-f0-9]{36}$/.test(req.params.id)) {
      return res.status(404).json({ error: 'RECEIPT_NOT_FOUND' });
    }
    const order = db.prepare(`SELECT o.id, o.product_id AS productId, p.name AS productName,
      o.regular_price AS regularPrice, o.charged, o.coupon_code AS couponCode,
      o.flag_awarded AS flagAwarded, o.created_at AS createdAt
      FROM orders o JOIN products p ON o.product_id = p.id
      WHERE o.id = ? AND o.owner_user_id = ?`).get(req.params.id, req.user.id);
    if (!order) return res.status(404).json({ error: 'RECEIPT_NOT_FOUND' });
    const lines = db.prepare(`SELECT oi.product_id AS productId, p.name, oi.quantity,
      oi.unit_price AS unitPrice, (oi.unit_price * oi.quantity) AS lineTotal
      FROM order_items oi JOIN products p ON p.id = oi.product_id
      WHERE oi.order_id = ?`).all(order.id);
    if (!lines.length) lines.push({ productId: order.productId, name: order.productName,
      quantity: 1, unitPrice: order.regularPrice, lineTotal: order.regularPrice });
    const receipt = { items: lines, id: order.id, productId: order.productId,
      productName: order.productName, regularPrice: order.regularPrice,
      charged: order.charged, couponCode: order.couponCode, createdAt: order.createdAt,
      status: 'DELIVERED TO THE AFTERLIFE', currency: 'Boo Bucks' };
    if (order.flagAwarded) receipt.flag = receiptFlag;
    res.json({ receipt });
  });

}
