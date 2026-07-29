-- ConCasa CRM — Integración Google Sheets «CITAS 2026» (agenda bidireccional)
-- Migración 129. No modifica 001–128. No toca P090 / Evidencia / mesa_mover.
-- Supabase = fuente de verdad. Sheets = interfaz + origen autorizado vía Edge/RPC.
-- Cupos CRM siguen siendo (org, kind, date, time, location) + capacity.
-- El ordinal de fila del Sheet vive solo en agenda_sheet_slot_links.

-- =============================================================================
-- Tablas
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.agenda_sheet_slot_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  spreadsheet_id TEXT NOT NULL,
  sheet_id BIGINT NOT NULL,
  sheet_title TEXT NOT NULL,
  sheet_date DATE NOT NULL,
  row_number INTEGER NOT NULL CHECK (row_number > 0),
  location_id TEXT NOT NULL CHECK (location_id IN ('monterrey', 'apodaca')),
  kind public.booking_kind NOT NULL CHECK (kind IN ('biometricos', 'firmas')),
  slot_time TIME NOT NULL,
  slot_ordinal INTEGER NOT NULL CHECK (slot_ordinal > 0),
  booking_id UUID NULL REFERENCES public.agenda_bookings(id),
  sync_status TEXT NOT NULL DEFAULT 'PENDIENTE'
    CHECK (sync_status IN ('SINCRONIZADO', 'PENDIENTE', 'CONFLICTO', 'ERROR', 'CANCELADA')),
  sync_version INTEGER NOT NULL DEFAULT 1 CHECK (sync_version > 0),
  sync_source TEXT NULL,
  last_synced_at TIMESTAMPTZ NULL,
  deleted_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT agenda_sheet_slot_links_row_unique
    UNIQUE (spreadsheet_id, sheet_id, row_number)
);

CREATE UNIQUE INDEX IF NOT EXISTS agenda_sheet_slot_links_active_booking_uidx
  ON public.agenda_sheet_slot_links (booking_id)
  WHERE booking_id IS NOT NULL AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS agenda_sheet_slot_links_slot_ordinal_uidx
  ON public.agenda_sheet_slot_links (
    spreadsheet_id, sheet_id, sheet_date, location_id, kind, slot_time, slot_ordinal
  )
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS agenda_sheet_slot_links_lookup_idx
  ON public.agenda_sheet_slot_links (
    organization_id, sheet_date, location_id, kind, slot_time
  )
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS agenda_sheet_slot_links_set_updated_at ON public.agenda_sheet_slot_links;
CREATE TRIGGER agenda_sheet_slot_links_set_updated_at
  BEFORE UPDATE ON public.agenda_sheet_slot_links
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.agenda_sheet_slot_links IS
  'Mapeo fila Google Sheets ↔ cupo CRM (ordinal de fila; sin reducir capacity). Soft-delete via deleted_at.';

CREATE TABLE IF NOT EXISTS public.agenda_sheet_sync_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  booking_id UUID NOT NULL REFERENCES public.agenda_bookings(id),
  event_type TEXT NOT NULL
    CHECK (event_type IN (
      'booking_created',
      'booking_updated',
      'booking_cancelled',
      'booking_rescheduled'
    )),
  idempotency_key TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'done', 'failed', 'dead')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  last_error TEXT NULL,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT agenda_sheet_sync_outbox_idem_unique UNIQUE (idempotency_key)
);

CREATE INDEX IF NOT EXISTS agenda_sheet_sync_outbox_pending_idx
  ON public.agenda_sheet_sync_outbox (available_at, created_at)
  WHERE status IN ('pending', 'failed');

DROP TRIGGER IF EXISTS agenda_sheet_sync_outbox_set_updated_at ON public.agenda_sheet_sync_outbox;
CREATE TRIGGER agenda_sheet_sync_outbox_set_updated_at
  BEFORE UPDATE ON public.agenda_sheet_sync_outbox
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.agenda_sheet_sync_outbox IS
  'Outbox CRM→Sheets. Fallo Google no revierte booking. Máx 5 intentos con backoff en worker.';

-- =============================================================================
-- RLS (sin acceso directo authenticated/anon; solo service_role / postgres)
-- =============================================================================
ALTER TABLE public.agenda_sheet_slot_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agenda_sheet_sync_outbox ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.agenda_sheet_slot_links FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.agenda_sheet_sync_outbox FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.agenda_sheet_slot_links TO service_role, postgres;
GRANT ALL ON TABLE public.agenda_sheet_sync_outbox TO service_role, postgres;

-- =============================================================================
-- Outbox trigger (solo kind biometricos/firmas; cambios relevantes)
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
    'sync_source', 'crm'
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

DROP TRIGGER IF EXISTS agenda_sheet_outbox_aiud ON public.agenda_bookings;
CREATE TRIGGER agenda_sheet_outbox_aiud
  AFTER INSERT OR UPDATE ON public.agenda_bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.agenda_sheet_outbox_on_booking_change();

REVOKE ALL ON FUNCTION public.agenda_sheet_outbox_on_booking_change() FROM PUBLIC, anon, authenticated;

-- =============================================================================
-- Helpers internos
-- =============================================================================
CREATE OR REPLACE FUNCTION public.agenda_sheet_normalize_nss(p_raw TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v TEXT;
BEGIN
  v := btrim(COALESCE(p_raw, ''));
  v := regexp_replace(v, '^[''`´’]+', '', 'g');
  v := regexp_replace(v, '[\s\-_.]', '', 'g');
  v := regexp_replace(v, '[^0-9]', '', 'g');
  IF v !~ '^[0-9]{11}$' THEN
    RETURN NULL;
  END IF;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION public.agenda_sheet_assert_service_role()
RETURNS VOID
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  IF COALESCE(auth.role(), '') IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'agenda_sheet: solo service_role'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

-- =============================================================================
-- RPC: reserva desde Sheets (NSS) — reutiliza asserts de cupo CRM
-- =============================================================================
CREATE OR REPLACE FUNCTION public.agenda_sheet_book_by_nss(
  p_organization_id UUID,
  p_spreadsheet_id TEXT,
  p_sheet_id BIGINT,
  p_sheet_title TEXT,
  p_sheet_date DATE,
  p_row_number INTEGER,
  p_location_id TEXT,
  p_kind public.booking_kind,
  p_slot_time TIME,
  p_slot_ordinal INTEGER,
  p_nss TEXT,
  p_scheduled_at TIMESTAMPTZ,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nss TEXT;
  v_exp RECORD;
  v_asesor RECORD;
  v_booking_id UUID;
  v_link_id UUID;
  v_agenda_meta JSONB;
  v_existing_link public.agenda_sheet_slot_links%ROWTYPE;
  v_count_exp INTEGER;
  v_etapa SMALLINT;
BEGIN
  PERFORM public.agenda_sheet_assert_service_role();

  IF p_organization_id IS NULL
     OR NULLIF(btrim(COALESCE(p_spreadsheet_id, '')), '') IS NULL
     OR p_sheet_id IS NULL
     OR p_sheet_date IS NULL
     OR p_row_number IS NULL OR p_row_number <= 0
     OR p_slot_ordinal IS NULL OR p_slot_ordinal <= 0
     OR p_scheduled_at IS NULL THEN
    RAISE EXCEPTION 'agenda_sheet_book_by_nss: parámetros incompletos'
      USING ERRCODE = '22023';
  END IF;

  IF p_location_id NOT IN ('monterrey', 'apodaca') THEN
    RAISE EXCEPTION 'agenda_sheet_book_by_nss: sede incompatible'
      USING ERRCODE = '22023';
  END IF;

  IF p_kind NOT IN ('biometricos', 'firmas') THEN
    RAISE EXCEPTION 'agenda_sheet_book_by_nss: tipo incompatible'
      USING ERRCODE = '22023';
  END IF;

  v_nss := public.agenda_sheet_normalize_nss(p_nss);
  IF v_nss IS NULL THEN
    RAISE EXCEPTION 'agenda_sheet_book_by_nss: NSS inválido'
      USING ERRCODE = '22023';
  END IF;

  -- Fila ya vinculada
  SELECT * INTO v_existing_link
  FROM public.agenda_sheet_slot_links l
  WHERE l.spreadsheet_id = btrim(p_spreadsheet_id)
    AND l.sheet_id = p_sheet_id
    AND l.row_number = p_row_number
    AND l.deleted_at IS NULL
  FOR UPDATE;

  IF FOUND AND v_existing_link.booking_id IS NOT NULL THEN
    RAISE EXCEPTION 'agenda_sheet_book_by_nss: Este espacio ya fue reservado en el CRM.'
      USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_count_exp
  FROM public.expedientes e
  WHERE e.organization_id = p_organization_id
    AND e.nss = v_nss
    AND e.deleted_at IS NULL
    AND e.ciclo_estado = 'activo';

  IF v_count_exp = 0 THEN
    RAISE EXCEPTION 'agenda_sheet_book_by_nss: El NSS no corresponde a un expediente disponible para esta cita.'
      USING ERRCODE = 'P0002';
  END IF;
  IF v_count_exp > 1 THEN
    RAISE EXCEPTION 'agenda_sheet_book_by_nss: El NSS no corresponde a un expediente disponible para esta cita.'
      USING ERRCODE = '22023';
  END IF;

  SELECT
    e.id,
    e.organization_id,
    e.asesor_id,
    e.ciclo_estado,
    e.submitted_to_mesa,
    e.etapa_actual,
    e.subestado,
    e.cliente_nombre,
    e.nss
  INTO v_exp
  FROM public.expedientes e
  WHERE e.organization_id = p_organization_id
    AND e.nss = v_nss
    AND e.deleted_at IS NULL
    AND e.ciclo_estado = 'activo'
  FOR UPDATE;

  IF v_exp.submitted_to_mesa IS NOT TRUE THEN
    RAISE EXCEPTION 'agenda_sheet_book_by_nss: El NSS no corresponde a un expediente disponible para esta cita.'
      USING ERRCODE = '22023';
  END IF;

  SELECT p.id, p.full_name, p.email
  INTO v_asesor
  FROM public.profiles p
  WHERE p.id = v_exp.asesor_id;

  IF p_kind = 'biometricos' THEN
    IF v_exp.etapa_actual NOT IN (3, 4, 5) THEN
      RAISE EXCEPTION 'agenda_sheet_book_by_nss: El NSS no corresponde a un expediente disponible para esta cita.'
        USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.agenda_bookings b
      WHERE b.expediente_id = v_exp.id AND b.kind = 'biometricos' AND b.status = 'booked'
    ) OR EXISTS (
      SELECT 1 FROM public.agenda_bookings b
      WHERE b.expediente_id = v_exp.id AND b.kind = 'notificacion' AND b.status = 'booked'
    ) THEN
      RAISE EXCEPTION 'agenda_sheet_book_by_nss: La cita ya existe en otra fila u horario.'
        USING ERRCODE = '22023';
    END IF;
    IF v_exp.etapa_actual = 5 THEN
      IF v_exp.subestado <> 'en_proceso' THEN
        RAISE EXCEPTION 'agenda_sheet_book_by_nss: El NSS no corresponde a un expediente disponible para esta cita.'
          USING ERRCODE = '22023';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM public.agenda_bookings b
        WHERE b.expediente_id = v_exp.id AND b.kind = 'biometricos' AND b.status = 'cancelled'
          AND b.id = (
            SELECT b2.id FROM public.agenda_bookings b2
            WHERE b2.expediente_id = v_exp.id AND b2.kind = 'biometricos'
            ORDER BY b2.created_at DESC LIMIT 1
          )
      ) THEN
        RAISE EXCEPTION 'agenda_sheet_book_by_nss: El NSS no corresponde a un expediente disponible para esta cita.'
          USING ERRCODE = '22023';
      END IF;
    END IF;
    v_agenda_meta := public.agenda_biometricos_assert_slot_available(
      v_exp.organization_id, p_scheduled_at, p_location_id
    );
  ELSE
    IF v_exp.etapa_actual NOT IN (9, 10) OR v_exp.subestado <> 'en_proceso' THEN
      RAISE EXCEPTION 'agenda_sheet_book_by_nss: El NSS no corresponde a un expediente disponible para esta cita.'
        USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.agenda_bookings b
      WHERE b.expediente_id = v_exp.id AND b.kind = 'firmas' AND b.status = 'booked'
    ) THEN
      RAISE EXCEPTION 'agenda_sheet_book_by_nss: La cita ya existe en otra fila u horario.'
        USING ERRCODE = '22023';
    END IF;
    PERFORM public.agenda_firmas_assert_agendable_desde(
      v_exp.id, p_scheduled_at, p_location_id
    );
    v_agenda_meta := public.agenda_firmas_assert_slot_available(
      v_exp.organization_id, p_scheduled_at, p_location_id
    );
  END IF;

  -- Verifica que date/time del assert coincidan con la fila
  IF (v_agenda_meta->>'booking_date')::DATE IS DISTINCT FROM p_sheet_date
     OR (v_agenda_meta->>'booking_time')::TIME IS DISTINCT FROM p_slot_time THEN
    RAISE EXCEPTION 'agenda_sheet_book_by_nss: horario de fila no coincide con slot CRM'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.agenda_bookings (
    organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, note, created_by
  ) VALUES (
    v_exp.organization_id, p_kind, v_exp.id,
    (v_agenda_meta->>'booking_date')::DATE,
    (v_agenda_meta->>'booking_time')::TIME,
    p_location_id, 'booked',
    'origen=google_sheets',
    v_exp.asesor_id
  )
  RETURNING id INTO v_booking_id;

  UPDATE public.expedientes
  SET fecha_cita = p_scheduled_at, updated_at = NOW()
  WHERE id = v_exp.id;

  v_etapa := v_exp.etapa_actual;
  IF p_kind = 'biometricos' AND v_exp.etapa_actual = 3 THEN
    UPDATE public.expedientes
    SET etapa_actual = 4, subestado = 'en_proceso', updated_at = NOW()
    WHERE id = v_exp.id;
    v_etapa := 4;
  END IF;

  INSERT INTO public.agenda_sheet_slot_links (
    organization_id, spreadsheet_id, sheet_id, sheet_title, sheet_date,
    row_number, location_id, kind, slot_time, slot_ordinal,
    booking_id, sync_status, sync_version, sync_source, last_synced_at
  ) VALUES (
    v_exp.organization_id, btrim(p_spreadsheet_id), p_sheet_id,
    COALESCE(NULLIF(btrim(p_sheet_title), ''), p_sheet_date::TEXT),
    p_sheet_date, p_row_number, p_location_id, p_kind, p_slot_time, p_slot_ordinal,
    v_booking_id, 'SINCRONIZADO', 1, 'sheets', NOW()
  )
  ON CONFLICT (spreadsheet_id, sheet_id, row_number) DO UPDATE
  SET
    booking_id = EXCLUDED.booking_id,
    location_id = EXCLUDED.location_id,
    kind = EXCLUDED.kind,
    slot_time = EXCLUDED.slot_time,
    slot_ordinal = EXCLUDED.slot_ordinal,
    sheet_date = EXCLUDED.sheet_date,
    sheet_title = EXCLUDED.sheet_title,
    sync_status = 'SINCRONIZADO',
    sync_source = 'sheets',
    last_synced_at = NOW(),
    sync_version = public.agenda_sheet_slot_links.sync_version + 1,
    deleted_at = NULL,
    updated_at = NOW()
  RETURNING id INTO v_link_id;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_exp.asesor_id,
    'asesor'::public.app_role,
    'agenda.sheet.book',
    'agenda_booking',
    v_booking_id,
    jsonb_build_object(
      'source', 'google_sheets',
      'nss', v_nss,
      'kind', p_kind,
      'location_id', p_location_id,
      'row_number', p_row_number,
      'sheet_id', p_sheet_id,
      'slot_ordinal', p_slot_ordinal,
      'link_id', v_link_id,
      'idempotency_key', p_idempotency_key,
      'etapa_actual', v_etapa
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'booking_id', v_booking_id,
    'link_id', v_link_id,
    'expediente_id', v_exp.id,
    'nss', v_nss,
    'cliente_nombre', v_exp.cliente_nombre,
    'asesor_id', v_exp.asesor_id,
    'asesor_nombre', COALESCE(v_asesor.full_name, v_asesor.email, ''),
    'kind', p_kind,
    'location_id', p_location_id,
    'booking_date', (v_agenda_meta->>'booking_date'),
    'booking_time', to_char((v_agenda_meta->>'booking_time')::TIME, 'HH24:MI'),
    'slot_ordinal', p_slot_ordinal,
    'sync_status', 'SINCRONIZADO',
    'etapa_actual', v_etapa
  );
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'agenda_sheet_book_by_nss: Este espacio ya fue reservado en el CRM.'
      USING ERRCODE = '22023';
END;
$$;

COMMENT ON FUNCTION public.agenda_sheet_book_by_nss IS
  'Reserva desde Sheets vía Edge: asserts CRM + booking + mapping atómico. Solo service_role.';

REVOKE ALL ON FUNCTION public.agenda_sheet_book_by_nss(
  UUID, TEXT, BIGINT, TEXT, DATE, INTEGER, TEXT, public.booking_kind, TIME, INTEGER, TEXT, TIMESTAMPTZ, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_sheet_book_by_nss(
  UUID, TEXT, BIGINT, TEXT, DATE, INTEGER, TEXT, public.booking_kind, TIME, INTEGER, TEXT, TIMESTAMPTZ, TEXT
) TO service_role, postgres;

-- =============================================================================
-- RPC: claim outbox + mark result (worker)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.agenda_sheet_claim_outbox(p_limit INTEGER DEFAULT 10)
RETURNS SETOF public.agenda_sheet_sync_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.agenda_sheet_assert_service_role();
  RETURN QUERY
  WITH cte AS (
    SELECT o.id
    FROM public.agenda_sheet_sync_outbox o
    WHERE o.status IN ('pending', 'failed')
      AND o.attempts < o.max_attempts
      AND o.available_at <= NOW()
    ORDER BY o.available_at ASC, o.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 10), 50))
  )
  UPDATE public.agenda_sheet_sync_outbox o
  SET status = 'processing',
      attempts = o.attempts + 1,
      updated_at = NOW()
  FROM cte
  WHERE o.id = cte.id
  RETURNING o.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.agenda_sheet_mark_outbox(
  p_id UUID,
  p_status TEXT,
  p_error TEXT DEFAULT NULL,
  p_backoff_seconds INTEGER DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempts INTEGER;
  v_max INTEGER;
  v_backoff INTEGER;
  v_final TEXT;
BEGIN
  PERFORM public.agenda_sheet_assert_service_role();
  IF p_status NOT IN ('done', 'failed', 'dead', 'pending') THEN
    RAISE EXCEPTION 'agenda_sheet_mark_outbox: status inválido'
      USING ERRCODE = '22023';
  END IF;

  SELECT attempts, max_attempts INTO v_attempts, v_max
  FROM public.agenda_sheet_sync_outbox
  WHERE id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_backoff := COALESCE(
    p_backoff_seconds,
    LEAST(3600, 30 * (2 ^ GREATEST(0, COALESCE(v_attempts, 1) - 1)))::INTEGER
  );

  v_final := p_status;
  IF p_status = 'failed' AND COALESCE(v_attempts, 0) >= COALESCE(v_max, 5) THEN
    v_final := 'dead';
  END IF;

  UPDATE public.agenda_sheet_sync_outbox
  SET
    status = v_final,
    last_error = CASE WHEN v_final = 'done' THEN NULL ELSE left(COALESCE(p_error, ''), 500) END,
    processed_at = CASE WHEN v_final = 'done' THEN NOW() ELSE processed_at END,
    available_at = CASE
      WHEN v_final IN ('failed', 'pending') THEN NOW() + make_interval(secs => v_backoff)
      ELSE available_at
    END,
    updated_at = NOW()
  WHERE id = p_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.agenda_sheet_upsert_link_from_crm(
  p_organization_id UUID,
  p_spreadsheet_id TEXT,
  p_sheet_id BIGINT,
  p_sheet_title TEXT,
  p_sheet_date DATE,
  p_row_number INTEGER,
  p_location_id TEXT,
  p_kind public.booking_kind,
  p_slot_time TIME,
  p_slot_ordinal INTEGER,
  p_booking_id UUID,
  p_sync_status TEXT DEFAULT 'SINCRONIZADO'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  PERFORM public.agenda_sheet_assert_service_role();
  INSERT INTO public.agenda_sheet_slot_links (
    organization_id, spreadsheet_id, sheet_id, sheet_title, sheet_date,
    row_number, location_id, kind, slot_time, slot_ordinal,
    booking_id, sync_status, sync_source, last_synced_at
  ) VALUES (
    p_organization_id, btrim(p_spreadsheet_id), p_sheet_id, p_sheet_title, p_sheet_date,
    p_row_number, p_location_id, p_kind, p_slot_time, p_slot_ordinal,
    p_booking_id, COALESCE(p_sync_status, 'SINCRONIZADO'), 'crm', NOW()
  )
  ON CONFLICT (spreadsheet_id, sheet_id, row_number) DO UPDATE
  SET
    booking_id = EXCLUDED.booking_id,
    sync_status = EXCLUDED.sync_status,
    sync_source = 'crm',
    last_synced_at = NOW(),
    sync_version = public.agenda_sheet_slot_links.sync_version + 1,
    deleted_at = NULL,
    updated_at = NOW()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.agenda_sheet_claim_outbox(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_sheet_claim_outbox(INTEGER) TO service_role, postgres;

REVOKE ALL ON FUNCTION public.agenda_sheet_mark_outbox(UUID, TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_sheet_mark_outbox(UUID, TEXT, TEXT, INTEGER) TO service_role, postgres;

REVOKE ALL ON FUNCTION public.agenda_sheet_upsert_link_from_crm(
  UUID, TEXT, BIGINT, TEXT, DATE, INTEGER, TEXT, public.booking_kind, TIME, INTEGER, UUID, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_sheet_upsert_link_from_crm(
  UUID, TEXT, BIGINT, TEXT, DATE, INTEGER, TEXT, public.booking_kind, TIME, INTEGER, UUID, TEXT
) TO service_role, postgres;

REVOKE ALL ON FUNCTION public.agenda_sheet_normalize_nss(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.agenda_sheet_normalize_nss(TEXT) TO service_role, postgres;

REVOKE ALL ON FUNCTION public.agenda_sheet_assert_service_role() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_sheet_assert_service_role() TO service_role, postgres;
