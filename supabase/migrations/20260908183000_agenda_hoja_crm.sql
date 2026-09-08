-- ConCasa CRM — Hoja operativa tipo Drive dentro del CRM.
-- Drive/Sheets sigue activo para captura/sincronizacion de bookings.
-- Esta capa agrega captura operativa CRM (manuales + resultados/notas) SIN mover etapas.

CREATE TABLE IF NOT EXISTS public.agenda_manual_occupancies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  kind public.booking_kind NOT NULL CHECK (kind::text IN ('biometricos','firmas','inscripcion')),
  location_id TEXT NOT NULL CHECK (btrim(location_id) <> ''),
  booking_date DATE NOT NULL,
  booking_time TIME NOT NULL,
  display_time TIME NOT NULL,
  nss TEXT,
  cliente_nombre TEXT CHECK (cliente_nombre IS NULL OR btrim(cliente_nombre) <> ''),
  asesor_nombre TEXT,
  asesor_id UUID REFERENCES public.profiles(id),
  expediente_id UUID REFERENCES public.expedientes(id),
  reconciled_booking_id UUID REFERENCES public.agenda_bookings(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  counts_toward_capacity BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  source TEXT NOT NULL DEFAULT 'manual_crm' CHECK (source IN ('manual_crm','legacy_sheet_snapshot')),
  source_inventory_id UUID UNIQUE,
  source_spreadsheet_id TEXT,
  source_sheet_id BIGINT,
  source_sheet_title TEXT,
  source_sheet_row INTEGER,
  created_by UUID REFERENCES public.profiles(id),
  cancelled_by UUID REFERENCES public.profiles(id),
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agenda_manual_occupancies_scope_idx
  ON public.agenda_manual_occupancies
  (organization_id, booking_date, kind, location_id, booking_time, status);
CREATE INDEX IF NOT EXISTS agenda_manual_occupancies_exp_idx
  ON public.agenda_manual_occupancies(expediente_id)
  WHERE expediente_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS agenda_manual_occupancies_reconciled_idx
  ON public.agenda_manual_occupancies(reconciled_booking_id)
  WHERE reconciled_booking_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.agenda_operational_results_native (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  booking_id UUID REFERENCES public.agenda_bookings(id),
  manual_occupancy_id UUID REFERENCES public.agenda_manual_occupancies(id),
  expediente_id UUID REFERENCES public.expedientes(id),
  kind TEXT NOT NULL CHECK (kind IN ('biometricos','firmas','inscripcion')),
  location_id TEXT NOT NULL,
  booking_date DATE NOT NULL,
  booking_time TIME NOT NULL,
  biometric_result_class TEXT,
  biometric_result_raw TEXT,
  biometric_color TEXT,
  notification_result_class TEXT,
  notification_result_raw TEXT,
  notification_color TEXT,
  signature_result_class TEXT,
  signature_result_raw TEXT,
  signature_color TEXT,
  notes_raw TEXT,
  biometric_cell_red BOOLEAN NOT NULL DEFAULT FALSE,
  notification_cell_red BOOLEAN NOT NULL DEFAULT FALSE,
  signature_cell_red BOOLEAN NOT NULL DEFAULT FALSE,
  operational_red_veto BOOLEAN NOT NULL DEFAULT FALSE,
  source TEXT NOT NULL DEFAULT 'manual_crm' CHECK (source IN ('manual_crm','legacy_sheet_snapshot')),
  source_result_id UUID UNIQUE,
  source_spreadsheet_id TEXT,
  source_sheet_id BIGINT,
  source_sheet_title TEXT,
  source_sheet_row INTEGER,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS agenda_operational_results_native_scope_idx
  ON public.agenda_operational_results_native
  (organization_id, booking_date, kind, location_id, booking_time);
CREATE INDEX IF NOT EXISTS agenda_operational_results_native_booking_idx
  ON public.agenda_operational_results_native(booking_id)
  WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS agenda_operational_results_native_manual_idx
  ON public.agenda_operational_results_native(manual_occupancy_id)
  WHERE manual_occupancy_id IS NOT NULL;

ALTER TABLE public.agenda_manual_occupancies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agenda_operational_results_native ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.agenda_manual_occupancies FROM anon, authenticated;
REVOKE ALL ON TABLE public.agenda_operational_results_native FROM anon, authenticated;
GRANT ALL ON TABLE public.agenda_manual_occupancies TO service_role, postgres;
GRANT ALL ON TABLE public.agenda_operational_results_native TO service_role, postgres;

CREATE OR REPLACE FUNCTION public.agenda_crm_manual_slot_count(
  p_org UUID,
  p_kind TEXT,
  p_date DATE,
  p_time TIME,
  p_location TEXT
)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COUNT(*)::INTEGER
  FROM public.agenda_manual_occupancies m
  WHERE m.organization_id = p_org
    AND m.kind::text = lower(btrim(COALESCE(p_kind, '')))
    AND m.booking_date = p_date
    AND m.booking_time = p_time
    AND m.location_id = lower(btrim(COALESCE(p_location, '')))
    AND m.status = 'active'
    AND m.source = 'manual_crm'
    AND m.counts_toward_capacity = TRUE
    AND m.reconciled_booking_id IS NULL;
$function$;

CREATE OR REPLACE FUNCTION public.agenda_crm_manual_daily_count(
  p_org UUID,
  p_kind TEXT,
  p_date DATE,
  p_location TEXT
)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COUNT(*)::INTEGER
  FROM public.agenda_manual_occupancies m
  WHERE m.organization_id = p_org
    AND m.kind::text = lower(btrim(COALESCE(p_kind, '')))
    AND m.booking_date = p_date
    AND m.location_id = lower(btrim(COALESCE(p_location, '')))
    AND m.status = 'active'
    AND m.source = 'manual_crm'
    AND m.counts_toward_capacity = TRUE
    AND m.reconciled_booking_id IS NULL;
$function$;

-- Mientras Drive siga siendo el inventario fisico, una captura manual CRM resta
-- un lugar disponible del mismo horario. No modifica ninguna fila de Google.
CREATE OR REPLACE FUNCTION public.agenda_sheet_inventory_available_count(
  p_org UUID,
  p_kind TEXT,
  p_date DATE,
  p_time TIME,
  p_location TEXT
)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH sheet_available AS (
    SELECT COUNT(*)::INTEGER AS n
    FROM public.agenda_sheet_slot_inventory i
    WHERE i.organization_id = p_org
      AND i.kind = lower(btrim(COALESCE(p_kind, '')))
      AND i.booking_date = p_date
      AND i.slot_time = p_time
      AND i.location_id = lower(btrim(COALESCE(p_location, '')))
      AND i.status = 'available'
  )
  SELECT GREATEST(
    COALESCE((SELECT n FROM sheet_available), 0)
      - public.agenda_crm_manual_slot_count(p_org, p_kind, p_date, p_time, p_location),
    0
  )::INTEGER;
$function$;

-- El hard-cap diario tambien considera manuales capturados desde CRM.
CREATE OR REPLACE FUNCTION public.agenda_daily_remaining(
  p_org UUID,
  p_kind TEXT,
  p_date DATE,
  p_location TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_cap INTEGER;
  v_occ INTEGER;
BEGIN
  v_cap := public.agenda_daily_capacity(p_org, p_kind, p_date, p_location);
  IF v_cap IS NULL THEN
    RETURN NULL;
  END IF;
  v_occ := public.agenda_daily_active_occupancy(p_org, p_kind, p_date, p_location)
    + public.agenda_crm_manual_daily_count(p_org, p_kind, p_date, p_location);
  IF v_occ > v_cap THEN
    RETURN 0;
  END IF;
  RETURN GREATEST(0, v_cap - v_occ);
END;
$function$;

CREATE OR REPLACE FUNCTION public.agenda_firmas_daily_remaining(
  p_org UUID,
  p_date DATE,
  p_canonical_location TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_canonical TEXT;
  v_cap INTEGER;
  v_occ INTEGER;
BEGIN
  v_canonical := public.agenda_firmas_canonical_location_id(p_canonical_location);
  IF v_canonical IS NULL THEN
    RETURN NULL;
  END IF;
  v_cap := public.agenda_daily_capacity(p_org, 'firmas', p_date, v_canonical);
  IF v_cap IS NULL THEN
    RETURN NULL;
  END IF;
  v_occ := public.agenda_firmas_daily_active_occupancy(p_org, p_date, v_canonical)
    + public.agenda_crm_manual_daily_count(p_org, 'firmas', p_date, v_canonical);
  IF v_occ > v_cap THEN
    RETURN 0;
  END IF;
  RETURN GREATEST(0, v_cap - v_occ);
END;
$function$;

CREATE OR REPLACE FUNCTION public.agenda_hoja_crm_normalize_color(p_color TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE upper(btrim(COALESCE(p_color, 'UNKNOWN')))
    WHEN 'GREEN' THEN 'GREEN'
    WHEN 'RED' THEN 'RED'
    WHEN 'ORANGE' THEN 'ORANGE'
    WHEN 'OTHER' THEN 'OTHER'
    ELSE 'UNKNOWN'
  END;
$function$;

CREATE OR REPLACE FUNCTION public.agenda_hoja_crm_result_class(
  p_raw TEXT,
  p_color TEXT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN NULLIF(btrim(COALESCE(p_raw, '')), '') IS NULL THEN 'PENDING'
    WHEN public.agenda_hoja_crm_normalize_color(p_color) = 'GREEN' THEN 'COMPLETED'
    WHEN public.agenda_hoja_crm_normalize_color(p_color) = 'RED' THEN 'FAILED_OR_NOT_ATTENDED'
    ELSE 'UNKNOWN'
  END;
$function$;

-- Vista diaria estilo Sheet. Las filas disponibles de Drive se reducen visualmente
-- por cada ocupacion manual CRM del mismo slot; luego se insertan las manuales CRM
-- como filas virtuales. Resultado: mismo numero efectivo de lugares sin tocar Google.
CREATE OR REPLACE FUNCTION public.agenda_hoja_crm_list(p_date DATE)
RETURNS TABLE(
  row_source TEXT,
  row_id UUID,
  manual_occupancy_id UUID,
  inventory_id UUID,
  booking_id UUID,
  expediente_id UUID,
  booking_date DATE,
  kind TEXT,
  location_id TEXT,
  logical_time TIME,
  display_time TIME,
  row_status TEXT,
  origin_label TEXT,
  nss TEXT,
  cliente_nombre TEXT,
  asesor_nombre TEXT,
  biometric_result_raw TEXT,
  biometric_color TEXT,
  notification_result_raw TEXT,
  notification_color TEXT,
  signature_result_raw TEXT,
  signature_color TEXT,
  notes_raw TEXT,
  sheet_title TEXT,
  sheet_row INTEGER,
  editable BOOLEAN,
  available BOOLEAN,
  crm_override BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor UUID;
  v_org UUID;
  v_role public.app_role;
BEGIN
  v_actor := public.current_profile_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'agenda_hoja_crm_list: no autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT p.organization_id, p.app_role
  INTO v_org, v_role
  FROM public.profiles p
  WHERE p.id = v_actor AND p.active = TRUE;

  IF v_org IS NULL OR v_role NOT IN ('mesa_admin','mesa_interno','mesa_externo','super_admin') THEN
    RAISE EXCEPTION 'agenda_hoja_crm_list: rol no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_date IS NULL THEN
    RAISE EXCEPTION 'agenda_hoja_crm_list: fecha invalida' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH manual_counts AS (
    SELECT m.kind::text AS kind, m.location_id, m.booking_time,
      COUNT(*)::INTEGER AS n
    FROM public.agenda_manual_occupancies m
    WHERE m.organization_id = v_org
      AND m.booking_date = p_date
      AND m.status = 'active'
      AND m.source = 'manual_crm'
      AND m.counts_toward_capacity = TRUE
      AND m.reconciled_booking_id IS NULL
    GROUP BY m.kind::text, m.location_id, m.booking_time
  ),
  inventory_ranked AS (
    SELECT i.*,
      CASE WHEN i.status = 'available' THEN
        row_number() OVER (
          PARTITION BY i.kind, i.location_id, i.slot_time, i.status
          ORDER BY i.sheet_row, i.id
        )
      ELSE NULL END AS available_rank
    FROM public.agenda_sheet_slot_inventory i
    WHERE i.organization_id = v_org
      AND i.booking_date = p_date
      AND i.kind IN ('biometricos','firmas','inscripcion')
      AND i.status IS DISTINCT FROM 'disabled'
  ),
  inventory_visible AS (
    SELECT i.*
    FROM inventory_ranked i
    LEFT JOIN manual_counts mc
      ON mc.kind = i.kind
     AND mc.location_id = i.location_id
     AND mc.booking_time = i.slot_time
    WHERE i.status <> 'available'
       OR i.available_rank > COALESCE(mc.n, 0)
  )
  SELECT
    'inventory'::TEXT AS row_source,
    i.id AS row_id,
    mlegacy.id AS manual_occupancy_id,
    i.id AS inventory_id,
    i.booking_id,
    COALESCE(i.expediente_id, b.expediente_id, mlegacy.expediente_id) AS expediente_id,
    i.booking_date,
    i.kind,
    i.location_id,
    i.slot_time AS logical_time,
    COALESCE(i.sheet_slot_time, i.slot_time) AS display_time,
    i.status AS row_status,
    CASE
      WHEN i.status = 'available' THEN 'Disponible'
      WHEN i.status = 'occupied_external' THEN 'Manual Drive'
      ELSE 'CRM → Drive'
    END AS origin_label,
    COALESCE(NULLIF(btrim(i.visible_nss), ''), NULLIF(btrim(e.nss::TEXT), ''), mlegacy.nss) AS nss,
    COALESCE(NULLIF(btrim(i.visible_name), ''), NULLIF(btrim(e.cliente_nombre), ''), mlegacy.cliente_nombre) AS cliente_nombre,
    COALESCE(NULLIF(btrim(i.visible_advisor), ''), NULLIF(btrim(pa.full_name), ''), mlegacy.asesor_nombre) AS asesor_nombre,
    CASE WHEN nr.id IS NOT NULL THEN nr.biometric_result_raw ELSE sr.biometric_result_raw END,
    CASE WHEN nr.id IS NOT NULL THEN COALESCE(nr.biometric_color, 'UNKNOWN') ELSE COALESCE(sr.biometric_color, 'UNKNOWN') END,
    CASE WHEN nr.id IS NOT NULL THEN nr.notification_result_raw ELSE sr.notification_result_raw END,
    CASE WHEN nr.id IS NOT NULL THEN COALESCE(nr.notification_color, 'UNKNOWN') ELSE COALESCE(sr.notification_color, 'UNKNOWN') END,
    CASE WHEN nr.id IS NOT NULL THEN nr.signature_result_raw ELSE sr.signature_result_raw END,
    CASE WHEN nr.id IS NOT NULL THEN COALESCE(nr.signature_color, 'UNKNOWN') ELSE COALESCE(sr.signature_color, 'UNKNOWN') END,
    CASE WHEN nr.id IS NOT NULL THEN nr.notes_raw ELSE sr.notes_raw END,
    i.sheet_title,
    i.sheet_row,
    (i.status <> 'available') AS editable,
    (i.status = 'available') AS available,
    (nr.id IS NOT NULL) AS crm_override
  FROM inventory_visible i
  LEFT JOIN public.agenda_bookings b ON b.id = i.booking_id
  LEFT JOIN public.agenda_manual_occupancies mlegacy
    ON mlegacy.source_inventory_id = i.id
   AND mlegacy.status = 'active'
  LEFT JOIN public.expedientes e
    ON e.id = COALESCE(i.expediente_id, b.expediente_id, mlegacy.expediente_id)
   AND e.deleted_at IS NULL
  LEFT JOIN public.profiles pa ON pa.id = e.asesor_id
  LEFT JOIN LATERAL (
    SELECT r.*
    FROM public.agenda_sheet_operational_results r
    WHERE r.organization_id = v_org
      AND r.booking_date = i.booking_date
      AND r.sheet_id = i.sheet_id
      AND r.sheet_row = i.sheet_row
    ORDER BY r.updated_at DESC NULLS LAST, r.id
    LIMIT 1
  ) sr ON TRUE
  LEFT JOIN LATERAL (
    SELECT n.*
    FROM public.agenda_operational_results_native n
    WHERE n.organization_id = v_org
      AND n.source = 'manual_crm'
      AND (
        (sr.id IS NOT NULL AND n.source_result_id = sr.id)
        OR (i.booking_id IS NOT NULL AND n.booking_id = i.booking_id)
        OR (mlegacy.id IS NOT NULL AND n.manual_occupancy_id = mlegacy.id)
      )
    ORDER BY
      CASE
        WHEN sr.id IS NOT NULL AND n.source_result_id = sr.id THEN 0
        WHEN i.booking_id IS NOT NULL AND n.booking_id = i.booking_id THEN 1
        ELSE 2
      END,
      n.updated_at DESC
    LIMIT 1
  ) nr ON TRUE

  UNION ALL

  SELECT
    'manual'::TEXT AS row_source,
    m.id AS row_id,
    m.id AS manual_occupancy_id,
    NULL::UUID AS inventory_id,
    m.reconciled_booking_id AS booking_id,
    m.expediente_id,
    m.booking_date,
    m.kind::text AS kind,
    m.location_id,
    m.booking_time AS logical_time,
    m.display_time,
    'occupied_manual_crm'::TEXT AS row_status,
    'Manual CRM'::TEXT AS origin_label,
    m.nss,
    m.cliente_nombre,
    m.asesor_nombre,
    nr.biometric_result_raw,
    COALESCE(nr.biometric_color, 'UNKNOWN'),
    nr.notification_result_raw,
    COALESCE(nr.notification_color, 'UNKNOWN'),
    nr.signature_result_raw,
    COALESCE(nr.signature_color, 'UNKNOWN'),
    COALESCE(nr.notes_raw, m.notes),
    NULL::TEXT AS sheet_title,
    NULL::INTEGER AS sheet_row,
    TRUE AS editable,
    FALSE AS available,
    (nr.id IS NOT NULL) AS crm_override
  FROM public.agenda_manual_occupancies m
  LEFT JOIN LATERAL (
    SELECT n.*
    FROM public.agenda_operational_results_native n
    WHERE n.organization_id = v_org
      AND n.source = 'manual_crm'
      AND n.manual_occupancy_id = m.id
    ORDER BY n.updated_at DESC
    LIMIT 1
  ) nr ON TRUE
  WHERE m.organization_id = v_org
    AND m.booking_date = p_date
    AND m.status = 'active'
    AND m.source = 'manual_crm'

  ORDER BY
    CASE location_id WHEN 'monterrey' THEN 0 WHEN 'apodaca' THEN 1 ELSE 2 END,
    CASE kind WHEN 'biometricos' THEN 0 WHEN 'firmas' THEN 1 WHEN 'inscripcion' THEN 2 ELSE 3 END,
    display_time,
    sheet_row NULLS LAST,
    row_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.agenda_hoja_crm_save_result(
  p_row_source TEXT,
  p_row_id UUID,
  p_biometric_result_raw TEXT DEFAULT NULL,
  p_biometric_color TEXT DEFAULT 'UNKNOWN',
  p_notification_result_raw TEXT DEFAULT NULL,
  p_notification_color TEXT DEFAULT 'UNKNOWN',
  p_signature_result_raw TEXT DEFAULT NULL,
  p_signature_color TEXT DEFAULT 'UNKNOWN',
  p_notes_raw TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor UUID;
  v_org UUID;
  v_role public.app_role;
  v_kind TEXT;
  v_location TEXT;
  v_date DATE;
  v_time TIME;
  v_booking_id UUID;
  v_expediente_id UUID;
  v_manual_id UUID;
  v_source_result_id UUID;
  v_source_spreadsheet_id TEXT;
  v_source_sheet_id BIGINT;
  v_source_sheet_title TEXT;
  v_source_sheet_row INTEGER;
  v_native_id UUID;
  v_bio_color TEXT;
  v_notif_color TEXT;
  v_sign_color TEXT;
BEGIN
  v_actor := public.current_profile_id();
  SELECT p.organization_id, p.app_role INTO v_org, v_role
  FROM public.profiles p
  WHERE p.id = v_actor AND p.active = TRUE;
  IF v_actor IS NULL OR v_org IS NULL OR v_role NOT IN ('mesa_admin','mesa_interno','mesa_externo','super_admin') THEN
    RAISE EXCEPTION 'agenda_hoja_crm_save_result: no autorizado' USING ERRCODE = '42501';
  END IF;

  IF lower(btrim(COALESCE(p_row_source, ''))) = 'inventory' THEN
    SELECT i.kind, i.location_id, i.booking_date, i.slot_time,
           i.booking_id, COALESCE(i.expediente_id, b.expediente_id),
           i.spreadsheet_id, i.sheet_id, i.sheet_title, i.sheet_row,
           m.id
    INTO v_kind, v_location, v_date, v_time,
         v_booking_id, v_expediente_id,
         v_source_spreadsheet_id, v_source_sheet_id, v_source_sheet_title, v_source_sheet_row,
         v_manual_id
    FROM public.agenda_sheet_slot_inventory i
    LEFT JOIN public.agenda_bookings b ON b.id = i.booking_id
    LEFT JOIN public.agenda_manual_occupancies m
      ON m.source_inventory_id = i.id AND m.status = 'active'
    WHERE i.id = p_row_id
      AND i.organization_id = v_org
      AND i.status <> 'available'
      AND i.status <> 'disabled'
    FOR UPDATE OF i;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'agenda_hoja_crm_save_result: fila no editable' USING ERRCODE = '22023';
    END IF;

    SELECT r.id INTO v_source_result_id
    FROM public.agenda_sheet_operational_results r
    WHERE r.organization_id = v_org
      AND r.booking_date = v_date
      AND r.sheet_id = v_source_sheet_id
      AND r.sheet_row = v_source_sheet_row
    ORDER BY r.updated_at DESC NULLS LAST, r.id
    LIMIT 1;
  ELSIF lower(btrim(COALESCE(p_row_source, ''))) = 'manual' THEN
    SELECT m.kind::text, m.location_id, m.booking_date, m.booking_time,
           m.reconciled_booking_id, m.expediente_id, m.id
    INTO v_kind, v_location, v_date, v_time,
         v_booking_id, v_expediente_id, v_manual_id
    FROM public.agenda_manual_occupancies m
    WHERE m.id = p_row_id
      AND m.organization_id = v_org
      AND m.status = 'active'
      AND m.source = 'manual_crm'
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'agenda_hoja_crm_save_result: manual no disponible' USING ERRCODE = '22023';
    END IF;
  ELSE
    RAISE EXCEPTION 'agenda_hoja_crm_save_result: origen invalido' USING ERRCODE = '22023';
  END IF;

  IF v_source_result_id IS NOT NULL THEN
    SELECT n.id INTO v_native_id
    FROM public.agenda_operational_results_native n
    WHERE n.organization_id = v_org
      AND n.source_result_id = v_source_result_id
    FOR UPDATE;
  END IF;
  IF v_native_id IS NULL AND v_manual_id IS NOT NULL THEN
    SELECT n.id INTO v_native_id
    FROM public.agenda_operational_results_native n
    WHERE n.organization_id = v_org
      AND n.manual_occupancy_id = v_manual_id
    ORDER BY n.updated_at DESC
    LIMIT 1
    FOR UPDATE;
  END IF;
  IF v_native_id IS NULL AND v_booking_id IS NOT NULL THEN
    SELECT n.id INTO v_native_id
    FROM public.agenda_operational_results_native n
    WHERE n.organization_id = v_org
      AND n.booking_id = v_booking_id
    ORDER BY n.updated_at DESC
    LIMIT 1
    FOR UPDATE;
  END IF;

  v_bio_color := public.agenda_hoja_crm_normalize_color(p_biometric_color);
  v_notif_color := public.agenda_hoja_crm_normalize_color(p_notification_color);
  v_sign_color := public.agenda_hoja_crm_normalize_color(p_signature_color);

  IF v_native_id IS NULL THEN
    INSERT INTO public.agenda_operational_results_native (
      organization_id, booking_id, manual_occupancy_id, expediente_id,
      kind, location_id, booking_date, booking_time,
      biometric_result_class, biometric_result_raw, biometric_color,
      notification_result_class, notification_result_raw, notification_color,
      signature_result_class, signature_result_raw, signature_color,
      notes_raw,
      biometric_cell_red, notification_cell_red, signature_cell_red,
      operational_red_veto,
      source, source_result_id, source_spreadsheet_id, source_sheet_id,
      source_sheet_title, source_sheet_row, created_by
    ) VALUES (
      v_org, v_booking_id, v_manual_id, v_expediente_id,
      v_kind, v_location, v_date, v_time,
      public.agenda_hoja_crm_result_class(p_biometric_result_raw, v_bio_color), NULLIF(btrim(COALESCE(p_biometric_result_raw,'')),''), v_bio_color,
      public.agenda_hoja_crm_result_class(p_notification_result_raw, v_notif_color), NULLIF(btrim(COALESCE(p_notification_result_raw,'')),''), v_notif_color,
      public.agenda_hoja_crm_result_class(p_signature_result_raw, v_sign_color), NULLIF(btrim(COALESCE(p_signature_result_raw,'')),''), v_sign_color,
      NULLIF(btrim(COALESCE(p_notes_raw,'')),''),
      v_bio_color = 'RED', v_notif_color = 'RED', v_sign_color = 'RED',
      (v_bio_color = 'RED' OR v_notif_color = 'RED' OR v_sign_color = 'RED'),
      'manual_crm', v_source_result_id, v_source_spreadsheet_id, v_source_sheet_id,
      v_source_sheet_title, v_source_sheet_row, v_actor
    ) RETURNING id INTO v_native_id;
  ELSE
    UPDATE public.agenda_operational_results_native n
    SET booking_id = COALESCE(v_booking_id, n.booking_id),
        manual_occupancy_id = COALESCE(v_manual_id, n.manual_occupancy_id),
        expediente_id = COALESCE(v_expediente_id, n.expediente_id),
        kind = v_kind,
        location_id = v_location,
        booking_date = v_date,
        booking_time = v_time,
        biometric_result_class = public.agenda_hoja_crm_result_class(p_biometric_result_raw, v_bio_color),
        biometric_result_raw = NULLIF(btrim(COALESCE(p_biometric_result_raw,'')),''),
        biometric_color = v_bio_color,
        notification_result_class = public.agenda_hoja_crm_result_class(p_notification_result_raw, v_notif_color),
        notification_result_raw = NULLIF(btrim(COALESCE(p_notification_result_raw,'')),''),
        notification_color = v_notif_color,
        signature_result_class = public.agenda_hoja_crm_result_class(p_signature_result_raw, v_sign_color),
        signature_result_raw = NULLIF(btrim(COALESCE(p_signature_result_raw,'')),''),
        signature_color = v_sign_color,
        notes_raw = NULLIF(btrim(COALESCE(p_notes_raw,'')),''),
        biometric_cell_red = (v_bio_color = 'RED'),
        notification_cell_red = (v_notif_color = 'RED'),
        signature_cell_red = (v_sign_color = 'RED'),
        operational_red_veto = (v_bio_color = 'RED' OR v_notif_color = 'RED' OR v_sign_color = 'RED'),
        source = 'manual_crm',
        source_result_id = COALESCE(v_source_result_id, n.source_result_id),
        source_spreadsheet_id = COALESCE(v_source_spreadsheet_id, n.source_spreadsheet_id),
        source_sheet_id = COALESCE(v_source_sheet_id, n.source_sheet_id),
        source_sheet_title = COALESCE(v_source_sheet_title, n.source_sheet_title),
        source_sheet_row = COALESCE(v_source_sheet_row, n.source_sheet_row),
        created_by = COALESCE(n.created_by, v_actor),
        updated_at = NOW()
    WHERE n.id = v_native_id;
  END IF;

  PERFORM public.log_action(
    v_org, v_actor, v_role,
    'AGENDA_HOJA_RESULT_UPDATED',
    'agenda_operational_result', v_native_id,
    jsonb_build_object(
      'row_source', lower(btrim(p_row_source)),
      'row_id', p_row_id,
      'booking_id', v_booking_id,
      'manual_occupancy_id', v_manual_id,
      'booking_date', v_date,
      'booking_time', v_time,
      'kind', v_kind,
      'location_id', v_location,
      'mutates_stage', false
    )
  );

  RETURN jsonb_build_object('ok', true, 'result_id', v_native_id, 'mutates_stage', false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.agenda_hoja_crm_add_manual(
  p_booking_date DATE,
  p_booking_time TIME,
  p_kind TEXT,
  p_location_id TEXT,
  p_display_time TIME DEFAULT NULL,
  p_nss TEXT DEFAULT NULL,
  p_cliente_nombre TEXT DEFAULT NULL,
  p_asesor_nombre TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor UUID;
  v_org UUID;
  v_role public.app_role;
  v_kind TEXT;
  v_location TEXT;
  v_nss TEXT;
  v_nss_norm TEXT;
  v_id UUID;
  v_available INTEGER;
  v_daily INTEGER;
BEGIN
  v_actor := public.current_profile_id();
  SELECT p.organization_id, p.app_role INTO v_org, v_role
  FROM public.profiles p
  WHERE p.id = v_actor AND p.active = TRUE;
  IF v_actor IS NULL OR v_org IS NULL OR v_role NOT IN ('mesa_admin','mesa_interno','mesa_externo','super_admin') THEN
    RAISE EXCEPTION 'agenda_hoja_crm_add_manual: no autorizado' USING ERRCODE = '42501';
  END IF;

  v_kind := lower(btrim(COALESCE(p_kind,'')));
  v_location := lower(btrim(COALESCE(p_location_id,'')));
  IF v_kind NOT IN ('biometricos','firmas','inscripcion') THEN
    RAISE EXCEPTION 'agenda_hoja_crm_add_manual: tipo invalido' USING ERRCODE = '22023';
  END IF;
  IF v_location NOT IN ('monterrey','apodaca') THEN
    RAISE EXCEPTION 'agenda_hoja_crm_add_manual: sede invalida' USING ERRCODE = '22023';
  END IF;
  IF p_booking_date IS NULL OR p_booking_time IS NULL THEN
    RAISE EXCEPTION 'agenda_hoja_crm_add_manual: fecha/hora requerida' USING ERRCODE = '22023';
  END IF;

  v_nss := NULLIF(btrim(COALESCE(p_nss,'')), '');
  v_nss_norm := regexp_replace(COALESCE(v_nss,''), '\D', '', 'g');
  IF NULLIF(btrim(COALESCE(p_cliente_nombre,'')), '') IS NULL THEN
    RAISE EXCEPTION 'agenda_hoja_crm_add_manual: nombre requerido' USING ERRCODE = '22023';
  END IF;

  -- Evitar duplicar una cita CRM real o una captura manual CRM del mismo NSS.
  IF v_nss_norm <> '' AND EXISTS (
    SELECT 1
    FROM public.agenda_bookings b
    JOIN public.expedientes e ON e.id = b.expediente_id
    WHERE b.organization_id = v_org
      AND b.kind::text = v_kind
      AND b.booking_date = p_booking_date
      AND b.location_id = v_location
      AND b.status = 'booked'
      AND regexp_replace(COALESCE(e.nss::TEXT,''), '\D', '', 'g') = v_nss_norm
  ) THEN
    RAISE EXCEPTION 'MANUAL_DUPLICADO_CRM: ya existe una cita CRM activa para este NSS en el dia/sede.' USING ERRCODE = '22023';
  END IF;

  IF v_nss_norm <> '' AND EXISTS (
    SELECT 1
    FROM public.agenda_manual_occupancies m
    WHERE m.organization_id = v_org
      AND m.kind::text = v_kind
      AND m.booking_date = p_booking_date
      AND m.location_id = v_location
      AND m.status = 'active'
      AND m.source = 'manual_crm'
      AND regexp_replace(COALESCE(m.nss,''), '\D', '', 'g') = v_nss_norm
  ) THEN
    RAISE EXCEPTION 'MANUAL_DUPLICADO_CRM: este NSS ya fue capturado manualmente.' USING ERRCODE = '22023';
  END IF;

  -- Mismo lock usado por los bookings normales: evita dos capturas simultaneas.
  PERFORM public.agenda_advisory_lock_slot_capacity(
    v_org, v_kind::public.booking_kind, v_location, p_booking_date, p_booking_time
  );

  IF public.agenda_daily_capacity(v_org, v_kind, p_booking_date, v_location) IS NOT NULL THEN
    PERFORM public.agenda_advisory_lock_daily_capacity(v_org, v_kind, p_booking_date, v_location);
  END IF;

  v_available := public.agenda_sheet_inventory_available_count(
    v_org, v_kind, p_booking_date, p_booking_time, v_location
  );
  IF COALESCE(v_available, 0) < 1 THEN
    RAISE EXCEPTION 'SIN_CUPO_REAL_EN_SHEET: no queda lugar disponible para captura manual.' USING ERRCODE = '22023';
  END IF;

  IF v_kind = 'firmas' THEN
    v_daily := public.agenda_firmas_daily_remaining(v_org, p_booking_date, v_location);
  ELSE
    v_daily := public.agenda_daily_remaining(v_org, v_kind, p_booking_date, v_location);
  END IF;
  IF v_daily IS NOT NULL AND v_daily < 1 THEN
    RAISE EXCEPTION 'SIN_CUPO_DIA: el cupo diario esta completo.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.agenda_manual_occupancies (
    organization_id, kind, location_id, booking_date, booking_time, display_time,
    nss, cliente_nombre, asesor_nombre, notes,
    status, counts_toward_capacity, source, created_by
  ) VALUES (
    v_org, v_kind::public.booking_kind, v_location, p_booking_date, p_booking_time,
    COALESCE(p_display_time, p_booking_time),
    v_nss, btrim(p_cliente_nombre), NULLIF(btrim(COALESCE(p_asesor_nombre,'')),''),
    NULLIF(btrim(COALESCE(p_notes,'')),''),
    'active', TRUE, 'manual_crm', v_actor
  ) RETURNING id INTO v_id;

  PERFORM public.log_action(
    v_org, v_actor, v_role,
    'AGENDA_MANUAL_OCCUPANCY_CREATED',
    'agenda_manual_occupancy', v_id,
    jsonb_build_object(
      'booking_date', p_booking_date,
      'booking_time', p_booking_time,
      'display_time', COALESCE(p_display_time, p_booking_time),
      'kind', v_kind,
      'location_id', v_location,
      'mutates_stage', false,
      'creates_booking', false
    )
  );

  RETURN jsonb_build_object('ok', true, 'manual_occupancy_id', v_id, 'mutates_stage', false, 'creates_booking', false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.agenda_hoja_crm_cancel_manual(
  p_manual_occupancy_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor UUID;
  v_org UUID;
  v_role public.app_role;
  v_row public.agenda_manual_occupancies%ROWTYPE;
BEGIN
  v_actor := public.current_profile_id();
  SELECT p.organization_id, p.app_role INTO v_org, v_role
  FROM public.profiles p
  WHERE p.id = v_actor AND p.active = TRUE;
  IF v_actor IS NULL OR v_org IS NULL OR v_role NOT IN ('mesa_admin','mesa_interno','mesa_externo','super_admin') THEN
    RAISE EXCEPTION 'agenda_hoja_crm_cancel_manual: no autorizado' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row
  FROM public.agenda_manual_occupancies m
  WHERE m.id = p_manual_occupancy_id
    AND m.organization_id = v_org
    AND m.source = 'manual_crm'
    AND m.status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'agenda_hoja_crm_cancel_manual: captura no disponible' USING ERRCODE = '22023';
  END IF;

  UPDATE public.agenda_manual_occupancies
  SET status = 'cancelled', cancelled_by = v_actor, cancelled_at = NOW(), updated_at = NOW()
  WHERE id = v_row.id;

  PERFORM public.log_action(
    v_org, v_actor, v_role,
    'AGENDA_MANUAL_OCCUPANCY_CANCELLED',
    'agenda_manual_occupancy', v_row.id,
    jsonb_build_object(
      'booking_date', v_row.booking_date,
      'booking_time', v_row.booking_time,
      'kind', v_row.kind,
      'location_id', v_row.location_id,
      'mutates_stage', false
    )
  );

  RETURN jsonb_build_object('ok', true, 'manual_occupancy_id', v_row.id, 'mutates_stage', false);
END;
$function$;

REVOKE ALL ON FUNCTION public.agenda_hoja_crm_list(DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agenda_hoja_crm_list(DATE) TO authenticated, service_role, postgres;
REVOKE ALL ON FUNCTION public.agenda_hoja_crm_save_result(TEXT,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agenda_hoja_crm_save_result(TEXT,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) TO authenticated, service_role, postgres;
REVOKE ALL ON FUNCTION public.agenda_hoja_crm_add_manual(DATE,TIME,TEXT,TEXT,TIME,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agenda_hoja_crm_add_manual(DATE,TIME,TEXT,TEXT,TIME,TEXT,TEXT,TEXT,TEXT) TO authenticated, service_role, postgres;
REVOKE ALL ON FUNCTION public.agenda_hoja_crm_cancel_manual(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agenda_hoja_crm_cancel_manual(UUID) TO authenticated, service_role, postgres;

COMMENT ON FUNCTION public.agenda_hoja_crm_list(DATE) IS
  'Vista diaria tipo Drive: inventario Sheet vigente + overrides/resultados y manuales CRM. Solo lectura de bookings/expedientes.';
COMMENT ON FUNCTION public.agenda_hoja_crm_save_result(TEXT,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT) IS
  'Captura resultado/color/notas en CRM. No cambia etapa ni agenda_booking.';
COMMENT ON FUNCTION public.agenda_hoja_crm_add_manual(DATE,TIME,TEXT,TEXT,TIME,TEXT,TEXT,TEXT,TEXT) IS
  'Ocupacion manual CRM que consume cupo sin crear booking ni mover etapa.';
