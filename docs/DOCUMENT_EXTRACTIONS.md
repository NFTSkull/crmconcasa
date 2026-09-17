# Document Extractions

Infraestructura **shadow** para extracciones documentales asíncronas.

## Rollout

| Fase | Estado | Alcance |
|---|---|---|
| **P2** | schema/queue | tablas, enqueue, flag enqueue OFF, stale por reemplazo |
| **P3** | worker/lease shadow | claim/lease, complete/fail/stale, Edge worker, provider `shadow` no-op |
| **P4** | futuro | provider real (OCR/Document AI) — **no implementado** |
| **P5** | futuro | UI/sugerencias / autofill controlado — **no implementado** |

**P3 no ejecuta OCR, no llama proveedores externos, no autollenna campos, no conecta upload.**

## Arquitectura

```
DOCUMENTO (expediente_documentos)
    ↓  enqueue_document_extraction (service_role; flag OFF)
JOB (document_extraction_jobs)
    ↓  document_extraction_claim_jobs (SKIP LOCKED + lease 5m)
WORKER Edge (document-extraction-worker)
    ↓  vigencia CURRENT ×2 + meta storage
ADAPTER Shadow (raw=null, fields={})
    ↓  document_extraction_complete_job (atómico)
document_extractions status=done
```

## RPCs P3 (service_role only)

| RPC | Rol |
|---|---|
| `document_extraction_claim_jobs(limit)` | claim ≤5; pending/failed reintentable/lease vencido |
| `document_extraction_load_job_meta(job_id)` | path/mime/bucket; **sin** payload_raw |
| `document_extraction_complete_job(...)` | done atómico; stale no revive |
| `document_extraction_mark_failed(...)` | backoff o `dead` si max_attempts |
| `document_extraction_mark_stale(...)` | job+extraction → stale |

## Feature flags (Vault, fail-closed DEFAULT OFF)

| Secret | Efecto |
|---|---|
| `document_extraction_enqueue_enabled` | permite enqueue |
| `document_extraction_worker_enabled` | permite claim/worker |
| `*_activation_at` | opcional |

Worker Edge secret (env, **no** reutilizar Sheets/P189):

`DOCUMENT_EXTRACTION_WORKER_SECRET` + header `x-concasa-doc-extraction-secret`

## Lease / retry / dead

- Lease: **5 minutos**
- Backoff: 1m / 5m / 15m / 30m según `attempts`
- `attempts >= max_attempts` → `dead`
- Claim usa `FOR UPDATE SKIP LOCKED`

## Race v1 → v2

1. Antes de procesar: `document_extraction_documento_is_current`
2. En `complete_job`: re-check + lock; si no current → `stale`
3. Complete sobre job ya `stale` → **no revive** (`revived:false`)

## Provider P3

Solo `shadow` (`ShadowDocumentExtractionProvider`):

```json
{ "provider": "shadow", "providerVersion": "p3", "raw": null, "normalized": { "fields": {} } }
```

Cualquier otro provider → `unsupported_provider` → dead (no retry).

## PII

- `payload_raw` solo service_role/worker
- Logs: job_id, extraction_id, documento_id, document_type, provider, status, error_code, duration_ms
- Sin nombres/CURP/CLABE/OCR/bytes/path completo en logs

## Allowlist

- `cliente_ine_frente`
- `cliente_ine_reverso`
- `cliente_comprobante_domicilio`
- `cliente_estado_cuenta`

## Qué NO hace P3

- OCR / OpenAI / Document AI / Azure
- Autofill / escritura `cliente_datos` o `expedientes`
- Hook `register_expediente_documento` → enqueue
- Cron Production / Cloud apply
- Agenda / citas / cupos / Sheets
- Cambios P189 snapshot/PDF
