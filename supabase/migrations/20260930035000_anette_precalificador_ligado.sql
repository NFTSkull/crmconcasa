-- ConCasa CRM — precalificador NSS-only ligado a un asesor titular.
-- Seguridad:
-- * el usuario precalificador conserva app_role=asesor por compatibilidad,
--   pero la capability precalificador_nss_only lo limita a un único flujo.
-- * NO pertenece a equipos y NO recibe create/integrate_for_any_advisor.
-- * todo INSERT de expediente hecho por ese actor queda bloqueado salvo que
--   use la RPC dedicada, con titular ligado + marca de procedencia.
-- * el expediente pertenece al titular (Anette); el precalificador no puede
--   abrirlo, cargar documentos ni completar Datos Generales por RLS normal.

BEGIN;

CREATE TABLE IF NOT EXISTS public.asesor_precalificadores_ligados (
  precalificador_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  asesor_titular_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (precalificador_id <> asesor_titular_id)
);

ALTER TABLE public.asesor_precalificadores_ligados ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.asesor_precalificadores_ligados FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.asesor_precalificadores_ligados TO service_role;

ALTER TABLE public.expedientes
  ADD COLUMN IF NOT EXISTS precalificador_origen_id UUID
  REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS expedientes_asesor_precalificador_created_idx
  ON public.expedientes (asesor_id, precalificador_origen_id, created_at DESC)
  WHERE deleted_at IS NULL AND precalificador_origen_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.guard_precalificador_nss_only_expediente_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor UUID := public.current_profile_id();
BEGIN
  IF v_actor IS NULL
     OR NOT public.profile_has_capability(v_actor, 'precalificador_nss_only') THEN
    RETURN NEW;
  END IF;

  IF NEW.precalificador_origen_id IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'precalificador_nss_only: solo puede crear desde el flujo NSS ligado'
      USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.asesor_precalificadores_ligados l
    JOIN public.profiles titular
      ON titular.id = l.asesor_titular_id
     AND titular.active = true
     AND titular.app_role = 'asesor'
    WHERE l.precalificador_id = v_actor
      AND l.asesor_titular_id = NEW.asesor_id
      AND l.active = true
  ) THEN
    RAISE EXCEPTION 'precalificador_nss_only: asesor titular no autorizado'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS expedientes_guard_precalificador_nss_only ON public.expedientes;
CREATE TRIGGER expedientes_guard_precalificador_nss_only
BEFORE INSERT ON public.expedientes
FOR EACH ROW
EXECUTE FUNCTION public.guard_precalificador_nss_only_expediente_insert();

CREATE OR REPLACE FUNCTION public.asesor_precalificador_ligado_context()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor UUID := public.current_profile_id();
  v_row RECORD;
BEGIN
  IF v_actor IS NULL
     OR NOT public.profile_has_capability(v_actor, 'precalificador_nss_only') THEN
    RETURN jsonb_build_object('enabled', false);
  END IF;

  SELECT
    l.asesor_titular_id,
    p.full_name,
    p.email
  INTO v_row
  FROM public.asesor_precalificadores_ligados l
  JOIN public.profiles actor
    ON actor.id = l.precalificador_id
   AND actor.active = true
   AND actor.app_role = 'asesor'
  JOIN public.profiles p
    ON p.id = l.asesor_titular_id
   AND p.active = true
   AND p.app_role = 'asesor'
   AND p.organization_id = actor.organization_id
  WHERE l.precalificador_id = v_actor
    AND l.active = true
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('enabled', false);
  END IF;

  RETURN jsonb_build_object(
    'enabled', true,
    'asesor_titular_id', v_row.asesor_titular_id,
    'asesor_titular_nombre', v_row.full_name,
    'asesor_titular_email', v_row.email
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.asesor_precalificador_ligado_context() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asesor_precalificador_ligado_context() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.asesor_precalificadores_para_titular()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor UUID := public.current_profile_id();
  v_items JSONB;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'asesor_precalificadores_para_titular: no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'full_name', p.full_name,
        'email', p.email
      )
      ORDER BY p.full_name, p.email
    ),
    '[]'::jsonb
  )
  INTO v_items
  FROM public.asesor_precalificadores_ligados l
  JOIN public.profiles p
    ON p.id = l.precalificador_id
   AND p.active = true
   AND p.app_role = 'asesor'
  WHERE l.asesor_titular_id = v_actor
    AND l.active = true;

  RETURN coalesce(v_items, '[]'::jsonb);
END;
$function$;

REVOKE ALL ON FUNCTION public.asesor_precalificadores_para_titular() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asesor_precalificadores_para_titular() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.asesor_precal_nss_only_habilitado()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor_id UUID := public.current_profile_id();
  v_profile public.profiles%ROWTYPE;
BEGIN
  IF v_actor_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT * INTO v_profile
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true
    AND p.app_role = 'asesor';

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF public.profile_has_capability(v_actor_id, 'precalificador_nss_only')
     AND EXISTS (
       SELECT 1
       FROM public.asesor_precalificadores_ligados l
       WHERE l.precalificador_id = v_actor_id
         AND l.active = true
     ) THEN
    RETURN true;
  END IF;

  IF v_profile.tipo_asesor_origen IS DISTINCT FROM 'externo'::public.tipo_asesor_origen THEN
    RETURN false;
  END IF;

  RETURN public.asesor_es_anette_externa(v_actor_id)
    OR public.asesor_es_equipo_silvia(v_actor_id);
END;
$function$;

COMMENT ON FUNCTION public.asesor_precal_nss_only_habilitado() IS
  'NSS-only para Anette/equipo Silvia y para precalificadores ligados con capability dedicada.';

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

  IF EXISTS (
    SELECT 1
    FROM public.expedientes e
    WHERE e.organization_id = v_actor_profile.organization_id
      AND e.asesor_id = v_target.id
      AND e.nss = v_nss
      AND e.programa = 'mejoravit'::public.programa
      AND e.ciclo_estado = 'activo'
      AND e.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'asesor_preparar_precalificacion_nss_only_ligada: Anette ya tiene un expediente activo con este NSS'
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

REVOKE ALL ON FUNCTION public.asesor_preparar_precalificacion_nss_only_ligada(TEXT, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asesor_preparar_precalificacion_nss_only_ligada(TEXT, TEXT)
  TO authenticated, service_role;

-- Overload nuevo: mismo inbox vigente + filtro opcional por origen de precalificación.
CREATE OR REPLACE FUNCTION public.asesor_list_expedientes_page(p_page integer DEFAULT 1, p_page_size integer DEFAULT 25, p_buscar text DEFAULT NULL::text, p_decision text DEFAULT NULL::text, p_estatus_operativo text DEFAULT NULL::text, p_resultado_real text DEFAULT NULL::text, p_programa text DEFAULT NULL::text, p_etapa_exacta integer DEFAULT NULL::integer, p_fecha_desde date DEFAULT NULL::date, p_fecha_hasta date DEFAULT NULL::date, p_quick_filter text DEFAULT 'todos'::text, p_owner_asesor_id uuid DEFAULT NULL::uuid, p_precalificador_origen_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '25s'
AS $function$
DECLARE
  v_actor UUID;
  v_role public.app_role;
  v_active BOOLEAN;
  v_page INTEGER;
  v_size INTEGER;
  v_from INTEGER;
  v_quick TEXT;
  v_owner UUID;
  v_total BIGINT;
  v_items JSONB;
BEGIN
  v_actor := public.current_profile_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'asesor_list_expedientes_page: no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.active
  INTO v_role, v_active
  FROM public.profiles p
  WHERE p.id = v_actor;

  IF NOT FOUND OR v_active IS DISTINCT FROM true OR v_role IS DISTINCT FROM 'asesor' THEN
    RAISE EXCEPTION 'asesor_list_expedientes_page: solo asesor activo'
      USING ERRCODE = '42501';
  END IF;

  v_page := GREATEST(1, coalesce(p_page, 1));
  v_size := LEAST(100, GREATEST(1, coalesce(p_page_size, 25)));
  v_from := (v_page - 1) * v_size;
  v_quick := lower(trim(coalesce(nullif(p_quick_filter, ''), 'todos')));

  v_owner := coalesce(p_owner_asesor_id, v_actor);
  IF v_owner IS DISTINCT FROM v_actor THEN
    IF NOT public.profile_has_capability(v_actor, 'integrate_for_any_advisor') THEN
      RAISE EXCEPTION 'asesor_list_expedientes_page: sin capability integrate_for_any_advisor'
        USING ERRCODE = '42501';
    END IF;
    IF NOT public.asesor_comparten_equipo_activo(v_actor, v_owner) THEN
      RAISE EXCEPTION 'asesor_list_expedientes_page: asesor titular fuera de equipo compartido'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_precalificador_origen_id IS NOT NULL THEN
    IF v_owner IS DISTINCT FROM v_actor THEN
      RAISE EXCEPTION 'asesor_list_expedientes_page: filtro de precalificador solo disponible sobre cartera propia'
        USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM public.asesor_precalificadores_ligados l
      WHERE l.asesor_titular_id = v_actor
        AND l.precalificador_id = p_precalificador_origen_id
        AND l.active = true
    ) THEN
      RAISE EXCEPTION 'asesor_list_expedientes_page: precalificador no ligado al asesor'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF v_quick = 'todos' THEN
    WITH cheap AS (
      SELECT
        e.id,
        e.programa,
        public.asesor_inbox_programa_ui(e.programa) AS programa_ui,
        e.nss::text AS nss,
        e.cliente_nombre,
        e.telefono_cliente::text AS telefono_cliente,
        e.direccion_opcional,
        e.asesor_id,
        e.origen_mesa::text AS origen_mesa,
        e.submitted_to_mesa,
        e.fecha_envio_mesa,
        e.etapa_actual,
        e.subestado::text AS subestado,
        e.ciclo_estado::text AS ciclo_estado,
        e.motivo_rechazo,
        e.comentario_rechazo,
        e.fecha_cita,
        e.firma_agendable_desde,
        e.pago_concasa_resultado,
        e.pago_concasa_at,
        e.created_at,
        e.updated_at,
        e.expediente_anterior_id,
        e.reingreso_rechazo_id,
        e.reingreso_manual_count,
        e.reingreso_manual_at,
        e.reingreso_manual_by,
        e.reprecalificacion_pendiente_id,
        coalesce(ed.decision::text, 'pendiente') AS decision,
        ed.monto_aprobado,
        coalesce(ed.notas_revision, '') AS notas_revision,
        ed.aprobado_at,
        ed.monto_aprobado_al_aprobar,
        ed.no_cumple_at,
        public.asesor_inbox_resultado_real(
          e.submitted_to_mesa,
          e.subestado::text,
          e.ciclo_estado::text,
          ed.decision::text
        ) AS resultado_real,
        CASE
          WHEN e.reprecalificacion_pendiente_id IS NOT NULL THEN 'pending'
          WHEN last_real.decision = 'aprobado' THEN 'approved'
          WHEN last_real.decision = 'no_cumple' THEN 'no_cumple'
          ELSE NULL
        END AS reprecal_estado,
        CASE
          WHEN e.reprecalificacion_pendiente_id IS NOT NULL THEN pend.created_at
          ELSE NULL
        END AS reprecal_solicitada_at,
        CASE
          WHEN e.reprecalificacion_pendiente_id IS NOT NULL THEN NULL
          ELSE last_real.decided_at
        END AS reprecal_resuelta_at,
        CASE
          WHEN e.reprecalificacion_pendiente_id IS NOT NULL THEN pend.created_at
          ELSE last_real.decided_at
        END AS reprecal_activity_at,
        CASE
          WHEN e.reprecalificacion_pendiente_id IS NOT NULL THEN pend.monto_aprobado_previo
          ELSE last_real.monto_aprobado_previo
        END AS reprecal_monto_previo,
        CASE
          WHEN e.reprecalificacion_pendiente_id IS NOT NULL THEN NULL
          WHEN last_real.decision = 'aprobado' THEN last_real.monto_aprobado
          ELSE NULL
        END AS reprecal_monto_resultado,
        CASE
          WHEN e.reprecalificacion_pendiente_id IS NOT NULL THEN pend.programa_solicitado::text
          ELSE last_real.programa_solicitado::text
        END AS reprecal_programa_solicitado,
        coalesce(
          CASE
            WHEN e.reprecalificacion_pendiente_id IS NOT NULL THEN pend.created_at
            ELSE last_real.decided_at
          END,
          e.created_at
        ) AS inbox_sort_at
      FROM public.expedientes e
      LEFT JOIN public.editor_decisions ed ON ed.expediente_id = e.id
      LEFT JOIN public.expediente_precalificacion_intentos pend
        ON pend.id = e.reprecalificacion_pendiente_id
      LEFT JOIN LATERAL (
        SELECT
          i.decision,
          i.created_at,
          i.decided_at,
          i.monto_aprobado,
          i.monto_aprobado_previo,
          i.programa_solicitado
        FROM public.expediente_precalificacion_intentos i
        WHERE e.reprecalificacion_pendiente_id IS NULL
          AND i.expediente_id = e.id
          AND i.decision IN (
            'aprobado'::public.editor_decision,
            'no_cumple'::public.editor_decision
          )
          AND (
            i.decision_previa IS NOT NULL
            OR nullif(btrim(coalesce(i.idempotency_key, '')), '') IS NOT NULL
          )
        ORDER BY i.decided_at DESC NULLS LAST, i.created_at DESC, i.id DESC
        LIMIT 1
      ) last_real ON TRUE
      WHERE e.deleted_at IS NULL
        AND e.asesor_id = v_owner
      AND (
        p_precalificador_origen_id IS NULL
        OR e.precalificador_origen_id = p_precalificador_origen_id
      )
    ),
    filtered AS MATERIALIZED (
      SELECT c.*
      FROM cheap c
      WHERE public.asesor_inbox_matches_buscar(
          c.cliente_nombre, c.nss, c.telefono_cliente, c.programa_ui, p_buscar
        )
        AND (
          p_decision IS NULL OR trim(p_decision) = ''
          OR c.decision = trim(p_decision)
        )
        AND (
          p_estatus_operativo IS NULL OR trim(p_estatus_operativo) = ''
          OR coalesce(c.subestado, 'pendiente') = trim(p_estatus_operativo)
        )
        AND (
          p_resultado_real IS NULL OR trim(p_resultado_real) = ''
          OR c.resultado_real = trim(p_resultado_real)
        )
        AND (
          p_programa IS NULL OR trim(p_programa) = ''
          OR c.programa_ui = trim(p_programa)
        )
        AND (
          p_etapa_exacta IS NULL
          OR c.etapa_actual = p_etapa_exacta::smallint
        )
        AND (
          p_fecha_desde IS NULL
          OR c.created_at >= (p_fecha_desde::timestamp AT TIME ZONE 'America/Monterrey')
        )
        AND (
          p_fecha_hasta IS NULL
          OR c.created_at <= (
            (p_fecha_hasta::timestamp + interval '1 day' - interval '1 millisecond')
              AT TIME ZONE 'America/Monterrey'
          )
        )
    ),
    counted AS MATERIALIZED (
      SELECT count(*)::bigint AS total FROM filtered
    ),
    candidate AS MATERIALIZED (
      SELECT f.*
      FROM filtered f
      ORDER BY f.inbox_sort_at DESC, f.id DESC
      OFFSET v_from
      LIMIT v_size
    ),
    enriched AS (
      SELECT
        c.*,
        public.asesor_inbox_categoria_correccion(c.id) AS categoria_correccion,
        eff.estado_efectivo,
        CASE
          WHEN eff.estado_efectivo = 'correccion_requerida'
          THEN public.asesor_inbox_format_correccion_explicacion(
            public.asesor_inbox_correccion_labels_vigentes(c.id)
          )
          ELSE NULL
        END AS correccion_explicacion,
        CASE
          WHEN eff.estado_efectivo = 'correccion_requerida'
          THEN public.asesor_inbox_correccion_resumen(c.id)
          ELSE NULL
        END AS correccion_resumen
      FROM candidate c
      LEFT JOIN LATERAL (
        SELECT public.asesor_inbox_estado_efectivo(c.id) AS estado_efectivo
      ) eff ON TRUE
    ),
    page AS (
      SELECT
        e.id,
        e.programa_ui AS programa,
        e.programa::text AS programa_db,
        e.nss,
        e.cliente_nombre,
        e.telefono_cliente,
        e.direccion_opcional,
        e.asesor_id,
        e.origen_mesa,
        e.submitted_to_mesa,
        e.fecha_envio_mesa,
        e.etapa_actual,
        e.subestado,
        e.ciclo_estado,
        e.motivo_rechazo,
        e.comentario_rechazo,
        e.fecha_cita,
        e.firma_agendable_desde,
        e.pago_concasa_resultado,
        e.pago_concasa_at,
        e.created_at,
        e.updated_at,
        e.expediente_anterior_id,
        e.reingreso_rechazo_id,
        e.reingreso_manual_count,
        e.reingreso_manual_at,
        e.reingreso_manual_by,
        e.reprecalificacion_pendiente_id,
        e.decision,
        e.monto_aprobado,
        e.notas_revision,
        e.aprobado_at,
        e.monto_aprobado_al_aprobar,
        e.no_cumple_at,
        e.resultado_real,
        e.categoria_correccion,
        e.estado_efectivo,
        e.correccion_explicacion,
        e.correccion_resumen,
        e.reprecal_estado,
        e.reprecal_solicitada_at,
        e.reprecal_resuelta_at,
        e.reprecal_activity_at,
        e.reprecal_monto_previo,
        e.reprecal_monto_resultado,
        e.reprecal_programa_solicitado,
        e.inbox_sort_at
      FROM enriched e
    )
    SELECT
      c.total,
      coalesce(
        (
          SELECT jsonb_agg(
            (to_jsonb(p) - 'inbox_sort_at')
            ORDER BY p.inbox_sort_at DESC, p.id DESC
          )
          FROM page p
        ),
        '[]'::jsonb
      )
    INTO v_total, v_items
    FROM counted c;

    RETURN jsonb_build_object(
      'items', coalesce(v_items, '[]'::jsonb),
      'total_count', v_total,
      'page', v_page,
      'page_size', v_size,
      'has_more', (v_from + v_size) < v_total
    );
  END IF;

  WITH cheap AS (
    SELECT
      e.id,
      e.programa,
      public.asesor_inbox_programa_ui(e.programa) AS programa_ui,
      e.nss::text AS nss,
      e.cliente_nombre,
      e.telefono_cliente::text AS telefono_cliente,
      e.direccion_opcional,
      e.asesor_id,
      e.origen_mesa::text AS origen_mesa,
      e.submitted_to_mesa,
      e.fecha_envio_mesa,
      e.etapa_actual,
      e.subestado::text AS subestado,
      e.ciclo_estado::text AS ciclo_estado,
      e.motivo_rechazo,
      e.comentario_rechazo,
      e.fecha_cita,
      e.firma_agendable_desde,
      e.pago_concasa_resultado,
      e.pago_concasa_at,
      e.created_at,
      e.updated_at,
      e.expediente_anterior_id,
      e.reingreso_rechazo_id,
      e.reingreso_manual_count,
      e.reingreso_manual_at,
      e.reingreso_manual_by,
      e.reprecalificacion_pendiente_id,
      coalesce(ed.decision::text, 'pendiente') AS decision,
      ed.monto_aprobado,
      coalesce(ed.notas_revision, '') AS notas_revision,
      ed.aprobado_at,
      ed.monto_aprobado_al_aprobar,
      ed.no_cumple_at,
      public.asesor_inbox_resultado_real(
        e.submitted_to_mesa,
        e.subestado::text,
        e.ciclo_estado::text,
        ed.decision::text
      ) AS resultado_real,
      CASE
        WHEN e.reprecalificacion_pendiente_id IS NOT NULL THEN 'pending'
        WHEN last_real.decision = 'aprobado' THEN 'approved'
        WHEN last_real.decision = 'no_cumple' THEN 'no_cumple'
        ELSE NULL
      END AS reprecal_estado,
      CASE
        WHEN e.reprecalificacion_pendiente_id IS NOT NULL THEN pend.created_at
        ELSE NULL
      END AS reprecal_solicitada_at,
      CASE
        WHEN e.reprecalificacion_pendiente_id IS NOT NULL THEN NULL
        ELSE last_real.decided_at
      END AS reprecal_resuelta_at,
      CASE
        WHEN e.reprecalificacion_pendiente_id IS NOT NULL THEN pend.created_at
        ELSE last_real.decided_at
      END AS reprecal_activity_at,
      CASE
        WHEN e.reprecalificacion_pendiente_id IS NOT NULL THEN pend.monto_aprobado_previo
        ELSE last_real.monto_aprobado_previo
      END AS reprecal_monto_previo,
      CASE
        WHEN e.reprecalificacion_pendiente_id IS NOT NULL THEN NULL
        WHEN last_real.decision = 'aprobado' THEN last_real.monto_aprobado
        ELSE NULL
      END AS reprecal_monto_resultado,
      CASE
        WHEN e.reprecalificacion_pendiente_id IS NOT NULL THEN pend.programa_solicitado::text
        ELSE last_real.programa_solicitado::text
      END AS reprecal_programa_solicitado,
      coalesce(
        CASE
          WHEN e.reprecalificacion_pendiente_id IS NOT NULL THEN pend.created_at
          ELSE last_real.decided_at
        END,
        e.created_at
      ) AS inbox_sort_at
    FROM public.expedientes e
    LEFT JOIN public.editor_decisions ed ON ed.expediente_id = e.id
    LEFT JOIN public.expediente_precalificacion_intentos pend
      ON pend.id = e.reprecalificacion_pendiente_id
    LEFT JOIN LATERAL (
      SELECT
        i.decision,
        i.created_at,
        i.decided_at,
        i.monto_aprobado,
        i.monto_aprobado_previo,
        i.programa_solicitado
      FROM public.expediente_precalificacion_intentos i
      WHERE e.reprecalificacion_pendiente_id IS NULL
        AND i.expediente_id = e.id
        AND i.decision IN (
          'aprobado'::public.editor_decision,
          'no_cumple'::public.editor_decision
        )
        AND (
          i.decision_previa IS NOT NULL
          OR nullif(btrim(coalesce(i.idempotency_key, '')), '') IS NOT NULL
        )
      ORDER BY i.decided_at DESC NULLS LAST, i.created_at DESC, i.id DESC
      LIMIT 1
    ) last_real ON TRUE
    WHERE e.deleted_at IS NULL
      AND e.asesor_id = v_owner
      AND (
        p_precalificador_origen_id IS NULL
        OR e.precalificador_origen_id = p_precalificador_origen_id
      )
  ),
  classified AS MATERIALIZED (
    SELECT
      c.*,
      eff.estado_efectivo,
      public.asesor_inbox_pendiente_agendar_biometricos(
        c.submitted_to_mesa, c.etapa_actual, c.id
      ) AS pendiente_agendar_biometricos,
      public.asesor_inbox_pendiente_agendar_firma(
        c.submitted_to_mesa, c.etapa_actual, c.id
      ) AS pendiente_agendar_firma,
      public.asesor_inbox_pendiente_subir_acuse(
        c.submitted_to_mesa, c.etapa_actual, c.id
      ) AS pendiente_subir_acuse
    FROM cheap c
    LEFT JOIN LATERAL (
      SELECT public.asesor_inbox_estado_efectivo(c.id) AS estado_efectivo
    ) eff ON TRUE
  ),
  filtered AS MATERIALIZED (
    SELECT b.*
    FROM classified b
    WHERE public.asesor_inbox_matches_buscar(
        b.cliente_nombre, b.nss, b.telefono_cliente, b.programa_ui, p_buscar
      )
      AND (
        p_decision IS NULL OR trim(p_decision) = ''
        OR b.decision = trim(p_decision)
      )
      AND (
        p_estatus_operativo IS NULL OR trim(p_estatus_operativo) = ''
        OR coalesce(b.subestado, 'pendiente') = trim(p_estatus_operativo)
      )
      AND (
        p_resultado_real IS NULL OR trim(p_resultado_real) = ''
        OR b.resultado_real = trim(p_resultado_real)
      )
      AND (
        p_programa IS NULL OR trim(p_programa) = ''
        OR b.programa_ui = trim(p_programa)
      )
      AND (
        p_etapa_exacta IS NULL
        OR b.etapa_actual = p_etapa_exacta::smallint
      )
      AND (
        p_fecha_desde IS NULL
        OR b.created_at >= (p_fecha_desde::timestamp AT TIME ZONE 'America/Monterrey')
      )
      AND (
        p_fecha_hasta IS NULL
        OR b.created_at <= (
          (p_fecha_hasta::timestamp + interval '1 day' - interval '1 millisecond')
            AT TIME ZONE 'America/Monterrey'
        )
      )
      AND coalesce(b.ciclo_estado, '') IS DISTINCT FROM 'cerrado'
      AND CASE v_quick
        WHEN 'en_tramite' THEN b.estado_efectivo = 'en_tramite'
        WHEN 'correccion_requerida' THEN b.estado_efectivo = 'correccion_requerida'
        WHEN 'correccion_enviada' THEN b.estado_efectivo = 'correccion_enviada'
        WHEN 'rechazados_mesa' THEN b.estado_efectivo = 'rechazado_mesa'
        WHEN 'cancelados' THEN b.estado_efectivo = 'cancelado'
        WHEN 'agendar_biometricos' THEN b.pendiente_agendar_biometricos
        WHEN 'agendar_firma' THEN b.pendiente_agendar_firma
        WHEN 'subir_acuse' THEN b.pendiente_subir_acuse
        ELSE TRUE
      END
  ),
  counted AS MATERIALIZED (
    SELECT count(*)::bigint AS total FROM filtered
  ),
  candidate AS MATERIALIZED (
    SELECT f.*
    FROM filtered f
    ORDER BY f.inbox_sort_at DESC, f.id DESC
    OFFSET v_from
    LIMIT v_size
  ),
  enriched AS (
    SELECT
      c.*,
      public.asesor_inbox_categoria_correccion(c.id) AS categoria_correccion,
      CASE
        WHEN c.estado_efectivo = 'correccion_requerida'
        THEN public.asesor_inbox_format_correccion_explicacion(
          public.asesor_inbox_correccion_labels_vigentes(c.id)
        )
        ELSE NULL
      END AS correccion_explicacion,
      CASE
        WHEN c.estado_efectivo = 'correccion_requerida'
        THEN public.asesor_inbox_correccion_resumen(c.id)
        ELSE NULL
      END AS correccion_resumen
    FROM candidate c
  ),
  page AS (
    SELECT
      e.id,
      e.programa_ui AS programa,
      e.programa::text AS programa_db,
      e.nss,
      e.cliente_nombre,
      e.telefono_cliente,
      e.direccion_opcional,
      e.asesor_id,
      e.origen_mesa,
      e.submitted_to_mesa,
      e.fecha_envio_mesa,
      e.etapa_actual,
      e.subestado,
      e.ciclo_estado,
      e.motivo_rechazo,
      e.comentario_rechazo,
      e.fecha_cita,
      e.firma_agendable_desde,
      e.pago_concasa_resultado,
      e.pago_concasa_at,
      e.created_at,
      e.updated_at,
      e.expediente_anterior_id,
      e.reingreso_rechazo_id,
      e.reingreso_manual_count,
      e.reingreso_manual_at,
      e.reingreso_manual_by,
      e.reprecalificacion_pendiente_id,
      e.decision,
      e.monto_aprobado,
      e.notas_revision,
      e.aprobado_at,
      e.monto_aprobado_al_aprobar,
      e.no_cumple_at,
      e.resultado_real,
      e.categoria_correccion,
      e.estado_efectivo,
      e.correccion_explicacion,
      e.correccion_resumen,
      e.reprecal_estado,
      e.reprecal_solicitada_at,
      e.reprecal_resuelta_at,
      e.reprecal_activity_at,
      e.reprecal_monto_previo,
      e.reprecal_monto_resultado,
      e.reprecal_programa_solicitado,
      e.inbox_sort_at
    FROM enriched e
  )
  SELECT
    c.total,
    coalesce(
      (
        SELECT jsonb_agg(
          (to_jsonb(p) - 'inbox_sort_at')
          ORDER BY p.inbox_sort_at DESC, p.id DESC
        )
        FROM page p
      ),
      '[]'::jsonb
    )
  INTO v_total, v_items
  FROM counted c;

  RETURN jsonb_build_object(
    'items', coalesce(v_items, '[]'::jsonb),
    'total_count', v_total,
    'page', v_page,
    'page_size', v_size,
    'has_more', (v_from + v_size) < v_total
  );
END;
$function$


REVOKE ALL ON FUNCTION public.asesor_list_expedientes_page(
  INTEGER, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, DATE, DATE, TEXT, UUID, UUID
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asesor_list_expedientes_page(
  INTEGER, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, DATE, DATE, TEXT, UUID, UUID
) TO authenticated, service_role;

COMMIT;
