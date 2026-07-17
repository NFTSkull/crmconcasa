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
| Rechazo | Nota obligatoria; puede regresar etapa |

- Validación server-side espejo de `getBloqueosAvanceMesa` / helpers retención.

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
- `kind = biometricos` fijo; tabla `agenda_config`.
- Modelo **semanal** canónico (sin calendario por día mock, sin vigencia por fecha, sin excepciones por día en P3M.1).
- Validación estricta de claves permitidas; `locations` no vacío si `enabled=true`; al menos una sede `enabled=true`.
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

### UI asesor (P079)

- Panel `RetencionAcuseAvisoSupabaseCard` en `/asesor/expediente/[id]` si `DATA_MODE=supabase`, `etapa_actual ∈ {8,9}`, `submitted_to_mesa`.
- Opción A/B en estado local hasta envío; persistencia vía RPC al enviar.
- Upload: Storage `expediente-documentos` + RPC `register_expediente_documento_retencion`.
- Reemplazo asesor: antes de enviar el bloque (`no_enviado`) puede subir/reemplazar PDFs no validados; con bloque `enviado` no reemplaza; en `correccion_requerida` solo `rechazado`; siempre bloqueado si `validado` (espejo del RPC).
- MIME de retención se normaliza a `application/pdf` en el cliente (igual que integración) para PDFs con tipo vacío/`octet-stream`.
- Opción A/B: borrador en `sessionStorage` (`retencion-opcion:<expedienteId>`) + inferencia desde docs `retencion_*` activos tras reload; orden: DB → inferencia → sessionStorage → default (la fila `retencion_opciones` solo se escribe al enviar a Mesa).
- Botón «Enviar a Mesa Control» visible en `no_enviado` / `correccion_requerida`; al éxito copy «Acuse enviado. El expediente está listo para agendar firma.» + refetch canónico a etapa 9.
- Sin validación Mesa del Acuse; Mesa agenda firma en etapa 9.

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

## 15. Admin KPIs / Producción (P081–P082)

**Operación:** RPCs read-only `admin_get_production_summary`, `admin_get_mesa_cohort_by_etapa`, `admin_list_production_by_asesor`, `admin_list_mesa_envios_page`, `admin_list_precalificaciones_page`

### P085 — filtro global por asesor

- Todas las consultas Admin aceptan el mismo `asesor_id` UUID estable (nunca nombre/email).
- `admin_list_production_by_asesor(p_from, p_to_exclusive, p_estado, p_asesor_id DEFAULT NULL)`:
  - sin `p_asesor_id` → producción de todos los asesores del periodo;
  - con `p_asesor_id` → una sola fila (o vacío si no hay producción).
- UI `/admin`: tarjetas de etapa filtran `etapa_actual`, sincronizan el select y hacen scroll a `#admin-mesa-expedientes`. **P086:** «Producción por asesor» permanece siempre visible/montada independientemente del filtro de etapa de Mesa; los filtros de Mesa no controlan su montaje; la sección administra carga, actualización, error y vacío con estados propios (fuera del gate global `loading` del dashboard).
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
- **P084:** excepción controlada que repara snapshots demostrablemente corruptos (1ª aprobación absurda + bounce <60s) desde `action_log`; no redefine la inmutabilidad ordinaria ni cambia `aprobado_at`. Caso sin re-aprobación: `monto_aprobado_snapshot_no_recuperable=true` + `monto_aprobado_al_aprobar=NULL` (etiqueta «Aprobación histórica con monto no recuperable»).
- Escritura `monto_aprobado` (aprobación): `> 0` + `NUMERIC(14,2)`. **No** hay máximo canónico de aprobación; `169000` es tope de base cobro Mejoravit, no del monto editor.
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

## 17d. Rechazo operativo y reingreso post-biométricos — P071/P072

### Rechazo operativo

**Operación:** RPC `rechazar_etapa_operativa`  
**Firma:** `rechazar_etapa_operativa(p_expediente_id uuid, p_motivo text, p_comentario text, p_biometricos_condicion biometricos_condicion, p_biometricos_razon text default null, p_biometricos_booking_id uuid default null) → jsonb`

- Solo Mesa autorizada; expediente visible, activo, enviado y exactamente en etapa 5 o 6.
- `reutilizables`, `repetir` e `invalidos` exigen booking biométrico del expediente, cita pasada y razón no vacía.
- Un booking `cancelled` solo acredita intento si `cancelled_at` es posterior a la cita. Un booking futuro `booked` bloquea.
- Registra una fila append-only en `expediente_rechazos_operativos`, cambia únicamente el subestado operativo a `rechazado` y escribe `action_log`.
- No cancela, reactiva ni modifica bookings, `fecha_cita` o notas históricas.

### Elegibilidad

**Operación:** RPC read-only `get_reingreso_post_biometricos_elegibilidad`  
**Firma:** `get_reingreso_post_biometricos_elegibilidad(p_expediente_id uuid) → jsonb`

- Solo el asesor dueño consulta.
- Reutiliza `reingreso_post_biometricos_elegibilidad_interna(uuid, uuid)`, sin grant al cliente.
- Respuesta: `eligible`, `reason_code`, `reason_message`, `rechazo_id`, `biometricos_condicion`, `existing_child_id`.

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
