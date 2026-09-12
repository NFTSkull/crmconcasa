-- Reasignación segura de expediente dentro del mismo equipo activo.
-- Alcance estricto: solo silvia.reyes@concasa.mx como líder activa + create/integrate/team_dashboard.
-- No copia ni recrea expediente: conserva documentos, datos, citas, etapa e historial.
-- Las proyecciones de agenda se actualizan y las citas activas se reencolan para Drive.

CREATE OR REPLACE FUNCTION public.asesor_reassign_team_context(
  p_expediente_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_id uuid;
  v_actor public.profiles%ROWTYPE;
  v_exp public.expedientes%ROWTYPE;
  v_team public.asesor_equipos%ROWTYPE;
  v_owner public.profiles%ROWTYPE;
  v_targets jsonb := '[]'::jsonb;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RETURN jsonb_build_object('can_reassign', false);
  END IF;

  SELECT * INTO v_actor
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND
     OR v_actor.app_role <> 'asesor'
     OR lower(btrim(COALESCE(v_actor.email, ''))) <> 'silvia.reyes@concasa.mx'
     OR NOT public.profile_has_capability(v_actor_id, 'team_dashboard_read')
     OR NOT public.profile_has_capability(v_actor_id, 'create_for_any_advisor')
     OR NOT public.profile_has_capability(v_actor_id, 'integrate_for_any_advisor') THEN
    RETURN jsonb_build_object('can_reassign', false);
  END IF;

  SELECT * INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id
    AND e.deleted_at IS NULL
    AND e.ciclo_estado = 'activo';

  IF NOT FOUND OR v_exp.organization_id IS DISTINCT FROM v_actor.organization_id THEN
    RETURN jsonb_build_object('can_reassign', false);
  END IF;

  SELECT t.* INTO v_team
  FROM public.asesor_equipos t
  WHERE t.active = true
    AND t.organization_id = v_actor.organization_id
    AND t.leader_id = v_actor_id
    AND public.asesor_pertenece_equipo_activo(t.id, v_exp.asesor_id)
  ORDER BY t.created_at ASC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('can_reassign', false);
  END IF;

  SELECT * INTO v_owner
  FROM public.profiles p
  WHERE p.id = v_exp.asesor_id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'full_name', p.full_name,
        'email', p.email
      )
      ORDER BY COALESCE(NULLIF(btrim(p.full_name), ''), p.email), p.email
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
    'can_reassign', true,
    'team_id', v_team.id,
    'team_name', v_team.nombre,
    'current_owner', jsonb_build_object(
      'id', v_owner.id,
      'full_name', v_owner.full_name,
      'email', v_owner.email
    ),
    'targets', v_targets
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.asesor_reassign_team_expediente(
  p_expediente_id uuid,
  p_target_asesor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_id uuid;
  v_actor public.profiles%ROWTYPE;
  v_exp public.expedientes%ROWTYPE;
  v_team public.asesor_equipos%ROWTYPE;
  v_target public.profiles%ROWTYPE;
  v_old_owner public.profiles%ROWTYPE;
  v_target_label text;
  v_new_origen public.origen_mesa;
  v_requeued integer := 0;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'asesor_reassign_team_expediente: usuario no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_actor
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND
     OR v_actor.app_role <> 'asesor'
     OR lower(btrim(COALESCE(v_actor.email, ''))) <> 'silvia.reyes@concasa.mx'
     OR NOT public.profile_has_capability(v_actor_id, 'team_dashboard_read')
     OR NOT public.profile_has_capability(v_actor_id, 'create_for_any_advisor')
     OR NOT public.profile_has_capability(v_actor_id, 'integrate_for_any_advisor') THEN
    RAISE EXCEPTION 'asesor_reassign_team_expediente: sin permisos de líder integrador'
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL OR p_target_asesor_id IS NULL THEN
    RAISE EXCEPTION 'asesor_reassign_team_expediente: expediente y asesor destino son obligatorios'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id
  FOR UPDATE;

  IF NOT FOUND OR v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'asesor_reassign_team_expediente: expediente no encontrado o eliminado'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.ciclo_estado IS DISTINCT FROM 'activo' THEN
    RAISE EXCEPTION 'asesor_reassign_team_expediente: solo se pueden reasignar expedientes activos'
      USING ERRCODE = '22023';
  END IF;

  IF v_exp.organization_id IS DISTINCT FROM v_actor.organization_id THEN
    RAISE EXCEPTION 'asesor_reassign_team_expediente: expediente de otra organización'
      USING ERRCODE = '42501';
  END IF;

  SELECT t.* INTO v_team
  FROM public.asesor_equipos t
  WHERE t.active = true
    AND t.organization_id = v_actor.organization_id
    AND t.leader_id = v_actor_id
    AND public.asesor_pertenece_equipo_activo(t.id, v_exp.asesor_id)
  ORDER BY t.created_at ASC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'asesor_reassign_team_expediente: el titular actual no pertenece a un equipo liderado por el actor'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_target
  FROM public.profiles p
  WHERE p.id = p_target_asesor_id
    AND p.active = true
    AND p.app_role = 'asesor'
    AND p.organization_id = v_actor.organization_id;

  IF NOT FOUND
     OR NOT public.asesor_pertenece_equipo_activo(v_team.id, p_target_asesor_id) THEN
    RAISE EXCEPTION 'asesor_reassign_team_expediente: asesor destino fuera del equipo activo'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_old_owner
  FROM public.profiles p
  WHERE p.id = v_exp.asesor_id;

  v_target_label := COALESCE(NULLIF(btrim(v_target.full_name), ''), v_target.email, '');
  v_new_origen := COALESCE(v_target.tipo_asesor_origen::text, 'interno')::public.origen_mesa;

  IF v_exp.asesor_id = p_target_asesor_id THEN
    RETURN jsonb_build_object(
      'ok', true,
      'changed', false,
      'expediente_id', v_exp.id,
      'asesor_id', v_target.id,
      'asesor_email', v_target.email,
      'asesor_nombre', v_target.full_name
    );
  END IF;

  -- Fuente de verdad: conserva el mismo expediente_id y todas sus relaciones.
  UPDATE public.expedientes
  SET asesor_id = p_target_asesor_id,
      origen_mesa = v_new_origen,
      updated_at = now()
  WHERE id = p_expediente_id;

  -- Si había un lote de corrección todavía sin enviar, pasa al nuevo titular.
  -- Lotes enviados/revisados permanecen históricos y no se reescriben.
  UPDATE public.expediente_asesor_cambio_lotes
  SET asesor_id = p_target_asesor_id,
      updated_at = now()
  WHERE expediente_id = p_expediente_id
    AND status = 'borrador'
    AND submitted_at IS NULL;

  -- Proyección de ocupaciones manuales vinculadas al expediente.
  UPDATE public.agenda_manual_occupancies
  SET asesor_id = p_target_asesor_id,
      asesor_nombre = v_target_label,
      updated_at = now()
  WHERE expediente_id = p_expediente_id
    AND status = 'active'
    AND cancelled_at IS NULL;

  -- Proyección interna del inventario ya vinculado. El worker de Sheets
  -- vuelve a leer el asesor desde expedientes antes de escribir al Drive.
  UPDATE public.agenda_sheet_slot_inventory
  SET visible_advisor = v_target_label,
      updated_at = now()
  WHERE expediente_id = p_expediente_id
    AND booking_id IS NOT NULL
    AND status <> 'disabled';

  -- Reencolar citas activas de Biométricos/Firmas para que Google Sheets
  -- refleje el nuevo asesor sin mover fecha, hora, fila ni booking.
  INSERT INTO public.agenda_sheet_sync_outbox (
    organization_id,
    booking_id,
    event_type,
    idempotency_key,
    payload,
    status,
    attempts,
    available_at
  )
  SELECT
    b.organization_id,
    b.id,
    'booking_updated',
    b.id::text || ':booking_updated:reassign:' || p_target_asesor_id::text || ':' || txid_current()::text,
    jsonb_build_object(
      'booking_id', b.id,
      'organization_id', b.organization_id,
      'kind', b.kind,
      'status', b.status,
      'booking_date', b.booking_date,
      'booking_time', b.booking_time,
      'location_id', b.location_id,
      'expediente_id', b.expediente_id,
      'event_type', 'booking_updated',
      'sync_source', 'crm_reassign'
    ),
    'pending',
    0,
    now()
  FROM public.agenda_bookings b
  WHERE b.expediente_id = p_expediente_id
    AND b.status = 'booked'
    AND b.kind IN ('biometricos', 'firmas')
  ON CONFLICT (idempotency_key) DO NOTHING;

  GET DIAGNOSTICS v_requeued = ROW_COUNT;

  PERFORM public.log_action(
    v_exp.organization_id,
    v_actor_id,
    v_actor.app_role,
    'expediente.reassign_advisor',
    'expediente',
    p_expediente_id,
    jsonb_build_object(
      'team_id', v_team.id,
      'team_name', v_team.nombre,
      'previous_asesor_id', v_exp.asesor_id,
      'previous_asesor_email', v_old_owner.email,
      'target_asesor_id', v_target.id,
      'target_asesor_email', v_target.email,
      'previous_origen_mesa', v_exp.origen_mesa,
      'target_origen_mesa', v_new_origen,
      'agenda_bookings_requeued', v_requeued,
      'preserved_related_data', true
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'changed', true,
    'expediente_id', v_exp.id,
    'previous_asesor_id', v_exp.asesor_id,
    'asesor_id', v_target.id,
    'asesor_email', v_target.email,
    'asesor_nombre', v_target.full_name,
    'origen_mesa', v_new_origen,
    'agenda_bookings_requeued', v_requeued
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.asesor_reassign_team_context(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.asesor_reassign_team_expediente(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asesor_reassign_team_context(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.asesor_reassign_team_expediente(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.asesor_reassign_team_context(uuid) IS
  'Contexto de reasignación exclusivo de Silvia líder integradora; targets del mismo equipo activo y expediente activo.';
COMMENT ON FUNCTION public.asesor_reassign_team_expediente(uuid, uuid) IS
  'Reasigna un expediente activo del Equipo Silvia; conserva relaciones y reencola agenda para Drive.';
