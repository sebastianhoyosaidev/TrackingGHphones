// Órdenes de Reparación — Geeks Hollywood (frontend)
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

// ---------- Tabs ----------
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('view-' + btn.dataset.view).classList.add('active');
    if (btn.dataset.view === 'orders') loadOrders();
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
    agreement: document.getElementById('f-agreement').value,
    diagnostic_note: document.getElementById('f-diagnostic').value
  };
  try {
    const r = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await r.json();
    if (!r.ok) {
      err.textContent = (data.errors || ['Error al guardar.']).join(' ');
      err.classList.remove('hidden');
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
  ['f-device-type', 'f-problems', 'f-arrival'].forEach(id => setSelected(id, []));
  toggleDiag('f-problems', 'diag-wrap');
  document.getElementById('ticket-success').classList.add('hidden');
  document.getElementById('intake-form').classList.remove('hidden');
});

// ---------- Orders list ----------
let currentStatusFilter = '';
document.getElementById('orders-search').addEventListener('input', loadOrders);
document.querySelectorAll('#status-filter .chip').forEach(b => {
  b.addEventListener('click', () => {
    document.querySelectorAll('#status-filter .chip').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    currentStatusFilter = b.dataset.value;
    loadOrders();
  });
});

async function loadOrders() {
  const list = document.getElementById('orders-list');
  const q = new URLSearchParams({
    search: document.getElementById('orders-search').value,
    status: currentStatusFilter
  });
  try {
    const orders = await (await fetch('/api/orders?' + q)).json();
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
          <span class="status-badge status-${esc(o.status)}">${esc(o.status)}</span>
        </div>
        <p class="order-name">${esc(o.customer_name)}</p>
        <p class="order-meta">${esc(o.device_type)} · ${esc(o.model)}${o.phone ? ' · ' + esc(o.phone) : ''}</p>
        <div class="order-problems">${o.problems.map(p => `<span class="tag">${esc(p)}</span>`).join('')}</div>
        ${o.diagnostic_note ? `<p class="order-meta"><strong>Cliente dice:</strong> ${esc(o.diagnostic_note)}</p>` : ''}
        <p class="order-meta">Recibió: ${esc(o.received_by)} · ${esc(o.created_at.slice(0, 16).replace('T', ' '))}</p>
        <div class="order-actions">
          ${canAdvance ? `<button class="btn-advance" data-id="${o.id}">${esc(NEXT_LABEL[o.status])}</button>` : ''}
          <button class="btn-edit" data-id="${o.id}">Editar</button>
        </div>`;
      list.appendChild(card);
    });
    list.querySelectorAll('.btn-advance').forEach(b =>
      b.addEventListener('click', () => advanceOrder(b.dataset.id)));
    list.querySelectorAll('.btn-edit').forEach(b =>
      b.addEventListener('click', () => openEdit(b.dataset.id)));
  } catch {
    list.innerHTML = '<p class="empty">No se pudo cargar. Revisa la conexión.</p>';
  }
}

async function advanceOrder(id) {
  await fetch('/api/orders/' + id + '/advance', { method: 'POST' });
  loadOrders();
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// ---------- Edit ----------
let editingId = null;
async function openEdit(id) {
  const orders = await (await fetch('/api/orders')).json();
  const o = orders.find(x => String(x.id) === String(id));
  if (!o) return;
  editingId = o.id;
  document.getElementById('edit-ticket').textContent = o.ticket;
  document.getElementById('e-name').value = o.customer_name;
  document.getElementById('e-phone').value = o.phone || '';
  document.getElementById('e-model').value = o.model;
  document.getElementById('e-imei').value = o.imei || '';
  document.getElementById('e-received-by').value = o.received_by;
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
    agreement: document.getElementById('e-agreement').value,
    diagnostic_note: document.getElementById('e-diagnostic').value,
    status: document.getElementById('e-status').value
  };
  try {
    const r = await fetch('/api/orders/' + editingId, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await r.json();
    if (!r.ok) {
      err.textContent = (data.errors || ['Error al guardar.']).join(' ');
      err.classList.remove('hidden');
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
    const r = await fetch('/api/track/' + encodeURIComponent(code));
    if (!r.ok) {
      err.textContent = r.status === 429
        ? 'Demasiadas consultas. Espera un minuto.'
        : 'Código no encontrado. Revisa el código.';
      err.classList.remove('hidden');
      return;
    }
    const o = await r.json();
    box.innerHTML = `
      <div class="lookup-status status-${esc(o.status)}">${esc(o.status)}</div>
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
