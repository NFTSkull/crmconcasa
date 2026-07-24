-- ConCasa CRM — P131: mesa_set_notificacion_booking_location
-- Uso local: psql … -f supabase/tests/rpc_mesa_set_notificacion_booking_location.sql

CREATE OR REPLACE FUNCTION public.__p131_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN RAISE EXCEPTION 'P131 TEST FAIL: %', p_msg; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p131_set_auth(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p131_reset_auth()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

BEGIN;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000131';
  v_asesor UUID := '00000000-0000-4000-8000-000000001131';
  v_mesa UUID := '00000000-0000-4000-8000-000000002131';
  v_exp UUID := '00000000-0000-4000-8000-000000005131';
  v_exp2 UUID := '00000000-0000-4000-8000-000000015131';
  v_exp3 UUID := '00000000-0000-4000-8000-000000025131';
  v_exp4 UUID := '00000000-0000-4000-8000-000000035131';
  v_book_null UUID := '00000000-0000-4000-8000-000000006131';
  v_book_sent UUID := '00000000-0000-4000-8000-000000007131';
  v_book_ok UUID := '00000000-0000-4000-8000-000000008131';
  v_book_bio UUID := '00000000-0000-4000-8000-000000009131';
  v_result JSONB;
  v_date DATE;
  v_time TIME;
  v_status public.booking_status;
  v_kind public.booking_kind;
  v_loc TEXT;
BEGIN
  INSERT INTO public.organizations (id, name, slug)
  VALUES (v_org, 'P131 Org', 'p131-org-' || substr(v_org::text, 1, 8))
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

  INSERT INTO public.profiles (
    id, organization_id, email, app_role, active, full_name, tipo_mesa, tipo_asesor_origen
  ) VALUES
    (v_asesor, v_org, 'asesor.p131@test.local', 'asesor', true, 'Asesor P131', NULL, 'interno'),
    (v_mesa, v_org, 'mesa.p131@test.local', 'mesa_interno', true, 'Mesa P131', 'interno', NULL)
  ON CONFLICT (id) DO UPDATE SET
    app_role = EXCLUDED.app_role,
    active = true,
    organization_id = EXCLUDED.organization_id,
    tipo_mesa = EXCLUDED.tipo_mesa,
    tipo_asesor_origen = EXCLUDED.tipo_asesor_origen;

  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, ciclo_estado
  ) VALUES
    (v_exp, v_org, v_asesor, 'mejoravit', '91310000001', 'Cliente P131a',
     '8113113113', 'interno', true, NOW(), 3, 'en_proceso', 'activo'),
    (v_exp2, v_org, v_asesor, 'mejoravit', '91310000002', 'Cliente P131b',
     '8113113114', 'interno', true, NOW(), 3, 'en_proceso', 'activo'),
    (v_exp3, v_org, v_asesor, 'mejoravit', '91310000003', 'Cliente P131c',
     '8113113115', 'interno', true, NOW(), 3, 'en_proceso', 'activo'),
    (v_exp4, v_org, v_asesor, 'mejoravit', '91310000004', 'Cliente P131d',
     '8113113116', 'interno', true, NOW(), 3, 'en_proceso', 'activo')
  ON CONFLICT (id) DO UPDATE SET deleted_at = NULL, submitted_to_mesa = true;

  INSERT INTO public.agenda_bookings (
    id, organization_id, expediente_id, kind, status,
    booking_date, booking_time, location_id, created_by
  ) VALUES
    (v_book_null, v_org, v_exp, 'notificacion', 'booked',
     CURRENT_DATE + 10, TIME '12:00', '', v_asesor),
    (v_book_sent, v_org, v_exp2, 'notificacion', 'booked',
     CURRENT_DATE + 11, TIME '12:00', 'notificacion', v_asesor),
    (v_book_ok, v_org, v_exp3, 'notificacion', 'booked',
     CURRENT_DATE + 12, TIME '12:00', 'monterrey', v_asesor),
    (v_book_bio, v_org, v_exp4, 'biometricos', 'booked',
     CURRENT_DATE + 13, TIME '09:00', 'monterrey', v_asesor)
  ON CONFLICT (id) DO UPDATE SET
    location_id = EXCLUDED.location_id,
    status = 'booked',
    kind = EXCLUDED.kind,
    expediente_id = EXCLUDED.expediente_id;

  PERFORM public.__p131_assert(
    public.agenda_notificacion_location_needs_assignment(NULL),
    'NULL needs assignment'
  );
  PERFORM public.__p131_assert(
    public.agenda_notificacion_location_needs_assignment(''),
    'empty needs assignment'
  );
  PERFORM public.__p131_assert(
    public.agenda_notificacion_location_needs_assignment('notificacion'),
    'sentinel needs assignment'
  );
  PERFORM public.__p131_assert(
    NOT public.agenda_notificacion_location_needs_assignment('monterrey'),
    'monterrey ok'
  );

  PERFORM public.__p131_set_auth(v_mesa);
  v_result := public.mesa_set_notificacion_booking_location(v_book_null, 'monterrey');
  PERFORM public.__p131_reset_auth();
  PERFORM public.__p131_assert(v_result->>'ok' = 'true', 'set null→monterrey ok');
  PERFORM public.__p131_assert(v_result->>'location_id' = 'monterrey', 'loc monterrey');
  PERFORM public.__p131_assert(v_result->>'unchanged' = 'false', 'changed');

  SELECT booking_date, booking_time, status, kind, location_id
  INTO v_date, v_time, v_status, v_kind, v_loc
  FROM public.agenda_bookings WHERE id = v_book_null;
  PERFORM public.__p131_assert(v_loc = 'monterrey', 'persisted monterrey');
  PERFORM public.__p131_assert(v_kind = 'notificacion', 'kind intact');
  PERFORM public.__p131_assert(v_status = 'booked', 'status intact');
  PERFORM public.__p131_assert(v_time = TIME '12:00', 'time intact');

  PERFORM public.__p131_set_auth(v_mesa);
  v_result := public.mesa_set_notificacion_booking_location(v_book_sent, 'apodaca');
  PERFORM public.__p131_reset_auth();
  PERFORM public.__p131_assert(v_result->>'location_id' = 'apodaca', 'sentinel→apodaca');

  SELECT location_id INTO v_loc FROM public.agenda_bookings WHERE id = v_book_sent;
  PERFORM public.__p131_assert(v_loc = 'apodaca', 'persisted apodaca');

  PERFORM public.__p131_set_auth(v_mesa);
  v_result := public.mesa_set_notificacion_booking_location(v_book_sent, 'apodaca');
  PERFORM public.__p131_reset_auth();
  PERFORM public.__p131_assert(v_result->>'unchanged' = 'true', 'idempotent');

  BEGIN
    PERFORM public.__p131_set_auth(v_mesa);
    PERFORM public.mesa_set_notificacion_booking_location(v_book_null, 'notificacion');
    PERFORM public.__p131_reset_auth();
    RAISE EXCEPTION 'P131 TEST FAIL: sentinel new debía fallar';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.__p131_reset_auth();
    IF SQLERRM LIKE 'P131 TEST FAIL:%' THEN RAISE; END IF;
    PERFORM public.__p131_assert(SQLERRM ILIKE '%inválido%', 'reject bad new loc');
  END;

  BEGIN
    PERFORM public.__p131_set_auth(v_mesa);
    PERFORM public.mesa_set_notificacion_booking_location(v_book_bio, 'apodaca');
    PERFORM public.__p131_reset_auth();
    RAISE EXCEPTION 'P131 TEST FAIL: bio debía fallar';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.__p131_reset_auth();
    IF SQLERRM LIKE 'P131 TEST FAIL:%' THEN RAISE; END IF;
    PERFORM public.__p131_assert(SQLERRM ILIKE '%notificacion%', 'reject bio');
  END;

  BEGIN
    PERFORM public.__p131_set_auth(v_mesa);
    PERFORM public.mesa_set_notificacion_booking_location(v_book_ok, 'apodaca');
    PERFORM public.__p131_reset_auth();
    RAISE EXCEPTION 'P131 TEST FAIL: canónica debía bloquear cambio';
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.__p131_reset_auth();
    IF SQLERRM LIKE 'P131 TEST FAIL:%' THEN RAISE; END IF;
    PERFORM public.__p131_assert(SQLERRM ILIKE '%canónica%', 'block canonical change');
  END;

  PERFORM public.__p131_assert(
    EXISTS (
      SELECT 1 FROM public.action_log al
      WHERE al.action = 'agenda.notificacion.set_location'
        AND al.entity_id = v_book_null
    ),
    'action_log written'
  );

  RAISE NOTICE 'P131 mesa_set_notificacion_booking_location: OK';
END;
$$;

DROP FUNCTION public.__p131_assert(BOOLEAN, TEXT);
DROP FUNCTION public.__p131_set_auth(UUID);
DROP FUNCTION public.__p131_reset_auth();
ROLLBACK;
