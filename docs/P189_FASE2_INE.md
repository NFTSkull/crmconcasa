# P189 Fase 2 — extracción INE → evoluciona a Document Extractions

> **Actualización P2 (2026-09-17):** el diseño INE-only de esta nota evoluciona a la
> infraestructura genérica shadow documentada en [`DOCUMENT_EXTRACTIONS.md`](./DOCUMENT_EXTRACTIONS.md).
> P2 crea tablas/cola/enqueue + flag OFF. **Todavía no hay OCR ni autofill.**

Propuesta original (histórico). **0 OCR en el hotfix P189.**

## Objetivo

Cuando el asesor suba `cliente_ine_frente` (y `cliente_ine_reverso` si existe), extraer campos de la credencial **sin** sobrescribir Datos Generales.

## Tabla propuesta (histórico `ine_extraction`) → `document_extractions`

El modelo implementado en P2 es genérico (`document_extractions` + `document_extraction_jobs`)
con allowlist que incluye INE, comprobante de domicilio y estado de cuenta.
Ver columnas/estados/idempotencia/PII en `DOCUMENT_EXTRACTIONS.md`.

Campos normalizados aproximados (INE): `nombreCompleto`, `nombres`, `apellidoPaterno`, `apellidoMaterno`, `curp`, `sexo`, `claveElector`, `ocr`, `cic`, `vigencia`, `anioRegistro`, `domicilioTexto`, `calle`, `numero`, `colonia`, `cp`, `municipio`, `estado`.

## Comparación vs CRM

Por dato: `MATCH` | `MISSING_IN_CRM` | `MISMATCH` | `LOW_CONFIDENCE`.

Solo se usaría un dato INE si: CRM no tiene fuente mejor, confidence ≥ umbral, campo allowlist, sin mismatch sin resolver. Nunca reemplazo silencioso. (**Autofill = P4.**)

## Número de identificación (Solicitud T7)

**REQUIERE DECISIÓN DE NEGOCIO.** El repo no define si T7 es clave de elector, OCR, CIC u otro. B2 tenía `identificacion.numero` como texto libre. No elegir todavía. P2 no modela regla definitiva.

Género: solo si la credencial muestra sexo y confidence alta. **No inferir de CURP.**

Vigencia: solo si el INE la muestra explícita. No construirla desde otros números.

## Runtime

- Server-side (Edge/worker), nunca service role en el navegador.
- Documento privado, hashes/versiones, idempotencia por `documento_id` + provider (cada versión de archivo = UUID nuevo).
- Asíncrono; upload no se bloquea si OCR falla; retries; `action_log` sin PII; payload_raw protegido; retención alineada al documento original.
- **P2:** enqueue existe pero **no** está cableado a `register_expediente_documento`. Flag Vault DEFAULT OFF.

## Proveedor (no escoger ahora)

| opción | nota |
|---|---|
| A. OCR clásico | barato; frágil en hologramas/fotos |
| B. Document AI | esquemas INE; costo/vendor |
| C. Modelo visión | flexible; necesita evaluación de PII/hosting |

La elección es decisión externa. P2 no llama ningún proveedor.
