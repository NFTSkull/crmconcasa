# ConCasa CRM — Plan de pruebas

## Libertad operativa de Mesa (P074/P075)

### SQL

- Runner: `scripts/preflight-reingreso-isolated.sh`.
- Base descartable; aplica migraciones productivas en orden y omite 061 conforme al preflight vigente.
- `rpc_mesa_mover_etapa_operativa.sql`: roles/origen/org, etapas 1–12, estados excluidos, etapa esperada, evento único, RLS/inmutabilidad, rollback y preservación de relaciones.
- `rpc_mesa_gestion_firmas.sql`: alta/reagenda/cancelación por cuatro roles Mesa, visibilidad, etapa/fecha/cupo, conservación de etapa/booking y regresión del flujo asesor.
- Regresiones incluidas: RLS, P070, P071/P072, documentos, retención, editor y avances normales.

### TypeScript/UI

- Zod valida entrada y respuesta de todas las RPC nuevas.
- Pruebas de modelo: roles, visibilidad, etapas, motivo, `saving`, errores estables, advertencias y booking fuera de 9/10.
- Comandos obligatorios: `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`.

### Validación sin datos reales

1. Usar exclusivamente la base descartable local y fixtures UUID P074/P075.
2. Confirmar que el runner elimina la base al finalizar.
3. No conectar el proyecto local a Supabase Cloud durante Fase C.
4. Revisar `git diff` para confirmar que 001–073, P070, 051 y 061 permanecen sin cambios.
