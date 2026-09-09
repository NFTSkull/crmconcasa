-- ConCasa CRM — Precalificación NSS-only para asesores externos.
--
-- Contrato:
-- - La UI externa captura únicamente NSS.
-- - El scraper ya recibe únicamente `{ nss, workerIndex: 0 }`; este cambio no
--   modifica ese contrato.
-- - NSS nuevo: expediente técnico Mejoravit con nombre/teléfono transitorios.
-- - NSS propio existente: conserva programa, nombre, teléfono y dirección
--   vigentes; inicia la reprecalificación canónica sin pedirlos de nuevo.
-- - Asesores internos conservan el flujo completo existente.
-- - Sin backfill y sin mutaciones de expedientes históricos al aplicar DDL.

CREATE OR REPLACE FUNCTION public.create_expediente_externo_nss(
  p_nss text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid;
  v_role public.app_role;
  v_origen public.tipo_asesor_origen;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'create_expediente_externo_nss: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.tipo_asesor_origen
  INTO v_role, v_origen
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'create_expediente_externo_nss: perfil no encontrado o inactivo'
      USING ERRCODE = '42501';
  END IF;

  IF v_role <> 'asesor'::public.app_role
     OR v_origen <> 'externo'::public.tipo_asesor_origen THEN
    RAISE EXCEPTION 'create_expediente_externo_nss: solo disponible para asesores externos'
      USING ERRCODE = '42501';
  END IF;

  -- `create_expediente` conserva todos los gates actuales de alta.
  RETURN public.create_expediente(
    'mejoravit'::public.programa,
    p_nss,
    'POR CAPTURAR',
    '0000000000',
    ''
  );
END;
$$;

COMMENT ON FUNCTION public.create_expediente_externo_nss(text) IS
  'Alta simplificada externa: recibe solo NSS; nuevos expedientes usan Mejoravit técnico y placeholders hasta Datos Generales.';

REVOKE ALL ON FUNCTION public.create_expediente_externo_nss(text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_expediente_externo_nss(text)
  TO authenticated, postgres, service_role;


CREATE OR REPLACE FUNCTION public.asesor_preparar_precalificacion_externo_nss(
  p_nss text,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid;
  v_role public.app_role;
  v_org_id uuid;
  v_origen public.tipo_asesor_origen;
  v_nss text;
  v_own_count integer;
  v_exp public.expedientes%ROWTYPE;
  v_gate jsonb;
  v_gate_status text;
  v_result jsonb;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'asesor_preparar_precalificacion_externo_nss: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id, p.tipo_asesor_origen
  INTO v_role, v_org_id, v_origen
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND
     OR v_role <> 'asesor'::public.app_role
     OR v_origen <> 'externo'::public.tipo_asesor_origen THEN
    RAISE EXCEPTION 'asesor_preparar_precalificacion_externo_nss: solo disponible para asesores externos'
      USING ERRCODE = '42501';
  END IF;

  v_nss := public.normalize_nss_mexico(p_nss);
  IF v_nss IS NULL OR v_nss !~ '^[0-9]{11}$' THEN
    RAISE EXCEPTION 'asesor_preparar_precalificacion_externo_nss: el NSS debe tener exactamente 11 dígitos'
      USING ERRCODE = '22023';
  END IF;

  -- Serializa el mismo NSS/asesor para evitar altas simultáneas por doble submit.
  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_actor_id::text || ':' || v_nss, 0)
  );

  SELECT count(*)::integer
  INTO v_own_count
  FROM public.expedientes e
  WHERE e.organization_id = v_org_id
    AND e.asesor_id = v_actor_id
    AND e.nss = v_nss
    AND e.deleted_at IS NULL
    AND e.ciclo_estado = 'activo';

  IF v_own_count > 1 THEN
    RAISE EXCEPTION 'asesor_preparar_precalificacion_externo_nss: este NSS tiene más de un expediente propio vigente; requiere revisión administrativa'
      USING ERRCODE = '22023';
  END IF;

  IF v_own_count = 1 THEN
    SELECT e.*
    INTO v_exp
    FROM public.expedientes e
    WHERE e.organization_id = v_org_id
      AND e.asesor_id = v_actor_id
      AND e.nss = v_nss
      AND e.deleted_at IS NULL
      AND e.ciclo_estado = 'activo'
    ORDER BY e.created_at DESC NULLS LAST, e.id DESC
    LIMIT 1
    FOR UPDATE;

    -- Usar SIEMPRE el programa vigente evita que NSS-only convierta una
    -- reprecalificación histórica Subcuenta/Compro tu casa a Mejoravit.
    v_gate := public.asesor_lookup_nss_precal_gate(v_nss, v_exp.programa);
    v_gate_status := v_gate->>'status';

    IF v_gate_status IS DISTINCT FROM 'reprecal_own_mesa' THEN
      RAISE EXCEPTION 'asesor_preparar_precalificacion_externo_nss: %',
        coalesce(v_gate->>'message', 'el NSS no puede reprecalificarse')
        USING ERRCODE = '22023';
    END IF;

    -- Preserva datos reales vigentes; la UI externa no los vuelve a pedir.
    v_result := public.asesor_iniciar_reprecalificacion(
      v_nss,
      v_exp.programa,
      v_exp.cliente_nombre,
      btrim(v_exp.telefono_cliente::text),
      coalesce(v_exp.direccion_opcional, ''),
      p_idempotency_key
    );

    RETURN v_result || jsonb_build_object(
      'action', 'reprecal',
      'expediente_id', v_exp.id,
      'programa', v_exp.programa
    );
  END IF;

  -- Para un NSS nuevo no se expone selector de programa: el default técnico es
  -- Mejoravit. El gate existente continúa bloqueando NSS post-Mesa ajenos o
  -- ambiguos, incluso si el expediente bloqueante está en otro programa.
  v_gate := public.asesor_lookup_nss_precal_gate(
    v_nss,
    'mejoravit'::public.programa
  );
  v_gate_status := v_gate->>'status';

  IF v_gate_status IS DISTINCT FROM 'ok_create' THEN
    RAISE EXCEPTION 'asesor_preparar_precalificacion_externo_nss: %',
      coalesce(v_gate->>'message', 'el NSS no puede crear una nueva precalificación')
      USING ERRCODE = '22023';
  END IF;

  v_result := public.create_expediente_externo_nss(v_nss);

  RETURN v_result || jsonb_build_object(
    'action', 'created',
    'expediente_id', v_result->>'id',
    'programa', 'mejoravit'
  );
END;
$$;

COMMENT ON FUNCTION public.asesor_preparar_precalificacion_externo_nss(text, text) IS
  'NSS-only externo: nuevo -> alta Mejoravit técnica; existente propio -> reprecal mismo programa preservando nombre/teléfono/dirección.';

REVOKE ALL ON FUNCTION public.asesor_preparar_precalificacion_externo_nss(text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asesor_preparar_precalificacion_externo_nss(text, text)
  TO authenticated, postgres, service_role;
