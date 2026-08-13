-- ConCasa CRM — P180 B1: color + texto → effective_result (KPI Bernardo)
-- Migration 178 (B1.1; 177 tomado por admin buscar NSS). NO activa P170 APPLY.
-- KPI: projection_status=CURRENT AND *_effective_result=COMPLETED_CURRENT.

-- =============================================================================
-- 1) Columnas P180
-- =============================================================================
ALTER TABLE public.agenda_sheet_operational_results
  ADD COLUMN IF NOT EXISTS biometric_color TEXT NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS notification_color TEXT NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS signature_color TEXT NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS biometric_effective_result TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS notification_effective_result TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS signature_effective_result TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS projection_status TEXT NOT NULL DEFAULT 'CURRENT';

ALTER TABLE public.agenda_sheet_operational_results
  DROP CONSTRAINT IF EXISTS agenda_sheet_ops_biometric_color_chk;
ALTER TABLE public.agenda_sheet_operational_results
  ADD CONSTRAINT agenda_sheet_ops_biometric_color_chk
  CHECK (biometric_color IN ('GREEN', 'RED', 'ORANGE', 'OTHER', 'UNKNOWN'));

ALTER TABLE public.agenda_sheet_operational_results
  DROP CONSTRAINT IF EXISTS agenda_sheet_ops_notification_color_chk;
ALTER TABLE public.agenda_sheet_operational_results
  ADD CONSTRAINT agenda_sheet_ops_notification_color_chk
  CHECK (notification_color IN ('GREEN', 'RED', 'ORANGE', 'OTHER', 'UNKNOWN'));

ALTER TABLE public.agenda_sheet_operational_results
  DROP CONSTRAINT IF EXISTS agenda_sheet_ops_signature_color_chk;
ALTER TABLE public.agenda_sheet_operational_results
  ADD CONSTRAINT agenda_sheet_ops_signature_color_chk
  CHECK (signature_color IN ('GREEN', 'RED', 'ORANGE', 'OTHER', 'UNKNOWN'));

ALTER TABLE public.agenda_sheet_operational_results
  DROP CONSTRAINT IF EXISTS agenda_sheet_ops_biometric_effective_chk;
ALTER TABLE public.agenda_sheet_operational_results
  ADD CONSTRAINT agenda_sheet_ops_biometric_effective_chk
  CHECK (biometric_effective_result IN (
    'COMPLETED_CURRENT', 'COMPLETED_HISTORICAL', 'FAILED',
    'REBOOK_REQUIRED', 'PENDING', 'MANUAL_REVIEW'
  ));

ALTER TABLE public.agenda_sheet_operational_results
  DROP CONSTRAINT IF EXISTS agenda_sheet_ops_notification_effective_chk;
ALTER TABLE public.agenda_sheet_operational_results
  ADD CONSTRAINT agenda_sheet_ops_notification_effective_chk
  CHECK (notification_effective_result IN (
    'COMPLETED_CURRENT', 'COMPLETED_HISTORICAL', 'FAILED',
    'REBOOK_REQUIRED', 'PENDING', 'MANUAL_REVIEW'
  ));

ALTER TABLE public.agenda_sheet_operational_results
  DROP CONSTRAINT IF EXISTS agenda_sheet_ops_signature_effective_chk;
ALTER TABLE public.agenda_sheet_operational_results
  ADD CONSTRAINT agenda_sheet_ops_signature_effective_chk
  CHECK (signature_effective_result IN (
    'COMPLETED_CURRENT', 'COMPLETED_HISTORICAL', 'FAILED',
    'REBOOK_REQUIRED', 'PENDING', 'MANUAL_REVIEW'
  ));

ALTER TABLE public.agenda_sheet_operational_results
  DROP CONSTRAINT IF EXISTS agenda_sheet_ops_projection_status_chk;
ALTER TABLE public.agenda_sheet_operational_results
  ADD CONSTRAINT agenda_sheet_ops_projection_status_chk
  CHECK (projection_status IN (
    'CURRENT', 'STALE', 'IDENTITY_CONFLICT', 'UNLINKED'
  ));

COMMENT ON COLUMN public.agenda_sheet_operational_results.biometric_color IS
  'P180: OperationalColor col E (BIOMETRICOS).';
COMMENT ON COLUMN public.agenda_sheet_operational_results.notification_color IS
  'P180: OperationalColor col F (NOTIFICACION bio).';
COMMENT ON COLUMN public.agenda_sheet_operational_results.signature_color IS
  'P180: OperationalColor col F FIRMO (FIRMAS).';
COMMENT ON COLUMN public.agenda_sheet_operational_results.biometric_effective_result IS
  'P180: color+texto+contexto biométricos (autoridad KPI).';
COMMENT ON COLUMN public.agenda_sheet_operational_results.notification_effective_result IS
  'P180: color+texto+contexto notificación (autoridad KPI).';
COMMENT ON COLUMN public.agenda_sheet_operational_results.signature_effective_result IS
  'P180: color+texto+contexto firma (autoridad KPI).';
COMMENT ON COLUMN public.agenda_sheet_operational_results.projection_status IS
  'P180: CURRENT|STALE|IDENTITY_CONFLICT|UNLINKED. KPI solo CURRENT.';

CREATE INDEX IF NOT EXISTS agenda_sheet_ops_p180_kpi_idx
  ON public.agenda_sheet_operational_results (
    organization_id, booking_date, projection_status, kind
  );

-- =============================================================================
-- 2) Upsert batch (extiende P175; no pisa last_applied_*)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.agenda_sheet_ops_upsert_batch(p_rows JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_elem JSONB;
  v_count INTEGER := 0;
  v_class_ok TEXT[] := ARRAY[
    'COMPLETED', 'FAILED_OR_NOT_ATTENDED', 'PENDING', 'UNKNOWN'
  ];
  v_color_ok TEXT[] := ARRAY[
    'GREEN', 'RED', 'ORANGE', 'OTHER', 'UNKNOWN'
  ];
  v_eff_ok TEXT[] := ARRAY[
    'COMPLETED_CURRENT', 'COMPLETED_HISTORICAL', 'FAILED',
    'REBOOK_REQUIRED', 'PENDING', 'MANUAL_REVIEW'
  ];
  v_proj_ok TEXT[] := ARRAY[
    'CURRENT', 'STALE', 'IDENTITY_CONFLICT', 'UNLINKED'
  ];
BEGIN
  PERFORM public.agenda_sheet_assert_service_role();

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'agenda_sheet_ops_upsert_batch: p_rows debe ser array JSON'
      USING ERRCODE = '22023';
  END IF;

  FOR v_elem IN
    SELECT e.elem
    FROM jsonb_array_elements(p_rows) AS e(elem)
  LOOP
    IF NULLIF(btrim(COALESCE(v_elem->>'spreadsheet_id', '')), '') IS NULL
      OR NULLIF(btrim(COALESCE(v_elem->>'sheet_id', '')), '') IS NULL
      OR NULLIF(btrim(COALESCE(v_elem->>'sheet_row', '')), '') IS NULL
      OR NULLIF(btrim(COALESCE(v_elem->>'booking_date', '')), '') IS NULL
      OR NULLIF(btrim(COALESCE(v_elem->>'kind', '')), '') IS NULL
      OR NULLIF(btrim(COALESCE(v_elem->>'location_id', '')), '') IS NULL
      OR NULLIF(btrim(COALESCE(v_elem->>'organization_id', '')), '') IS NULL
    THEN
      CONTINUE;
    END IF;

    IF lower(btrim(v_elem->>'kind')) NOT IN ('biometricos', 'firmas') THEN
      CONTINUE;
    END IF;
    IF lower(btrim(v_elem->>'location_id')) NOT IN ('monterrey', 'apodaca') THEN
      CONTINUE;
    END IF;

    IF NOT (
      COALESCE(v_elem->>'biometric_result_class', 'PENDING') = ANY (v_class_ok)
      AND COALESCE(v_elem->>'notification_result_class', 'PENDING') = ANY (v_class_ok)
      AND COALESCE(v_elem->>'signature_result_class', 'PENDING') = ANY (v_class_ok)
    ) THEN
      CONTINUE;
    END IF;

    IF NOT (
      COALESCE(v_elem->>'biometric_color', 'UNKNOWN') = ANY (v_color_ok)
      AND COALESCE(v_elem->>'notification_color', 'UNKNOWN') = ANY (v_color_ok)
      AND COALESCE(v_elem->>'signature_color', 'UNKNOWN') = ANY (v_color_ok)
    ) THEN
      CONTINUE;
    END IF;

    IF NOT (
      COALESCE(v_elem->>'biometric_effective_result', 'PENDING') = ANY (v_eff_ok)
      AND COALESCE(v_elem->>'notification_effective_result', 'PENDING') = ANY (v_eff_ok)
      AND COALESCE(v_elem->>'signature_effective_result', 'PENDING') = ANY (v_eff_ok)
    ) THEN
      CONTINUE;
    END IF;

    IF NOT (
      COALESCE(v_elem->>'projection_status', 'CURRENT') = ANY (v_proj_ok)
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.agenda_sheet_operational_results AS t (
      organization_id,
      spreadsheet_id,
      sheet_id,
      sheet_title,
      booking_date,
      sheet_row,
      kind,
      location_id,
      slot_time,
      booking_id,
      expediente_id,
      biometric_result_class,
      biometric_result_raw,
      notification_result_class,
      notification_result_raw,
      signature_result_class,
      signature_result_raw,
      notes_raw,
      biometric_cell_red,
      notification_cell_red,
      signature_cell_red,
      operational_red_veto,
      inscripcion_rebook_required,
      inscripcion_rebook_reason_raw,
      biometric_color,
      notification_color,
      signature_color,
      biometric_effective_result,
      notification_effective_result,
      signature_effective_result,
      projection_status,
      last_seen_at
    ) VALUES (
      (v_elem->>'organization_id')::UUID,
      btrim(v_elem->>'spreadsheet_id'),
      (v_elem->>'sheet_id')::BIGINT,
      COALESCE(NULLIF(btrim(v_elem->>'sheet_title'), ''), '(sin título)'),
      (v_elem->>'booking_date')::DATE,
      (v_elem->>'sheet_row')::INTEGER,
      lower(btrim(v_elem->>'kind')),
      lower(btrim(v_elem->>'location_id')),
      NULLIF(btrim(COALESCE(v_elem->>'slot_time', '')), '')::TIME,
      NULLIF(btrim(COALESCE(v_elem->>'booking_id', '')), '')::UUID,
      NULLIF(btrim(COALESCE(v_elem->>'expediente_id', '')), '')::UUID,
      COALESCE(v_elem->>'biometric_result_class', 'PENDING'),
      NULLIF(btrim(COALESCE(v_elem->>'biometric_result_raw', '')), ''),
      COALESCE(v_elem->>'notification_result_class', 'PENDING'),
      NULLIF(btrim(COALESCE(v_elem->>'notification_result_raw', '')), ''),
      COALESCE(v_elem->>'signature_result_class', 'PENDING'),
      NULLIF(btrim(COALESCE(v_elem->>'signature_result_raw', '')), ''),
      NULLIF(btrim(COALESCE(v_elem->>'notes_raw', '')), ''),
      COALESCE((v_elem->>'biometric_cell_red')::BOOLEAN, false),
      COALESCE((v_elem->>'notification_cell_red')::BOOLEAN, false),
      COALESCE((v_elem->>'signature_cell_red')::BOOLEAN, false),
      COALESCE((v_elem->>'operational_red_veto')::BOOLEAN, false),
      COALESCE((v_elem->>'inscripcion_rebook_required')::BOOLEAN, false),
      NULLIF(btrim(COALESCE(v_elem->>'inscripcion_rebook_reason_raw', '')), ''),
      COALESCE(v_elem->>'biometric_color', 'UNKNOWN'),
      COALESCE(v_elem->>'notification_color', 'UNKNOWN'),
      COALESCE(v_elem->>'signature_color', 'UNKNOWN'),
      COALESCE(v_elem->>'biometric_effective_result', 'PENDING'),
      COALESCE(v_elem->>'notification_effective_result', 'PENDING'),
      COALESCE(v_elem->>'signature_effective_result', 'PENDING'),
      COALESCE(v_elem->>'projection_status', 'CURRENT'),
      COALESCE(
        NULLIF(btrim(COALESCE(v_elem->>'last_seen_at', '')), '')::TIMESTAMPTZ,
        NOW()
      )
    )
    ON CONFLICT (spreadsheet_id, sheet_id, sheet_row) DO UPDATE SET
      organization_id = EXCLUDED.organization_id,
      sheet_title = EXCLUDED.sheet_title,
      booking_date = EXCLUDED.booking_date,
      kind = EXCLUDED.kind,
      location_id = EXCLUDED.location_id,
      slot_time = EXCLUDED.slot_time,
      booking_id = EXCLUDED.booking_id,
      expediente_id = EXCLUDED.expediente_id,
      biometric_result_class = EXCLUDED.biometric_result_class,
      biometric_result_raw = EXCLUDED.biometric_result_raw,
      notification_result_class = EXCLUDED.notification_result_class,
      notification_result_raw = EXCLUDED.notification_result_raw,
      signature_result_class = EXCLUDED.signature_result_class,
      signature_result_raw = EXCLUDED.signature_result_raw,
      notes_raw = EXCLUDED.notes_raw,
      biometric_cell_red = EXCLUDED.biometric_cell_red,
      notification_cell_red = EXCLUDED.notification_cell_red,
      signature_cell_red = EXCLUDED.signature_cell_red,
      operational_red_veto = EXCLUDED.operational_red_veto,
      inscripcion_rebook_required = EXCLUDED.inscripcion_rebook_required,
      inscripcion_rebook_reason_raw = EXCLUDED.inscripcion_rebook_reason_raw,
      biometric_color = EXCLUDED.biometric_color,
      notification_color = EXCLUDED.notification_color,
      signature_color = EXCLUDED.signature_color,
      biometric_effective_result = EXCLUDED.biometric_effective_result,
      notification_effective_result = EXCLUDED.notification_effective_result,
      signature_effective_result = EXCLUDED.signature_effective_result,
      projection_status = CASE
        WHEN t.projection_status = 'IDENTITY_CONFLICT' THEN 'IDENTITY_CONFLICT'
        ELSE COALESCE(EXCLUDED.projection_status, 'CURRENT')
      END,
      last_seen_at = EXCLUDED.last_seen_at,
      updated_at = NOW();
      -- last_applied_* / apply_outcome NO se tocan (solo apply RPC)

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('upserted', v_count);
END;
$$;

COMMENT ON FUNCTION public.agenda_sheet_ops_upsert_batch(JSONB) IS
  'P165/P173/P175/P180: upsert proyección ops + color/effective_result (service_role).';

-- =============================================================================
-- 3) Marcar STALE + IDENTITY_CONFLICT (solo full-reconcile; fail-closed)
-- =============================================================================
DROP FUNCTION IF EXISTS public.agenda_sheet_ops_mark_stale_except(TEXT, BIGINT, INTEGER[]);

CREATE OR REPLACE FUNCTION public.agenda_sheet_ops_mark_stale_except(
  p_spreadsheet_id TEXT,
  p_sheet_id BIGINT,
  p_seen_rows INTEGER[],
  p_row_min INTEGER,
  p_row_max INTEGER,
  p_allow_empty_snapshot BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stale INTEGER := 0;
  v_conflict INTEGER := 0;
  v_seen_n INTEGER := 0;
BEGIN
  PERFORM public.agenda_sheet_assert_service_role();

  IF NULLIF(btrim(COALESCE(p_spreadsheet_id, '')), '') IS NULL
    OR p_sheet_id IS NULL
    OR p_row_min IS NULL
    OR p_row_max IS NULL
    OR p_row_min < 1
    OR p_row_max < p_row_min
  THEN
    RETURN jsonb_build_object(
      'skipped', true,
      'reason', 'invalid_scope',
      'stale_marked', 0,
      'identity_conflicts', 0
    );
  END IF;

  v_seen_n := COALESCE(cardinality(p_seen_rows), 0);

  IF v_seen_n = 0 AND NOT COALESCE(p_allow_empty_snapshot, false) THEN
    RETURN jsonb_build_object(
      'skipped', true,
      'reason', 'empty_snapshot_not_allowed',
      'stale_marked', 0,
      'identity_conflicts', 0
    );
  END IF;

  UPDATE public.agenda_sheet_operational_results r
  SET projection_status = 'STALE',
      updated_at = NOW()
  WHERE r.spreadsheet_id = btrim(p_spreadsheet_id)
    AND r.sheet_id = p_sheet_id
    AND r.projection_status = 'CURRENT'
    AND r.sheet_row >= p_row_min
    AND r.sheet_row <= p_row_max
    AND (
      v_seen_n = 0
      OR NOT (r.sheet_row = ANY (p_seen_rows))
    );

  GET DIAGNOSTICS v_stale = ROW_COUNT;

  -- Duplicados CURRENT: TODOS → IDENTITY_CONFLICT (ninguno KPI).
  WITH dups AS (
    SELECT r.booking_id, r.booking_date, r.kind
    FROM public.agenda_sheet_operational_results r
    WHERE r.spreadsheet_id = btrim(p_spreadsheet_id)
      AND r.sheet_id = p_sheet_id
      AND r.projection_status = 'CURRENT'
      AND r.booking_id IS NOT NULL
    GROUP BY r.booking_id, r.booking_date, r.kind
    HAVING COUNT(*) > 1
  )
  UPDATE public.agenda_sheet_operational_results t
  SET projection_status = 'IDENTITY_CONFLICT',
      updated_at = NOW()
  FROM dups
  WHERE t.spreadsheet_id = btrim(p_spreadsheet_id)
    AND t.sheet_id = p_sheet_id
    AND t.projection_status = 'CURRENT'
    AND t.booking_id = dups.booking_id
    AND t.booking_date = dups.booking_date
    AND t.kind = dups.kind;

  GET DIAGNOSTICS v_conflict = ROW_COUNT;

  -- IDENTITY_CONFLICT solitario visto en snapshot → CURRENT
  UPDATE public.agenda_sheet_operational_results t
  SET projection_status = 'CURRENT',
      updated_at = NOW()
  WHERE t.spreadsheet_id = btrim(p_spreadsheet_id)
    AND t.sheet_id = p_sheet_id
    AND t.projection_status = 'IDENTITY_CONFLICT'
    AND t.booking_id IS NOT NULL
    AND t.sheet_row >= p_row_min
    AND t.sheet_row <= p_row_max
    AND (
      v_seen_n = 0
      OR t.sheet_row = ANY (p_seen_rows)
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.agenda_sheet_operational_results o
      WHERE o.spreadsheet_id = t.spreadsheet_id
        AND o.sheet_id = t.sheet_id
        AND o.booking_id = t.booking_id
        AND o.booking_date = t.booking_date
        AND o.kind = t.kind
        AND o.id <> t.id
        AND o.projection_status IN ('CURRENT', 'IDENTITY_CONFLICT')
    );

  RETURN jsonb_build_object(
    'skipped', false,
    'stale_marked', COALESCE(v_stale, 0),
    'identity_conflicts', COALESCE(v_conflict, 0),
    'row_min', p_row_min,
    'row_max', p_row_max
  );
END;
$$;

COMMENT ON FUNCTION public.agenda_sheet_ops_mark_stale_except(TEXT, BIGINT, INTEGER[], INTEGER, INTEGER, BOOLEAN) IS
  'P180 B1.1: STALE solo en scope escaneado; empty fail-closed; dups CURRENT→IDENTITY_CONFLICT todos.';

REVOKE ALL ON FUNCTION public.agenda_sheet_ops_mark_stale_except(TEXT, BIGINT, INTEGER[], INTEGER, INTEGER, BOOLEAN)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_sheet_ops_mark_stale_except(TEXT, BIGINT, INTEGER[], INTEGER, INTEGER, BOOLEAN)
  TO service_role, postgres;

-- =============================================================================
-- 4) Bernardo KPIs: CURRENT + COMPLETED_CURRENT (no legacy COMPLETED)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.bernardo_ops_summary(
  p_fecha_desde DATE,
  p_fecha_hasta DATE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_org UUID;
  v_bio INTEGER := 0;
  v_firm INTEGER := 0;
  v_notif INTEGER := 0;
BEGIN
  v_actor := public.__admin_require_super_admin();
  SELECT p.organization_id INTO v_org
  FROM public.profiles p
  WHERE p.id = v_actor;

  IF p_fecha_desde IS NULL OR p_fecha_hasta IS NULL OR p_fecha_desde > p_fecha_hasta THEN
    RAISE EXCEPTION 'bernardo_ops_summary: rango de fechas inválido'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    (
      SELECT COUNT(*)::INTEGER
      FROM public.agenda_sheet_operational_results r
      WHERE r.organization_id = v_org
        AND r.booking_date >= p_fecha_desde
        AND r.booking_date <= p_fecha_hasta
        AND r.kind = 'biometricos'
        AND r.projection_status = 'CURRENT'
        AND r.biometric_effective_result = 'COMPLETED_CURRENT'
        AND (
          r.booking_id IS NULL
          OR (
            SELECT COUNT(*)
            FROM public.agenda_sheet_operational_results d
            WHERE d.organization_id = r.organization_id
              AND d.booking_id = r.booking_id
              AND d.booking_date = r.booking_date
              AND d.kind = r.kind
              AND d.projection_status = 'CURRENT'
          ) = 1
        )
    ),
    (
      SELECT COUNT(*)::INTEGER
      FROM public.agenda_sheet_operational_results r
      WHERE r.organization_id = v_org
        AND r.booking_date >= p_fecha_desde
        AND r.booking_date <= p_fecha_hasta
        AND r.kind = 'firmas'
        AND r.projection_status = 'CURRENT'
        AND r.signature_effective_result = 'COMPLETED_CURRENT'
        AND (
          r.booking_id IS NULL
          OR (
            SELECT COUNT(*)
            FROM public.agenda_sheet_operational_results d
            WHERE d.organization_id = r.organization_id
              AND d.booking_id = r.booking_id
              AND d.booking_date = r.booking_date
              AND d.kind = r.kind
              AND d.projection_status = 'CURRENT'
          ) = 1
        )
    ),
    (
      SELECT COUNT(*)::INTEGER
      FROM public.agenda_sheet_operational_results r
      WHERE r.organization_id = v_org
        AND r.booking_date >= p_fecha_desde
        AND r.booking_date <= p_fecha_hasta
        AND r.kind = 'biometricos'
        AND r.projection_status = 'CURRENT'
        AND r.notification_effective_result = 'COMPLETED_CURRENT'
        AND (
          r.booking_id IS NULL
          OR (
            SELECT COUNT(*)
            FROM public.agenda_sheet_operational_results d
            WHERE d.organization_id = r.organization_id
              AND d.booking_id = r.booking_id
              AND d.booking_date = r.booking_date
              AND d.kind = r.kind
              AND d.projection_status = 'CURRENT'
          ) = 1
        )
    )
  INTO v_bio, v_firm, v_notif;

  RETURN jsonb_build_object(
    'biometricos', COALESCE(v_bio, 0),
    'firmas', COALESCE(v_firm, 0),
    'notificaciones', COALESCE(v_notif, 0),
    'from_date', p_fecha_desde,
    'to_date_inclusive', p_fecha_hasta
  );
END;
$$;

COMMENT ON FUNCTION public.bernardo_ops_summary(DATE, DATE) IS
  'P180 Bernardo: conteos CURRENT+COMPLETED_CURRENT por booking_date.';

CREATE OR REPLACE FUNCTION public.bernardo_ops_detail(
  p_metric TEXT,
  p_fecha_desde DATE,
  p_fecha_hasta DATE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_org UUID;
  v_metric TEXT;
  v_items JSONB;
BEGIN
  v_actor := public.__admin_require_super_admin();
  SELECT p.organization_id INTO v_org
  FROM public.profiles p
  WHERE p.id = v_actor;

  v_metric := lower(btrim(COALESCE(p_metric, '')));
  IF v_metric NOT IN ('biometricos', 'firmas', 'notificaciones') THEN
    RAISE EXCEPTION 'bernardo_ops_detail: métrica inválida'
      USING ERRCODE = '22023';
  END IF;

  IF p_fecha_desde IS NULL OR p_fecha_hasta IS NULL OR p_fecha_desde > p_fecha_hasta THEN
    RAISE EXCEPTION 'bernardo_ops_detail: rango de fechas inválido'
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(
    jsonb_agg(row_to_json(x)::JSONB ORDER BY x.booking_date DESC, x.booking_time ASC NULLS LAST, x.sheet_row ASC),
    '[]'::JSONB
  )
  INTO v_items
  FROM (
    SELECT
      r.id::TEXT AS result_id,
      r.booking_date::TEXT AS booking_date,
      to_char(r.slot_time, 'HH24:MI') AS booking_time,
      r.kind,
      r.location_id,
      r.sheet_row,
      r.sheet_title,
      r.booking_id::TEXT AS booking_id,
      COALESCE(r.expediente_id, ab.expediente_id)::TEXT AS expediente_id,
      CASE
        WHEN v_metric = 'biometricos' THEN r.biometric_effective_result
        WHEN v_metric = 'firmas' THEN r.signature_effective_result
        ELSE r.notification_effective_result
      END AS result_class,
      CASE
        WHEN v_metric = 'biometricos' THEN r.biometric_result_raw
        WHEN v_metric = 'firmas' THEN r.signature_result_raw
        ELSE r.notification_result_raw
      END AS result_raw,
      CASE
        WHEN v_metric = 'biometricos' THEN r.biometric_color
        WHEN v_metric = 'firmas' THEN r.signature_color
        ELSE r.notification_color
      END AS result_color,
      r.projection_status,
      COALESCE(
        NULLIF(btrim(e.cliente_nombre), ''),
        NULLIF(btrim(inv.visible_name), ''),
        CASE
          WHEN r.booking_id IS NULL THEN
            format('Cita manual · fila %s · %s', r.sheet_row, r.location_id)
          ELSE 'Cliente sin nombre'
        END
      ) AS cliente_nombre,
      COALESCE(
        NULLIF(btrim(asesor.full_name), ''),
        NULLIF(btrim(asesor.email), ''),
        NULLIF(btrim(inv.visible_advisor), ''),
        'Asesor sin nombre registrado'
      ) AS asesor_nombre
    FROM public.agenda_sheet_operational_results r
    LEFT JOIN public.agenda_bookings ab ON ab.id = r.booking_id
    LEFT JOIN public.expedientes e
      ON e.id = COALESCE(r.expediente_id, ab.expediente_id)
    LEFT JOIN public.profiles asesor
      ON asesor.id = COALESCE(ab.created_by, e.asesor_id)
    LEFT JOIN public.agenda_sheet_slot_inventory inv
      ON inv.spreadsheet_id = r.spreadsheet_id
     AND inv.sheet_id = r.sheet_id
     AND inv.sheet_row = r.sheet_row
    WHERE r.organization_id = v_org
      AND r.booking_date >= p_fecha_desde
      AND r.booking_date <= p_fecha_hasta
      AND r.projection_status = 'CURRENT'
      AND (
        r.booking_id IS NULL
        OR (
          SELECT COUNT(*)
          FROM public.agenda_sheet_operational_results d
          WHERE d.organization_id = r.organization_id
            AND d.booking_id = r.booking_id
            AND d.booking_date = r.booking_date
            AND d.kind = r.kind
            AND d.projection_status = 'CURRENT'
        ) = 1
      )
      AND (
        (v_metric = 'biometricos'
          AND r.kind = 'biometricos'
          AND r.biometric_effective_result = 'COMPLETED_CURRENT')
        OR (v_metric = 'firmas'
          AND r.kind = 'firmas'
          AND r.signature_effective_result = 'COMPLETED_CURRENT')
        OR (v_metric = 'notificaciones'
          AND r.kind = 'biometricos'
          AND r.notification_effective_result = 'COMPLETED_CURRENT')
      )
  ) x;

  RETURN jsonb_build_object(
    'metric', v_metric,
    'total', jsonb_array_length(v_items),
    'items', v_items,
    'from_date', p_fecha_desde,
    'to_date_inclusive', p_fecha_hasta
  );
END;
$$;

COMMENT ON FUNCTION public.bernardo_ops_detail(TEXT, DATE, DATE) IS
  'P180 Bernardo: detalle 1:1 CURRENT+COMPLETED_CURRENT (result_class=effective_result).';
