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
- **Ticket numbers** auto-generated (`GH-0001`, `GH-0002`, …), shown big after saving so staff can give it to the customer
- **Orders list** — search by name / ticket / model / phone, filter by status, one-tap status advance (Recibido → En reparación → Listo → Entregado), full edit of existing orders
- **Ticket lookup screen** — enter a ticket number to show the current status to the customer in-store
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
│   └── package.json
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
- For a shop computer on the local network, run the server there and open `http://<server-ip>:3000` from the counter devices.

## API (for developers)

| Method | Endpoint                  | Description                              |
|--------|---------------------------|------------------------------------------|
| GET    | `/api/orders`             | List orders (`?search=`, `?status=`)     |
| POST   | `/api/orders`             | Create order (validates required fields) |
| GET    | `/api/orders/:ticket`     | Lookup one order by ticket (e.g. GH-0001)|
| POST   | `/api/orders/:id/advance`| Advance status one step                  |
| PUT    | `/api/orders/:id`         | Full edit of an order                    |

## Notes

- All UI text is in Spanish, matching the shop's counter workflow.
- Blu mascot slots are intentional placeholders (`blu-slot-header`, `blu-slot-intake` in the HTML/CSS) — replace with the real mascot image when available.
