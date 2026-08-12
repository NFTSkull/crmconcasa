-- ConCasa CRM — P170: motor canónico Sheet → expediente (apply operacional)
-- Extiende P165 (proyección) sin cablear webhook/reconcile.
-- Avances: biométricos →5; bio+notif COMPLETED →8 (5→8 vigente); firma FIRMO=SI →11.
-- Rechazo system-driven sin impersonar humano. Idempotencia por fingerprint.
-- NO toca inventory/cupos/P160/P162; NO cancela bookings; NO auto-reactiva; NUNCA etapa 12.

-- =============================================================================
-- 1) Proyección ops: notas + metadata de apply
-- =============================================================================
ALTER TABLE public.agenda_sheet_operational_results
  ADD COLUMN IF NOT EXISTS notes_raw TEXT NULL,
  ADD COLUMN IF NOT EXISTS last_applied_fingerprint TEXT NULL,
  ADD COLUMN IF NOT EXISTS last_applied_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS apply_outcome TEXT NULL;

COMMENT ON COLUMN public.agenda_sheet_operational_results.notes_raw IS
  'P170: NOTAS del Sheet (motivo descriptivo). No clasifica COMPLETED/FAILED.';
COMMENT ON COLUMN public.agenda_sheet_operational_results.last_applied_fingerprint IS
  'P170: fingerprint del último estado operativo aplicado al expediente.';
COMMENT ON COLUMN public.agenda_sheet_operational_results.last_applied_at IS
  'P170: timestamp de la última aplicación efectiva o NO_OP idempotente.';
COMMENT ON COLUMN public.agenda_sheet_operational_results.apply_outcome IS
  'P170: último outcome (APPLIED/NO_OP/NO_APPLY/LINK_MISMATCH/SKIPPED_*/REQUIRES_HUMAN_REACTIVATION/…).';

-- Upsert P165: aceptar notes_raw sin pisar metadata de apply
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
      notes_raw,
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
      last_seen_at = EXCLUDED.last_seen_at,
      updated_at = NOW();
      -- last_applied_* / apply_outcome NO se tocan (solo apply RPC)

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('upserted', v_count);
END;
$$;

-- =============================================================================
-- 2) Rechazo: decision_source human | google_sheet (sin falsificar persona)
-- =============================================================================
ALTER TABLE public.expediente_rechazos_operativos
  ADD COLUMN IF NOT EXISTS decision_source TEXT NOT NULL DEFAULT 'human',
  ADD COLUMN IF NOT EXISTS source_spreadsheet_id TEXT NULL,
  ADD COLUMN IF NOT EXISTS source_sheet_id BIGINT NULL,
  ADD COLUMN IF NOT EXISTS source_sheet_row INTEGER NULL,
  ADD COLUMN IF NOT EXISTS source_booking_id UUID NULL;

ALTER TABLE public.expediente_rechazos_operativos
  ALTER COLUMN decidido_por DROP NOT NULL,
  ALTER COLUMN decidido_por_rol DROP NOT NULL;

ALTER TABLE public.expediente_rechazos_operativos
  DROP CONSTRAINT IF EXISTS expediente_rechazos_operativos_decision_source_chk;

ALTER TABLE public.expediente_rechazos_operativos
  ADD CONSTRAINT expediente_rechazos_operativos_decision_source_chk
  CHECK (
    decision_source = 'human'
      AND decidido_por IS NOT NULL
      AND decidido_por_rol IS NOT NULL
      AND source_spreadsheet_id IS NULL
      AND source_sheet_id IS NULL
      AND source_sheet_row IS NULL
    OR
    decision_source = 'google_sheet'
      AND decidido_por IS NULL
      AND decidido_por_rol IS NULL
      AND source_spreadsheet_id IS NOT NULL
      AND btrim(source_spreadsheet_id) <> ''
      AND source_sheet_id IS NOT NULL
      AND source_sheet_row IS NOT NULL
      AND source_sheet_row > 0
  );

COMMENT ON COLUMN public.expediente_rechazos_operativos.decision_source IS
  'P170: human (Mesa) | google_sheet (CITAS 2026 system).';

-- =============================================================================
-- 3) Fingerprint canónico (servidor)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.agenda_sheet_ops_fingerprint(
  p_spreadsheet_id TEXT,
  p_sheet_id BIGINT,
  p_sheet_row INTEGER,
  p_expediente_id UUID,
  p_booking_id UUID,
  p_kind TEXT,
  p_biometric_result_class TEXT,
  p_biometric_result_raw TEXT,
  p_notification_result_class TEXT,
  p_notification_result_raw TEXT,
  p_signature_result_class TEXT,
  p_signature_result_raw TEXT,
  p_notes_raw TEXT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT md5(
    concat_ws(
      E'\x1f',
      coalesce(nullif(btrim(p_spreadsheet_id), ''), ''),
      coalesce(p_sheet_id::text, ''),
      coalesce(p_sheet_row::text, ''),
      coalesce(p_expediente_id::text, ''),
      coalesce(p_booking_id::text, ''),
      coalesce(lower(nullif(btrim(p_kind), '')), ''),
      coalesce(upper(nullif(btrim(p_biometric_result_class), '')), 'PENDING'),
      coalesce(nullif(btrim(p_biometric_result_raw), ''), ''),
      coalesce(upper(nullif(btrim(p_notification_result_class), '')), 'PENDING'),
      coalesce(nullif(btrim(p_notification_result_raw), ''), ''),
      coalesce(upper(nullif(btrim(p_signature_result_class), '')), 'PENDING'),
      coalesce(nullif(btrim(p_signature_result_raw), ''), ''),
      coalesce(nullif(btrim(p_notes_raw), ''), '')
    )
  );
$$;

REVOKE ALL ON FUNCTION public.agenda_sheet_ops_fingerprint(
  TEXT, BIGINT, INTEGER, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agenda_sheet_ops_fingerprint(
  TEXT, BIGINT, INTEGER, UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO service_role, postgres;

-- =============================================================================
-- 4) Helper rechazo interno (human o google_sheet)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.expediente_rechazar_operativo_internal(
  p_expediente_id UUID,
  p_motivo TEXT,
  p_comentario TEXT,
  p_biometricos_condicion public.biometricos_condicion,
  p_biometricos_razon TEXT DEFAULT NULL,
  p_biometricos_booking_id UUID DEFAULT NULL,
  p_actor_id UUID DEFAULT NULL,
  p_actor_role public.app_role DEFAULT NULL,
  p_decision_source TEXT DEFAULT 'human',
  p_source_spreadsheet_id TEXT DEFAULT NULL,
  p_source_sheet_id BIGINT DEFAULT NULL,
  p_source_sheet_row INTEGER DEFAULT NULL,
  p_source_booking_id UUID DEFAULT NULL,
  p_skip_future_booking_gate BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exp RECORD;
  v_booking RECORD;
  v_rechazo_id UUID;
  v_motivo TEXT;
  v_comentario TEXT;
  v_razon TEXT;
  v_timezone TEXT := 'America/Monterrey';
  v_booking_at TIMESTAMPTZ;
  v_source TEXT;
BEGIN
  v_source := lower(btrim(COALESCE(p_decision_source, 'human')));
  IF v_source NOT IN ('human', 'google_sheet') THEN
    RAISE EXCEPTION 'expediente_rechazar_operativo_internal: decision_source inválido'
      USING ERRCODE = '22023';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'REENTRY_NOT_REJECTED: expediente_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_motivo := NULLIF(btrim(COALESCE(p_motivo, '')), '');
  v_comentario := NULLIF(btrim(COALESCE(p_comentario, '')), '');
  v_razon := NULLIF(btrim(COALESCE(p_biometricos_razon, '')), '');

  IF v_motivo IS NULL THEN
    RAISE EXCEPTION 'REENTRY_NOT_REJECTED: motivo es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF p_biometricos_condicion IS NULL THEN
    RAISE EXCEPTION 'REENTRY_BIOMETRICS_NOT_REUSABLE: condición biométrica obligatoria'
      USING ERRCODE = '22023';
  END IF;

  IF p_biometricos_condicion IN ('reutilizables', 'repetir', 'invalidos')
     AND (p_biometricos_booking_id IS NULL OR v_razon IS NULL) THEN
    RAISE EXCEPTION 'REENTRY_BOOKING_EVIDENCE_MISSING: booking y razón son obligatorios para la condición declarada'
      USING ERRCODE = '22023';
  END IF;

  IF v_source = 'human' THEN
    IF p_actor_id IS NULL OR p_actor_role IS NULL THEN
      RAISE EXCEPTION 'REENTRY_NOT_OWNER: actor humano obligatorio'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NULLIF(btrim(COALESCE(p_source_spreadsheet_id, '')), '') IS NULL
       OR p_source_sheet_id IS NULL
       OR p_source_sheet_row IS NULL
       OR p_source_sheet_row <= 0 THEN
      RAISE EXCEPTION 'REENTRY_NOT_REJECTED: source Sheet obligatorio'
        USING ERRCODE = '22023';
    END IF;
    IF p_actor_id IS NOT NULL OR p_actor_role IS NOT NULL THEN
      RAISE EXCEPTION 'REENTRY_NOT_OWNER: google_sheet no admite actor humano'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT
    e.id,
    e.organization_id,
    e.etapa_actual,
    e.subestado,
    e.submitted_to_mesa,
    e.ciclo_estado,
    e.deleted_at
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id
  FOR UPDATE;

  IF NOT FOUND OR v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'REENTRY_NOT_REJECTED: expediente no disponible'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_exp.etapa_actual < 1 OR v_exp.etapa_actual > 12 THEN
    RAISE EXCEPTION 'REENTRY_STAGE_OUT_OF_RANGE: etapa actual %', v_exp.etapa_actual
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.ciclo_estado <> 'activo' THEN
    RAISE EXCEPTION 'REENTRY_CYCLE_NOT_ACTIVE: ciclo no activo'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.submitted_to_mesa IS NOT TRUE THEN
    RAISE EXCEPTION 'REENTRY_NOT_REJECTED: expediente no enviado a Mesa'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.subestado = 'rechazado' THEN
    RAISE EXCEPTION 'REENTRY_NOT_REJECTED: expediente ya rechazado'
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(NULLIF(btrim(ac.config->>'timezone'), ''), 'America/Monterrey')
  INTO v_timezone
  FROM public.agenda_config ac
  WHERE ac.organization_id = v_exp.organization_id
    AND ac.kind = 'biometricos';
  v_timezone := COALESCE(v_timezone, 'America/Monterrey');

  IF NOT p_skip_future_booking_gate AND EXISTS (
    SELECT 1
    FROM public.agenda_bookings b
    WHERE b.expediente_id = p_expediente_id
      AND b.kind = 'biometricos'
      AND b.status = 'booked'
      AND ((b.booking_date::TIMESTAMP + b.booking_time) AT TIME ZONE v_timezone) > NOW()
  ) THEN
    RAISE EXCEPTION 'REENTRY_FUTURE_BOOKING_ACTIVE: existe una cita biométrica futura activa'
      USING ERRCODE = '22023';
  END IF;

  IF p_biometricos_booking_id IS NOT NULL THEN
    SELECT
      b.id,
      b.expediente_id,
      b.organization_id,
      b.status,
      b.booking_date,
      b.booking_time,
      b.cancelled_at
    INTO v_booking
    FROM public.agenda_bookings b
    WHERE b.id = p_biometricos_booking_id
      AND b.expediente_id = p_expediente_id
      AND b.organization_id = v_exp.organization_id
      AND b.kind = 'biometricos';

    IF NOT FOUND THEN
      RAISE EXCEPTION 'REENTRY_BOOKING_EVIDENCE_MISSING: booking no pertenece al expediente'
        USING ERRCODE = '22023';
    END IF;

    v_booking_at :=
      (v_booking.booking_date::TIMESTAMP + v_booking.booking_time)
      AT TIME ZONE v_timezone;

    IF v_booking_at > NOW()
       OR (
         v_booking.status = 'cancelled'
         AND (v_booking.cancelled_at IS NULL OR v_booking.cancelled_at < v_booking_at)
       )
       OR v_booking.status NOT IN ('booked', 'cancelled') THEN
      RAISE EXCEPTION 'REENTRY_BOOKING_EVIDENCE_MISSING: booking no acredita un intento pasado'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  INSERT INTO public.expediente_rechazos_operativos (
    organization_id,
    expediente_id,
    etapa,
    subestado_anterior,
    motivo,
    comentario,
    biometricos_condicion,
    biometricos_razon,
    biometricos_booking_id,
    decidido_por,
    decidido_por_rol,
    decision_source,
    source_spreadsheet_id,
    source_sheet_id,
    source_sheet_row,
    source_booking_id
  ) VALUES (
    v_exp.organization_id,
    p_expediente_id,
    v_exp.etapa_actual,
    v_exp.subestado,
    v_motivo,
    v_comentario,
    p_biometricos_condicion,
    v_razon,
    p_biometricos_booking_id,
    CASE WHEN v_source = 'human' THEN p_actor_id ELSE NULL END,
    CASE WHEN v_source = 'human' THEN p_actor_role ELSE NULL END,
    v_source,
    CASE WHEN v_source = 'google_sheet' THEN btrim(p_source_spreadsheet_id) ELSE NULL END,
    CASE WHEN v_source = 'google_sheet' THEN p_source_sheet_id ELSE NULL END,
    CASE WHEN v_source = 'google_sheet' THEN p_source_sheet_row ELSE NULL END,
    CASE WHEN v_source = 'google_sheet' THEN p_source_booking_id ELSE NULL END
  )
  RETURNING id INTO v_rechazo_id;

  UPDATE public.expedientes
  SET
    subestado = 'rechazado',
    motivo_rechazo = v_motivo,
    comentario_rechazo = v_comentario,
    updated_at = NOW()
  WHERE id = p_expediente_id;

  PERFORM public.log_action(
    v_exp.organization_id,
    p_actor_id,
    p_actor_role,
    CASE
      WHEN v_source = 'google_sheet' THEN 'agenda_sheet.operational.reject'
      ELSE 'expediente.rechazo_operativo'
    END,
    'expediente',
    p_expediente_id,
    jsonb_build_object(
      'rechazo_id', v_rechazo_id,
      'etapa', v_exp.etapa_actual,
      'subestado_anterior', v_exp.subestado,
      'motivo', v_motivo,
      'comentario', v_comentario,
      'biometricos_condicion', p_biometricos_condicion,
      'biometricos_razon', v_razon,
      'biometricos_booking_id', p_biometricos_booking_id,
      'decision_source', v_source,
      'source', CASE WHEN v_source = 'google_sheet' THEN 'google_sheet' ELSE NULL END,
      'spreadsheet_id', p_source_spreadsheet_id,
      'sheet_id', p_source_sheet_id,
      'sheet_row', p_source_sheet_row,
      'booking_id', p_source_booking_id
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'expediente_id', p_expediente_id,
    'rechazo_id', v_rechazo_id,
    'etapa', v_exp.etapa_actual,
    'subestado', 'rechazado',
    'biometricos_condicion', p_biometricos_condicion,
    'biometricos_booking_id', p_biometricos_booking_id,
    'decision_source', v_source
  );
END;
$$;

REVOKE ALL ON FUNCTION public.expediente_rechazar_operativo_internal(
  UUID, TEXT, TEXT, public.biometricos_condicion, TEXT, UUID,
  UUID, public.app_role, TEXT, TEXT, BIGINT, INTEGER, UUID, BOOLEAN
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.expediente_rechazar_operativo_internal(
  UUID, TEXT, TEXT, public.biometricos_condicion, TEXT, UUID,
  UUID, public.app_role, TEXT, TEXT, BIGINT, INTEGER, UUID, BOOLEAN
) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expediente_rechazar_operativo_internal(
  UUID, TEXT, TEXT, public.biometricos_condicion, TEXT, UUID,
  UUID, public.app_role, TEXT, TEXT, BIGINT, INTEGER, UUID, BOOLEAN
) TO postgres;

-- Wrapper humano: misma firma pública; delega al helper
CREATE OR REPLACE FUNCTION public.rechazar_etapa_operativa(
  p_expediente_id UUID,
  p_motivo TEXT,
  p_comentario TEXT,
  p_biometricos_condicion public.biometricos_condicion,
  p_biometricos_razon TEXT DEFAULT NULL,
  p_biometricos_booking_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID;
  v_actor_role public.app_role;
  v_actor_org UUID;
  v_exp_org UUID;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'REENTRY_NOT_OWNER: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_actor_org
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND OR v_actor_role NOT IN (
    'mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin'
  ) THEN
    RAISE EXCEPTION 'REENTRY_NOT_OWNER: rol no autorizado'
      USING ERRCODE = '42501';
  END IF;

  SELECT e.organization_id INTO v_exp_org
  FROM public.expedientes e
  WHERE e.id = p_expediente_id;

  IF v_actor_role <> 'super_admin'
     AND v_exp_org IS DISTINCT FROM v_actor_org THEN
    RAISE EXCEPTION 'REENTRY_NOT_OWNER: expediente fuera de la organización'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.can_see_expediente(p_expediente_id) THEN
    RAISE EXCEPTION 'REENTRY_NOT_OWNER: expediente no visible para el actor'
      USING ERRCODE = '42501';
  END IF;

  RETURN public.expediente_rechazar_operativo_internal(
    p_expediente_id,
    p_motivo,
    p_comentario,
    p_biometricos_condicion,
    p_biometricos_razon,
    p_biometricos_booking_id,
    v_actor_id,
    v_actor_role,
    'human',
    NULL,
    NULL,
    NULL,
    NULL,
    false
  );
END;
$$;

COMMENT ON FUNCTION public.rechazar_etapa_operativa(
  UUID, TEXT, TEXT, public.biometricos_condicion, TEXT, UUID
) IS
  'P071/P096/P170: rechazo operativo humano Mesa. Delega a expediente_rechazar_operativo_internal.';

-- =============================================================================
-- 5) Apply RPC (service_role only)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.agenda_sheet_apply_operational_result(
  p_organization_id UUID,
  p_spreadsheet_id TEXT,
  p_sheet_id BIGINT,
  p_sheet_row INTEGER,
  p_booking_date DATE,
  p_kind TEXT,
  p_location_id TEXT,
  p_booking_id UUID,
  p_expediente_id UUID,
  p_biometric_result_class TEXT,
  p_biometric_result_raw TEXT,
  p_notification_result_class TEXT,
  p_notification_result_raw TEXT,
  p_signature_result_class TEXT,
  p_signature_result_raw TEXT,
  p_notes_raw TEXT DEFAULT NULL,
  p_fingerprint TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kind TEXT;
  v_fp TEXT;
  v_fp_in TEXT;
  v_ops public.agenda_sheet_operational_results%ROWTYPE;
  v_book public.agenda_bookings%ROWTYPE;
  v_exp public.expedientes%ROWTYPE;
  v_bio TEXT;
  v_notif TEXT;
  v_sig TEXT;
  v_notes TEXT;
  v_motivo TEXT;
  v_etapa_antes SMALLINT;
  v_sub_antes public.operativo_subestado;
  v_etapa_despues SMALLINT;
  v_sub_despues public.operativo_subestado;
  v_outcome TEXT;
  v_actions TEXT[] := ARRAY[]::TEXT[];
  v_booking_id UUID;
  v_fecha_cita TIMESTAMPTZ;
  v_mutated BOOLEAN := false;
  v_reject_done BOOLEAN := false;
  v_tmp JSONB;
BEGIN
  PERFORM public.agenda_sheet_assert_service_role();

  v_kind := lower(btrim(COALESCE(p_kind, '')));
  IF v_kind NOT IN ('biometricos', 'firmas') THEN
    RETURN jsonb_build_object('ok', false, 'outcome', 'NO_APPLY', 'reason', 'kind_invalid');
  END IF;

  IF p_organization_id IS NULL
     OR NULLIF(btrim(COALESCE(p_spreadsheet_id, '')), '') IS NULL
     OR p_sheet_id IS NULL
     OR p_sheet_row IS NULL
     OR p_sheet_row <= 0
     OR p_booking_date IS NULL
     OR NULLIF(btrim(COALESCE(p_location_id, '')), '') IS NULL
  THEN
    RETURN jsonb_build_object('ok', false, 'outcome', 'NO_APPLY', 'reason', 'input_incomplete');
  END IF;

  -- Identidad obligatoria para mutar
  IF p_booking_id IS NULL OR p_expediente_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'outcome', 'NO_APPLY', 'reason', 'missing_pq');
  END IF;

  v_bio := upper(btrim(COALESCE(p_biometric_result_class, 'PENDING')));
  v_notif := upper(btrim(COALESCE(p_notification_result_class, 'PENDING')));
  v_sig := upper(btrim(COALESCE(p_signature_result_class, 'PENDING')));
  v_notes := NULLIF(btrim(COALESCE(p_notes_raw, '')), '');

  v_fp := public.agenda_sheet_ops_fingerprint(
    p_spreadsheet_id, p_sheet_id, p_sheet_row,
    p_expediente_id, p_booking_id, v_kind,
    v_bio, p_biometric_result_raw,
    v_notif, p_notification_result_raw,
    v_sig, p_signature_result_raw,
    v_notes
  );
  v_fp_in := NULLIF(btrim(COALESCE(p_fingerprint, '')), '');
  IF v_fp_in IS NOT NULL AND v_fp_in IS DISTINCT FROM v_fp THEN
    -- Edge envió fingerprint distinto: autoridad = servidor
    NULL;
  END IF;

  -- Identidad P/Q/kind/org ANTES de cualquier write (no mutación parcial / no FK inválida)
  SELECT * INTO v_book
  FROM public.agenda_bookings b
  WHERE b.id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND
     OR v_book.expediente_id IS DISTINCT FROM p_expediente_id
     OR v_book.organization_id IS DISTINCT FROM p_organization_id
     OR v_book.kind::text IS DISTINCT FROM v_kind
  THEN
    RETURN jsonb_build_object(
      'ok', true,
      'outcome', 'LINK_MISMATCH',
      'fingerprint', v_fp,
      'reason', 'booking_pq_kind_org'
    );
  END IF;

  SELECT * INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id
  FOR UPDATE;

  IF NOT FOUND OR v_exp.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true, 'outcome', 'SKIPPED_TERMINAL',
      'reason', 'deleted_or_missing', 'fingerprint', v_fp
    );
  END IF;

  IF v_exp.organization_id IS DISTINCT FROM p_organization_id THEN
    RETURN jsonb_build_object(
      'ok', true, 'outcome', 'LINK_MISMATCH',
      'reason', 'org_mismatch', 'fingerprint', v_fp
    );
  END IF;

  -- Upsert proyección fila (observación) sin tocar apply metadata salvo al final
  INSERT INTO public.agenda_sheet_operational_results AS t (
    organization_id, spreadsheet_id, sheet_id, sheet_title, booking_date, sheet_row,
    kind, location_id, booking_id, expediente_id,
    biometric_result_class, biometric_result_raw,
    notification_result_class, notification_result_raw,
    signature_result_class, signature_result_raw,
    notes_raw, last_seen_at
  ) VALUES (
    p_organization_id, btrim(p_spreadsheet_id), p_sheet_id, '(apply)', p_booking_date, p_sheet_row,
    v_kind, lower(btrim(p_location_id)), p_booking_id, p_expediente_id,
    v_bio, NULLIF(btrim(COALESCE(p_biometric_result_raw, '')), ''),
    v_notif, NULLIF(btrim(COALESCE(p_notification_result_raw, '')), ''),
    v_sig, NULLIF(btrim(COALESCE(p_signature_result_raw, '')), ''),
    v_notes, NOW()
  )
  ON CONFLICT (spreadsheet_id, sheet_id, sheet_row) DO UPDATE SET
    organization_id = EXCLUDED.organization_id,
    booking_date = EXCLUDED.booking_date,
    kind = EXCLUDED.kind,
    location_id = EXCLUDED.location_id,
    booking_id = EXCLUDED.booking_id,
    expediente_id = EXCLUDED.expediente_id,
    biometric_result_class = EXCLUDED.biometric_result_class,
    biometric_result_raw = EXCLUDED.biometric_result_raw,
    notification_result_class = EXCLUDED.notification_result_class,
    notification_result_raw = EXCLUDED.notification_result_raw,
    signature_result_class = EXCLUDED.signature_result_class,
    signature_result_raw = EXCLUDED.signature_result_raw,
    notes_raw = EXCLUDED.notes_raw,
    last_seen_at = NOW(),
    updated_at = NOW();

  SELECT * INTO v_ops
  FROM public.agenda_sheet_operational_results
  WHERE spreadsheet_id = btrim(p_spreadsheet_id)
    AND sheet_id = p_sheet_id
    AND sheet_row = p_sheet_row
  FOR UPDATE;

  -- Idempotencia
  IF v_ops.last_applied_fingerprint IS NOT NULL
     AND v_ops.last_applied_fingerprint = v_fp THEN
    UPDATE public.agenda_sheet_operational_results
    SET last_applied_at = NOW(), apply_outcome = 'NO_OP', updated_at = NOW()
    WHERE id = v_ops.id;
    RETURN jsonb_build_object(
      'ok', true,
      'outcome', 'NO_OP',
      'fingerprint', v_fp,
      'expediente_id', p_expediente_id,
      'reason', 'same_fingerprint'
    );
  END IF;

  IF v_exp.ciclo_estado IS DISTINCT FROM 'activo' THEN
    UPDATE public.agenda_sheet_operational_results
    SET last_applied_fingerprint = v_fp, last_applied_at = NOW(),
        apply_outcome = 'SKIPPED_TERMINAL', updated_at = NOW()
    WHERE id = v_ops.id;
    RETURN jsonb_build_object('ok', true, 'outcome', 'SKIPPED_TERMINAL', 'reason', 'ciclo_inactivo', 'fingerprint', v_fp);
  END IF;

  v_etapa_antes := v_exp.etapa_actual;
  v_sub_antes := v_exp.subestado;
  v_etapa_despues := v_exp.etapa_actual;
  v_sub_despues := v_exp.subestado;

  -- Motivo rechazo
  v_motivo := COALESCE(
    v_notes,
    NULLIF(btrim(COALESCE(
      CASE
        WHEN v_kind = 'biometricos' AND v_bio = 'FAILED_OR_NOT_ATTENDED' THEN p_biometric_result_raw
        WHEN v_kind = 'biometricos' AND v_notif = 'FAILED_OR_NOT_ATTENDED' THEN p_notification_result_raw
        WHEN v_kind = 'firmas' AND v_sig = 'FAILED_OR_NOT_ATTENDED' THEN p_signature_result_raw
        ELSE NULL
      END, '')), ''),
    'Resultado operativo no exitoso registrado en CITAS 2026'
  );

  ------------------------------------------------------------------
  -- BIOMÉTRICOS
  ------------------------------------------------------------------
  IF v_kind = 'biometricos' THEN
    -- D) bio FAILED → rechazo sin avance
    IF v_bio = 'FAILED_OR_NOT_ATTENDED' THEN
      IF v_exp.subestado = 'rechazado' THEN
        v_outcome := 'NO_OP';
      ELSIF v_exp.submitted_to_mesa IS NOT TRUE THEN
        v_outcome := 'SKIPPED_GATE';
      ELSE
        BEGIN
          v_tmp := public.expediente_rechazar_operativo_internal(
            p_expediente_id, v_motivo, NULL, 'desconocida', NULL, NULL,
            NULL, NULL, 'google_sheet',
            p_spreadsheet_id, p_sheet_id, p_sheet_row, p_booking_id,
            true
          );
          v_reject_done := true;
          v_mutated := true;
          v_actions := array_append(v_actions, 'reject');
          v_sub_despues := 'rechazado';
          v_outcome := 'APPLIED';
        EXCEPTION WHEN OTHERS THEN
          v_outcome := 'SKIPPED_GATE';
        END;
      END IF;

    ELSIF v_bio = 'COMPLETED' THEN
      -- X→verde / expediente ya rechazado: no auto-reactiva
      IF v_exp.subestado = 'rechazado' THEN
        UPDATE public.agenda_sheet_operational_results
        SET last_applied_fingerprint = v_fp, last_applied_at = NOW(),
            apply_outcome = 'REQUIRES_HUMAN_REACTIVATION', updated_at = NOW()
        WHERE id = v_ops.id;
        RETURN jsonb_build_object(
          'ok', true,
          'outcome', 'REQUIRES_HUMAN_REACTIVATION',
          'fingerprint', v_fp,
          'etapa_actual', v_exp.etapa_actual,
          'subestado', v_exp.subestado
        );
      END IF;

      IF v_exp.submitted_to_mesa IS NOT TRUE THEN
        v_outcome := 'SKIPPED_GATE';
      ELSE
        -- A/B/C: asegurar hasta 5 si corresponde
        IF v_exp.etapa_actual < 3 THEN
          v_outcome := 'SKIPPED_STAGE';
        ELSIF v_exp.etapa_actual IN (3, 4) THEN
          v_fecha_cita := v_exp.fecha_cita;
          IF v_fecha_cita IS NULL OR v_book.status IS DISTINCT FROM 'booked' THEN
            v_outcome := 'SKIPPED_GATE';
          ELSE
            IF v_exp.etapa_actual = 3 THEN
              UPDATE public.expedientes
              SET etapa_actual = 4, subestado = 'en_proceso', updated_at = NOW()
              WHERE id = p_expediente_id;
              PERFORM public.log_action(
                p_organization_id, NULL, NULL,
                'agenda_sheet.operational.bio_advance',
                'expediente', p_expediente_id,
                jsonb_build_object(
                  'source', 'google_sheet', 'spreadsheet_id', p_spreadsheet_id,
                  'sheet_id', p_sheet_id, 'sheet_row', p_sheet_row,
                  'booking_id', p_booking_id, 'fingerprint', v_fp,
                  'etapa_anterior', 3, 'etapa_nueva', 4,
                  'transition', '3_4_sheet_bio'
                )
              );
              v_actions := array_append(v_actions, 'bio_advance');
              v_mutated := true;
              v_exp.etapa_actual := 4;
            END IF;

            -- 4→5 (gates espejo avanzar)
            IF v_exp.etapa_actual = 4 THEN
              UPDATE public.expedientes
              SET etapa_actual = 5, subestado = 'en_proceso', updated_at = NOW()
              WHERE id = p_expediente_id;
              PERFORM public.log_action(
                p_organization_id, NULL, NULL,
                'agenda_sheet.operational.bio_advance',
                'expediente', p_expediente_id,
                jsonb_build_object(
                  'source', 'google_sheet', 'spreadsheet_id', p_spreadsheet_id,
                  'sheet_id', p_sheet_id, 'sheet_row', p_sheet_row,
                  'booking_id', p_booking_id, 'fingerprint', v_fp,
                  'etapa_anterior', 4, 'etapa_nueva', 5,
                  'transition', '4_5', 'kind', 'biometricos'
                )
              );
              v_actions := array_append(v_actions, 'bio_advance');
              v_mutated := true;
              v_exp.etapa_actual := 5;
              v_etapa_despues := 5;
              v_outcome := 'APPLIED';
            END IF;
          END IF;
        ELSIF v_exp.etapa_actual >= 5 THEN
          v_outcome := 'NO_OP'; -- no downgrade
          v_etapa_despues := v_exp.etapa_actual;
        END IF;

        -- B) notif COMPLETED → target 8 (5→8)
        IF v_notif = 'COMPLETED' AND v_outcome IS DISTINCT FROM 'SKIPPED_GATE'
           AND v_outcome IS DISTINCT FROM 'SKIPPED_STAGE' THEN
          SELECT e.* INTO v_exp FROM public.expedientes e WHERE e.id = p_expediente_id;
          IF v_exp.etapa_actual = 5 THEN
            IF v_exp.subestado IS DISTINCT FROM 'en_proceso'
               OR v_exp.fecha_cita IS NULL
               OR v_exp.fecha_cita > NOW()
               OR v_book.status IS DISTINCT FROM 'booked' THEN
              IF v_outcome IS NULL OR v_outcome = 'NO_OP' THEN
                v_outcome := 'SKIPPED_GATE';
              END IF;
            ELSE
              UPDATE public.expedientes
              SET etapa_actual = 8, subestado = 'en_proceso', updated_at = NOW()
              WHERE id = p_expediente_id;
              PERFORM public.log_action(
                p_organization_id, NULL, NULL,
                'agenda_sheet.operational.notification_close',
                'expediente', p_expediente_id,
                jsonb_build_object(
                  'source', 'google_sheet', 'spreadsheet_id', p_spreadsheet_id,
                  'sheet_id', p_sheet_id, 'sheet_row', p_sheet_row,
                  'booking_id', p_booking_id, 'fingerprint', v_fp,
                  'etapa_anterior', 5, 'etapa_nueva', 8,
                  'transition', '5_8'
                )
              );
              v_actions := array_append(v_actions, 'notification_close');
              v_mutated := true;
              v_etapa_despues := 8;
              v_outcome := 'APPLIED';
            END IF;
          ELSIF v_exp.etapa_actual >= 8 THEN
            IF v_outcome IS NULL OR v_outcome = 'NO_OP' THEN
              v_outcome := 'NO_OP';
            END IF;
            v_etapa_despues := v_exp.etapa_actual;
          END IF;
        END IF;

        -- C) notif FAILED tras bio COMPLETED → rechazo (después de reconocer ≥5)
        IF v_notif = 'FAILED_OR_NOT_ATTENDED' AND NOT v_reject_done THEN
          SELECT e.* INTO v_exp FROM public.expedientes e WHERE e.id = p_expediente_id;
          IF v_exp.subestado = 'rechazado' THEN
            NULL;
          ELSIF v_exp.submitted_to_mesa IS NOT TRUE THEN
            IF v_outcome IS NULL THEN v_outcome := 'SKIPPED_GATE'; END IF;
          ELSE
            BEGIN
              v_tmp := public.expediente_rechazar_operativo_internal(
                p_expediente_id, v_motivo, NULL, 'desconocida', NULL, NULL,
                NULL, NULL, 'google_sheet',
                p_spreadsheet_id, p_sheet_id, p_sheet_row, p_booking_id,
                true
              );
              v_reject_done := true;
              v_mutated := true;
              v_actions := array_append(v_actions, 'reject');
              v_sub_despues := 'rechazado';
              v_etapa_despues := v_exp.etapa_actual;
              v_outcome := 'APPLIED';
            EXCEPTION WHEN OTHERS THEN
              IF v_outcome IS NULL THEN v_outcome := 'SKIPPED_GATE'; END IF;
            END;
          END IF;
        END IF;
      END IF;

    ELSE
      -- PENDING/UNKNOWN bio: no mutar por esta señal
      v_outcome := 'NO_APPLY';
    END IF;

  ------------------------------------------------------------------
  -- FIRMAS
  ------------------------------------------------------------------
  ELSIF v_kind = 'firmas' THEN
    IF v_sig = 'FAILED_OR_NOT_ATTENDED' THEN
      IF v_exp.subestado = 'rechazado' THEN
        v_outcome := 'NO_OP';
      ELSIF v_exp.submitted_to_mesa IS NOT TRUE THEN
        v_outcome := 'SKIPPED_GATE';
      ELSE
        BEGIN
          v_tmp := public.expediente_rechazar_operativo_internal(
            p_expediente_id, v_motivo, NULL, 'desconocida', NULL, NULL,
            NULL, NULL, 'google_sheet',
            p_spreadsheet_id, p_sheet_id, p_sheet_row, p_booking_id,
            true
          );
          v_mutated := true;
          v_actions := array_append(v_actions, 'reject');
          v_sub_despues := 'rechazado';
          v_outcome := 'APPLIED';
        EXCEPTION WHEN OTHERS THEN
          v_outcome := 'SKIPPED_GATE';
        END;
      END IF;

    ELSIF v_sig = 'COMPLETED' THEN
      IF v_exp.subestado = 'rechazado' THEN
        UPDATE public.agenda_sheet_operational_results
        SET last_applied_fingerprint = v_fp, last_applied_at = NOW(),
            apply_outcome = 'REQUIRES_HUMAN_REACTIVATION', updated_at = NOW()
        WHERE id = v_ops.id;
        RETURN jsonb_build_object(
          'ok', true, 'outcome', 'REQUIRES_HUMAN_REACTIVATION',
          'fingerprint', v_fp, 'etapa_actual', v_exp.etapa_actual
        );
      END IF;

      IF v_exp.submitted_to_mesa IS NOT TRUE THEN
        v_outcome := 'SKIPPED_GATE';
      ELSIF v_exp.etapa_actual < 9 THEN
        v_outcome := 'SKIPPED_STAGE';
      ELSIF v_exp.etapa_actual >= 11 THEN
        v_outcome := 'NO_OP';
        v_etapa_despues := v_exp.etapa_actual;
      ELSE
        -- 9→10
        IF v_exp.etapa_actual = 9 THEN
          IF v_exp.subestado IS DISTINCT FROM 'en_proceso'
             OR v_exp.fecha_cita IS NULL
             OR v_book.status IS DISTINCT FROM 'booked' THEN
            v_outcome := 'SKIPPED_GATE';
          ELSE
            UPDATE public.expedientes
            SET etapa_actual = 10, subestado = 'en_proceso', updated_at = NOW()
            WHERE id = p_expediente_id;
            PERFORM public.log_action(
              p_organization_id, NULL, NULL,
              'agenda_sheet.operational.signature_complete',
              'expediente', p_expediente_id,
              jsonb_build_object(
                'source', 'google_sheet', 'spreadsheet_id', p_spreadsheet_id,
                'sheet_id', p_sheet_id, 'sheet_row', p_sheet_row,
                'booking_id', p_booking_id, 'fingerprint', v_fp,
                'etapa_anterior', 9, 'etapa_nueva', 10, 'transition', '9_10'
              )
            );
            v_actions := array_append(v_actions, 'signature_complete');
            v_mutated := true;
            v_exp.etapa_actual := 10;
          END IF;
        END IF;

        -- 10→11
        IF v_exp.etapa_actual = 10 AND (v_outcome IS NULL OR v_outcome IS DISTINCT FROM 'SKIPPED_GATE') THEN
          SELECT e.* INTO v_exp FROM public.expedientes e WHERE e.id = p_expediente_id;
          IF v_exp.subestado IS DISTINCT FROM 'en_proceso'
             OR v_exp.fecha_cita IS NULL
             OR v_book.status IS DISTINCT FROM 'booked' THEN
            IF NOT v_mutated THEN v_outcome := 'SKIPPED_GATE'; END IF;
          ELSE
            UPDATE public.expedientes
            SET etapa_actual = 11, subestado = 'en_proceso', updated_at = NOW()
            WHERE id = p_expediente_id;
            PERFORM public.log_action(
              p_organization_id, NULL, NULL,
              'agenda_sheet.operational.signature_complete',
              'expediente', p_expediente_id,
              jsonb_build_object(
                'source', 'google_sheet', 'spreadsheet_id', p_spreadsheet_id,
                'sheet_id', p_sheet_id, 'sheet_row', p_sheet_row,
                'booking_id', p_booking_id, 'fingerprint', v_fp,
                'etapa_anterior', 10, 'etapa_nueva', 11, 'transition', '10_11'
              )
            );
            v_actions := array_append(v_actions, 'signature_complete');
            v_mutated := true;
            v_etapa_despues := 11;
            v_outcome := 'APPLIED';
          END IF;
        END IF;
      END IF;
    ELSE
      v_outcome := 'NO_APPLY';
    END IF;
  END IF;

  IF v_outcome IS NULL THEN
    v_outcome := CASE WHEN v_mutated THEN 'APPLIED' ELSE 'NO_APPLY' END;
  END IF;

  SELECT e.etapa_actual, e.subestado INTO v_etapa_despues, v_sub_despues
  FROM public.expedientes e WHERE e.id = p_expediente_id;

  -- Guard: nunca 12 por Sheet; nunca tocar firma_agendable_desde
  IF v_etapa_despues >= 12 THEN
    RAISE EXCEPTION 'agenda_sheet_apply: no debe alcanzar etapa 12'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.agenda_sheet_operational_results
  SET last_applied_fingerprint = v_fp,
      last_applied_at = NOW(),
      apply_outcome = v_outcome,
      updated_at = NOW()
  WHERE id = v_ops.id;

  RETURN jsonb_build_object(
    'ok', true,
    'outcome', v_outcome,
    'fingerprint', v_fp,
    'expediente_id', p_expediente_id,
    'booking_id', p_booking_id,
    'kind', v_kind,
    'etapa_anterior', v_etapa_antes,
    'etapa_actual', v_etapa_despues,
    'subestado_anterior', v_sub_antes,
    'subestado', v_sub_despues,
    'actions', to_jsonb(v_actions),
    'mutated', v_mutated
  );
END;
$$;

COMMENT ON FUNCTION public.agenda_sheet_apply_operational_result(
  UUID, TEXT, BIGINT, INTEGER, DATE, TEXT, TEXT, UUID, UUID,
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) IS
  'P170: aplica resultado operativo CITAS 2026 al expediente (service_role). Idempotente por fingerprint.';

REVOKE ALL ON FUNCTION public.agenda_sheet_apply_operational_result(
  UUID, TEXT, BIGINT, INTEGER, DATE, TEXT, TEXT, UUID, UUID,
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agenda_sheet_apply_operational_result(
  UUID, TEXT, BIGINT, INTEGER, DATE, TEXT, TEXT, UUID, UUID,
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_sheet_apply_operational_result(
  UUID, TEXT, BIGINT, INTEGER, DATE, TEXT, TEXT, UUID, UUID,
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO service_role, postgres;
