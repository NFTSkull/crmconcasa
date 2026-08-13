-- P179: NSS bloquea a otro asesor SOLO si submitted_to_mesa=true.
-- Restaura coherencia con P049 (permite duplicar pre-Mesa).
-- NO edita 049/155/168/169. Solo REPLACE del gate RO.
-- Statuses conservados; cambia el universo de bloqueo.

CREATE OR REPLACE FUNCTION public.asesor_lookup_nss_precal_gate(
  p_nss TEXT,
  p_programa public.programa
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_role public.app_role;
  v_org UUID;
  v_nss TEXT;
  v_block_any INT;
  v_block_same INT;
  v_exp_id UUID;
  v_exp_asesor UUID;
  v_exp_programa public.programa;
  v_pendiente UUID;
BEGIN
  v_actor := public.current_profile_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'asesor_lookup_nss_precal_gate: no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id INTO v_role, v_org
  FROM public.profiles p
  WHERE p.id = v_actor AND p.active = true;

  IF NOT FOUND OR v_role <> 'asesor' THEN
    RAISE EXCEPTION 'asesor_lookup_nss_precal_gate: solo asesor'
      USING ERRCODE = '42501';
  END IF;

  IF p_programa IS NULL THEN
    RAISE EXCEPTION 'asesor_lookup_nss_precal_gate: programa obligatorio'
      USING ERRCODE = '22023';
  END IF;

  v_nss := public.normalize_nss_mexico(p_nss);
  IF v_nss IS NULL OR v_nss !~ '^[0-9]{11}$' THEN
    RAISE EXCEPTION 'asesor_lookup_nss_precal_gate: NSS inválido'
      USING ERRCODE = '22023';
  END IF;

  --------------------------------------------------------------------------
  -- A) EXPEDIENTES QUE BLOQUEAN: solo post-Mesa (P049 / P179)
  --------------------------------------------------------------------------
  SELECT count(*) INTO v_block_any
  FROM public.expedientes e
  WHERE e.organization_id = v_org
    AND e.nss = v_nss
    AND e.deleted_at IS NULL
    AND e.ciclo_estado = 'activo'
    AND e.submitted_to_mesa = true;

  SELECT count(*) INTO v_block_same
  FROM public.expedientes e
  WHERE e.organization_id = v_org
    AND e.nss = v_nss
    AND e.programa = p_programa
    AND e.deleted_at IS NULL
    AND e.ciclo_estado = 'activo'
    AND e.submitted_to_mesa = true;

  -- Ambiguous solo sobre post-Mesa (varios pre-Mesa NO son ambiguous).
  IF v_block_any > 1 OR v_block_same > 1 THEN
    RETURN jsonb_build_object(
      'status', 'blocked_ambiguous',
      'message', 'Este NSS requiere revisión administrativa porque tiene más de un expediente vigente.',
      'nss', v_nss,
      'programa', p_programa
    );
  END IF;

  IF v_block_same = 1 THEN
    SELECT e.id, e.asesor_id, e.programa, e.reprecalificacion_pendiente_id
    INTO v_exp_id, v_exp_asesor, v_exp_programa, v_pendiente
    FROM public.expedientes e
    WHERE e.organization_id = v_org
      AND e.nss = v_nss
      AND e.programa = p_programa
      AND e.deleted_at IS NULL
      AND e.ciclo_estado = 'activo'
      AND e.submitted_to_mesa = true;

    IF v_exp_asesor IS DISTINCT FROM v_actor THEN
      RETURN jsonb_build_object(
        'status', 'blocked_other_asesor',
        'message', 'Este NSS ya tiene un expediente activo asignado a otro asesor.',
        'nss', v_nss,
        'programa', p_programa
      );
    END IF;

    RETURN jsonb_build_object(
      'status', 'reprecal_own_mesa',
      'message', 'Este NSS ya tiene un expediente activo asignado a ti. Puedes volver a precalificarlo; el resultado se actualizará en el mismo expediente.',
      'expediente_id', v_exp_id,
      'programa', v_exp_programa,
      'programa_actual', v_exp_programa,
      'programa_solicitado', p_programa,
      'cambio_programa', false,
      'nss', v_nss,
      'reprecalificacion_pendiente_id', v_pendiente
    );
  END IF;

  -- Un post-Mesa en otro programa
  IF v_block_any = 1 THEN
    SELECT e.id, e.asesor_id, e.programa, e.reprecalificacion_pendiente_id
    INTO v_exp_id, v_exp_asesor, v_exp_programa, v_pendiente
    FROM public.expedientes e
    WHERE e.organization_id = v_org
      AND e.nss = v_nss
      AND e.deleted_at IS NULL
      AND e.ciclo_estado = 'activo'
      AND e.submitted_to_mesa = true;

    IF v_exp_asesor IS DISTINCT FROM v_actor THEN
      RETURN jsonb_build_object(
        'status', 'blocked_other_asesor',
        'message', 'Este NSS ya tiene un expediente activo asignado a otro asesor.',
        'nss', v_nss,
        'programa', p_programa
      );
    END IF;

    RETURN jsonb_build_object(
      'status', 'reprecal_change_programa',
      'message', 'Puedes solicitar cambio de programa sobre el mismo expediente. El programa y monto vigentes no cambian hasta que el Editor apruebe.',
      'expediente_id', v_exp_id,
      'programa', v_exp_programa,
      'programa_actual', v_exp_programa,
      'programa_solicitado', p_programa,
      'cambio_programa', true,
      'nss', v_nss,
      'reprecalificacion_pendiente_id', v_pendiente
    );
  END IF;

  --------------------------------------------------------------------------
  -- B) REUTILIZACIÓN PROPIA (pre-Mesa): evita duplicado del mismo asesor
  --    Otros asesores pre-Mesa NO bloquean → ok_create.
  --------------------------------------------------------------------------
  SELECT e.id, e.asesor_id, e.programa, e.reprecalificacion_pendiente_id
  INTO v_exp_id, v_exp_asesor, v_exp_programa, v_pendiente
  FROM public.expedientes e
  WHERE e.organization_id = v_org
    AND e.nss = v_nss
    AND e.programa = p_programa
    AND e.asesor_id = v_actor
    AND e.deleted_at IS NULL
    AND e.ciclo_estado = 'activo'
  ORDER BY e.created_at DESC NULLS LAST
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'reprecal_own_mesa',
      'message', 'Este NSS ya tiene un expediente activo asignado a ti. Puedes volver a precalificarlo; el resultado se actualizará en el mismo expediente.',
      'expediente_id', v_exp_id,
      'programa', v_exp_programa,
      'programa_actual', v_exp_programa,
      'programa_solicitado', p_programa,
      'cambio_programa', false,
      'nss', v_nss,
      'reprecalificacion_pendiente_id', v_pendiente
    );
  END IF;

  SELECT e.id, e.asesor_id, e.programa, e.reprecalificacion_pendiente_id
  INTO v_exp_id, v_exp_asesor, v_exp_programa, v_pendiente
  FROM public.expedientes e
  WHERE e.organization_id = v_org
    AND e.nss = v_nss
    AND e.asesor_id = v_actor
    AND e.deleted_at IS NULL
    AND e.ciclo_estado = 'activo'
  ORDER BY e.created_at DESC NULLS LAST
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'reprecal_change_programa',
      'message', 'Puedes solicitar cambio de programa sobre el mismo expediente. El programa y monto vigentes no cambian hasta que el Editor apruebe.',
      'expediente_id', v_exp_id,
      'programa', v_exp_programa,
      'programa_actual', v_exp_programa,
      'programa_solicitado', p_programa,
      'cambio_programa', true,
      'nss', v_nss,
      'reprecalificacion_pendiente_id', v_pendiente
    );
  END IF;

  RETURN jsonb_build_object(
    'status', 'ok_create',
    'message', 'Puedes crear una nueva precalificación.',
    'nss', v_nss,
    'programa', p_programa,
    'programa_solicitado', p_programa,
    'cambio_programa', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.asesor_lookup_nss_precal_gate(TEXT, public.programa) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.asesor_lookup_nss_precal_gate(TEXT, public.programa) FROM anon;
GRANT EXECUTE ON FUNCTION public.asesor_lookup_nss_precal_gate(TEXT, public.programa) TO authenticated;

COMMENT ON FUNCTION public.asesor_lookup_nss_precal_gate(TEXT, public.programa) IS
  'P179: bloqueo a otro asesor solo si submitted_to_mesa=true (P049). Pre-Mesa ajeno → ok_create; propio activo → reprecal. Ambiguous solo post-Mesa.';
