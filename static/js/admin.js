/* ════════════════════════════════════════════════════════
   admin.js — Admin panel: users, restaurants, orders
   ════════════════════════════════════════════════════════ */

async function loadStats() {
  const data = await apiFetch('/api/admin/stats', true);
  if (data.error) { showToast(data.error, 'error'); return; }
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('a-users', data.total_users ?? '—');
  set('a-restaurants', data.total_restaurants ?? '—');
  set('a-orders', data.total_orders ?? '—');
  set('a-revenue', `₹${(data.total_revenue || 0).toFixed(2)}`);
  loadAdminRevenueChart();
}

let adminRevenueChart = null;
async function loadAdminRevenueChart() {
  const data = await apiFetch('/api/admin/revenue-stats', true);
  if (!data || data.error || !Array.isArray(data) || data.length === 0) return;

  const ctx = document.getElementById('adminRevenueChart');
  if (!ctx) return;

  if (adminRevenueChart) adminRevenueChart.destroy();

  const top = data.slice(0, 15); // limit to top 15 for readability
  adminRevenueChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: top.map(r => r.name),
      datasets: [{
        label: 'Revenue (₹)',
        data: top.map(r => r.revenue),
        backgroundColor: 'rgba(255,107,53,0.6)',
        borderColor: 'rgba(255,107,53,1)',
        borderWidth: 1,
        borderRadius: 4
      }, {
        label: 'Orders',
        data: top.map(r => r.order_count),
        backgroundColor: 'rgba(32,201,151,0.5)',
        borderColor: 'rgba(32,201,151,1)',
        borderWidth: 1,
        borderRadius: 4,
        yAxisID: 'y1'
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { labels: { color: '#8892a4' } },
        tooltip: {
          callbacks: {
            label: ctx => ctx.dataset.label === 'Revenue (₹)'
              ? `₹${ctx.parsed.y.toFixed(2)}`
              : `${ctx.parsed.y} orders`
          }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#8892a4', maxRotation: 30 } },
        y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#8892a4', callback: v => '₹' + v } },
        y1: { beginAtZero: true, position: 'right', grid: { display: false }, ticks: { color: '#20c997' } }
      }
    }
  });
}

async function loadUsers() {
  const users = await apiFetch('/api/admin/users', true);
  const tbody = document.getElementById('users-tbody');
  if (!tbody) return;
  if (!Array.isArray(users) || users.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center" style="color:var(--text-muted);padding:2rem">No users found</td></tr>';
    return;
  }
  tbody.innerHTML = users.map((u, i) => `
    <tr>
      <td style="color:var(--text-muted)">${i + 1}</td>
      <td><strong>${u.name}</strong></td>
      <td style="color:var(--text-muted)">${u.email}</td>
      <td><span class="badge-cuisine">${u.role || 'customer'}</span></td>
      <td>
        <button class="btn-outline-custom" style="padding:.3rem .7rem;font-size:.78rem;border-color:var(--accent);color:var(--accent)"
          onclick="deleteUser('${u._id}','${u.name.replace(/'/g, "\\'")}')">
          <i class="bi bi-trash"></i> Delete
        </button>
      </td>
    </tr>
  `).join('');
}

async function deleteUser(id, name) {
  if (!confirm(`Delete user "${name}"? This cannot be undone.`)) return;
  const res = await apiDelete(`/api/admin/user/${id}`);
  if (res.message) { showToast('User deleted', 'success'); loadUsers(); }
  else showToast(res.error || 'Delete failed', 'error');
}

async function loadRestaurants() {
  const rests = await apiFetch('/api/admin/restaurants', true);
  const tbody = document.getElementById('restaurants-tbody');
  if (!tbody) return;
  if (!Array.isArray(rests) || rests.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center" style="color:var(--text-muted);padding:2rem">No restaurants found</td></tr>';
    return;
  }
  tbody.innerHTML = rests.map((r, i) => `
    <tr>
      <td style="color:var(--text-muted)">${i + 1}</td>
      <td><strong>${r.name}</strong></td>
      <td><span class="badge-cuisine">${r.cuisine}</span></td>
      <td style="color:var(--text-muted);font-size:.85rem">${r.email}</td>
      <td>${renderStars(r.rating || 0)} <span class="rating-num">${(r.rating || 0).toFixed(1)}</span></td>
      <td><strong style="color:var(--primary)">₹${r.total_revenue || 0}</strong></td>
      <td>
        <button class="btn-outline-custom" style="padding:.3rem .65rem;font-size:.75rem;margin:.1rem"
          onclick="viewRestaurantMenu('${r._id}', '${r.name.replace(/'/g, "\\'")}')">
          <i class="bi bi-eye"></i> Menu
        </button>
        <button class="btn-outline-custom" style="padding:.3rem .65rem;font-size:.75rem;margin:.1rem"
          onclick="toggleRestaurant('${r._id}', ${r.approved !== false})">
          <i class="bi bi-toggle-${r.approved !== false ? 'on' : 'off'}"></i>
          ${r.approved !== false ? 'Disable' : 'Enable'}
        </button>
        <button class="btn-outline-custom" style="padding:.3rem .65rem;font-size:.75rem;border-color:var(--accent);color:var(--accent);margin:.1rem"
          onclick="deleteRestaurant('${r._id}','${r.name.replace(/'/g, "\\'")}')">
          <i class="bi bi-trash"></i>
        </button>
      </td>
    </tr>
  `).join('');
}

let adminMenuModal = null;

async function viewRestaurantMenu(id, name) {
  document.getElementById('admin-menu-title').textContent = `Menu: ${name}`;
  document.getElementById('admin-menu-grid').innerHTML = '<div class="col-12 text-center py-4" style="color:var(--text-muted)">Loading menu...</div>';

  if (!adminMenuModal) {
    adminMenuModal = new bootstrap.Modal(document.getElementById('adminMenuModal'));
  }
  adminMenuModal.show();

  const items = await apiFetch(`/api/menu/${id}`);
  const grid = document.getElementById('admin-menu-grid');

  if (!Array.isArray(items) || items.length === 0) {
    grid.innerHTML = '<div class="col-12 text-center py-4" style="color:var(--text-muted)">No items in this menu.</div>';
    return;
  }

  grid.innerHTML = items.map(item => `
    <div class="col-12 col-md-6">
      <div class="menu-card" style="animation:none">
        <img src="${item.image || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=200'}" alt="${item.name}">
        <div class="details">
          <div class="name">${item.name}</div>
          <div class="price">₹${item.price}</div>
          <small style="color:${item.available ? '#20c997' : 'var(--accent)'}">${item.available ? '✅ Available' : '❌ Disabled'}</small>
        </div>
      </div>
    </div>
  `).join('');
}

async function toggleRestaurant(id, currentlyApproved) {
  const res = await apiPut(`/api/admin/restaurant/${id}`, { approved: !currentlyApproved });
  if (res.message) { showToast(`Restaurant ${currentlyApproved ? 'disabled' : 'enabled'}`, 'success'); loadRestaurants(); }
  else showToast(res.error || 'Update failed', 'error');
}

async function deleteRestaurant(id, name) {
  if (!confirm(`Delete restaurant "${name}" and all its menu items?`)) return;
  const res = await apiDelete(`/api/admin/restaurant/${id}`);
  if (res.message) { showToast('Restaurant deleted', 'success'); loadRestaurants(); loadStats(); }
  else showToast(res.error || 'Delete failed', 'error');
}

async function loadAllOrders() {
  const orders = await apiFetch('/api/admin/orders', true);
  const tbody = document.getElementById('admin-orders-tbody');
  if (!tbody) return;
  if (!Array.isArray(orders) || orders.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="color:var(--text-muted);padding:2rem">No orders found</td></tr>';
    return;
  }
  tbody.innerHTML = orders.map(o => {
    const items = o.items.map(i => `${i.quantity}× ${i.name}`).join(', ');
    const date = new Date(o.created_at).toLocaleString();
    const shortId = o._id.slice(-6).toUpperCase();
    return `
    <tr>
      <td><code style="color:var(--primary)">#${shortId}</code></td>
      <td>${o.restaurant_name}</td>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${items}">${items}</td>
      <td style="color:var(--primary);font-weight:700">₹${o.total_price}</td>
      <td><span class="status-badge status-${o.status}">${o.status}</span></td>
      <td style="font-size:.82rem;color:var(--text-muted)">${date}</td>
      <td>${o.review ? `<span style="font-size:0.9rem">⭐ ${o.review.rating}</span><br><small class="text-muted-custom" style="font-size:0.75rem" title="${o.review.comment.replace(/"/g, '&quot;')}">${o.review.comment.length > 25 ? o.review.comment.substring(0, 25) + '...' : o.review.comment}</small>` : `<span style="font-size:0.8rem;color:var(--text-muted)">No review</span>`}</td>
    </tr>`;
  }).join('');
}
