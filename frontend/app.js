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
  for (const id of ['f-technician', 'e-technician', 'w-technician', 'dash-technician', 'orders-technician']) {
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
    price: document.getElementById('f-price').value,
    marketing_opt_in: document.getElementById('f-optin').checked,
    agreement: document.getElementById('f-agreement').value,
    diagnostic_note: document.getElementById('f-diagnostic').value
  };
  try {
    const r = await api('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (r.status === 401) return sessionExpired();
    const data = await r.json();
    if (!r.ok) {
      err.textContent = (data.errors || [data.error || 'Error al guardar.']).join(' ');
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
  clearCustomerMatch();
  document.getElementById('f-received-by').value = currentUser || '';
  ['f-device-type', 'f-problems', 'f-arrival'].forEach(id => setSelected(id, []));
  toggleDiag('f-problems', 'diag-wrap');
  document.getElementById('ticket-success').classList.add('hidden');
  document.getElementById('intake-form').classList.remove('hidden');
});

// ---------- Orders list ----------
let currentStatusFilter = '';
document.getElementById('orders-search').addEventListener('input', () => {
  clearTimeout(ordersSearchTimer);
  ordersSearchTimer = setTimeout(loadOrders, 250);
});
for (const id of ['orders-from', 'orders-to', 'orders-technician', 'orders-device', 'orders-problem']) {
  document.getElementById(id).addEventListener('change', loadOrders);
}
document.getElementById('orders-clear-filters').addEventListener('click', () => {
  document.getElementById('orders-search').value = '';
  ['orders-from', 'orders-to', 'orders-technician', 'orders-device', 'orders-problem'].forEach(id => {
    document.getElementById(id).value = '';
  });
  ['aging_bucket', 'pickup_bucket', 'open_only', 'overdue', 'completed_technician', 'completed_from', 'completed_to', 'completed_unassigned', 'unassigned', 'warranty_only']
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

// Se muestran 50 órdenes y "Mostrar más" carga las siguientes.
const ORDERS_PAGE = 50;
let ordersShown = ORDERS_PAGE;
let ordersSearchTimer = null;
let ordersSeq = 0; // si llegan respuestas viejas (escribir rápido, cambiar filtros), se ignoran

async function loadOrders(opts) {
  // Un filtro nuevo vuelve a la primera página; "Mostrar más" la conserva.
  if (!(opts && opts.keepPage === true)) ordersShown = ORDERS_PAGE;
  const seq = ++ordersSeq;
  const list = document.getElementById('orders-list');
  const q = new URLSearchParams({
    search: document.getElementById('orders-search').value,
    status: currentStatusFilter,
    from: document.getElementById('orders-from').value,
    to: document.getElementById('orders-to').value,
    technician: document.getElementById('orders-technician').value,
    device_type: document.getElementById('orders-device').value,
    problem: document.getElementById('orders-problem').value.trim(),
    limit: String(ordersShown)
  });
  ['aging_bucket', 'pickup_bucket', 'open_only', 'overdue', 'completed_technician', 'completed_from', 'completed_to', 'completed_unassigned', 'unassigned', 'warranty_only']
    .forEach(key => { if (list.dataset[key]) q.set(key, list.dataset[key]); });
  if (!list.children.length || !(opts && opts.keepPage)) list.innerHTML = '<p class="empty">Cargando órdenes…</p>';
  try {
    const response = await api('/api/orders?' + q);
    if (seq !== ordersSeq) return;
    if (response.status === 401) return sessionExpired();
    if (!response.ok) throw new Error('No se pudieron cargar las órdenes.');
    const orders = await response.json();
    if (seq !== ordersSeq) return;
    const total = Number(response.headers.get('X-Total-Count')) || orders.length;
    if (!orders.length) {
      list.innerHTML = '<p class="empty">No hay órdenes aquí todavía.</p>';
      return;
    }
    list.innerHTML = '';
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
        ${o.price !== null && o.price !== undefined ? `<p class="order-meta"><strong>Precio:</strong> ${esc(money(o.price))}</p>` : ''}
        <p class="order-meta"><strong>Técnico:</strong> ${o.assigned_technician ? esc(o.assigned_technician) : 'Sin asignar'}${o.promised_at ? ` · <strong>Prometida:</strong> ${esc(o.promised_at)}` : ''}</p>
        <p class="order-meta"><span class="received-by">Recibió: ${esc(o.received_by)}</span> · ${esc(o.created_at.slice(0, 16).replace('T', ' '))}</p>
        ${o.status_changed_at ? `<p class="order-meta">${esc(o.status)} desde ${esc(o.status_changed_at.slice(0, 16))}</p>` : ''}
        ${warrantyClaimLine(o)}
        ${warrantyStatusLine(o)}
        <div class="order-actions">
          ${canAdvance ? `<button class="btn-advance" data-id="${o.id}" data-status="${esc(o.status)}">${esc(NEXT_LABEL[o.status])}</button>` : ''}
          <button class="btn-history" type="button" data-id="${o.id}" aria-expanded="false">Historial</button>
          <button class="btn-edit" data-id="${o.id}">Editar</button>
          ${o.status === 'Entregado' ? `<button class="btn-warranty" type="button" data-id="${o.id}">Garantía / Devolución</button>` : ''}
          ${o.status === 'Recibido' ? `<button class="btn-delete" data-id="${o.id}">Eliminar</button>` : ''}
        </div>
        <div class="order-history hidden" id="order-history-${o.id}" aria-live="polite"></div>`;
      list.appendChild(card);
    });
    const summary = document.createElement('p');
    summary.className = 'orders-count';
    summary.textContent = `Mostrando ${orders.length} de ${total} órdenes`;
    list.prepend(summary);
    if (total > orders.length) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'btn-secondary btn-more';
      more.textContent = `Mostrar más (${total - orders.length} restantes)`;
      more.addEventListener('click', () => { ordersShown += ORDERS_PAGE; loadOrders({ keepPage: true }); });
      list.appendChild(more);
    }
    list.querySelectorAll('.btn-advance').forEach(b =>
      b.addEventListener('click', () => advanceOrder(b.dataset.id, b.dataset.status)));
    list.querySelectorAll('.btn-edit').forEach(b =>
      b.addEventListener('click', () => openEdit(b.dataset.id)));
    list.querySelectorAll('.btn-history').forEach(b =>
      b.addEventListener('click', () => toggleOrderHistory(b)));
    list.querySelectorAll('.btn-delete').forEach(b =>
      b.addEventListener('click', () => deleteOrder(b.dataset.id)));
    list.querySelectorAll('.btn-warranty').forEach(b =>
      b.addEventListener('click', () => openWarranty(b.dataset.id)));
  } catch {
    list.innerHTML = '<p class="empty">No se pudo cargar. Revisa la conexión.</p>';
  }
}

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
      } else if (event.details) {
        message = esc(event.details);
      } else message = 'Actualización de orden';
      return `<p class="history-event"><strong>${message}</strong><span>${at} · ${esc(event.actor || 'sistema')}</span></p>`;
    }).join('') || '<p class="muted">Sin eventos registrados.</p>';
    box.dataset.loaded = 'true';
  } catch (error) {
    box.textContent = error.message || 'No se pudo cargar el historial.';
  }
}

async function advanceOrder(id, currentStatus) {
  // "Entregado" no se puede deshacer: se pide confirmación.
  if (currentStatus === 'Listo' &&
      !confirm('¿Marcar como ENTREGADO? Esto no se puede deshacer.\nDesde hoy empiezan a contar los días de garantía.')) return;
  try {
    const r = await api('/api/orders/' + id + '/advance', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: currentStatus })
    });
    if (r.status === 401) return sessionExpired();
    if (!r.ok) {
      const data = await r.json().catch(() => ({}));
      alert(data.error || 'No se pudo cambiar el estado.');
    }
  } catch {
    alert('No se pudo conectar con el servidor.');
  }
  loadOrders({ keepPage: true });
}

// La sesión dura 12 h. Si caduca, se avisa y se vuelve al login (lo escrito
// en el formulario de Nueva orden sigue ahí al volver a entrar).
function sessionExpired() {
  alert('Tu sesión expiró. Inicia sesión otra vez para continuar.');
  showLogin();
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
    loadOrders({ keepPage: true });
  } catch {
    alert('No se pudo conectar con el servidor.');
  }
}

function money(v) {
  return '$' + Number(v || 0).toLocaleString('es-US', { maximumFractionDigits: 2 });
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
let editingUpdatedAt = null; // para detectar si otra persona la cambió mientras se edita
async function openEdit(id) {
  // B-2: trae solo la orden a editar, no toda la lista.
  const r = await api('/api/orders/' + encodeURIComponent(id));
  if (r.status === 401) return sessionExpired();
  if (!r.ok) return;
  const o = await r.json();
  if (!o || !o.id) return;
  editingId = o.id;
  editingUpdatedAt = o.updated_at;
  document.getElementById('edit-ticket').textContent = o.ticket;
  document.getElementById('e-name').value = o.customer_name;
  document.getElementById('e-phone').value = o.phone || '';
  document.getElementById('e-model').value = o.model;
  document.getElementById('e-imei').value = o.imei || '';
  document.getElementById('e-received-by').value = o.received_by;
  document.getElementById('e-technician').value = o.assigned_technician || '';
  document.getElementById('e-promised-at').value = o.promised_at || '';
  document.getElementById('e-agreement').value = o.agreement;
  document.getElementById('e-price').value = o.price ?? '';
  document.getElementById('e-optin').checked = o.marketing_opt_in === 1;
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
    price: document.getElementById('e-price').value,
    marketing_opt_in: document.getElementById('e-optin').checked,
    agreement: document.getElementById('e-agreement').value,
    diagnostic_note: document.getElementById('e-diagnostic').value,
    status: document.getElementById('e-status').value,
    expected_updated_at: editingUpdatedAt
  };
  try {
    const r = await api('/api/orders/' + editingId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (r.status === 401) { document.getElementById('edit-modal').classList.add('hidden'); return sessionExpired(); }
    const data = await r.json();
    if (!r.ok) {
      err.textContent = (data.errors || [data.error || 'Error al guardar.']).join(' ');
      err.classList.remove('hidden');
      focusFirstInvalid('e');
      return;
    }
    document.getElementById('edit-modal').classList.add('hidden');
    loadOrders({ keepPage: true });
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
      ${o.warranty_result ? `<p><strong>Garantía:</strong> ${esc(o.warranty_result)}</p>` : ''}
      ${o.warranty_until ? `<p><strong>Garantía hasta:</strong> ${esc(o.warranty_until)}</p>` : ''}
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

// ---------- Panel operativo (v1.4.0) ----------
// Fluido: filtros se aplican solos, el contenido anterior se mantiene visible
// mientras carga y se ignoran respuestas viejas si el usuario cambia rápido.
let dashboardSeq = 0;
let dashboardTimer = null;
let insightsData = null;
function scheduleDashboard() {
  clearTimeout(dashboardTimer);
  dashboardTimer = setTimeout(loadDashboard, 250);
}
document.getElementById('dashboard-filters').addEventListener('submit', e => {
  e.preventDefault();
  loadDashboard();
});
for (const id of ['dash-status', 'dash-technician', 'dash-device']) {
  document.getElementById(id).addEventListener('change', scheduleDashboard);
}
for (const id of ['dash-from', 'dash-to']) {
  document.getElementById(id).addEventListener('change', () => {
    document.querySelectorAll('#dash-ranges .range-chip').forEach(b => b.classList.remove('active'));
    scheduleDashboard();
  });
}
document.querySelectorAll('#dash-ranges .range-chip').forEach(btn => {
  btn.addEventListener('click', () => {
    const today = new Date();
    let from = new Date(today);
    const r = btn.dataset.range;
    if (r === 'month') from = new Date(today.getFullYear(), today.getMonth(), 1);
    else if (r === 'year') from = new Date(today.getFullYear(), 0, 1);
    else if (r !== 'today') from.setDate(today.getDate() - (Number(r) - 1));
    document.getElementById('dash-from').value = localDateInput(from);
    document.getElementById('dash-to').value = localDateInput(today);
    document.querySelectorAll('#dash-ranges .range-chip').forEach(b => b.classList.toggle('active', b === btn));
    loadDashboard();
  });
});
document.querySelectorAll('#dash-subtabs .subtab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#dash-subtabs .subtab').forEach(b => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.dash-pane').forEach(p => p.classList.toggle('active', p.id === 'pane-' + btn.dataset.pane));
  });
});

function dashboardQuery() {
  return new URLSearchParams({
    from: document.getElementById('dash-from').value,
    to: document.getElementById('dash-to').value,
    status: document.getElementById('dash-status').value,
    technician: document.getElementById('dash-technician').value,
    device_type: document.getElementById('dash-device').value
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

async function loadDashboard(opts) {
  const silent = !!(opts && opts.silent === true); // refresco automático: sin "Actualizando…"
  const seq = ++dashboardSeq;
  const state = document.getElementById('dashboard-state');
  const content = document.getElementById('dashboard-content');
  const firstLoad = content.classList.contains('hidden');
  if (!silent) {
    state.textContent = firstLoad ? 'Cargando datos del taller…' : 'Actualizando…';
    state.classList.remove('error');
    content.classList.add('is-loading');
  }
  try {
    const range = new URLSearchParams({ from: document.getElementById('dash-from').value, to: document.getElementById('dash-to').value });
    const [dashRes, insRes] = await Promise.all([
      api('/api/dashboard?' + dashboardQuery()),
      api('/api/insights?' + range)
    ]);
    if (seq !== dashboardSeq) return; // llegó una respuesta vieja: se ignora
    if (dashRes.status === 401 || insRes.status === 401) return sessionExpired();
    const data = await dashRes.json();
    const insights = await insRes.json();
    if (!dashRes.ok) throw new Error(data.error || 'No se pudo cargar el panel.');
    if (!insRes.ok) throw new Error(insights.error || 'No se pudo cargar el panel.');
    loadBackupStatus();
    updateDeviceOptions(data.deviceTypes || []);
    peekCache.clear();
    closePeek();
    renderDashboard(data);
    insightsData = insights;
    renderInsights(insights);
    content.classList.remove('hidden');
    state.textContent = data.created.length ? '' : 'No hay órdenes en el período seleccionado.';
  } catch (error) {
    if (seq !== dashboardSeq) return;
    state.textContent = error.message || 'No se pudo cargar el panel. Revisa la conexión.';
    state.classList.add('error');
  } finally {
    if (seq === dashboardSeq) content.classList.remove('is-loading');
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
  // Filtros del panel que también aplican a las tarjetas (no las fechas: son "ahora").
  const kpiBase = {
    status: document.getElementById('dash-status').value,
    technician: document.getElementById('dash-technician').value,
    device_type: document.getElementById('dash-device').value
  };
  const today = localDateInput(new Date());
  const kpiParams = [
    { from: today, to: today },
    { open_only: '1' },
    { status: 'En reparación' },
    { status: 'Listo' },
    { status: 'Entregado', completed_from: today, completed_to: today },
    { aging_bucket: '3_plus' },
    { overdue: '1' },
    { status: 'Listo', pickup_bucket: 'over_48' }
  ];
  const kpis = document.getElementById('dashboard-kpis');
  kpis.innerHTML = items.map(([label, value, alert], i) => `
    <button type="button" class="kpi-card peekable${alert && value ? ' alert' : ''}" data-i="${i}">
      <span class="kpi-label">${esc(label)}</span>
      <strong class="kpi-value">${Number(value) || 0}</strong></button>`).join('');
  kpis.querySelectorAll('.kpi-card').forEach(b => b.addEventListener('click', () => {
    const [label] = items[b.dataset.i];
    togglePeek(b, { title: label, params: { ...kpiBase, ...kpiParams[b.dataset.i] }, anchor: kpis });
  }));

  const base = {
    from: document.getElementById('dash-from').value,
    to: document.getElementById('dash-to').value,
    status: document.getElementById('dash-status').value,
    technician: document.getElementById('dash-technician').value,
    device_type: document.getElementById('dash-device').value
  };
  const withBase = extra => ({ ...base, ...extra });
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
  const dur = h => h < 48 ? `${Math.round(h * 10) / 10} h` : `${Math.round(h / 24 * 10) / 10} días`;
  const turnaroundItems = data.turnaround.byTechnician.filter(x => x.count > 0).map(x => ({
    // Siempre en horas en las barras, para poder comparar técnicos de un vistazo.
    ...x, label: `${x.label} · ${x.count}`, display: `${Math.round(x.value * 10) / 10} h`, value: x.value
  }));
  const t = data.turnaround;
  document.getElementById('turnaround-summary').textContent = t.medianHours === null
    ? 'Sin entregas con marcas de tiempo válidas en este período.'
    : `Reparación típica (recibido → listo): ${dur(t.medianHours)}` +
      (t.medianPickupHours !== null ? ` · Espera típica de recogida (listo → entregado): ${dur(t.medianPickupHours)}` : '') +
      ` · ${t.completedCount} entregas. "Típica" = la mitad tarda menos y la otra mitad más (mediana); cuenta horas de calendario, incluidas noches y domingos.`;
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
  // La cifra de la barra sale de valueOf (antes "Entregadas por técnico"
  // mostraba por error la cifra de pendientes).
  const numberOf = item => { const v = valueOf(item); return typeof v === 'number' ? v : (Number(item.value) || 0); };
  const max = Math.max(1, ...items.map(numberOf));
  const panelTitle = (target.closest('.chart-panel')?.querySelector('h3')?.textContent || '').trim();
  const section = target.lastElementChild?.classList.contains('chart-subheading') ? target.lastElementChild.textContent : '';
  items.forEach((item, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'bar-row';
    const number = numberOf(item);
    const display = typeof valueOf(item) === 'string' ? valueOf(item) : `${number}${suffix ? ` ${suffix}` : ''}`;
    button.setAttribute('aria-label', `Ver órdenes: ${item.label}, ${display}`);
    button.innerHTML = `<span class="bar-label">${esc(item.label)}</span>
      <progress class="bar-progress" max="${max}" value="${number}" aria-hidden="true"></progress>
      <span class="bar-value">${esc(display)}</span>`;
    button.addEventListener('click', () => togglePeek(button, {
      title: `${section ? section.charAt(0) + section.slice(1).toLowerCase() : panelTitle} · ${String(item.label).split(' · ')[0]}`,
      params: paramsFor(item, index), anchor: target,
    }));
    target.appendChild(button);
  });
}

function openOrdersFromChart(params) {
  document.getElementById('orders-search').value = params.search || '';
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
  const extraIds = ['aging_bucket', 'pickup_bucket', 'open_only', 'overdue', 'completed_technician', 'completed_from', 'completed_to', 'completed_unassigned', 'unassigned', 'warranty_only'];
  extraIds.forEach(key => {
    const value = query.get(key);
    if (value) document.getElementById('orders-list').dataset[key] = value;
    else delete document.getElementById('orders-list').dataset[key];
  });
  loadOrders(params);
}

document.getElementById('dashboard-export').addEventListener('click', async () => {
  const button = document.getElementById('dashboard-export');
  const original = button.textContent;
  button.disabled = true;
  button.textContent = 'Preparando…';
  try {
    const query = dashboardQuery();
    const response = await api('/api/orders?' + query);
    if (!response.ok) throw new Error('No se pudo generar el reporte.');
    const orders = await response.json();
    const columns = [
      ['Ticket', 'ticket'], ['Cliente', 'customer_name'], ['Teléfono', 'phone'], ['Equipo', 'device_type'],
      ['Modelo', 'model'], ['Problemas', o => o.problems.join('; ')], ['Estado', 'status'],
      ['Técnico asignado', 'assigned_technician'], ['Precio', 'price'], ['Acepta promociones', o => o.marketing_opt_in === 1 ? 'Sí' : 'No'], ['Recibió', 'received_by'], ['Fecha de ingreso', 'created_at'],
      ['Fecha prometida', 'promised_at'], ['Último cambio de estado', 'status_changed_at'],
      ['Garantía', o => o.warranty_of_ticket ? `De ${o.warranty_of_ticket}: ${o.warranty_result || ''}`
        : (o.warranty_until ? `Hasta ${o.warranty_until}` : '')]
    ];
    csvDownload(`reporte-ordenes-${localDateInput(new Date())}.csv`, columns, orders);
  } catch (error) {
    alert(error.message || 'No se pudo generar el reporte.');
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
});

// ---------- Garantía / Devolución (v1.4.0) ----------
// El servidor decide el resultado; aquí solo se muestra una vista previa.
const WARRANTY_CAUSES = {
  'Falla de fábrica / de la reparación': 'fabrica',
  'Daño del cliente (partido, golpe, mojado…)': 'cliente'
};
// Señales en "¿Cómo llegó?" que suelen indicar daño del cliente.
const DAMAGE_SIGNS = ['Mojado', 'Backglass partido', 'Golpes visibles'];

function warrantyClaimLine(o) {
  if (!o.warranty_of_ticket) return '';
  const cls = { 'Cubierta': 'covered', 'No cubierta': 'not-covered', 'Vencida': 'expired' }[o.warranty_result] || 'expired';
  return `<p class="warranty-claim ${cls}">↩ Garantía de ${esc(o.warranty_of_ticket)} · <strong>${esc(o.warranty_result || '')}</strong>${o.warranty_reason ? ` · ${esc(o.warranty_reason)}` : ''}</p>`;
}

function warrantyStatusLine(o) {
  if (o.status !== 'Entregado' || !o.warranty_until) return '';
  if (o.warranty_active) {
    const days = o.warranty_days_left === 0 ? 'último día' : `quedan ${o.warranty_days_left} días`;
    return `<p class="warranty-line ok">🛡 Garantía hasta ${esc(o.warranty_until)} · ${esc(days)}</p>`;
  }
  return `<p class="warranty-line expired">Garantía vencida el ${esc(o.warranty_until)}</p>`;
}

buildChips('w-problems', PROBLEMS, { multi: true });
buildChips('w-arrival', ARRIVAL, { multi: true, onChange: updateWarrantyPreview });
buildChips('w-cause', Object.keys(WARRANTY_CAUSES), { onChange: updateWarrantyPreview });

let warrantyOrder = null;
async function openWarranty(id) {
  const r = await api('/api/orders/' + encodeURIComponent(id));
  if (r.status === 401) return sessionExpired();
  if (!r.ok) return alert('No se pudo abrir la orden.');
  const o = await r.json();
  warrantyOrder = o;
  document.getElementById('w-ticket').textContent = o.ticket;
  const info = document.getElementById('w-info');
  info.innerHTML = `
    <p><strong>${esc(o.customer_name)}</strong> · ${esc(o.device_type)} · ${esc(o.model)}${o.phone ? ' · ' + esc(o.phone) : ''}</p>
    <p>Se reparó: ${o.problems.map(esc).join(', ')}</p>
    <p>Entregado: ${esc((o.delivered_at || '').slice(0, 10) || '—')}</p>
    ${warrantyStatusLine(o)}`;
  document.getElementById('warranty-form').reset();
  ['w-problems', 'w-arrival', 'w-cause'].forEach(cid => setSelected(cid, []));
  document.getElementById('w-error').classList.add('hidden');
  document.getElementById('warranty-form').classList.remove('hidden');
  document.getElementById('w-success').classList.add('hidden');
  updateWarrantyPreview();
  document.getElementById('warranty-modal').classList.remove('hidden');
}

function updateWarrantyPreview() {
  const out = document.getElementById('w-result');
  const warn = document.getElementById('w-damage-warning');
  const causeLabel = getSelected('w-cause')[0];
  const cause = WARRANTY_CAUSES[causeLabel];
  const signs = getSelected('w-arrival').filter(x => DAMAGE_SIGNS.includes(x));
  warn.classList.toggle('hidden', !(cause === 'fabrica' && signs.length));
  warn.textContent = `Ojo: marcaste ${signs.join(', ')}. Revisa bien si de verdad es falla de fábrica.`;
  out.className = 'warranty-result';
  if (warrantyOrder && warrantyOrder.warranty_active === false) {
    out.classList.add('expired');
    out.textContent = 'Garantía VENCIDA (pasaron más de 60 días). Se cobra como reparación normal.';
  } else if (cause === 'cliente') {
    out.classList.add('not-covered');
    out.textContent = 'NO CUBIERTA: es daño del cliente. Se cobra como reparación normal.';
  } else if (cause === 'fabrica') {
    out.classList.add('covered');
    out.textContent = 'CUBIERTA por garantía: sin costo para el cliente.';
  } else {
    out.textContent = 'Elige qué lo causó para ver si cubre la garantía.';
  }
}

document.getElementById('warranty-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = document.getElementById('w-error');
  err.classList.add('hidden');
  const body = {
    problems: getSelected('w-problems'),
    arrival_condition: getSelected('w-arrival'),
    diagnostic_note: document.getElementById('w-diagnostic').value,
    cause: WARRANTY_CAUSES[getSelected('w-cause')[0]] || '',
    assigned_technician: document.getElementById('w-technician').value,
    promised_at: document.getElementById('w-promised-at').value,
    price: document.getElementById('w-price').value,
    agreement: document.getElementById('w-agreement').value
  };
  try {
    const r = await api('/api/orders/' + warrantyOrder.id + '/warranty', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (r.status === 401) { document.getElementById('warranty-modal').classList.add('hidden'); return sessionExpired(); }
    const data = await r.json();
    if (!r.ok) {
      err.textContent = data.errors ? data.errors.join(' ') : (data.error || 'Error al guardar.');
      err.classList.remove('hidden');
      return;
    }
    document.getElementById('warranty-form').classList.add('hidden');
    document.getElementById('w-success-label').textContent = `¡Garantía abierta! Resultado: ${data.warranty_result}`;
    document.getElementById('w-ticket-big').textContent = data.ticket;
    document.getElementById('w-code-big').textContent = data.customer_code || '—';
    document.getElementById('w-success').classList.remove('hidden');
  } catch {
    err.textContent = 'No se pudo conectar con el servidor.';
    err.classList.remove('hidden');
  }
});

function closeWarranty() {
  document.getElementById('warranty-modal').classList.add('hidden');
  loadOrders({ keepPage: true });
}
document.getElementById('btn-warranty-cancel').addEventListener('click', () =>
  document.getElementById('warranty-modal').classList.add('hidden'));
document.getElementById('btn-warranty-close').addEventListener('click', closeWarranty);
document.getElementById('warranty-modal').addEventListener('click', (e) => {
  if (e.target.id === 'warranty-modal') e.target.classList.add('hidden');
});

// ---------- Insights: clientes, marketing, repuestos (v1.4.0) ----------
function csvDownload(filename, columns, rows) {
  // Evita que Excel ejecute fórmulas escritas en los datos (= + - @).
  const cell = value => {
    let text = String(value ?? '');
    if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return `"${text.replace(/"/g, '""')}"`;
  };
  const csv = '﻿' + [columns.map(([label]) => cell(label)).join(','),
    ...rows.map(r => columns.map(([, key]) => cell(typeof key === 'function' ? key(r) : r[key])).join(','))].join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function changeBadge(change, { inverse = false } = {}) {
  if (change === null) return '<span class="delta up">nuevo</span>';
  if (!change) return '<span class="delta flat">≈ igual</span>';
  const good = inverse ? change < 0 : change > 0;
  return `<span class="delta ${good ? 'up' : 'down'}">${change > 0 ? '▲' : '▼'} ${Math.abs(change)}%</span>`;
}

function fmtDate(d) {
  if (!d) return '—';
  const [y, m, day] = d.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, day).toLocaleDateString('es-US', { day: 'numeric', month: 'short', year: 'numeric' });
}

function renderInsights(ins) {
  const p = ins.period;
  document.getElementById('dash-period-label').textContent =
    `${fmtDate(p.from)} – ${fmtDate(p.to)} (${p.days} ${p.days === 1 ? 'día' : 'días'}) · comparado con ${fmtDate(p.prevFrom)} – ${fmtDate(p.prevTo)}`;

  // Resumen comparado
  const s = ins.summary;
  const plain = v => String(v);
  const cards = [
    ['Órdenes recibidas', s.orders, plain],
    ['Entregadas', s.delivered, plain],
    ['Cobrado (entregadas)', s.revenue, money],
    ['Ticket promedio', s.avgTicket, money],
    ['Garantías del período', s.warrantyClaims, plain, true,
      s.warrantyClaims.value ? `${s.warrantyCovered} cubiertas por el taller` : ''],
  ];
  // Qué órdenes hay detrás de cada tarjeta (el promedio no es una lista).
  const compareParams = [
    { from: p.from, to: p.to },
    { status: 'Entregado', completed_from: p.from, completed_to: p.to },
    { status: 'Entregado', completed_from: p.from, completed_to: p.to },
    null,
    { from: p.from, to: p.to, warranty_only: '1' },
  ];
  const compare = document.getElementById('dash-compare');
  compare.innerHTML = cards.map(([label, m, fmt, inverse, extra = ''], i) => `
    <${compareParams[i] ? `button type="button" class="compare-card peekable" data-i="${i}"` : 'div class="compare-card"'}><span class="kpi-label">${esc(label)}</span>
      <strong class="kpi-value">${esc(fmt(m.value))}</strong>${extra ? `<span class="compare-extra">${esc(extra)}</span>` : ''}
      <span class="compare-prev">${changeBadge(m.change, { inverse: !!inverse })} <small>antes: ${esc(fmt(m.previous))}</small></span>
    </${compareParams[i] ? 'button' : 'div'}>`).join('') + (s.pricedShare !== null && s.pricedShare < 100
      ? `<p class="compare-note">Solo ${s.pricedShare}% de las órdenes entregadas tienen precio anotado. Para ingresos exactos, llena "Precio acordado" al recibir cada equipo.</p>` : '');

  compare.querySelectorAll('.compare-card.peekable').forEach(b => b.addEventListener('click', () =>
    togglePeek(b, { title: `${cards[b.dataset.i][0]} (período)`, params: compareParams[b.dataset.i], anchor: compare })));
  renderMoney(ins.pipeline);
  renderCustomers(ins.customers);
  renderSegments(ins.segments);
  renderStock(ins.stock);
}

function renderMoney(pl) {
  const box = (label, m, cls, filter) => `
    <button type="button" class="money-card ${cls}" data-status="${esc(filter)}">
      <span class="kpi-label">${esc(label)}</span>
      <strong class="money-value">${esc(money(m.value))}</strong>
      <span class="money-sub">${m.count} ${m.count === 1 ? 'orden' : 'órdenes'}${m.withoutPrice ? ` · <em>${m.withoutPrice} sin precio</em>` : ''}</span>
    </button>`;
  document.getElementById('dash-money').innerHTML =
    box('Total abierto', pl.open, 'money-total', '') +
    box('Recibido (sin empezar)', pl.received, '', 'Recibido') +
    box('En reparación', pl.inRepair, '', 'En reparación') +
    box('Listo para cobrar', pl.ready, 'money-ready', 'Listo');
  const moneyGrid = document.getElementById('dash-money');
  moneyGrid.querySelectorAll('.money-card').forEach(b => b.addEventListener('click', () => {
    const status = b.dataset.status;
    togglePeek(b, { title: b.querySelector('.kpi-label').textContent,
      params: status ? { status } : { open_only: '1' }, anchor: moneyGrid, money: true });
  }));
  const notes = [`Cobrado hoy: ${money(pl.collectedToday)}.`];
  if (pl.readyWaiting48h.count) notes.push(`${money(pl.readyWaiting48h.value)} en ${pl.readyWaiting48h.count} órdenes listas hace más de 48 h: llama a esos clientes.`);
  if (pl.open.withoutPrice) notes.push(`${pl.open.withoutPrice} órdenes abiertas no tienen precio: edítalas para que el total sea exacto.`);
  document.getElementById('dash-money-note').textContent = notes.join(' ');
}

function renderCustomers(c) {
  const k = c.summary;
  document.getElementById('cust-kpis').innerHTML = [
    ['Clientes en el período', k.inPeriod, ''],
    ['Clientes nuevos', k.new.value, changeBadge(k.new.change)],
    ['Clientes que volvieron', `${k.returning} · ${k.returningRate}%`, ''],
    ['Aceptan promociones', `${k.optedIn} de ${k.total}`, ''],
  ].map(([label, value, extra]) => `<div class="kpi-card"><span class="kpi-label">${esc(label)}</span>
      <strong class="kpi-value">${esc(value)}</strong>${extra ? `<span class="compare-prev">${extra}</span>` : ''}</div>`).join('')
    + (k.noPhoneInPeriod ? `<p class="compare-note">${k.noPhoneInPeriod} órdenes del período no tienen teléfono: esos clientes no se pueden volver a contactar.</p>` : '');
  drawCustomerTable();
}

function drawCustomerTable() {
  if (!insightsData) return;
  const q = document.getElementById('cust-search').value.trim().toLowerCase();
  const digits = q.replace(/\D/g, '');
  const list = insightsData.customers.all.filter(c => !q ||
    c.name.toLowerCase().includes(q) || (digits && c.phone.replace(/\D/g, '').includes(digits)));
  const shown = list.slice(0, q ? 50 : 15);
  document.getElementById('cust-table').innerHTML = `
    <thead><tr><th>Cliente</th><th>Teléfono</th><th class="num">Visitas</th><th class="num">Gastado</th><th>Última visita</th><th>Equipos</th><th>Promos</th></tr></thead>
    <tbody>${shown.map((c, i) => `<tr class="peekable-row" tabindex="0" data-i="${i}">
      <td><strong>${esc(c.name)}</strong>${c.warrantyClaims ? ` <span class="pill pill-warn">${c.warrantyClaims} garantía${c.warrantyClaims > 1 ? 's' : ''}</span>` : ''}</td>
      <td>${esc(c.phone || '—')}</td>
      <td class="num">${c.visits}</td>
      <td class="num">${c.spent ? esc(money(c.spent)) : '—'}</td>
      <td>${esc(fmtDate(c.last))} <small class="muted">(${c.daysSinceLast} d)</small></td>
      <td>${esc(c.models.join(', '))}</td>
      <td>${c.optIn ? '<span class="pill pill-ok">Sí</span>' : '<span class="pill">No</span>'}</td>
    </tr>`).join('') || '<tr><td colspan="7" class="muted">Sin clientes.</td></tr>'}</tbody>`
    + (list.length > shown.length ? `<caption class="table-more">Mostrando ${shown.length} de ${list.length}. Busca o descarga el CSV para ver todos.</caption>` : '');
  const table = document.getElementById('cust-table');
  table.querySelectorAll('.peekable-row').forEach(row => {
    const c = shown[row.dataset.i];
    const open = () => togglePeek(row, { title: `Órdenes de ${c.name}`,
      params: { search: c.phone ? c.phone.replace(/\D/g, '') : c.name }, anchor: table.parentElement });
    row.addEventListener('click', open);
    row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  });
}
document.getElementById('cust-search').addEventListener('input', drawCustomerTable);
document.getElementById('cust-export').addEventListener('click', () => {
  if (!insightsData) return;
  csvDownload(`clientes-${localDateInput(new Date())}.csv`, [
    ['Nombre', 'name'], ['Teléfono', 'phone'], ['Visitas', 'visits'], ['Gastado', 'spent'],
    ['Primera visita', 'first'], ['Última visita', 'last'], ['Equipos', c => c.models.join('; ')],
    ['Garantías', 'warrantyClaims'], ['Acepta promociones', c => c.optIn ? 'Sí' : 'No']
  ], insightsData.customers.all);
});

function renderSegments(segments) {
  const box = document.getElementById('mkt-segments');
  box.innerHTML = segments.map(sg => `
    <section class="segment-card">
      <h3>${esc(sg.title)}${sg.transactional ? ' <span class="pill pill-ok">Aviso de servicio</span>' : ''}</h3>
      <p class="segment-action">→ ${esc(sg.action)}</p>
      <div class="segment-numbers">
        <span><strong>${sg.total}</strong> clientes</span>
        <span><strong>${sg.contactable}</strong> ${sg.transactional ? 'con teléfono' : 'contactables'}</span>
      </div>
      <div class="segment-buttons">
        <button type="button" class="btn-secondary btn-small" data-seg-view="${esc(sg.id)}" ${sg.contactable ? '' : 'disabled'}>Ver lista</button>
        <button type="button" class="btn-secondary btn-small" data-seg-csv="${esc(sg.id)}" ${sg.contactable ? '' : 'disabled'}>Descargar CSV</button>
      </div>
      <div class="segment-list hidden" id="seg-list-${esc(sg.id)}">
        ${sg.contacts.slice(0, 30).map(c => `<p><strong>${esc(c.name)}</strong> · ${esc(c.phone)} · ${esc(c.model)} <small class="muted">${esc(c.detail)}</small></p>`).join('')}
        ${sg.contacts.length > 30 ? `<p class="muted">…y ${sg.contacts.length - 30} más en el CSV.</p>` : ''}
      </div>
    </section>`).join('');
  box.querySelectorAll('[data-seg-view]').forEach(b => b.addEventListener('click', () =>
    document.getElementById('seg-list-' + b.dataset.segView).classList.toggle('hidden')));
  box.querySelectorAll('[data-seg-csv]').forEach(b => b.addEventListener('click', () => {
    const sg = segments.find(x => x.id === b.dataset.segCsv);
    csvDownload(`marketing-${sg.id}-${localDateInput(new Date())}.csv`, [
      ['Nombre', 'name'], ['Teléfono', 'phone'], ['Equipo', 'model'], ['Fecha', 'date'], ['Detalle', 'detail'], ['Acción sugerida', () => sg.action]
    ], sg.contacts);
  }));
}

function renderStock(stock) {
  document.getElementById('stock-rules').textContent =
    `Demanda calculada con los últimos ${stock.rules.demandWindowDays} días. "Stock sugerido" = lo que se usa en ${stock.rules.stockWeeks} semanas. ` +
    '"Vuelven por garantía" mide la calidad del repuesto o proveedor: si es alto, cambia de proveedor.';
  const priorityClass = { Alta: 'pill-alert', Media: 'pill-warn', Baja: '' };
  document.getElementById('stock-table').innerHTML = `
    <thead><tr><th>Prioridad</th><th>Repuesto</th><th>Modelo</th><th class="num">En el período</th><th class="num">Tendencia</th><th class="num">Por semana</th><th class="num">Stock sugerido</th><th class="num">Vuelven por garantía</th></tr></thead>
    <tbody>${stock.parts.map(r => `<tr>
      <td><span class="pill ${priorityClass[r.priority]}">${esc(r.priority)}</span></td>
      <td><strong>${esc(r.part)}</strong></td>
      <td>${esc(r.model)}</td>
      <td class="num">${r.period} <small class="muted">(antes ${r.previous})</small></td>
      <td class="num">${changeBadge(r.trend)}</td>
      <td class="num">${r.perWeek}</td>
      <td class="num"><strong>${r.suggested}</strong></td>
      <td class="num">${r.warrantyReturns ? `<span class="pill ${r.returnRate >= 10 ? 'pill-alert' : 'pill-warn'}">${r.warrantyReturns} · ${r.returnRate}%</span>` : '0'}</td>
    </tr>`).join('') || '<tr><td colspan="8" class="muted">Todavía no hay reparaciones con repuesto en los últimos 90 días.</td></tr>'}</tbody>`;
  document.getElementById('models-table').innerHTML = `
    <thead><tr><th>Modelo</th><th class="num">Órdenes</th><th class="num">Tendencia</th></tr></thead>
    <tbody>${stock.topModels.map(m => `<tr><td>${esc(m.label)}</td><td class="num">${m.value} <small class="muted">(antes ${m.previous})</small></td><td class="num">${changeBadge(m.change)}</td></tr>`).join('')
      || '<tr><td colspan="3" class="muted">Sin órdenes en el período.</td></tr>'}</tbody>`;
  document.getElementById('acc-table').innerHTML = `
    <thead><tr><th>Modelo</th><th class="num">Fundas / protectores</th><th class="num">Cargadores</th></tr></thead>
    <tbody>${stock.accessories.map(a => `<tr><td>${esc(a.model)}</td><td class="num">${a.cases}</td><td class="num">${a.chargers}</td></tr>`).join('')
      || '<tr><td colspan="3" class="muted">Sin oportunidades en el período.</td></tr>'}</tbody>`;
}

// ---------- Cliente conocido en el mostrador (v1.4.0) ----------
// Al escribir el teléfono se busca el historial: evita duplicar órdenes y
// avisa si el equipo está en garantía (para no cobrar lo que es gratis).
let lookupTimer = null;
let lookupSeq = 0;
function clearCustomerMatch() {
  const box = document.getElementById('f-customer-match');
  box.classList.add('hidden');
  box.replaceChildren();
}
document.getElementById('f-phone').addEventListener('input', () => {
  clearTimeout(lookupTimer);
  lookupTimer = setTimeout(lookupCustomer, 350);
});

async function lookupCustomer() {
  const phone = document.getElementById('f-phone').value;
  const seq = ++lookupSeq;
  if (phone.replace(/\D/g, '').length < 7) return clearCustomerMatch();
  try {
    const r = await api('/api/customers/lookup?phone=' + encodeURIComponent(phone));
    if (seq !== lookupSeq) return;
    if (r.status === 401) return sessionExpired();
    const c = r.ok ? await r.json() : { found: false };
    if (!c.found) return clearCustomerMatch();
    renderCustomerMatch(c);
  } catch { clearCustomerMatch(); }
}

function renderCustomerMatch(c) {
  const box = document.getElementById('f-customer-match');
  const dev = o => `${o.device_type === 'Otro' || o.model.toLowerCase().startsWith(o.device_type.toLowerCase()) ? '' : o.device_type + ' '}${o.model}`;
  box.innerHTML = `
    <p class="match-title">👤 Cliente que ya vino: <strong>${esc(c.name)}</strong> · ${c.visits} ${c.visits === 1 ? 'visita' : 'visitas'}${c.spent ? ` · ${esc(money(c.spent))}` : ''}</p>
    ${c.inWarranty.map(o => `
      <div class="match-row match-warranty">
        <span>🛡 <strong>En garantía:</strong> ${esc(o.ticket)} · ${esc(dev(o))} (${esc(o.problems.join(', '))}) · hasta ${esc(o.warranty_until)}</span>
        <button type="button" class="btn-small btn-match-warranty" data-id="${o.id}">Abrir garantía</button>
      </div>`).join('')}
    ${c.open.map(o => `
      <div class="match-row match-open">
        <span>⚠ <strong>Ya tiene una orden abierta:</strong> ${esc(o.ticket)} · ${esc(dev(o))} · ${esc(o.status)}</span>
        <button type="button" class="btn-small btn-match-open" data-ticket="${esc(o.ticket)}">Ver</button>
      </div>`).join('')}
    <p class="match-recent">Últimas: ${c.recent.map(o => `${esc(o.ticket)} ${esc(dev(o))} (${esc(o.problems.join(', '))})`).join(' · ')}</p>
    <button type="button" class="btn-small btn-match-fill">Usar sus datos</button>`;
  box.classList.remove('hidden');
  box.querySelector('.btn-match-fill').addEventListener('click', () => {
    document.getElementById('f-name').value = c.name;
    document.getElementById('f-optin').checked = !!c.optIn;
  });
  box.querySelectorAll('.btn-match-warranty').forEach(b => b.addEventListener('click', () => openWarranty(b.dataset.id)));
  box.querySelectorAll('.btn-match-open').forEach(b => b.addEventListener('click', () => {
    document.getElementById('orders-search').value = b.dataset.ticket;
    document.querySelector('.tab[data-view=orders]').click();
  }));
}

// ---------- Vista rápida: clic en tarjeta o barra -> 6 órdenes más recientes ----------
// Una sola lista abierta a la vez (segundo clic o Esc la cierra). Cada consulta
// pide solo 6 órdenes y se guarda en memoria hasta que cambian los filtros.
const peekCache = new Map();
let peekKey = null;
let peekSeq = 0;
let peekTrigger = null;

function closePeek() {
  peekKey = null;
  peekSeq++;
  document.getElementById('peek')?.remove();
  if (peekTrigger) {
    peekTrigger.classList.remove('is-open');
    peekTrigger.setAttribute('aria-expanded', 'false');
  }
  peekTrigger = null;
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const ms = Date.now() - Date.parse(dateStr.replace(' ', 'T'));
  const h = Math.floor(ms / 3600000);
  if (h < 1) return 'hace minutos';
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} ${d === 1 ? 'día' : 'días'}`;
}

function cleanParams(params) {
  return Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v !== null && v !== undefined));
}

async function togglePeek(trigger, { title, params, anchor, money = false }) {
  const clean = cleanParams(params);
  const key = new URLSearchParams(clean).toString();
  if (peekTrigger === trigger && peekKey === key) return closePeek();
  closePeek();
  peekKey = key;
  peekTrigger = trigger;
  trigger.classList.add('is-open');
  trigger.setAttribute('aria-expanded', 'true');
  const el = document.createElement('div');
  el.id = 'peek';
  el.className = 'peek' + (money ? ' peek-dark' : '');
  el.setAttribute('aria-live', 'polite');
  el.innerHTML = '<p class="drop-empty">Cargando…</p>';
  anchor.after(el);
  const seq = ++peekSeq;
  try {
    let data = peekCache.get(key);
    if (!data) {
      const r = await api('/api/orders?' + new URLSearchParams({ ...clean, limit: '6' }));
      if (r.status === 401) return sessionExpired();
      if (!r.ok) throw new Error();
      data = { orders: await r.json(), total: Number(r.headers.get('X-Total-Count')) || 0 };
      peekCache.set(key, data);
    }
    if (seq !== peekSeq) return; // el usuario ya abrió otra
    renderPeek(el, title, clean, data);
    if (el.getBoundingClientRect().bottom > window.innerHeight) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch {
    if (seq === peekSeq) el.innerHTML = '<p class="drop-empty">No se pudo cargar. Revisa la conexión.</p>';
  }
}

function renderPeek(el, title, params, { orders, total }) {
  const dev = o => `${o.device_type === 'Otro' || o.model.toLowerCase().startsWith(o.device_type.toLowerCase()) ? '' : o.device_type + ' '}${o.model}`;
  const oneStatus = !!params.status;
  el.innerHTML = `
    <div class="drop-head">
      <strong>${esc(title)}</strong>
      <span>${orders.length ? `Las ${orders.length} más recientes de ${total}` : ''}</span>
      <button type="button" class="drop-close" aria-label="Cerrar lista">✕</button>
    </div>
    ${orders.length ? `<ul class="drop-list">${orders.map(o => `
      <li><button type="button" class="drop-item" data-ticket="${esc(o.ticket)}">
        <span class="drop-ticket">${esc(o.ticket)}</span>
        <span class="drop-main"><strong>${esc(o.customer_name)}</strong> · ${esc(dev(o))}
          <small>${esc(o.problems.join(', '))}${oneStatus ? '' : ` · <span class="status-badge ${statusCssClass(o.status)}">${esc(o.status)}</span>`}</small></span>
        <span class="drop-side"><strong>${o.price !== null && o.price !== undefined ? esc(money(o.price)) : '<em>sin precio</em>'}</strong>
          <small>${esc(`${o.status} ${timeAgo(o.status_changed_at || o.created_at)}`)}</small></span>
      </button></li>`).join('')}</ul>` : '<p class="drop-empty">No hay órdenes aquí.</p>'}
    ${total > orders.length ? `<button type="button" class="drop-all">Ver todas (${total}) →</button>` : ''}`;
  el.querySelector('.drop-close').addEventListener('click', closePeek);
  el.querySelectorAll('.drop-item').forEach(b => b.addEventListener('click', () => goToOrder(b.dataset.ticket)));
  el.querySelector('.drop-all')?.addEventListener('click', () => { closePeek(); openOrdersFromChart(params); });
}

// Abre la pestaña Órdenes mostrando solo esa orden (búsqueda por ticket).
function goToOrder(ticket) {
  closePeek();
  openOrdersFromChart({ search: ticket }); // limpia filtros, busca el ticket y cambia de pestaña
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && peekKey !== null) closePeek(); });

// ---------- Aviso de respaldos automáticos ----------
async function loadBackupStatus() {
  const el = document.getElementById('dash-backup');
  try {
    const r = await api('/api/backup-status');
    if (!r.ok) return el.classList.add('hidden');
    const b = await r.json();
    el.classList.remove('hidden', 'warn');
    if (!b.enabled) {
      el.classList.add('warn');
      el.textContent = '⚠ Respaldos automáticos desactivados en el servidor.';
    } else if (b.lastError && (!b.lastAt || b.lastError > b.lastAt)) {
      el.classList.add('warn');
      el.textContent = '⚠ El último respaldo automático falló. Avisa a quien administra el servidor.';
    } else if (b.lastAt) {
      // lastAt viene en UTC (ISO con Z): se compara directamente con la hora actual.
      const min = Math.max(0, Math.round((Date.now() - Date.parse(b.lastAt)) / 60000));
      const ago = min < 1 ? 'hace menos de 1 minuto' : min < 60 ? `hace ${min} min` : min < 1440 ? `hace ${Math.round(min / 60)} h` : `hace ${Math.round(min / 1440)} días`;
      el.textContent = `🛡 Último respaldo automático: ${ago}${b.pending ? ' · hay cambios nuevos: se respaldan en 1 minuto' : ''}`;
    } else {
      el.textContent = '🛡 Respaldos automáticos activos: el primero se crea con el próximo cambio.';
    }
  } catch { el.classList.add('hidden'); }
}

// ---------- Siempre al día: refresco automático entre equipos ----------
// Todo se guarda en el servidor al instante. Esto solo trae lo que cambiaron
// otras personas: cada 30 s si la pestaña está visible, y al volver a la app.
// No interrumpe: espera si hay un formulario, una lista desplegada o un
// historial abierto.
const LIVE_REFRESH_MS = 30 * 1000;
function busyOnScreen() {
  return !document.getElementById('edit-modal').classList.contains('hidden') ||
    !document.getElementById('warranty-modal').classList.contains('hidden') ||
    peekKey !== null ||
    !!document.querySelector('.order-history:not(.hidden)') ||
    document.activeElement?.id === 'orders-search';
}
function liveRefresh() {
  if (!currentUser || document.visibilityState !== 'visible' || busyOnScreen()) return;
  const view = document.querySelector('main .view.active')?.id;
  if (view === 'view-orders') loadOrders({ keepPage: true });
  else if (view === 'view-dashboard') loadDashboard({ silent: true });
}
setInterval(liveRefresh, LIVE_REFRESH_MS);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') liveRefresh(); });
