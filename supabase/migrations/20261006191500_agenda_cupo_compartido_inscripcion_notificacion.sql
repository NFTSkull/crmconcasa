-- Corrige el cupo compartido Inscripción/Notificación en Monterrey.
-- Ambos usan las mismas filas físicas de Drive (Inscripción 11:00) y el mismo hard-cap diario de 4.
-- La ocupación diaria de Inscripción debe contar bookings kind=notificacion para que UI/gates no anuncien cupo fantasma.

CREATE OR REPLACE FUNCTION public.agenda_daily_active_occupancy(
  p_org uuid,
  p_kind text,
  p_date date,
  p_location text
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH scope AS (
    SELECT
      lower(btrim(COALESCE(p_kind, ''))) AS kind_norm,
      lower(btrim(COALESCE(p_location, ''))) AS loc_norm
  ),
  crm AS (
    SELECT b.id, public.agenda_sheet_normalize_nss(e.nss::TEXT) AS nss_norm
    FROM public.agenda_bookings b
    LEFT JOIN public.expedientes e ON e.id = b.expediente_id
    CROSS JOIN scope s
    WHERE b.organization_id = p_org
      AND (
        b.kind::text = s.kind_norm
        OR (
          s.kind_norm = 'inscripcion'
          AND s.loc_norm = 'monterrey'
          AND b.kind::text = 'notificacion'
        )
      )
      AND b.booking_date = p_date
      AND lower(btrim(COALESCE(b.location_id, ''))) = s.loc_norm
      AND b.status = 'booked'
  ),
  scope_snapshot AS (
    SELECT max(i.sheet_last_seen_at) AS max_seen
    FROM public.agenda_sheet_slot_inventory i
    CROSS JOIN scope s
    WHERE i.organization_id = p_org
      AND i.kind = s.kind_norm
      AND i.booking_date = p_date
      AND i.location_id = s.loc_norm
  ),
  external_raw AS (
    SELECT i.id, i.booking_id,
      lower(COALESCE(i.occupancy_source, '')) AS occupancy_source,
      public.agenda_sheet_normalize_nss(i.visible_nss) AS nss_norm,
      COALESCE(
        NULLIF(btrim(COALESCE(i.manual_occupancy_fingerprint, '')), ''),
        public.agenda_sheet_normalize_nss(i.visible_nss),
        'row:' || i.id::text
      ) AS dedupe_key,
      i.sheet_last_seen_at
    FROM public.agenda_sheet_slot_inventory i
    CROSS JOIN scope s
    WHERE i.organization_id = p_org
      AND i.kind = s.kind_norm
      AND i.booking_date = p_date
      AND i.location_id = s.loc_norm
      AND i.status IN ('occupied_external', 'conflict')
  ),
  external_filtered AS (
    SELECT x.*
    FROM external_raw x
    CROSS JOIN scope_snapshot s
    WHERE (x.booking_id IS NULL OR NOT EXISTS (SELECT 1 FROM crm c WHERE c.id = x.booking_id))
      AND NOT (
        x.nss_norm IS NOT NULL
        AND EXISTS (SELECT 1 FROM crm c WHERE c.nss_norm = x.nss_norm)
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
      CASE x.occupancy_source WHEN 'sheet_webhook' THEN 0 WHEN 'sheet_legacy' THEN 1 ELSE 2 END,
      x.sheet_last_seen_at DESC NULLS LAST,
      x.id
  ),
  orphan_claims AS (
    SELECT count(*)::INTEGER AS n
    FROM public.agenda_sheet_slot_inventory i
    CROSS JOIN scope s
    WHERE i.organization_id = p_org
      AND i.kind = s.kind_norm
      AND i.booking_date = p_date
      AND i.location_id = s.loc_norm
      AND i.status IN ('claimed', 'linked')
      AND (
        i.booking_id IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM public.agenda_bookings b_any WHERE b_any.id = i.booking_id
        )
      )
  )
  SELECT ((SELECT count(*)::INTEGER FROM crm)
    + (SELECT count(*)::INTEGER FROM external_dedup)
    + COALESCE((SELECT n FROM orphan_claims), 0))::INTEGER;
$function$;

COMMENT ON FUNCTION public.agenda_daily_active_occupancy(uuid,text,date,text) IS
  'Ocupación diaria CRM+Sheet. En Inscripción Monterrey cuenta también Notificación porque ambos comparten el mismo pool físico/cupo de 4.';

CREATE OR REPLACE FUNCTION public.agenda_notificacion_claim_inscripcion_ai()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_inv_id UUID;
  v_location TEXT;
  v_cap INTEGER;
  v_occ INTEGER;
BEGIN
  IF NEW.kind::TEXT <> 'notificacion' OR NEW.status::TEXT <> 'booked' THEN
    RETURN NEW;
  END IF;

  v_location := lower(btrim(COALESCE(NEW.location_id, '')));

  IF v_location <> 'monterrey' THEN
    RETURN NEW;
  END IF;

  IF NOT public.agenda_sheet_inventory_enforced(NEW.booking_date) THEN
    RETURN NEW;
  END IF;

  IF NOT public.agenda_sheet_inventory_applies(v_location) THEN
    RETURN NEW;
  END IF;

  v_cap := public.agenda_daily_capacity(
    NEW.organization_id, 'inscripcion', NEW.booking_date, v_location
  );

  IF v_cap IS NOT NULL THEN
    PERFORM public.agenda_daily_capacity_lock(
      NEW.organization_id, 'inscripcion', NEW.booking_date, v_location
    );

    v_occ :=
      public.agenda_daily_active_occupancy(
        NEW.organization_id, 'inscripcion', NEW.booking_date, v_location
      )
      + public.agenda_crm_manual_daily_count(
        NEW.organization_id, 'inscripcion', NEW.booking_date, v_location
      );

    IF v_occ > v_cap THEN
      RAISE EXCEPTION
        'SIN_CUPO_DIA: El cupo compartido de Inscripción/Notificación está completo (máximo 4 personas en Monterrey).'
        USING ERRCODE='22023';
    END IF;
  END IF;

  SELECT i.id
  INTO v_inv_id
  FROM public.agenda_sheet_slot_inventory i
  WHERE i.organization_id = NEW.organization_id
    AND i.booking_date = NEW.booking_date
    AND i.kind = 'inscripcion'
    AND i.location_id = v_location
    AND i.status = 'available'
    AND (
      i.sheet_slot_time = TIME '11:00'
      OR (i.sheet_slot_time IS NULL AND i.slot_time = TIME '11:00')
    )
  ORDER BY i.sheet_row
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF v_inv_id IS NULL THEN
    RAISE EXCEPTION 'SIN_CUPO_REAL_EN_SHEET'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.agenda_sheet_slot_inventory i
  SET
    status = 'claimed',
    booking_id = NEW.id,
    expediente_id = NEW.expediente_id,
    claimed_at = NOW(),
    linked_at = NULL,
    occupancy_source = 'crm',
    manual_occupancy_fingerprint = NULL,
    last_error = NULL,
    updated_at = NOW()
  WHERE i.id = v_inv_id;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.agenda_notificacion_claim_inscripcion_ai() IS
  'Notificación Monterrey reclama una fila física de Inscripción y comparte su hard-cap diario de 4.';
