# ConCasa CRM — Contratos de API (producción)

**Fase:** P1 — contratos conceptuales (sin implementación HTTP aún)
**Validación:** Zod en server/RPC (P2+)
**Auditoría:** cada mutación escribe `action_log`

Convenciones:
- `expediente_id`: UUID
- `organization_id`: UUID (single org ConCasa en piloto)
- Errores: `{ code, message, details? }`
- Auth: Bearer JWT Supabase; rol desde `profiles`, no del body
- Login UI: correo normal o alias exacto controlado `asesor.mejoravit` → `asesor.mejoravit@usuarios.concasa.mx` (`normalizeLoginIdentifier`); sin sistema general de usernames

---

## 0bis. Ingresos Super Admin (P134 / P135 / P137 / P138)

**RPCs:** `super_admin_get_ingresos_resumen` · `super_admin_list_ingresos_page` · `super_admin_export_ingresos`
**Rol:** solo `super_admin` (org propia).
**Fórmula:** `round(monto_base × porcentaje_cobro / 100, 2)` — sin cargo fijo ni tope $169,000.
**Monto base:** `cliente_datos.monto_mejoravit_actualizado` si >0; si no, `parse_monto_mejoravit_json(datos)`.
**Elegibilidad proyectado (P137):** `submitted_to_mesa` + `fecha_envio_mesa` NOT NULL; ciclo no cancelado; sin rechazo activo; monto+% válidos. **No** exige evidencia biométrica como gate (helper `ingresos_bio_aprobacion_at` se conserva informativo).
**Alcance de etapa:** `p_stage_scope` ∈ `all_submitted` | `from_step` | `exact_step` + `p_visible_step` (NULL solo en `all_submitted`; 1–11 en los otros). Mapeo canónico paso visible → internas (Paso 3 → 3+4).
**Real:** snapshot `expediente_ingresos_reconocidos` en la misma TX que `11→12` (trigger); incompletos bloquean con mensaje canónico.
**Fechas filtro (Monterrey):** proyectado/incompletos por `fecha_envio_mesa`; real por `reconocido_at`.
**P135:** helper bio ampliado; no altera movimientos Mesa. **P137:** cambia el universo y filtros de etapa del read-model Ingresos.
**P138:** `super_admin_export_ingresos` — mismos filtros que list; detalle completo hasta 10 000 filas; error controlado si se excede; Excel en cliente (ExcelJS) con hojas/columnas personalizables.

---

## 1. Crear expediente

**Operación:** `POST /expedientes` · RPC `create_expediente`

### Request (conceptual)

```json
{
  "programa": "mejoravit | subcuenta | compro_tu_casa",
  "nss": "12345678901",
  "cliente_nombre": "string",
  "telefono_cliente": "10 dígitos",
  "direccion_opcional": "string?",
  "expediente_anterior_id": "uuid?"
}
```

### Response

```json
{
  "id": "uuid",
  "organization_id": "uuid",
  "asesor_id": "uuid",
  "origen_mesa": "interno | externo",
  "etapa_actual": 1,
  "subestado": "pendiente",
  "ciclo_estado": "activo",
  "created_at": "ISO"
}
```

### Reglas

- Solo rol `asesor` (o `super_admin`).
- `origen_mesa` = `profiles.tipo_asesor_origen` (asesor no elige).
- Rechazar duplicado **activo** mismo `nss + programa + organization_id`.
- Si `expediente_anterior_id`: validar que ciclo previo esté `cerrado` o documentar excepción admin.

---

## 2. Aprobar monto (editor)

**Operación:** `PATCH /expedientes/{id}/editor-decision` · RPC `upsert_editor_decision`

### Request

```json
{
  "decision": "pendiente | aprobado | no_cumple",
  "monto_aprobado": "number | null",
  "notas_revision": "string"
}
```

### Reglas

- Rol `editor` | `super_admin`.
- Asesor integra solo si `decision = aprobado` AND `monto_aprobado > 0` (helper mock `asesorPuedeIntegrarTrasMontoRevisor`; nombre legacy, aplica al rol **editor**).
- Log: `action_log` `editor_decision.update`.

---

## 3. Guardar datos cliente

**Operación:** `PUT /expedientes/{id}/cliente-datos` · RPC `save_cliente_datos`

### Request

```json
{
  "datos": {
    "nombreCliente": "string",
    "nss": "string",
    "curp": "string",
    "rfc": "string",
    "celular": "string",
    "correo": "string",
    "empresa": "string",
    "registroPatronal": "string",
    "telefonoEmpresa": "string",
    "referencias": [{ "nombre": "string", "celular": "string" }],
    "beneficiario": { "nombre": "string", "parentesco": "string" },
    "direccionEmpresa": { "calle": "string", "colonia": "string", "municipio": "string", "cp": "string" }
  }
}
```

### Reglas

- Rol `asesor` (expediente propio).
- **RFC obligatorio** antes de envío integración (`getClienteDatosCamposFaltantes`).
- Estado inicial `pendiente` → `completo` al guardar campos mínimos.
- **P133 — formatos de campo:** nombres (`nombreCliente`, refs, beneficiario/parentesco) solo letras Unicode + espacios/guion/apóstrofe; NSS 11 dígitos; teléfonos vía `normalize_telefono_mexico` (10); CP 5 dígitos; plazo solo dígitos si viene; RFC contrato vigente si no vacío. Validación FE (`clienteDatosFieldFormats` / `validateClienteDatos`) + assert SQL en `save_cliente_datos` / `save_cliente_datos_correccion` sobre payload entrante (mig. 119). Sin CHECK en tablas ni backfill de históricos.
- **P098 — teléfonos repetidos:** el mismo número (normalizado a 10 dígitos) puede existir en varios expedientes/precalificaciones. Identidad canónica = `expediente_id` (PK de `cliente_datos`); el teléfono no es UNIQUE, ni upsert key, ni identificador del cliente. Sigue prohibido repetir teléfono **dentro del mismo payload** (cliente ↔ referencias; referencias entre sí). NSS / `nss_bloqueado_en_mesa` intactos.
- **P090 — base de cobro Mejoravit:** si existe `cliente_datos.monto_mejoravit_actualizado`, tiene prioridad sobre `datos.montoMejoravit` y sobre el fallback editor (−11% / tope $169,000). El guardado del asesor **no** acepta ni borra el override Mesa (`monto_mejoravit_actualizado*`). Fórmula de cobro automática: `ROUND(base × % / 100 + 3000, 2)`.

---

## 3bis. Monto actualizado Mejoravit (Mesa) — P090 B0–B1

**Sin UI en este bloque.** Backend local únicamente.

### Escritura

**RPC:** `mesa_actualizar_monto_mejoravit(p_expediente_id uuid, p_monto_nuevo numeric, p_motivo text) → jsonb`

- Roles: `mesa_admin` | `mesa_interno` | `mesa_externo` | `super_admin` (+ aliases mesa vigentes); org + `can_see_expediente`; expediente activo, no eliminado, enviado a Mesa.
- Redondea `p_monto_nuevo` a 2 decimales; debe ser > 0 y distinto del monto operativo vigente.
- Motivo: `btrim`, no vacío, ≤ 500.
- Exige `porcentaje_cobro`; **no** exige `metodo_pago`.
- Base anterior: `COALESCE(monto_mejoravit_actualizado, JSON montoMejoravit válido, LEAST(ROUND(monto_aprobado×0.89,2),169000))`.
- Cobro nuevo: `ROUND(monto_nuevo × porcentaje_cobro / 100 + 3000, 2)`.
- Escribe historial `expediente_monto_mejoravit_actualizaciones` (append-only) + columnas operativas en `cliente_datos` + `monto_calculado`. **No** toca `datos`, `%`, método, snapshots, etapa/subestado.
- Auditoría: `action_log` acción `mesa.monto_mejoravit.updated`.
- Concurrencia: `FOR UPDATE` expediente → `cliente_datos` en la misma transacción.
- Retorno estable: `expediente_id`, `monto_original_operativo`, `monto_anterior`, `monto_nuevo`, `diferencia`, `porcentaje_cobro`, `monto_cobro_anterior`, `monto_cobro_nuevo`, `motivo`, `updated_by`, `updated_at`.

### Lectura

**RPC:** `get_expediente_monto_mejoravit_context(p_expediente_id uuid) → jsonb`

- Sesión + org + `can_see_expediente` (Mesa visible, asesor dueño, super_admin según patrón vigente).
- Campos: `expediente_id`, `monto_aprobado_editor`, `monto_snapshot_primera_aprobacion`, `monto_mejoravit_datos_generales`, `monto_mejoravit_actualizado`, `monto_operativo_vigente`, `monto_original_operativo`, `porcentaje_cobro`, `cargo_fijo` (= **3000**), `monto_calculado`, `ultima_actualizacion`, `historial` (DESC por `created_at`), `can_update`.
- `can_update=true` solo Mesa operable (activo, enviado, visible); asesor siempre `false`.
- Historial: `id`, montos, diferencia, `%`, cobros, motivo, `created_at`, `created_by`, `created_by_name` (si disponible sin PII sensible).

### P087 / Pagaré

- Agregados Admin **no** usan `monto_mejoravit_actualizado`.
- Pagaré (`cliente_pagare`): P090 B3 backend + B4 UI Mesa/asesor RO vía `register_mesa_documento`; no obligatorio / no gate.

### UI B2 (frontend)

- Mesa: sección independiente (no dentro de Datos Generales) + diálogo «Actualizar monto Mejoravit» con vista previa de cobro.
- Asesor: RO cuando hay override Mesa; sin botón ni formulario.
- Wrappers TS: `getExpedienteMontoMejoravitContext` / `actualizarMontoMejoravitMesa` — solo RPCs P090; sin `save_cliente_datos` ni updates directos.

### 3ter. Pagaré (`cliente_pagare`) — P090 B3 backend + B4 UI

**RPC:** `register_mesa_documento` (misma firma) con tipo `cliente_pagare`. Sin RPC nueva.

| Regla | Valor |
|-------|--------|
| Roles escritura | `mesa_admin`, `mesa_interno`, `mesa_externo`, `super_admin` + `can_see_expediente` |
| Etapa mínima | `etapa_actual >= 7` |
| Error etapa | `El Pagaré solo puede cargarse después de concluir la inscripción.` |
| MIME | `application/pdf`, `image/jpeg`, `image/png` |
| Tamaño | ≤ `expediente_documento_max_size_bytes()` = 15×1024×1024 |
| Versionado | soft-delete del vigente + versión N+1; unique activo `(expediente_id, tipo)` |
| Path | `{org}/{expediente}/cliente_pagare/{uuid}.{ext}` |
| Asesor | SELECT vía `can_see_expediente` (solo vigentes `deleted_at IS NULL`); sin register |
| Gate avance | **No** — no bloquea 6→7 ni ninguna transición |
| Reingreso | sin herencia automática |
| Auditoría | `expediente.documento.mesa_register` + payload (`tipo`, `version`, `reemplazo`, …) |
| Eliminación (P136) | RPC `mesa_eliminar_documento_expediente` — soft-delete activo; action `expediente.documento.mesa_eliminar`; Storage best-effort tras DB |

**UI B4 + P136:**

- Mesa: `MesaPagareSection` — upload/reemplazo/eliminar → Storage + RPC; preview/descarga vía `getArchivoBlob`.
- Asesor: `AsesorPagareSection` RO desde etapa 7 — solo listado activo + Ver/Descargar.
- Contrato TS: `CLIENTE_PAGARE_DOCUMENT_CONTRACT`. Allowlist UI complementarios **sin** `cliente_pagare` (evita duplicado); registro SQL en `INTEGRATION_DOC_TIPOS_MESA_REGISTER`.
- No modifica etapa, monto, cobro ni Datos Generales. Sin notificaciones.

### 3quater. Notificación documento (`cliente_notificacion`) — P092 + P132-acuse

**Separación:** `cliente_notificacion` = documento de expediente. `notificacion` = `agenda_bookings.kind` (agenda/P070) — **no** reutilizar como tipo documental.

**RPC:** `register_mesa_documento` (Mesa) y `register_expediente_documento` (asesor). Migración `089` + `118` + `120`.

| Regla | Valor |
|-------|--------|
| Roles escritura | Mesa (`register_mesa_documento`) **o** asesor dueño (`register_expediente_documento`) |
| Etapa mínima | `etapa_actual >= 7` |
| Error etapa | `El documento Notificación solo puede cargarse después de concluir la inscripción.` |
| MIME | `application/pdf`, `image/jpeg`, `image/png` |
| Tamaño | ≤ 15 728 640 bytes |
| Path | `{org}/{expediente}/cliente_notificacion/{uuid}.{ext}` |
| Gate avance | **No (P132-acuse):** carga/reemplazo sin `7→9`; `expediente_apply_notificacion_7_9` es stub no-op |
| Obligatorio | **No** |
| Origen contrato TS | `Asesor\|Mesa`; `esGateAvance: false` |

**UI:**

- Mesa: `MesaNotificacionDocumentoSection` — upload sin avance.
- Asesor: `AsesorNotificacionDocumentoSection` upload/reemplazo desde etapa 7.
- Contrato: `CLIENTE_NOTIFICACION_DOCUMENT_CONTRACT`. Fuera de checklist integración UI; en allowlist upload asesor.

**P132-acuse:** cierre Biometría Mesa `5→8`; Acuse principal en etapa 8 → `8→9` + `firma_agendable_desde` (si NULL = hoy Monterrey; sin +5 hábiles, mig. 139); gate firmas SQL conserva assert (NULL/hoy permiten); picker/minDate desde hoy sujeto a cupo.

Otros tipos Mesa (acta/SAT/semanas) conservan MIME PDF-only.

### 3quinquies. Notificación (`cliente_notificacion_apodaca`) — P104

**Separación:** distinto de `cliente_notificacion` (documento Mesa P092) y de `agenda_bookings.kind='notificacion'` (P070). Nunca reutilizar esos tipos.

**RPC:** `register_expediente_documento` (asesor propietario). Allowlist `integration_doc_tipos_asesor_opcionales()`. Migración local `095_cliente_notificacion_apodaca_opcional.sql` (sin Cloud en este bloque).

| Regla | Valor |
|-------|--------|
| Roles escritura | asesor dueño (+ roles ya autorizados en RPC) |
| Etapa mínima | ninguna (cualquier etapa del expediente) |
| MIME | PDF (`expediente_documento_mime_permitido` heredado) |
| Tamaño | ≤ 15 728 640 bytes |
| Mesa | preview/descarga en documentos del asesor; sin upload Mesa |
| Gate avance / envío | **No** |
| Reingreso | sí, alineado a opcionales asesor (`reingreso_documentos_reutilizables`) |
| Obligatorio | **No** |

**UI:** label UI `Notificación` (badge Opcional; tipo interno `cliente_notificacion_apodaca`) en checklist Asesor (`AsesorIntegracionDocsUpload` + DocumentDropzone) **solo** si sede canónica Apodaca (`location_id` de biométricos) y etapa 8; histórico RO si ya hay archivo. También `MesaNotificacionApodacaSection` / `MesaDocumentosAsesorSection`.

### 3sexies. Evidencia opcional del asesor (`asesor_evidencia`)

**Separación:** tipo `asesor_evidencia` — no confundir con stubs `asesor_ine_*` del catálogo ni con docs Mesa (Pagaré/Notificación/Solicitud).

**RPC:** `register_expediente_documento` (asesor propietario). Allowlist `integration_doc_tipos_asesor_opcionales()`. Migración `128_asesor_evidencia_opcional.sql` (sin Cloud en este bloque).

| Regla | Valor |
|-------|--------|
| Roles escritura | asesor dueño del expediente |
| Lectura | `can_see_expediente` (asesor dueño, Mesa visible, super_admin) |
| Etapa mínima | ninguna |
| MIME | allowlist común (PDF/imágenes/Office/ZIP/RAR/texto/json/xml) + `application/octet-stream` fallback; resto de tipos sin cambio |
| Tamaño | ≤ `expediente_documento_max_size_bytes()` = 15×1024×1024 |
| Path | `{org}/{expediente}/asesor_evidencia/{uuid}.{ext}` |
| Versionado | soft-delete del vigente + N+1 (mismo patrón register) |
| Gate / obligatorio / envío / avance / cobro / P090 | **No** |
| Reingreso | sin herencia automática (no se agrega a `reingreso_documentos_reutilizables`) |
| Preview UI | solo PDF/JPG/JPEG/PNG/WEBP; resto solo descarga |
| Mesa | consulta/descarga; sin upload/reemplazo/eliminar |

**UI:** `AsesorEvidenciaSection` + `MesaEvidenciaAsesorSection`. Fuera de checklist de integración.

---

## 4. Subir / reemplazar documento

**Operación:** `POST /expedientes/{id}/documentos/{tipo}` · Storage upload + RPC metadata

### Request

- Multipart `file` (PDF/imagen)
- `tipo_documento`: catálogo (`ine`, `cliente_ine_frente`, `retencion_*`, …)

### Response

```json
{
  "id": "uuid",
  "expediente_id": "uuid",
  "tipo_documento": "string",
  "storage_path": "string",
  "estatus_revision": "subido | resubido",
  "version": 1,
  "created_at": "ISO"
}
```

### Reglas

- Asesor: upload en expediente propio.
- Reemplazo incrementa `version`; anterior soft-delete o historial en `documento_revisiones`.
- Retención etapa 8: asesor solo reemplaza docs `rechazado` (`retencionDocPuedeReemplazarAsesor`).

---

## 5. Enviar integración a Mesa

**Operación:** `POST /expedientes/{id}/enviar-mesa` · RPC `enviar_a_mesa`

### Request

```json
{
  "docs_snapshot": "optional checklist resumen"
}
```

### Response

```json
{
  "etapa_actual": 1,
  "subestado": "en_validacion_mesa",
  "submitted_to_mesa": true,
  "fecha_envio_mesa": "ISO"
}
```

### Reglas (B0D4)

- Gate: editor aprobado + monto + docs integración + RFC.
- **NO** incrementar a etapa 2 (`etapaAlEnviarAMesaDesdeAsesor` → 1).
- `action_log`: `expediente.enviar_a_mesa`.

---

## 5bis. Reingreso manual a Mesa (mismo expediente)

**Operación:** UI Asesor «Reingreso» · RPC `asesor_enviar_reingreso_a_mesa(p_expediente_id)`
**Migración:** 142

### Request

```json
{ "p_expediente_id": "uuid" }
```

### Response

```json
{
  "ok": true,
  "changed": true,
  "idempotent": false,
  "expediente_id": "uuid",
  "precalificacion_id": "uuid",
  "reingreso_manual_count": 1,
  "reingreso_manual_at": "ISO",
  "reingreso_manual_by": "uuid",
  "etapa_actual": 1,
  "subestado": "en_validacion_mesa",
  "submitted_to_mesa": true,
  "fecha_envio_mesa": "ISO"
}
```

### Reglas

- Solo `asesor` dueño; ciclo `activo`; debe existir envío previo (`submitted_to_mesa` + `fecha_envio_mesa`).
- Gates de negocio = `enviar_a_mesa` (monto, cliente_datos cobro, docs integración, NSS bloqueado excluyendo self); **no** bloquea por «ya enviado».
- Transición = misma que `enviar_a_mesa`: `etapa_actual=1`, `subestado=en_validacion_mesa`, `fecha_envio_mesa=NOW()`.
- Incrementa `reingreso_manual_count`; set `reingreso_manual_at/by`.
- No INSERT expediente/precalificación; no toca docs/citas/`reingreso_rechazo_id` (P072).
- Idempotencia: mismo actor en ≤5s → `changed:false` sin nuevo incremento.
- `action_log.action = expediente_reingreso_mesa`.

---

## 6. Validar / rechazar documento (Mesa)

**Operación:** `PATCH /documentos/{id}/revision` · RPC `update_documento_revision`

### Request

```json
{
  "estatus_revision": "validado | rechazado | subido | resubido",
  "comentario_mesa": "string | null"
}
```

### Reglas

- Rol mesa_* | super_admin; expediente visible por RLS.
- `rechazado` → `comentario_mesa` **obligatorio**.
- Puede rechazar doc **ya validado** (corrección error dedo).
- Insert `documento_revisiones` (historial).
- Retención rechazada → `retencion_envios.estado = correccion_requerida`.

---

## 7. Avanzar etapa (Mesa)

**Operación:** `POST /expedientes/{id}/avanzar-etapa` · RPC `avanzar_etapa_operativa`

### Request

```json
{
  "direccion": "siguiente | anterior",
  "motivo_rechazo": "string?",
  "comentario_rechazo": "string?"
}
```

### Reglas por transición

| Transición | Bloqueos |
|------------|----------|
| 1→2 | Docs etapa 1 validados; datos cliente `validado` |
| 4→5 | Cita biométrica (`fecha_cita` + booking `biometricos` activo `booked`) |
| 5→6 | Etapa 5 + `en_proceso`; `fecha_cita` + booking biométrico activo; **`fecha_cita <= now()`** (cita ya ocurrió; no registra resultado formal en P3N.1) |
| 6→7 | Etapa 6 + `en_proceso`; enviado a Mesa; ciclo `activo` (sin `fecha_cita` ni booking) |
| 7→8 | Etapa 7 + `en_proceso`; enviado a Mesa; ciclo `activo` (sin retención ni firmas) |
| 8→9 | Retención: opción + envío asesor + docs opción `validado` |
| 9→10 | Etapa 9 + `en_proceso`; `fecha_cita` + booking `firmas` activo (`booked`); roles `mesa_admin`/`mesa_interno`/`mesa_externo`/`super_admin` |
| 10→11 | Etapa 10 + `en_proceso`; mismos gates de firma (`fecha_cita` + booking `firmas` `booked`); roles Mesa/`super_admin`. UI: «Pasar a Firmado». |
| 11→12 | Etapa 11 + `en_proceso`; enviado a Mesa; ciclo `activo`; roles Mesa/`super_admin`. No muta bookings, documentos, montos ni `fecha_cita`. UI: «Pasar a Pago a ConCasa» (posición operativa final; no registra pago financiero). |
| Rechazo | Nota obligatoria; puede regresar etapa |

- Validación server-side espejo de `getBloqueosAvanceMesa` / helpers retención.
- **UI P089 (acciones masivas):** «Pasar a siguiente etapa» en `/mesa-control/citas` reutiliza **esta misma RPC** una vez por `expediente_id` elegible (dedupe por expediente; concurrencia limitada en cliente). No existe RPC batch; Drive no es requisito de avance.

---

## 8bis. Google Sheets ↔ Agenda (sync bidireccional)

**Migración:** `129_google_sheets_agenda_sync.sql`
**Spreadsheet:** `1JOERzJc2yLncDbzTFG2lQLQXdlWwmGehlxP7JNOoupA` («CITAS 2026»)
**TZ integración:** `America/Mexico_City` (CRM interno de agenda sigue usando `America/Monterrey` en `agenda_config`).

### Fuente de verdad
Supabase `agenda_bookings`. Sheets no inserta filas directas; toda reserva Sheet→CRM pasa por Edge `agenda-sheet-webhook` + RPC `agenda_sheet_book_by_nss` (`service_role` only).

### Identidad de cupo / fila
- CRM: `(organization_id, kind, booking_date, booking_time, location_id)` + capacity (sin `slot_id`).
- Sheet: misma clave + `slot_ordinal` (fila N de esa hora) en `agenda_sheet_slot_links`.
- **Cupo real (mig. 131):** una fila física del Sheet = una fila en `agenda_sheet_slot_inventory`. Obligatorio desde `2026-07-30` inclusive. Inventario stale si `MAX(observed_at)` por org+fecha es NULL o menor que `NOW() - 6 hours`. Asserts biométricos/firmas + claim `FOR UPDATE SKIP LOCKED` bloquean con `SIN_CUPO_REAL_EN_SHEET` si no hay fila `available` fresca. **Cron (mig. 132):** `agenda-sheet-reconcile-every-15m` refresca inventario vía Edge `agenda-sheet-reconcile` (Vault `agenda_sheet_project_url` + `agenda_sheet_worker_secret`).
- **Alias horario (mig. 137):** `agenda_sheet_time_alias_defaults` (globales por `location_id`/`kind`) + `agenda_sheet_time_aliases` (override por org). Seed defaults: biometricos monterrey/apodaca `08:30`⇄`08:00`. Resolve: override org (activo→traduce; inactive→identidad) luego default. Inventario: `slot_time` = lógico; `sheet_slot_time` = A física. Identidad física canónica en `slot_key`: `kind|date|logical|location|sheet=HH:mm|sheetId=N|row=N`. Worker/webhook escriben solo B:D + O:U (`values.batchUpdate`); A read-only. Firmas/otros horarios sin alias. `anon`/`authenticated` no mutan aliases/defaults.

### RPCs internas
- `agenda_sheet_book_by_nss(...)` — reserva atómica + mapping + `action_log` `agenda.sheet.book`
- `agenda_sheet_claim_outbox` / `agenda_sheet_mark_outbox` — worker CRM→Sheets (claim recupera `processing` >10 min → `failed`/`dead`)
- `agenda_sheet_requeue_dead_sync(p_booking_id)` — reencola outbox `dead` de `booking_created` para bookings activos futuros; con `p_booking_id` también puede reencolar `booking_cancelled` si hay fila Sheet conocida (`service_role`); no muta bookings ni Sheets; sin `p_booking_id` no toca cancelaciones (anti-backfill)
- `agenda_sheet_enqueue_cancel_cleanup(p_booking_id)` — encola `booking_cancelled_cleanup` idempotente para booking **cancelled** con evidencia CRM (`service_role`); no UPDATE de outbox histórico done; no muta bookings
- `agenda_sheet_mark_cancelled_cleared(p_booking_id)` — soft-delete `slot_links` + libera inventario tras limpieza Sheet
- `agenda_sheet_upsert_link_from_crm` — mapping tras escritura Sheet
- `agenda_sheet_inventory_availability(p_kind, p_date, p_location_id)` — read-model cupo real (`authenticated`); si enforced y not fresh → `{ ok:true, fresh:false, slots:[] }`; buckets por `slot_time` lógico (+ `sheet_slot_time` informativo)
- `agenda_sheet_inventory_upsert_batch(p_rows)` / `mark_linked` / `mark_conflict` — `service_role` only (anti-steal: no degradar claimed/linked con `booking_id`; **`sheet_title` exacto sin `btrim`** — pestañas tipo `03 AGOSTO `; persiste `sheet_slot_time`)
- `agenda_sheet_list_time_aliases` / `agenda_sheet_resolve_logical_time` / `agenda_sheet_resolve_sheet_time` — `service_role` (mig. 137)

### Outbox
Trigger en `agenda_bookings` → `agenda_sheet_sync_outbox` (`booking_created|updated|cancelled|rescheduled`). Fallo Google no revierte booking. Máx 5 intentos. Payload incluye `sheet_id`, `sheet_title`, `sheet_row`, `inventory_id` si hay fila de inventario reclamada. Claim inventario (`agenda_sheet_inventory_claim_ai`) corre antes que outbox alfabéticamente.

### Feature flag
`GOOGLE_SHEETS_SYNC_ENABLED=false` apaga sync sin borrar bookings/mappings.

### Columnas técnicas
Rango seguro **O:U** (`ESTADO CRM`…`CRM_SYNC_VERSION`). **A:N se PRESERVA** (H:I contiene notas/papelería reales). Escritura Edge solo A:D + O:U tras relectura y guard `assertTechColumnsWritable`. Extracción exige `TechCellSource` (`absolute_row` con `startColumnIndex`, o `tech_range_ou` si el GET fue `O:U`); nunca inferir O:U por `values.length === 7`.

### Resolución de pestaña
`GOOGLE_SHEETS_TAB_MAP_JSON` preferente. Fallback live por metadatos → `resolved_from_tab_map` | `resolved_from_live_metadata` | `missing_sheet_for_date` | `ambiguous_sheet_for_date`. No crea pestañas.

### Worker CRM→Sheets
- POST `/functions/v1/agenda-sheet-sync-worker`
- Header: `x-concasa-worker-secret` (también acepta `x-concasa-webhook-secret`)
- Secret Edge: `GOOGLE_SHEETS_WORKER_SECRET` (fallback `GOOGLE_SHEETS_WEBHOOK_SECRET`)
- Body: `{}` (no requerido)
- Sync off: `200 { processed: 0, disabled: true }` sin tocar datos
- Claim: `agenda_sheet_claim_outbox` con `FOR UPDATE SKIP LOCKED`, máx 50/ejecución
- Título A1: resuelve título live por `sheetId` (`listSheets`) para conservar trailing spaces
- Confirmación: read-back A:U; si NSS/nombre/bookingId/source no coinciden → `failed` (`write_verify_failed`), no `done`
- **Cancelación (contrato 136):** conservar **A** y **G:N** sin escribirlos; limpiar solo **B:D** + **O:U** vía `values.batchClear`; no rewrite A:U; propiedad solo si `P=booking_id` y source crm; E/F con texto → `manual_result_conflict` → outbox `dead` (no retry); fila reutilizada (**P** distinto) → no tocar; no comparar `link.sync_version` vs U (stale tras CANCELADA); inventario `CANCELADA` → available aunque haya conflicto E/F
- Cancel sin fila conocida / already_absent → `done` no-op + `agenda_sheet_mark_cancelled_cleared`
- Worker admin read-only: `POST` body `{ dry_run_cancel_cleanup: true, targets: [...] }` clasifica con A:U live sin mutar
- Cron: mig. 130 job `agenda-sheet-sync-worker-every-minute` (`* * * * *`) vía Vault `agenda_sheet_project_url` + `agenda_sheet_worker_secret` (independiente del reconcile 132)

### Docs operativas
`integrations/google-sheets-agenda/README.md`

---

## 8. Agendar biométricos (asesor)

**Operación:** `POST /agenda/biometricos/bookings` · RPC `book_biometricos`

### Request

```json
{
  "expediente_id": "uuid",
  "date": "YYYY-MM-DD",
  "time": "HH:mm",
  "location_id": "string"
}
```

### Reglas (B0D5)

- Solo `asesor`; expediente etapa **4 o 5** (5 solo tras cancelación Mesa: `subestado = en_proceso`, sin booking activo, última cita biométrica `cancelled`).
- Persiste booking + `expedientes.fecha_cita`; **NO** cambia etapa.
- Cupo según `agenda_config` + conflictos.

---

## 8.2 Cancelar biométricos (asesor) — P3M.4

**Operación:** `POST /agenda/biometricos/bookings/cancel` · RPC `cancel_biometricos`

### Request

```json
{
  "expediente_id": "uuid",
  "motivo": "string?"
}
```

### Reglas

- Roles: `asesor` (dueño), `mesa_admin`, `mesa_interno`, `mesa_externo`, `super_admin`.
- Expediente etapas **4 o 5**, `subestado = en_proceso`, enviado a Mesa, ciclo activo.
- Asesor puede **agendar** (`book_biometricos`) en etapa 4 (normal) o etapa 5 solo si `subestado = en_proceso`, no hay booking activo y la **última** cita `kind = biometricos` está `cancelled` (mismo expediente). No cambia etapa.
- Mesa: `can_see_expediente`; asesor: solo dueño.
- Motivo **obligatorio** para roles Mesa (`mesa_*`, `super_admin`).
- Booking activo `kind=biometricos`, `status=booked`.
- `agenda_bookings.status → cancelled`; `expedientes.fecha_cita = null`; **no** cambia etapa.

---

## 8.3 Reagendar biométricos (asesor) — P3M.4

**Operación:** `POST /agenda/biometricos/bookings/reagendar` · RPC `reagendar_biometricos`

### Request

```json
{
  "expediente_id": "uuid",
  "scheduled_at": "ISO-8601",
  "location_id": "string",
  "note": "string?"
}
```

### Reglas

- Solo `asesor` dueño; expediente etapa **4**; booking activo.
- Cancela booking anterior + crea nuevo `booked`; actualiza `fecha_cita`; valida `agenda_config` (P2C-11).
- **No** cambia etapa.

---

## 8.1 Configurar disponibilidad biométricos (Mesa) — P3M.1

**Operación:** `PUT /agenda/biometricos/config` · RPC `upsert_agenda_config_biometricos`

### Request

```json
{
  "config": {
    "enabled": true,
    "timezone": "America/Monterrey",
    "min_lead_hours": 24,
    "allowed_weekdays": [1, 2, 3, 4, 5],
    "slots": ["09:00", "10:00", "11:00"],
    "locations": {
      "mty-centro": {
        "enabled": true,
        "capacity_per_slot": 3,
        "label": "Centro MTY",
        "capacity_by_time": { "09:00": 8, "10:00": 5 }
      }
    }
  },
  "organization_id": "uuid?"
}
```

`organization_id` opcional: default = org del actor. Solo `super_admin` puede apuntar a otra org.

### Reglas

- **Escritura:** `mesa_admin`, `super_admin` (Cynthia opera como `mesa_admin`).
- **Bloqueados:** `mesa_interno`, `mesa_externo`, `asesor`, `editor`.
- `kind = biometricos` fijo; tabla `agenda_config`.
- Modelo **semanal** canónico (sin calendario por día mock, sin vigencia por fecha, sin excepciones por día en P3M.1).
- Validación estricta de claves permitidas; `locations` no vacío si `enabled=true`; al menos una sede `enabled=true`.
- **P123/P124:** `locations.<id>.capacity_by_time` (`{ "HH:MM": n≥1 }`). Precedencia de cupo en booking: fila `agenda_slot_capacities` (fecha) → `capacity_by_time[hora]`. Sin `capacity_by_time` el horario no es reservable (P124; `capacity_per_slot` solo compatibilidad histórica).
- Si el upsert **reduce** disponibilidad y hay bookings futuros `booked`: **no bloquea**; retorna `warnings[]`; registra `action_log` → `agenda.biometricos.config_upsert`; **no** cancela bookings.

### Response

```json
{
  "ok": true,
  "agenda_config_id": "uuid",
  "organization_id": "uuid",
  "kind": "biometricos",
  "config": { },
  "created": true,
  "updated_at": "ISO-8601",
  "updated_by": "uuid",
  "warnings": []
}
```

- Migración: `034_rpc_upsert_agenda_config_biometricos.sql`.
- Tests: `supabase/tests/rpc_upsert_agenda_config_biometricos.sql` (18 pruebas).
- UI / `DATA_MODE` fuera de alcance P3M.1A.

---

## 8.2 Configurar disponibilidad firmas (Mesa) — P3P.1A

**Operación:** `PUT /agenda/firmas/config` · RPC `upsert_agenda_config_firmas`

### Request

```json
{
  "config": {
    "enabled": true,
    "timezone": "America/Monterrey",
    "min_lead_hours": 24,
    "allowed_weekdays": [1, 2, 3, 4, 5],
    "slots": ["09:00", "10:00", "11:00"],
    "locations": {
      "mty-centro": {
        "enabled": true,
        "capacity_per_slot": 3,
        "label": "Centro MTY"
      }
    }
  },
  "organization_id": "uuid?"
}
```

`organization_id` opcional: default = org del actor. Solo `super_admin` puede apuntar a otra org.

### Reglas

- **Escritura:** `mesa_admin`, `super_admin` (Cynthia opera como `mesa_admin`).
- **Bloqueados:** `mesa_interno`, `mesa_externo`, `asesor`, `editor`.
- `kind = firmas` fijo; tabla `agenda_config`.
- Modelo **semanal** canónico (misma estructura que biométricos §8.1).
- Preprocesa con `agenda_firmas_normalize_config` (legacy `minLeadDays` → `min_lead_hours`).
- Validación estricta de claves permitidas; `locations` no vacío si `enabled=true`; al menos una sede `enabled=true`.
- Si el upsert **reduce** disponibilidad y hay bookings futuros `firmas` con `status='booked'`: **no bloquea**; retorna `warnings[]`; registra `action_log` → `agenda.firmas.config_upsert`; **no** cancela bookings.

### Response

```json
{
  "ok": true,
  "agenda_config_id": "uuid",
  "organization_id": "uuid",
  "kind": "firmas",
  "config": { },
  "created": true,
  "updated_at": "ISO-8601",
  "updated_by": "uuid",
  "warnings": []
}
```

- Migración: `036_rpc_upsert_agenda_config_firmas.sql`.
- Tests: `supabase/tests/rpc_upsert_agenda_config_firmas.sql` (20 pruebas).
- UI Mesa: `AgendaFirmasWeeklySupabaseSection` + `SupabaseAgendaFirmasConfigRepo` (P3P.1B).
- Booking asesor fuera de alcance P3P.1B (P3P.2).

---

## 9. Enviar retención a Mesa (asesor)

**Operación:** `POST /expedientes/{id}/retencion/enviar` · RPC `enviar_retencion_mesa`

### Request

```json
{
  "retencion_opcion": "con_sello | sin_sello"
}
```

### Reglas

- Etapa 8 (primer envío) o etapa 8/9 con `correccion_requerida` (reenvío); documento principal de la opción en `subido|resubido|validado`.
  - Opción A: `retencion_acuse_con_sello`
  - Opción B: `retencion_carta_sin_sello`
- Aviso/INE históricos no son requeridos para envío ni avance 8→9.
- Upsert `retencion_envios` (`enviado`, `estado = enviado`) **y** avance atómico `etapa_actual` 8→9 (`subestado = en_proceso`).
- No marca el documento como `validado`; no crea `agenda_bookings` ni `fecha_cita`.
- Reintento con expediente ya en etapa 9 + bloque enviado: respuesta idempotente (`idempotent: true`), sin avanzar a 10.
- Bloquea cambio opción A/B mientras `estado = enviado` (corrección libera).

### UI asesor (P079 + P132-acuse)

- Panel `RetencionAcuseAvisoSupabaseCard` si `DATA_MODE=supabase`, `etapa_actual >= 8`, `submitted_to_mesa`.
- Acuse principal en etapa 8 avanza atómicamente a 9 y fija `firma_agendable_desde` (si NULL; +5 hábiles Monterrey); copy muestra fecha cuando existe.
- En agenda firma (etapa ≥ 9) aviso no bloqueante si falta Acuse + enlace al panel retención; banner `Podrás agendar la firma a partir del DD/MM/YYYY`.
- Upload: Storage + `register_expediente_documento_retencion` (avance 8→9 solo etapa exacta 8).
- `enviar_retencion_mesa` no avanza etapa (reenvíos/idempotencia).
- Sin validación Mesa del Acuse; gate SQL `agenda_firmas_assert_agendable_desde` en book/reagendar.

---

## 10. Retención en Mesa (lectura + agenda firma)

`update_documento_revision` sigue existiendo para otros documentos; **P079** no expone Validar / Solicitar corrección sobre el bloque Acuse.

### UI Mesa (P079)

- Sección `MesaRetencionAcuseAvisoSection` en `/mesa-control/[id]` Supabase si `etapa_actual >= 8`.
- Lee `retencion_opciones`, `retencion_envios`, docs `retencion_*` (lista según opción A/B) en modo lectura.
- Preview/descarga Storage; copy «Acuse recibido — listo para agendar firma.»
- Agenda firmas vía controles etapa 9 (`mesa_book_firmas` / P075); el envío del Acuse **no** crea booking.

### UI Mesa avance 8→9 (recuperación / gate coherente)

- Panel «Avanzar a etapa 9» si `deriveAvanceOperativo8a9View.puedeAvanzar` (casos residuales en etapa 8).
- Gates: etapa 8, `en_proceso`, enviado a Mesa, ciclo activo, `cliente_datos` validado, `retencion_envios` enviado/estado `enviado`, documento principal en `subido|resubido|validado`.
- RPC `avanzar_etapa_operativa` → `etapa_actual = 9`, `action_log.transition = 8_9`.
- Flujo normal post-P079: el asesor ya dejó el expediente en etapa 9 al enviar.

---

## 11. Agendar firma (asesor / mesa_admin) — P2C-18

**Operación:** `POST /agenda/firmas/bookings` · RPC `book_firmas`

### Request

```json
{
  "expediente_id": "uuid",
  "scheduled_at": "ISO-8601",
  "location_id": "string",
  "note": "string?"
}
```

### Reglas

- Roles: `asesor` (dueño), `mesa_admin`, `super_admin`.
- Expediente etapa **9 o 10** (10 solo tras cancelación Mesa: `subestado = en_proceso`, sin booking activo, última cita firmas `cancelled`), enviado a Mesa.
- Valida `agenda_config` (`kind = firmas`): anticipación, día, slot, sede, cupo.
- **Deploy:** migración `024` ejecuta `backfill_agenda_config_firmas()` para orgs sin fila firmas (idempotente).
- Persiste `agenda_bookings` (`kind = firmas`) + `expedientes.fecha_cita`.
- **NO** cambia `etapa_actual`.

- UI asesor: `AgendaFirmasSupabaseCard` en etapa 9 (P3P.2).
- UI Mesa: resumen cita + avance 9→10 en detalle Supabase (P3P.3).
- **P117:** en etapa 10, botón Mesa «Pasar a Firmado» → `avanzar_etapa_operativa` transición `10→11` (mismos gates de firma; no movimiento manual libre).
- **P119.4:** en etapa 11, botón Mesa «Pasar a Pago a ConCasa» → `avanzar_etapa_operativa` transición `11→12` (solo posición operativa; no registra pago ni muta citas/docs/montos).

---

## 12. Cancelar firma (asesor / mesa_admin) — P2C-19

**Operación:** `POST /agenda/firmas/bookings/cancel` · RPC `cancel_firmas`

### Request

```json
{
  "expediente_id": "uuid",
  "motivo": "string?"
}
```

### Reglas

- Roles: `asesor` (dueño), `mesa_admin`, `mesa_interno`, `mesa_externo`, `super_admin`.
- Expediente etapa **9 o 10**, `subestado = en_proceso`, enviado a Mesa, ciclo activo.
- Asesor puede **agendar** (`book_firmas`) en etapa 9 (normal) o etapa 10 solo si `subestado = en_proceso`, no hay booking activo y la **última** cita `kind = firmas` está `cancelled` (mismo expediente). No cambia etapa.
- Mesa: `can_see_expediente`; asesor: solo dueño.
- Motivo **obligatorio** para roles Mesa (`mesa_*`, `super_admin`).
- Requiere booking `firmas` activo (`status = booked`).
- Cancela booking (`status = cancelled`, `cancelled_at`); limpia `expedientes.fecha_cita`.
- **NO** cambia `etapa_actual`.

---

## 13. Reagendar firma (asesor / mesa_admin) — P2C-19

**Operación:** `POST /agenda/firmas/bookings/reagendar` · RPC `reagendar_firmas`

### Request

```json
{
  "expediente_id": "uuid",
  "scheduled_at": "ISO-8601",
  "location_id": "string",
  "note": "string?"
}
```

### Reglas

- Mismos roles y gates que cancelar (etapa 9 o 10, booking activo).
- Cancela booking anterior, valida nuevo slot (`agenda_firmas_assert_slot_available`), inserta nuevo booking, actualiza `fecha_cita`.
- **NO** cambia `etapa_actual`.

### Pendiente

- UI / `DATA_MODE` fuera de alcance.

---

## 14. Reenvío retención (asesor)

**Operación:** `POST /expedientes/{id}/retencion/reenviar`

### Reglas

- Solo si `retencion_envios.estado = correccion_requerida` y sin faltantes.
- Docs rechazados reemplazados → `resubido`; Mesa revalida.

---

## 14B. Bandeja Mesa paginada (P102)

**Operación:** RPC read-only `mesa_list_bandeja_page(...) → jsonb`

| Campo | Semántica |
|---|---|
| `items` | Página ≤25 (keyset `sort_ts ASC, id ASC`) |
| `total_count` | Total del filtro actual |
| `has_more` / `next_cursor` | Cursor `(sort_ts, id)`; `LIMIT+1` interno |
| `counts` | KPIs globales (mismo universo visible + origen); no dependen de la página |

- Roles: `mesa_admin` \| `mesa_interno` \| `mesa_externo` \| `super_admin`; visibilidad `can_see_expediente`.
- Orden de evaluación: **filtros → orden global → página**. Nunca filtrar en cliente sobre 25 filas.
- UI `/mesa-control` (Supabase): infinite scroll pide la siguiente página; enrich documental P100 solo de IDs de la página.
- Migración `094_rpc_mesa_list_bandeja_page.sql` (ampliada en **113** / P127).

### 14B-bis. Actividad Mesa — Visto / Actualizado por (P127)

**Tabla:** `expediente_mesa_actividad` (unique `organization_id + expediente_id`). SELECT con `can_see_expediente`; sin INSERT/UPDATE/DELETE a `authenticated`.

| Fuente | Campos | Mecanismo |
|---|---|---|
| Visto por | `last_viewed_by` / `last_viewed_at` | RPC `mesa_registrar_vista_expediente(p_expediente_id)` al abrir detalle; no escribe `action_log`; no muta expediente |
| Actualizado por | `last_updated_by` / `last_updated_at` | Trigger AFTER INSERT `action_log` si `actor_role` ∈ Mesa/`super_admin` y acción no es vista/lectura; resuelve expediente por `entity_type=expediente` o `payload.expediente_id` |

**RPC detalle:** `get_mesa_expediente_actividad(p_expediente_id) → jsonb` con nombres vía `profiles.full_name`.

**Bandeja:** mismos campos en cada item (`last_viewed_by_name/at`, `last_updated_by_name/at`) por JOIN batch (sin N+1). UI: `America/Monterrey`.

**Migración:** `113_mesa_internal_names_and_activity.sql` (también actualiza `full_name` de 5 `mesa_interno` inequívocos; no toca email/UID/rol/org).

### 14B-ter. Presencia activa — Abierto ahora por (P128)

**Tabla:** `expediente_mesa_presencia` (unique `organization_id + expediente_id + user_id + session_id`). SELECT con `can_see_expediente`; sin INSERT/UPDATE/DELETE a `authenticated`.

| RPC | Uso |
|---|---|
| `mesa_touch_expediente_presencia(exp, session)` | Upsert al abrir + heartbeat 25s |
| `mesa_close_expediente_presencia(exp, session)` | Retira sesión del actor (best-effort) |
| `mesa_list_expedientes_presencia(ids[])` | Batch; solo `last_seen_at` &lt; 90s; nombres dedupe por usuario |

No escribe `action_log` ni muta `expedientes`. UI badge verde; Visto/Actualizado (P127) intactos. Migración `114_expediente_mesa_presencia.sql`.

### 14B-quater. Lote de cambios del asesor (P130)

**Tablas (migración 115):** `expediente_asesor_cambio_lotes` + `expediente_asesor_cambios` (append-only al congelar). Sin escritura directa `authenticated`.

| RPC | Uso |
|---|---|
| `mesa_list_asesor_cambios_summary(p_expediente_ids uuid[])` | Batch bandeja; `{ ok, items[{ expediente_id, batch_id, status, submitted_at, changes_count, summary[] }] }` |
| `mesa_get_asesor_cambio_lote(p_expediente_id)` | Detalle; `{ ok, lote, changes[] }` |
| `mesa_marcar_asesor_cambios_revisados(p_lote_id)` | Idempotente; roles Mesa/`super_admin`; no avanza etapa ni valida docs |

Captura en la misma TX de `register_expediente_documento_correccion` / `save_cliente_datos_correccion`. **Fix lotes vacíos (mig. 117):** `asesor_cambio_freeze_lote` no congela sin filas (borra borrador vacío); `register_expediente_documento` (vía `…_pre_reingreso`) registra reemplazo post-Mesa con el mismo helper `asesor_cambio_record_doc_reemplazo`. UI: `hasAdvisorChangeDetails` (batchId && count>0) — sin «Revisar cambios» si count=0; enrich `advisorChanges*`; panel `mesa-asesor-cambios`; focus `asesor-cambios`.

---

## 15. Admin KPIs / Producción (P081–P082)

**Operación:** RPCs read-only `admin_get_production_summary`, `admin_get_mesa_cohort_by_etapa`, `admin_list_production_by_asesor`, `admin_list_mesa_envios_page`, `admin_list_precalificaciones_page`

### 15-bis. Reporte expedientes por asesores × pasos visuales (P112)

**Operación:** RPC read-only `admin_report_expedientes_asesores_etapas(p_asesor_ids UUID[] DEFAULT NULL, p_pasos_visuales SMALLINT[] DEFAULT NULL, p_estado TEXT DEFAULT 'vigentes') RETURNS JSONB`

**Auth:** únicamente `super_admin`; `SECURITY DEFINER` + `STABLE`; GRANT `authenticated`; REVOKE `anon`/`PUBLIC`. No escribe `action_log` ni muta filas.

**Universo:** `organization_id` del actor; `deleted_at IS NULL`; `submitted_to_mesa`; `ciclo_estado = activo`; etapa en pasos seleccionados. `p_estado`: `vigentes` (activos+rechazados), `activos`, `rechazados`. NULL/`{}` en asesores/pasos = Todos. Sin rango de fechas.

**Mapeo pasos:** 1→[1], 2→[2], 3→[3,4], 4→[5], …, 11→[12]. Validar pasos ∈ 1..11.

**Response:** `{ resumen[], detalle[], meta }` — migración `098_admin_report_expedientes_asesores_etapas.sql`. UI `/admin` «Reporte de expedientes» + Excel `reporte-expedientes-YYYY-MM-DD.xlsx` (snapshot de la última consulta).

### 15-ter. Reporte v2 + fecha canónica de paso (P114)

**Tracking:** `expedientes.fecha_entrada_paso_visual_actual` (nullable, sin backfill) + `expediente_paso_visual_transiciones` (append-only vía trigger). Mapper `__map_etapa_interna_a_paso_visual`. Cruce 3→4 no cambia fecha ni escribe historial.

**Operación:** RPC read-only `admin_report_expedientes_asesores_etapas_v2(..., p_fecha_desde DATE DEFAULT NULL, p_fecha_hasta DATE DEFAULT NULL)` — migración `100_…sql`. P112 (`…_etapas` sin fechas) intacta.

**Fechas:** calendario `America/Monterrey`; rango inclusivo; desde>hasta → error. Sin rango incluye históricos `NULL`. Con rango los excluye y reporta `meta.sin_fecha_canonica` / `meta.excluidos_por_fecha_desconocida`. Detalle incluye `fecha_entrada_paso_actual` (`YYYY-MM-DD`|null).

**P115 (solo UI):** filtro general Admin traduce paso visual→internas (Paso 3→`[3,4]`) sin cambiar RPC; resumen UI distingue etapas consultadas vs `meta.pasos` (con resultados); advertencia de rango + «Quitar rango».

### 15-quater. Reporte v3 + tipo de fecha (P116)

**Operación:** RPC read-only `admin_report_expedientes_asesores_etapas_v3(..., p_tipo_fecha TEXT DEFAULT 'envio_mesa', p_fecha_desde, p_fecha_hasta)` — migración `101_…sql`. P112/P114 intactas.

**`p_tipo_fecha`:** `envio_mesa` → `expedientes.fecha_envio_mesa` (default, reportes históricos); `entrada_paso_actual` → semántica P114. Fechas calendario `America/Monterrey`. Meta incluye `tipo_fecha`, `sin_fecha_canonica`, `excluidos_por_fecha_desconocida`. Detalle incluye `fecha_envio_mesa` y `fecha_entrada_paso_actual`.

### P085 — filtro global por asesor

- Todas las consultas Admin aceptan el mismo `asesor_id` UUID estable (nunca nombre/email).
- `admin_list_production_by_asesor(p_from, p_to_exclusive, p_estado, p_asesor_id DEFAULT NULL)`:
  - sin `p_asesor_id` → producción de todos los asesores del periodo;
  - con `p_asesor_id` → una sola fila (o vacío si no hay producción).
- UI `/admin`: tarjetas de etapa filtran `etapa_actual`, sincronizan el select, hacen scroll a `#admin-mesa-expedientes` y ocultan temporalmente «Producción por asesor» mientras hay etapa activa.
- Orden de secciones: Filtros → KPIs → Etapas → Expedientes Mesa → Producción por asesor → Precalificaciones.
- **Seguimiento Mesa (P085):** `admin_list_mesa_envios_page` → **1 fila/expediente** con resumen RO (`situacion_*`, `siguiente_accion_*`, correcciones por elemento, espera, rechazo operativo, reingreso, última actividad Mesa). **Sin** timeline embebido. Timeline: `admin_get_expediente_mesa_timeline(p_expediente_id, p_limit, p_offset)` bajo demanda («Ver seguimiento»).
- **Privacidad asesor Mesa:** respuesta **sin** `asesor_email`. Display: `asesor_nombre` o `Asesor sin nombre registrado` (nunca correo). Búsqueda puede usar email internamente en SQL sin devolverlo.
- **Timeline paginación:** `p_limit` NULL→10, ≤0→1, >100→100; `p_offset` NULL/−→0; orden `created_at DESC, id DESC` (id no expuesto); `has_more`; total_count independiente del limit.
- **Listado rendimiento:** cohorte filtrada → page_ids → seguimiento pesado solo de la página.
- **Última actividad Mesa:** solo whitelist de `action_log.action` de flujo Mesa (no `actor_role`, no reinterpretar por `super_admin`).
- **Correcciones:** identidad por documento/sección (`rechazado` / `resubido` / `cliente_datos.rechazado` / `retencion_envios.correccion_requerida`); no se cierra una corrección por cambios en otro elemento.
- **Rechazo operativo:** solo `expediente_rechazos_operativos` (+ espejo `subestado=rechazado`); motivo fallback `Sin motivo registrado`; sin UUID/actor/payload en API.
- Campos fila (seguros): `expediente_id` (solo interno timeline), `fecha_envio_mesa`, `etapa_actual`, `etapa_label`, `subestado`, `situacion_code/label`, `siguiente_accion_label/actor`, `ultima_actividad_mesa_*`, `correcciones_*`, `espera_*`, `rechazo_*`, `reingreso_activo`, `total_count`. Display UI también incluye `cliente_nombre` / `asesor_nombre` (no exportar UUID ni email).

### Fechas canónicas

| Métrica | Fecha | Monto |
|---|---|---|
| Enviados a Mesa | `expedientes.fecha_envio_mesa` | — |
| Precalificaciones aprobadas | `editor_decisions.aprobado_at` (1ª transición) | `monto_aprobado_al_aprobar` |

- Zona de negocio: `America/Monterrey` (cortes Hoy/semana/mes en cliente → bounds `[from, toExclusive)`).
- Periodo predeterminado en UI: **Hoy**.
- `monto_aprobado` actual permanece mutable; no se usa para KPIs de periodo.
- Mayor a $20,000: `monto_aprobado_al_aprobar > 20000` (estricto).
- Fechas canónicas Precal: `aprobado_at` (aprobadas) y `no_cumple_at` (No cumple). **No** `updated_at`.
- KPI superior: Enviados Mesa, Aprobadas, No cumple, Aprobadas >$20k, Monto Mejoravit.
- KPI / columna `monto_aprobado_total`: solo `decision = aprobado` + programa `mejoravit` + `monto_aprobado_al_aprobar`.
- **P087:** en agregados Admin (`monto_aprobado_total`, `monto_mejoravit_total`, `monto_mejoravit_promedio`) cada expediente aporta `LEAST(COALESCE(monto_aprobado_al_aprobar,0), 169000)` **antes** del `SUM`/`AVG`. El total puede superar `$169,000`. El snapshot y las filas individuales (`monto_aprobado_al_aprobar`) **no** se modifican ni se topan en UI/Excel de detalle. Migración `086_…sql` (no implica UPDATE de datos). Items de `admin_list_precalificaciones_page` conservan `monto_aprobado_snapshot_no_recuperable` (contrato P084).
- **P084:** excepción controlada que repara snapshots demostrablemente corruptos (1ª aprobación absurda + bounce <60s) desde `action_log`; no redefine la inmutabilidad ordinaria ni cambia `aprobado_at`. Caso sin re-aprobación: `monto_aprobado_snapshot_no_recuperable=true` + `monto_aprobado_al_aprobar=NULL` (etiqueta «Aprobación histórica con monto no recuperable»).
- Escritura `monto_aprobado` (aprobación): `> 0` + `NUMERIC(14,2)`. **No** hay máximo canónico de aprobación del editor; el tope `$169,000` de P087 aplica **solo** a la aportación en agregados Admin, no al valor almacenado ni a la base de cobro Mejoravit.
- Bloque Precalificaciones:
  - Filtro default **Resueltas** (Aprobadas ∪ No cumple del periodo).
  - Pendientes = estado actual (etiqueta «Pendiente actual»), sin inventar `pendiente_at` ni usar `updated_at`.
  - Summary: Total resueltas, Aprobadas, No cumple, Pendientes actuales, Monto/Promedio Mejoravit.

### Reglas

- Rol `super_admin` únicamente.
- Solo lectura; sin mutaciones desde Admin.
- Paginación server-side con `total_count` exacto (page size ≤ 100).
- Export Excel respeta filtros; máx. 5000 filas por hoja; sin NSS/teléfono/UUID.
- Cohorte Mesa: fechas filtran envíos; etapas muestran **estado actual**.
- Reemplaza agregación client-side legacy (`adminDashboardStats.ts`) en `/admin`.

---

## 16. Descargar documento (signed URL)

**Operación:** `POST /documentos/{id}/signed-url`

### Response

```json
{
  "url": "https://...",
  "expires_at": "ISO"
}
```

### Reglas

- TTL 60–300 s.
- RLS + Storage policy: asesor propio; mesa según origen; externo nunca internos.

---

## 17a-bis. Mesa Citas — fecha del día + export Excel (P095)

**UI:** `/mesa-control/citas` · `MesaAgendaCitasClient` · vista default `lista`.

**Lectura:** RPC `get_mesa_agenda_bookings` (sin cambio de firma). Cliente `fetchMesaAgendaBookings`.

**Fecha (B1 / P120):**
- `MESA_AGENDA_BUSINESS_TIMEZONE` = `America/Monterrey` vía `zonedYmdParts`.
- Apertura: `defaultMesaAgendaDayRange()` → `p_start_date = p_end_date = hoy`.
- **Lista (P120):** `Fecha inicial` y `Fecha final` son independientes (borrador). No se consulta al editar; «Actualizar citas» valida y envía ambas a `get_mesa_agenda_bookings` (`p_start_date`/`p_end_date`). Rango inválido (vacío, inicial > final, >62 días) muestra error inline y deshabilita el botón sin corregir fechas. «Hoy» fija ambas a hoy Monterrey y consulta. Volver a Lista conserva el rango libre (no fuerza un día).
- **Día / Semana:** un día / rango semanal; no reutilizan la normalización de un solo día sobre Lista.
- Selección P089 se limpia por `selectionClearKey` (rango aplicado Lista); filtros UI se conservan.

**Export Excel (B2 util + B3 UI + P107/P109):**
- UI: botón `Descargar Excel` → `downloadMesaCitasExcel(loadedEntries, exportDayYmd, filters, sortBy)`; día vía `resolveMesaCitasExportDayYmd`; independiente de `selectedBookingIds` / límite 100.
- **P111:** gate `canDownloadMesaCitasExcel` / `canDownloadMesaCitasExcelForUser` (roles Mesa + `super_admin`, incl. `mesa_admin`); sin RPC adicional.
- `prepareMesaCitasExport(entries, fechaYmd, filters, sortBy)` → workbook in-memory agrupado por `report_group` resuelto + `bookingTime` (Firmas: hora oficial de presentación `09:30`).
- Archivo `citas-mesa-YYYY-MM-DD.xlsx`; hoja `Citas`; por bloque: `Fecha` | `NSS` | `Nombre completo`.
- Lectura: `get_mesa_agenda_bookings` incluye `report_group`.
- **P110:** sin UI de clasificación; resolver Excel = especiales históricos (`inscripcion`, `biometricos_tramite_completo`) o fallback por `kind`. RPC `mesa_set_agenda_booking_report_group` permanece en Cloud sin cableado UI.
- Firmas: bloque único `FIRMAS — 9:30 AM` (no muta `booking_time`).

---

## 17b. Validar en Drive (Mesa agenda citas) — P069

**Operación:** RPC `mesa_set_agenda_drive_validation`
**Lectura:** campos `drive_*` en `get_mesa_agenda_bookings`

### Request

```json
{
  "p_booking_id": "uuid",
  "p_validated": true
}
```

### Reglas

- Validación por `agenda_bookings.id` (no por expediente).
- Roles: `mesa_admin`, `mesa_interno`, `mesa_externo`, `super_admin`.
- `p_validated = true` solo si `status = booked`.
- Solo actualiza `drive_validated`, `drive_validated_at`, `drive_validated_by`.
- No cambia `status`, fechas, `kind`, `expediente_id`, etapa, cupos ni historial.
- Reagenda crea nuevo booking → inicia `drive_validated = false`.
- Auditoría: `agenda.drive_validation.set` / `agenda.drive_validation.clear`.
- **UI P089 (acciones masivas):** «Validar en Drive» en `/mesa-control/citas` reutiliza **esta misma RPC** por cada `booking_id` elegible (`p_validated=true`), con concurrencia limitada en cliente. No existe RPC batch nueva; no avanza etapas.

---

## 17c. Convertir Biométricos → Notificación (asesor) — P070

**Operación:** RPC `convert_biometricos_to_notificacion`
**Firma:** `convert_biometricos_to_notificacion(p_expediente_id uuid, p_booking_date date, p_note text default null) → jsonb`
**SECURITY:** `DEFINER`, `search_path=public`, `REVOKE` PUBLIC/anon, `GRANT EXECUTE` authenticated

### Request

```json
{
  "p_expediente_id": "uuid",
  "p_booking_date": "YYYY-MM-DD",
  "p_note": null
}
```

### Reglas

- Solo `asesor` dueño (profile activo), org propia, expediente no eliminado, `submitted_to_mesa`, ciclo `activo`, `subestado=en_proceso`.
- Etapas permitidas: **4** (flujo normal) o **3** (legacy con biométricos `booked`).
- Requiere booking `biometricos` `booked` (`FOR UPDATE`); bloquea si ya hay `notificacion` `booked`.
- Fecha de notificación futura (noon en TZ de agenda biométrica).
- **Operación atómica (misma transacción / misma función):**
  1. CANCEL biométricos → `status=cancelled`, `cancelled_at=now()`, nota conversión; **conserva** `kind`, fecha/hora/sede y columnas Drive.
  2. INSERT notificación → `kind=notificacion`, `status=booked`, `booking_time=12:00`, `drive_validated=false` (default).
  3. Expediente → `etapa_actual=3`, `fecha_cita` = noon de la nueva fecha, `subestado` permanece `en_proceso`.
- **No** `UPDATE agenda_bookings SET kind='notificacion'`.
- **No hereda Drive validation** a la Notificación nueva.
- Sin validación de cupo.
- Rollback completo si falla el INSERT (bio, etapa y `fecha_cita` quedan como antes).
- Auditoría: `agenda.biometricos.convert_to_notificacion` (booking anterior/nuevo, etapa anterior/nueva).
- Frontend: **una sola** llamada RPC (no `cancel_biometricos` + `book_notificacion` separados).

---

## 17d. Rechazo operativo y reingreso post-biométricos — P071/P072/P108A

### Rechazo operativo

**Operación:** RPC `rechazar_etapa_operativa`
**Firma:** `rechazar_etapa_operativa(p_expediente_id uuid, p_motivo text, p_comentario text, p_biometricos_condicion biometricos_condicion, p_biometricos_razon text default null, p_biometricos_booking_id uuid default null) → jsonb`
**Migración P108A:** `096_rechazo_operativo_todas_etapas_reactivacion.sql`

- Solo Mesa autorizada; expediente visible, activo, enviado y en etapa interna **1–12**.
- `reutilizables`, `repetir` e `invalidos` exigen booking biométrico del expediente, cita pasada y razón no vacía (camino P071/P072).
- Un booking `cancelled` solo acredita intento si `cancelled_at` es posterior a la cita. Un booking futuro `booked` bloquea.
- Registra una fila append-only en `expediente_rechazos_operativos`, cambia únicamente el subestado operativo a `rechazado` y escribe `action_log`.
- No cancela, reactiva ni modifica bookings, `fecha_cita`, documentos, montos ni notas históricas.
- **P108A / P099 (UI Mesa):** tarjeta «Rechazar expediente» en los 11 pasos visibles; formulario solo motivo (select + «Otro») y nota opcional; payload biométrico interno `desconocida` + nulls. Cancelación terminal: tarjeta roja «Cancelar trámite». Asesor: chip/filtro `Rechazados` + banner con motivo/nota + CTA «Corregir y reenviar a Mesa»; no confundir con cancelado.

### Reactivación (mismo expediente) — P108A

**Operación:** RPC `reactivar_expediente_rechazado`
**Firma:** `reactivar_expediente_rechazado(p_expediente_id uuid) → jsonb`

- Roles: asesor propietario del expediente, o `mesa_admin|mesa_interno|mesa_externo|super_admin` (con `can_see_expediente` / org).
- Exige: ciclo `activo`, `subestado=rechazado`, rechazo vigente append-only, etapa 1–12.
- Impide doble reactivación del mismo `rechazo_id` (`expediente_rechazo_reactivaciones` UNIQUE).
- Conserva `etapa_actual`, documentos, citas, montos y bookings.
- Subestado canónico post-reactivación (misma regla que `mesa_mover_etapa_operativa`): etapa **1 → `en_validacion_mesa`**; etapas **2–12 → `en_proceso`**.
- Limpia `motivo_rechazo` / `comentario_rechazo` del expediente; **no** borra filas de `expediente_rechazos_operativos`.
- Traza: `expediente_rechazo_reactivaciones` + `action_log` (`expediente.rechazo_reactivacion`) con quién, cuándo y `rechazo_id` atendido.
- **No** depende de `biometricos_condicion`. Errores estables `REACTIVATION_*`.

### Elegibilidad reingreso hijo (P072 intacto)

**Operación:** RPC read-only `get_reingreso_post_biometricos_elegibilidad`
**Firma:** `get_reingreso_post_biometricos_elegibilidad(p_expediente_id uuid) → jsonb`

- Solo el asesor dueño consulta.
- Reutiliza `reingreso_post_biometricos_elegibilidad_interna(uuid, uuid)`, sin grant al cliente.
- Respuesta: `eligible`, `reason_code`, `reason_message`, `rechazo_id`, `biometricos_condicion`, `existing_child_id`.
- Sigue siendo flujo especial post-biométricos (etapas 5/6 + `reutilizables`); la reactivación del mismo expediente (P108A) no lo reemplaza.

### Creación atómica

**Operación:** RPC `iniciar_reingreso_post_biometricos`
**Firma:** `iniciar_reingreso_post_biometricos(p_expediente_anterior_id uuid, p_nota text default null) → jsonb`

- Bloquea el padre y reevalúa dentro de la transacción la misma elegibilidad.
- Cierra únicamente el ciclo del padre y crea un hijo enlazado en etapa 6, `en_proceso`, activo y enviado a Mesa, sin booking.
- El hijo inicia una decisión de editor pendiente; la aprobación nueva recalcula el cobro con la fórmula productiva.
- Reutiliza solo documentos validados de la lista blanca. Domicilio y estado de cuenta siempre son nuevos.
- El avance especial 6→7 exige nueva aprobación con monto positivo y ambos documentos nuevos activos/validados.
- Errores estables `REENTRY_*`; Zod valida inputs/outputs en dominio.

### Seguridad e integridad

- `SECURITY DEFINER`, `search_path=public`, referencias calificadas, `REVOKE` PUBLIC/anon y grants explícitos a `authenticated`, `service_role`, `postgres`.
- FK compuesta `(reingreso_rechazo_id, expediente_anterior_id)` garantiza que el rechazo pertenezca al padre.
- Índices parciales impiden reutilizar un rechazo o crear más de un hijo de reingreso activo.
- `reutilizado_de_documento_id` conserva genealogía; lectura Storage se permite por un hijo visible sin ampliar escritura.
- Auditoría en `action_log` y en la tabla especializada append-only.

---

## 17e. Libertad operativa y firmas por Mesa — P074/P075

### Movimiento manual

**RPC:** `mesa_mover_etapa_operativa(p_expediente_id uuid, p_etapa_destino smallint, p_etapa_esperada smallint, p_motivo text) → jsonb`

- Roles: `mesa_admin`, `mesa_interno`, `mesa_externo`, `super_admin`; organización/origen siempre por `can_see_expediente`.
- Requiere expediente no eliminado, enviado, ciclo activo y subestado `en_validacion_mesa|en_proceso`.
- Destino 1 deriva `en_validacion_mesa`; 2–12 deriva `en_proceso`.
- Solo muta etapa/subestado/updated_at. Escribe `expediente_movimientos_mesa` y `action_log`.
- Errores estables `MESA_MOVE_*`; `p_etapa_esperada` evita sobrescritura concurrente.
- **P093 B1 (UI):** el panel «Movimiento manual de Mesa» aclara que **no** es rechazo; si el motivo contiene `rechaz*` muestra advertencia informativa (no bloquea ni ejecuta rechazo); en pasos elegibles ofrece atajo a `#mesa-rechazo-operativo`. El rechazo canónico sigue siendo solo `rechazar_etapa_operativa` (17d; P108A: etapas 1–12).
- **P093 B2 (UI):** la numeración Mesa («Etapa N», IDs 1–12) y Asesor («Paso K de 11») es la misma `etapa_actual`; helpers `etapa-numeracion-ux` solo presentacionales. No cambia contrato RPC ni persistencia.

### Firmas exclusivas de Mesa

**Alta:** `mesa_book_firmas(p_expediente_id uuid, p_booking_at timestamptz, p_timezone text, p_location_id text, p_nota text default null) → jsonb`

**Reagenda:** `mesa_reagendar_firmas(p_expediente_id uuid, p_booking_at timestamptz, p_timezone text, p_location_id text, p_motivo text) → jsonb`

**Cancelación:** `mesa_cancel_firmas(p_expediente_id uuid, p_motivo text) → jsonb`

- Alta/reagenda: cuatro roles Mesa, expediente visible, activo/enviado, etapa 9/10, fecha futura, timezone y sede de `agenda_config`.
- Cancelación: explícita sobre booking activo visible; permitida fuera de 9/10 para resolver bookings conservados por movimiento manual.
- Ninguna operación cambia etapa. Alta/reagenda actualizan `fecha_cita`; cancelación la limpia solo si no queda otro booking activo.
- Las RPC compartidas `book_firmas`, `reagendar_firmas` y `cancel_firmas` conservan sus contratos.
- Seguridad: `SECURITY DEFINER`, `search_path=''`, referencias calificadas, `REVOKE PUBLIC/anon`, grants explícitos.

---

## 17e-bis. Cupos por horario + gestionar cita (P118)

### Cupos

**Listar:** `list_agenda_slot_capacities(p_kind booking_kind, p_slot_date date, p_location_id text default null) → table`

- Roles: Mesa + `asesor` + `super_admin`. Devuelve capacity/occupied/available/active.

**Upsert:** `upsert_agenda_slot_capacity(p_kind, p_location_id, p_slot_date, p_slot_time, p_capacity, p_active default true) → jsonb`

- Roles: `mesa_admin` | `super_admin`. Kind solo `biometricos`|`firmas`. Rechaza `capacity < occupied` con mensaje `No puedes establecer un cupo menor a las N citas ya reservadas.` (P125). No muta bookings. `ON CONFLICT` idempotente. Locks advisory: `org+kind+sede+hora` + slot por fecha (compartidos con asserts de booking). `action_log` `agenda.slot_capacity.upsert`.

**Config semanal (`upsert_agenda_config_*`):** reducir `capacity_by_time[hora]` bloquea si la nueva capacidad es menor al máximo de bookings `booked` futuros para esa hora+sede+kind. **P126:** `capacity_by_time[hora]=0` es cierre explícito (permitido aunque haya ocupados); no usa `capacity_per_slot`; bloquea nuevas reservas; conserva citas. Vacío / sin clave ≠ 0. Quitar horario o bajar cupo no cancela/reubica citas. Excepciones por fecha (`agenda_slot_capacities`) no se sobrescriben y siguen exigiendo capacidad > 0.

Asserts de book biométricos/firmas usan override cuando existe fila (`active=false` bloquea).

### Decisiones / gestionar

**Listar:** `list_agenda_booking_decisiones(p_expediente_id uuid) → table` (asesor del expediente o Mesa con `can_see_expediente`).

**Gestionar:** `mesa_gestionar_cita(p_booking_id, p_action, p_motivo, p_new_scheduled_at?, p_new_location_id?, p_new_booking_date?) → jsonb`

- Acciones: `reagendar` | `cancelar` | `cancelar_continuar` / `cancel_continue`.
- **P118b:** `cancel_continue` delega a `mesa_cancelar_cita_y_continuar(p_booking_id, p_motivo)`:
  - Roles SQL: `mesa_admin` | `super_admin` (UI: + `mesa_control_admin`).
  - Biométricos + etapa 4 → cancela booking, `fecha_cita=NULL`, avanza a 5, decisión `cancel_continue`.
  - Firmas + etapa 10 → cancela booking, `fecha_cita=NULL`, avanza a 11.
  - Notificación / firmas 9 / interno-externo-asesor: rechazado.
  - Idempotente si ya hay decisión `cancel_continue` y booking cancelado.
- Cancelar normal: no avanza etapa; permite reagendar.
- `cancelar` / `reagendar` delegan a RPCs existentes por kind y persisten fila en `agenda_booking_decisiones`.

Migraciones: `103_agenda_slot_capacities.sql`, `104_agenda_booking_decisiones_y_gestionar.sql`, `109_agenda_capacity_by_time.sql`, `110_agenda_explicit_hourly_capacities_only.sql`, `111_agenda_capacity_update_safety.sql`, `112_agenda_allow_zero_recurring_capacity.sql`.

---

## 17f. Cancelación operativa de expediente — P094 (B1 SQL)

**Objetivo:** cierre terminal cuando el cliente no continúa. Separado del rechazo operativo (17d).

### Señal canónica

| Campo | Valor |
|-------|--------|
| `ciclo_estado` | `cancelado` (enum ya existente en core) |
| `subestado` | **no** se fuerza a `rechazado`; se conserva el subestado previo (auditoría de dónde estaba) |
| Historial | Tabla append-only `expediente_cancelaciones` (espejo de `expediente_rechazos_operativos`): motivo, comentario, actor, timestamps; más `action_log` |
| `etapa_actual` | No cambia |
| Agenda | No cancela bookings automáticamente (igual filosofía que rechazo P071) |

### RPC (B1)

**Operación:** `cancelar_expediente_operativo`
**Firma:** `cancelar_expediente_operativo(p_expediente_id uuid, p_motivo text, p_comentario text default null) → jsonb`
**Migración:** `090_cancelar_expediente_operativo.sql`

- Roles Mesa (`mesa_admin|mesa_interno|mesa_externo|super_admin`) + `can_see_expediente`.
- Requiere: no eliminado, enviado a Mesa, `ciclo_estado = activo`.
- Permite cancelar aunque `subestado = rechazado` (abandono antes de reingreso) → tras cancelar, reingreso queda inelegible (`ciclo ≠ activo`).
- **No** crear fila en `expediente_rechazos_operativos`.
- **No** inferir cancelación desde motivo de movimiento manual.
- Errores estables `MESA_CANCEL_EXP_*`; `action_log` `expediente.cancelacion_operativa` (payload con `sin_efectos_agenda`).
- Respuesta: `ok`, `expediente_id`, `ciclo_estado='cancelado'`, `cancelacion_id`, `subestado` (previo, sin mutar), `etapa`.
- Tabla: SELECT vía RLS `can_see_expediente`; INSERT/UPDATE/DELETE revocados a `authenticated` (solo la RPC escribe).

### Gates posteriores

Con `ciclo_estado = cancelado` (cubierto por predicados `≠ activo` existentes + suite P094):

- Sin avance, movimiento manual, rechazo operativo, reingreso, book/reagendar citas.
- Uploads asesor/Mesa: `register_*` ya exigen `ciclo = activo` (B1 sin huecos nuevos).
- UI (B2): chip «Rechazos y cancelaciones» + subvistas; acción Cancelar en detalle; banner RO si `ciclo=cancelado`; acciones write gated por ciclo activo.

### Reapertura administrativa

**Fuera de P094.** Si negocio la pide después: RPC admin auditada `cancelado → activo` sin borrar historial de cancelación.

### UI / filtros (diseño)

**Mesa — Vista rápida:**

```text
Todos | Correcciones enviadas | Nuevos | En proceso | Rechazos y cancelaciones | Citas hoy
```

- Chip «Rechazos y cancelaciones»: contador =
  `count(subestado=rechazado ∧ ciclo_estado=activo)` + `count(ciclo_estado=cancelado)`.
- Subvistas disjuntas:
  - **Rechazados:** `subestado=rechazado` ∧ `ciclo_estado=activo`
  - **Cancelados:** `ciclo_estado=cancelado`
- Carga de bandeja: hoy solo `ciclo=activo`; cancelados requieren ampliar query (o fetch dedicado) **sin** mezclarlos en «En proceso» ni en «Todos» operativo si «Todos» sigue siendo ciclo activo (política: «Todos» = activos enviados; cancelados solo vía el chip agrupado).

**Asesor:**

- `rechazado_mesa` = enviado ∧ `subestado=rechazado` ∧ `ciclo_estado=activo` (recuperable).
- Estado `cancelado` = `ciclo_estado=cancelado` (prioridad sobre `en_tramite` y sobre `rechazado_mesa`).
- KPI/chip «Cancelados» independiente; detalle RO con banner terminal (sin write operativo).

**Admin (seguimiento) — B3 UI + B4 SQL:**

- Filtro `estado=rechazados`: `subestado=rechazado` ∧ `ciclo_estado=activo`.
- Filtro `estado=cancelados`: `ciclo_estado=cancelado` (opción UI explícita).
- Migración `091_admin_estado_rechazados_cancelados.sql`: redefine summary, cohort, by_asesor y mesa_envios_page con predicados disjuntos; firmas/SECURITY/P087 intactos.
- Frontend: `adminEstadoRpcParam` pasa `cancelados` nativo; sin split cliente.

### Relación con rechazo (17d) — intacto en P094 B0

- `rechazar_etapa_operativa` es el rechazo canónico (P108A: etapas internas 1–12; UI con `desconocida`).
- Reactivación mismo expediente: `reactivar_expediente_rechazado` (P108A); no toca cancelación terminal.
- Reingreso P072 exige `subestado=rechazado` ∧ `ciclo=activo` ∧ biométricos `reutilizables` en 5/6 → incompatible con cancelado; independiente de la reactivación P108A.
- Ampliar rechazo a otras etapas **no** es alcance de P094.

---

## 17. Repos mock existentes (referencia implementación)

| Interfaz | Archivo |
|----------|---------|
| `SessionRepo` | `src/domain/session/repo.ts` |
| `PrecalificacionesRepo` | `src/domain/precalificaciones/repo.ts` |
| `ExpedienteArchivosRepo` | `src/domain/expediente-archivos/repo.ts` |
| `ExpedienteClienteDatosRepo` | `src/domain/expediente-cliente-datos/repo.ts` |
| `ExpedienteRetencionOpcionRepo` | `src/domain/expediente-retencion/types.ts` |
| `ExpedienteRetencionEnvioMesaRepo` | `src/domain/expediente-retencion/types.ts` |
| `MockExpedientesRepo` | `src/domain/expedientes/mock.repo.ts` (formalizar interfaz P2) |

---

## 18. TODO P2

- [ ] Formalizar `ExpedientesRepo` interface
- [ ] Zod schemas por RPC
- [ ] OpenAPI o tRPC router
- [ ] Idempotency keys en envío mesa / retención

## 17f. Marcador Mesa `tiene_datos` (P119)

**RPC** `mesa_set_expediente_marcador(p_expediente_id, p_tipo, p_active)`

- Allowlist `tipo`: `tiene_datos`.
- Roles: `mesa_admin` | `mesa_interno` | `mesa_externo` | `super_admin`.
- Idempotente; `action_log` `mesa.expediente.marcador_set`.
- No modifica etapa/subestado.
- Lectura: SELECT RLS `can_see_expediente` + batch enrich bandeja.

**Asignación rápida:** reutiliza `mesa_take_expediente`.
**Avance rápido:** reutiliza `avanzar_etapa_operativa`.
