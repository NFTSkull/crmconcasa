-- ConCasa CRM — P118: cupos por horario (agenda_slot_capacities)
-- Uso: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/rpc_agenda_slot_capacities.sql

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__p118_cap_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P118 CAP TEST FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p118_cap_set_auth(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p118_cap_reset_auth()
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000001';
  v_mesa UUID := '00000000-0000-4000-8003-000000000001';
  v_asesor UUID := '00000000-0000-4000-8001-000000000001';
  v_exp UUID := '00000000-0000-4000-9118-000000000010';
  v_exp2 UUID := '00000000-0000-4000-9118-000000000011';
  v_slot_date DATE := (CURRENT_DATE + 14);
  v_slot_time TIME := '09:00';
  v_loc TEXT := 'monterrey';
  v_upsert JSONB;
  v_occ INTEGER;
  v_cap INTEGER;
  v_avail INTEGER;
  v_fail BOOLEAN;
BEGIN
  PERFORM public.__p118_cap_assert(
    to_regprocedure('public.upsert_agenda_slot_capacity(public.booking_kind,text,date,time,integer,boolean)') IS NOT NULL,
    'RPC upsert_agenda_slot_capacity debe existir (migración 103)'
  );
  PERFORM public.__p118_cap_assert(
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_mesa AND p.app_role = 'mesa_admin'),
    'fixture mesa_admin requerido'
  );

  DELETE FROM public.agenda_bookings WHERE expediente_id IN (v_exp, v_exp2);
  DELETE FROM public.agenda_slot_capacities
  WHERE organization_id = v_org
    AND kind = 'biometricos'
    AND location_id = v_loc
    AND slot_date = v_slot_date
    AND slot_time = v_slot_time;

  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '11800000001',
    'Fixture P118 Cap', '5511800001', 'interno', true, NOW(),
    4, 'en_proceso', 'activo'
  )
  ON CONFLICT (id) DO UPDATE SET
    asesor_id = EXCLUDED.asesor_id,
    etapa_actual = 4,
    subestado = 'en_proceso',
    ciclo_estado = 'activo',
    submitted_to_mesa = true,
    deleted_at = NULL,
    fecha_cita = NULL;

  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_exp2, v_org, v_asesor, 'mejoravit', '11800000002',
    'Fixture P118 Cap2', '5511800002', 'interno', true, NOW(),
    4, 'en_proceso', 'activo'
  )
  ON CONFLICT (id) DO UPDATE SET
    asesor_id = EXCLUDED.asesor_id,
    etapa_actual = 4,
    subestado = 'en_proceso',
    ciclo_estado = 'activo',
    submitted_to_mesa = true,
    deleted_at = NULL,
    fecha_cita = NULL;

  -- 1) Crear cupo capacity=2
  PERFORM public.__p118_cap_set_auth(v_mesa);
  SELECT public.upsert_agenda_slot_capacity(
    'biometricos', v_loc, v_slot_date, v_slot_time, 2, true
  ) INTO v_upsert;
  PERFORM public.__p118_cap_reset_auth();
  PERFORM public.__p118_cap_assert(COALESCE((v_upsert->>'ok')::BOOLEAN, false), 'upsert cupo ok');

  -- 2) Ocupar 1
  INSERT INTO public.agenda_bookings (
    organization_id, expediente_id, kind, status,
    booking_date, booking_time, location_id, created_by
  ) VALUES (
    v_org, v_exp, 'biometricos', 'booked',
    v_slot_date, v_slot_time, v_loc, v_asesor
  );

  PERFORM public.__p118_cap_set_auth(v_mesa);
  SELECT occupied, capacity, available INTO v_occ, v_cap, v_avail
  FROM public.list_agenda_slot_capacities('biometricos', v_slot_date, v_loc)
  WHERE location_id = v_loc AND slot_time = v_slot_time
  LIMIT 1;
  PERFORM public.__p118_cap_reset_auth();
  PERFORM public.__p118_cap_assert(v_occ = 1, format('ocupados=1 got %s', v_occ));
  PERFORM public.__p118_cap_assert(v_cap = 2, format('capacidad=2 got %s', v_cap));
  PERFORM public.__p118_cap_assert(v_avail = 1, format('disponibles=1 got %s', v_avail));

  -- 3) No bajar capacidad bajo ocupados
  v_fail := false;
  PERFORM public.__p118_cap_set_auth(v_mesa);
  BEGIN
    PERFORM public.upsert_agenda_slot_capacity(
      'biometricos', v_loc, v_slot_date, v_slot_time, 0, true
    );
  EXCEPTION WHEN OTHERS THEN
    v_fail := true;
  END;
  PERFORM public.__p118_cap_reset_auth();
  PERFORM public.__p118_cap_assert(v_fail, 'debe rechazar capacidad < ocupados');

  -- Llenar cupo
  INSERT INTO public.agenda_bookings (
    organization_id, expediente_id, kind, status,
    booking_date, booking_time, location_id, created_by
  ) VALUES (
    v_org, v_exp2, 'biometricos', 'booked',
    v_slot_date, v_slot_time, v_loc, v_asesor
  );

  PERFORM public.__p118_cap_set_auth(v_mesa);
  SELECT occupied, available INTO v_occ, v_avail
  FROM public.list_agenda_slot_capacities('biometricos', v_slot_date, v_loc)
  WHERE location_id = v_loc AND slot_time = v_slot_time
  LIMIT 1;
  PERFORM public.__p118_cap_reset_auth();
  PERFORM public.__p118_cap_assert(v_occ = 2 AND v_avail = 0, 'cupo agotado: occupied=2 available=0');

  -- Intentar bajar a 1 con 2 ocupados → STOP
  v_fail := false;
  PERFORM public.__p118_cap_set_auth(v_mesa);
  BEGIN
    PERFORM public.upsert_agenda_slot_capacity(
      'biometricos', v_loc, v_slot_date, v_slot_time, 1, true
    );
  EXCEPTION WHEN OTHERS THEN
    v_fail := true;
  END;
  PERFORM public.__p118_cap_reset_auth();
  PERFORM public.__p118_cap_assert(v_fail, 'no bajar capacidad bajo ocupados (2)');

  DELETE FROM public.agenda_bookings WHERE expediente_id IN (v_exp, v_exp2);
  DELETE FROM public.agenda_slot_capacities
  WHERE organization_id = v_org
    AND kind = 'biometricos'
    AND location_id = v_loc
    AND slot_date = v_slot_date
    AND slot_time = v_slot_time;

  RAISE NOTICE 'P118 rpc_agenda_slot_capacities: OK';
END;
$$;
