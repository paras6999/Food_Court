/* ════════════════════════════════════════════════════════
   table_order.js — Dine-in table ordering (QR code flow)
   ════════════════════════════════════════════════════════ */

// ── Parse URL params ────────────────────────────────────
const urlParams = new URLSearchParams(window.location.search);
const restaurantId = urlParams.get('restaurant');
const tableNumber = parseInt(urlParams.get('table'));

// ── Cart (in-memory for table session) ──────────────────
let tableCart = [];
let restaurantData = null;
let menuData = [];

// ── Init ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  updateAuthUI();
  if (!restaurantId || !tableNumber) {
    showError('Invalid QR code. Missing restaurant or table information.');
    return;
  }
  validateTable();
});

function updateAuthUI() {
  const token = getToken();
  const role = getRole();
  const name = getName();
  const loginBtn = document.getElementById('nav-login-btn');
  const logoutBtn = document.getElementById('nav-logout-btn');
  const userName = document.getElementById('nav-user-name');

  if (token && role === 'customer') {
    if (loginBtn) loginBtn.style.display = 'none';
    if (logoutBtn) logoutBtn.style.display = '';
    if (userName) { userName.style.display = ''; userName.textContent = name; }
  } else {
    if (loginBtn) loginBtn.style.display = '';
    if (logoutBtn) logoutBtn.style.display = 'none';
    if (userName) userName.style.display = 'none';
  }
}

// ── Validate Table ──────────────────────────────────────
async function validateTable() {
  const loadEl = document.getElementById('loading-state');
  const errEl = document.getElementById('error-state');
  const mainEl = document.getElementById('main-content');

  try {
    const data = await apiFetch(`/api/table/${restaurantId}/${tableNumber}`);

    if (data.error) {
      loadEl.style.display = 'none';
      errEl.style.display = '';
      document.getElementById('error-msg').textContent = data.error;
      return;
    }

    restaurantData = data.restaurant;
    menuData = data.menu || [];

    // Populate UI
    document.getElementById('rest-name').textContent = restaurantData.name;
    document.getElementById('rest-cuisine').textContent = restaurantData.cuisine || 'Various';
    document.getElementById('rest-img').src = restaurantData.image || 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=300';
    document.getElementById('rest-rating').innerHTML = renderStars(restaurantData.rating || 0) +
      ` <span class="rating-num">${(restaurantData.rating || 0).toFixed(1)} (${restaurantData.totalRatings || 0})</span>`;

    document.getElementById('table-number-display').textContent = tableNumber;
    document.getElementById('nav-table-num').textContent = tableNumber;
    document.getElementById('table-badge-nav').style.display = '';
    document.getElementById('cart-table-num').textContent = tableNumber;

    document.title = `Table ${tableNumber} — ${restaurantData.name} — FoodCourt`;

    // Show offer
    if (restaurantData.offer) {
      document.getElementById('offer-banner').style.display = '';
      document.getElementById('offer-text').textContent = restaurantData.offer;
    }

    renderMenu();

    loadEl.style.display = 'none';
    mainEl.style.display = '';

    // Load active orders if logged in
    if (getToken() && getRole() === 'customer') {
      loadActiveOrders();
      setInterval(loadActiveOrders, 8000);
    }

  } catch (err) {
    loadEl.style.display = 'none';
    errEl.style.display = '';
    document.getElementById('error-msg').textContent = 'Unable to connect. Please try again.';
  }
}

// ── Render Menu ─────────────────────────────────────────
function renderMenu() {
  const grid = document.getElementById('menu-grid');
  if (!menuData.length) {
    grid.innerHTML = '<div class="col-12"><div class="empty-state"><div class="icon">🍽️</div><p>No menu items available yet.</p></div></div>';
    return;
  }

  grid.innerHTML = menuData.map((item, idx) => `
    <div class="col-12 col-md-6" style="animation-delay:${idx * 0.05}s">
      <div class="menu-card">
        <img src="${item.image || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=200'}" alt="${item.name}"
             onerror="this.src='https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=200'">
        <div class="details">
          <div class="name">${item.name}</div>
          <div class="price">₹${item.price}</div>
        </div>
        <div class="ms-auto">
          <button class="btn-primary-custom" style="padding:0.45rem 1rem;font-size:0.85rem"
            onclick="addToTableCart('${item._id}','${item.name.replace(/'/g, "\\'")}',${item.price})">
            <i class="bi bi-plus-lg"></i> Add
          </button>
        </div>
      </div>
    </div>
  `).join('');
}

// ── Cart Logic ──────────────────────────────────────────
function addToTableCart(itemId, name, price) {
  const existing = tableCart.find(i => i.itemId === itemId);
  if (existing) {
    existing.quantity += 1;
  } else {
    tableCart.push({ itemId, name, price, quantity: 1 });
  }
  renderTableCart();
  showToast(`${name} added to order 🛒`, 'success');
}

function removeFromTableCart(itemId) {
  tableCart = tableCart.filter(i => i.itemId !== itemId);
  renderTableCart();
}

function changeTableQty(itemId, delta) {
  const item = tableCart.find(i => i.itemId === itemId);
  if (!item) return;
  item.quantity += delta;
  if (item.quantity <= 0) tableCart = tableCart.filter(i => i.itemId !== itemId);
  renderTableCart();
}

function renderTableCart() {
  const fab = document.getElementById('cart-fab');
  const badge = document.getElementById('cart-badge');
  const list = document.getElementById('cart-items-list');
  const footer = document.getElementById('cart-footer');

  if (fab) fab.style.display = tableCart.length > 0 ? '' : 'none';
  if (badge) badge.textContent = tableCart.reduce((s, i) => s + i.quantity, 0);

  if (!list) return;

  if (tableCart.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="icon">🛒</div><p>Your order is empty</p></div>`;
    if (footer) footer.style.display = 'none';
    return;
  }

  const total = tableCart.reduce((sum, i) => sum + i.price * i.quantity, 0);
  list.innerHTML = tableCart.map(item => `
    <div style="display:flex;align-items:center;gap:.75rem;padding:.75rem 0;border-bottom:1px solid var(--border)">
      <div style="flex:1">
        <div style="font-weight:600;font-size:.9rem">${item.name}</div>
        <div style="color:var(--primary);font-size:.88rem;font-weight:600">₹${item.price} each</div>
      </div>
      <div class="qty-ctrl">
        <button class="qty-btn" onclick="changeTableQty('${item.itemId}',-1)">−</button>
        <span class="qty-num">${item.quantity}</span>
        <button class="qty-btn" onclick="changeTableQty('${item.itemId}',1)">+</button>
      </div>
      <button onclick="removeFromTableCart('${item.itemId}')" style="background:none;border:none;color:var(--accent);cursor:pointer;font-size:1.1rem">🗑</button>
    </div>
  `).join('');

  if (footer) {
    footer.style.display = '';
    const totalEl = document.getElementById('cart-total');
    if (totalEl) totalEl.textContent = `₹${total}`;
  }
}

// ── Place Order ─────────────────────────────────────────
async function placeTableOrder() {
  if (!getToken() || getRole() !== 'customer') {
    showToast('Please login first to place your order', 'error');
    setTimeout(() => {
      // Store current URL so we can redirect back
      localStorage.setItem('fc_redirect', window.location.href);
      window.location.href = '/login.html';
    }, 1200);
    return;
  }

  if (tableCart.length === 0) {
    showToast('Your order is empty', 'error');
    return;
  }

  const btn = document.getElementById('checkout-btn');
  btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Placing…';
  btn.disabled = true;

  const body = {
    restaurant_id: restaurantId,
    table_number: tableNumber,
    items: tableCart.map(i => ({ item_id: i.itemId, quantity: i.quantity })),
    address: `Dine-In — Table ${tableNumber}`
  };

  const res = await apiPost('/api/order', body, true);

  btn.innerHTML = '<i class="bi bi-check-circle"></i> Place Dine-In Order';
  btn.disabled = false;

  if (res.order_id) {
    tableCart = [];
    renderTableCart();
    // Close sidebar
    const sidebar = document.getElementById('cartSidebar');
    if (sidebar) { const bs = bootstrap.Offcanvas.getInstance(sidebar); if (bs) bs.hide(); }
    showToast('Order placed! 🎉 The kitchen is preparing your food.', 'success');
    loadActiveOrders();
  } else {
    showToast(res.error || 'Failed to place order', 'error');
  }
}

// ── Active Orders ───────────────────────────────────────
const STATUS_STEPS = ['pending', 'accepted', 'preparing', 'ready', 'delivered'];

function stepProgress(status) {
  const idx = STATUS_STEPS.indexOf(status);
  if (idx === -1) return 0;
  return Math.round((idx / (STATUS_STEPS.length - 1)) * 100);
}

async function loadActiveOrders() {
  if (!getToken()) return;

  const orders = await apiFetch('/api/orders/me', true);
  const section = document.getElementById('active-orders-section');
  const list = document.getElementById('active-orders-list');

  if (!Array.isArray(orders)) return;

  // Filter only orders for this table and restaurant that are active
  const tableOrders = orders.filter(o =>
    o.restaurant_id === restaurantId &&
    o.table_number === tableNumber &&
    ['pending', 'accepted', 'preparing', 'ready'].includes(o.status)
  );

  if (tableOrders.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = '';
  list.innerHTML = tableOrders.map(o => {
    const progress = stepProgress(o.status);
    const items = o.items.map(i => `<span class="badge-cuisine" style="margin:.1rem">${i.quantity}× ${i.name}</span>`).join(' ');

    return `
      <div class="active-order-card">
        <div class="d-flex justify-content-between align-items-start mb-3">
          <div>
            <code style="color:var(--primary);font-size:0.9rem">#${o._id.slice(-6).toUpperCase()}</code>
            <div class="mt-1">${items}</div>
          </div>
          <div class="text-end">
            <span class="status-badge status-${o.status}">${o.status.toUpperCase()}</span>
            <div style="color:var(--primary);font-weight:700;margin-top:.25rem">₹${o.total_price}</div>
          </div>
        </div>
        <div>
          <div style="display:flex;justify-content:space-between;font-size:0.72rem;color:var(--text-muted);margin-bottom:.35rem">
            <span>Placed</span><span>Accepted</span><span>Preparing</span><span>Ready</span><span>Served</span>
          </div>
          <div class="order-progress-track">
            <div class="order-progress-fill" style="width:${progress}%"></div>
          </div>
        </div>
        ${o.status === 'ready' ? '<div class="ready-alert mt-2"><i class="bi bi-check-circle-fill"></i> Your food is ready for pickup / serving!</div>' : ''}
      </div>
    `;
  }).join('');
}

// ── Service Requests ────────────────────────────────────
async function requestService(type) {
  if (!getToken() || getRole() !== 'customer') {
    showToast('Please login first', 'error');
    return;
  }

  const labels = {
    waiter: '🙋 Calling waiter…',
    water: '💧 Requesting water…',
    bill: '🧾 Requesting bill…',
    cleanup: '🧹 Requesting table cleanup…'
  };

  showToast(labels[type] || 'Sending request…', 'info');

  const res = await apiPost('/api/service-request', {
    restaurant_id: restaurantId,
    table_number: tableNumber,
    request_type: type
  }, true);

  if (res.message) {
    showToast('Request sent to restaurant! ✅', 'success');
  } else {
    showToast(res.error || 'Failed to send request', 'error');
  }
}
