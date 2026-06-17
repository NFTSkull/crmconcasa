-- ConCasa CRM — P2C-21 backfill agenda_config firmas por organización (deploy producción)

-- =============================================================================
-- backfill_agenda_config_firmas
-- Inserta config canónica kind=firmas solo donde falta. No modifica filas existentes.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.backfill_agenda_config_firmas()
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_inserted INTEGER := 0;
BEGIN
  WITH ins AS (
    INSERT INTO public.agenda_config (organization_id, kind, config)
    SELECT
      o.id,
      'firmas'::public.booking_kind,
      public.agenda_firmas_normalize_config('{}'::jsonb)
    FROM public.organizations o
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.agenda_config ac
      WHERE ac.organization_id = o.id
        AND ac.kind = 'firmas'
    )
    ON CONFLICT (organization_id, kind) DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*)::INTEGER INTO v_inserted FROM ins;

  RETURN jsonb_build_object(
    'ok', true,
    'inserted', v_inserted
  );
END;
$$;

COMMENT ON FUNCTION public.backfill_agenda_config_firmas() IS
  'Backfill idempotente: agenda_config kind=firmas canónica por organización sin fila firmas. No borra ni actualiza existentes.';

SELECT public.backfill_agenda_config_firmas();
