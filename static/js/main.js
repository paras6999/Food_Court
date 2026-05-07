/* ════════════════════════════════════════════════════════
   main.js — Shared utilities for all pages
   ════════════════════════════════════════════════════════ */

const API = '';   // empty = same origin

// ── Auth Helpers ────────────────────────────────────────
function getToken()  { return localStorage.getItem('fc_token'); }
function getRole()   { return localStorage.getItem('fc_role'); }
function getName()   { return localStorage.getItem('fc_name'); }
function getUserId() { return localStorage.getItem('fc_id'); }

function authHeaders() {
  const t = getToken();
  return t ? { 'Authorization': `Bearer ${t}` }
           : {};
}

// ── Fetch wrappers ──────────────────────────────────────
async function apiFetch(path, withAuth = false) {
  const headers = withAuth ? authHeaders() : {};
  try {
    const r = await fetch(API + path, { headers });
    return await r.json();
  } catch (err) {
    console.error('Fetch error:', err);
    return { error: 'Network error' };
  }
}

async function apiPost(path, body, withAuth = false) {
  const headers = {
    'Content-Type': 'application/json',
    ...(withAuth ? authHeaders() : {})
  };
  try {
    const r = await fetch(API + path, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
    
    // Check if response is JSON
    const contentType = r.headers.get("content-type");
    if (contentType && contentType.indexOf("application/json") !== -1) {
        return await r.json();
    } else {
        const text = await r.text();
        console.error('Non-JSON response from server:', text);
        return { error: `Server error: ${r.status}` };
    }
  } catch (err) {
    console.error('Network/fetch error:', err);
    return { error: 'Network error' };
  }
}

async function apiPut(path, body) {
  const headers = {
    'Content-Type': 'application/json',
    ...authHeaders()
  };
  try {
    const r = await fetch(API + path, {
      method: 'PUT',
      headers,
      body: JSON.stringify(body)
    });
    return await r.json();
  } catch (err) {
    return { error: 'Network error' };
  }
}

// ── Coupons & Points ──────────────────────────────────────────────
window.appliedCoupon = null;
window.couponDiscountAmount = 0;
window.userFcPoints = 0;

async function loadUserProfile() {
    if (getRole() === 'customer' && getToken()) {
        const profile = await apiFetch('/api/user/profile', true);
        if (profile && !profile.error) {
            window.userFcPoints = profile.fc_points || 0;
            
            // Update points UI in cart
            const pointsContainer = document.getElementById('cart-points-container');
            const pointsLabel = document.getElementById('cart-points-label');
            
            if (pointsContainer && window.userFcPoints > 0) {
                pointsContainer.style.display = 'block';
                if (pointsLabel) pointsLabel.innerHTML = `<i class="bi bi-star-fill text-warning"></i> Use ${window.userFcPoints} Points`;
            }
        }
    }
}

// Call on load
document.addEventListener('DOMContentLoaded', loadUserProfile);

async function applyCoupon(restaurantId = null) {
  const codeInput = document.getElementById('cart-coupon');
  const msgEl = document.getElementById('coupon-message');
  if (!codeInput || !msgEl) return;
  
  const code = codeInput.value.trim().toUpperCase();
  if (!code) {
    msgEl.innerHTML = '<span class="text-danger">Please enter a coupon code.</span>';
    return;
  }
  
  // Auto-detect restaurant_id from cart if not provided
  if (!restaurantId) {
      // Try from table ordering context
      if (typeof window.restaurantId !== 'undefined' && window.restaurantId) {
          restaurantId = window.restaurantId;
      } else {
          // Try from delivery cart keys
          try {
              const cart = JSON.parse(localStorage.getItem('fc_cart') || '{}');
              const restIds = Object.keys(cart);
              if (restIds.length === 1) {
                  restaurantId = restIds[0];
              } else if (restIds.length > 1) {
                  // Multiple restaurants — use the first one (coupon is per-restaurant)
                  restaurantId = restIds[0];
              }
          } catch(e) {}
      }
  }
  
  if (!restaurantId) {
      msgEl.innerHTML = '<span class="text-danger">Please add items to cart first before applying coupon.</span>';
      return;
  }
  
  // Need to get current subtotal from UI or global logic
  let subtotal = 0;
  if (typeof window.getCartSubtotal === 'function') {
      subtotal = window.getCartSubtotal();
  } else {
      // Fallback: try to read from DOM if no function available
      const subEl = document.getElementById('cart-subtotal');
      if (subEl) subtotal = parseFloat(subEl.textContent.replace('₹', '').replace('$', ''));
  }
  
  msgEl.innerHTML = '<span style="color:var(--text-muted)">Validating...</span>';
  
  const payload = { code, subtotal, restaurant_id: restaurantId };
  
  const res = await apiPost('/api/coupon/validate', payload, true);
  if (res.valid) {
      window.appliedCoupon = code;
      window.couponDiscountAmount = res.discount_amount;
      msgEl.innerHTML = `<span class="text-success">${res.message}</span>`;
      showToast(`Coupon applied! Saved ₹${res.discount_amount}`, 'success');
      
      // Trigger cart re-render to update totals
      if (typeof renderCart === 'function') renderCart();
      if (typeof renderTableCart === 'function') renderTableCart();
  } else {
      window.appliedCoupon = null;
      window.couponDiscountAmount = 0;
      msgEl.innerHTML = `<span class="text-danger">${res.error || res.message || 'Invalid coupon'}</span>`;
      
      // Trigger cart re-render to reset totals
      if (typeof renderCart === 'function') renderCart();
      if (typeof renderTableCart === 'function') renderTableCart();
  }
}

async function apiDelete(path) {
  try {
    const r = await fetch(API + path, { method: 'DELETE', headers: authHeaders() });
    return await r.json();
  } catch (err) {
    return { error: 'Network error' };
  }
}

// ── Toast ───────────────────────────────────────────────
function showToast(msg, type = 'info') {
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  const colors = { success: '#20c997', error: '#dc3545', info: '#0dcaf0' };
  const cont = document.getElementById('toast-container');
  if (!cont) return;

  const t = document.createElement('div');
  t.className = `fc-toast ${type}`;
  t.innerHTML = `<span>${icons[type]}</span><span>${msg}</span>`;
  t.style.borderLeftColor = colors[type];
  cont.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .4s'; setTimeout(() => t.remove(), 400); }, 3000);
}

// ── Navbar init (shows user info) ───────────────────────
function initNavbar() {
  const token = getToken();
  const role  = getRole();
  const name  = getName();

  if (token && role === 'customer') {
    const navUserInfo = document.getElementById('nav-user-info');
    const navLoginItem = document.getElementById('nav-login-item');
    const navRegisterItem = document.getElementById('nav-register-item');
    const navOrdersItem = document.getElementById('nav-orders-item');
    const navLogoutItem = document.getElementById('nav-logout-item');
    
    if (navUserInfo) { navUserInfo.style.display = ''; document.getElementById('nav-username').textContent = name; }
    if (navLoginItem) navLoginItem.style.display = 'none';
    if (navRegisterItem) navRegisterItem.style.display = 'none';
    if (navOrdersItem) navOrdersItem.style.display = '';
    if (navLogoutItem) navLogoutItem.style.display = '';
  }

  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) logoutBtn.addEventListener('click', e => { e.preventDefault(); localStorage.clear(); window.location.href = '/'; });
}

// ── Star renderer ───────────────────────────────────────
function renderStars(rating) {
  const full = Math.floor(rating);
  const half = rating % 1 >= 0.5;
  const empty = 5 - full - (half ? 1 : 0);
  return `<span class="stars">${'★'.repeat(full)}${half ? '½' : ''}${'☆'.repeat(empty)}</span>`;
}

// ── Theme Toggle ────────────────────────────────────────
function initTheme() {
    const currentTheme = localStorage.getItem('fc-theme');
    if (currentTheme === 'light') {
        document.body.classList.add('light-theme');
    }
    
    // Setup toggle switches
    const themeSwitches = document.querySelectorAll('.theme-switch input');
    themeSwitches.forEach(sw => {
        if (currentTheme === 'light') {
            sw.checked = true;
        }
        sw.addEventListener('change', toggleTheme);
    });

    // Setup new button icon
    const icon = document.querySelector('#theme-toggle-btn i');
    if (icon) {
        icon.className = currentTheme === 'light' ? 'bi bi-sun' : 'bi bi-moon-stars';
    }
}

function toggleTheme(e) {
    if (e.target.checked) {
        document.body.classList.add('light-theme');
        localStorage.setItem('fc-theme', 'light');
    } else {
        document.body.classList.remove('light-theme');
        localStorage.setItem('fc-theme', 'dark');
    }
    
    const icon = document.querySelector('#theme-toggle-btn i');
    if (icon) {
        icon.className = e.target.checked ? 'bi bi-sun' : 'bi bi-moon-stars';
    }
}

function toggleProfessionalTheme() {
    const isLight = document.body.classList.contains('light-theme');
    const icon = document.querySelector('#theme-toggle-btn i');
    if (isLight) {
        document.body.classList.remove('light-theme');
        localStorage.setItem('fc-theme', 'dark');
        if (icon) icon.className = 'bi bi-moon-stars';
    } else {
        document.body.classList.add('light-theme');
        localStorage.setItem('fc-theme', 'light');
        if (icon) icon.className = 'bi bi-sun';
    }
}

// Ensure theme is applied right away when script loads
initTheme();

// ── Item Details Bottom Sheet ───────────────────────────
function openItemDetails(itemId, name, price, restId, restName, image, desc, isVeg, addonsStr = '') {
    let bsModal = document.getElementById('itemDetailsModal');
    
    // Parse addons
    let addonsHTML = '';
    if (addonsStr) {
        const addonsList = addonsStr.split(',').map(a => a.trim()).filter(a => a);
        addonsList.forEach(addon => {
            const parts = addon.split(':');
            if (parts.length === 2) {
                const aName = parts[0].trim();
                const aPrice = parseFloat(parts[1].trim());
                if (!isNaN(aPrice)) {
                    addonsHTML += `
                    <label class="d-flex justify-content-between align-items-center p-2" style="background:rgba(255,255,255,0.05); border-radius:8px; cursor:pointer;">
                        <span><input type="checkbox" class="bs-addon-cb me-2" value="${aName}" data-price="${aPrice}"> ${aName}</span>
                        <span style="color:var(--text-muted); font-size:0.85rem;">+₹${aPrice}</span>
                    </label>
                    `;
                }
            }
        });
    }

    if (!bsModal) {
        const html = `
        <div class="offcanvas offcanvas-bottom" tabindex="-1" id="itemDetailsModal" style="height:auto; max-height:85vh; border-top-left-radius: 20px; border-top-right-radius: 20px;">
            <div class="offcanvas-header" style="border-bottom:none; padding-bottom:0;">
                <button type="button" class="btn-close btn-close-white ms-auto" data-bs-dismiss="offcanvas"></button>
            </div>
            <div class="offcanvas-body">
                <img id="bs-item-img" src="" style="width:100%; height:200px; object-fit:cover; border-radius:12px; margin-bottom:1rem;" onerror="this.src='https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400'">
                <div class="d-flex justify-content-between align-items-start mb-2">
                    <div>
                        <h4 id="bs-item-name" style="font-weight:700; margin-bottom:0.2rem;"></h4>
                        <span id="bs-item-badge" style="font-size:0.8rem;"></span>
                    </div>
                    <h5 id="bs-item-price" style="color:var(--primary); font-weight:700;"></h5>
                </div>
                <p id="bs-item-desc" style="color:var(--text-muted); font-size:0.9rem; line-height:1.4;"></p>
                
                <hr style="border-color:var(--border);">
                
                <h6 style="font-weight:700; margin-bottom:1rem;">Spiciness Level</h6>
                <div class="d-flex gap-2 mb-3" id="bs-spicy-levels">
                    <button class="pill bs-spicy active" data-val="Mild">Mild 🌶️</button>
                    <button class="pill bs-spicy" data-val="Medium">Medium 🌶️🌶️</button>
                    <button class="pill bs-spicy" data-val="Spicy">Spicy 🌶️🌶️🌶️</button>
                </div>
                
                <div id="bs-addons-container" style="display:none">
                    <h6 style="font-weight:700; margin-bottom:1rem;">Add-ons</h6>
                    <div class="d-flex flex-column gap-2 mb-4" id="bs-addons">
                        <!-- Dynamic add-ons -->
                    </div>
                </div>
                
                <div class="d-flex align-items-center gap-3 mt-4">
                    <div class="qty-ctrl" style="background:rgba(255,255,255,0.05); padding:0.5rem; border-radius:50px;">
                        <button class="qty-btn" onclick="updateBsQty(-1)">−</button>
                        <span class="qty-num" id="bs-item-qty">1</span>
                        <button class="qty-btn" onclick="updateBsQty(1)">+</button>
                    </div>
                    <button class="btn-primary-custom flex-grow-1 justify-content-center" style="padding:0.8rem; font-size:1rem;" id="bs-add-btn">
                        Add item - ₹<span id="bs-total-price"></span>
                    </button>
                </div>
            </div>
        </div>
        `;
        document.body.insertAdjacentHTML('beforeend', html);
        bsModal = document.getElementById('itemDetailsModal');
        
        // Setup spicy toggle
        document.querySelectorAll('.bs-spicy').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.bs-spicy').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
            });
        });
        
        // Setup addons update price
        document.getElementById('bs-addons').addEventListener('change', (e) => {
            if (e.target.classList.contains('bs-addon-cb')) {
                updateBsPrice();
            }
        });
    }

    // Populate addons
    const addonsContainer = document.getElementById('bs-addons-container');
    const addonsDiv = document.getElementById('bs-addons');
    if (addonsHTML) {
        addonsDiv.innerHTML = addonsHTML;
        addonsContainer.style.display = 'block';
    } else {
        addonsDiv.innerHTML = '';
        addonsContainer.style.display = 'none';
    }

    // Set data
    document.getElementById('bs-item-img').src = image || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=400';
    document.getElementById('bs-item-name').textContent = name;
    document.getElementById('bs-item-badge').innerHTML = isVeg ? '🟢 Veg' : '🔴 Non-Veg';
    document.getElementById('bs-item-price').textContent = `₹${price}`;
    document.getElementById('bs-item-desc').textContent = desc || 'Delicious freshly prepared dish.';
    
    // Reset selections
    document.querySelectorAll('.bs-spicy').forEach(b => b.classList.remove('active'));
    document.querySelector('.bs-spicy[data-val="Mild"]').classList.add('active');
    document.querySelectorAll('.bs-addon-cb').forEach(cb => cb.checked = false);
    document.getElementById('bs-item-qty').textContent = '1';
    
    // Store original price to element dataset
    const bsModalEl = document.getElementById('itemDetailsModal');
    bsModalEl.dataset.basePrice = price;
    bsModalEl.dataset.itemId = itemId;
    bsModalEl.dataset.itemName = name;
    bsModalEl.dataset.restId = restId;
    bsModalEl.dataset.restName = restName || 'Restaurant';
    
    // AI Suggestion Logic
    const lowerName = name.toLowerCase();
    let suggestName = "";
    let suggestPrice = 0;
    
    if (lowerName.includes("pizza")) {
        suggestName = "Chilled Coca-Cola (330ml) 🥤";
        suggestPrice = 45;
    } else if (lowerName.includes("burger")) {
        suggestName = "Crispy French Fries (M) 🍟";
        suggestPrice = 80;
    } else if (lowerName.includes("sandwich") || lowerName.includes("wrap")) {
        suggestName = "Fresh Mango Juice 🥤";
        suggestPrice = 70;
    } else if (lowerName.includes("biryani") || lowerName.includes("rice")) {
        suggestName = "Cold Raita & Salan Bowl 🥣";
        suggestPrice = 30;
    } else {
        suggestName = "Chilled Coca-Cola (330ml) 🥤";
        suggestPrice = 45;
    }
    
    updateBsPrice();
    
    // Set add btn click
    const addBtn = document.getElementById('bs-add-btn');
    addBtn.onclick = (e) => {
        const q = parseInt(document.getElementById('bs-item-qty').textContent);
        const finalPrice = parseFloat(document.getElementById('bs-total-price').textContent) / q;
        const spicy = document.querySelector('.bs-spicy.active').dataset.val;
        const addons = Array.from(document.querySelectorAll('.bs-addon-cb:checked')).map(cb => cb.value).join(', ');
        
        const optionsStr = `Spicy: ${spicy}${addons ? ' | Add-ons: ' + addons : ''}`;
        
        const isTableMode = typeof addToTableCart === 'function';
        
        // We use the dynamic finalPrice and options
        // Check if addToTableCart exists (table mode) or addToCart (delivery mode)
        if (isTableMode) {
            addToTableCart(itemId, name, finalPrice, optionsStr);
            triggerFlyingCart(e, itemId);
        } else if (typeof addToCart === 'function') {
            addToCart(itemId, name, finalPrice, restId, optionsStr, restName);
            triggerFlyingCart(e, itemId); // Add triggerFlyingCart here too
        }
        
        bootstrap.Offcanvas.getInstance(bsModal).hide();
        
        // Show AI Recommendation Modal
        setTimeout(() => {
            showAiSuggestionModal(name, suggestName, suggestPrice, restId, restName, isTableMode);
        }, 600);
    };

    const bs = new bootstrap.Offcanvas(bsModal);
    bs.show();
}

function updateBsQty(delta) {
    const el = document.getElementById('bs-item-qty');
    let q = parseInt(el.textContent) + delta;
    if (q < 1) q = 1;
    if (q > 20) q = 20;
    el.textContent = q;
    updateBsPrice();
}

function updateBsPrice() {
    const bsModalEl = document.getElementById('itemDetailsModal');
    const base = parseFloat(bsModalEl.dataset.basePrice || 0);
    const q = parseInt(document.getElementById('bs-item-qty').textContent);
    
    let addonPrice = 0;
    document.querySelectorAll('.bs-addon-cb:checked').forEach(cb => {
        addonPrice += parseFloat(cb.dataset.price);
    });
    
    const total = (base + addonPrice) * q;
    document.getElementById('bs-total-price').textContent = total;
}

function triggerFlyingCart(e, itemId) {
    if (!e || !e.target) return;
    
    // Create element
    const rect = e.target.getBoundingClientRect();
    const target = document.getElementById('cart-fab') ? document.getElementById('cart-fab').getBoundingClientRect() : {left: window.innerWidth - 60, top: window.innerHeight - 60};
    
    const clone = document.createElement('div');
    clone.className = 'flying-cart-item';
    clone.innerHTML = '🛒';
    clone.style.left = `${rect.left}px`;
    clone.style.top = `${rect.top}px`;
    clone.style.background = 'var(--primary)';
    clone.style.display = 'flex';
    clone.style.alignItems = 'center';
    clone.style.justifyContent = 'center';
    clone.style.fontSize = '24px';
    
    document.body.appendChild(clone);
    
    // Start animation
    setTimeout(() => {
        clone.style.left = `${target.left}px`;
        clone.style.top = `${target.top}px`;
        clone.style.transform = 'scale(0.2)';
        clone.style.opacity = '0';
    }, 10);
    
    // Cleanup
    setTimeout(() => {
        clone.remove();
        const badge = document.getElementById('cart-badge');
        if (badge) {
            badge.style.transform = 'scale(1.5)';
            setTimeout(() => badge.style.transform = 'scale(1)', 200);
        }
    }, 800);
}

function showAiSuggestionModal(itemName, suggestName, suggestPrice, restId, restName, isTableMode) {
    const oldModal = document.getElementById('aiSuggestionModal');
    if (oldModal) oldModal.remove();

    const html = `
    <div class="modal fade" id="aiSuggestionModal" tabindex="-1" aria-hidden="true" style="backdrop-filter: blur(5px);">
        <div class="modal-dialog modal-dialog-centered">
            <div class="modal-content" style="background: var(--card-bg); border: 1px solid var(--border); border-radius: 20px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.15);">
                <div class="modal-body text-center p-4">
                    <div style="font-size: 3rem; margin-bottom: 1rem; animation: pulse 2s infinite;">✨</div>
                    <h4 style="font-weight: 800; color: var(--text-primary); margin-bottom: 0.5rem;">Pair Your Meal! 🍕</h4>
                    <p style="color: var(--text-muted); font-size: 0.95rem; margin-bottom: 1.5rem;">
                        Would you like to pair your delicious <strong>${itemName}</strong> with a cold, refreshing <strong>${suggestName}</strong> for just <strong class="text-success">₹${suggestPrice}</strong>?
                    </p>
                    <div class="d-flex gap-2">
                        <button type="button" class="btn btn-outline-custom flex-grow-1" data-bs-dismiss="modal" style="border-radius: 50px; padding: 0.8rem; border-color: var(--border); color: var(--text-primary)">No, Thanks</button>
                        <button type="button" class="btn btn-primary-custom flex-grow-1" id="ai-suggestion-confirm-btn" style="border-radius: 50px; padding: 0.8rem;">Yes, Add it! 🥤</button>
                    </div>
                </div>
            </div>
        </div>
    </div>
    `;
    document.body.insertAdjacentHTML('beforeend', html);
    const modalEl = document.getElementById('aiSuggestionModal');
    const modal = new bootstrap.Modal(modalEl);
    
    document.getElementById('ai-suggestion-confirm-btn').onclick = () => {
        const mockItemId = "mock_suggest_" + Math.random().toString(36).substr(2, 9);
        if (isTableMode) {
            addToTableCart(mockItemId, suggestName, suggestPrice, "AI Suggestion");
        } else {
            addToCart(mockItemId, suggestName, suggestPrice, restId, "AI Suggestion", restName);
        }
        modal.hide();
    };
    
    modal.show();
}


