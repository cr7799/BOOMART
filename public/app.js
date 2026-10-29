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
    throw error;
  }
  return body;
}

async function get(path) {
  return readJson(await fetch(path, { cache: 'no-store' }));
}

async function post(path, payload = {}) {
  const { csrfToken } = await get('/api/auth/csrf');
  return readJson(await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify(payload)
  }));
}

async function patch(path, payload) {
  const { csrfToken } = await get('/api/auth/csrf');
  return readJson(await fetch(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify(payload)
  }));
}

async function remove(path) {
  const { csrfToken } = await get('/api/auth/csrf');
  return readJson(await fetch(path, { method: 'DELETE',
    headers: { 'X-CSRF-Token': csrfToken } }));
}

function text(tag, content, className) {
  const node = document.createElement(tag);
  node.textContent = String(content);
  if (className) node.className = className;
  return node;
}

const logout = document.getElementById('logout');
logout?.addEventListener('click', async () => {
  try { await post('/api/auth/logout'); location.replace('/'); }
  catch (error) { message.textContent = error.message; }
});

const images = {
  'spectral-socks': '/assets/spectral-socks.webp',
  'haunted-mug': '/assets/haunted-mug.webp',
  'golden-carrot': '/assets/golden-carrot.webp',
  'graveyard-candle': '/assets/graveyard-candle.webp',
  'haunted-fern': '/assets/haunted-fern.webp',
  'jinn-teapot': '/assets/jinn-teapot.webp',
  'cursed-spellbook': '/assets/cursed-spellbook.webp',
  'moonstone-lantern': '/assets/moonstone-lantern.webp',
  'ectoplasm-cleaner': '/assets/ectoplasm-cleaner.webp',
  'phantom-headphones': '/assets/phantom-headphones.webp'
};

function updateHeaderWallet(balance, count) {
  const wallet = document.getElementById('headerWalletBalance');
  const badge = document.getElementById('headerCartCount');
  if (wallet != null && Number.isFinite(Number(balance))) wallet.textContent = Number(balance).toLocaleString('en-US');
  if (badge != null && Number.isFinite(Number(count))) {
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.setAttribute('aria-label', `${count} items in basket`);
  }
}

let addToastTimeout;
function announceBasketAddition(product, count) {
  document.getElementById('basketToast')?.remove();
  clearTimeout(addToastTimeout);
  const toast = text('div', '', 'basket-toast');
  toast.id = 'basketToast'; toast.setAttribute('role', 'status');
  const art = document.createElement('img'); art.src = images[product.id] || '/assets/storefront.webp';
  art.alt = ''; art.width = 76; art.height = 76;
  const info = text('div', '', 'basket-toast-info');
  info.append(text('span', 'SHELF TRANSFER COMPLETE', 'basket-toast-kicker'),
    text('strong', `${product.name} added`),
    text('small', `${count} ${count === 1 ? 'item' : 'items'} awaiting the midnight cashier`));
  const view = text('a', 'View basket', 'basket-toast-link'); view.href = '/shop/cart';
  const close = text('button', '×', 'basket-toast-close'); close.type = 'button';
  close.setAttribute('aria-label','Dismiss basket notification');
  close.addEventListener('click', () => {toast.remove();clearTimeout(addToastTimeout);});
  toast.append(art, info, view, close); document.body.append(toast);
  addToastTimeout = setTimeout(() => toast.remove(), 5500);
}

function announceBasketLimit(product, detail) {
  document.getElementById('basketToast')?.remove();
  clearTimeout(addToastTimeout);
  const toast = text('div', '', 'basket-toast basket-toast-error');
  toast.id = 'basketToast';
  toast.setAttribute('role', 'alert');
  const art = document.createElement('img');
  art.src = images[product.id] || '/assets/storefront.webp';
  art.alt = ''; art.width = 76; art.height = 76;
  const info = text('div', '', 'basket-toast-info');
  info.append(text('span', 'RELIC CABINET SEALED', 'basket-toast-kicker'),
    text('strong', detail),
    text('small', 'Only one Golden Carrot is allowed per basket.'));
  const view = text('a', 'View basket', 'basket-toast-link'); view.href = '/shop/cart';
  const close = text('button', '×', 'basket-toast-close'); close.type = 'button';
  close.setAttribute('aria-label', 'Dismiss basket warning');
  close.addEventListener('click', () => { toast.remove(); clearTimeout(addToastTimeout); });
  toast.append(art, info, view, close);
  document.body.append(toast);
  addToastTimeout = setTimeout(() => toast.remove(), 7500);
}

async function renderHome() {
  const [profile, overview] = await Promise.all([
    get('/api/ghosts/me/profile'),
    get('/api/customer/overview')
  ]);
  document.getElementById('username').textContent = overview.username;
  document.getElementById('accountName').textContent = overview.username;
  document.getElementById('ticketCount').textContent = overview.openTickets;

  const { ghost } = await get(`/api/ghosts/${profile.ghost.id}/profile`);
  document.getElementById('ghostName').textContent = ghost.nickname;
  document.getElementById('ghostEpitaph').textContent = ghost.epitaph;
}

const catalogInfo = {
  'spectral-socks': ['Wardrobe', 'The Grey Lady', 'Not suitable for anyone with actual feet.'],
  'haunted-mug': ['Kitchen', 'Casper Jr.', 'My mint tea knows all my secrets.'],
  'golden-carrot': ['Rare artifacts', 'Slimer II', 'The store keeps it under glass until a delivery rite is signed.'],
  'graveyard-candle': ['Rituals', 'Si 13', 'Burned from both ends. So did my vacation days.'],
  'haunted-fern': ['Curiosities', 'The Baker Beyond', 'Tastes like the afterlife, minus the service charge.'],
  'jinn-teapot': ['Kitchen', 'Chai Phantom', 'A wish costs extra; the tea does not.'],
  'cursed-spellbook': ['Curiosities', 'The Grey Lady', 'I have never looked better. Or worse.'],
  'moonstone-lantern': ['Curiosities', 'Nocturnal Visitor', 'Finally I can find the stairs in the crypt.'],
  'ectoplasm-cleaner': ['Rituals', 'Dr. Fang', 'The sun still has a restraining order against me.'],
  'phantom-headphones': ['Curiosities', 'Radio Casablanca', 'Only broadcasts after midnight. I want a refund.']
};
const categories = ['All', 'Kitchen', 'Wardrobe', 'Rituals', 'Curiosities', 'Rare artifacts'];
function priceLabel(n) { return `${n} Boo Bucks`; }
async function renderShop() {
  const [{ products }, wallet, recent, cart] = await Promise.all([
    get('/api/shop/products'), get('/api/shop/wallet'), get('/api/shop/orders'), get('/api/shop/cart')
  ]);
  updateHeaderWallet(wallet.balance, cart.itemCount);
  const container = document.getElementById('products');
  const search = document.getElementById('productSearch');
  const category = document.getElementById('productCategory');
  const sort = document.getElementById('productSort');
  for (const type of categories) {
    const option = document.createElement('option'); option.value = type; option.textContent = type;
    category.append(option);
  }
  function paint() {
    container.replaceChildren();
    const query = search.value.trim().toLowerCase();
    const matching = products.filter(product => {
      const type = catalogInfo[product.id]?.[0] || 'Curiosities';
      return (category.value === 'All' || type === category.value) &&
        `${product.name} ${product.description}`.toLowerCase().includes(query);
    }).sort((a,b) => sort.value === 'price-asc' ? a.price-b.price :
      sort.value === 'price-desc' ? b.price-a.price : a.name.localeCompare(b.name));
    if (!matching.length) container.append(text('p', 'No shelves answer to that name.', 'muted'));
    for (const product of matching) {
      const card = text('article', '', 'product');
      if (product.id === 'golden-carrot') card.classList.add('relic-product');
      const cover = text('div', '', 'product-art');
      const img = document.createElement('img');
      img.src = images[product.id] || '/assets/storefront.webp';
      img.alt = `Product photo: ${product.name}`;
      img.width = 366; img.height = 420; img.loading = 'lazy';
      cover.append(img);
      const body = text('div', '', 'product-body');
      const [type, author, review] = catalogInfo[product.id] || ['Curiosities','Anonymous ghost','No report filed.'];
      body.append(text('span', type, 'product-type'), text('h2', product.name),
        text('p', product.description, 'muted'));
      const details = document.createElement('details');
      details.className = 'product-review';
      details.append(text('summary', 'Read reviews'),text('strong', author),text('p', review));
      body.append(details);
      const foot = text('div', '', 'product-footer');
      foot.append(text('strong', priceLabel(product.price)));
      const add = text('button', 'Add to basket', 'primary shop-add'); add.type = 'button';
      add.addEventListener('click', async () => {
        message.textContent = ''; add.disabled = true;
        try {
          const cart = await post('/api/shop/cart/lines', { product_id: product.id });
          updateHeaderWallet(cart.balance, cart.itemCount);
          announceBasketAddition(product, cart.itemCount);
        } catch (error) {
          if (error.code === 'ITEM_LIMIT') announceBasketLimit(product, error.message);
          else message.textContent = error.message;
        }
        finally { add.disabled = false; }
      });
      foot.append(add); body.append(foot); card.append(cover, body); container.append(card);
    }
  }
  search.addEventListener('input', paint);
  category.addEventListener('change', paint);
  sort.addEventListener('change', paint);
  paint();
  const orders = document.getElementById('recentOrders');
  if (!recent.orders.length) orders.append(text('p', 'No deliveries have crossed the veil yet.', 'muted'));
  for (const order of recent.orders.slice(0, 4)) {
    const a = document.createElement('a'); a.href = `/shop/orders/${order.id}`;
    a.className = 'shop-order-link'; a.textContent = `${order.productName}${order.itemCount > 1 ? ` (+${order.itemCount - 1} items)` : ''} · ${priceLabel(order.charged)}`;
    orders.append(a);
  }
}

async function renderCart() {
  const content = document.getElementById('cartContents');
  const couponForm = document.getElementById('couponForm');
  const totalArea = document.getElementById('priceSummary');
  const payButton = document.getElementById('checkoutButton');
  const shipping = document.getElementById('shippingOptions');
  const count = document.getElementById('basketCount');
  let latest;

  function amountRow(name, amount, className = '') {
    const row = text('div', '', 'basket-amount-row ' + className);
    row.append(text('span', name), text('strong', priceLabel(amount)));
    return row;
  }

  async function action(update) {
    message.textContent = '';
    try { await update(); await refresh(); }
    catch (error) { message.textContent = error.message; await refresh(); }
  }

  async function refresh() {
    latest = await get('/api/shop/cart');
    updateHeaderWallet(latest.balance, latest.itemCount);
    count.textContent = latest.itemCount ? `(${latest.itemCount})` : '';
    content.replaceChildren(); totalArea.replaceChildren(); shipping.replaceChildren();
    const hasItems = latest.items.length > 0;
    couponForm.hidden = !hasItems;
    payButton.disabled = !hasItems;
    if (!hasItems) {
      const empty = text('div', '', 'basket-empty');
      empty.append(text('h3', 'Your basket is quietly haunted.'),
        text('p', 'Nothing on the shelf followed you home this time.', 'muted'));
      const link = text('a', 'Explore the shop', 'primary basket-back'); link.href = '/shop';
      empty.append(link); content.append(empty);
      totalArea.append(amountRow('Subtotal', 0), amountRow('Total due', 0, 'basket-total'));
      shipping.append(text('p', 'The delivery spirits await an order.', 'muted'));
      return;
    }

    for (const item of latest.items) {
      const row = text('article', '', 'basket-line');
      const img = document.createElement('img'); img.className = 'basket-photo';
      img.src = images[item.productId] || '/assets/storefront.webp';
      img.alt = item.name; img.width = 112; img.height = 118; img.loading = 'lazy';
      const main = text('div', '', 'basket-line-details');
      main.append(text('h3', item.name), text('p', item.description, 'muted'),
        text('p', `${priceLabel(item.price)} each`, 'basket-unit-price'));
      const tools = text('div', '', 'basket-line-controls');
      const quantity = text('div', '', 'basket-quantity');
      const subtract = text('button', '−'); subtract.type = 'button';
      subtract.setAttribute('aria-label', `Decrease ${item.name} quantity`);
      subtract.disabled = item.quantity === 1;
      subtract.addEventListener('click', () => action(() => patch(`/api/shop/cart/lines/${item.lineId}`, {quantity: item.quantity-1})));
      const number = text('span', item.quantity); number.setAttribute('aria-label', `Quantity ${item.quantity}`);
      const add = text('button', '+'); add.type = 'button';
      add.setAttribute('aria-label', `Increase ${item.name} quantity`);
      add.disabled = item.quantity >= 99 || item.productId === 'golden-carrot';
      add.addEventListener('click', () => action(() => patch(`/api/shop/cart/lines/${item.lineId}`, {quantity: item.quantity+1})));
      quantity.append(subtract, number, add);
      const removeButton = text('button', 'Remove', 'basket-remove'); removeButton.type = 'button';
      removeButton.setAttribute('aria-label', `Remove ${item.name} from basket`);
      removeButton.addEventListener('click', () => action(() => remove(`/api/shop/cart/lines/${item.lineId}`)));
      tools.append(quantity, removeButton);
      const linePrice = text('strong', priceLabel(item.lineTotal), 'basket-line-price');
      row.append(img, main, tools, linePrice); content.append(row);
    }

    const hasRelic = latest.items.some(item => item.productId === 'golden-carrot');
    if (hasRelic) {
      shipping.append(text('p', 'Sealed artifacts are held by the relic dispatch office.', 'muted'));
    } else {
      const label = text('label', 'Delivery service'); label.htmlFor = 'shippingSelect';
      const select = document.createElement('select'); select.id = 'shippingSelect';
      for (const mode of ['standard', 'express']) {
        const option = document.createElement('option'); option.value = mode;
        option.textContent = mode === 'standard' ? 'Standard night delivery' : 'Express apparition';
        select.append(option);
      }
      select.value = latest.deliveryMode;
      select.addEventListener('change', () => action(() =>
        patch(`/api/shop/cart/lines/${latest.items[0].lineId}`, { delivery_mode: select.value })));
      shipping.append(label, select);
    }

    totalArea.append(amountRow(`Subtotal · ${latest.itemCount} items`, latest.subtotal));
    if (latest.quote) {
      totalArea.append(amountRow('Approved gift allowance', -(latest.subtotal-latest.quote.total), 'basket-discount'));
    }
    totalArea.append(amountRow('Total due', latest.quote ? latest.quote.total : latest.subtotal, 'basket-total'));
    if (!latest.quote && latest.subtotal > latest.balance) {
      totalArea.append(text('p', 'Your wallet may not cover this basket.', 'basket-warning'));
    }
  }

  couponForm.addEventListener('submit', async event => {
    event.preventDefault(); message.textContent = '';
    try { await post('/api/shop/quote/coupon', { code: document.getElementById('couponCode').value.trim() }); await refresh(); }
    catch (error) { message.textContent = error.message; }
  });
  payButton.addEventListener('click', async () => {
    message.textContent = ''; payButton.disabled = true;
    try { const result = await post('/api/shop/checkout', {}); location.assign(result.next); }
    catch (error) { message.textContent = error.message; payButton.disabled = false; }
  });
  try { await refresh(); } catch (error) { payButton.disabled = true; message.textContent = error.message; }
}

async function renderReceipt() {
  const orderId = location.pathname.split('/').pop();
  const [{ receipt }, wallet, cart] = await Promise.all([
    get(`/api/shop/orders/${orderId}`), get('/api/shop/wallet'), get('/api/shop/cart')
  ]);
  updateHeaderWallet(wallet.balance, cart.itemCount);
  const article = document.getElementById('receiptContent');
  article.replaceChildren();
  const ticket = text('div', '', 'relic-receipt');
  if (receipt.flag) ticket.classList.add('relic-receipt-winning');
  const masthead = text('div', '', 'relic-receipt-masthead');
  masthead.append(text('span', '✦ THE OFFICIAL AFTERLIFE LEDGER ✦', 'relic-receipt-overline'),
    text('h2', 'BOOMART', 'relic-receipt-brand'),
    text('p', 'Midnight Mercantile · Receipts Beyond the Veil', 'relic-receipt-subtitle'));
  const mark = text('div', receipt.flag ? 'SEALED & CLAIMED' : 'PAID & FILED', 'relic-receipt-seal');
  masthead.append(mark);
  const details = text('div', '', 'relic-receipt-info');
  function meta(label, value) {
    const cell = text('div', '', 'receipt-meta-cell');
    cell.append(text('span', label), text('strong', value));
    return cell;
  }
  const when = Number.isFinite(Number(receipt.createdAt)) ?
    new Date(receipt.createdAt).toLocaleString('en-GB',{ dateStyle:'medium', timeStyle:'short' }) : 'The witching hour';
  details.append(meta('ARCHIVE REFERENCE', `#${receipt.id.slice(0, 12).toUpperCase()}`),
    meta('DATE OF SUMMONING',when), meta('STATE',receipt.status));
  const list = text('div', '', 'relic-receipt-items');
  const headings = text('div', '', 'receipt-table-head');
  headings.append(text('span','CURIOSITY'),text('span','QTY'),text('span','PRICE'));
  list.append(headings);
  for (const item of receipt.items) {
    const line = text('div', '', 'receipt-table-line');
    const photo = document.createElement('img'); photo.src = images[item.productId] || '/assets/storefront.webp';
    photo.width = 52; photo.height = 52; photo.alt = '';
    const productName = text('div', '', 'receipt-product-name');
    productName.append(text('strong',item.name),text('small',`${priceLabel(item.unitPrice)} each`));
    const product = text('div', '', 'receipt-product'); product.append(photo,productName);
    line.append(product,text('span',item.quantity),text('strong',priceLabel(item.lineTotal)));
    list.append(line);
  }
  const totals = text('div', '', 'relic-receipt-totals');
  function money(label,amount, cls='') {
    const row=text('div','',`receipt-money ${cls}`);
    row.append(text('span',label),text('strong',priceLabel(amount)));
    return row;
  }
  totals.append(money('Subtotal',receipt.regularPrice));
  if (receipt.regularPrice > receipt.charged) totals.append(money('Spectral allowance',-(receipt.regularPrice-receipt.charged),'receipt-discount'));
  totals.append(money('Paid to the midnight cashier',receipt.charged,'receipt-final'));
  const farewell = text('div', '', 'relic-receipt-farewell');
  farewell.append(text('p','Thank you for shopping beyond the veil.'),
    text('small',`Balance remaining: ${priceLabel(wallet.balance)} · No living refunds`));
  ticket.append(masthead,details,list,totals,farewell);
  if (receipt.flag) {
    const special = text('div', '', 'receipt-flag-casket');
    special.append(text('span','AN UNSEALED MESSAGE FROM THE CARROT','receipt-flag-caption'),
      text('p',receipt.flag,'receipt-flag'));
    const copy = text('button','Copy the sealed message','receipt-copy'); copy.type='button';
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(receipt.flag); copy.textContent='Copied to your spellbook'; }
      catch { copy.textContent='Select and copy the message above'; }
    });
    special.append(copy); ticket.append(special);
  }
  article.append(ticket);
  const print=document.getElementById('printOrderReceipt');
  print?.addEventListener('click',()=>window.print());
}

async function renderSupport() {
  const { tickets } = await get('/api/support/tickets');
  const container = document.getElementById('ticketList');
  container.replaceChildren();
  if (!tickets.length) container.append(text('p', 'Nothing on file. The archivists are delighted.', 'muted'));
  for (const ticket of tickets) {
    const button = text('button', '', 'ticket-button');
    button.type = 'button';
    const subject = text('span', `#${ticket.id} · ${ticket.subject}`);
    const status = text('small', ticket.status, 'status-pill');
    button.append(subject, status);
    button.addEventListener('click', async () => {
      try {
        const { ticket: detail } = await get(`/api/support/tickets/${ticket.id}`);
        const article = document.getElementById('ticketDetail');
        article.replaceChildren(text('span', `CASE #${detail.id}`, 'eyebrow'),
          text('h2', detail.subject), text('p', detail.message),
          text('small', `Status: ${detail.status}`, 'muted'));
        article.hidden = false;
      } catch (error) { message.textContent = error.message; }
    });
    container.append(button);
  }
}

const render = { home: renderHome, shop: renderShop, cart: renderCart,
  receipt: renderReceipt, support: renderSupport }[page];
if (render) render().catch(error => { message.textContent = error.message; });
