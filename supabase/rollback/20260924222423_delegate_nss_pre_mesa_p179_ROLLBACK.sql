-- Rollback P179 alta delegada NSS-only.
-- Restaura el bloqueo histórico por cualquier expediente activo NSS+programa.

DO $rollback_create_for_advisor$
DECLARE
  v_proc regprocedure :=
    'public.create_expediente_for_asesor(uuid,public.programa,text,text,text,text)'::regprocedure;
  v_def text;
  v_new text;
  v_from text := $snippet$
  -- P179: otro asesor pre-Mesa NO bloquea.
  -- Sólo evitamos duplicar el mismo NSS+programa para el mismo asesor destino.
  IF EXISTS (
    SELECT 1
    FROM public.expedientes e
    WHERE e.organization_id = v_org_id
      AND e.nss = v_nss
      AND e.programa = p_programa
      AND e.asesor_id = p_asesor_id
      AND e.ciclo_estado = 'activo'
      AND e.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'create_expediente_for_asesor: el asesor destino ya tiene un expediente activo con ese NSS y programa'
      USING ERRCODE = '23505';
  END IF;$snippet$;
  v_to text := $snippet$
  -- Duplicado activo NSS+programa (misma regla que índice único / create_expediente)
  IF EXISTS (
    SELECT 1
    FROM public.expedientes e
    WHERE e.organization_id = v_org_id
      AND e.nss = v_nss
      AND e.programa = p_programa
      AND e.ciclo_estado = 'activo'
      AND e.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'create_expediente_for_asesor: ya existe un expediente activo con ese NSS y programa'
      USING ERRCODE = '23505';
  END IF;$snippet$;
BEGIN
  SELECT pg_get_functiondef(v_proc) INTO v_def;
  IF strpos(v_def, v_from) = 0 THEN
    RAISE EXCEPTION 'ROLLBACK_ABORT: create_expediente_for_asesor no coincide con parche esperado';
  END IF;
  v_new := replace(v_def, v_from, v_to);
  EXECUTE v_new;
END;
$rollback_create_for_advisor$;

DO $rollback_delegate_wrapper$
DECLARE
  v_proc regprocedure :=
    'public.asesor_preparar_precalificacion_nss_only_para_asesor(uuid,text,text)'::regprocedure;
  v_def text;
  v_new text;
  v_from text := $snippet$
  SELECT e.* INTO v_existing
  FROM public.expedientes e
  WHERE e.organization_id = v_actor.organization_id
    AND e.nss = v_nss
    AND e.programa = 'mejoravit'::public.programa
    AND e.ciclo_estado = 'activo'
    AND e.deleted_at IS NULL
    AND (
      e.asesor_id = p_target_asesor_id
      OR e.submitted_to_mesa = true
    )
  ORDER BY e.created_at DESC NULLS LAST, e.id DESC
  LIMIT 1;$snippet$;
  v_to text := $snippet$
  SELECT e.* INTO v_existing
  FROM public.expedientes e
  WHERE e.organization_id = v_actor.organization_id
    AND e.nss = v_nss
    AND e.programa = 'mejoravit'::public.programa
    AND e.ciclo_estado = 'activo'
    AND e.deleted_at IS NULL
  ORDER BY e.created_at DESC NULLS LAST, e.id DESC
  LIMIT 1;$snippet$;
BEGIN
  SELECT pg_get_functiondef(v_proc) INTO v_def;
  IF strpos(v_def, v_from) = 0 THEN
    RAISE EXCEPTION 'ROLLBACK_ABORT: wrapper delegado no coincide con parche esperado';
  END IF;
  v_new := replace(v_def, v_from, v_to);
  EXECUTE v_new;
END;
$rollback_delegate_wrapper$;
