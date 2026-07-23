-- ConCasa CRM — P118: decisiones de gestión de cita (append-only) + RPC unificada Mesa
-- STOP: cancelar_continuar requiere RPC dedicada por kind (no bypass de gates).

CREATE TABLE IF NOT EXISTS public.agenda_booking_decisiones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  expediente_id UUID NOT NULL REFERENCES public.expedientes(id),
  booking_id UUID REFERENCES public.agenda_bookings(id),
  kind public.booking_kind NOT NULL,
  decision TEXT NOT NULL,
  motivo TEXT NOT NULL,
  decided_by UUID NOT NULL REFERENCES public.profiles(id),
  decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  previous_booking_date DATE,
  previous_booking_time TIME,
  previous_location_id TEXT,
  new_booking_date DATE,
  new_booking_time TIME,
  new_location_id TEXT,
  new_booking_id UUID REFERENCES public.agenda_bookings(id),
  CONSTRAINT agenda_booking_decisiones_decision_check
    CHECK (decision IN ('reagendar', 'cancelar', 'cancelar_continuar')),
  CONSTRAINT agenda_booking_decisiones_motivo_nonempty
    CHECK (btrim(motivo) <> '')
);

CREATE INDEX IF NOT EXISTS agenda_booking_decisiones_exp_idx
  ON public.agenda_booking_decisiones (expediente_id, decided_at DESC);

COMMENT ON TABLE public.agenda_booking_decisiones IS
  'P118: historial append-only de decisiones Mesa sobre citas (reagendar/cancelar).';

ALTER TABLE public.agenda_booking_decisiones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS agenda_booking_decisiones_select ON public.agenda_booking_decisiones;
CREATE POLICY agenda_booking_decisiones_select
  ON public.agenda_booking_decisiones
  FOR SELECT
  TO authenticated
  USING (
    organization_id = public.current_organization_id()
    OR public.current_app_role() = 'super_admin'
    OR EXISTS (
      SELECT 1 FROM public.expedientes e
      WHERE e.id = agenda_booking_decisiones.expediente_id
        AND e.asesor_id = public.current_profile_id()
    )
  );

REVOKE ALL ON TABLE public.agenda_booking_decisiones FROM PUBLIC;
GRANT SELECT ON TABLE public.agenda_booking_decisiones TO authenticated;
GRANT ALL ON TABLE public.agenda_booking_decisiones TO service_role;

-- Lectura para asesor/Mesa
CREATE OR REPLACE FUNCTION public.list_agenda_booking_decisiones(
  p_expediente_id UUID
)
RETURNS TABLE (
  id UUID,
  kind public.booking_kind,
  decision TEXT,
  motivo TEXT,
  decided_at TIMESTAMPTZ,
  decided_by_name TEXT,
  previous_booking_date DATE,
  previous_booking_time TIME,
  previous_location_id TEXT,
  new_booking_date DATE,
  new_booking_time TIME,
  new_location_id TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_role public.app_role;
  v_org UUID;
BEGIN
  v_actor := public.current_profile_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'list_agenda_booking_decisiones: no autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id INTO v_role, v_org
  FROM public.profiles p WHERE p.id = v_actor AND p.active = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'list_agenda_booking_decisiones: perfil inactivo' USING ERRCODE = '42501';
  END IF;

  IF NOT public.can_see_expediente(p_expediente_id) THEN
    RAISE EXCEPTION 'list_agenda_booking_decisiones: no autorizado' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    d.id,
    d.kind,
    d.decision,
    d.motivo,
    d.decided_at,
    COALESCE(pr.full_name, pr.email, d.decided_by::TEXT) AS decided_by_name,
    d.previous_booking_date,
    d.previous_booking_time,
    d.previous_location_id,
    d.new_booking_date,
    d.new_booking_time,
    d.new_location_id
  FROM public.agenda_booking_decisiones d
  LEFT JOIN public.profiles pr ON pr.id = d.decided_by
  WHERE d.expediente_id = p_expediente_id
  ORDER BY d.decided_at DESC
  LIMIT 50;
END;
$$;

REVOKE ALL ON FUNCTION public.list_agenda_booking_decisiones(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_agenda_booking_decisiones(UUID) TO authenticated;

-- Gestión unificada Mesa (reagendar / cancelar). cancelar_continuar → STOP.
CREATE OR REPLACE FUNCTION public.mesa_gestionar_cita(
  p_booking_id UUID,
  p_action TEXT,
  p_motivo TEXT,
  p_new_scheduled_at TIMESTAMPTZ DEFAULT NULL,
  p_new_location_id TEXT DEFAULT NULL,
  p_new_booking_date DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID;
  v_role public.app_role;
  v_org UUID;
  v_b public.agenda_bookings%ROWTYPE;
  v_motivo TEXT;
  v_action TEXT;
  v_result JSONB;
  v_new_booking_id UUID;
  v_decision_id UUID;
BEGIN
  v_actor := public.current_profile_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'mesa_gestionar_cita: no autenticado' USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.organization_id INTO v_role, v_org
  FROM public.profiles p WHERE p.id = v_actor AND p.active = true;

  IF NOT FOUND OR v_role NOT IN (
    'mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin'
  ) THEN
    RAISE EXCEPTION 'mesa_gestionar_cita: rol no autorizado' USING ERRCODE = '42501';
  END IF;

  v_action := lower(btrim(COALESCE(p_action, '')));
  v_motivo := NULLIF(btrim(COALESCE(p_motivo, '')), '');
  IF v_motivo IS NULL THEN
    RAISE EXCEPTION 'mesa_gestionar_cita: motivo obligatorio' USING ERRCODE = '22023';
  END IF;

  IF v_action = 'cancelar_continuar' THEN
    -- STOP P118: no hay transición segura sin omitir gates de cita (bio 4→5 / firmas 9→10|10→11).
    RAISE EXCEPTION 'mesa_gestionar_cita: cancelar_continuar requiere RPC dedicada por kind (P118 STOP)'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_b
  FROM public.agenda_bookings b
  WHERE b.id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'mesa_gestionar_cita: booking no encontrado' USING ERRCODE = 'P0002';
  END IF;

  IF v_role <> 'super_admin' AND v_b.organization_id IS DISTINCT FROM v_org THEN
    RAISE EXCEPTION 'mesa_gestionar_cita: org distinta' USING ERRCODE = '42501';
  END IF;

  IF v_b.status <> 'booked' THEN
    RAISE EXCEPTION 'mesa_gestionar_cita: booking no activo' USING ERRCODE = '22023';
  END IF;

  IF v_action = 'cancelar' THEN
    IF v_b.kind = 'biometricos' THEN
      v_result := public.cancel_biometricos(v_b.expediente_id, v_motivo);
    ELSIF v_b.kind = 'firmas' THEN
      IF to_regprocedure('public.mesa_cancel_firmas(uuid,text)') IS NOT NULL THEN
        v_result := public.mesa_cancel_firmas(v_b.expediente_id, v_motivo);
      ELSE
        v_result := public.cancel_firmas(v_b.expediente_id, v_motivo);
      END IF;
    ELSIF v_b.kind = 'notificacion' THEN
      IF v_role NOT IN ('mesa_admin', 'super_admin') THEN
        RAISE EXCEPTION 'mesa_gestionar_cita: cancelar notificación solo mesa_admin/super_admin'
          USING ERRCODE = '42501';
      END IF;
      v_result := public.cancel_notificacion_etapa3(v_b.expediente_id, v_motivo);
    ELSE
      RAISE EXCEPTION 'mesa_gestionar_cita: kind no soportado' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.agenda_booking_decisiones (
      organization_id, expediente_id, booking_id, kind, decision, motivo, decided_by,
      previous_booking_date, previous_booking_time, previous_location_id
    ) VALUES (
      v_b.organization_id, v_b.expediente_id, v_b.id, v_b.kind, 'cancelar', v_motivo, v_actor,
      v_b.booking_date, v_b.booking_time, v_b.location_id
    ) RETURNING id INTO v_decision_id;

    RETURN jsonb_build_object(
      'ok', true,
      'action', 'cancelar',
      'decision_id', v_decision_id,
      'result', v_result
    );
  END IF;

  IF v_action = 'reagendar' THEN
    IF v_b.kind = 'biometricos' THEN
      IF p_new_scheduled_at IS NULL OR NULLIF(btrim(COALESCE(p_new_location_id, '')), '') IS NULL THEN
        RAISE EXCEPTION 'mesa_gestionar_cita: reagendar biométricos exige fecha/hora y sede'
          USING ERRCODE = '22023';
      END IF;
      IF v_role NOT IN ('mesa_admin', 'super_admin') THEN
        RAISE EXCEPTION 'mesa_gestionar_cita: reagendar biométricos solo mesa_admin/super_admin'
          USING ERRCODE = '42501';
      END IF;
      v_result := public.mesa_reagendar_biometricos(
        v_b.expediente_id,
        (p_new_scheduled_at AT TIME ZONE 'America/Monterrey')::DATE,
        (p_new_scheduled_at AT TIME ZONE 'America/Monterrey')::TIME,
        NULLIF(btrim(p_new_location_id), ''),
        v_motivo
      );
    ELSIF v_b.kind = 'firmas' THEN
      IF p_new_scheduled_at IS NULL OR NULLIF(btrim(COALESCE(p_new_location_id, '')), '') IS NULL THEN
        RAISE EXCEPTION 'mesa_gestionar_cita: reagendar firmas exige fecha/hora y sede'
          USING ERRCODE = '22023';
      END IF;
      v_result := public.mesa_reagendar_firmas(
        v_b.expediente_id,
        p_new_scheduled_at,
        'America/Monterrey',
        NULLIF(btrim(p_new_location_id), ''),
        v_motivo
      );
    ELSIF v_b.kind = 'notificacion' THEN
      IF p_new_booking_date IS NULL THEN
        RAISE EXCEPTION 'mesa_gestionar_cita: reagendar notificación exige fecha'
          USING ERRCODE = '22023';
      END IF;
      IF v_role NOT IN ('mesa_admin', 'super_admin') THEN
        RAISE EXCEPTION 'mesa_gestionar_cita: reagendar notificación solo mesa_admin/super_admin'
          USING ERRCODE = '42501';
      END IF;
      v_result := public.mesa_reagendar_notificacion(
        v_b.expediente_id, p_new_booking_date, v_motivo
      );
    ELSE
      RAISE EXCEPTION 'mesa_gestionar_cita: kind no soportado' USING ERRCODE = '22023';
    END IF;

    SELECT b.id INTO v_new_booking_id
    FROM public.agenda_bookings b
    WHERE b.expediente_id = v_b.expediente_id
      AND b.kind = v_b.kind
      AND b.status = 'booked'
    ORDER BY b.created_at DESC
    LIMIT 1;

    INSERT INTO public.agenda_booking_decisiones (
      organization_id, expediente_id, booking_id, kind, decision, motivo, decided_by,
      previous_booking_date, previous_booking_time, previous_location_id,
      new_booking_date, new_booking_time, new_location_id, new_booking_id
    )
    SELECT
      v_b.organization_id, v_b.expediente_id, v_b.id, v_b.kind, 'reagendar', v_motivo, v_actor,
      v_b.booking_date, v_b.booking_time, v_b.location_id,
      nb.booking_date, nb.booking_time, nb.location_id, nb.id
    FROM public.agenda_bookings nb
    WHERE nb.id = v_new_booking_id
    RETURNING id INTO v_decision_id;

    RETURN jsonb_build_object(
      'ok', true,
      'action', 'reagendar',
      'decision_id', v_decision_id,
      'new_booking_id', v_new_booking_id,
      'result', v_result
    );
  END IF;

  RAISE EXCEPTION 'mesa_gestionar_cita: acción no reconocida (%)', p_action
    USING ERRCODE = '22023';
END;
$$;

REVOKE ALL ON FUNCTION public.mesa_gestionar_cita(UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mesa_gestionar_cita(UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT, DATE) TO authenticated;

COMMENT ON FUNCTION public.mesa_gestionar_cita(UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT, DATE) IS
  'P118: Mesa reagendar/cancelar con decisión persistida. cancelar_continuar = STOP (sin bypass de gates).';
