-- ConCasa CRM — Dashboard Bernardo: proyección de resultados operativos CITAS 2026
-- Migración 165. Reporting only. No toca inventory/bookings/capacidades/P160/P162/P163.
-- Fuente: columnas Sheet E/F/I (BIOMETRICOS / NOTIFICACION / COMPLETO), no status=booked.

-- =============================================================================
-- Tabla proyección (sin PII adicional; raw solo estados operativos)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.agenda_sheet_operational_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  spreadsheet_id TEXT NOT NULL,
  sheet_id BIGINT NOT NULL,
  sheet_title TEXT NOT NULL,
  booking_date DATE NOT NULL,
  sheet_row INTEGER NOT NULL CHECK (sheet_row > 0),
  kind TEXT NOT NULL CHECK (kind IN ('biometricos', 'firmas')),
  location_id TEXT NOT NULL CHECK (location_id IN ('monterrey', 'apodaca')),
  slot_time TIME NULL,
  booking_id UUID NULL REFERENCES public.agenda_bookings(id) ON DELETE SET NULL,
  expediente_id UUID NULL,
  biometric_result_class TEXT NOT NULL CHECK (biometric_result_class IN (
    'COMPLETED', 'FAILED_OR_NOT_ATTENDED', 'PENDING', 'UNKNOWN'
  )),
  biometric_result_raw TEXT NULL,
  notification_result_class TEXT NOT NULL CHECK (notification_result_class IN (
    'COMPLETED', 'FAILED_OR_NOT_ATTENDED', 'PENDING', 'UNKNOWN'
  )),
  notification_result_raw TEXT NULL,
  signature_result_class TEXT NOT NULL CHECK (signature_result_class IN (
    'COMPLETED', 'FAILED_OR_NOT_ATTENDED', 'PENDING', 'UNKNOWN'
  )),
  signature_result_raw TEXT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT agenda_sheet_operational_results_row_unique
    UNIQUE (spreadsheet_id, sheet_id, sheet_row)
);

CREATE INDEX IF NOT EXISTS agenda_sheet_ops_date_metric_idx
  ON public.agenda_sheet_operational_results (
    organization_id, booking_date, kind, location_id
  );

CREATE INDEX IF NOT EXISTS agenda_sheet_ops_booking_idx
  ON public.agenda_sheet_operational_results (booking_id)
  WHERE booking_id IS NOT NULL;

DROP TRIGGER IF EXISTS agenda_sheet_operational_results_set_updated_at
  ON public.agenda_sheet_operational_results;
CREATE TRIGGER agenda_sheet_operational_results_set_updated_at
  BEFORE UPDATE ON public.agenda_sheet_operational_results
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.agenda_sheet_operational_results IS
  'P165 Bernardo: resultado operativo Sheet (completado/no/pendiente). Distinto de cupo/inventory.';

ALTER TABLE public.agenda_sheet_operational_results ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.agenda_sheet_operational_results
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.agenda_sheet_operational_results
  TO service_role, postgres;

-- SuperAdmin puede leer (Realtime + RPC detail joins).
CREATE POLICY agenda_sheet_ops_select_super_admin
  ON public.agenda_sheet_operational_results
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.app_role = 'super_admin'
        AND p.organization_id = agenda_sheet_operational_results.organization_id
    )
  );

GRANT SELECT ON TABLE public.agenda_sheet_operational_results TO authenticated;

ALTER TABLE public.agenda_sheet_operational_results REPLICA IDENTITY FULL;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime
    ADD TABLE public.agenda_sheet_operational_results;
EXCEPTION
  WHEN duplicate_object THEN
    NULL;
  WHEN undefined_object THEN
    NULL;
END $$;

-- =============================================================================
-- Upsert batch (service_role / Edge)
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
      last_seen_at = EXCLUDED.last_seen_at,
      updated_at = NOW();

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('upserted', v_count);
END;
$$;

COMMENT ON FUNCTION public.agenda_sheet_ops_upsert_batch(JSONB) IS
  'P165: upsert proyección resultados operativos Sheet (service_role).';

REVOKE ALL ON FUNCTION public.agenda_sheet_ops_upsert_batch(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agenda_sheet_ops_upsert_batch(JSONB) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_sheet_ops_upsert_batch(JSONB)
  TO service_role, postgres;

-- =============================================================================
-- Bernardo KPIs (solo COMPLETED; periodo = booking_date del tab)
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
    COUNT(*) FILTER (
      WHERE r.kind = 'biometricos'
        AND r.biometric_result_class = 'COMPLETED'
    )::INTEGER,
    COUNT(*) FILTER (
      WHERE r.kind = 'firmas'
        AND r.signature_result_class = 'COMPLETED'
    )::INTEGER,
    COUNT(*) FILTER (
      WHERE r.kind = 'biometricos'
        AND r.notification_result_class = 'COMPLETED'
    )::INTEGER
  INTO v_bio, v_firm, v_notif
  FROM public.agenda_sheet_operational_results r
  WHERE r.organization_id = v_org
    AND r.booking_date >= p_fecha_desde
    AND r.booking_date <= p_fecha_hasta;

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
  'P165 Bernardo: conteos COMPLETED por booking_date (Monterrey calendario).';

REVOKE ALL ON FUNCTION public.bernardo_ops_summary(DATE, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bernardo_ops_summary(DATE, DATE) FROM anon;
GRANT EXECUTE ON FUNCTION public.bernardo_ops_summary(DATE, DATE)
  TO authenticated, service_role, postgres;

-- =============================================================================
-- Bernardo detalle (misma semántica KPI; join seguro a cliente/asesor)
-- =============================================================================
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

  SELECT COALESCE(jsonb_agg(row_to_json(x)::JSONB ORDER BY x.booking_date DESC, x.booking_time ASC NULLS LAST, x.sheet_row ASC), '[]'::JSONB)
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
        WHEN v_metric = 'biometricos' THEN r.biometric_result_class
        WHEN v_metric = 'firmas' THEN r.signature_result_class
        ELSE r.notification_result_class
      END AS result_class,
      CASE
        WHEN v_metric = 'biometricos' THEN r.biometric_result_raw
        WHEN v_metric = 'firmas' THEN r.signature_result_raw
        ELSE r.notification_result_raw
      END AS result_raw,
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
      AND (
        (v_metric = 'biometricos'
          AND r.kind = 'biometricos'
          AND r.biometric_result_class = 'COMPLETED')
        OR (v_metric = 'firmas'
          AND r.kind = 'firmas'
          AND r.signature_result_class = 'COMPLETED')
        OR (v_metric = 'notificaciones'
          AND r.kind = 'biometricos'
          AND r.notification_result_class = 'COMPLETED')
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
  'P165 Bernardo: detalle 1:1 con KPI COMPLETED (sin ampliar permisos).';

REVOKE ALL ON FUNCTION public.bernardo_ops_detail(TEXT, DATE, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bernardo_ops_detail(TEXT, DATE, DATE) FROM anon;
GRANT EXECUTE ON FUNCTION public.bernardo_ops_detail(TEXT, DATE, DATE)
  TO authenticated, service_role, postgres;
