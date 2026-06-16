# Supabase — ConCasa CRM (P1)

Migraciones SQL para producción. **No conectadas a la UI mock** en esta fase.

## Estado (P2B / P2C)

| Item | Estado |
|------|--------|
| `migrations/001`–`004` | ✅ Schema, RLS, auditoría, RPC `update_documento_revision` |
| `migrations/005_rpc_enviar_a_mesa.sql` | ✅ RPC `enviar_a_mesa` (P2C-3) |
| `migrations/006_rpc_avanzar_etapa_operativa.sql` | ✅ RPC `avanzar_etapa_operativa` (P2C-4) |
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

## Aplicar migración (cuando exista CLI)

```bash
# Instalar CLI: https://supabase.com/docs/guides/cli
supabase init          # solo una vez, si no hay config
supabase start         # Postgres local
supabase db reset      # aplica migrations/
```

**No ejecutar** `supabase db push` contra producción sin revisión de seguridad y backup.

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
  tests/
    rls_policies.sql
    audit_document_history.sql
    rpc_documento_revision.sql
    rpc_enviar_a_mesa.sql
    rpc_avanzar_etapa_operativa.sql
  seed.sql
  README.md
```

## Próximos archivos

- Script npm `test:sql` — ejecutar las 5 suites SQL en orden
- `book_biometricos` — agenda biométricos (etapa 4)
- Retención etapa 8 — RPCs de envío/validación retención
- Storage — bucket + policies
- Integración UI P3 — `DATA_MODE=mock|supabase`

## Referencias

- `docs/PRODUCTO.md`
- `docs/ARQUITECTURA_PRODUCCION.md`
- `docs/API_CONTRATOS.md`
- `docs/RIESGOS_PRODUCCION.md`
