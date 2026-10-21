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
app.set('trust proxy', 'loopback'); // para Nginx en producción; inofensivo en local
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
  let sweeps = 0;
  return (req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const recent = (hits.get(ip) || []).filter(t => now - t < windowMs);
    recent.push(now);
    hits.set(ip, recent);
    if (++sweeps % 512 === 0) {
      for (const [key, timestamps] of hits) {
        if (!timestamps.length || now - timestamps[timestamps.length - 1] >= windowMs) hits.delete(key);
      }
    }
    if (recent.length > max) {
      res.setHeader('Retry-After', String(Math.ceil(windowMs / 1000)));
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
app.use('/api/orders', requireAuth); // login obligatorio en todo lo del taller

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
  CREATE TABLE IF NOT EXISTS order_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    ticket TEXT NOT NULL,
    event_type TEXT NOT NULL,
    from_status TEXT,
    to_status TEXT,
    previous_technician TEXT,
    assigned_technician TEXT,
    actor TEXT NOT NULL DEFAULT 'staff',
    source_audit_id INTEGER UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_order_events_order ON order_events(order_id, created_at);
  CREATE TABLE IF NOT EXISTS staff_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
  CREATE TABLE IF NOT EXISTS staff_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_staff_sessions_user ON staff_sessions(user_id);
`);

function withTransaction(work) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* conserva el error original */ }
    throw error;
  }
}

// Migración aditiva y segura: las órdenes anteriores conservan los campos
// nuevos como NULL. No se asignan técnicos ni fechas prometidas a registros
// existentes. Para las métricas de estado se aprovechan created_at y audit_log.
const orderCols = db.prepare('PRAGMA table_info(orders)').all().map(c => c.name);
if (!orderCols.includes('assigned_technician')) {
  db.exec('ALTER TABLE orders ADD COLUMN assigned_technician TEXT');
}
if (!orderCols.includes('promised_at')) {
  db.exec('ALTER TABLE orders ADD COLUMN promised_at TEXT');
}
const eventCols = db.prepare('PRAGMA table_info(order_events)').all().map(c => c.name);
if (!eventCols.includes('previous_technician')) {
  db.exec('ALTER TABLE order_events ADD COLUMN previous_technician TEXT');
}
db.exec(`
  INSERT OR IGNORE INTO order_events
    (order_id, ticket, event_type, from_status, to_status, actor, created_at)
  SELECT o.id, o.ticket, 'status', NULL, 'Recibido', 'sistema', o.created_at
  FROM orders o
  WHERE NOT EXISTS (
    SELECT 1 FROM order_events e WHERE e.order_id = o.id AND e.event_type = 'status'
  );
  INSERT OR IGNORE INTO order_events
    (order_id, ticket, event_type, from_status, to_status, actor, source_audit_id, created_at)
  SELECT a.order_id, a.ticket, 'status', a.from_status, a.to_status,
         a.actor, a.id, a.created_at
  FROM audit_log a;
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

// ============ LOGIN DEL PERSONAL ============
// Sesiones con cookies httpOnly. Contraseñas con scrypt (node:crypto, sin
// dependencias nuevas). El admin inicial se crea SOLO desde variables de
// entorno (nunca en el código): ADMIN_USER / ADMIN_PASSWORD.
// En local: ponlas en backend/.env (gitignored) y corre `npm run start:local`.
const SESSION_COOKIE = 'gh_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 horas
// B-8: tope de sesiones activas por usuario (un taller usa varios
// dispositivos; 10 es amplio y evita acumulación indefinida).
const MAX_SESSIONS_PER_USER = 10;

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  const parts = String(stored).split(':');
  if (parts.length !== 2) return false;
  const check = crypto.scryptSync(password, parts[0], 64);
  const expected = Buffer.from(parts[1], 'hex');
  return check.length === expected.length && crypto.timingSafeEqual(check, expected);
}

function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie;
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    try {
      out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      // Ignora cookies malformadas en vez de convertir una sesión inválida
      // en un error 500 para toda la petición.
    }
  }
  return out;
}

function createSession(userId, username) {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString().slice(0, 19).replace('T', ' ');
  db.prepare('INSERT INTO staff_sessions (token_hash, user_id, username, expires_at) VALUES (?, ?, ?, ?)')
    .run(tokenHash, userId, username, expiresAt);
  // B-8: poda las sesiones más viejas si se supera el tope por usuario.
  db.prepare(`
    DELETE FROM staff_sessions
    WHERE user_id = ?
      AND token_hash NOT IN (
        SELECT token_hash FROM staff_sessions
        WHERE user_id = ?
        ORDER BY created_at DESC, rowid DESC
        LIMIT ?
      )
  `).run(userId, userId, MAX_SESSIONS_PER_USER);
  return token;
}

function getSessionUser(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const s = db.prepare(
    "SELECT user_id, username FROM staff_sessions WHERE token_hash = ? AND expires_at > datetime('now')"
  ).get(tokenHash);
  return s ? { id: s.user_id, username: s.username } : null;
}

function setSessionCookie(req, res, token) {
  // Secure solo cuando la conexión ya es HTTPS (detrás de Nginx con trust proxy).
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie',
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_MS / 1000}${secure}`);
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

// Guardia: todo /api/orders/* la requiere. /api/track/:code sigue público.
function requireAuth(req, res, next) {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'No autorizado. Inicia sesión.' });
  req.staffUser = user;
  next();
}

// Admin inicial: solo si no hay usuarios Y las variables están definidas.
(function seedAdmin() {
  const n = db.prepare('SELECT COUNT(*) AS n FROM staff_users').get().n;
  if (n > 0) return;
  const u = (process.env.ADMIN_USER || '').trim();
  const p = process.env.ADMIN_PASSWORD || '';
  if (!u || !p) {
    console.log('Sin usuarios de personal. Define ADMIN_USER y ADMIN_PASSWORD (backend/.env) para crear el admin inicial.');
    return;
  }
  db.prepare('INSERT INTO staff_users (username, password_hash) VALUES (?, ?)').run(u, hashPassword(p));
  // B-5: no se registra el identificador del admin en el log.
  console.log('Admin inicial creado.');
})();

// Anti-fuerza-bruta en el login: 10 intentos/min por IP.
const loginRateLimit = makeRateLimiter({
  windowMs: 60 * 1000,
  max: parseInt(process.env.LOGIN_RATE_LIMIT_MAX || '10', 10),
  message: 'Demasiados intentos. Espera un minuto.',
});

// Bandera de modo desarrollo para el frontend. El botón "Rellenar datos de
// prueba" solo existe fuera de producción (B-1). No expone nada sensible.
app.get('/api/config', (req, res) => {
  res.json({ devMode: process.env.NODE_ENV !== 'production' });
});

app.post('/api/login', loginRateLimit, (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password) {
    return res.status(401).json({ error: 'Credenciales inválidas.' });
  }
  const user = db.prepare('SELECT * FROM staff_users WHERE username = ?').get(username.trim());
  if (!user) {
    // B-4: corre un scrypt dummy con salt aleatoria para que el tiempo de
    // respuesta no revele si el usuario existe (antes se respondía más
    // rápido al no pasar por scrypt). Mensaje genérico igual que abajo.
    crypto.scryptSync(password, crypto.randomBytes(16), 64);
    return res.status(401).json({ error: 'Credenciales inválidas.' });
  }
  // Mensaje genérico a propósito: no revela si el usuario existe.
  if (!verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Credenciales inválidas.' });
  }
  const token = createSession(user.id, user.username);
  setSessionCookie(req, res, token);
  res.json({ ok: true, username: user.username });
});

app.post('/api/logout', (req, res) => {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    db.prepare('DELETE FROM staff_sessions WHERE token_hash = ?').run(tokenHash);
  }
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'No autorizado.' });
  res.json({ username: user.username });
});

app.post('/api/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 8 caracteres.' });
  }
  const user = db.prepare('SELECT * FROM staff_users WHERE id = ?').get(req.staffUser.id);
  if (!user || !verifyPassword(currentPassword || '', user.password_hash)) {
    return res.status(401).json({ error: 'Credenciales inválidas.' });
  }
  db.prepare('UPDATE staff_users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), user.id);
  // Revoca todas las sesiones y emite una fresca.
  db.prepare('DELETE FROM staff_sessions WHERE user_id = ?').run(user.id);
  const token = createSession(user.id, user.username);
  setSessionCookie(req, res, token);
  res.json({ ok: true });
});

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sin 0/O/1/I/L para evitar confusiones
function generateCustomerCode() {
  const bytes = crypto.randomBytes(8);
  let code = '';
  for (const b of bytes) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return code; // 8 caracteres, ~1 billón de combinaciones
}

const STATUSES = ['Recibido', 'En reparación', 'Listo', 'Entregado'];
const TECHNICIANS = ['Fabio', 'Oliver', 'Sebastian', 'Fernando', 'Maria', 'Elder'];

function recordOrderEvent(orderId, ticket, eventType, fromStatus, toStatus, actor, assignedTechnician = null, previousTechnician = null) {
  db.prepare(`
    INSERT INTO order_events
      (order_id, ticket, event_type, from_status, to_status, previous_technician, assigned_technician, actor)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(orderId, ticket, eventType, fromStatus, toStatus, previousTechnician || null,
    assignedTechnician || null, actor || 'staff');
}

// Auditoría de cambios de estado. actor = usuario autenticado de la sesión.
function logStatusChange(orderId, ticket, fromStatus, toStatus, actor, assignedTechnician = null) {
  db.prepare(`
    INSERT INTO audit_log (order_id, ticket, from_status, to_status, actor)
    VALUES (?, ?, ?, ?, ?)
  `).run(orderId, ticket, fromStatus, toStatus, actor);
  recordOrderEvent(orderId, ticket, 'status', fromStatus, toStatus, actor, assignedTechnician);
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
  assigned_technician: 60,
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
  checkText(body, 'assigned_technician', 'El técnico asignado', { required: false, max: MAX_LEN.assigned_technician }, errors);
  const technician = typeof body.assigned_technician === 'string' ? body.assigned_technician.trim() : '';
  if (technician && !TECHNICIANS.includes(technician)) errors.push('El técnico asignado no es válido.');
  const promisedAt = body.promised_at;
  if (promisedAt !== undefined && promisedAt !== null && promisedAt !== '') {
    if (typeof promisedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(promisedAt) ||
        Number.isNaN(Date.parse(`${promisedAt}T00:00:00Z`)) || new Date(`${promisedAt}T00:00:00Z`).toISOString().slice(0, 10) !== promisedAt) {
      errors.push('La fecha prometida no es válida.');
    }
  }
  const problems = checkStringList(body, 'problems', 'Los problemas', errors);
  checkStringList(body, 'arrival_condition', 'Cómo llegó', errors);
  if (problems && problems.length === 0) errors.push('Elige al menos un problema.');
  if (problems && problems.includes('Diagnóstico') && !isNonEmptyString(body.diagnostic_note)) {
    errors.push('Si es diagnóstico, escribe qué dice el cliente.');
  }
  return errors;
}

function readOrderFilters(query) {
  const filters = {
    from: localDateOnly(query.from) ? query.from : '',
    to: localDateOnly(query.to) ? query.to : '',
    status: typeof query.status === 'string' && STATUSES.includes(query.status) ? query.status : '',
    technician: typeof query.technician === 'string' && TECHNICIANS.includes(query.technician) ? query.technician : '',
    deviceType: typeof query.device_type === 'string' ? query.device_type.trim().slice(0, 30) : '',
    problem: typeof query.problem === 'string' ? query.problem.trim().slice(0, 40) : '',
    completedTechnician: typeof query.completed_technician === 'string' && TECHNICIANS.includes(query.completed_technician) ? query.completed_technician : '',
    completedFrom: localDateOnly(query.completed_from) ? query.completed_from : '',
    completedTo: localDateOnly(query.completed_to) ? query.completed_to : '',
    agingBucket: ['0_1', '2_3', '4_7', '8_plus'].includes(query.aging_bucket) ? query.aging_bucket : '',
    pickupBucket: ['under_24', '1_2', '2_3', '3_plus'].includes(query.pickup_bucket) ? query.pickup_bucket : '',
    openOnly: query.open_only === '1',
    overdueOnly: query.overdue === '1',
    unassignedOnly: query.unassigned === '1',
    completedUnassigned: query.completed_unassigned === '1',
  };
  return filters;
}

function buildOrderWhere(filters) {
  const clauses = [];
  const params = [];
  if (filters.from) { clauses.push('date(created_at) >= date(?)'); params.push(filters.from); }
  if (filters.to) { clauses.push('date(created_at) <= date(?)'); params.push(filters.to); }
  if (filters.status) { clauses.push('status = ?'); params.push(filters.status); }
  if (filters.technician) { clauses.push('assigned_technician = ?'); params.push(filters.technician); }
  if (filters.deviceType) { clauses.push('device_type = ?'); params.push(filters.deviceType); }
  if (filters.problem) { clauses.push("EXISTS (SELECT 1 FROM json_each(orders.problems) WHERE value = ?)"); params.push(filters.problem); }
  if (filters.openOnly) clauses.push("orders.status <> 'Entregado'");
  if (filters.unassignedOnly) clauses.push('orders.assigned_technician IS NULL');
  if (filters.overdueOnly) clauses.push("orders.status <> 'Entregado' AND orders.promised_at < date('now', 'localtime')");
  if (filters.agingBucket) {
    const bounds = { '0_1': [-2, null], '2_3': [-4, -2], '4_7': [-8, -4], '8_plus': [null, -8] }[filters.agingBucket];
    clauses.push("orders.status <> 'Entregado'");
    if (bounds[0] !== null && bounds[1] !== null) {
      clauses.push("orders.created_at < datetime('now', 'localtime', ?) AND orders.created_at >= datetime('now', 'localtime', ?)");
      params.push(`${bounds[0]} days`, `${bounds[1]} days`);
    } else if (bounds[0] !== null) {
      clauses.push("orders.created_at >= datetime('now', 'localtime', ?)"); params.push(`${bounds[0]} days`);
    } else {
      clauses.push("orders.created_at < datetime('now', 'localtime', ?)"); params.push(`${bounds[1]} days`);
    }
  }
  if (filters.pickupBucket) {
    const bounds = { under_24: [null, -24], '1_2': [-24, -48], '2_3': [-48, -72], '3_plus': [-72, null] }[filters.pickupBucket];
    clauses.push("orders.status = 'Listo'");
    const readyTime = "(SELECT MAX(e.created_at) FROM order_events e WHERE e.order_id = orders.id AND e.event_type = 'status' AND e.to_status = 'Listo')";
    if (bounds[0] === null) clauses.push(`${readyTime} >= datetime('now', 'localtime', ?)`), params.push(`${bounds[1]} hours`);
    else if (bounds[1] === null) clauses.push(`${readyTime} < datetime('now', 'localtime', ?)`), params.push(`${bounds[0]} hours`);
    else {
      clauses.push(`${readyTime} < datetime('now', 'localtime', ?) AND ${readyTime} >= datetime('now', 'localtime', ?)`);
      params.push(`${bounds[0]} hours`, `${bounds[1]} hours`);
    }
  }
  if (filters.completedTechnician || filters.completedFrom || filters.completedTo || filters.completedUnassigned) {
    clauses.push(`EXISTS (SELECT 1 FROM order_events e WHERE e.order_id = orders.id
      AND e.event_type = 'status' AND e.to_status = 'Entregado'
      AND (? = '' OR e.assigned_technician = ?)
      AND (? = 0 OR e.assigned_technician IS NULL)
      AND (? = '' OR date(e.created_at) >= date(?))
      AND (? = '' OR date(e.created_at) <= date(?)))`);
    params.push(filters.completedTechnician, filters.completedTechnician,
      filters.completedUnassigned ? 1 : 0,
      filters.completedFrom, filters.completedFrom, filters.completedTo, filters.completedTo);
  }
  return { sql: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '', params };
}

// B-9: escapa los comodines de LIKE (\, %, _) para que se busquen como
// texto literal y no alteren los resultados de la búsqueda.
function escapeLike(s) {
  return s.replace(/[\\%_]/g, c => '\\' + c);
}

// List orders (search + status filter)
app.get('/api/orders', (req, res) => {
  const search = typeof req.query.search === 'string' ? req.query.search : '';
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  const filters = readOrderFilters({ ...req.query, status: status || '' });
  const where = buildOrderWhere(filters);
  let sql = `SELECT orders.*,
    (SELECT e.created_at FROM order_events e WHERE e.order_id = orders.id
      AND e.event_type = 'status' AND e.to_status = orders.status
      ORDER BY e.created_at DESC, e.id DESC LIMIT 1) AS status_changed_at
    FROM orders` + where.sql;
  const params = [...where.params];
  if (search.trim()) {
    const likeCols = ['customer_name', 'ticket', 'model', 'phone']
      .map(c => `${c} LIKE ? ESCAPE '\\'`).join(' OR ');
    sql += (where.sql ? ' AND ' : ' WHERE ') + `(${likeCols})`;
    const like = `%${escapeLike(search.trim())}%`;
    params.push(like, like, like, like);
  }
  sql += ' ORDER BY id DESC';
  const rows = db.prepare(sql).all(...params).map(toPublic);
  res.json(rows);
});

function localDateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function dateBucket(dateValue, interval) {
  const date = new Date(`${dateValue.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (interval === 'month') {
    const start = new Date(date.getFullYear(), date.getMonth(), 1);
    return { key: fmt(start), label: start.toLocaleDateString('es-US', { month: 'short', year: '2-digit' }),
      from: fmt(start), to: fmt(new Date(date.getFullYear(), date.getMonth() + 1, 0)), value: 0 };
  }
  if (interval === 'week') {
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    const end = new Date(start); end.setDate(end.getDate() + 6);
    return { key: fmt(start), label: `${start.toLocaleDateString('es-US', { month: 'short', day: 'numeric' })}–${end.toLocaleDateString('es-US', { month: 'short', day: 'numeric' })}`,
      from: fmt(start), to: fmt(end), value: 0 };
  }
  return { key: fmt(date), label: date.toLocaleDateString('es-US', { month: 'short', day: 'numeric' }),
    from: fmt(date), to: fmt(date), value: 0 };
}

// Métricas operativas autenticadas. Las fechas históricas solo se calculan a
// partir de created_at y de transiciones guardadas en auditoría.
app.get('/api/dashboard', staffRateLimit, requireAuth, (req, res) => {
  const filters = readOrderFilters(req.query);
  if (filters.from && !localDateOnly(filters.from)) filters.from = '';
  if (filters.to && !localDateOnly(filters.to)) filters.to = '';
  if (filters.from && filters.to && filters.from > filters.to) {
    return res.status(400).json({ error: 'El inicio del período debe ser anterior al final.' });
  }
  const interval = ['day', 'week', 'month'].includes(req.query.interval) ? req.query.interval : 'day';
  const categoryWhere = buildOrderWhere({ ...filters, from: '', to: '' });
  const rangeWhere = buildOrderWhere(filters);
  const categoryOrders = db.prepare('SELECT * FROM orders' + categoryWhere.sql).all(...categoryWhere.params);
  const rangeOrders = db.prepare('SELECT * FROM orders' + rangeWhere.sql).all(...rangeWhere.params);
  const today = db.prepare("SELECT date('now', 'localtime') AS today").get().today;
  const now = Date.now();
  const dateMs = value => Date.parse(String(value || '').replace(' ', 'T'));
  const ageDays = order => Math.max(0, (now - dateMs(order.created_at)) / 86400000);
  const openOrders = categoryOrders.filter(o => o.status !== 'Entregado');
  const readyOrders = categoryOrders.filter(o => o.status === 'Listo');
  const latestReady = new Map();
  for (const event of db.prepare(`
    SELECT e.order_id, e.created_at FROM order_events e
    WHERE e.event_type = 'status' AND e.to_status = 'Listo'
    ORDER BY e.created_at DESC, e.id DESC
  `).all()) {
    if (!latestReady.has(event.order_id)) latestReady.set(event.order_id, event.created_at);
  }
  const pickupHours = order => latestReady.has(order.id)
    ? Math.max(0, (now - dateMs(latestReady.get(order.id))) / 3600000) : null;

  const deliveredSql = `
    SELECT COUNT(*) AS n FROM order_events e JOIN orders o ON o.id = e.order_id
    WHERE e.event_type = 'status' AND e.to_status = 'Entregado'
      AND date(e.created_at) = date('now', 'localtime')
      AND (? = '' OR e.assigned_technician = ?)
      AND (? = '' OR o.device_type = ?)
      AND (? = '' OR o.status = ?)
      AND (? = '' OR EXISTS (SELECT 1 FROM json_each(o.problems) WHERE value = ?))
  `;
  const deliveredToday = db.prepare(deliveredSql).get(
    filters.technician, filters.technician, filters.deviceType, filters.deviceType,
    filters.status, filters.status, filters.problem, filters.problem
  ).n;

  const byCreated = new Map();
  for (const order of rangeOrders) {
    const bucket = dateBucket(order.created_at, interval);
    if (bucket) {
      const found = byCreated.get(bucket.key) || bucket;
      found.value++;
      byCreated.set(bucket.key, found);
    }
  }
  const completedQuery = db.prepare(`
    SELECT e.*, o.created_at AS order_created_at, o.device_type, o.problems
    FROM order_events e JOIN orders o ON o.id = e.order_id
    WHERE e.event_type = 'status' AND e.to_status = 'Entregado'
      AND (? = '' OR date(e.created_at) >= date(?))
      AND (? = '' OR date(e.created_at) <= date(?))
      AND (? = '' OR o.device_type = ?)
  `);
  const completed = completedQuery.all(filters.from, filters.from, filters.to, filters.to,
    filters.deviceType, filters.deviceType).filter(e => {
      if (filters.status && filters.status !== 'Entregado') return false;
      if (filters.technician && e.assigned_technician !== filters.technician) return false;
      if (filters.problem && !JSON.parse(e.problems || '[]').includes(filters.problem)) return false;
      return true;
    });
  const turnaround = completed.map(e => ({
    technician: e.assigned_technician,
    hours: Math.max(0, (dateMs(e.created_at) - dateMs(e.order_created_at)) / 3600000),
  }));
  const median = values => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted.length % 2 ? sorted[(sorted.length - 1) / 2] :
      (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  };
  const countBy = (rows, valueOf) => {
    const counts = new Map();
    for (const row of rows) {
      const label = valueOf(row);
      if (label) counts.set(label, (counts.get(label) || 0) + 1);
    }
    return [...counts].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  };
  const statuses = STATUSES.map(label => ({ label, value: rangeOrders.filter(o => o.status === label).length }));
  const technicians = TECHNICIANS.map(label => ({
    label, value: openOrders.filter(o => o.assigned_technician === label).length,
    completed: completed.filter(e => e.assigned_technician === label).length,
  }));
  technicians.push({ label: 'Sin asignar', value: openOrders.filter(o => !o.assigned_technician).length,
    completed: completed.filter(e => !e.assigned_technician).length });
  const aging = [
    { label: '0–1 días', min: 0, max: 2 }, { label: '2–3 días', min: 2, max: 4 },
    { label: '4–7 días', min: 4, max: 8 }, { label: '8+ días', min: 8, max: Infinity },
  ].map(b => ({ label: b.label, value: openOrders.filter(o => ageDays(o) >= b.min && ageDays(o) < b.max).length }));
  const pickupWaiting = [
    { label: '<24 h', min: 0, max: 24 }, { label: '1–2 días', min: 24, max: 48 },
    { label: '2–3 días', min: 48, max: 72 }, { label: '3+ días', min: 72, max: Infinity },
  ].map(b => ({ label: b.label, value: readyOrders.filter(o => {
    const hours = pickupHours(o); return hours !== null && hours >= b.min && hours < b.max;
  }).length }));
  const turnaroundByTechnician = TECHNICIANS.map(label => {
    const values = turnaround.filter(t => t.technician === label).map(t => t.hours);
    const value = median(values);
    return { label, value: value === null ? 0 : Math.round(value * 10) / 10, count: values.length };
  });

  res.json({
    generatedAt: new Date().toISOString(), interval, filters,
    summary: {
      createdToday: categoryOrders.filter(o => o.created_at.slice(0, 10) === today).length,
      open: openOrders.length,
      inRepair: categoryOrders.filter(o => o.status === 'En reparación').length,
      ready: readyOrders.length,
      deliveredToday,
      aging: openOrders.filter(o => ageDays(o) >= 3).length,
      overdue: openOrders.filter(o => o.promised_at && o.promised_at < today).length,
      waitingPickup: readyOrders.filter(o => (pickupHours(o) || 0) >= 48).length,
    },
    created: [...byCreated.values()].sort((a, b) => a.key.localeCompare(b.key)),
    statuses,
    technicians,
    devices: countBy(rangeOrders, o => o.device_type),
    issues: countBy(rangeOrders.flatMap(o => JSON.parse(o.problems || '[]')), p => p).slice(0, 10),
    aging,
    pickupWaiting,
    turnaround: { medianHours: median(turnaround.map(t => t.hours)), completedCount: turnaround.length, byTechnician: turnaroundByTechnician },
    techniciansRoster: TECHNICIANS,
    deviceTypes: db.prepare('SELECT DISTINCT device_type FROM orders ORDER BY device_type').all().map(r => r.device_type),
  });
});

// Una sola orden por id (para edición). Protegido con requireAuth como el
// resto de /api/orders/* (B-2: openEdit ya no descarga todas las órdenes).
app.get('/api/orders/:id', (req, res) => {
  const row = db.prepare(`
    SELECT o.*,
      (SELECT e.created_at FROM order_events e WHERE e.order_id = o.id
        AND e.event_type = 'status' AND e.to_status = o.status
        ORDER BY e.created_at DESC, e.id DESC LIMIT 1) AS status_changed_at
    FROM orders o WHERE o.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Orden no encontrada.' });
  res.json(toPublic(row));
});

// Create order
app.post('/api/orders', (req, res) => {
  // Quién lo recibe sale de la sesión, no de lo que mande el cliente.
  if (req.body && typeof req.body === 'object') req.body.received_by = req.staffUser.username;
  const errors = validateOrder(req.body);
  if (errors.length) return res.status(400).json({ errors });
  const b = req.body;
  // El ticket se genera una sola vez por intento de creación: los reintentos
  // por colisión de customer_code reutilizan el mismo ticket (no queman
  // números extra). Si la creación falla del todo tras los reintentos, ese
  // único ticket se pierde — igual que con cualquier inserción fallida antes.
  const row = withTransaction(() => {
    const ticket = nextTicket();
    const info = insertOrderWithCodeRetry(ticket, b);
    const created = db.prepare('SELECT * FROM orders WHERE id = ?').get(info.lastInsertRowid);
    recordOrderEvent(created.id, created.ticket, 'status', null, 'Recibido', req.staffUser.username, created.assigned_technician);
    if (created.assigned_technician) {
      recordOrderEvent(created.id, created.ticket, 'technician_assigned', null, null, req.staffUser.username, created.assigned_technician);
    }
    return created;
  });
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
          (ticket, customer_code, customer_name, phone, device_type, model, imei, problems, arrival_condition, received_by, agreement, diagnostic_note, assigned_technician, promised_at, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Recibido')
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
        (b.diagnostic_note || '').trim(),
        (b.assigned_technician || '').trim() || null,
        (b.promised_at || '').trim() || null
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
  const updated = withTransaction(() => {
    db.prepare("UPDATE orders SET status = ?, updated_at = datetime('now', 'localtime') WHERE id = ?")
      .run(toStatus, req.params.id);
    logStatusChange(row.id, row.ticket, row.status, toStatus, req.staffUser.username, row.assigned_technician);
    return db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  });
  res.json(toPublic(updated));
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

app.get('/api/orders/:id/history', (req, res) => {
  const order = db.prepare('SELECT id FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Orden no encontrada.' });
  const events = db.prepare(`
    SELECT id, order_id, ticket, event_type, from_status, to_status,
      previous_technician, assigned_technician, actor, created_at
    FROM order_events WHERE order_id = ? ORDER BY created_at ASC, id ASC
  `).all(req.params.id);
  res.json(events);
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
  withTransaction(() => {
    logStatusChange(row.id, row.ticket, row.status, 'Eliminada', req.staffUser.username, row.assigned_technician);
    db.prepare('DELETE FROM orders WHERE id = ?').run(req.params.id);
  });
  res.json({ ok: true, ticket: row.ticket });
});

// Full edit
app.put('/api/orders/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Orden no encontrada.' });
  // Quién lo recibió no se puede cambiar desde el cliente: se conserva.
  if (req.body && typeof req.body === 'object') req.body.received_by = existing.received_by;
  const errors = validateOrder(req.body);
  if (errors.length) return res.status(400).json({ errors });
  const b = req.body;
  const assignedTechnician = Object.prototype.hasOwnProperty.call(b, 'assigned_technician')
    ? ((b.assigned_technician || '').trim() || null) : existing.assigned_technician;
  const promisedAt = Object.prototype.hasOwnProperty.call(b, 'promised_at')
    ? ((b.promised_at || '').trim() || null) : existing.promised_at;
  const status = STATUSES.includes(b.status) ? b.status : existing.status;
  // B-3: la máquina de estados se impone en el servidor. Solo se permite
  // quedarse en el mismo estado o avanzar; las regresiones (p. ej.
  // Entregado -> Recibido) se rechazan porque casi siempre son un error.
  const fromIdx = STATUSES.indexOf(existing.status);
  const toIdx = STATUSES.indexOf(status);
  if (fromIdx >= 0 && toIdx >= 0 && toIdx < fromIdx) {
    return res.status(400).json({ error: 'No se puede devolver una orden a un estado anterior.' });
  }
  const updated = withTransaction(() => {
    db.prepare(`
      UPDATE orders SET
        customer_name = ?, phone = ?, device_type = ?, model = ?, imei = ?,
        problems = ?, arrival_condition = ?, received_by = ?, agreement = ?,
        diagnostic_note = ?, assigned_technician = ?, promised_at = ?, status = ?, updated_at = datetime('now', 'localtime')
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
      assignedTechnician,
      promisedAt,
      status,
      req.params.id
    );
    if (status !== existing.status) {
      logStatusChange(existing.id, existing.ticket, existing.status, status, req.staffUser.username, assignedTechnician);
    }
    if (assignedTechnician !== existing.assigned_technician) {
      recordOrderEvent(existing.id, existing.ticket, 'technician_assigned', existing.status, status,
        req.staffUser.username, assignedTechnician, existing.assigned_technician);
    }
    return db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  });
  res.json(toPublic(updated));
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
