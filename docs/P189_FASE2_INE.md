# P189 Fase 2 — extracción INE (diseño, NO implementar)

Propuesta de arquitectura. **0 migrations. 0 OCR en este hotfix.**

## Objetivo

Cuando el asesor suba `cliente_ine_frente` (y `cliente_ine_reverso` si existe), extraer campos de la credencial **sin** sobrescribir Datos Generales.

## Tabla propuesta `ine_extraction`

| columna | rol |
|---|---|
| id | PK |
| organization_id | RLS |
| expediente_id | FK |
| documento_id | `expediente_documentos.id` |
| document_version | versión del archivo |
| provider | nombre, no hardcode de vendor |
| provider_version | |
| status | pending / done / failed / skipped |
| created_at / processed_at | |
| payload_raw | JSONB protegido (PII; sin SELECT authenticated) |
| payload_normalized | campos con `{value, confidence, source_side, source_bbox?}` |

Campos normalizados aproximados: `nombreCompleto`, `nombres`, `apellidoPaterno`, `apellidoMaterno`, `curp`, `sexo`, `claveElector`, `ocr`, `cic`, `vigencia`, `anioRegistro`, `domicilioTexto`, `calle`, `numero`, `colonia`, `cp`, `municipio`, `estado`.

## Comparación vs CRM

Por dato: `MATCH` | `MISSING_IN_CRM` | `MISMATCH` | `LOW_CONFIDENCE`.

P189 solo usaría un dato INE si: CRM no tiene fuente mejor, confidence ≥ umbral, campo allowlist, sin mismatch sin resolver. Nunca reemplazo silencioso.

## Número de identificación (Solicitud T7)

**REQUIERE DECISIÓN DE NEGOCIO.** El repo no define si T7 es clave de elector, OCR, CIC u otro. B2 tenía `identificacion.numero` como texto libre. No elegir todavía.

Género: solo si la credencial muestra sexo y confidence alta. **No inferir de CURP.**

Vigencia: solo si el INE la muestra explícita. No construirla desde otros números.

## Runtime

- Server-side (Edge/worker), nunca service role en el navegador.
- Documento privado, hashes/versiones, idempotencia `(documento_id, document_version, provider_version)`.
- Asíncrono; upload no se bloquea si OCR falla; retries; `action_log` sin PII; payload_raw protegido; retención alineada al documento original.

## Proveedor (no escoger ahora)

| opción | nota |
|---|---|
| A. OCR clásico | barato; frágil en hologramas/fotos |
| B. Document AI | esquemas INE; costo/vendor |
| C. Modelo visión | flexible; necesita evaluación de PII/hosting |

La elección es decisión externa.
