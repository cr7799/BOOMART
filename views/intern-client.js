const message = document.getElementById('internMessage');
let leaving = false;
let paymentTimer = null;
let paymentTicker = null;
let paymentStartedAt = 0;
const paymentModal = document.getElementById('internPayment');
const paymentTitle = document.getElementById('internPaymentTitle');
const paymentMessage = document.getElementById('internPaymentMessage');
const paymentSpinner = document.getElementById('internPaymentSpinner');
const paymentItem = document.getElementById('internPaymentItem');
const paymentKey = 'boomart.guest.pending-invoice';
const catalog = document.getElementById('internCatalog');
const search = document.getElementById('internSearch');
const rumors = [
  'Your contract was countersigned by an invisible cat.',
  'Human Resources is looking for the last living employee.',
  'Management has approved your application to stay unpaid.',
  'We offer two benefits: fog and longer fog.',
  'A ghost insists the fire exit is just a painting.'
];
const products = [
  {id:'spectral-socks', name:'Spectral Socks', price:20, image:'spectral-socks.webp', line:'For the feet you may no longer own.'},
  {id:'haunted-mug', name:'Possessed Tea Mug', price:35, image:'haunted-mug.webp', line:'It drinks your tea before you do.'},
  {id:'ectoplasm-cleaner', name:'Ectoplasm Cleaner', price:50, image:'ectoplasm-cleaner.webp', line:'Removes stains, not regrets.'},
  {id:'cursed-spellbook', name:'Cursed Notebook', price:65, image:'cursed-spellbook.webp', line:'Most of its pages are complaints.'},
  {id:'phantom-headphones', name:'Phantom Headphones', price:80, image:'phantom-headphones.webp', line:'Listen to the voices politely.'},
  {id:'haunted-fern', name:'Haunted Plant', price:90, image:'haunted-fern.webp', line:'It wants you to water its ghost.'},
  {id:'golden-carrot', name:'Golden Carrot', price:999, image:'golden-carrot.webp', line:'An ancient relic, conveniently available to guests.'}
];
let wishList = new Set();
function showProducts() {
  const term = search.value.toLowerCase().trim();
  catalog.replaceChildren();
  for (const product of products.filter(p => `${p.name} ${p.line}`.toLowerCase().includes(term))) {
    const card = document.createElement('article'); card.className = 'intern-product';
    const img = document.createElement('img'); img.src = `/assets/${product.image}`; img.alt = product.name;
    const inner = document.createElement('div'); inner.className = 'intern-product-inner';
    const heading = document.createElement('h3'); heading.textContent = product.name;
    const sub = document.createElement('p'); sub.textContent = product.line;
    const price = document.createElement('strong'); price.textContent = `${product.price} Boo Bucks`;
    const buy = document.createElement('button'); buy.type = 'button'; buy.textContent = 'Buy Now';
    buy.addEventListener('click', () => beginPayment(product));
    const favorite = document.createElement('button'); favorite.type = 'button';
    favorite.textContent = wishList.has(product.id) ? 'Saved to haunt-list' : 'Add to haunt-list';
    favorite.addEventListener('click', () => {
      if (wishList.has(product.id)) wishList.delete(product.id); else wishList.add(product.id);
      favorite.textContent = wishList.has(product.id) ? 'Saved to haunt-list' : 'Add to haunt-list';
      message.textContent = 'The ghost clerk has misplaced your list somewhere safe.';
    });
    inner.append(heading, sub, price, buy, favorite); card.append(img, inner); catalog.append(card);
  }
  if (!catalog.childElementCount) {
    const empty = document.createElement('p'); empty.textContent = 'Nothing lives under that name. Not anymore.';
    catalog.append(empty);
  }
}
search.addEventListener('input', showProducts);
showProducts();
function cancelPayment() {
  if (paymentTimer) clearTimeout(paymentTimer);
  if (paymentTicker) clearInterval(paymentTicker);
  paymentTimer = null; paymentTicker = null;
  paymentModal.hidden = true;
  document.body.classList.remove('intern-payment-locked');
  try { sessionStorage.removeItem(paymentKey); } catch {}
}
function beginPayment(product, previousStart = Date.now()) {
  if (paymentTimer) clearTimeout(paymentTimer);
  if (paymentTicker) clearInterval(paymentTicker);
  paymentStartedAt = previousStart;
  try { sessionStorage.setItem(paymentKey, JSON.stringify({ id:product.id, startedAt:paymentStartedAt })); } catch {}
  paymentModal.hidden = false;
  document.body.classList.add('intern-payment-locked');
  paymentMessage.classList.remove('intern-payment-failed');
  paymentItem.textContent = `${product.name} · ${product.price} Boo Bucks`;
  const updates = [
    'Contacting the afterlife...', 'Waiting for ghost approval...',
    'Your payment is being processed by a spectre...',
    'Request forwarded to the graveyard accounting committee...',
    'The cashier has temporarily left their body...',
    'Consulting the night shift supervisor...'
  ];
  function update() {
    const elapsed = Date.now() - paymentStartedAt;
    if (elapsed >= 60_000) {
      if (paymentTicker) clearInterval(paymentTicker);
      paymentTicker = null;
      paymentSpinner.hidden = true;
      paymentTitle.textContent = 'THE GHOST DECLINED';
      paymentMessage.textContent = 'Payment failed: ghost declined.';
      paymentMessage.classList.add('intern-payment-failed');
      return;
    }
    paymentTitle.textContent = 'Processing payment...';
    paymentSpinner.hidden = false;
    paymentMessage.textContent = updates[Math.floor(elapsed / 6000) % updates.length];
  }
  update();
  if (!paymentMessage.classList.contains('intern-payment-failed')) {
    paymentTicker = setInterval(update, 1000);
  }
}
try {
  const saved = JSON.parse(sessionStorage.getItem(paymentKey) || 'null');
  const product = products.find(entry => entry.id === saved?.id);
  if (product && Number.isFinite(saved.startedAt) && saved.startedAt > 0 && saved.startedAt <= Date.now()) {
    beginPayment(product, saved.startedAt);
  }
} catch {}
let rumorIndex = 0;
function nextRumor() { message.textContent = rumors[rumorIndex++ % rumors.length]; }
document.getElementById('internRumors').addEventListener('click', nextRumor);
document.getElementById('internBadge').addEventListener('click', () => { message.textContent = 'Badge request: approved for another 400 years of probation.'; });
document.getElementById('internSupport').addEventListener('click', () => { document.getElementById('internSideJoke').textContent = 'Support ghost: BOO! Please hold forever.'; });
document.getElementById('internContract').addEventListener('click', () => { document.getElementById('internSideJoke').textContent = 'Section 13: You are responsible for all losses of ectoplasm, even those occurring before birth.'; });
document.getElementById('internViewStore').addEventListener('click', () => document.getElementById('internShop').scrollIntoView({behavior:'smooth'}));
async function escapeInternship() {
  if (leaving) return;
  leaving = true;
  cancelPayment();
  try {
    const csrf = await fetch('/api/auth/csrf', { cache: 'no-store' }).then(r => r.json());
    const response = await fetch('/api/auth/logout', {
      method: 'POST', headers: { 'X-CSRF-Token': csrf.csrfToken }
    });
    if (!response.ok) throw new Error('The spirits will not release you yet.');
    location.replace('/');
  } catch (error) { message.textContent = error.message; leaving = false; }
}
document.getElementById('internLogout').addEventListener('click', escapeInternship);
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    if (!paymentModal.hidden) event.preventDefault();
    else escapeInternship();
  }
});
