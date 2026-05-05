/* ════════════════════════════════════════════════════════
   restaurant.js — Dashboard, menu CRUD, order management,
                    table & QR code management
   ════════════════════════════════════════════════════════ */

// ── Dashboard Stats ─────────────────────────────────────
async function loadDashboard() {
  const data = await apiFetch('/api/restaurant/dashboard', true);
  if (data.error) { showToast(data.error, 'error'); return; }
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('s-total', data.total_orders ?? '—');
  set('s-revenue', `₹${(data.revenue || 0).toFixed(0)}`);
  set('s-pending', data.pending ?? '—');
  set('s-preparing', data.preparing ?? '—');

  // Load current offer to input if it exists
  const offerInput = document.getElementById('offer-input');
  if (offerInput && data.restaurant) {
    offerInput.value = data.restaurant.offer || '';
  }
}

// ── Chart.js Revenue Graph ──────────────────────────────
let revenueChart = null;

async function loadRevenueGraph() {
  const data = await apiFetch('/api/restaurant/revenue_data', true);
  if (!data || data.error) return;

  const ctx = document.getElementById('revenueChart');
  if (!ctx) return;

  if (revenueChart) {
    revenueChart.destroy();
  }

  revenueChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.labels.map(l => l.substring(5)), // Show MM-DD
      datasets: [{
        label: 'Revenue (₹)',
        data: data.data,
        backgroundColor: 'rgba(255, 107, 53, 0.5)',
        borderColor: 'rgba(255, 107, 53, 1)',
        borderWidth: 1,
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#8892a4' } },
        x: { grid: { display: false }, ticks: { color: '#8892a4' } }
      }
    }
  });
}

// ── Orders ──────────────────────────────────────────────
let previousOrderCount = null;

async function loadOrders() {
  const filter = document.getElementById('status-filter')?.value || '';
  const url = '/api/restaurant/orders' + (filter ? `?status=${filter}` : '');
  const orders = await apiFetch(url, true);
  const tbody = document.getElementById('orders-tbody');

  // Detect new pending orders for Toast notification + sound
  if (Array.isArray(orders)) {
    const currentPending = orders.filter(o => o.status === 'pending').length;
    if (previousOrderCount !== null && currentPending > previousOrderCount) {
      const hasDineIn = orders.some(o => o.status === 'pending' && o.table_number);
      showToast(hasDineIn ? '🔔 New dine-in order from table!' : '🔔 New order received!', 'success');
      // Play notification sound
      try { document.getElementById('notification-sound')?.play(); } catch(e) {}
      loadDashboard(); // update top stats
    }
    previousOrderCount = currentPending;
  }

  if (!tbody) return;

  if (!Array.isArray(orders) || orders.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center" style="color:var(--text-muted);padding:2rem">No orders found</td></tr>';
    return;
  }

  tbody.innerHTML = orders.map(o => {
    const items = o.items.map(i => `${i.quantity}× ${i.name}`).join(', ');
    const date = new Date(o.created_at).toLocaleString();
    const shortId = o._id.slice(-6).toUpperCase();
    const isDineIn = o.order_type === 'dine-in' || o.table_number;
    const isServiceReq = o.order_type === 'service-request';

    // Build table/type column
    let tableCol;
    if (isServiceReq) {
      const reqLabels = { waiter: '🙋 Waiter', water: '💧 Water', bill: '🧾 Bill', cleanup: '🧹 Cleanup' };
      tableCol = `<div class="table-badge-order service-req">
        <i class="bi bi-bell-fill"></i> ${reqLabels[o.request_type] || 'Service'}
      </div>
      ${o.table_number ? `<div class="table-num-badge mt-1">Table ${o.table_number}</div>` : ''}`;
    } else if (isDineIn) {
      tableCol = `<div class="table-badge-order dine-in">
        <i class="bi bi-geo-alt-fill"></i> Table ${o.table_number}
      </div>`;
    } else {
      tableCol = `<div class="table-badge-order delivery">
        <i class="bi bi-truck"></i> Delivery
      </div>`;
    }

    const actions = buildOrderActions(o._id, o.status);
    return `
    <tr class="${isDineIn && o.status === 'pending' ? 'dine-in-highlight' : ''}">
      <td><code style="color:var(--primary)">#${shortId}</code></td>
      <td>${tableCol}</td>
      <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${items}">${isServiceReq ? '<em style="color:var(--text-muted)">Service Request</em>' : items}</td>
      <td style="color:var(--primary);font-weight:700">${isServiceReq ? '—' : '₹' + o.total_price}</td>
      <td><span class="status-badge status-${o.status}">${o.status}</span></td>
      <td style="font-size:.82rem;color:var(--text-muted)">${date}</td>
      <td>${actions}</td>
    </tr>`;
  }).join('');
}

function buildOrderActions(orderId, status) {
  const btn = (label, newStatus, icon) =>
    `<button class="btn-outline-custom" style="padding:.3rem .75rem;font-size:.78rem;margin:.15rem"
      onclick="updateOrderStatus('${orderId}','${newStatus}')"><i class="bi ${icon}"></i> ${label}</button>`;

  switch (status) {
    case 'pending': return btn('Accept', 'accepted', 'bi-check-circle') + btn('Reject', 'rejected', 'bi-x-circle');
    case 'accepted': return btn('Preparing', 'preparing', 'bi-fire');
    case 'preparing': return btn('Ready', 'ready', 'bi-bell');
    case 'ready': return btn('Delivered', 'delivered', 'bi-truck');
    default: return `<span style="color:var(--text-muted);font-size:.82rem">${status}</span>`;
  }
}

async function updateOrderStatus(orderId, newStatus) {
  const res = await apiPut(`/api/order/status/${orderId}`, { status: newStatus });
  if (res.message) {
    showToast(`Order marked as ${newStatus} ✅`, 'success');
    loadOrders();
    loadDashboard();
  } else {
    showToast(res.error || 'Update failed', 'error');
  }
}

// ── Menu ────────────────────────────────────────────────
let menuItems = [];

async function loadMenu() {
  const data = await apiFetch('/api/restaurant/menu', true);
  const grid = document.getElementById('menu-grid');
  if (!grid) return;
  menuItems = Array.isArray(data) ? data : [];

  if (menuItems.length === 0) {
    grid.innerHTML = `<div class="col-12"><div class="empty-state"><div class="icon">🍽️</div><p>No menu items yet. Add one!</p></div></div>`;
    return;
  }

  grid.innerHTML = menuItems.map(item => `
    <div class="col-12 col-md-6">
      <div class="menu-card">
        <img src="${item.image || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=200'}" alt="${item.name}"
             onerror="this.src='https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=200'">
        <div class="details">
          <div class="name">${item.name}</div>
          <div class="price">₹${item.price}</div>
          <small style="color:${item.available ? '#20c997' : 'var(--accent)'}">
            ${item.available ? '✅ Available' : '❌ Unavailable'}
          </small>
        </div>
        <div class="d-flex flex-column gap-2 ms-auto">
          <button class="btn-outline-custom" style="padding:.3rem .7rem;font-size:.78rem" onclick="openEditModal('${item._id}')">
            <i class="bi bi-pencil"></i> Edit
          </button>
          <button class="btn-outline-custom" style="padding:.3rem .7rem;font-size:.78rem;border-color:var(--accent);color:var(--accent)"
            onclick="deleteMenuItem('${item._id}','${item.name.replace(/'/g, "\\'")}')">
            <i class="bi bi-trash"></i> Del
          </button>
        </div>
      </div>
    </div>
  `).join('');
}

let menuModal = null;

function openAddModal() {
  document.getElementById('modal-title').textContent = 'Add Menu Item';
  document.getElementById('edit-item-id').value = '';
  document.getElementById('item-name').value = '';
  document.getElementById('item-price').value = '';
  document.getElementById('item-available').checked = true;
  const fileInput = document.getElementById('item-image');
  if (fileInput) fileInput.value = '';
  menuModal = new bootstrap.Modal(document.getElementById('menuModal'));
  menuModal.show();
}

function openEditModal(itemId) {
  const item = menuItems.find(i => i._id === itemId);
  if (!item) return;
  document.getElementById('modal-title').textContent = 'Edit Menu Item';
  document.getElementById('edit-item-id').value = item._id;
  document.getElementById('item-name').value = item.name;
  document.getElementById('item-price').value = item.price;
  document.getElementById('item-available').checked = item.available;
  menuModal = new bootstrap.Modal(document.getElementById('menuModal'));
  menuModal.show();
}

async function saveMenuItem() {
  const itemId = document.getElementById('edit-item-id').value;
  const name = document.getElementById('item-name').value.trim();
  const price = document.getElementById('item-price').value;
  const available = document.getElementById('item-available').checked;
  const imageFile = document.getElementById('item-image')?.files[0];
  const btn = document.getElementById('save-item-btn');

  if (!name || !price) { showToast('Name and price are required', 'error'); return; }

  btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
  btn.disabled = true;

  // Use FormData to support optional file upload
  const fd = new FormData();
  fd.append('name', name);
  fd.append('price', price);
  fd.append('available', available);
  if (imageFile) fd.append('image', imageFile);

  const url = itemId ? `/api/menu/update/${itemId}` : '/api/menu/add';
  const method = itemId ? 'PUT' : 'POST';

  try {
    const r = await fetch(url, {
      method,
      headers: { 'Authorization': `Bearer ${getToken()}` },
      body: fd
    });
    const data = await r.json();
    if (data.message) {
      showToast(itemId ? 'Item updated ✅' : 'Item added ✅', 'success');
      if (menuModal) menuModal.hide();
      loadMenu();
    } else {
      showToast(data.error || 'Save failed', 'error');
    }
  } catch {
    showToast('Network error', 'error');
  }

  btn.innerHTML = '<i class="bi bi-check-lg"></i> Save';
  btn.disabled = false;
}

async function deleteMenuItem(itemId, name) {
  if (!confirm(`Delete "${name}"?`)) return;
  const res = await apiDelete(`/api/menu/delete/${itemId}`);
  if (res.message) { showToast('Item deleted', 'success'); loadMenu(); }
  else showToast(res.error || 'Delete failed', 'error');
}

// ── Reviews ─────────────────────────────────────────────
async function loadReviews() {
  const data = await apiFetch('/api/restaurant/dashboard', true); // fetch current restaurant id
  if (data?.error || !data?.restaurant?._id) return;

  const reviews = await apiFetch(`/api/reviews/${data.restaurant._id}`);
  const container = document.getElementById('reviews-container');
  if (!container) return;

  if (!Array.isArray(reviews) || reviews.length === 0) {
    container.innerHTML = '<div class="col-12 text-center" style="color:var(--text-muted);padding:2rem">No reviews yet. Keep delivering great food!</div>';
    return;
  }

  container.innerHTML = reviews.map(r => `
      <div class="col-12 col-md-6">
          <div class="fc-card p-3">
              <div class="d-flex justify-content-between align-items-start mb-2">
                  <strong>${r.user_name}</strong>
                  <span>${renderStars(r.rating)}</span>
              </div>
              <p class="mb-0 text-muted-custom" style="font-size:0.9rem">${r.comment || '<i>No comment provided</i>'}</p>
              <div class="mt-2 text-end" style="font-size:0.75rem;color:var(--text-muted)">
                  ${new Date(r.created_at).toLocaleDateString()}
              </div>
          </div>
      </div>
  `).join('');
}

// ── Offers ──────────────────────────────────────────────
async function saveOffer() {
  const offerText = document.getElementById('offer-input').value.trim();
  const res = await apiPost('/api/restaurant/offer', { offer: offerText }, true);

  if (res.message) {
    showToast('Offer updated successfully! 🏷️', 'success');
  } else {
    showToast(res.error || 'Failed to update offer', 'error');
  }
}


// ══════════════════════════════════════════════════════════
// TABLES & QR CODE MANAGEMENT
// ══════════════════════════════════════════════════════════

async function generateTables() {
  const countInput = document.getElementById('add-table-count');
  const count = parseInt(countInput.value) || 1;

  if (count < 1 || count > 50) {
    showToast('Enter a number between 1 and 50', 'error');
    return;
  }

  const res = await apiPost('/api/restaurant/tables', { count }, true);
  if (res.message) {
    showToast(`${count} table(s) created! 🪑`, 'success');
    countInput.value = 1;
    loadTables();
  } else {
    showToast(res.error || 'Failed to create tables', 'error');
  }
}

async function loadTables() {
  const grid = document.getElementById('tables-grid');
  if (!grid) return;

  const tables = await apiFetch('/api/restaurant/tables', true);

  if (!Array.isArray(tables) || tables.length === 0) {
    grid.innerHTML = `<div class="col-12"><div class="empty-state"><div class="icon">🪑</div><p>No tables yet. Generate some above!</p></div></div>`;
    return;
  }

  const baseUrl = window.location.origin;
  // Get restaurant ID from JWT
  const dashData = await apiFetch('/api/restaurant/dashboard', true);
  const restId = dashData?.restaurant?._id;

  if (!restId) {
    grid.innerHTML = '<div class="col-12 text-center" style="color:var(--text-muted)">Failed to load restaurant info</div>';
    return;
  }

  grid.innerHTML = tables.map(t => {
    const qrUrl = `${baseUrl}/customer_table.html?restaurant=${restId}&table=${t.table_number}`;
    const statusClass = t.status === 'occupied' ? 'occupied' : 'available';
    return `
      <div class="col-6 col-md-4 col-lg-3">
        <div class="qr-table-card ${statusClass}">
          <div class="qr-table-header">
            <div class="qr-table-num">Table ${t.table_number}</div>
            <span class="qr-table-status ${statusClass}">
              ${t.status === 'occupied' ? `🟠 ${t.active_orders} order(s)` : '🟢 Available'}
            </span>
          </div>
          <div class="qr-code-container" id="qr-${t.table_number}"></div>
          <div class="qr-table-actions">
            <button class="btn-outline-custom" style="padding:.3rem .6rem;font-size:.75rem;flex:1"
              onclick="copyQrUrl('${qrUrl}')">
              <i class="bi bi-clipboard"></i> Copy URL
            </button>
            <button class="btn-outline-custom" style="padding:.3rem .6rem;font-size:.75rem;border-color:var(--accent);color:var(--accent)"
              onclick="deleteTable(${t.table_number})">
              <i class="bi bi-trash"></i>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Generate QR codes after DOM update
  setTimeout(() => {
    tables.forEach(t => {
      const qrUrl = `${baseUrl}/customer_table.html?restaurant=${restId}&table=${t.table_number}`;
      const container = document.getElementById(`qr-${t.table_number}`);
      if (container && container.childElementCount === 0) {
        try {
          new QRCode(container, {
            text: qrUrl,
            width: 140,
            height: 140,
            colorDark: '#ff6b35',
            colorLight: '#1a1a2e',
            correctLevel: QRCode.CorrectLevel.M
          });
        } catch(e) {
          container.innerHTML = `<div style="padding:1rem;font-size:0.8rem;color:var(--text-muted)">QR: ${qrUrl}</div>`;
        }
      }
    });
  }, 100);
}

function copyQrUrl(url) {
  navigator.clipboard.writeText(url).then(() => {
    showToast('QR URL copied to clipboard! 📋', 'success');
  }).catch(() => {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = url;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('QR URL copied! 📋', 'success');
  });
}

async function deleteTable(tableNumber) {
  if (!confirm(`Delete Table ${tableNumber}? This cannot be undone.`)) return;
  const res = await apiDelete(`/api/restaurant/table/${tableNumber}`);
  if (res.message) {
    showToast(`Table ${tableNumber} deleted`, 'success');
    loadTables();
  } else {
    showToast(res.error || 'Delete failed', 'error');
  }
}
