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
  const discountInput = document.getElementById('discount-pct-input');
  const couponToggle = document.getElementById('coupon-toggle');
  if (data.restaurant) {
    if (offerInput) offerInput.value = data.restaurant.offer || '';
    if (discountInput) discountInput.value = data.restaurant.discount_pct || '';
    if (couponToggle) couponToggle.checked = data.restaurant.allow_coupons !== false; // Default to true
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

// ── Top Dishes Pie Chart ────────────────────────────────
let dishPieChart = null;
let dishPieMode = 'quantity'; // 'quantity' or 'revenue'
let allDishData = [];

async function loadTopDishesChart() {
  const data = await apiFetch('/api/restaurant/top_dishes', true);
  if (!data || data.error || !Array.isArray(data)) return;
  allDishData = data;
  renderDishPieChart();
  renderDishTable();
}

function setDishPieMode(mode) {
  dishPieMode = mode;
  document.getElementById('pie-mode-qty').classList.toggle('active', mode === 'quantity');
  document.getElementById('pie-mode-rev').classList.toggle('active', mode === 'revenue');
  renderDishPieChart();
  renderDishTable();
}

function renderDishTable() {
  const tbody = document.getElementById('top-items-table-body');
  if (!tbody || allDishData.length === 0) {
    if(tbody) tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">No items sold yet.</td></tr>';
    return;
  }
  
  // Sort based on current mode
  const sortedData = [...allDishData].sort((a, b) => {
    if (dishPieMode === 'quantity') {
      return b.quantity_sold - a.quantity_sold;
    } else {
      return b.revenue - a.revenue;
    }
  });

  tbody.innerHTML = sortedData.map((d, index) => {
    const isTop = index < 3;
    const rankBadge = isTop ? `<span class="badge" style="background:var(--primary);margin-right:8px;">#${index+1}</span>` : `<span style="color:var(--text-muted);font-size:0.8rem;margin-right:12px;">#${index+1}</span>`;
    return `
      <tr>
        <td style="font-weight:${isTop ? '600' : '400'};">${rankBadge}${d.name}</td>
        <td class="text-end">${d.quantity_sold}</td>
        <td class="text-end text-success fw-bold">₹${d.revenue.toFixed(2)}</td>
      </tr>
    `;
  }).join('');
}

function renderDishPieChart() {
  const ctx = document.getElementById('dishPieChart');
  if (!ctx || allDishData.length === 0) return;

  if (dishPieChart) dishPieChart.destroy();

  const top10 = allDishData.slice(0, 10);
  const others = allDishData.slice(10);

  const labels = top10.map(d => d.name);
  let values;
  if (dishPieMode === 'quantity') {
    values = top10.map(d => d.quantity_sold);
    if (others.length > 0) {
      labels.push('Others');
      values.push(others.reduce((s, d) => s + d.quantity_sold, 0));
    }
  } else {
    values = top10.map(d => d.revenue);
    if (others.length > 0) {
      labels.push('Others');
      values.push(others.reduce((s, d) => s + d.revenue, 0));
    }
  }

  const colors = [
    '#ff6b35', '#20c997', '#0dcaf0', '#6f42c1', '#fd7e14',
    '#d63384', '#198754', '#0d6efd', '#ffc107', '#dc3545',
    '#8892a4'
  ];

  dishPieChart = new Chart(ctx, {
    type: 'pie',
    data: {
      labels: labels,
      datasets: [{
        data: values,
        backgroundColor: colors.slice(0, labels.length),
        borderColor: 'rgba(0,0,0,0.2)',
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { boxWidth: 12, font: { size: 10 } }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              const total = context.dataset.data.reduce((a, b) => a + b, 0);
              const pct = ((context.parsed / total) * 100).toFixed(1);
              if (dishPieMode === 'revenue') {
                return `${context.label}: ₹${context.parsed.toFixed(0)} (${pct}%)`;
              }
              return `${context.label}: ${context.parsed} sold (${pct}%)`;
            }
          }
        }
      }
    }
  });
}

// ── Assistance Requests ─────────────────────────────────
async function loadAssistance() {
  const data = await apiFetch('/api/restaurant/assistance', true);
  const container = document.getElementById('assistance-list');
  if (!container) return;

  if (!Array.isArray(data) || data.length === 0) {
    container.innerHTML = '<div class="text-center py-4" style="color:var(--text-muted)">No assistance requests right now. 🎉</div>';
    return;
  }

  const reqLabels = { waiter: '🙋 Call Waiter', water: '💧 Water', bill: '🧾 Bill', cleanup: '🧹 Cleanup' };

  container.innerHTML = data.map(r => {
    const time = new Date(r.created_at).toLocaleString();
    const isPending = r.status === 'pending';
    return `
    <div class="fc-card p-3 mb-2" style="border-left: 3px solid ${isPending ? 'var(--primary)' : '#20c997'};">
      <div class="d-flex justify-content-between align-items-center">
        <div>
          <div style="font-weight:700; font-size:0.95rem;">
            <span class="badge ${isPending ? 'bg-warning text-dark' : 'bg-success'}" style="font-size:0.75rem; margin-right:0.5rem;">
              ${isPending ? 'Pending' : 'Resolved'}
            </span>
            ${reqLabels[r.request_type] || r.request_type}
          </div>
          <div style="font-size:0.85rem; color:var(--text-muted); margin-top:0.3rem;">
            <i class="bi bi-geo-alt-fill" style="color:var(--primary)"></i> Table ${r.table_number}
            <span style="margin-left:1rem;"><i class="bi bi-clock"></i> ${time}</span>
          </div>
        </div>
        ${isPending ? `<button class="btn-primary-custom" style="padding:0.4rem 1rem; font-size:0.85rem;" onclick="resolveAssistance('${r._id}')">
          <i class="bi bi-check-circle"></i> Resolve
        </button>` : ''}
      </div>
    </div>`;
  }).join('');
}

async function resolveAssistance(requestId) {
  const res = await apiPut(`/api/restaurant/assistance/${requestId}/resolve`, {});
  if (res.message) {
    showToast('Assistance request resolved ✅', 'success');
    loadAssistance();
  } else {
    showToast(res.error || 'Failed to resolve', 'error');
  }
}

// ── Orders ──────────────────────────────────────────────
let previousOrderCount = null;
let currentOrderView = 'table'; // 'table' or 'kanban'

function setOrderView(view) {
    currentOrderView = view;
    document.getElementById('btn-view-table').classList.toggle('active', view === 'table');
    document.getElementById('btn-view-kanban').classList.toggle('active', view === 'kanban');
    
    // Switch table-responsive parent instead of the table element itself to hide the whole wrapper
    document.querySelector('.table-responsive').style.display = view === 'table' ? '' : 'none';
    document.getElementById('orders-kanban-view').style.display = view === 'kanban' ? '' : 'none';
    
    loadOrders();
}

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

    const isOffline = o.order_type === 'offline';

    // Build table/type column
    let tableCol;
    if (isServiceReq) {
      const reqLabels = { waiter: '🙋 Waiter', water: '💧 Water', bill: '🧾 Bill', cleanup: '🧹 Cleanup' };
      tableCol = `<div class="table-badge-order service-req">
        <i class="bi bi-bell-fill"></i> ${reqLabels[o.request_type] || 'Service'}
      </div>
      ${o.table_number ? `<div class="table-num-badge mt-1">Table ${o.table_number}</div>` : ''}`;
    } else if (isOffline) {
      tableCol = `<div class="table-badge-order" style="background:var(--primary);color:#fff">
        <i class="bi bi-shop"></i> POS (Offline)
      </div>`;
    } else if (isDineIn) {
      tableCol = `<div class="table-badge-order dine-in">
        <i class="bi bi-geo-alt-fill"></i> Table ${o.table_number}
      </div>`;
    } else {
      tableCol = `<div class="table-badge-order delivery">
        <i class="bi bi-truck"></i> Delivery
      </div>`;
    }

    const actions = buildOrderActions(o);
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
  
  // -- KANBAN VIEW POPULATION --
  const kPending = document.getElementById('kb-pending-col');
  const kPrep = document.getElementById('kb-prep-col');
  const kDone = document.getElementById('kb-done-col');
  
  if(kPending) {
      let pendingOrders = orders.filter(o => o.status === 'pending' || o.status === 'accepted');
      let prepOrders = orders.filter(o => o.status === 'preparing' || o.status === 'ready');
      let doneOrders = orders.filter(o => o.status === 'delivered' || o.status === 'rejected');
      
      document.getElementById('kb-pending-count').textContent = pendingOrders.length;
      document.getElementById('kb-prep-count').textContent = prepOrders.length;
      document.getElementById('kb-done-count').textContent = doneOrders.length;
      
      const renderKanbanCard = (o) => {
        const items = o.items.map(i => `${i.quantity}× ${i.name}`).join(', ');
        const date = new Date(o.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        const shortId = o._id.slice(-6).toUpperCase();
        const isDineIn = o.order_type === 'dine-in' || o.table_number;
        const isServiceReq = o.order_type === 'service-request';
        
        const isOffline = o.order_type === 'offline';
        
        let header = isServiceReq ? '🙋 Service' : (isOffline ? '🧑‍🍳 POS (Offline)' : (isDineIn ? `🪑 Table ${o.table_number}` : '🚚 Delivery'));
        let actions = buildOrderActions(o);
        
        return `<div class="fc-card p-2 shadow-sm mb-2" style="border-left: 3px solid ${(isDineIn||isOffline)?'var(--primary)':'var(--text-muted)'}; background: var(--surface)">
            <div class="d-flex justify-content-between align-items-center mb-1">
                <span class="badge ${isDineIn ? 'bg-primary' : 'bg-secondary'}">${header}</span>
                <small style="color:var(--text-muted)">${date}</small>
            </div>
            <div style="font-size:0.85rem; font-weight: 600; margin-bottom: 4px;">#${shortId} <span style="float:right; color:var(--primary)">${isServiceReq ? '' : '₹' + o.total_price}</span></div>
            <div style="font-size:0.8rem; color:var(--text-muted); margin-bottom: 8px; line-height: 1.3;">${isServiceReq ? o.request_type : items}</div>
            <div class="d-flex flex-wrap gap-1">${actions}</div>
        </div>`;
      };
      
      kPending.innerHTML = pendingOrders.map(renderKanbanCard).join('');
      kPrep.innerHTML = prepOrders.map(renderKanbanCard).join('');
      kDone.innerHTML = doneOrders.map(renderKanbanCard).join('');
  }
}

function buildOrderActions(o) {
  const btn = (label, newStatus, icon) =>
    `<button class="btn-outline-custom" style="padding:.3rem .75rem;font-size:.78rem;margin:.15rem"
      onclick="updateOrderStatus('${o._id}','${newStatus}')"><i class="bi ${icon}"></i> ${label}</button>`;

  const billBtn = (icon, label, action) => 
    `<button class="btn-outline-custom" style="padding:.3rem .75rem;font-size:.78rem;margin:.15rem; border-color: #20c997; color: #20c997"
      onclick="${action}"><i class="bi ${icon}"></i> ${label}</button>`;

  const wpMsg = encodeURIComponent(
    `*🧾 Invoice from ${localStorage.getItem('fc_name') || 'FoodCourt'}*\n` +
    `*Order ID:* ${o._id.slice(-6).toUpperCase()}\n` +
    `*Date:* ${new Date(o.created_at).toLocaleTimeString()}\n\n` +
    o.items.map(i => `▪ ${i.quantity}x ${i.name} - ₹${i.price * i.quantity}`).join('\n') +
    `\n\n*Total:* ₹${o.total_price}\n\n` +
    `*View Receipt:* ${window.location.origin}/bill/${o._id}`
  );

  let actions = '';
  switch (o.status) {
    case 'pending': actions = btn('Accept', 'accepted', 'bi-check-circle') + btn('Reject', 'rejected', 'bi-x-circle'); break;
    case 'accepted': actions = btn('Preparing', 'preparing', 'bi-fire'); break;
    case 'preparing': actions = btn('Ready', 'ready', 'bi-bell'); break;
    case 'ready': actions = btn('Delivered', 'delivered', 'bi-truck'); break;
    default: actions = `<span style="color:var(--text-muted);font-size:.82rem">${o.status}</span>`; break;
  }

  // If order is ready or delivered, show billing options
  if (o.status === 'ready' || o.status === 'delivered') {
    if (o.order_type !== 'service-request') {
      const waNumber = o.customer_mobile ? (o.customer_mobile.startsWith('+') ? o.customer_mobile.replace('+', '') : '91' + o.customer_mobile) : '';
      actions += `<br>` + billBtn('bi-printer', 'Print', `window.open('/bill/${o._id}', '_blank')`);
      actions += billBtn('bi-whatsapp', 'WhatsApp', `window.open('https://wa.me/${waNumber}?text=${wpMsg}', '_blank')`);
    }
  }
  return actions;
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
          <div class="mt-2 d-flex align-items-center gap-2">
            <label class="theme-switch" style="transform: scale(0.7); margin: 0; transform-origin: left">
              <input type="checkbox" onchange="toggleItemAvailability('${item._id}', this.checked)" ${item.available ? 'checked' : ''}>
              <div class="slider round"></div>
            </label>
            <small style="color:${item.available ? '#20c997' : 'var(--text-muted)'}" id="avail-label-${item._id}">
              ${item.available ? 'Available' : 'Out of Stock'}
            </small>
          </div>
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
  const addonsEl = document.getElementById('item-addons');
  if (addonsEl) addonsEl.value = '';
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
  const addonsEl = document.getElementById('item-addons');
  if (addonsEl) addonsEl.value = item.addons || '';
  menuModal = new bootstrap.Modal(document.getElementById('menuModal'));
  menuModal.show();
}

async function saveMenuItem() {
  const itemId = document.getElementById('edit-item-id').value;
  const name = document.getElementById('item-name').value.trim();
  const price = document.getElementById('item-price').value;
  const available = document.getElementById('item-available').checked;
  const imageFile = document.getElementById('item-image')?.files[0];
  const addons = document.getElementById('item-addons')?.value.trim() || '';
  const btn = document.getElementById('save-item-btn');

  if (!name || !price) { showToast('Name and price are required', 'error'); return; }

  btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
  btn.disabled = true;

  // Use FormData to support optional file upload
  const fd = new FormData();
  fd.append('name', name);
  fd.append('price', price);
  fd.append('available', available);
  fd.append('addons', addons);
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

async function toggleItemAvailability(itemId, isAvailable) {
  const item = menuItems.find(i => i._id === itemId);
  if (!item) return;
  
  // Use FormData so we match the backend format for /api/menu/update
  const fd = new FormData();
  fd.append('name', item.name);
  fd.append('price', item.price);
  fd.append('available', isAvailable);

  const res = await fetch(`/api/menu/update/${itemId}`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${getToken()}` },
      body: fd
  });
  const data = await res.json();
  
  if (data.message) {
      showToast(isAvailable ? 'Item marked Available' : 'Item marked Out of Stock', 'success');
      item.available = isAvailable;
      const label = document.getElementById(`avail-label-${itemId}`);
      if(label) {
          label.textContent = isAvailable ? 'Available' : 'Out of Stock';
          label.style.color = isAvailable ? '#20c997' : 'var(--text-muted)';
      }
  } else {
      showToast(data.error || 'Failed to update stock', 'error');
      loadMenu(); // revert UI if failed
  }
}

// ── Reviews ─────────────────────────────────────────────
async function loadReviews() {
  const container = document.getElementById('reviews-container');
  if (!container) return;

  const data = await apiFetch('/api/restaurant/dashboard', true); 
  if (data?.error || !data?.restaurant?._id) {
    container.innerHTML = '<div class="col-12 text-center text-danger">Failed to load restaurant profile.</div>';
    return;
  }

  const reviews = await apiFetch(`/api/reviews/${data.restaurant._id}`);
  
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
  const discountPct = document.getElementById('discount-pct-input').value.trim();
  const allowCoupons = document.getElementById('coupon-toggle').checked;
  
  const res = await apiPost('/api/restaurant/offer', { 
    offer: offerText, 
    discount_pct: discountPct,
    allow_coupons: allowCoupons
  }, true);

  if (res.message) {
    showToast('Offer updated successfully! 🏷️', 'success');
  } else {
    showToast(res.error || 'Failed to update offer', 'error');
  }
}

function setQuickOffer(text, pct) {
  document.getElementById('offer-input').value = text;
  document.getElementById('discount-pct-input').value = pct;
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
          <div class="qr-table-actions d-flex flex-wrap gap-2">
            <button class="btn-outline-custom" style="padding:.3rem .6rem;font-size:.75rem;flex:1"
              onclick="copyQrUrl('${qrUrl}')">
              <i class="bi bi-clipboard"></i> Copy URL
            </button>
            <button class="btn-outline-custom" style="padding:.3rem .6rem;font-size:.75rem;flex:1;border-color:var(--accent);color:var(--accent)"
              onclick="deleteTable(${t.table_number})">
              <i class="bi bi-trash"></i>
            </button>
            ${t.status === 'occupied' ? `<button class="btn-outline-custom w-100 mt-2" style="padding:.3rem .6rem;font-size:.75rem;border-color:#20c997;color:#20c997" onclick="generateTableBill(${t.table_number})"><i class="bi bi-receipt"></i> Generate Final Bill</button>` : ''}
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

let currentBillTable = null;

async function generateTableBill(tableNumber) {
    const res = await apiFetch(`/api/restaurant/table/${tableNumber}/bill`, true);
    if (res.error) {
        showToast(res.error, 'error');
        return;
    }

    currentBillTable = tableNumber;
    document.getElementById('bill-table-num').textContent = tableNumber;
    
    const tbody = document.getElementById('table-bill-items');
    if (!res.items || res.items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">No items</td></tr>';
    } else {
        tbody.innerHTML = res.items.map(i => `
            <tr>
                <td>${i.name}</td>
                <td>${i.quantity}</td>
                <td class="text-end">₹${i.price * i.quantity}</td>
            </tr>
        `).join('');
    }

    document.getElementById('table-bill-discount').textContent = `-₹${res.total_discount.toFixed(2)}`;
    document.getElementById('table-bill-total').textContent = `₹${(res.total_price - res.total_discount).toFixed(2)}`;
    
    const btn = document.getElementById('table-bill-pay-btn');
    btn.onclick = () => clearTable(tableNumber);
    
    const modal = new bootstrap.Modal(document.getElementById('tableBillModal'));
    modal.show();
}

async function clearTable(tableNumber) {
    if (!confirm(`Are you sure you want to mark Table ${tableNumber} as paid and clear it?`)) return;
    
    const btn = document.getElementById('table-bill-pay-btn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Processing...';
    
    const res = await apiPost(`/api/restaurant/table/${tableNumber}/clear`, {}, true);
    if (res.message) {
        showToast(`Table ${tableNumber} cleared successfully! 🧾`, 'success');
        const modal = bootstrap.Modal.getInstance(document.getElementById('tableBillModal'));
        if (modal) modal.hide();
        loadTables();
        loadOrders();
        loadDashboard();
    } else {
        showToast(res.error || 'Failed to clear table', 'error');
    }
    
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-check-circle"></i> Mark as Paid & Clear Table';
}

// ══════════════════════════════════════════════════════════
// AI ANALYST CHAT
// ══════════════════════════════════════════════════════════

let aiChatOpen = false;

function toggleAIChat() {
    const panel = document.getElementById('ai-chat-panel');
    const trigger = document.getElementById('ai-chat-trigger');
    aiChatOpen = !aiChatOpen;
    if (aiChatOpen) {
        panel.style.transform = 'translateY(0)';
        trigger.style.display = 'none';
    } else {
        panel.style.transform = 'translateY(120%)';
        setTimeout(() => trigger.style.display = 'flex', 300);
    }
}

function handleAIQuery(e) {
    e.preventDefault();
    const input = document.getElementById('ai-chat-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    sendAIQuery(text);
}

// Simple markdown to HTML formatter for the AI responses
function parseMarkdown(text) {
    let html = text
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/\n/g, '<br>');
    return html;
}

async function sendAIQuery(query) {
    if (!query) {
        const input = document.getElementById('ai-chat-input');
        query = input.value.trim();
        if (!query) return;
        input.value = '';
    }
    if (!aiChatOpen) toggleAIChat();
    
    const messages = document.getElementById('ai-chat-messages');
    
    // Append user message
    const userMsg = document.createElement('div');
    userMsg.style.cssText = 'background:var(--primary); color:white; padding:0.8rem; border-radius:8px; align-self:flex-end; max-width:85%;';
    userMsg.textContent = query;
    messages.appendChild(userMsg);
    
    // Append loading indicator
    const typingMsg = document.createElement('div');
    typingMsg.style.cssText = 'background:var(--card-bg); padding:0.8rem; border-radius:8px; align-self:flex-start; border:1px solid var(--border); max-width:85%; color:var(--text-muted);';
    typingMsg.innerHTML = '<span class="spinner-grow spinner-grow-sm" role="status" aria-hidden="true"></span> Thinking...';
    messages.appendChild(typingMsg);
    
    messages.scrollTop = messages.scrollHeight;
    
    try {
        const res = await apiPost('/api/restaurant/ai-analyst', { query }, true);
        typingMsg.remove();
        
        const aiMsg = document.createElement('div');
        aiMsg.style.cssText = 'background:var(--card-bg); padding:0.8rem; border-radius:8px; align-self:flex-start; border:1px solid var(--border); max-width:85%; line-height: 1.5;';
        
        if (res.error) {
            aiMsg.innerHTML = `<span style="color:var(--accent)">${res.error}</span>`;
        } else {
            aiMsg.innerHTML = parseMarkdown(res.response);
        }
        
        messages.appendChild(aiMsg);
    } catch (e) {
        typingMsg.remove();
        const errMsg = document.createElement('div');
        errMsg.style.cssText = 'background:var(--card-bg); padding:0.8rem; border-radius:8px; align-self:flex-start; border:1px solid var(--accent); color:var(--accent); max-width:85%;';
        errMsg.textContent = 'Failed to connect to AI server.';
        messages.appendChild(errMsg);
    }
    
    messages.scrollTop = messages.scrollHeight;
}

// ══════════════════════════════════════════════════════════
// OFFLINE ORDER / POS SYSTEM
// ══════════════════════════════════════════════════════════

let offlineOrderCart = [];

async function openOfflineOrderModal() {
    // Reload menu to populate dropdown
    await loadMenu();
    
    const select = document.getElementById('offline-menu-select');
    if (!select) return;
    
    select.innerHTML = '<option value="">-- Select an item --</option>' + 
        menuItems.map(item => `<option value="${item._id}">${item.name} (₹${item.price})</option>`).join('');
    
    offlineOrderCart = [];
    document.getElementById('offline-mobile').value = '';
    document.getElementById('offline-discount').value = '0';
    renderOfflineOrder();
    
    new bootstrap.Modal(document.getElementById('offlineOrderModal')).show();
}

function addOfflineItem() {
    const select = document.getElementById('offline-menu-select');
    const itemId = select.value;
    if (!itemId) return;
    
    const item = menuItems.find(i => i._id === itemId);
    if (!item) return;
    
    const existing = offlineOrderCart.find(i => i.item_id === itemId);
    if (existing) {
        existing.quantity += 1;
    } else {
        offlineOrderCart.push({
            item_id: item._id,
            name: item.name,
            price: item.price,
            quantity: 1
        });
    }
    
    select.value = ''; // Reset select
    renderOfflineOrder();
}

function updateOfflineItemQty(index, qty) {
    qty = parseInt(qty);
    if (qty <= 0) {
        offlineOrderCart.splice(index, 1);
    } else {
        offlineOrderCart[index].quantity = qty;
    }
    renderOfflineOrder();
}

function renderOfflineOrder() {
    const tbody = document.getElementById('offline-order-items');
    
    if (offlineOrderCart.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No items added yet.</td></tr>';
        document.getElementById('offline-subtotal').textContent = '₹0';
        document.getElementById('offline-discount-display').textContent = '-₹0';
        document.getElementById('offline-total').textContent = '₹0';
        return;
    }
    
    let subtotal = 0;
    
    tbody.innerHTML = offlineOrderCart.map((item, i) => {
        const itemTotal = item.price * item.quantity;
        subtotal += itemTotal;
        return `
            <tr>
                <td style="max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${item.name}">${item.name}</td>
                <td>₹${item.price}</td>
                <td>
                    <div class="d-flex align-items-center">
                        <button class="btn btn-sm btn-outline-secondary p-0" style="width:20px;height:20px;line-height:1" onclick="updateOfflineItemQty(${i}, ${item.quantity - 1})">-</button>
                        <span class="mx-2" style="font-size:0.85rem">${item.quantity}</span>
                        <button class="btn btn-sm btn-outline-secondary p-0" style="width:20px;height:20px;line-height:1" onclick="updateOfflineItemQty(${i}, ${item.quantity + 1})">+</button>
                    </div>
                </td>
                <td style="font-weight:bold">₹${itemTotal}</td>
                <td>
                    <button class="btn btn-sm text-danger p-0" onclick="updateOfflineItemQty(${i}, 0)"><i class="bi bi-trash"></i></button>
                </td>
            </tr>
        `;
    }).join('');
    
    let discount = parseFloat(document.getElementById('offline-discount').value) || 0;
    if (discount > subtotal) {
        discount = subtotal;
        document.getElementById('offline-discount').value = discount;
    }
    
    const total = subtotal - discount;
    
    document.getElementById('offline-subtotal').textContent = `₹${subtotal}`;
    document.getElementById('offline-discount-display').textContent = `-₹${discount}`;
    document.getElementById('offline-total').textContent = `₹${total}`;
}

async function submitOfflineOrder() {
    if (offlineOrderCart.length === 0) {
        showToast('Cart is empty', 'error');
        return;
    }
    
    const btn = document.getElementById('offline-submit-btn');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Processing...';
    btn.disabled = true;
    
    const mobile = document.getElementById('offline-mobile').value.trim();
    const discount = parseFloat(document.getElementById('offline-discount').value) || 0;
    const printReceipt = document.getElementById('offline-print-receipt').checked;
    
    const payload = {
        items: offlineOrderCart,
        mobile_number: mobile,
        discount: discount
    };
    
    const res = await apiPost('/api/restaurant/offline_order', payload, true);
    
    if (res.message) {
        showToast('Offline order created successfully!', 'success');
        bootstrap.Modal.getInstance(document.getElementById('offlineOrderModal')).hide();
        loadOrders();
        loadDashboard();
        
        if (printReceipt && res.order_id) {
            window.open(`/bill/${res.order_id}`, '_blank');
        }
    } else {
        showToast(res.error || 'Failed to create order', 'error');
    }
    
    btn.innerHTML = originalText;
    btn.disabled = false;
}

function quickAIQuery(query) {
    document.getElementById('ai-chat-input').value = query;
    sendAIQuery();
}

