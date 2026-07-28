-- ConCasa CRM — P132: Notificación libera firma (estructural, sin mutar expedientes)
-- Uso local: PGPASSWORD=postgres psql ... -f supabase/tests/rpc_notificacion_libera_firma_p132.sql
-- Uso Cloud: npx supabase db query --linked -f supabase/tests/rpc_notificacion_libera_firma_p132.sql

CREATE OR REPLACE FUNCTION public.__p132_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P132 FAIL: %', p_msg;
  END IF;
END;
$$;

DO $$
DECLARE
  v_src TEXT;
  v_name TEXT;
  v_branch5 TEXT;
  v_lunes DATE := DATE '2026-07-06';
  v_viernes DATE := DATE '2026-07-10';
  v_lunes_sig DATE;
  v_viernes_sig DATE;
  v_pos5 INT;
  v_pos6 INT;
BEGIN
  PERFORM public.__p132_assert(EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'expedientes'
      AND column_name = 'firma_agendable_desde'
      AND data_type = 'date'
      AND is_nullable = 'YES'
  ), 'columna firma_agendable_desde DATE NULL');

  PERFORM public.__p132_assert(EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'expedientes'
      AND column_name = 'notificacion_primera_cargada_at'
      AND udt_name = 'timestamptz'
      AND is_nullable = 'YES'
  ), 'columna notificacion_primera_cargada_at TIMESTAMPTZ NULL');

  PERFORM public.__p132_assert(EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'add_business_days_monterrey'
  ), 'add_business_days_monterrey existe');

  PERFORM public.__p132_assert(EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'expediente_apply_notificacion_7_9'
  ), 'expediente_apply_notificacion_7_9 existe');

  PERFORM public.__p132_assert(EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'agenda_firmas_assert_agendable_desde'
  ), 'agenda_firmas_assert_agendable_desde existe');

  v_lunes_sig := public.add_business_days_monterrey(v_lunes, 5);
  v_viernes_sig := public.add_business_days_monterrey(v_viernes, 5);
  PERFORM public.__p132_assert(
    v_lunes_sig = DATE '2026-07-13',
    format('lunes+5=%s esperado 2026-07-13', v_lunes_sig)
  );
  PERFORM public.__p132_assert(
    v_viernes_sig = DATE '2026-07-17',
    format('viernes+5=%s esperado 2026-07-17', v_viernes_sig)
  );

  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'avanzar_etapa_operativa_pre_reingreso'
  LIMIT 1;
  PERFORM public.__p132_assert(v_src IS NOT NULL, 'avanzar_etapa_operativa_pre_reingreso existe');
  PERFORM public.__p132_assert(position('''5_7''' in v_src) > 0, 'source contiene 5_7');

  v_pos5 := position('ELSIF v_exp.etapa_actual = 5 THEN' in v_src);
  v_pos6 := position('ELSIF v_exp.etapa_actual = 6 THEN' in v_src);
  PERFORM public.__p132_assert(v_pos5 > 0 AND v_pos6 > v_pos5, 'ramas 5 y 6 ordenadas');
  v_branch5 := substring(v_src from v_pos5 for (v_pos6 - v_pos5));
  PERFORM public.__p132_assert(position('''5_7''' in v_branch5) > 0, 'rama 5 usa transition 5_7');
  PERFORM public.__p132_assert(position('''etapa_nueva'', 7' in v_branch5) > 0, 'rama 5 etapa_nueva 7');
  PERFORM public.__p132_assert(position('etapa_actual = 7' in v_branch5) > 0, 'rama 5 UPDATE a 7');
  PERFORM public.__p132_assert(position('''5_6''' in v_branch5) = 0, 'rama 5 sin 5_6');
  PERFORM public.__p132_assert(position('etapa_actual = 6' in v_branch5) = 0, 'rama 5 no setea etapa 6');

  PERFORM public.__p132_assert(position('''6_7''' in v_src) > 0, 'conserva 6_7');
  PERFORM public.__p132_assert(position('''7_8''' in v_src) > 0, 'conserva 7_8');
  PERFORM public.__p132_assert(position('''8_9''' in v_src) > 0, 'conserva 8_9');

  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'register_mesa_documento'
  LIMIT 1;
  PERFORM public.__p132_assert(
    position('expediente_apply_notificacion_7_9' in v_src) > 0,
    'register_mesa_documento llama apply 7_9'
  );

  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'register_expediente_documento_pre_reingreso'
  LIMIT 1;
  PERFORM public.__p132_assert(
    position('expediente_apply_notificacion_7_9' in v_src) > 0,
    'pre_reingreso llama apply 7_9'
  );

  PERFORM public.__p132_assert(
    'cliente_notificacion' = ANY(public.integration_doc_tipos_asesor_upload()),
    'asesor upload allowlist incluye cliente_notificacion'
  );

  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'register_expediente_documento_retencion'
  LIMIT 1;
  PERFORM public.__p132_assert(v_src IS NOT NULL, 'register_retencion existe');
  PERFORM public.__p132_assert(
    position('v_avance_8_9 := true' in v_src) = 0,
    'retencion no setea v_avance_8_9 := true'
  );
  PERFORM public.__p132_assert(
    position('etapa_actual = 9' in v_src) = 0,
    'retencion no hace UPDATE etapa_actual = 9'
  );

  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'enviar_retencion_mesa'
  LIMIT 1;
  PERFORM public.__p132_assert(
    position('etapa_actual = 9,' in v_src) = 0,
    'enviar_retencion_mesa sin SET etapa_actual = 9'
  );

  FOREACH v_name IN ARRAY ARRAY[
    'book_firmas',
    'reagendar_firmas',
    'mesa_book_firmas',
    'mesa_reagendar_firmas'
  ]::TEXT[] LOOP
    SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = v_name
    LIMIT 1;
    PERFORM public.__p132_assert(v_src IS NOT NULL, v_name || ' existe');
    PERFORM public.__p132_assert(
      position('agenda_firmas_assert_agendable_desde' in v_src) > 0,
      v_name || ' llama agenda_firmas_assert_agendable_desde'
    );
  END LOOP;

  RAISE NOTICE 'RPC notificacion_libera_firma P132: structural OK (sin mutar expedientes)';
END;
$$;

DROP FUNCTION IF EXISTS public.__p132_assert(BOOLEAN, TEXT);
