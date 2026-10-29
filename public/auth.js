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

const page = document.body.dataset.page;
const message = document.getElementById('message');

async function readJson(response) {
  const body = await response.json();
  if (!response.ok) {
    const error = new Error(body.message || body.error || 'The spirits lost your request.');
    error.code = body.error;
    error.ghostTrial = body.ghostTrial === true;
    throw error;
  }
  return body;
}

async function post(path, payload = {}) {
  const { csrfToken } = await readJson(await fetch('/api/auth/csrf', {
    cache: 'no-store', credentials: 'same-origin'
  }));
  return readJson(await fetch(path, {
    method: 'POST',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify(payload)
  }));
}

async function verifyLogin(expectedUsername) {
  const response = await fetch('/api/auth/me', {
    cache: 'no-store', credentials: 'same-origin'
  });
  if (!response.ok) {
    throw new Error('The portal opened, but your session did not survive. Please retry.');
  }
  const account = await response.json();
  if (account.username !== expectedUsername) {
    throw new Error('The wrong soul answered the portal. Please sign in again.');
  }
}

function depart(destination, announcement) {
  message.textContent = announcement;
  document.body.dataset.transitionMessage = announcement;
  document.body.classList.add('soul-transition');
  setTimeout(() => location.replace(destination), 650);
}

function phantomLoginShow() {
  if (document.getElementById('phantomRootScene')) return;
  const scene = document.createElement('div');
  scene.id = 'phantomRootScene';
  scene.className = 'phantom-root-scene';
  scene.setAttribute('role', 'dialog');
  scene.setAttribute('aria-modal', 'true');
  scene.setAttribute('aria-label', 'The old operator answers');
  const card = document.createElement('section');
  card.className = 'phantom-root-card';
  const ghost = document.createElement('img');
  ghost.src = '/assets/doom-face.svg';
  ghost.alt = 'An unsettling ghost is laughing at the login attempt';
  const eyebrow = document.createElement('p'); eyebrow.className = 'eyebrow';
  eyebrow.textContent = 'AUTOMATED PERSONNEL RESPONSE · 1899';
  const title = document.createElement('h2'); title.textContent = 'THE DEVELOPER IS STILL DEAD';
  const line = document.createElement('p'); line.textContent = 'That dusty badge opens only the complaint department. Your application has been forwarded to the screaming cabinet.';
  const dismiss = document.createElement('button');
  dismiss.type = 'button'; dismiss.textContent = 'RETURN TO THE LIVING';
  const close = () => { scene.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  dismiss.addEventListener('click', close);
  card.append(ghost, eyebrow, title, line, dismiss);
  scene.append(card); document.body.append(scene);
  document.addEventListener('keydown', onKey);
  dismiss.focus();
}

function showSpectralCheck() {
  if (document.getElementById('spectralCheck')) return;
  try { sessionStorage.setItem('boomart.ghost-check', 'required'); } catch {}
  const veil = document.createElement('div'); veil.className = 'spectral-check'; veil.id = 'spectralCheck';
  veil.setAttribute('role','dialog'); veil.setAttribute('aria-modal','true');
  const card = document.createElement('section'); card.className = 'spectral-check-card';
  const face = document.createElement('img'); face.src = '/assets/doom-face.svg'; face.alt = '';
  const heading = document.createElement('h2'); heading.textContent = 'Prove you’re not a ghost';
  const desc = document.createElement('p'); desc.textContent = 'One of these creatures is alive. Identify it before returning to the gate.';
  const choices = document.createElement('div'); choices.className = 'spectral-check-choices';
  for (const [name,value] of [['A haunted candle','candle'],['A black cat','cat'],['A gravestone','stone']]) {
    const label = document.createElement('label'); const radio = document.createElement('input');
    radio.type = 'radio'; radio.name = 'spectral-choice'; radio.value = value;
    label.append(radio,document.createTextNode(' '+name)); choices.append(label);
  }
  const feedback = document.createElement('p'); feedback.className = 'spectral-check-error'; feedback.setAttribute('role','status');
  const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Let me return to the gate';
  button.addEventListener('click', () => {
    const choice = choices.querySelector('input:checked');
    if (choice?.value !== 'cat') { feedback.textContent = 'The graveyard disagrees. Try a living creature.'; return; }
    try { sessionStorage.removeItem('boomart.ghost-check'); } catch {}
    veil.remove();
    document.querySelector('#username')?.focus();
  });
  card.append(face,heading,desc,choices,feedback,button); veil.append(card); document.body.append(veil);
  const first = choices.querySelector('input'); if (first) first.focus();
}

if (page === 'login') {
  try { sessionStorage.removeItem('boomart.guest.pending-invoice'); } catch {}
  try { if (sessionStorage.getItem('boomart.ghost-check') === 'required') showSpectralCheck(); } catch {}
  document.getElementById('loginForm').addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const result = await post('/api/auth/login', Object.fromEntries(new FormData(event.currentTarget)));
      await verifyLogin(result.username);
      depart(result.next, 'Opening the passage to the other side...');
    } catch (error) {
      message.textContent = error.message;
      button.disabled = false;
      if (error.code === 'PHANTOM_OPERATOR_TRAP') phantomLoginShow();
      else if (error.ghostTrial) showSpectralCheck();
    }
  });
  document.getElementById('guestLogin').addEventListener('click', async event => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const result = await post('/api/auth/guest');
      depart(result.next, 'The crypt accepts your internship application. Bad decision.');
    } catch (error) { message.textContent = error.message; button.disabled = false; }
  });
}

if (page === 'register') {
  document.getElementById('signupForm').addEventListener('submit', async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const result = await post('/api/auth/register', Object.fromEntries(new FormData(event.currentTarget)));
      depart(result.next, 'Transferring your soul to the other life...');
    } catch (error) { message.textContent = error.message; button.disabled = false; }
  });
}
