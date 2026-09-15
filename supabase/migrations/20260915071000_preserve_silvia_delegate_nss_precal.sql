-- ConCasa CRM — preservar delegación en flujo NSS-only del Equipo Silvia.
--
-- Silvia Reyes, Adriana Reyes y Hector Nuñez ya cuentan en Production con:
--   create_for_any_advisor + integrate_for_any_advisor
-- y deben conservar tanto la creación/precalificación para otro asesor de su
-- mismo equipo como la reasignación posterior del expediente.
--
-- Esta migración NO cambia esas capabilities ni la RPC de reasignación.
-- Solo agrega contexto team-scoped para la UI NSS-only y un wrapper seguro para
-- crear por NSS a nombre de otro asesor del mismo equipo.

CREATE OR REPLACE FUNCTION public.asesor_precal_nss_only_delegate_context()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := public.current_profile_id();
  v_actor public.profiles%ROWTYPE;
  v_team public.asesor_equipos%ROWTYPE;
  v_can_delegate boolean := false;
  v_targets jsonb := '[]'::jsonb;
BEGIN
  IF v_actor_id IS NULL THEN
    RETURN jsonb_build_object('enabled', false, 'can_delegate', false, 'targets', '[]'::jsonb);
  END IF;

  SELECT * INTO v_actor
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true
    AND p.app_role = 'asesor';

  IF NOT FOUND OR NOT public.asesor_precal_nss_only_habilitado() THEN
    RETURN jsonb_build_object('enabled', false, 'can_delegate', false, 'targets', '[]'::jsonb);
  END IF;

  v_can_delegate := public.profile_has_capability(v_actor_id, 'create_for_any_advisor')
    AND public.profile_has_capability(v_actor_id, 'integrate_for_any_advisor');

  IF NOT v_can_delegate THEN
    RETURN jsonb_build_object('enabled', true, 'can_delegate', false, 'targets', '[]'::jsonb);
  END IF;

  SELECT t.* INTO v_team
  FROM public.asesor_equipos t
  WHERE t.active = true
    AND t.organization_id = v_actor.organization_id
    AND public.asesor_pertenece_equipo_activo(t.id, v_actor_id)
  ORDER BY t.created_at ASC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('enabled', true, 'can_delegate', false, 'targets', '[]'::jsonb);
  END IF;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'full_name', p.full_name,
        'email', p.email,
        'is_self', p.id = v_actor_id
      )
      ORDER BY (p.id = v_actor_id) DESC, p.full_name ASC, p.email ASC
    ),
    '[]'::jsonb
  )
  INTO v_targets
  FROM public.profiles p
  WHERE p.active = true
    AND p.app_role = 'asesor'
    AND p.organization_id = v_actor.organization_id
    AND public.asesor_pertenece_equipo_activo(v_team.id, p.id);

  RETURN jsonb_build_object(
    'enabled', true,
    'can_delegate', true,
    'team_id', v_team.id,
    'team_name', v_team.nombre,
    'targets', v_targets
  );
END;
$$;

COMMENT ON FUNCTION public.asesor_precal_nss_only_delegate_context() IS
  'Contexto NSS-only: conserva selector team-scoped para asesores con create+integrate_for_any_advisor.';

REVOKE ALL ON FUNCTION public.asesor_precal_nss_only_delegate_context()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asesor_precal_nss_only_delegate_context()
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.asesor_preparar_precalificacion_nss_only_para_asesor(
  p_target_asesor_id uuid,
  p_nss text,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id uuid := public.current_profile_id();
  v_actor public.profiles%ROWTYPE;
  v_target public.profiles%ROWTYPE;
  v_team public.asesor_equipos%ROWTYPE;
  v_nss text;
  v_existing public.expedientes%ROWTYPE;
  v_created jsonb;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'asesor_preparar_precalificacion_nss_only_para_asesor: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_actor
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true
    AND p.app_role = 'asesor';

  IF NOT FOUND
     OR NOT public.asesor_precal_nss_only_habilitado()
     OR NOT public.profile_has_capability(v_actor_id, 'create_for_any_advisor')
     OR NOT public.profile_has_capability(v_actor_id, 'integrate_for_any_advisor') THEN
    RAISE EXCEPTION 'asesor_preparar_precalificacion_nss_only_para_asesor: sin permisos delegados'
      USING ERRCODE = '42501';
  END IF;

  IF p_target_asesor_id IS NULL THEN
    RAISE EXCEPTION 'asesor_preparar_precalificacion_nss_only_para_asesor: selecciona el asesor titular'
      USING ERRCODE = '22023';
  END IF;

  IF p_target_asesor_id = v_actor_id THEN
    RETURN public.asesor_preparar_precalificacion_nss_only(p_nss, p_idempotency_key);
  END IF;

  SELECT * INTO v_target
  FROM public.profiles p
  WHERE p.id = p_target_asesor_id
    AND p.active = true
    AND p.app_role = 'asesor'
    AND p.organization_id = v_actor.organization_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'asesor_preparar_precalificacion_nss_only_para_asesor: asesor destino inválido'
      USING ERRCODE = '42501';
  END IF;

  SELECT t.* INTO v_team
  FROM public.asesor_equipos t
  WHERE t.active = true
    AND t.organization_id = v_actor.organization_id
    AND public.asesor_pertenece_equipo_activo(t.id, v_actor_id)
    AND public.asesor_pertenece_equipo_activo(t.id, p_target_asesor_id)
  ORDER BY t.created_at ASC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'asesor_preparar_precalificacion_nss_only_para_asesor: asesor destino fuera del equipo activo'
      USING ERRCODE = '42501';
  END IF;

  v_nss := public.normalize_nss_mexico(p_nss);
  IF v_nss IS NULL OR v_nss !~ '^[0-9]{11}$' THEN
    RAISE EXCEPTION 'asesor_preparar_precalificacion_nss_only_para_asesor: el NSS debe tener exactamente 11 dígitos'
      USING ERRCODE = '22023';
  END IF;

  SELECT e.* INTO v_existing
  FROM public.expedientes e
  WHERE e.organization_id = v_actor.organization_id
    AND e.nss = v_nss
    AND e.programa = 'mejoravit'::public.programa
    AND e.ciclo_estado = 'activo'
    AND e.deleted_at IS NULL
  ORDER BY e.created_at DESC NULLS LAST, e.id DESC
  LIMIT 1;

  IF FOUND THEN
    IF v_existing.asesor_id = p_target_asesor_id THEN
      RAISE EXCEPTION 'asesor_preparar_precalificacion_nss_only_para_asesor: este NSS ya tiene un expediente activo con el asesor seleccionado; abre ese expediente para continuar o volver a precalificar'
        USING ERRCODE = '23505';
    END IF;

    RAISE EXCEPTION 'asesor_preparar_precalificacion_nss_only_para_asesor: este NSS ya tiene un expediente activo con otro asesor; usa Cambiar asesor si corresponde'
      USING ERRCODE = '23505';
  END IF;

  v_created := public.create_expediente_for_asesor(
    p_target_asesor_id,
    'mejoravit'::public.programa,
    v_nss,
    'POR CAPTURAR',
    '0000000000',
    ''
  );

  RETURN v_created || jsonb_build_object(
    'action', 'created',
    'expediente_id', v_created->>'id',
    'programa', 'mejoravit',
    'delegated', true,
    'target_asesor_id', p_target_asesor_id,
    'team_id', v_team.id
  );
END;
$$;

COMMENT ON FUNCTION public.asesor_preparar_precalificacion_nss_only_para_asesor(uuid, text, text) IS
  'Crea NSS-only para otro asesor del mismo equipo. No reasigna automáticamente expedientes existentes.';

REVOKE ALL ON FUNCTION public.asesor_preparar_precalificacion_nss_only_para_asesor(uuid, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asesor_preparar_precalificacion_nss_only_para_asesor(uuid, text, text)
  TO authenticated, service_role;
