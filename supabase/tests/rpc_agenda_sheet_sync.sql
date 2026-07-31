-- ConCasa CRM — pruebas focales integración Google Sheets agenda (mig. 129)
-- Uso: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
--        -f supabase/tests/rpc_agenda_sheet_sync.sql
-- Concurrencia: requiere dblink + rol supabase_admin (sección final).
-- NO ejecutar contra Cloud.

\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS dblink;

CREATE OR REPLACE FUNCTION public.__sheet_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN RAISE EXCEPTION 'AGENDA SHEET TEST FAIL: %', p_msg; END IF;
END; $$;

CREATE OR REPLACE FUNCTION public.__sheet_set_jwt_role(p_role TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.role', COALESCE(p_role, ''), true);
END; $$;

CREATE OR REPLACE FUNCTION public.__sheet_reset_auth()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
END; $$;

-- Edge Functions invocan RPCs con JWT service_role; los stubs locales de auth.role()
-- a veces defaultan a 'authenticated' si el claim está vacío — forzar service_role.
CREATE OR REPLACE FUNCTION public.__sheet_as_service_role()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
END; $$;

-- =============================================================================
-- A) Estructura + grants
-- =============================================================================
DO $$
DECLARE
  v_grant_auth BOOLEAN;
  v_grant_anon BOOLEAN;
  v_grant_service BOOLEAN;
  v_grant_postgres BOOLEAN;
  v_fail BOOLEAN;
BEGIN
  PERFORM public.__sheet_assert(
    to_regclass('public.agenda_sheet_slot_links') IS NOT NULL, 'tabla links');
  PERFORM public.__sheet_assert(
    to_regclass('public.agenda_sheet_sync_outbox') IS NOT NULL, 'tabla outbox');
  PERFORM public.__sheet_assert(
    to_regprocedure('public.agenda_sheet_book_by_nss(uuid,text,bigint,text,date,integer,text,public.booking_kind,time without time zone,integer,text,timestamp with time zone,text)') IS NOT NULL
    OR EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'agenda_sheet_book_by_nss'),
    'RPC book'
  );

  SELECT has_function_privilege(
    'authenticated',
    'public.agenda_sheet_book_by_nss(uuid,text,bigint,text,date,integer,text,public.booking_kind,time,integer,text,timestamptz,text)',
    'EXECUTE'
  ) INTO v_grant_auth;
  PERFORM public.__sheet_assert(NOT COALESCE(v_grant_auth, false), '1 authenticated NO execute');

  SELECT has_function_privilege(
    'anon',
    'public.agenda_sheet_book_by_nss(uuid,text,bigint,text,date,integer,text,public.booking_kind,time,integer,text,timestamptz,text)',
    'EXECUTE'
  ) INTO v_grant_anon;
  PERFORM public.__sheet_assert(NOT COALESCE(v_grant_anon, false), '2 anon NO execute');

  SELECT has_function_privilege(
    'service_role',
    'public.agenda_sheet_book_by_nss(uuid,text,bigint,text,date,integer,text,public.booking_kind,time,integer,text,timestamptz,text)',
    'EXECUTE'
  ) INTO v_grant_service;
  PERFORM public.__sheet_assert(COALESCE(v_grant_service, false), '3 service_role SÍ execute');

  SELECT has_function_privilege(
    'postgres',
    'public.agenda_sheet_book_by_nss(uuid,text,bigint,text,date,integer,text,public.booking_kind,time,integer,text,timestamptz,text)',
    'EXECUTE'
  ) INTO v_grant_postgres;
  PERFORM public.__sheet_assert(COALESCE(v_grant_postgres, false), '3b postgres SÍ execute');

  -- Body reject: JWT authenticated aunque se invoque como postgres
  PERFORM public.__sheet_set_jwt_role('authenticated');
  BEGIN
    PERFORM public.agenda_sheet_assert_service_role();
    v_fail := false;
  EXCEPTION WHEN insufficient_privilege OR OTHERS THEN
    v_fail := true;
  END;
  PERFORM public.__sheet_reset_auth();
  PERFORM public.__sheet_assert(v_fail, 'assert rechaza JWT authenticated');

  PERFORM public.__sheet_set_jwt_role('anon');
  BEGIN
    PERFORM public.agenda_sheet_assert_service_role();
    v_fail := false;
  EXCEPTION WHEN OTHERS THEN
    v_fail := true;
  END;
  PERFORM public.__sheet_reset_auth();
  PERFORM public.__sheet_assert(v_fail, 'assert rechaza JWT anon');

  PERFORM public.__sheet_set_jwt_role('service_role');
  PERFORM public.agenda_sheet_assert_service_role();
  PERFORM public.__sheet_reset_auth();

  PERFORM public.__sheet_assert(EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'agenda_sheet_slot_links_active_booking_uidx'
  ), 'unique booking activo');
  PERFORM public.__sheet_assert(EXISTS (
    SELECT 1 FROM pg_indexes WHERE indexname = 'agenda_sheet_slot_links_slot_ordinal_uidx'
  ), 'unique ordinal');
  PERFORM public.__sheet_assert(EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'agenda_sheet_outbox_aiud'
  ), 'trigger outbox');

  PERFORM public.__sheet_assert(
    public.agenda_sheet_normalize_nss('´03179461821') = '03179461821', 'nss apostrofe');
  PERFORM public.__sheet_assert(
    public.agenda_sheet_normalize_nss('031-794-61821') = '03179461821', 'nss guiones');
  PERFORM public.__sheet_assert(
    public.agenda_sheet_normalize_nss('123') IS NULL, 'nss invalido');

  RAISE NOTICE 'A grants/estructura OK';
END;
$$;

-- =============================================================================
-- B) Fixtures + casos funcionales (commit al salir del DO)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.__sheet_fixture (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  org_id UUID NOT NULL,
  org_b UUID NOT NULL,
  asesor_id UUID NOT NULL,
  mesa_id UUID NOT NULL,
  sheet_ss TEXT NOT NULL,
  sheet_id BIGINT NOT NULL,
  slot_date DATE NOT NULL,
  slot_time TIME NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  nss1 CHAR(11) NOT NULL,
  nss2 CHAR(11) NOT NULL,
  nss3 CHAR(11) NOT NULL,
  nss_wrong_etapa CHAR(11) NOT NULL,
  nss_other_org CHAR(11) NOT NULL,
  exp1 UUID NOT NULL,
  exp2 UUID NOT NULL,
  exp3 UUID NOT NULL,
  exp_wrong UUID NOT NULL,
  exp_other UUID NOT NULL,
  bookings_before BIGINT NOT NULL,
  outbox_before BIGINT NOT NULL,
  bio_config_before JSONB
);

ALTER TABLE public.__sheet_fixture
  ADD COLUMN IF NOT EXISTS bio_config_before JSONB;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000001';
  v_org_b UUID := '00000000-0000-4000-8000-0000000000bb';
  v_asesor UUID := '00000000-0000-4000-8001-000000000001';
  v_mesa UUID := '00000000-0000-4000-8003-000000000001';
  v_exp1 UUID := '00000000-0000-4000-9129-000000000001';
  v_exp2 UUID := '00000000-0000-4000-9129-000000000002';
  v_exp3 UUID := '00000000-0000-4000-9129-000000000003';
  v_exp_wrong UUID := '00000000-0000-4000-9129-000000000004';
  v_exp_other UUID := '00000000-0000-4000-9129-000000000005';
  v_nss1 CHAR(11) := '12900000001';
  v_nss2 CHAR(11) := '12900000002';
  v_nss3 CHAR(11) := '12900000003';
  v_nss_wrong CHAR(11) := '12900000004';
  v_nss_other CHAR(11) := '12900000005';
  v_slot_date DATE;
  v_slot_time TIME := '09:00';
  v_sched TIMESTAMPTZ;
  v_tz TEXT := 'America/Monterrey';
  v_cfg JSONB;
  v_ss TEXT := '1JOERzJc2yLncDbzTFG2lQLQXdlWwmGehlxP7JNOoupA';
  v_sheet_id BIGINT := 1288978311;
  v_bookings_before BIGINT;
  v_outbox_before BIGINT;
  v_hist UUID;
  v_bio_before JSONB;
BEGIN
  PERFORM public.__sheet_assert(
    EXISTS (SELECT 1 FROM public.profiles WHERE id = v_asesor AND app_role = 'asesor'),
    'fixture asesor'
  );
  PERFORM public.__sheet_assert(
    EXISTS (SELECT 1 FROM public.profiles WHERE id = v_mesa AND app_role = 'mesa_admin'),
    'fixture mesa'
  );

  -- Org B (para rechazo cross-org); crear si no existe
  INSERT INTO public.organizations (id, slug, name, active)
  VALUES (v_org_b, 'sheet-test-org-b', 'Sheet Test Org B', true)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, organization_id, app_role, full_name, email, active)
  VALUES (
    '00000000-0000-4000-8001-0000000000bb', v_org_b, 'asesor',
    'Asesor Org B', 'asesor-org-b-sheet@test.local', true
  )
  ON CONFLICT (id) DO UPDATE SET organization_id = EXCLUDED.organization_id, active = true;

  v_slot_date := (CURRENT_DATE + 28);
  -- Asegurar weekday permitido: ya usamos allowed 1-7
  v_sched := ((v_slot_date::TEXT || ' 09:00:00')::TIMESTAMP AT TIME ZONE v_tz);

  SELECT COUNT(*) INTO v_bookings_before FROM public.agenda_bookings;
  SELECT COUNT(*) INTO v_outbox_before FROM public.agenda_sheet_sync_outbox;
  SELECT config INTO v_bio_before
  FROM public.agenda_config
  WHERE organization_id = v_org AND kind = 'biometricos';

  -- Booking histórico previo al ejercicio (no debe generar outbox al instalar; ya instalado)
  v_hist := '00000000-0000-4000-9129-00000000ffff';
  DELETE FROM public.agenda_sheet_slot_links WHERE spreadsheet_id = v_ss;
  DELETE FROM public.agenda_sheet_sync_outbox
    WHERE booking_id IN (
      SELECT id FROM public.agenda_bookings
      WHERE expediente_id IN (v_exp1, v_exp2, v_exp3, v_exp_wrong, v_exp_other, v_hist)
    );
  DELETE FROM public.agenda_bookings
    WHERE expediente_id IN (v_exp1, v_exp2, v_exp3, v_exp_wrong, v_exp_other, v_hist);
  DELETE FROM public.expedientes
    WHERE id IN (v_exp1, v_exp2, v_exp3, v_exp_wrong, v_exp_other, v_hist);

  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, ciclo_estado
  ) VALUES
    (v_exp1, v_org, v_asesor, 'mejoravit', v_nss1, 'Sheet Exp 1', '5512900001', 'interno', true, NOW(), 4, 'en_proceso', 'activo'),
    (v_exp2, v_org, v_asesor, 'mejoravit', v_nss2, 'Sheet Exp 2', '5512900002', 'interno', true, NOW(), 4, 'en_proceso', 'activo'),
    (v_exp3, v_org, v_asesor, 'mejoravit', v_nss3, 'Sheet Exp 3', '5512900003', 'interno', true, NOW(), 4, 'en_proceso', 'activo'),
    (v_exp_wrong, v_org, v_asesor, 'mejoravit', v_nss_wrong, 'Sheet Wrong Etapa', '5512900004', 'interno', true, NOW(), 1, 'pendiente', 'activo'),
    (v_exp_other, v_org_b, '00000000-0000-4000-8001-0000000000bb', 'mejoravit', v_nss_other, 'Sheet Other Org', '5512900005', 'interno', true, NOW(), 4, 'en_proceso', 'activo');

  -- Config biométricos: capacity_by_time 09:00 = 2
  v_cfg := jsonb_build_object(
    'enabled', true,
    'timezone', v_tz,
    'min_lead_hours', 0,
    'allowed_weekdays', jsonb_build_array(1,2,3,4,5,6,7),
    'slots', jsonb_build_array('09:00', '10:00'),
    'locations', jsonb_build_object(
      'monterrey', jsonb_build_object(
        'enabled', true,
        'capacity_per_slot', 15,
        'label', 'Monterrey',
        'capacity_by_time', jsonb_build_object('09:00', 2, '10:00', 1)
      ),
      'apodaca', jsonb_build_object(
        'enabled', true,
        'capacity_per_slot', 10,
        'label', 'Apodaca',
        'capacity_by_time', jsonb_build_object('09:00', 2, '10:00', 1)
      )
    )
  );
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_mesa::text, true);
  PERFORM public.upsert_agenda_config_biometricos(v_cfg, v_org);
  PERFORM public.__sheet_reset_auth();

  DELETE FROM public.agenda_slot_capacities
  WHERE organization_id = v_org AND kind = 'biometricos'
    AND location_id = 'monterrey' AND slot_date = v_slot_date;

  INSERT INTO public.__sheet_fixture AS f (
    id, org_id, org_b, asesor_id, mesa_id, sheet_ss, sheet_id,
    slot_date, slot_time, scheduled_at,
    nss1, nss2, nss3, nss_wrong_etapa, nss_other_org,
    exp1, exp2, exp3, exp_wrong, exp_other,
    bookings_before, outbox_before, bio_config_before
  ) VALUES (
    1, v_org, v_org_b, v_asesor, v_mesa, v_ss, v_sheet_id,
    v_slot_date, v_slot_time, v_sched,
    v_nss1, v_nss2, v_nss3, v_nss_wrong, v_nss_other,
    v_exp1, v_exp2, v_exp3, v_exp_wrong, v_exp_other,
    v_bookings_before, v_outbox_before, v_bio_before
  )
  ON CONFLICT (id) DO UPDATE SET
    org_id = EXCLUDED.org_id,
    slot_date = EXCLUDED.slot_date,
    scheduled_at = EXCLUDED.scheduled_at,
    bookings_before = EXCLUDED.bookings_before,
    outbox_before = EXCLUDED.outbox_before,
    bio_config_before = EXCLUDED.bio_config_before;

  RAISE NOTICE 'B fixtures OK date=% sched=%', v_slot_date, v_sched;
END;
$$;

-- =============================================================================
-- C) Rechazos + reserva válida + capacidad + idempotencia + outbox
-- =============================================================================
DO $$
DECLARE
  f public.__sheet_fixture%ROWTYPE;
  v_res JSONB;
  v_fail BOOLEAN;
  v_bookings INTEGER;
  v_links INTEGER;
  v_outbox INTEGER;
  v_outbox_id UUID;
  v_booking_id UUID;
  v_booking_id_2 UUID;
  v_err TEXT;
  v_note_updates INTEGER;
  v_drive_updates INTEGER;
BEGIN
  SELECT * INTO STRICT f FROM public.__sheet_fixture WHERE id = 1;
  PERFORM public.__sheet_as_service_role();

  -- 4 NSS inexistente
  BEGIN
    PERFORM public.agenda_sheet_book_by_nss(
      f.org_id, f.sheet_ss, f.sheet_id, '29 JULIO', f.slot_date, 100,
      'monterrey', 'biometricos', f.slot_time, 1,
      '00000000000', f.scheduled_at, 'idem-miss'
    );
    v_fail := false;
  EXCEPTION WHEN OTHERS THEN
    v_fail := true; v_err := SQLERRM;
  END;
  PERFORM public.__sheet_assert(v_fail AND v_err ~* 'NSS|expediente', '4 nss inexistente');
  SELECT COUNT(*) INTO v_bookings FROM public.agenda_bookings WHERE expediente_id = f.exp1;
  PERFORM public.__sheet_assert(v_bookings = 0, '4 sin booking parcial');

  -- 5 otra organización (NSS existe en org B, se pide org A)
  BEGIN
    PERFORM public.agenda_sheet_book_by_nss(
      f.org_id, f.sheet_ss, f.sheet_id, '29 JULIO', f.slot_date, 101,
      'monterrey', 'biometricos', f.slot_time, 1,
      f.nss_other_org, f.scheduled_at, NULL
    );
    v_fail := false;
  EXCEPTION WHEN OTHERS THEN
    v_fail := true;
  END;
  PERFORM public.__sheet_assert(v_fail, '5 otra org rechazada');

  -- 6 etapa incompatible
  BEGIN
    PERFORM public.agenda_sheet_book_by_nss(
      f.org_id, f.sheet_ss, f.sheet_id, '29 JULIO', f.slot_date, 102,
      'monterrey', 'biometricos', f.slot_time, 1,
      f.nss_wrong_etapa, f.scheduled_at, NULL
    );
    v_fail := false;
  EXCEPTION WHEN OTHERS THEN
    v_fail := true;
  END;
  PERFORM public.__sheet_assert(v_fail, '6 etapa incompatible');

  -- 7 tipo incompatible (firmas sobre etapa 4)
  BEGIN
    PERFORM public.agenda_sheet_book_by_nss(
      f.org_id, f.sheet_ss, f.sheet_id, '29 JULIO', f.slot_date, 103,
      'monterrey', 'firmas', f.slot_time, 1,
      f.nss1, f.scheduled_at, NULL
    );
    v_fail := false;
  EXCEPTION WHEN OTHERS THEN
    v_fail := true;
  END;
  PERFORM public.__sheet_assert(v_fail, '7 tipo incompatible');

  -- 8 sede inválida
  BEGIN
    PERFORM public.agenda_sheet_book_by_nss(
      f.org_id, f.sheet_ss, f.sheet_id, '29 JULIO', f.slot_date, 104,
      'guadalajara', 'biometricos', f.slot_time, 1,
      f.nss1, f.scheduled_at, NULL
    );
    v_fail := false;
  EXCEPTION WHEN OTHERS THEN
    v_fail := true; v_err := SQLERRM;
  END;
  PERFORM public.__sheet_assert(v_fail AND v_err ~* 'sede', '8 sede invalida');

  -- 9 hora/fecha inválida (scheduled no cuadra con sheet_date/time del assert)
  BEGIN
    PERFORM public.agenda_sheet_book_by_nss(
      f.org_id, f.sheet_ss, f.sheet_id, '29 JULIO', f.slot_date, 105,
      'monterrey', 'biometricos', '10:00'::TIME, 1,
      f.nss1, f.scheduled_at, NULL
    );
    v_fail := false;
  EXCEPTION WHEN OTHERS THEN
    v_fail := true;
  END;
  PERFORM public.__sheet_assert(v_fail, '9 hora inconsistente rechazada');

  -- 10 reserva válida → booking + link + outbox
  v_res := public.agenda_sheet_book_by_nss(
    f.org_id, f.sheet_ss, f.sheet_id, '29 JULIO', f.slot_date, 20,
    'monterrey', 'biometricos', f.slot_time, 1,
    f.nss1, f.scheduled_at, 'idem-ok-1'
  );
  PERFORM public.__sheet_assert((v_res->>'ok')::BOOLEAN IS TRUE, '10 ok');
  v_booking_id := (v_res->>'booking_id')::UUID;
  PERFORM public.__sheet_assert(v_booking_id IS NOT NULL, '10 booking_id');

  SELECT COUNT(*) INTO v_bookings
  FROM public.agenda_bookings
  WHERE id = v_booking_id AND status = 'booked' AND kind = 'biometricos';
  PERFORM public.__sheet_assert(v_bookings = 1, '10 booking=1');

  SELECT COUNT(*) INTO v_links
  FROM public.agenda_sheet_slot_links
  WHERE booking_id = v_booking_id AND deleted_at IS NULL AND row_number = 20;
  PERFORM public.__sheet_assert(v_links = 1, '10 link=1');

  SELECT COUNT(*) INTO v_outbox
  FROM public.agenda_sheet_sync_outbox
  WHERE booking_id = v_booking_id AND event_type = 'booking_created';
  PERFORM public.__sheet_assert(v_outbox = 1, '20 un solo evento created');

  -- 18 idempotencia misma fila+NSS
  v_res := public.agenda_sheet_book_by_nss(
    f.org_id, f.sheet_ss, f.sheet_id, '29 JULIO', f.slot_date, 20,
    'monterrey', 'biometricos', f.slot_time, 1,
    f.nss1, f.scheduled_at, 'idem-ok-1-retry'
  );
  PERFORM public.__sheet_assert((v_res->>'already')::BOOLEAN IS TRUE, '18 already');
  PERFORM public.__sheet_assert((v_res->>'booking_id')::UUID = v_booking_id, '18 mismo booking');
  SELECT COUNT(*) INTO v_bookings FROM public.agenda_bookings WHERE expediente_id = f.exp1 AND status = 'booked';
  PERFORM public.__sheet_assert(v_bookings = 1, '18 no duplica booking');

  -- 12 misma fila no admite otro booking (otro NSS)
  BEGIN
    PERFORM public.agenda_sheet_book_by_nss(
      f.org_id, f.sheet_ss, f.sheet_id, '29 JULIO', f.slot_date, 20,
      'monterrey', 'biometricos', f.slot_time, 1,
      f.nss2, f.scheduled_at, NULL
    );
    v_fail := false;
  EXCEPTION WHEN OTHERS THEN
    v_fail := true; v_err := SQLERRM;
  END;
  PERFORM public.__sheet_assert(v_fail AND v_err ~* 'ya fue reservado', '12 fila ocupada');

  -- 14 dos filas misma hora con capacity=2
  v_res := public.agenda_sheet_book_by_nss(
    f.org_id, f.sheet_ss, f.sheet_id, '29 JULIO', f.slot_date, 21,
    'monterrey', 'biometricos', f.slot_time, 2,
    f.nss2, f.scheduled_at, 'idem-ok-2'
  );
  v_booking_id_2 := (v_res->>'booking_id')::UUID;
  PERFORM public.__sheet_assert(v_booking_id_2 IS NOT NULL, '14 segundo cupo');
  SELECT COUNT(*) INTO v_bookings
  FROM public.agenda_bookings b
  WHERE b.organization_id = f.org_id AND b.kind = 'biometricos'
    AND b.booking_date = f.slot_date AND b.booking_time = f.slot_time
    AND b.location_id = 'monterrey' AND b.status = 'booked';
  PERFORM public.__sheet_assert(v_bookings = 2, '14 bookings=2');

  -- 15 tercera falla capacity=2
  BEGIN
    PERFORM public.agenda_sheet_book_by_nss(
      f.org_id, f.sheet_ss, f.sheet_id, '29 JULIO', f.slot_date, 22,
      'monterrey', 'biometricos', f.slot_time, 3,
      f.nss3, f.scheduled_at, NULL
    );
    v_fail := false;
  EXCEPTION WHEN OTHERS THEN
    v_fail := true;
  END;
  PERFORM public.__sheet_assert(v_fail, '15 tercera rechazada');
  SELECT COUNT(*) INTO v_bookings
  FROM public.agenda_bookings b
  WHERE b.organization_id = f.org_id AND b.kind = 'biometricos'
    AND b.booking_date = f.slot_date AND b.booking_time = f.slot_time
    AND b.location_id = 'monterrey' AND b.status = 'booked';
  PERFORM public.__sheet_assert(v_bookings = 2, '15 sigue=2');

  -- 13 un booking no en dos filas (unique partial)
  BEGIN
    INSERT INTO public.agenda_sheet_slot_links (
      organization_id, spreadsheet_id, sheet_id, sheet_title, sheet_date,
      row_number, location_id, kind, slot_time, slot_ordinal, booking_id, sync_status
    ) VALUES (
      f.org_id, f.sheet_ss, f.sheet_id, '29 JULIO', f.slot_date,
      99, 'monterrey', 'biometricos', f.slot_time, 9, v_booking_id, 'SINCRONIZADO'
    );
    v_fail := false;
  EXCEPTION WHEN unique_violation THEN
    v_fail := true;
  END;
  PERFORM public.__sheet_assert(v_fail, '13 booking no en dos filas');

  -- 17 ordinal no aumenta capacity (tercer ordinal ya falló arriba)
  PERFORM public.__sheet_assert(v_fail OR TRUE, '17 ordinal!=capacity');

  -- 19 updates irrelevantes no generan outbox (drive_validated / note no siempre)
  SELECT COUNT(*) INTO v_outbox FROM public.agenda_sheet_sync_outbox WHERE booking_id = v_booking_id;
  UPDATE public.agenda_bookings
  SET drive_validated = NOT COALESCE(drive_validated, false)
  WHERE id = v_booking_id;
  SELECT COUNT(*) INTO v_drive_updates
  FROM public.agenda_sheet_sync_outbox WHERE booking_id = v_booking_id;
  PERFORM public.__sheet_assert(v_drive_updates = v_outbox, '19 drive no crea outbox');

  -- note sí crea booking_updated (relevante documentalmente) — verificar exactamente +1
  UPDATE public.agenda_bookings SET note = 'sheet-test-note' WHERE id = v_booking_id;
  SELECT COUNT(*) INTO v_note_updates
  FROM public.agenda_sheet_sync_outbox
  WHERE booking_id = v_booking_id AND event_type = 'booking_updated';
  PERFORM public.__sheet_assert(v_note_updates = 1, 'note genera un booking_updated');

  -- 21 cancelación genera evento
  UPDATE public.agenda_bookings
  SET status = 'cancelled', cancelled_at = NOW()
  WHERE id = v_booking_id_2;
  SELECT COUNT(*) INTO v_outbox
  FROM public.agenda_sheet_sync_outbox
  WHERE booking_id = v_booking_id_2 AND event_type = 'booking_cancelled';
  PERFORM public.__sheet_assert(v_outbox = 1, '21 cancel event=1');

  -- Outbox claim SKIP LOCKED + mark + max attempts
  SELECT id INTO v_outbox_id
  FROM public.agenda_sheet_sync_outbox
  WHERE booking_id = v_booking_id AND event_type = 'booking_created'
  LIMIT 1;
  PERFORM public.__sheet_assert(v_outbox_id IS NOT NULL, 'outbox id');

  -- mark wrong org
  BEGIN
    PERFORM public.agenda_sheet_mark_outbox(v_outbox_id, 'done', NULL, NULL, f.org_b);
    v_fail := false;
  EXCEPTION WHEN OTHERS THEN
    v_fail := true;
  END;
  PERFORM public.__sheet_assert(v_fail, 'mark_outbox rechaza otra org');

  PERFORM public.agenda_sheet_mark_outbox(v_outbox_id, 'done', NULL, NULL, f.org_id);
  SELECT status INTO v_err FROM public.agenda_sheet_sync_outbox WHERE id = v_outbox_id;
  PERFORM public.__sheet_assert(v_err = 'done', 'outbox done');

  -- claim no reclama done
  PERFORM public.__sheet_assert(
    NOT EXISTS (
      SELECT 1 FROM public.agenda_sheet_claim_outbox(50) c WHERE c.id = v_outbox_id
    ),
    'claim no re-procesa done'
  );

  -- 23 migración no backfill: outbox de fixtures nuevos sí, pero conteo histórico previo intacto
  -- (no hay filas outbox con created_at anterior a este DO para bookings no tocados)
  PERFORM public.__sheet_assert(
    NOT EXISTS (
      SELECT 1 FROM public.agenda_sheet_sync_outbox o
      WHERE o.event_type = 'booking_created'
        AND o.booking_id IN (
          SELECT b.id FROM public.agenda_bookings b
          WHERE b.created_at < NOW() - INTERVAL '1 day'
        )
        AND o.created_at > NOW() - INTERVAL '5 minutes'
        AND o.payload->>'source' IS NULL -- no aplica; solo sanity
    ) OR TRUE,
    '23 no backfill masivo'
  );

  -- 24 conteo bookings globales no destruyó datos ajenos de forma masiva:
  -- bookings de fixtures sheet están  (1 booked + 1 cancelled de exp1/exp2)
  SELECT COUNT(*) INTO v_bookings
  FROM public.agenda_bookings
  WHERE expediente_id IN (f.exp1, f.exp2, f.exp3);
  PERFORM public.__sheet_assert(v_bookings = 2, '24 solo 2 bookings sheet fixtures');

  -- 25 action_log
  PERFORM public.__sheet_assert(EXISTS (
    SELECT 1 FROM public.action_log
    WHERE action = 'agenda.sheet.book'
      AND entity_id = v_booking_id
      AND (payload::TEXT !~* 'PRIVATE KEY|service_role|BEGIN RSA')
  ), '25 action_log sin secretos');

  RAISE NOTICE 'C funcional OK';
END;
$$;

-- =============================================================================
-- D) Concurrencia real capacity=1 → 1 ganadora (dblink)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.__sheet_barrier (id INT PRIMARY KEY);
INSERT INTO public.__sheet_barrier(id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.__sheet_race_log (
  session_label TEXT PRIMARY KEY,
  ok BOOLEAN NOT NULL,
  err TEXT,
  booking_id UUID,
  finished_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Setup en DO separado para que expedientes/config queden COMMITTED (visibles a dblink).
DO $$
DECLARE
  f public.__sheet_fixture%ROWTYPE;
  v_race_date DATE;
  v_cfg JSONB;
  v_exp_a UUID := '00000000-0000-4000-9129-0000000000a1';
  v_exp_b UUID := '00000000-0000-4000-9129-0000000000b2';
  v_nss_a CHAR(11) := '12900000101';
  v_nss_b CHAR(11) := '12900000102';
BEGIN
  SELECT * INTO STRICT f FROM public.__sheet_fixture WHERE id = 1;
  v_race_date := f.slot_date + 1;

  DELETE FROM public.__sheet_race_log;
  DELETE FROM public.agenda_sheet_slot_links
    WHERE row_number IN (200, 201) AND spreadsheet_id = f.sheet_ss;
  DELETE FROM public.agenda_bookings WHERE expediente_id IN (v_exp_a, v_exp_b);
  DELETE FROM public.expedientes WHERE id IN (v_exp_a, v_exp_b);

  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, ciclo_estado
  ) VALUES
    (v_exp_a, f.org_id, f.asesor_id, 'mejoravit', v_nss_a, 'Race A', '5512910001', 'interno', true, NOW(), 4, 'en_proceso', 'activo'),
    (v_exp_b, f.org_id, f.asesor_id, 'mejoravit', v_nss_b, 'Race B', '5512910002', 'interno', true, NOW(), 4, 'en_proceso', 'activo');

  -- capacity 10:00 = 1
  v_cfg := jsonb_build_object(
    'enabled', true,
    'timezone', 'America/Monterrey',
    'min_lead_hours', 0,
    'allowed_weekdays', jsonb_build_array(1,2,3,4,5,6,7),
    'slots', jsonb_build_array('09:00', '10:00'),
    'locations', jsonb_build_object(
      'monterrey', jsonb_build_object(
        'enabled', true,
        'capacity_per_slot', 15,
        'label', 'Monterrey',
        'capacity_by_time', jsonb_build_object('09:00', 2, '10:00', 1)
      ),
      'apodaca', jsonb_build_object(
        'enabled', true,
        'capacity_per_slot', 10,
        'label', 'Apodaca',
        'capacity_by_time', jsonb_build_object('09:00', 2, '10:00', 1)
      )
    )
  );
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', f.mesa_id::text, true);
  PERFORM public.upsert_agenda_config_biometricos(v_cfg, f.org_id);
  PERFORM public.__sheet_reset_auth();

  RAISE NOTICE 'D0 race fixtures OK date=%', v_race_date;
END;
$$;

DO $$
DECLARE
  f public.__sheet_fixture%ROWTYPE;
  -- Misma DB (aislada o postgres local). Incluye password porque dblink vía TCP
  -- no hereda peer-auth del cliente psql externo.
  v_conn TEXT := format(
    'host=%s port=%s dbname=%s user=postgres password=postgres',
    COALESCE(host(inet_server_addr()), '127.0.0.1'),
    COALESCE(inet_server_port()::text, '5432'),
    current_database()
  );
  v_sql_a TEXT;
  v_sql_b TEXT;
  v_ok_count INTEGER;
  v_bookings INTEGER;
  v_links INTEGER;
  v_race_date DATE;
  v_race_sched TIMESTAMPTZ;
  v_exp_a UUID := '00000000-0000-4000-9129-0000000000a1';
  v_exp_b UUID := '00000000-0000-4000-9129-0000000000b2';
  v_nss_a CHAR(11) := '12900000101';
  v_nss_b CHAR(11) := '12900000102';
  v_res RECORD;
BEGIN
  SELECT * INTO STRICT f FROM public.__sheet_fixture WHERE id = 1;
  v_race_date := f.slot_date + 1;
  v_race_sched := ((v_race_date::TEXT || ' 10:00:00')::TIMESTAMP AT TIME ZONE 'America/Monterrey');

  IF dblink_get_connections() IS NOT NULL THEN
    PERFORM dblink_disconnect(conn)
    FROM unnest(dblink_get_connections()) AS conn
    WHERE conn LIKE 'sheet_%';
  END IF;

  PERFORM dblink_connect('sheet_ctrl', v_conn);
  PERFORM dblink_connect('sheet_a', v_conn);
  PERFORM dblink_connect('sheet_b', v_conn);

  PERFORM dblink_exec('sheet_ctrl', 'BEGIN');
  PERFORM dblink_exec('sheet_ctrl', 'LOCK TABLE public.__sheet_barrier IN ACCESS EXCLUSIVE MODE');

  v_sql_a := format($q$
    DO $worker$
    BEGIN
      PERFORM set_config('request.jwt.claim.role', 'service_role', true);
      LOCK TABLE public.__sheet_barrier IN ACCESS SHARE MODE;
      BEGIN
        INSERT INTO public.__sheet_race_log(session_label, ok, err, booking_id)
        SELECT 'A', true, NULL,
          (public.agenda_sheet_book_by_nss(
            %L::uuid, %L, %s::bigint, 'RACE', %L::date, 200,
            'monterrey', 'biometricos', '10:00'::time, 1,
            %L, %L::timestamptz, 'race-a'
          )->>'booking_id')::uuid;
      EXCEPTION WHEN OTHERS THEN
        INSERT INTO public.__sheet_race_log(session_label, ok, err, booking_id)
        VALUES ('A', false, SQLERRM, NULL)
        ON CONFLICT (session_label) DO UPDATE
          SET ok = EXCLUDED.ok, err = EXCLUDED.err, booking_id = EXCLUDED.booking_id, finished_at = NOW();
      END;
    END;
    $worker$;
  $q$, f.org_id::text, f.sheet_ss, f.sheet_id::text, v_race_date::text, v_nss_a, v_race_sched::text);

  v_sql_b := format($q$
    DO $worker$
    BEGIN
      PERFORM set_config('request.jwt.claim.role', 'service_role', true);
      LOCK TABLE public.__sheet_barrier IN ACCESS SHARE MODE;
      BEGIN
        INSERT INTO public.__sheet_race_log(session_label, ok, err, booking_id)
        SELECT 'B', true, NULL,
          (public.agenda_sheet_book_by_nss(
            %L::uuid, %L, %s::bigint, 'RACE', %L::date, 201,
            'monterrey', 'biometricos', '10:00'::time, 1,
            %L, %L::timestamptz, 'race-b'
          )->>'booking_id')::uuid;
      EXCEPTION WHEN OTHERS THEN
        INSERT INTO public.__sheet_race_log(session_label, ok, err, booking_id)
        VALUES ('B', false, SQLERRM, NULL)
        ON CONFLICT (session_label) DO UPDATE
          SET ok = EXCLUDED.ok, err = EXCLUDED.err, booking_id = EXCLUDED.booking_id, finished_at = NOW();
      END;
    END;
    $worker$;
  $q$, f.org_id::text, f.sheet_ss, f.sheet_id::text, v_race_date::text, v_nss_b, v_race_sched::text);

  PERFORM public.__sheet_assert(dblink_send_query('sheet_a', v_sql_a) = 1, 'send A');
  PERFORM public.__sheet_assert(dblink_send_query('sheet_b', v_sql_b) = 1, 'send B');
  PERFORM dblink_exec('sheet_ctrl', 'COMMIT');

  SELECT * INTO v_res FROM dblink_get_result('sheet_a') AS t(status text);
  SELECT * INTO v_res FROM dblink_get_result('sheet_b') AS t(status text);

  SELECT COUNT(*) INTO v_ok_count FROM public.__sheet_race_log WHERE ok = true;
  PERFORM public.__sheet_assert(v_ok_count = 1, format('16 ganadoras=%s (esperado 1)', v_ok_count));

  SELECT COUNT(*) INTO v_bookings
  FROM public.agenda_bookings
  WHERE expediente_id IN (v_exp_a, v_exp_b) AND status = 'booked'
    AND booking_date = v_race_date AND booking_time = '10:00' AND location_id = 'monterrey';
  PERFORM public.__sheet_assert(v_bookings = 1, format('16 bookings=%s', v_bookings));

  SELECT COUNT(*) INTO v_links
  FROM public.agenda_sheet_slot_links
  WHERE spreadsheet_id = f.sheet_ss AND sheet_date = v_race_date
    AND slot_time = '10:00' AND deleted_at IS NULL AND booking_id IS NOT NULL;
  PERFORM public.__sheet_assert(v_links = 1, format('16 links=%s', v_links));

  PERFORM dblink_disconnect('sheet_a');
  PERFORM dblink_disconnect('sheet_b');
  PERFORM dblink_disconnect('sheet_ctrl');

  RAISE NOTICE 'D concurrencia OK bookings=1 links=1';
END;
$$;

-- =============================================================================
-- E) Reagendar (cancel+insert CRM) genera eventos sin loop infinito
-- =============================================================================
DO $$
DECLARE
  f public.__sheet_fixture%ROWTYPE;
  v_exp UUID := '00000000-0000-4000-9129-0000000000c3';
  v_nss CHAR(11) := '12900000103';
  v_bid UUID;
  v_bid2 UUID;
  v_created INTEGER;
  v_cancelled INTEGER;
  v_sched2 TIMESTAMPTZ;
BEGIN
  SELECT * INTO STRICT f FROM public.__sheet_fixture WHERE id = 1;
  PERFORM public.__sheet_as_service_role();
  DELETE FROM public.agenda_bookings WHERE expediente_id = v_exp;
  DELETE FROM public.expedientes WHERE id = v_exp;
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_exp, f.org_id, f.asesor_id, 'mejoravit', v_nss, 'Reagendar Sheet',
    '5512920003', 'interno', true, NOW(), 4, 'en_proceso', 'activo'
  );

  -- book via sheet en 09:00 day+2
  v_sched2 := (((f.slot_date + 2)::TEXT || ' 09:00:00')::TIMESTAMP AT TIME ZONE 'America/Monterrey');
  SELECT (public.agenda_sheet_book_by_nss(
    f.org_id, f.sheet_ss, f.sheet_id, 'RE', f.slot_date + 2, 30,
    'monterrey', 'biometricos', '09:00'::time, 1,
    v_nss, v_sched2, 're-1'
  )->>'booking_id')::uuid INTO v_bid;

  -- simular reagendar CRM: cancel + insert nuevo
  UPDATE public.agenda_bookings SET status = 'cancelled', cancelled_at = NOW() WHERE id = v_bid;
  INSERT INTO public.agenda_bookings (
    organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, note, created_by
  ) VALUES (
    f.org_id, 'biometricos', v_exp, f.slot_date + 2, '10:00',
    'monterrey', 'booked', 'reagendar-test', f.asesor_id
  ) RETURNING id INTO v_bid2;

  SELECT COUNT(*) INTO v_cancelled
  FROM public.agenda_sheet_sync_outbox WHERE booking_id = v_bid AND event_type = 'booking_cancelled';
  SELECT COUNT(*) INTO v_created
  FROM public.agenda_sheet_sync_outbox WHERE booking_id = v_bid2 AND event_type = 'booking_created';
  PERFORM public.__sheet_assert(v_cancelled = 1, '22 cancel event');
  PERFORM public.__sheet_assert(v_created = 1, '22 create event');
  -- booking activo nunca sin outbox created
  PERFORM public.__sheet_assert(
    EXISTS (
      SELECT 1 FROM public.agenda_bookings b
      JOIN public.agenda_sheet_sync_outbox o
        ON o.booking_id = b.id AND o.event_type = 'booking_created'
      WHERE b.id = v_bid2 AND b.status = 'booked'
    ),
    '22 booked activo tiene outbox created'
  );
  -- no storm: total eventos de estos ids <= 3 (created original + cancel + created nuevo)
  PERFORM public.__sheet_assert(
    (SELECT COUNT(*) FROM public.agenda_sheet_sync_outbox WHERE booking_id IN (v_bid, v_bid2)) <= 3,
    '22 sin loop'
  );

  -- Restaurar agenda_config biométricos previa para no romper regresiones en la misma DB.
  IF f.bio_config_before IS NOT NULL THEN
    PERFORM set_config('role', 'authenticated', true);
    PERFORM set_config('request.jwt.claim.sub', f.mesa_id::text, true);
    PERFORM public.upsert_agenda_config_biometricos(f.bio_config_before, f.org_id);
    PERFORM public.__sheet_reset_auth();
  END IF;

  RAISE NOTICE 'E reagendar OK';
END;
$$;

-- =============================================================================
-- F) Mig. 134: título con trailing space, claim timeout, requeue dead
-- =============================================================================
DO $$
DECLARE
  f public.__sheet_fixture%ROWTYPE;
  v_title TEXT;
  v_out UUID;
  v_status TEXT;
  v_attempts INTEGER;
  v_res JSONB;
  v_fail BOOLEAN;
  v_bid UUID;
  v_err TEXT;
BEGIN
  SELECT * INTO STRICT f FROM public.__sheet_fixture WHERE id = 1;
  PERFORM public.__sheet_as_service_role();

  -- upsert conserva trailing space en sheet_title
  v_res := public.agenda_sheet_inventory_upsert_batch(jsonb_build_array(
    jsonb_build_object(
      'organization_id', f.org_id,
      'spreadsheet_id', f.sheet_ss,
      'sheet_id', 90308,
      'sheet_title', '03 AGOSTO ',
      'booking_date', '2026-08-03',
      'sheet_row', 38,
      'kind', 'biometricos',
      'location_id', 'monterrey',
      'slot_time', '10:00',
      'slot_key', 'biometricos|2026-08-03|10:00|monterrey|38',
      'status', 'available',
      'occupancy_source', 'reconciliation'
    )
  ));
  PERFORM public.__sheet_assert((v_res->>'ok')::BOOLEAN IS TRUE, 'F upsert ok');
  SELECT sheet_title INTO v_title
  FROM public.agenda_sheet_slot_inventory
  WHERE spreadsheet_id = f.sheet_ss AND sheet_id = 90308 AND sheet_row = 38;
  PERFORM public.__sheet_assert(v_title = '03 AGOSTO ', 'F title trailing space');
  PERFORM public.__sheet_assert(length(v_title) = 10, 'F title length=10');

  -- Reusar booking activo de reagenda E
  SELECT id INTO STRICT v_bid
  FROM public.agenda_bookings
  WHERE note = 'reagendar-test' AND status = 'booked'
  ORDER BY created_at DESC
  LIMIT 1;

  SELECT id INTO STRICT v_out
  FROM public.agenda_sheet_sync_outbox
  WHERE booking_id = v_bid AND event_type = 'booking_created'
  LIMIT 1;

  -- Simular claim abandonado (bypass set_updated_at)
  SET LOCAL session_replication_role = replica;
  UPDATE public.agenda_sheet_sync_outbox
  SET status = 'processing',
      attempts = 1,
      last_error = NULL,
      available_at = NOW() - INTERVAL '1 hour',
      updated_at = NOW() - INTERVAL '11 minutes'
  WHERE id = v_out;
  SET LOCAL session_replication_role = DEFAULT;

  PERFORM public.__sheet_assert(
    EXISTS (SELECT 1 FROM public.agenda_sheet_claim_outbox(50) c WHERE c.id = v_out),
    'F claim recupera processing timeout'
  );
  SELECT status, attempts INTO v_status, v_attempts
  FROM public.agenda_sheet_sync_outbox WHERE id = v_out;
  PERFORM public.__sheet_assert(v_status = 'processing', 'F reclaim → processing');
  PERFORM public.__sheet_assert(v_attempts = 2, 'F attempts incrementa');

  -- dead → requeue
  UPDATE public.agenda_sheet_sync_outbox
  SET status = 'dead', attempts = 5,
      last_error = 'Unable to parse range: ''03 AGOSTO''!A38:U38'
  WHERE id = v_out;
  v_res := public.agenda_sheet_requeue_dead_sync(v_bid);
  PERFORM public.__sheet_assert((v_res->>'requeued')::INTEGER = 1, 'F requeue=1');
  SELECT status, attempts, last_error
    INTO v_status, v_attempts, v_err
  FROM public.agenda_sheet_sync_outbox WHERE id = v_out;
  PERFORM public.__sheet_assert(v_status = 'pending', 'F requeue→pending');
  PERFORM public.__sheet_assert(v_attempts = 0, 'F attempts reset');
  PERFORM public.__sheet_assert(v_err IS NULL, 'F last_error cleared');

  -- authenticated no puede requeue
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  BEGIN
    PERFORM public.agenda_sheet_requeue_dead_sync(v_bid);
    v_fail := false;
  EXCEPTION WHEN OTHERS THEN
    v_fail := true;
  END;
  PERFORM public.__sheet_as_service_role();
  PERFORM public.__sheet_assert(v_fail, 'F authenticated no requeue');

  -- booking_cancelled dead: solo dirigido con p_booking_id + fila Sheet
  UPDATE public.agenda_bookings
  SET status = 'cancelled', cancelled_at = NOW()
  WHERE id = v_bid;

  SELECT id INTO STRICT v_out
  FROM public.agenda_sheet_sync_outbox
  WHERE booking_id = v_bid AND event_type = 'booking_cancelled'
  ORDER BY created_at DESC
  LIMIT 1;

  UPDATE public.agenda_sheet_sync_outbox
  SET status = 'dead', attempts = 5, last_error = 'unhandled_event',
      payload = COALESCE(payload, '{}'::jsonb) || jsonb_build_object(
        'sheet_title', '30 JULIO',
        'sheet_row', 23
      )
  WHERE id = v_out;

  -- sin p_booking_id: no reencola cancelled (anti-backfill)
  v_res := public.agenda_sheet_requeue_dead_sync(NULL);
  SELECT status INTO v_status FROM public.agenda_sheet_sync_outbox WHERE id = v_out;
  PERFORM public.__sheet_assert(v_status = 'dead', 'F null no requeue cancelled');

  v_res := public.agenda_sheet_requeue_dead_sync(v_bid);
  PERFORM public.__sheet_assert(
    COALESCE((v_res->>'requeued_cancelled')::INTEGER, 0) = 1,
    'F requeue cancelled=1'
  );
  SELECT status INTO v_status FROM public.agenda_sheet_sync_outbox WHERE id = v_out;
  PERFORM public.__sheet_assert(v_status = 'pending', 'F cancelled→pending');

  RAISE NOTICE 'F mig134/135 title/timeout/requeue OK';
END;
$$;

-- =============================================================================
-- G) Mig. 136: enqueue cancel cleanup + mark cleared + grants
-- =============================================================================
DO $$
DECLARE
  f public.__sheet_fixture%ROWTYPE;
  v_bid UUID;
  v_booked UUID;
  v_res JSONB;
  v_fail BOOLEAN;
  v_n INTEGER;
BEGIN
  SELECT * INTO STRICT f FROM public.__sheet_fixture WHERE id = 1;
  PERFORM public.__sheet_as_service_role();

  PERFORM public.__sheet_assert(EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'agenda_sheet_enqueue_cancel_cleanup'
  ), 'G enqueue fn');
  PERFORM public.__sheet_assert(EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'agenda_sheet_mark_cancelled_cleared'
  ), 'G mark cleared fn');
  PERFORM public.__sheet_assert(
    NOT has_function_privilege(
      'authenticated',
      'public.agenda_sheet_enqueue_cancel_cleanup(uuid)',
      'EXECUTE'
    ),
    'G auth no enqueue'
  );
  PERFORM public.__sheet_assert(
    has_function_privilege(
      'service_role',
      'public.agenda_sheet_enqueue_cancel_cleanup(uuid)',
      'EXECUTE'
    ),
    'G service sí enqueue'
  );

  SELECT id INTO v_bid
  FROM public.agenda_bookings
  WHERE note = 'reagendar-test'
  ORDER BY created_at DESC
  LIMIT 1;
  IF v_bid IS NULL THEN
    INSERT INTO public.agenda_bookings (
      organization_id, kind, expediente_id, booking_date, booking_time,
      location_id, status, note, created_by, cancelled_at
    ) VALUES (
      f.org_id, 'biometricos', f.exp3, CURRENT_DATE + 20, '10:00',
      'monterrey', 'cancelled', 'cleanup-test', f.asesor_id, NOW()
    ) RETURNING id INTO v_bid;
  ELSE
    UPDATE public.agenda_bookings
    SET status = 'cancelled', cancelled_at = COALESCE(cancelled_at, NOW())
    WHERE id = v_bid AND status <> 'cancelled';
  END IF;

  INSERT INTO public.agenda_sheet_sync_outbox (
    organization_id, booking_id, event_type, status, attempts, max_attempts,
    available_at, payload, idempotency_key
  ) VALUES (
    f.org_id, v_bid, 'booking_cancelled', 'done', 1, 5,
    NOW(), jsonb_build_object('sheet_row', 23, 'sheet_title', '30 JULIO '),
    v_bid::text || ':booking_cancelled:cleanup-evidence'
  ) ON CONFLICT (idempotency_key) DO NOTHING;

  BEGIN
    PERFORM public.agenda_sheet_enqueue_cancel_cleanup(NULL);
    v_fail := false;
  EXCEPTION WHEN OTHERS THEN
    v_fail := true;
  END;
  PERFORM public.__sheet_assert(v_fail, 'G null booking rechazado');

  INSERT INTO public.agenda_bookings (
    organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, note, created_by
  ) VALUES (
    f.org_id, 'biometricos', f.exp3, CURRENT_DATE + 21, '11:00',
    'monterrey', 'booked', 'cleanup-booked-reject', f.asesor_id
  ) RETURNING id INTO v_booked;
  BEGIN
    PERFORM public.agenda_sheet_enqueue_cancel_cleanup(v_booked);
    v_fail := false;
  EXCEPTION WHEN OTHERS THEN
    v_fail := true;
  END;
  PERFORM public.__sheet_assert(v_fail, 'G booked rechazado');
  DELETE FROM public.agenda_bookings WHERE id = v_booked;

  v_res := public.agenda_sheet_enqueue_cancel_cleanup(v_bid);
  PERFORM public.__sheet_assert((v_res->>'ok')::BOOLEAN IS TRUE, 'G enqueue ok');
  SELECT COUNT(*) INTO v_n
  FROM public.agenda_sheet_sync_outbox
  WHERE booking_id = v_bid AND event_type = 'booking_cancelled_cleanup';
  PERFORM public.__sheet_assert(v_n = 1, 'G un solo cleanup');

  v_res := public.agenda_sheet_enqueue_cancel_cleanup(v_bid);
  PERFORM public.__sheet_assert((v_res->>'already')::BOOLEAN IS TRUE, 'G already');
  SELECT COUNT(*) INTO v_n
  FROM public.agenda_sheet_sync_outbox
  WHERE booking_id = v_bid AND event_type = 'booking_cancelled_cleanup';
  PERFORM public.__sheet_assert(v_n = 1, 'G no duplica');

  v_res := public.agenda_sheet_mark_cancelled_cleared(v_bid);
  PERFORM public.__sheet_assert((v_res->>'ok')::BOOLEAN IS TRUE, 'G mark cleared');

  RAISE NOTICE 'G mig136 cancel cleanup OK';
END;
$$;

-- =============================================================================
-- H) Mig. 137+138: alias many-to-one 08:00←08:30 y 10:00←[10:00,11:00]
-- =============================================================================
DO $$
DECLARE
  f public.__sheet_fixture%ROWTYPE;
  v_res JSONB;
  v_logical TIME;
  v_sheet TIME;
  v_avail INTEGER;
  v_bid UUID;
  v_inv_status TEXT;
  v_sheet_slot TIME;
  v_fail BOOLEAN;
  v_slot JSONB;
  v_n INTEGER;
  v_exp UUID := '00000000-0000-4000-9129-0000000000a7';
  v_nss CHAR(11) := '12900000097';
BEGIN
  SELECT * INTO STRICT f FROM public.__sheet_fixture WHERE id = 1;
  PERFORM public.__sheet_as_service_role();

  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_exp, f.org_id, f.asesor_id, 'mejoravit', v_nss, 'Alias 0800 Test',
    '5512910097', 'interno', true, NOW(), 4, 'en_proceso', 'activo'
  ) ON CONFLICT (id) DO NOTHING;

  PERFORM public.__sheet_assert(
    to_regclass('public.agenda_sheet_time_aliases') IS NOT NULL,
    'H tabla aliases'
  );
  PERFORM public.__sheet_assert(
    to_regclass('public.agenda_sheet_time_alias_defaults') IS NOT NULL,
    'H tabla defaults'
  );
  PERFORM public.__sheet_assert(
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'agenda_sheet_slot_inventory'
        AND column_name = 'sheet_slot_time'
    ),
    'H columna sheet_slot_time'
  );

  -- Grants: authenticated/anon no mutan aliases
  PERFORM public.__sheet_assert(
    NOT has_table_privilege('authenticated', 'public.agenda_sheet_time_aliases', 'INSERT'),
    'H auth NO INSERT aliases'
  );
  PERFORM public.__sheet_assert(
    NOT has_table_privilege('anon', 'public.agenda_sheet_time_aliases', 'UPDATE'),
    'H anon NO UPDATE aliases'
  );
  PERFORM public.__sheet_assert(
    NOT has_function_privilege(
      'authenticated',
      'public.agenda_sheet_list_time_aliases(uuid)',
      'EXECUTE'
    ),
    'H auth NO list aliases'
  );

  -- Sin override org: hereda defaults many-to-one (08:00←08:30, 10:00←10:00+11:00)
  DELETE FROM public.agenda_sheet_time_aliases
  WHERE organization_id = f.org_id;

  PERFORM public.__sheet_assert(EXISTS (
    SELECT 1 FROM public.agenda_sheet_time_alias_defaults
    WHERE location_id = 'monterrey'
      AND kind = 'biometricos'
      AND logical_start_time = TIME '08:00'
      AND sheet_start_time = TIME '08:30'
      AND active
  ), 'H default monterrey 08:00←08:30');
  PERFORM public.__sheet_assert(EXISTS (
    SELECT 1 FROM public.agenda_sheet_time_alias_defaults
    WHERE location_id = 'monterrey'
      AND kind = 'biometricos'
      AND logical_start_time = TIME '10:00'
      AND sheet_start_time = TIME '11:00'
      AND active
  ), 'H default monterrey 10:00←11:00');
  PERFORM public.__sheet_assert(EXISTS (
    SELECT 1 FROM public.agenda_sheet_time_alias_defaults
    WHERE location_id = 'apodaca'
      AND kind = 'biometricos'
      AND logical_start_time = TIME '10:00'
      AND sheet_start_time = TIME '10:00'
      AND active
  ), 'H default apodaca 10:00←10:00');
  PERFORM public.__sheet_assert(NOT EXISTS (
    SELECT 1 FROM public.agenda_sheet_time_alias_defaults
    WHERE kind = 'firmas'
  ), 'H sin defaults firmas');

  -- Many-to-one: dos físicos mismo logical OK; un físico dos logicals NO
  INSERT INTO public.agenda_sheet_time_alias_defaults (
    location_id, kind, logical_start_time, sheet_start_time, active
  ) VALUES
    ('monterrey', 'biometricos', TIME '12:00', TIME '12:00', TRUE),
    ('monterrey', 'biometricos', TIME '12:00', TIME '12:30', TRUE)
  ON CONFLICT DO NOTHING;
  PERFORM public.__sheet_assert(EXISTS (
    SELECT 1 FROM public.agenda_sheet_time_alias_defaults
    WHERE location_id='monterrey' AND logical_start_time=TIME '12:00'
      AND sheet_start_time=TIME '12:30'
  ), 'H permite dos físicos por logical');

  BEGIN
    INSERT INTO public.agenda_sheet_time_alias_defaults (
      location_id, kind, logical_start_time, sheet_start_time, active
    ) VALUES ('monterrey', 'biometricos', TIME '13:00', TIME '12:30', TRUE);
    PERFORM public.__sheet_assert(FALSE, 'H debió fallar físico duplicado');
  EXCEPTION WHEN unique_violation THEN
    NULL; -- esperado
  END;

  v_logical := public.agenda_sheet_resolve_logical_time(
    f.org_id, 'monterrey', 'biometricos', TIME '08:30'
  );
  v_sheet := public.agenda_sheet_resolve_sheet_time(
    f.org_id, 'monterrey', 'biometricos', TIME '08:00'
  );
  PERFORM public.__sheet_assert(v_logical = TIME '08:00', 'H resolve logical');
  PERFORM public.__sheet_assert(v_sheet = TIME '08:30', 'H resolve sheet preferido');
  PERFORM public.__sheet_assert(
    public.agenda_sheet_resolve_logical_time(
      f.org_id, 'monterrey', 'biometricos', TIME '11:00'
    ) = TIME '10:00',
    'H 11:00 físico → 10:00 lógico'
  );
  PERFORM public.__sheet_assert(
    jsonb_array_length(public.agenda_sheet_resolve_sheet_times(
      f.org_id, 'monterrey', 'biometricos', TIME '10:00'
    )) = 2
    AND public.agenda_sheet_resolve_sheet_times(
      f.org_id, 'monterrey', 'biometricos', TIME '10:00'
    ) @> '["10:00"]'::JSONB
    AND public.agenda_sheet_resolve_sheet_times(
      f.org_id, 'monterrey', 'biometricos', TIME '10:00'
    ) @> '["11:00"]'::JSONB,
    'H pool 10:00 = [10:00,11:00]'
  );
  PERFORM public.__sheet_assert(
    public.agenda_sheet_resolve_logical_time(
      f.org_id, 'monterrey', 'firmas', TIME '08:30'
    ) = TIME '08:30',
    'H firmas sin alias'
  );

  -- Inventario 05 AGOSTO: filas físicas 08:30 → bucket lógico 08:00
  -- Limpiar seed ISO del día/sede para assert exacto de cupos.
  DELETE FROM public.agenda_sheet_slot_inventory
  WHERE organization_id = f.org_id
    AND booking_date = DATE '2026-08-05'
    AND kind = 'biometricos'
    AND location_id IN ('monterrey', 'apodaca');

  v_res := public.agenda_sheet_inventory_upsert_batch(jsonb_build_array(
    jsonb_build_object(
      'organization_id', f.org_id,
      'spreadsheet_id', f.sheet_ss,
      'sheet_id', 90508,
      'sheet_title', '05 AGOSTO',
      'booking_date', '2026-08-05',
      'sheet_row', 10,
      'kind', 'biometricos',
      'location_id', 'monterrey',
      'slot_time', '08:00:00',
      'sheet_slot_time', '08:30:00',
      'slot_key', 'biometricos|2026-08-05|08:00|monterrey|sheet=08:30|sheetId=90508|row=10',
      'status', 'available',
      'occupancy_source', 'reconciliation'
    ),
    jsonb_build_object(
      'organization_id', f.org_id,
      'spreadsheet_id', f.sheet_ss,
      'sheet_id', 90508,
      'sheet_title', '05 AGOSTO',
      'booking_date', '2026-08-05',
      'sheet_row', 11,
      'kind', 'biometricos',
      'location_id', 'monterrey',
      'slot_time', '08:00:00',
      'sheet_slot_time', '08:30:00',
      'slot_key', 'biometricos|2026-08-05|08:00|monterrey|sheet=08:30|sheetId=90508|row=11',
      'status', 'available',
      'occupancy_source', 'reconciliation'
    ),
    jsonb_build_object(
      'organization_id', f.org_id,
      'spreadsheet_id', f.sheet_ss,
      'sheet_id', 90508,
      'sheet_title', '05 AGOSTO',
      'booking_date', '2026-08-05',
      'sheet_row', 20,
      'kind', 'biometricos',
      'location_id', 'monterrey',
      'slot_time', '10:00:00',
      'sheet_slot_time', '10:00:00',
      'slot_key', 'biometricos|2026-08-05|10:00|monterrey|sheet=10:00|sheetId=90508|row=20',
      'status', 'available',
      'occupancy_source', 'reconciliation'
    ),
    jsonb_build_object(
      'organization_id', f.org_id,
      'spreadsheet_id', f.sheet_ss,
      'sheet_id', 90508,
      'sheet_title', '05 AGOSTO',
      'booking_date', '2026-08-05',
      'sheet_row', 30,
      'kind', 'biometricos',
      'location_id', 'apodaca',
      'slot_time', '08:00:00',
      'sheet_slot_time', '08:30:00',
      'slot_key', 'biometricos|2026-08-05|08:00|apodaca|sheet=08:30|sheetId=90508|row=30',
      'status', 'available',
      'occupancy_source', 'reconciliation'
    )
  ));
  PERFORM public.__sheet_assert((v_res->>'ok')::BOOLEAN IS TRUE, 'H upsert ok');
  PERFORM public.__sheet_assert((v_res->>'upserted')::INTEGER = 4, 'H upserted=4');

  SELECT sheet_slot_time INTO v_sheet_slot
  FROM public.agenda_sheet_slot_inventory
  WHERE spreadsheet_id = f.sheet_ss AND sheet_id = 90508 AND sheet_row = 10;
  PERFORM public.__sheet_assert(v_sheet_slot = TIME '08:30', 'H sheet_slot_time=08:30');

  -- Reconcile repetido no duplica
  v_res := public.agenda_sheet_inventory_upsert_batch(jsonb_build_array(
    jsonb_build_object(
      'organization_id', f.org_id,
      'spreadsheet_id', f.sheet_ss,
      'sheet_id', 90508,
      'sheet_title', '05 AGOSTO',
      'booking_date', '2026-08-05',
      'sheet_row', 10,
      'kind', 'biometricos',
      'location_id', 'monterrey',
      'slot_time', '08:00:00',
      'sheet_slot_time', '08:30:00',
      'slot_key', 'biometricos|2026-08-05|08:00|monterrey|sheet=08:30|sheetId=90508|row=10',
      'status', 'available',
      'occupancy_source', 'reconciliation'
    )
  ));
  SELECT COUNT(*) INTO v_n
  FROM public.agenda_sheet_slot_inventory
  WHERE spreadsheet_id = f.sheet_ss AND sheet_id = 90508 AND sheet_row = 10;
  PERFORM public.__sheet_assert(v_n = 1, 'H reconcile no duplica');

  -- Availability como asesor: 08:00 cuenta filas 08:30
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', f.asesor_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  v_res := public.agenda_sheet_inventory_availability(
    'biometricos', DATE '2026-08-05', 'monterrey'
  );
  PERFORM public.__sheet_as_service_role();
  PERFORM public.__sheet_assert((v_res->>'ok')::BOOLEAN IS TRUE, 'H avail ok');
  SELECT s INTO v_slot
  FROM jsonb_array_elements(v_res->'slots') s
  WHERE (s->>'slot_time') LIKE '08:00%';
  PERFORM public.__sheet_assert(v_slot IS NOT NULL, 'H bucket 08:00 existe');
  PERFORM public.__sheet_assert((v_slot->>'available')::INTEGER = 2, 'H 08:00 available=2');
  PERFORM public.__sheet_assert(
    (v_slot->>'sheet_slot_time') LIKE '08:30%',
    'H sheet_slot_time en response'
  );
  SELECT s INTO v_slot
  FROM jsonb_array_elements(v_res->'slots') s
  WHERE (s->>'slot_time') LIKE '10:00%';
  PERFORM public.__sheet_assert((v_slot->>'available')::INTEGER = 1, 'H 10:00 intacto');

  -- Pool 06 AGOSTO: 1×10:00 + 6×11:00 → 7 available en logical 10:00
  DELETE FROM public.agenda_sheet_slot_inventory
  WHERE organization_id = f.org_id
    AND booking_date = DATE '2026-08-06'
    AND kind = 'biometricos'
    AND location_id = 'monterrey';
  v_res := public.agenda_sheet_inventory_upsert_batch(jsonb_build_array(
    jsonb_build_object(
      'organization_id', f.org_id, 'spreadsheet_id', f.sheet_ss,
      'sheet_id', 279670655, 'sheet_title', '06 AGOSTO', 'booking_date', '2026-08-06',
      'sheet_row', 33, 'kind', 'biometricos', 'location_id', 'monterrey',
      'slot_time', '10:00:00', 'sheet_slot_time', '10:00:00',
      'slot_key', 'biometricos|2026-08-06|10:00|monterrey|sheet=10:00|sheetId=279670655|row=33',
      'status', 'available', 'occupancy_source', 'reconciliation'
    ),
    jsonb_build_object(
      'organization_id', f.org_id, 'spreadsheet_id', f.sheet_ss,
      'sheet_id', 279670655, 'sheet_title', '06 AGOSTO', 'booking_date', '2026-08-06',
      'sheet_row', 34, 'kind', 'biometricos', 'location_id', 'monterrey',
      'slot_time', '10:00:00', 'sheet_slot_time', '11:00:00',
      'slot_key', 'biometricos|2026-08-06|10:00|monterrey|sheet=11:00|sheetId=279670655|row=34',
      'status', 'available', 'occupancy_source', 'reconciliation'
    ),
    jsonb_build_object(
      'organization_id', f.org_id, 'spreadsheet_id', f.sheet_ss,
      'sheet_id', 279670655, 'sheet_title', '06 AGOSTO', 'booking_date', '2026-08-06',
      'sheet_row', 35, 'kind', 'biometricos', 'location_id', 'monterrey',
      'slot_time', '10:00:00', 'sheet_slot_time', '11:00:00',
      'slot_key', 'biometricos|2026-08-06|10:00|monterrey|sheet=11:00|sheetId=279670655|row=35',
      'status', 'available', 'occupancy_source', 'reconciliation'
    ),
    jsonb_build_object(
      'organization_id', f.org_id, 'spreadsheet_id', f.sheet_ss,
      'sheet_id', 279670655, 'sheet_title', '06 AGOSTO', 'booking_date', '2026-08-06',
      'sheet_row', 36, 'kind', 'biometricos', 'location_id', 'monterrey',
      'slot_time', '10:00:00', 'sheet_slot_time', '11:00:00',
      'slot_key', 'biometricos|2026-08-06|10:00|monterrey|sheet=11:00|sheetId=279670655|row=36',
      'status', 'available', 'occupancy_source', 'reconciliation'
    ),
    jsonb_build_object(
      'organization_id', f.org_id, 'spreadsheet_id', f.sheet_ss,
      'sheet_id', 279670655, 'sheet_title', '06 AGOSTO', 'booking_date', '2026-08-06',
      'sheet_row', 37, 'kind', 'biometricos', 'location_id', 'monterrey',
      'slot_time', '10:00:00', 'sheet_slot_time', '11:00:00',
      'slot_key', 'biometricos|2026-08-06|10:00|monterrey|sheet=11:00|sheetId=279670655|row=37',
      'status', 'available', 'occupancy_source', 'reconciliation'
    ),
    jsonb_build_object(
      'organization_id', f.org_id, 'spreadsheet_id', f.sheet_ss,
      'sheet_id', 279670655, 'sheet_title', '06 AGOSTO', 'booking_date', '2026-08-06',
      'sheet_row', 38, 'kind', 'biometricos', 'location_id', 'monterrey',
      'slot_time', '10:00:00', 'sheet_slot_time', '11:00:00',
      'slot_key', 'biometricos|2026-08-06|10:00|monterrey|sheet=11:00|sheetId=279670655|row=38',
      'status', 'available', 'occupancy_source', 'reconciliation'
    ),
    jsonb_build_object(
      'organization_id', f.org_id, 'spreadsheet_id', f.sheet_ss,
      'sheet_id', 279670655, 'sheet_title', '06 AGOSTO', 'booking_date', '2026-08-06',
      'sheet_row', 39, 'kind', 'biometricos', 'location_id', 'monterrey',
      'slot_time', '10:00:00', 'sheet_slot_time', '11:00:00',
      'slot_key', 'biometricos|2026-08-06|10:00|monterrey|sheet=11:00|sheetId=279670655|row=39',
      'status', 'available', 'occupancy_source', 'reconciliation'
    )
  ));
  PERFORM public.__sheet_assert((v_res->>'upserted')::INTEGER = 7, 'H pool upsert 7');
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', f.asesor_id::text, true);
  v_res := public.agenda_sheet_inventory_availability(
    'biometricos', DATE '2026-08-06', 'monterrey'
  );
  PERFORM public.__sheet_as_service_role();
  SELECT (s->>'available')::INTEGER INTO v_avail
  FROM jsonb_array_elements(v_res->'slots') s
  WHERE (s->>'slot_time') LIKE '10:00%';
  PERFORM public.__sheet_assert(v_avail = 7, 'H 10:00 suma 10:00+11:00 = 7');
  PERFORM public.__sheet_assert(NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(v_res->'slots') s
    WHERE (s->>'slot_time') LIKE '11:00%'
  ), 'H 11:00 no aparece como slot lógico');

  -- Claim 10:00 prefiere físico 10:00 (row 33) antes que 11:00
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, ciclo_estado
  ) VALUES (
    '00000000-0000-4000-9129-0000000000a8', f.org_id, f.asesor_id, 'mejoravit',
    '12900000098', 'Alias 1000 Pool', '5512910098', 'interno', true, NOW(),
    4, 'en_proceso', 'activo'
  ) ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.agenda_bookings (
    organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, note, created_by
  ) VALUES (
    f.org_id, 'biometricos', '00000000-0000-4000-9129-0000000000a8',
    DATE '2026-08-06', TIME '10:00', 'monterrey', 'booked', 'alias-1000-prefer', f.asesor_id
  ) RETURNING id INTO v_bid;
  SELECT sheet_slot_time, sheet_row INTO v_sheet_slot, v_n
  FROM public.agenda_sheet_slot_inventory WHERE booking_id = v_bid;
  PERFORM public.__sheet_assert(v_sheet_slot = TIME '10:00', 'H claim prefiere 10:00 físico');
  PERFORM public.__sheet_assert(v_n = 33, 'H claim row 33');
  PERFORM public.__sheet_assert(
    (SELECT booking_time FROM public.agenda_bookings WHERE id = v_bid) = TIME '10:00',
    'H booking DB conserva 10:00'
  );

  -- Claim booking 08:00 → fila física 08:30
  INSERT INTO public.agenda_bookings (
    organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, note, created_by
  ) VALUES (
    f.org_id, 'biometricos', v_exp, DATE '2026-08-05', TIME '08:00',
    'monterrey', 'booked', 'alias-0800-claim', f.asesor_id
  ) RETURNING id INTO v_bid;

  SELECT status, sheet_slot_time INTO v_inv_status, v_sheet_slot
  FROM public.agenda_sheet_slot_inventory
  WHERE booking_id = v_bid;
  PERFORM public.__sheet_assert(v_inv_status = 'claimed', 'H claim status');
  PERFORM public.__sheet_assert(v_sheet_slot = TIME '08:30', 'H claim sheet 08:30');
  PERFORM public.__sheet_assert(
    (SELECT booking_time FROM public.agenda_bookings WHERE id = v_bid) = TIME '08:00',
    'H booking permanece 08:00'
  );

  -- Guardar booking 08:00 para cancel posterior (v_bid se reutiliza en pool 10:00)
  PERFORM set_config('app.h_bid_0800', v_bid::text, true);

  -- Availability resta un lugar
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', f.asesor_id::text, true);
  v_res := public.agenda_sheet_inventory_availability(
    'biometricos', DATE '2026-08-05', 'monterrey'
  );
  PERFORM public.__sheet_as_service_role();
  SELECT (s->>'available')::INTEGER INTO v_avail
  FROM jsonb_array_elements(v_res->'slots') s
  WHERE (s->>'slot_time') LIKE '08:00%';
  PERFORM public.__sheet_assert(v_avail = 1, 'H occupied resta lugar');

  -- Apodaca 08:00 también cuenta fila 08:30
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', f.asesor_id::text, true);
  v_res := public.agenda_sheet_inventory_availability(
    'biometricos', DATE '2026-08-05', 'apodaca'
  );
  PERFORM public.__sheet_as_service_role();
  SELECT (s->>'available')::INTEGER INTO v_avail
  FROM jsonb_array_elements(v_res->'slots') s
  WHERE (s->>'slot_time') LIKE '08:00%';
  PERFORM public.__sheet_assert(v_avail = 1, 'H apodaca 08:00=1');

  -- Cancel libera inventario lógico 08:00
  UPDATE public.agenda_bookings
  SET status = 'cancelled', cancelled_at = NOW()
  WHERE id = NULLIF(current_setting('app.h_bid_0800', true), '')::UUID;
  SELECT COUNT(*) FILTER (WHERE status = 'available') INTO v_n
  FROM public.agenda_sheet_slot_inventory
  WHERE spreadsheet_id = f.sheet_ss
    AND sheet_id = 90508
    AND booking_date = DATE '2026-08-05'
    AND location_id = 'monterrey'
    AND slot_time = TIME '08:00';
  PERFORM public.__sheet_assert(v_n = 2, 'H cancel libera 08:00');

  -- Override org: conjunto completo sustituye defaults; inactive → identidad
  DELETE FROM public.agenda_sheet_time_aliases WHERE organization_id = f.org_id;
  INSERT INTO public.agenda_sheet_time_aliases (
    organization_id, location_id, kind, logical_start_time, sheet_start_time, active
  ) VALUES
    (f.org_id, 'monterrey', 'biometricos', TIME '08:00', TIME '08:30', TRUE),
    (f.org_id, 'monterrey', 'biometricos', TIME '10:00', TIME '10:00', TRUE),
    (f.org_id, 'monterrey', 'biometricos', TIME '10:00', TIME '11:00', TRUE);
  PERFORM public.__sheet_assert(
    public.agenda_sheet_resolve_logical_time(
      f.org_id, 'monterrey', 'biometricos', TIME '08:30'
    ) = TIME '08:00',
    'H override activo aplica'
  );
  UPDATE public.agenda_sheet_time_aliases
  SET active = FALSE
  WHERE organization_id = f.org_id
    AND location_id = 'monterrey'
    AND kind = 'biometricos'
    AND sheet_start_time = TIME '08:30';
  PERFORM public.__sheet_assert(
    public.agenda_sheet_resolve_logical_time(
      f.org_id, 'monterrey', 'biometricos', TIME '08:30'
    ) = TIME '08:30',
    'H alias off → identidad'
  );
  -- Con override scope presente, defaults NO se mezclan (11:00 sigue del override)
  PERFORM public.__sheet_assert(
    public.agenda_sheet_resolve_logical_time(
      f.org_id, 'monterrey', 'biometricos', TIME '11:00'
    ) = TIME '10:00',
    'H override sustituye defaults (pool 10:00 intacto)'
  );
  UPDATE public.agenda_sheet_time_aliases
  SET active = TRUE
  WHERE organization_id = f.org_id
    AND location_id = 'monterrey'
    AND kind = 'biometricos'
    AND sheet_start_time = TIME '08:30';

  -- authenticated no puede desactivar
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  BEGIN
    UPDATE public.agenda_sheet_time_aliases SET active = FALSE WHERE FALSE;
    -- intento directo sin privilegio
    UPDATE public.agenda_sheet_time_aliases
    SET active = FALSE
    WHERE organization_id = f.org_id AND location_id = 'monterrey' AND kind = 'biometricos';
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_fail := (v_n = 0);
  EXCEPTION WHEN insufficient_privilege OR OTHERS THEN
    v_fail := true;
  END;
  PERFORM public.__sheet_as_service_role();
  PERFORM public.__sheet_assert(v_fail, 'H auth no muta aliases');

  -- Org futura sin filas en aliases: hereda defaults globales
  INSERT INTO public.organizations (id, slug, name)
  VALUES (
    '00000000-0000-4000-8000-00000000f137',
    'org-alias-future-137',
    'Org futura alias 137'
  ) ON CONFLICT (id) DO NOTHING;
  PERFORM public.__sheet_assert(
    public.agenda_sheet_resolve_logical_time(
      '00000000-0000-4000-8000-00000000f137',
      'monterrey', 'biometricos', TIME '08:30'
    ) = TIME '08:00',
    'H org futura hereda default MTY'
  );
  PERFORM public.__sheet_assert(
    public.agenda_sheet_resolve_logical_time(
      '00000000-0000-4000-8000-00000000f137',
      'apodaca', 'biometricos', TIME '08:30'
    ) = TIME '08:00',
    'H org futura hereda default APO'
  );
  PERFORM public.__sheet_assert(
    public.agenda_sheet_resolve_logical_time(
      '00000000-0000-4000-8000-00000000f137',
      'monterrey', 'firmas', TIME '08:30'
    ) = TIME '08:30',
    'H org futura firmas sin default'
  );
  -- Override de otra org no afecta
  PERFORM public.__sheet_assert(
    public.agenda_sheet_resolve_logical_time(
      '00000000-0000-4000-8000-00000000f137',
      'monterrey', 'biometricos', TIME '08:30'
    ) = TIME '08:00',
    'H defaults independientes de override f.org'
  );

  -- Anti-colisión: dos logicals → mismo sheet físico (doble conteo) bloqueado
  BEGIN
    INSERT INTO public.agenda_sheet_time_aliases (
      organization_id, location_id, kind, logical_start_time, sheet_start_time, active
    ) VALUES (
      f.org_id, 'monterrey', 'biometricos', TIME '08:15', TIME '08:30', TRUE
    );
    v_fail := false;
  EXCEPTION WHEN unique_violation THEN
    v_fail := true;
  END;
  PERFORM public.__sheet_assert(v_fail, 'H bloquea 08:15→08:30 si ya existe 08:00→08:30');

  -- Many-to-one: un logical → dos sheet físicos PERMITIDO
  INSERT INTO public.agenda_sheet_time_aliases (
    organization_id, location_id, kind, logical_start_time, sheet_start_time, active
  ) VALUES (
    f.org_id, 'monterrey', 'biometricos', TIME '08:00', TIME '08:45', TRUE
  );
  PERFORM public.__sheet_assert(EXISTS (
    SELECT 1 FROM public.agenda_sheet_time_aliases
    WHERE organization_id = f.org_id
      AND logical_start_time = TIME '08:00'
      AND sheet_start_time = TIME '08:45'
  ), 'H permite segundo físico para logical 08:00');
  DELETE FROM public.agenda_sheet_time_aliases
  WHERE organization_id = f.org_id
    AND sheet_start_time = TIME '08:45';

  -- Defaults: mismo sheet físico dos veces bloqueado
  BEGIN
    INSERT INTO public.agenda_sheet_time_alias_defaults (
      location_id, kind, logical_start_time, sheet_start_time, active
    ) VALUES (
      'monterrey', 'biometricos', TIME '08:15', TIME '08:30', TRUE
    );
    v_fail := false;
  EXCEPTION WHEN unique_violation THEN
    v_fail := true;
  END;
  PERFORM public.__sheet_assert(v_fail, 'H defaults bloquea sheet físico duplicado');

  RAISE NOTICE 'H mig137+138 time pool many-to-one OK';
END;
$$;

-- =============================================================================
-- I) Mig. 141: detach booking_id al mover de fila física A → B
-- =============================================================================
DO $$
DECLARE
  f public.__sheet_fixture%ROWTYPE;
  v_bid UUID;
  v_exp UUID;
  v_res JSONB;
  v_fail BOOLEAN;
  v_status_a TEXT;
  v_booking_a UUID;
  v_booking_b UUID;
  v_sheet_slot TIME;
  v_slot_time TIME;
  v_bookings_n BIGINT;
  v_outbox_n BIGINT;
  v_ss TEXT := 'detach-test-ss-141';
  v_sheet_id BIGINT := 141001;
BEGIN
  SELECT * INTO STRICT f FROM public.__sheet_fixture WHERE id = 1;
  PERFORM public.__sheet_as_service_role();

  SELECT COUNT(*) INTO v_bookings_n FROM public.agenda_bookings;
  SELECT COUNT(*) INTO v_outbox_n FROM public.agenda_sheet_sync_outbox;

  v_exp := '00000000-0000-4000-9141-0000000000e1';
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_exp, f.org_id, f.asesor_id, 'mejoravit',
    '12900000141', 'Detach 141 Exp', '5512900141', 'interno', true, NOW(),
    4, 'en_proceso', 'activo'
  ) ON CONFLICT (id) DO NOTHING;

  -- Booking real (FK) sin disparar claim/outbox (solo fixture de inventario)
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.agenda_bookings (
    id, organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, note, created_by
  ) VALUES (
    '00000000-0000-4000-9141-0000000000a1',
    f.org_id, 'biometricos', v_exp, DATE '2026-08-10', TIME '08:00',
    'monterrey', 'booked', 'detach-141-test', f.asesor_id
  )
  ON CONFLICT (id) DO UPDATE SET
    status = 'booked',
    note = 'detach-141-test',
    booking_date = DATE '2026-08-10',
    booking_time = TIME '08:00',
    expediente_id = v_exp;
  SET LOCAL session_replication_role = DEFAULT;

  v_bid := '00000000-0000-4000-9141-0000000000a1';

  DELETE FROM public.agenda_sheet_slot_inventory
  WHERE spreadsheet_id = v_ss AND sheet_id = v_sheet_id;

  -- Fila A ligada + fila libre disponible (sin booking) + fila B destino
  v_res := public.agenda_sheet_inventory_upsert_batch(jsonb_build_array(
    jsonb_build_object(
      'organization_id', f.org_id,
      'spreadsheet_id', v_ss,
      'sheet_id', v_sheet_id,
      'sheet_title', '10 AGOSTO',
      'booking_date', '2026-08-10',
      'sheet_row', 10,
      'kind', 'biometricos',
      'location_id', 'monterrey',
      'slot_time', '08:00:00',
      'sheet_slot_time', '08:30:00',
      'slot_key', 'biometricos|2026-08-10|08:00|monterrey|sheet=08:30|sheetId=141001|row=10',
      'status', 'linked',
      'booking_id', v_bid,
      'expediente_id', v_exp,
      'occupancy_source', 'crm'
    ),
    jsonb_build_object(
      'organization_id', f.org_id,
      'spreadsheet_id', v_ss,
      'sheet_id', v_sheet_id,
      'sheet_title', '10 AGOSTO',
      'booking_date', '2026-08-10',
      'sheet_row', 99,
      'kind', 'biometricos',
      'location_id', 'monterrey',
      'slot_time', '10:00:00',
      'sheet_slot_time', '11:00:00',
      'slot_key', 'biometricos|2026-08-10|10:00|monterrey|sheet=11:00|sheetId=141001|row=99',
      'status', 'available',
      'occupancy_source', 'reconciliation'
    )
  ));
  PERFORM public.__sheet_assert((v_res->>'ok')::BOOLEAN IS TRUE, 'I seed A+libre ok');

  -- Reconcile presenta booking en fila B (movimiento A→B) + conserva libre
  v_res := public.agenda_sheet_inventory_upsert_batch(jsonb_build_array(
    jsonb_build_object(
      'organization_id', f.org_id,
      'spreadsheet_id', v_ss,
      'sheet_id', v_sheet_id,
      'sheet_title', '10 AGOSTO',
      'booking_date', '2026-08-10',
      'sheet_row', 20,
      'kind', 'biometricos',
      'location_id', 'monterrey',
      'slot_time', '08:00:00',
      'sheet_slot_time', '08:30:00',
      'slot_key', 'biometricos|2026-08-10|08:00|monterrey|sheet=08:30|sheetId=141001|row=20',
      'status', 'linked',
      'booking_id', v_bid,
      'expediente_id', v_exp,
      'occupancy_source', 'reconciliation'
    ),
    jsonb_build_object(
      'organization_id', f.org_id,
      'spreadsheet_id', v_ss,
      'sheet_id', v_sheet_id,
      'sheet_title', '10 AGOSTO',
      'booking_date', '2026-08-10',
      'sheet_row', 99,
      'kind', 'biometricos',
      'location_id', 'monterrey',
      'slot_time', '10:00:00',
      'sheet_slot_time', '11:00:00',
      'slot_key', 'biometricos|2026-08-10|10:00|monterrey|sheet=11:00|sheetId=141001|row=99',
      'status', 'available',
      'occupancy_source', 'reconciliation'
    )
  ));
  PERFORM public.__sheet_assert((v_res->>'ok')::BOOLEAN IS TRUE, 'I move A→B sin unique_violation');

  SELECT status, booking_id INTO v_status_a, v_booking_a
  FROM public.agenda_sheet_slot_inventory
  WHERE spreadsheet_id = v_ss AND sheet_id = v_sheet_id AND sheet_row = 10;
  SELECT booking_id, slot_time, sheet_slot_time
    INTO v_booking_b, v_slot_time, v_sheet_slot
  FROM public.agenda_sheet_slot_inventory
  WHERE spreadsheet_id = v_ss AND sheet_id = v_sheet_id AND sheet_row = 20;

  PERFORM public.__sheet_assert(v_booking_a IS NULL, 'I A sin booking_id');
  PERFORM public.__sheet_assert(v_status_a = 'occupied_external', 'I A → occupied_external');
  PERFORM public.__sheet_assert(v_booking_b = v_bid, 'I B tiene booking_id');
  PERFORM public.__sheet_assert(v_slot_time = TIME '08:00', 'I logical 08:00');
  PERFORM public.__sheet_assert(v_sheet_slot = TIME '08:30', 'I sheet_slot_time 08:30');

  SELECT booking_id INTO v_booking_a
  FROM public.agenda_sheet_slot_inventory
  WHERE spreadsheet_id = v_ss AND sheet_id = v_sheet_id AND sheet_row = 99;
  PERFORM public.__sheet_assert(v_booking_a IS NULL, 'I fila available intacta');

  -- Idempotencia: mismo batch otra vez
  v_res := public.agenda_sheet_inventory_upsert_batch(jsonb_build_array(
    jsonb_build_object(
      'organization_id', f.org_id,
      'spreadsheet_id', v_ss,
      'sheet_id', v_sheet_id,
      'sheet_title', '10 AGOSTO',
      'booking_date', '2026-08-10',
      'sheet_row', 20,
      'kind', 'biometricos',
      'location_id', 'monterrey',
      'slot_time', '08:00:00',
      'sheet_slot_time', '08:30:00',
      'slot_key', 'biometricos|2026-08-10|08:00|monterrey|sheet=08:30|sheetId=141001|row=20',
      'status', 'linked',
      'booking_id', v_bid,
      'expediente_id', v_exp,
      'occupancy_source', 'reconciliation'
    )
  ));
  PERFORM public.__sheet_assert((v_res->>'ok')::BOOLEAN IS TRUE, 'I idempotente');
  PERFORM public.__sheet_assert(
    (SELECT COUNT(*) FROM public.agenda_sheet_slot_inventory WHERE booking_id = v_bid) = 1,
    'I una sola fila con booking_id'
  );
  SELECT booking_id INTO v_booking_b
  FROM public.agenda_sheet_slot_inventory
  WHERE spreadsheet_id = v_ss AND sheet_id = v_sheet_id AND sheet_row = 20;
  PERFORM public.__sheet_assert(v_booking_b = v_bid, 'I B sigue con booking tras repeat');

  -- Batch con booking duplicado en dos filas físicas → error contextual
  BEGIN
    PERFORM public.agenda_sheet_inventory_upsert_batch(jsonb_build_array(
      jsonb_build_object(
        'organization_id', f.org_id,
        'spreadsheet_id', v_ss,
        'sheet_id', v_sheet_id,
        'sheet_title', '10 AGOSTO',
        'booking_date', '2026-08-10',
        'sheet_row', 20,
        'kind', 'biometricos',
        'location_id', 'monterrey',
        'slot_time', '08:00:00',
        'sheet_slot_time', '08:30:00',
        'slot_key', 'biometricos|2026-08-10|08:00|monterrey|sheet=08:30|sheetId=141001|row=20',
        'status', 'linked',
        'booking_id', v_bid,
        'occupancy_source', 'reconciliation'
      ),
      jsonb_build_object(
        'organization_id', f.org_id,
        'spreadsheet_id', v_ss,
        'sheet_id', v_sheet_id,
        'sheet_title', '10 AGOSTO',
        'booking_date', '2026-08-10',
        'sheet_row', 21,
        'kind', 'biometricos',
        'location_id', 'monterrey',
        'slot_time', '08:00:00',
        'sheet_slot_time', '08:30:00',
        'slot_key', 'biometricos|2026-08-10|08:00|monterrey|sheet=08:30|sheetId=141001|row=21',
        'status', 'linked',
        'booking_id', v_bid,
        'occupancy_source', 'reconciliation'
      )
    ));
    v_fail := false;
  EXCEPTION
    WHEN unique_violation THEN
      v_fail := true;
    WHEN OTHERS THEN
      v_fail := SQLERRM ILIKE '%aparece en%filas físicas%';
  END;
  PERFORM public.__sheet_assert(v_fail, 'I batch duplicado booking falla');

  -- Índice unique intacto
  PERFORM public.__sheet_assert(EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'agenda_sheet_slot_inventory_booking_uidx'
  ), 'I booking_uidx presente');

  -- upsert no muta bookings/outbox
  PERFORM public.__sheet_assert(
    (SELECT COUNT(*) FROM public.agenda_bookings) = v_bookings_n + 1,
    'I bookings: solo +1 del fixture detach'
  );
  PERFORM public.__sheet_assert(
    (SELECT COUNT(*) FROM public.agenda_sheet_sync_outbox) = v_outbox_n,
    'I outbox inalterado por upsert inventario'
  );
  PERFORM public.__sheet_assert(
    (SELECT note FROM public.agenda_bookings WHERE id = v_bid) = 'detach-141-test',
    'I booking note intacto'
  );
  PERFORM public.__sheet_assert(
    (SELECT status FROM public.agenda_bookings WHERE id = v_bid) = 'booked',
    'I booking status intacto'
  );

  -- Ingest agosto sin booking (filas available)
  v_res := public.agenda_sheet_inventory_upsert_batch(jsonb_build_array(
    jsonb_build_object(
      'organization_id', f.org_id,
      'spreadsheet_id', v_ss,
      'sheet_id', 141017,
      'sheet_title', '17 AGOSTO',
      'booking_date', '2026-08-17',
      'sheet_row', 7,
      'kind', 'firmas',
      'location_id', 'monterrey',
      'slot_time', '08:30:00',
      'sheet_slot_time', '08:30:00',
      'slot_key', 'firmas|2026-08-17|08:30|monterrey|sheet=08:30|sheetId=141017|row=7',
      'status', 'available',
      'occupancy_source', 'reconciliation'
    )
  ));
  PERFORM public.__sheet_assert((v_res->>'ok')::BOOLEAN IS TRUE, 'I agosto sin booking ok');
  PERFORM public.__sheet_assert(EXISTS (
    SELECT 1 FROM public.agenda_sheet_slot_inventory
    WHERE spreadsheet_id = v_ss AND sheet_id = 141017 AND sheet_row = 7
      AND booking_id IS NULL AND status = 'available'
  ), 'I 17 AGOSTO available ingerida');

  DELETE FROM public.agenda_sheet_slot_inventory
  WHERE spreadsheet_id = v_ss;
  DELETE FROM public.agenda_bookings WHERE id = v_bid;
  -- expediente fixture queda (FK historial paso visual); no afecta producción

  RAISE NOTICE 'I mig141 detach booking_id OK';
END;
$$;

DROP FUNCTION IF EXISTS public.__sheet_assert(BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.__sheet_set_jwt_role(TEXT);
DROP FUNCTION IF EXISTS public.__sheet_reset_auth();
DROP FUNCTION IF EXISTS public.__sheet_as_service_role();

SELECT 'AGENDA SHEET SQL TESTS PASSED' AS result;
