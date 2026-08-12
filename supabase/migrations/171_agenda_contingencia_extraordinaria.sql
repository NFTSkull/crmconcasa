-- ConCasa CRM — P172 B1: Contingencia extraordinaria de citas (mig. 171)
-- Cloud libre REAL tras 170 → 171. Producto P172; no edita mig 170 aplicada.
--
-- REGLA INVIOLABLE: declarar contingencia NO cancela/reagenda bookings normales,
-- NO toca inventory/slot_links/outbox/Sheets/etapa/subestado.
-- Citas extraordinarias viven en agenda_extraordinary_bookings (sin cupo).

-- =============================================================================
-- 1) Cabecera
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.agenda_contingencias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  affected_date DATE NOT NULL,
  kind TEXT NOT NULL,
  location_id TEXT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT agenda_contingencias_kind_check
    CHECK (kind IN ('biometricos', 'firmas')),
  CONSTRAINT agenda_contingencias_status_check
    CHECK (status IN ('active', 'closed')),
  CONSTRAINT agenda_contingencias_reason_nonempty
    CHECK (char_length(btrim(reason)) BETWEEN 1 AND 500),
  CONSTRAINT agenda_contingencias_location_check
    CHECK (
      location_id IS NULL
      OR lower(btrim(location_id)) IN ('monterrey', 'apodaca')
    )
);

COMMENT ON TABLE public.agenda_contingencias IS
  'P172: declaración Mesa de contingencia por fecha+kind (+sede opcional). No muta agenda_bookings.';

-- Unicidad lógica ACTIVE (NULL location = scope org-wide). NULLS NOT DISTINCT (PG15+).
CREATE UNIQUE INDEX IF NOT EXISTS agenda_contingencias_active_uniq
  ON public.agenda_contingencias (organization_id, affected_date, kind, location_id)
  NULLS NOT DISTINCT
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS agenda_contingencias_org_date_idx
  ON public.agenda_contingencias (organization_id, affected_date DESC);

-- =============================================================================
-- 2) Snapshot citas afectadas
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.agenda_contingencia_citas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contingency_id UUID NOT NULL REFERENCES public.agenda_contingencias(id) ON DELETE CASCADE,
  original_booking_id UUID NOT NULL REFERENCES public.agenda_bookings(id),
  expediente_id UUID NOT NULL REFERENCES public.expedientes(id),
  advisor_id UUID NOT NULL REFERENCES public.profiles(id),
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  status TEXT NOT NULL DEFAULT 'pending_rebook',
  extraordinary_booking_id UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT agenda_contingencia_citas_status_check
    CHECK (status IN ('pending_rebook', 'rebooked', 'closed')),
  CONSTRAINT agenda_contingencia_citas_booking_uniq
    UNIQUE (contingency_id, original_booking_id)
);

COMMENT ON TABLE public.agenda_contingencia_citas IS
  'P172: snapshot al declarar contingencia. pending_rebook = tarea persistente asesor.';

CREATE INDEX IF NOT EXISTS agenda_contingencia_citas_advisor_pending_idx
  ON public.agenda_contingencia_citas (advisor_id, status)
  WHERE status = 'pending_rebook';

CREATE INDEX IF NOT EXISTS agenda_contingencia_citas_exp_idx
  ON public.agenda_contingencia_citas (expediente_id);

CREATE INDEX IF NOT EXISTS agenda_contingencia_citas_original_booking_idx
  ON public.agenda_contingencia_citas (original_booking_id);

-- =============================================================================
-- 3) Citas extraordinarias (tabla separada — SIN cupo / inventory / outbox)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.agenda_extraordinary_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contingency_item_id UUID NOT NULL REFERENCES public.agenda_contingencia_citas(id),
  original_booking_id UUID NOT NULL REFERENCES public.agenda_bookings(id),
  expediente_id UUID NOT NULL REFERENCES public.expedientes(id),
  advisor_id UUID NOT NULL REFERENCES public.profiles(id),
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  kind TEXT NOT NULL,
  booking_date DATE NOT NULL,
  booking_time TIME NOT NULL,
  location_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'booked',
  created_by UUID NOT NULL REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT agenda_extraordinary_bookings_kind_check
    CHECK (kind IN ('biometricos', 'firmas')),
  CONSTRAINT agenda_extraordinary_bookings_status_check
    CHECK (status IN ('booked', 'cancelled')),
  CONSTRAINT agenda_extraordinary_bookings_location_check
    CHECK (lower(btrim(location_id)) IN ('monterrey', 'apodaca'))
);

COMMENT ON TABLE public.agenda_extraordinary_bookings IS
  'P172: cita extraordinaria post-contingencia. NO participa en inventory/capacity/outbox/Sheets.';

-- Una extraordinaria activa por item
CREATE UNIQUE INDEX IF NOT EXISTS agenda_extraordinary_active_per_item_uniq
  ON public.agenda_extraordinary_bookings (contingency_item_id)
  WHERE status = 'booked';

CREATE INDEX IF NOT EXISTS agenda_extraordinary_bookings_exp_idx
  ON public.agenda_extraordinary_bookings (expediente_id, booking_date);

-- FK diferida item → extraordinary (nullable hasta rebook)
ALTER TABLE public.agenda_contingencia_citas
  DROP CONSTRAINT IF EXISTS agenda_contingencia_citas_extraordinary_fk;
ALTER TABLE public.agenda_contingencia_citas
  ADD CONSTRAINT agenda_contingencia_citas_extraordinary_fk
  FOREIGN KEY (extraordinary_booking_id)
  REFERENCES public.agenda_extraordinary_bookings(id);

-- =============================================================================
-- 4) Helpers
-- =============================================================================
CREATE OR REPLACE FUNCTION public.agenda_contingency_normalize_location_id(
  p_location_id TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v TEXT;
BEGIN
  v := lower(btrim(COALESCE(p_location_id, '')));
  IF v = '' THEN
    RETURN NULL;
  END IF;
  IF v NOT IN ('monterrey', 'apodaca') THEN
    RAISE EXCEPTION 'CONTINGENCY_LOCATION_INVALID: use monterrey|apodaca o null'
      USING ERRCODE = '22023';
  END IF;
  RETURN v;
END;
$$;

-- Criterio canónico P172 B1.1: original bajo contingencia ACTIVE|CLOSED
-- (closed ≠ voided; closed = terminada admin / reagendas hechas; histórico permanece).
CREATE OR REPLACE FUNCTION public.agenda_booking_has_contingency(
  p_booking_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
VOLATILE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.agenda_contingencia_citas c
    JOIN public.agenda_contingencias h ON h.id = c.contingency_id
    WHERE c.original_booking_id = p_booking_id
      AND h.status IN ('active', 'closed')
  );
$$;

COMMENT ON FUNCTION public.agenda_booking_has_contingency(UUID) IS
  'P172 B1.1: booking original en snapshot de contingencia active|closed. Permanente (no undo).';

-- Alias legado → mismo criterio permanente (P170 / reporting).
CREATE OR REPLACE FUNCTION public.agenda_booking_under_contingency(
  p_booking_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT public.agenda_booking_has_contingency(p_booking_id);
$$;

COMMENT ON FUNCTION public.agenda_booking_under_contingency(UUID) IS
  'P172 B1.1: alias de agenda_booking_has_contingency (active|closed).';

CREATE OR REPLACE FUNCTION public.agenda_assert_booking_not_under_contingency(
  p_booking_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$
BEGIN
  IF p_booking_id IS NOT NULL AND public.agenda_booking_has_contingency(p_booking_id) THEN
    RAISE EXCEPTION 'BOOKING_UNDER_CONTINGENCY: el booking original (%) no admite cancel/reagenda/Drive normal; use cita extraordinaria',
      p_booking_id
      USING ERRCODE = 'P0001';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.agenda_assert_booking_not_under_contingency(UUID) IS
  'P172 B1.1: raise BOOKING_UNDER_CONTINGENCY si el booking es original de contingencia.';

-- Tarea persistente Cloud: pendiente mientras item pending_rebook + cabecera active
CREATE OR REPLACE FUNCTION public.asesor_inbox_pendiente_cita_extraordinaria(
  p_expediente_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.agenda_contingencia_citas c
    JOIN public.agenda_contingencias h ON h.id = c.contingency_id
    WHERE c.expediente_id = p_expediente_id
      AND c.status = 'pending_rebook'
      AND h.status = 'active'
  );
$$;

COMMENT ON FUNCTION public.asesor_inbox_pendiente_cita_extraordinaria(UUID) IS
  'P172: tarea persistente extraordinary_rebook_required (no desaparece al abrir campana).';

-- Reporting Bernardo: distinguir CONTINGENCY sin reinterpretar filas Sheet
CREATE OR REPLACE FUNCTION public.agenda_ops_row_contingency_flag(
  p_booking_id UUID
)
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_booking_id IS NULL THEN NULL
    WHEN public.agenda_booking_has_contingency(p_booking_id)
      THEN 'CONTINGENCY'
    ELSE NULL
  END;
$$;

COMMENT ON FUNCTION public.agenda_ops_row_contingency_flag(UUID) IS
  'P172/P165: flag reporting CONTINGENCY | null. No muta agenda_sheet_operational_results.';

-- =============================================================================
-- 5) RLS
-- =============================================================================
ALTER TABLE public.agenda_contingencias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agenda_contingencia_citas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agenda_extraordinary_bookings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.agenda_contingencias FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.agenda_contingencia_citas FROM PUBLIC, anon;
REVOKE ALL ON TABLE public.agenda_extraordinary_bookings FROM PUBLIC, anon;

GRANT SELECT ON TABLE public.agenda_contingencias TO authenticated;
GRANT SELECT ON TABLE public.agenda_contingencia_citas TO authenticated;
GRANT SELECT ON TABLE public.agenda_extraordinary_bookings TO authenticated;
GRANT ALL ON TABLE public.agenda_contingencias TO service_role;
GRANT ALL ON TABLE public.agenda_contingencia_citas TO service_role;
GRANT ALL ON TABLE public.agenda_extraordinary_bookings TO service_role;

DROP POLICY IF EXISTS agenda_contingencias_select ON public.agenda_contingencias;
CREATE POLICY agenda_contingencias_select
  ON public.agenda_contingencias
  FOR SELECT
  TO authenticated
  USING (
    public.current_app_role() = 'super_admin'
    OR (
      organization_id = public.current_organization_id()
      AND public.current_app_role() IN (
        'mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin'
      )
    )
    OR EXISTS (
      SELECT 1
      FROM public.agenda_contingencia_citas c
      WHERE c.contingency_id = agenda_contingencias.id
        AND c.advisor_id = public.current_profile_id()
    )
  );

DROP POLICY IF EXISTS agenda_contingencia_citas_select ON public.agenda_contingencia_citas;
CREATE POLICY agenda_contingencia_citas_select
  ON public.agenda_contingencia_citas
  FOR SELECT
  TO authenticated
  USING (
    public.current_app_role() = 'super_admin'
    OR (
      organization_id = public.current_organization_id()
      AND public.current_app_role() IN (
        'mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin'
      )
    )
    OR advisor_id = public.current_profile_id()
  );

DROP POLICY IF EXISTS agenda_extraordinary_bookings_select ON public.agenda_extraordinary_bookings;
CREATE POLICY agenda_extraordinary_bookings_select
  ON public.agenda_extraordinary_bookings
  FOR SELECT
  TO authenticated
  USING (
    public.current_app_role() = 'super_admin'
    OR (
      organization_id = public.current_organization_id()
      AND public.current_app_role() IN (
        'mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin'
      )
    )
    OR advisor_id = public.current_profile_id()
  );

-- =============================================================================
-- 6) RPC declarar contingencia (Mesa / SuperAdmin)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.agenda_declarar_contingencia(
  p_affected_date DATE,
  p_kind TEXT,
  p_location_id TEXT DEFAULT NULL,
  p_reason TEXT DEFAULT NULL
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
  v_kind TEXT;
  v_loc TEXT;
  v_reason TEXT;
  v_cont UUID;
  v_reused BOOLEAN := false;
  v_lock_key BIGINT;
  v_book RECORD;
  v_inserted INT := 0;
  v_affected INT := 0;
  v_advisors INT := 0;
  v_outbox_before BIGINT;
  v_outbox_after BIGINT;
BEGIN
  v_actor := public.current_profile_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'CONTINGENCY_UNAUTHORIZED: no autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id INTO v_role, v_org
  FROM public.profiles p
  WHERE p.id = v_actor AND p.active = true;

  IF NOT FOUND OR v_role NOT IN (
    'mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin'
  ) THEN
    RAISE EXCEPTION 'CONTINGENCY_UNAUTHORIZED: solo Mesa/SuperAdmin'
      USING ERRCODE = '42501';
  END IF;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'CONTINGENCY_ORG_REQUIRED' USING ERRCODE = '22023';
  END IF;

  IF p_affected_date IS NULL THEN
    RAISE EXCEPTION 'CONTINGENCY_DATE_REQUIRED' USING ERRCODE = '22023';
  END IF;

  v_kind := lower(btrim(COALESCE(p_kind, '')));
  IF v_kind NOT IN ('biometricos', 'firmas') THEN
    RAISE EXCEPTION 'CONTINGENCY_KIND_INVALID: biometricos|firmas'
      USING ERRCODE = '22023';
  END IF;

  v_loc := public.agenda_contingency_normalize_location_id(p_location_id);
  v_reason := btrim(COALESCE(p_reason, ''));
  IF char_length(v_reason) < 1 OR char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'CONTINGENCY_REASON_INVALID: 1..500 chars'
      USING ERRCODE = '22023';
  END IF;

  -- Lock idempotencia (org+date+kind+loc) — evita doble click / carrera
  v_lock_key := hashtextextended(
    v_org::text || '|' || p_affected_date::text || '|' || v_kind || '|' || coalesce(v_loc, '*'),
    17201
  );
  PERFORM pg_advisory_xact_lock(v_lock_key);

  SELECT c.id INTO v_cont
  FROM public.agenda_contingencias c
  WHERE c.organization_id = v_org
    AND c.affected_date = p_affected_date
    AND c.kind = v_kind
    AND c.location_id IS NOT DISTINCT FROM v_loc
    AND c.status = 'active'
  FOR UPDATE;

  IF FOUND THEN
    v_reused := true;
  ELSE
    -- Snapshot bajo lock de filas booked (estado consistente)
    -- Primero contar afectados; rechazar vacío accidental
    SELECT count(*)::int INTO v_affected
    FROM public.agenda_bookings b
    WHERE b.organization_id = v_org
      AND b.booking_date = p_affected_date
      AND b.kind::text = v_kind
      AND b.status = 'booked'
      AND (v_loc IS NULL OR lower(btrim(b.location_id)) = v_loc);

    IF v_affected = 0 THEN
      RAISE EXCEPTION 'CONTINGENCY_NO_AFFECTED_BOOKINGS: no crear contingencia vacía'
        USING ERRCODE = 'P0001';
    END IF;

    SELECT count(*) INTO v_outbox_before
    FROM public.agenda_sheet_sync_outbox;

    INSERT INTO public.agenda_contingencias (
      organization_id, affected_date, kind, location_id, reason, status, created_by
    ) VALUES (
      v_org, p_affected_date, v_kind, v_loc, v_reason, 'active', v_actor
    )
    RETURNING id INTO v_cont;

    FOR v_book IN
      SELECT b.id AS booking_id, b.expediente_id, e.asesor_id
      FROM public.agenda_bookings b
      JOIN public.expedientes e ON e.id = b.expediente_id
      WHERE b.organization_id = v_org
        AND b.booking_date = p_affected_date
        AND b.kind::text = v_kind
        AND b.status = 'booked'
        AND (v_loc IS NULL OR lower(btrim(b.location_id)) = v_loc)
      FOR UPDATE OF b
    LOOP
      -- Recheck post-lock: no capturar cancelled concurrente
      IF NOT EXISTS (
        SELECT 1 FROM public.agenda_bookings b2
        WHERE b2.id = v_book.booking_id AND b2.status = 'booked'
      ) THEN
        CONTINUE;
      END IF;

      INSERT INTO public.agenda_contingencia_citas (
        contingency_id, original_booking_id, expediente_id,
        advisor_id, organization_id, status
      ) VALUES (
        v_cont, v_book.booking_id, v_book.expediente_id,
        v_book.asesor_id, v_org, 'pending_rebook'
      )
      ON CONFLICT (contingency_id, original_booking_id) DO NOTHING;

      IF FOUND THEN
        v_inserted := v_inserted + 1;
      END IF;
    END LOOP;

    -- Si tras locks concurrentes no quedó ningún item → rollback cabecera vacía
    SELECT count(*)::int INTO v_affected
    FROM public.agenda_contingencia_citas
    WHERE contingency_id = v_cont;

    IF v_affected = 0 THEN
      DELETE FROM public.agenda_contingencias WHERE id = v_cont;
      RAISE EXCEPTION 'CONTINGENCY_NO_AFFECTED_BOOKINGS: bookings ya no booked'
        USING ERRCODE = 'P0001';
    END IF;

    SELECT count(*) INTO v_outbox_after FROM public.agenda_sheet_sync_outbox;
    IF v_outbox_after <> v_outbox_before THEN
      RAISE EXCEPTION 'CONTINGENCY_OUTBOX_LEAK: declarar no debe escribir outbox'
        USING ERRCODE = 'P0001';
    END IF;

    PERFORM public.log_action(
      v_org, v_actor, v_role,
      'AGENDA_CONTINGENCY_DECLARED',
      'agenda_contingencia', v_cont,
      jsonb_build_object(
        'contingency_id', v_cont,
        'affected_date', p_affected_date,
        'kind', v_kind,
        'location_id', v_loc,
        'affected_count', v_affected
      )
    );
  END IF;

  SELECT count(*)::int,
         count(DISTINCT advisor_id)::int
    INTO v_affected, v_advisors
  FROM public.agenda_contingencia_citas
  WHERE contingency_id = v_cont;

  RETURN jsonb_build_object(
    'ok', true,
    'contingency_id', v_cont,
    'affected_count', v_affected,
    'advisor_count', v_advisors,
    'kind', v_kind,
    'date', p_affected_date,
    'location_id', v_loc,
    'reused', v_reused
  );
END;
$$;

COMMENT ON FUNCTION public.agenda_declarar_contingencia(DATE, TEXT, TEXT, TEXT) IS
  'P172: Mesa declara contingencia + snapshot booked. Idempotente ACTIVE. 0 outbox/Sheets.';

REVOKE ALL ON FUNCTION public.agenda_declarar_contingencia(DATE, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agenda_declarar_contingencia(DATE, TEXT, TEXT, TEXT)
  TO authenticated, service_role;

-- =============================================================================
-- 7) RPC agendar cita extraordinaria (asesor dueño)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.asesor_agendar_cita_extraordinaria(
  p_contingency_item_id UUID,
  p_booking_date DATE,
  p_booking_time TIME,
  p_location_id TEXT
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
  v_item public.agenda_contingencia_citas%ROWTYPE;
  v_cont public.agenda_contingencias%ROWTYPE;
  v_book public.agenda_bookings%ROWTYPE;
  v_loc TEXT;
  v_ext UUID;
  v_etapa SMALLINT;
  v_sub public.operativo_subestado;
  v_outbox_before BIGINT;
  v_outbox_after BIGINT;
  v_inv_before BIGINT;
  v_inv_after BIGINT;
BEGIN
  v_actor := public.current_profile_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'EXTRAORDINARY_UNAUTHORIZED: no autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id INTO v_role, v_org
  FROM public.profiles p
  WHERE p.id = v_actor AND p.active = true;

  IF NOT FOUND OR v_role <> 'asesor' THEN
    RAISE EXCEPTION 'EXTRAORDINARY_UNAUTHORIZED: solo asesor'
      USING ERRCODE = '42501';
  END IF;

  IF p_contingency_item_id IS NULL
     OR p_booking_date IS NULL
     OR p_booking_time IS NULL THEN
    RAISE EXCEPTION 'EXTRAORDINARY_INPUT_INVALID' USING ERRCODE = '22023';
  END IF;

  v_loc := public.agenda_contingency_normalize_location_id(p_location_id);
  IF v_loc IS NULL THEN
    RAISE EXCEPTION 'EXTRAORDINARY_LOCATION_REQUIRED' USING ERRCODE = '22023';
  END IF;

  -- Lock item
  SELECT * INTO v_item
  FROM public.agenda_contingencia_citas
  WHERE id = p_contingency_item_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'EXTRAORDINARY_ITEM_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  IF v_item.advisor_id IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'EXTRAORDINARY_FORBIDDEN: no es dueño del item'
      USING ERRCODE = '42501';
  END IF;

  IF v_item.organization_id IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'EXTRAORDINARY_ORG_MISMATCH' USING ERRCODE = '42501';
  END IF;

  IF v_item.status <> 'pending_rebook' THEN
    RAISE EXCEPTION 'EXTRAORDINARY_ITEM_NOT_PENDING: %', v_item.status
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_cont
  FROM public.agenda_contingencias
  WHERE id = v_item.contingency_id
  FOR UPDATE;

  IF NOT FOUND OR v_cont.status <> 'active' THEN
    RAISE EXCEPTION 'EXTRAORDINARY_CONTINGENCY_INACTIVE'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_book
  FROM public.agenda_bookings
  WHERE id = v_item.original_booking_id;

  IF NOT FOUND
     OR v_book.expediente_id IS DISTINCT FROM v_item.expediente_id
     OR v_book.organization_id IS DISTINCT FROM v_item.organization_id
     OR v_book.kind::text IS DISTINCT FROM v_cont.kind THEN
    RAISE EXCEPTION 'EXTRAORDINARY_ORIGINAL_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  SELECT e.etapa_actual, e.subestado INTO v_etapa, v_sub
  FROM public.expedientes e
  WHERE e.id = v_item.expediente_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'EXTRAORDINARY_EXPEDIENTE_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  SELECT count(*) INTO v_outbox_before FROM public.agenda_sheet_sync_outbox;
  SELECT count(*) INTO v_inv_before FROM public.agenda_sheet_slot_inventory
  WHERE organization_id = v_org;

  INSERT INTO public.agenda_extraordinary_bookings (
    contingency_item_id, original_booking_id, expediente_id, advisor_id,
    organization_id, kind, booking_date, booking_time, location_id,
    status, created_by
  ) VALUES (
    v_item.id, v_item.original_booking_id, v_item.expediente_id, v_item.advisor_id,
    v_item.organization_id, v_cont.kind, p_booking_date, p_booking_time, v_loc,
    'booked', v_actor
  )
  RETURNING id INTO v_ext;

  UPDATE public.agenda_contingencia_citas
  SET status = 'rebooked',
      extraordinary_booking_id = v_ext,
      updated_at = NOW()
  WHERE id = v_item.id;

  -- Etapa/subestado intactos
  IF EXISTS (
    SELECT 1 FROM public.expedientes e
    WHERE e.id = v_item.expediente_id
      AND (e.etapa_actual IS DISTINCT FROM v_etapa OR e.subestado IS DISTINCT FROM v_sub)
  ) THEN
    RAISE EXCEPTION 'EXTRAORDINARY_ETAPA_MUTATION_FORBIDDEN'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*) INTO v_outbox_after FROM public.agenda_sheet_sync_outbox;
  SELECT count(*) INTO v_inv_after FROM public.agenda_sheet_slot_inventory
  WHERE organization_id = v_org;

  IF v_outbox_after <> v_outbox_before THEN
    RAISE EXCEPTION 'EXTRAORDINARY_OUTBOX_LEAK' USING ERRCODE = 'P0001';
  END IF;
  IF v_inv_after <> v_inv_before THEN
    RAISE EXCEPTION 'EXTRAORDINARY_INVENTORY_LEAK' USING ERRCODE = 'P0001';
  END IF;

  PERFORM public.log_action(
    v_org, v_actor, v_role,
    'AGENDA_EXTRAORDINARY_REBOOKED',
    'agenda_extraordinary_booking', v_ext,
    jsonb_build_object(
      'contingency_id', v_cont.id,
      'contingency_item_id', v_item.id,
      'original_booking_id', v_item.original_booking_id,
      'extraordinary_booking_id', v_ext,
      'kind', v_cont.kind,
      'booking_date', p_booking_date,
      'booking_time', p_booking_time,
      'location_id', v_loc
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'extraordinary_booking_id', v_ext,
    'contingency_item_id', v_item.id,
    'contingency_id', v_cont.id,
    'original_booking_id', v_item.original_booking_id,
    'status', 'rebooked',
    'etapa_actual', v_etapa,
    'subestado', v_sub
  );
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'EXTRAORDINARY_DUPLICATE: ya existe cita extraordinaria activa'
      USING ERRCODE = '23505';
END;
$$;

COMMENT ON FUNCTION public.asesor_agendar_cita_extraordinaria(UUID, DATE, TIME, TEXT) IS
  'P172: asesor dueño crea extraordinary booking (sin cupo). No cambia etapa. 0 outbox.';

REVOKE ALL ON FUNCTION public.asesor_agendar_cita_extraordinaria(UUID, DATE, TIME, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asesor_agendar_cita_extraordinaria(UUID, DATE, TIME, TEXT)
  TO authenticated, service_role;

-- =============================================================================
-- 8) Lectura pendientes (tarea persistente Cloud)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.asesor_list_contingencia_pendientes()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_role public.app_role;
  v_items JSONB;
BEGIN
  v_actor := public.current_profile_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'CONTINGENCY_LIST_UNAUTHORIZED' USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role INTO v_role
  FROM public.profiles p WHERE p.id = v_actor AND p.active = true;

  IF NOT FOUND OR v_role <> 'asesor' THEN
    RAISE EXCEPTION 'CONTINGENCY_LIST_UNAUTHORIZED: solo asesor' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.affected_date, x.kind), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT
      c.id AS contingency_item_id,
      c.contingency_id,
      c.expediente_id,
      c.original_booking_id,
      c.status AS item_status,
      h.affected_date,
      h.kind,
      h.location_id AS contingency_location_id,
      h.reason,
      'extraordinary_rebook_required'::text AS task_kind
    FROM public.agenda_contingencia_citas c
    JOIN public.agenda_contingencias h ON h.id = c.contingency_id
    WHERE c.advisor_id = v_actor
      AND c.status = 'pending_rebook'
      AND h.status = 'active'
  ) x;

  RETURN jsonb_build_object('ok', true, 'items', v_items);
END;
$$;

COMMENT ON FUNCTION public.asesor_list_contingencia_pendientes() IS
  'P172: lista tareas persistentes extraordinary_rebook_required del asesor.';

REVOKE ALL ON FUNCTION public.asesor_list_contingencia_pendientes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asesor_list_contingencia_pendientes()
  TO authenticated, service_role;

-- Mesa: listar contingencias de la org
CREATE OR REPLACE FUNCTION public.mesa_list_agenda_contingencias(
  p_from DATE DEFAULT NULL,
  p_to DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_role public.app_role;
  v_org UUID;
  v_rows JSONB;
BEGIN
  v_actor := public.current_profile_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'CONTINGENCY_LIST_UNAUTHORIZED' USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id INTO v_role, v_org
  FROM public.profiles p WHERE p.id = v_actor AND p.active = true;

  IF NOT FOUND OR v_role NOT IN (
    'mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin'
  ) THEN
    RAISE EXCEPTION 'CONTINGENCY_LIST_UNAUTHORIZED' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.affected_date DESC, x.kind), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      h.id AS contingency_id,
      h.affected_date,
      h.kind,
      h.location_id,
      h.reason,
      h.status,
      h.created_at,
      (SELECT count(*)::int FROM public.agenda_contingencia_citas c WHERE c.contingency_id = h.id) AS affected_count,
      (SELECT count(*)::int FROM public.agenda_contingencia_citas c
        WHERE c.contingency_id = h.id AND c.status = 'pending_rebook') AS pending_count
    FROM public.agenda_contingencias h
    WHERE (v_role = 'super_admin' OR h.organization_id = v_org)
      AND (p_from IS NULL OR h.affected_date >= p_from)
      AND (p_to IS NULL OR h.affected_date <= p_to)
  ) x;

  RETURN jsonb_build_object('ok', true, 'items', v_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.mesa_list_agenda_contingencias(DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mesa_list_agenda_contingencias(DATE, DATE)
  TO authenticated, service_role;

-- =============================================================================
-- 8b) Guard mutaciones normales sobre booking ORIGINAL (cancel/reagenda/Drive)
-- =============================================================================
-- Trigger central: evita diverger por RPC. NO aplica a agenda_extraordinary_bookings.
-- closed sigue bloqueando (no es voided).
CREATE OR REPLACE FUNCTION public.agenda_bookings_guard_contingency()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND public.agenda_booking_has_contingency(OLD.id) THEN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      RAISE EXCEPTION
        'BOOKING_UNDER_CONTINGENCY: no se puede cancelar/cambiar status del booking original (%)',
        OLD.id
        USING ERRCODE = 'P0001';
    END IF;

    IF NEW.booking_date IS DISTINCT FROM OLD.booking_date
       OR NEW.booking_time IS DISTINCT FROM OLD.booking_time
       OR NEW.location_id IS DISTINCT FROM OLD.location_id
       OR NEW.kind IS DISTINCT FROM OLD.kind THEN
      RAISE EXCEPTION
        'BOOKING_UNDER_CONTINGENCY: no se puede reagendar el booking original (%); use asesor_agendar_cita_extraordinaria',
        OLD.id
        USING ERRCODE = 'P0001';
    END IF;

    IF NEW.drive_validated IS DISTINCT FROM OLD.drive_validated
       OR NEW.drive_validated_at IS DISTINCT FROM OLD.drive_validated_at
       OR NEW.drive_validated_by IS DISTINCT FROM OLD.drive_validated_by THEN
      RAISE EXCEPTION
        'BOOKING_UNDER_CONTINGENCY: no se puede Validar en Drive el booking original (%) — no hubo cita',
        OLD.id
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.agenda_bookings_guard_contingency() IS
  'P172 B1.1: bloquea cancel/reagenda/Drive sobre booking original bajo contingencia active|closed.';

DROP TRIGGER IF EXISTS agenda_bookings_guard_contingency_bu ON public.agenda_bookings;
CREATE TRIGGER agenda_bookings_guard_contingency_bu
  BEFORE UPDATE ON public.agenda_bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.agenda_bookings_guard_contingency();

-- Semántica closed (sin RPC de cierre en B1.1):
-- closed = contingencia administrativamente terminada / reagendas hechas.
-- NO = "nunca existió" / undo. voided requeriría acción auditada aparte (no implementado).
COMMENT ON COLUMN public.agenda_contingencias.status IS
  'active|closed. closed ≠ voided; originales siguen excluidos de P170 y mutaciones normales.';


-- =============================================================================
-- 8c) Drive validation: assert explícito (además del trigger)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.mesa_set_agenda_drive_validation(p_booking_id uuid, p_validated boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_id UUID;
  v_actor_role public.app_role;
  v_org_id UUID;
  v_booking RECORD;
  v_was_validated BOOLEAN;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'mesa_set_agenda_drive_validation: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_org_id
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'mesa_set_agenda_drive_validation: perfil no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF v_actor_role NOT IN ('mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin') THEN
    RAISE EXCEPTION 'mesa_set_agenda_drive_validation: rol no autorizado (%)', v_actor_role
      USING ERRCODE = '42501';
  END IF;

  IF p_booking_id IS NULL THEN
    RAISE EXCEPTION 'mesa_set_agenda_drive_validation: booking_id es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF p_validated IS NULL THEN
    RAISE EXCEPTION 'mesa_set_agenda_drive_validation: validated es obligatorio'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    b.id,
    b.organization_id,
    b.expediente_id,
    b.kind,
    b.status,
    b.drive_validated,
    b.booking_date,
    b.booking_time,
    e.deleted_at
  INTO v_booking
  FROM public.agenda_bookings b
  INNER JOIN public.expedientes e ON e.id = b.expediente_id
  WHERE b.id = p_booking_id
  FOR UPDATE OF b;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'mesa_set_agenda_drive_validation: booking no encontrado'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_booking.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'mesa_set_agenda_drive_validation: expediente no disponible'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_actor_role <> 'super_admin'
     AND v_booking.organization_id IS DISTINCT FROM v_org_id THEN
    RAISE EXCEPTION 'mesa_set_agenda_drive_validation: booking fuera de la organización del actor'
      USING ERRCODE = '42501';
  END IF;

  IF NOT public.can_see_expediente(v_booking.expediente_id) THEN
    RAISE EXCEPTION 'mesa_set_agenda_drive_validation: no autorizado para operar este expediente'
      USING ERRCODE = '42501';
  END IF;

  -- P172 B1.1: booking original bajo contingencia no admite Validar en Drive
  PERFORM public.agenda_assert_booking_not_under_contingency(p_booking_id);

  IF p_validated IS TRUE AND v_booking.status <> 'booked' THEN
    RAISE EXCEPTION 'mesa_set_agenda_drive_validation: solo se puede validar una cita activa (booked)'
      USING ERRCODE = '22023';
  END IF;

  v_was_validated := COALESCE(v_booking.drive_validated, false);

  IF p_validated IS TRUE THEN
    UPDATE public.agenda_bookings
    SET
      drive_validated = true,
      drive_validated_at = NOW(),
      drive_validated_by = v_actor_id
    WHERE id = p_booking_id;

    PERFORM public.log_action(
      v_booking.organization_id,
      v_actor_id,
      v_actor_role,
      'agenda.drive_validation.set',
      'agenda_booking',
      p_booking_id,
      jsonb_build_object(
        'expediente_id', v_booking.expediente_id,
        'kind', v_booking.kind,
        'booking_date', v_booking.booking_date,
        'booking_time', v_booking.booking_time,
        'previous_validated', v_was_validated,
        'drive_validated', true
      )
    );
  ELSE
    UPDATE public.agenda_bookings
    SET
      drive_validated = false,
      drive_validated_at = NULL,
      drive_validated_by = NULL
    WHERE id = p_booking_id;

    PERFORM public.log_action(
      v_booking.organization_id,
      v_actor_id,
      v_actor_role,
      'agenda.drive_validation.clear',
      'agenda_booking',
      p_booking_id,
      jsonb_build_object(
        'expediente_id', v_booking.expediente_id,
        'kind', v_booking.kind,
        'booking_date', v_booking.booking_date,
        'booking_time', v_booking.booking_time,
        'previous_validated', v_was_validated,
        'drive_validated', false
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'booking_id', p_booking_id,
    'drive_validated', p_validated,
    'drive_validated_at', CASE WHEN p_validated THEN NOW() ELSE NULL END,
    'drive_validated_by', CASE WHEN p_validated THEN v_actor_id ELSE NULL END,
    'status_unchanged', v_booking.status,
    'kind_unchanged', v_booking.kind
  );
END;
$function$;
-- =============================================================================
-- 9) P170 guard: SKIPPED_CONTINGENCY (CREATE OR REPLACE; no edita archivo 170)
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


  -- P172: booking bajo contingencia activa → nunca mutar expediente (prioridad sobre COMPLETED/FAILED/X/SI/CESI)
  IF public.agenda_booking_has_contingency(p_booking_id) THEN
    -- Observación Sheet permanece (upsert projection) pero apply_outcome = SKIPPED_CONTINGENCY
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
  'P170+P172 B1.1: SKIPPED_CONTINGENCY permanente si booking original en contingencia active|closed.';

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

-- =============================================================================
-- 10) P172 B2: preview + listados Mesa/asesor (read-only; mismo predicado que declarar)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.agenda_preview_contingencia(
  p_affected_date DATE,
  p_kind TEXT,
  p_location_id TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_role public.app_role;
  v_org UUID;
  v_kind TEXT;
  v_loc TEXT;
  v_affected INT := 0;
  v_advisors INT := 0;
BEGIN
  v_actor := public.current_profile_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'CONTINGENCY_PREVIEW_UNAUTHORIZED' USING ERRCODE = '42501';
  END IF;
  SELECT p.app_role, p.organization_id INTO v_role, v_org
  FROM public.profiles p WHERE p.id = v_actor AND p.active = true;
  IF NOT FOUND OR v_role NOT IN (
    'mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin'
  ) THEN
    RAISE EXCEPTION 'CONTINGENCY_PREVIEW_UNAUTHORIZED' USING ERRCODE = '42501';
  END IF;
  IF p_affected_date IS NULL THEN
    RAISE EXCEPTION 'CONTINGENCY_DATE_REQUIRED' USING ERRCODE = '22023';
  END IF;
  v_kind := lower(btrim(COALESCE(p_kind, '')));
  IF v_kind NOT IN ('biometricos', 'firmas') THEN
    RAISE EXCEPTION 'CONTINGENCY_KIND_INVALID' USING ERRCODE = '22023';
  END IF;
  v_loc := public.agenda_contingency_normalize_location_id(p_location_id);

  SELECT count(*)::int,
         count(DISTINCT e.asesor_id)::int
    INTO v_affected, v_advisors
  FROM public.agenda_bookings b
  JOIN public.expedientes e ON e.id = b.expediente_id
  WHERE b.organization_id = v_org
    AND b.booking_date = p_affected_date
    AND b.kind::text = v_kind
    AND b.status = 'booked'
    AND (v_loc IS NULL OR lower(btrim(b.location_id)) = v_loc);

  RETURN jsonb_build_object(
    'ok', true,
    'affected_date', p_affected_date,
    'kind', v_kind,
    'location_id', v_loc,
    'affected_count', v_affected,
    'advisor_count', v_advisors
  );
END;
$$;

COMMENT ON FUNCTION public.agenda_preview_contingencia(DATE, TEXT, TEXT) IS
  'P172 B2: preview read-only mismo predicado que declarar. 0 writes.';

REVOKE ALL ON FUNCTION public.agenda_preview_contingencia(DATE, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agenda_preview_contingencia(DATE, TEXT, TEXT)
  TO authenticated, service_role;

-- Ampliar list Mesa con rebooked_count
CREATE OR REPLACE FUNCTION public.mesa_list_agenda_contingencias(
  p_from DATE DEFAULT NULL,
  p_to DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_role public.app_role;
  v_org UUID;
  v_rows JSONB;
BEGIN
  v_actor := public.current_profile_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'CONTINGENCY_LIST_UNAUTHORIZED' USING ERRCODE = '42501';
  END IF;
  SELECT p.app_role, p.organization_id INTO v_role, v_org
  FROM public.profiles p WHERE p.id = v_actor AND p.active = true;
  IF NOT FOUND OR v_role NOT IN (
    'mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin'
  ) THEN
    RAISE EXCEPTION 'CONTINGENCY_LIST_UNAUTHORIZED' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.affected_date DESC, x.kind), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      h.id AS contingency_id,
      h.affected_date,
      h.kind,
      h.location_id,
      h.reason,
      h.status,
      h.created_at,
      (SELECT count(*)::int FROM public.agenda_contingencia_citas c WHERE c.contingency_id = h.id) AS affected_count,
      (SELECT count(*)::int FROM public.agenda_contingencia_citas c
        WHERE c.contingency_id = h.id AND c.status = 'pending_rebook') AS pending_count,
      (SELECT count(*)::int FROM public.agenda_contingencia_citas c
        WHERE c.contingency_id = h.id AND c.status = 'rebooked') AS rebooked_count
    FROM public.agenda_contingencias h
    WHERE (v_role = 'super_admin' OR h.organization_id = v_org)
      AND (p_from IS NULL OR h.affected_date >= p_from)
      AND (p_to IS NULL OR h.affected_date <= p_to)
  ) x;

  RETURN jsonb_build_object('ok', true, 'items', v_rows);
END;
$$;

-- Items por rango (para badges por booking_id)
CREATE OR REPLACE FUNCTION public.mesa_list_contingencia_items(
  p_from DATE DEFAULT NULL,
  p_to DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_role public.app_role;
  v_org UUID;
  v_rows JSONB;
BEGIN
  v_actor := public.current_profile_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'CONTINGENCY_LIST_UNAUTHORIZED' USING ERRCODE = '42501';
  END IF;
  SELECT p.app_role, p.organization_id INTO v_role, v_org
  FROM public.profiles p WHERE p.id = v_actor AND p.active = true;
  IF NOT FOUND OR v_role NOT IN (
    'mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin'
  ) THEN
    RAISE EXCEPTION 'CONTINGENCY_LIST_UNAUTHORIZED' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      c.id AS contingency_item_id,
      c.contingency_id,
      c.original_booking_id,
      c.expediente_id,
      c.status AS item_status,
      c.extraordinary_booking_id,
      h.affected_date,
      h.kind,
      h.location_id AS contingency_location_id,
      h.reason,
      h.status AS contingency_status,
      eb.booking_date AS extraordinary_date,
      eb.booking_time AS extraordinary_time,
      eb.location_id AS extraordinary_location_id
    FROM public.agenda_contingencia_citas c
    JOIN public.agenda_contingencias h ON h.id = c.contingency_id
    LEFT JOIN public.agenda_extraordinary_bookings eb ON eb.id = c.extraordinary_booking_id
    WHERE (v_role = 'super_admin' OR c.organization_id = v_org)
      AND (p_from IS NULL OR h.affected_date >= p_from)
      AND (p_to IS NULL OR h.affected_date <= p_to)
  ) x;

  RETURN jsonb_build_object('ok', true, 'items', v_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.mesa_list_contingencia_items(DATE, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mesa_list_contingencia_items(DATE, DATE)
  TO authenticated, service_role;

-- Asesor: items de un expediente (pending + rebooked)
CREATE OR REPLACE FUNCTION public.asesor_list_contingencia_expediente(
  p_expediente_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_role public.app_role;
  v_rows JSONB;
BEGIN
  v_actor := public.current_profile_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'CONTINGENCY_LIST_UNAUTHORIZED' USING ERRCODE = '42501';
  END IF;
  SELECT p.app_role INTO v_role FROM public.profiles p WHERE p.id = v_actor AND p.active = true;
  IF NOT FOUND OR v_role <> 'asesor' THEN
    RAISE EXCEPTION 'CONTINGENCY_LIST_UNAUTHORIZED' USING ERRCODE = '42501';
  END IF;
  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'CONTINGENCY_EXPEDIENTE_REQUIRED' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.expedientes e
    WHERE e.id = p_expediente_id AND e.asesor_id = v_actor
  ) THEN
    RAISE EXCEPTION 'CONTINGENCY_FORBIDDEN' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.affected_date DESC), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      c.id AS contingency_item_id,
      c.contingency_id,
      c.original_booking_id,
      c.expediente_id,
      c.status AS item_status,
      c.extraordinary_booking_id,
      h.affected_date,
      h.kind,
      h.location_id AS contingency_location_id,
      h.reason,
      h.status AS contingency_status,
      ob.booking_date AS original_date,
      ob.booking_time AS original_time,
      ob.location_id AS original_location_id,
      eb.booking_date AS extraordinary_date,
      eb.booking_time AS extraordinary_time,
      eb.location_id AS extraordinary_location_id
    FROM public.agenda_contingencia_citas c
    JOIN public.agenda_contingencias h ON h.id = c.contingency_id
    JOIN public.agenda_bookings ob ON ob.id = c.original_booking_id
    LEFT JOIN public.agenda_extraordinary_bookings eb ON eb.id = c.extraordinary_booking_id
    WHERE c.expediente_id = p_expediente_id
      AND c.advisor_id = v_actor
      AND h.status = 'active'
      AND c.status IN ('pending_rebook', 'rebooked')
  ) x;

  RETURN jsonb_build_object('ok', true, 'items', v_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.asesor_list_contingencia_expediente(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asesor_list_contingencia_expediente(UUID)
  TO authenticated, service_role;
