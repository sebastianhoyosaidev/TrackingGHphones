# Handoff report for Muse — v1.4.0

**Repo:** `siiick78/TrackingGHphones` · **Branch:** `fix/hora-local-y-campo-password` · **Base:** `main` (v1.3.0, commit `5e38557`)
**Prepared by:** Claude, 2026-10-22, at the owner's request.
**Scope:** code only. Claude has no access to the Oracle server; Muse deploys.

---

## 1. TL;DR — what to do on the server

> ⚠️ **Do NOT delete the app folder and re-clone from scratch.** The live data lives in `backend/repairshop.db` (plus `-wal`/`-shm`) and the admin credentials in `backend/.env`. Both are git-ignored, so a fresh clone does **not** contain them and the shop would lose every order. Update the existing clone in place with `git pull` (below). If you must re-clone, copy `repairshop.db*` and `.env` out first and back in after.

```bash
# 0) Go to the existing app folder (adjust path)
cd /path/to/TrackingGHphones

# 1) Backup the database (safe while the server runs)
cd backend && npm run backup && cd ..
#    -> creates backend/backups/repairshop-YYYYMMDD-HHMMSS.db  (also copy it off the server)

# 2) Get the new code
git fetch origin
git checkout fix/hora-local-y-campo-password
git pull --ff-only origin fix/hora-local-y-campo-password

# 3) Dependencies: unchanged (still only express). Safe to skip, or:
cd backend && npm ci && cd ..

# 4) Restart the app the same way it runs today, e.g. one of:
#    pm2 restart <name>        |  sudo systemctl restart <service>
#    or stop the running `npm start` / `node start.js` and start it again
```

The database migration runs **automatically** on start and is additive (adds columns only). No env changes are required; optional ones are in §5.

When the owner approves, merge the branch into `main` on GitHub (PR "Compare & pull request" → Merge) and switch the server back to `main` with `git checkout main && git pull`.

---

## 2. Verify after restart (2 minutes)

Open `http://193.122.140.38:3000` and log in.

1. **Login page:** the password field now looks like the username field (rounded, full width).
2. **Panel:** a black "💵 Dinero por entrar" box at the top, period chips (Hoy / 7 días / 30 días…), and four tabs: Resumen · Clientes · Marketing · Repuestos y accesorios.
3. **Nueva orden:** new checkbox "El cliente acepta recibir promociones" under the phone, and new "Precio acordado en $" field under the agreement. Save a test order → the time shown in Órdenes must be **local Florida time**, not +4 h.
4. **Órdenes:** a delivered order shows "🛡 Garantía hasta … · quedan N días" and a green **Garantía / Devolución** button.
5. Delete the test order afterwards (only possible while it is in `Recibido`).
6. Server log: no errors on start (`Admin inicial creado.` / `Sin usuarios…` messages are normal).

The three existing test orders `GH-0003`, `GH-0004`, `GH-0005` (customer names start with "PRUEBA") can be deleted from the Órdenes tab.

---

## 2b. Demo mode — the owner wants to see a simulated shop in Chrome

All data so far is fake, and the owner wants to explore the app with months of realistic history (repeat customers, warranties, unpicked devices…). `backend/seed-demo.js` builds that in a **separate file `backend/demo.db`**; the real `repairshop.db` is never touched.

```bash
cd /path/to/TrackingGHphones/backend
# Create the simulated shop (180 days, ~1,400 orders, ~1,000 customers, ~40 warranty claims).
# Use the same login the owner already uses, so nothing new to remember:
node --env-file=.env seed-demo.js          # takes ADMIN_USER / ADMIN_PASSWORD from .env
#   (without .env: ADMIN_USER=... ADMIN_PASSWORD=... node seed-demo.js; default is demo / demo1234)
#   Re-generate from scratch later with:  node --env-file=.env seed-demo.js --reset
```

Then restart the app pointing at the demo DB (same URL, `http://193.122.140.38:3000`):

| How the app runs | Switch to demo | Switch back to real data |
|---|---|---|
| pm2 | `DB_FILE=demo.db pm2 restart <app> --update-env` | `DB_FILE=repairshop.db pm2 restart <app> --update-env` (set it explicitly: pm2 may keep an old value) |
| systemd | add `Environment=DB_FILE=demo.db` to the unit, `daemon-reload`, restart | remove the line, `daemon-reload`, restart |
| plain shell | stop it, then `DB_FILE=demo.db npm start` | stop it, then `npm start` |

On start the log prints `Base de datos: /…/demo.db` when `DB_FILE` is set. Safety built into the script: refuses `repairshop.db` even with `--reset`; refuses to overwrite a demo that already has orders unless `--reset`; every phone uses the reserved fictional range `NNN-555-0100…0199`; every agreement starts with `DEMO`; deterministic output. `demo.db` is git-ignored (`*.db`).

---

## 3. What changed

### 3.1 Timezone fix (backend/server.js, top of file)
Dates are stored with SQLite `datetime('now','localtime')`, which uses the process timezone. The Oracle VM runs in UTC, so times were 4–5 h ahead.

```js
process.env.TZ = process.env.TZ || 'America/New_York';
```
Placed before any date use. Verified: SQLite `localtime` and JS `Date` both follow it. Existing rows are **not** rewritten (they keep their UTC timestamps).

### 3.2 Warranty / returns (60 days)
- **Rule (enforced server-side, not in the browser):**
  - delivered more than `WARRANTY_DAYS` (default 60) days ago → `Vencida`
  - else cause `cliente` (customer damage: cracked, dropped, wet) → `No cubierta`
  - else cause `fabrica` (factory / repair defect) → `Cubierta`
- Delivery date = the real `Entregado` event in `order_events` (works for orders delivered before v1.4.0 too). Warranty covers through *delivery date + 60 days* inclusive.
- A claim **creates a new order** linked by `warranty_of`; customer/device/opt-in are copied from the original; `received_by` comes from the session. The original order is never modified (keeps delivery metrics correct).
- Refused if the original is not `Entregado` (409) or already has an open claim (409).
- `warranty_of`, `warranty_result`, `warranty_reason` can **only** be set by this endpoint; they are ignored in normal `POST /api/orders` bodies.
- History events: `warranty_opened` on the claim, `warranty_claim` on the original (text in `order_events.details`).
- Public lookup `/api/track/:code` additionally returns `warranty_until` and `warranty_result` (still no phone/IMEI/notes).

New endpoint:
```
POST /api/orders/:id/warranty   (auth)
body: { problems: string[], diagnostic_note: string, cause: "fabrica"|"cliente",
        agreement: string, arrival_condition?: string[], assigned_technician?: string,
        promised_at?: "YYYY-MM-DD", price?: number }
201 -> the new order (+ warranty_of_ticket)
```

### 3.3 Price and marketing consent
- `orders.price REAL NULL` — optional, validated `0..100000`.
- `orders.marketing_opt_in INTEGER 0/1` — checkbox at intake/edit. **Only opted-in customers with a phone are "contactable"** in marketing lists (US TCPA compliance).
- `PUT /api/orders/:id` keeps the stored price/opt-in when the fields are not sent.

### 3.4 New endpoint `GET /api/insights?from=&to=` (auth)
Current period vs. the previous period of the same length.
- `summary`: orders, delivered, collected (sum of price of orders delivered in period), average ticket, warranty claims — each with `previous` and `% change`.
- `pipeline` (current state, not date-filtered): money in Recibido / En reparación / Listo / total open, collected today, money in orders Listo > 48 h, orders without price.
- `customers`: a customer = same phone (last 10 digits, any format); without phone, same name (accent/case-insensitive). New vs returning, visits, spent, last visit, opt-in, warranty claims. Full list for CSV export.
- `segments` (marketing): delivered last 14 days → ask for Google review; screen/back-glass broken & arrived without case → sell case + protector; no charger / charging issue → sell charger; warranty ends in ≤ 7 days → free check-up; not back in > 90 days → come-back promo.
- `stock`: problem → part map (`Pantalla partida→Pantalla`, `Backglass roto→Backglass`, `Charging port→Puerto de carga`, `Cámara frontal/trasera`, `Batería`). Per part+model: count in period vs previous, demand per week over the last 90 days, **suggested stock = 2 weeks of demand**, priority, and **warranty-return rate** (covered claims ÷ original repairs, flags bad parts/suppliers). Plus top models and accessory opportunities per model. Model names are merged case-insensitively ("iphone 13" = "iPhone 13").

### 3.5 Frontend
- Dashboard redesign: quick period chips, filters auto-apply (250 ms debounce), stale responses ignored, old content stays visible while loading (no flicker), 4 tabs, comparison badges ▲▼, money panel (cards open the filtered order list), customer table with search + CSV, marketing segment cards with list + CSV, parts/models/accessories tables. Fully responsive; no new libraries; CSP unchanged (no inline styles/scripts).
- Warranty modal with live preview of the result and a warning when "factory defect" is chosen but the device arrived wet / dented / with cracked back glass.
- Order cards: price, warranty end date / days left, claim badge (green Cubierta / red No cubierta / grey Vencida).
- Confirmation before "Marcar como Entregado" (irreversible, starts the warranty clock).
- Session expiry (12 h) now shows "Tu sesión expiró" and returns to login instead of "Error al guardar" / "Revisa la conexión"; advance-status errors are shown.
- All CSV exports prefix values starting with `= + - @` with `'` (Excel formula injection).
- Password input styled (`input[type="password"]` was missing from the base input rule).

### 3.6 Counter, search and paging (found by running the simulated shop)
- `GET /api/customers/lookup?phone=` (auth): matches the last 10 digits in any format, returns name, visits, spent, **open orders** and **orders still in warranty** (excluding ones that already have an open claim). Intake shows it under the phone field with "Abrir garantía" / "Ver" / "Usar sus datos" buttons.
- `GET /api/orders` search moved from SQL `LIKE` to JS: accent/case-insensitive, and phone digits match any format (`2395550108`, `(239) 555-0108`). Two-phase query (light candidate scan → full rows only for the page).
- Paging: `?limit=&offset=` + `X-Total-Count` header. UI loads 50 at a time ("Mostrar más"), keeps the page after advance/edit/delete, 250 ms debounce on search. Without `limit` it returns everything (CSV export).
- Insights: new transactional segment `pickup` ("Listos y sin recoger 3+ días") — a service reminder, so contactable = has phone (no opt-in needed). Model labels no longer duplicate the brand ("iPhone iPhone 11").
- `DB_FILE` env var selects the SQLite file; `NO_LISTEN=1` prepares the DB without opening the port (used by the seed). `server.js` now `module.exports` a few internals for the seed script.

Simulated-shop results that drove these changes (1,418 orders): phone search in another format returned 0 of 3; "Carmen Diaz" returned 0 (stored "Díaz"); a returning customer with an active warranty could be charged as a new paid order with no warning; 77 devices "Listo" for 30+ days with no reminder list; `/api/orders` returned 1 MB per load. All fixed and re-verified.

### 3.7 Files
| File | Change |
|---|---|
| `backend/server.js` | TZ, migrations, warranty helpers + endpoint, price/opt-in, `/api/insights` |
| `frontend/app.js` | dashboard v2, insights rendering, warranty modal, price/opt-in, session/advance fixes, safe CSV |
| `frontend/index.html` | dashboard tabs/money panel, warranty modal, new form fields |
| `frontend/styles.css` | styles for all of the above, password field, bar label wrap fix |
| `backend/package.json` | version 1.4.0 (no dependency changes) |
| `backend/seed-demo.js` | new: simulated shop generator |
| `CHANGELOG.md`, `MIGRATIONS.md`, `README.md` | docs |

---

## 4. Database migration (automatic, additive)

```sql
ALTER TABLE orders ADD COLUMN warranty_of INTEGER;
ALTER TABLE orders ADD COLUMN warranty_result TEXT;
ALTER TABLE orders ADD COLUMN warranty_reason TEXT;
ALTER TABLE orders ADD COLUMN price REAL;
ALTER TABLE orders ADD COLUMN marketing_opt_in INTEGER NOT NULL DEFAULT 0;
ALTER TABLE order_events ADD COLUMN details TEXT;
CREATE INDEX IF NOT EXISTS idx_orders_warranty_of ON orders(warranty_of);
```
Each `ALTER` runs only if the column is missing (checked with `PRAGMA table_info`), so restarts are safe. Old code runs fine on the migrated DB (rollback = checkout `main` + restart).

---

## 5. Optional environment variables
| Var | Default | Meaning |
|---|---|---|
| `TZ` | `America/New_York` | Shop timezone |
| `DB_FILE` | `repairshop.db` | SQLite file (e.g. `demo.db` for the simulated shop) |
| `WARRANTY_DAYS` | `60` | Warranty length in days |

---

## 6. How it was tested (in Claude's sandbox)
- **37 end-to-end API checks** on a real server instance and real SQLite DB: price/opt-in validation, local time, warranty Cubierta / No cubierta / Vencida (delivery moved 70 days back), duplicate-claim and not-delivered refusals, field injection ignored, history, public lookup, edit preserving fields, insights numbers (revenue, open money, customer merge across phone formats, segments, parts demand, warranty return rate, model merge), auth required on new endpoints. **All passed.**
- **Migration test:** DB created and populated by the v1.3.0 `server.js` from `main`, then started with v1.4.0: old order readable, warranty date computed from its real delivery, claim opened, insights OK, clean log.
- **Simulated shop:** 1,418 orders / 180 days; scenario script (repeat customer by phone formats, accents, active-warranty detection, paging, pickup list, insights sanity, auth on the new endpoint). All endpoints < 210 ms on that dataset.
- **Visual test** with headless Chromium at 1280 px and 390 px (phone): every new screen, no console/CSP errors.
- Limitation: the sandbox could not reach the npm registry, so tests ran against a minimal Express-compatible test double (routing, JSON, static). `express` itself and `package-lock.json` are unchanged from v1.3.0. Please confirm the app starts normally after `npm ci` on the server.

---

## 7. Still open (recommended next)
1. **HTTPS** — the app is served over plain HTTP on a public IP; passwords and customer data travel unencrypted. Put Nginx + Let's Encrypt (domain needed) in front; the app already sets `Secure` cookies when behind HTTPS (`trust proxy` loopback).
2. **Individual staff accounts** — everyone shares one login, so history shows the same actor for every action. Needs a small user-management screen.
3. Run `npm audit` on the server (blocked in the sandbox).
4. Old orders created before the TZ fix keep UTC timestamps (shown 4–5 h ahead). Can be left as-is or corrected with a one-off script if the owner wants.
