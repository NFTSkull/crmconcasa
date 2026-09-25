-- ConCasa CRM — alinear alta delegada NSS-only con P179.
-- Regla canónica:
-- - otro asesor pre-Mesa NO bloquea una nueva precalificación;
-- - un expediente post-Mesa sí bloquea;
-- - el mismo asesor destino no debe duplicar su propio expediente activo.
--
-- Cambio quirúrgico:
-- 1) create_expediente_for_asesor deja de bloquear por cualquier activo NSS+programa
--    y sólo bloquea duplicado activo del MISMO asesor destino.
-- 2) asesor_preparar_precalificacion_nss_only_para_asesor sólo considera conflicto
--    si el expediente es del asesor destino o ya fue enviado a Mesa.
--
-- No actualiza expedientes, no reasigna, no borra filas y no toca Mesa/agenda/documentos.

DO $patch_create_for_advisor$
DECLARE
  v_proc regprocedure :=
    'public.create_expediente_for_asesor(uuid,public.programa,text,text,text,text)'::regprocedure;
  v_def text;
  v_new text;
  v_old text := $snippet$
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
  v_replacement text := $snippet$
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
BEGIN
  SELECT pg_get_functiondef(v_proc) INTO v_def;

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'P179_DELEGATE_ABORT: create_expediente_for_asesor no existe';
  END IF;

  IF strpos(v_def, v_old) = 0 THEN
    RAISE EXCEPTION 'P179_DELEGATE_ABORT: baseline create_expediente_for_asesor cambió';
  END IF;

  IF strpos(v_def, v_replacement) > 0 THEN
    RAISE EXCEPTION 'P179_DELEGATE_ABORT: create_expediente_for_asesor ya parece parchada';
  END IF;

  v_new := replace(v_def, v_old, v_replacement);

  IF v_new = v_def THEN
    RAISE EXCEPTION 'P179_DELEGATE_ABORT: no se produjo cambio en create_expediente_for_asesor';
  END IF;

  EXECUTE v_new;

  SELECT pg_get_functiondef(v_proc) INTO v_def;

  IF strpos(v_def, v_replacement) = 0 OR strpos(v_def, v_old) > 0 THEN
    RAISE EXCEPTION 'P179_DELEGATE_ABORT: postcondición create_expediente_for_asesor falló';
  END IF;
END;
$patch_create_for_advisor$;

DO $patch_delegate_wrapper$
DECLARE
  v_proc regprocedure :=
    'public.asesor_preparar_precalificacion_nss_only_para_asesor(uuid,text,text)'::regprocedure;
  v_def text;
  v_new text;
  v_old text := $snippet$
  SELECT e.* INTO v_existing
  FROM public.expedientes e
  WHERE e.organization_id = v_actor.organization_id
    AND e.nss = v_nss
    AND e.programa = 'mejoravit'::public.programa
    AND e.ciclo_estado = 'activo'
    AND e.deleted_at IS NULL
  ORDER BY e.created_at DESC NULLS LAST, e.id DESC
  LIMIT 1;$snippet$;
  v_replacement text := $snippet$
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
BEGIN
  SELECT pg_get_functiondef(v_proc) INTO v_def;

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'P179_DELEGATE_ABORT: wrapper delegado no existe';
  END IF;

  IF strpos(v_def, v_old) = 0 THEN
    RAISE EXCEPTION 'P179_DELEGATE_ABORT: baseline wrapper delegado cambió';
  END IF;

  IF strpos(v_def, v_replacement) > 0 THEN
    RAISE EXCEPTION 'P179_DELEGATE_ABORT: wrapper delegado ya parece parchado';
  END IF;

  v_new := replace(v_def, v_old, v_replacement);

  IF v_new = v_def THEN
    RAISE EXCEPTION 'P179_DELEGATE_ABORT: no se produjo cambio en wrapper delegado';
  END IF;

  EXECUTE v_new;

  SELECT pg_get_functiondef(v_proc) INTO v_def;

  IF strpos(v_def, v_replacement) = 0 OR strpos(v_def, v_old) > 0 THEN
    RAISE EXCEPTION 'P179_DELEGATE_ABORT: postcondición wrapper delegado falló';
  END IF;
END;
$patch_delegate_wrapper$;

COMMENT ON FUNCTION public.create_expediente_for_asesor(
  UUID, public.programa, TEXT, TEXT, TEXT, TEXT
) IS
  'P208/P179: alta delegada. Pre-Mesa de otro asesor no bloquea; mismo target activo sí; post-Mesa bloquea mediante nss_bloqueado_en_mesa.';

COMMENT ON FUNCTION public.asesor_preparar_precalificacion_nss_only_para_asesor(
  UUID, TEXT, TEXT
) IS
  'NSS-only delegado team-scoped. P179: otro asesor pre-Mesa no bloquea; mismo target activo o cualquier post-Mesa sí bloquean.';

REVOKE ALL ON FUNCTION public.create_expediente_for_asesor(
  UUID, public.programa, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_expediente_for_asesor(
  UUID, public.programa, TEXT, TEXT, TEXT, TEXT
) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.asesor_preparar_precalificacion_nss_only_para_asesor(
  UUID, TEXT, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asesor_preparar_precalificacion_nss_only_para_asesor(
  UUID, TEXT, TEXT
) TO authenticated, service_role;
