-- ConCasa CRM — excepción NSS activo únicamente para Anette.
-- Mantiene el bloqueo si el NSS ya fue enviado a Mesa.
-- Para otros asesores titulares ligados, conserva el control de duplicado activo.

CREATE OR REPLACE FUNCTION public.asesor_preparar_precalificacion_nss_only_ligada(
  p_nss TEXT,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor UUID := public.current_profile_id();
  v_actor_profile public.profiles%ROWTYPE;
  v_target public.profiles%ROWTYPE;
  v_link public.asesor_precalificadores_ligados%ROWTYPE;
  v_nss TEXT;
  v_id UUID;
  v_created_at TIMESTAMPTZ;
  v_origen public.origen_mesa;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'asesor_preparar_precalificacion_nss_only_ligada: no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_actor_profile
  FROM public.profiles p
  WHERE p.id = v_actor
    AND p.active = true
    AND p.app_role = 'asesor';

  IF NOT FOUND
     OR NOT public.profile_has_capability(v_actor, 'precalificador_nss_only') THEN
    RAISE EXCEPTION 'asesor_preparar_precalificacion_nss_only_ligada: usuario no habilitado'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_link
  FROM public.asesor_precalificadores_ligados l
  WHERE l.precalificador_id = v_actor
    AND l.active = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'asesor_preparar_precalificacion_nss_only_ligada: no existe asesor titular ligado'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_target
  FROM public.profiles p
  WHERE p.id = v_link.asesor_titular_id
    AND p.active = true
    AND p.app_role = 'asesor'
    AND p.organization_id = v_actor_profile.organization_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'asesor_preparar_precalificacion_nss_only_ligada: asesor titular no disponible'
      USING ERRCODE = '42501';
  END IF;

  v_nss := public.normalize_nss_mexico(p_nss);
  IF v_nss IS NULL OR v_nss !~ '^[0-9]{11}$' THEN
    RAISE EXCEPTION 'asesor_preparar_precalificacion_nss_only_ligada: el NSS debe tener exactamente 11 dígitos'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(v_target.id::text || ':mejoravit:' || v_nss, 0)
  );

  IF public.nss_bloqueado_en_mesa(
    v_actor_profile.organization_id,
    v_nss,
    'mejoravit'::public.programa,
    NULL
  ) THEN
    RAISE EXCEPTION 'asesor_preparar_precalificacion_nss_only_ligada: este NSS ya tiene un expediente enviado a Mesa'
      USING ERRCODE = '23505';
  END IF;

  -- Excepción exclusiva de Anette: su precalificador ligado puede crear una
  -- nueva precalificación aunque ya exista otro expediente activo pre-Mesa
  -- con el mismo NSS. El bloqueo de NSS ya enviado a Mesa se conserva arriba.
  IF NOT public.asesor_es_anette_externa(v_target.id)
     AND EXISTS (
       SELECT 1
       FROM public.expedientes e
       WHERE e.organization_id = v_actor_profile.organization_id
         AND e.asesor_id = v_target.id
         AND e.nss = v_nss
         AND e.programa = 'mejoravit'::public.programa
         AND e.ciclo_estado = 'activo'
         AND e.deleted_at IS NULL
     ) THEN
    RAISE EXCEPTION 'asesor_preparar_precalificacion_nss_only_ligada: el asesor titular ya tiene un expediente activo con este NSS'
      USING ERRCODE = '23505';
  END IF;

  v_origen := coalesce(v_target.tipo_asesor_origen::text, 'interno')::public.origen_mesa;

  INSERT INTO public.expedientes (
    organization_id,
    asesor_id,
    programa,
    nss,
    cliente_nombre,
    telefono_cliente,
    direccion_opcional,
    origen_mesa,
    ciclo_estado,
    submitted_to_mesa,
    etapa_actual,
    subestado,
    deleted_at,
    precalificador_origen_id
  ) VALUES (
    v_actor_profile.organization_id,
    v_target.id,
    'mejoravit'::public.programa,
    v_nss,
    'POR CAPTURAR',
    '0000000000',
    '',
    v_origen,
    'activo',
    false,
    1,
    'pendiente',
    NULL,
    v_actor
  )
  RETURNING id, created_at INTO v_id, v_created_at;

  INSERT INTO public.editor_decisions (
    expediente_id,
    organization_id,
    decision,
    monto_aprobado,
    notas_revision
  ) VALUES (
    v_id,
    v_actor_profile.organization_id,
    'pendiente',
    NULL,
    ''
  );

  PERFORM public.log_action(
    v_actor_profile.organization_id,
    v_actor,
    'asesor'::public.app_role,
    'precalificacion.nss_only_ligada.create',
    'expediente',
    v_id,
    jsonb_build_object(
      'target_asesor_id', v_target.id,
      'precalificador_origen_id', v_actor,
      'nss_sufijo', right(v_nss, 4),
      'programa', 'mejoravit',
      'idempotency_present', nullif(btrim(coalesce(p_idempotency_key, '')), '') IS NOT NULL
    )
  );

  RETURN jsonb_build_object(
    'action', 'created',
    'expediente_id', v_id,
    'programa', 'mejoravit',
    'target_asesor_id', v_target.id,
    'precalificador_origen_id', v_actor,
    'created_at', v_created_at
  );
END;
$function$;


COMMENT ON FUNCTION public.asesor_preparar_precalificacion_nss_only_ligada(TEXT, TEXT) IS
  'NSS-only ligado: Anette permite nueva precalificación con NSS activo pre-Mesa; otros titulares conservan bloqueo de duplicado; NSS enviado a Mesa sigue bloqueado.';
