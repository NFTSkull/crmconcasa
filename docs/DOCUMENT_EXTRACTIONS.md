# Document Extractions (P2 shadow)

Infraestructura **shadow** para extracciones documentales asíncronas.
**P2 no ejecuta OCR, no llama providers, no autollenna campos, no modifica uploads.**

## Arquitectura

```
DOCUMENTO (expediente_documentos)
    ↓  enqueue_document_extraction (service_role; flag OFF por defecto)
JOB (document_extraction_jobs)
    ↓  worker futuro (P3)
EXTRACCIÓN (document_extractions)
    ↓
RESULTADO NORMALIZADO (payload_normalized) + RAW PII (payload_raw)
```

## Tablas

### `document_extractions`

Resultado versionado por documento+provider.

| Campo | Rol |
|---|---|
| documento_id | FK a `expediente_documentos.id` (cada versión de archivo = UUID nuevo) |
| document_version | Denormalizado de `expediente_documentos.version` |
| document_type | Allowlist de 4 tipos |
| provider / provider_version | Identidad del extractor |
| status | pending / processing / done / failed / stale / skipped |
| payload_normalized | Campos con provenance (sin PII en logs) |
| payload_raw | PII — **sin SELECT authenticated** |
| stale_at / stale_reason | Versión sustituida |

### `document_extraction_jobs`

Cola/outbox separada de P189 (`infonavit_pdf_outbox`). Claim/lease → **P3**.

Estados: pending / processing / done / failed / dead / cancelled / stale.

## Allowlist (explícita)

- `cliente_ine_frente`
- `cliente_ine_reverso`
- `cliente_comprobante_domicilio`
- `cliente_estado_cuenta`

No se generaliza al resto del catálogo documental.

## Idempotencia

En el modelo actual, **reemplazar un documento soft-deletea la fila previa e inserta un `id` nuevo** con `version = MAX+1`.

Por tanto la UNIQUE correcta es:

`(documento_id, provider, provider_version)`

`document_version` se guarda denormalizado para auditoría; no forma parte de la UNIQUE porque ya está implicado por `documento_id`.

## Stale / versionado

Caso: INE v1 encolada → asesor sube v2 → job v1 termina después.

Regla: **v1 nunca es candidata vigente si existe v2**.

`enqueue_document_extraction` llama `document_extraction_mark_stale_superseded` para marcar extracciones/jobs previos del mismo `(expediente_id, document_type)` como `stale` antes de crear la de la versión actual.

`document_extraction_documento_is_current(documento_id)` → `deleted_at IS NULL`.

## PII

- `payload_raw` puede contener nombres, CURP, dirección, CLABE.
- `REVOKE ALL` a `anon`/`authenticated` + `FORCE RLS`.
- Acceso operativo: `service_role` / owner.
- `action_log` solo ids/tipos/status/provider/error_code — **nunca** OCR/PII.

## Feature flag (fail-closed)

Vault secrets (ops; **no** `vault.create_secret` en la migration):

| Secret | Efecto |
|---|---|
| `document_extraction_enqueue_enabled` | debe ser `true` (trim/ci) |
| `document_extraction_activation_at` | opcional ISO; si presente y futuro → OFF |

Default / missing / error de lectura → **OFF**.

No reutiliza `p189_infonavit_enqueue_enabled`.

## Enqueue

`enqueue_document_extraction(documento_id, provider, provider_version)`

- Resuelve org / expediente / tipo / version **server-side**.
- Valida allowlist y `deleted_at IS NULL`.
- Idempotente.
- Retorno sin PII.
- `GRANT` solo `service_role`.
- **No** llamado desde `register_expediente_documento` en P2.

## Rollout

| Fase | Alcance |
|---|---|
| **P2** (este PR) | Schema + RLS + enqueue + flag OFF + docs/tests. Sin OCR. |
| **P3** | Worker claim/lease + provider + flag gradual + cableado upload gated. |
| **P4** | Autofill controlado a `cliente_datos` con comparación/provenance. |

## Fuentes de verdad (futuro; no implementado)

| Dominio | Fuente prioritaria |
|---|---|
| Identidad (nombres, CURP, vigencia explícita) | INE frente/reverso |
| Vivienda / domicilio | Comprobante (CFE) |
| CLABE | Estado de cuenta (+ `isValidClabeMexico` futuro) |

### T7 — Número de identificación

**BLOQUEADO.** Puede existir campo candidato con provenance; **sin** regla de autofill ni decisión CIC/OCR/claveElector en P2.

## Contrato `payload_normalized` (ejemplo sintético)

```json
{
  "fields": {
    "titular.nombres": {
      "value": "NOMBRE_SINTETICO",
      "normalizedValue": "NOMBRE_SINTETICO",
      "confidence": 0.99,
      "sourceDocumentType": "cliente_ine_frente",
      "sourceDocumentId": "00000000-0000-4000-8000-000000000001",
      "documentVersion": 1,
      "page": 1,
      "bbox": [0.1, 0.2, 0.3, 0.4],
      "extractionRule": "shadow_fixture_p2"
    }
  }
}
```

## Qué P2 no hace

- OCR / Document AI / modelos
- Descarga de Storage
- Autofill / escritura a `cliente_datos` o `expedientes`
- Modificar generación Infonavit / P189 snapshot
- Conectar upload → enqueue
- Backfill / Cloud apply
- Agenda / citas / cupos / Sheets
