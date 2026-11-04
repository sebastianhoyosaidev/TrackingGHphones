// Órdenes de Reparación — Geeks Hollywood
// Simple Express + SQLite backend. No build step: `node server.js`.
// Uses Node's built-in node:sqlite (Node 22.5+), so there are no native
// dependencies to compile.

// Zona horaria del taller (Hollywood, FL). Las fechas se guardan con
// datetime('now', 'localtime'), que depende de la zona del servidor; en la
// nube suele ser UTC y las horas salían 4–5 h adelantadas. Se puede cambiar
// con la variable de entorno TZ. Debe ir antes de cualquier uso de fechas.
process.env.TZ = process.env.TZ || 'America/New_York';

const express = require('express');
const path = require('path');
const crypto = require('node:crypto');
const fs = require('node:fs');
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
// Cada cambio guardado con éxito en /api/orders* programa un respaldo automático.
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.path.startsWith('/api/orders')) {
    res.on('finish', () => { if (res.statusCode < 400) scheduleBackup(); });
  }
  next();
});
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

// DB_FILE permite usar otra base (p. ej. demo.db para el taller simulado).
// Por defecto, la base real: backend/repairshop.db.
const DB_FILE = path.resolve(__dirname, process.env.DB_FILE || 'repairshop.db');
const dbExisted = fs.existsSync(DB_FILE);
const db = new DatabaseSync(DB_FILE);

// ============ RESPALDOS AUTOMÁTICOS ============
// Un respaldo después de cada cambio (esperando 1 min sin cambios, máx. 10 min,
// para no hacer una copia por clic), uno al arrancar (antes de migrar) y uno
// al apagar. Cada copia se verifica. Se guardan las 48 más recientes y una por
// día durante 30 días; el resto se borra solo. VACUUM INTO hace una copia
// consistente aunque la app esté escribiendo.
// AUTO_BACKUP=0 lo desactiva; BACKUP_DIR cambia la carpeta (defecto backend/backups).
// Nota: estas copias viven en el mismo servidor. Protegen de errores y de una
// base dañada, NO de perder el servidor: copia la carpeta fuera (ver README).
const AUTO_BACKUP = process.env.AUTO_BACKUP !== '0' && process.env.NO_LISTEN !== '1';
const BACKUP_DIR = path.resolve(__dirname, process.env.BACKUP_DIR || 'backups');
const BACKUP_KEEP_RECENT = 48;
const BACKUP_KEEP_DAYS = 30;
const BACKUP_DELAY_MS = 60 * 1000;
const BACKUP_MAX_WAIT_MS = 10 * 60 * 1000;
const backupPrefix = `${path.basename(DB_FILE, '.db')}-auto-`;
const backupState = { lastFile: null, lastAt: null, lastError: null, pending: false };
let backupTimer = null;
let backupPendingSince = 0;

function backupStamp(d = new Date()) {
  const p2 = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}-${String(d.getMilliseconds()).padStart(3, '0')}`;
}

function runBackup(reason) {
  clearTimeout(backupTimer);
  backupTimer = null;
  backupPendingSince = 0;
  backupState.pending = false;
  if (!AUTO_BACKUP) return;
  const dest = path.join(BACKUP_DIR, `${backupPrefix}${backupStamp()}.db`);
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
    // Verificación: la copia debe abrir, pasar quick_check y tener la tabla de órdenes.
    const check = new DatabaseSync(dest, { readOnly: true });
    try {
      const ok = check.prepare('PRAGMA quick_check').get().quick_check === 'ok';
      check.prepare('SELECT COUNT(*) AS n FROM orders').get();
      if (!ok) throw new Error('quick_check falló');
    } finally { check.close(); }
    backupState.lastFile = path.basename(dest);
    backupState.lastAt = new Date().toISOString();
    backupState.lastError = null;
    pruneBackups();
  } catch (e) {
    try { fs.unlinkSync(dest); } catch { /* no se creó */ }
    backupState.lastError = `${new Date().toISOString()} ${e.message}`;
    console.error(`[respaldo ${reason}] ERROR:`, e.message);
  }
}

function pruneBackups() {
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith(backupPrefix) && f.endsWith('.db')).sort().reverse(); // más nuevas primero
  const cutoff = backupStamp(new Date(Date.now() - BACKUP_KEEP_DAYS * 86400000)).slice(0, 8);
  const daysKept = new Set();
  files.forEach((f, i) => {
    const dayKey = f.slice(backupPrefix.length, backupPrefix.length + 8); // YYYYMMDD
    if (i < BACKUP_KEEP_RECENT) { daysKept.add(dayKey); return; }
    if (dayKey >= cutoff && !daysKept.has(dayKey)) { daysKept.add(dayKey); return; } // la más nueva de cada día
    try { fs.unlinkSync(path.join(BACKUP_DIR, f)); } catch { /* ignora */ }
  });
}

function scheduleBackup() {
  if (!AUTO_BACKUP) return;
  const now = Date.now();
  if (!backupPendingSince) backupPendingSince = now;
  backupState.pending = true;
  clearTimeout(backupTimer);
  const wait = Math.max(0, Math.min(BACKUP_DELAY_MS, backupPendingSince + BACKUP_MAX_WAIT_MS - now));
  backupTimer = setTimeout(() => runBackup('cambios'), wait);
}

// Copia de seguridad al arrancar, ANTES de cualquier migración del esquema.
if (dbExisted) runBackup('arranque');
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
// Garantías (v1.4.0): una garantía es una orden nueva vinculada a la orden
// entregada original (warranty_of). warranty_result: Cubierta | No cubierta |
// Vencida. warranty_reason: la causa que eligió el personal.
if (!orderCols.includes('warranty_of')) {
  db.exec('ALTER TABLE orders ADD COLUMN warranty_of INTEGER');
}
if (!orderCols.includes('warranty_result')) {
  db.exec('ALTER TABLE orders ADD COLUMN warranty_result TEXT');
}
if (!orderCols.includes('warranty_reason')) {
  db.exec('ALTER TABLE orders ADD COLUMN warranty_reason TEXT');
}
db.exec('CREATE INDEX IF NOT EXISTS idx_orders_warranty_of ON orders(warranty_of)');
// Índices de rendimiento (se crean una sola vez; no cambian datos). Los "de
// cobertura" llevan las columnas que el panel lee, así SQLite responde desde
// el índice sin abrir cada fila.
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_orders_created_cover ON orders(created_at, status, device_type, assigned_technician);
  CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
  CREATE INDEX IF NOT EXISTS idx_orders_technician ON orders(assigned_technician, device_type);
  CREATE INDEX IF NOT EXISTS idx_orders_device ON orders(device_type);
  CREATE INDEX IF NOT EXISTS idx_order_events_order_status ON order_events(order_id, event_type, to_status, created_at);
  CREATE INDEX IF NOT EXISTS idx_order_events_status_date_cover ON order_events(event_type, to_status, created_at, order_id, assigned_technician);
`);
// Panel (v1.4.0): precio acordado (opcional) y permiso de marketing del cliente.
if (!orderCols.includes('price')) {
  db.exec('ALTER TABLE orders ADD COLUMN price REAL');
}
if (!orderCols.includes('marketing_opt_in')) {
  db.exec('ALTER TABLE orders ADD COLUMN marketing_opt_in INTEGER NOT NULL DEFAULT 0');
}
const eventCols = db.prepare('PRAGMA table_info(order_events)').all().map(c => c.name);
if (!eventCols.includes('previous_technician')) {
  db.exec('ALTER TABLE order_events ADD COLUMN previous_technician TEXT');
}
if (!eventCols.includes('details')) {
  db.exec('ALTER TABLE order_events ADD COLUMN details TEXT');
}
// v1.4.0 — corrección de duplicados: hasta v1.3.0, cada cambio de estado hecho
// en la app se guardaba en audit_log Y en order_events sin enlazarlos, y este
// paso de arranque volvía a copiar audit_log -> order_events (sin técnico).
// Resultado: tras cada reinicio, el historial y las métricas de entregas se
// duplicaban. Ahora:
//   1) se borran las copias importadas que duplican un evento ya registrado
//      por la app (se conserva el original, que sí tiene el técnico);
//   2) solo se importa de audit_log lo que no exista ya en order_events;
//   3) logStatusChange enlaza ambos registros (source_audit_id).
withTransaction(() => {
  db.exec(`
    DELETE FROM order_events
    WHERE source_audit_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM order_events o
      -- "+o.source_audit_id": el "+" evita que SQLite use el índice de
      -- source_audit_id (que aquí revisa casi toda la tabla por cada fila) y
      -- usa el de order_id. Mismo resultado; el arranque pasa de ~35 s a
      -- milisegundos con 5.800 órdenes.
      WHERE o.id <> order_events.id AND +o.source_audit_id IS NULL
        AND o.order_id = order_events.order_id AND o.event_type = 'status'
        AND COALESCE(o.from_status, '') = COALESCE(order_events.from_status, '')
        AND o.to_status = order_events.to_status AND o.created_at = order_events.created_at
    );
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
    FROM audit_log a
    WHERE NOT EXISTS (
      SELECT 1 FROM order_events e
      WHERE e.order_id = a.order_id AND e.event_type = 'status'
        AND COALESCE(e.from_status, '') = COALESCE(a.from_status, '')
        AND e.to_status = a.to_status AND e.created_at = a.created_at
    );
  `);
});

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
// Versiones asíncronas para las rutas: scrypt corre en el pool de hilos de
// Node y no congela al resto de peticiones mientras se verifica una clave.
const scryptAsync = (password, salt) => new Promise((resolve, reject) =>
  crypto.scrypt(password, salt, 64, (err, key) => (err ? reject(err) : resolve(key))));
async function hashPasswordAsync(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${(await scryptAsync(password, salt)).toString('hex')}`;
}
async function verifyPassword(password, stored) {
  const parts = String(stored).split(':');
  if (parts.length !== 2) return false;
  const check = await scryptAsync(password, parts[0]);
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

app.post('/api/login', loginRateLimit, async (req, res, next) => {
  try {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password) {
    return res.status(401).json({ error: 'Credenciales inválidas.' });
  }
  const user = db.prepare('SELECT * FROM staff_users WHERE username = ?').get(username.trim());
  if (!user) {
    // B-4: corre un scrypt dummy con salt aleatoria para que el tiempo de
    // respuesta no revele si el usuario existe (antes se respondía más
    // rápido al no pasar por scrypt). Mensaje genérico igual que abajo.
    await scryptAsync(password, crypto.randomBytes(16));
    return res.status(401).json({ error: 'Credenciales inválidas.' });
  }
  // Mensaje genérico a propósito: no revela si el usuario existe.
  if (!(await verifyPassword(password, user.password_hash))) {
    return res.status(401).json({ error: 'Credenciales inválidas.' });
  }
  const token = createSession(user.id, user.username);
  setSessionCookie(req, res, token);
  res.json({ ok: true, username: user.username });
  } catch (error) { next(error); }
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

app.post('/api/change-password', requireAuth, async (req, res, next) => {
  try {
  const { currentPassword, newPassword } = req.body || {};
  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 8 caracteres.' });
  }
  const user = db.prepare('SELECT * FROM staff_users WHERE id = ?').get(req.staffUser.id);
  if (!user || !(await verifyPassword(typeof currentPassword === 'string' ? currentPassword : '', user.password_hash))) {
    return res.status(401).json({ error: 'Credenciales inválidas.' });
  }
  const newHash = await hashPasswordAsync(newPassword);
  db.prepare('UPDATE staff_users SET password_hash = ? WHERE id = ?').run(newHash, user.id);
  // Revoca todas las sesiones y emite una fresca.
  db.prepare('DELETE FROM staff_sessions WHERE user_id = ?').run(user.id);
  const token = createSession(user.id, user.username);
  setSessionCookie(req, res, token);
  res.json({ ok: true });
  } catch (error) { next(error); }
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

function recordOrderEvent(orderId, ticket, eventType, fromStatus, toStatus, actor, assignedTechnician = null, previousTechnician = null, sourceAuditId = null) {
  db.prepare(`
    INSERT INTO order_events
      (order_id, ticket, event_type, from_status, to_status, previous_technician, assigned_technician, actor, source_audit_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(orderId, ticket, eventType, fromStatus, toStatus, previousTechnician || null,
    assignedTechnician || null, actor || 'staff', sourceAuditId);
}

// Auditoría de cambios de estado. actor = usuario autenticado de la sesión.
function logStatusChange(orderId, ticket, fromStatus, toStatus, actor, assignedTechnician = null) {
  const audit = db.prepare(`
    INSERT INTO audit_log (order_id, ticket, from_status, to_status, actor)
    VALUES (?, ?, ?, ?, ?)
  `).run(orderId, ticket, fromStatus, toStatus, actor);
  // Enlazado con source_audit_id para que el arranque no lo vuelva a importar.
  recordOrderEvent(orderId, ticket, 'status', fromStatus, toStatus, actor, assignedTechnician, null,
    Number(audit.lastInsertRowid));
}

function nextTicket() {
  // Single atomic statement: bump the counter and read the new value.
  const row = db
    .prepare("UPDATE counters SET value = value + 1 WHERE name = 'ticket' RETURNING value")
    .get();
  return 'GH-' + String(row.value).padStart(4, '0');
}

// ============ GARANTÍA ============
// Días de garantía desde la entrega (configurable con WARRANTY_DAYS).
const WARRANTY_DAYS = parseInt(process.env.WARRANTY_DAYS || '60', 10);
const WARRANTY_CAUSES = {
  fabrica: 'Falla de fábrica / de la reparación',
  cliente: 'Daño del cliente (partido, golpe, mojado…)',
};

// Fecha local de hoy (YYYY-MM-DD) según la zona horaria del taller.
function localToday() {
  return db.prepare("SELECT date('now', 'localtime') AS d").get().d;
}
function addDays(dateStr, n) {
  const d = new Date(`${dateStr.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function daysBetween(fromDate, toDate) {
  return Math.round((Date.parse(`${toDate.slice(0, 10)}T00:00:00Z`) -
    Date.parse(`${fromDate.slice(0, 10)}T00:00:00Z`)) / 86400000);
}
// La garantía cubre hasta el día "entrega + WARRANTY_DAYS" inclusive.
function warrantyInfo(deliveredAt) {
  if (!deliveredAt) return null;
  const until = addDays(deliveredAt, WARRANTY_DAYS);
  const daysLeft = daysBetween(localToday(), until);
  return { warranty_until: until, warranty_days_left: daysLeft, warranty_active: daysLeft >= 0 };
}

// Subconsultas reutilizables (requieren el alias de tabla de orders).
const deliveredAtSql = alias => `(SELECT MAX(e.created_at) FROM order_events e
  WHERE e.order_id = ${alias}.id AND e.event_type = 'status' AND e.to_status = 'Entregado')`;
const warrantyOfTicketSql = alias => `(SELECT w.ticket FROM orders w WHERE w.id = ${alias}.warranty_of)`;

function getDeliveredAt(orderId) {
  return db.prepare(`SELECT ${deliveredAtSql('o')} AS d FROM orders o WHERE o.id = ?`).get(orderId)?.d || null;
}

function toPublic(row) {
  if (!row) return null;
  const out = {
    ...row,
    problems: JSON.parse(row.problems || '[]'),
    arrival_condition: JSON.parse(row.arrival_condition || '[]'),
  };
  if (row.status === 'Entregado' && row.delivered_at) Object.assign(out, warrantyInfo(row.delivered_at));
  return out;
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
  if (body.price !== undefined && body.price !== null && body.price !== '') {
    const price = Number(body.price);
    if (!Number.isFinite(price) || price < 0 || price > 100000) errors.push('El precio no es válido.');
  }
  if (body.marketing_opt_in !== undefined && typeof body.marketing_opt_in !== 'boolean') {
    errors.push('El permiso de promociones no es válido.');
  }
  const problems = checkStringList(body, 'problems', 'Los problemas', errors);
  checkStringList(body, 'arrival_condition', 'Cómo llegó', errors);
  if (problems && problems.length === 0) errors.push('Elige al menos un problema.');
  if (problems && problems.includes('Diagnóstico') && !isNonEmptyString(body.diagnostic_note)) {
    errors.push('Si es diagnóstico, escribe qué dice el cliente.');
  }
  return errors;
}

function priceValue(v) {
  if (v === undefined || v === null || v === '') return null;
  return Math.round(Number(v) * 100) / 100;
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
    agingBucket: ['0_1', '2_3', '4_7', '8_plus', '3_plus'].includes(query.aging_bucket) ? query.aging_bucket : '',
    pickupBucket: ['under_24', '1_2', '2_3', '3_plus', 'over_48'].includes(query.pickup_bucket) ? query.pickup_bucket : '',
    warrantyOnly: query.warranty_only === '1',
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
  // Comparación directa sobre created_at ('AAAA-MM-DD HH:MM:SS') en vez de
  // date(created_at): mismo resultado y así usa el índice.
  if (filters.from) { clauses.push('orders.created_at >= ?'); params.push(filters.from); }
  if (filters.to) { clauses.push("orders.created_at < date(?, '+1 day')"); params.push(filters.to); }
  if (filters.status) { clauses.push('orders.status = ?'); params.push(filters.status); }
  if (filters.technician) { clauses.push('orders.assigned_technician = ?'); params.push(filters.technician); }
  if (filters.deviceType) { clauses.push('orders.device_type = ?'); params.push(filters.deviceType); }
  if (filters.problem) { clauses.push("EXISTS (SELECT 1 FROM json_each(orders.problems) WHERE value = ?)"); params.push(filters.problem); }
  if (filters.openOnly) clauses.push("orders.status <> 'Entregado'");
  if (filters.unassignedOnly) clauses.push('orders.assigned_technician IS NULL');
  if (filters.warrantyOnly) clauses.push('orders.warranty_of IS NOT NULL');
  if (filters.overdueOnly) clauses.push("orders.status <> 'Entregado' AND orders.promised_at < date('now', 'localtime')");
  if (filters.agingBucket) {
    // 3_plus = "Abiertas 3 días o más" del panel (mismo corte de 72 h).
    // [más reciente, más antiguo]: 2_3 = creada hace entre 2 y 4 días.
    // (Antes 2_3 y 4_7 tenían los límites al revés y siempre salían vacías.)
    const bounds = { '0_1': [-2, null], '2_3': [-2, -4], '4_7': [-4, -8], '8_plus': [null, -8], '3_plus': [null, -3] }[filters.agingBucket];
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
    // over_48 = "Listas esperando 48 h o más" del panel.
    const bounds = { under_24: [null, -24], '1_2': [-24, -48], '2_3': [-48, -72], '3_plus': [-72, null], over_48: [-48, null] }[filters.pickupBucket];
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
    // "Órdenes con una entrega que cumpla esto": se arma una sola vez la lista
    // de entregas que cumplen (usa el índice por fecha) en vez de buscar orden
    // por orden. Mismo resultado que el EXISTS anterior.
    const sub = ["e.event_type = 'status'", "e.to_status = 'Entregado'"];
    if (filters.completedTechnician) { sub.push('e.assigned_technician = ?'); params.push(filters.completedTechnician); }
    if (filters.completedUnassigned) sub.push('e.assigned_technician IS NULL');
    if (filters.completedFrom) { sub.push('e.created_at >= ?'); params.push(filters.completedFrom); }
    if (filters.completedTo) { sub.push("e.created_at < date(?, '+1 day')"); params.push(filters.completedTo); }
    clauses.push(`orders.id IN (SELECT e.order_id FROM order_events e WHERE ${sub.join(' AND ')})`);
  }
  return { sql: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '', params };
}

// Agrega una condición más a un WHERE ya armado (o lo empieza).
function andWhere(where, clause, ...params) {
  return {
    sql: where.sql ? `${where.sql} AND ${clause}` : ` WHERE ${clause}`,
    params: [...where.params, ...params],
  };
}

// Texto normalizado para buscar: sin tildes, minúsculas, espacios simples.
function normalizeText(s) {
  return stripAccents(String(s || '').toLowerCase()).replace(/\s+/g, ' ').trim();
}

// List orders (search + filters + paging)
// La búsqueda se hace en JS para que:
//   - "Carmen Diaz" encuentre "Carmen Díaz" (sin importar tildes/mayúsculas)
//   - "2395550108", "(239) 555-0108" o "5550108" encuentren "239-555-0108"
// Paginación opcional: ?limit=N&offset=M. La cabecera X-Total-Count dice cuántas
// hay en total. Sin limit devuelve todas (lo usa la descarga CSV).
app.get('/api/orders', (req, res) => {
  const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';
  const status = typeof req.query.status === 'string' ? req.query.status : '';
  const filters = readOrderFilters({ ...req.query, status: status || '' });
  const where = buildOrderWhere(filters);
  // Fase 1: solo los campos de búsqueda (ligero).
  let candidates = db.prepare(`SELECT id, customer_name, ticket, model, phone FROM orders${where.sql} ORDER BY id DESC`)
    .all(...where.params);
  if (search) {
    const text = normalizeText(search);
    const digits = search.replace(/\D/g, '');
    candidates = candidates.filter(o =>
      normalizeText(o.customer_name).includes(text) ||
      normalizeText(o.ticket).includes(text) ||
      normalizeText(o.model).includes(text) ||
      (digits.length >= 4 && String(o.phone || '').replace(/\D/g, '').includes(digits)));
  }
  const total = candidates.length;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 0, 0), 1000);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  const page = limit ? candidates.slice(offset, offset + limit) : candidates;
  res.setHeader('X-Total-Count', String(total));
  if (!page.length) return res.json([]);
  // Fase 2: filas completas solo de la página.
  const ids = page.map(o => o.id);
  const rows = db.prepare(`SELECT orders.*,
    (SELECT e.created_at FROM order_events e WHERE e.order_id = orders.id
      AND e.event_type = 'status' AND e.to_status = orders.status
      ORDER BY e.created_at DESC, e.id DESC LIMIT 1) AS status_changed_at,
    ${deliveredAtSql('orders')} AS delivered_at,
    ${warrantyOfTicketSql('orders')} AS warranty_of_ticket
    FROM orders WHERE orders.id IN (${ids.map(() => '?').join(',')}) ORDER BY orders.id DESC`).all(...ids);
  res.json(rows.map(toPublic));
});

// Búsqueda de cliente en el mostrador (al escribir el teléfono en Nueva orden).
// Devuelve su historial y si tiene una orden abierta o una garantía vigente,
// para no duplicar órdenes ni cobrar algo que debería ir por garantía.
app.get('/api/customers/lookup', staffRateLimit, requireAuth, (req, res) => {
  const digits = String(req.query.phone || '').replace(/\D/g, '').slice(-10);
  if (digits.length < 7) return res.json({ found: false });
  const rows = db.prepare(`SELECT orders.*, ${deliveredAtSql('orders')} AS delivered_at,
      ${warrantyOfTicketSql('orders')} AS warranty_of_ticket
    FROM orders WHERE phone <> '' ORDER BY id DESC`).all()
    .filter(o => o.phone.replace(/\D/g, '').slice(-10).endsWith(digits));
  if (!rows.length) return res.json({ found: false });
  const orders = rows.map(toPublic);
  // Garantía vigente: entregada, no es a su vez una garantía, y sin otra garantía abierta.
  const openClaimFor = new Set(orders.filter(o => o.warranty_of && o.status !== 'Entregado').map(o => o.warranty_of));
  res.json({
    found: true,
    name: orders[0].customer_name,
    phone: orders[0].phone,
    optIn: orders[0].marketing_opt_in === 1,
    visits: orders.length,
    spent: Math.round(orders.filter(o => o.status === 'Entregado').reduce((s, o) => s + (o.price || 0), 0) * 100) / 100,
    open: orders.filter(o => o.status !== 'Entregado').map(o => ({ id: o.id, ticket: o.ticket, device_type: o.device_type, model: o.model, status: o.status, problems: o.problems })),
    inWarranty: orders.filter(o => o.status === 'Entregado' && o.warranty_active && !o.warranty_of && !openClaimFor.has(o.id))
      .map(o => ({ id: o.id, ticket: o.ticket, device_type: o.device_type, model: o.model, problems: o.problems, warranty_until: o.warranty_until, warranty_days_left: o.warranty_days_left })),
    recent: orders.slice(0, 5).map(o => ({ id: o.id, ticket: o.ticket, device_type: o.device_type, model: o.model, problems: o.problems, status: o.status, created_at: o.created_at, price: o.price })),
  });
});

function localDateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

// Formateadores creados una sola vez (crear uno por fecha es lento).
const LABEL_MONTH_YEAR = new Intl.DateTimeFormat('es-US', { month: 'short', year: '2-digit' });
const LABEL_MONTH_DAY = new Intl.DateTimeFormat('es-US', { month: 'short', day: 'numeric' });
function dateBucket(dateValue, interval) {
  const date = new Date(`${dateValue.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  const fmt = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (interval === 'month') {
    const start = new Date(date.getFullYear(), date.getMonth(), 1);
    return { key: fmt(start), label: LABEL_MONTH_YEAR.format(start),
      from: fmt(start), to: fmt(new Date(date.getFullYear(), date.getMonth() + 1, 0)), value: 0 };
  }
  if (interval === 'week') {
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    const end = new Date(start); end.setDate(end.getDate() + 6);
    return { key: fmt(start), label: `${LABEL_MONTH_DAY.format(start)}–${LABEL_MONTH_DAY.format(end)}`,
      from: fmt(start), to: fmt(end), value: 0 };
  }
  return { key: fmt(date), label: LABEL_MONTH_DAY.format(date),
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
  // categoryWhere: mismos filtros sin el rango de fechas (estado actual del
  // taller). rangeWhere: con el rango de fechas (gráficas del período).
  const categoryWhere = buildOrderWhere({ ...filters, from: '', to: '' });
  const rangeWhere = buildOrderWhere(filters);
  const today = db.prepare("SELECT date('now', 'localtime') AS today").get().today;
  const now = Date.now();
  const dateMs = value => Date.parse(String(value || '').replace(' ', 'T'));
  const ageDays = order => Math.max(0, (now - dateMs(order.created_at)) / 86400000);

  // Solo se cargan las órdenes ABIERTAS (lo que hay hoy en el taller), no todo
  // el historial. Para las que están Listo se trae cuándo quedaron listas.
  const openWhere = andWhere(categoryWhere, "orders.status <> 'Entregado'");
  const openOrders = db.prepare(`
    SELECT orders.id, orders.status, orders.created_at, orders.assigned_technician, orders.promised_at,
      CASE WHEN orders.status = 'Listo' THEN (
        SELECT MAX(e.created_at) FROM order_events e
        WHERE e.order_id = orders.id AND e.event_type = 'status' AND e.to_status = 'Listo'
      ) END AS ready_at
    FROM orders` + openWhere.sql).all(...openWhere.params);
  const pickupHours = order => order.ready_at ? Math.max(0, (now - dateMs(order.ready_at)) / 3600000) : null;
  const createdTodayWhere = andWhere(categoryWhere, "orders.created_at >= ? AND orders.created_at < date(?, '+1 day')", today, today);
  const createdToday = db.prepare('SELECT COUNT(*) AS n FROM orders' + createdTodayWhere.sql).get(...createdTodayWhere.params).n;

  // Entregadas hoy (por la fecha del evento de entrega).
  const deliveredClauses = ["e.event_type = 'status'", "e.to_status = 'Entregado'",
    'e.created_at >= ?', "e.created_at < date(?, '+1 day')"];
  const deliveredParams = [today, today];
  if (filters.technician) { deliveredClauses.push('e.assigned_technician = ?'); deliveredParams.push(filters.technician); }
  if (filters.deviceType) { deliveredClauses.push('o.device_type = ?'); deliveredParams.push(filters.deviceType); }
  if (filters.status) { deliveredClauses.push('o.status = ?'); deliveredParams.push(filters.status); }
  if (filters.problem) { deliveredClauses.push('EXISTS (SELECT 1 FROM json_each(o.problems) WHERE value = ?)'); deliveredParams.push(filters.problem); }
  const deliveredToday = db.prepare(`SELECT COUNT(*) AS n FROM order_events e JOIN orders o ON o.id = e.order_id
    WHERE ${deliveredClauses.join(' AND ')}`).get(...deliveredParams).n;

  // Gráficas del período: los conteos los hace SQLite (GROUP BY). Los empates
  // se ordenan por primera aparición, igual que antes.
  const byCreated = new Map();
  for (const row of db.prepare(`SELECT substr(orders.created_at, 1, 10) AS day, COUNT(*) AS n
      FROM orders${rangeWhere.sql} GROUP BY day`).all(...rangeWhere.params)) {
    const bucket = dateBucket(row.day, interval);
    if (bucket) {
      const found = byCreated.get(bucket.key) || bucket;
      found.value += row.n;
      byCreated.set(bucket.key, found);
    }
  }
  const statusCounts = new Map(db.prepare(`SELECT orders.status AS label, COUNT(*) AS n
      FROM orders${rangeWhere.sql} GROUP BY orders.status`).all(...rangeWhere.params).map(r => [r.label, r.n]));
  const sortedCounts = rows => rows.filter(r => r.label).map(r => ({ label: r.label, value: r.value }))
    .sort((x, y) => y.value - x.value);
  const devices = sortedCounts(db.prepare(`SELECT orders.device_type AS label, COUNT(*) AS value, MIN(orders.id) AS first
      FROM orders${rangeWhere.sql} GROUP BY orders.device_type ORDER BY first`).all(...rangeWhere.params));
  const issues = sortedCounts(db.prepare(`SELECT p.value AS label, COUNT(*) AS value, MIN(orders.id * 1000 + p.key) AS first
      FROM orders JOIN json_each(orders.problems) p${rangeWhere.sql} GROUP BY p.value ORDER BY first`)
    .all(...rangeWhere.params)).slice(0, 10);

  // Entregas del período. Tiempo de REPARACIÓN = de recibido a la primera vez
  // que quedó "Listo" (sin "Listo": hasta la entrega). La espera de recogida se
  // mide aparte: de "Listo" a "Entregado". Horas de calendario (incluye
  // noches). Los filtros van en SQL y solo se leen las columnas necesarias.
  let completed = [];
  if (!filters.status || filters.status === 'Entregado') {
    const clauses = ["e.event_type = 'status'", "e.to_status = 'Entregado'"];
    const params = [];
    if (filters.from) { clauses.push('e.created_at >= ?'); params.push(filters.from); }
    if (filters.to) { clauses.push("e.created_at < date(?, '+1 day')"); params.push(filters.to); }
    if (filters.deviceType) { clauses.push('o.device_type = ?'); params.push(filters.deviceType); }
    if (filters.technician) { clauses.push('e.assigned_technician = ?'); params.push(filters.technician); }
    if (filters.problem) { clauses.push('EXISTS (SELECT 1 FROM json_each(o.problems) WHERE value = ?)'); params.push(filters.problem); }
    completed = db.prepare(`SELECT e.assigned_technician, e.created_at, o.created_at AS order_created_at,
        (SELECT MIN(l.created_at) FROM order_events l
          WHERE l.order_id = e.order_id AND l.event_type = 'status' AND l.to_status = 'Listo') AS first_listo
      FROM order_events e JOIN orders o ON o.id = e.order_id WHERE ${clauses.join(' AND ')}`).all(...params);
  }
  const turnaround = completed.map(e => {
    const end = e.first_listo || e.created_at; // sin paso por "Listo": se usa la entrega
    return {
      technician: e.assigned_technician,
      hours: Math.max(0, (dateMs(end) - dateMs(e.order_created_at)) / 3600000),
      pickupHours: e.first_listo ? Math.max(0, (dateMs(e.created_at) - dateMs(e.first_listo)) / 3600000) : null,
    };
  });
  const median = values => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted.length % 2 ? sorted[(sorted.length - 1) / 2] :
      (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  };
  const statuses = STATUSES.map(label => ({ label, value: statusCounts.get(label) || 0 }));

  // Un solo recorrido por las abiertas y otro por las entregas: todos los
  // conteos a la vez, en vez de filtrar la lista una vez por cada barra.
  const AGING = [
    { label: '0–1 días', min: 0, max: 2 }, { label: '2–3 días', min: 2, max: 4 },
    { label: '4–7 días', min: 4, max: 8 }, { label: '8+ días', min: 8, max: Infinity },
  ];
  const PICKUP = [
    { label: '<24 h', min: 0, max: 24 }, { label: '1–2 días', min: 24, max: 48 },
    { label: '2–3 días', min: 48, max: 72 }, { label: '3+ días', min: 72, max: Infinity },
  ];
  const UNASSIGNED = 'Sin asignar';
  const techKey = name => (name ? name : UNASSIGNED);
  const openByTech = new Map(), completedByTech = new Map(), hoursByTech = new Map();
  const agingCounts = AGING.map(() => 0), pickupCounts = PICKUP.map(() => 0);
  const counts = { inRepair: 0, ready: 0, aging: 0, overdue: 0, waitingPickup: 0 };
  for (const o of openOrders) {
    const key = techKey(o.assigned_technician);
    openByTech.set(key, (openByTech.get(key) || 0) + 1);
    const age = ageDays(o);
    const ai = AGING.findIndex(b => age >= b.min && age < b.max);
    if (ai >= 0) agingCounts[ai]++;
    if (age >= 3) counts.aging++;
    if (o.status === 'En reparación') counts.inRepair++;
    if (o.promised_at && o.promised_at < today) counts.overdue++;
    if (o.status === 'Listo') {
      counts.ready++;
      const hours = pickupHours(o);
      if (hours !== null) {
        const pi = PICKUP.findIndex(b => hours >= b.min && hours < b.max);
        if (pi >= 0) pickupCounts[pi]++;
      }
      if ((hours || 0) >= 48) counts.waitingPickup++;
    }
  }
  for (const t of turnaround) {
    const key = techKey(t.technician);
    completedByTech.set(key, (completedByTech.get(key) || 0) + 1);
    if (!hoursByTech.has(key)) hoursByTech.set(key, []);
    hoursByTech.get(key).push(t.hours);
  }
  const technicians = [...TECHNICIANS, UNASSIGNED].map(label => ({
    label, value: openByTech.get(label) || 0, completed: completedByTech.get(label) || 0,
  }));
  const aging = AGING.map((b, i) => ({ label: b.label, value: agingCounts[i] }));
  const pickupWaiting = PICKUP.map((b, i) => ({ label: b.label, value: pickupCounts[i] }));
  const turnaroundByTechnician = TECHNICIANS.map(label => {
    const values = hoursByTech.get(label) || [];
    const value = median(values);
    return { label, value: value === null ? 0 : Math.round(value * 10) / 10, count: values.length };
  });

  res.json({
    generatedAt: new Date().toISOString(), interval, filters,
    summary: {
      createdToday,
      open: openOrders.length,
      inRepair: counts.inRepair,
      ready: counts.ready,
      deliveredToday,
      aging: counts.aging,
      overdue: counts.overdue,
      waitingPickup: counts.waitingPickup,
    },
    created: [...byCreated.values()].sort((a, b) => a.key.localeCompare(b.key)),
    statuses,
    technicians,
    devices,
    issues,
    aging,
    pickupWaiting,
    turnaround: {
      medianHours: median(turnaround.map(t => t.hours)),
      medianPickupHours: median(turnaround.filter(t => t.pickupHours !== null).map(t => t.pickupHours)),
      completedCount: turnaround.length, byTechnician: turnaroundByTechnician,
    },
    techniciansRoster: TECHNICIANS,
    deviceTypes: db.prepare('SELECT DISTINCT device_type FROM orders ORDER BY device_type').all().map(r => r.device_type),
  });
});

// ============ INSIGHTS (v1.4.0): clientes, marketing y repuestos ============
// Todo se calcula con datos ya guardados. Fechas en la zona horaria del taller.
// Período actual = [from, to]; período anterior = mismo número de días justo antes.

// Problema -> repuesto que normalmente se usa. "No carga", "No enciende",
// "Mojado", "Software", "Diagnóstico" y "Otro" no implican un repuesto fijo.
const PART_FOR_PROBLEM = {
  'Pantalla partida': 'Pantalla',
  'Backglass roto': 'Backglass (tapa trasera)',
  'Charging port': 'Puerto de carga',
  'Cámara frontal': 'Cámara frontal',
  'Cámara trasera': 'Cámara trasera',
  'Batería': 'Batería',
};
const SCREEN_PROBLEMS = ['Pantalla partida', 'Backglass roto'];
const STOCK_WEEKS = 2;          // stock sugerido = demanda de 2 semanas
const DEMAND_WINDOW_DAYS = 90;  // ventana para estimar demanda semanal
const INACTIVE_DAYS = 90;       // cliente "inactivo" si no vuelve en 90 días

function stripAccents(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}
// Un cliente = mismo teléfono (últimos 10 dígitos); sin teléfono, mismo nombre.
function customerKey(o) {
  const digits = String(o.phone || '').replace(/\D/g, '');
  if (digits.length >= 7) return 'tel:' + digits.slice(-10);
  return 'nom:' + stripAccents(String(o.customer_name || '').trim().toLowerCase()).replace(/\s+/g, ' ');
}
// "iphone 13 pro" e "iPhone 13 Pro" son el mismo modelo.
function modelKey(o) {
  return `${o.device_type}|${stripAccents(String(o.model || '').trim().toLowerCase()).replace(/\s+/g, ' ')}`;
}
// Nombre legible: "iPhone 13" ya trae la marca; "S23" no, se le antepone el tipo.
function displayModel(o) {
  const model = String(o.model || '').trim();
  const type = String(o.device_type || '');
  const hasBrand = type === 'Otro' || stripAccents(model.toLowerCase()).startsWith(stripAccents(type.toLowerCase()));
  return hasBrand ? model : `${type} ${model}`;
}
function pctChange(cur, prev) {
  if (!prev) return cur ? null : 0; // null = "nuevo" (no había antes)
  return Math.round(((cur - prev) / prev) * 100);
}

app.get('/api/insights', staffRateLimit, requireAuth, (req, res) => {
  const today = localToday();
  const to = localDateOnly(req.query.to) ? req.query.to : today;
  const from = localDateOnly(req.query.from) ? req.query.from : addDays(to, -29);
  if (from > to) return res.status(400).json({ error: 'El inicio del período debe ser anterior al final.' });
  const spanDays = daysBetween(from, to) + 1;
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(from, -spanDays);
  const demandFrom = addDays(today, -(DEMAND_WINDOW_DAYS - 1));

  const deliveredAt = new Map();
  for (const e of db.prepare(`SELECT order_id, MAX(created_at) AS at FROM order_events
      WHERE event_type = 'status' AND to_status = 'Entregado' GROUP BY order_id`).all()) {
    deliveredAt.set(e.order_id, e.at);
  }
  const all = db.prepare('SELECT * FROM orders ORDER BY created_at ASC, id ASC').all().map(o => ({
    ...o,
    day: o.created_at.slice(0, 10),
    problems: JSON.parse(o.problems || '[]'),
    arrival: JSON.parse(o.arrival_condition || '[]'),
    delivered_day: deliveredAt.has(o.id) ? deliveredAt.get(o.id).slice(0, 10) : null,
  }));
  const byId = new Map(all.map(o => [o.id, o]));
  const between = (day, a, b) => day && day >= a && day <= b;
  const cur = all.filter(o => between(o.day, from, to));
  const prev = all.filter(o => between(o.day, prevFrom, prevTo));

  // ---------- Resumen comparado con el período anterior ----------
  const deliveredIn = (a, b) => all.filter(o => between(o.delivered_day, a, b));
  const revenue = list => Math.round(list.reduce((sum, o) => sum + (o.price || 0), 0) * 100) / 100;
  const pricedCount = list => list.filter(o => o.price !== null && o.price !== undefined).length;
  const curDelivered = deliveredIn(from, to);
  const prevDelivered = deliveredIn(prevFrom, prevTo);
  const claimsCur = cur.filter(o => o.warranty_of);
  const claimsPrev = prev.filter(o => o.warranty_of);
  const metric = (value, previous) => ({ value, previous, change: pctChange(value, previous) });
  const summary = {
    orders: metric(cur.length, prev.length),
    delivered: metric(curDelivered.length, prevDelivered.length),
    revenue: metric(revenue(curDelivered), revenue(prevDelivered)),
    avgTicket: metric(
      pricedCount(curDelivered) ? Math.round(revenue(curDelivered) / pricedCount(curDelivered)) : 0,
      pricedCount(prevDelivered) ? Math.round(revenue(prevDelivered) / pricedCount(prevDelivered)) : 0),
    pricedShare: curDelivered.length ? Math.round((pricedCount(curDelivered) / curDelivered.length) * 100) : null,
    warrantyClaims: metric(claimsCur.length, claimsPrev.length),
    warrantyCovered: claimsCur.filter(o => o.warranty_result === 'Cubierta').length,
  };

  // ---------- Dinero por entrar (estado actual, no depende de las fechas) ----------
  // Suma del precio acordado de las órdenes que aún no se entregan.
  const openOrders = all.filter(o => o.status !== 'Entregado');
  const money = list => ({
    count: list.length,
    value: revenue(list),
    withoutPrice: list.filter(o => o.price === null || o.price === undefined).length,
  });
  const pipeline = {
    received: money(openOrders.filter(o => o.status === 'Recibido')),
    inRepair: money(openOrders.filter(o => o.status === 'En reparación')),
    ready: money(openOrders.filter(o => o.status === 'Listo')),
    open: money(openOrders),
    collectedToday: revenue(all.filter(o => o.delivered_day === today)),
    readyWaiting48h: money(openOrders.filter(o => o.status === 'Listo' && o.updated_at &&
      (Date.now() - Date.parse(o.updated_at.replace(' ', 'T'))) >= 48 * 3600000)),
  };

  // ---------- Clientes ----------
  const customers = new Map();
  for (const o of all) {
    const key = customerKey(o);
    const c = customers.get(key) || {
      key, name: '', phone: '', visits: 0, first: o.day, last: o.day, models: new Set(),
      optIn: false, spent: 0, warrantyClaims: 0,
    };
    c.name = o.customer_name;              // nombre más reciente
    if (o.phone) c.phone = o.phone;
    c.visits++;
    c.last = o.day;
    c.models.add(displayModel(o));
    c.optIn = o.marketing_opt_in === 1;    // el permiso más reciente manda
    if (o.status === 'Entregado' && o.price) c.spent += o.price;
    if (o.warranty_of) c.warrantyClaims++;
    customers.set(key, c);
  }
  const keyOf = new Map(all.map(o => [o.id, customerKey(o)]));
  const periodKeys = new Set(cur.map(o => keyOf.get(o.id)));
  const newKeys = [...periodKeys].filter(k => customers.get(k).first >= from);
  const prevPeriodKeys = new Set(prev.map(o => keyOf.get(o.id)));
  // Nuevo en el período anterior = su primera visita cae en ese período.
  const prevNew = [...prevPeriodKeys].filter(k => customers.get(k).first >= prevFrom);
  const publicCustomer = c => ({
    name: c.name, phone: c.phone, visits: c.visits, first: c.first, last: c.last,
    models: [...c.models].slice(-3), optIn: c.optIn, spent: Math.round(c.spent * 100) / 100,
    warrantyClaims: c.warrantyClaims, daysSinceLast: daysBetween(c.last, today),
  });
  const allCustomers = [...customers.values()].map(publicCustomer)
    .sort((a, b) => b.visits - a.visits || b.spent - a.spent || b.last.localeCompare(a.last));
  const customerSummary = {
    inPeriod: periodKeys.size,
    new: metric(newKeys.length, prevNew.length),
    returning: periodKeys.size - newKeys.length,
    returningRate: periodKeys.size ? Math.round(((periodKeys.size - newKeys.length) / periodKeys.size) * 100) : 0,
    total: customers.size,
    withPhone: allCustomers.filter(c => c.phone).length,
    optedIn: allCustomers.filter(c => c.optIn && c.phone).length,
    noPhoneInPeriod: cur.filter(o => !String(o.phone || '').replace(/\D/g, '')).length,
  };

  // ---------- Marketing: segmentos accionables ----------
  // Solo se pueden contactar clientes con teléfono Y permiso de promociones.
  // transactional = aviso sobre SU equipo (no es publicidad): basta con teléfono.
  const segment = (id, title, action, rows, { transactional = false } = {}) => {
    const seen = new Map();
    for (const r of rows) if (!seen.has(r.key)) seen.set(r.key, r);
    const list = [...seen.values()];
    const contacts = list.filter(r => r.phone && (transactional || r.optIn));
    return { id, title, action, transactional, total: list.length, contactable: contacts.length,
      contacts: contacts.map(({ key, ...rest }) => rest) };
  };
  const row = (o, detail) => {
    const c = customers.get(keyOf.get(o.id));
    return { key: c.key, name: c.name, phone: c.phone, optIn: c.optIn,
      model: displayModel(o), date: o.delivered_day || o.day, detail };
  };
  const recent = all.filter(o => between(o.day, from, to));
  const listoSince = new Map(db.prepare(`SELECT order_id, MAX(created_at) AS at FROM order_events
      WHERE event_type = 'status' AND to_status = 'Listo' GROUP BY order_id`).all().map(r => [r.order_id, r.at.slice(0, 10)]));
  const segments = [
    segment('pickup', 'Listos y sin recoger (3+ días)', 'Llamar para que lo recoja (aviso de servicio)',
      all.filter(o => o.status === 'Listo' && listoSince.has(o.id) && daysBetween(listoSince.get(o.id), today) >= 3)
        .sort((a, b) => listoSince.get(a.id).localeCompare(listoSince.get(b.id)))
        .map(o => ({ ...row(o, `Listo hace ${daysBetween(listoSince.get(o.id), today)} días · ${o.ticket}${o.price ? ' · $' + o.price : ''}`), date: listoSince.get(o.id) })),
      { transactional: true }),
    segment('review', 'Entregados en los últimos 14 días', 'Pedir reseña en Google',
      all.filter(o => between(o.delivered_day, addDays(today, -13), today) && o.warranty_result !== 'No cubierta')
        .map(o => row(o, 'Entregado'))),
    segment('cases', 'Pantalla o tapa rota y llegó sin funda', 'Ofrecer funda + protector de pantalla',
      recent.filter(o => o.problems.some(p => SCREEN_PROBLEMS.includes(p)) && !o.arrival.includes('Con funda'))
        .map(o => row(o, o.problems.filter(p => SCREEN_PROBLEMS.includes(p)).join(', ')))),
    segment('chargers', 'Llegó sin cargador o con falla de carga', 'Ofrecer cargador / cable original',
      recent.filter(o => o.arrival.includes('Sin cargador') || o.problems.includes('Charging port') || o.problems.includes('No carga'))
        .map(o => row(o, o.arrival.includes('Sin cargador') ? 'Sin cargador' : 'Falla de carga'))),
    segment('warranty-ending', 'Garantía vence en los próximos 7 días', 'Ofrecer revisión gratis antes de que venza',
      all.filter(o => o.status === 'Entregado' && o.delivered_day && !o.warranty_of)
        .filter(o => { const left = daysBetween(today, addDays(o.delivered_day, WARRANTY_DAYS)); return left >= 0 && left <= 7; })
        .map(o => row(o, `Vence ${addDays(o.delivered_day, WARRANTY_DAYS)}`))),
    segment('inactive', `No vuelven hace más de ${INACTIVE_DAYS} días`, 'Promoción de regreso / recordatorio',
      [...customers.values()].filter(c => daysBetween(c.last, today) > INACTIVE_DAYS)
        .map(c => ({ key: c.key, name: c.name, phone: c.phone, optIn: c.optIn,
          model: [...c.models].pop() || '', date: c.last, detail: `${daysBetween(c.last, today)} días` }))),
  ];

  // ---------- Repuestos: qué tener en stock ----------
  const partRows = new Map();
  const modelLabel = new Map(); // modelKey -> nombre más usado
  const labelCounts = new Map();
  for (const o of all) {
    const mk = modelKey(o);
    const label = displayModel(o);
    const counts = labelCounts.get(mk) || new Map();
    counts.set(label, (counts.get(label) || 0) + 1);
    labelCounts.set(mk, counts);
  }
  for (const [mk, counts] of labelCounts) {
    modelLabel.set(mk, [...counts].sort((a, b) => b[1] - a[1])[0][0]);
  }
  const bump = (o, field) => {
    for (const problem of o.problems) {
      const part = PART_FOR_PROBLEM[problem];
      if (!part) continue;
      const mk = modelKey(o);
      const id = `${part}|${mk}`;
      const r = partRows.get(id) || { part, model: modelLabel.get(mk), period: 0, previous: 0, last90: 0, warrantyReturns: 0, repairs90: 0 };
      r[field]++;
      partRows.set(id, r);
    }
  };
  // Las garantías "No cubierta"/"Vencida" sí consumen repuesto; las cubiertas
  // también (se repone la pieza). Todas cuentan como demanda.
  for (const o of cur) bump(o, 'period');
  for (const o of prev) bump(o, 'previous');
  for (const o of all.filter(x => between(x.day, demandFrom, today))) bump(o, 'last90');
  // Calidad: reparaciones originales (90 días) que volvieron por garantía cubierta.
  for (const o of all.filter(x => !x.warranty_of && between(x.day, demandFrom, today))) bump(o, 'repairs90');
  for (const claim of all.filter(o => o.warranty_of && o.warranty_result === 'Cubierta')) {
    const original = byId.get(claim.warranty_of);
    if (original && between(original.day, demandFrom, today)) bump(original, 'warrantyReturns');
  }
  const weeks = DEMAND_WINDOW_DAYS / 7;
  const parts = [...partRows.values()].map(r => {
    const perWeek = Math.round((r.last90 / weeks) * 10) / 10;
    const suggested = r.last90 ? Math.max(1, Math.ceil((r.last90 / weeks) * STOCK_WEEKS)) : 0;
    const trend = pctChange(r.period, r.previous);
    const returnRate = r.repairs90 ? Math.round((r.warrantyReturns / r.repairs90) * 100) : 0;
    let priority = 'Baja';
    if (suggested >= 2 || (r.period >= 3 && (trend === null || trend > 0))) priority = 'Alta';
    else if (r.last90 >= 2) priority = 'Media';
    return { ...r, perWeek, suggested, trend, returnRate, priority };
  }).filter(r => r.period || r.previous || r.last90)
    .sort((a, b) => ({ Alta: 0, Media: 1, Baja: 2 }[a.priority] - { Alta: 0, Media: 1, Baja: 2 }[b.priority])
      || b.last90 - a.last90 || b.period - a.period);

  // Accesorios: oportunidades de venta por modelo en el período.
  const accessoriesByModel = new Map();
  for (const o of cur) {
    const label = modelLabel.get(modelKey(o));
    const a = accessoriesByModel.get(label) || { model: label, cases: 0, chargers: 0 };
    if (o.problems.some(p => SCREEN_PROBLEMS.includes(p)) && !o.arrival.includes('Con funda')) a.cases++;
    if (o.arrival.includes('Sin cargador')) a.chargers++;
    accessoriesByModel.set(label, a);
  }
  const accessories = [...accessoriesByModel.values()].filter(a => a.cases || a.chargers)
    .sort((a, b) => (b.cases + b.chargers) - (a.cases + a.chargers)).slice(0, 12);

  // Modelos más atendidos en el período (para decidir qué modelos cubrir).
  const modelCounts = new Map();
  for (const o of cur) {
    const label = modelLabel.get(modelKey(o));
    modelCounts.set(label, (modelCounts.get(label) || 0) + 1);
  }
  const prevModelCounts = new Map();
  for (const o of prev) {
    const label = modelLabel.get(modelKey(o));
    prevModelCounts.set(label, (prevModelCounts.get(label) || 0) + 1);
  }
  const topModels = [...modelCounts].map(([label, value]) => ({
    label, value, previous: prevModelCounts.get(label) || 0, change: pctChange(value, prevModelCounts.get(label) || 0),
  })).sort((a, b) => b.value - a.value).slice(0, 10);

  res.json({
    generatedAt: new Date().toISOString(),
    period: { from, to, days: spanDays, prevFrom, prevTo, today },
    summary,
    pipeline,
    customers: { summary: customerSummary, top: allCustomers.slice(0, 10), all: allCustomers },
    segments,
    stock: { parts, accessories, topModels, rules: { stockWeeks: STOCK_WEEKS, demandWindowDays: DEMAND_WINDOW_DAYS } },
  });
});

// Una sola orden por id (para edición). Protegido con requireAuth como el
// resto de /api/orders/* (B-2: openEdit ya no descarga todas las órdenes).
app.get('/api/orders/:id', (req, res) => {
  const row = db.prepare(`
    SELECT o.*,
      (SELECT e.created_at FROM order_events e WHERE e.order_id = o.id
        AND e.event_type = 'status' AND e.to_status = o.status
        ORDER BY e.created_at DESC, e.id DESC LIMIT 1) AS status_changed_at,
      ${deliveredAtSql('o')} AS delivered_at,
      ${warrantyOfTicketSql('o')} AS warranty_of_ticket
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

// Garantía / devolución de una orden ya entregada.
// Crea una ORDEN NUEVA vinculada a la original (la original no se toca, así
// su historial y las métricas de entrega siguen siendo correctos).
// Resultado, decidido aquí y no en el navegador:
//   - Vencida:     pasaron más de WARRANTY_DAYS días desde la entrega.
//   - No cubierta: dentro del plazo, pero es daño del cliente.
//   - Cubierta:    dentro del plazo y es falla de fábrica / de la reparación.
// Una orden "No cubierta" o "Vencida" se trabaja como reparación normal (con costo).
app.post('/api/orders/:id/warranty', (req, res) => {
  const original = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!original) return res.status(404).json({ error: 'Orden no encontrada.' });
  if (original.status !== 'Entregado') {
    return res.status(409).json({ error: 'Solo se abre garantía de una orden ya entregada.' });
  }
  const open = db.prepare("SELECT ticket FROM orders WHERE warranty_of = ? AND status <> 'Entregado'").get(original.id);
  if (open) {
    return res.status(409).json({ error: `Ya hay una garantía abierta para esta orden: ${open.ticket}.` });
  }
  const p = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const cause = typeof p.cause === 'string' ? p.cause : '';
  // Los datos del cliente y del equipo salen de la orden original.
  const body = {
    customer_name: original.customer_name,
    phone: original.phone || '',
    device_type: original.device_type,
    model: original.model,
    imei: original.imei || '',
    problems: p.problems,
    arrival_condition: p.arrival_condition,
    received_by: req.staffUser.username,
    agreement: p.agreement,
    diagnostic_note: p.diagnostic_note,
    assigned_technician: p.assigned_technician,
    promised_at: p.promised_at,
    price: p.price,
    marketing_opt_in: original.marketing_opt_in === 1,
  };
  const errors = validateOrder(body);
  if (!isNonEmptyString(p.diagnostic_note)) errors.push('Escribe qué dice el cliente que le pasa.');
  if (!Object.prototype.hasOwnProperty.call(WARRANTY_CAUSES, cause)) {
    errors.push('Elige si es falla de fábrica o daño del cliente.');
  }
  if (errors.length) return res.status(400).json({ errors: [...new Set(errors)] });

  const deliveredAt = getDeliveredAt(original.id) || original.updated_at;
  const info = warrantyInfo(deliveredAt);
  const result = !info.warranty_active ? 'Vencida' : (cause === 'cliente' ? 'No cubierta' : 'Cubierta');

  const row = withTransaction(() => {
    const ticket = nextTicket();
    const inserted = insertOrderWithCodeRetry(ticket, body,
      { of: original.id, result, reason: WARRANTY_CAUSES[cause] });
    const created = db.prepare('SELECT * FROM orders WHERE id = ?').get(inserted.lastInsertRowid);
    const actor = req.staffUser.username;
    recordOrderEvent(created.id, created.ticket, 'status', null, 'Recibido', actor, created.assigned_technician);
    if (created.assigned_technician) {
      recordOrderEvent(created.id, created.ticket, 'technician_assigned', null, null, actor, created.assigned_technician);
    }
    const insertDetail = db.prepare(`
      INSERT INTO order_events (order_id, ticket, event_type, actor, details) VALUES (?, ?, ?, ?, ?)
    `);
    insertDetail.run(created.id, created.ticket, 'warranty_opened', actor,
      `Garantía de ${original.ticket}: ${result} — ${WARRANTY_CAUSES[cause]}`);
    insertDetail.run(original.id, original.ticket, 'warranty_claim', actor,
      `Volvió por garantía: ${created.ticket} (${result})`);
    return created;
  });
  res.status(201).json({ ...toPublic(row), warranty_of_ticket: original.ticket });
});

// Inserta la orden reintentando el customer_code si colisiona (UNIQUE).
// Colisiones son astronómicamente improbables (8 chars, ~1 billón de
// combinaciones), pero el reintento evita un 500 espurio si alguna ocurre.
// `warranty` viene solo del servidor (endpoint de garantía), nunca del body.
function insertOrderWithCodeRetry(ticket, b, warranty = {}) {
  const MAX_CODE_ATTEMPTS = 5;
  for (let attempt = 1; attempt <= MAX_CODE_ATTEMPTS; attempt++) {
    const customerCode = generateCustomerCode();
    try {
      return db.prepare(`
        INSERT INTO orders
          (ticket, customer_code, customer_name, phone, device_type, model, imei, problems, arrival_condition, received_by, agreement, diagnostic_note, assigned_technician, promised_at, price, marketing_opt_in, warranty_of, warranty_result, warranty_reason, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Recibido')
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
        (b.promised_at || '').trim() || null,
        priceValue(b.price),
        b.marketing_opt_in === true ? 1 : 0,
        warranty.of ?? null,
        warranty.result ?? null,
        warranty.reason ?? null
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
    // Garantía: hasta cuándo (si ya se entregó) y, si es una garantía, su resultado.
    warranty_until: row.status === 'Entregado'
      ? (warrantyInfo(getDeliveredAt(row.id)) || {}).warranty_until || null : null,
    warranty_result: row.warranty_result || null,
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
  // Si la pantalla estaba desactualizada (otra persona ya cambió el estado
  // desde otro equipo), no se avanza dos veces: se avisa.
  const expected = req.body && typeof req.body.from === 'string' ? req.body.from : null;
  if (expected && expected !== row.status) {
    return res.status(409).json({ error: `Otra persona ya cambió esta orden a "${row.status}". Se actualizó la lista.` });
  }
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
      previous_technician, assigned_technician, actor, details, created_at
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
  // Ediciones simultáneas: si la orden cambió desde que se abrió el formulario
  // (otra persona, otro equipo), no se sobrescribe en silencio.
  if (req.body && typeof req.body.expected_updated_at === 'string' &&
      req.body.expected_updated_at !== existing.updated_at) {
    return res.status(409).json({ error: 'Otra persona cambió esta orden mientras la editabas. Cierra y vuelve a abrirla para ver sus cambios; los tuyos no se guardaron.' });
  }
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
  const price = Object.prototype.hasOwnProperty.call(b, 'price') ? priceValue(b.price) : existing.price;
  const optIn = typeof b.marketing_opt_in === 'boolean' ? (b.marketing_opt_in ? 1 : 0) : existing.marketing_opt_in;
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
        diagnostic_note = ?, assigned_technician = ?, promised_at = ?, price = ?, marketing_opt_in = ?,
        status = ?, updated_at = datetime('now', 'localtime')
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
      price,
      optIn,
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

// Estado de los respaldos (para el aviso del panel).
app.get('/api/backup-status', staffRateLimit, requireAuth, (req, res) => {
  res.json({ enabled: AUTO_BACKUP, ...backupState });
});

// NO_LISTEN=1: solo prepara la base (lo usa seed-demo.js), sin abrir el puerto.
if (process.env.NO_LISTEN !== '1') {
  // Al apagar (pm2/systemd envían SIGTERM; Ctrl+C es SIGINT) se hace el
  // respaldo pendiente antes de salir.
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.once(signal, () => {
      if (backupState.pending) runBackup('apagado');
      process.exit(0);
    });
  }
  app.listen(PORT, () => {
    console.log(`Órdenes de Reparación corriendo en http://localhost:${PORT}`);
    console.log(`Modo: ${process.env.NODE_ENV || 'development'}`);
    if (process.env.DB_FILE) console.log(`Base de datos: ${DB_FILE}`);
  });
}
module.exports = { db, DB_FILE, generateCustomerCode, WARRANTY_DAYS, TECHNICIANS, STATUSES };
