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
- **Customer status lookup** — the customer enters their code (not the ticket) and sees only minimal info: ticket, name, device, problems and status. Never phone, IMEI, notes or agreements. Rate-limited (30/min per IP)
- **Rate limiting on staff routes** — `/api/orders*` limited to 300 requests/min per IP (429 if exceeded); tunable via `STAFF_RATE_LIMIT_MAX` / `TRACK_RATE_LIMIT_MAX` env vars
- **Audit trail** — every status change (advance, edit, delete) is recorded with timestamp, order, from/to status and actor; viewable at `GET /api/orders/:id/audit`
- **Delete test orders** — orders still in `Recibido` can be deleted (API + "Eliminar" button on the card); later statuses are protected
- **Backups** — `npm run backup` snapshots the database to timestamped files in `backend/backups/` (see Backups section)
- **Security headers** on every response (`nosniff`, `DENY` framing, `no-referrer`, basic CSP) and no `X-Powered-By` fingerprint
- **Geeks Hollywood branding** — official logo, brand blue `#3399ff`, red accent `#ef3f56`, dark navy header. Two clearly-marked placeholder slots are reserved for **Blu**, the shop mascot (header + above the intake form) — waiting on the real mascot image.

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
│   ├── backups/            # timestamped DB copies (git-ignored)
│   └── package.json
├── CHANGELOG.md            # version history
└── README.md
```

## Run it

Requirements: **Node.js 22+** (uses the built-in `node:sqlite` module) and npm.

```bash
cd backend
npm install
node server.js
```

Then open **http://localhost:3000** in your browser.

- The SQLite database file (`backend/repairshop.db`) is created automatically on first run and starts empty.
- To run on a different port: `PORT=8080 node server.js`
- `npm start` runs the server with `NODE_ENV=production`. In production the global error handler returns a generic "Error interno del servidor." message to clients and logs the full error (with stack trace) server-side only — stack traces never reach the client. Run `node server.js` directly for local debugging (development mode); client-facing error behavior is the same in both modes.

### Local con login (para probar)

El taller requiere iniciar sesión. El admin inicial se crea **solo** desde variables de entorno — nunca hay credenciales en el código:

```bash
cd backend
cp .env.example .env   # edítalo y pon tu usuario/clave
npm run start:local    # lee backend/.env automáticamente
```

Abre **http://localhost:3000** e inicia sesión con tu usuario de `.env`.

- `.env` está en `.gitignore`: jamás se sube a git.
- Sin `ADMIN_USER`/`ADMIN_PASSWORD` el servidor arranca igual pero sin usuarios (verás el aviso en consola).
- Sesiones de 12 h en cookie httpOnly; `POST /api/change-password` cambia la clave (mínimo 8 caracteres).

## Backups

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
| GET    | `/api/orders`             | List orders (`?search=`, `?status=`)     |
| POST   | `/api/orders`             | Create order (validates required fields) |
| GET    | `/api/track/:code`        | Public customer status lookup by unguessable code (minimal fields, rate-limited) |
| POST   | `/api/orders/:id/advance`| Advance status one step                  |
| PUT    | `/api/orders/:id`         | Full edit of an order                    |
| DELETE | `/api/orders/:id`         | Delete an order (only in `Recibido` status; 404/409 otherwise) |
| GET    | `/api/orders/:id/audit`   | Status-change history of an order (audit trail) |

## Notes

- All UI text is in Spanish, matching the shop's counter workflow.
- Blu mascot slots are intentional placeholders (`blu-slot-header`, `blu-slot-intake` in the HTML/CSS) — replace with the real mascot image when available.
- `npm audit` is blocked by the sandbox network proxy (403 `policy_denied` on the npm security endpoint, verified 2026-10-16). Run it from an unrestricted network before any production deploy, and deploy with `npm ci`. Manual review 2026-10-16: `express 4.22.3` and `qs 6.16.0` are current; no applicable CVEs found by hand.
