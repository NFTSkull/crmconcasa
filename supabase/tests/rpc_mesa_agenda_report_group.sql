-- ConCasa CRM — P109 report_group Excel (mesa_set_agenda_booking_report_group + get fields)
-- Uso: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/rpc_mesa_agenda_report_group.sql

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__mesa_rg_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT p_ok THEN RAISE EXCEPTION 'MESA REPORT_GROUP FAIL: %', p_msg; END IF; END;
$$;

CREATE OR REPLACE FUNCTION public.__mesa_rg_auth(p_user UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__mesa_rg_reset()
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
  v_exp UUID := '00000000-0000-4000-9109-000000000010';
  v_exp2 UUID := '00000000-0000-4000-9109-000000000012';
  v_exp_b UUID := '00000000-0000-4000-9109-000000000011';
  v_booking UUID := '00000000-0000-4000-9109-000000000020';
  v_booking2 UUID := '00000000-0000-4000-9109-000000000021';
  v_booking_org UUID := '00000000-0000-4000-9109-000000000022';
  v_date DATE := CURRENT_DATE + 25;
  v_result JSONB;
  v_status public.booking_status;
  v_kind public.booking_kind;
  v_time TIME;
  v_loc TEXT;
  v_note TEXT;
  v_group TEXT;
  v_log INT;
  v_get_group TEXT;
BEGIN
  INSERT INTO public.organizations (id, name, slug, active)
  VALUES (v_org_b, 'Org RG Test B', 'org-rg-test-b', true)
  ON CONFLICT (id) DO UPDATE SET active = true;

  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado
  ) VALUES (
    v_exp, v_org, v_a1, 'mejoravit', '91091000010', 'Cliente RG Test',
    '5588880001', 'interno', true, NOW(), 3, 'en_proceso'
  )
  ON CONFLICT (id) DO UPDATE SET
    submitted_to_mesa = true, etapa_actual = 3, subestado = 'en_proceso', deleted_at = NULL;

  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado
  ) VALUES (
    v_exp2, v_org, v_a1, 'mejoravit', '91091000012', 'Cliente RG Test 2',
    '5588880003', 'interno', true, NOW(), 3, 'en_proceso'
  )
  ON CONFLICT (id) DO UPDATE SET
    submitted_to_mesa = true, etapa_actual = 3, subestado = 'en_proceso', deleted_at = NULL;

  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado
  ) VALUES (
    v_exp_b, v_org_b, v_a1, 'mejoravit', '91091000011', 'Cliente Org B RG',
    '5588880002', 'interno', true, NOW(), 3, 'en_proceso'
  )
  ON CONFLICT (id) DO UPDATE SET submitted_to_mesa = true, deleted_at = NULL;

  DELETE FROM public.agenda_bookings WHERE id IN (v_booking, v_booking2, v_booking_org);

  INSERT INTO public.agenda_bookings (
    id, organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, created_by, note
  ) VALUES (
    v_booking, v_org, 'biometricos', v_exp, v_date, '10:00:00',
    'sede-centro', 'booked', v_a1, 'nota-rg'
  );

  INSERT INTO public.agenda_bookings (
    id, organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, created_by
  ) VALUES (
    v_booking2, v_org, 'firmas', v_exp2, v_date + 1, '11:00:00',
    'sede-centro', 'booked', v_a1
  );

  INSERT INTO public.agenda_bookings (
    id, organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, created_by
  ) VALUES (
    v_booking_org, v_org_b, 'notificacion', v_exp_b, v_date, '10:00:00',
    'sede-centro', 'booked', v_a1
  );

  -- 1) columna nullable por defecto
  SELECT report_group INTO v_group FROM public.agenda_bookings WHERE id = v_booking;
  PERFORM public.__mesa_rg_assert(v_group IS NULL, '1 default null');

  -- 2) mesa_admin actualiza solo report_group
  PERFORM public.__mesa_rg_auth(v_mesa);
  SELECT public.mesa_set_agenda_booking_report_group(
    v_booking, 'biometricos_tramite_completo'
  ) INTO v_result;
  PERFORM public.__mesa_rg_reset();

  PERFORM public.__mesa_rg_assert(v_result->>'ok' = 'true', '2 ok');
  PERFORM public.__mesa_rg_assert(
    v_result->>'report_group' = 'biometricos_tramite_completo',
    '2 report_group'
  );
  PERFORM public.__mesa_rg_assert(v_result->>'kind' = 'biometricos', '2 kind intacto en response');

  SELECT status, kind, booking_time, location_id, note, report_group
  INTO v_status, v_kind, v_time, v_loc, v_note, v_group
  FROM public.agenda_bookings WHERE id = v_booking;

  PERFORM public.__mesa_rg_assert(v_status = 'booked', '2 status intacto');
  PERFORM public.__mesa_rg_assert(v_kind = 'biometricos', '2 kind intacto');
  PERFORM public.__mesa_rg_assert(v_time = '10:00:00'::time, '2 time intacto');
  PERFORM public.__mesa_rg_assert(v_loc = 'sede-centro', '2 location intacto');
  PERFORM public.__mesa_rg_assert(v_note = 'nota-rg', '2 note intacto');
  PERFORM public.__mesa_rg_assert(v_group = 'biometricos_tramite_completo', '2 group persisted');

  SELECT COUNT(*)::int INTO v_log
  FROM public.action_log
  WHERE action = 'agenda.booking.report_group'
    AND entity_id = v_booking;
  PERFORM public.__mesa_rg_assert(v_log >= 1, '2 action_log');

  -- 3) get_mesa_agenda_bookings expone report_group
  PERFORM public.__mesa_rg_auth(v_mesa);
  SELECT g.report_group INTO v_get_group
  FROM public.get_mesa_agenda_bookings(v_date, v_date, false, NULL) g
  WHERE g.booking_id = v_booking;
  PERFORM public.__mesa_rg_reset();
  PERFORM public.__mesa_rg_assert(
    v_get_group = 'biometricos_tramite_completo',
    '3 get report_group'
  );

  -- 4) mesa_interno puede corregir a inscripcion
  PERFORM public.__mesa_rg_auth(v_mesa_int);
  SELECT public.mesa_set_agenda_booking_report_group(v_booking, 'inscripcion')
    INTO v_result;
  PERFORM public.__mesa_rg_reset();
  PERFORM public.__mesa_rg_assert(v_result->>'report_group' = 'inscripcion', '4 inscripcion');

  -- 5) super_admin puede set firmas classification on firmas kind
  PERFORM public.__mesa_rg_auth(v_super);
  SELECT public.mesa_set_agenda_booking_report_group(v_booking2, 'firmas')
    INTO v_result;
  PERFORM public.__mesa_rg_reset();
  PERFORM public.__mesa_rg_assert(v_result->>'ok' = 'true', '5 super ok');

  -- 6) asesor (editor) no autorizado
  BEGIN
    PERFORM public.__mesa_rg_auth(v_editor);
    PERFORM public.mesa_set_agenda_booking_report_group(v_booking, 'biometricos');
    PERFORM public.__mesa_rg_reset();
    RAISE EXCEPTION 'MESA REPORT_GROUP FAIL: 6 editor debió fallar';
  EXCEPTION
    WHEN OTHERS THEN
      PERFORM public.__mesa_rg_reset();
      IF SQLERRM LIKE '%MESA REPORT_GROUP FAIL:%' THEN
        RAISE;
      END IF;
      PERFORM public.__mesa_rg_assert(
        SQLERRM LIKE '%MESA_REPORT_GROUP_UNAUTHORIZED%',
        '6 unauthorized code'
      );
  END;

  -- 7) valor inválido
  BEGIN
    PERFORM public.__mesa_rg_auth(v_mesa);
    PERFORM public.mesa_set_agenda_booking_report_group(v_booking, 'otro');
    PERFORM public.__mesa_rg_reset();
    RAISE EXCEPTION 'MESA REPORT_GROUP FAIL: 7 inválido debió fallar';
  EXCEPTION
    WHEN OTHERS THEN
      PERFORM public.__mesa_rg_reset();
      IF SQLERRM LIKE '%MESA REPORT_GROUP FAIL:%' THEN
        RAISE;
      END IF;
      PERFORM public.__mesa_rg_assert(
        SQLERRM LIKE '%MESA_REPORT_GROUP_INVALID%',
        '7 invalid code'
      );
  END;

  -- 8) org cruzada (mesa org A no ve booking org B)
  BEGIN
    PERFORM public.__mesa_rg_auth(v_mesa);
    PERFORM public.mesa_set_agenda_booking_report_group(v_booking_org, 'notificacion');
    PERFORM public.__mesa_rg_reset();
    RAISE EXCEPTION 'MESA REPORT_GROUP FAIL: 8 cross-org debió fallar';
  EXCEPTION
    WHEN OTHERS THEN
      PERFORM public.__mesa_rg_reset();
      IF SQLERRM LIKE '%MESA REPORT_GROUP FAIL:%' THEN
        RAISE;
      END IF;
      PERFORM public.__mesa_rg_assert(
        SQLERRM LIKE '%MESA_REPORT_GROUP_UNAUTHORIZED%',
        '8 cross-org unauthorized'
      );
  END;

  -- 9) booking inexistente
  BEGIN
    PERFORM public.__mesa_rg_auth(v_mesa);
    PERFORM public.mesa_set_agenda_booking_report_group(
      '00000000-0000-4000-9109-000000000099'::uuid,
      'biometricos'
    );
    PERFORM public.__mesa_rg_reset();
    RAISE EXCEPTION 'MESA REPORT_GROUP FAIL: 9 not found debió fallar';
  EXCEPTION
    WHEN OTHERS THEN
      PERFORM public.__mesa_rg_reset();
      IF SQLERRM LIKE '%MESA REPORT_GROUP FAIL:%' THEN
        RAISE;
      END IF;
      PERFORM public.__mesa_rg_assert(
        SQLERRM LIKE '%MESA_REPORT_GROUP_NOT_FOUND%',
        '9 not found'
      );
  END;

  -- 10) CHECK permite null y valores canónicos; rechaza basura vía constraint al update directo
  UPDATE public.agenda_bookings SET report_group = NULL WHERE id = v_booking2;
  BEGIN
    UPDATE public.agenda_bookings SET report_group = 'basura' WHERE id = v_booking2;
    RAISE EXCEPTION 'MESA REPORT_GROUP FAIL: 10 CHECK debió fallar';
  EXCEPTION
    WHEN check_violation THEN
      NULL;
    WHEN OTHERS THEN
      IF SQLERRM LIKE '%MESA REPORT_GROUP FAIL:%' THEN
        RAISE;
      END IF;
      -- algunos drivers reportan 23514 distinto
      PERFORM public.__mesa_rg_assert(
        SQLSTATE = '23514' OR SQLERRM ILIKE '%report_group%',
        '10 check violation'
      );
  END;

  RAISE NOTICE 'rpc_mesa_agenda_report_group: OK';
END;
$$;

DROP FUNCTION IF EXISTS public.__mesa_rg_assert(BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.__mesa_rg_auth(UUID);
DROP FUNCTION IF EXISTS public.__mesa_rg_reset();
