# Órdenes de Reparación — Geeks Hollywood

Repair order management web app for phone and electronics shops — fast intake, status tracking, and ticket lookup.

Built for **Geeks Hollywood** (4514 Hollywood Blvd, Hollywood, FL · (754) 888-9631).

## Features

- **Fast intake (Spanish UI)** — a repair order in under 30 seconds:
  - Customer name (required), phone (optional)
  - Device type quick-tap: iPhone, Samsung, Otro
  - Model (required), IMEI (optional)
  - Problems multi-select: Diagnóstico, Pantalla partida, Backglass roto, Charging port, Cámara frontal, Cámara trasera, No carga, Batería, No enciende, Mojado, Software, Otro
  - If **Diagnóstico** is selected, "¿Qué dice el cliente?" becomes required
  - "¿Cómo llegó?" multi-select: Mojado, Backglass partido, No prende, Rayones, Golpes visibles, Con funda, Sin cargador, Otro
  - Received by (required), what was agreed with the customer (required)
- **Ticket numbers** auto-generated (`GH-0001`, `GH-0002`, …) for internal shop use, plus a separate **unguessable customer code** (e.g. `X7K2P9QW`) shown big after saving so staff can give it to the customer
- **Orders list** — search by name / ticket / model / phone, filter by status, one-tap status advance (Recibido → En reparación → Listo → Entregado), full edit of existing orders
- **Operational dashboard (v1.3.0)** — Spanish KPI cards, date/status/technician/device filters, clickable lightweight bar charts, and a filtered CSV report
- **Technician assignment** — optional responsible technician from the six-person roster; separate from the authenticated user who received the device
- **Promised date and workflow history** — optional promised completion date, status-change timestamps, technician assignment history, and order history on each card
- **Warranty / returns (v1.4.0)** — 60-day warranty from delivery. A claim is a new order linked to the original; the server decides *Cubierta* (factory/repair defect within 60 days), *No cubierta* (customer damage) or *Vencida* (over 60 days)
- **Money (v1.4.0)** — optional agreed price per order; dashboard shows money still to collect (open / in repair / ready), collected, average ticket
- **Customers, marketing and parts insights (v1.4.0)** — repeat customers, marketing segments limited to customers who opted in to promotions (TCPA), parts demand per model with suggested stock and warranty-return rate, accessory sales opportunities
- **Customer status lookup** — the customer enters their code (not the ticket) and sees only minimal info: ticket, name, device, problems and status. Never phone, IMEI, notes or agreements. Rate-limited (30/min per IP)
- **Rate limiting on staff routes** — `/api/orders*` limited to 300 requests/min per IP (429 if exceeded); tunable via `STAFF_RATE_LIMIT_MAX` / `TRACK_RATE_LIMIT_MAX` env vars
- **Audit trail** — every status change (advance, edit, delete) is recorded with timestamp, order, from/to status and actor; viewable at `GET /api/orders/:id/audit`
- **Delete test orders** — orders still in `Recibido` can be deleted (API + "Eliminar" button on the card); later statuses are protected
- **Backups** — `npm run backup` snapshots the database to timestamped files in `backend/backups/` (see Backups section)
- **Security headers** on every response (`nosniff`, `DENY` framing, `no-referrer`, basic CSP) and no `X-Powered-By` fingerprint
- **Geeks Hollywood branding** — official logo, brand orange `#F05228`, blue `#2B5FA6`, red accent `#ef3f56`, dark navy header.

## Tech

Plain HTML/CSS/JS frontend + Node.js (Express) backend + SQLite via Node's built-in `node:sqlite` (no native dependencies to compile). No build step, dependency-light.

```
TrackingGHphones/
├── frontend/
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   └── assets/
│       └── logo.png        # Geeks Hollywood logo
├── backend/
│   ├── server.js           # Express API + SQLite
│   ├── backup.js           # DB backup script (npm run backup)
│   ├── start.js            # Portable production-mode entry point
│   ├── .env.example        # Local environment template
│   ├── backups/            # timestamped DB copies (git-ignored)
│   └── package.json
├── MIGRATIONS.md           # Safe additive migration and rollback guide
├── CHANGELOG.md            # version history
├── REPORTE_COMPLETO_PARA_MUSE_v1.3.0.md # Detailed handoff report
└── README.md
```

## Run it

Requirements: **Node.js 22+** (uses the built-in `node:sqlite` module) and npm.

```bash
cd backend
npm install
npm start
```

Then open **http://localhost:3000** in your browser.

- The SQLite database file (`backend/repairshop.db`) is created automatically on first run and starts empty.
- To run on a different port, set `PORT` in the current shell before `npm start`.
- `npm start` uses a small Node entry point to set `NODE_ENV=production` portably on Windows, macOS, and Linux. The global error handler returns a generic "Error interno del servidor." message to clients and logs the full error server-side only. Run `node server.js` directly for local debugging.

### Local con login (para probar)

El taller requiere iniciar sesión. El admin inicial se crea **solo** desde variables de entorno — nunca hay credenciales en el código:

```bash
cd backend
cp .env.example .env   # edítalo y pon tu usuario/clave (PowerShell: Copy-Item .env.example .env)
npm run start:local    # lee backend/.env automáticamente
```

Abre **http://localhost:3000** e inicia sesión con tu usuario de `.env`.

- `.env` está en `.gitignore`: jamás se sube a git.
- Sin `ADMIN_USER`/`ADMIN_PASSWORD` el servidor arranca igual pero sin usuarios (verás el aviso en consola).
- Sesiones de 12 h en cookie httpOnly; `POST /api/change-password` cambia la clave (mínimo 8 caracteres).

## Taller simulado (datos de prueba)

Para probar la app con meses de datos realistas **sin clientes reales**:

```bash
cd backend
node seed-demo.js            # crea demo.db (180 días). --days 90 para menos, --reset para rehacerla
DB_FILE=demo.db node server.js
# PowerShell: $env:DB_FILE="demo.db"; node server.js
```

Entra con `demo` / `demo1234` (o con `ADMIN_USER`/`ADMIN_PASSWORD` si los definiste al crear la demo).
El script nunca escribe en `repairshop.db`, se niega a sobrescribir una demo con órdenes sin `--reset`,
y todos los teléfonos usan el rango ficticio 555-0100…0199. Para volver a los datos reales, inicia el
servidor sin `DB_FILE`.

## Panel e interpretación de métricas

El panel usa datos de órdenes y del historial local de estados. No inventa asignaciones antiguas. Las fechas "hoy" y los cortes de fecha usan la zona horaria del taller (`America/New_York` por defecto; se cambia con la variable `TZ`).

| Indicador o gráfico | Regla |
|---|---|
| Creadas hoy | Órdenes con `created_at` en la fecha local actual. |
| Abiertas | Estado actual distinto de `Entregado`. |
| En reparación / listas | Estado actual exactamente `En reparación` / `Listo`. |
| Entregadas hoy | Transiciones reales a `Entregado` registradas hoy. |
| Envejecidas | Abiertas durante al menos 72 horas. El gráfico separa 0–1, 2–3, 4–7 y 8+ días. |
| Promesa vencida | Orden no entregada cuya fecha prometida es anterior a hoy. |
| Esperando recogida | Estado `Listo` durante al menos 48 horas; el gráfico separa rangos de espera. |
| Tiempo de reparación | Mediana de horas entre recepción y transición a `Entregado`, usando `created_at` y el historial. |
| Carga por técnico | Órdenes abiertas con asignación actual. El trabajo completado usa la asignación guardada al entregar. |

Los filtros de fecha restringen los gráficos por creación; el gráfico de entregas y la mediana usan fecha de entrega. Los indicadores marcados "hoy" siguen representando el día local actual. Al seleccionar un gráfico se abre la lista con los filtros correspondientes. La exportación CSV contiene las órdenes que coinciden con los filtros activos.

Las órdenes previas a la versión 1.3.0 conservan la asignación y fecha prometida como vacías. El historial de estado existente en `audit_log` se copia conservando sus marcas de tiempo; las asignaciones históricas no se pueden reconstruir. Por eso el reporte por técnico solo atribuye el trabajo completado cuando existe una asignación registrada al momento de entrega.

Consulta [MIGRATIONS.md](MIGRATIONS.md) antes del primer inicio con una base de datos existente.

## Backups

**Automatic (v1.4.0):** the server backs up the database by itself, verified (`quick_check`), into `backend/backups/<db>-auto-YYYYMMDD-HHMMSS-mmm.db`:
after each saved change (waits 1 min of quiet, max 10 min), on start (before migrations) and on shutdown (SIGTERM/SIGINT).
It keeps the 48 newest plus one per day for 30 days. `AUTO_BACKUP=0` disables it; `BACKUP_DIR` changes the folder.
The dashboard shows "Último respaldo automático". **These copies live on the same server**: also copy the folder
off the server (e.g. a daily `rclone` to Google Drive or Oracle Object Storage) to survive losing the machine.

**Manual:**

```bash
cd backend
npm run backup
```

This copies `repairshop.db` to a timestamped file in `backend/backups/` (e.g. `repairshop-20261009-211500.db`) using SQLite's `VACUUM INTO` — a clean, consistent copy that is safe to take while the server is running. The `backups/` folder is git-ignored; copy the files somewhere safe (USB drive, cloud storage) on a regular schedule.

**Restore:** stop the server, then replace the live database with the backup:

```bash
# 1. Stop the server first!
cd backend
cp repairshop.db repairshop.db.before-restore   # safety copy of the current DB
cp backups/repairshop-20261009-211500.db repairshop.db
node server.js
```

WAL sidecar files (`repairshop.db-wal`, `repairshop.db-shm`) are recreated automatically — no need to back them up.
- For a shop computer on the local network, run the server there and open `http://<server-ip>:3000` from the counter devices.

## API (for developers)

| Method | Endpoint                  | Description                              |
|--------|---------------------------|------------------------------------------|
| GET    | `/api/orders`             | List orders (`limit`/`offset` paging with `X-Total-Count`; accent-insensitive `search`, phone in any format, `status`, `from`, `to`, `technician`, `device_type`, `problem`, aging/pickup buckets, completed technician/date) |
| GET    | `/api/dashboard`          | Authenticated KPI and chart data (`from`, `to`, `status`, `technician`, `device_type`, `interval`) |
| POST   | `/api/orders`             | Create order (validates required fields) |
| GET    | `/api/track/:code`        | Public customer status lookup by unguessable code (minimal fields, rate-limited) |
| POST   | `/api/orders/:id/advance`| Advance status one step                  |
| PUT    | `/api/orders/:id`         | Full edit of an order                    |
| DELETE | `/api/orders/:id`         | Delete an order (only in `Recibido` status; 404/409 otherwise) |
| GET    | `/api/orders/:id/audit`   | Status-change history of an order (audit trail) |
| GET    | `/api/orders/:id/history` | Status and technician assignment events |
| POST   | `/api/orders/:id/warranty`| Open a warranty claim for a delivered order (`problems`, `diagnostic_note`, `cause`: `fabrica`/`cliente`, `agreement`, optional `arrival_condition`, `assigned_technician`, `promised_at`, `price`) |
| GET    | `/api/insights`           | Customers, marketing segments, parts/stock and money pipeline (`from`, `to`) |
| GET    | `/api/backup-status`      | Automatic backup status (enabled, last file/time, last error, pending) |
| GET    | `/api/customers/lookup`   | Returning-customer lookup by phone (`phone`): visits, open orders, orders in warranty |

## Notes

- All UI text is in Spanish, matching the shop's counter workflow.
- `npm audit` is blocked by the sandbox network proxy (403 `policy_denied` on the npm security endpoint, verified 2026-10-16). Run it from an unrestricted network before any production deploy, and deploy with `npm ci`. Manual review 2026-10-16: `express 4.22.3` and `qs 6.16.0` are current; no applicable CVEs found by hand.
