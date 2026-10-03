// Órdenes de Reparación — Geeks Hollywood
// Simple Express + SQLite backend. No build step: `node server.js`.
// Uses Node's built-in node:sqlite (Node 22.5+), so there are no native
// dependencies to compile.
const express = require('express');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'frontend')));

const db = new DatabaseSync(path.join(__dirname, 'repairshop.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket TEXT UNIQUE NOT NULL,
    customer_name TEXT NOT NULL,
    phone TEXT DEFAULT '',
    device_type TEXT NOT NULL,
    model TEXT NOT NULL,
    imei TEXT DEFAULT '',
    problems TEXT NOT NULL DEFAULT '[]',
    arrival_condition TEXT NOT NULL DEFAULT '[]',
    received_by TEXT NOT NULL,
    agreement TEXT NOT NULL,
    diagnostic_note TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'Recibido',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
  CREATE TABLE IF NOT EXISTS counters (
    name TEXT PRIMARY KEY,
    value INTEGER NOT NULL DEFAULT 0
  );
  INSERT OR IGNORE INTO counters (name, value) VALUES ('ticket', 0);
`);

const STATUSES = ['Recibido', 'En reparación', 'Listo', 'Entregado'];

function nextTicket() {
  // Single atomic statement: bump the counter and read the new value.
  const row = db
    .prepare("UPDATE counters SET value = value + 1 WHERE name = 'ticket' RETURNING value")
    .get();
  return 'GH-' + String(row.value).padStart(4, '0');
}

function toPublic(row) {
  if (!row) return null;
  return {
    ...row,
    problems: JSON.parse(row.problems || '[]'),
    arrival_condition: JSON.parse(row.arrival_condition || '[]'),
  };
}

function validateOrder(body) {
  const errors = [];
  if (!body.customer_name || !body.customer_name.trim()) errors.push('El nombre del cliente es obligatorio.');
  if (!body.device_type || !body.device_type.trim()) errors.push('El tipo de equipo es obligatorio.');
  if (!body.model || !body.model.trim()) errors.push('El modelo es obligatorio.');
  if (!body.received_by || !body.received_by.trim()) errors.push('Quién lo recibe es obligatorio.');
  if (!body.agreement || !body.agreement.trim()) errors.push('Qué se acordó es obligatorio.');
  const problems = Array.isArray(body.problems) ? body.problems : [];
  if (problems.length === 0) errors.push('Elige al menos un problema.');
  if (problems.includes('Diagnóstico') && (!body.diagnostic_note || !body.diagnostic_note.trim())) {
    errors.push('Si es diagnóstico, escribe qué dice el cliente.');
  }
  return errors;
}

// List orders (search + status filter)
app.get('/api/orders', (req, res) => {
  const { search = '', status = '' } = req.query;
  let sql = 'SELECT * FROM orders';
  const clauses = [];
  const params = [];
  if (status && STATUSES.includes(status)) {
    clauses.push('status = ?');
    params.push(status);
  }
  if (search.trim()) {
    clauses.push('(customer_name LIKE ? OR ticket LIKE ? OR model LIKE ? OR phone LIKE ?)');
    const like = `%${search.trim()}%`;
    params.push(like, like, like, like);
  }
  if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
  sql += ' ORDER BY id DESC';
  const rows = db.prepare(sql).all(...params).map(toPublic);
  res.json(rows);
});

// Create order
app.post('/api/orders', (req, res) => {
  const errors = validateOrder(req.body);
  if (errors.length) return res.status(400).json({ errors });
  const b = req.body;
  const ticket = nextTicket();
  const info = db.prepare(`
    INSERT INTO orders
      (ticket, customer_name, phone, device_type, model, imei, problems, arrival_condition, received_by, agreement, diagnostic_note, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Recibido')
  `).run(
    ticket,
    b.customer_name.trim(),
    (b.phone || '').trim(),
    b.device_type.trim(),
    b.model.trim(),
    (b.imei || '').trim(),
    JSON.stringify(b.problems || []),
    JSON.stringify(b.arrival_condition || []),
    b.received_by.trim(),
    b.agreement.trim(),
    (b.diagnostic_note || '').trim()
  );
  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(toPublic(row));
});

// Lookup by ticket (customer-facing)
app.get('/api/orders/:ticket', (req, res) => {
  const ticket = req.params.ticket.trim().toUpperCase();
  const row = db.prepare('SELECT * FROM orders WHERE ticket = ?').get(ticket);
  if (!row) return res.status(404).json({ error: 'Ticket no encontrado.' });
  res.json(toPublic(row));
});

// Advance status one step
app.post('/api/orders/:id/advance', (req, res) => {
  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Orden no encontrada.' });
  const idx = STATUSES.indexOf(row.status);
  if (idx < 0 || idx >= STATUSES.length - 1) {
    return res.status(400).json({ error: 'La orden ya está entregada.' });
  }
  db.prepare("UPDATE orders SET status = ?, updated_at = datetime('now', 'localtime') WHERE id = ?")
    .run(STATUSES[idx + 1], req.params.id);
  res.json(toPublic(db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id)));
});

// Full edit
app.put('/api/orders/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Orden no encontrada.' });
  const errors = validateOrder(req.body);
  if (errors.length) return res.status(400).json({ errors });
  const b = req.body;
  const status = STATUSES.includes(b.status) ? b.status : existing.status;
  db.prepare(`
    UPDATE orders SET
      customer_name = ?, phone = ?, device_type = ?, model = ?, imei = ?,
      problems = ?, arrival_condition = ?, received_by = ?, agreement = ?,
      diagnostic_note = ?, status = ?, updated_at = datetime('now', 'localtime')
    WHERE id = ?
  `).run(
    b.customer_name.trim(),
    (b.phone || '').trim(),
    b.device_type.trim(),
    b.model.trim(),
    (b.imei || '').trim(),
    JSON.stringify(b.problems || []),
    JSON.stringify(b.arrival_condition || []),
    b.received_by.trim(),
    b.agreement.trim(),
    (b.diagnostic_note || '').trim(),
    status,
    req.params.id
  );
  res.json(toPublic(db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id)));
});

app.listen(PORT, () => {
  console.log(`Órdenes de Reparación corriendo en http://localhost:${PORT}`);
});
