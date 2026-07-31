-- ConCasa CRM — Firmas sin mínimo de 5 días hábiles (mig 139)
-- Uso: PGPASSWORD=postgres psql ... -f supabase/tests/rpc_firmas_sin_minimo_5_dias_habiles.sql

CREATE OR REPLACE FUNCTION public.__firmas_no5_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'FIRMAS-NO5 FAIL: %', p_msg;
  END IF;
END;
$$;

DO $$
DECLARE
  v_src TEXT;
  v_name TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'register_expediente_documento_retencion'
  LIMIT 1;
  PERFORM public.__firmas_no5_assert(v_src IS NOT NULL, 'register_retencion existe');
  PERFORM public.__firmas_no5_assert(
    position('v_firma_desde := v_fecha_local' in v_src) > 0,
    'setter = hoy Monterrey'
  );
  PERFORM public.__firmas_no5_assert(
    position('add_business_days_monterrey(v_fecha_local, 5)' in v_src) = 0,
    'sin +5 hábiles en retencion'
  );
  PERFORM public.__firmas_no5_assert(
    position('v_avance_8_9 := true' in v_src) > 0,
    'conserva avance 8→9'
  );

  -- Gate SQL sigue existiendo (NULL/hoy permiten; fechas pasadas vía scheduled_at > NOW)
  PERFORM public.__firmas_no5_assert(EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'agenda_firmas_assert_agendable_desde'
  ), 'assert agendable_desde existe');

  FOREACH v_name IN ARRAY ARRAY[
    'book_firmas',
    'reagendar_firmas'
  ]::TEXT[] LOOP
    SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = v_name
    LIMIT 1;
    PERFORM public.__firmas_no5_assert(v_src IS NOT NULL, v_name || ' existe');
    PERFORM public.__firmas_no5_assert(
      position('agenda_firmas_assert_agendable_desde' in v_src) > 0,
      v_name || ' conserva assert agendable'
    );
    PERFORM public.__firmas_no5_assert(
      position('p_scheduled_at <= NOW()' in v_src) > 0
        OR position('p_scheduled_at < NOW()' in v_src) > 0
        OR position('debe ser en fecha/hora futura' in v_src) > 0,
      v_name || ' bloquea pasado'
    );
  END LOOP;

  -- Biométricos intactos
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'book_biometricos'
  LIMIT 1;
  PERFORM public.__firmas_no5_assert(v_src IS NOT NULL, 'book_biometricos existe');
  PERFORM public.__firmas_no5_assert(
    position('agenda_firmas_assert_agendable_desde' in v_src) = 0,
    'book_biometricos no usa gate firmas'
  );

  RAISE NOTICE 'rpc_firmas_sin_minimo_5_dias_habiles: OK';
END;
$$;

DROP FUNCTION IF EXISTS public.__firmas_no5_assert(BOOLEAN, TEXT);
