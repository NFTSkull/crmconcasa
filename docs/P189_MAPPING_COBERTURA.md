# P189 — Matriz de cobertura mapping v2 FINAL

Fuente de verdad ejecutable: `supabase/functions/_shared/infonavit-pdf/p189-field-coverage.ts` (test vs SHA/nombres de plantilla v1).

**Regla de monto:** `resolve_monto_operativo_mejoravit` (NO `monto_aprobado`).

**Firma:** no hay AcroForm de firma. Carta T8 = nombre textual. Presupuesto T10 = fecha. Las líneas de firma del PDF quedan vacías.

**Año Solicitud T59:** 2 dígitos. La plantilla imprime `de 20` → se lee «de 2026».

**Teléfono empresa:** `telefonoEmpresa` son 10 dígitos canónicos. No hay parser fiable de LADA (81 vs 55 vs 228). Decisión: T16 = número completo, T15 LADA vacío, T17 extensión vacía.

**Número de identificación:** el CRM no define si es clave de elector, OCR o CIC. `datos.infonavit.titular.identificacion` es texto libre y B8 no lo captura. **REQUIERE DECISIÓN DE NEGOCIO** (Fase 2).

Ver entregable de certificación para tablas campo → fuente.
