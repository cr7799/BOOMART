const display = document.getElementById('seconds');
let timer;
async function refresh() {
  const response = await fetch('/api/auth/me', { cache: 'no-store' });
  if (!response.ok) { clearInterval(timer); location.replace('/'); return; }
  const user = await response.json();
  if (!user.ghosted) { clearInterval(timer); location.replace('/'); return; }
  const remaining = Math.max(0, Math.ceil((user.expiresAt - Date.now()) / 1000));
  display.textContent = String(remaining);
  if (remaining === 0) { clearInterval(timer); location.replace('/'); }
}
refresh().catch(() => location.replace('/'));
timer = setInterval(() => refresh().catch(() => {}), 350);
