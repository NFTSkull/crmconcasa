-- ConCasa CRM — P119.2: concurrencia real de cupos (último lugar)
-- Método: extensión dblink + dos sesiones async (dblink_send_query) contra book_biometricos.
-- Barrera: LOCK TABLE ACCESS EXCLUSIVE en sesión controladora + ACCESS SHARE en workers
--   (al liberar EXCLUSIVE ambas workers avanzan juntas; sin sleep/polling).
-- Nota: setup/carrera/cleanup van en DO separados para que el fixture quede COMMITTED
--   y sea visible a las sesiones dblink (evita "expediente no encontrado").
-- Uso (requiere rol superuser local: supabase_admin — dblink no acepta non-superuser):
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U supabase_admin -d postgres \
--     -f supabase/tests/rpc_agenda_slot_capacity_concurrency_p1192.sql

\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS dblink;

CREATE OR REPLACE FUNCTION public.__p1192_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P119.2 CONC FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.__p1192_barrier (
  id INT PRIMARY KEY
);
INSERT INTO public.__p1192_barrier(id) VALUES (1)
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS public.__p1192_race_log (
  session_label TEXT PRIMARY KEY,
  ok BOOLEAN NOT NULL,
  err TEXT,
  booking_id UUID,
  finished_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.__p1192_fixture (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  org_id UUID NOT NULL,
  mesa_id UUID NOT NULL,
  asesor_id UUID NOT NULL,
  exp_a UUID NOT NULL,
  exp_b UUID NOT NULL,
  loc TEXT NOT NULL,
  slot_time TIME NOT NULL,
  slot_date DATE NOT NULL,
  slot2_date DATE NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  scheduled2_at TIMESTAMPTZ NOT NULL,
  cfg_backup JSONB,
  winner_id UUID,
  loser_id UUID
);

GRANT ALL ON TABLE public.__p1192_barrier TO authenticated;
GRANT ALL ON TABLE public.__p1192_race_log TO authenticated;

-- =============================================================================
-- 1) Setup (commit al terminar el DO → visible a dblink)
-- =============================================================================
DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000001';
  v_mesa UUID := '00000000-0000-4000-8003-000000000001';
  v_asesor UUID := '00000000-0000-4000-8001-000000000001';
  v_exp_a UUID := '00000000-0000-4000-9119-0000000000a1';
  v_exp_b UUID := '00000000-0000-4000-9119-0000000000b2';
  v_loc TEXT := 'sede-centro';
  v_slot_time TIME := '11:00';
  v_scheduled TIMESTAMPTZ;
  v_scheduled2 TIMESTAMPTZ;
  v_slot_date DATE;
  v_slot2_date DATE;
  v_cfg_backup JSONB;
  v_cap INTEGER;
  v_booked INTEGER;
  v_avail INTEGER;
BEGIN
  PERFORM public.__p1192_assert(
    to_regprocedure('public.book_biometricos(uuid,timestamptz,text,text)') IS NOT NULL,
    'book_biometricos debe existir'
  );
  PERFORM public.__p1192_assert(
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_asesor AND p.app_role = 'asesor'),
    'fixture asesor requerido'
  );
  PERFORM public.__p1192_assert(
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_mesa AND p.app_role = 'mesa_admin'),
    'fixture mesa_admin requerido'
  );

  SELECT ac.config INTO v_cfg_backup
  FROM public.agenda_config ac
  WHERE ac.organization_id = v_org AND ac.kind = 'biometricos';

  INSERT INTO public.agenda_config (organization_id, kind, config)
  VALUES (
    v_org, 'biometricos',
    jsonb_build_object(
      'enabled', true,
      'timezone', 'America/Monterrey',
      'min_lead_hours', 1,
      'allowed_weekdays', jsonb_build_array(1, 2, 3, 4, 5, 6, 7),
      'slots', jsonb_build_array('09:00', '10:00', '11:00', '12:00'),
      'locations', jsonb_build_object(
        v_loc, jsonb_build_object('enabled', true, 'capacity_per_slot', 8)
      )
    )
  )
  ON CONFLICT (organization_id, kind) DO UPDATE SET config = EXCLUDED.config;

  v_scheduled := public.agenda_biometricos_slot_ts(1, '11:00', 14, 'America/Monterrey');
  v_scheduled2 := public.agenda_biometricos_slot_ts(2, '11:00', 15, 'America/Monterrey');
  v_slot_date := (v_scheduled AT TIME ZONE 'America/Monterrey')::DATE;
  v_slot2_date := (v_scheduled2 AT TIME ZONE 'America/Monterrey')::DATE;

  DELETE FROM public.agenda_bookings WHERE expediente_id IN (v_exp_a, v_exp_b);
  DELETE FROM public.agenda_slot_capacities
  WHERE organization_id = v_org
    AND kind = 'biometricos'
    AND location_id = v_loc
    AND slot_date IN (v_slot_date, v_slot2_date)
    AND slot_time = v_slot_time;
  DELETE FROM public.__p1192_race_log;
  DELETE FROM public.__p1192_fixture;

  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, ciclo_estado
  ) VALUES
    (
      v_exp_a, v_org, v_asesor, 'mejoravit', '11920000001',
      'P119.2 Conc A', '5511920001', 'interno', true, NOW(),
      3, 'en_proceso', 'activo'
    ),
    (
      v_exp_b, v_org, v_asesor, 'mejoravit', '11920000002',
      'P119.2 Conc B', '5511920002', 'interno', true, NOW(),
      3, 'en_proceso', 'activo'
    )
  ON CONFLICT (id) DO UPDATE SET
    asesor_id = EXCLUDED.asesor_id,
    etapa_actual = 3,
    subestado = 'en_proceso',
    ciclo_estado = 'activo',
    submitted_to_mesa = true,
    deleted_at = NULL,
    fecha_cita = NULL;

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_mesa::text, true);
  PERFORM public.upsert_agenda_slot_capacity(
    'biometricos', v_loc, v_slot_date, v_slot_time, 1, true
  );
  PERFORM public.upsert_agenda_slot_capacity(
    'biometricos', v_loc, v_slot2_date, v_slot_time, 1, true
  );
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RESET ROLE;

  SELECT c.capacity,
         public.agenda_count_slot_booked(v_org, 'biometricos', v_slot_date, v_slot_time, v_loc),
         GREATEST(
           0,
           c.capacity - public.agenda_count_slot_booked(v_org, 'biometricos', v_slot_date, v_slot_time, v_loc)
         )
  INTO v_cap, v_booked, v_avail
  FROM public.agenda_slot_capacities c
  WHERE c.organization_id = v_org
    AND c.kind = 'biometricos'
    AND c.location_id = v_loc
    AND c.slot_date = v_slot_date
    AND c.slot_time = v_slot_time
    AND c.active;

  PERFORM public.__p1192_assert(v_cap = 1 AND v_booked = 0 AND v_avail = 1, 'antes: cap=1 booked=0 avail=1');

  INSERT INTO public.__p1192_fixture (
    id, org_id, mesa_id, asesor_id, exp_a, exp_b, loc, slot_time,
    slot_date, slot2_date, scheduled_at, scheduled2_at, cfg_backup
  ) VALUES (
    1, v_org, v_mesa, v_asesor, v_exp_a, v_exp_b, v_loc, v_slot_time,
    v_slot_date, v_slot2_date, v_scheduled, v_scheduled2, v_cfg_backup
  );

  RAISE NOTICE 'P119.2 setup OK: slot=% % loc=% avail=1', v_slot_date, v_slot_time, v_loc;
END;
$$;

-- =============================================================================
-- 2) Carrera concurrente real (fixture ya committed)
-- =============================================================================
DO $$
DECLARE
  f public.__p1192_fixture%ROWTYPE;
  v_conn TEXT := 'dbname=postgres';
  v_sql_a TEXT;
  v_sql_b TEXT;
  v_ok_a BOOLEAN;
  v_ok_b BOOLEAN;
  v_err_a TEXT;
  v_err_b TEXT;
  v_booked INTEGER;
  v_cap INTEGER;
  v_avail INTEGER;
  v_winner UUID;
  v_loser UUID;
  v_res RECORD;
BEGIN
  SELECT * INTO STRICT f FROM public.__p1192_fixture WHERE id = 1;

  IF dblink_get_connections() IS NOT NULL THEN
    PERFORM dblink_disconnect(conn)
    FROM unnest(dblink_get_connections()) AS conn
    WHERE conn LIKE 'p1192_%';
  END IF;

  PERFORM dblink_connect('p1192_ctrl', v_conn);
  PERFORM dblink_connect('p1192_a', v_conn);
  PERFORM dblink_connect('p1192_b', v_conn);

  PERFORM dblink_exec('p1192_ctrl', 'BEGIN');
  PERFORM dblink_exec(
    'p1192_ctrl',
    'LOCK TABLE public.__p1192_barrier IN ACCESS EXCLUSIVE MODE'
  );

  v_sql_a := format(
    $q$
    DO $worker$
    BEGIN
      PERFORM set_config('role', 'authenticated', true);
      PERFORM set_config('request.jwt.claim.sub', %L, true);
      LOCK TABLE public.__p1192_barrier IN ACCESS SHARE MODE;
      BEGIN
        INSERT INTO public.__p1192_race_log(session_label, ok, err, booking_id)
        SELECT 'A', true, NULL, (public.book_biometricos(%L::uuid, %L::timestamptz, %L, 'race-a')->>'booking_id')::uuid;
      EXCEPTION WHEN OTHERS THEN
        INSERT INTO public.__p1192_race_log(session_label, ok, err, booking_id)
        VALUES ('A', false, SQLERRM, NULL)
        ON CONFLICT (session_label) DO UPDATE
          SET ok = EXCLUDED.ok, err = EXCLUDED.err, booking_id = EXCLUDED.booking_id, finished_at = NOW();
      END;
    END;
    $worker$;
    $q$,
    f.asesor_id::text, f.exp_a::text, f.scheduled_at::text, f.loc
  );

  v_sql_b := format(
    $q$
    DO $worker$
    BEGIN
      PERFORM set_config('role', 'authenticated', true);
      PERFORM set_config('request.jwt.claim.sub', %L, true);
      LOCK TABLE public.__p1192_barrier IN ACCESS SHARE MODE;
      BEGIN
        INSERT INTO public.__p1192_race_log(session_label, ok, err, booking_id)
        SELECT 'B', true, NULL, (public.book_biometricos(%L::uuid, %L::timestamptz, %L, 'race-b')->>'booking_id')::uuid;
      EXCEPTION WHEN OTHERS THEN
        INSERT INTO public.__p1192_race_log(session_label, ok, err, booking_id)
        VALUES ('B', false, SQLERRM, NULL)
        ON CONFLICT (session_label) DO UPDATE
          SET ok = EXCLUDED.ok, err = EXCLUDED.err, booking_id = EXCLUDED.booking_id, finished_at = NOW();
      END;
    END;
    $worker$;
    $q$,
    f.asesor_id::text, f.exp_b::text, f.scheduled_at::text, f.loc
  );

  PERFORM public.__p1192_assert(dblink_send_query('p1192_a', v_sql_a) = 1, 'send A');
  PERFORM public.__p1192_assert(dblink_send_query('p1192_b', v_sql_b) = 1, 'send B');

  PERFORM dblink_exec('p1192_ctrl', 'COMMIT');

  LOOP
    SELECT * INTO v_res FROM dblink_get_result('p1192_a') AS t(status text);
    EXIT WHEN NOT FOUND;
  END LOOP;
  LOOP
    SELECT * INTO v_res FROM dblink_get_result('p1192_b') AS t(status text);
    EXIT WHEN NOT FOUND;
  END LOOP;

  SELECT ok, err INTO v_ok_a, v_err_a FROM public.__p1192_race_log WHERE session_label = 'A';
  SELECT ok, err INTO v_ok_b, v_err_b FROM public.__p1192_race_log WHERE session_label = 'B';

  PERFORM public.__p1192_assert(v_ok_a IS NOT NULL AND v_ok_b IS NOT NULL, 'ambas sesiones registraron resultado');
  PERFORM public.__p1192_assert(
    (v_ok_a AND NOT v_ok_b) OR (v_ok_b AND NOT v_ok_a),
    format('exactamente una gana (A=%s B=%s errA=%s errB=%s)', v_ok_a, v_ok_b, coalesce(v_err_a,'-'), coalesce(v_err_b,'-'))
  );

  IF v_ok_a THEN
    v_winner := f.exp_a;
    v_loser := f.exp_b;
    PERFORM public.__p1192_assert(coalesce(v_err_b, '') ILIKE '%cupo agotado%', 'perdedor: error canónico cupo agotado');
  ELSE
    v_winner := f.exp_b;
    v_loser := f.exp_a;
    PERFORM public.__p1192_assert(coalesce(v_err_a, '') ILIKE '%cupo agotado%', 'perdedor: error canónico cupo agotado');
  END IF;

  SELECT count(*)::int INTO v_booked
  FROM public.agenda_bookings b
  WHERE b.organization_id = f.org_id
    AND b.kind = 'biometricos'
    AND b.status = 'booked'
    AND b.booking_date = f.slot_date
    AND b.booking_time = f.slot_time
    AND b.location_id = f.loc;

  PERFORM public.__p1192_assert(v_booked = 1, 'después carrera: exactamente 1 booked en el slot');

  SELECT c.capacity,
         GREATEST(
           0,
           c.capacity - public.agenda_count_slot_booked(f.org_id, 'biometricos', f.slot_date, f.slot_time, f.loc)
         )
  INTO v_cap, v_avail
  FROM public.agenda_slot_capacities c
  WHERE c.organization_id = f.org_id
    AND c.kind = 'biometricos'
    AND c.location_id = f.loc
    AND c.slot_date = f.slot_date
    AND c.slot_time = f.slot_time
    AND c.active;

  PERFORM public.__p1192_assert(v_cap = 1 AND v_avail = 0, 'después carrera: cap=1 avail=0 (sin sobrecupo)');

  PERFORM public.__p1192_assert(
    EXISTS (
      SELECT 1 FROM public.agenda_bookings b
      WHERE b.expediente_id = v_winner AND b.status = 'booked' AND b.kind = 'biometricos'
    ),
    'ganador tiene booking activo'
  );
  PERFORM public.__p1192_assert(
    NOT EXISTS (
      SELECT 1 FROM public.agenda_bookings b
      WHERE b.expediente_id = v_loser AND b.status = 'booked' AND b.kind = 'biometricos'
    ),
    'perdedor sin booking activo'
  );

  UPDATE public.__p1192_fixture SET winner_id = v_winner, loser_id = v_loser WHERE id = 1;

  PERFORM dblink_disconnect('p1192_a');
  PERFORM dblink_disconnect('p1192_b');
  PERFORM dblink_disconnect('p1192_ctrl');

  RAISE NOTICE 'P119.2 race OK: winner=% loser=% booked=1 avail=0', v_winner, v_loser;
END;
$$;

-- =============================================================================
-- 3) Cancel + reagenda (RPC canónicas)
-- =============================================================================
DO $$
DECLARE
  f public.__p1192_fixture%ROWTYPE;
  v_cancel JSONB;
  v_reag JSONB;
  v_booked INTEGER;
  v_avail INTEGER;
BEGIN
  SELECT * INTO STRICT f FROM public.__p1192_fixture WHERE id = 1;
  PERFORM public.__p1192_assert(f.winner_id IS NOT NULL, 'winner_id requerido');

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', f.asesor_id::text, true);
  SELECT public.cancel_biometricos(f.winner_id, 'p1192 liberar cupo') INTO v_cancel;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RESET ROLE;

  PERFORM public.__p1192_assert(COALESCE((v_cancel->>'ok')::boolean, false), 'cancel RPC ok');

  SELECT count(*)::int INTO v_booked
  FROM public.agenda_bookings b
  WHERE b.organization_id = f.org_id
    AND b.kind = 'biometricos'
    AND b.status = 'booked'
    AND b.booking_date = f.slot_date
    AND b.booking_time = f.slot_time
    AND b.location_id = f.loc;
  PERFORM public.__p1192_assert(v_booked = 0, 'tras cancel: booked=0 en slot');

  SELECT GREATEST(
           0,
           c.capacity - public.agenda_count_slot_booked(f.org_id, 'biometricos', f.slot_date, f.slot_time, f.loc)
         )
  INTO v_avail
  FROM public.agenda_slot_capacities c
  WHERE c.organization_id = f.org_id
    AND c.kind = 'biometricos'
    AND c.location_id = f.loc
    AND c.slot_date = f.slot_date
    AND c.slot_time = f.slot_time
    AND c.active;
  PERFORM public.__p1192_assert(v_avail = 1, 'tras cancel: available=1');

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', f.asesor_id::text, true);
  PERFORM public.book_biometricos(f.winner_id, f.scheduled_at, f.loc, 'p1192 rebook');
  SELECT public.reagendar_biometricos(f.winner_id, f.scheduled2_at, f.loc, 'p1192 reagenda') INTO v_reag;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  RESET ROLE;

  PERFORM public.__p1192_assert(COALESCE((v_reag->>'ok')::boolean, false), 'reagendar RPC ok');

  SELECT count(*)::int INTO v_booked
  FROM public.agenda_bookings b
  WHERE b.organization_id = f.org_id
    AND b.kind = 'biometricos'
    AND b.status = 'booked'
    AND b.booking_date = f.slot_date
    AND b.booking_time = f.slot_time
    AND b.location_id = f.loc;
  PERFORM public.__p1192_assert(v_booked = 0, 'tras reagenda: slot anterior libre');

  SELECT count(*)::int INTO v_booked
  FROM public.agenda_bookings b
  WHERE b.organization_id = f.org_id
    AND b.kind = 'biometricos'
    AND b.status = 'booked'
    AND b.booking_date = f.slot2_date
    AND b.booking_time = f.slot_time
    AND b.location_id = f.loc;
  PERFORM public.__p1192_assert(v_booked = 1, 'tras reagenda: nuevo slot ocupado=1');

  PERFORM public.__p1192_assert(
    (
      SELECT count(*)::int
      FROM public.agenda_bookings b
      WHERE b.expediente_id = f.winner_id AND b.kind = 'biometricos' AND b.status = 'booked'
    ) = 1,
    'nunca dos bookings activos del ganador'
  );

  RAISE NOTICE 'P119.2 cancel+reagenda OK';
END;
$$;

-- =============================================================================
-- 4) Cleanup + restaurar agenda_config
-- =============================================================================
DO $$
DECLARE
  f public.__p1192_fixture%ROWTYPE;
BEGIN
  SELECT * INTO STRICT f FROM public.__p1192_fixture WHERE id = 1;

  DELETE FROM public.action_log
  WHERE entity_type = 'agenda_booking'
    AND entity_id IN (
      SELECT b.id FROM public.agenda_bookings b WHERE b.expediente_id IN (f.exp_a, f.exp_b)
    );
  DELETE FROM public.agenda_bookings WHERE expediente_id IN (f.exp_a, f.exp_b);
  DELETE FROM public.agenda_slot_capacities
  WHERE organization_id = f.org_id
    AND kind = 'biometricos'
    AND location_id = f.loc
    AND slot_date IN (f.slot_date, f.slot2_date)
    AND slot_time = f.slot_time;
  DELETE FROM public.expediente_paso_visual_transiciones
  WHERE expediente_id IN (f.exp_a, f.exp_b);
  DELETE FROM public.action_log
  WHERE entity_id IN (f.exp_a, f.exp_b);
  -- Soft-delete si quedan FKs residuales; hard-delete cuando sea posible
  BEGIN
    DELETE FROM public.expedientes WHERE id IN (f.exp_a, f.exp_b);
  EXCEPTION WHEN foreign_key_violation THEN
    UPDATE public.expedientes
    SET deleted_at = NOW(), ciclo_estado = 'cerrado', updated_at = NOW()
    WHERE id IN (f.exp_a, f.exp_b);
  END;
  DELETE FROM public.__p1192_race_log;
  DELETE FROM public.__p1192_fixture;

  IF f.cfg_backup IS NOT NULL THEN
    UPDATE public.agenda_config
    SET config = f.cfg_backup
    WHERE organization_id = f.org_id AND kind = 'biometricos';
  END IF;

  RAISE NOTICE 'P119.2 concurrency cupos: OK (cleanup done)';
END;
$$;

DROP FUNCTION public.__p1192_assert(BOOLEAN, TEXT);
