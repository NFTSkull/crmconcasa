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

## 1ter. Validación CURP + constancia PDF + RFC estimado (P156, piloto)

**Tipo documental:** `cliente_constancia_curp` (label «Constancia CURP») — opcional asesor (`integration_doc_tipos_asesor_opcionales`), PDF ≤15 MiB, versionado Storage `expediente-documentos`. Distinto de `cliente_acta_nacimiento`, `cliente_acta_nacimiento_digital`, `cliente_constancia_sat`.

**Tabla:** `cliente_validaciones_identidad` — historial; una vigente por `(expediente_id, tipo)`.

**Tipos de validación:** `curp_local` | `curp_constancia` | `curp_certificacion_registro_civil` | `curp_coincidencia_datos` | `rfc_estimado` | `rfc_validacion_sat`.

**Métodos:** `local` | `pdf_constancia` | `manual_asistido` | `api_oficial`.

**RPCs (SECURITY DEFINER):**
- `asesor_list_validaciones_identidad(p_expediente_id)` — dueño / Mesa / editor / super_admin
- `asesor_registrar_validacion_identidad(...)` — solo asesor dueño; invalida vigente previa del mismo tipo; `action_log` `identidad.validacion.registrar` (sin texto PDF / sin PII completa)
- `asesor_invalidar_validaciones_identidad(p_expediente_id, p_motivo)` — solo asesor dueño; `identidad.validacion.invalidar`

**Análisis PDF:** client-side (`pdfjs-dist`), solo texto embebido (sin OCR). Persistencia solo `resultado_resumido` con flags/coincidencias (`texto_legible`, `certificada_registro_civil`, `campos_coinciden`, `campos_con_diferencia`, `campos_no_disponibles`, `parser_version`) — **sin** CURP/nombres/fecha/acta/municipio completos.

**UI Asesor (hotfix constancia):** carga vía `DocumentDropzone` (arrastrar/clic/reemplazar); **upload/replace Storage primero**, análisis después (si el parser falla el PDF permanece activo). Copy de envío a Mesa según `submitted_to_mesa` del expediente (no por el solo hecho de subir). Microcopy amigable (sin enums crudos). Mesa: solo lectura del activo más reciente («✓ Recibida» + Ver/Descargar). No cambia etapa/subestado/permisos/envío.

**Invalidación:** `asesor_invalidar_validaciones_identidad(..., p_tipos TEXT[] DEFAULT NULL)` — selectiva por tipos; NULL = todas.

**RFC:** siempre estimado; nunca `RFC_OFICIAL_CONFIRMADO` en este flujo. Label UI: «RFC estimado (pendiente de confirmación oficial).» / «Confirmación oficial pendiente.»

**Feature flag:** `NEXT_PUBLIC_CURP_VALIDACION_PILOTO` (default habilitado salvo `"false"`). **No** gate de `enviar_a_mesa` en piloto.

**RLS:** SELECT si `can_see_expediente`; mutaciones solo vía RPC.

---

## 1bis. Re-precalificar NSS propio activo (P155 / P168 / P169)

**RPCs:** `asesor_lookup_nss_precal_gate` · `asesor_iniciar_reprecalificacion` · `editor_resolver_reprecalificacion` (también vía `upsert_editor_decision` si hay `reprecalificacion_pendiente_id`)

**Rol lookup/iniciar:** solo `asesor` autenticado (`auth.uid()` = dueño del expediente).
**Rol resolver:** `editor` | `super_admin`.

### Fuente de verdad
| Concepto | Dónde |
|---|---|
| Programa **vigente** | `expedientes.programa` |
| Programa **solicitado** (pendiente) | `expediente_precalificacion_intentos.programa_solicitado` |
| Monto **vigente** | `editor_decisions.monto_aprobado` |
| Aplicación del cambio de programa | Solo en `editor_resolver_reprecalificacion` cuando `decision = aprobado` (misma transacción que el monto) |

### Gate statuses
Universo del gate (P169): `organization_id` + NSS + `deleted_at IS NULL` + `ciclo_estado = 'activo'` — **sin** exigir `submitted_to_mesa`.

- `ok_create` — no hay expediente activo reutilizable → alta normal con `create_expediente`
- `reprecal_own_mesa` — dueño + **activo** (pre o post Mesa) + mismo programa → re-precal (nombre histórico; abarca pre-Mesa desde P169)
- `reprecal_change_programa` — dueño + **activo** + programa distinto → cambio diferido (P168); **no** crea otro expediente
- `blocked_other_asesor` — «…asignado a otro asesor.» (activo de otro, pre o post Mesa)
- `blocked_ambiguous` — >1 expediente activo para el NSS
- `blocked_programa_mismatch` — legacy P155 (el gate P168/P169 ya no lo emite para dueño elegible)

### Reglas
- Mismo `expediente_id`; no INSERT de expediente ni cliente duplicado.
- Historial en `expediente_precalificacion_intentos` (`programa` = vigente al iniciar; `programa_solicitado` = pedido; `es_vigente` = última aprobada aplicada).
- Mientras hay pendiente: **no** muta `expedientes.programa` ni `editor_decisions` vigentes; **no** muta `submitted_to_mesa` / `fecha_envio_mesa` / etapa / subestado / documentos / bookings / cliente_datos / cobro / retención / pagaré.
- **P185 (Editor UI, sin RPC):** dashboard `/editor` no precarga `editor_decisions` vigente en una re-precal pending (Pendiente + monto/notas vacíos). Tras resolver, la última revisión REAL se lee de `expediente_precalificacion_intentos` (batch SELECT por IDs de página; discriminador P183). `no_cumple` no pisa el vigente.
- **P186 B1B:** `/editor` pagina con `editor_list_expediente_ids_page` (orden RPC); pending autosave 750ms + resolve al salir de fila; restore draft del intento; refresh focus/visibility 8s. Timeline asesor: etapa 12 + `pagado` → Completado verde.
- Aprobado: actualiza `editor_decisions.monto_aprobado`; si `programa_solicitado` ≠ vigente, actualiza `expedientes.programa` en la misma RPC; conserva `aprobado_at` / `monto_aprobado_al_aprobar`.
- `no_cumple`: solo cierra el intento; no borra vigente ni cambia programa ni retrocede etapa.
- Idempotencia: `idempotency_key` por expediente + reuso de `reprecalificacion_pendiente_id` (actualiza `programa_solicitado` si cambia la solicitud).
- `action_log`: `asesor.reprecalificacion.iniciar` / `editor.reprecalificacion.aprobar|no_cumple` (metadata: `programa_vigente`/`programa_anterior`, `programa_solicitado`, `cambio_programa`; sin NSS completo).
- Enum `programa` intacto (`mejoravit` | `subcuenta` | `compro_tu_casa`).
- `nss_bloqueado_en_mesa` / `create_expediente` intactos para ajenos.
- `/asesor/nueva` (P181): si gate = `ok_create` → `create_expediente`. Si gate = own/change **del mismo asesor** → confirmación (no error) → revalida gate → `asesor_iniciar_reprecalificacion` sobre `expediente_id` del gate → redirect `/asesor/expediente/{id}`. `blocked_other_asesor` / ambiguous / mismatch: error, 0 create, 0 reprecal. P179 intacto (pre-Mesa ajeno → `ok_create`).
- UI detalle: CTAs en «Decisión del editor» sin exigir `submittedToMesa` (P169).
- Mig. **155** (base) + **168** (cambio de programa; feature P164) + **169** (gate pre-Mesa). UI: detalle asesor CTAs + Editor banner.

---

## 1quater. Auto-precalificar Infonavit + reintentos cron (P213/P214)

**HTTP create path:** `POST /api/precalificaciones/[id]/auto-precalificar`  
- Auth: Bearer JWT (asesor). Responde **202** `{ ok, status:"accepted", expediente_id }`; scraper en `after()`.  
- Job: `runAutoPrecalificarJob` (domain) → scraper `SCRAPER_*` → `auto_upsert_editor_decision` si mapeo conocido; siempre inserta `auto_precal_intentos`.

**Mapeo scraper → decisión:**
- `califica===true` + saldo → `aprobado`
- `califica===false` → `no_cumple` (`p_motivo` = `mensaje` keyword o fallback genérico)
- `success:false` + `razon=no_cumple_criterios` + `mensaje` string → `no_cumple` (`p_motivo` = mensaje exacto)
- resto → `pending_error` (sin mutar `editor_decisions`)

**Tabla:** `auto_precal_intentos` (mig **214**) — `expediente_id`, `intentado_en`, `resultado` ∈ `aprobado|no_cumple|pending_error`, `razon` nullable. Solo `service_role`.

**Cron:** `GET|POST /api/cron/reintentar-pendientes`  
- Auth: header `x-cron-secret: $CRON_SECRET` **o** `Authorization: Bearer $CRON_SECRET` (Vercel Cron). 401 si no coincide.  
- Candidatos: `editor_decisions.decision='pendiente'` **y** ≥1 fila `auto_precal_intentos` con `resultado='pending_error'` + `razon='scraper_failed'` (excluye backlog sin auto-precal y excluye solo-`ambiguous_payload`).  
- Excluye si total intentos ≥ 3 o último intento < 10 min.  
- Max **5** por run, **secuencial** (`await` en for; nunca `Promise.all`).  
- Schedule: `vercel.json` `*/5 * * * *` (chequeo; cooldown reintento sigue en 10 min).

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

## 1quater. Editor inbox page + borrador re-precal (P186 B1A)

**RPCs:** `editor_list_expediente_ids_page` · `editor_guardar_borrador_reprecalificacion`

**Roles:** `editor` | `super_admin` (`active=true`), org del actor. STABLE (list) / VOLATILE (draft). SECURITY DEFINER. GRANT `authenticated`. REVOKE PUBLIC/anon.

### List (IDs)

Preferencia: no duplicar `EXPEDIENTES_LIST_SELECT`. El RPC devuelve membership + `editor_activity_at` + `total_count`; el repo lee filas con el SELECT actual.

```json
{ "items": [{ "id": "uuid", "editor_activity_at": "timestamptz" }], "total_count": 123, "page": 1, "page_size": 50 }
```

- `editor_activity_at = COALESCE(intento_pending.created_at, e.created_at)`
- JOIN: `e.reprecalificacion_pendiente_id = intentos.id AND intento.expediente_id = e.id`
- `ORDER BY editor_activity_at DESC, e.id DESC` **antes** de OFFSET/LIMIT
- Search: misma semántica que `buildEditorListOrFilter` (cliente, tel, nss, programa, asesor email/nombre); `%`/`_` stripped
- Default page_size 50; max 100; `deleted_at IS NULL`; aislamiento `organization_id`

### Draft

Solo escribe `expediente_precalificacion_intentos.monto_aprobado` (NULL o >= 0) y `notas_revision` (`COALESCE(p_notas,'')`) del pointer pending (`decision='pendiente'`, `decided_at IS NULL`). No resuelve. No limpia pointer. No `editor_decisions`. No UPDATE `expedientes`. 0 `action_log` (excepción debounce vs auditoría genérica; la resolución canónica sí audita).

### UI B1B

`listForEditor` llama el RPC de IDs, SELECT por ids, reconstruye orden. Pending: debounce 750ms → draft RPC; al salir deliberadamente de la fila (relatedTarget fuera del `<tr>` con documento visible y `hasFocus`, o relatedTarget null tras settle con `activeElement` fuera de fila) → `upsert_editor_decision` si hay contenido. Window blur / visibility hidden no resuelven. Restore: `editorPendingDraftFromIntento`. Filas normales: autosave 750ms intacto.

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
    "direccionEmpresa": { "calle": "string", "colonia": "string", "municipio": "string", "cp": "string" },
    "notaMesa": "string (opcional; siempre se persiste en JSON datos, incluso vacío)"
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

**Hotfix 145:** si Mesa `mover_etapa` deja etapa 8 con `retencion_envios.estado=enviado` + principal válido, `repair_retencion_enviada_a_etapa_9` (y trigger BEFORE UPDATE) restaura etapa 9 sin tocar docs/bookings. UI no afirma «listo para agendar firma» si `etapa_actual < 9`.

Otros tipos Mesa (acta/SAT/semanas) conservan MIME PDF-only.

### 3quinquies. Notificación (`cliente_notificacion_apodaca`) — P104

**Separación:** distinto de `cliente_notificacion` (documento Mesa P092) y de `agenda_bookings.kind='notificacion'` (P070). Nunca reutilizar esos tipos.

**RPC:** `register_expediente_documento` (asesor propietario). Allowlist `integration_doc_tipos_asesor_opcionales()`. Migración local `095_cliente_notificacion_apodaca_opcional.sql` (sin Cloud en este bloque).

| Regla | Valor |
|-------|--------|
| Roles escritura | asesor dueño (+ roles ya autorizados en RPC) |
| Etapa mínima | ninguna (cualquier etapa del expediente) |
| MIME | PDF / JPEG / PNG (mig. **144**; sin WEBP/HEIC/GIF/SVG) |
| Tamaño | ≤ 15 728 640 bytes |
| Mesa | upload/reemplazo/eliminar + preview/descarga (`MesaNotificacionApodacaSection`, P136) |
| Gate avance / envío | **No** |
| Reingreso | sí, alineado a opcionales asesor (`reingreso_documentos_reutilizables`) |
| Obligatorio | **No** |

**UI:** label UI `Notificación` (badge Opcional; tipo interno `cliente_notificacion_apodaca`) en checklist Asesor (`AsesorIntegracionDocsUpload`) y Mesa (`MesaNotificacionApodacaSection`) en cualquier etapa/sede; formatos PDF/JPG/JPEG/PNG; misma versión activa compartida.

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
- Retención: asesor dueño puede reemplazar el archivo activo de Acuse/Aviso tras envío (sin exigir corrección Mesa); soft-delete deja una sola versión activa (`retencionDocPuedeReemplazarAsesor` + RPC `register_expediente_documento_retencion`). Mesa solo lectura Ver/Descargar del activo.

---

## 5. Enviar integración a Mesa

**Operación:** `POST /expedientes/{id}/enviar-mesa` · RPC `enviar_a_mesa(p_expediente_id uuid) → jsonb`

### Request

```json
{ "p_expediente_id": "uuid" }
```

No hay `docs_snapshot`: el RPC no recibe checklist ni payload de documentos.

### Response

```json
{
  "etapa_actual": 1,
  "subestado": "en_validacion_mesa",
  "submitted_to_mesa": true,
  "fecha_envio_mesa": "ISO"
}
```

### Reglas (B0D4 + P189 B3)

- Gate: monto editor > 0 + `cliente_datos` `completo|validado` + cobro + 4 docs integración (`cliente_ine_frente|reverso`, `cliente_comprobante_domicilio`, `cliente_estado_cuenta`) + NSS no bloqueado.
- RFC **no** es gate de envío.
- **NO** incrementar a etapa 2 (`etapaAlEnviarAMesaDesdeAsesor` → 1).
- `action_log`: `expediente.enviar_a_mesa`.
- P189 (solo `programa=mejoravit`): assert `datos.infonavit` persistidos **antes** del UPDATE; tras UPDATE, misma TX: 1 snapshot inmutable (`submission_version=0`, `kind=initial`) + 3 outbox `pending`. Otros programas: 0 filas P189.
- PDFs P189 **no** entran a `integration_doc_tipos_asesor_envio` ni al conteo de docs de etapa.

---

## 5bis. Reingreso manual a Mesa (mismo expediente)

**Operación:** UI Asesor «Enviar como reingreso» · RPC `asesor_enviar_reingreso_a_mesa(p_expediente_id)`
**Migraciones:** 142 (columnas + RPC inicial) · 143 (hotfix UI) · **152** (gates Datos Generales + docs + monto + domicilio **antes** de idempotencia 5s / CAS) · **184** (P189 snapshot/outbox Mejoravit)

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
  "fecha_envio_mesa": "ISO",
  "era_primer_envio": true
}
```

### Reglas

- Solo `asesor` dueño; expediente existente; no `deleted_at`; no `ciclo_estado = cancelado`.
- Contrato vigente **152**: exige monto editor > 0, `cliente_datos` `completo|validado` + cobro, `direccion_opcional`, 4 docs integración. **No** es el hotfix 143 “sin checklist”.
- UPDATE del mismo expediente: `submitted_to_mesa=true`, `fecha_envio_mesa=NOW()`, `etapa_actual=1`, `subestado=en_validacion_mesa`, incrementa `reingreso_manual_*` si `changed=true`.
- No INSERT expediente/precalificación; no toca docs/citas/`reingreso_rechazo_id` (P072).
- Idempotencia: mismo actor en ≤5s o CAS lost → `changed:false` **sin** snapshot/outbox P189.
- `changed=true` + Mejoravit: `submission_version = reingreso_manual_count` post-UPDATE, `kind=reingreso`, 1 snapshot + 3 outbox. Primer envío vía reingreso (`era_primer_envio=true`) usa version **1** (no se fuerza 0).
- `action_log.action = expediente_reingreso_mesa` (incluye `era_primer_envio`, etapas/subestados).
- UI: card «Reingreso a Mesa» arriba de Datos Generales; visible en todo expediente activo del dueño. Mejoravit con cambios sin guardar: bloquea envío/reingreso.

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
- **Cupo real (mig. 131):** una fila física del Sheet = una fila en `agenda_sheet_slot_inventory`. Obligatorio desde `2026-07-30` inclusive. Inventario stale si `MAX(observed_at)` por org+fecha es NULL o menor que `NOW() - 6 hours`. Asserts biométricos/firmas + claim `FOR UPDATE SKIP LOCKED` bloquean con `SIN_CUPO_REAL_EN_SHEET` si no hay fila `available` fresca. **Cron (mig. 132):** `agenda-sheet-reconcile-every-15m` refresca inventario vía Edge `agenda-sheet-reconcile` (Vault `agenda_sheet_project_url` + `agenda_sheet_worker_secret`). **P188 freshness (mig. 182, LOCAL):** cron `agenda-sheet-availability-refresh-every-2h` (`7 */2 * * *`, offset vs :00/:15/:30/:45) → `agenda-sheet-live-sync` `{mode:availability, scope:horizon}` (worker secret only). Horizonte `America/Monterrey` hoy..+60; 1× `listSheets` + `values.batchGet`; isolation por tab (upsert_failed no aborta el resto). HTTP 200 `outcome=all_success` / 207 `partial_success|all_tabs_failed`. Fail-closed 6h intacto. **No usa reconcile** (P170/P175 + aborto 17 AGOSTO). Rollback: `SELECT cron.unschedule('agenda-sheet-availability-refresh-every-2h');`. **Hotfix firmas 09:30 (mig. 157, local):** si el inventario trae horarios omitidos en `agenda_config.firmas.slots` / `capacity_by_time`, la UI los ofrece y `agenda_firmas_sync_slots_from_sheet_inventory` alinea config (sin hardcode de una sola hora).
- **Inbound ocupación manual (mig. 162):** Sheet = ocupación física. NSS|NOMBRE|ASESOR → `occupied_external` (sin `agenda_booking` falso). Webhook `sheet_webhook`+fingerprint. Edge `agenda-sheet-live-sync` refresca fecha/sede/kind antes de listar y `book_gate` antes de reservar. `available = physical_rows − occupied_in_sheet`. Sin HORA → `MANUAL_ENTRY_WITHOUT_SLOT`. Booking CRM ausente del Sheet no libera. Apps Script payload sin PII.
- **Firmas Apodaca / encabezado vacío:** el inventario no depende solo del literal `APODACA FIRMAS` en A1. Si A1 está vacío pero el layout es el bloque Apodaca (p.ej. 10:00/10:30 en filas 3–5 antes de `MONTERREY FIRMAS`), el parser rehidrata `location_id=apodaca`+`kind=firmas` (también vía hints por `sheet_row`). No mezcla con Monterrey. Webhook/live-sync/reconcile comparten `section-recovery`.
- **Resultados operativos Bernardo (mig. 165):** tabla `agenda_sheet_operational_results` (proyección reporting, **distinta** del inventario de cupo). Clasifica Sheet: biométricos E=`BIOMETRICOS`, notificación F=`NOTIFICACION`; **firmas F=`FIRMO`** (COMPLETED solo `FIRMO=SI`; G=`FIRMA` es info adicional, no requisito). Filas Firmas sin hora con identidad cuentan en reporting (slot_time null); no crean inventario. Notas `COMPLETO✔` / `FALTA ACUSE` **no** confirman firma. Webhook upserta proyección incluso con booking en P; Apps Script notifica ediciones E–I; reconcile backfill por pestaña. RPCs `bernardo_ops_summary` / `bernardo_ops_detail` (P180 mig **178**: KPI = `projection_status=CURRENT` AND `*_effective_result=COMPLETED_CURRENT`) (solo `super_admin`). Periodo = `booking_date` del tab (no `last_seen_at`). KPI cuenta solo `COMPLETED` (≠ `agenda_bookings.status=booked`).
- **Aplicación operativa Sheet → expediente (mig. 170 / P170):** columnas `notes_raw`, `last_applied_fingerprint`, `last_applied_at`, `apply_outcome`. RPC service_role-only `agenda_sheet_apply_operational_result`. Identidad P+Q+org+kind. Matriz bio→5 / bio+notif→8 (no 8→9) / firma→11 / rechazo `decision_source=google_sheet`. Edge: projection→apply; kill switch `GOOGLE_SHEETS_OPERATIONAL_APPLY_ENABLED` (default false) + `GOOGLE_SHEETS_OPERATIONAL_APPLY_FROM_DATE`.
- **Protección hora Sheet A (P174 B1 local):** columna A (HORA) es READ ONLY para filas existentes en booking_created/cancel/webhook/reconcile. Edición externa → `occupied_slot_time_changed` (auditoría; no muta `booking_time` ni A). Apply Edge pre-RPC: si A visible ≠ `sheet=` en R → `SKIPPED_TIME_IDENTITY_CONFLICT` (sin advance/reject/rollback). P172 `SKIPPED_CONTINGENCY` sigue en SQL cuando no hay skip Edge. Aliases/UI/disponibilidad sin cambio. P121 replacement: A = copia exacta de A histórica (`inspection.hora`). APPLY OFF.
- **P179 NSS bloqueo solo post-Mesa (LOCAL):** `asesor_lookup_nss_precal_gate` (mig **176**): `blocked_other_asesor` únicamente si existe activo con `submitted_to_mesa=true` de otro asesor. Pre-Mesa ajeno → `ok_create` (P049). Propio activo pre/post → `reprecal_*`. `blocked_ambiguous` solo con >1 post-Mesa. Sin Cloud.

- **P178 inscripción self-service (LOCAL→Cloud):** asesor dueño elegible post-biométricos agenda sin requirement previo; `book_inscripcion_extraordinaria` autocrea `source_type=asesor` en la misma TX; RPC read-only `agenda_inscripcion_asesor_eligibility`; Monterrey + 11:00; sin mutar etapa/`fecha_cita`. UI: Disponible / No disponible todavía. P170 OFF; P175 sheet/mesa intactos; P176/P174 intactos.

- **P177 UI tab Inscripción (LOCAL):** tercer tab en agenda asesor (Biométricos|Notificación|Inscripción); sin requirement = informativo; Monterrey-only; sin Cloud/Sheet/Edge.

- **P208 hard-cap diario Biométricos Monterrey (LOCAL):** tabla `agenda_daily_capacity_rules` (hoy `biometricos`+`monterrey`=15). Helpers `agenda_daily_capacity` / `agenda_daily_active_occupancy` / `agenda_daily_remaining` / `agenda_advisory_lock_daily_capacity`. Occupancy = `agenda_bookings.status=booked` + inventory `occupied_external|conflict` + `claimed|linked` huérfanos; **no** duplica linked/claimed con booking activo. Gate + claim `SIN_CUPO_DIA`. Availability JSON añade `daily_*` (superset). `book_biometricos` firma/RETURNS intactos. Firmas/Inscripción/Apodaca sin regla. 0 writers de citas. Mig **208**.

- **P176 hotfix disponibilidad:** `agenda_sheet_inventory_availability` vuelve a emitir `fresh/enforced/slots[]` (superset con capacity/available/occupied + inscripcion). Live-sync auth: `profiles.active` + roles reales. Sin cambiar aliases/horas/P170.

- **Inscripción extraordinaria (P175 B5.2 PROD):** Edge webhook+reconcile publican wiring B5.1; secrets `GOOGLE_SHEETS_INSCRIPCION_REQUIREMENTS_FROM_DATE=2026-08-13` + `ENABLED=true`; P170 OFF; sin auto-book; cutoff por booking_date.

- **Inscripción extraordinaria (P175 B5.1 LOCAL):** Edge reconcile/webhook, tras `agenda_sheet_ops_upsert_batch` OK, invocan `agenda_inscripcion_require_from_sheet` **antes** de P170 apply. Gate env fail-closed `GOOGLE_SHEETS_INSCRIPCION_REQUIREMENTS_ENABLED` + `FROM_DATE` (booking_date). Independiente de P170. Secrets productivos siguen OFF/ausentes. Sin Cloud deploy B5.1.

- **Inscripción extraordinaria (P175 B4 rollout):** mig **173** Cloud; sede Monterrey V1; cupo **3** filas físicas `A=11:00 AM` append-only debajo de APODACA BIOMETRICOS (+ contenido posterior); FORMATO + tabs futuras. Edge parser/inventory/worker. UI publicada. P170 APPLY OFF; `GOOGLE_SHEETS_INSCRIPCION_REQUIREMENTS_*` OFF. Sin backfill históricos / sin Apodaca inscripción / sin P172 kind / sin bulk P089.

- **Inscripción extraordinaria (P175 B2 UI LOCAL):** UI asesor (`AgendaInscripcionSupabaseCard`, campana `inscripcion_rebook_required`); Mesa solicitar + Citas (filtro/badge teal/cancel/reagendar; hora 11:00 AM fija; **sin** Drive ni bulk P089); Reporte del día KPI «Inscripciones» = bookings `kind=inscripcion` (no col F). Mig **173** sigue NO Cloud. Bloques Sheet NO creados → availability 0 manejado. Requirements automáticos OFF. P170 OFF.

- **Inscripción extraordinaria (P175 B1 LOCAL):** `booking_kind=inscripcion` (mig **173** local only). Hora fija `11:00` (sin aliases). Tabla `agenda_inscripcion_requerimientos` (una abierta/expediente). RPCs: `agenda_inscripcion_require_from_sheet` (service_role; gated env, no auto-activar), `mesa_solicitar_cita_inscripcion`, `book_inscripcion_extraordinaria`, `cancel_inscripcion_extraordinaria`, `reagendar_inscripcion_extraordinaria` (asesor dueño **o** Mesa visible). Claim atómico inventory `kind=inscripcion` + `sheet_slot_time=11:00`. No muta `fecha_cita` ni etapa. Detector col F `REAGENDA`+`INSCRIP` → `notification_result_class=PENDING` + `inscripcion_rebook_required`; P170 apply → `REQUIRES_INSCRIPCION_REBOOK` (sin rechazo). Parsers: `MONTERREY/APODACA INSCRIPCION`. Env-gate fail-closed `GOOGLE_SHEETS_INSCRIPCION_REQUIREMENTS_*`. P172 kind fuera de alcance B1/B2. Sin Cloud/Sheet/UI publicada.
- **Red veto operativo (mig. 172 / P173 B1 local):** proyección lee fondo efectivo E:I (`getEffectiveBackgrounds` / `effectiveFormat.backgroundColorStyle` + fallback `backgroundColor`). Flags `biometric_cell_red` / `notification_cell_red` / `signature_cell_red` / `operational_red_veto` (+ opcional `operational_red_columns` E–I). Criterio #FF0000 solo BACKGROUND (font rojo no cuenta). Fingerprint SQL/TS incluye flags `0|1`. Apply (partida POST-P172): `SKIPPED_CONTINGENCY` > textual FAILED > `COLOR_VETO` > positivos. `COLOR_VETO`: sin avance/rechazo/rollback; sí fingerprint + `apply_outcome`. Ops upsert no pisa `last_applied_*`/`apply_outcome`. Reconcile 1× formatos/tab (`E1:I200`); webhook 1× fila (`E{row}:I{row}`). Format-only → reconcile ~15m (sin Code.gs). Classifiers texto intactos. APPLY kill switch OFF; sync CRM→Sheets no tocado.
- **Contingencia extraordinaria (mig. 171 / P172 B1+B1.1+B2):** `agenda_contingencias` (kind `biometricos|firmas`, status `active|closed`, sede opcional) + snapshot `agenda_contingencia_citas` (`pending_rebook|rebooked|closed`) + `agenda_extraordinary_bookings` (sin inventory/capacity/outbox/Sheets). RPC Mesa `agenda_declarar_contingencia` (idempotente ACTIVE; rechaza vacío; 0 outbox). RPC asesor `asesor_agendar_cita_extraordinaria` (dueño; sin cupo; no cambia etapa). Tarea persistente `extraordinary_rebook_required` mientras `pending_rebook`. **B1.1:** helper `agenda_booking_has_contingency` (active|closed) → Apply P170 `SKIPPED_CONTINGENCY` permanente; trigger `agenda_bookings_guard_contingency_bu` + assert Drive → `BOOKING_UNDER_CONTINGENCY` (no cancel/reagenda/Drive normal). `closed` ≠ voided. Avance `avanzar_etapa_operativa` sin booking_id → sin bloqueo global expediente (UI B2). Helper reporting `agenda_ops_row_contingency_flag` → `CONTINGENCY`. Action log: `AGENDA_CONTINGENCY_DECLARED` / `AGENDA_EXTRAORDINARY_REBOOKED`. **B2 UI:** preview read-only `agenda_preview_contingencia` (mismo predicado que declarar); listados `mesa_list_agenda_contingencias` (+`rebooked_count`) / `mesa_list_contingencia_items` / `asesor_list_contingencia_expediente`; Mesa botón día único (kinds independientes, 2 RPC si ambos; sin bulk selection); badges + panel; Asesor campana Cloud (abrir campana ≠ resolver tarea) + `AgendaExtraordinaryRebookCard` (catálogo horarios, 0 capacity). SuperAdmin reusa `MesaAgendaCitasClient`. Sin Sheet write.
- **Alias horario (mig. 137):** `agenda_sheet_time_alias_defaults` (globales por `location_id`/`kind`) + `agenda_sheet_time_aliases` (override por org). Seed defaults: biometricos monterrey/apodaca `08:30`⇄`08:00`. Resolve: override org (activo→traduce; inactive→identidad) luego default. Inventario: `slot_time` = lógico; `sheet_slot_time` = A física. Identidad física canónica en `slot_key`: `kind|date|logical|location|sheet=HH:mm|sheetId=N|row=N`. Worker/webhook escriben solo B:D + O:U (`values.batchUpdate`); A read-only. Firmas/otros horarios sin alias. `anon`/`authenticated` no mutan aliases/defaults.

### RPCs internas
- `agenda_sheet_book_by_nss(...)` — reserva atómica + mapping + `action_log` `agenda.sheet.book`
- `agenda_sheet_claim_outbox` / `agenda_sheet_mark_outbox` — worker CRM→Sheets (claim recupera `processing` >10 min → `failed`/`dead`)
- `agenda_sheet_requeue_dead_sync(p_booking_id)` — reencola outbox `dead` de `booking_created` para bookings activos futuros; con `p_booking_id` también puede reencolar `booking_cancelled` si hay fila Sheet conocida (`service_role`); no muta bookings ni Sheets; sin `p_booking_id` no toca cancelaciones (anti-backfill)
- `agenda_booking_sheet_sync_status(p_booking_id)` — P200 read-model `PENDING`/`SYNCED`/`FAILED` (`authenticated` + `can_see_expediente`; roles asesor/Mesa/super_admin)
- `agenda_sheet_enqueue_cancel_cleanup(p_booking_id)` — encola `booking_cancelled_cleanup` idempotente para booking **cancelled** con evidencia CRM (`service_role`); no UPDATE de outbox histórico done; no muta bookings
- `agenda_sheet_mark_cancelled_cleared(p_booking_id)` — soft-delete `slot_links` + libera inventario tras limpieza Sheet
- `agenda_sheet_upsert_link_from_crm` — mapping tras escritura Sheet
- `agenda_sheet_inventory_availability(p_kind, p_date, p_location_id)` — read-model cupo real (`authenticated`); si enforced y not fresh → `{ ok:true, fresh:false, slots:[] }`; buckets por `slot_time` lógico (+ `sheet_slot_time` informativo)
- `agenda_sheet_inventory_upsert_batch(p_rows)` / `mark_linked` / `mark_conflict` — `service_role` only (anti-steal: no degradar claimed/linked con `booking_id`; **`sheet_title` exacto sin `btrim`** — pestañas tipo `03 AGOSTO `; persiste `sheet_slot_time`)
- `agenda_sheet_ops_upsert_batch(p_rows)` — `service_role` (mig. 165): proyección resultados operativos Sheet
- `bernardo_ops_summary(p_fecha_desde, p_fecha_hasta)` / `bernardo_ops_detail(p_metric, …)` — solo `super_admin` (Dashboard Bernardo; COMPLETED 1:1)
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
- **Reagenda (mig. 160 + histórico + P200):** RPCs `reagendar_*` siguen cancel+insert (un booking activo en Supabase). Outbox cancel captura `sheet_*` / `had_sheet_link` **antes** del release (trigger `z_agenda_sheet_inventory_release_au`). Create adjunta `prior_cancelled_booking_id`. Worker ordena cancel→create.
  - **Reagendo (no cancelación pura):** conserva B:D/G:N **y E/F** de la fila prior; `manual_result_conflict` **no** es terminal si hay create sibling/`reschedule_move`. Escribe `O=REAGENDADO` (canónico `RESCHEDULED_HISTORY`) y **conserva `P=prior_booking_uuid`**. Formato naranja UX; inserta 1 fila FREE debajo (misma hora A); relocaliza por UUID (P). Inventario histórico → `disabled`; replacement → `available`.
  - **Cancelación pura:** clear B:D+O:U (contrato 136); E/F con texto → `manual_result_conflict` → outbox `dead`.
  - Gate create: prior listo si outbox cancel done + sin link activo + Sheet no “owned activo” (`P=prior` con `O=REAGENDADO` cuenta limpio).
- `agenda_booking_sheet_sync_status(p_booking_id)` — read-model STABLE (mig. **200**): `PENDING`/`SYNCED`/`FAILED` + `sync_pending`/`sync_error`/`last_synced_at`. Asesor dueño, Mesa visible, `super_admin`. Sin payload outbox ni secretos.
- Título A1: resuelve título live por `sheetId` (`listSheets`) para conservar trailing spaces
- Confirmación: read-back A:U; si NSS/nombre/bookingId/source no coinciden → `failed` (`write_verify_failed`), no `done`
- **Cancelación (contrato 136):** conservar **A** y **G:N** sin escribirlos; limpiar solo **B:D** + **O:U** vía `values.batchClear`; no rewrite A:U; propiedad solo si `P=booking_id` y source crm; E/F con texto → `manual_result_conflict` → outbox `dead` (no retry); fila reutilizada (**P** distinto) → no tocar; no comparar `link.sync_version` vs U (stale tras CANCELADA); inventario `CANCELADA` → available aunque haya conflicto E/F; inventario `REAGENDADO`/`RESCHEDULED_HISTORY` → `disabled` (IGNORE_FOR_CAPACITY)
- Cancel sin evidencia Sheet → `done` no-op + `agenda_sheet_mark_cancelled_cleared`; con evidencia sin coords → `failed` `missing_sheet_coords_for_cancel`
- Worker admin read-only: `POST` body `{ dry_run_cancel_cleanup: true, targets: [...] }` clasifica con A:U live sin mutar
- **Reconcile dry-run (dominio):** `buildReconcileBookingReport` por CRM_BOOKING_ID (P) → `MATCHED` | `STALE_SHEET_ENTRY` | `DUPLICATE_SHEET_ENTRY` | `MISSING_SHEET_ENTRY` | `AMBIGUOUS`; `buildRepairPlan` solo stale/duplicate confirmados (nunca ambiguous). Repair **no** se ejecuta en prod sin autorización.
- Cron: mig. 130 job `agenda-sheet-sync-worker-every-minute` (`* * * * *`) vía Vault `agenda_sheet_project_url` + `agenda_sheet_worker_secret` (independiente del reconcile 132)

### Docs operativas
`integrations/google-sheets-agenda/README.md`

---

## 7bis. Vigencia documental 45 días — tramo 3–8 (P211 LOCAL)

**Objetivo:** mientras el expediente esté en etapas **3–8**, ciclo activo, `submitted_to_mesa`, y **sin** `vigencia_documental_liberada_at`, corre un reloj de 45 días naturales (`America/Monterrey`) desde la entrada al tramo (`<3 → 3..8`). Día 0..45 vigente; **>45** vencido.

**Columnas:** `vigencia_documental_started_at`, `vigencia_documental_liberada_at`, `vigencia_reingreso_completado_at` (nullable; auditoría).

**RO:** `expediente_vigencia_documental_estado(uuid)` — única autoridad runtime (no reconstruye historia).

**Assert:** `assert_expediente_vigencia_documental_ok(uuid)` → `VIGENCIA_DOCUMENTAL_REINGRESO_REQUERIDO` si vencido y faltan docs frescos (`cliente_comprobante_domicilio` + `cliente_estado_cuenta`, activos, `created_at` local ≥ primer día vencido). **No** exige `estatus_revision=validado`.

**Release sticky:** primera llegada `etapa_actual >= 9` setea `liberada_at`; Mesa `9→8` **no** reaplica P211 (`reason=already_released`).

**Gates forward (además del trigger clock/release):** `book_biometricos` (antes cupo P208), `agenda_sheet_book_by_nss` (rama biométricos), `avanzar_etapa_operativa` / `_pre_reingreso`, `register_expediente_documento_retencion` (antes side-effects 8→9), `repair_retencion_enviada_a_etapa_9`, `agenda_sheet_apply_operational_result` (avances 3→4/4→5/5→8).

**Mesa override:** `mesa_mover_etapa_operativa` **no** llama assert (sin GUC cliente-spoofable). Trigger solo mantiene clock/release.

**UI:** solo detalle asesor (header + panel «REINGRESO POR VIGENCIA»). No inbox. No crea expediente hijo / P198 / P210.

**Mig:** **211** (local; no Cloud en esta fase).

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

- UI asesor: `AgendaFirmasSupabaseCard` en etapa 9; en etapa 10 también con booking activo (reagendar/cancelar) o tras cancelación (re-agendar).
- **Hotfix post-Acuse:** `canShowFirmasManageActions` / `canShowAsesorFirmasSupabaseCard` alineados a RPC `reagendar_firmas` (etapas 9 y 10).
- UI Mesa: resumen cita + avance 9→10 en detalle Supabase (P3P.3).
- **P117:** en etapa 10, botón Mesa «Pasar a Firmado» → `avanzar_etapa_operativa` transición `10→11` (mismos gates de firma; no movimiento manual libre).
- **P119.4 / P166:** en etapa 11, Mesa decide **Sí pagó** / **No pagó** → RPC `decidir_pago_concasa` (11→12 + `pago_concasa_resultado`). No es rechazo; no muta citas/docs/montos. Ingresos P134 solo si `pagado`.

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

## 14A. Inbox asesor paginado + summary (B1.5 / P161)

**Equivalencia TS→SQL:** `docs/ASESOR_INBOX_B15_EQUIVALENCIA.md`
**Migración:** `161_asesor_inbox_page_summary.sql` (**aplicada en Cloud** `fvtqbxukqlajezyyvwzy`).
**Calibración pendientes (P167):** `167_asesor_pendientes_calibrados.sql` — `asesor_inbox_categoria_correccion` incluye docs `cliente_*` + Acuse/`retencion_envios`; `asesor_inbox_pendiente_agendar_biometricos` incluye reagendar en etapa 4/5 tras cancelación. Label UI chip/KPI: «Necesita corrección». Selector TS: `getAdvisorPrimaryPendingAction` / `listAsesorCorreccionesAbiertas`.
**P191 (LOCAL, no Cloud):** tareas accionables (`agendar_biometricos` / `agendar_firma` / `subir_acuse`) requieren `asesor_inbox_es_accionable` = `resultado_real NOT IN ('cancelado','rechazado_mesa')`. Lista y summary llaman los mismos `pendiente_*`. Cancelados / Rechazados por Mesa / corrección documental no cambian. Numeración: **191** = ese hotfix.
**Hotfix 192 (LOCAL, no Cloud):** `asesor_inbox_categoria_correccion` evalúa `expediente_tiene_correccion_asesor_pendiente` (lote P130 `pendiente_revision` + `submitted_at`) **antes** de DG/docs/acuse. Sin gate de etapa. Operación de citas → **193**.
**UI `/asesor`:** cableada a las RPCs (B1 UI). Sin fallback a `listForAsesor()`. Refetch al focus/visibility (debounce ≥8s).

### `asesor_list_expedientes_page(...) → jsonb`

| Campo | Semántica |
|---|---|
| `items` | Página (default 25, máx 100) |
| `total_count` | Total del **filtro actual** (puede >1000) |
| `page` / `page_size` / `has_more` | Paginación offset |

- Identidad: `current_profile_id()` = `auth.uid()`; solo `app_role=asesor` activo.
- Aislamiento: `expedientes.asesor_id = actor` y `deleted_at IS NULL`.
- Orden (P183, mig **180** local): `ORDER BY COALESCE(reprecal_activity_at, created_at) DESC, id DESC` **antes** de OFFSET/LIMIT. `reprecal_activity_at` sale de `expediente_precalificacion_intentos` (pending = `reprecalificacion_pendiente_id.created_at`; resuelto REAL = `decided_at`). **No** se ordena por `expedientes.updated_at`.
- Filtros de fecha `fecha_desde` / `fecha_hasta`: siguen usando **`e.created_at`** (P183 no cambia semántica histórica).
- Metadata additive (nullable): `reprecal_estado` (`pending`\|`approved`\|`no_cumple`), `reprecal_solicitada_at`, `reprecal_resuelta_at`, `reprecal_activity_at`, `reprecal_monto_previo`, `reprecal_monto_resultado`, `reprecal_programa_solicitado`. Ortogonal a `resultado_real` / `asesor_inbox_resultado_real`.
- Discriminador intento REAL: `decision_previa IS NOT NULL OR idempotency_key` (snapshot histórico de 1ª aprobación no cuenta).
- Filtros: buscar, decisión, subestado, resultado_real, programa (label UI), etapa, fechas MX, quick_filter (todos los chips actuales).
- SECURITY DEFINER; `REVOKE` PUBLIC/anon; `GRANT EXECUTE` authenticated.

### `asesor_inbox_summary(p_notif_limit DEFAULT 50) → jsonb`

| Campo | Semántica |
|---|---|
| `counts` | KPIs/chips globales del asesor (sin filtros de búsqueda) |
| `programas_unicos` | Distinct labels UI |
| `notifications` | Top N (default 50) para NotificationsBell |

Counts: `total`, `en_tramite`, `correccion_*`, `rechazados_mesa`, `cancelados`, `aprobados_editor`, `no_cumple`, `agendar_biometricos`, `agendar_firma`, `subir_acuse`.

`correccion_requerida` cuenta **expedientes** con ≥1 corrección Mesa abierta (datos / docs `cliente_*` / Acuse), no ítems duplicados.

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
- **Hotfix 192 (LOCAL):** `mesa_bandeja_categoria_resumen` antepone lote P130 `pendiente_revision` + `submitted_at` → `correccion_enviada` (prioridad sobre `correccion_requerida` / faltantes). Lista y `counts.correccionesEnviadas` heredan el helper. Sin duplicar predicado en `mesa_list_bandeja_page`. `mesa_bandeja_sort_ts` usa latest pending `submitted_at`. Legacy P102 (pack legado + timestamp DG) se conserva si no hay lote pendiente. Sin gate de etapa. Sin backfill.
- **P193 (LOCAL):** misma firma de `mesa_list_bandeja_page`. `p_quick_filter` extra (no overload): `correccion_solicitada` = parent ∧ origin `REQUESTED_CORRECTION`; `otras_actualizaciones` = parent ∧ origin ∈ {ADVISOR_UPDATE, AMBIGUOUS, LEGACY}. `correccion_enviada` sigue siendo el padre (todos los cambios por revisar). Helper STABLE `mesa_cambio_revision_clasificacion(expediente_id)` (sin persistir). Counts: `correccionesSolicitadas`, `otrasActualizaciones`; invariante `correccionesEnviadas = correccionesSolicitadas + otrasActualizaciones`. Items: `cambio_revision_origen`, `cambio_request_type`, `cambio_request_at` (sin PII / sin payload). Subfiltro en SQL **antes** de ORDER/CURSOR/LIMIT. `mesa_bandeja_categoria_resumen` no se toca. Operación de citas → mig **196**.

- **P194 (LOCAL):** extiende `mesa_list_asesor_cambios_summary` con `preview_changes` (máx 3: `tipo`, `campo`, `document_kind`, `label`, `has_old`, `has_new`, `source`; sin `valor_*`). `changes_count` físico intacto. Recover read-time solo si `changes_count=0` (`mesa_asesor_cambio_recover_empty_lote`, ventana `submitted_at -60s .. +10s`). Fuentes: `P130`, `HISTORY_RECOVERED`, `HISTORY_PARTIAL`, `HISTORY_NO_DIFF`. `mesa_get_asesor_cambio_lote` añade `recovered_changes`, `history_confidence`, `history_source`, `history_note`; filas P130 llevan `source=P130`. Labels read-time (`asesor_evidencia`, notificación/apodaca/carta, INE). 0 writers/backfill/tablas. Operación de citas → mig **196**.

- **P195 (LOCAL):** `p_ops_filter=sin_asignar` (chip Disponibles) exige `ciclo_estado=activo` ∧ `subestado IS DISTINCT FROM 'rechazado'` además de `assigned_to IS NULL` y no `correccion_requerida`. `activo+rechazado` sale de Disponibles y sigue en vista rápida Rechazados. Tras reactivar (`subestado≠rechazado`) vuelve a evaluarse con las reglas normales. `mi_bandeja` / `en_trabajo` / `todo_mesa` sin cambio de asignación. 0 writers. **Superado en el predicado de lista por P199** (el rechazo raw sin episodio pending sigue excluido). Operación de citas → mig **200**.

- **P198 (LOCAL):** `mesa_cambio_revision_estado_efectivo` + REPLACE `mesa_list_bandeja_page`. Filtros `correccion_enviada` / `correccion_solicitada` / `otras_actualizaciones` / `en_espera_asesor` por estado efectivo. Items: `cambio_revision_estado`, `cambio_actionable_at`, `cambio_batch_id`. Predicado `sin_asignar` **idéntico a P195 hasta P199**. 0 UPDATE de lotes. Operación de citas → mig **200**.

- **P199 (LOCAL):** helper `mesa_es_trabajo_accionable_mesa` + REPLACE `mesa_list_bandeja_page` `sin_asignar`. Disponibles = ciclo activo ∧ `assigned_to` NULL ∧ (estado_mesa NULL/`sin_asignar`) ∧ (P198 `CORRECTION_PENDING_REVIEW`/`ADVISOR_UPDATE_PENDING_REVIEW` **o** legado P195 sin `WAITING_ADVISOR`). P198 pending puede sobrescribir `subestado=rechazado`. `mesa_take_expediente` **no** cambia (Fase 0: 0 pending libres en `en_espera_asesor`). 0 tablas/columnas/backfill. Operación de citas → mig **200**. **Superado en membresía de lista por P206** (helper P199 intacto; assignment deja de filtrar).

- **P207 (LOCAL):** REPLACE `mesa_list_bandeja_page` rama `sin_asignar`. Disponibles = ciclo activo ∧ (`CORRECTION_PENDING_REVIEW` ∨ (Nuevos en Mesa ∧ no `WAITING_ADVISOR` ∧ categoria ≠ `correccion_requerida`)). **Sin** `assigned_to` / `estado_mesa`. **No** usa `mesa_es_trabajo_accionable_mesa`. Quick filters / P205 counts / P198 / P199 / take/release intactos. 0 writers. Mig **207**.

- **P206 (LOCAL):** REPLACE `mesa_list_bandeja_page` solo rama `p_ops_filter=sin_asignar` (chip Disponibles). Membresía = `ciclo_estado=activo` ∧ `mesa_es_trabajo_accionable_mesa(...)` — **sin** `assigned_to` / `estado_mesa`. Assignment sigue en payload (badges). `mi_bandeja` / `en_trabajo` / `en_espera_asesor` / `todo_mesa` / quick filters / P205 `mesa_bandeja_counts_fast` / take/release / helper P199 **intactos**. 0 writers / 0 backfill. Mig **206**. **Superado en membresía de Disponibles por P207**.

- **P201 (LOCAL):** REPLACE `asesor_inbox_estado_efectivo` consume `mesa_cambio_revision_estado_efectivo` (P198). `CORRECTION_PENDING_REVIEW` → `correccion_enviada`; `WAITING_ADVISOR` → `correccion_requerida`; retención abierta (`asesor_inbox_retencion_correccion_abierta`) → `correccion_requerida`; `CLOSED`/`ADVISOR_UPDATE` → resultado normal (sin `OR categoria_correccion`). List/summary intactos (ya filtran por `estado_efectivo`). 0 writers. **Superado en la regla temporal por P202.**

- **P202 (LOCAL):** mig **202**. Helper `mesa_cambio_episodio_latest`: `latest_request_at` = solicitud Mesa **vigente** (DG/doc/ops abierta del ciclo); `latest_response_at` = último lote P130 del ciclo. WAITING solo si `request` existe y (`response` null o `request > response`). PENDING si respuesta posterior sin cierre. Ignora lotes/solicitudes pre-`fecha_envio_mesa`. REPLACE `mesa_cambio_tiene_solicitud_posterior`, `mesa_cambio_revision_clasificacion`, `mesa_cambio_revision_estado_efectivo`, `asesor_inbox_estado_efectivo`. UI badges: Necesita→«Pendiente de corregir»; Enviada→«Enviada a Mesa». 0 writers.

- **P204-A:** mig **203**. REPLACE `asesor_inbox_estado_efectivo`: `WAITING_ADVISOR` + `request_type=RECHAZO_OPERATIVO_CON_CORRECCION` → `rechazado_mesa` (no `correccion_requerida`). DG/DOC WAITING → Necesita; PENDING_REVIEW → Enviada. P198 Mesa / Disponibles / writers intactos. 0 UPDATE negocio.

- **P203 (LOCAL, 0 SQL):** performance SAFE. `mesa_list_bandeja_page` first paint con `p_include_counts=false`; counts en petición aparte race-safe (misma semántica de chips). Asesor: `listAsesorInboxPage` en page/chip sin `getAsesorInboxSummary`; summary single-flight + TTL focus 45s (mutation/initial sí refrescan). Enrich batch REST: `listResumenBatchByExpedienteIds`, `listAsesorAgendaHintsByExpedienteIds`, `listRetencionHintsByExpedienteIds` + `Promise.allSettled` post-paint. **No** cambia filtros/counts/estado_efectivo/writers. Mig **203** sigue reservada a operación de citas.
- **P205-B1 (LOCAL):** RPC `mesa_bandeja_counts_fast(p_today_ymd, p_origen) → jsonb` — **solo** el objeto `counts` (13 campos), misma semántica que `mesa_list_bandeja_page` con `include_counts=true` (actor/`can_see` + origen + today; **no** quick/ops/buscar/etapa/cursor). CTEs `MATERIALIZED`: `categoria` + P198 1×/expediente. FE `getMesaBandejaCounts`; fallback **solo** PGRST202 → list limit=1 includeCounts. List/`includeCounts=false` y P198/P199/P204-D intactos. Mig **205**. 0 writers.

- **P197 (LOCAL):** `asesor_inbox_estado_efectivo(expediente_id)` + flags de episodio. `asesor_list_expedientes_page` / `asesor_inbox_summary` filtran y cuentan por estado efectivo (no por `categoria_correccion` ni `resultado_real` crudos). `categoria_correccion` sigue en items (columna Documentación). **P197-B3:** el detalle asesor lee el mismo helper (fail-soft si Cloud <197). No toca `mesa_list_bandeja_page` ni writers. **Superado en la prioridad del episodio por P201.** Operación de citas → mig **199** (198 = P198 Mesa).

- **P196 (LOCAL):** REPLACE `mesa_cambio_revision_clasificacion`. `REQUESTED_CORRECTION` solo si existe solicitud Mesa abierta del ciclo (`fecha_envio_mesa`) con `request_at < L.submitted_at` y **no** hay otro lote P130 con `submitted_at` entre R y L (L = primer reenvío). Si no, `ADVISOR_UPDATE`. `AMBIGUOUS`/`LEGACY` igual que P193. No toca `mesa_list_bandeja_page`, Disponibles, P192, mark-revisado ni writers. Operación de citas → mig **197**.

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

**Hotfix 192:** el chip Mesa «Correcciones listas para revisar» y el KPI asesor «Corrección enviada» usan `expediente_tiene_correccion_asesor_pendiente`. `mesa_marcar_asesor_cambios_revisados` no cambia; al pasar a `revisado` el expediente sale solo del predicado.

---

## 15. Admin KPIs / Producción (P081–P082)

**Operación:** RPCs read-only `admin_get_production_summary`, `admin_get_mesa_cohort_by_etapa`, `admin_list_production_by_asesor`, `admin_list_mesa_envios_page`, `admin_list_precalificaciones_page`

### 15-quinquies. Snapshot stock vigente por etapa (Admin)

**Operación:** RPCs RO `admin_expedientes_snapshot_etapas(p_asesor_id, p_estado, p_buscar)` y `admin_list_expedientes_snapshot_page(p_page, p_page_size, p_asesor_id, p_etapa_actual, p_estado, p_buscar)` — migraciones `147_…sql` + `148_…sql`.

**Auth:** solo `super_admin` (`__admin_require_super_admin`); `SECURITY DEFINER` + `STABLE`; GRANT `authenticated`; REVOKE `anon`/`PUBLIC`.

**Universo:** `deleted_at IS NULL`; **sin** filtro de fechas de periodo. **Integración (etapa 1):** solo si `submitted_to_mesa = TRUE` AND `fecha_envio_mesa IS NOT NULL` (misma definición que el KPI «Expedientes enviados a Mesa», sin rango). Etapas ≥2: sin filtro adicional de envío. Pre-Mesa fuera de tarjetas, `total_actual` y drilldown. Filtros opcionales: asesor, estado (mismos predicados P094), búsqueda (cliente/NSS/asesor/programa; mig **177**). Etapa solo en el listado (drilldown); el agregado de tarjetas **no** recibe etapa.

**Response snapshot:** `{ total_actual, by_etapa[1..12], by_paso_visual[1..11], generated_at }`. `total_actual` = suma de conteos de tarjetas. Legacy interna 4 se refleja en `by_etapa` y se absorbe en paso visual 3.

**UI `/admin`:** sección «Estado actual de los expedientes enviados a Mesa» + listado «Expedientes del flujo operativo de Mesa»; independiente de Hoy/semana/mes. KPI superiores y Excel siguen en universo por periodo (`fecha_envio_mesa`).

### 15-novies. Localizador Admin cliente/NSS (P182)

**Operación:** RPC read-only `admin_search_cliente_expedientes(p_buscar TEXT, p_limit INTEGER DEFAULT 20, p_asesor_id UUID DEFAULT NULL)` — migración **179** (local B1; no Cloud).

**Auth:** `super_admin` vía `__admin_require_super_admin()`; `SECURITY DEFINER` + `STABLE` + `search_path=public`; GRANT `authenticated`; REVOKE `anon`/`PUBLIC`. Org = `profiles.organization_id` del actor.

**Universo:** `public.expedientes` de la org; `deleted_at IS NULL`; **incluye pre-Mesa y post-Mesa**; **sin** `p_from`/`p_to`; **sin** exigir `submitted_to_mesa`. Identidad = `expediente_id` (no `GROUP BY` NSS; P179: mismo NSS + dos asesores pre-Mesa = 2 filas). Orden: `updated_at DESC, created_at DESC, id DESC`.

**Match:** `cliente_nombre`, `nss`, `profiles.full_name`/`email`, `programa` ILIKE. Si el input tiene ≥3 dígitos, también match por dígitos de NSS (espacios/guiones). `p_asesor_id` opcional. Vacío → `{items:[], truncated:false}`. Limit clamp 1..50 (default 20); `truncated` si hay más.

**Joins:** `editor_decisions` (1:1); `expediente_precalificacion_intentos` **solo** `i.id = e.reprecalificacion_pendiente_id`. No existe tabla `precalificaciones`.

**Response item:** `expediente_id`, cliente/NSS, asesor, programa, timestamps, ciclo/etapa/subestado, `submitted_to_mesa`/`fecha_envio_mesa`, `editor_decision`/`monto_aprobado`/`aprobado_at`/`no_cumple_at`, `reprecalificacion_pendiente_id`/`precal_pending`/`programa_solicitado`.

**UI `/admin` pestaña Resumen:** con `buscarDebounced` no vacío, sección «Resultados de búsqueda» **antes** de KPIs («Resumen del periodo»). Debounce 300 ms; última request gana. CTA «Abrir expediente» = panel con datos del RPC (no `AdminExpedienteDrawer` Mesa). P177 `p_buscar` de listados/KPIs **sin cambio de semántica**.

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

**Admin proyección etapa 10 (solo UI):** `admin-visible-stages` — 10 pasos; Paso 8 «Listo para agendar firma»→`[9,10]`; sin tarjeta/select «Cita para firma». 0 SQL/RPC.

**Admin Producción Expand (solo UI):** Expandir asesor → `listMesaEnviosPage` on-demand con `asesorId` + `etapaActuales` del paso Admin; métrica primaria = stageCount si hay filtro de etapa. Sin RPC nuevo.

### 15-quater. Reporte v3 + tipo de fecha (P116)

**Operación:** RPC read-only `admin_report_expedientes_asesores_etapas_v3(..., p_tipo_fecha TEXT DEFAULT 'envio_mesa', p_fecha_desde, p_fecha_hasta)` — migración `101_…sql`. P112/P114 intactas.

**`p_tipo_fecha`:** `envio_mesa` → `expedientes.fecha_envio_mesa` (default, reportes históricos); `entrada_paso_actual` → semántica P114. Fechas calendario `America/Monterrey`. Meta incluye `tipo_fecha`, `sin_fecha_canonica`, `excluidos_por_fecha_desconocida`. Detalle incluye `fecha_envio_mesa` y `fecha_entrada_paso_actual`.

### 15-octies. Desglose por asesor + NSS completo (P154)

**Operación:** `CREATE OR REPLACE` de `admin_stage_cohort_outcome_summary` / `_page` — migración `154_admin_stage_cohort_asesor_detail.sql`.

**Summary:** cada etapa incluye `por_asesor[]` (`asesor_id`, nombre, email, conteos). Suma por asesor = `entered_count` de la etapa.

**Page:** `p_resultado` ∈ `entered|advanced|stayed|incident|undetermined`. NSS **completo** (sin máscara) solo Super Admin; `nss_completo: true`; `asesor_email`; audita `action_log` `admin.stage_cohort_outcome_detail`. Función page **VOLATILE**.

**UI/Excel:** celdas del desglose clicables; hoja «Desglose por asesor»; detalle con NSS texto + filtros auto.

### 15-septies. Resultado de cohorte por etapa (P153)

**Operación:** RPCs read-only `admin_stage_cohort_outcome_summary(...)` y `admin_stage_cohort_outcome_page(...)` — migración `153_admin_stage_cohort_outcomes.sql`. Fuente exclusiva: `expediente_paso_visual_transiciones`. No altera P149.

**Auth:** solo `super_admin`; `SECURITY DEFINER` + `STABLE`; GRANT `authenticated`; REVOKE `anon`/`PUBLIC`.

**Cohorte:** visitas con `fecha_entrada` en `[p_fecha_desde, p_fecha_hasta]` inclusivo (`America/Monterrey`). Cobertura documentada desde `2026-07-23`.

**Clasificación al cierre (mutuamente excluyente):** `advanced` = salió antes de `to_excl` y `next_paso > paso`; `stayed` = sin salida o salida ≥ `to_excl`; `incident` = salió en periodo sin avance normal; `undetermined` residual. Cuadre: entraron = advanced+stayed+incident+undetermined.

**Summary por etapa:** `entered_count`, `advanced_count`, `stayed_count`, `incident_count`, `undetermined_count`, `advance_rate`, `stayed_rate`, `avg/median_advance_duration_seconds`, `history_coverage_from`.

**Page:** `p_resultado` ∈ advanced|stayed|incident|undetermined; `p_limit`/`p_offset`. Items incluyen `situacion_actual` (sigue_en_etapa|avanzo_despues|…).

**UI:** sección debajo del resumen P149; Excel hojas «Resultado por etapa» + «Detalle de resultados».

### 15-sexies. Reporte histórico de etapas (P149 → P163)

**Operación:** RPCs read-only `admin_stage_history_report_summary(...)` y `admin_stage_history_report_page(...)` — migraciones `149` + calibración `163_admin_stage_history_calibrated.sql`. Fuente: `expediente_paso_visual_transiciones` (cobertura confiable desde 2026-07-23; sin backfill). Snapshot 147/148 y cohorte 153/154 intactos.

**Auth:** solo `super_admin`; SECURITY DEFINER + STABLE.

**Timezone:** `America/Monterrey` semiabierto `[desde 00:00, hasta+1 00:00)`.

**`p_movimiento`:** `entrada` (`fecha_entrada` ∈ rango) | `avance` (`exited_at` ∈ rango y `next_paso > paso`; KPI movimientos = advanced_count del filtro; retroceso no cuenta) | `estuvieron` (intersección intervalo∩rango) | `estado_actual` (snapshot; fechas ignoradas; items con `visita_id`/`paso_visual`/`paso_nombre`).

**Asesor:** propietario **actual** (`asesor_fuente='actual'`).

**UI/Excel:** definiciones; unicos vs movimientos; advertencia si rango < 2026-07-23; Excel hoja Consulta + mismo dataset.

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
- **P108A / P099 / P204-C (UI Mesa):** tarjeta «Rechazar expediente» en los 11 pasos visibles; formulario solo motivo (select + «Otro») y nota opcional; payload biométrico interno `desconocida` + nulls. Cancelación terminal: tarjeta roja «Cancelar trámite». Asesor: chip/filtro `Rechazados` + banner persistente «Expediente rechazado por Mesa» + CTA «Reenviar a Mesa» (`reactivar_expediente_rechazado`); con cambios post-rechazo: «Cambios guardados · Falta reenviar a Mesa» (nunca «Corrección enviada» si el rechazo sigue abierto). Mesa detalle: banner «Rechazo operativo abierto» + CTA «Reactivar expediente» (mismo writer). No auto-reactivar al guardar/validar docs.

### Reactivación + avance/manual Mesa — P204-D

**Operación:** RPC `mesa_avanzar_etapa_reactivando_si_necesario(p_expediente_id uuid, p_comentario text default null) → jsonb`
**Migración:** `204_mesa_advance_and_manual_from_rejection.sql`

- Solo roles Mesa (`mesa_admin|mesa_interno|mesa_externo|super_admin`).
- Si `subestado=rechazado` con rechazo abierto: llama `reactivar_expediente_rechazado` y luego `avanzar_etapa_operativa` en la **misma transacción** (rollback atómico si el avance falla).
- Si no hay rechazo abierto: solo delega a `avanzar_etapa_operativa` (gates normales intactos).
- UI Mesa detalle usa este RPC vía `avanzarEtapaOperativa` (Supabase repo).

**Movimiento manual:** `mesa_mover_etapa_operativa` acepta `rechazado` como override: reactiva canónicamente + mueve sin gates de flujo (docs/P198/citas/etc.). Conserva auth, visibilidad, ciclo activo, enviado a Mesa, destino válido, motivo.

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

### Primer alta de Datos Generales en reingreso (mig. 151)

Si el expediente ya está enviado a Mesa y **no** existe fila `cliente_datos`:

| Contexto | Regla |
|----------|--------|
| Reingreso activo (`es_reingreso_asesor_edicion_activa`) | `save_cliente_datos_correccion` crea la fila (INSERT) vía `save_cliente_datos` con flag post_mesa |
| Sin reingreso activo | Conserva error «faltan datos del cliente» |
| `asesor_enviar_reingreso_a_mesa` | Exige Datos Generales completos + docs integración; no incrementa `reingreso_manual_count` si falla; idempotencia 5s |

FE: post-Mesa siempre usa corrección (aunque aún no haya fila); UI lista pendientes exactos antes del envío.

### Documentos y Datos Generales en reingreso activo (mig. 150; amplía 146)

Tipos asesor: `integration_doc_tipos_asesor_upload()` (INE frente/reverso, domicilio, estado de cuenta, opcionales de integración, etc.). **No** abre tipos Mesa-only (p. ej. `cliente_acta_nacimiento`, `cliente_constancia_sat`, Pagaré, Solicitud).

| Contexto | Regla |
|----------|--------|
| P072 hijo válido (`es_reingreso_post_biometricos_valido`, etapa 6) | Asesor dueño: Datos Generales + subir/reemplazar todos los docs de `integration_doc_tipos_asesor_upload` |
| Reingreso manual (`reingreso_manual_count > 0` **y** `etapa_actual = 1`) | Igual sobre el mismo expediente |
| Tras avance Mesa (manual sale de etapa 1; P072 sale de etapa 6) | Se cierran permisos ampliados; quedan reglas post-Mesa normales (reemplazo si existe, opcionales faltantes, rechazados) |
| Expediente normal sin reingreso activo | Conserva reglas post-Mesa previas |

Helpers SQL: `es_reingreso_asesor_edicion_activa`, `es_reingreso_manual_docs_editables` (con cierre etapa 1), alias `es_reingreso_docs_domicilio_estado_cuenta`. RPC `register_expediente_documento` + storage `expediente_documento_storage_asesor_post_mesa_upload_allowed`. FE: `esReingresoDocumentosEditables` / `esReingresoDatosEditables`. Versionado soft-delete; una versión activa; `action_log`; no cambia etapa ni padre.

### Documentos domicilio / estado de cuenta en reingreso (hotfix 146)

Superseded por mig. **150** (mismos tipos siguen cubiertos dentro de la allowlist asesor completa).

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

## 19. P189 B1 — PDFs Infonavit fill/flatten (LOCAL, sin RPC)

Motor puro: `supabase/functions/_shared/infonavit-pdf/`.

**API**

```ts
generateInfonavitPdf({
  documentType: 'carta_bajo_protesta' | 'presupuesto_mejoramiento' | 'solicitud_inscripcion_credito',
  templateBytes: Uint8Array,
  snapshot: InfonavitPdfSnapshotInput, // semántica; no CRM
}): Promise<Uint8Array>
```

**Templates v1** (`infonavit-templates/v1/`, SHA256 exacto B0):

| file | SHA256 |
|---|---|
| carta-bajo-protesta.pdf | `bfff2e484c…7689ea4` |
| presupuesto-mejoramiento.pdf | `8402f7e6ca…2d3e0581` |
| solicitud-inscripcion-credito.pdf | `f091c744a3…a55d90a6` |

Fail-safe: SHA / pageCount / field names+types → `INFONAVIT_TEMPLATE_CONTRACT_MISMATCH` (sin PII). Overflow texto → `INFONAVIT_TEXT_OVERFLOW` (meta: documentType, semanticField, maxLines).

Pipeline: load → verify contract → reset defaults → fill (nombres AcroForm) → appearances → flatten → 0 campos editables.

**Fuera de B1:** snapshot table, outbox, Edge Function, Storage, `enviar_a_mesa`. (B2.1 usó mig **183** para unicidad teléfonos; snapshot queda **184+**.)

## 19bis. P189 B2 — Datos Generales estructurados Infonavit (LOCAL)

JSON `cliente_datos.datos.infonavit` (`schemaVersion: 1`), solo `programa=mejoravit`.

RPC `save_cliente_datos` / `save_cliente_datos_correccion`: **sin migration** — `p_datos` JSONB flexible (mig 151) preserva keys extra. El mapper FE incluye `infonavit` en `p_datos`.

No se exige `datos.infonavit` a rows legacy. Completitud UI P189 es previa al RPC; el gate SQL de envío/reingreso (B3) es la autoridad.

`presupuestoEstimado` ≠ `montoMejoravit`. `nombreCliente` / `referencias[].nombre` / `beneficiario.nombre` / `direccion_opcional` se derivan al guardar; no se parsea legacy.

Unicidad teléfonos intra-expediente: celular cliente, tel empresa, ref1/ref2 celular, ref1/ref2 LADA+teléfono.

**P189 B2.1 (SQL):** helper `cliente_datos_assert_telefonos_unicos` en `save_cliente_datos` (mig **183**). `save_cliente_datos_correccion` delega al mismo save. Error `CLIENTE_DATOS_TELEFONO_DUPLICADO` (sin PII). Parciales incompletos no cuentan. El mismo número **sí** puede existir en otro expediente (P098). No toca `enviar_a_mesa`.

## 19ter. P189 B3 — Snapshot inmutable + outbox transaccional (LOCAL)

**Migración:** `184_infonavit_submission_snapshot_outbox.sql` (NO Cloud apply). No modifica **183**.

Tras envío/reingreso **exitoso** Mejoravit, **misma TX**:

1. `expediente_infonavit_submission_snapshots` (PII solo en `payload` JSONB; RLS FORCE; authenticated sin privilegio; trigger `INFONAVIT_SNAPSHOT_IMMUTABLE` en UPDATE/DELETE).
2. `infonavit_pdf_outbox` exactamente 3 filas `pending` (`infonavit_carta_bajo_protesta`, `infonavit_presupuesto_mejoramiento`, `infonavit_solicitud_inscripcion`). UNIQUE `(expediente_id, document_type, submission_version, template_version, snapshot_hash)`.

Helper `enqueue_infonavit_pdf_submission` (no-op si `programa ≠ mejoravit`). Completitud v1: `mejoravit_infonavit_datos_persistidos_diagnostico` / `assert_*` wrapper. `credito.plazoAnios` (años 1–10; no `plazoMeses`). Plazo fuera de 1–10 → `plazoAnios` null + `mappingWarnings` incluye `plazo_invalido` (no se traga el valor). **P189 mappingVersion=2 FINAL (mig 189):** `credito.montoSolicitado` y `mejora.presupuestoEstimado` = `resolve_monto_operativo_mejoravit` (Monto Mejoravit: `monto_mejoravit_actualizado` → JSON `montoMejoravit` → fallback editor −11%/169k). **NO** usa `editor_decisions.monto_aprobado` como autoridad del PDF. Nombre titular: `datos.nombreCliente` o `expedientes.cliente_nombre`, partido solo para impresión (`parseNombrePersonaMx`). Referencias/beneficiario igual; celular de refs no se copia a teléfono fijo. Vivienda: `expedientes.direccion_opcional` via `infonavit_parse_direccion_mx` **paridad TS** (`parseDireccionMxParaSolicitud`, mig **190**): colonia corta ante C.P./CP/CP5/INT/LOTE/MZ/entidad; `#` no se pega a calle; entidad solo con NL/N.L./NUEVO LEÓN; `direccionCompleta` = raw. `schemaVersion` sigue 1; `mappingVersion` sigue 2; `template_version` sigue `v1`. Snapshots existentes inmutables. `fechaDocumento` = `(fecha_envio_mesa AT TIME ZONE 'America/Monterrey')::date`. Si `datos.nss` y `expedientes.nss` (dígitos) divergen → `INFONAVIT_NSS_MISMATCH` **solo** cuando P189 required/enqueue.

**P189 mig 190 (parser dirección, LOCAL, no Cloud):** `CREATE OR REPLACE` de `infonavit_parse_direccion_mx` + `vivienda.lote`/`manzana` desde el parser. Firma `(p_raw text) → jsonb` intacta. Numeración: **189** = mapping v2; **190** = parser parity. 0 regeneración de históricos en este bloque.

**P189 B7 (misma 184, SHA deliberadamente nuevo):** Vault `p189_infonavit_enqueue_enabled` + `p189_infonavit_activation_at` (valores **fuera** de la migration). `p189_infonavit_feature_enabled()` DEFAULT OFF (true solo si enabled=`true` ci/trim + activation parseable + `now() >= activation`). Elegibilidad `expedientes.created_at` vs activation: **nuevo** (`created_at >= activation`) required; **legacy** fail-open (enqueue solo si v1 completo). Kill switch = enabled ≠ true (0 assert/enqueue, sin revertir funciones). Completitud FE: `requireInfonavit` solo si `status.required`. PGRST202 → feature OFF / B5 `has_submission=false`. **B7.1:** UI P189 (`AsesorInfonavitDatosGeneralesFields`) solo si `required` o legacy ON con v1 capturado; FLAG OFF / legacy sin v1 = layout pre-P189.

**RPC** `get_p189_infonavit_feature_status(p_expediente_id uuid) → jsonb`

Read-only UI. SQL sigue siendo autoridad del envío. No expone Vault, `activation_at`, snapshot ni PII.

- Auth: `auth.uid()` + perfil activo + `can_see_expediente`. Asesor dueño; Mesa vía visibilidad. `anon` sin EXECUTE. Asesor ajeno / otra org → `42501`.
- Return: `{aplica, feature_active, legacy, required, has_complete_v1}`.
- Frontend: si PostgREST `PGRST202` / function not found → tratar como `feature_active=false`, `required=false`. No silenciar 401/403/42501/red.

B3 **no** genera PDF, Storage, Edge, claim, ni `expediente_documentos` finales.

**Fuera de B2:** generateInfonavitPdf, Edge, Storage, Mesa botones PDF.

## 19quater. P189 B4 — Worker PDF + Storage + registro documental (LOCAL)

**Migración:** `185_infonavit_pdf_worker_contract.sql` (NO Cloud apply). 183/184 intactas.

Invocación **manual** (`POST` Edge `infonavit-pdf-worker`). Sin cron / pg_net / Vault / scheduler (B4.1).

**Auth:** header `x-concasa-worker-secret` vs env `INFONAVIT_PDF_WORKER_SECRET` (secret propio; no agenda/P188). `verify_jwt=false` → validar secret **antes** de body/DB/Storage. 401 → 0 I/O.

**Body:** `{ "outbox_id": "<uuid>" }` o `{}` (claim batch ≤3). Verdad solo en DB. Sin payload/PII en HTTP.

**RPCs** (SECURITY DEFINER, EXECUTE solo `postgres`/`service_role`):

| RPC | Rol |
|---|---|
| `infonavit_pdf_claim_outbox(p_outbox_id, p_limit)` | SKIP LOCKED. `pending∧available_at≤now` o `processing` stale (lease 10 min). `attempts+1`. Return **sin** payload. |
| `infonavit_pdf_load_claimed_job(p_outbox_id)` | Payload + hash server-side (`digest(payload::text)` = B3). |
| `infonavit_pdf_fail_outbox(..., p_retryable, p_lease_started_at)` | Backoff 1/5/15/30 min. Códigos allowlist. Lease mismatch → `lease_lost`. |
| `infonavit_pdf_complete_outbox(p_outbox_id, p_storage_path, p_mime, p_size)` | Path **derivado** `{org}/{exp}/{tipo}/{outbox_id}.pdf`. Versionado + unique activo. Out-of-order: si existe outbox `done` con `submission_version` mayor, el PDF viejo entra histórico (`deleted_at`). Idempotente `already_done`. `estatus_revision=subido`, `uploaded_by_role=sistema`. |

**Storage:** bucket `expediente-documentos`, upsert al mismo path (retry). Filename = outbox UUID. Display: `Carta Bajo Protesta.pdf` / `Presupuesto de Mejoramiento.pdf` / `Solicitud de Inscripción de Crédito.pdf`.

**Mapping DB→B1:** `infonavit_carta_bajo_protesta`→`carta_bajo_protesta`; `infonavit_presupuesto_mejoramiento`→`presupuesto_mejoramiento`; `infonavit_solicitud_inscripcion`→`solicitud_inscripcion_credito`.

Tipos P189 **no** entran a `integration_doc_tipos_asesor_upload`. Si S2 falla, S1 activo permanece.

**Fuera de B4:** cron (B4.1), UI Mesa/asesor (B5), Cloud apply/deploy.

## 19quinquies. P189 B4.1 — Scheduler local del worker (pg_cron + pg_net + Vault)

**Migración:** `186_infonavit_pdf_worker_schedule.sql` (NO Cloud apply). 183/184/185 intactas. No modifica el worker B4.

`enviar_a_mesa` / reingreso **no** llaman HTTP. Tras COMMIT, el outbox queda `pending`. Job independiente `infonavit-pdf-worker-dispatch` (`* * * * *`) ejecuta `infonavit_pdf_dispatch_worker()`:

1. Si no hay trabajo procesable (`pending ∧ available_at≤now` **o** `processing` stale según lease B4 10 min) → `no_work`, 0 HTTP.
2. Vault `infonavit_pdf_worker_url` + `infonavit_pdf_worker_secret` (nombres; valores fuera de la migration). Faltantes o blank → `missing_configuration`, 0 HTTP (fail-closed).
3. `net.http_post` body `{}`; headers `Content-Type: application/json` + `x-concasa-worker-secret`. Timeout **25000 ms** (pg_net encola; el worker procesa el batch en el POST). URL completa desde Vault (local o Cloud); no hardcode productiva.

Helper SECURITY DEFINER; EXECUTE solo `postgres` / `service_role`. REVOKE `PUBLIC` / `anon` / `authenticated`. No lee snapshot/PII. No claim / PDF / Storage / `expediente_documentos`. No reutiliza outbox/cron/secret de agenda ni P188.

Secret incorrecto → worker 401, outbox sigue `pending`, `attempts` intactos. Edge caída: outbox `pending`; el siguiente cron reintenta. El expediente enviado a Mesa no se revierte.

**Fuera de B4.1:** UI Mesa/asesor (B5), Cloud cron/Vault/deploy.

## 19sexies. P189 B5 — Visibilidad / preview / descarga (LOCAL)

**Migración:** `187_infonavit_pdf_read_model.sql` (NO Cloud apply). 183–186 intactas. No modifica worker/cron/Vault/templates.

**RPC** `get_expediente_infonavit_pdf_estado(p_expediente_id uuid) → jsonb`

Read model UI. El frontend **no** consulta `expediente_infonavit_submission_snapshots` ni `infonavit_pdf_outbox`.

- Auth: `auth.uid()` + perfil activo + misma org + visibilidad.
- Roles: `mesa_admin` | `mesa_interno` | `mesa_externo` | `super_admin` (vía `can_see_expediente`) **o** `asesor` dueño. **Editor denied** (aunque `can_see_expediente` sea true).
- Non-Mejoravit: `{aplica:false, has_submission:false, documents:[]}`.
- Mejoravit sin snapshot (legacy): `{aplica:true, has_submission:false}` — la UI **oculta** la sección (no error / no pendiente).
- Latest = `MAX(submission_version)`. Por tipo de esa version: `pending|processing|done|failed`.
- `done` → `latest_document` = `documento_id` de **esa** outbox. `pending|processing|failed` → `previous_document` si hay outbox `done` de version menor (reingreso: «Versión anterior»).
- Meta documental: `id, tipo_documento, nombre_original, mime_type, size_bytes, version, created_at`. Sin payload/PII/`snapshot_hash`/`template_sha256`/`uploaded_by`/`last_error_code`.
- Storage SELECT existente (`expediente_documento_storage_can_read` → `can_see_expediente`) cubre paths `{org}/{exp}/{tipo}/{outbox}.pdf`. **0 policy nueva.** Preview/download = `storage.download` privado (mismo patrón Evidencia), no signed URL pública.
- Tipos **no** entran a allowlists de upload/envio/obligatorios. No gate Mesa. No validar/rechazar/reemplazar.

**UI:** sección «Documentos INFONAVIT» en detalle Mesa (después de docs cliente, antes de complementarios) y asesor dueño RO post-envío. Polling 10s si algún latest está `pending|processing`; stop al unmount / todos done|failed.

**Fuera de B5:** Cloud apply/deploy/smoke/release.

## 19septies. P189 Word editable Mesa on-demand (LOCAL)

Sin migration. Sin Storage DOCX. Sin outbox Word. Sin `expediente_documentos` extra. PDF fill/flatten intacto.

**HTTP** `POST /api/mesa/infonavit-docx` (`runtime=nodejs`)

Body Zod: `{ expedienteId: uuid, documentType: infonavit_carta_bajo_protesta|infonavit_presupuesto_mejoramiento|infonavit_solicitud_inscripcion, submissionVersion: int>=0 | dígitos }`.

Auth: `Authorization: Bearer` sesión Mesa. Roles: `mesa_admin` | `mesa_interno` | `mesa_externo` | `super_admin` activo. Visibilidad: RPC `get_expediente_infonavit_pdf_estado` con JWT. Snapshot: `SELECT` server-side `expediente_infonavit_submission_snapshots` por `(expediente_id, submission_version)` exacta (service role; 0 SELECT browser). Genera `generateInfonavitDocx` en memoria desde `adaptB3SnapshotToB1` del **mismo** snapshot que el PDF de esa versión.

OK: `Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document` + `Content-Disposition: attachment` + filename amigable sin PII (`Carta Bajo Protesta editable.docx`, `Presupuesto de Mejoramiento editable.docx`, `Solicitud de Inscripción editable.docx`).

Errores públicos sin PII: 401 `unauthenticated`, 403 `forbidden` (asesor / sin visibilidad / inactivo), 400 `invalid_request`, 409 `not_done` | `version_mismatch` (no usa otra versión), 404/409 `snapshot_missing`.

**UI Mesa:** misma tarjeta Documentos INFONAVIT: Vista previa / Descargar PDF / Descargar Word editable (solo `done` + versión activa). Asesor: sin acceso ni botón.

**Fuera:** Cloud/push/PR/deploy; regeneración de históricos; companion DOCX en Storage.

## 17f. Marcador Mesa `tiene_datos` (P119)

**RPC** `mesa_set_expediente_marcador(p_expediente_id, p_tipo, p_active)`

- Allowlist `tipo`: `tiene_datos`.
- Roles: `mesa_admin` | `mesa_interno` | `mesa_externo` | `super_admin`.
- Idempotente; `action_log` `mesa.expediente.marcador_set`.
- No modifica etapa/subestado.
- Lectura: SELECT RLS `can_see_expediente` + batch enrich bandeja.

**Asignación rápida:** reutiliza `mesa_take_expediente`.
**Avance rápido:** reutiliza `avanzar_etapa_operativa`.
