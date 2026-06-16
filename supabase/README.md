# Supabase — ConCasa CRM (P1)

Migraciones SQL para producción. **No conectadas a la UI mock** en esta fase.

## Estado (P2B / P2C)

| Item | Estado |
|------|--------|
| `migrations/001`–`004` | ✅ Schema, RLS, auditoría, RPC `update_documento_revision` |
| `migrations/005_rpc_enviar_a_mesa.sql` | ✅ RPC `enviar_a_mesa` (P2C-3) |
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
  tests/
    rls_policies.sql
    audit_document_history.sql
    rpc_documento_revision.sql
    rpc_enviar_a_mesa.sql
  seed.sql
  README.md
```

## Próximos archivos

- `avanzar_etapa_operativa` — Mesa avanza etapa operativa (p. ej. 1→2 tras validar integración)
- `book_biometricos` — agenda biométricos
- Storage — bucket + policies

## Referencias

- `docs/PRODUCTO.md`
- `docs/ARQUITECTURA_PRODUCCION.md`
- `docs/API_CONTRATOS.md`
- `docs/RIESGOS_PRODUCCION.md`
