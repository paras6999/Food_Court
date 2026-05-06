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
  return t ? { 'Content-Type': 'application/json', 'Authorization': `Bearer ${t}` }
           : { 'Content-Type': 'application/json' };
}

// ── Fetch wrappers ──────────────────────────────────────
async function apiFetch(path, withAuth = false) {
  const headers = withAuth ? authHeaders() : { 'Content-Type': 'application/json' };
  try {
    const r = await fetch(API + path, { headers });
    return await r.json();
  } catch (err) {
    console.error('Fetch error:', err);
    return { error: 'Network error' };
  }
}

async function apiPost(path, body, withAuth = false) {
  const headers = withAuth ? authHeaders() : { 'Content-Type': 'application/json' };
  try {
    const r = await fetch(API + path, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
    return await r.json();
  } catch (err) {
    return { error: 'Network error' };
  }
}

async function apiPut(path, body) {
  try {
    const r = await fetch(API + path, {
      method: 'PUT',
      headers: authHeaders(),
      body: JSON.stringify(body)
    });
    return await r.json();
  } catch (err) {
    return { error: 'Network error' };
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
    const navUser = document.getElementById('nav-user');
    const navLogin = document.getElementById('nav-login');
    const navReg = document.getElementById('nav-register');
    const navOrders = document.getElementById('nav-orders');
    if (navUser) { navUser.style.display = ''; document.getElementById('nav-username').textContent = name; }
    if (navLogin) navLogin.style.display = 'none';
    if (navReg) navReg.style.display = 'none';
    if (navOrders) navOrders.style.display = '';
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
}

function toggleTheme(e) {
    if (e.target.checked) {
        document.body.classList.add('light-theme');
        localStorage.setItem('fc-theme', 'light');
    } else {
        document.body.classList.remove('light-theme');
        localStorage.setItem('fc-theme', 'dark');
    }
}

// Ensure theme is applied right away when script loads
initTheme();

// ── Item Details Bottom Sheet ───────────────────────────
function openItemDetails(itemId, name, price, restId, restName, image, desc, isVeg) {
    let bsModal = document.getElementById('itemDetailsModal');
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
                
                <h6 style="font-weight:700; margin-bottom:1rem;">Add-ons</h6>
                <div class="d-flex flex-column gap-2 mb-4" id="bs-addons">
                    <label class="d-flex justify-content-between align-items-center p-2" style="background:rgba(255,255,255,0.05); border-radius:8px; cursor:pointer;">
                        <span><input type="checkbox" class="bs-addon-cb me-2" value="Extra Cheese" data-price="30"> Extra Cheese</span>
                        <span style="color:var(--text-muted); font-size:0.85rem;">+₹30</span>
                    </label>
                    <label class="d-flex justify-content-between align-items-center p-2" style="background:rgba(255,255,255,0.05); border-radius:8px; cursor:pointer;">
                        <span><input type="checkbox" class="bs-addon-cb me-2" value="Double Patty" data-price="50"> Double Patty</span>
                        <span style="color:var(--text-muted); font-size:0.85rem;">+₹50</span>
                    </label>
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
        document.querySelectorAll('.bs-addon-cb').forEach(cb => {
            cb.addEventListener('change', updateBsPrice);
        });
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
    
    updateBsPrice();
    
    // Set add btn click
    const addBtn = document.getElementById('bs-add-btn');
    addBtn.onclick = (e) => {
        const q = parseInt(document.getElementById('bs-item-qty').textContent);
        const finalPrice = parseFloat(document.getElementById('bs-total-price').textContent) / q;
        const spicy = document.querySelector('.bs-spicy.active').dataset.val;
        const addons = Array.from(document.querySelectorAll('.bs-addon-cb:checked')).map(cb => cb.value).join(', ');
        
        const optionsStr = `Spicy: ${spicy}${addons ? ' | Add-ons: ' + addons : ''}`;
        
        // We use the dynamic finalPrice and options
        // Check if addToTableCart exists (table mode) or addToCart (delivery mode)
        if (typeof addToTableCart === 'function') {
            addToTableCart(itemId, name, finalPrice, optionsStr);
            triggerFlyingCart(e, itemId);
        } else if (typeof addToCart === 'function') {
            addToCart(itemId, name, finalPrice, restId, optionsStr, restName);
            triggerFlyingCart(e, itemId); // Add triggerFlyingCart here too
        }
        
        bootstrap.Offcanvas.getInstance(bsModal).hide();
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


