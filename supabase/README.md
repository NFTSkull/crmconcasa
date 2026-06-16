# Supabase — ConCasa CRM (P1)

Migraciones SQL para producción. **No conectadas a la UI mock** en esta fase.

## Estado (P2B / P2C)

| Item | Estado |
|------|--------|
| `migrations/001`–`004` | ✅ Schema, RLS, auditoría, RPC `update_documento_revision` |
| `migrations/005_rpc_enviar_a_mesa.sql` | ✅ RPC `enviar_a_mesa` (P2C-3) |
| `migrations/006_rpc_avanzar_etapa_operativa.sql` | ✅ RPC `avanzar_etapa_operativa` (P2C-4) |
| `migrations/007_rpc_book_biometricos.sql` | ✅ RPC `book_biometricos` (P2C-6) |
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

### RPC `avanzar_etapa_operativa` (P2C-4)

- **Función:**

  ```sql
  public.avanzar_etapa_operativa(
    p_expediente_id uuid,
    p_comentario text default null
  ) returns jsonb
  ```

- **Alcance:** solo transición **1 → 2** (integración → registro)
- **Roles permitidos:** `mesa_admin`, `mesa_interno`, `mesa_externo`, `super_admin` (vía `can_see_expediente`)
- **Roles bloqueados:** `asesor`, `editor` — **`revisor` no existe en producción**
- **Gates:** expediente enviado a Mesa; `etapa_actual = 1`; `subestado = en_validacion_mesa`; `cliente_datos.estado = validado`; 10 documentos obligatorios con `estatus_revision = validado` (opcionales no bloquean)
- **Efecto:** `etapa_actual = 2`, `subestado = en_proceso`, `updated_at = now()`
- **Auditoría:** `action_log` → `expediente.avanzar_etapa_operativa`
- **Tests:** `supabase/tests/rpc_avanzar_etapa_operativa.sql`

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
  tests/
    rls_policies.sql
    audit_document_history.sql
    rpc_documento_revision.sql
    rpc_enviar_a_mesa.sql
    rpc_avanzar_etapa_operativa.sql
    rpc_book_biometricos.sql
  seed.sql
  README.md
```

## Próximos archivos

- Extender `book_biometricos` con reglas `agenda_config` (cupo por slot/location, min lead days)
- Cancelación / reagenda de cita biométrica (RPC separada)
- Avance etapa **4→5** (RPC separada)
- Retención etapa 8 — RPCs de envío/validación retención
- Storage — bucket + policies
- Integración UI P3 — `DATA_MODE=mock|supabase`

## Referencias

- `docs/PRODUCTO.md`
- `docs/ARQUITECTURA_PRODUCCION.md`
- `docs/API_CONTRATOS.md`
- `docs/RIESGOS_PRODUCCION.md`
