// Órdenes de Reparación — Geeks Hollywood
// Simple Express + SQLite backend. No build step: `node server.js`.
// Uses Node's built-in node:sqlite (Node 22.5+), so there are no native
// dependencies to compile.
const express = require('express');
const path = require('path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const app = express();
app.disable('x-powered-by'); // no anunciar qué tecnología corre el servidor
const PORT = process.env.PORT || 3000;

// Cabeceras de seguridad en cada respuesta
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'");
  next();
});

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// Límite de peticiones por IP (simple, en memoria). Los máximos se pueden
// ajustar con variables de entorno para pruebas:
//   TRACK_RATE_LIMIT_MAX (defecto 30), STAFF_RATE_LIMIT_MAX (defecto 300)
function makeRateLimiter({ windowMs, max, message }) {
  const hits = new Map(); // ip -> marcas de tiempo
  return (req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const recent = (hits.get(ip) || []).filter(t => now - t < windowMs);
    recent.push(now);
    hits.set(ip, recent);
    if (recent.length > max) {
      return res.status(429).json({ error: message });
    }
    next();
  };
}

// Consulta pública del cliente: 30/min por IP (igual que antes).
const trackRateLimit = makeRateLimiter({
  windowMs: 60 * 1000,
  max: parseInt(process.env.TRACK_RATE_LIMIT_MAX || '30', 10),
  message: 'Demasiadas consultas. Espera un minuto.',
});

// Rutas del taller (/api/orders*): 300/min por IP — amplio para el uso en
// mostrador, pero frena el abuso automatizado.
const staffRateLimit = makeRateLimiter({
  windowMs: 60 * 1000,
  max: parseInt(process.env.STAFF_RATE_LIMIT_MAX || '300', 10),
  message: 'Demasiadas solicitudes. Espera un momento.',
});
app.use('/api/orders', staffRateLimit);

const db = new DatabaseSync(path.join(__dirname, 'repairshop.db'));
// WAL: las lecturas no bloquean a las escrituras (y viceversa); busy_timeout
// de 5 s para esperar el candado en vez de fallar de inmediato.
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA busy_timeout = 5000;');

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
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    ticket TEXT NOT NULL,
    from_status TEXT,
    to_status TEXT,
    actor TEXT NOT NULL DEFAULT 'staff',
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_audit_log_order ON audit_log(order_id);
`);

// Código de consulta del cliente: aleatorio e imposible de adivinar.
// El ticket (GH-0001...) sigue siendo secuencial para uso interno del taller,
// pero el cliente consulta su estado con este código, no con el ticket.
const cols = db.prepare('PRAGMA table_info(orders)').all().map(c => c.name);
if (!cols.includes('customer_code')) {
  db.exec('ALTER TABLE orders ADD COLUMN customer_code TEXT');
  const missing = db.prepare('SELECT id FROM orders WHERE customer_code IS NULL').all();
  for (const { id } of missing) {
    db.prepare('UPDATE orders SET customer_code = ? WHERE id = ?').run(generateCustomerCode(), id);
  }
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_customer_code ON orders(customer_code)');

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sin 0/O/1/I/L para evitar confusiones
function generateCustomerCode() {
  const bytes = crypto.randomBytes(8);
  let code = '';
  for (const b of bytes) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return code; // 8 caracteres, ~1 billón de combinaciones
}

const STATUSES = ['Recibido', 'En reparación', 'Listo', 'Entregado'];

// Auditoría de cambios de estado. actor = 'staff' hasta que exista login
// (el login del personal es un track separado).
function logStatusChange(orderId, ticket, fromStatus, toStatus) {
  db.prepare(`
    INSERT INTO audit_log (order_id, ticket, from_status, to_status, actor)
    VALUES (?, ?, ?, ?, 'staff')
  `).run(orderId, ticket, fromStatus, toStatus);
}

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

// Límites de longitud (defensa en el servidor; el frontend no los impone).
const MAX_LEN = {
  customer_name: 100,
  phone: 30,
  device_type: 30,
  model: 100,
  imei: 40,
  received_by: 100,
  agreement: 2000,
  diagnostic_note: 2000,
};
const MAX_LIST_ITEMS = 12;    // coincide con las opciones del frontend
const MAX_LIST_ITEM_LEN = 40;

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim() !== '';
}

function checkText(body, field, label, { required, max }, errors) {
  const v = body[field];
  if (v === undefined || v === null || v === '') {
    if (required) errors.push(`${label} es obligatorio.`);
    return;
  }
  if (typeof v !== 'string') {
    errors.push(`${label} debe ser texto.`);
    return;
  }
  if (required && !v.trim()) {
    errors.push(`${label} es obligatorio.`);
    return;
  }
  if (v.length > max) errors.push(`${label}: máximo ${max} caracteres.`);
}

// Devuelve la lista válida, [] si no vino, o null si la forma es inválida.
function checkStringList(body, field, label, errors) {
  const v = body[field];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || !v.every(x => typeof x === 'string')) {
    errors.push(`${label} debe ser una lista de textos.`);
    return null;
  }
  if (v.length > MAX_LIST_ITEMS) errors.push(`${label}: máximo ${MAX_LIST_ITEMS} elementos.`);
  if (v.some(x => x.length > MAX_LIST_ITEM_LEN)) {
    errors.push(`${label}: cada elemento, máximo ${MAX_LIST_ITEM_LEN} caracteres.`);
  }
  return v;
}

function validateOrder(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return ['Petición inválida.'];
  }
  const errors = [];
  checkText(body, 'customer_name', 'El nombre del cliente', { required: true, max: MAX_LEN.customer_name }, errors);
  checkText(body, 'phone', 'El teléfono', { required: false, max: MAX_LEN.phone }, errors);
  checkText(body, 'device_type', 'El tipo de equipo', { required: true, max: MAX_LEN.device_type }, errors);
  checkText(body, 'model', 'El modelo', { required: true, max: MAX_LEN.model }, errors);
  checkText(body, 'imei', 'El IMEI', { required: false, max: MAX_LEN.imei }, errors);
  checkText(body, 'received_by', 'Quién lo recibe', { required: true, max: MAX_LEN.received_by }, errors);
  checkText(body, 'agreement', 'Qué se acordó', { required: true, max: MAX_LEN.agreement }, errors);
  checkText(body, 'diagnostic_note', 'La nota de diagnóstico', { required: false, max: MAX_LEN.diagnostic_note }, errors);
  const problems = checkStringList(body, 'problems', 'Los problemas', errors);
  checkStringList(body, 'arrival_condition', 'Cómo llegó', errors);
  if (problems && problems.length === 0) errors.push('Elige al menos un problema.');
  if (problems && problems.includes('Diagnóstico') && !isNonEmptyString(body.diagnostic_note)) {
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
  // El ticket se genera una sola vez por intento de creación: los reintentos
  // por colisión de customer_code reutilizan el mismo ticket (no queman
  // números extra). Si la creación falla del todo tras los reintentos, ese
  // único ticket se pierde — igual que con cualquier inserción fallida antes.
  const ticket = nextTicket();
  const info = insertOrderWithCodeRetry(ticket, b);
  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(info.lastInsertRowid);
  res.status(201).json(toPublic(row));
});

// Inserta la orden reintentando el customer_code si colisiona (UNIQUE).
// Colisiones son astronómicamente improbables (8 chars, ~1 billón de
// combinaciones), pero el reintento evita un 500 espurio si alguna ocurre.
function insertOrderWithCodeRetry(ticket, b) {
  const MAX_CODE_ATTEMPTS = 5;
  for (let attempt = 1; attempt <= MAX_CODE_ATTEMPTS; attempt++) {
    const customerCode = generateCustomerCode();
    try {
      return db.prepare(`
        INSERT INTO orders
          (ticket, customer_code, customer_name, phone, device_type, model, imei, problems, arrival_condition, received_by, agreement, diagnostic_note, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Recibido')
      `).run(
        ticket,
        customerCode,
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
    } catch (e) {
      const isCodeCollision = e && e.code === 'ERR_SQLITE_ERROR' &&
        /UNIQUE constraint failed: orders\.customer_code/.test(e.message || '');
      if (isCodeCollision && attempt < MAX_CODE_ATTEMPTS) {
        console.warn(`Colisión de customer_code (intento ${attempt}/${MAX_CODE_ATTEMPTS}), reintentando…`);
        continue;
      }
      throw e;
    }
  }
  const err = new Error('No se pudo generar un código de cliente único tras varios intentos.');
  err.status = 500;
  throw err;
}

// Consulta pública de estado (para el cliente).
// Usa el código imposible de adivinar (no el ticket secuencial) y devuelve
// solo los campos mínimos: jamás teléfono, IMEI, notas internas ni acuerdos.
// El endpoint anterior /api/orders/:ticket se eliminó: era secuencial
// (GH-0001, GH-0002...) y exponía la fila completa.
function toCustomerView(row) {
  if (!row) return null;
  return {
    ticket: row.ticket,
    customer_name: row.customer_name,
    device_type: row.device_type,
    model: row.model,
    problems: JSON.parse(row.problems || '[]'),
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

app.get('/api/track/:code', trackRateLimit, (req, res) => {
  const code = req.params.code.trim().toUpperCase();
  if (!/^[A-Z2-9]{8}$/.test(code)) {
    return res.status(404).json({ error: 'Código no encontrado.' });
  }
  const row = db.prepare('SELECT * FROM orders WHERE customer_code = ?').get(code);
  if (!row) return res.status(404).json({ error: 'Código no encontrado.' });
  res.json(toCustomerView(row));
});

// Advance status one step
app.post('/api/orders/:id/advance', (req, res) => {
  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Orden no encontrada.' });
  const idx = STATUSES.indexOf(row.status);
  if (idx < 0 || idx >= STATUSES.length - 1) {
    return res.status(400).json({ error: 'La orden ya está entregada.' });
  }
  const toStatus = STATUSES[idx + 1];
  db.prepare("UPDATE orders SET status = ?, updated_at = datetime('now', 'localtime') WHERE id = ?")
    .run(toStatus, req.params.id);
  logStatusChange(row.id, row.ticket, row.status, toStatus);
  res.json(toPublic(db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id)));
});

// Historial de cambios de estado de una orden (auditoría).
app.get('/api/orders/:id/audit', (req, res) => {
  const order = db.prepare('SELECT id FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Orden no encontrada.' });
  const rows = db.prepare(`
    SELECT id, order_id, ticket, from_status, to_status, actor, created_at
    FROM audit_log WHERE order_id = ? ORDER BY id ASC
  `).all(req.params.id);
  res.json(rows);
});

// Full edit
// Delete an order — only while still in 'Recibido' (safe way to clear bogus
// test orders). Any later status is protected: 409.
app.delete('/api/orders/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Orden no encontrada.' });
  if (row.status !== 'Recibido') {
    return res.status(409).json({ error: 'Solo se pueden eliminar órdenes en estado Recibido.' });
  }
  logStatusChange(row.id, row.ticket, row.status, 'Eliminada');
  db.prepare('DELETE FROM orders WHERE id = ?').run(req.params.id);
  res.json({ ok: true, ticket: row.ticket });
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
  if (status !== existing.status) {
    logStatusChange(existing.id, existing.ticket, existing.status, status);
  }
  res.json(toPublic(db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id)));
});

// Manejador global de errores: registra el error completo en el servidor pero
// jamás filtra stack traces ni detalles internos al cliente.
app.use((err, req, res, _next) => {
  console.error(`[${new Date().toISOString()}] ERROR ${req.method} ${req.originalUrl}:`, err);
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'El cuerpo de la petición no es JSON válido.' });
  }
  const status = err && Number.isInteger(err.status) ? err.status : 500;
  res.status(status).json({ error: status === 500 ? 'Error interno del servidor.' : (err.message || 'Error.') });
});

app.listen(PORT, () => {
  console.log(`Órdenes de Reparación corriendo en http://localhost:${PORT}`);
  console.log(`Modo: ${process.env.NODE_ENV || 'development'}`);
});
