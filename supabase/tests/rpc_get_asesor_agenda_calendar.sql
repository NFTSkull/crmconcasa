-- ConCasa CRM — P064 RPC get_asesor_agenda_calendar (solo lectura org-wide)
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__rpc_calendar_test_insert_expediente(
  p_id UUID,
  p_org UUID,
  p_asesor UUID,
  p_nss TEXT,
  p_origen public.origen_mesa
) RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (
    p_id, p_org, p_asesor, 'mejoravit', p_nss, 'Cliente test',
    '8110000000', p_origen, true, 4, 'en_proceso', 'activo'
  )
  ON CONFLICT (id) DO UPDATE SET
    asesor_id = EXCLUDED.asesor_id,
    deleted_at = NULL,
    submitted_to_mesa = true,
    etapa_actual = 4,
    subestado = 'en_proceso';
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000001';
  v_asesor_a1 UUID := '00000000-0000-4000-8001-000000000001';
  v_asesor_a2 UUID := '00000000-0000-4000-8001-000000000002';
  v_editor UUID := '00000000-0000-4000-8002-000000000001';

  v_exp_a1 UUID := '00000000-0000-4000-9010-000000000001';
  v_exp_a2 UUID := '00000000-0000-4000-9010-000000000002';

  v_day DATE := CURRENT_DATE + 14;
  v_rows INTEGER;
  v_direct INTEGER;
BEGIN
  PERFORM public.__rpc_calendar_test_insert_expediente(v_exp_a1, v_org, v_asesor_a1, '90100000001', 'interno');
  PERFORM public.__rpc_calendar_test_insert_expediente(v_exp_a2, v_org, v_asesor_a2, '90100000002', 'externo');

  DELETE FROM public.agenda_bookings
  WHERE expediente_id IN (v_exp_a1, v_exp_a2)
    AND booking_date = v_day;

  INSERT INTO public.agenda_bookings (
    organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, created_by
  ) VALUES (
    v_org, 'biometricos', v_exp_a1, v_day, '10:00:00', 'sede-centro', 'booked', v_asesor_a1
  );

  INSERT INTO public.agenda_bookings (
    organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, created_by, cancelled_at
  ) VALUES (
    v_org, 'firmas', v_exp_a2, v_day, '11:30:00', 'sede-norte', 'cancelled', v_asesor_a2, NOW()
  );

  INSERT INTO public.agenda_bookings (
    organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, created_by
  ) VALUES (
    v_org, 'firmas', v_exp_a2, v_day, '15:00:00', 'sede-norte', 'booked', v_asesor_a2
  );

  -- Asesor A2 ve cita de A1 vía RPC (RLS directo no lo permitiría)
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_asesor_a2::text, true);

  SELECT count(*)::INTEGER
  INTO v_rows
  FROM public.get_asesor_agenda_calendar(v_day, v_day, false)
  WHERE kind = 'biometricos'
    AND asesor_id = v_asesor_a1
    AND status = 'booked';

  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'calendar: asesor B debió ver cita biométrica de asesor A (rows=%)', v_rows;
  END IF;

  SELECT count(*)::INTEGER
  INTO v_rows
  FROM public.get_asesor_agenda_calendar(v_day, v_day, false)
  WHERE kind = 'firmas'
    AND asesor_id = v_asesor_a2
    AND status = 'booked';

  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'calendar: debió ver solo firma activa de A2 (rows=%)', v_rows;
  END IF;

  SELECT count(*)::INTEGER
  INTO v_rows
  FROM public.get_asesor_agenda_calendar(v_day, v_day, true)
  WHERE kind = 'firmas'
    AND asesor_id = v_asesor_a2
    AND status = 'cancelled';

  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'calendar: include_cancelled debió devolver firma cancelada (rows=%)', v_rows;
  END IF;

  -- RLS directo: asesor A2 no ve booking del expediente ajeno
  SELECT count(*)::INTEGER
  INTO v_direct
  FROM public.agenda_bookings b
  WHERE b.expediente_id = v_exp_a1
    AND b.status = 'booked';

  IF v_direct <> 0 THEN
    RAISE EXCEPTION 'calendar: RLS directo no debió exponer booking ajeno (rows=%)', v_direct;
  END IF;

  -- Editor bloqueado
  PERFORM set_config('request.jwt.claim.sub', v_editor::text, true);
  BEGIN
    PERFORM count(*) FROM public.get_asesor_agenda_calendar(v_day, v_day, false);
    RAISE EXCEPTION 'calendar: editor debió estar bloqueado';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%forbidden_role%' THEN
      RAISE;
    END IF;
  END;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

DROP FUNCTION IF EXISTS public.__rpc_calendar_test_insert_expediente(UUID, UUID, UUID, TEXT, public.origen_mesa);
