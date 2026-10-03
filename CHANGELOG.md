# Historial de versiones — Órdenes de Reparación (Geeks Hollywood)

Notas de cada versión publicada. El código vive en este repo privado;
la app de verdad corre en el servidor (Oracle Cloud).

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
