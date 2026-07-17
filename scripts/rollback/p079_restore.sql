-- Rollback P079: restaura definiciones previas de enviar_retencion_mesa
-- y avanzar_etapa_operativa_pre_reingreso (snapshots capturados pre-cambio).
-- NO ejecutar en Cloud sin autorización. Fuera de migraciones publicadas.
--
-- Uso (local/aislada):
--   psql ... -f scripts/rollback/p079_pre_enviar_retencion_mesa.sql
--   psql ... -f scripts/rollback/p079_pre_avanzar_etapa_operativa_pre_reingreso.sql
--   psql ... -f scripts/rollback/p079_restore_grants.sql
--
-- Tras restaurar cuerpos, reaplicar grants de 017:

\ir p079_pre_enviar_retencion_mesa.sql
\ir p079_pre_avanzar_etapa_operativa_pre_reingreso.sql

REVOKE ALL ON FUNCTION public.enviar_retencion_mesa(UUID, public.retencion_opcion) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enviar_retencion_mesa(UUID, public.retencion_opcion) FROM anon;
GRANT EXECUTE ON FUNCTION public.enviar_retencion_mesa(UUID, public.retencion_opcion) TO authenticated;

COMMENT ON FUNCTION public.enviar_retencion_mesa(UUID, public.retencion_opcion) IS
  'Asesor dueño envía o reenvía bloque Acuse/Aviso retención (etapa 8). No cambia etapa_actual.';
