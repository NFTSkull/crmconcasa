-- ConCasa CRM — Inventario físico de filas Sheet (cupo real)
-- Migración 131. No modifica 129/130. No toca P090 / Evidencia / mesa_mover / NOM-035.
-- Inventario obligatorio desde 2026-07-30 inclusive.
-- Stale si MAX(observed_at) por org+fecha es NULL o < NOW() - INTERVAL '6 hours'.

-- =============================================================================
-- Tabla
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.agenda_sheet_slot_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  spreadsheet_id TEXT NOT NULL,
  sheet_id BIGINT NOT NULL,
  sheet_title TEXT NOT NULL,
  booking_date DATE NOT NULL,
  sheet_row INTEGER NOT NULL CHECK (sheet_row > 0),
  kind TEXT NOT NULL CHECK (kind IN ('biometricos', 'firmas')),
  location_id TEXT NOT NULL CHECK (location_id IN ('monterrey', 'apodaca')),
  slot_time TIME NOT NULL,
  slot_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'available', 'occupied_external', 'claimed', 'linked', 'disabled', 'conflict'
  )),
  visible_nss TEXT NULL,
  visible_name TEXT NULL,
  visible_advisor TEXT NULL,
  booking_id UUID NULL REFERENCES public.agenda_bookings(id) ON DELETE SET NULL,
  expediente_id UUID NULL,
  occupancy_source TEXT NOT NULL CHECK (occupancy_source IN (
    'sheet_legacy', 'sheet_webhook', 'crm', 'reconciliation'
  )),
  observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at TIMESTAMPTZ NULL,
  linked_at TIMESTAMPTZ NULL,
  last_error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT agenda_sheet_slot_inventory_row_unique
    UNIQUE (spreadsheet_id, sheet_id, sheet_row)
);

CREATE UNIQUE INDEX IF NOT EXISTS agenda_sheet_slot_inventory_booking_uidx
  ON public.agenda_sheet_slot_inventory (booking_id)
  WHERE booking_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS agenda_sheet_slot_inventory_lookup_idx
  ON public.agenda_sheet_slot_inventory (
    organization_id, booking_date, kind, location_id, slot_time, status
  );

DROP TRIGGER IF EXISTS agenda_sheet_slot_inventory_set_updated_at
  ON public.agenda_sheet_slot_inventory;
CREATE TRIGGER agenda_sheet_slot_inventory_set_updated_at
  BEFORE UPDATE ON public.agenda_sheet_slot_inventory
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.agenda_sheet_slot_inventory IS
  'Inventario físico fila Sheet ↔ cupo real. Obligatorio booking_date >= 2026-07-30. Stale >6h.';

-- =============================================================================
-- RLS + grants (sin acceso directo authenticated/anon)
-- =============================================================================
ALTER TABLE public.agenda_sheet_slot_inventory ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.agenda_sheet_slot_inventory FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.agenda_sheet_slot_inventory TO service_role, postgres;

-- =============================================================================
-- Helpers: enforced / fresh / counts / assert
-- =============================================================================
CREATE OR REPLACE FUNCTION public.agenda_sheet_inventory_enforced(p_date DATE)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT p_date IS NOT NULL AND p_date >= DATE '2026-07-30';
$$;

COMMENT ON FUNCTION public.agenda_sheet_inventory_enforced(DATE) IS
  'Inventario Sheet obligatorio si fecha >= 2026-07-30.';

-- Solo sedes del spreadsheet operativo (legacy sede-centro etc. usan solo config Mesa).
CREATE OR REPLACE FUNCTION public.agenda_sheet_inventory_applies(p_location TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT lower(btrim(COALESCE(p_location, ''))) IN ('monterrey', 'apodaca');
$$;

COMMENT ON FUNCTION public.agenda_sheet_inventory_applies(TEXT) IS
  'true solo para sedes sincronizadas con Google Sheets (monterrey/apodaca).';

CREATE OR REPLACE FUNCTION public.agenda_sheet_inventory_fresh(
  p_org UUID,
  p_date DATE
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max TIMESTAMPTZ;
BEGIN
  IF NOT public.agenda_sheet_inventory_enforced(p_date) THEN
    RETURN true;
  END IF;

  SELECT MAX(i.observed_at)
  INTO v_max
  FROM public.agenda_sheet_slot_inventory i
  WHERE i.organization_id = p_org
    AND i.booking_date = p_date;

  IF v_max IS NULL THEN
    RETURN false;
  END IF;

  IF v_max < (NOW() - INTERVAL '6 hours') THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.agenda_sheet_inventory_fresh(UUID, DATE) IS
  'false si enforced y (sin filas OR MAX(observed_at) stale >6h).';

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
SET search_path = public
AS $$
  SELECT COUNT(*)::INTEGER
  FROM public.agenda_sheet_slot_inventory i
  WHERE i.organization_id = p_org
    AND i.kind = p_kind
    AND i.booking_date = p_date
    AND i.slot_time = p_time
    AND i.location_id = p_location
    AND i.status = 'available';
$$;

CREATE OR REPLACE FUNCTION public.agenda_sheet_inventory_physical_total(
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
SET search_path = public
AS $$
  SELECT COUNT(*)::INTEGER
  FROM public.agenda_sheet_slot_inventory i
  WHERE i.organization_id = p_org
    AND i.kind = p_kind
    AND i.booking_date = p_date
    AND i.slot_time = p_time
    AND i.location_id = p_location
    AND i.status IS DISTINCT FROM 'disabled';
$$;

CREATE OR REPLACE FUNCTION public.agenda_sheet_assert_inventory_allows_booking(
  p_org UUID,
  p_kind TEXT,
  p_date DATE,
  p_time TIME,
  p_location TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_available INTEGER;
BEGIN
  IF NOT public.agenda_sheet_inventory_enforced(p_date) THEN
    RETURN;
  END IF;
  IF NOT public.agenda_sheet_inventory_applies(p_location) THEN
    RETURN;
  END IF;

  IF NOT public.agenda_sheet_inventory_fresh(p_org, p_date) THEN
    RAISE EXCEPTION 'SIN_CUPO_REAL_EN_SHEET: inventario desactualizado'
      USING ERRCODE = '22023';
  END IF;

  v_available := public.agenda_sheet_inventory_available_count(
    p_org, p_kind, p_date, p_time, p_location
  );

  IF COALESCE(v_available, 0) < 1 THEN
    RAISE EXCEPTION 'SIN_CUPO_REAL_EN_SHEET'
      USING ERRCODE = '22023';
  END IF;
END;
$$;

-- Gate post-assert de config: min(config restante, available sheet) debe ser >= 1
CREATE OR REPLACE FUNCTION public.agenda_sheet_inventory_gate_after_config_assert(
  p_org UUID,
  p_kind TEXT,
  p_date DATE,
  p_time TIME,
  p_location TEXT,
  p_config_capacity INTEGER,
  p_booked_count INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_available INTEGER;
  v_effective INTEGER;
BEGIN
  PERFORM public.agenda_sheet_assert_inventory_allows_booking(
    p_org, p_kind, p_date, p_time, p_location
  );

  IF NOT public.agenda_sheet_inventory_enforced(p_date) THEN
    RETURN;
  END IF;
  IF NOT public.agenda_sheet_inventory_applies(p_location) THEN
    RETURN;
  END IF;

  v_available := public.agenda_sheet_inventory_available_count(
    p_org, p_kind, p_date, p_time, p_location
  );

  v_effective := LEAST(
    GREATEST(COALESCE(p_config_capacity, 0) - COALESCE(p_booked_count, 0), 0),
    COALESCE(v_available, 0)
  );

  IF v_effective < 1 THEN
    RAISE EXCEPTION 'SIN_CUPO_REAL_EN_SHEET'
      USING ERRCODE = '22023';
  END IF;
END;
$$;

-- =============================================================================
-- Trigger claim (AFTER INSERT) — nombre ordena ANTES que agenda_sheet_outbox_aiud
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
  IF NEW.kind IS NULL OR NEW.kind::TEXT NOT IN ('biometricos', 'firmas') THEN
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

  SELECT i.id
  INTO v_inv_id
  FROM public.agenda_sheet_slot_inventory i
  WHERE i.organization_id = NEW.organization_id
    AND i.booking_date = NEW.booking_date
    AND i.kind = NEW.kind::TEXT
    AND i.location_id = NEW.location_id
    AND i.slot_time = NEW.booking_time
    AND i.status = 'available'
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
    occupancy_source = 'crm',
    updated_at = NOW()
  WHERE i.id = v_inv_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS agenda_sheet_inventory_claim_ai ON public.agenda_bookings;
CREATE TRIGGER agenda_sheet_inventory_claim_ai
  AFTER INSERT ON public.agenda_bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.agenda_sheet_inventory_claim_ai();

-- =============================================================================
-- Trigger release on cancel (AFTER UPDATE)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.agenda_sheet_inventory_release_au()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (OLD.status = 'booked' AND NEW.status = 'cancelled') THEN
    RETURN NEW;
  END IF;

  UPDATE public.agenda_sheet_slot_inventory i
  SET
    status = 'available',
    booking_id = NULL,
    expediente_id = NULL,
    claimed_at = NULL,
    linked_at = NULL,
    -- Liberación CRM: limpiar visibles escritos por occupancy crm
    visible_nss = NULL,
    visible_name = NULL,
    visible_advisor = NULL,
    updated_at = NOW()
  WHERE i.booking_id = NEW.id
    AND i.status IN ('claimed', 'linked')
    AND i.occupancy_source = 'crm';
  -- Nunca liberar occupied_external / disabled / conflict (filtro status+source).

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS agenda_sheet_inventory_release_au ON public.agenda_bookings;
CREATE TRIGGER agenda_sheet_inventory_release_au
  AFTER UPDATE ON public.agenda_bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.agenda_sheet_inventory_release_au();

-- =============================================================================
-- Outbox payload: añadir sheet_id / sheet_title / sheet_row / inventory_id
-- =============================================================================
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
  v_inv RECORD;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.kind NOT IN ('biometricos', 'firmas') THEN
      RETURN NEW;
    END IF;
    IF NEW.status <> 'booked' THEN
      RETURN NEW;
    END IF;
    v_event := 'booking_created';
    v_version := '1';
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.kind NOT IN ('biometricos', 'firmas')
       AND OLD.kind NOT IN ('biometricos', 'firmas') THEN
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

  SELECT i.id AS inventory_id, i.sheet_id, i.sheet_title, i.sheet_row
  INTO v_inv
  FROM public.agenda_sheet_slot_inventory i
  WHERE i.booking_id = NEW.id
  LIMIT 1;

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
    'sheet_id', v_inv.sheet_id,
    'sheet_title', v_inv.sheet_title,
    'sheet_row', v_inv.sheet_row,
    'inventory_id', v_inv.inventory_id
  );

  INSERT INTO public.agenda_sheet_sync_outbox (
    organization_id, booking_id, event_type, idempotency_key, payload
  ) VALUES (
    NEW.organization_id, NEW.id, v_event, v_key, v_payload
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN NEW;
END;
$$;

-- =============================================================================
-- RPC availability (authenticated)
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
  v_enforced BOOLEAN;
  v_fresh BOOLEAN;
  v_slots JSONB := '[]'::JSONB;
BEGIN
  v_actor := public.current_profile_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'agenda_sheet_inventory_availability: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.organization_id INTO v_org
  FROM public.profiles p
  WHERE p.id = v_actor;

  IF v_org IS NULL THEN
    RAISE EXCEPTION 'agenda_sheet_inventory_availability: organización no encontrada'
      USING ERRCODE = '42501';
  END IF;

  IF p_kind IS NULL OR p_kind NOT IN ('biometricos', 'firmas') THEN
    RAISE EXCEPTION 'agenda_sheet_inventory_availability: kind inválido'
      USING ERRCODE = '22023';
  END IF;

  IF p_location_id IS NULL OR p_location_id NOT IN ('monterrey', 'apodaca') THEN
    RAISE EXCEPTION 'agenda_sheet_inventory_availability: sede inválida'
      USING ERRCODE = '22023';
  END IF;

  IF p_date IS NULL THEN
    RAISE EXCEPTION 'agenda_sheet_inventory_availability: fecha inválida'
      USING ERRCODE = '22023';
  END IF;

  v_enforced := public.agenda_sheet_inventory_enforced(p_date);
  v_fresh := public.agenda_sheet_inventory_fresh(v_org, p_date);

  IF v_enforced AND NOT v_fresh THEN
    RETURN jsonb_build_object(
      'ok', true,
      'fresh', false,
      'enforced', true,
      'slots', '[]'::JSONB
    );
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'slot_time', to_char(s.slot_time, 'HH24:MI:SS'),
      'available', s.available,
      'physical_total', s.physical_total,
      'occupied_external', s.occupied_external,
      'claimed', s.claimed,
      'linked', s.linked,
      'disabled', s.disabled
    )
    ORDER BY s.slot_time
  ), '[]'::JSONB)
  INTO v_slots
  FROM (
    SELECT
      i.slot_time,
      COUNT(*) FILTER (WHERE i.status = 'available')::INTEGER AS available,
      COUNT(*) FILTER (WHERE i.status IS DISTINCT FROM 'disabled')::INTEGER AS physical_total,
      COUNT(*) FILTER (WHERE i.status = 'occupied_external')::INTEGER AS occupied_external,
      COUNT(*) FILTER (WHERE i.status = 'claimed')::INTEGER AS claimed,
      COUNT(*) FILTER (WHERE i.status = 'linked')::INTEGER AS linked,
      COUNT(*) FILTER (WHERE i.status = 'disabled')::INTEGER AS disabled
    FROM public.agenda_sheet_slot_inventory i
    WHERE i.organization_id = v_org
      AND i.kind = p_kind
      AND i.booking_date = p_date
      AND i.location_id = p_location_id
    GROUP BY i.slot_time
  ) s;

  RETURN jsonb_build_object(
    'ok', true,
    'fresh', v_fresh,
    'enforced', v_enforced,
    'slots', COALESCE(v_slots, '[]'::JSONB)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.agenda_sheet_inventory_availability(TEXT, DATE, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agenda_sheet_inventory_availability(TEXT, DATE, TEXT)
  TO authenticated, service_role, postgres;

-- =============================================================================
-- RPC upsert_batch (service_role)
-- Reglas anti-steal:
--  - incoming available + existing.booking_id NOT NULL → conservar status existente
--  - incoming occupied_external + existing claimed/linked mismo booking → conservar linked/claimed
-- No borra filas ausentes del batch (reconciler marca aparte).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.agenda_sheet_inventory_upsert_batch(p_rows JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_elem JSONB;
  v_count INTEGER := 0;
  v_existing public.agenda_sheet_slot_inventory%ROWTYPE;
  v_status TEXT;
  v_booking_id UUID;
  v_expediente_id UUID;
  v_occ TEXT;
  v_visible_nss TEXT;
  v_visible_name TEXT;
  v_visible_advisor TEXT;
BEGIN
  PERFORM public.agenda_sheet_assert_service_role();

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'agenda_sheet_inventory_upsert_batch: p_rows debe ser array JSON'
      USING ERRCODE = '22023';
  END IF;

  FOR v_elem IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    v_status := NULLIF(btrim(COALESCE(v_elem->>'status', '')), '');
    BEGIN
      v_booking_id := NULLIF(btrim(COALESCE(v_elem->>'booking_id', '')), '')::UUID;
    EXCEPTION WHEN invalid_text_representation THEN
      v_booking_id := NULL;
    END;
    BEGIN
      v_expediente_id := NULLIF(btrim(COALESCE(v_elem->>'expediente_id', '')), '')::UUID;
    EXCEPTION WHEN invalid_text_representation THEN
      v_expediente_id := NULL;
    END;
    v_occ := NULLIF(btrim(COALESCE(v_elem->>'occupancy_source', '')), '');
    v_visible_nss := NULLIF(btrim(COALESCE(v_elem->>'visible_nss', '')), '');
    v_visible_name := NULLIF(btrim(COALESCE(v_elem->>'visible_name', '')), '');
    v_visible_advisor := NULLIF(btrim(COALESCE(v_elem->>'visible_advisor', '')), '');

    IF v_status IS NULL OR v_status NOT IN (
      'available', 'occupied_external', 'claimed', 'linked', 'disabled', 'conflict'
    ) THEN
      RAISE EXCEPTION 'agenda_sheet_inventory_upsert_batch: status inválido'
        USING ERRCODE = '22023';
    END IF;

    IF v_occ IS NULL OR v_occ NOT IN (
      'sheet_legacy', 'sheet_webhook', 'crm', 'reconciliation'
    ) THEN
      RAISE EXCEPTION 'agenda_sheet_inventory_upsert_batch: occupancy_source inválido'
        USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_existing
    FROM public.agenda_sheet_slot_inventory i
    WHERE i.spreadsheet_id = btrim(v_elem->>'spreadsheet_id')
      AND i.sheet_id = (v_elem->>'sheet_id')::BIGINT
      AND i.sheet_row = (v_elem->>'sheet_row')::INTEGER
    FOR UPDATE;

    IF FOUND THEN
      -- Anti-steal: no degradar claimed/linked con booking a available
      IF v_status = 'available' AND v_existing.booking_id IS NOT NULL THEN
        v_status := v_existing.status;
        v_booking_id := v_existing.booking_id;
        v_expediente_id := v_existing.expediente_id;
        v_occ := v_existing.occupancy_source;
      -- Misma reserva CRM: no pisar claimed/linked con occupied_external
      ELSIF v_status = 'occupied_external'
            AND v_existing.status IN ('claimed', 'linked')
            AND v_existing.booking_id IS NOT NULL
            AND (
              v_booking_id IS NULL
              OR v_booking_id = v_existing.booking_id
            ) THEN
        v_status := v_existing.status;
        v_booking_id := v_existing.booking_id;
        v_expediente_id := COALESCE(v_expediente_id, v_existing.expediente_id);
        v_occ := v_existing.occupancy_source;
      END IF;

      UPDATE public.agenda_sheet_slot_inventory i
      SET
        organization_id = COALESCE(
          NULLIF(btrim(COALESCE(v_elem->>'organization_id', '')), '')::UUID,
          i.organization_id
        ),
        sheet_title = COALESCE(NULLIF(btrim(COALESCE(v_elem->>'sheet_title', '')), ''), i.sheet_title),
        booking_date = COALESCE((v_elem->>'booking_date')::DATE, i.booking_date),
        kind = COALESCE(NULLIF(btrim(COALESCE(v_elem->>'kind', '')), ''), i.kind),
        location_id = COALESCE(NULLIF(btrim(COALESCE(v_elem->>'location_id', '')), ''), i.location_id),
        slot_time = COALESCE((v_elem->>'slot_time')::TIME, i.slot_time),
        slot_key = COALESCE(NULLIF(btrim(COALESCE(v_elem->>'slot_key', '')), ''), i.slot_key),
        status = v_status,
        visible_nss = v_visible_nss,
        visible_name = v_visible_name,
        visible_advisor = v_visible_advisor,
        booking_id = v_booking_id,
        expediente_id = v_expediente_id,
        occupancy_source = v_occ,
        observed_at = NOW(),
        last_error = CASE
          WHEN v_status = 'conflict' THEN COALESCE(v_elem->>'last_error', i.last_error)
          ELSE i.last_error
        END,
        updated_at = NOW()
      WHERE i.id = v_existing.id;
    ELSE
      INSERT INTO public.agenda_sheet_slot_inventory (
        organization_id, spreadsheet_id, sheet_id, sheet_title, booking_date,
        sheet_row, kind, location_id, slot_time, slot_key, status,
        visible_nss, visible_name, visible_advisor,
        booking_id, expediente_id, occupancy_source, observed_at
      ) VALUES (
        (v_elem->>'organization_id')::UUID,
        btrim(v_elem->>'spreadsheet_id'),
        (v_elem->>'sheet_id')::BIGINT,
        btrim(v_elem->>'sheet_title'),
        (v_elem->>'booking_date')::DATE,
        (v_elem->>'sheet_row')::INTEGER,
        btrim(v_elem->>'kind'),
        btrim(v_elem->>'location_id'),
        (v_elem->>'slot_time')::TIME,
        btrim(v_elem->>'slot_key'),
        v_status,
        v_visible_nss,
        v_visible_name,
        v_visible_advisor,
        v_booking_id,
        v_expediente_id,
        v_occ,
        NOW()
      );
    END IF;

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'upserted', v_count);
END;
$$;

REVOKE ALL ON FUNCTION public.agenda_sheet_inventory_upsert_batch(JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_sheet_inventory_upsert_batch(JSONB)
  TO service_role, postgres;

-- =============================================================================
-- mark_linked / mark_conflict (service_role)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.agenda_sheet_inventory_mark_linked(
  p_booking_id UUID,
  p_sheet_row INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n INTEGER;
BEGIN
  PERFORM public.agenda_sheet_assert_service_role();

  IF p_booking_id IS NULL THEN
    RAISE EXCEPTION 'agenda_sheet_inventory_mark_linked: booking_id requerido'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.agenda_sheet_slot_inventory i
  SET
    status = 'linked',
    linked_at = NOW(),
    updated_at = NOW()
  WHERE i.booking_id = p_booking_id
    AND (p_sheet_row IS NULL OR i.sheet_row = p_sheet_row);

  GET DIAGNOSTICS v_n = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'updated', v_n);
END;
$$;

CREATE OR REPLACE FUNCTION public.agenda_sheet_inventory_mark_conflict(
  p_id UUID,
  p_error TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n INTEGER;
BEGIN
  PERFORM public.agenda_sheet_assert_service_role();

  IF p_id IS NULL THEN
    RAISE EXCEPTION 'agenda_sheet_inventory_mark_conflict: id requerido'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.agenda_sheet_slot_inventory i
  SET
    status = 'conflict',
    last_error = NULLIF(btrim(COALESCE(p_error, '')), ''),
    updated_at = NOW()
  WHERE i.id = p_id;

  GET DIAGNOSTICS v_n = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'updated', v_n);
END;
$$;

REVOKE ALL ON FUNCTION public.agenda_sheet_inventory_mark_linked(UUID, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_sheet_inventory_mark_linked(UUID, INTEGER)
  TO service_role, postgres;

REVOKE ALL ON FUNCTION public.agenda_sheet_inventory_mark_conflict(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_sheet_inventory_mark_conflict(UUID, TEXT)
  TO service_role, postgres;

-- Helpers internos: sin EXECUTE a authenticated/anon
REVOKE ALL ON FUNCTION public.agenda_sheet_inventory_enforced(DATE)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_sheet_inventory_enforced(DATE)
  TO service_role, postgres, authenticated;

REVOKE ALL ON FUNCTION public.agenda_sheet_inventory_applies(TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_sheet_inventory_applies(TEXT)
  TO service_role, postgres, authenticated;

REVOKE ALL ON FUNCTION public.agenda_sheet_inventory_fresh(UUID, DATE)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_sheet_inventory_fresh(UUID, DATE)
  TO service_role, postgres;

REVOKE ALL ON FUNCTION public.agenda_sheet_inventory_available_count(UUID, TEXT, DATE, TIME, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_sheet_inventory_available_count(UUID, TEXT, DATE, TIME, TEXT)
  TO service_role, postgres;

REVOKE ALL ON FUNCTION public.agenda_sheet_inventory_physical_total(UUID, TEXT, DATE, TIME, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_sheet_inventory_physical_total(UUID, TEXT, DATE, TIME, TEXT)
  TO service_role, postgres;

REVOKE ALL ON FUNCTION public.agenda_sheet_assert_inventory_allows_booking(UUID, TEXT, DATE, TIME, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_sheet_assert_inventory_allows_booking(UUID, TEXT, DATE, TIME, TEXT)
  TO service_role, postgres;

REVOKE ALL ON FUNCTION public.agenda_sheet_inventory_gate_after_config_assert(UUID, TEXT, DATE, TIME, TEXT, INTEGER, INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_sheet_inventory_gate_after_config_assert(UUID, TEXT, DATE, TIME, TEXT, INTEGER, INTEGER)
  TO service_role, postgres;

REVOKE ALL ON FUNCTION public.agenda_sheet_inventory_claim_ai() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agenda_sheet_inventory_release_au() FROM PUBLIC, anon, authenticated;


-- =============================================================================
-- Parche asserts biométricos/firmas: gate inventario justo antes del RETURN
-- Cuerpo desde mig. 112 + PERFORM agenda_sheet_inventory_gate_after_config_assert
-- =============================================================================
CREATE OR REPLACE FUNCTION public.agenda_biometricos_assert_slot_available(
  p_org_id uuid,
  p_scheduled_at timestamp with time zone,
  p_location_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_row public.agenda_config%ROWTYPE;
  v_config JSONB;
  v_tz TEXT;
  v_local_ts TIMESTAMP;
  v_booking_date DATE;
  v_booking_time TIME;
  v_time_label TEXT;
  v_min_lead_hours INTEGER;
  v_iso_dow INTEGER;
  v_slot TEXT;
  v_slot_allowed BOOLEAN := false;
  v_location_cfg JSONB;
  v_capacity INTEGER;
  v_booked_count INTEGER;
  v_resolved RECORD;
  v_recurrent INTEGER;
BEGIN
  SELECT ac.*
  INTO v_row
  FROM public.agenda_config ac
  WHERE ac.organization_id = p_org_id
    AND ac.kind = 'biometricos';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'agenda_config: configuración biométricos no encontrada'
      USING ERRCODE = '22023';
  END IF;

  v_config := public.agenda_biometricos_normalize_config(v_row.config);

  IF COALESCE((v_config->>'enabled')::BOOLEAN, true) IS NOT TRUE THEN
    RAISE EXCEPTION 'agenda_config: agenda biométricos deshabilitada'
      USING ERRCODE = '22023';
  END IF;

  v_tz := NULLIF(btrim(COALESCE(v_config->>'timezone', '')), '');
  IF v_tz IS NULL THEN
    RAISE EXCEPTION 'agenda_config: timezone no configurado'
      USING ERRCODE = '22023';
  END IF;

  v_local_ts := p_scheduled_at AT TIME ZONE v_tz;
  v_booking_date := v_local_ts::DATE;
  v_booking_time := v_local_ts::TIME;
  v_time_label := to_char(v_local_ts, 'HH24:MI');

  v_min_lead_hours := public.agenda_biometricos_min_lead_hours(v_config);
  IF p_scheduled_at < NOW() + (v_min_lead_hours || ' hours')::INTERVAL THEN
    RAISE EXCEPTION 'agenda_config: fecha no cumple anticipación mínima'
      USING ERRCODE = '22023';
  END IF;

  IF NOT (v_config ? 'allowed_weekdays')
     OR jsonb_typeof(v_config->'allowed_weekdays') <> 'array'
     OR jsonb_array_length(v_config->'allowed_weekdays') = 0 THEN
    RAISE EXCEPTION 'agenda_config: días no configurados'
      USING ERRCODE = '22023';
  END IF;

  v_iso_dow := EXTRACT(ISODOW FROM v_local_ts)::INTEGER;
  IF NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_config->'allowed_weekdays') elem
    WHERE (elem #>> '{}')::INTEGER = v_iso_dow
  ) THEN
    RAISE EXCEPTION 'agenda_config: día no permitido'
      USING ERRCODE = '22023';
  END IF;

  IF (v_config ? 'slots')
     AND jsonb_typeof(v_config->'slots') = 'array'
     AND jsonb_array_length(v_config->'slots') > 0 THEN
    FOR v_slot IN
      SELECT jsonb_array_elements_text(v_config->'slots')
    LOOP
      IF v_time_label = v_slot THEN
        v_slot_allowed := true;
        EXIT;
      END IF;
    END LOOP;
  END IF;

  -- P118: horario explícito en cupos activos también es válido
  IF NOT v_slot_allowed AND EXISTS (
    SELECT 1 FROM public.agenda_slot_capacities c
    WHERE c.organization_id = p_org_id
      AND c.kind = 'biometricos'
      AND c.location_id = p_location_id
      AND c.slot_date = v_booking_date
      AND to_char(c.slot_time, 'HH24:MI') = v_time_label
      AND c.active = true
  ) THEN
    v_slot_allowed := true;
  END IF;

  IF NOT v_slot_allowed THEN
    RAISE EXCEPTION 'agenda_config: horario no permitido'
      USING ERRCODE = '22023';
  END IF;

  IF NOT (v_config ? 'locations')
     OR jsonb_typeof(v_config->'locations') <> 'object'
     OR v_config->'locations' = '{}'::JSONB THEN
    RAISE EXCEPTION 'agenda_config: sedes no configuradas'
      USING ERRCODE = '22023';
  END IF;

  IF NOT (v_config->'locations' ? p_location_id) THEN
    RAISE EXCEPTION 'agenda_config: sede no permitida'
      USING ERRCODE = '22023';
  END IF;

  v_location_cfg := v_config->'locations'->p_location_id;
  IF COALESCE((v_location_cfg->>'enabled')::BOOLEAN, true) IS NOT TRUE THEN
    RAISE EXCEPTION 'agenda_config: sede deshabilitada'
      USING ERRCODE = '22023';
  END IF;

  -- P124: solo excepción por fecha o capacity_by_time[hora] (sin capacity_per_slot)
  v_recurrent := public.agenda_location_explicit_capacity(v_location_cfg, v_time_label);

  -- P125: lock compartido org+kind+sede+hora + lock de slot (fecha)
  PERFORM public.agenda_advisory_lock_slot_capacity(
    p_org_id, 'biometricos'::public.booking_kind, p_location_id, v_booking_date, v_booking_time
  );

  -- P126: capacity_by_time=0 es cierre explícito (sin fallback)
  SELECT * INTO v_resolved
  FROM public.agenda_resolve_slot_capacity(
    p_org_id, 'biometricos'::public.booking_kind,
    v_booking_date, v_booking_time, p_location_id,
    CASE WHEN v_recurrent IS NULL THEN 1 ELSE GREATEST(0, v_recurrent) END
  );

  IF v_resolved.active IS NOT TRUE THEN
    RAISE EXCEPTION 'agenda_config: horario desactivado'
      USING ERRCODE = '22023';
  END IF;

  IF v_resolved.from_override THEN
    v_capacity := GREATEST(1, v_resolved.capacity);
  ELSIF v_recurrent IS NOT NULL THEN
    v_capacity := GREATEST(0, v_recurrent);
  ELSE
    RAISE EXCEPTION 'agenda_config: cupo no configurado para horario'
      USING ERRCODE = '22023';
  END IF;

  IF v_capacity < 1 THEN
    RAISE EXCEPTION 'agenda_config: cupo agotado'
      USING ERRCODE = '22023';
  END IF;

  v_booked_count := public.agenda_count_slot_booked(
    p_org_id, 'biometricos'::public.booking_kind,
    v_booking_date, v_booking_time, p_location_id
  );

  IF v_booked_count >= v_capacity THEN
    RAISE EXCEPTION 'agenda_config: cupo agotado'
      USING ERRCODE = '22023';
  END IF;

  PERFORM public.agenda_sheet_inventory_gate_after_config_assert(
    p_org_id,
    'biometricos',
    v_booking_date,
    v_booking_time,
    p_location_id,
    v_capacity,
    v_booked_count
  );

  RETURN jsonb_build_object(
    'agenda_config_applied', true,
    'timezone', v_tz,
    'booking_date', v_booking_date,
    'booking_time', v_booking_time,
    'location_id', p_location_id,
    'capacity_per_slot', v_capacity,
    'booked_count_before', v_booked_count,
    'capacity_from_override', v_resolved.from_override
  );
END;
$function$;
CREATE OR REPLACE FUNCTION public.agenda_firmas_assert_slot_available(
  p_org_id uuid,
  p_scheduled_at timestamp with time zone,
  p_location_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_row public.agenda_config%ROWTYPE;
  v_config JSONB;
  v_tz TEXT;
  v_local_ts TIMESTAMP;
  v_booking_date DATE;
  v_booking_time TIME;
  v_time_label TEXT;
  v_min_lead_hours INTEGER;
  v_iso_dow INTEGER;
  v_slot TEXT;
  v_slot_allowed BOOLEAN := false;
  v_location_cfg JSONB;
  v_capacity INTEGER;
  v_booked_count INTEGER;
  v_resolved RECORD;
  v_recurrent INTEGER;
BEGIN
  SELECT ac.*
  INTO v_row
  FROM public.agenda_config ac
  WHERE ac.organization_id = p_org_id
    AND ac.kind = 'firmas';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'agenda_config: configuración firmas no encontrada'
      USING ERRCODE = '22023';
  END IF;

  v_config := public.agenda_firmas_normalize_config(v_row.config);

  IF COALESCE((v_config->>'enabled')::BOOLEAN, true) IS NOT TRUE THEN
    RAISE EXCEPTION 'agenda_config: agenda firmas deshabilitada'
      USING ERRCODE = '22023';
  END IF;

  v_tz := NULLIF(btrim(COALESCE(v_config->>'timezone', '')), '');
  IF v_tz IS NULL THEN
    RAISE EXCEPTION 'agenda_config: timezone no configurado'
      USING ERRCODE = '22023';
  END IF;

  v_local_ts := p_scheduled_at AT TIME ZONE v_tz;
  v_booking_date := v_local_ts::DATE;
  v_booking_time := v_local_ts::TIME;
  v_time_label := to_char(v_local_ts, 'HH24:MI');

  v_min_lead_hours := public.agenda_firmas_min_lead_hours(v_config);
  IF p_scheduled_at < NOW() + (v_min_lead_hours || ' hours')::INTERVAL THEN
    RAISE EXCEPTION 'agenda_config: fecha no cumple anticipación mínima'
      USING ERRCODE = '22023';
  END IF;

  IF NOT (v_config ? 'allowed_weekdays')
     OR jsonb_typeof(v_config->'allowed_weekdays') <> 'array'
     OR jsonb_array_length(v_config->'allowed_weekdays') = 0 THEN
    RAISE EXCEPTION 'agenda_config: días no configurados'
      USING ERRCODE = '22023';
  END IF;

  v_iso_dow := EXTRACT(ISODOW FROM v_local_ts)::INTEGER;
  IF NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_config->'allowed_weekdays') elem
    WHERE (elem #>> '{}')::INTEGER = v_iso_dow
  ) THEN
    RAISE EXCEPTION 'agenda_config: día no permitido'
      USING ERRCODE = '22023';
  END IF;

  IF (v_config ? 'slots')
     AND jsonb_typeof(v_config->'slots') = 'array'
     AND jsonb_array_length(v_config->'slots') > 0 THEN
    FOR v_slot IN
      SELECT jsonb_array_elements_text(v_config->'slots')
    LOOP
      IF v_time_label = v_slot THEN
        v_slot_allowed := true;
        EXIT;
      END IF;
    END LOOP;
  END IF;

  IF NOT v_slot_allowed AND EXISTS (
    SELECT 1 FROM public.agenda_slot_capacities c
    WHERE c.organization_id = p_org_id
      AND c.kind = 'firmas'
      AND c.location_id = p_location_id
      AND c.slot_date = v_booking_date
      AND to_char(c.slot_time, 'HH24:MI') = v_time_label
      AND c.active = true
  ) THEN
    v_slot_allowed := true;
  END IF;

  IF NOT v_slot_allowed THEN
    RAISE EXCEPTION 'agenda_config: horario no permitido'
      USING ERRCODE = '22023';
  END IF;

  IF NOT (v_config ? 'locations')
     OR jsonb_typeof(v_config->'locations') <> 'object'
     OR v_config->'locations' = '{}'::JSONB THEN
    RAISE EXCEPTION 'agenda_config: sedes no configuradas'
      USING ERRCODE = '22023';
  END IF;

  IF NOT (v_config->'locations' ? p_location_id) THEN
    RAISE EXCEPTION 'agenda_config: sede no permitida'
      USING ERRCODE = '22023';
  END IF;

  v_location_cfg := v_config->'locations'->p_location_id;
  IF COALESCE((v_location_cfg->>'enabled')::BOOLEAN, true) IS NOT TRUE THEN
    RAISE EXCEPTION 'agenda_config: sede deshabilitada'
      USING ERRCODE = '22023';
  END IF;

  -- P124: solo excepción por fecha o capacity_by_time[hora] (sin capacity_per_slot)
  v_recurrent := public.agenda_location_explicit_capacity(v_location_cfg, v_time_label);

  -- P125: lock compartido org+kind+sede+hora + lock de slot (fecha)
  PERFORM public.agenda_advisory_lock_slot_capacity(
    p_org_id, 'firmas'::public.booking_kind, p_location_id, v_booking_date, v_booking_time
  );

  -- P126: capacity_by_time=0 es cierre explícito (sin fallback)
  SELECT * INTO v_resolved
  FROM public.agenda_resolve_slot_capacity(
    p_org_id, 'firmas'::public.booking_kind,
    v_booking_date, v_booking_time, p_location_id,
    CASE WHEN v_recurrent IS NULL THEN 1 ELSE GREATEST(0, v_recurrent) END
  );

  IF v_resolved.active IS NOT TRUE THEN
    RAISE EXCEPTION 'agenda_config: horario desactivado'
      USING ERRCODE = '22023';
  END IF;

  IF v_resolved.from_override THEN
    v_capacity := GREATEST(1, v_resolved.capacity);
  ELSIF v_recurrent IS NOT NULL THEN
    v_capacity := GREATEST(0, v_recurrent);
  ELSE
    RAISE EXCEPTION 'agenda_config: cupo no configurado para horario'
      USING ERRCODE = '22023';
  END IF;

  IF v_capacity < 1 THEN
    RAISE EXCEPTION 'agenda_config: cupo firmas agotado'
      USING ERRCODE = '22023';
  END IF;

  v_booked_count := public.agenda_count_slot_booked(
    p_org_id, 'firmas'::public.booking_kind,
    v_booking_date, v_booking_time, p_location_id
  );

  IF v_booked_count >= v_capacity THEN
    RAISE EXCEPTION 'agenda_config: cupo firmas agotado'
      USING ERRCODE = '22023';
  END IF;

  PERFORM public.agenda_sheet_inventory_gate_after_config_assert(
    p_org_id,
    'firmas',
    v_booking_date,
    v_booking_time,
    p_location_id,
    v_capacity,
    v_booked_count
  );

  RETURN jsonb_build_object(
    'agenda_config_applied', true,
    'timezone', v_tz,
    'booking_date', v_booking_date,
    'booking_time', v_booking_time,
    'location_id', p_location_id,
    'capacity_per_slot', v_capacity,
    'booked_count_before', v_booked_count,
    'capacity_from_override', v_resolved.from_override
  );
END;
$function$;
COMMENT ON FUNCTION public.agenda_biometricos_assert_slot_available(uuid, timestamptz, text) IS
  'Assert cupo biométricos + gate inventario Sheet (mig. 131) si fecha >= 2026-07-30.';
COMMENT ON FUNCTION public.agenda_firmas_assert_slot_available(uuid, timestamptz, text) IS
  'Assert cupo firmas + gate inventario Sheet (mig. 131) si fecha >= 2026-07-30.';
