console.info('%cBOOMART', 'color:#bb90e6;font-weight:bold',
  'You opened DevTools in a crypt. Bold. The server remains unimpressed.');
if (!Object.getOwnPropertyDescriptor(window, '__ADMIN__')) {
  let claimed = false;
  let mocked = false;
  Object.defineProperty(window, '__ADMIN__', {
    configurable: true,
    get: () => claimed,
    set(value) {
      claimed = Boolean(value);
      if (!mocked && claimed) {
        mocked = true;
        const toast = document.createElement('aside');
        toast.className = 'devtools-role-toast';
        toast.textContent = 'Congratulations on your cardboard crown. The crypt still knows who you are.';
        toast.setAttribute('role', 'status');
        document.body.append(toast);
        setTimeout(() => toast.remove(), 4000);
      }
    }
  });
}
try {
  if (!localStorage.getItem('role')) localStorage.setItem('role', 'customer');
  if (localStorage.getItem('role') === 'admin' && !sessionStorage.getItem('boomart.role-joke-seen')) {
    sessionStorage.setItem('boomart.role-joke-seen', '1');
    console.info('Roles live in the crypt, not in your pockets.');
    const toast = document.createElement('aside');
    toast.className = 'devtools-role-toast';
    toast.textContent = 'HR has rejected your localStorage promotion. The cardboard crown is nontransferable.';
    document.addEventListener('DOMContentLoaded', () => {
      document.body.append(toast);
      setTimeout(() => toast.remove(), 4000);
    }, { once: true });
  }
} catch { }

const output = document.getElementById('adminOutput');
const feedback = document.getElementById('message');
const overview = document.getElementById('adminOverview');
const context = document.getElementById('consoleContext');
function show(value, heading = 'MANAGEMENT RESPONSE') {
  context.textContent = heading;
  output.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}
async function parse(response) {
  let data;
  try { data = await response.json(); } catch { throw new Error('The crypt returned an unreadable response.'); }
  if (!response.ok) { const error = new Error(data.message || data.error || 'The ghost broke the printer.'); error.body = data; throw error; }
  return data;
}
async function post(path, payload = {}) {
  const { csrfToken } = await parse(await fetch('/api/auth/csrf', { cache: 'no-store' }));
  return parse(await fetch(path, { method: 'POST', headers: {
    'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken
  }, body: JSON.stringify(payload) }));
}
async function get(path) { return parse(await fetch(path, { cache: 'no-store' })); }
const nap = ms => new Promise(resolve => setTimeout(resolve, ms));
get('/api/admin/overview').then(data => {
  overview.textContent = `${data.department} — ${data.shoppingPolicy}`;
}).catch(error => { feedback.textContent = error.message; });
get('/api/shop/wallet').then(data => {
  document.getElementById('managerBalance').textContent = String(data.balance);
}).catch(() => { document.getElementById('managerBalance').textContent = '—'; });
const saved = (key, fallback) => {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
};
const persist = (key, value) => {
  try { localStorage.setItem(key, String(value)); } catch { }
};
const forget = key => { try { localStorage.removeItem(key); } catch {} };
let darkClicks = Math.max(0, Math.min(2, Number(saved('boomart.doom', '0')) || 0));
let adoptAttempts = Math.max(0, Number(saved('boomart.adopt.attempts', '0')) || 0);
function advanceDoom() {
  darkClicks = (darkClicks + 1) % 3;
  persist('boomart.doom', darkClicks);
  persist('boomart.doom.ever', '1');
  applyDoom();
}
function applyDoom() {
  document.body.classList.toggle('admin-haunted-purple', darkClicks === 0 && saved('boomart.doom.ever', '0') === '1');
  document.body.classList.remove('admin-doom', 'admin-doom-second');
  const existing = document.getElementById('doomVeil');
  if (darkClicks === 0) { if (existing) existing.remove(); return; }
  if (existing) { existing.classList.toggle('doom-phase-two', darkClicks === 2); return; }
  const veil = document.createElement('section');
  veil.id = 'doomVeil';
  veil.className = 'doom-veil';
  veil.setAttribute('role', 'dialog');
  veil.setAttribute('aria-modal', 'true');
  veil.setAttribute('aria-label', 'Dark Mode of Doom');
  const mist = document.createElement('div'); mist.className = 'doom-mist'; mist.setAttribute('aria-hidden', 'true');
  const face = document.createElement('img'); face.className = 'doom-face'; face.src = '/assets/doom-face.svg'; face.alt = 'A glowing ghost face floating in the dark';
  const title = document.createElement('h2'); title.textContent = 'YOU CANNOT ESCAPE THE DARK'; title.className = 'doom-proclamation';
  const toggle = document.createElement('button');
  toggle.type = 'button'; toggle.className = 'doom-next-toggle';
  toggle.setAttribute('aria-label', 'Toggle dark mode of doom');
  toggle.title = 'Dark mode of doom';
  toggle.textContent = '◐';
  toggle.addEventListener('click', advanceDoom);
  veil.append(mist, face, title, toggle);
  document.body.append(veil);
  veil.classList.toggle('doom-phase-two', darkClicks === 2);
}
applyDoom();
function openPrinterOffice() {
  const popup = window.open('', 'boomart-print-office', 'width=540,height=680,resizable=yes,scrollbars=yes');
  if (!popup) return null;
  popup.document.open();
  popup.document.write(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>BOOMART Printing Office</title><link rel="stylesheet" href="/style.css"></head>
<body class="receipt-popup"><main class="receipt-paper"><h1>BOOMART PRINTING OFFICE</h1>
<pre id="receiptText">The printer is awakening...</pre>
<div class="receipt-toolbar"><button id="receiptPrint" type="button">Print receipt</button>
<button id="receiptClose" type="button">Close office</button></div></main></body></html>`);
  popup.document.close();
  popup.document.getElementById('receiptPrint').addEventListener('click', () => {
    popup.focus(); popup.print();
  });
  popup.document.getElementById('receiptClose').addEventListener('click', () => popup.close());
  return popup;
}
function ghostPopup(restoring = false) {
  let popup = document.querySelector('.haunted-popup');
  if (popup) { popup.classList.remove('ghost-shudder'); void popup.offsetWidth; popup.classList.add('ghost-shudder'); return; }
  popup = document.createElement('aside');
  popup.className = 'haunted-popup';
  popup.setAttribute('role', 'dialog');
  popup.setAttribute('aria-label', 'BOOMART ghost adoption');
  const header = document.createElement('div'); header.className = 'ghost-popup-header';
  const tag = document.createElement('span'); tag.textContent = 'OFFICIAL AFTERLIFE ADOPTION';
  const prompt = document.createElement('p'); prompt.className = 'ghost-popup-copy';
  prompt.textContent = 'Congratulations. You adopted a ghost with abandonment issues.';
  const picture = document.createElement('img'); picture.src = '/assets/assigned-ghost.webp';
  picture.alt = 'The ghost you have unfortunately adopted';
  const close = document.createElement('button'); close.textContent = 'PLEASE LEAVE'; close.type = 'button';
  header.append(tag); popup.append(header, picture, prompt, close);
  const phrases = [
    'WHY ARE YOU TRYING TO ABANDON ME?', 'I THOUGHT WE WERE FRIENDS.',
    'YOUR CLICK HAS BEEN REJECTED BY THE AFTERLIFE.', 'DO NOT MAKE ME CALL HR.',
    'I WILL FOLLOW YOU UNTIL THE END OF YOUR SHIFT.', 'NICE TRY. STILL HERE.',
    'YOU CAN CLOSE THE TAB. CAN YOU CLOSE YOUR GUILT?'
  ];
  function relocate() {
    adoptAttempts++;
    persist('boomart.adopt.attempts', adoptAttempts);
    prompt.textContent = phrases[(adoptAttempts - 1) % phrases.length];
    const width = popup.getBoundingClientRect().width;
    const height = popup.getBoundingClientRect().height;
    const maxX = Math.max(12, window.innerWidth - width - 16);
    const maxY = Math.max(12, window.innerHeight - height - 16);
    popup.style.left = `${12 + ((adoptAttempts * 193) % Math.max(1, maxX - 12))}px`;
    popup.style.top = `${12 + ((adoptAttempts * 137) % Math.max(1, maxY - 12))}px`;
    popup.classList.remove('ghost-shudder'); void popup.offsetWidth; popup.classList.add('ghost-shudder');
  }
  close.addEventListener('click', relocate);
  const escape = event => {
    if (event.key === 'Escape') {
      popup.remove(); document.removeEventListener('keydown', escape);
      forget('boomart.adopt.active'); forget('boomart.adopt.attempts'); adoptAttempts = 0;
      show('The ghost hates keyboard shortcuts. It will return if invited again.', 'ADOPTION OFFICE');
    }
  };
  document.addEventListener('keydown', escape);
  document.body.append(popup);
  popup.style.left = `${Math.max(12, (window.innerWidth - popup.offsetWidth) / 2)}px`;
  popup.style.top = `${Math.max(12, (window.innerHeight - popup.offsetHeight) / 3)}px`;
  persist('boomart.adopt.active', '1');
  if (restoring) relocate();
  else show('Adoption approved. The CLOSE button is a matter of opinion.', 'ADOPTION OFFICE');
}
async function runAction(action) {
  if (action === 'vault') show(await get('/api/admin/vault'), 'VAULT RESPONSE');
  else if (action === 'export') show('The confidential archive is being delivered. The cats are unionized.', 'ARCHIVE EXPORT');
  else if (action === 'self') show(await post('/api/admin/remove-self'), 'PERSONNEL OFFICE');
  else if (action === 'delete') {
    if (!confirm('Delete all users, including the ghosts?')) { show('Deletion cancelled. Cowardice has been documented.', 'PERSONNEL OFFICE'); return; }
    show('Deleting 404 ghosts... 0%...', 'DELETION SERVICE');
    await nap(650);
    show(await post('/api/admin/delete-all'), 'DELETION SERVICE');
  }
  else if (action === 'audit') {
    const data = await get('/api/admin/audit');
    show(data.events.map(event => `${event.at} ${event.action} — ${event.text}`).join('\n'), 'SECURITY AUDIT');
  }
  else if (action === 'docs') show(await get('/api/admin/docs'), 'LEGACY API INDEX');
  else if (action === 'debug') show(await post('/api/admin/legacy-debug'), 'CONFIGURATION');
  else if (action === 'dark') {
    advanceDoom();
    if (darkClicks === 0) show('The house remembers your visit to the shadows.', 'LIGHTING DEPARTMENT');
  }
  else if (action === 'ghost-accounting') {
    const report = await post('/api/admin/accounting/toggle');
    show([`MODE: ${report.mode}`, '',
      ...report.entries.map(item => `${item.item.padEnd(30)} +${item.credit} / -${item.debit}`),
      '------------------------------------------',
      `CREDITS: ${report.totalCredit} ${report.currency}`,
      `DEBITS: ${report.totalDebit} ${report.currency}`,
      `BALANCE: ${report.balance} ${report.currency}`].join('\n'), 'ACCOUNTING OFFICE');
  }
  else if (action === 'haunt-printer') {
    const office = openPrinterOffice();
    try {
      const job = await post('/api/admin/printer/receipt');
      if (office && !office.closed) {
        office.document.getElementById('receiptText').textContent = job.receipt;
        office.focus();
      }
      show(`JOB ${String(job.jobId).padStart(4, '0')} — ${job.state}\n\n${job.receipt}`,
        'PRINTER SERVICE');
      if (!office) show('The printing office cannot open. Allow popups for this site, then try again.', 'PRINTER SERVICE');
    } catch (error) { if (office && !office.closed) office.close(); throw error; }
  }
  else if (action === 'adopt') ghostPopup();
  else if (action === 'self-destruct') {
    const lock = await post('/api/admin/self-destruct');
    const scene = document.createElement('div');
    scene.className = 'destruction-scene';
    scene.setAttribute('aria-hidden', 'true');
    for (let i = 0; i < 17; i++) {
      const shard = document.createElement('span');
      shard.className = 'destruction-shard';
      shard.style.setProperty('--piece', String(i));
      scene.append(shard);
    }
    document.body.append(scene);
    document.body.classList.add('collapse-sequence');
    await nap(3100);
    location.replace(lock.next);
  }
  else if (action === 'summon') {
    if (!confirm('THE ETERNAL BOARD PRESENTS: One complimentary executive séance! Volunteer your mortal paperwork to our supernatural research department?')) return;
    const data = await post('/api/admin/ritual/summon'); location.replace(data.next);
  }
}
document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', async () => {
  const action = button.dataset.action;
  feedback.textContent = '';
  if (button.tagName !== 'A') button.disabled = true;
  try { await runAction(action); }
  catch (error) { show(error.body || { error: error.message }, action === 'self' ? 'PERSONNEL OFFICE' : 'REQUEST FAILED'); if (action !== 'self') feedback.textContent = error.message; }
  finally { if (button.tagName !== 'A') button.disabled = false; }
}));
if (saved('boomart.adopt.active', '0') === '1') ghostPopup(true);
document.getElementById('logout').addEventListener('click', async () => {
  try { await post('/api/auth/logout'); location.replace('/'); }
  catch (error) { feedback.textContent = error.message; }
});
