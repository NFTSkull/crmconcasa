-- Excepciones one-time firmas (estático)
CREATE OR REPLACE FUNCTION public.__exc_firmas_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT p_ok THEN RAISE EXCEPTION 'EXC FIRMAS FAIL: %', p_msg; END IF; END;
$$;

DO $$
DECLARE
  v_src TEXT;
  v_sig TEXT;
BEGIN
  PERFORM public.__exc_firmas_assert(
    to_regclass('public.agenda_booking_exceptions') IS NOT NULL,
    'tabla agenda_booking_exceptions'
  );

  PERFORM public.__exc_firmas_assert(
    EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='super_admin_grant_booking_exception'
    ),
    'rpc grant'
  );

  PERFORM public.__exc_firmas_assert(
    EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='agenda_firmas_assert_agendable_desde'
    ),
    'assert existe'
  );

  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='agenda_firmas_assert_agendable_desde'
  LIMIT 1;
  PERFORM public.__exc_firmas_assert(
    position('agenda_firmas_find_pending_exception' in v_src) > 0,
    'assert consulta excepción'
  );
  PERFORM public.__exc_firmas_assert(
    position('firma solo puede agendarse desde' in v_src) > 0,
    'mensaje gate intacto'
  );

  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='book_firmas'
  LIMIT 1;
  PERFORM public.__exc_firmas_assert(
    position('agenda_firmas_consume_booking_exception' in v_src) > 0,
    'book consume excepción'
  );
  PERFORM public.__exc_firmas_assert(
    position('via'', ''booking_exception' in v_src) > 0
    OR position('booking_exception' in v_src) > 0,
    'book puede avanzar 9→10 vía excepción'
  );

  v_sig := 'public.super_admin_grant_booking_exception(uuid,text,text,date,time without time zone,text)';
  PERFORM public.__exc_firmas_assert(
    has_function_privilege('authenticated', v_sig, 'EXECUTE'),
    'grant authenticated (rol validado dentro)'
  );
  PERFORM public.__exc_firmas_assert(
    NOT has_function_privilege('anon', v_sig, 'EXECUTE'),
    'anon sin grant'
  );

  -- Regresión: helper 5 días / slot intactos
  PERFORM public.__exc_firmas_assert(
    EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='agenda_firmas_assert_slot_available'
    ),
    'assert slot intacto'
  );

  RAISE NOTICE 'EXC FIRMAS OK';
END $$;

DROP FUNCTION IF EXISTS public.__exc_firmas_assert(BOOLEAN, TEXT);
