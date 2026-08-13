-- ConCasa CRM — P175 B1: Cita extraordinaria de inscripción (LOCAL ONLY)
-- booking_kind=inscripcion; requirement; hora fija 11:00; cupo inventory.
-- NO Cloud apply B1. NO Sheet write. NO backfill. P170 APPLY OFF. P174 A read-only.
-- P172: kind inscripcion fuera de contingencia (constraints 171 intactos).

-- =============================================================================
-- 1) Enum
-- =============================================================================
ALTER TYPE public.booking_kind ADD VALUE IF NOT EXISTS 'inscripcion';

-- =============================================================================
-- 2) Unique active booking
-- =============================================================================
CREATE UNIQUE INDEX IF NOT EXISTS agenda_bookings_one_active_inscripcion_per_expediente_idx
  ON public.agenda_bookings (expediente_id, kind)
  WHERE kind = 'inscripcion'::public.booking_kind
    AND status = 'booked'::public.booking_status;

-- =============================================================================
-- 3) Requirement table
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.agenda_inscripcion_requerimientos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  expediente_id UUID NOT NULL REFERENCES public.expedientes(id),
  source_booking_id UUID NULL REFERENCES public.agenda_bookings(id),
  source_kind public.booking_kind NULL,
  source_type TEXT NOT NULL
    CHECK (source_type IN ('sheet', 'mesa')),
  status TEXT NOT NULL
    CHECK (status IN (
      'pending_booking',
      'booked',
      'completed',
      'cancelled',
      'rebook_required'
    )),
  requested_by UUID NULL REFERENCES public.profiles(id),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  booked_booking_id UUID NULL REFERENCES public.agenda_bookings(id),
  completed_at TIMESTAMPTZ NULL,
  cancelled_at TIMESTAMPTZ NULL,
  reason TEXT NULL,
  source_sheet_id BIGINT NULL,
  source_sheet_row INTEGER NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.agenda_inscripcion_requerimientos IS
  'P175: requisito persistente de cita extraordinaria de inscripción. Crear no cambia etapa.';

CREATE INDEX IF NOT EXISTS agenda_inscripcion_req_org_idx
  ON public.agenda_inscripcion_requerimientos (organization_id);
CREATE INDEX IF NOT EXISTS agenda_inscripcion_req_exp_idx
  ON public.agenda_inscripcion_requerimientos (expediente_id);
CREATE INDEX IF NOT EXISTS agenda_inscripcion_req_status_idx
  ON public.agenda_inscripcion_requerimientos (status);
CREATE INDEX IF NOT EXISTS agenda_inscripcion_req_source_booking_idx
  ON public.agenda_inscripcion_requerimientos (source_booking_id)
  WHERE source_booking_id IS NOT NULL;

-- Una sola necesidad ABIERTA por expediente
CREATE UNIQUE INDEX IF NOT EXISTS agenda_inscripcion_req_one_open_per_expediente_idx
  ON public.agenda_inscripcion_requerimientos (expediente_id)
  WHERE status IN ('pending_booking', 'booked', 'rebook_required');

ALTER TABLE public.agenda_inscripcion_requerimientos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agenda_inscripcion_req_select ON public.agenda_inscripcion_requerimientos;
CREATE POLICY agenda_inscripcion_req_select
  ON public.agenda_inscripcion_requerimientos
  FOR SELECT TO authenticated
  USING (
    organization_id = public.current_organization_id()
    AND public.can_see_expediente(expediente_id)
  );

REVOKE ALL ON TABLE public.agenda_inscripcion_requerimientos FROM PUBLIC;
REVOKE ALL ON TABLE public.agenda_inscripcion_requerimientos FROM anon;
GRANT SELECT ON TABLE public.agenda_inscripcion_requerimientos TO authenticated;
GRANT ALL ON TABLE public.agenda_inscripcion_requerimientos TO service_role;
GRANT ALL ON TABLE public.agenda_inscripcion_requerimientos TO postgres;

-- =============================================================================
-- 4) Ops projection flags
-- =============================================================================
ALTER TABLE public.agenda_sheet_operational_results
  ADD COLUMN IF NOT EXISTS inscripcion_rebook_required BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.agenda_sheet_operational_results
  ADD COLUMN IF NOT EXISTS inscripcion_rebook_reason_raw TEXT NULL;

COMMENT ON COLUMN public.agenda_sheet_operational_results.inscripcion_rebook_required IS
  'P175: bio COMPLETED + REAGENDA INSCRIP* en F. No implica FAILED genérico para apply.';

-- =============================================================================
-- 5) Widen kind CHECKs (inventory / links / ops) — P172 named CHECKs intactos
-- =============================================================================
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT c.conname, c.conrelid::regclass AS tbl
    FROM pg_constraint c
    WHERE c.contype = 'c'
      AND c.conrelid IN (
        'public.agenda_sheet_slot_inventory'::regclass,
        'public.agenda_sheet_slot_links'::regclass,
        'public.agenda_sheet_operational_results'::regclass
      )
      AND pg_get_constraintdef(c.oid) ILIKE '%kind%biometricos%firmas%'
      AND pg_get_constraintdef(c.oid) NOT ILIKE '%inscripcion%'
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS %I', r.tbl, r.conname);
  END LOOP;
END $$;

ALTER TABLE public.agenda_sheet_slot_inventory
  DROP CONSTRAINT IF EXISTS agenda_sheet_slot_inventory_kind_check;
ALTER TABLE public.agenda_sheet_slot_inventory
  ADD CONSTRAINT agenda_sheet_slot_inventory_kind_check
  CHECK (kind IN ('biometricos', 'firmas', 'inscripcion'));

ALTER TABLE public.agenda_sheet_slot_links
  DROP CONSTRAINT IF EXISTS agenda_sheet_slot_links_kind_check;
ALTER TABLE public.agenda_sheet_slot_links
  ADD CONSTRAINT agenda_sheet_slot_links_kind_check
  CHECK (kind IN ('biometricos', 'firmas', 'inscripcion'));

ALTER TABLE public.agenda_sheet_operational_results
  DROP CONSTRAINT IF EXISTS agenda_sheet_operational_results_kind_check;
ALTER TABLE public.agenda_sheet_operational_results
  ADD CONSTRAINT agenda_sheet_operational_results_kind_check
  CHECK (kind IN ('biometricos', 'firmas', 'inscripcion'));

-- =============================================================================
-- 6) Claim + outbox triggers: include inscripcion
-- =============================================================================
CREATE OR REPLACE FUNCTION public.agenda_sheet_inventory_claim_ai()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv_id UUID;
BEGIN
  IF NEW.kind IS NULL OR NEW.kind::TEXT NOT IN ('biometricos', 'firmas', 'inscripcion') THEN
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM 'booked' THEN
    RETURN NEW;
  END IF;
  IF NOT public.agenda_sheet_inventory_enforced(NEW.booking_date) THEN
    RETURN NEW;
  END IF;
  IF NOT public.agenda_sheet_inventory_applies(NEW.location_id) THEN
    RETURN NEW;
  END IF;

  -- Inscripción: cupo físico A=11:00 (sheet_slot_time / slot_time)
  IF NEW.kind::TEXT = 'inscripcion' THEN
    SELECT i.id INTO v_inv_id
    FROM public.agenda_sheet_slot_inventory i
    WHERE i.organization_id = NEW.organization_id
      AND i.booking_date = NEW.booking_date
      AND i.kind = 'inscripcion'
      AND i.location_id = NEW.location_id
      AND i.status = 'available'
      AND (
        i.sheet_slot_time = TIME '11:00'
        OR (i.sheet_slot_time IS NULL AND i.slot_time = TIME '11:00')
      )
    FOR UPDATE SKIP LOCKED
    LIMIT 1;
  ELSE
    SELECT i.id INTO v_inv_id
    FROM public.agenda_sheet_slot_inventory i
    WHERE i.organization_id = NEW.organization_id
      AND i.booking_date = NEW.booking_date
      AND i.kind = NEW.kind::TEXT
      AND i.location_id = NEW.location_id
      AND i.slot_time = NEW.booking_time
      AND i.status = 'available'
    FOR UPDATE SKIP LOCKED
    LIMIT 1;
  END IF;

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
    occupancy_source = 'crm',
    updated_at = NOW()
  WHERE i.id = v_inv_id;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.agenda_sheet_outbox_on_booking_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event TEXT;
  v_key TEXT;
  v_payload JSONB;
  v_version TEXT;
  v_sheet_id BIGINT;
  v_sheet_title TEXT;
  v_sheet_row INT;
  v_inventory_id UUID;
  v_had_link BOOLEAN := FALSE;
  v_prior_id UUID;
  v_prior_date DATE;
  v_prior_time TIME;
  v_prior_location TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.kind NOT IN ('biometricos', 'firmas', 'inscripcion') THEN
      RETURN NEW;
    END IF;
    IF NEW.status <> 'booked' THEN
      RETURN NEW;
    END IF;
    v_event := 'booking_created';
    v_version := '1';
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.kind NOT IN ('biometricos', 'firmas', 'inscripcion')
       AND OLD.kind NOT IN ('biometricos', 'firmas', 'inscripcion') THEN
      RETURN NEW;
    END IF;
    IF OLD.status = 'booked' AND NEW.status = 'cancelled' THEN
      v_event := 'booking_cancelled';
      v_version := COALESCE(NEW.cancelled_at::TEXT, NEW.updated_at::TEXT, 'c');
    ELSIF OLD.status = 'booked' AND NEW.status = 'booked'
          AND (
            OLD.booking_date IS DISTINCT FROM NEW.booking_date
            OR OLD.booking_time IS DISTINCT FROM NEW.booking_time
            OR OLD.location_id IS DISTINCT FROM NEW.location_id
          ) THEN
      v_event := 'booking_rescheduled';
      v_version := NEW.updated_at::TEXT;
    ELSIF OLD.status = 'booked' AND NEW.status = 'booked'
          AND (
            OLD.note IS DISTINCT FROM NEW.note
            OR OLD.report_group IS DISTINCT FROM NEW.report_group
          ) THEN
      v_event := 'booking_updated';
      v_version := NEW.updated_at::TEXT;
    ELSE
      RETURN NEW;
    END IF;
  ELSE
    RETURN NEW;
  END IF;

  -- 1) Inventario aún ligado (outbox corre antes del release gracias a z_ trigger)
  SELECT i.id, i.sheet_id, i.sheet_title, i.sheet_row
  INTO v_inventory_id, v_sheet_id, v_sheet_title, v_sheet_row
  FROM public.agenda_sheet_slot_inventory i
  WHERE i.booking_id = NEW.id
  LIMIT 1;

  IF v_inventory_id IS NOT NULL THEN
    v_had_link := TRUE;
  END IF;

  -- 2) Link activo
  IF v_sheet_row IS NULL THEN
    SELECT l.sheet_id, l.sheet_title, l.row_number
    INTO v_sheet_id, v_sheet_title, v_sheet_row
    FROM public.agenda_sheet_slot_links l
    WHERE l.booking_id = NEW.id
      AND l.deleted_at IS NULL
    ORDER BY l.updated_at DESC NULLS LAST
    LIMIT 1;
    IF FOUND THEN
      v_had_link := TRUE;
    END IF;
  END IF;

  -- 3) Soft-deleted link
  IF v_sheet_row IS NULL THEN
    SELECT l.sheet_id, l.sheet_title, l.row_number
    INTO v_sheet_id, v_sheet_title, v_sheet_row
    FROM public.agenda_sheet_slot_links l
    WHERE l.booking_id = NEW.id
      AND l.deleted_at IS NOT NULL
    ORDER BY l.deleted_at DESC NULLS LAST
    LIMIT 1;
    IF FOUND THEN
      v_had_link := TRUE;
    END IF;
  END IF;

  IF NOT v_had_link THEN
    SELECT EXISTS (
      SELECT 1 FROM public.agenda_sheet_slot_links l WHERE l.booking_id = NEW.id
    ) INTO v_had_link;
  END IF;

  v_key := NEW.id::TEXT || ':' || v_event || ':' || v_version;
  v_payload := jsonb_build_object(
    'booking_id', NEW.id,
    'organization_id', NEW.organization_id,
    'kind', NEW.kind,
    'status', NEW.status,
    'booking_date', NEW.booking_date,
    'booking_time', NEW.booking_time,
    'location_id', NEW.location_id,
    'expediente_id', NEW.expediente_id,
    'event_type', v_event,
    'sync_source', 'crm',
    'sheet_id', v_sheet_id,
    'sheet_title', v_sheet_title,
    'sheet_row', v_sheet_row,
    'inventory_id', v_inventory_id,
    'had_sheet_link', v_had_link
  );

  IF v_event = 'booking_created' THEN
    SELECT b.id, b.booking_date, b.booking_time, b.location_id
    INTO v_prior_id, v_prior_date, v_prior_time, v_prior_location
    FROM public.agenda_bookings b
    WHERE b.expediente_id = NEW.expediente_id
      AND b.kind = NEW.kind
      AND b.status = 'cancelled'
      AND b.id IS DISTINCT FROM NEW.id
      AND b.cancelled_at IS NOT NULL
      AND b.cancelled_at > NOW() - INTERVAL '2 hours'
    ORDER BY b.cancelled_at DESC
    LIMIT 1;

    IF v_prior_id IS NOT NULL THEN
      v_payload := v_payload || jsonb_build_object(
        'prior_cancelled_booking_id', v_prior_id,
        'prior_booking_date', v_prior_date,
        'prior_booking_time', v_prior_time,
        'prior_location_id', v_prior_location,
        'reschedule_move', true
      );
    END IF;
  END IF;

  IF v_event = 'booking_cancelled' THEN
    v_payload := v_payload || jsonb_build_object(
      'old_booking_date', NEW.booking_date,
      'old_booking_time', NEW.booking_time,
      'old_location_id', NEW.location_id
    );
  END IF;

  INSERT INTO public.agenda_sheet_sync_outbox (
    organization_id, booking_id, event_type, idempotency_key, payload
  ) VALUES (
    NEW.organization_id, NEW.id, v_event, v_key, v_payload
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN NEW;
END;
$$;


COMMENT ON FUNCTION public.agenda_sheet_outbox_on_booking_change() IS
  'Outbox CRM→Sheets; P175 incluye kind=inscripcion; cancel captura sheet_*; create prior_cancelled.';

-- =============================================================================
-- 7) Availability accepts inscripcion
-- =============================================================================
CREATE OR REPLACE FUNCTION public.agenda_sheet_inventory_availability(
  p_kind TEXT,
  p_date DATE,
  p_location_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_org UUID;
  v_kind TEXT;
  v_loc TEXT;
  v_total INT := 0;
  v_available INT := 0;
  v_occupied INT := 0;
BEGIN
  v_actor := public.current_profile_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'agenda_sheet_inventory_availability: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.organization_id INTO v_org
  FROM public.profiles p WHERE p.id = v_actor AND p.active = true;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'agenda_sheet_inventory_availability: organización no encontrada'
      USING ERRCODE = '42501';
  END IF;

  v_kind := lower(btrim(COALESCE(p_kind, '')));
  IF v_kind NOT IN ('biometricos', 'firmas', 'inscripcion') THEN
    RAISE EXCEPTION 'agenda_sheet_inventory_availability: kind inválido'
      USING ERRCODE = '22023';
  END IF;

  v_loc := lower(btrim(COALESCE(p_location_id, '')));
  IF v_loc NOT IN ('monterrey', 'apodaca') THEN
    RAISE EXCEPTION 'agenda_sheet_inventory_availability: sede inválida'
      USING ERRCODE = '22023';
  END IF;

  IF p_date IS NULL THEN
    RAISE EXCEPTION 'agenda_sheet_inventory_availability: fecha inválida'
      USING ERRCODE = '22023';
  END IF;

  IF v_kind = 'inscripcion' THEN
    SELECT
      count(*)::INT,
      count(*) FILTER (WHERE i.status = 'available')::INT,
      count(*) FILTER (WHERE i.status IN ('claimed', 'linked', 'occupied_external'))::INT
    INTO v_total, v_available, v_occupied
    FROM public.agenda_sheet_slot_inventory i
    WHERE i.organization_id = v_org
      AND i.booking_date = p_date
      AND i.kind = 'inscripcion'
      AND i.location_id = v_loc
      AND (
        i.sheet_slot_time = TIME '11:00'
        OR (i.sheet_slot_time IS NULL AND i.slot_time = TIME '11:00')
      )
      AND i.status IS DISTINCT FROM 'disabled';
  ELSE
    SELECT
      count(*)::INT,
      count(*) FILTER (WHERE i.status = 'available')::INT,
      count(*) FILTER (WHERE i.status IN ('claimed', 'linked', 'occupied_external'))::INT
    INTO v_total, v_available, v_occupied
    FROM public.agenda_sheet_slot_inventory i
    WHERE i.organization_id = v_org
      AND i.booking_date = p_date
      AND i.kind = v_kind
      AND i.location_id = v_loc
      AND i.status IS DISTINCT FROM 'disabled';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'kind', v_kind,
    'booking_date', p_date,
    'location_id', v_loc,
    'capacity', v_total,
    'available', v_available,
    'occupied', v_occupied,
    'fixed_time', CASE WHEN v_kind = 'inscripcion' THEN '11:00' ELSE NULL END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.agenda_sheet_inventory_availability(TEXT, DATE, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agenda_sheet_inventory_availability(TEXT, DATE, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.agenda_sheet_inventory_availability(TEXT, DATE, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_sheet_inventory_availability(TEXT, DATE, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.agenda_sheet_inventory_availability(TEXT, DATE, TEXT) TO postgres;


-- =============================================================================
-- 8) Helpers P175
-- =============================================================================
CREATE OR REPLACE FUNCTION public.agenda_inscripcion_etapa_permitida(p_etapa INT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_etapa IS NOT NULL AND p_etapa BETWEEN 3 AND 7;
$$;

CREATE OR REPLACE FUNCTION public.agenda_inscripcion_normalize_location(p_location_id TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v TEXT;
BEGIN
  v := lower(btrim(COALESCE(p_location_id, '')));
  IF v IN ('monterrey', 'mty') THEN RETURN 'monterrey'; END IF;
  IF v IN ('apodaca', 'apo') THEN RETURN 'apodaca'; END IF;
  RETURN NULL;
END;
$$;

-- =============================================================================
-- 9) Sheet requirement (service_role)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.agenda_inscripcion_require_from_sheet(
  p_organization_id UUID,
  p_source_booking_id UUID,
  p_expediente_id UUID,
  p_sheet_id BIGINT,
  p_sheet_row INTEGER,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_book RECORD;
  v_ops RECORD;
  v_exp RECORD;
  v_open UUID;
  v_id UUID;
  v_reason TEXT;
BEGIN
  IF p_organization_id IS NULL OR p_source_booking_id IS NULL OR p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'agenda_inscripcion_require_from_sheet: identidad incompleta' USING ERRCODE = '22023';
  END IF;

  SELECT b.* INTO v_book FROM public.agenda_bookings b WHERE b.id = p_source_booking_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'agenda_inscripcion_require_from_sheet: booking no encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF v_book.organization_id IS DISTINCT FROM p_organization_id
     OR v_book.expediente_id IS DISTINCT FROM p_expediente_id THEN
    RAISE EXCEPTION 'agenda_inscripcion_require_from_sheet: mismatch' USING ERRCODE = '22023';
  END IF;
  IF v_book.kind IS DISTINCT FROM 'biometricos'::public.booking_kind THEN
    RAISE EXCEPTION 'agenda_inscripcion_require_from_sheet: source debe ser biometricos' USING ERRCODE = '22023';
  END IF;

  SELECT e.* INTO v_exp FROM public.expedientes e WHERE e.id = p_expediente_id;
  IF NOT FOUND OR v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'agenda_inscripcion_require_from_sheet: expediente no disponible' USING ERRCODE = 'P0002';
  END IF;
  IF v_exp.organization_id IS DISTINCT FROM p_organization_id THEN
    RAISE EXCEPTION 'agenda_inscripcion_require_from_sheet: org mismatch' USING ERRCODE = '42501';
  END IF;
  IF v_exp.ciclo_estado IS DISTINCT FROM 'activo'
     OR v_exp.submitted_to_mesa IS NOT TRUE
     OR v_exp.subestado = 'rechazado'
     OR NOT public.agenda_inscripcion_etapa_permitida(v_exp.etapa_actual) THEN
    RAISE EXCEPTION 'agenda_inscripcion_require_from_sheet: expediente no elegible' USING ERRCODE = '22023';
  END IF;

  SELECT o.* INTO v_ops
  FROM public.agenda_sheet_operational_results o
  WHERE o.booking_id = p_source_booking_id
    AND o.expediente_id = p_expediente_id
    AND (p_sheet_id IS NULL OR o.sheet_id = p_sheet_id)
    AND (p_sheet_row IS NULL OR o.sheet_row = p_sheet_row)
  ORDER BY o.updated_at DESC NULLS LAST
  LIMIT 1;
  IF NOT FOUND
     OR v_ops.biometric_result_class IS DISTINCT FROM 'COMPLETED'
     OR COALESCE(v_ops.inscripcion_rebook_required, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'agenda_inscripcion_require_from_sheet: evidencia ops inválida' USING ERRCODE = '22023';
  END IF;

  SELECT r.id INTO v_open
  FROM public.agenda_inscripcion_requerimientos r
  WHERE r.expediente_id = p_expediente_id
    AND r.status IN ('pending_booking', 'booked', 'rebook_required')
  LIMIT 1;
  IF v_open IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'requirement_id', v_open);
  END IF;

  v_reason := NULLIF(left(btrim(COALESCE(p_reason, v_ops.inscripcion_rebook_reason_raw, '')), 500), '');
  INSERT INTO public.agenda_inscripcion_requerimientos (
    organization_id, expediente_id, source_booking_id, source_kind, source_type,
    status, reason, source_sheet_id, source_sheet_row
  ) VALUES (
    p_organization_id, p_expediente_id, p_source_booking_id, 'biometricos'::public.booking_kind,
    'sheet', 'pending_booking', v_reason, p_sheet_id, p_sheet_row
  ) RETURNING id INTO v_id;

  PERFORM public.log_action(
    p_organization_id, NULL, NULL,
    'agenda.inscripcion.require', 'expediente', p_expediente_id,
    jsonb_build_object('requirement_id', v_id, 'source_type', 'sheet',
      'source_booking_id', p_source_booking_id, 'etapa_actual', v_exp.etapa_actual)
  );

  RETURN jsonb_build_object('ok', true, 'idempotent', false, 'requirement_id', v_id,
    'status', 'pending_booking', 'etapa_actual', v_exp.etapa_actual);
END;
$$;

REVOKE ALL ON FUNCTION public.agenda_inscripcion_require_from_sheet(UUID, UUID, UUID, BIGINT, INTEGER, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agenda_inscripcion_require_from_sheet(UUID, UUID, UUID, BIGINT, INTEGER, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.agenda_inscripcion_require_from_sheet(UUID, UUID, UUID, BIGINT, INTEGER, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_inscripcion_require_from_sheet(UUID, UUID, UUID, BIGINT, INTEGER, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.agenda_inscripcion_require_from_sheet(UUID, UUID, UUID, BIGINT, INTEGER, TEXT) TO postgres;

-- =============================================================================
-- 10) Mesa solicitar
-- =============================================================================
CREATE OR REPLACE FUNCTION public.mesa_solicitar_cita_inscripcion(
  p_expediente_id UUID,
  p_motivo TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_role public.app_role;
  v_org UUID;
  v_exp RECORD;
  v_bio UUID;
  v_open UUID;
  v_id UUID;
  v_motivo TEXT;
BEGIN
  v_actor := public.current_profile_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'mesa_solicitar_cita_inscripcion: no autenticado' USING ERRCODE = '42501';
  END IF;
  SELECT p.app_role, p.organization_id INTO v_role, v_org
  FROM public.profiles p WHERE p.id = v_actor AND p.active = true;
  IF v_role IS NULL OR v_role NOT IN ('mesa_admin','mesa_interno','mesa_externo','super_admin') THEN
    RAISE EXCEPTION 'mesa_solicitar_cita_inscripcion: rol no autorizado' USING ERRCODE = '42501';
  END IF;

  v_motivo := NULLIF(btrim(COALESCE(p_motivo, '')), '');
  IF v_motivo IS NULL THEN
    RAISE EXCEPTION 'mesa_solicitar_cita_inscripcion: motivo obligatorio' USING ERRCODE = '22023';
  END IF;
  IF p_expediente_id IS NULL OR NOT public.can_see_expediente(p_expediente_id) THEN
    RAISE EXCEPTION 'mesa_solicitar_cita_inscripcion: no visible' USING ERRCODE = '42501';
  END IF;

  SELECT e.* INTO v_exp FROM public.expedientes e WHERE e.id = p_expediente_id;
  IF NOT FOUND OR v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'mesa_solicitar_cita_inscripcion: no disponible' USING ERRCODE = 'P0002';
  END IF;
  IF v_exp.organization_id IS DISTINCT FROM v_org AND v_role IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'mesa_solicitar_cita_inscripcion: org mismatch' USING ERRCODE = '42501';
  END IF;
  IF v_exp.ciclo_estado IS DISTINCT FROM 'activo'
     OR v_exp.submitted_to_mesa IS NOT TRUE
     OR v_exp.subestado = 'rechazado'
     OR NOT public.agenda_inscripcion_etapa_permitida(v_exp.etapa_actual) THEN
    RAISE EXCEPTION 'mesa_solicitar_cita_inscripcion: expediente no elegible' USING ERRCODE = '22023';
  END IF;

  SELECT b.id INTO v_bio FROM public.agenda_bookings b
  WHERE b.expediente_id = p_expediente_id AND b.kind = 'biometricos'::public.booking_kind
  ORDER BY b.created_at DESC NULLS LAST LIMIT 1;
  IF v_bio IS NULL THEN
    RAISE EXCEPTION 'mesa_solicitar_cita_inscripcion: sin biométricos previos' USING ERRCODE = '22023';
  END IF;

  SELECT r.id INTO v_open FROM public.agenda_inscripcion_requerimientos r
  WHERE r.expediente_id = p_expediente_id
    AND r.status IN ('pending_booking','booked','rebook_required') LIMIT 1;
  IF v_open IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'idempotent', true, 'requirement_id', v_open);
  END IF;

  INSERT INTO public.agenda_inscripcion_requerimientos (
    organization_id, expediente_id, source_booking_id, source_kind, source_type,
    status, requested_by, reason
  ) VALUES (
    v_exp.organization_id, p_expediente_id, v_bio, 'biometricos'::public.booking_kind,
    'mesa', 'pending_booking', v_actor, left(v_motivo, 500)
  ) RETURNING id INTO v_id;

  PERFORM public.log_action(
    v_exp.organization_id, v_actor, v_role,
    'agenda.inscripcion.require', 'expediente', p_expediente_id,
    jsonb_build_object('requirement_id', v_id, 'source_type', 'mesa', 'etapa_actual', v_exp.etapa_actual)
  );

  RETURN jsonb_build_object('ok', true, 'idempotent', false, 'requirement_id', v_id,
    'status', 'pending_booking', 'etapa_actual', v_exp.etapa_actual);
END;
$$;

REVOKE ALL ON FUNCTION public.mesa_solicitar_cita_inscripcion(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mesa_solicitar_cita_inscripcion(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.mesa_solicitar_cita_inscripcion(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mesa_solicitar_cita_inscripcion(UUID, TEXT) TO service_role;

-- =============================================================================
-- 11) Book
-- =============================================================================
CREATE OR REPLACE FUNCTION public.book_inscripcion_extraordinaria(
  p_expediente_id UUID,
  p_booking_date DATE,
  p_location_id TEXT,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_role public.app_role;
  v_org UUID;
  v_exp RECORD;
  v_req RECORD;
  v_loc TEXT;
  v_note TEXT;
  v_booking_id UUID;
  v_kind public.booking_kind := 'inscripcion';
  v_time TIME := TIME '11:00';
  v_avail INT;
  v_etapa INT;
BEGIN
  v_actor := public.current_profile_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'book_inscripcion_extraordinaria: no autenticado' USING ERRCODE = '42501';
  END IF;
  SELECT p.app_role, p.organization_id INTO v_role, v_org
  FROM public.profiles p WHERE p.id = v_actor AND p.active = true;
  IF v_role IS DISTINCT FROM 'asesor' THEN
    RAISE EXCEPTION 'book_inscripcion_extraordinaria: solo asesor' USING ERRCODE = '42501';
  END IF;

  v_loc := public.agenda_inscripcion_normalize_location(p_location_id);
  IF v_loc IS NULL THEN
    RAISE EXCEPTION 'book_inscripcion_extraordinaria: sede inválida' USING ERRCODE = '22023';
  END IF;
  IF p_booking_date IS NULL OR p_booking_date < (timezone('America/Monterrey', now()))::date THEN
    RAISE EXCEPTION 'book_inscripcion_extraordinaria: fecha inválida' USING ERRCODE = '22023';
  END IF;
  v_note := NULLIF(btrim(COALESCE(p_note, '')), '');

  SELECT e.* INTO v_exp FROM public.expedientes e WHERE e.id = p_expediente_id FOR UPDATE;
  IF NOT FOUND OR v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'book_inscripcion_extraordinaria: expediente no disponible' USING ERRCODE = 'P0002';
  END IF;
  IF v_exp.organization_id IS DISTINCT FROM v_org OR v_exp.asesor_id IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'book_inscripcion_extraordinaria: no autorizado' USING ERRCODE = '42501';
  END IF;
  IF v_exp.ciclo_estado IS DISTINCT FROM 'activo'
     OR v_exp.submitted_to_mesa IS NOT TRUE
     OR v_exp.subestado = 'rechazado'
     OR NOT public.agenda_inscripcion_etapa_permitida(v_exp.etapa_actual) THEN
    RAISE EXCEPTION 'book_inscripcion_extraordinaria: expediente no elegible' USING ERRCODE = '22023';
  END IF;
  v_etapa := v_exp.etapa_actual;

  SELECT r.* INTO v_req FROM public.agenda_inscripcion_requerimientos r
  WHERE r.expediente_id = p_expediente_id
    AND r.status IN ('pending_booking','rebook_required')
  FOR UPDATE LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'book_inscripcion_extraordinaria: sin requirement abierto' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.agenda_bookings b
    WHERE b.expediente_id = p_expediente_id AND b.kind = v_kind AND b.status = 'booked'
  ) THEN
    RAISE EXCEPTION 'book_inscripcion_extraordinaria: ya existe cita activa' USING ERRCODE = '22023';
  END IF;

  SELECT count(*)::INT INTO v_avail
  FROM public.agenda_sheet_slot_inventory i
  WHERE i.organization_id = v_org
    AND i.booking_date = p_booking_date
    AND i.kind = 'inscripcion'
    AND i.location_id = v_loc
    AND i.status = 'available'
    AND (i.sheet_slot_time = v_time OR (i.sheet_slot_time IS NULL AND i.slot_time = v_time));
  IF COALESCE(v_avail, 0) < 1 THEN
    RAISE EXCEPTION 'SIN_CUPO_REAL_EN_SHEET' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.agenda_bookings (
    organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, note, created_by
  ) VALUES (
    v_org, v_kind, p_expediente_id, p_booking_date, v_time,
    v_loc, 'booked', v_note, v_actor
  ) RETURNING id INTO v_booking_id;

  UPDATE public.agenda_inscripcion_requerimientos
  SET status = 'booked', booked_booking_id = v_booking_id, updated_at = NOW()
  WHERE id = v_req.id;

  PERFORM public.log_action(
    v_org, v_actor, v_role,
    'agenda.inscripcion.book', 'agenda_booking', v_booking_id,
    jsonb_build_object(
      'expediente_id', p_expediente_id, 'requirement_id', v_req.id,
      'booking_date', p_booking_date, 'booking_time', '11:00',
      'location_id', v_loc, 'etapa_actual', v_etapa, 'fecha_cita_unchanged', true
    )
  );

  RETURN jsonb_build_object(
    'ok', true, 'booking_id', v_booking_id, 'kind', 'inscripcion',
    'booking_date', p_booking_date, 'booking_time', '11:00',
    'location_id', v_loc, 'requirement_id', v_req.id,
    'etapa_actual', v_etapa, 'fecha_cita_unchanged', true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.book_inscripcion_extraordinaria(UUID, DATE, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.book_inscripcion_extraordinaria(UUID, DATE, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.book_inscripcion_extraordinaria(UUID, DATE, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.book_inscripcion_extraordinaria(UUID, DATE, TEXT, TEXT) TO service_role;

-- =============================================================================
-- 12) Cancel
-- =============================================================================
CREATE OR REPLACE FUNCTION public.cancel_inscripcion_extraordinaria(
  p_booking_id UUID,
  p_motivo TEXT DEFAULT NULL,
  p_resolve_requirement BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_role public.app_role;
  v_org UUID;
  v_book RECORD;
  v_exp RECORD;
  v_etapa INT;
  v_req_status TEXT;
BEGIN
  v_actor := public.current_profile_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'cancel_inscripcion_extraordinaria: no autenticado' USING ERRCODE = '42501';
  END IF;
  SELECT p.app_role, p.organization_id INTO v_role, v_org
  FROM public.profiles p WHERE p.id = v_actor AND p.active = true;

  SELECT b.* INTO v_book FROM public.agenda_bookings b WHERE b.id = p_booking_id FOR UPDATE;
  IF NOT FOUND OR v_book.kind IS DISTINCT FROM 'inscripcion'::public.booking_kind THEN
    RAISE EXCEPTION 'cancel_inscripcion_extraordinaria: booking inválido' USING ERRCODE = 'P0002';
  END IF;
  IF v_book.status IS DISTINCT FROM 'booked' THEN
    RAISE EXCEPTION 'cancel_inscripcion_extraordinaria: no booked' USING ERRCODE = '22023';
  END IF;

  SELECT e.* INTO v_exp FROM public.expedientes e WHERE e.id = v_book.expediente_id;
  v_etapa := v_exp.etapa_actual;

  IF v_role = 'asesor' THEN
    IF v_exp.asesor_id IS DISTINCT FROM v_actor OR v_book.organization_id IS DISTINCT FROM v_org THEN
      RAISE EXCEPTION 'cancel_inscripcion_extraordinaria: no autorizado' USING ERRCODE = '42501';
    END IF;
  ELSIF v_role IN ('mesa_admin','mesa_interno','mesa_externo','super_admin') THEN
    IF NOT public.can_see_expediente(v_book.expediente_id) THEN
      RAISE EXCEPTION 'cancel_inscripcion_extraordinaria: no visible' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'cancel_inscripcion_extraordinaria: rol no autorizado' USING ERRCODE = '42501';
  END IF;

  UPDATE public.agenda_bookings
  SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW(),
      note = COALESCE(NULLIF(left(btrim(COALESCE(p_motivo,'')), 500), ''), note)
  WHERE id = p_booking_id;

  IF COALESCE(p_resolve_requirement, false) THEN
    UPDATE public.agenda_inscripcion_requerimientos
    SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
    WHERE expediente_id = v_book.expediente_id
      AND status IN ('booked','pending_booking','rebook_required');
    v_req_status := 'cancelled';
  ELSE
    UPDATE public.agenda_inscripcion_requerimientos
    SET status = 'rebook_required', booked_booking_id = NULL, updated_at = NOW()
    WHERE expediente_id = v_book.expediente_id AND status = 'booked';
    v_req_status := 'rebook_required';
  END IF;

  PERFORM public.log_action(
    v_book.organization_id, v_actor, v_role,
    'agenda.inscripcion.cancel', 'agenda_booking', p_booking_id,
    jsonb_build_object('requirement_status', v_req_status, 'etapa_actual', v_etapa)
  );

  RETURN jsonb_build_object('ok', true, 'booking_id', p_booking_id,
    'requirement_status', v_req_status, 'etapa_actual', v_etapa);
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_inscripcion_extraordinaria(UUID, TEXT, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_inscripcion_extraordinaria(UUID, TEXT, BOOLEAN) FROM anon;
GRANT EXECUTE ON FUNCTION public.cancel_inscripcion_extraordinaria(UUID, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_inscripcion_extraordinaria(UUID, TEXT, BOOLEAN) TO service_role;

-- =============================================================================
-- 13) Reagenda (asesor dueño O Mesa visible): cancel + claim + book; hora 11:00
--     book_inscripcion_extraordinaria sigue SOLO asesor (alta inicial).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.reagendar_inscripcion_extraordinaria(
  p_expediente_id UUID,
  p_booking_date DATE,
  p_location_id TEXT,
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_role public.app_role;
  v_org UUID;
  v_exp RECORD;
  v_old RECORD;
  v_req RECORD;
  v_loc TEXT;
  v_note TEXT;
  v_booking_id UUID;
  v_kind public.booking_kind := 'inscripcion';
  v_time TIME := TIME '11:00';
  v_avail INT;
  v_etapa INT;
  v_cancel JSONB;
BEGIN
  v_actor := public.current_profile_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'reagendar_inscripcion_extraordinaria: no autenticado' USING ERRCODE = '42501';
  END IF;
  SELECT p.app_role, p.organization_id INTO v_role, v_org
  FROM public.profiles p WHERE p.id = v_actor AND p.active = true;

  v_loc := public.agenda_inscripcion_normalize_location(p_location_id);
  IF v_loc IS NULL THEN
    RAISE EXCEPTION 'reagendar_inscripcion_extraordinaria: sede inválida' USING ERRCODE = '22023';
  END IF;
  IF p_booking_date IS NULL OR p_booking_date < (timezone('America/Monterrey', now()))::date THEN
    RAISE EXCEPTION 'reagendar_inscripcion_extraordinaria: fecha inválida' USING ERRCODE = '22023';
  END IF;
  v_note := NULLIF(btrim(COALESCE(p_note, '')), '');

  SELECT e.* INTO v_exp FROM public.expedientes e WHERE e.id = p_expediente_id FOR UPDATE;
  IF NOT FOUND OR v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'reagendar_inscripcion_extraordinaria: expediente no disponible' USING ERRCODE = 'P0002';
  END IF;
  v_etapa := v_exp.etapa_actual;

  IF v_role = 'asesor' THEN
    IF v_exp.asesor_id IS DISTINCT FROM v_actor OR v_exp.organization_id IS DISTINCT FROM v_org THEN
      RAISE EXCEPTION 'reagendar_inscripcion_extraordinaria: no autorizado' USING ERRCODE = '42501';
    END IF;
  ELSIF v_role IN ('mesa_admin','mesa_interno','mesa_externo','super_admin') THEN
    IF NOT public.can_see_expediente(p_expediente_id) THEN
      RAISE EXCEPTION 'reagendar_inscripcion_extraordinaria: no visible' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'reagendar_inscripcion_extraordinaria: rol no autorizado' USING ERRCODE = '42501';
  END IF;

  IF v_exp.ciclo_estado IS DISTINCT FROM 'activo'
     OR v_exp.submitted_to_mesa IS NOT TRUE
     OR v_exp.subestado = 'rechazado'
     OR NOT public.agenda_inscripcion_etapa_permitida(v_exp.etapa_actual) THEN
    RAISE EXCEPTION 'reagendar_inscripcion_extraordinaria: expediente no elegible' USING ERRCODE = '22023';
  END IF;

  SELECT b.* INTO v_old FROM public.agenda_bookings b
  WHERE b.expediente_id = p_expediente_id
    AND b.kind = v_kind
    AND b.status = 'booked'
  FOR UPDATE LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reagendar_inscripcion_extraordinaria: sin cita activa' USING ERRCODE = '22023';
  END IF;

  v_cancel := public.cancel_inscripcion_extraordinaria(
    v_old.id, COALESCE(v_note, 'Reagenda inscripción'), false
  );

  SELECT r.* INTO v_req FROM public.agenda_inscripcion_requerimientos r
  WHERE r.expediente_id = p_expediente_id
    AND r.status IN ('pending_booking','rebook_required')
  FOR UPDATE LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reagendar_inscripcion_extraordinaria: sin requirement abierto' USING ERRCODE = '22023';
  END IF;

  SELECT count(*)::INT INTO v_avail
  FROM public.agenda_sheet_slot_inventory i
  WHERE i.organization_id = v_exp.organization_id
    AND i.booking_date = p_booking_date
    AND i.kind = 'inscripcion'
    AND i.location_id = v_loc
    AND i.status = 'available'
    AND (i.sheet_slot_time = v_time OR (i.sheet_slot_time IS NULL AND i.slot_time = v_time));
  IF COALESCE(v_avail, 0) < 1 THEN
    RAISE EXCEPTION 'SIN_CUPO_REAL_EN_SHEET' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.agenda_bookings (
    organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, note, created_by
  ) VALUES (
    v_exp.organization_id, v_kind, p_expediente_id, p_booking_date, v_time,
    v_loc, 'booked', v_note, v_actor
  ) RETURNING id INTO v_booking_id;

  UPDATE public.agenda_inscripcion_requerimientos
  SET status = 'booked', booked_booking_id = v_booking_id, updated_at = NOW()
  WHERE id = v_req.id;

  PERFORM public.log_action(
    v_exp.organization_id, v_actor, v_role,
    'agenda.inscripcion.reagendar', 'agenda_booking', v_booking_id,
    jsonb_build_object(
      'expediente_id', p_expediente_id,
      'booking_anterior_id', v_old.id,
      'booking_date', p_booking_date,
      'booking_time', '11:00',
      'location_id', v_loc,
      'etapa_actual', v_etapa,
      'fecha_cita_unchanged', true
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'cancel', v_cancel,
    'booking_id', v_booking_id,
    'booking_anterior_id', v_old.id,
    'booking_date', p_booking_date,
    'booking_time', '11:00',
    'location_id', v_loc,
    'etapa_actual', v_etapa,
    'fecha_cita_unchanged', true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reagendar_inscripcion_extraordinaria(UUID, DATE, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reagendar_inscripcion_extraordinaria(UUID, DATE, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.reagendar_inscripcion_extraordinaria(UUID, DATE, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reagendar_inscripcion_extraordinaria(UUID, DATE, TEXT, TEXT) TO service_role;


-- =============================================================================
-- 14) P170 apply: no reject on inscripcion_rebook_required
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
  p_fingerprint TEXT DEFAULT NULL,
  p_biometric_cell_red BOOLEAN DEFAULT false,
  p_notification_cell_red BOOLEAN DEFAULT false,
  p_signature_cell_red BOOLEAN DEFAULT false,
  p_operational_red_veto BOOLEAN DEFAULT false
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
  v_bio_red BOOLEAN := false;
  v_notif_red BOOLEAN := false;
  v_sig_red BOOLEAN := false;
  v_red_veto BOOLEAN := false;
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
  v_bio_red := COALESCE(p_biometric_cell_red, false);
  v_notif_red := COALESCE(p_notification_cell_red, false);
  v_sig_red := COALESCE(p_signature_cell_red, false);
  v_red_veto := COALESCE(p_operational_red_veto, false);

  v_fp := public.agenda_sheet_ops_fingerprint(
    p_spreadsheet_id, p_sheet_id, p_sheet_row,
    p_expediente_id, p_booking_id, v_kind,
    v_bio, p_biometric_result_raw,
    v_notif, p_notification_result_raw,
    v_sig, p_signature_result_raw,
    v_notes,
    v_bio_red, v_notif_red, v_sig_red, v_red_veto
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


  -- P172: booking bajo contingencia activa → nunca mutar expediente (prioridad sobre COMPLETED/FAILED/X/SI/CESI)
  IF public.agenda_booking_has_contingency(p_booking_id) THEN
    -- Observación Sheet permanece (upsert projection) pero apply_outcome = SKIPPED_CONTINGENCY
    INSERT INTO public.agenda_sheet_operational_results AS t (
      organization_id, spreadsheet_id, sheet_id, sheet_title, booking_date, sheet_row,
      kind, location_id, booking_id, expediente_id,
      biometric_result_class, biometric_result_raw,
      notification_result_class, notification_result_raw,
      signature_result_class, signature_result_raw,
      notes_raw,
      biometric_cell_red, notification_cell_red, signature_cell_red, operational_red_veto,
      last_seen_at
    ) VALUES (
      p_organization_id, btrim(p_spreadsheet_id), p_sheet_id, '(apply)', p_booking_date, p_sheet_row,
      v_kind, lower(btrim(p_location_id)), p_booking_id, p_expediente_id,
      v_bio, NULLIF(btrim(COALESCE(p_biometric_result_raw, '')), ''),
      v_notif, NULLIF(btrim(COALESCE(p_notification_result_raw, '')), ''),
      v_sig, NULLIF(btrim(COALESCE(p_signature_result_raw, '')), ''),
      v_notes,
      v_bio_red, v_notif_red, v_sig_red, v_red_veto,
      NOW()
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
      biometric_cell_red = EXCLUDED.biometric_cell_red,
      notification_cell_red = EXCLUDED.notification_cell_red,
      signature_cell_red = EXCLUDED.signature_cell_red,
      operational_red_veto = EXCLUDED.operational_red_veto,
      last_seen_at = NOW(),
      updated_at = NOW();

    UPDATE public.agenda_sheet_operational_results
    SET last_applied_fingerprint = v_fp,
        last_applied_at = NOW(),
        apply_outcome = 'SKIPPED_CONTINGENCY',
        updated_at = NOW()
    WHERE spreadsheet_id = btrim(p_spreadsheet_id)
      AND sheet_id = p_sheet_id
      AND sheet_row = p_sheet_row;

    RETURN jsonb_build_object(
      'ok', true,
      'outcome', 'SKIPPED_CONTINGENCY',
      'fingerprint', v_fp,
      'expediente_id', p_expediente_id,
      'booking_id', p_booking_id,
      'kind', v_kind,
      'mutated', false,
      'reason', 'booking_under_contingency'
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
    biometric_cell_red = EXCLUDED.biometric_cell_red,
    notification_cell_red = EXCLUDED.notification_cell_red,
    signature_cell_red = EXCLUDED.signature_cell_red,
    operational_red_veto = EXCLUDED.operational_red_veto,
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

      -- P173: COLOR_VETO bloquea positivos; textual FAILED notif sigue flujo P170/P172
      IF v_red_veto AND v_notif IS DISTINCT FROM 'FAILED_OR_NOT_ATTENDED' THEN
        UPDATE public.agenda_sheet_operational_results
        SET last_applied_fingerprint = v_fp,
            last_applied_at = NOW(),
            apply_outcome = 'COLOR_VETO',
            updated_at = NOW()
        WHERE id = v_ops.id;
        RETURN jsonb_build_object(
          'ok', true,
          'outcome', 'COLOR_VETO',
          'fingerprint', v_fp,
          'expediente_id', p_expediente_id,
          'booking_id', p_booking_id,
          'kind', v_kind,
          'mutated', false,
          'reason', 'operational_red_veto',
          'biometric_cell_red', v_bio_red,
          'notification_cell_red', v_notif_red,
          'signature_cell_red', v_sig_red,
          'operational_red_veto', v_red_veto,
          'etapa_actual', v_exp.etapa_actual,
          'subestado', v_exp.subestado
        );
      END IF;

      IF v_exp.submitted_to_mesa IS NOT TRUE THEN
        v_outcome := 'SKIPPED_GATE';
      ELSE
        -- A/B/C: asegurar hasta 5 si corresponde (orden P170/P172)
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
        -- P175: REAGENDA INSCRIPCION (ops.inscripcion_rebook_required) NO rechaza.
        IF v_notif = 'FAILED_OR_NOT_ATTENDED' AND NOT v_reject_done THEN
          IF COALESCE(v_ops.inscripcion_rebook_required, false) THEN
            UPDATE public.agenda_sheet_operational_results
            SET last_applied_fingerprint = v_fp,
                last_applied_at = NOW(),
                apply_outcome = 'REQUIRES_INSCRIPCION_REBOOK',
                updated_at = NOW()
            WHERE id = v_ops.id;
            RETURN jsonb_build_object(
              'ok', true,
              'outcome', 'REQUIRES_INSCRIPCION_REBOOK',
              'fingerprint', v_fp,
              'expediente_id', p_expediente_id,
              'booking_id', p_booking_id,
              'kind', v_kind,
              'mutated', false,
              'reason', 'inscripcion_rebook_required',
              'etapa_actual', v_exp.etapa_actual,
              'subestado', v_exp.subestado
            );
          END IF;
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
      -- PENDING/UNKNOWN bio: COLOR_VETO si hay rojo operativo; si no, NO_APPLY
      IF v_red_veto THEN
        UPDATE public.agenda_sheet_operational_results
        SET last_applied_fingerprint = v_fp,
            last_applied_at = NOW(),
            apply_outcome = 'COLOR_VETO',
            updated_at = NOW()
        WHERE id = v_ops.id;
        RETURN jsonb_build_object(
          'ok', true,
          'outcome', 'COLOR_VETO',
          'fingerprint', v_fp,
          'expediente_id', p_expediente_id,
          'booking_id', p_booking_id,
          'kind', v_kind,
          'mutated', false,
          'reason', 'operational_red_veto',
          'biometric_cell_red', v_bio_red,
          'notification_cell_red', v_notif_red,
          'signature_cell_red', v_sig_red,
          'operational_red_veto', v_red_veto,
          'etapa_actual', v_exp.etapa_actual,
          'subestado', v_exp.subestado
        );

      ELSE
        v_outcome := 'NO_APPLY';
      END IF;
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

      IF v_red_veto THEN
        UPDATE public.agenda_sheet_operational_results
        SET last_applied_fingerprint = v_fp,
            last_applied_at = NOW(),
            apply_outcome = 'COLOR_VETO',
            updated_at = NOW()
        WHERE id = v_ops.id;
        RETURN jsonb_build_object(
          'ok', true,
          'outcome', 'COLOR_VETO',
          'fingerprint', v_fp,
          'expediente_id', p_expediente_id,
          'booking_id', p_booking_id,
          'kind', v_kind,
          'mutated', false,
          'reason', 'operational_red_veto',
          'biometric_cell_red', v_bio_red,
          'notification_cell_red', v_notif_red,
          'signature_cell_red', v_sig_red,
          'operational_red_veto', v_red_veto,
          'etapa_actual', v_exp.etapa_actual,
          'subestado', v_exp.subestado
        );

      ELSIF v_exp.submitted_to_mesa IS NOT TRUE THEN
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
      IF v_red_veto THEN
        UPDATE public.agenda_sheet_operational_results
        SET last_applied_fingerprint = v_fp,
            last_applied_at = NOW(),
            apply_outcome = 'COLOR_VETO',
            updated_at = NOW()
        WHERE id = v_ops.id;
        RETURN jsonb_build_object(
          'ok', true,
          'outcome', 'COLOR_VETO',
          'fingerprint', v_fp,
          'expediente_id', p_expediente_id,
          'booking_id', p_booking_id,
          'kind', v_kind,
          'mutated', false,
          'reason', 'operational_red_veto',
          'biometric_cell_red', v_bio_red,
          'notification_cell_red', v_notif_red,
          'signature_cell_red', v_sig_red,
          'operational_red_veto', v_red_veto,
          'etapa_actual', v_exp.etapa_actual,
          'subestado', v_exp.subestado
        );

      ELSE
        v_outcome := 'NO_APPLY';
      END IF;
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

-- Una sola firma (21 args con defaults en color). Callers P170/P172 de 17 args
-- resuelven aquí sin ambigüedad mientras no exista overload paralelo de 17 args.
-- Mig 172 DROPea el overload 17-args; verify-p172 re-aplica 172 tras 171.

REVOKE ALL ON FUNCTION public.agenda_sheet_apply_operational_result(
  UUID, TEXT, BIGINT, INTEGER, DATE, TEXT, TEXT, UUID, UUID,
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_sheet_apply_operational_result(
  UUID, TEXT, BIGINT, INTEGER, DATE, TEXT, TEXT, UUID, UUID,
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  BOOLEAN, BOOLEAN, BOOLEAN, BOOLEAN
) TO service_role, postgres;




-- P175: persist inscripcion_rebook_* on ops upsert
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
      biometric_cell_red,
      notification_cell_red,
      signature_cell_red,
      operational_red_veto,
      inscripcion_rebook_required,
      inscripcion_rebook_reason_raw,
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
      last_seen_at = EXCLUDED.last_seen_at,
      updated_at = NOW();
      -- last_applied_* / apply_outcome NO se tocan (solo apply RPC)

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('upserted', v_count);
END;
$$;

