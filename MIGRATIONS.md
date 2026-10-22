# Migración de base de datos — v1.4.0

Automática al iniciar `backend/server.js`. Solo **agrega** columnas; no cambia ni borra datos existentes. Haz `npm run backup` antes, como siempre.

- `orders.warranty_of INTEGER NULL`: id de la orden original cuando la orden es una garantía.
- `orders.warranty_result TEXT NULL`: `Cubierta` | `No cubierta` | `Vencida`.
- `orders.warranty_reason TEXT NULL`: causa elegida por el personal.
- `orders.price REAL NULL`: precio acordado. Las órdenes anteriores quedan sin precio (el panel avisa cuántas).
- `orders.marketing_opt_in INTEGER NOT NULL DEFAULT 0`: permiso de promociones. Las órdenes anteriores quedan en 0 (sin permiso).
- `order_events.details TEXT NULL`: texto de eventos de garantía.
- Índice `idx_orders_warranty_of`.

Las fechas de garantía se calculan con el evento real de `Entregado` del historial, así que las órdenes ya entregadas antes de esta versión también muestran su garantía.

**Limpieza de historial duplicado (única operación que borra filas):** al arrancar se eliminan de `order_events` las filas importadas desde `audit_log` (`source_audit_id` no nulo) que duplican exactamente un evento ya registrado por la app (misma orden, estados y segundo). Se conserva el original, que sí tiene el técnico. `audit_log` no se toca. Antes de esto se hace un respaldo automático al arrancar.

**Zona horaria:** desde v1.4.0 el servidor usa `America/New_York` (o la variable `TZ`). Las órdenes creadas antes con hora UTC conservan su hora guardada (aparecen 4–5 h adelantadas); no se reescriben para no alterar datos.

**Reversión:** volver al código anterior funciona con la base migrada (ignora las columnas nuevas).

---

# Migración local de base de datos — v1.3.0

La versión 1.3.0 agrega asignación de técnico, fecha prometida y un historial común de eventos. La migración corre automáticamente al iniciar `backend/server.js`; no modifica tickets, clientes, códigos de consulta, estados actuales ni filas de auditoría existentes.

## Cambios de esquema

- `orders.assigned_technician TEXT NULL`: técnico responsable actual. Las órdenes anteriores quedan sin asignar.
- `orders.promised_at TEXT NULL`: fecha opcional prometida (`YYYY-MM-DD`). Las órdenes anteriores quedan sin fecha.
- `order_events`: línea de tiempo de creación, cambios de estado y asignación de técnico. No usa una clave foránea a `orders`, así que los eventos de una orden eliminada no desaparecen.
- `order_events.source_audit_id`: identifica cada fila migrada desde `audit_log` y hace que la importación pueda repetirse sin duplicados.
- `order_events.previous_technician`: guarda el técnico anterior cuando se cambia o quita la asignación.

## Antes de iniciar la versión nueva

En la carpeta `backend`, crea una copia con la versión actual:

```bash
npm run backup
```

La herramienta usa SQLite `VACUUM INTO` para producir una copia consistente. Conserva esa copia en una ubicación segura antes de iniciar la versión actualizada con una base de datos existente.

## Qué hace la migración

1. Agrega las columnas nuevas únicamente cuando todavía no existen.
2. Crea `order_events` e índices si faltan.
3. Para cada orden sin eventos, registra la recepción en el `created_at` real de la orden.
4. Copia cada fila de `audit_log` con su fecha, actor y estados originales.
5. No asigna técnicos retrospectivamente ni deriva una fecha prometida a partir de notas o acuerdos.

Los pasos son idempotentes: si el inicio se interrumpe y se vuelve a ejecutar, no vuelve a copiar los eventos de auditoría ya identificados.

## Reversión

La migración es aditiva. La opción de reversión menos riesgosa es volver a la versión anterior del código y conservar la base migrada: el código anterior ignora las columnas y la tabla nuevas. La información nueva seguirá almacenada, aunque la versión anterior no la muestre.

Para volver también el esquema al estado previo, detén el servidor y restaura la copia creada antes de la migración. Guarda primero la base actual y sus archivos WAL/SHM para no perder órdenes recibidas después de la copia. No borres columnas ni la tabla `order_events` mientras haya datos nuevos que deban conservarse.

Esta guía describe solo una operación en la copia local. No ejecuta ni autoriza una migración en ningún servidor remoto.
