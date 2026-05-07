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

// ── Group Ordering ──────────────────────────────────────
let isGroupOrder = false;
let groupCartData = null;
let groupSyncInterval = null;
let isGroupCreator = false; // only creator can place the group order

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
  
  // New dropdown items
  const navUserInfo = document.getElementById('nav-user-info');
  const navLoginItem = document.getElementById('nav-login-item');
  const navRegisterItem = document.getElementById('nav-register-item');
  const navOrdersItem = document.getElementById('nav-orders-item');
  const navLogoutItem = document.getElementById('nav-logout-item');
  const navUserName = document.getElementById('nav-username');

  if (token && role === 'customer') {
    if (navUserInfo) navUserInfo.style.display = '';
    if (navUserName) navUserName.textContent = name;
    if (navLoginItem) navLoginItem.style.display = 'none';
    if (navRegisterItem) navRegisterItem.style.display = 'none';
    if (navOrdersItem) navOrdersItem.style.display = '';
    if (navLogoutItem) navLogoutItem.style.display = '';
    
    const promo = document.getElementById('guest-promo-banner');
    if (promo) promo.style.display = 'none';
  } else {
    if (navUserInfo) navUserInfo.style.display = 'none';
    if (navLoginItem) navLoginItem.style.display = '';
    if (navRegisterItem) navRegisterItem.style.display = '';
    if (navOrdersItem) navOrdersItem.style.display = 'none';
    if (navLogoutItem) navLogoutItem.style.display = 'none';
    
    const promo = document.getElementById('guest-promo-banner');
    if (promo) promo.style.display = '';
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

    // Show group order button if logged in
    if (getToken() && getRole() === 'customer') {
      document.getElementById('start-group-order').style.display = '';
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

async function startGroupOrder() {
  if (!getToken() || getRole() !== 'customer') {
    showToast('Please login to start a group order', 'error');
    return;
  }

  const btn = document.getElementById('start-group-order');
  btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Starting…';
  btn.disabled = true;

  try {
    const res = await apiPost('/api/cart/group/join', {
      restaurant_id: restaurantId,
      table_number: tableNumber
    }, true);

    if (res.cart) {
      isGroupOrder = true;
      groupCartData = res.cart;
      isGroupCreator = res.cart.is_creator === true;
      tableCart = []; // Clear local cart
      renderTableCart();

      // Start polling for updates
      groupSyncInterval = setInterval(syncGroupCart, 3000);

      btn.innerHTML = isGroupCreator ? '👑 Group Order Active (You\'re Host)' : '👥 Group Order Joined';
      btn.disabled = true;
      btn.style.background = 'linear-gradient(45deg, #28a745, #20c997)';

      showToast(isGroupCreator ? 'Group order started! Others can now join.' : 'Joined group order!', 'success');
    } else {
      showToast(res.error || 'Failed to start group order', 'error');
      btn.innerHTML = '👥 Start Group Order';
      btn.disabled = false;
    }
  } catch (err) {
    showToast('Network error', 'error');
    btn.innerHTML = '👥 Start Group Order';
    btn.disabled = false;
  }
}

async function syncGroupCart() {
  if (!isGroupOrder) return;

  try {
    const res = await apiFetch(`/api/cart/group/sync?restaurant_id=${restaurantId}&table_number=${tableNumber}`, true);
    if (res.cart) {
      groupCartData = res.cart;
      // Update creator status on sync too
      if (typeof res.cart.is_creator !== 'undefined') {
        isGroupCreator = res.cart.is_creator === true;
      }
      renderTableCart();
    }
  } catch (err) {
    // Silent fail for polling
  }
}

let currentTableMenuFilters = { veg: false, best: false };

function toggleTableMenuFilter(type) {
    currentTableMenuFilters[type] = !currentTableMenuFilters[type];
    const btn = document.getElementById(`filter-${type}`);
    if (btn) {
        if (currentTableMenuFilters[type]) btn.classList.add('active');
        else btn.classList.remove('active');
    }
    renderMenu();
}

// ── Render Menu ─────────────────────────────────────────
function renderMenu() {
  const grid = document.getElementById('menu-grid');
  if (!menuData.length) {
    grid.innerHTML = '<div class="col-12"><div class="empty-state"><div class="icon">🍽️</div><p>No menu items available yet.</p></div></div>';
    return;
  }

  // Pre-process items
  const processedItems = menuData.map(item => {
    const nameLower = item.name.toLowerCase();
    const isVeg = !(nameLower.includes('chicken') || nameLower.includes('beef') || nameLower.includes('pork') || nameLower.includes('fish') || nameLower.includes('meat') || nameLower.includes('egg'));
    const isBestseller = item.price > 150 && item.price < 300;
    const restName = restaurantData ? restaurantData.name.replace(/'/g, "\\'") : 'Restaurant';
    return { ...item, isVeg, isBestseller, restName };
  });

  let filtered = processedItems;
  if (currentTableMenuFilters.veg) filtered = filtered.filter(i => i.isVeg);
  if (currentTableMenuFilters.best) filtered = filtered.filter(i => i.isBestseller);

  if (filtered.length === 0) {
    grid.innerHTML = '<div class="col-12"><div class="empty-state"><div class="icon">🍽️</div><p>No menu items match your filters.</p></div></div>';
    return;
  }

    const isLoggedIn = !!localStorage.getItem('fc_token');
    const discount = isLoggedIn && restaurantData && restaurantData.discount_pct ? parseFloat(restaurantData.discount_pct) : 0;
    
    grid.innerHTML = filtered.map((item, idx) => {
        let priceHtml = '';
        if (discount > 0) {
            const discountedPrice = (item.price * (1 - discount / 100)).toFixed(2);
            priceHtml = `<span style="text-decoration:line-through; color:var(--text-muted); font-size:0.85rem">₹${item.price}</span> <span style="color: #20c997; font-weight: bold;">₹${discountedPrice}</span>`;
        } else {
            priceHtml = `₹${item.price}`;
        }
        
        return `
    <div class="col-12 col-md-6" style="animation-delay:${idx * 0.05}s">
      <div class="menu-card" style="cursor:pointer" onclick="openItemDetails('${item._id}', '${item.name.replace(/'/g, "\\'")}', ${item.price}, '${restaurantId}', '${item.restName}', '${item.image || ''}', '${item.description || ''}', ${item.isVeg}, '${item.addons || ''}')">
        <img src="${item.image || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=200'}" alt="${item.name}"
             onerror="this.src='https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=200'">
        <div class="details">
          <div class="name">
              ${item.isVeg ? '<span style="font-size:0.7rem">🟢</span>' : '<span style="font-size:0.7rem">🔴</span>'}
              ${item.name}
          </div>
          <div class="price">${priceHtml}</div>
        </div>
        <div class="ms-auto">
          <button class="btn-primary-custom" style="padding:0.45rem 1rem;font-size:0.85rem"
            onclick="event.stopPropagation(); openItemDetails('${item._id}', '${item.name.replace(/'/g, "\\'")}', ${item.price}, '${restaurantId}', '${item.restName}', '${item.image || ''}', '${item.description || ''}', ${item.isVeg}, '${item.addons || ''}')">
            <i class="bi bi-plus-lg"></i> Add
          </button>
        </div>
      </div>
    </div>
  `}).join('');
}

// ── Cart Logic ──────────────────────────────────────────
function addToTableCart(itemId, name, price, optionsStr = '') {
  if (isGroupOrder) {
    addToGroupCart(itemId, name, price, optionsStr);
    return;
  }

  const existing = tableCart.find(i => i.itemId === itemId && i.options === optionsStr);
  if (existing) {
    existing.quantity += 1;
  } else {
    tableCart.push({ itemId, name, price, quantity: 1, options: optionsStr });
  }
  renderTableCart();
  showToast(`${name} added to order 🛒`, 'success');
}

async function addToGroupCart(itemId, name, price, optionsStr = '') {
  try {
    const res = await apiPost('/api/cart/group/add', {
      restaurant_id: restaurantId,
      table_number: tableNumber,
      item_id: itemId,
      quantity: 1,
      options: optionsStr
    }, true);

    if (res.cart) {
      groupCartData = res.cart;
      renderTableCart();
      showToast(`${name} added to group order 🛒`, 'success');
    } else {
      showToast(res.error || 'Failed to add item', 'error');
    }
  } catch (err) {
    showToast('Network error', 'error');
  }
}

function removeFromTableCart(itemId, optionsStr = '') {
  if (isGroupOrder) {
    // For group cart, we need to remove the item from backend
    removeFromGroupCart(itemId, optionsStr);
    return;
  }

  tableCart = tableCart.filter(i => !(i.itemId === itemId && i.options === optionsStr));
  renderTableCart();
}

function changeTableQty(itemId, delta, optionsStr = '') {
  if (isGroupOrder) {
    changeGroupQty(itemId, delta, optionsStr);
    return;
  }

  const item = tableCart.find(i => i.itemId === itemId && i.options === optionsStr);
  if (!item) return;
  item.quantity += delta;
  if (item.quantity <= 0) tableCart = tableCart.filter(i => !(i.itemId === itemId && i.options === optionsStr));
  renderTableCart();
}

async function removeFromGroupCart(itemKey) {
  try {
    const res = await apiPost('/api/cart/group/remove', {
      restaurant_id: restaurantId,
      table_number: tableNumber,
      item_key: itemKey
    }, true);

    if (res.cart) {
      groupCartData = res.cart;
      renderTableCart();
      showToast('Item removed from group order', 'success');
    } else {
      showToast(res.error || 'Failed to remove item', 'error');
    }
  } catch (err) {
    showToast('Network error', 'error');
  }
}

async function updateGroupCartQuantity(itemKey, quantity) {
  try {
    const res = await apiPost('/api/cart/group/update-quantity', {
      restaurant_id: restaurantId,
      table_number: tableNumber,
      item_key: itemKey,
      quantity: quantity
    }, true);

    if (res.cart) {
      groupCartData = res.cart;
      renderTableCart();
    } else {
      showToast(res.error || 'Failed to update quantity', 'error');
    }
  } catch (err) {
    showToast('Network error', 'error');
  }
}

function renderTableCart() {
  const fab = document.getElementById('cart-fab');
  const badge = document.getElementById('cart-badge');
  const list = document.getElementById('cart-items-list');
  const footer = document.getElementById('cart-footer');

  let cartItems = [];
  let total = 0;

  if (isGroupOrder && groupCartData) {
    cartItems = groupCartData.items || [];
    total = cartItems.reduce((sum, i) => sum + i.price * i.quantity, 0);
  } else {
    cartItems = tableCart;
    total = tableCart.reduce((sum, i) => sum + i.price * i.quantity, 0);
  }

  if (fab) fab.style.display = cartItems.length > 0 ? '' : 'none';
  if (badge) badge.textContent = cartItems.reduce((s, i) => s + i.quantity, 0);

  if (!list) return;

  if (cartItems.length === 0) {
    list.innerHTML = `<div class="empty-state"><div class="icon">🛒</div><p>Your ${isGroupOrder ? 'group ' : ''}order is empty</p></div>`;
    if (footer) footer.style.display = 'none';
    return;
  }

  list.innerHTML = cartItems.map(item => `
    <div style="display:flex;align-items:center;gap:.75rem;padding:.75rem 0;border-bottom:1px solid var(--border)">
      <div style="flex:1">
        <div style="font-weight:600;font-size:.9rem">${item.name}</div>
        ${item.options ? `<div style="font-size:0.75rem;color:var(--text-muted)">${item.options}</div>` : ''}
        ${isGroupOrder && item.added_by ? `<div style="font-size:0.7rem;color:var(--primary);font-style:italic">Added by ${item.added_by}</div>` : ''}
        <div style="color:var(--primary);font-size:.88rem;font-weight:600">₹${item.price} each</div>
      </div>
      ${!isGroupOrder ? `
      <div class="qty-ctrl">
        <button class="qty-btn" onclick="changeTableQty('${item.itemId}',-1,'${item.options}')">−</button>
        <span class="qty-num">${item.quantity}</span>
        <button class="qty-btn" onclick="changeTableQty('${item.itemId}',1,'${item.options}')">+</button>
      </div>
      <button onclick="removeFromTableCart('${item.itemId}','${item.options}')" style="background:none;border:none;color:var(--accent);cursor:pointer;font-size:1.1rem">🗑</button>
      ` : `
      <div class="qty-ctrl">
        <button class="qty-btn" onclick="updateGroupCartQuantity('${item.item_key}', ${item.quantity - 1})">−</button>
        <span class="qty-num">${item.quantity}</span>
        <button class="qty-btn" onclick="updateGroupCartQuantity('${item.item_key}', ${item.quantity + 1})">+</button>
      </div>
      <button onclick="removeFromGroupCart('${item.item_key}')" style="background:none;border:none;color:var(--accent);cursor:pointer;font-size:1.1rem">🗑</button>
      `}
    </div>
  `).join('');

  window.getCartSubtotal = () => total;

  if (footer) {
    footer.style.display = '';
    const subtotalEl = document.getElementById('cart-subtotal');
    if (subtotalEl) subtotalEl.textContent = `₹${total.toFixed(2)}`;
    
    let finalTotal = total;
    const discountRow = document.getElementById('cart-discount-row');
    const discountEl = document.getElementById('cart-discount');
    
    if (window.appliedCoupon && window.couponDiscountAmount > 0) {
        if (discountRow) discountRow.style.setProperty('display', 'flex', 'important');
        if (discountEl) discountEl.textContent = `-₹${window.couponDiscountAmount.toFixed(2)}`;
        finalTotal = Math.max(0, total - window.couponDiscountAmount);
    } else {
        if (discountRow) discountRow.style.setProperty('display', 'none', 'important');
    }
    
    const totalEl = document.getElementById('cart-total');
    if (totalEl) totalEl.textContent = `₹${finalTotal.toFixed(2)}`;

    // Group order: show Place Order only to creator; others see info message
    const checkoutBtn = document.getElementById('checkout-btn');
    const creatorNote = document.getElementById('group-creator-note');
    if (isGroupOrder) {
      if (checkoutBtn) checkoutBtn.style.display = isGroupCreator ? '' : 'none';
      if (!creatorNote) {
        const note = document.createElement('div');
        note.id = 'group-creator-note';
        note.style.cssText = 'text-align:center;color:var(--text-muted);font-size:0.85rem;padding:0.5rem;background:rgba(255,107,53,0.08);border-radius:8px;margin-top:0.5rem;';
        note.innerHTML = isGroupCreator
          ? '<i class="bi bi-crown-fill text-warning"></i> You are the group host. Place the order when everyone is ready.'
          : '<i class="bi bi-info-circle"></i> Waiting for the group host to place the order…';
        if (checkoutBtn) checkoutBtn.parentNode.insertBefore(note, checkoutBtn.nextSibling);
      } else {
        creatorNote.innerHTML = isGroupCreator
          ? '<i class="bi bi-crown-fill text-warning"></i> You are the group host. Place the order when everyone is ready.'
          : '<i class="bi bi-info-circle"></i> Waiting for the group host to place the order…';
      }
    } else {
      if (checkoutBtn) checkoutBtn.style.display = '';
      const note = document.getElementById('group-creator-note');
      if (note) note.remove();
    }
  }
}

// ── Place Order ─────────────────────────────────────────
async function placeTableOrder() {
  let cartItems = [];
  if (isGroupOrder && groupCartData) {
    cartItems = groupCartData.items || [];
  } else {
    cartItems = tableCart;
  }

  if (cartItems.length === 0) {
    showToast('Your order is empty', 'error');
    return;
  }

  // Group order: only creator can place
  if (isGroupOrder && !isGroupCreator) {
    showToast('Only the group host can place the order', 'error');
    return;
  }

  const btn = document.getElementById('checkout-btn');
  btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Placing…';
  btn.disabled = true;

  const isGuest = !getToken() || getRole() !== 'customer';

  let res;
  try {
    if (isGroupOrder) {
      // Use the dedicated group order endpoint — server enforces creator check
      res = await apiPost('/api/cart/group/place-order', {
        restaurant_id: restaurantId,
        table_number: tableNumber,
        coupon_code: window.appliedCoupon || '',
        mobile_number: document.getElementById('cart-mobile')?.value?.trim() || ''
      }, true);
    } else {
      const body = {
        restaurant_id: restaurantId,
        table_number: tableNumber,
        items: cartItems.map(i => ({ item_id: i.itemId || i.item_id, quantity: i.quantity, options: i.options || '' })),
        address: `Dine-In — Table ${tableNumber}`,
        coupon_code: window.appliedCoupon || '',
        mobile_number: document.getElementById('cart-mobile')?.value?.trim() || ''
      };
      const headers = {
        'Content-Type': 'application/json',
        ...(isGuest ? {} : authHeaders())
      };
      const response = await fetch(API + '/api/order', { method: 'POST', headers, body: JSON.stringify(body) });
      res = await response.json();
    }
  } catch (err) {
    res = { error: 'Network error' };
  }

  btn.innerHTML = '<i class="bi bi-check-circle"></i> Place Dine-In Order';
  btn.disabled = false;

  if (res.order_id) {
    // Clear carts
    tableCart = [];
    if (isGroupOrder) {
      groupCartData = null;
      isGroupOrder = false;
      isGroupCreator = false;
      if (groupSyncInterval) {
        clearInterval(groupSyncInterval);
        groupSyncInterval = null;
      }
      // Reset button
      const groupBtn = document.getElementById('start-group-order');
      if (groupBtn) {
        groupBtn.innerHTML = '👥 Start Group Order';
        groupBtn.disabled = false;
        groupBtn.style.background = 'linear-gradient(45deg, #ff6b6b, #ee5a24)';
      }
    }
    
    window.appliedCoupon = null;
    window.couponDiscountAmount = 0;
    renderTableCart();
    // Close sidebar
    const sidebar = document.getElementById('cartSidebar');
    if (sidebar) { const bs = bootstrap.Offcanvas.getInstance(sidebar); if (bs) bs.hide(); }
    showToast(`Order placed! 🎉 The kitchen is preparing your food.`, 'success');
    
    if (isGuest) {
      let guestOrders = JSON.parse(localStorage.getItem('fc_guest_orders') || '[]');
      guestOrders.push(res.order_id);
      localStorage.setItem('fc_guest_orders', JSON.stringify(guestOrders));
    }
    
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
  const isGuest = !getToken() || getRole() !== 'customer';
  let orders = [];

  if (isGuest) {
    const guestOrders = JSON.parse(localStorage.getItem('fc_guest_orders') || '[]');
    if (guestOrders.length === 0) return;
    try {
        const response = await fetch(API + '/api/orders/guest', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order_ids: guestOrders })
        });
        orders = await response.json();
    } catch(err) {
        return;
    }
  } else {
    orders = await apiFetch('/api/orders/me', true);
  }

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
            <span>🟠 Placed</span><span>🔵 Accepted</span><span>🔥 Cooking</span><span>🟢 Ready</span><span>✔️ Served</span>
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
