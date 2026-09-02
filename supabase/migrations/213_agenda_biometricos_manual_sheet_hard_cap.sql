-- ConCasa CRM — P213: hard-cap end-to-end Biométricos Monterrey = 15.
-- Objetivo: evitar que ocupaciones manuales del Sheet / inventario fantasma
-- permitan o aparenten una persona #16. No cancela ni mueve bookings existentes.

-- 1) Read-model diario robusto: CRM booked + manuales reales deduplicados.
--    Filas reconciliation viejas no deben inflar el cupo tras corrimientos/reagendos.
CREATE OR REPLACE FUNCTION public.agenda_daily_active_occupancy(
  p_org UUID,
  p_kind TEXT,
  p_date DATE,
  p_location TEXT
)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH crm AS (
    SELECT
      b.id,
      regexp_replace(COALESCE(e.nss, ''), '\D', '', 'g') AS nss_norm
    FROM public.agenda_bookings b
    LEFT JOIN public.expedientes e ON e.id = b.expediente_id
    WHERE b.organization_id = p_org
      AND b.kind::text = lower(btrim(COALESCE(p_kind, '')))
      AND b.booking_date = p_date
      AND b.location_id = lower(btrim(COALESCE(p_location, '')))
      AND b.status = 'booked'
  ),
  scope_snapshot AS (
    SELECT max(i.sheet_last_seen_at) AS max_seen
    FROM public.agenda_sheet_slot_inventory i
    WHERE i.organization_id = p_org
      AND i.kind = lower(btrim(COALESCE(p_kind, '')))
      AND i.booking_date = p_date
      AND i.location_id = lower(btrim(COALESCE(p_location, '')))
  ),
  external_raw AS (
    SELECT
      i.id,
      i.booking_id,
      lower(COALESCE(i.occupancy_source, '')) AS occupancy_source,
      regexp_replace(COALESCE(i.visible_nss, ''), '\D', '', 'g') AS nss_norm,
      COALESCE(
        NULLIF(btrim(COALESCE(i.manual_occupancy_fingerprint, '')), ''),
        NULLIF(regexp_replace(COALESCE(i.visible_nss, ''), '\D', '', 'g'), ''),
        'row:' || i.id::text
      ) AS dedupe_key,
      i.sheet_last_seen_at
    FROM public.agenda_sheet_slot_inventory i
    WHERE i.organization_id = p_org
      AND i.kind = lower(btrim(COALESCE(p_kind, '')))
      AND i.booking_date = p_date
      AND i.location_id = lower(btrim(COALESCE(p_location, '')))
      AND i.status IN ('occupied_external', 'conflict')
  ),
  external_filtered AS (
    SELECT x.*
    FROM external_raw x
    CROSS JOIN scope_snapshot s
    WHERE (x.booking_id IS NULL OR NOT EXISTS (SELECT 1 FROM crm c WHERE c.id = x.booking_id))
      AND NOT (
        x.nss_norm <> ''
        AND EXISTS (SELECT 1 FROM crm c WHERE c.nss_norm <> '' AND c.nss_norm = x.nss_norm)
      )
      AND (
        x.occupancy_source <> 'reconciliation'
        OR s.max_seen IS NULL
        OR x.sheet_last_seen_at IS NULL
        OR x.sheet_last_seen_at >= s.max_seen - interval '5 seconds'
      )
  ),
  external_dedup AS (
    SELECT DISTINCT ON (x.dedupe_key) x.dedupe_key
    FROM external_filtered x
    ORDER BY x.dedupe_key,
      CASE x.occupancy_source
        WHEN 'sheet_webhook' THEN 0
        WHEN 'sheet_legacy' THEN 1
        ELSE 2
      END,
      x.sheet_last_seen_at DESC NULLS LAST,
      x.id
  ),
  orphan_claims AS (
    SELECT count(*)::INTEGER AS n
    FROM public.agenda_sheet_slot_inventory i
    WHERE i.organization_id = p_org
      AND i.kind = lower(btrim(COALESCE(p_kind, '')))
      AND i.booking_date = p_date
      AND i.location_id = lower(btrim(COALESCE(p_location, '')))
      AND i.status IN ('claimed', 'linked')
      AND (
        i.booking_id IS NULL
        OR NOT EXISTS (SELECT 1 FROM crm c WHERE c.id = i.booking_id)
      )
  )
  SELECT (
    (SELECT count(*)::INTEGER FROM crm)
    + (SELECT count(*)::INTEGER FROM external_dedup)
    + COALESCE((SELECT n FROM orphan_claims), 0)
  )::INTEGER;
$$;

COMMENT ON FUNCTION public.agenda_daily_active_occupancy(UUID,TEXT,DATE,TEXT) IS
  'P213: occupancy diario deduplica manuales por fingerprint/NSS y excluye reconciliation stale/duplicada; CRM booked manda.';

-- 2) Tras una lectura completa del Sheet, desactivar solo inventario físico ya inexistente.
--    Nunca toca linked/claimed ni filas con booking_id.
CREATE OR REPLACE FUNCTION public.agenda_sheet_inventory_prune_scope(
  p_organization_id UUID,
  p_spreadsheet_id TEXT,
  p_sheet_id BIGINT,
  p_booking_date DATE,
  p_kind TEXT,
  p_location_id TEXT,
  p_seen_rows INTEGER[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pruned INTEGER := 0;
BEGIN
  PERFORM public.agenda_sheet_assert_service_role();

  IF p_organization_id IS NULL
     OR NULLIF(btrim(COALESCE(p_spreadsheet_id, '')), '') IS NULL
     OR p_sheet_id IS NULL
     OR p_booking_date IS NULL
     OR NULLIF(btrim(COALESCE(p_kind, '')), '') IS NULL
     OR NULLIF(btrim(COALESCE(p_location_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'agenda_sheet_inventory_prune_scope: parámetros requeridos'
      USING ERRCODE = '22023';
  END IF;

  IF public.agenda_daily_capacity(
       p_organization_id,
       lower(btrim(p_kind)),
       p_booking_date,
       lower(btrim(p_location_id))
     ) IS NOT NULL THEN
    PERFORM public.agenda_advisory_lock_daily_capacity(
      p_organization_id,
      lower(btrim(p_kind)),
      p_booking_date,
      lower(btrim(p_location_id))
    );
  END IF;

  UPDATE public.agenda_sheet_slot_inventory i
  SET
    status = 'disabled',
    booking_id = NULL,
    expediente_id = NULL,
    claimed_at = NULL,
    linked_at = NULL,
    visible_nss = NULL,
    visible_name = NULL,
    visible_advisor = NULL,
    manual_occupancy_fingerprint = NULL,
    occupancy_source = 'reconciliation',
    last_error = NULL,
    updated_at = NOW()
  WHERE i.organization_id = p_organization_id
    AND i.spreadsheet_id = p_spreadsheet_id
    AND i.sheet_id = p_sheet_id
    AND i.booking_date = p_booking_date
    AND i.kind = lower(btrim(p_kind))
    AND i.location_id = lower(btrim(p_location_id))
    AND i.booking_id IS NULL
    AND i.status IN ('available', 'occupied_external', 'conflict')
    AND NOT (i.sheet_row = ANY(COALESCE(p_seen_rows, ARRAY[]::INTEGER[])));

  GET DIAGNOSTICS v_pruned = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'pruned', v_pruned);
END;
$$;

-- 3) Después de rechazar una captura manual nueva, liberar únicamente esa fila
--    si no pertenece a ningún booking. El caller limpia B:D + O:U del Sheet primero.
CREATE OR REPLACE FUNCTION public.agenda_sheet_release_rejected_manual_row(
  p_organization_id UUID,
  p_spreadsheet_id TEXT,
  p_sheet_id BIGINT,
  p_sheet_row INTEGER,
  p_booking_date DATE,
  p_kind TEXT,
  p_location_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_released INTEGER := 0;
BEGIN
  PERFORM public.agenda_sheet_assert_service_role();

  IF public.agenda_daily_capacity(
       p_organization_id,
       lower(btrim(p_kind)),
       p_booking_date,
       lower(btrim(p_location_id))
     ) IS NOT NULL THEN
    PERFORM public.agenda_advisory_lock_daily_capacity(
      p_organization_id,
      lower(btrim(p_kind)),
      p_booking_date,
      lower(btrim(p_location_id))
    );
  END IF;

  UPDATE public.agenda_sheet_slot_inventory i
  SET
    status = 'available',
    booking_id = NULL,
    expediente_id = NULL,
    claimed_at = NULL,
    linked_at = NULL,
    visible_nss = NULL,
    visible_name = NULL,
    visible_advisor = NULL,
    manual_occupancy_fingerprint = NULL,
    occupancy_source = 'reconciliation',
    last_error = NULL,
    observed_at = NOW(),
    sheet_last_seen_at = NOW(),
    updated_at = NOW()
  WHERE i.organization_id = p_organization_id
    AND i.spreadsheet_id = p_spreadsheet_id
    AND i.sheet_id = p_sheet_id
    AND i.sheet_row = p_sheet_row
    AND i.booking_date = p_booking_date
    AND i.kind = lower(btrim(p_kind))
    AND i.location_id = lower(btrim(p_location_id))
    AND i.booking_id IS NULL
    AND i.status IN ('occupied_external', 'conflict', 'available');

  GET DIAGNOSTICS v_released = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'released', v_released);
END;
$$;

REVOKE ALL ON FUNCTION public.agenda_sheet_inventory_prune_scope(UUID,TEXT,BIGINT,DATE,TEXT,TEXT,INTEGER[])
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agenda_sheet_release_rejected_manual_row(UUID,TEXT,BIGINT,INTEGER,DATE,TEXT,TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_sheet_inventory_prune_scope(UUID,TEXT,BIGINT,DATE,TEXT,TEXT,INTEGER[])
  TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.agenda_sheet_release_rejected_manual_row(UUID,TEXT,BIGINT,INTEGER,DATE,TEXT,TEXT)
  TO service_role, postgres;
