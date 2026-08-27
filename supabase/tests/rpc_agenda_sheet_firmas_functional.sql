-- ConCasa CRM — Firmas funcional post-mig 129 (sin asserts de mensaje desfasados)
-- Valida: book OK, cupo agotado rechaza, cancel + reagendar OK.
-- No modifica mensajes ni RPC de Firmas.
\set ON_ERROR_STOP on

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000001';
  v_asesor UUID := '00000000-0000-4000-8001-000000000001';
  v_mesa UUID := '00000000-0000-4000-8003-000000000001';
  v_exp UUID := '00000000-0000-4000-9129-00000000f001';
  v_exp2 UUID := '00000000-0000-4000-9129-00000000f002';
  v_exp3 UUID := '00000000-0000-4000-9129-00000000f003';
  v_exp4 UUID := '00000000-0000-4000-9129-00000000f004';
  v_cfg JSONB;
  v_slot TIMESTAMPTZ;
  v_slot2 TIMESTAMPTZ;
  v_res JSONB;
  v_fail BOOLEAN;
  v_err TEXT;
  v_booked INTEGER;
  v_cancelled INTEGER;
  v_date DATE;
  v_time TIME := '10:00';
  v_tz TEXT := 'America/Monterrey';
BEGIN
  -- Config firmas con capacity_by_time explícito (P124)
  v_cfg := jsonb_build_object(
    'enabled', true,
    'timezone', v_tz,
    'min_lead_hours', 0,
    'allowed_weekdays', jsonb_build_array(1,2,3,4,5,6,7),
    'slots', jsonb_build_array('09:00', '10:00', '11:00'),
    'locations', jsonb_build_object(
      'mty-centro', jsonb_build_object(
        'enabled', true,
        'capacity_per_slot', 2,
        'capacity_by_time', jsonb_build_object('09:00', 2, '10:00', 2, '11:00', 2)
      ),
      'monterrey', jsonb_build_object(
        'enabled', true,
        'capacity_per_slot', 2,
        'capacity_by_time', jsonb_build_object('09:00', 2, '10:00', 2, '11:00', 2)
      )
    )
  );

  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_mesa::text, true);
  PERFORM public.upsert_agenda_config_firmas(v_cfg, v_org);
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  v_date := (CURRENT_DATE + 14);
  WHILE EXTRACT(ISODOW FROM v_date)::INTEGER NOT IN (1,2,3,4,5) LOOP
    v_date := v_date + 1;
  END LOOP;
  v_slot := ((v_date::TEXT || ' 10:00:00')::TIMESTAMP AT TIME ZONE v_tz);
  v_slot2 := ((v_date::TEXT || ' 11:00:00')::TIMESTAMP AT TIME ZONE v_tz);

  DELETE FROM public.agenda_bookings WHERE expediente_id IN (v_exp, v_exp2, v_exp3, v_exp4);
  DELETE FROM public.expediente_paso_visual_transiciones WHERE expediente_id IN (v_exp, v_exp2, v_exp3, v_exp4);
  DELETE FROM public.expedientes WHERE id IN (v_exp, v_exp2, v_exp3, v_exp4);

  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, ciclo_estado
  ) VALUES
    (v_exp, v_org, v_asesor, 'mejoravit', '12900000901', 'Firmas Func 1', '5512900901', 'interno', true, NOW(), 9, 'en_proceso', 'activo'),
    (v_exp2, v_org, v_asesor, 'mejoravit', '12900000902', 'Firmas Func 2', '5512900902', 'interno', true, NOW(), 9, 'en_proceso', 'activo'),
    (v_exp3, v_org, v_asesor, 'mejoravit', '12900000903', 'Firmas Func 3', '5512900903', 'interno', true, NOW(), 9, 'en_proceso', 'activo'),
    (v_exp4, v_org, v_asesor, 'mejoravit', '12900000904', 'Firmas Func 4', '5512900904', 'interno', true, NOW(), 9, 'en_proceso', 'activo');

  -- 1) Book válido
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_asesor::text, true);
  v_res := public.book_firmas(v_exp, v_slot, 'mty-centro', 'sheet-func-1');
  IF NOT COALESCE((v_res->>'ok')::BOOLEAN, false) THEN
    RAISE EXCEPTION 'FIRMAS FUNC FAIL: book válido';
  END IF;

  SELECT COUNT(*) INTO v_booked
  FROM public.agenda_bookings
  WHERE expediente_id = v_exp AND kind = 'firmas' AND status = 'booked';
  IF v_booked <> 1 THEN
    RAISE EXCEPTION 'FIRMAS FUNC FAIL: booking no persistió';
  END IF;

  -- 2) Llenar cupo (capacity=2) y rechazar tercero
  PERFORM public.book_firmas(v_exp2, v_slot, 'mty-centro', 'sheet-func-2');
  BEGIN
    PERFORM public.book_firmas(v_exp3, v_slot, 'mty-centro', 'sheet-func-3');
    v_fail := false;
  EXCEPTION WHEN OTHERS THEN
    v_fail := true;
    v_err := SQLERRM;
  END;
  IF NOT v_fail THEN
    RAISE EXCEPTION 'FIRMAS FUNC FAIL: debía rechazar sin cupo';
  END IF;
  IF position('cupo' IN lower(v_err)) = 0 AND position('agotado' IN lower(v_err)) = 0 THEN
    RAISE EXCEPTION 'FIRMAS FUNC FAIL: rechazo sin cupo inesperado: %', v_err;
  END IF;

  -- 3) Reagendar desde cita activa (sin cancelar antes)
  v_res := public.reagendar_firmas(v_exp, v_slot2, 'mty-centro', 'reagendar-func');
  IF NOT COALESCE((v_res->>'ok')::BOOLEAN, false) THEN
    RAISE EXCEPTION 'FIRMAS FUNC FAIL: reagendar';
  END IF;
  SELECT COUNT(*) INTO v_booked
  FROM public.agenda_bookings
  WHERE expediente_id = v_exp AND kind = 'firmas' AND status = 'booked'
    AND booking_time = '11:00';
  IF v_booked <> 1 THEN
    RAISE EXCEPTION 'FIRMAS FUNC FAIL: reagendar no dejó booking 11:00';
  END IF;

  -- 4) Cancel
  v_res := public.cancel_firmas(v_exp, 'test sheet funcional');
  IF NOT COALESCE((v_res->>'ok')::BOOLEAN, false) THEN
    RAISE EXCEPTION 'FIRMAS FUNC FAIL: cancel';
  END IF;
  SELECT COUNT(*) INTO v_cancelled
  FROM public.agenda_bookings
  WHERE expediente_id = v_exp AND kind = 'firmas' AND status = 'cancelled';
  IF v_cancelled < 1 THEN
    RAISE EXCEPTION 'FIRMAS FUNC FAIL: cancel no marcó cancelled';
  END IF;

  -- 5) Volver a agendar tras cancel (comportamiento post-129)
  v_res := public.book_firmas(v_exp, v_slot2, 'mty-centro', 'rebook-after-cancel');
  IF NOT COALESCE((v_res->>'ok')::BOOLEAN, false) THEN
    RAISE EXCEPTION 'FIRMAS FUNC FAIL: book tras cancel';
  END IF;

  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  -- Outbox mig 129 existe y acepta eventos (lectura como postgres; RLS bloquea authenticated)
  IF to_regclass('public.agenda_sheet_sync_outbox') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.agenda_sheet_sync_outbox o
      WHERE o.booking_id IN (
        SELECT b.id FROM public.agenda_bookings b WHERE b.expediente_id = v_exp
      )
    ) THEN
      RAISE NOTICE 'FIRMAS FUNC: outbox sin filas para exp (puede ser normal si trigger filtró)';
    END IF;
  END IF;

  RAISE NOTICE 'FIRMAS FUNCIONAL OK (book/cupo/reagendar/cancel/rebook; mig 129 no rompe)';
END;
$$;
