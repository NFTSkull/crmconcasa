# Supabase — ConCasa CRM (P1)

Migraciones SQL para producción. **No conectadas a la UI mock** en esta fase.

## Estado (P2B / P2C)

| Item | Estado |
|------|--------|
| `migrations/001`–`004` | ✅ Schema, RLS, auditoría, RPC `update_documento_revision` |
| `migrations/005_rpc_enviar_a_mesa.sql` | ✅ RPC `enviar_a_mesa` (P2C-3) |
| `migrations/006_rpc_avanzar_etapa_operativa.sql` | ✅ RPC `avanzar_etapa_operativa` (P2C-4) |
| `migrations/007_rpc_book_biometricos.sql` | ✅ RPC `book_biometricos` (P2C-6) |
| `migrations/008_rpc_avanzar_etapa_4_5.sql` | ✅ extensión `avanzar_etapa_operativa` 4→5 (P2C-7) |
| `migrations/009_rpc_biometricos_cancel_reagendar.sql` | ✅ RPC `cancel_biometricos` / `reagendar_biometricos` (P2C-8) |
| `migrations/010_rpc_upsert_editor_decision.sql` | ✅ RPC `upsert_editor_decision` (P2C-9) |
| `migrations/011_rpc_save_cliente_datos.sql` | ✅ RPC `save_cliente_datos` (P2C-10) |
| `migrations/012_agenda_config_biometricos_rules.sql` | ✅ reglas `agenda_config` biométricos (P2C-11) |
| `migrations/013_rpc_avanzar_etapa_2_3_4.sql` | ✅ extensión `avanzar_etapa_operativa` 2→3 y 3→4 (P2C-12) |
| `migrations/014_rpc_avanzar_etapa_5_6.sql` | ✅ extensión `avanzar_etapa_operativa` 5→6 (P2C-13) |
| `migrations/015_rpc_avanzar_etapa_6_7.sql` | ✅ extensión `avanzar_etapa_operativa` 6→7 (P2C-14) |
| `migrations/016_rpc_avanzar_etapa_7_8.sql` | ✅ extensión `avanzar_etapa_operativa` 7→8 (P2C-15) |
| `migrations/017_rpc_enviar_retencion_mesa.sql` | ✅ RPC `enviar_retencion_mesa` (P2C-16) |
| `migrations/018_rpc_documento_revision_retencion_hook.sql` | ✅ hook rechazo `retencion_*` → `correccion_requerida` (P2C-16) |
| `migrations/019_rpc_avanzar_etapa_8_9.sql` | ✅ extensión `avanzar_etapa_operativa` 8→9 (P2C-17) |
| `migrations/020_agenda_config_firmas_rules.sql` | ✅ reglas `agenda_config` firmas (P2C-18) |
| `migrations/021_rpc_book_firmas.sql` | ✅ RPC `book_firmas` (P2C-18) |
| `migrations/022_rpc_firmas_cancel_reagendar.sql` | ✅ RPC `cancel_firmas` / `reagendar_firmas` (P2C-19) |
| `migrations/023_rpc_avanzar_etapa_9_10.sql` | ✅ extensión `avanzar_etapa_operativa` 9→10 (P2C-20) |
| `migrations/024_backfill_agenda_config_firmas.sql` | ✅ backfill `agenda_config` firmas por org (P2C-21) |
| `migrations/025_rpc_create_expediente.sql` | ✅ RPC `create_expediente` — asesor crea expediente (P3C) |
| `migrations/026_integration_doc_tipos_asesor_envio.sql` | ✅ P3H.1c: listas asesor/Mesa (supersedido por 028) |
| `migrations/027_rpc_register_expediente_documento.sql` | ✅ P3H.2: bucket `expediente-documentos` + RPC `register_expediente_documento` |
| `migrations/028_integration_doc_tipos_sin_duplicados.sql` | ✅ P3H.2b: 5 oblig / 1 opc / 6 upload / 7 Mesa |
| Roles `app_role` | `asesor`, `editor`, `mesa_*`, `super_admin` — **sin `revisor`** |
| Supabase CLI local | `npx supabase start` / `db reset` |
| UI mock | Sin conexión; `/revisor` legacy redirige a `/editor` |

### RPC `create_expediente` (P3C)

- **Migración:** `025_rpc_create_expediente.sql`
- **Quién:** solo `asesor` activo (no `super_admin` ni mesa/editor).
- **Origen:** `organization_id`, `asesor_id` y `origen_mesa` desde perfil autenticado; sin confiar en body del cliente.
- **Estado inicial:** etapa 1, `subestado=pendiente`, `ciclo_estado=activo`, `submitted_to_mesa=false`; crea `editor_decisions` pendiente + `action_log` `expediente.create`.
- **Duplicado:** rechaza NSS+programa activo en la misma org.
- **Tests:** `supabase/tests/rpc_create_expediente.sql`
- **UI:** `/asesor/nueva` con `NEXT_PUBLIC_DATA_MODE=supabase` (sin `listForAsesor` hasta P3B.2).

### RPC `enviar_a_mesa` (P2C-3)

- **Función:** `public.enviar_a_mesa(p_expediente_id uuid) returns jsonb`
- **Auditoría:** `action_log` → `expediente.enviar_a_mesa`
- **Rol:** solo `asesor` dueño del expediente (misma organización)
- **Gates:** decisión editor `aprobado` + `monto_aprobado > 0`; `cliente_datos` con RFC y estado `completo`/`validado`; **5** documentos del asesor presentes (`integration_doc_tipos_asesor_envio`)
- **Efecto:** `submitted_to_mesa = true`, `etapa_actual = 1`, `subestado = en_validacion_mesa` (no avanza a etapa 2)
- **Tests:** `supabase/tests/rpc_enviar_a_mesa.sql`

### P3H.2b — Documentos asesor sin duplicados (5 / 6 upload / 7 Mesa)

- **Migración:** `028_integration_doc_tipos_sin_duplicados.sql`
- **`integration_doc_tipos_asesor_envio()`:** 5 tipos obligatorios para `enviar_a_mesa`.
- **`integration_doc_tipos_asesor_opcionales()`:** `cliente_semanas_cotizadas` (no bloquea envío).
- **`integration_doc_tipos_asesor_upload()`:** 6 tipos permitidos en Storage/RPC asesor (excluye acta/constancia SAT).
- **`integration_doc_tipos_obligatorios()`:** 7 tipos (5 asesor + acta + constancia SAT) para `count_integration_docs_validados` y avance 1→2. **Acta y constancia SAT** las sube **Mesa de Control** por expediente; el asesor no las sube ni aparecen en su panel.
- **Legacy fuera de gates:** `ine`, `estado_cuenta`, `direccion` (datos históricos pueden existir).

### P3H.1c — Documentos asesor (histórico, supersedido por 028)

- **Migración:** `026_integration_doc_tipos_asesor_envio.sql`
- Reemplazada por P3H.2b (antes 8/10 con duplicados legacy).

### RPC `avanzar_etapa_operativa` (P2C-4 / P2C-7 / P2C-12 / P2C-13 / P2C-14 / P2C-15 / P2C-17 / P2C-20)

- **Función:**

  ```sql
  public.avanzar_etapa_operativa(
    p_expediente_id uuid,
    p_comentario text default null
  ) returns jsonb
  ```

- **Alcance:** transiciones **1 → 2** (P2C-4), **2 → 3** y **3 → 4** (P2C-12), **4 → 5** (P2C-7), **5 → 6** (P2C-13), **6 → 7** (P2C-14), **7 → 8** (P2C-15), **8 → 9** (P2C-17), **9 → 10** (P2C-20); otras etapas rechazadas
- **Roles permitidos:** `mesa_admin`, `mesa_interno`, `mesa_externo`, `super_admin` (vía `can_see_expediente`)
- **Roles bloqueados:** `asesor`, `editor` — **`revisor` no existe en producción**

**1 → 2 (integración → registro)**

- **Gates:** expediente enviado a Mesa; `etapa_actual = 1`; `subestado = en_validacion_mesa`; `cliente_datos.estado = validado`; 7 documentos obligatorios con `estatus_revision = validado`
- **Efecto:** `etapa_actual = 2`, `subestado = en_proceso`
- **Tests:** `supabase/tests/rpc_avanzar_etapa_operativa.sql` (15 pruebas)

**4 → 5 (biométricos → registro IMSS)**

- **Gates:** expediente enviado a Mesa; `etapa_actual = 4`; `fecha_cita IS NOT NULL`; booking `agenda_bookings` con `kind = biometricos` y `status = booked` (no compara fecha/hora exacta vs booking por timezone)
- **Efecto:** `etapa_actual = 5`, `subestado = en_proceso`; **no** modifica `fecha_cita` ni bookings
- **Retorno 4→5:** incluye `booking_id`, `fecha_cita`
- **Tests:** `supabase/tests/rpc_avanzar_etapa_4_5.sql` (18 pruebas)

**2 → 3 (listo para cita biométrico)**

- **Gates:** expediente enviado a Mesa; `etapa_actual = 2`; `subestado = en_proceso`; ciclo activo; visibilidad Mesa
- **Efecto:** `etapa_actual = 3`, `subestado = en_proceso`; **no** modifica `fecha_cita` ni bookings
- **Tests:** `supabase/tests/rpc_avanzar_etapa_2_3_4.sql` (transición 2→3, pruebas 1–12)

**3 → 4 (cita agendada — listo para que asesor agende biométricos)**

- **Gates:** expediente enviado a Mesa; `etapa_actual = 3`; `subestado = en_proceso`; ciclo activo; visibilidad Mesa
- **Efecto:** `etapa_actual = 4`, `subestado = en_proceso`; **no** exige booking biométrico aún
- **Tests:** `supabase/tests/rpc_avanzar_etapa_2_3_4.sql` (transición 3→4, pruebas 13–21)

**5 → 6 (inscripción — post-biométricos)**

- **Gates:** expediente enviado a Mesa; `etapa_actual = 5`; `subestado = en_proceso`; `fecha_cita IS NOT NULL`; **`fecha_cita <= now()`** (cita ya ocurrió; impide avance inmediato tras 4→5); booking `agenda_bookings` con `kind = biometricos` y `status = booked`
- **No confirma asistencia biométrica** — gate mínimo temporal; confirmación formal queda para fase futura (columna/RPC específica)
- **Efecto:** `etapa_actual = 6`, `subestado = en_proceso`; **no** modifica `fecha_cita` ni cancela bookings
- **Retorno 5→6:** incluye `booking_id`, `fecha_cita`, `comentario`
- **Tests:** `supabase/tests/rpc_avanzar_etapa_5_6.sql` (25 pruebas)

**6 → 7 (notificación — post-inscripción)**

- **Gates:** expediente enviado a Mesa; `etapa_actual = 6`; `subestado = en_proceso`; ciclo activo; visibilidad Mesa; **no** exige `fecha_cita` ni booking
- **Efecto:** `etapa_actual = 7`, `subestado = en_proceso`; **no** modifica `fecha_cita`, bookings, documentos, `cliente_datos` ni retención/firmas
- **Tests:** `supabase/tests/rpc_avanzar_etapa_6_7.sql` (22 pruebas)

**7 → 8 (acuse/aviso retención — sin flujo de retención)**

- **Gates:** expediente enviado a Mesa; `etapa_actual = 7`; `subestado = en_proceso`; ciclo activo; visibilidad Mesa; **no** exige retención ni `fecha_cita`/booking
- **Efecto:** `etapa_actual = 8`, `subestado = en_proceso`; **no** crea/envía retención; **no** modifica `fecha_cita`, bookings, documentos, `cliente_datos` ni `editor_decisions`
- **Tests:** `supabase/tests/rpc_avanzar_etapa_7_8.sql` (23 pruebas)

**8 → 9 (post-retención validada)**

- **Gates:** expediente enviado a Mesa; `etapa_actual = 8`; `subestado = en_proceso`; ciclo activo; visibilidad Mesa; `cliente_datos.estado = validado`; `retencion_envios.enviado = true` y `estado = enviado`; opción efectiva (`retencion_envios.opcion`, fallback `retencion_opciones.retencion_opcion`); documentos requeridos por opción con `estatus_revision = validado` (`con_sello`: acuse+aviso+INE; `sin_sello`: carta+aviso+INE)
- **Efecto:** `etapa_actual = 9`, `subestado = en_proceso`; **no** modifica retención/envío, documentos, `cliente_datos`, `fecha_cita` ni bookings
- **Retorno 8→9:** incluye `retencion_opcion`, `required_documentos`
- **Tests:** `supabase/tests/rpc_avanzar_etapa_8_9.sql` (38 pruebas)

**9 → 10 (cita firma agendada)**

- **Roles:** solo `mesa_admin` y `super_admin` (bloqueados `mesa_interno`, `mesa_externo`, `asesor`, `editor`)
- **Gates:** expediente enviado a Mesa; `etapa_actual = 9`; `subestado = en_proceso`; ciclo activo; `fecha_cita IS NOT NULL`; booking `agenda_bookings` con `kind = firmas` y `status = booked`
- **Efecto:** `etapa_actual = 10`, `subestado = en_proceso`; **no** modifica `fecha_cita` ni bookings
- **Retorno 9→10:** incluye `booking_id`, `fecha_cita`, `transition: 9_10`, `kind: firmas`
- **Tests:** `supabase/tests/rpc_avanzar_etapa_9_10.sql` (14 pruebas)

- **Auditoría (todas las transiciones):** `action_log` → `expediente.avanzar_etapa_operativa` (payload `transition: 2_3 | 3_4 | 5_6 | 6_7 | 7_8 | 8_9 | 9_10` según bloque)

### RPC `enviar_retencion_mesa` (P2C-16)

- **Función:**

  ```sql
  public.enviar_retencion_mesa(
    p_expediente_id uuid,
    p_retencion_opcion public.retencion_opcion
  ) returns jsonb
  ```

- **Alcance:** asesor dueño envía o reenvía bloque Acuse/Aviso en **etapa 8**; **no** cambia `etapa_actual`
- **Roles permitidos:** solo `asesor` (dueño, misma organización)
- **Roles bloqueados:** `mesa_*`, `editor`, `super_admin` — **`revisor` no existe**
- **Gates:** expediente activo, enviado a Mesa, `etapa_actual = 8`, `subestado = en_proceso`; docs requeridos de la opción con `estatus_revision` en `subido` | `resubido` | `validado` (no `rechazado` ni `faltante`)
- **Opción A (`con_sello`):** `retencion_acuse_con_sello`, `retencion_aviso_retencion`, `retencion_ine_frente`, `retencion_ine_reverso`
- **Opción B (`sin_sello`):** `retencion_carta_sin_sello`, `retencion_aviso_retencion`, `retencion_ine_frente`, `retencion_ine_reverso`
- **Reenvío:** permitido solo si `retencion_envios.estado = correccion_requerida`; bloqueado si ya `enviado`
- **Efecto:** upsert `retencion_opciones` + `retencion_envios` (`enviado = true`, `estado = enviado`, `fecha_envio_mesa = now()`)
- **Hook Mesa:** `update_documento_revision` rechazo `retencion_*` → `retencion_envios.estado = correccion_requerida` (si existe fila)
- **Auditoría:** `action_log` → `expediente.enviar_retencion_mesa`
- **Tests:** `supabase/tests/rpc_enviar_retencion_mesa.sql` (36 pruebas)

### RPC `book_firmas` (P2C-18)

- **Función:**

  ```sql
  public.book_firmas(
    p_expediente_id uuid,
    p_scheduled_at timestamptz,
    p_location_id text default null,
    p_note text default null
  ) returns jsonb
  ```

- **Alcance:** asesor dueño o `mesa_admin` agenda cita firmas en **etapa 9**; **no** avanza a etapa 10
- **Roles permitidos:** `asesor` (dueño), `mesa_admin`, `super_admin`
- **Roles bloqueados:** `mesa_interno`, `mesa_externo`, `editor` — **`revisor` no existe**
- **Gates:** expediente activo, enviado a Mesa, `subestado = en_proceso`, `etapa_actual = 9`; sin booking `firmas` activo; reglas `agenda_config` firmas
- **Efecto:** inserta `agenda_bookings` (`kind = firmas`); actualiza `expedientes.fecha_cita`; **no** cambia `etapa_actual`
- **Auditoría:** `action_log` → `agenda.firmas.book`
- **Tests:** `supabase/tests/rpc_book_firmas.sql` (37 pruebas)

### RPC `cancel_firmas` / `reagendar_firmas` (P2C-19)

- **Funciones:**

  ```sql
  public.cancel_firmas(
    p_expediente_id uuid,
    p_motivo text default null
  ) returns jsonb

  public.reagendar_firmas(
    p_expediente_id uuid,
    p_scheduled_at timestamptz,
    p_location_id text,
    p_note text default null
  ) returns jsonb
  ```

- **Alcance:** asesor dueño o `mesa_admin` cancela/reagenda cita firmas en **etapa 9 o 10**; **no** avanza etapa
- **Roles permitidos:** `asesor` (dueño), `mesa_admin`, `super_admin`
- **Roles bloqueados:** `mesa_interno`, `mesa_externo`, `editor` — **`revisor` no existe**
- **Gates:** expediente activo, enviado a Mesa, `subestado = en_proceso`, `etapa_actual IN (9, 10)`; booking `firmas` activo (`status = booked`)
- **Cancel:** `status = cancelled`, `cancelled_at`; limpia `expedientes.fecha_cita`
- **Reagendar:** cancela booking anterior (nota `Reagendada`), valida slot con `agenda_firmas_assert_slot_available` **después** de cancelar, inserta nuevo booking, actualiza `fecha_cita`
- **Auditoría:** `action_log` → `agenda.firmas.cancel` / `agenda.firmas.reagendar`
- **Tests:** `supabase/tests/rpc_firmas_cancel_reagendar.sql` (44 pruebas)

### Reglas `agenda_config` firmas (P2C-18)

- **Migración:** `020_agenda_config_firmas_rules.sql`
- **RPC afectada:** `book_firmas`, `reagendar_firmas`
- **Helper:** `agenda_firmas_assert_slot_available(org, scheduled_at, location_id)`
- **Estructura `config` JSONB (canónica):**

  ```json
  {
    "enabled": true,
    "timezone": "America/Monterrey",
    "min_lead_hours": 24,
    "allowed_weekdays": [1, 2, 3, 4, 5],
    "locations": {
      "mty-centro": { "enabled": true, "capacity_per_slot": 3 }
    },
    "slots": ["09:00", "10:00", "11:00", "12:00", "16:00"]
  }
  ```

- **Índice:** `agenda_bookings_one_active_firmas_per_expediente_idx`

### Backfill `agenda_config` firmas (P2C-21)

- **Migración:** `024_backfill_agenda_config_firmas.sql`
- **Función:** `public.backfill_agenda_config_firmas() returns jsonb`
- **Cuándo:** deploy producción — orgs existentes sin fila `kind = firmas` (local `seed.sql` solo tiene biométricos)
- **Comportamiento:** inserta config canónica normalizada por org; `ON CONFLICT DO NOTHING`; **no** modifica firmas existentes ni biométricos
- **Re-ejecución:** idempotente (`inserted: 0` si ya cubierto)
- **Tests:** `supabase/tests/backfill_agenda_config_firmas.sql` (7 pruebas)

### RPC `book_biometricos` (P2C-6)

- **Función:**

  ```sql
  public.book_biometricos(
    p_expediente_id uuid,
    p_scheduled_at timestamptz,
    p_location_id text default null,
    p_note text default null
  ) returns jsonb
  ```

- **Alcance:** asesor dueño agenda cita biométricos en **etapa 4**; **no** avanza a etapa 5
- **Roles permitidos:** solo `asesor` (dueño, misma organización)
- **Roles bloqueados:** `editor`, `mesa_*`, `super_admin` — **`revisor` no existe**
- **Gates:** expediente activo, enviado a Mesa, `etapa_actual = 4`; `scheduled_at` futuro; `location_id` obligatorio; sin booking `biometricos` activo (`status = booked`)
- **Anti-duplicado:** índice único parcial `agenda_bookings_one_active_biometricos_per_expediente_idx` en `(expediente_id, kind)` donde `kind = biometricos` y `status = booked`; la RPC además hace pre-check y captura `unique_violation` con mensaje controlado
- **Efecto:** inserta `agenda_bookings` (`kind = biometricos`, `status = booked`, `booking_date`/`booking_time` derivados de `scheduled_at`); actualiza `expedientes.fecha_cita`; **no** cambia `etapa_actual`
- **Auditoría:** `action_log` → `agenda.biometricos.book`
- **Tests:** `supabase/tests/rpc_book_biometricos.sql` (18 pruebas)
- **P2C-11:** reglas `agenda_config` aplicadas (ver sección siguiente)

### Reglas `agenda_config` biométricos (P2C-11)

- **Migración:** `012_agenda_config_biometricos_rules.sql`
- **RPCs afectadas:** `book_biometricos`, `reagendar_biometricos` (firmas: ver `020` / P2C-18)
- **Helper:** `agenda_biometricos_assert_slot_available(org, scheduled_at, location_id)`
- **Estructura `config` JSONB (canónica P2C-11):**

  ```json
  {
    "enabled": true,
    "timezone": "America/Monterrey",
    "min_lead_hours": 24,
    "allowed_weekdays": [1, 2, 3, 4, 5],
    "locations": {
      "mty-centro": { "enabled": true, "capacity_per_slot": 3 }
    },
    "slots": ["09:00", "10:00", "11:00"]
  }
  ```

- **Legacy seed** (`minLeadDays`, sin `locations`/`slots`): se **normaliza** al insertar/actualizar vía trigger `agenda_config_normalize_biometricos` y `UPDATE` en migración 012; **no hay modo permisivo** en RPC
- **Validaciones estrictas:** `locations`, `slots` y `allowed_weekdays` deben existir y no estar vacíos; sede/hora exactas obligatorias
- **Errores:** prefijo `agenda_config:` (no encontrada, deshabilitada, anticipación, día, horario, sede, cupo)
- **Índice P2C-6:** se mantiene `agenda_bookings_one_active_biometricos_per_expediente_idx` (no reemplazado)
- **Tests:** `supabase/tests/agenda_config_biometricos_rules.sql` (36 pruebas)

### RPC `cancel_biometricos` / `reagendar_biometricos` (P2C-8)

- **Funciones:**

  ```sql
  public.cancel_biometricos(
    p_expediente_id uuid,
    p_motivo text default null
  ) returns jsonb

  public.reagendar_biometricos(
    p_expediente_id uuid,
    p_scheduled_at timestamptz,
    p_location_id text,
    p_note text default null
  ) returns jsonb
  ```

- **Alcance:** asesor dueño cancela o reagenda cita biométrica en **etapa 4**; **no** cambia etapa
- **Roles permitidos:** solo `asesor` (dueño, misma organización)
- **Roles bloqueados:** `editor`, `mesa_*`, `super_admin` — **`revisor` no existe**
- **Gates comunes:** expediente activo, enviado a Mesa, `etapa_actual = 4`; booking activo `kind = biometricos`, `status = booked`
- **Cancelar:** `status → cancelled`, `cancelled_at = now()`, nota con motivo; `expedientes.fecha_cita = null`; libera índice parcial
- **Reagendar:** cancela booking activo + inserta nuevo `booked` en una transacción; actualiza `fecha_cita`; captura `unique_violation`
- **Auditoría:** `agenda.biometricos.cancel` / `agenda.biometricos.reagendar`
- **Tests:** `supabase/tests/rpc_biometricos_cancel_reagendar.sql` (24 pruebas)
- **Nota:** `reagendar_biometricos` aplica reglas `agenda_config` (P2C-11); `cancel_biometricos` sin cambios de config

### RPC `upsert_editor_decision` (P2C-9)

- **Función:**

  ```sql
  public.upsert_editor_decision(
    p_expediente_id uuid,
    p_decision public.editor_decision,
    p_monto_aprobado numeric default null,
    p_motivo text default null
  ) returns jsonb
  ```

- **Alcance:** editor guarda decisión de monto **antes** de envío a Mesa; **no** envía a Mesa ni cambia etapa
- **Roles permitidos:** solo `editor` (misma organización) — **`super_admin` bloqueado** en P2C-9
- **Roles bloqueados:** `asesor`, `mesa_*`, `super_admin` — **`revisor` no existe**
- **Gates:** expediente activo, no soft-deleted, `submitted_to_mesa = false`; `aprobado` exige `monto_aprobado > 0`; otras decisiones dejan `monto_aprobado = null`
- **Efecto:** upsert en `editor_decisions` (`decided_by`, `notas_revision` desde `p_motivo`)
- **Auditoría:** `action_log` → `editor.decision.upsert`
- **Tests:** `supabase/tests/rpc_upsert_editor_decision.sql` (19 pruebas)
- **Integración:** `enviar_a_mesa` consume decisión `aprobado` + monto creados por esta RPC

### RPC `save_cliente_datos` (P2C-10)

- **Función:**

  ```sql
  public.save_cliente_datos(
    p_expediente_id uuid,
    p_rfc text,
    p_telefono text,
    p_referencias jsonb default '[]'::jsonb,
    p_imagenes jsonb default null,
    p_datos jsonb default '{}'::jsonb,
    p_estado public.cliente_datos_estado default 'completo'
  ) returns jsonb
  ```

- **Alcance:** asesor dueño guarda/actualiza `cliente_datos` (RFC, teléfono, referencias, imágenes como metadata/rutas); **no** envía a Mesa, **no** cambia etapa ni `submitted_to_mesa`
- **Roles permitidos:** solo `asesor` (dueño, misma organización)
- **Roles bloqueados:** `editor`, `mesa_*`, `super_admin` — **`revisor` no existe**
- **Columnas nuevas en `cliente_datos`:** `telefono_normalizado`, `referencias` (jsonb), `imagenes` (jsonb)
- **Anti-duplicado teléfono principal:** índice **UNIQUE** parcial `cliente_datos_org_telefono_normalizado_unique_idx` en `(organization_id, telefono_normalizado)` donde `telefono_normalizado IS NOT NULL AND telefono_normalizado <> ''`; pre-check RPC + `pg_advisory_xact_lock`; captura `unique_violation` → `save_cliente_datos: teléfono repetido`
- **Teléfonos en referencias JSONB:** validados por RPC (sin tabla normalizada ni índice UNIQUE en P2C-10)
- **Validaciones:** RFC México (12/13, regex), teléfono MX 10 dígitos sin duplicados en org, referencias con nombres/teléfonos únicos, imágenes solo metadata (`storage_path`/`url`/`public_url`, mime jpeg/png/webp) — **sin binarios ni Supabase Storage**
- **Estado:** asesor puede `completo` o `pendiente`; **no** puede marcar `validado`
- **`p_imagenes`:** `NULL` conserva existentes; `[]` limpia
- **Auditoría:** `action_log` → `cliente_datos.save`
- **Tests:** `supabase/tests/rpc_save_cliente_datos.sql` (42 pruebas)
- **Integración:** `enviar_a_mesa` consume `cliente_datos` con RFC en `datos->>'rfc'` y `estado` `completo`/`validado`

## Aplicar migración (cuando exista CLI)

```bash
# Instalar CLI: https://supabase.com/docs/guides/cli
supabase init          # solo una vez, si no hay config
supabase start         # Postgres local
supabase db reset      # aplica migrations/
```

**No ejecutar** `supabase db push` contra producción sin revisión de seguridad y backup.

## Tests SQL (P2C-5)

Requiere **Supabase local** en marcha (`npx supabase start`). Para un entorno limpio:

```bash
npx supabase db reset
npm run test:sql
```

Atajo con reset incluido:

```bash
npm run test:sql:reset
```

Orden de ejecución (`npm run test:sql`):

1. `supabase/tests/rls_policies.sql`
2. `supabase/tests/audit_document_history.sql`
3. `supabase/tests/rpc_documento_revision.sql`
4. `supabase/tests/rpc_enviar_a_mesa.sql`
5. `supabase/tests/rpc_avanzar_etapa_operativa.sql`
6. `supabase/tests/rpc_book_biometricos.sql`
7. `supabase/tests/rpc_avanzar_etapa_4_5.sql`
8. `supabase/tests/rpc_biometricos_cancel_reagendar.sql`
9. `supabase/tests/rpc_upsert_editor_decision.sql`
10. `supabase/tests/rpc_save_cliente_datos.sql`
11. `supabase/tests/agenda_config_biometricos_rules.sql`
12. `supabase/tests/rpc_avanzar_etapa_2_3_4.sql`
13. `supabase/tests/rpc_avanzar_etapa_5_6.sql`
14. `supabase/tests/rpc_avanzar_etapa_6_7.sql`
15. `supabase/tests/rpc_avanzar_etapa_7_8.sql`
16. `supabase/tests/rpc_enviar_retencion_mesa.sql`
17. `supabase/tests/rpc_avanzar_etapa_8_9.sql`
18. `supabase/tests/rpc_book_firmas.sql`
19. `supabase/tests/rpc_firmas_cancel_reagendar.sql`
20. `supabase/tests/rpc_avanzar_etapa_9_10.sql`
21. `supabase/tests/backfill_agenda_config_firmas.sql`
22. `supabase/tests/rpc_create_expediente.sql`

Variables opcionales: `SUPABASE_DB_HOST`, `SUPABASE_DB_PORT`, `SUPABASE_DB_USER`, `SUPABASE_DB_PASSWORD`, `SUPABASE_DB_NAME` (defaults: `127.0.0.1:54322`, usuario `postgres`).

## Estructura

```
supabase/
  migrations/
    001_core_schema.sql
    002_rls_policies.sql
    003_audit_and_document_history.sql
    004_rpc_documento_revision.sql
    005_rpc_enviar_a_mesa.sql
    006_rpc_avanzar_etapa_operativa.sql
    007_rpc_book_biometricos.sql
    008_rpc_avanzar_etapa_4_5.sql
    009_rpc_biometricos_cancel_reagendar.sql
    010_rpc_upsert_editor_decision.sql
    011_rpc_save_cliente_datos.sql
    012_agenda_config_biometricos_rules.sql
    013_rpc_avanzar_etapa_2_3_4.sql
    014_rpc_avanzar_etapa_5_6.sql
    015_rpc_avanzar_etapa_6_7.sql
    016_rpc_avanzar_etapa_7_8.sql
    017_rpc_enviar_retencion_mesa.sql
    018_rpc_documento_revision_retencion_hook.sql
    019_rpc_avanzar_etapa_8_9.sql
    020_agenda_config_firmas_rules.sql
    021_rpc_book_firmas.sql
    022_rpc_firmas_cancel_reagendar.sql
    023_rpc_avanzar_etapa_9_10.sql
    024_backfill_agenda_config_firmas.sql
    025_rpc_create_expediente.sql
  tests/
    rls_policies.sql
    audit_document_history.sql
    rpc_documento_revision.sql
    rpc_enviar_a_mesa.sql
    rpc_avanzar_etapa_operativa.sql
    rpc_book_biometricos.sql
    rpc_avanzar_etapa_4_5.sql
    rpc_biometricos_cancel_reagendar.sql
    rpc_upsert_editor_decision.sql
    rpc_save_cliente_datos.sql
    agenda_config_biometricos_rules.sql
    rpc_avanzar_etapa_2_3_4.sql
    rpc_avanzar_etapa_5_6.sql
    rpc_avanzar_etapa_6_7.sql
    rpc_avanzar_etapa_7_8.sql
    rpc_enviar_retencion_mesa.sql
    rpc_avanzar_etapa_8_9.sql
    rpc_book_firmas.sql
    rpc_firmas_cancel_reagendar.sql
    rpc_avanzar_etapa_9_10.sql
    backfill_agenda_config_firmas.sql
    rpc_create_expediente.sql
  seed.sql
  README.md
```

## Próximos archivos

- Storage — bucket + policies
- Integración UI P3 — `DATA_MODE=mock|supabase`

## Referencias

- `docs/PRODUCTO.md`
- `docs/ARQUITECTURA_PRODUCCION.md`
- `docs/API_CONTRATOS.md`
- `docs/RIESGOS_PRODUCCION.md`
