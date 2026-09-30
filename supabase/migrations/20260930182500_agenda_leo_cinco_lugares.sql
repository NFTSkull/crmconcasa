-- ConCasa CRM — LEO / Hacer pagarés: cinco lugares manuales por día.
--
-- Regla:
-- - LEO siempre tiene máximo 5 lugares operativos.
-- - No consume los 15 cupos de Biométricos.
-- - El alta desde CRM es manual y requiere hora, NSS, cliente y asesor.
-- - Resultados/colores/notas se guardan en el mismo movimiento para que la fila
--   aparezca completa desde el inicio.

CREATE OR REPLACE FUNCTION public.agenda_hoja_crm_add_leo_manual(
  p_booking_date DATE,
  p_booking_time TIME,
  p_nss TEXT,
  p_cliente_nombre TEXT,
  p_asesor_nombre TEXT,
  p_biometric_result_raw TEXT DEFAULT NULL,
  p_biometric_color TEXT DEFAULT 'UNKNOWN',
  p_notification_result_raw TEXT DEFAULT NULL,
  p_notification_color TEXT DEFAULT 'UNKNOWN',
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
  v_nss_norm TEXT;
  v_cliente TEXT;
  v_asesor TEXT;
  v_total INTEGER;
  v_manual_id UUID;
  v_result_id UUID;
  v_bio_color TEXT;
  v_notif_color TEXT;
BEGIN
  v_actor := public.current_profile_id();

  SELECT p.organization_id, p.app_role
  INTO v_org, v_role
  FROM public.profiles p
  WHERE p.id = v_actor
    AND p.active = TRUE;

  IF v_actor IS NULL
     OR v_org IS NULL
     OR v_role NOT IN ('mesa_admin','mesa_interno','mesa_externo','super_admin') THEN
    RAISE EXCEPTION 'agenda_hoja_crm_add_leo_manual: no autorizado'
      USING ERRCODE = '42501';
  END IF;

  IF p_booking_date IS NULL OR p_booking_time IS NULL THEN
    RAISE EXCEPTION 'agenda_hoja_crm_add_leo_manual: fecha y hora requeridas'
      USING ERRCODE = '22023';
  END IF;

  v_nss_norm := regexp_replace(COALESCE(p_nss,''), '\D', '', 'g');
  v_cliente := NULLIF(btrim(COALESCE(p_cliente_nombre,'')), '');
  v_asesor := NULLIF(btrim(COALESCE(p_asesor_nombre,'')), '');

  IF length(v_nss_norm) <> 11 THEN
    RAISE EXCEPTION 'agenda_hoja_crm_add_leo_manual: NSS debe tener 11 digitos'
      USING ERRCODE = '22023';
  END IF;

  IF v_cliente IS NULL THEN
    RAISE EXCEPTION 'agenda_hoja_crm_add_leo_manual: nombre del cliente requerido'
      USING ERRCODE = '22023';
  END IF;

  IF v_asesor IS NULL THEN
    RAISE EXCEPTION 'agenda_hoja_crm_add_leo_manual: asesor requerido'
      USING ERRCODE = '22023';
  END IF;

  -- Serializa altas LEO por organización/día para que dos usuarios no ocupen
  -- simultáneamente el quinto lugar.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_org::text || ':leo:' || p_booking_date::text, 0)
  );

  IF EXISTS (
    SELECT 1
    FROM public.agenda_sheet_operational_results r
    WHERE r.organization_id = v_org
      AND r.booking_date = p_booking_date
      AND r.source_block = 'leo'
      AND r.projection_status = 'CURRENT'
      AND regexp_replace(COALESCE(r.visible_nss,''), '\D', '', 'g') = v_nss_norm
  )
  OR EXISTS (
    SELECT 1
    FROM public.agenda_manual_occupancies m
    WHERE m.organization_id = v_org
      AND m.booking_date = p_booking_date
      AND m.location_id = 'leo'
      AND m.kind = 'biometricos'::public.booking_kind
      AND m.status = 'active'
      AND m.source = 'manual_crm'
      AND regexp_replace(COALESCE(m.nss,''), '\D', '', 'g') = v_nss_norm
  ) THEN
    RAISE EXCEPTION 'LEO_DUPLICADO: este NSS ya esta capturado en LEO para el dia.'
      USING ERRCODE = '22023';
  END IF;

  WITH leo_keys AS (
    SELECT COALESCE(
      NULLIF(regexp_replace(COALESCE(r.visible_nss,''), '\D', '', 'g'),''),
      'drive:' || r.id::text
    ) AS k
    FROM public.agenda_sheet_operational_results r
    WHERE r.organization_id = v_org
      AND r.booking_date = p_booking_date
      AND r.source_block = 'leo'
      AND r.projection_status = 'CURRENT'

    UNION

    SELECT COALESCE(
      NULLIF(regexp_replace(COALESCE(m.nss,''), '\D', '', 'g'),''),
      'manual:' || m.id::text
    ) AS k
    FROM public.agenda_manual_occupancies m
    WHERE m.organization_id = v_org
      AND m.booking_date = p_booking_date
      AND m.location_id = 'leo'
      AND m.kind = 'biometricos'::public.booking_kind
      AND m.status = 'active'
      AND m.source = 'manual_crm'
  )
  SELECT count(*)::INTEGER
  INTO v_total
  FROM leo_keys;

  IF COALESCE(v_total,0) >= 5 THEN
    RAISE EXCEPTION 'LEO_CUPO_COMPLETO: LEO ya tiene 5 lugares ocupados.'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.agenda_manual_occupancies(
    organization_id,
    kind,
    location_id,
    booking_date,
    booking_time,
    display_time,
    nss,
    cliente_nombre,
    asesor_nombre,
    notes,
    status,
    counts_toward_capacity,
    source,
    created_by
  )
  VALUES(
    v_org,
    'biometricos'::public.booking_kind,
    'leo',
    p_booking_date,
    p_booking_time,
    p_booking_time,
    v_nss_norm,
    upper(v_cliente),
    upper(v_asesor),
    NULLIF(btrim(COALESCE(p_notes,'')), ''),
    'active',
    FALSE,
    'manual_crm',
    v_actor
  )
  RETURNING id INTO v_manual_id;

  v_bio_color := public.agenda_hoja_crm_normalize_color(p_biometric_color);
  v_notif_color := public.agenda_hoja_crm_normalize_color(p_notification_color);

  INSERT INTO public.agenda_operational_results_native(
    organization_id,
    manual_occupancy_id,
    kind,
    location_id,
    booking_date,
    booking_time,
    biometric_result_class,
    biometric_result_raw,
    biometric_color,
    notification_result_class,
    notification_result_raw,
    notification_color,
    signature_result_class,
    signature_result_raw,
    signature_color,
    notes_raw,
    biometric_cell_red,
    notification_cell_red,
    signature_cell_red,
    operational_red_veto,
    source,
    created_by
  )
  VALUES(
    v_org,
    v_manual_id,
    'biometricos',
    'leo',
    p_booking_date,
    p_booking_time,
    public.agenda_hoja_crm_result_class(p_biometric_result_raw, v_bio_color),
    NULLIF(btrim(COALESCE(p_biometric_result_raw,'')), ''),
    v_bio_color,
    public.agenda_hoja_crm_result_class(p_notification_result_raw, v_notif_color),
    NULLIF(btrim(COALESCE(p_notification_result_raw,'')), ''),
    v_notif_color,
    'PENDING',
    NULL,
    'UNKNOWN',
    NULLIF(btrim(COALESCE(p_notes,'')), ''),
    v_bio_color = 'RED',
    v_notif_color = 'RED',
    FALSE,
    (v_bio_color = 'RED' OR v_notif_color = 'RED'),
    'manual_crm',
    v_actor
  )
  RETURNING id INTO v_result_id;

  PERFORM public.log_action(
    v_org,
    v_actor,
    v_role,
    'AGENDA_LEO_MANUAL_CREATED',
    'agenda_manual_occupancy',
    v_manual_id,
    jsonb_build_object(
      'booking_date', p_booking_date,
      'booking_time', p_booking_time,
      'nss', v_nss_norm,
      'cliente_nombre', upper(v_cliente),
      'asesor_nombre', upper(v_asesor),
      'result_id', v_result_id,
      'leo_slot', COALESCE(v_total,0) + 1,
      'leo_capacity', 5,
      'counts_toward_capacity', false,
      'mutates_stage', false,
      'creates_booking', false
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'manual_occupancy_id', v_manual_id,
    'result_id', v_result_id,
    'leo_slot', COALESCE(v_total,0) + 1,
    'leo_capacity', 5,
    'counts_toward_capacity', false,
    'mutates_stage', false,
    'creates_booking', false
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.agenda_hoja_crm_add_leo_manual(
  DATE,TIME,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.agenda_hoja_crm_add_leo_manual(
  DATE,TIME,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT
) TO authenticated, service_role, postgres;

COMMENT ON FUNCTION public.agenda_hoja_crm_add_leo_manual(
  DATE,TIME,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT
) IS 'Alta manual LEO/Hacer pagarés. Máximo 5 registros por día; no consume capacidad de Biométricos ni crea booking.';
