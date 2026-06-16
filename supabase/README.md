# Supabase — ConCasa CRM (P1)

Migraciones SQL para producción. **No conectadas a la UI mock** en esta fase.

## Estado P1

| Item | Estado |
|------|--------|
| `migrations/001_core_schema.sql` | ✅ Creado |
| Supabase CLI local | ❌ No detectada en entorno dev |
| Proyecto remoto vinculado | ❌ No configurado |
| Policies RLS | TODO P2/P6 (RLS ON, deny-by-default) |

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
    001_core_schema.sql   # enums + 14 tablas + RLS enabled
  README.md
```

## Próximos archivos (fuera P1)

- `002_rls_policies.sql` — asesor, editor, mesa interno/externo, admin
- `003_rpc_operativo.sql` — enviar_mesa, avanzar_etapa, book_biometricos
- `004_storage.sql` — bucket + policies
- `seed/dev.sql` — org ConCasa + usuarios prueba (nunca datos mock reales)

## Referencias

- `docs/PRODUCTO.md`
- `docs/ARQUITECTURA_PRODUCCION.md`
- `docs/API_CONTRATOS.md`
- `docs/RIESGOS_PRODUCCION.md`
