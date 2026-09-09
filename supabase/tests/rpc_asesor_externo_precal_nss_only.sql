-- Precalificación NSS-only: wrappers exclusivos de asesores externos.
\set ON_ERROR_STOP on
\ir ../migrations/20260909224000_asesor_externo_precal_nss_only.sql

BEGIN;

CREATE OR REPLACE FUNCTION public.__ext_nss_assert(p_ok boolean, p_msg text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'EXT NSS ONLY FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__ext_nss_set_auth(p_user_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__ext_nss_reset_auth()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

DO $$
DECLARE
  v_ext uuid;
  v_int uuid;
  v_res jsonb;
  v_exp uuid;
  v_intento uuid;
  v_denied boolean := false;
  v_bad_nss boolean := false;
BEGIN
  SELECT id INTO v_ext
  FROM public.profiles
  WHERE app_role = 'asesor'::public.app_role
    AND tipo_asesor_origen = 'externo'::public.tipo_asesor_origen
    AND active = true
  ORDER BY created_at, id
  LIMIT 1;

  SELECT id INTO v_int
  FROM public.profiles
  WHERE app_role = 'asesor'::public.app_role
    AND tipo_asesor_origen = 'interno'::public.tipo_asesor_origen
    AND active = true
  ORDER BY created_at, id
  LIMIT 1;

  PERFORM public.__ext_nss_assert(v_ext IS NOT NULL, 'existe asesor externo fixture');

  PERFORM public.__ext_nss_assert(
    has_function_privilege('authenticated', 'public.create_expediente_externo_nss(text)', 'EXECUTE'),
    'authenticated puede ejecutar alta externa'
  );
  PERFORM public.__ext_nss_assert(
    has_function_privilege('authenticated', 'public.asesor_preparar_precalificacion_externo_nss(text,text)', 'EXECUTE'),
    'authenticated puede ejecutar prepare externo'
  );
  PERFORM public.__ext_nss_assert(
    NOT has_function_privilege('anon', 'public.create_expediente_externo_nss(text)', 'EXECUTE'),
    'anon no puede ejecutar alta externa'
  );
  PERFORM public.__ext_nss_assert(
    NOT has_function_privilege('anon', 'public.asesor_preparar_precalificacion_externo_nss(text,text)', 'EXECUTE'),
    'anon no puede ejecutar prepare externo'
  );

  -- NSS nuevo: prepare crea un solo expediente Mejoravit técnico.
  PERFORM public.__ext_nss_set_auth(v_ext);
  SELECT public.asesor_preparar_precalificacion_externo_nss(
    '99765432109',
    'test-new-99765432109'
  ) INTO v_res;
  PERFORM public.__ext_nss_reset_auth();

  v_exp := (v_res->>'expediente_id')::uuid;
  PERFORM public.__ext_nss_assert(v_res->>'action' = 'created', 'NSS nuevo action=created');
  PERFORM public.__ext_nss_assert(v_exp IS NOT NULL, 'alta externa devuelve expediente_id');
  PERFORM public.__ext_nss_assert(EXISTS (
    SELECT 1
    FROM public.expedientes e
    WHERE e.id = v_exp
      AND e.asesor_id = v_ext
      AND e.nss::text = '99765432109'
      AND e.programa = 'mejoravit'::public.programa
      AND e.cliente_nombre = 'POR CAPTURAR'
      AND btrim(e.telefono_cliente::text) = '0000000000'
      AND e.origen_mesa = 'externo'::public.origen_mesa
      AND e.submitted_to_mesa = false
      AND e.etapa_actual = 1
      AND e.subestado = 'pendiente'::public.operativo_subestado
  ), 'expediente técnico externo correcto');
  PERFORM public.__ext_nss_assert(EXISTS (
    SELECT 1 FROM public.editor_decisions ed
    WHERE ed.expediente_id = v_exp
      AND ed.decision = 'pendiente'::public.editor_decision
      AND ed.monto_aprobado IS NULL
  ), 'editor decision pendiente');
  PERFORM public.__ext_nss_assert(
    (SELECT count(*) FROM public.expedientes e
     WHERE e.asesor_id = v_ext AND e.nss::text = '99765432109'
       AND e.deleted_at IS NULL AND e.ciclo_estado = 'activo') = 1,
    'NSS nuevo crea exactamente un expediente propio activo'
  );

  -- Simula que Datos Generales ya sustituyeron placeholders y que el expediente
  -- histórico está en Subcuenta. NSS-only debe preservar TODO esto al reprecal.
  UPDATE public.expedientes
  SET programa = 'subcuenta'::public.programa,
      cliente_nombre = 'CLIENTE REAL EXTERNO',
      telefono_cliente = '5512345678',
      direccion_opcional = 'DOMICILIO REAL'
  WHERE id = v_exp;

  PERFORM public.__ext_nss_set_auth(v_ext);
  SELECT public.asesor_preparar_precalificacion_externo_nss(
    '99765432109',
    'test-reprecal-99765432109'
  ) INTO v_res;
  PERFORM public.__ext_nss_reset_auth();

  v_intento := (v_res->>'intento_id')::uuid;
  PERFORM public.__ext_nss_assert(v_res->>'action' = 'reprecal', 'NSS existente action=reprecal');
  PERFORM public.__ext_nss_assert((v_res->>'expediente_id')::uuid = v_exp, 'reprecal reutiliza mismo expediente');
  PERFORM public.__ext_nss_assert(v_res->>'programa' = 'subcuenta', 'reprecal conserva programa vigente');
  PERFORM public.__ext_nss_assert(v_intento IS NOT NULL, 'reprecal crea/reutiliza intento canónico');
  PERFORM public.__ext_nss_assert(EXISTS (
    SELECT 1
    FROM public.expedientes e
    WHERE e.id = v_exp
      AND e.programa = 'subcuenta'::public.programa
      AND e.cliente_nombre = 'CLIENTE REAL EXTERNO'
      AND btrim(e.telefono_cliente::text) = '5512345678'
      AND e.direccion_opcional = 'DOMICILIO REAL'
  ), 'reprecal no pisa nombre/teléfono/dirección/programa');
  PERFORM public.__ext_nss_assert(EXISTS (
    SELECT 1
    FROM public.expediente_precalificacion_intentos i
    WHERE i.id = v_intento
      AND i.expediente_id = v_exp
      AND i.programa = 'subcuenta'::public.programa
      AND i.programa_solicitado = 'subcuenta'::public.programa
      AND i.cliente_nombre = 'CLIENTE REAL EXTERNO'
      AND btrim(i.telefono_cliente::text) = '5512345678'
  ), 'intento canónico conserva datos/programa existentes');
  PERFORM public.__ext_nss_assert(
    (SELECT count(*) FROM public.expedientes e
     WHERE e.asesor_id = v_ext AND e.nss::text = '99765432109'
       AND e.deleted_at IS NULL AND e.ciclo_estado = 'activo') = 1,
    'reprecal NSS-only no duplica expediente'
  );

  -- NSS inválido conserva validación estricta.
  PERFORM public.__ext_nss_set_auth(v_ext);
  BEGIN
    PERFORM public.asesor_preparar_precalificacion_externo_nss('123', 'bad');
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_bad_nss := true;
  END;
  PERFORM public.__ext_nss_reset_auth();
  PERFORM public.__ext_nss_assert(v_bad_nss, 'NSS inválido rechazado');

  -- Un asesor interno no puede usar ninguno de los wrappers externos.
  IF v_int IS NOT NULL THEN
    PERFORM public.__ext_nss_set_auth(v_int);
    BEGIN
      PERFORM public.asesor_preparar_precalificacion_externo_nss(
        '99765432108',
        'internal-denied'
      );
    EXCEPTION WHEN SQLSTATE '42501' THEN
      v_denied := true;
    END;
    PERFORM public.__ext_nss_reset_auth();
    PERFORM public.__ext_nss_assert(v_denied, 'asesor interno no puede usar prepare externo');
  END IF;

  RAISE NOTICE 'EXT NSS ONLY OK';
END;
$$;

ROLLBACK;
