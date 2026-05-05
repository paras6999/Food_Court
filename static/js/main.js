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
