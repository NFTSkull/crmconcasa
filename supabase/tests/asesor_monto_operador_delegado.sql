-- Regresión estática: asesor_update_monto_aprobado debe usar la autorización P208.
-- No crea perfiles, expedientes ni datos de prueba.
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__asesor_monto_delegado_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'ASESOR MONTO DELEGADO TEST FAIL: %', p_msg;
  END IF;
END;
$$;

DO $$
DECLARE
  v_def TEXT;
BEGIN
  SELECT pg_get_functiondef(
    'public.asesor_update_monto_aprobado(uuid,numeric)'::regprocedure
  ) INTO v_def;

  PERFORM public.__asesor_monto_delegado_assert(
    v_def IS NOT NULL,
    'asesor_update_monto_aprobado existe'
  );

  PERFORM public.__asesor_monto_delegado_assert(
    position('asesor_can_operate_expediente_as' in v_def) > 0,
    'usa asesor_can_operate_expediente_as'
  );

  PERFORM public.__asesor_monto_delegado_assert(
    position('solo el asesor dueño puede actualizar el monto' in v_def) = 0,
    'ya no conserva gate owner-only'
  );

  PERFORM public.__asesor_monto_delegado_assert(
    position('expediente de otra organización' in v_def) > 0,
    'mantiene aislamiento por organización'
  );

  PERFORM public.__asesor_monto_delegado_assert(
    position('expediente ya enviado a Mesa' in v_def) > 0,
    'mantiene bloqueo post-Mesa'
  );
END;
$$;

DROP FUNCTION public.__asesor_monto_delegado_assert(BOOLEAN, TEXT);
