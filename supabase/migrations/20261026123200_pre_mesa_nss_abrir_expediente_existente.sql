-- Completa P208 colaboración pre-Mesa: reutilizar el expediente ajeno.
-- Preserva bloqueos post-Mesa P179 y re-precal del propio asesor.
CREATE OR REPLACE FUNCTION public.asesor_lookup_nss_precal_gate(p_nss text, p_programa programa)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor UUID;
  v_role public.app_role;
  v_org UUID;
  v_nss TEXT;
  v_block_any INT;
  v_block_same INT;
  v_pre_other_count INT;
  v_owner_name TEXT;
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

  -- Si lo tiene otro asesor pre-Mesa, se comparte EL expediente existente:
  -- no crear otro por NSS y avisar quien es el titular antes de abrir.
  SELECT COUNT(*) INTO v_pre_other_count
  FROM public.expedientes e
  WHERE e.organization_id=v_org
    AND e.nss=v_nss
    AND e.deleted_at IS NULL
    AND e.ciclo_estado='activo'
    AND e.submitted_to_mesa IS NOT TRUE
    AND e.asesor_id IS DISTINCT FROM v_actor;

  IF v_pre_other_count > 1 THEN
    RETURN jsonb_build_object(
      'status','blocked_ambiguous',
      'message','Este NSS tiene varios expedientes activos sin enviar a Mesa; requiere revisión antes de continuar.',
      'nss',v_nss,'programa',p_programa
    );
  END IF;

  IF v_pre_other_count=1 THEN
    SELECT e.id,e.asesor_id,e.programa,p.full_name
      INTO v_exp_id,v_exp_asesor,v_exp_programa,v_owner_name
    FROM public.expedientes e
    LEFT JOIN public.profiles p ON p.id=e.asesor_id
    WHERE e.organization_id=v_org
      AND e.nss=v_nss
      AND e.deleted_at IS NULL
      AND e.ciclo_estado='activo'
      AND e.submitted_to_mesa IS NOT TRUE
      AND e.asesor_id IS DISTINCT FROM v_actor
    LIMIT 1;

    RETURN jsonb_build_object(
      'status','open_existing_pre_mesa',
      'message','Este NSS ya tiene expediente activo, aún sin enviar a Mesa. Puedes continuar en el mismo expediente.',
      'expediente_id',v_exp_id,
      'asesor_nombre',COALESCE(NULLIF(btrim(v_owner_name),''),'Otro asesor'),
      'programa',v_exp_programa,
      'programa_actual',v_exp_programa,
      'programa_solicitado',p_programa,
      'nss',v_nss
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
$function$;
