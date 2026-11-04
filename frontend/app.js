// Órdenes de Reparación — Geeks Hollywood (frontend)

// Todas las peticiones llevan las cookies de sesión.
const api = (url, opts = {}) => fetch(url, { credentials: 'same-origin', ...opts });

// ---------- Sesión ----------
let currentUser = null;
function showLogin() {
  currentUser = null;
  document.getElementById('main-tabs').classList.add('hidden');
  document.querySelectorAll('main .view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-login').classList.add('active');
  // Login fluido: usuario recordado + foco directo (2 toques para entrar).
  try {
    const remembered = localStorage.getItem('gh_remembered_user');
    if (remembered) {
      document.getElementById('login-user').value = remembered;
      document.getElementById('login-pass').focus();
    } else {
      document.getElementById('login-user').focus();
    }
  } catch { /* almacenamiento no disponible: se ignora */ }
}
function showApp(username) {
  currentUser = username;
  document.getElementById('view-login').classList.remove('active');
  document.getElementById('main-tabs').classList.remove('hidden');
  document.getElementById('user-name').textContent = username;
  document.querySelectorAll('main .view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-dashboard').classList.add('active');
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.view === 'dashboard'));
  // Quién lo recibe sale de la sesión (el servidor lo impone de todos modos).
  const rb = document.getElementById('f-received-by');
  rb.value = username;
  rb.readOnly = true;
  loadDashboard();
}
async function checkSession() {
  try {
    const r = await api('/api/me');
    if (!r.ok) return showLogin();
    showApp((await r.json()).username);
  } catch {
    showLogin();
  }
}
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = document.getElementById('login-error');
  err.classList.add('hidden');
  try {
    const r = await api('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: document.getElementById('login-user').value,
        password: document.getElementById('login-pass').value
      })
    });
    if (!r.ok) {
      err.textContent = 'Credenciales inválidas.';
      err.classList.remove('hidden');
      return;
    }
    document.getElementById('login-pass').value = '';
    const username = (await r.json()).username;
    try { localStorage.setItem('gh_remembered_user', username); } catch { /* sin almacenamiento */ }
    showApp(username);
  } catch {
    err.textContent = 'No se pudo conectar con el servidor.';
    err.classList.remove('hidden');
  }
});
document.getElementById('btn-logout').addEventListener('click', async () => {
  try { await api('/api/logout', { method: 'POST' }); } catch { /* igual mostramos el login */ }
  showLogin();
});
checkSession();

const PROBLEMS = [
  'Diagnóstico', 'Pantalla partida', 'Backglass roto', 'Charging port',
  'Cámara frontal', 'Cámara trasera', 'No carga', 'Batería',
  'No enciende', 'Mojado', 'Software', 'Otro'
];
const ARRIVAL = [
  'Mojado', 'Backglass partido', 'No prende',
  'Rayones', 'Golpes visibles', 'Con funda', 'Sin cargador', 'Otro'
];
const NEXT_LABEL = {
  'Recibido': 'Pasar a En reparación',
  'En reparación': 'Marcar como Listo',
  'Listo': 'Marcar como Entregado'
};
const TECHNICIANS = ['Fabio', 'Oliver', 'Sebastian', 'Fernando', 'Maria', 'Elder'];

function fillTechnicianOptions() {
  for (const id of ['f-technician', 'e-technician', 'dash-technician', 'orders-technician']) {
    const select = document.getElementById(id);
    if (!select) continue;
    const first = select.options[0];
    select.replaceChildren(first);
    TECHNICIANS.forEach(name => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      select.appendChild(option);
    });
  }
}
fillTechnicianOptions();

function localDateInput(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
const todayForInput = new Date();
document.getElementById('dash-to').value = localDateInput(todayForInput);
const monthAgo = new Date(todayForInput);
monthAgo.setDate(monthAgo.getDate() - 29);
document.getElementById('dash-from').value = localDateInput(monthAgo);

// ---------- Tabs ----------
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('view-' + btn.dataset.view).classList.add('active');
    if (btn.dataset.view === 'orders') loadOrders();
    if (btn.dataset.view === 'dashboard') loadDashboard();
  });
});

// ---------- Chip groups ----------
function buildChips(containerId, options, { multi = false, onChange = null } = {}) {
  const c = document.getElementById(containerId);
  c.innerHTML = '';
  options.forEach(opt => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.dataset.value = opt;
    b.textContent = opt;
    b.addEventListener('click', () => {
      if (multi) {
        b.classList.toggle('active');
      } else {
        c.querySelectorAll('.chip').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
      }
      if (onChange) onChange(getSelected(containerId));
    });
    c.appendChild(b);
  });
}
function getSelected(containerId) {
  return [...document.querySelectorAll('#' + containerId + ' .chip.active')].map(b => b.dataset.value);
}
function setSelected(containerId, values) {
  const set = new Set(values || []);
  document.querySelectorAll('#' + containerId + ' .chip').forEach(b => {
    b.classList.toggle('active', set.has(b.dataset.value));
  });
}

function toggleDiag(containerId, wrapId, inputId) {
  const show = getSelected(containerId).includes('Diagnóstico');
  document.getElementById(wrapId).classList.toggle('hidden', !show);
}

buildChips('f-device-type', ['iPhone', 'Samsung', 'Otro']);
buildChips('f-problems', PROBLEMS, { multi: true, onChange: () => toggleDiag('f-problems', 'diag-wrap') });
buildChips('f-arrival', ARRIVAL, { multi: true });
buildChips('e-device-type', ['iPhone', 'Samsung', 'Otro']);
buildChips('e-problems', PROBLEMS, { multi: true, onChange: () => toggleDiag('e-problems', 'e-diag-wrap') });
buildChips('e-arrival', ARRIVAL, { multi: true });

// ---------- Rellenar datos de prueba (solo en desarrollo, B-1) ----------
// El botón solo se muestra cuando el servidor corre fuera de producción
// (NODE_ENV !== 'production', ver /api/config). En producción se elimina del
// DOM para que el personal no pueda crear órdenes basura.
(function initTestButton() {
  const btn = document.getElementById('btn-fill-test');
  if (!btn) return;
  const wireButton = () => {
    btn.addEventListener('click', () => {
      document.getElementById('f-name').value = 'Test User';
      document.getElementById('f-phone').value = '300-000-0000';
      setSelected('f-device-type', ['iPhone']);
      document.getElementById('f-model').value = 'Modelo de Prueba';
      document.getElementById('f-imei').value = '000000000000000';
      setSelected('f-problems', ['Pantalla partida']);
      toggleDiag('f-problems', 'diag-wrap');
      setSelected('f-arrival', ['Golpes visibles']);
      document.getElementById('f-received-by').value = 'Técnico de Prueba';
      document.getElementById('f-agreement').value = 'Datos de prueba — borrar después';
      document.getElementById('f-diagnostic').value = '';
    });
  };
  fetch('/api/config')
    .then(r => (r.ok ? r.json() : { devMode: false }))
    .then(cfg => {
      if (cfg && cfg.devMode === true) wireButton();
      else btn.remove(); // fail closed: sin confirmación de dev, se oculta
    })
    .catch(() => btn.remove());
})();

// ---------- Scroll + foco al primer campo inválido ----------
function focusFirstInvalid(prefix) {
  const g = (id) => document.getElementById(prefix + '-' + id);
  const checks = [
    [g('name'), () => g('name').value.trim() !== ''],
    [document.getElementById(prefix + '-device-type'), () => getSelected(prefix + '-device-type').length > 0],
    [g('model'), () => g('model').value.trim() !== ''],
    [document.getElementById(prefix + '-problems'), () => getSelected(prefix + '-problems').length > 0],
    [g('received-by'), () => g('received-by').value.trim() !== ''],
    [g('agreement'), () => g('agreement').value.trim() !== '']
  ];
  if (getSelected(prefix + '-problems').includes('Diagnóstico')) {
    const d = g('diagnostic');
    if (d) checks.push([d, () => d.value.trim() !== '']);
  }
  for (const [el, ok] of checks) {
    if (!el || ok()) continue;
    el.classList.add('flash-invalid');
    setTimeout(() => el.classList.remove('flash-invalid'), 2500);
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (typeof el.focus === 'function' && el.tagName !== 'DIV') el.focus({ preventScroll: true });
    return;
  }
}

// ---------- Intake submit ----------
document.getElementById('intake-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = document.getElementById('form-error');
  err.classList.add('hidden');
  const problems = getSelected('f-problems');
  const body = {
    customer_name: document.getElementById('f-name').value,
    phone: document.getElementById('f-phone').value,
    device_type: getSelected('f-device-type')[0] || '',
    model: document.getElementById('f-model').value,
    imei: document.getElementById('f-imei').value,
    problems,
    arrival_condition: getSelected('f-arrival'),
    received_by: document.getElementById('f-received-by').value,
    assigned_technician: document.getElementById('f-technician').value,
    promised_at: document.getElementById('f-promised-at').value,
    agreement: document.getElementById('f-agreement').value,
    diagnostic_note: document.getElementById('f-diagnostic').value
  };
  try {
    const r = await api('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await r.json();
    if (!r.ok) {
      err.textContent = (data.errors || ['Error al guardar.']).join(' ');
      err.classList.remove('hidden');
      focusFirstInvalid('f');
      return;
    }
    document.getElementById('intake-form').classList.add('hidden');
    document.getElementById('ticket-big').textContent = data.ticket;
    document.getElementById('customer-code-big').textContent = data.customer_code || '—';
    document.getElementById('ticket-success').classList.remove('hidden');
  } catch {
    err.textContent = 'No se pudo conectar con el servidor.';
    err.classList.remove('hidden');
  }
});

document.getElementById('btn-new-order').addEventListener('click', () => {
  document.getElementById('intake-form').reset();
  document.getElementById('f-received-by').value = currentUser || '';
  ['f-device-type', 'f-problems', 'f-arrival'].forEach(id => setSelected(id, []));
  toggleDiag('f-problems', 'diag-wrap');
  document.getElementById('ticket-success').classList.add('hidden');
  document.getElementById('intake-form').classList.remove('hidden');
});

// ---------- Orders list ----------
let currentStatusFilter = '';
// Espera 300 ms después de la última tecla antes de buscar (no una petición por letra).
let ordersSearchTimer = null;
document.getElementById('orders-search').addEventListener('input', () => {
  clearTimeout(ordersSearchTimer);
  ordersSearchTimer = setTimeout(loadOrders, 300);
});
for (const id of ['orders-from', 'orders-to', 'orders-technician', 'orders-device', 'orders-problem']) {
  document.getElementById(id).addEventListener('change', loadOrders);
}
document.getElementById('orders-clear-filters').addEventListener('click', () => {
  document.getElementById('orders-search').value = '';
  ['orders-from', 'orders-to', 'orders-technician', 'orders-device', 'orders-problem'].forEach(id => {
    document.getElementById(id).value = '';
  });
  ['aging_bucket', 'pickup_bucket', 'open_only', 'overdue', 'completed_technician', 'completed_from', 'completed_to', 'completed_unassigned', 'unassigned']
    .forEach(key => delete document.getElementById('orders-list').dataset[key]);
  currentStatusFilter = '';
  document.querySelectorAll('#status-filter .chip').forEach(b => b.classList.toggle('active', b.dataset.value === ''));
  loadOrders();
});
document.querySelectorAll('#status-filter .chip').forEach(b => {
  b.addEventListener('click', () => {
    document.querySelectorAll('#status-filter .chip').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    currentStatusFilter = b.dataset.value;
    loadOrders();
  });
});

const ORDERS_PAGE_SIZE = 50;
let ordersNextCursor = null;
let ordersRequestId = 0;
let ordersAbort = null;

async function loadOrders(append) {
  // Los listeners pasan un Event; solo `true` significa "Cargar más".
  append = append === true;
  const list = document.getElementById('orders-list');
  const moreBtn = document.getElementById('orders-load-more');
  const q = new URLSearchParams({
    search: document.getElementById('orders-search').value,
    status: currentStatusFilter,
    from: document.getElementById('orders-from').value,
    to: document.getElementById('orders-to').value,
    technician: document.getElementById('orders-technician').value,
    device_type: document.getElementById('orders-device').value,
    problem: document.getElementById('orders-problem').value.trim()
  });
  ['aging_bucket', 'pickup_bucket', 'open_only', 'overdue', 'completed_technician', 'completed_from', 'completed_to', 'completed_unassigned', 'unassigned']
    .forEach(key => { if (list.dataset[key]) q.set(key, list.dataset[key]); });
  q.set('limit', String(ORDERS_PAGE_SIZE));
  if (append && ordersNextCursor) q.set('cursor', String(ordersNextCursor));
  if (!append) clearTimeout(ordersSearchTimer);
  // Cancela la petición anterior que siga en camino (búsqueda vieja).
  if (ordersAbort) ordersAbort.abort();
  ordersAbort = new AbortController();
  const signal = ordersAbort.signal;
  const requestId = ++ordersRequestId;
  if (append) {
    moreBtn.disabled = true;
    moreBtn.textContent = 'Cargando…';
  } else {
    ordersNextCursor = null;
    moreBtn.classList.add('hidden');
    list.innerHTML = '<p class="empty">Cargando órdenes…</p>';
  }
  try {
    const response = await api('/api/orders?' + q, { signal });
    if (!response.ok) throw new Error('No se pudieron cargar las órdenes.');
    const data = await response.json();
    if (requestId !== ordersRequestId) return; // llegó una búsqueda más nueva
    const orders = data.orders;
    ordersNextCursor = data.next_cursor;
    moreBtn.classList.toggle('hidden', !ordersNextCursor);
    if (!append && !orders.length) {
      list.innerHTML = '<p class="empty">No hay órdenes aquí todavía.</p>';
      return;
    }
    if (!append) list.innerHTML = '';
    const newCards = [];
    orders.forEach(o => {
      const card = document.createElement('div');
      card.className = 'order-card';
      const canAdvance = o.status !== 'Entregado';
      card.innerHTML = `
        <div class="order-top">
          <span class="order-ticket">${esc(o.ticket)}</span>
          <span class="status-badge ${statusCssClass(o.status)}">${esc(o.status)}</span>
        </div>
        <p class="order-name">${esc(o.customer_name)}</p>
        <p class="order-meta">${esc(o.device_type)} · ${esc(o.model)}${o.phone ? ' · ' + esc(o.phone) : ''}</p>
        <div class="order-problems">${o.problems.map(p => `<span class="tag">${esc(p)}</span>`).join('')}</div>
        ${o.diagnostic_note ? `<p class="order-meta"><strong>Cliente dice:</strong> ${esc(o.diagnostic_note)}</p>` : ''}
        <p class="order-meta"><strong>Técnico:</strong> ${o.assigned_technician ? esc(o.assigned_technician) : 'Sin asignar'}${o.promised_at ? ` · <strong>Prometida:</strong> ${esc(o.promised_at)}` : ''}</p>
        <p class="order-meta"><span class="received-by">Recibió: ${esc(o.received_by)}</span> · ${esc(o.created_at.slice(0, 16).replace('T', ' '))}</p>
        ${o.status_changed_at ? `<p class="order-meta">${esc(o.status)} desde ${esc(o.status_changed_at.slice(0, 16))}</p>` : ''}
        <div class="order-actions">
          ${canAdvance ? `<button class="btn-advance" data-id="${o.id}">${esc(NEXT_LABEL[o.status])}</button>` : ''}
          <button class="btn-history" type="button" data-id="${o.id}" aria-expanded="false">Historial</button>
          <button class="btn-edit" data-id="${o.id}">Editar</button>
          ${o.status === 'Recibido' ? `<button class="btn-delete" data-id="${o.id}">Eliminar</button>` : ''}
        </div>
        <div class="order-history hidden" id="order-history-${o.id}" aria-live="polite"></div>`;
      list.appendChild(card);
      newCards.push(card);
    });
    // Solo se enganchan las tarjetas nuevas, para no duplicar listeners al "Cargar más".
    newCards.forEach(card => {
      card.querySelectorAll('.btn-advance').forEach(b =>
        b.addEventListener('click', () => advanceOrder(b.dataset.id)));
      card.querySelectorAll('.btn-edit').forEach(b =>
        b.addEventListener('click', () => openEdit(b.dataset.id)));
      card.querySelectorAll('.btn-history').forEach(b =>
        b.addEventListener('click', () => toggleOrderHistory(b)));
      card.querySelectorAll('.btn-delete').forEach(b =>
        b.addEventListener('click', () => deleteOrder(b.dataset.id)));
    });
  } catch {
    if (requestId !== ordersRequestId) return;
    if (append) alert('No se pudieron cargar más órdenes. Revisa la conexión.');
    else list.innerHTML = '<p class="empty">No se pudo cargar. Revisa la conexión.</p>';
  } finally {
    if (requestId === ordersRequestId) {
      moreBtn.disabled = false;
      moreBtn.textContent = 'Cargar más';
    }
  }
}
document.getElementById('orders-load-more').addEventListener('click', () => loadOrders(true));

async function toggleOrderHistory(button) {
  const box = document.getElementById('order-history-' + button.dataset.id);
  const opening = box.classList.contains('hidden');
  box.classList.toggle('hidden', !opening);
  button.setAttribute('aria-expanded', String(opening));
  if (!opening || box.dataset.loaded === 'true') return;
  box.textContent = 'Cargando historial…';
  try {
    const response = await api('/api/orders/' + encodeURIComponent(button.dataset.id) + '/history');
    if (!response.ok) throw new Error('No se pudo cargar el historial.');
    const events = await response.json();
    box.innerHTML = events.map(event => {
      const at = esc(String(event.created_at || '').slice(0, 16));
      let message = '';
      if (event.event_type === 'status') {
        message = event.from_status ? `Estado: ${esc(event.from_status)} → ${esc(event.to_status)}` : `Orden recibida: ${esc(event.to_status)}`;
      } else if (event.event_type === 'technician_assigned') {
        message = event.assigned_technician
          ? `Técnico asignado: ${esc(event.previous_technician || 'Sin asignar')} → ${esc(event.assigned_technician)}`
          : `Asignación retirada: ${esc(event.previous_technician || 'Sin asignar')}`;
      } else message = 'Actualización de orden';
      return `<p class="history-event"><strong>${message}</strong><span>${at} · ${esc(event.actor || 'sistema')}</span></p>`;
    }).join('') || '<p class="muted">Sin eventos registrados.</p>';
    box.dataset.loaded = 'true';
  } catch (error) {
    box.textContent = error.message || 'No se pudo cargar el historial.';
  }
}

async function advanceOrder(id) {
  await api('/api/orders/' + id + '/advance', { method: 'POST' });
  loadOrders();
}

async function deleteOrder(id) {
  if (!confirm('¿Eliminar esta orden? Solo se puede eliminar en estado Recibido.')) return;
  try {
    const r = await api('/api/orders/' + id, { method: 'DELETE' });
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      alert(data.error || 'No se pudo eliminar.');
      return;
    }
    loadOrders();
  } catch {
    alert('No se pudo conectar con el servidor.');
  }
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function statusCssClass(status) {
  return ({ 'Recibido': 'status-received', 'En reparación': 'status-repair', 'Listo': 'status-ready', 'Entregado': 'status-delivered' })[status] || 'status-unknown';
}

// ---------- Edit ----------
let editingId = null;
async function openEdit(id) {
  // B-2: trae solo la orden a editar, no toda la lista.
  const r = await api('/api/orders/' + encodeURIComponent(id));
  if (!r.ok) return;
  const o = await r.json();
  if (!o || !o.id) return;
  editingId = o.id;
  document.getElementById('edit-ticket').textContent = o.ticket;
  document.getElementById('e-name').value = o.customer_name;
  document.getElementById('e-phone').value = o.phone || '';
  document.getElementById('e-model').value = o.model;
  document.getElementById('e-imei').value = o.imei || '';
  document.getElementById('e-received-by').value = o.received_by;
  document.getElementById('e-technician').value = o.assigned_technician || '';
  document.getElementById('e-promised-at').value = o.promised_at || '';
  document.getElementById('e-agreement').value = o.agreement;
  document.getElementById('e-diagnostic').value = o.diagnostic_note || '';
  document.getElementById('e-status').value = o.status;
  setSelected('e-device-type', [o.device_type]);
  setSelected('e-problems', o.problems);
  setSelected('e-arrival', o.arrival_condition);
  toggleDiag('e-problems', 'e-diag-wrap');
  document.getElementById('edit-error').classList.add('hidden');
  document.getElementById('edit-modal').classList.remove('hidden');
}

document.getElementById('btn-edit-cancel').addEventListener('click', () => {
  document.getElementById('edit-modal').classList.add('hidden');
});
document.getElementById('edit-modal').addEventListener('click', (e) => {
  if (e.target.id === 'edit-modal') e.target.classList.add('hidden');
});

document.getElementById('edit-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = document.getElementById('edit-error');
  err.classList.add('hidden');
  const body = {
    customer_name: document.getElementById('e-name').value,
    phone: document.getElementById('e-phone').value,
    device_type: getSelected('e-device-type')[0] || '',
    model: document.getElementById('e-model').value,
    imei: document.getElementById('e-imei').value,
    problems: getSelected('e-problems'),
    arrival_condition: getSelected('e-arrival'),
    received_by: document.getElementById('e-received-by').value,
    assigned_technician: document.getElementById('e-technician').value,
    promised_at: document.getElementById('e-promised-at').value,
    agreement: document.getElementById('e-agreement').value,
    diagnostic_note: document.getElementById('e-diagnostic').value,
    status: document.getElementById('e-status').value
  };
  try {
    const r = await api('/api/orders/' + editingId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await r.json();
    if (!r.ok) {
      err.textContent = (data.errors || ['Error al guardar.']).join(' ');
      err.classList.remove('hidden');
      focusFirstInvalid('e');
      return;
    }
    document.getElementById('edit-modal').classList.add('hidden');
    loadOrders();
  } catch {
    err.textContent = 'No se pudo conectar con el servidor.';
    err.classList.remove('hidden');
  }
});

// ---------- Lookup ----------
async function doLookup() {
  const code = document.getElementById('lookup-ticket').value.trim().toUpperCase();
  const err = document.getElementById('lookup-error');
  const box = document.getElementById('lookup-result');
  err.classList.add('hidden');
  box.classList.add('hidden');
  if (!code) return;
  try {
    const r = await api('/api/track/' + encodeURIComponent(code));
    if (!r.ok) {
      err.textContent = r.status === 429
        ? 'Demasiadas consultas. Espera un minuto.'
        : 'Código no encontrado. Revisa el código.';
      err.classList.remove('hidden');
      return;
    }
    const o = await r.json();
    box.innerHTML = `
      <div class="lookup-status ${statusCssClass(o.status)}">${esc(o.status)}</div>
      <p><strong>Ticket:</strong> ${esc(o.ticket)}</p>
      <p><strong>Cliente:</strong> ${esc(o.customer_name)}</p>
      <p><strong>Equipo:</strong> ${esc(o.device_type)} ${esc(o.model)}</p>
      <p><strong>Problemas:</strong> ${o.problems.map(esc).join(', ')}</p>
      <p class="muted">Geeks Hollywood · 4514 Hollywood Blvd · (754) 888-9631</p>`;
    box.classList.remove('hidden');
  } catch {
    err.textContent = 'No se pudo conectar con el servidor.';
    err.classList.remove('hidden');
  }
}
document.getElementById('btn-lookup').addEventListener('click', doLookup);
document.getElementById('lookup-ticket').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doLookup();
});

// ---------- Panel operativo ----------
document.getElementById('dashboard-filters').addEventListener('submit', e => {
  e.preventDefault();
  loadDashboard();
});

function dashboardQuery() {
  return new URLSearchParams({
    from: document.getElementById('dash-from').value,
    to: document.getElementById('dash-to').value,
    status: document.getElementById('dash-status').value,
    technician: document.getElementById('dash-technician').value,
    device_type: document.getElementById('dash-device').value,
    interval: document.getElementById('dash-interval').value
  });
}

function updateDeviceOptions(deviceTypes) {
  for (const [id, emptyLabel] of [['dash-device', 'Todos los equipos'], ['orders-device', 'Todos los equipos']]) {
    const select = document.getElementById(id);
    const oldValue = select.value;
    select.replaceChildren(new Option(emptyLabel, ''));
    deviceTypes.forEach(type => select.add(new Option(type, type)));
    if (deviceTypes.includes(oldValue)) select.value = oldValue;
  }
}

async function loadDashboard() {
  const state = document.getElementById('dashboard-state');
  const content = document.getElementById('dashboard-content');
  state.textContent = 'Cargando datos del taller…';
  state.classList.remove('error');
  content.classList.add('hidden');
  try {
    const response = await api('/api/dashboard?' + dashboardQuery());
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'No se pudo cargar el panel.');
    updateDeviceOptions(data.deviceTypes || []);
    renderDashboard(data);
    content.classList.remove('hidden');
    state.textContent = data.created.length ? '' : 'No hay órdenes en el período seleccionado.';
  } catch (error) {
    state.textContent = error.message || 'No se pudo cargar el panel. Revisa la conexión.';
    state.classList.add('error');
  }
}

function renderDashboard(data) {
  const items = [
    ['Órdenes creadas hoy', data.summary.createdToday, false],
    ['Órdenes abiertas', data.summary.open, false],
    ['En reparación', data.summary.inRepair, false],
    ['Listas para recoger', data.summary.ready, false],
    ['Entregadas hoy', data.summary.deliveredToday, false],
    ['Abiertas 3 días o más', data.summary.aging, true],
    ['Promesa vencida', data.summary.overdue, true],
    ['Listas esperando 48 h o más', data.summary.waitingPickup, true]
  ];
  document.getElementById('dashboard-kpis').innerHTML = items.map(([label, value, alert]) => `
    <div class="kpi-card${alert && value ? ' alert' : ''}"><span class="kpi-label">${esc(label)}</span>
      <strong class="kpi-value">${Number(value) || 0}</strong></div>`).join('');

  const base = {
    from: document.getElementById('dash-from').value,
    to: document.getElementById('dash-to').value,
    status: document.getElementById('dash-status').value,
    technician: document.getElementById('dash-technician').value,
    device_type: document.getElementById('dash-device').value
  };
  const withBase = extra => ({ ...base, ...extra });
  renderBars('chart-created', data.created, x => withBase({ from: x.from, to: x.to }));
  renderBars('chart-status', data.statuses, x => withBase({ status: x.label }));

  const technicianChart = document.getElementById('chart-technicians');
  technicianChart.replaceChildren();
  appendChartSection(technicianChart, 'Pendientes por técnico', data.technicians,
    x => withBase({ from: '', to: '', technician: x.label === 'Sin asignar' ? '' : x.label,
      open_only: '1', unassigned: x.label === 'Sin asignar' ? '1' : '' }), x => x.value, 'órdenes');
  appendChartSection(technicianChart, 'Entregadas por técnico', data.technicians,
    x => withBase({ from: '', to: '', technician: '', status: 'Entregado',
      completed_technician: x.label === 'Sin asignar' ? '' : x.label,
      completed_unassigned: x.label === 'Sin asignar' ? '1' : '',
      completed_from: base.from, completed_to: base.to }), x => x.completed, 'órdenes');

  renderBars('chart-devices', data.devices, x => withBase({ device_type: x.label }));
  renderBars('chart-issues', data.issues, x => withBase({ problem: x.label }));
  const agingKeys = ['0_1', '2_3', '4_7', '8_plus'];
  renderBars('chart-aging', data.aging, (x, i) => withBase({ from: '', to: '', status: '', aging_bucket: agingKeys[i], open_only: '1' }));
  const pickupKeys = ['under_24', '1_2', '2_3', '3_plus'];
  renderBars('chart-pickup', data.pickupWaiting, (x, i) => withBase({ from: '', to: '', status: 'Listo', pickup_bucket: pickupKeys[i] }));
  const turnaroundItems = data.turnaround.byTechnician.filter(x => x.count > 0).map(x => ({
    ...x, label: `${x.label} · ${x.count}`, display: `${x.value} h`, value: x.value
  }));
  document.getElementById('turnaround-summary').textContent = data.turnaround.medianHours === null
    ? 'Sin entregas con marcas de tiempo válidas en este período.'
    : `Mediana general: ${Math.round(data.turnaround.medianHours * 10) / 10} h · ${data.turnaround.completedCount} entregas.`;
  renderBars('chart-turnaround', turnaroundItems, x => withBase({ from: '', to: '', status: 'Entregado',
    technician: '', completed_technician: x.label.split(' · ')[0], completed_from: base.from, completed_to: base.to }), x => x.display);
}

function appendChartSection(target, title, items, paramsFor, valueOf, valueLabel = '') {
  const heading = document.createElement('p');
  heading.className = 'chart-subheading';
  heading.textContent = title;
  target.appendChild(heading);
  addBarRows(target, items, paramsFor, valueOf, valueLabel);
}

function renderBars(id, items, paramsFor, valueOf = item => item.value) {
  const target = document.getElementById(id);
  target.replaceChildren();
  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'bar-empty';
    empty.textContent = 'No hay datos para mostrar.';
    target.appendChild(empty);
    return;
  }
  addBarRows(target, items, paramsFor, valueOf);
}

function addBarRows(target, items, paramsFor, valueOf = item => item.value, suffix = '') {
  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'bar-empty';
    empty.textContent = 'Sin datos';
    target.appendChild(empty);
    return;
  }
  const values = items.map(item => Number(item.value) || 0);
  const max = Math.max(1, ...values);
  items.forEach((item, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'bar-row';
    const number = Number(item.value) || 0;
    const display = typeof valueOf(item) === 'string' ? valueOf(item) : `${number}${suffix ? ` ${suffix}` : ''}`;
    button.setAttribute('aria-label', `Abrir órdenes: ${item.label}, ${display}`);
    button.innerHTML = `<span class="bar-label">${esc(item.label)}</span>
      <progress class="bar-progress" max="${max}" value="${number}" aria-hidden="true"></progress>
      <span class="bar-value">${esc(display)}</span>`;
    button.addEventListener('click', () => openOrdersFromChart(paramsFor(item, index)));
    target.appendChild(button);
  });
}

function openOrdersFromChart(params) {
  document.getElementById('orders-search').value = '';
  document.getElementById('orders-from').value = params.from || '';
  document.getElementById('orders-to').value = params.to || '';
  document.getElementById('orders-technician').value = params.technician || '';
  document.getElementById('orders-device').value = params.device_type || '';
  document.getElementById('orders-problem').value = params.problem || '';
  currentStatusFilter = params.status || '';
  document.querySelectorAll('#status-filter .chip').forEach(b => b.classList.toggle('active', b.dataset.value === currentStatusFilter));
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.view === 'orders'));
  document.querySelectorAll('main .view').forEach(v => v.classList.toggle('active', v.id === 'view-orders'));
  const query = new URLSearchParams(params);
  const extraIds = ['aging_bucket', 'pickup_bucket', 'open_only', 'overdue', 'completed_technician', 'completed_from', 'completed_to', 'completed_unassigned', 'unassigned'];
  extraIds.forEach(key => {
    const value = query.get(key);
    if (value) document.getElementById('orders-list').dataset[key] = value;
    else delete document.getElementById('orders-list').dataset[key];
  });
  loadOrders();
}

document.getElementById('dashboard-export').addEventListener('click', async () => {
  // El servidor arma el CSV por partes y el navegador lo guarda directo a
  // disco: no se carga todo el reporte en memoria.
  const button = document.getElementById('dashboard-export');
  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'Preparando…';
  try {
    const me = await api('/api/me');
    if (!me.ok) throw new Error('Tu sesión expiró. Vuelve a iniciar sesión.');
    const query = dashboardQuery();
    query.delete('interval');
    const link = document.createElement('a');
    link.href = '/api/orders/export.csv?' + query;
    link.download = `reporte-ordenes-${localDateInput(new Date())}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } catch (error) {
    alert(error.message || 'No se pudo generar el reporte.');
  } finally {
    setTimeout(() => {
      button.disabled = false;
      button.textContent = original;
    }, 1500);
  }
});
