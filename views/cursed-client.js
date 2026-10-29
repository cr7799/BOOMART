const fill = document.getElementById('soulFill');
const meter = document.getElementById('soulMeter');
const count = document.getElementById('curseCount');
const message = document.getElementById('curseMessage');
const button = document.getElementById('tapButton');
const rewardDialog = document.getElementById('curseRewardDialog');
const rewardTitle = document.getElementById('curseRewardTitle');
const rewardCode = document.getElementById('curseRewardCode');
const rewardNote = document.getElementById('curseRewardNote');
const rewardCopy = document.getElementById('curseRewardCopy');
const officeExit = document.getElementById('curseOfficeExit');
let busy = false;
let completed = false;
let lastTapAt = -Infinity;
const CLIENT_TAP_GAP_MS = 190;
let snapshot = 0;
let snapshotAt = performance.now();
let drainPerSecond = 4.1;
function render() {
  const elapsedSeconds = (performance.now() - snapshotAt) / 1000;
  const energy = Math.max(0, snapshot - drainPerSecond * elapsedSeconds);
  fill.style.width = `${energy}%`;
  meter.setAttribute('aria-valuenow', String(Math.round(energy)));
  count.textContent = `${Math.floor(energy)}% extracted`;
}
function update(data) {
  snapshot = data.energy;
  snapshotAt = performance.now();
  drainPerSecond = data.decayPerSecond || 4.1;
  render();
}
async function responseJson(response) {
  const raw = await response.text();
  let body;
  try { body = JSON.parse(raw); } catch { }
  if (!body || typeof body !== 'object') {
    body = { error: response.status === 429 ? 'SPECTRAL_TAP_QUOTA' : 'RITUAL_REPLY_UNREADABLE',
      message: response.status === 429
        ? 'The unionized ghosts have confiscated the tap counter. Try again shortly.'
        : 'The ritual clerk sent a note nobody can decipher. Try again.' };
  }
  if (!response.ok) {
    const error = new Error(body.message || body.error || 'The ritual did not answer.');
    error.body = body;
    error.status = response.status;
    throw error;
  }
  return body;
}
function revealInheritance(receipt, next) {
  completed = true;
  button.disabled = true;
  rewardTitle.textContent = receipt?.title || 'Your inheritance has arrived';
  rewardCode.textContent = receipt?.voucher || 'THE PAYROLL DEPARTMENT LOST THE ENVELOPE';
  rewardNote.textContent = receipt?.note || 'If this slip is empty, ask the ghost cashier to check the ledger.';
  officeExit.href = next || '/admin';
  rewardDialog.showModal();
  rewardCode.focus({ preventScroll: true });
}
rewardDialog.addEventListener('cancel', event => event.preventDefault());
rewardCopy.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(rewardCode.textContent);
    rewardCopy.textContent = 'COPIED — the undertaker approves';
  } catch {
    rewardCopy.textContent = 'Select the code above and copy it manually';
    rewardCode.focus();
  }
});
async function perform(path, payload = {}) {
  const { csrfToken } = await responseJson(await fetch('/api/auth/csrf', { cache: 'no-store' }));
  return responseJson(await fetch(path, { method: 'POST', headers: {
    'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken
  }, body: JSON.stringify(payload) }));
}
async function status() {
  if (completed) return;
  try {
    const response = await fetch('/api/rituals/status', { cache: 'no-store' });
    if (response.status === 409) return;
    const data = await responseJson(response);
    update(data);
  } catch (error) { message.textContent = error.message; }
}
async function tap() {
  const now = performance.now();
  if (completed || busy || now - lastTapAt < CLIENT_TAP_GAP_MS) return;
  lastTapAt = now;
  busy = true;
  button.disabled = true;
  try {
    const result = await perform('/api/rituals/manual-tap');
    update(result);
    message.textContent = result.stabilizing
      ? 'Hold the line. The spirits demand sustained effort!'
      : (result.message || '');
    if (result.released) {
      revealInheritance(result.estateReceipt, result.next);
      return;
    }
  } catch (error) {
    if (error.body?.energy !== undefined) update(error.body);
    message.textContent = error.body?.error === 'TOO_FAST' ? 'Slow down. The spirits refuse rushed paperwork.' : error.message;
  } finally { busy = false; if (!completed) button.disabled = false; }
}
button.addEventListener('click', tap);
document.addEventListener('keydown', event => {
  if (event.code !== 'Space') return;
  if (completed) { event.preventDefault(); event.stopImmediatePropagation(); return; }
  if (event.repeat || event.target.matches('button,input,textarea')) return;
  event.preventDefault();
  tap();
}, true);
document.addEventListener('keyup', event => {
  if (completed && event.code === 'Space') event.preventDefault();
}, true);
document.getElementById('curseLogout').addEventListener('click', async () => {
  try { await perform('/api/auth/logout'); location.replace('/'); }
  catch (error) { message.textContent = error.message; }
});
status();
setInterval(render, 75);
setInterval(status, 2000);
