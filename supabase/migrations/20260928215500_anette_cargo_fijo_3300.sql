-- ConCasa CRM — cargo fijo de cobro específico para Anette.
-- Regla: expedientes cuyo dueño sea anette.perez@concasa.mx usan $3,300.
-- Todos los demás asesores conservan $3,000.
-- No hace backfill ni pisa montos manuales/históricos.

BEGIN;

CREATE OR REPLACE FUNCTION public.cliente_datos_cargo_fijo(
  p_expediente_id UUID
)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN EXISTS (
      SELECT 1
      FROM public.expedientes e
      INNER JOIN public.profiles p ON p.id = e.asesor_id
      WHERE e.id = p_expediente_id
        AND lower(btrim(COALESCE(p.email, ''))) = 'anette.perez@concasa.mx'
    ) THEN 3300::NUMERIC
    ELSE 3000::NUMERIC
  END;
$function$;

REVOKE ALL ON FUNCTION public.cliente_datos_cargo_fijo(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cliente_datos_cargo_fijo(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.cliente_datos_cargo_fijo(UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.cliente_datos_cargo_fijo(UUID) TO service_role;

COMMENT ON FUNCTION public.cliente_datos_cargo_fijo(UUID) IS
  'Cargo fijo de cobro por dueño: Anette Perez = 3300; resto = 3000. No muta datos.';

DO $patch$
DECLARE
  v_def TEXT;
BEGIN
  -- save_cliente_datos: cálculo canónico de Datos Generales.
  SELECT pg_get_functiondef(p.oid)
  INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'save_cliente_datos'
    AND pg_get_function_identity_arguments(p.oid) =
      'p_expediente_id uuid, p_rfc text, p_telefono text, p_referencias jsonb, p_imagenes jsonb, p_datos jsonb, p_estado cliente_datos_estado, p_porcentaje_cobro numeric, p_metodo_pago text, p_direccion_opcional text, p_monto_calculado_manual numeric';

  IF v_def IS NULL OR position('+ 3000' IN v_def) = 0 THEN
    RAISE EXCEPTION 'anette_cargo_fijo_3300: save_cliente_datos formula no encontrada';
  END IF;
  EXECUTE replace(
    v_def,
    '+ 3000',
    '+ public.cliente_datos_cargo_fijo(p_expediente_id)'
  );

  -- Mesa: si cambia monto operativo, conservar la misma regla del dueño.
  SELECT pg_get_functiondef(p.oid)
  INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'mesa_actualizar_monto_mejoravit'
    AND pg_get_function_identity_arguments(p.oid) =
      'p_expediente_id uuid, p_monto_nuevo numeric, p_motivo text';

  IF v_def IS NULL OR position('+ 3000' IN v_def) = 0 THEN
    RAISE EXCEPTION 'anette_cargo_fijo_3300: mesa_actualizar_monto_mejoravit formula no encontrada';
  END IF;
  EXECUTE replace(
    v_def,
    '+ 3000',
    '+ public.cliente_datos_cargo_fijo(p_expediente_id)'
  );

  -- Reingreso/editor: recálculo al cambiar monto aprobado.
  SELECT pg_get_functiondef(p.oid)
  INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'upsert_editor_decision'
    AND pg_get_function_identity_arguments(p.oid) =
      'p_expediente_id uuid, p_decision editor_decision, p_monto_aprobado numeric, p_motivo text';

  IF v_def IS NULL OR position('+ 3000' IN v_def) = 0 THEN
    RAISE EXCEPTION 'anette_cargo_fijo_3300: upsert_editor_decision formula no encontrada';
  END IF;
  EXECUTE replace(
    v_def,
    '+ 3000',
    '+ public.cliente_datos_cargo_fijo(p_expediente_id)'
  );

  -- Pago ConCasa: solo afecta fallback cuando no existe monto_calculado persistido.
  SELECT pg_get_functiondef(p.oid)
  INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'pago_concasa_resolver_objetivo_vigente'
    AND pg_get_function_identity_arguments(p.oid) = 'p_expediente_id uuid';

  IF v_def IS NULL OR position('+ 3000' IN v_def) = 0 THEN
    RAISE EXCEPTION 'anette_cargo_fijo_3300: pago_concasa fallback no encontrado';
  END IF;
  EXECUTE replace(
    v_def,
    '+ 3000',
    '+ public.cliente_datos_cargo_fijo(p_expediente_id)'
  );

  -- Contexto de Mesa/UI: exponer el cargo fijo real del expediente.
  SELECT pg_get_functiondef(p.oid)
  INTO v_def
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'get_expediente_monto_mejoravit_context'
    AND pg_get_function_identity_arguments(p.oid) = 'p_expediente_id uuid';

  IF v_def IS NULL OR position('''cargo_fijo'', 3000' IN v_def) = 0 THEN
    RAISE EXCEPTION 'anette_cargo_fijo_3300: cargo_fijo de contexto no encontrado';
  END IF;
  EXECUTE replace(
    v_def,
    '''cargo_fijo'', 3000',
    '''cargo_fijo'', public.cliente_datos_cargo_fijo(p_expediente_id)'
  );
END;
$patch$;

COMMIT;
