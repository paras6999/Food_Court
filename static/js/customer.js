/* ════════════════════════════════════════════════════════
   customer.js — Restaurant listing, cart logic, checkout
   ════════════════════════════════════════════════════════ */

// ── Cart (stored in localStorage) ──────────────────────
const CART_KEY = 'fc_cart';

function getCart() { 
    let cart = JSON.parse(localStorage.getItem(CART_KEY) || '{}');
    if (Array.isArray(cart)) {
        cart = {}; // migrate old array cart
        saveCart(cart);
    }
    return cart;
}

function saveCart(cart) { localStorage.setItem(CART_KEY, JSON.stringify(cart)); }

function addToCart(itemId, name, price, restId, optionsStr = '', restName = 'Restaurant') {
    let cart = getCart();

    if (!cart[restId]) {
        cart[restId] = { restaurant_name: restName, items: [] };
    }
    
    const existing = cart[restId].items.find(i => i.item_id === itemId && i.options === optionsStr);
    if (existing) {
        existing.quantity += 1;
    } else {
        cart[restId].items.push({ item_id: itemId, name: name, price: price, quantity: 1, options: optionsStr });
    }
    
    saveCart(cart);
    renderCart();
    showToast(`${name} added to cart 🛒`, 'success');
}

function removeFromCart(restId, itemId, optionsStr = '') {
    let cart = getCart();
    if (cart[restId]) {
        cart[restId].items = cart[restId].items.filter(i => !(i.item_id === itemId && i.options === optionsStr));
        if (cart[restId].items.length === 0) {
            delete cart[restId];
        }
    }
    saveCart(cart);
    renderCart();
}

function changeQty(restId, itemId, delta, optionsStr = '') {
    let cart = getCart();
    if (cart[restId]) {
        const item = cart[restId].items.find(i => i.item_id === itemId && i.options === optionsStr);
        if (item) {
            item.quantity += delta;
            if (item.quantity <= 0) {
                cart[restId].items = cart[restId].items.filter(i => !(i.item_id === itemId && i.options === optionsStr));
            }
            if (cart[restId].items.length === 0) {
                delete cart[restId];
            }
        }
    }
    saveCart(cart);
    renderCart();
}

function renderCart() {
    const cart = getCart();
    const fab = document.getElementById('cart-fab');
    const badge = document.getElementById('cart-badge');
    const list = document.getElementById('cart-items-list');
    const footer = document.getElementById('cart-footer');

    const restIds = Object.keys(cart);
    let totalItems = 0;
    let totalPrice = 0;

    restIds.forEach(rid => {
        cart[rid].items.forEach(i => {
            totalItems += i.quantity;
            totalPrice += i.price * i.quantity;
        });
    });

    if (fab) fab.style.display = totalItems > 0 ? '' : 'none';
    if (badge) badge.textContent = totalItems;

    if (!list) return;

    if (totalItems === 0) {
        list.innerHTML = `<div class="empty-state"><div class="icon">🛒</div><p>Your cart is empty</p></div>`;
        if (footer) footer.style.display = 'none';
        return;
    }

    let html = '';
    restIds.forEach(rid => {
        const rData = cart[rid];
        html += `<div style="background:rgba(255,107,53,0.05);padding:0.5rem;border-radius:8px;margin-top:0.5rem;">
                   <strong style="color:var(--primary);font-size:0.85rem">${rData.restaurant_name}</strong>
                 </div>`;
        rData.items.forEach(item => {
            html += `
            <div style="display:flex;align-items:center;gap:.75rem;padding:.75rem 0;border-bottom:1px solid var(--border)">
              <div style="flex:1">
                <div style="font-weight:600;font-size:.9rem">${item.name}</div>
                ${item.options ? `<div style="font-size:0.75rem;color:var(--text-muted)">${item.options}</div>` : ''}
                <div style="color:var(--primary);font-size:.88rem;font-weight:600">₹${item.price} each</div>
              </div>
              <div class="qty-ctrl">
                <button class="qty-btn" onclick="changeQty('${rid}','${item.item_id}',-1,'${item.options}')">−</button>
                <span class="qty-num">${item.quantity}</span>
                <button class="qty-btn" onclick="changeQty('${rid}','${item.item_id}',1,'${item.options}')">+</button>
              </div>
              <button onclick="removeFromCart('${rid}','${item.item_id}','${item.options}')" style="background:none;border:none;color:var(--accent);cursor:pointer;font-size:1.1rem">🗑</button>
            </div>
            `;
        });
    });

    list.innerHTML = html;

    window.getCartSubtotal = () => totalPrice;

    if (footer) {
        footer.style.display = '';
        const subtotalEl = document.getElementById('cart-subtotal');
        if (subtotalEl) subtotalEl.textContent = `₹${totalPrice.toFixed(2)}`;
        
        let finalTotal = totalPrice;
        const discountRow = document.getElementById('cart-discount-row');
        const discountEl = document.getElementById('cart-discount');
        
        if (window.appliedCoupon && window.couponDiscountAmount > 0) {
            if (discountRow) discountRow.style.setProperty('display', 'flex', 'important');
            if (discountEl) discountEl.textContent = `-₹${window.couponDiscountAmount.toFixed(2)}`;
            finalTotal = Math.max(0, finalTotal - window.couponDiscountAmount);
        } else {
            if (discountRow) discountRow.style.setProperty('display', 'none', 'important');
        }
        
        // Handle Points logic
        const usePointsCheckbox = document.getElementById('cart-use-points');
        const pointsSavingsEl = document.getElementById('cart-points-savings');
        let pointsDiscount = 0;
        
        if (usePointsCheckbox && usePointsCheckbox.checked && window.userFcPoints > 0) {
            const maxPointsDiscount = window.userFcPoints / 10.0;
            pointsDiscount = Math.min(finalTotal, maxPointsDiscount);
            if (pointsSavingsEl) pointsSavingsEl.textContent = `Save ₹${pointsDiscount.toFixed(2)}`;
            finalTotal = Math.max(0, finalTotal - pointsDiscount);
        } else {
            if (pointsSavingsEl && window.userFcPoints > 0) {
                const potentialSavings = Math.min(finalTotal, window.userFcPoints / 10.0);
                pointsSavingsEl.textContent = `Save ₹${potentialSavings.toFixed(2)}`;
            }
        }
        
        const totalEl = document.getElementById('cart-total');
        if (totalEl) totalEl.textContent = `₹${finalTotal.toFixed(2)}`;
    }
}

async function checkout(method = 'razorpay') {
    const cart = getCart();
    const restIds = Object.keys(cart);
    const addressEl = document.getElementById('cart-address');
    const address = addressEl ? addressEl.value.trim() : '';
    const usePointsCheckbox = document.getElementById('cart-use-points');
    const usePoints = usePointsCheckbox ? usePointsCheckbox.checked : false;

    if (!getToken() || getRole() !== 'customer') {
        showToast('Please login to place an order', 'error');
        setTimeout(() => window.location.href = '/login.html', 1200);
        return;
    }
    if (!address) { showToast('Please enter a delivery address', 'error'); return; }
    if (restIds.length === 0) { showToast('Your cart is empty', 'error'); return; }

    const payBtn = document.getElementById(method === 'cod' ? 'checkout-btn-cod' : 'checkout-btn-razorpay');
    const originalBtnHtml = payBtn ? payBtn.innerHTML : '';
    if (payBtn) { payBtn.disabled = true; payBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Processing…'; }

    // ── Cash on Delivery ──
    if (method === 'cod') {
        let successCount = 0;
        let failCount = 0;
        
        // Loop and send parallel order requests for each restaurant
        await Promise.all(restIds.map(async (restId) => {
            const body = {
                restaurant_id: restId,
                items: cart[restId].items.map(i => ({ item_id: i.item_id, quantity: i.quantity, options: i.options })),
                address,
                coupon_code: window.appliedCoupon || '',
                use_points: usePoints
            };
            const res = await apiPost('/api/order', body, true);
            if (res.order_id) successCount++;
            else failCount++;
        }));

        if (successCount > 0) {
            saveCart({});
            window.appliedCoupon = null;
            window.couponDiscountAmount = 0;
            renderCart();
            const sidebar = document.getElementById('cartSidebar');
            if (sidebar) { const bs = bootstrap.Offcanvas.getInstance(sidebar); if (bs) bs.hide(); }
            showToast(`Placed ${successCount} order(s) successfully via COD! 🎉`, 'success');
            if (failCount > 0) showToast(`${failCount} order(s) failed`, 'error');
            setTimeout(() => window.location.href = '/orders.html', 1500);
        } else {
            showToast('Failed to place orders', 'error');
            if (payBtn) { payBtn.disabled = false; payBtn.innerHTML = originalBtnHtml; }
        }
        return;
    }

    // ── Razorpay Payment ──
    let totalAmount = 0;
    restIds.forEach(rid => {
        cart[rid].items.forEach(i => { totalAmount += i.price * i.quantity; });
    });
    
    if (window.appliedCoupon && window.couponDiscountAmount > 0) {
        totalAmount = Math.max(0, totalAmount - window.couponDiscountAmount);
    }
    
    if (usePoints && window.userFcPoints > 0) {
        totalAmount = Math.max(0, totalAmount - (window.userFcPoints / 10.0));
    }

    const orderRes = await apiPost('/api/payment/create-order', { amount: totalAmount }, true);

    if (orderRes.error) {
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
        description: 'Multi-Restaurant Order Payment',
        order_id: orderRes.razorpay_order_id,
        prefill: {
            name: getName() || '',
        },
        theme: { color: '#ff6b35' },
        handler: async function (response) {
            // Concurrent payment-verified order placement requests!
            let successCount = 0;
            let failCount = 0;
            
            await Promise.all(restIds.map(async (restId) => {
                const verifyRes = await apiPost('/api/payment/verify', {
                    razorpay_order_id:   response.razorpay_order_id,
                    razorpay_payment_id: response.razorpay_payment_id,
                    razorpay_signature:  response.razorpay_signature,
                    restaurant_id: restId,
                    items: cart[restId].items.map(i => ({ item_id: i.item_id, quantity: i.quantity, options: i.options })),
                    address: address,
                    coupon_code: window.appliedCoupon || '',
                    use_points: usePoints
                }, true);
                if (verifyRes.order_id) successCount++;
                else failCount++;
            }));

            if (successCount > 0) {
                saveCart({});
                window.appliedCoupon = null;
                window.couponDiscountAmount = 0;
                renderCart();
                const sidebar = document.getElementById('cartSidebar');
                if (sidebar) { const bs = bootstrap.Offcanvas.getInstance(sidebar); if (bs) bs.hide(); }
                showToast(`Payment successful! Placed ${successCount} order(s) 🎉`, 'success');
                setTimeout(() => window.location.href = '/orders.html', 1500);
            } else {
                showToast('Payment successful but order placement failed', 'error');
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
    window.allRestaurants = Array.isArray(data) ? data : [];
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
            const escapedRestName = i.restaurant_name.replace(/'/g, "\\'");
            HTML += `
        <div class="suggestion-item" onclick="triggerFlyingCart(event, '${i._id}'); addToCart('${i._id}', '${escapedName}', ${i.price}, '${i.restaurant_id}', '', '${escapedRestName}')">
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
