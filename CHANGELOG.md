# Historial de versiones — Órdenes de Reparación (Geeks Hollywood)

Notas de cada versión publicada. El código vive en este repo privado;
la app de verdad corre en el servidor (Oracle Cloud).

## v1.4.0 — 2026-10-22 — Garantías, dinero por entrar y panel de clientes, marketing y repuestos

**Garantía / devolución (60 días)**
- Botón "Garantía / Devolución" en cada orden Entregada. La tarjeta muestra
  hasta cuándo tiene garantía y cuántos días quedan (60 días desde la entrega;
  configurable con `WARRANTY_DAYS`).
- La garantía crea una orden nueva vinculada a la original (la original no se
  modifica). El servidor decide el resultado: **Cubierta** (falla de fábrica o
  de la reparación dentro del plazo), **No cubierta** (daño del cliente:
  partido, golpe, mojado) o **Vencida** (más de 60 días).
- Aviso si se marca "falla de fábrica" pero el equipo llegó mojado, golpeado o
  con la tapa partida. No se permite abrir dos garantías a la vez para la
  misma orden. Queda registrado en el historial de ambas órdenes y la consulta
  del cliente muestra la fecha de fin de garantía.

**Dinero**
- Campo nuevo "Precio acordado en $" (opcional) en Nueva orden, Editar y
  Garantía. Validado en el servidor (0–100 000).
- Panel: "Dinero por entrar" con total abierto, recibido, en reparación y
  listo para cobrar; cobrado hoy; dinero en órdenes listas hace más de 48 h;
  aviso de órdenes sin precio.

**Panel más fluido y preciso**
- Períodos rápidos (Hoy, 7 días, 30 días, Este mes, 90 días, Este año).
  Los filtros se aplican solos; el contenido no parpadea al actualizar.
- Comparación con el período anterior (▲▼ %) para órdenes, entregas, cobrado,
  ticket promedio y garantías.
- Pestañas nuevas: **Clientes** (nuevos, recurrentes, gasto, búsqueda,
  exportar CSV), **Marketing** (5 segmentos accionables con lista y CSV) y
  **Repuestos y accesorios** (demanda por repuesto y modelo, tendencia, stock
  sugerido para 2 semanas, tasa de regreso por garantía como indicador de
  calidad del proveedor, modelos más atendidos, oportunidades de venta de
  fundas/protectores y cargadores).
- Casilla "El cliente acepta recibir promociones": solo esos clientes aparecen
  como contactables en Marketing (cumplimiento TCPA).

**Mostrador y lista de órdenes**
- Al escribir el teléfono en Nueva orden, la app reconoce al cliente: muestra
  sus visitas, avisa si tiene una **orden abierta** (evita duplicados) o un
  equipo **en garantía** (botón para abrir la garantía en vez de cobrar), y
  permite usar sus datos guardados.
- Búsqueda sin importar tildes/mayúsculas y con el teléfono en cualquier
  formato ("2395550108", "(239) 555-0108", "239-555-0108").
- La lista de Órdenes carga de 50 en 50 ("Mostrar más") en vez de todo de
  golpe; la búsqueda espera a que termines de escribir.
- Marketing: lista nueva "Listos y sin recoger (3+ días)" como **aviso de
  servicio** (se puede avisar a cualquier cliente con teléfono).

**Vista rápida en todo el panel**
- Un clic en cualquier tarjeta (dinero por entrar, comparaciones, indicadores)
  o barra de gráfico despliega sus 6 órdenes más recientes; cada una abre la
  orden y "Ver todas" abre la lista filtrada. Una sola lista abierta a la vez
  (segundo clic o Esc la cierra). Filas de Clientes también.
- Cada lista pide solo 6 órdenes y se guarda en memoria hasta que cambian los
  filtros. Verificado: las 56 listas cuadran con el número de su tarjeta.
- Se quitó "Órdenes creadas por período" y el filtro "Agrupar por".

**Siempre en línea y sin perder datos**
- Respaldo automático verificado tras cada cambio (1 min sin cambios, máx.
  10 min), al arrancar (antes de migrar) y al apagar. Se guardan 48 recientes
  + 1 por día durante 30 días. El panel muestra "Último respaldo automático".
- Ediciones simultáneas: si otra persona cambió la orden mientras la
  editabas, no se sobrescribe (aviso). "Avanzar estado" desde una lista vieja
  ya no avanza dos veces.
- La lista de Órdenes y el panel se actualizan solos cada 30 s y al volver a
  la app, sin interrumpir formularios ni listas abiertas.

**Correcciones de exactitud**
- Historial duplicado (venía de v1.3.0): cada reinicio volvía a copiar los
  cambios de estado, inflando "Entregadas hoy", entregas por técnico y tiempos.
  Se corrige la causa y se limpian automáticamente los duplicados existentes.
- Tiempo de reparación: ahora mide recibido → listo (antes hasta entregado,
  sumando la espera de recogida; en la simulación salía el doble). La espera
  de recogida se muestra aparte.
- "Entregadas por técnico" mostraba la cifra de pendientes.
- Antigüedad "2–3 días" y "4–7 días" siempre salían vacías al pulsarlas.

**Taller simulado (para pruebas)**
- `node seed-demo.js` crea `demo.db` con 6 meses de órdenes falsas realistas
  (clientes que repiten, garantías, equipos sin recoger, precios). Nunca toca
  `repairshop.db`. La app la usa con `DB_FILE=demo.db`.

**Correcciones**
- Zona horaria del taller (`America/New_York`, configurable con `TZ`): antes
  las horas se guardaban en UTC (4–5 h adelantadas).
- El campo de contraseña del login no tenía estilo.
- Confirmación antes de marcar Entregado (no se puede deshacer).
- Si la sesión caduca, la página lo dice y vuelve al login en vez de mostrar
  "Error al guardar" o "Revisa la conexión".
- Errores al avanzar estado ahora se muestran.
- Los CSV escapan valores que empiezan por `= + - @` (inyección de fórmulas
  en Excel).

## v1.3.0 — 2026-10-21 — Panel operativo, asignación y reportes

**Panel de operaciones**
- Nueva sección inicial después del inicio de sesión, con tarjetas para órdenes
  creadas hoy, abiertas, en reparación, listas, entregadas hoy, envejecidas,
  con promesa vencida y esperando recogida.
- Filtros por rango de fechas, estado, técnico, tipo de equipo y granularidad
  diaria, semanal o mensual.
- Gráficos ligeros basados en barras accesibles, sin añadir librerías. Cada
  barra lleva a la lista de órdenes con los filtros correspondientes.
- Gráficos para órdenes creadas, estados, carga y entregas por técnico, tipos
  de equipo, problemas frecuentes, antigüedad, espera para recogida y mediana
  del tiempo de reparación.
- Exportación CSV de la lista que coincide con los filtros del panel.
- Estados visibles de carga, falta de datos y error; diseño adaptable a móvil,
  tableta y escritorio.

**Técnicos y flujo**
- Lista fija de técnicos Fabio, Oliver, Sebastian, Fernando, Maria y Elder;
  asignación opcional separada de `received_by` y editable en la orden.
- Fecha prometida opcional, con validación del lado servidor y detección de
  vencimiento cuando una orden no entregada ya pasó la fecha.
- Historial común de creación, cambios de estado y asignaciones, con actor y
  marca de tiempo. La tarjeta de orden muestra el historial bajo demanda y la
  fecha desde que está en el estado actual.
- Actualizaciones de orden, estado, auditoría y eventos dentro de transacciones
  SQLite para evitar que los datos y su registro queden desincronizados.

**Migración y métricas**
- Migración aditiva al iniciar: agrega `assigned_technician`, `promised_at` y
  `order_events`, e importa las fechas de `audit_log` de forma idempotente.
- Órdenes existentes quedan sin asignación ni fecha prometida. No se infieren
  técnicos históricos a partir de `received_by`.
- Envejecimiento definido como 72 horas abierta; espera de recogida como 48
  horas en `Listo`; reparación como tiempo entre recepción y transición a
  `Entregado`. El reporte por técnico solo atribuye cierres con asignación
  guardada al momento de entrega.
- Nueva guía de migración y reversión en `MIGRATIONS.md`.

**Revisión general del código**
- `npm start` usa `backend/start.js` para establecer modo producción de forma
  portable en Windows, macOS y Linux.
- Se agregó `backend/.env.example`, que faltaba aunque README indicaba copiarlo.
- Las cookies malformadas se ignoran con seguridad; el rate limiter limpia IPs
  inactivas periódicamente y devuelve `Retry-After` al limitar solicitudes.
- Se corrigieron las clases CSS del estado `En reparación` y se reforzó el
  contraste de las etiquetas de estado.
- No se añadieron dependencias de visualización ni cuentas de técnicos.

## v1.2.0 — 2026-10-09 — Robustez del servidor y herramientas de taller

**Formulario de recepción**
- Nuevo botón "Rellenar datos de prueba": llena el formulario con datos
  falsos (Test User, 300-000-0000, …) para probar rápido sin escribir.
- Si el servidor rechaza la orden, el formulario ahora baja (scroll) y enfoca
  el primer campo faltante o inválido, con un resaltado rojo temporal.
  También aplica al formulario de edición.

**Manejo de errores**
- Nuevo middleware global de errores: el cliente siempre recibe un mensaje
  genérico ("Error interno del servidor."); el error completo con stack trace
  se registra solo en el log del servidor. Nunca se filtran detalles internos.
- El cuerpo JSON malformado responde 400 con mensaje claro.
- `npm start` ahora corre con `NODE_ENV=production` (documentado en README).

**Códigos de cliente**
- Al crear una orden, si el `customer_code` aleatorio colisionara (casi
  imposible: ~1 billón de combinaciones), se reintenta con un código nuevo
  hasta 5 veces antes de devolver 500. El ticket no se regenera en los
  reintentos (no se queman números extra).

**Límites de peticiones (rate limiting)**
- Nuevo límite general para las rutas del taller (`/api/orders*`):
  300 peticiones por minuto por IP (responde 429 si se excede).
- La consulta pública (`/api/track/:code`) mantiene su límite de 30/min por IP.
- Los máximos se pueden ajustar con `STAFF_RATE_LIMIT_MAX` y
  `TRACK_RATE_LIMIT_MAX` (útil para pruebas).

**Validación en el servidor**
- Topes de longitud en todos los campos de texto: nombre 100, teléfono 30,
  tipo de equipo 30, modelo 100, IMEI 40, quién recibe 100, qué se acordó 2000,
  nota de diagnóstico 2000 caracteres.
- `problems` y `arrival_condition` deben ser listas de textos: máximo 12
  elementos, 40 caracteres cada uno. Cualquier violación responde 400 con
  mensaje claro en español.

**Base de datos**
- SQLite ahora abre en modo WAL (`journal_mode = WAL`) con `busy_timeout`
  de 5000 ms: las lecturas no bloquean a las escrituras y el servidor espera
  el candado en vez de fallar de inmediato.

**Eliminar órdenes de prueba**
- Nuevo `DELETE /api/orders/:id`: elimina órdenes todavía en estado
  `Recibido` (la forma segura de borrar órdenes de prueba falsas).
  Responde 404 si no existe y 409 si ya avanzó de estado.
- En la lista de órdenes aparece un botón "Eliminar" solo en tarjetas con
  estado Recibido (pide confirmación).

**Auditoría de estados**
- Nueva tabla `audit_log`: cada cambio de estado (avance, edición o
  eliminación) guarda fecha/hora, id y ticket de la orden, estado anterior y
  nuevo, y actor ("staff" hasta que exista login).
- Nuevo `GET /api/orders/:id/audit`: historial de cambios de una orden
  (404 si la orden no existe).

**Cabeceras de seguridad**
- La CSP ahora incluye `object-src 'none'`, `base-uri 'self'` y
  `frame-ancestors 'self'`, sin romper el frontend existente.

**Respaldos**
- Nuevo `npm run backup` (`backend/backup.js`): copia `repairshop.db` con
  `VACUUM INTO` a `backend/backups/repairshop-AAAAMMDD-HHMMSS.db`
  (carpeta ignorada por git). Instrucciones de restauración en README.

**Evaluación Express 5**
- Se evaluó migrar de Express 4 a 5: esfuerzo bajo (~1–2 h con pruebas) y
  riesgo bajo para este código (sin rutas comodín ni sintaxis afectada), pero
  beneficio marginal ahora. Recomendación: migrar después, junto con el
  track de login del personal. No se migró en esta versión.

**Versiones**
- `backend/package.json` 1.0.0 → 1.1.0 (iguala lo documentado en este historial).

## v1.1.0 — 2026-10-03 — Seguridad del lado del cliente

**Código de consulta imposible de adivinar**
- Cada orden ahora genera un `customer_code` aleatorio de 8 caracteres
  (ej: `X7K2P9QW`, ~1 billón de combinaciones). Migración automática para
  órdenes existentes.
- El ticket secuencial (`GH-0001`, …) sigue existiendo pero es solo de uso
  interno del taller.

**Consulta pública mínima y protegida**
- Nuevo endpoint `GET /api/track/:code`: devuelve solo ticket, nombre del
  cliente, equipo, problemas y estado. Jamás teléfono, IMEI, notas internas
  ni lo acordado con el cliente.
- Límite de 30 consultas por minuto por IP (responde 429 si se excede).
- Eliminado `GET /api/orders/:ticket`: era secuencial y devolvía la fila completa.

**Cabeceras de seguridad**
- `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer` y CSP básica en cada respuesta.
- Se eliminó la cabecera `X-Powered-By` (no anunciar la tecnología).

**Frontend**
- La pantalla de éxito muestra el ticket interno y el código para el cliente.
- La vista "Consultar" ahora pide el código en vez del ticket.

## v1.0.0 — 2026-10-03 — Lanzamiento inicial

- Recepción rápida de órdenes: nombre, teléfono (opcional), tipo de equipo,
  modelo, IMEI (opcional), problemas multi-selección, cómo llegó, quién recibe,
  qué se acordó y nota de diagnóstico (obligatoria si es diagnóstico).
- Tickets secuenciales `GH-0001`, `GH-0002`, …
- Flujo de estados: Recibido → En reparación → Listo → Entregado.
- Lista de órdenes con búsqueda, filtro por estado, avance en un toque y edición.
- Consulta de ticket para mostrar el estado al cliente.
- Branding de Geeks Hollywood (logo, azul `#3399ff`, rojo `#ef3f56`).
- Backend: Node.js 22.5+ + Express + `node:sqlite` (sin build step).
