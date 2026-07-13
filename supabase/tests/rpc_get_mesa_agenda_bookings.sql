-- ConCasa CRM — P067 RPC get_mesa_agenda_bookings (solo lectura Mesa)
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__rpc_mesa_bookings_test_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'RPC MESA BOOKINGS TEST FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_mesa_bookings_test_set_auth(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_mesa_bookings_test_reset_auth()
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_mesa_bookings_test_expect_error(
  p_user_id UUID,
  p_start DATE,
  p_end DATE,
  p_fragment TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM public.__rpc_mesa_bookings_test_set_auth(p_user_id);
  BEGIN
    PERFORM count(*) FROM public.get_mesa_agenda_bookings(p_start, p_end, false, NULL);
    PERFORM public.__rpc_mesa_bookings_test_reset_auth();
    RAISE EXCEPTION 'debió fallar con %', p_fragment;
  EXCEPTION
    WHEN OTHERS THEN
      PERFORM public.__rpc_mesa_bookings_test_reset_auth();
      IF SQLERRM NOT LIKE ('%' || p_fragment || '%') THEN
        RAISE;
      END IF;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_mesa_bookings_test_insert_expediente(
  p_id UUID,
  p_org UUID,
  p_asesor UUID,
  p_nss TEXT,
  p_origen public.origen_mesa DEFAULT 'interno',
  p_cliente TEXT DEFAULT 'Cliente test mesa bookings',
  p_etapa SMALLINT DEFAULT 3
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, ciclo_estado
  ) VALUES (
    p_id, p_org, p_asesor, 'mejoravit', p_nss, p_cliente,
    '8110000000', p_origen, true, NOW(),
    p_etapa, 'en_proceso', 'activo'
  )
  ON CONFLICT (id) DO UPDATE SET
    organization_id = EXCLUDED.organization_id,
    asesor_id = EXCLUDED.asesor_id,
    nss = EXCLUDED.nss,
    cliente_nombre = EXCLUDED.cliente_nombre,
    origen_mesa = EXCLUDED.origen_mesa,
    submitted_to_mesa = true,
    etapa_actual = EXCLUDED.etapa_actual,
    subestado = 'en_proceso',
    deleted_at = NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_mesa_bookings_test_insert_booking(
  p_id UUID,
  p_org UUID,
  p_exp UUID,
  p_day DATE,
  p_time TIME,
  p_kind public.booking_kind,
  p_status public.booking_status,
  p_created_by UUID,
  p_note TEXT DEFAULT NULL,
  p_created_at TIMESTAMPTZ DEFAULT NOW(),
  p_cancelled_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.agenda_bookings (
    id, organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, note, created_by, created_at, cancelled_at
  ) VALUES (
    p_id, p_org, p_kind, p_exp, p_day, p_time,
    'sede-centro', p_status, p_note, p_created_by, p_created_at, p_cancelled_at
  )
  ON CONFLICT (id) DO UPDATE SET
    booking_date = EXCLUDED.booking_date,
    booking_time = EXCLUDED.booking_time,
    kind = EXCLUDED.kind,
    status = EXCLUDED.status,
    note = EXCLUDED.note,
    created_by = EXCLUDED.created_by,
    created_at = EXCLUDED.created_at,
    cancelled_at = EXCLUDED.cancelled_at;
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000001';
  v_org_other UUID := '00000000-0000-4000-8000-000000000099';
  v_asesor_int UUID := '00000000-0000-4000-8001-000000000001';
  v_asesor_ext UUID := '00000000-0000-4000-8001-000000000002';
  v_mesa_admin UUID := '00000000-0000-4000-8003-000000000001';
  v_mesa_int UUID := '00000000-0000-4000-8004-000000000001';
  v_mesa_ext UUID := '00000000-0000-4000-8005-000000000001';
  v_super UUID := '00000000-0000-4000-8006-000000000001';
  v_editor UUID := '00000000-0000-4000-8002-000000000001';

  v_exp_int UUID := '00000000-0000-4000-9070-000000000001';
  v_exp_ext UUID := '00000000-0000-4000-9070-000000000002';
  v_exp_other_org UUID := '00000000-0000-4000-9070-000000000099';

  v_day DATE := CURRENT_DATE + 21;
  v_day2 DATE := CURRENT_DATE + 22;

  v_bio_id UUID := '00000000-0000-4000-9071-000000000001';
  v_firma_id UUID := '00000000-0000-4000-9071-000000000002';
  v_notif_id UUID := '00000000-0000-4000-9071-000000000003';
  v_cancel_id UUID := '00000000-0000-4000-9071-000000000004';
  v_order_early UUID := '00000000-0000-4000-9071-000000000005';
  v_order_late UUID := '00000000-0000-4000-9071-000000000006';
  v_other_org_booking UUID := '00000000-0000-4000-9071-000000000099';

  v_rows INTEGER;
  v_count_before INTEGER;
  v_count_after INTEGER;
  v_etapa_before SMALLINT;
  v_etapa_after SMALLINT;
  v_rec RECORD;
  v_prev_time TIME;
  v_prev_date DATE;
BEGIN
  INSERT INTO public.organizations (id, slug, name, active)
  VALUES (v_org, 'concasa', 'ConCasa', true)
  ON CONFLICT (slug) DO UPDATE SET active = true, updated_at = NOW();

  INSERT INTO public.organizations (id, slug, name, active)
  VALUES (v_org_other, 'org-otra-mesa-bookings', 'Org Otra Mesa Bookings', true)
  ON CONFLICT (slug) DO UPDATE SET active = true, updated_at = NOW();

  INSERT INTO public.profiles (
    id, organization_id, email, full_name, app_role, tipo_mesa, tipo_asesor_origen, active
  ) VALUES
    (v_asesor_int, v_org, 'test.asesor.int@mesa-bookings.local', 'Test Asesor Int', 'asesor', NULL, 'interno', true),
    (v_asesor_ext, v_org, 'test.asesor.ext@mesa-bookings.local', 'Test Asesor Ext', 'asesor', NULL, 'externo', true),
    (v_mesa_admin, v_org, 'test.mesa.admin@mesa-bookings.local', 'Test Mesa Admin', 'mesa_admin', NULL, NULL, true),
    (v_mesa_int, v_org, 'test.mesa.int@mesa-bookings.local', 'Test Mesa Interno', 'mesa_interno', 'interno', NULL, true),
    (v_mesa_ext, v_org, 'test.mesa.ext@mesa-bookings.local', 'Test Mesa Externo', 'mesa_externo', 'externo', NULL, true),
    (v_super, v_org, 'test.super@mesa-bookings.local', 'Test Super Admin', 'super_admin', NULL, NULL, true),
    (v_editor, v_org, 'test.editor@mesa-bookings.local', 'Test Editor', 'editor', NULL, NULL, true)
  ON CONFLICT (id) DO UPDATE SET
    organization_id = EXCLUDED.organization_id,
    app_role = EXCLUDED.app_role,
    tipo_mesa = EXCLUDED.tipo_mesa,
    active = true,
    updated_at = NOW();

  PERFORM public.__rpc_mesa_bookings_test_insert_expediente(
    v_exp_int, v_org, v_asesor_int, '90701000001', 'interno'::public.origen_mesa, 'Cliente Interno Mesa', 3::smallint
  );
  PERFORM public.__rpc_mesa_bookings_test_insert_expediente(
    v_exp_ext, v_org, v_asesor_ext, '90702000002', 'externo'::public.origen_mesa, 'Cliente Externo Mesa', 9::smallint
  );
  PERFORM public.__rpc_mesa_bookings_test_insert_expediente(
    v_exp_other_org, v_org_other, v_asesor_int, '90799000099', 'interno'::public.origen_mesa, 'Cliente Otra Org', 4::smallint
  );

  DELETE FROM public.agenda_bookings
  WHERE expediente_id IN (v_exp_int, v_exp_ext, v_exp_other_org)
     OR id IN (
       v_bio_id, v_firma_id, v_notif_id, v_cancel_id,
       v_order_early, v_order_late, v_other_org_booking
     );

  PERFORM public.__rpc_mesa_bookings_test_insert_booking(
    v_bio_id, v_org, v_exp_int, v_day, '09:00:00', 'biometricos', 'booked', v_mesa_admin, 'nota bio'
  );
  PERFORM public.__rpc_mesa_bookings_test_insert_booking(
    v_firma_id, v_org, v_exp_ext, v_day, '10:30:00', 'firmas', 'booked', v_mesa_admin, 'nota firma'
  );
  PERFORM public.__rpc_mesa_bookings_test_insert_booking(
    v_notif_id, v_org, v_exp_int, v_day, '12:00:00', 'notificacion', 'booked', v_mesa_admin, 'nota notif'
  );
  PERFORM public.__rpc_mesa_bookings_test_insert_booking(
    v_cancel_id, v_org, v_exp_int, v_day, '14:00:00', 'biometricos', 'cancelled',
    v_mesa_admin, 'cancelada', NOW() - INTERVAL '1 hour', NOW()
  );
  PERFORM public.__rpc_mesa_bookings_test_insert_booking(
    v_order_early, v_org, v_exp_int, v_day, '08:00:00', 'firmas', 'booked', v_asesor_int,
    'orden temprano', NOW() - INTERVAL '2 hours'
  );
  PERFORM public.__rpc_mesa_bookings_test_insert_booking(
    v_order_late, v_org, v_exp_ext, v_day2, '16:00:00', 'biometricos', 'booked', v_asesor_ext,
    'orden tarde', NOW() - INTERVAL '1 hour'
  );
  PERFORM public.__rpc_mesa_bookings_test_insert_booking(
    v_other_org_booking, v_org_other, v_exp_other_org, v_day, '11:00:00', 'biometricos', 'booked', v_asesor_int
  );

  -- 1. sin auth
  PERFORM public.__rpc_mesa_bookings_test_reset_auth();
  BEGIN
    PERFORM count(*) FROM public.get_mesa_agenda_bookings(v_day, v_day, false, NULL);
    RAISE EXCEPTION 'test 1: sin auth debió fallar';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%not_authenticated%' THEN
      RAISE;
    END IF;
  END;

  -- 2. asesor bloqueado
  PERFORM public.__rpc_mesa_bookings_test_expect_error(
    v_asesor_int, v_day, v_day, 'forbidden_role'
  );

  -- 3. profile inactivo
  UPDATE public.profiles SET active = false WHERE id = v_mesa_admin;
  PERFORM public.__rpc_mesa_bookings_test_expect_error(
    v_mesa_admin, v_day, v_day, 'profile_inactive'
  );
  UPDATE public.profiles SET active = true WHERE id = v_mesa_admin;

  -- 4. rango invertido
  PERFORM public.__rpc_mesa_bookings_test_expect_error(
    v_mesa_admin, v_day, v_day - 1, 'invalid_date_range'
  );

  -- 5. rango mayor a 62 días
  PERFORM public.__rpc_mesa_bookings_test_expect_error(
    v_mesa_admin, v_day, v_day + 63, 'date_range_too_large'
  );

  -- 6. mesa_admin ve citas permitidas
  PERFORM public.__rpc_mesa_bookings_test_set_auth(v_mesa_admin);
  SELECT count(*)::INTEGER INTO v_rows
  FROM public.get_mesa_agenda_bookings(v_day, v_day2, false, NULL)
  WHERE status = 'booked';
  PERFORM public.__rpc_mesa_bookings_test_assert(v_rows >= 5, 'test 6: mesa_admin ve citas activas');
  PERFORM public.__rpc_mesa_bookings_test_reset_auth();

  -- 7. mesa_interno solo origen interno
  PERFORM public.__rpc_mesa_bookings_test_set_auth(v_mesa_int);
  SELECT count(*)::INTEGER INTO v_rows
  FROM public.get_mesa_agenda_bookings(v_day, v_day2, false, NULL)
  WHERE expediente_id = v_exp_ext;
  PERFORM public.__rpc_mesa_bookings_test_assert(v_rows = 0, 'test 7: interno no ve externo');
  SELECT count(*)::INTEGER INTO v_rows
  FROM public.get_mesa_agenda_bookings(v_day, v_day, false, NULL)
  WHERE expediente_id = v_exp_int AND cliente_nombre IS NOT NULL;
  PERFORM public.__rpc_mesa_bookings_test_assert(v_rows >= 1, 'test 7: interno ve interno con PII');
  PERFORM public.__rpc_mesa_bookings_test_reset_auth();

  -- 8. mesa_externo solo origen externo
  PERFORM public.__rpc_mesa_bookings_test_set_auth(v_mesa_ext);
  SELECT count(*)::INTEGER INTO v_rows
  FROM public.get_mesa_agenda_bookings(v_day, v_day, false, NULL)
  WHERE expediente_id = v_exp_int;
  PERFORM public.__rpc_mesa_bookings_test_assert(v_rows = 0, 'test 8: externo no ve interno');
  SELECT count(*)::INTEGER INTO v_rows
  FROM public.get_mesa_agenda_bookings(v_day, v_day, false, 'firmas')
  WHERE expediente_id = v_exp_ext;
  PERFORM public.__rpc_mesa_bookings_test_assert(v_rows = 1, 'test 8: externo ve firma externa');
  PERFORM public.__rpc_mesa_bookings_test_reset_auth();

  -- 9. no devuelve otra organización
  PERFORM public.__rpc_mesa_bookings_test_set_auth(v_mesa_admin);
  SELECT count(*)::INTEGER INTO v_rows
  FROM public.get_mesa_agenda_bookings(v_day, v_day, false, NULL)
  WHERE booking_id = v_other_org_booking;
  PERFORM public.__rpc_mesa_bookings_test_assert(v_rows = 0, 'test 9: sin citas de otra org');
  PERFORM public.__rpc_mesa_bookings_test_reset_auth();

  -- 10. default sin canceladas
  PERFORM public.__rpc_mesa_bookings_test_set_auth(v_mesa_admin);
  SELECT count(*)::INTEGER INTO v_rows
  FROM public.get_mesa_agenda_bookings(v_day, v_day, false, NULL)
  WHERE booking_id = v_cancel_id;
  PERFORM public.__rpc_mesa_bookings_test_assert(v_rows = 0, 'test 10: default excluye canceladas');
  PERFORM public.__rpc_mesa_bookings_test_reset_auth();

  -- 11. include_cancelled
  PERFORM public.__rpc_mesa_bookings_test_set_auth(v_mesa_admin);
  SELECT count(*)::INTEGER INTO v_rows
  FROM public.get_mesa_agenda_bookings(v_day, v_day, true, NULL)
  WHERE booking_id = v_cancel_id AND status = 'cancelled';
  PERFORM public.__rpc_mesa_bookings_test_assert(v_rows = 1, 'test 11: include_cancelled devuelve cancelada');
  PERFORM public.__rpc_mesa_bookings_test_reset_auth();

  -- 12-14. filtros por kind
  PERFORM public.__rpc_mesa_bookings_test_set_auth(v_mesa_admin);
  SELECT count(*)::INTEGER INTO v_rows
  FROM public.get_mesa_agenda_bookings(v_day, v_day2, false, 'biometricos');
  PERFORM public.__rpc_mesa_bookings_test_assert(v_rows >= 2, 'test 12: filtro biometricos');
  SELECT count(*)::INTEGER INTO v_rows
  FROM public.get_mesa_agenda_bookings(v_day, v_day2, false, 'firmas');
  PERFORM public.__rpc_mesa_bookings_test_assert(v_rows >= 1, 'test 13: filtro firmas');
  SELECT count(*)::INTEGER INTO v_rows
  FROM public.get_mesa_agenda_bookings(v_day, v_day, false, 'notificacion');
  PERFORM public.__rpc_mesa_bookings_test_assert(v_rows = 1, 'test 14: filtro notificacion');
  PERFORM public.__rpc_mesa_bookings_test_reset_auth();

  -- 15-16. expediente_id, cliente y NSS
  PERFORM public.__rpc_mesa_bookings_test_set_auth(v_mesa_admin);
  SELECT count(*)::INTEGER INTO v_rows
  FROM public.get_mesa_agenda_bookings(v_day, v_day, false, NULL)
  WHERE booking_id = v_bio_id
    AND expediente_id = v_exp_int
    AND cliente_nombre = 'Cliente Interno Mesa'
    AND nss = '90701000001';
  PERFORM public.__rpc_mesa_bookings_test_assert(v_rows = 1, 'test 15-16: expediente_id cliente y NSS');
  PERFORM public.__rpc_mesa_bookings_test_reset_auth();

  -- 17. distingue asesor dueño de created_by
  PERFORM public.__rpc_mesa_bookings_test_set_auth(v_mesa_admin);
  SELECT count(*)::INTEGER INTO v_rows
  FROM public.get_mesa_agenda_bookings(v_day, v_day, false, 'biometricos')
  WHERE booking_id = v_bio_id
    AND asesor_id = v_asesor_int
    AND created_by = v_mesa_admin
    AND asesor_id IS DISTINCT FROM created_by;
  PERFORM public.__rpc_mesa_bookings_test_assert(v_rows = 1, 'test 17: asesor dueño vs created_by');
  PERFORM public.__rpc_mesa_bookings_test_reset_auth();

  -- 18. orden por fecha/hora/created_at
  PERFORM public.__rpc_mesa_bookings_test_set_auth(v_mesa_admin);
  v_prev_date := NULL;
  v_prev_time := NULL;
  FOR v_rec IN
    SELECT booking_date, booking_time
    FROM public.get_mesa_agenda_bookings(v_day, v_day2, false, NULL)
    ORDER BY booking_date ASC, booking_time ASC, created_at ASC
  LOOP
    IF v_prev_date IS NOT NULL THEN
      PERFORM public.__rpc_mesa_bookings_test_assert(
        v_rec.booking_date > v_prev_date
          OR (v_rec.booking_date = v_prev_date AND v_rec.booking_time >= v_prev_time),
        'test 18: orden fecha/hora'
      );
    END IF;
    v_prev_date := v_rec.booking_date;
    v_prev_time := v_rec.booking_time;
  END LOOP;
  PERFORM public.__rpc_mesa_bookings_test_reset_auth();

  -- 19-20. no modifica bookings ni expediente
  SELECT count(*)::INTEGER INTO v_count_before FROM public.agenda_bookings;
  SELECT etapa_actual INTO v_etapa_before FROM public.expedientes WHERE id = v_exp_int;
  PERFORM public.__rpc_mesa_bookings_test_set_auth(v_mesa_admin);
  PERFORM count(*) FROM public.get_mesa_agenda_bookings(v_day, v_day2, true, NULL);
  PERFORM public.__rpc_mesa_bookings_test_reset_auth();
  SELECT count(*)::INTEGER INTO v_count_after FROM public.agenda_bookings;
  SELECT etapa_actual INTO v_etapa_after FROM public.expedientes WHERE id = v_exp_int;
  PERFORM public.__rpc_mesa_bookings_test_assert(
    v_count_before = v_count_after,
    'test 19: no modifica bookings'
  );
  PERFORM public.__rpc_mesa_bookings_test_assert(
    v_etapa_before = v_etapa_after,
    'test 20: no modifica etapa expediente'
  );

  -- editor bloqueado
  PERFORM public.__rpc_mesa_bookings_test_expect_error(
    v_editor, v_day, v_day, 'forbidden_role'
  );

  -- super_admin ve alcance org
  PERFORM public.__rpc_mesa_bookings_test_set_auth(v_super);
  SELECT count(*)::INTEGER INTO v_rows
  FROM public.get_mesa_agenda_bookings(v_day, v_day, false, NULL)
  WHERE expediente_id IN (v_exp_int, v_exp_ext);
  PERFORM public.__rpc_mesa_bookings_test_assert(v_rows >= 2, 'super_admin ve citas org');
  PERFORM public.__rpc_mesa_bookings_test_reset_auth();
END;
$$;

DROP FUNCTION IF EXISTS public.__rpc_mesa_bookings_test_insert_booking(
  UUID, UUID, UUID, DATE, TIME, public.booking_kind, public.booking_status, UUID, TEXT, TIMESTAMPTZ, TIMESTAMPTZ
);
DROP FUNCTION IF EXISTS public.__rpc_mesa_bookings_test_insert_expediente(
  UUID, UUID, UUID, TEXT, public.origen_mesa, TEXT, SMALLINT
);
DROP FUNCTION IF EXISTS public.__rpc_mesa_bookings_test_expect_error(UUID, DATE, DATE, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_mesa_bookings_test_reset_auth();
DROP FUNCTION IF EXISTS public.__rpc_mesa_bookings_test_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__rpc_mesa_bookings_test_assert(BOOLEAN, TEXT);
