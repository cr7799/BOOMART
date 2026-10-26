const views = ['loginView', 'signupView', 'homeView', 'ghostView'];
const $ = id => document.getElementById(id);
let ghostTimer;

function show(id, message = '') {
  for (const view of views) $(view).hidden = view !== id;
  $('message').textContent = message;
  clearInterval(ghostTimer);
}

async function readJson(response) {
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || body.error || 'Request failed');
  return body;
}

async function post(path, payload = {}) {
  const { csrfToken } = await readJson(await fetch('/api/auth/csrf'));
  return readJson(await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify(payload)
  }));
}

async function refresh() {
  const response = await fetch('/api/auth/me', { cache: 'no-store' });
  if (response.status === 401) {
    show('loginView');
    return;
  }
  const user = await readJson(response);
  if (user.ghosted) {
    show('ghostView');
    const tick = async () => {
      const remaining = Math.max(0, Math.ceil((user.expiresAt - Date.now()) / 1000));
      $('seconds').textContent = remaining;
      if (remaining === 0) {
        clearInterval(ghostTimer);
        // Even if someone modifies this client countdown, the server deletes the account.
        await fetch('/api/auth/me', { cache: 'no-store' });
        show('loginView', 'Your temporary soul has expired. Try the supplied night-shift credentials.');
      }
    };
    ghostTimer = setInterval(() => tick().catch(() => {}), 200);
    await tick();
    return;
  }
  $('who').textContent = user.username;
  $('access').textContent = `Role: ${user.role} | Verified customer: ${user.verified ? 'yes' : 'no'}`;
  show('homeView');
}

$('showSignup').addEventListener('click', () => show('signupView'));
$('showLogin').addEventListener('click', () => show('loginView'));

$('signupForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    const result = await post('/api/auth/register', Object.fromEntries(form));
    show('loginView', result.message);
  } catch (error) { $('message').textContent = error.message; }
});

$('loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    await post('/api/auth/login', Object.fromEntries(form));
    await refresh();
  } catch (error) { $('message').textContent = error.message; }
});

$('logout').addEventListener('click', async () => {
  try {
    await post('/api/auth/logout');
    show('loginView', 'Logged out. The ghosts will miss you.');
  } catch (error) { $('message').textContent = error.message; }
});

refresh().catch(error => { show('loginView', error.message); });
