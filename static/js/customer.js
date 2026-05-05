/* ════════════════════════════════════════════════════════
   customer.js — Restaurant listing, cart logic, checkout
   ════════════════════════════════════════════════════════ */

// ── Cart (stored in localStorage) ──────────────────────
const CART_KEY = 'fc_cart';
const CART_REST_KEY = 'fc_cart_restaurant';

function getCart() { return JSON.parse(localStorage.getItem(CART_KEY) || '[]'); }
function saveCart(cart) { localStorage.setItem(CART_KEY, JSON.stringify(cart)); }
function getCartRestId() { return localStorage.getItem(CART_REST_KEY) || ''; }
function setCartRestId(id) { localStorage.setItem(CART_REST_KEY, id); }

function addToCart(itemId, name, price, restId) {
    const currentRest = getCartRestId();
    let cart = getCart();

    // If user is trying to add from a different restaurant, ask them to clear
    if (currentRest && currentRest !== restId && cart.length > 0) {
        if (!confirm('Your cart has items from another restaurant. Clear cart and add this item?')) return;
        cart = [];
    }

    setCartRestId(restId);
    const existing = cart.find(i => i.itemId === itemId);
    if (existing) {
        existing.quantity += 1;
    } else {
        cart.push({ itemId, name, price, quantity: 1 });
    }
    saveCart(cart);
    renderCart();
    showToast(`${name} added to cart 🛒`, 'success');
}

function removeFromCart(itemId) {
    let cart = getCart().filter(i => i.itemId !== itemId);
    saveCart(cart);
    if (cart.length === 0) { localStorage.removeItem(CART_REST_KEY); }
    renderCart();
}

function changeQty(itemId, delta) {
    let cart = getCart();
    const item = cart.find(i => i.itemId === itemId);
    if (!item) return;
    item.quantity += delta;
    if (item.quantity <= 0) { cart = cart.filter(i => i.itemId !== itemId); }
    saveCart(cart);
    if (cart.length === 0) localStorage.removeItem(CART_REST_KEY);
    renderCart();
}

function renderCart() {
    const cart = getCart();
    const fab = document.getElementById('cart-fab');
    const badge = document.getElementById('cart-badge');
    const list = document.getElementById('cart-items-list');
    const footer = document.getElementById('cart-footer');

    if (fab) fab.style.display = cart.length > 0 ? '' : 'none';
    if (badge) badge.textContent = cart.reduce((s, i) => s + i.quantity, 0);

    if (!list) return;

    if (cart.length === 0) {
        list.innerHTML = `<div class="empty-state"><div class="icon">🛒</div><p>Your cart is empty</p></div>`;
        if (footer) footer.style.display = 'none';
        return;
    }

    const total = cart.reduce((sum, i) => sum + i.price * i.quantity, 0);
    list.innerHTML = cart.map(item => `
    <div style="display:flex;align-items:center;gap:.75rem;padding:.75rem 0;border-bottom:1px solid var(--border)">
      <div style="flex:1">
        <div style="font-weight:600;font-size:.9rem">${item.name}</div>
        <div style="color:var(--primary);font-size:.88rem;font-weight:600">₹${item.price} each</div>
      </div>
      <div class="qty-ctrl">
        <button class="qty-btn" onclick="changeQty('${item.itemId}',-1)">−</button>
        <span class="qty-num">${item.quantity}</span>
        <button class="qty-btn" onclick="changeQty('${item.itemId}',1)">+</button>
      </div>
      <button onclick="removeFromCart('${item.itemId}')" style="background:none;border:none;color:var(--accent);cursor:pointer;font-size:1.1rem">🗑</button>
    </div>
  `).join('');

    if (footer) {
        footer.style.display = '';
        const totalEl = document.getElementById('cart-total');
        if (totalEl) totalEl.textContent = `₹${total}`;
    }
}

async function checkout(method = 'razorpay') {
    const cart = getCart();
    const restId = getCartRestId();
    const addressEl = document.getElementById('cart-address');
    const address = addressEl ? addressEl.value.trim() : '';

    if (!getToken() || getRole() !== 'customer') {
        showToast('Please login to place an order', 'error');
        setTimeout(() => window.location.href = '/login.html', 1200);
        return;
    }
    if (!address) { showToast('Please enter a delivery address', 'error'); return; }
    if (cart.length === 0) { showToast('Your cart is empty', 'error'); return; }

    const payBtn = document.getElementById(method === 'cod' ? 'checkout-btn-cod' : 'checkout-btn-razorpay');
    const originalBtnHtml = payBtn ? payBtn.innerHTML : '';
    if (payBtn) { payBtn.disabled = true; payBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Processing…'; }

    // ── Cash on Delivery ──
    if (method === 'cod') {
        const body = {
            restaurant_id: restId,
            items: cart.map(i => ({ item_id: i.itemId, quantity: i.quantity })),
            address
        };
        const res = await apiPost('/api/order', body, true);
        if (res.order_id) {
            saveCart([]);
            localStorage.removeItem(CART_REST_KEY);
            renderCart();
            const sidebar = document.getElementById('cartSidebar');
            if (sidebar) { const bs = bootstrap.Offcanvas.getInstance(sidebar); if (bs) bs.hide(); }
            showToast('Order placed successfully via COD! 🎉', 'success');
            setTimeout(() => window.location.href = '/orders.html', 1500);
        } else {
            showToast(res.error || 'Failed to place order', 'error');
            if (payBtn) { payBtn.disabled = false; payBtn.innerHTML = originalBtnHtml; }
        }
        return;
    }

    // ── Razorpay Payment ──
    const total = cart.reduce((sum, i) => sum + i.price * i.quantity, 0);

    const orderRes = await apiPost('/api/payment/create-order', { amount: total }, true);

    if (orderRes.error) {
        // If testing locally and razorpay module is missing, Vercel gives 500 error which is caught as "Network error"
        let msg = orderRes.error;
        if (msg === 'Network error') {
            msg = 'Network error: Backend could not process payment. Did you install razorpay locally?';
        }
        showToast(msg, 'error');
        if (payBtn) { payBtn.disabled = false; payBtn.innerHTML = originalBtnHtml; }
        return;
    }

    const options = {
        key: orderRes.key_id,
        amount: orderRes.amount,
        currency: orderRes.currency,
        name: 'FoodCourt',
        description: 'Food Order Payment',
        order_id: orderRes.razorpay_order_id,
        prefill: {
            name: getName() || '',
        },
        theme: { color: '#ff6b35' },
        handler: async function (response) {
            const verifyRes = await apiPost('/api/payment/verify', {
                razorpay_order_id:   response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature:  response.razorpay_signature,
                restaurant_id: restId,
                items: cart.map(i => ({ item_id: i.itemId, quantity: i.quantity })),
                address: address
            }, true);

            if (verifyRes.order_id) {
                saveCart([]);
                localStorage.removeItem(CART_REST_KEY);
                renderCart();
                const sidebar = document.getElementById('cartSidebar');
                if (sidebar) { const bs = bootstrap.Offcanvas.getInstance(sidebar); if (bs) bs.hide(); }
                showToast('Payment successful! Order placed 🎉', 'success');
                setTimeout(() => window.location.href = '/orders.html', 1500);
            } else {
                showToast(verifyRes.error || 'Payment verification failed', 'error');
                if (payBtn) { payBtn.disabled = false; payBtn.innerHTML = originalBtnHtml; }
            }
        },
        modal: {
            ondismiss: function () {
                showToast('Payment cancelled', 'error');
                if (payBtn) { payBtn.disabled = false; payBtn.innerHTML = originalBtnHtml; }
            }
        }
    };

    if (typeof Razorpay === 'undefined') {
        showToast('Payment gateway not loaded. Please refresh.', 'error');
        if (payBtn) { payBtn.disabled = false; payBtn.innerHTML = originalBtnHtml; }
        return;
    }

    const rzp = new Razorpay(options);
    rzp.open();
}

// ── Restaurant listing ──────────────────────────────────
async function loadRestaurants(query = '', cuisine = '') {
    const grid = document.getElementById('restaurants-grid');
    if (!grid) return;

    let url = '/api/restaurants?';
    if (query) url += `q=${encodeURIComponent(query)}&`;
    if (cuisine) url += `cuisine=${encodeURIComponent(cuisine)}&`;

    const data = await apiFetch(url);
    grid.innerHTML = '';

    if (!Array.isArray(data) || data.length === 0) {
        grid.innerHTML = `<div class="col-12"><div class="empty-state"><div class="icon">🍽️</div><p>No restaurants found. Try a different search.</p></div></div>`;
        return;
    }

    grid.innerHTML = data.map(r => `
    <div class="col-12 col-sm-6 col-lg-4">
      <div class="fc-card" onclick="window.location.href='/menu.html?id=${r._id}'">
        <img src="${r.image || 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=400'}"
             alt="${r.name}" onerror="this.src='https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=400'">
        <div class="card-body">
          <h3 class="card-title">${r.name}</h3>
          <div class="d-flex align-items-center justify-content-between mt-2">
            <span class="badge-cuisine">${r.cuisine || 'Various'}</span>
            <span>${renderStars(r.rating || 0)} <span class="rating-num">${(r.rating || 0).toFixed(1)}</span></span>
          </div>
          ${r.offer ? `<div class="mt-2 d-inline-block px-2 py-1" style="background:rgba(32,201,151,0.1);color:#20c997;border-radius:4px;font-size:0.75rem;font-weight:700;"><i class="bi bi-tags-fill"></i> ${r.offer}</div>` : ''}
          <div class="mt-2">
            <button class="btn-primary-custom w-100 mt-2" style="font-size:0.85rem;padding:.4rem 1rem"
              onclick="event.stopPropagation();window.location.href='/menu.html?id=${r._id}'">
              <i class="bi bi-menu-button-wide"></i> View Menu
            </button>
          </div>
        </div>
      </div>
    </div>
  `).join('');
}

// ── Search Suggestions ──────────────────────────────────
let searchTimeout;

document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('search-input');
    const suggestionsBox = document.getElementById('search-suggestions');
    if (!searchInput || !suggestionsBox) return;

    // Handle Input with Debounce
    searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        const query = e.target.value.trim();

        if (query.length < 2) {
            suggestionsBox.classList.remove('active');
            return;
        }

        searchTimeout = setTimeout(async () => {
            const data = await apiFetch(`/api/search?q=${encodeURIComponent(query)}`);
            renderSuggestions(data);
        }, 300);
    });

    // Handle Enter Key
    searchInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
            if (typeof triggerSearch === 'function') triggerSearch();
        }
    });

    // Close when clicking outside
    document.addEventListener('click', (e) => {
        if (!searchInput.contains(e.target) && !suggestionsBox.contains(e.target)) {
            suggestionsBox.classList.remove('active');
        }
    });
});

function renderSuggestions(data) {
    const box = document.getElementById('search-suggestions');
    box.innerHTML = '';
    let HTML = '';

    if (data.restaurants?.length) {
        HTML += `<div class="suggestion-group">Restaurants</div>`;
        data.restaurants.forEach(r => {
            HTML += `
        <a href="/menu.html?id=${r._id}" class="suggestion-item">
          <div>
            <strong>${r.name}</strong>
            <div class="small-text">${r.cuisine} • ⭐ ${r.rating}</div>
          </div>
          <i class="bi bi-arrow-right text-muted-custom"></i>
        </a>
      `;
        });
    }

    if (data.menu_items?.length) {
        HTML += `<div class="suggestion-group">Dishes</div>`;
        data.menu_items.forEach(i => {
            const escapedName = i.name.replace(/'/g, "\\'");
            HTML += `
        <div class="suggestion-item" onclick="addToCart('${i._id}', '${escapedName}', ${i.price}, '${i.restaurant_id}')">
          <div>
            <strong>${i.name}</strong> <span class="text-primary-custom ms-2">₹${i.price}</span>
            <div class="small-text">from ${i.restaurant_name}</div>
          </div>
          <button class="btn-outline-custom" style="padding:0.2rem 0.6rem;font-size:0.75rem;border-radius:20px">+ Add</button>
        </div>
      `;
        });
    }

    if (!HTML) {
        HTML = `<div style="padding:1rem;color:var(--text-muted);text-align:center">No results found</div>`;
    }

    box.innerHTML = HTML;
    box.classList.add('active');
}
