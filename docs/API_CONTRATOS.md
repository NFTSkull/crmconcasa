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
| 4→5 | Cita biométrica (`fecha_cita` o booking activo) |
| 8→9 | Retención: opción + envío asesor + docs opción `validado` |
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

---

## 10. Validar / rechazar retención (Mesa)

Mismo contrato que **§6** sobre tipos `retencion_*`.

Adicional:
- Rechazo post-validación permitido.
- Avance 8→9 consulta `getBloqueosRetencionAvanceEtapa8Mesa`.

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
- Persiste `agenda_bookings` (`kind = firmas`) + `expedientes.fecha_cita`.
- **NO** cambia `etapa_actual`.

### Pendiente (bloques posteriores)

- `cancel_firmas`, `reagendar_firmas`.
- Avance Mesa **9→10** (`avanzar_etapa_operativa`).
- UI / `DATA_MODE` fuera de alcance P2C-18.

---

## 12. Reenvío retención (asesor)

**Operación:** `POST /expedientes/{id}/retencion/reenviar`

### Reglas

- Solo si `retencion_envios.estado = correccion_requerida` y sin faltantes.
- Docs rechazados reemplazados → `resubido`; Mesa revalida.

---

## 13. Admin KPIs

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

## 14. Descargar documento (signed URL)

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

## 15. Repos mock existentes (referencia implementación)

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

## 16. TODO P2

- [ ] Formalizar `ExpedientesRepo` interface
- [ ] Zod schemas por RPC
- [ ] OpenAPI o tRPC router
- [ ] Idempotency keys en envío mesa / retención
