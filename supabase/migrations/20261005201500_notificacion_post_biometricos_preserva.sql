-- Notificación posterior a biométricos realizados.
-- Preserva booking/resultados biométricos; no usa la conversión P070 ni regresa a etapa 3.

CREATE OR REPLACE FUNCTION public.book_notificacion_post_biometricos(
  p_expediente_id uuid,
  p_booking_date date,
  p_location_id text,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_id uuid;
  v_actor_role public.app_role;
  v_org_id uuid;
  v_exp record;
  v_bio record;
  v_notif_id uuid;
  v_note text;
  v_booking_time time := time '12:00';
  v_location_id text;
  v_tz text := 'America/Monterrey';
  v_scheduled_at timestamptz;
  v_local_noon timestamp;
  v_etapa_anterior smallint;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'book_notificacion_post_biometricos: usuario no autenticado' USING ERRCODE='42501';
  END IF;

  SELECT p.app_role, p.organization_id INTO v_actor_role, v_org_id
  FROM public.profiles p WHERE p.id=v_actor_id AND p.active=true;
  IF NOT FOUND OR v_actor_role <> 'asesor' THEN
    RAISE EXCEPTION 'book_notificacion_post_biometricos: rol no autorizado' USING ERRCODE='42501';
  END IF;

  v_note := NULLIF(btrim(COALESCE(p_note,'')), '');
  v_location_id := public.agenda_notificacion_normalize_location_id(p_location_id);

  SELECT e.id,e.organization_id,e.asesor_id,e.ciclo_estado,e.submitted_to_mesa,
         e.etapa_actual,e.subestado,e.fecha_cita,e.deleted_at
  INTO v_exp FROM public.expedientes e WHERE e.id=p_expediente_id FOR UPDATE;

  IF NOT FOUND OR v_exp.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'book_notificacion_post_biometricos: expediente no disponible' USING ERRCODE='P0002';
  END IF;
  IF v_exp.organization_id IS DISTINCT FROM v_org_id OR v_exp.asesor_id IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'book_notificacion_post_biometricos: solo el asesor dueño puede agendar' USING ERRCODE='42501';
  END IF;
  IF v_exp.ciclo_estado <> 'activo' OR v_exp.submitted_to_mesa IS NOT TRUE OR v_exp.subestado <> 'en_proceso' THEN
    RAISE EXCEPTION 'book_notificacion_post_biometricos: expediente no accionable' USING ERRCODE='22023';
  END IF;
  IF v_exp.etapa_actual NOT IN (4,5) THEN
    RAISE EXCEPTION 'book_notificacion_post_biometricos: solo aplica después de biométricos (etapa actual: %)', v_exp.etapa_actual USING ERRCODE='22023';
  END IF;

  SELECT b.id,b.booking_date,b.booking_time,b.location_id,b.status
  INTO v_bio
  FROM public.agenda_bookings b
  WHERE b.expediente_id=p_expediente_id AND b.kind='biometricos' AND b.status='booked'
  ORDER BY b.created_at DESC,b.id DESC LIMIT 1 FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'book_notificacion_post_biometricos: no hay cita biométrica registrada' USING ERRCODE='22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.agenda_sheet_operational_results r
    WHERE r.booking_id=v_bio.id
      AND r.projection_status='CURRENT'
      AND r.biometric_effective_result='COMPLETED_CURRENT'
  ) THEN
    RAISE EXCEPTION 'book_notificacion_post_biometricos: biométricos todavía no aparecen como realizados' USING ERRCODE='22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.agenda_bookings b
    WHERE b.expediente_id=p_expediente_id AND b.kind='notificacion' AND b.status='booked'
  ) THEN
    RAISE EXCEPTION 'book_notificacion_post_biometricos: ya existe una notificación activa' USING ERRCODE='22023';
  END IF;

  SELECT NULLIF(btrim(COALESCE(ac.config->>'timezone','')), '')
  INTO v_tz FROM public.agenda_config ac
  WHERE ac.organization_id=v_exp.organization_id AND ac.kind='biometricos';
  IF v_tz IS NULL THEN v_tz := 'America/Monterrey'; END IF;

  v_local_noon := p_booking_date::timestamp + time '12:00';
  v_scheduled_at := v_local_noon AT TIME ZONE v_tz;
  IF v_scheduled_at <= now() THEN
    RAISE EXCEPTION 'book_notificacion_post_biometricos: la fecha debe ser futura' USING ERRCODE='22023';
  END IF;

  v_etapa_anterior := v_exp.etapa_actual;

  INSERT INTO public.agenda_bookings(
    organization_id,kind,expediente_id,booking_date,booking_time,location_id,status,note,created_by
  ) VALUES (
    v_exp.organization_id,'notificacion',p_expediente_id,p_booking_date,v_booking_time,
    v_location_id,'booked',v_note,v_actor_id
  ) RETURNING id INTO v_notif_id;

  UPDATE public.expedientes
  SET etapa_actual=5,fecha_cita=v_scheduled_at,subestado='en_proceso',updated_at=now()
  WHERE id=p_expediente_id;

  PERFORM public.log_action(
    v_exp.organization_id,v_actor_id,v_actor_role,
    'agenda.notificacion.book_post_biometricos','agenda_booking',v_notif_id,
    jsonb_build_object(
      'expediente_id',p_expediente_id,'biometricos_booking_id',v_bio.id,
      'notificacion_booking_id',v_notif_id,'biometricos_preservados',true,
      'booking_date',p_booking_date,'booking_time',v_booking_time,
      'location_id',v_location_id,'etapa_anterior',v_etapa_anterior,'etapa_actual',5
    )
  );

  RETURN jsonb_build_object(
    'ok',true,'booking_id',v_notif_id,'expediente_id',p_expediente_id,
    'biometricos_booking_id',v_bio.id,'scheduled_at',v_scheduled_at,
    'booking_date',p_booking_date,'booking_time',v_booking_time,'location_id',v_location_id,
    'etapa_anterior',v_etapa_anterior,'etapa_actual',5,'biometricos_preservados',true
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_notificacion_post_biometricos(
  p_expediente_id uuid,
  p_motivo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_id uuid; v_actor_role public.app_role; v_org_id uuid; v_exp record;
  v_notif record; v_bio record; v_motivo text; v_tz text := 'America/Monterrey';
  v_bio_at timestamptz;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'cancel_notificacion_post_biometricos: usuario no autenticado' USING ERRCODE='42501'; END IF;
  SELECT p.app_role,p.organization_id INTO v_actor_role,v_org_id FROM public.profiles p WHERE p.id=v_actor_id AND p.active=true;
  IF NOT FOUND OR v_actor_role <> 'asesor' THEN RAISE EXCEPTION 'cancel_notificacion_post_biometricos: rol no autorizado' USING ERRCODE='42501'; END IF;

  SELECT e.id,e.organization_id,e.asesor_id,e.ciclo_estado,e.submitted_to_mesa,e.etapa_actual,e.subestado,e.deleted_at
  INTO v_exp FROM public.expedientes e WHERE e.id=p_expediente_id FOR UPDATE;
  IF NOT FOUND OR v_exp.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'cancel_notificacion_post_biometricos: expediente no disponible' USING ERRCODE='P0002'; END IF;
  IF v_exp.organization_id IS DISTINCT FROM v_org_id OR v_exp.asesor_id IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'cancel_notificacion_post_biometricos: solo el asesor dueño puede cancelar' USING ERRCODE='42501';
  END IF;
  IF v_exp.etapa_actual <> 5 OR v_exp.ciclo_estado <> 'activo' OR v_exp.submitted_to_mesa IS NOT TRUE THEN
    RAISE EXCEPTION 'cancel_notificacion_post_biometricos: expediente no accionable' USING ERRCODE='22023';
  END IF;

  SELECT b.id,b.booking_date,b.booking_time,b.location_id,b.note INTO v_notif
  FROM public.agenda_bookings b
  WHERE b.expediente_id=p_expediente_id AND b.kind='notificacion' AND b.status='booked'
  ORDER BY b.created_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'cancel_notificacion_post_biometricos: no hay notificación activa' USING ERRCODE='22023'; END IF;

  v_motivo := NULLIF(btrim(COALESCE(p_motivo,'')), '');
  UPDATE public.agenda_bookings
  SET status='cancelled',cancelled_at=now(),
      note=CASE WHEN v_motivo IS NULL THEN note
                WHEN note IS NULL OR btrim(note)='' THEN 'Cancelada: '||v_motivo
                ELSE note||E'\nCancelada: '||v_motivo END
  WHERE id=v_notif.id;

  SELECT b.booking_date,b.booking_time INTO v_bio
  FROM public.agenda_bookings b
  WHERE b.expediente_id=p_expediente_id AND b.kind='biometricos' AND b.status='booked'
  ORDER BY b.created_at DESC LIMIT 1;

  SELECT NULLIF(btrim(COALESCE(ac.config->>'timezone','')), '') INTO v_tz
  FROM public.agenda_config ac WHERE ac.organization_id=v_exp.organization_id AND ac.kind='biometricos';
  IF v_tz IS NULL THEN v_tz := 'America/Monterrey'; END IF;
  IF v_bio.booking_date IS NOT NULL THEN
    v_bio_at := (v_bio.booking_date::timestamp + COALESCE(v_bio.booking_time,time '09:00')) AT TIME ZONE v_tz;
  END IF;

  UPDATE public.expedientes SET fecha_cita=COALESCE(v_bio_at,fecha_cita),updated_at=now()
  WHERE id=p_expediente_id;

  PERFORM public.log_action(
    v_exp.organization_id,v_actor_id,v_actor_role,
    'agenda.notificacion.cancel_post_biometricos','agenda_booking',v_notif.id,
    jsonb_build_object('expediente_id',p_expediente_id,'biometricos_preservados',true,'motivo',v_motivo)
  );

  RETURN jsonb_build_object('ok',true,'expediente_id',p_expediente_id,'booking_id',v_notif.id,'status','cancelled','etapa_actual',5,'biometricos_preservados',true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.reagendar_notificacion_post_biometricos(
  p_expediente_id uuid,
  p_booking_date date,
  p_location_id text,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_id uuid; v_actor_role public.app_role; v_org_id uuid; v_exp record;
  v_prev record; v_new_id uuid; v_location_id text; v_note text;
  v_tz text := 'America/Monterrey'; v_scheduled_at timestamptz;
  v_booking_time time := time '12:00';
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN RAISE EXCEPTION 'reagendar_notificacion_post_biometricos: usuario no autenticado' USING ERRCODE='42501'; END IF;
  SELECT p.app_role,p.organization_id INTO v_actor_role,v_org_id FROM public.profiles p WHERE p.id=v_actor_id AND p.active=true;
  IF NOT FOUND OR v_actor_role <> 'asesor' THEN RAISE EXCEPTION 'reagendar_notificacion_post_biometricos: rol no autorizado' USING ERRCODE='42501'; END IF;

  SELECT e.id,e.organization_id,e.asesor_id,e.ciclo_estado,e.submitted_to_mesa,e.etapa_actual,e.subestado,e.deleted_at
  INTO v_exp FROM public.expedientes e WHERE e.id=p_expediente_id FOR UPDATE;
  IF NOT FOUND OR v_exp.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'reagendar_notificacion_post_biometricos: expediente no disponible' USING ERRCODE='P0002'; END IF;
  IF v_exp.organization_id IS DISTINCT FROM v_org_id OR v_exp.asesor_id IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'reagendar_notificacion_post_biometricos: solo el asesor dueño puede reagendar' USING ERRCODE='42501';
  END IF;
  IF v_exp.etapa_actual <> 5 OR v_exp.ciclo_estado <> 'activo' OR v_exp.submitted_to_mesa IS NOT TRUE THEN
    RAISE EXCEPTION 'reagendar_notificacion_post_biometricos: expediente no accionable' USING ERRCODE='22023';
  END IF;

  SELECT b.id,b.booking_date,b.booking_time,b.location_id INTO v_prev
  FROM public.agenda_bookings b
  WHERE b.expediente_id=p_expediente_id AND b.kind='notificacion' AND b.status='booked'
  ORDER BY b.created_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'reagendar_notificacion_post_biometricos: no hay notificación activa' USING ERRCODE='22023'; END IF;

  v_location_id := public.agenda_notificacion_normalize_location_id(p_location_id);
  v_note := NULLIF(btrim(COALESCE(p_note,'')), '');
  SELECT NULLIF(btrim(COALESCE(ac.config->>'timezone','')), '') INTO v_tz
  FROM public.agenda_config ac WHERE ac.organization_id=v_exp.organization_id AND ac.kind='biometricos';
  IF v_tz IS NULL THEN v_tz := 'America/Monterrey'; END IF;
  v_scheduled_at := (p_booking_date::timestamp + v_booking_time) AT TIME ZONE v_tz;
  IF v_scheduled_at <= now() THEN RAISE EXCEPTION 'reagendar_notificacion_post_biometricos: la fecha debe ser futura' USING ERRCODE='22023'; END IF;

  UPDATE public.agenda_bookings
  SET status='cancelled',cancelled_at=now(),
      note=CASE WHEN note IS NULL OR btrim(note)='' THEN 'Reagendado' ELSE note||E'\nReagendado' END
  WHERE id=v_prev.id;

  INSERT INTO public.agenda_bookings(
    organization_id,kind,expediente_id,booking_date,booking_time,location_id,status,note,created_by
  ) VALUES (
    v_exp.organization_id,'notificacion',p_expediente_id,p_booking_date,v_booking_time,v_location_id,'booked',v_note,v_actor_id
  ) RETURNING id INTO v_new_id;

  UPDATE public.expedientes SET fecha_cita=v_scheduled_at,updated_at=now() WHERE id=p_expediente_id;

  PERFORM public.log_action(
    v_exp.organization_id,v_actor_id,v_actor_role,
    'agenda.notificacion.reagendar_post_biometricos','agenda_booking',v_new_id,
    jsonb_build_object('expediente_id',p_expediente_id,'booking_anterior_id',v_prev.id,'booking_nuevo_id',v_new_id,'biometricos_preservados',true,'booking_date',p_booking_date,'location_id',v_location_id)
  );

  RETURN jsonb_build_object(
    'ok',true,'expediente_id',p_expediente_id,'booking_anterior_id',v_prev.id,'booking_nuevo_id',v_new_id,
    'booking_id',v_new_id,'scheduled_at',v_scheduled_at,'booking_date',p_booking_date,'booking_time',v_booking_time,
    'location_id',v_location_id,'status','booked','kind','notificacion','etapa_actual',5,'biometricos_preservados',true
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.book_notificacion_post_biometricos(uuid,date,text,text) FROM public, anon;
REVOKE ALL ON FUNCTION public.cancel_notificacion_post_biometricos(uuid,text) FROM public, anon;
REVOKE ALL ON FUNCTION public.reagendar_notificacion_post_biometricos(uuid,date,text,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.book_notificacion_post_biometricos(uuid,date,text,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_notificacion_post_biometricos(uuid,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reagendar_notificacion_post_biometricos(uuid,date,text,text) TO authenticated, service_role;

COMMENT ON FUNCTION public.book_notificacion_post_biometricos(uuid,date,text,text) IS
  'Agenda Notificación después de biométricos COMPLETED; conserva booking/resultados biométricos y evita regresión a etapa 3.';
