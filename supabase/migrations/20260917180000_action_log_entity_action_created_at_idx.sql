-- P230-ish: índice para mesa_asesor_cambio_recover_empty_lote (action_log por entity_id+action+created_at).
-- Sin tocar funciones Mesa. Solo DDL de índice.
--
-- IMPORTANTE: CREATE INDEX CONCURRENTLY no puede correr dentro de una transacción.
-- Aplicar este archivo con autocommit / fuera de supabase db push empaquetado, p.ej.:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260917180000_action_log_entity_action_created_at_idx.sql
-- o equivalente linked query sin BEGIN implícito.
-- En local (tabla chica) también es válido; si el runner fuerza transacción, usar en su lugar:
--   CREATE INDEX IF NOT EXISTS … (sin CONCURRENTLY) solo en entornos de lab.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_action_log_entity_action_created_at
  ON public.action_log (entity_id, action, created_at);

COMMENT ON INDEX public.idx_action_log_entity_action_created_at IS
  'Soporta lookups action_log por entity_id+action+created_at (recover empty lote Mesa / cliente_datos.*).';
