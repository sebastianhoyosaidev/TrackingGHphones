// Taller simulado — llena una base de datos APARTE con meses de órdenes
// falsas pero realistas, para probar la app sin clientes reales.
//
// Uso (desde backend/):
//   node seed-demo.js                 # crea demo.db con 180 días de historia
//   node seed-demo.js --days 90       # menos historia
//   node seed-demo.js --reset         # borra demo.db y lo vuelve a crear
// Luego abre la app sobre esa base:
//   DB_FILE=demo.db ADMIN_USER=demo ADMIN_PASSWORD=demo1234 node server.js
//   (PowerShell: $env:DB_FILE="demo.db"; $env:ADMIN_USER="demo"; $env:ADMIN_PASSWORD="demo1234"; node server.js)
//
// Seguridad:
//   - Nunca escribe en repairshop.db (la base real), ni con --reset.
//   - Se niega a escribir en una base que ya tenga órdenes (usa --reset).
//   - Todos los teléfonos usan 555-0100…0199, el rango reservado para
//     números ficticios en EE. UU.; ningún número es real.
//   - Cada orden lleva "DEMO" en el acuerdo.
//   - Generador pseudoaleatorio con semilla fija: mismo resultado cada vez.
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const argVal = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const DAYS = Math.max(7, Math.min(730, parseInt(argVal('--days', '180'), 10) || 180));
const FILE = argVal('--file', 'demo.db');
const target = path.resolve(__dirname, FILE);
if (path.basename(target) === 'repairshop.db') {
  console.error('Este script no escribe en repairshop.db (la base real). Usa otro archivo, p. ej. --file demo.db');
  process.exit(1);
}
if (args.includes('--reset')) {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    try { fs.unlinkSync(target + suffix); } catch { /* no existe */ }
  }
}

// Crea el esquema completo cargando el servidor sin abrir el puerto.
process.env.DB_FILE = target;
process.env.NO_LISTEN = '1';
process.env.ADMIN_USER = process.env.ADMIN_USER || 'demo';
process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'demo1234';
const { db, generateCustomerCode, TECHNICIANS } = require('./server.js');

if (db.prepare('SELECT COUNT(*) AS n FROM orders').get().n > 0) {
  console.error(`${FILE} ya tiene órdenes. Usa --reset para empezar de cero.`);
  process.exit(1);
}

// ---------- Aleatoriedad reproducible ----------
let seed = 20261022;
function rand() { // mulberry32
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const chance = p => rand() < p;
const pick = list => list[Math.floor(rand() * list.length)];
const between = (a, b) => a + rand() * (b - a);
function weighted(pairs) {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [v, w] of pairs) { if ((r -= w) <= 0) return v; }
  return pairs[pairs.length - 1][0];
}

// ---------- Catálogos ----------
const FIRST = ['Juan', 'María', 'José', 'Ana', 'Luis', 'Carmen', 'Carlos', 'Sofía', 'Miguel', 'Valentina',
  'Jorge', 'Camila', 'Andrés', 'Daniela', 'Pedro', 'Isabella', 'Ricardo', 'Gabriela', 'Fernando', 'Lucía',
  'Michael', 'Jessica', 'David', 'Ashley', 'Chris', 'Brittany', 'James', 'Amanda', 'Kevin', 'Nicole',
  'Alejandro', 'Paola', 'Diego', 'Natalia', 'Javier', 'Andrea', 'Rafael', 'Mariana', 'Héctor', 'Yesenia'];
const LAST = ['García', 'Rodríguez', 'Martínez', 'Hernández', 'López', 'González', 'Pérez', 'Sánchez',
  'Ramírez', 'Torres', 'Flores', 'Rivera', 'Gómez', 'Díaz', 'Reyes', 'Morales', 'Cruz', 'Ortiz',
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Miller', 'Davis', 'Wilson', 'Castillo', 'Vargas',
  'Mendoza', 'Rojas', 'Guzmán', 'Álvarez', 'Medina', 'Castro', 'Suárez', 'Peña'];
const AREA = ['239', '305', '321', '352', '386', '407', '561', '727', '754', '772', '786', '813', '850', '863', '904', '941', '954'];

// [tipo, modelo, peso, nivel de precio 1..5]
const DEVICES = [
  ['iPhone', 'iPhone 11', 6, 1], ['iPhone', 'iPhone 12', 7, 2], ['iPhone', 'iPhone 12 Pro', 3, 2],
  ['iPhone', 'iPhone 13', 10, 2], ['iPhone', 'iPhone 13 Pro Max', 4, 3], ['iPhone', 'iPhone 14', 8, 3],
  ['iPhone', 'iPhone 14 Pro', 5, 4], ['iPhone', 'iPhone 15', 6, 4], ['iPhone', 'iPhone 15 Pro Max', 4, 5],
  ['iPhone', 'iPhone 16', 3, 5], ['iPhone', 'iPhone SE (2022)', 2, 1],
  ['Samsung', 'Galaxy S21', 3, 2], ['Samsung', 'Galaxy S22 Ultra', 3, 4], ['Samsung', 'Galaxy S23', 4, 3],
  ['Samsung', 'Galaxy S24 Ultra', 2, 5], ['Samsung', 'Galaxy A14', 4, 1], ['Samsung', 'Galaxy A15', 4, 1],
  ['Samsung', 'Galaxy A54', 3, 2], ['Samsung', 'Galaxy Z Flip 5', 1, 5],
  ['Otro', 'iPad 9', 2, 2], ['Otro', 'iPad Air 5', 1, 3], ['Otro', 'Motorola Moto G Power', 3, 1],
  ['Otro', 'Google Pixel 7', 2, 2], ['Otro', 'Apple Watch Series 7', 1, 2],
];
const PROBLEMS = [
  ['Pantalla partida', 34], ['Batería', 15], ['Charging port', 11], ['Backglass roto', 9],
  ['Diagnóstico', 7], ['No carga', 6], ['Cámara trasera', 4], ['Software', 4], ['Mojado', 3],
  ['No enciende', 3], ['Cámara frontal', 2], ['Otro', 2],
];
// Precio base por problema según nivel (1..5) del modelo.
const PRICE = {
  'Pantalla partida': [110, 150, 210, 280, 360], 'Batería': [69, 79, 89, 99, 119],
  'Charging port': [59, 69, 79, 89, 99], 'Backglass roto': [89, 109, 139, 169, 199],
  'Cámara trasera': [79, 99, 129, 159, 199], 'Cámara frontal': [69, 79, 99, 119, 139],
  'Software': [40, 40, 50, 50, 60], 'Mojado': [80, 90, 100, 110, 120], 'No carga': [59, 69, 79, 89, 99],
  'No enciende': [60, 70, 80, 90, 100], 'Otro': [50, 60, 70, 80, 90], 'Diagnóstico': [0, 0, 0, 0, 0],
};
const PART_TEXT = {
  'Pantalla partida': 'cambio de pantalla', 'Batería': 'cambio de batería', 'Charging port': 'cambio de puerto de carga',
  'Backglass roto': 'cambio de tapa trasera', 'Cámara trasera': 'cambio de cámara trasera',
  'Cámara frontal': 'cambio de cámara frontal', 'Software': 'reinstalar software', 'Mojado': 'limpieza por líquido',
  'No carga': 'revisar carga', 'No enciende': 'revisar encendido', 'Otro': 'revisión', 'Diagnóstico': 'diagnóstico',
};

// ---------- Utilidades de fecha (zona del taller, ya fijada por server.js) ----------
const pad = n => String(n).padStart(2, '0');
const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const day = d => fmt(d).slice(0, 10);
const addHours = (d, h) => new Date(d.getTime() + h * 3600000);
const now = new Date();
const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (DAYS - 1));

// ---------- Clientes ----------
const customers = [];
const usedPhones = new Set();
function newPhone() {
  for (let i = 0; i < 50; i++) {
    const p = `${pick(AREA)}-555-01${pad(Math.floor(rand() * 100))}`;
    if (!usedPhones.has(p)) { usedPhones.add(p); return p; }
  }
  return '';
}
function newCustomer() {
  const c = {
    name: `${pick(FIRST)} ${pick(LAST)}`,
    phone: chance(0.92) ? newPhone() : '',
    optIn: chance(0.45),
    visits: [],
  };
  customers.push(c);
  return c;
}
// Variantes reales de escritura en el mostrador.
function typedName(c) {
  if (!chance(0.2)) return c.name;
  return pick([
    c.name.normalize('NFD').replace(/[̀-ͯ]/g, ''), // sin tildes
    c.name.toLowerCase(),
    c.name.split(' ')[0],                                    // solo el nombre
  ]);
}
function typedPhone(c) {
  if (!c.phone || !chance(0.3)) return c.phone;
  const d = c.phone.replace(/\D/g, '');
  return pick([`(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`, d, `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`]);
}
function typedModel(model) {
  if (!chance(0.15)) return model;
  return pick([model.toLowerCase(), model.replace('iPhone ', 'iphone '), model.replace('Galaxy ', '')]);
}

// ---------- Generación ----------
const orders = []; // { created, ...campos, events: [{at, from, to}] }
function chooseProblems() {
  const first = weighted(PROBLEMS);
  const list = [first];
  if (chance(0.12)) {
    const second = weighted(PROBLEMS);
    if (second !== first && second !== 'Diagnóstico') list.push(second);
  }
  return list;
}
function arrivalFor(problems) {
  const a = [];
  if (problems.includes('Mojado') || chance(0.03)) a.push('Mojado');
  if (problems.includes('Backglass roto') || chance(0.05)) a.push('Backglass partido');
  if (problems.includes('No enciende')) a.push('No prende');
  if (chance(0.35)) a.push('Rayones');
  if (problems.includes('Pantalla partida') ? chance(0.4) : chance(0.1)) a.push('Golpes visibles');
  if (chance(0.3)) a.push('Con funda');
  if (chance(0.45)) a.push('Sin cargador');
  return a;
}
function priceFor(problems, level) {
  let total = 0;
  for (const p of problems) total += PRICE[p][level - 1];
  if (problems.length > 1) total = Math.round(total * 0.9); // descuento por combo
  return total;
}
// Avanza el estado con tiempos realistas, sin pasar de "ahora".
function timeline(created, problems) {
  const events = [{ at: created, from: null, to: 'Recibido' }];
  let t = created;
  // Diagnóstico: a veces queda días esperando que el cliente apruebe.
  const startWait = problems.includes('Diagnóstico') ? between(4, chance(0.3) ? 120 : 30) : between(0.3, 26);
  const steps = [['En reparación', startWait], ['Listo', between(1, chance(0.15) ? 96 : 40)],
    ['Entregado', chance(0.06) ? 99999 : between(0.5, chance(0.2) ? 200 : 60)]];
  let from = 'Recibido';
  for (const [to, hours] of steps) {
    const next = addHours(t, hours);
    // Solo en horario del taller (10:00–19:30); si cae fuera, al día siguiente.
    if (next.getHours() < 10) next.setHours(10, Math.floor(rand() * 59));
    if (next.getHours() >= 20) { next.setDate(next.getDate() + 1); next.setHours(10, Math.floor(rand() * 59)); }
    if (next > now) break;
    events.push({ at: next, from, to });
    from = to; t = next;
  }
  return events;
}

for (let d = new Date(start); d <= now; d.setDate(d.getDate() + 1)) {
  const weekday = d.getDay();
  if (weekday === 0) continue; // domingo cerrado
  // Crece un poco con el tiempo; sábados más movidos.
  const growth = 1 + 0.4 * ((d - start) / (now - start || 1));
  const n = Math.round((weekday === 6 ? between(7, 12) : between(4, 10)) * growth);
  for (let i = 0; i < n; i++) {
    const created = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 10 + Math.floor(rand() * 9), Math.floor(rand() * 60), Math.floor(rand() * 60));
    if (created > now) continue;
    // ~25% son clientes que vuelven (más probable si vinieron hace poco).
    let c;
    const previous = customers.filter(x => x.visits.length);
    if (previous.length > 20 && chance(0.25)) {
      c = chance(0.6) ? pick(previous.slice(-Math.min(previous.length, 120))) : pick(previous);
    } else c = newCustomer();
    // Un cliente que vuelve trae a menudo el mismo equipo.
    const dev = c.visits.length && chance(0.55) ? c.visits[c.visits.length - 1].dev : weighted(DEVICES.map(x => [x, x[2]]));
    const problems = chooseProblems();
    const isDiag = problems.includes('Diagnóstico');
    const order = {
      created, customer: c, dev, problems,
      customer_name: typedName(c), phone: typedPhone(c),
      device_type: dev[0], model: typedModel(dev[1]),
      imei: chance(0.3) ? `35${Math.floor(between(1e12, 9e12))}` : '',
      arrival: arrivalFor(problems),
      technician: chance(0.82) ? pick(TECHNICIANS) : null,
      promised: chance(0.6) ? day(addHours(created, 24 * Math.ceil(between(1, 3)))) : null,
      // A veces se olvida poner el precio; en diagnósticos aún no se sabe.
      price: isDiag ? (chance(0.5) ? null : 35) : (chance(0.1) ? null : priceFor(problems, dev[3])),
      diagnostic_note: isDiag ? pick(['Se apagó y no prende', 'Se calienta mucho', 'La pantalla parpadea',
        'No suena en llamadas', 'Se reinicia solo', 'Dice que se mojó un poco']) : '',
      optIn: c.optIn,
      events: timeline(created, problems),
    };
    c.visits.push(order);
    orders.push(order);
  }
}

// Garantías: ~5% de las entregadas vuelven dentro de 1–75 días.
const claims = [];
for (const o of orders) {
  const delivered = o.events.find(e => e.to === 'Entregado');
  if (!delivered || !chance(0.05)) continue;
  const back = addHours(delivered.at, 24 * between(1, 75));
  back.setHours(10 + Math.floor(rand() * 9));
  if (back > now) continue;
  const cause = chance(0.6) ? 'fabrica' : 'cliente';
  const daysSince = Math.floor((new Date(day(back)) - new Date(day(delivered.at))) / 86400000);
  const result = daysSince > 60 ? 'Vencida' : (cause === 'cliente' ? 'No cubierta' : 'Cubierta');
  const problems = o.problems.filter(p => p !== 'Diagnóstico').slice(0, 1);
  if (!problems.length) continue;
  claims.push({
    created: back, customer: o.customer, dev: o.dev, problems, original: o,
    customer_name: o.customer_name, phone: o.phone, device_type: o.device_type, model: o.model, imei: o.imei,
    arrival: cause === 'cliente' ? ['Golpes visibles', ...(chance(0.4) ? ['Mojado'] : [])] : ['Con funda'],
    technician: o.technician || pick(TECHNICIANS), promised: null,
    price: result === 'Cubierta' ? 0 : priceFor(problems, o.dev[3]),
    diagnostic_note: cause === 'cliente' ? pick(['Se le cayó otra vez', 'Se le mojó', 'Dice que no lo golpeó, pero tiene golpe'])
      : pick(['La pantalla nueva dejó de tocar', 'La batería dura poco', 'Vuelve a no cargar', 'Líneas en la pantalla']),
    optIn: o.optIn, warranty: { result, reason: cause === 'cliente' ? 'Daño del cliente (partido, golpe, mojado…)' : 'Falla de fábrica / de la reparación' },
    events: timeline(back, problems),
  });
}

// ---------- Inserción en orden cronológico ----------
const all = [...orders, ...claims].sort((a, b) => a.created - b.created);
const insertOrder = db.prepare(`
  INSERT INTO orders (ticket, customer_code, customer_name, phone, device_type, model, imei, problems,
    arrival_condition, received_by, agreement, diagnostic_note, status, created_at, updated_at,
    assigned_technician, promised_at, price, marketing_opt_in, warranty_of, warranty_result, warranty_reason)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
const insertEvent = db.prepare(`
  INSERT INTO order_events (order_id, ticket, event_type, from_status, to_status, assigned_technician, actor, details, created_at, source_audit_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
const insertAudit = db.prepare(`
  INSERT INTO audit_log (order_id, ticket, from_status, to_status, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)`);
const bumpTicket = db.prepare("UPDATE counters SET value = value + 1 WHERE name = 'ticket' RETURNING value");
const STAFF = 'geeks';

db.exec('BEGIN');
try {
  for (const o of all) {
    const ticket = 'GH-' + String(bumpTicket.get().value).padStart(4, '0');
    const last = o.events[o.events.length - 1];
    const agreement = `DEMO — ${o.problems.map(p => PART_TEXT[p]).join(' + ')}` +
      (o.price ? `, $${o.price}` : o.warranty?.result === 'Cubierta' ? ', sin costo (garantía)' : ', precio por confirmar') +
      (o.promised ? `, listo el ${o.promised}` : '');
    const info = insertOrder.run(ticket, generateCustomerCode(), o.customer_name, o.phone, o.device_type, o.model,
      o.imei, JSON.stringify(o.problems), JSON.stringify(o.arrival), STAFF, agreement, o.diagnostic_note,
      last.to, fmt(o.created), fmt(last.at), o.technician, o.promised, o.price, o.optIn ? 1 : 0,
      o.original ? o.original.dbId : null, o.warranty?.result || null, o.warranty?.reason || null);
    o.dbId = Number(info.lastInsertRowid);
    o.ticket = ticket;
    insertEvent.run(o.dbId, ticket, 'status', null, 'Recibido', o.technician, STAFF, null, fmt(o.created), null);
    if (o.technician) insertEvent.run(o.dbId, ticket, 'technician_assigned', null, null, o.technician, STAFF, null, fmt(o.created), null);
    if (o.original) {
      insertEvent.run(o.dbId, ticket, 'warranty_opened', null, null, null, STAFF,
        `Garantía de ${o.original.ticket}: ${o.warranty.result} — ${o.warranty.reason}`, fmt(o.created), null);
      insertEvent.run(o.original.dbId, o.original.ticket, 'warranty_claim', null, null, null, STAFF,
        `Volvió por garantía: ${ticket} (${o.warranty.result})`, fmt(o.created), null);
    }
    for (const e of o.events.slice(1)) {
      const audit = insertAudit.run(o.dbId, ticket, e.from, e.to, STAFF, fmt(e.at));
      insertEvent.run(o.dbId, ticket, 'status', e.from, e.to, o.technician, STAFF, null, fmt(e.at), Number(audit.lastInsertRowid));
    }
  }
  db.exec('COMMIT');
} catch (e) {
  db.exec('ROLLBACK');
  throw e;
}

const count = q => db.prepare(q).get().n;
console.log(`Taller simulado creado en ${FILE}: ${DAYS} días de historia.`);
console.log(`  Órdenes: ${count('SELECT COUNT(*) AS n FROM orders')} (garantías: ${count('SELECT COUNT(*) AS n FROM orders WHERE warranty_of IS NOT NULL')})`);
console.log(`  Clientes distintos: ${customers.length} · que volvieron: ${customers.filter(c => c.visits.length > 1).length}`);
console.log(`  Abiertas: ${count("SELECT COUNT(*) AS n FROM orders WHERE status <> 'Entregado'")}`);
console.log(`Usuario de la demo: ${process.env.ADMIN_USER} / ${process.env.ADMIN_USER === 'demo' ? 'demo1234' : '(el de ADMIN_PASSWORD)'}`);
db.close();
