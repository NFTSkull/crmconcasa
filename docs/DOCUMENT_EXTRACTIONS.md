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

---

## Requisito UX obligatorio (P4/P5) — NO implementado aún

Contrato de producto para captura/revisión Infonavit en **Mesa**.  
**P2/P3 no incluyen esta UI.** Implementar en fases futuras (P4/P5), no en el worker shadow.

### Objetivo

Al capturar/revisar campos Infonavit en Mesa debe existir vista del **documento fuente** junto al formulario, sin abrir otra pestaña.

### Layout

| Viewport | Comportamiento |
|---|---|
| **Desktop** | Split view: izquierda formulario/campos; derecha preview privado **sticky** del documento correspondiente |
| **Mobile** | Modal/drawer reutilizando infraestructura actual de preview privado |

Reutilizar siempre que sea posible:

- `MesaArchivoPreviewDialog`
- blobs privados existentes

**Prohibido:** URLs públicas permanentes. Solo blob URL temporal + `revokeObjectURL` correcto.

### Mapeo campo → documento visible

| Contexto / campos | Documento a mostrar | Notas |
|---|---|---|
| Identidad: nombres, apellidos, CURP, tipo ID, número ID, vigencia | **INE** | Selector claro **Frente \| Reverso** según docs disponibles |
| RFC | **Estado de cuenta** | Solo referencia visual humana. **NO** fuente automática de RFC. RFC fuera de autofill por ahora |
| CLABE del derechohabiente | **Estado de cuenta** | Sí es documento fuente de la CLABE |
| Dirección / vivienda | **Únicamente comprobante de domicilio** | No usar INE como principal. Si CFE: extracción futura prioriza bloque domicilio superior izquierdo |

**T7 — Número identificación:** sigue **BLOQUEADO** para autofill. No decidir todavía CIC / OCR / clave elector.

### Navegación (intención)

- click/foco en identidad → preview INE  
- click/foco en RFC → preview Estado de cuenta  
- click/foco en CLABE → preview Estado de cuenta  
- click/foco en vivienda/dirección → preview Comprobante de domicilio  

### Reglas del preview

- documento privado; blob URL temporal; `revokeObjectURL` al cerrar/cambiar
- sin descargas automáticas; sin afectar Storage; sin modificar documento; sin duplicar uploads
- si falta el documento → estado **"Documento no disponible"** sin bloquear captura manual
- si hubo reemplazo → mostrar **solo** la versión activa (`deleted_at IS NULL` / current)

### Fuera de alcance de este requisito documental

- Implementar OCR/provider real
- Autofill a `cliente_datos`
- Conectar upload → enqueue
- Cloud apply / Production

## P4A — Preview fuente en captura Mesa (sin OCR)

UI-only: al enfocar campos en `MesaInfonavitGenerarDocumentosForm`, Mesa ve el documento **current** (`deleted_at IS NULL` vía `listByExpediente` + `rowMasRecientePorTipoDocumento`):

| Contexto | Documento |
|----------|-----------|
| Identidad (nombre, CURP, ID…) | `cliente_ine_frente` / `cliente_ine_reverso` |
| RFC / CLABE derechohabiente | `cliente_estado_cuenta` |
| Vivienda | `cliente_comprobante_domicilio` |

Blob privado (`getArchivoBlob` → `URL.createObjectURL` / `revokeObjectURL`). Reutiliza `MesaArchivoPreviewDialog`. **No** enqueue, provider, autofill ni mutación de `cliente_datos`.

## P4B — CLABE shadow desde texto embebido del Estado de cuenta

Detección **client-side** cuando Mesa enfoca CLABE y existe `cliente_estado_cuenta` PDF:

Estado de cuenta (blob privado P4A)
→ `extractPdfEmbeddedText` (pdfjs, sin OCR)
→ candidatos 18 dígitos (espacios/guiones)
→ `normalizeClabeMexico` + `isValidClabeMexico` (P1)
→ score por proximidad a etiquetas (`CLABE`, `CLABE INTERBANCARIA`, …)
→ UI sugerencia (`detected` / `ambiguous` / `not_found` / `no_text_layer` / `unsupported`)

**Umbral DETECTED:** score alto (etiqueta a ≤40 chars del candidato). Checksum solo **no** basta.

| Garantía | Estado |
|---|---|
| Sin OCR | sí |
| Sin provider externo | sí |
| Sin persistencia DB / localStorage / logs del raw text | sí |
| Sin autofill / sin mutar draft | sí |
| PDF escaneado / imagen | revisión manual |
| P2/P3 worker | **no** conectado |

