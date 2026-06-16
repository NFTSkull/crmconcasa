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
| Roles `app_role` | `asesor`, `editor`, `mesa_*`, `super_admin` — **sin `revisor`** |
| Supabase CLI local | `npx supabase start` / `db reset` |
| UI mock | Sin conexión; `/revisor` legacy redirige a `/editor` |

### RPC `enviar_a_mesa` (P2C-3)

- **Función:** `public.enviar_a_mesa(p_expediente_id uuid) returns jsonb`
- **Auditoría:** `action_log` → `expediente.enviar_a_mesa`
- **Rol:** solo `asesor` dueño del expediente (misma organización)
- **Gates:** decisión editor `aprobado` + `monto_aprobado > 0`; `cliente_datos` con RFC y estado `completo`/`validado`; 10 documentos obligatorios de integración presentes
- **Efecto:** `submitted_to_mesa = true`, `etapa_actual = 1`, `subestado = en_validacion_mesa` (no avanza a etapa 2)
- **Tests:** `supabase/tests/rpc_enviar_a_mesa.sql`

### RPC `avanzar_etapa_operativa` (P2C-4 / P2C-7)

- **Función:**

  ```sql
  public.avanzar_etapa_operativa(
    p_expediente_id uuid,
    p_comentario text default null
  ) returns jsonb
  ```

- **Alcance:** transiciones **1 → 2** (P2C-4) y **4 → 5** (P2C-7); otras etapas rechazadas
- **Roles permitidos:** `mesa_admin`, `mesa_interno`, `mesa_externo`, `super_admin` (vía `can_see_expediente`)
- **Roles bloqueados:** `asesor`, `editor` — **`revisor` no existe en producción**

**1 → 2 (integración → registro)**

- **Gates:** expediente enviado a Mesa; `etapa_actual = 1`; `subestado = en_validacion_mesa`; `cliente_datos.estado = validado`; 10 documentos obligatorios con `estatus_revision = validado`
- **Efecto:** `etapa_actual = 2`, `subestado = en_proceso`
- **Tests:** `supabase/tests/rpc_avanzar_etapa_operativa.sql` (15 pruebas)

**4 → 5 (biométricos → registro IMSS)**

- **Gates:** expediente enviado a Mesa; `etapa_actual = 4`; `fecha_cita IS NOT NULL`; booking `agenda_bookings` con `kind = biometricos` y `status = booked` (no compara fecha/hora exacta vs booking por timezone)
- **Efecto:** `etapa_actual = 5`, `subestado = en_proceso`; **no** modifica `fecha_cita` ni bookings
- **Retorno 4→5:** incluye `booking_id`, `fecha_cita`
- **Tests:** `supabase/tests/rpc_avanzar_etapa_4_5.sql` (18 pruebas)

- **Auditoría (ambas):** `action_log` → `expediente.avanzar_etapa_operativa`

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
- **Nota:** reglas de cupo por slot/`agenda_config` (min lead days, slots) quedan para fase posterior; P2C-6 valida solo fecha futura

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
- **Nota:** sin reglas `agenda_config` (cupo/slot) en P2C-8

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
  seed.sql
  README.md
```

## Próximos archivos

- RPC `save_cliente_datos` (P2C-10)
- Extender `book_biometricos` con reglas `agenda_config` (cupo por slot/location, min lead days)
- Avance etapas **2→3**, **3→4**, **5→6**… (fuera de alcance actual)
- Retención etapa 8 — RPCs de envío/validación retención
- Storage — bucket + policies
- Integración UI P3 — `DATA_MODE=mock|supabase`

## Referencias

- `docs/PRODUCTO.md`
- `docs/ARQUITECTURA_PRODUCCION.md`
- `docs/API_CONTRATOS.md`
- `docs/RIESGOS_PRODUCCION.md`
