-- ConCasa CRM — pruebas P2C-6 RPC book_biometricos
-- Uso: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/rpc_book_biometricos.sql

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__rpc_book_test_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'RPC BOOK TEST FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_book_test_set_auth(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_book_test_reset_auth()
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_book_test_call_as(
  p_user_id UUID,
  p_expediente_id UUID,
  p_scheduled_at TIMESTAMPTZ,
  p_location_id TEXT DEFAULT 'sede-centro',
  p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_result JSONB;
BEGIN
  PERFORM public.__rpc_book_test_set_auth(p_user_id);
  SELECT public.book_biometricos(
    p_expediente_id,
    p_scheduled_at,
    p_location_id,
    p_note
  ) INTO v_result;
  PERFORM public.__rpc_book_test_reset_auth();
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_book_test_call_expect_fail(
  p_user_id UUID,
  p_expediente_id UUID,
  p_scheduled_at TIMESTAMPTZ,
  p_location_id TEXT DEFAULT 'sede-centro',
  p_note TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM public.__rpc_book_test_set_auth(p_user_id);
  BEGIN
    PERFORM public.book_biometricos(
      p_expediente_id,
      p_scheduled_at,
      p_location_id,
      p_note
    );
    PERFORM public.__rpc_book_test_reset_auth();
    RETURN false;
  EXCEPTION
    WHEN OTHERS THEN
      PERFORM public.__rpc_book_test_reset_auth();
      RETURN true;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_book_test_insert_expediente(
  p_id UUID,
  p_org_id UUID,
  p_asesor_id UUID,
  p_nss CHAR(11),
  p_etapa SMALLINT DEFAULT 4,
  p_submitted BOOLEAN DEFAULT true,
  p_deleted_at TIMESTAMPTZ DEFAULT NULL,
  p_subestado public.operativo_subestado DEFAULT 'en_proceso'
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, deleted_at
  ) VALUES (
    p_id, p_org_id, p_asesor_id, 'mejoravit', p_nss,
    'Fixture Book Biometricos', '5577777777', 'interno',
    p_submitted,
    CASE WHEN p_submitted THEN NOW() ELSE NULL END,
    p_etapa, p_subestado, p_deleted_at
  )
  ON CONFLICT (id) DO UPDATE SET
    asesor_id = EXCLUDED.asesor_id,
    nss = EXCLUDED.nss,
    submitted_to_mesa = EXCLUDED.submitted_to_mesa,
    etapa_actual = EXCLUDED.etapa_actual,
    subestado = EXCLUDED.subestado,
    deleted_at = EXCLUDED.deleted_at,
    ciclo_estado = 'activo',
    fecha_cita = NULL,
    updated_at = NOW();

  DELETE FROM public.agenda_bookings WHERE expediente_id = p_id;
END;
$$;

DO $$
DECLARE
  v_org_id UUID := '00000000-0000-4000-8000-000000000001';
  v_asesor_a1 UUID := '00000000-0000-4000-8001-000000000001';
  v_asesor_a2 UUID := '00000000-0000-4000-8001-000000000002';
  v_editor UUID := '00000000-0000-4000-8002-000000000001';
  v_mesa_admin UUID := '00000000-0000-4000-8003-000000000001';
  v_super UUID := '00000000-0000-4000-8006-000000000001';

  v_exp_ok UUID := '00000000-0000-4000-9008-000000000010';
  v_exp_other UUID := '00000000-0000-4000-9008-000000000020';
  v_exp_roles UUID := '00000000-0000-4000-9008-000000000030';
  v_exp_wrong_etapa UUID := '00000000-0000-4000-9008-000000000040';
  v_exp_not_sent UUID := '00000000-0000-4000-9008-000000000050';
  v_exp_deleted UUID := '00000000-0000-4000-9008-000000000060';
  v_exp_past UUID := '00000000-0000-4000-9008-000000000070';
  v_exp_future UUID := '00000000-0000-4000-9008-000000000080';
  v_exp_dup UUID := '00000000-0000-4000-9008-000000000090';
  v_exp_rebook UUID := '00000000-0000-4000-9008-000000000100';
  v_exp_etapa_check UUID := '00000000-0000-4000-9008-000000000110';
  v_exp_etapa3 UUID := '00000000-0000-4000-9008-000000000115';
  v_exp_db_dup UUID := '00000000-0000-4000-9008-000000000120';
  v_exp_etapa5 UUID := '00000000-0000-4000-9008-000000000130';
  v_exp_etapa5_nocancel UUID := '00000000-0000-4000-9008-000000000140';
  v_exp_etapa5_booked UUID := '00000000-0000-4000-9008-000000000141';
  v_exp_etapa5_badsub UUID := '00000000-0000-4000-9008-000000000142';

  v_future TIMESTAMPTZ := public.agenda_biometricos_slot_ts(1, '10:00', 7);
  v_past TIMESTAMPTZ := NOW() - INTERVAL '1 day';
  v_result JSONB;
  v_booking_id UUID;
BEGIN
  PERFORM public.__rpc_book_test_insert_expediente(v_exp_ok, v_org_id, v_asesor_a1, '90801000001');
  PERFORM public.__rpc_book_test_insert_expediente(v_exp_other, v_org_id, v_asesor_a2, '90802000002');
  PERFORM public.__rpc_book_test_insert_expediente(v_exp_roles, v_org_id, v_asesor_a1, '90803000003');
  PERFORM public.__rpc_book_test_insert_expediente(v_exp_wrong_etapa, v_org_id, v_asesor_a1, '90804000004', 2::smallint);
  PERFORM public.__rpc_book_test_insert_expediente(
    v_exp_not_sent, v_org_id, v_asesor_a1, '90805000005', 4::smallint, false
  );
  PERFORM public.__rpc_book_test_insert_expediente(
    v_exp_deleted, v_org_id, v_asesor_a1, '90806000006', 4::smallint, true, NOW()
  );
  PERFORM public.__rpc_book_test_insert_expediente(v_exp_past, v_org_id, v_asesor_a1, '90807000007');
  PERFORM public.__rpc_book_test_insert_expediente(v_exp_future, v_org_id, v_asesor_a1, '90808000008');
  PERFORM public.__rpc_book_test_insert_expediente(v_exp_dup, v_org_id, v_asesor_a1, '90809000009');
  PERFORM public.__rpc_book_test_insert_expediente(v_exp_rebook, v_org_id, v_asesor_a1, '90810000010');
  PERFORM public.__rpc_book_test_insert_expediente(v_exp_etapa_check, v_org_id, v_asesor_a1, '90811000011');
  PERFORM public.__rpc_book_test_insert_expediente(v_exp_etapa3, v_org_id, v_asesor_a1, '90811500015', 3::smallint);
  PERFORM public.__rpc_book_test_insert_expediente(v_exp_db_dup, v_org_id, v_asesor_a1, '90812000012');

  -- Test 1: asesor dueño agenda en etapa 4
  v_result := public.__rpc_book_test_call_as(v_asesor_a1, v_exp_ok, v_future, 'sede-centro', 'cita prueba');
  PERFORM public.__rpc_book_test_assert(
    (v_result->>'ok')::boolean = true,
    'test 1: asesor dueño ok'
  );
  PERFORM public.__rpc_book_test_assert(
    v_result->>'kind' = 'biometricos',
    'test 1: kind biometricos'
  );
  PERFORM public.__rpc_book_test_assert(
    v_result->>'status' = 'booked',
    'test 1: status booked'
  );

  -- Test 1b: P063 asesor dueño agenda en etapa 3
  v_result := public.__rpc_book_test_call_as(v_asesor_a1, v_exp_etapa3, v_future, 'sede-centro', 'cita etapa 3');
  PERFORM public.__rpc_book_test_assert(
    (v_result->>'ok')::boolean = true,
    'test 1b: book en etapa 3 ok'
  );
  PERFORM public.__rpc_book_test_assert(
    (v_result->>'etapa_actual')::int = 3,
    'test 1b: etapa sigue en 3 tras book'
  );

  -- Test 2: asesor no agenda expediente ajeno
  PERFORM public.__rpc_book_test_assert(
    public.__rpc_book_test_call_expect_fail(v_asesor_a1, v_exp_other, v_future),
    'test 2: asesor ajeno bloqueado'
  );

  -- Test 3: editor bloqueado
  PERFORM public.__rpc_book_test_assert(
    public.__rpc_book_test_call_expect_fail(v_editor, v_exp_roles, v_future),
    'test 3: editor bloqueado'
  );

  -- Test 4: mesa bloqueada
  PERFORM public.__rpc_book_test_assert(
    public.__rpc_book_test_call_expect_fail(v_mesa_admin, v_exp_roles, v_future),
    'test 4: mesa bloqueada'
  );

  -- Test 5: super_admin bloqueado
  PERFORM public.__rpc_book_test_assert(
    public.__rpc_book_test_call_expect_fail(v_super, v_exp_roles, v_future),
    'test 5: super_admin bloqueado'
  );

  -- Test 6: etapa distinta de 3/4/5
  PERFORM public.__rpc_book_test_assert(
    public.__rpc_book_test_call_expect_fail(v_asesor_a1, v_exp_wrong_etapa, v_future),
    'test 6: etapa != 3/4/5 falla'
  );

  -- Test 7: no enviado a Mesa
  PERFORM public.__rpc_book_test_assert(
    public.__rpc_book_test_call_expect_fail(v_asesor_a1, v_exp_not_sent, v_future),
    'test 7: no enviado falla'
  );

  -- Test 8: soft-deleted
  PERFORM public.__rpc_book_test_assert(
    public.__rpc_book_test_call_expect_fail(v_asesor_a1, v_exp_deleted, v_future),
    'test 8: deleted falla'
  );

  -- Test 9: fecha pasada
  PERFORM public.__rpc_book_test_assert(
    public.__rpc_book_test_call_expect_fail(v_asesor_a1, v_exp_past, v_past),
    'test 9: fecha pasada falla'
  );

  -- Test 10: fecha futura
  v_result := public.__rpc_book_test_call_as(v_asesor_a1, v_exp_future, v_future);
  PERFORM public.__rpc_book_test_assert(
    (v_result->>'ok')::boolean = true,
    'test 10: fecha futura ok'
  );

  -- Test 11: duplicado activo
  v_result := public.__rpc_book_test_call_as(v_asesor_a1, v_exp_dup, v_future);
  PERFORM public.__rpc_book_test_assert(
    (v_result->>'ok')::boolean = true,
    'test 11: primer booking dup ok'
  );
  PERFORM public.__rpc_book_test_assert(
    public.__rpc_book_test_call_expect_fail(
      v_asesor_a1, v_exp_dup,
      public.agenda_biometricos_slot_ts(1, '11:00', 8),
      'sede-centro'
    ),
    'test 11: duplicado activo falla'
  );

  -- Test 12: cita cancelada previa permite nueva
  INSERT INTO public.agenda_bookings (
    organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, created_by, cancelled_at
  ) VALUES (
    v_org_id, 'biometricos', v_exp_rebook, CURRENT_DATE + 1, '10:00:00',
    'sede-vieja', 'cancelled', v_asesor_a1, NOW()
  );
  v_result := public.__rpc_book_test_call_as(v_asesor_a1, v_exp_rebook, v_future, 'sede-nueva');
  PERFORM public.__rpc_book_test_assert(
    (v_result->>'ok')::boolean = true,
    'test 12: rebook tras cancelada ok'
  );

  -- Test 13: fila en agenda_bookings
  v_booking_id := (v_result->>'booking_id')::uuid;
  PERFORM public.__rpc_book_test_assert(
    EXISTS (
      SELECT 1 FROM public.agenda_bookings b
      WHERE b.id = v_booking_id
        AND b.expediente_id = v_exp_rebook
        AND b.kind = 'biometricos'
        AND b.status = 'booked'
    ),
    'test 13: fila agenda_bookings'
  );

  -- Test 14: action_log
  PERFORM public.__rpc_book_test_assert(
    EXISTS (
      SELECT 1 FROM public.action_log al
      WHERE al.entity_type = 'agenda_booking'
        AND al.entity_id = v_booking_id
        AND al.action = 'agenda.biometricos.book'
    ),
    'test 14: action_log'
  );

  -- Test 15: no cambia etapa_actual
  v_result := public.__rpc_book_test_call_as(v_asesor_a1, v_exp_etapa_check, v_future);
  PERFORM public.__rpc_book_test_assert(
    (v_result->>'etapa_actual')::int = 4,
    'test 15: respuesta etapa 4'
  );
  PERFORM public.__rpc_book_test_assert(
    EXISTS (
      SELECT 1 FROM public.expedientes e
      WHERE e.id = v_exp_etapa_check AND e.etapa_actual = 4
    ),
    'test 15: expediente sigue etapa 4'
  );

  -- Test 16: campos JSON obligatorios
  PERFORM public.__rpc_book_test_assert(
    v_result ? 'ok'
    AND v_result ? 'booking_id'
    AND v_result ? 'expediente_id'
    AND v_result ? 'scheduled_at'
    AND v_result ? 'status'
    AND v_result ? 'kind',
    'test 16: JSON completo'
  );
  PERFORM public.__rpc_book_test_assert(
    (v_result->>'ok')::boolean = true,
    'test 16: ok true'
  );

  -- Test 17: índice único parcial anti-duplicado existe
  PERFORM public.__rpc_book_test_assert(
    EXISTS (
      SELECT 1
      FROM pg_indexes i
      WHERE i.schemaname = 'public'
        AND i.tablename = 'agenda_bookings'
        AND i.indexname = 'agenda_bookings_one_active_biometricos_per_expediente_idx'
    ),
    'test 17: índice único parcial existe'
  );
  PERFORM public.__rpc_book_test_assert(
    EXISTS (
      SELECT 1
      FROM pg_index ix
      JOIN pg_class c ON c.oid = ix.indexrelid
      WHERE c.relname = 'agenda_bookings_one_active_biometricos_per_expediente_idx'
        AND ix.indisunique = true
    ),
    'test 17: índice marcado como unique'
  );

  -- Test 18: DB rechaza segundo booked activo (protección índice, no solo RPC)
  v_result := public.__rpc_book_test_call_as(v_asesor_a1, v_exp_db_dup, v_future, 'sede-db-dup');
  PERFORM public.__rpc_book_test_assert(
    (v_result->>'ok')::boolean = true,
    'test 18: primer booking db_dup ok'
  );
  BEGIN
    INSERT INTO public.agenda_bookings (
      organization_id, kind, expediente_id, booking_date, booking_time,
      location_id, status, created_by
    ) VALUES (
      v_org_id, 'biometricos', v_exp_db_dup, CURRENT_DATE + 2, '11:00:00',
      'sede-forzada', 'booked', v_asesor_a1
    );
    PERFORM public.__rpc_book_test_assert(false, 'test 18: segundo booked debió fallar por índice');
  EXCEPTION
    WHEN unique_violation THEN
      NULL;
  END;
  PERFORM public.__rpc_book_test_assert(
    (
      SELECT COUNT(*)::int
      FROM public.agenda_bookings b
      WHERE b.expediente_id = v_exp_db_dup
        AND b.kind = 'biometricos'
        AND b.status = 'booked'
    ) = 1,
    'test 18: solo un booked activo tras intento forzado'
  );

  -- Test 19: asesor agenda en etapa 5 tras cancelación Mesa
  PERFORM public.__rpc_book_test_insert_expediente(
    v_exp_etapa5, v_org_id, v_asesor_a1, '90813000013', 5::smallint
  );
  INSERT INTO public.agenda_bookings (
    organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, created_by, cancelled_at, note
  ) VALUES (
    v_org_id, 'biometricos', v_exp_etapa5, CURRENT_DATE + 1, '10:00:00',
    'sede-vieja', 'cancelled', v_asesor_a1, NOW(), 'Cancelado: Mesa solicita reagenda'
  );
  v_result := public.__rpc_book_test_call_as(
    v_asesor_a1, v_exp_etapa5, public.agenda_biometricos_slot_ts(1, '11:00', 8), 'sede-centro'
  );
  PERFORM public.__rpc_book_test_assert(
    (v_result->>'ok')::boolean = true AND (v_result->>'etapa_actual')::int = 5,
    'test 19: book biométricos etapa 5 tras cancel'
  );
  PERFORM public.__rpc_book_test_assert(
    EXISTS (
      SELECT 1 FROM public.expedientes e
      WHERE e.id = v_exp_etapa5 AND e.etapa_actual = 5
    ),
    'test 19: etapa sigue 5'
  );

  -- Test 20: etapa 5 sin cancelación previa
  PERFORM public.__rpc_book_test_insert_expediente(
    v_exp_etapa5_nocancel, v_org_id, v_asesor_a1, '90814000014', 5::smallint
  );
  PERFORM public.__rpc_book_test_assert(
    public.__rpc_book_test_call_expect_fail(
      v_asesor_a1, v_exp_etapa5_nocancel, public.agenda_biometricos_slot_ts(1, '11:00', 9)
    ),
    'test 20: etapa 5 sin cancelación previa falla'
  );

  -- Test 21: etapa 5 con último booking no cancelado
  PERFORM public.__rpc_book_test_insert_expediente(
    v_exp_etapa5_booked, v_org_id, v_asesor_a1, '90814100015', 5::smallint
  );
  INSERT INTO public.agenda_bookings (
    organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, created_by
  ) VALUES (
    v_org_id, 'biometricos', v_exp_etapa5_booked, CURRENT_DATE + 1, '10:00:00',
    'sede-vieja', 'booked', v_asesor_a1
  );
  PERFORM public.__rpc_book_test_assert(
    public.__rpc_book_test_call_expect_fail(
      v_asesor_a1, v_exp_etapa5_booked, public.agenda_biometricos_slot_ts(1, '11:00', 10)
    ),
    'test 21: etapa 5 último booking no cancelado falla'
  );

  -- Test 22: etapa 5 subestado distinto de en_proceso
  PERFORM public.__rpc_book_test_insert_expediente(
    v_exp_etapa5_badsub, v_org_id, v_asesor_a1, '90814200016', 5::smallint,
    true, NULL, 'pendiente'::public.operativo_subestado
  );
  INSERT INTO public.agenda_bookings (
    organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, created_by, cancelled_at, note
  ) VALUES (
    v_org_id, 'biometricos', v_exp_etapa5_badsub, CURRENT_DATE + 1, '10:00:00',
    'sede-vieja', 'cancelled', v_asesor_a1, NOW(), 'Cancelado: Mesa solicita reagenda'
  );
  PERFORM public.__rpc_book_test_assert(
    public.__rpc_book_test_call_expect_fail(
      v_asesor_a1, v_exp_etapa5_badsub, public.agenda_biometricos_slot_ts(1, '11:00', 11)
    ),
    'test 22: etapa 5 subestado distinto de en_proceso falla'
  );

  RAISE NOTICE 'RPC book_biometricos: 22 pruebas OK';
END;
$$;

DROP FUNCTION IF EXISTS public.__rpc_book_test_insert_expediente(UUID, UUID, UUID, CHAR, SMALLINT, BOOLEAN, TIMESTAMPTZ, public.operativo_subestado);
DROP FUNCTION IF EXISTS public.__rpc_book_test_call_expect_fail(UUID, UUID, TIMESTAMPTZ, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_book_test_call_as(UUID, UUID, TIMESTAMPTZ, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_book_test_reset_auth();
DROP FUNCTION IF EXISTS public.__rpc_book_test_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__rpc_book_test_assert(BOOLEAN, TEXT);
