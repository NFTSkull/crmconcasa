-- ConCasa CRM — P119.1: sede real en notificación notificación
\set ON_ERROR_STOP on
BEGIN;

CREATE OR REPLACE FUNCTION public.__p1191_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN RAISE EXCEPTION 'P119.1 TEST FAIL: %', p_msg; END IF;
END;
$$;

DO $$
DECLARE
  v_norm TEXT;
BEGIN
  v_norm := public.agenda_notificacion_normalize_location_id('monterrey');
  PERFORM public.__p1191_assert(v_norm = 'monterrey', 'monterrey');
  v_norm := public.agenda_notificacion_normalize_location_id('apodaca');
  PERFORM public.__p1191_assert(v_norm = 'apodaca', 'apodaca');
  v_norm := public.agenda_notificacion_normalize_location_id('mty-centro');
  PERFORM public.__p1191_assert(v_norm = 'monterrey', 'legacy mty');

  BEGIN
    PERFORM public.agenda_notificacion_normalize_location_id('notificacion');
    RAISE EXCEPTION 'P119.1 TEST FAIL: sentinel debía fallar';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'P119.1 TEST FAIL:%' THEN RAISE; END IF;
    PERFORM public.__p1191_assert(SQLERRM ILIKE '%inválido%', 'reject sentinel');
  END;

  RAISE NOTICE 'P119.1 notificacion sede normalize: OK';
END;
$$;

DROP FUNCTION public.__p1191_assert(BOOLEAN, TEXT);
ROLLBACK;
