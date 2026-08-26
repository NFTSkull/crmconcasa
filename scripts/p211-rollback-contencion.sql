-- P211 local rollback de contención (NO Cloud).
-- 1) Desactiva trigger / assert → P211 inert.
-- 2) Opcional: restaurar RPCs pre-assert desde scripts/p211-rollback-rpc-snapshots/*.sql
-- Columnas nullable pueden permanecer (más seguro en emergencia).
-- NO borrar documentos ni mutar expedientes reales.

BEGIN;

DROP TRIGGER IF EXISTS trg_expedientes_vigencia_documental_biu ON public.expedientes;

CREATE OR REPLACE FUNCTION public.assert_expediente_vigencia_documental_ok(p_expediente_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object('applicable', false, 'reason', 'p211_disabled');
$$;

COMMENT ON FUNCTION public.assert_expediente_vigencia_documental_ok(UUID) IS
  'P211 DISABLED (rollback contención).';

COMMIT;

-- Después (fuera de esta TX si preferís):
--   psql -f scripts/p211-rollback-rpc-snapshots/book_biometricos.sql
--   ... resto de snapshots ...
--   (opcional) restaurar mesa_mover_etapa_operativa sin set_config skip
