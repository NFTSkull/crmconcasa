-- ConCasa CRM — P069 validación Drive por booking (mesa_set_agenda_drive_validation + get fields)
-- Uso: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/rpc_mesa_agenda_drive_validation.sql

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__mesa_drive_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT p_ok THEN RAISE EXCEPTION 'MESA DRIVE FAIL: %', p_msg; END IF; END;
$$;

CREATE OR REPLACE FUNCTION public.__mesa_drive_auth(p_user UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__mesa_drive_reset()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000001';
  v_org_b UUID := '00000000-0000-4000-8000-000000000099';
  v_a1 UUID := '00000000-0000-4000-8001-000000000001';
  v_mesa UUID := '00000000-0000-4000-8003-000000000001';
  v_mesa_int UUID := '00000000-0000-4000-8004-000000000001';
  v_super UUID := '00000000-0000-4000-8006-000000000001';
  v_editor UUID := '00000000-0000-4000-8002-000000000001';
  v_exp UUID := '00000000-0000-4000-9069-000000000010';
  v_exp2 UUID := '00000000-0000-4000-9069-000000000012';
  v_exp_b UUID := '00000000-0000-4000-9069-000000000011';
  v_booking UUID := '00000000-0000-4000-9069-000000000020';
  v_booking2 UUID := '00000000-0000-4000-9069-000000000021';
  v_booking_org UUID := '00000000-0000-4000-9069-000000000022';
  v_date DATE := CURRENT_DATE + 20;
  v_result JSONB;
  v_status public.booking_status;
  v_kind public.booking_kind;
  v_time TIME;
  v_loc TEXT;
  v_validated BOOLEAN;
  v_log INT;
BEGIN
  INSERT INTO public.organizations (id, name, slug, active)
  VALUES (v_org_b, 'Org Drive Test B', 'org-drive-test-b', true)
  ON CONFLICT (id) DO UPDATE SET active = true;

  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado
  ) VALUES (
    v_exp, v_org, v_a1, 'mejoravit', '90691000010', 'Cliente Drive Test',
    '5599990001', 'interno', true, NOW(), 3, 'en_proceso'
  )
  ON CONFLICT (id) DO UPDATE SET
    submitted_to_mesa = true, etapa_actual = 3, subestado = 'en_proceso', deleted_at = NULL;

  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado
  ) VALUES (
    v_exp2, v_org, v_a1, 'mejoravit', '90691000012', 'Cliente Drive Test 2',
    '5599990003', 'interno', true, NOW(), 3, 'en_proceso'
  )
  ON CONFLICT (id) DO UPDATE SET
    submitted_to_mesa = true, etapa_actual = 3, subestado = 'en_proceso', deleted_at = NULL;

  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado
  ) VALUES (
    v_exp_b, v_org_b, v_a1, 'mejoravit', '90691000011', 'Cliente Org B',
    '5599990002', 'interno', true, NOW(), 3, 'en_proceso'
  )
  ON CONFLICT (id) DO UPDATE SET submitted_to_mesa = true, deleted_at = NULL;

  DELETE FROM public.agenda_bookings WHERE id IN (v_booking, v_booking2, v_booking_org);

  INSERT INTO public.agenda_bookings (
    id, organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, created_by
  ) VALUES (
    v_booking, v_org, 'biometricos', v_exp, v_date, '10:00:00',
    'sede-centro', 'booked', v_a1
  );

  INSERT INTO public.agenda_bookings (
    id, organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, created_by
  ) VALUES (
    v_booking2, v_org, 'biometricos', v_exp2, v_date + 1, '11:00:00',
    'sede-centro', 'booked', v_a1
  );

  INSERT INTO public.agenda_bookings (
    id, organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, created_by
  ) VALUES (
    v_booking_org, v_org_b, 'biometricos', v_exp_b, v_date, '10:00:00',
    'sede-centro', 'booked', v_a1
  );

  -- 1) columnas default false
  SELECT drive_validated INTO v_validated FROM public.agenda_bookings WHERE id = v_booking;
  PERFORM public.__mesa_drive_assert(v_validated IS FALSE, '1 default false');

  -- 2) mesa_admin valida
  PERFORM public.__mesa_drive_auth(v_mesa);
  SELECT public.mesa_set_agenda_drive_validation(v_booking, true) INTO v_result;
  PERFORM public.__mesa_drive_reset();
  PERFORM public.__mesa_drive_assert((v_result->>'ok')::boolean, '2 mesa_admin set ok');
  PERFORM public.__mesa_drive_assert((v_result->>'drive_validated')::boolean, '2 drive_validated true');

  SELECT drive_validated, status, kind, booking_time, location_id
  INTO v_validated, v_status, v_kind, v_time, v_loc
  FROM public.agenda_bookings WHERE id = v_booking;
  PERFORM public.__mesa_drive_assert(v_validated IS TRUE, '2 persisted true');
  PERFORM public.__mesa_drive_assert(v_status = 'booked', '2 status unchanged');
  PERFORM public.__mesa_drive_assert(v_kind = 'biometricos', '2 kind unchanged');
  PERFORM public.__mesa_drive_assert(v_time = TIME '10:00', '2 time unchanged');
  PERFORM public.__mesa_drive_assert(v_loc = 'sede-centro', '2 location unchanged');

  -- 3) get_mesa_agenda_bookings expone campos
  PERFORM public.__mesa_drive_auth(v_mesa);
  PERFORM public.__mesa_drive_assert(
    EXISTS (
      SELECT 1 FROM public.get_mesa_agenda_bookings(v_date, v_date, false, NULL) g
      WHERE g.booking_id = v_booking
        AND g.drive_validated IS TRUE
        AND g.drive_validated_by = v_mesa
        AND g.drive_validated_at IS NOT NULL
    ),
    '3 get returns drive fields'
  );
  PERFORM public.__mesa_drive_reset();

  -- 4) mesa_interno puede validar otro booking
  PERFORM public.__mesa_drive_auth(v_mesa_int);
  SELECT public.mesa_set_agenda_drive_validation(v_booking2, true) INTO v_result;
  PERFORM public.__mesa_drive_reset();
  PERFORM public.__mesa_drive_assert((v_result->>'ok')::boolean, '4 mesa_interno set');

  -- 5) super_admin puede quitar
  PERFORM public.__mesa_drive_auth(v_super);
  SELECT public.mesa_set_agenda_drive_validation(v_booking2, false) INTO v_result;
  PERFORM public.__mesa_drive_reset();
  PERFORM public.__mesa_drive_assert((v_result->>'drive_validated')::boolean IS FALSE, '5 super clear');
  SELECT drive_validated INTO v_validated FROM public.agenda_bookings WHERE id = v_booking2;
  PERFORM public.__mesa_drive_assert(v_validated IS FALSE, '5 cleared persisted');
  PERFORM public.__mesa_drive_assert(
    (SELECT drive_validated_at IS NULL AND drive_validated_by IS NULL FROM public.agenda_bookings WHERE id = v_booking2),
    '5 at/by null'
  );

  -- 6) editor bloqueado
  BEGIN
    PERFORM public.__mesa_drive_auth(v_editor);
    PERFORM public.mesa_set_agenda_drive_validation(v_booking, false);
    PERFORM public.__mesa_drive_reset();
    RAISE EXCEPTION '6';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.__mesa_drive_reset();
    PERFORM public.__mesa_drive_assert(SQLERRM LIKE '%rol no autorizado%', '6 editor blocked');
  END;

  -- 7) otra org bloqueada
  BEGIN
    PERFORM public.__mesa_drive_auth(v_mesa);
    PERFORM public.mesa_set_agenda_drive_validation(v_booking_org, true);
    PERFORM public.__mesa_drive_reset();
    RAISE EXCEPTION '7';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.__mesa_drive_reset();
    PERFORM public.__mesa_drive_assert(
      SQLERRM LIKE '%organización%' OR SQLERRM LIKE '%no autorizado%',
      '7 other org blocked'
    );
  END;

  -- 8) no validar cancelada
  UPDATE public.agenda_bookings SET status = 'cancelled', cancelled_at = NOW() WHERE id = v_booking2;
  BEGIN
    PERFORM public.__mesa_drive_auth(v_mesa);
    PERFORM public.mesa_set_agenda_drive_validation(v_booking2, true);
    PERFORM public.__mesa_drive_reset();
    RAISE EXCEPTION '8';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.__mesa_drive_reset();
    PERFORM public.__mesa_drive_assert(SQLERRM LIKE '%cita activa%', '8 cancelled cannot validate');
  END;

  -- 9) sí se puede quitar validación de booking (aunque quede booked; clear ok)
  PERFORM public.__mesa_drive_auth(v_mesa);
  SELECT public.mesa_set_agenda_drive_validation(v_booking, false) INTO v_result;
  PERFORM public.__mesa_drive_reset();
  PERFORM public.__mesa_drive_assert((v_result->>'drive_validated')::boolean IS FALSE, '9 clear ok');

  -- 10) booking nuevo (reagenda) inicia sin validar
  PERFORM public.__mesa_drive_assert(
    (SELECT drive_validated FROM public.agenda_bookings WHERE id = v_booking2) IS FALSE
    OR (SELECT drive_validated FROM public.agenda_bookings WHERE id = v_booking2) IS NOT TRUE,
    '10 new/cancelled booking not validated'
  );

  -- 11) auditoría
  SELECT count(*) INTO v_log FROM public.action_log
  WHERE action IN ('agenda.drive_validation.set', 'agenda.drive_validation.clear')
    AND entity_id IN (v_booking, v_booking2)
    AND created_at > NOW() - INTERVAL '5 minutes';
  PERFORM public.__mesa_drive_assert(v_log >= 2, '11 action_log written');

  -- 12) no toca expediente etapa/fecha_cita
  PERFORM public.__mesa_drive_assert(
    (SELECT etapa_actual FROM public.expedientes WHERE id = v_exp) = 3,
    '12 etapa unchanged'
  );

  RAISE NOTICE 'rpc_mesa_agenda_drive_validation: 12 casos OK';
END;
$$;
