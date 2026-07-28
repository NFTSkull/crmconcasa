-- ConCasa CRM — P132 (post acuse-libera-firma): asserts residuales Notificación
-- Notificación ya NO avanza 7→9; helper días hábiles + gate firmas se conservan.
-- Uso: npx supabase db query --linked -f supabase/tests/rpc_notificacion_libera_firma_p132.sql

CREATE OR REPLACE FUNCTION public.__p132_notif_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P132-NOTIF FAIL: %', p_msg;
  END IF;
END;
$$;

DO $$
DECLARE
  v_src TEXT;
  v_name TEXT;
  v_lunes DATE := DATE '2026-07-06';
  v_lunes_sig DATE;
BEGIN
  PERFORM public.__p132_notif_assert(EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'expedientes'
      AND column_name = 'firma_agendable_desde'
      AND data_type = 'date'
      AND is_nullable = 'YES'
  ), 'columna firma_agendable_desde DATE NULL');

  PERFORM public.__p132_notif_assert(EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'add_business_days_monterrey'
  ), 'add_business_days_monterrey existe');

  PERFORM public.__p132_notif_assert(EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'expediente_apply_notificacion_7_9'
  ), 'expediente_apply_notificacion_7_9 existe (stub)');

  PERFORM public.__p132_notif_assert(EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'agenda_firmas_assert_agendable_desde'
  ), 'agenda_firmas_assert_agendable_desde existe');

  v_lunes_sig := public.add_business_days_monterrey(v_lunes, 5);
  PERFORM public.__p132_notif_assert(
    v_lunes_sig = DATE '2026-07-13',
    format('lunes+5=%s esperado 2026-07-13', v_lunes_sig)
  );

  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'expediente_apply_notificacion_7_9'
  LIMIT 1;
  PERFORM public.__p132_notif_assert(position('''noop''' in v_src) > 0, 'apply 7_9 es stub noop');
  PERFORM public.__p132_notif_assert(
    position('etapa_actual = 9' in v_src) = 0,
    'stub no avanza etapa'
  );

  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'register_mesa_documento'
  LIMIT 1;
  PERFORM public.__p132_notif_assert(
    position('expediente_apply_notificacion_7_9' in v_src) = 0,
    'register_mesa_documento sin apply 7_9'
  );

  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'register_expediente_documento_pre_reingreso'
  LIMIT 1;
  PERFORM public.__p132_notif_assert(
    position('expediente_apply_notificacion_7_9' in v_src) = 0,
    'pre_reingreso sin apply 7_9'
  );

  PERFORM public.__p132_notif_assert(
    'cliente_notificacion' = ANY(public.integration_doc_tipos_asesor_upload()),
    'asesor upload allowlist incluye cliente_notificacion'
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
    PERFORM public.__p132_notif_assert(v_src IS NOT NULL, v_name || ' existe');
    PERFORM public.__p132_notif_assert(
      position('agenda_firmas_assert_agendable_desde' in v_src) > 0,
      v_name || ' conserva gate firma_agendable_desde'
    );
  END LOOP;

  RAISE NOTICE 'RPC notificacion_libera_firma P132 (post-acuse): residual OK';
END;
$$;

DROP FUNCTION IF EXISTS public.__p132_notif_assert(BOOLEAN, TEXT);
