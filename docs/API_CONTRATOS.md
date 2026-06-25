# ConCasa CRM — Contratos de API (producción)

**Fase:** P1 — contratos conceptuales (sin implementación HTTP aún)  
**Validación:** Zod en server/RPC (P2+)  
**Auditoría:** cada mutación escribe `action_log`

Convenciones:
- `expediente_id`: UUID
- `organization_id`: UUID (single org ConCasa en piloto)
- Errores: `{ code, message, details? }`
- Auth: Bearer JWT Supabase; rol desde `profiles`, no del body

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
| 9→10 | Cita firma: `fecha_cita` + booking `firmas` activo (`booked`); solo `mesa_admin`/`super_admin` |
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

- Solo `asesor`; expediente etapa **4**.
- Persiste booking + `expedientes.fecha_cita`; **NO** cambia etapa a 5.
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

- Solo `asesor` dueño; expediente etapa **4**; booking activo `kind=biometricos`, `status=booked`.
- `agenda_bookings.status → cancelled`; `expedientes.fecha_cita = null`; **no** cambia etapa.
- Libera cupo del slot cancelado.

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

## 9. Enviar retención a Mesa (asesor)

**Operación:** `POST /expedientes/{id}/retencion/enviar` · RPC `enviar_retencion_mesa`

### Request

```json
{
  "retencion_opcion": "con_sello | sin_sello"
}
```

### Reglas

- Etapa 8; todos los docs de la opción subidos (no necesariamente validados).
- Upsert `retencion_envios` (`enviado`, `estado = enviado`).
- Bloquea cambio opción A/B mientras `estado = enviado` (corrección libera).

### UI asesor (P3O.2)

- Panel `RetencionAcuseAvisoSupabaseCard` en `/asesor/expediente/[id]` si `DATA_MODE=supabase`, `etapa_actual = 8`, `submitted_to_mesa`.
- Opción A/B en estado local hasta envío; persistencia vía RPC al enviar.
- Upload: Storage `expediente-documentos` + RPC `register_expediente_documento_retencion`.
- Reemplazo asesor solo `faltante` / `rechazado`; bloqueado si `validado`.
- Botón «Enviar a Mesa» si checklist completo y `retencionPuedeReenviarAMesa`.
- Sin botón 8→9 ni validación Mesa (P3O.3).

---

## 10. Validar / rechazar retención (Mesa)

Mismo contrato que **§6** sobre tipos `retencion_*`.

Adicional:
- Rechazo post-validación permitido.
- Avance 8→9 consulta `getBloqueosRetencionAvanceEtapa8Mesa`.

### UI Mesa (P3O.3)

- Sección `MesaRetencionAcuseAvisoSection` en `/mesa-control/[id]` Supabase si `etapa_actual = 8`.
- Lee `retencion_opciones`, `retencion_envios`, docs `retencion_*` (lista según opción A/B).
- Preview/descarga Storage; validar/rechazar vía RPC `update_documento_revision`.
- Rechazo obliga comentario; hook SQL pone `retencion_envios.estado = correccion_requerida`.
- Sin botón 8→9 en esta versión.

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
- Expediente etapa **9**, `subestado = en_proceso`, enviado a Mesa.
- Valida `agenda_config` (`kind = firmas`): anticipación, día, slot, sede, cupo.
- **Deploy:** migración `024` ejecuta `backfill_agenda_config_firmas()` para orgs sin fila firmas (idempotente).
- Persiste `agenda_bookings` (`kind = firmas`) + `expedientes.fecha_cita`.
- **NO** cambia `etapa_actual`.

### Pendiente (bloques posteriores)

- UI / `DATA_MODE` fuera de alcance.

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

- Roles: `asesor` (dueño), `mesa_admin`, `super_admin`.
- Expediente etapa **9 o 10**, `subestado = en_proceso`, enviado a Mesa.
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

## 15. Admin KPIs

**Operación:** `GET /admin/metrics` · vistas materializadas / RPC read-only

### Response (conceptual)

```json
{
  "operativo_kpis": {},
  "funnel_by_etapa": [],
  "metrics_by_asesor": [],
  "time_metrics": {}
}
```

### Reglas

- Rol `super_admin` únicamente.
- P7: reemplaza agregación client-side (`adminDashboardStats.ts`).

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
