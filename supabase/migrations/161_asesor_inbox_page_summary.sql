-- ConCasa CRM — B1.5 P161: inbox asesor paginado + summary (RO)
-- RPCs: asesor_list_expedientes_page, asesor_inbox_summary
-- Equivalencia TS: docs/ASESOR_INBOX_B15_EQUIVALENCIA.md
-- Sin UI, sin Cloud apply en este bloque.

-- =============================================================================
-- Helpers (paridad /asesor)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.asesor_inbox_programa_ui(p_programa public.programa)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE p_programa
    WHEN 'mejoravit' THEN 'Mejoravit'
    WHEN 'subcuenta' THEN 'Subcuenta'
    WHEN 'compro_tu_casa' THEN 'Compro tu casa'
    ELSE p_programa::text
  END;
$$;

CREATE OR REPLACE FUNCTION public.asesor_inbox_resultado_real(
  p_submitted_to_mesa BOOLEAN,
  p_subestado TEXT,
  p_ciclo_estado TEXT,
  p_decision TEXT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN coalesce(p_ciclo_estado, '') = 'cancelado' THEN 'cancelado'
    WHEN coalesce(p_submitted_to_mesa, false)
      AND coalesce(p_subestado, '') = 'rechazado'
      AND (p_ciclo_estado IS NULL OR p_ciclo_estado = 'activo')
      THEN 'rechazado_mesa'
    WHEN coalesce(p_submitted_to_mesa, false) THEN 'en_tramite'
    WHEN coalesce(p_decision, 'pendiente') = 'no_cumple' THEN 'no_cumple_editor'
    WHEN coalesce(p_decision, 'pendiente') = 'aprobado' THEN 'aprobado_editor'
    ELSE 'pendiente_editor'
  END;
$$;

COMMENT ON FUNCTION public.asesor_inbox_resultado_real(BOOLEAN, TEXT, TEXT, TEXT) IS
  'B1.5: espejo deriveResultadoRealExpediente.';

CREATE OR REPLACE FUNCTION public.asesor_inbox_doc_pack_estatus(
  p_expediente_id UUID,
  p_tipo TEXT
)
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  -- DOCUMENTO_TIPOS legado (ine/estado_cuenta/nss/direccion). Paridad exacta TS.
  SELECT d.estatus_revision::text
  FROM public.expediente_documentos d
  WHERE d.expediente_id = p_expediente_id
    AND d.deleted_at IS NULL
    AND d.tipo_documento = p_tipo
  ORDER BY d.created_at DESC NULLS LAST, d.id DESC
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.asesor_inbox_categoria_correccion(p_expediente_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_cd_estado TEXT;
  v_ine TEXT;
  v_ec TEXT;
  v_nss TEXT;
  v_dir TEXT;
  v_doc TEXT;
BEGIN
  -- deriveResumenExpedienteCorreccion con solo estado (UI /asesor actual).
  SELECT cd.estado::text INTO v_cd_estado
  FROM public.cliente_datos cd
  WHERE cd.expediente_id = p_expediente_id
  LIMIT 1;

  IF v_cd_estado = 'rechazado' THEN
    RETURN 'correccion_requerida';
  END IF;

  v_ine := public.asesor_inbox_doc_pack_estatus(p_expediente_id, 'ine');
  v_ec := public.asesor_inbox_doc_pack_estatus(p_expediente_id, 'estado_cuenta');
  v_nss := public.asesor_inbox_doc_pack_estatus(p_expediente_id, 'nss');
  v_dir := public.asesor_inbox_doc_pack_estatus(p_expediente_id, 'direccion');

  IF v_ine IS NULL OR v_ec IS NULL OR v_nss IS NULL OR v_dir IS NULL
     OR v_ine = 'faltante' OR v_ec = 'faltante' OR v_nss = 'faltante' OR v_dir = 'faltante' THEN
    v_doc := 'faltantes';
  ELSIF v_ine = 'rechazado' OR v_ec = 'rechazado' OR v_nss = 'rechazado' OR v_dir = 'rechazado' THEN
    v_doc := 'correccion_requerida';
  ELSIF v_ine = 'resubido' OR v_ec = 'resubido' OR v_nss = 'resubido' OR v_dir = 'resubido' THEN
    v_doc := 'correccion_enviada';
  ELSIF v_ine = 'subido' OR v_ec = 'subido' OR v_nss = 'subido' OR v_dir = 'subido' THEN
    v_doc := 'pendiente_revision_documental';
  ELSIF v_ine = 'validado' AND v_ec = 'validado' AND v_nss = 'validado' AND v_dir = 'validado' THEN
    v_doc := 'documentos_validados';
  ELSE
    v_doc := 'pendiente_revision_documental';
  END IF;

  -- Sin fechas en la llamada UI → no aplica clienteDatosCorreccionEnviadaPendiente.
  RETURN v_doc;
END;
$$;

COMMENT ON FUNCTION public.asesor_inbox_categoria_correccion(UUID) IS
  'B1.5: espejo deriveResumenExpedienteCorreccion(/asesor) con DOCUMENTO_TIPOS legado.';

CREATE OR REPLACE FUNCTION public.asesor_inbox_has_booking(
  p_expediente_id UUID,
  p_kind TEXT,
  p_status TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.agenda_bookings b
    WHERE b.expediente_id = p_expediente_id
      AND b.kind::text = p_kind
      AND b.status::text = p_status
  );
$$;

CREATE OR REPLACE FUNCTION public.asesor_inbox_pendiente_agendar_biometricos(
  p_submitted_to_mesa BOOLEAN,
  p_etapa_actual SMALLINT,
  p_expediente_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT coalesce(p_submitted_to_mesa, false)
    AND p_etapa_actual = 3
    AND NOT public.asesor_inbox_has_booking(p_expediente_id, 'notificacion', 'booked')
    AND NOT public.asesor_inbox_has_booking(p_expediente_id, 'biometricos', 'booked');
$$;

CREATE OR REPLACE FUNCTION public.asesor_inbox_pendiente_agendar_firma(
  p_submitted_to_mesa BOOLEAN,
  p_etapa_actual SMALLINT,
  p_expediente_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  -- canShowAsesorFirmasSupabaseCard + !hasActiveBooking (modo Supabase).
  SELECT CASE
    WHEN NOT coalesce(p_submitted_to_mesa, false) THEN false
    WHEN p_etapa_actual = 9 THEN
      NOT public.asesor_inbox_has_booking(p_expediente_id, 'firmas', 'booked')
    WHEN p_etapa_actual = 10 THEN
      NOT public.asesor_inbox_has_booking(p_expediente_id, 'firmas', 'booked')
      AND public.asesor_inbox_has_booking(p_expediente_id, 'firmas', 'cancelled')
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION public.asesor_inbox_pendiente_subir_acuse(
  p_submitted_to_mesa BOOLEAN,
  p_etapa_actual SMALLINT,
  p_expediente_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT coalesce(p_submitted_to_mesa, false)
    AND p_etapa_actual IS NOT NULL
    AND p_etapa_actual >= 8
    AND NOT EXISTS (
      SELECT 1
      FROM public.expediente_documentos d
      WHERE d.expediente_id = p_expediente_id
        AND d.deleted_at IS NULL
        AND d.tipo_documento IN (
          'retencion_acuse_con_sello',
          'retencion_carta_sin_sello'
        )
        AND d.estatus_revision::text IN ('subido', 'resubido', 'validado')
    );
$$;

CREATE OR REPLACE FUNCTION public.asesor_inbox_matches_buscar(
  p_cliente_nombre TEXT,
  p_nss TEXT,
  p_telefono TEXT,
  p_programa_ui TEXT,
  p_buscar TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_term TEXT;
  v_digits TEXT;
BEGIN
  v_term := lower(trim(coalesce(p_buscar, '')));
  IF v_term = '' THEN
    RETURN true;
  END IF;

  IF position(v_term in lower(coalesce(p_cliente_nombre, ''))) > 0 THEN
    RETURN true;
  END IF;
  IF position(v_term in lower(coalesce(p_programa_ui, ''))) > 0 THEN
    RETURN true;
  END IF;
  IF position(v_term in lower(coalesce(p_nss, ''))) > 0 THEN
    RETURN true;
  END IF;

  v_digits := regexp_replace(v_term, '\D', '', 'g');
  IF v_digits <> '' THEN
    IF position(v_digits in regexp_replace(coalesce(p_nss, ''), '\D', '', 'g')) > 0 THEN
      RETURN true;
    END IF;
    IF position(v_digits in regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g')) > 0 THEN
      RETURN true;
    END IF;
  END IF;

  RETURN false;
END;
$$;

-- =============================================================================
-- asesor_list_expedientes_page
-- =============================================================================

CREATE OR REPLACE FUNCTION public.asesor_list_expedientes_page(
  p_page INTEGER DEFAULT 1,
  p_page_size INTEGER DEFAULT 25,
  p_buscar TEXT DEFAULT NULL,
  p_decision TEXT DEFAULT NULL,
  p_estatus_operativo TEXT DEFAULT NULL,
  p_resultado_real TEXT DEFAULT NULL,
  p_programa TEXT DEFAULT NULL,
  p_etapa_exacta INTEGER DEFAULT NULL,
  p_fecha_desde DATE DEFAULT NULL,
  p_fecha_hasta DATE DEFAULT NULL,
  p_quick_filter TEXT DEFAULT 'todos'
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
  v_active BOOLEAN;
  v_page INTEGER;
  v_size INTEGER;
  v_from INTEGER;
  v_quick TEXT;
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

  WITH base AS (
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
      public.asesor_inbox_categoria_correccion(e.id) AS categoria_correccion,
      public.asesor_inbox_pendiente_agendar_biometricos(
        e.submitted_to_mesa, e.etapa_actual, e.id
      ) AS pendiente_agendar_biometricos,
      public.asesor_inbox_pendiente_agendar_firma(
        e.submitted_to_mesa, e.etapa_actual, e.id
      ) AS pendiente_agendar_firma,
      public.asesor_inbox_pendiente_subir_acuse(
        e.submitted_to_mesa, e.etapa_actual, e.id
      ) AS pendiente_subir_acuse
    FROM public.expedientes e
    LEFT JOIN public.editor_decisions ed ON ed.expediente_id = e.id
    WHERE e.deleted_at IS NULL
      AND e.asesor_id = v_actor
  ),
  filtered AS (
    SELECT b.*
    FROM base b
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
      AND (
        v_quick = 'todos'
        OR coalesce(b.ciclo_estado, '') IS DISTINCT FROM 'cerrado'
      )
      AND CASE v_quick
        WHEN 'todos' THEN TRUE
        WHEN 'en_tramite' THEN
          b.resultado_real = 'en_tramite'
          AND b.categoria_correccion IS DISTINCT FROM 'correccion_requerida'
          AND b.categoria_correccion IS DISTINCT FROM 'correccion_enviada'
        WHEN 'correccion_requerida' THEN b.categoria_correccion = 'correccion_requerida'
        WHEN 'correccion_enviada' THEN b.categoria_correccion = 'correccion_enviada'
        WHEN 'rechazados_mesa' THEN b.resultado_real = 'rechazado_mesa'
        WHEN 'cancelados' THEN b.resultado_real = 'cancelado'
        WHEN 'agendar_biometricos' THEN b.pendiente_agendar_biometricos
        WHEN 'agendar_firma' THEN b.pendiente_agendar_firma
        WHEN 'subir_acuse' THEN b.pendiente_subir_acuse
        ELSE TRUE
      END
  ),
  counted AS (
    SELECT count(*)::bigint AS total FROM filtered
  ),
  page AS (
    SELECT
      f.id,
      f.programa_ui AS programa,
      f.programa::text AS programa_db,
      f.nss,
      f.cliente_nombre,
      f.telefono_cliente,
      f.direccion_opcional,
      f.asesor_id,
      f.origen_mesa,
      f.submitted_to_mesa,
      f.fecha_envio_mesa,
      f.etapa_actual,
      f.subestado,
      f.ciclo_estado,
      f.motivo_rechazo,
      f.comentario_rechazo,
      f.fecha_cita,
      f.firma_agendable_desde,
      f.created_at,
      f.updated_at,
      f.expediente_anterior_id,
      f.reingreso_rechazo_id,
      f.reingreso_manual_count,
      f.reingreso_manual_at,
      f.reingreso_manual_by,
      f.reprecalificacion_pendiente_id,
      f.decision,
      f.monto_aprobado,
      f.notas_revision,
      f.aprobado_at,
      f.monto_aprobado_al_aprobar,
      f.no_cumple_at,
      f.resultado_real,
      f.categoria_correccion
    FROM filtered f
    ORDER BY f.created_at DESC, f.id DESC
    OFFSET v_from
    LIMIT v_size
  )
  SELECT
    c.total,
    coalesce(
      (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.created_at DESC, p.id DESC) FROM page p),
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
$$;

REVOKE ALL ON FUNCTION public.asesor_list_expedientes_page(
  INTEGER, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, DATE, DATE, TEXT
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asesor_list_expedientes_page(
  INTEGER, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, DATE, DATE, TEXT
) TO authenticated;

COMMENT ON FUNCTION public.asesor_list_expedientes_page(
  INTEGER, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, DATE, DATE, TEXT
) IS
  'B1.5 P161: listado paginado inbox asesor (filtros→orden created_at DESC,id DESC→página). Solo dueño.';

-- =============================================================================
-- asesor_inbox_summary
-- =============================================================================

CREATE OR REPLACE FUNCTION public.asesor_inbox_summary(
  p_notif_limit INTEGER DEFAULT 50
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
  v_active BOOLEAN;
  v_limit INTEGER;
  v_today TEXT;
  v_counts JSONB;
  v_programas JSONB;
  v_notifs JSONB;
BEGIN
  v_actor := public.current_profile_id();
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'asesor_inbox_summary: no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role, p.active
  INTO v_role, v_active
  FROM public.profiles p
  WHERE p.id = v_actor;

  IF NOT FOUND OR v_active IS DISTINCT FROM true OR v_role IS DISTINCT FROM 'asesor' THEN
    RAISE EXCEPTION 'asesor_inbox_summary: solo asesor activo'
      USING ERRCODE = '42501';
  END IF;

  v_limit := LEAST(100, GREATEST(1, coalesce(p_notif_limit, 50)));
  v_today := to_char(
    (now() AT TIME ZONE 'America/Monterrey')::date,
    'YYYY-MM-DD'
  );

  WITH base AS (
    SELECT
      e.id,
      e.cliente_nombre,
      e.submitted_to_mesa,
      e.fecha_envio_mesa,
      e.etapa_actual,
      e.subestado::text AS subestado,
      e.ciclo_estado::text AS ciclo_estado,
      e.fecha_cita,
      e.updated_at,
      public.asesor_inbox_programa_ui(e.programa) AS programa_ui,
      public.asesor_inbox_resultado_real(
        e.submitted_to_mesa,
        e.subestado::text,
        e.ciclo_estado::text,
        ed.decision::text
      ) AS resultado_real,
      public.asesor_inbox_categoria_correccion(e.id) AS categoria_correccion,
      public.asesor_inbox_pendiente_agendar_biometricos(
        e.submitted_to_mesa, e.etapa_actual, e.id
      ) AS pendiente_agendar_biometricos,
      public.asesor_inbox_pendiente_agendar_firma(
        e.submitted_to_mesa, e.etapa_actual, e.id
      ) AS pendiente_agendar_firma,
      public.asesor_inbox_pendiente_subir_acuse(
        e.submitted_to_mesa, e.etapa_actual, e.id
      ) AS pendiente_subir_acuse,
      (SELECT cd.estado::text FROM public.cliente_datos cd WHERE cd.expediente_id = e.id LIMIT 1)
        AS cliente_datos_estado
    FROM public.expedientes e
    LEFT JOIN public.editor_decisions ed ON ed.expediente_id = e.id
    WHERE e.deleted_at IS NULL
      AND e.asesor_id = v_actor
  ),
  agg AS (
    SELECT
      count(*)::bigint AS total,
      count(*) FILTER (WHERE resultado_real = 'aprobado_editor')::bigint AS aprobados_editor,
      count(*) FILTER (WHERE resultado_real = 'no_cumple_editor')::bigint AS no_cumple,
      count(*) FILTER (
        WHERE resultado_real = 'en_tramite'
          AND categoria_correccion IS DISTINCT FROM 'correccion_requerida'
          AND categoria_correccion IS DISTINCT FROM 'correccion_enviada'
      )::bigint AS en_tramite,
      count(*) FILTER (WHERE resultado_real = 'rechazado_mesa')::bigint AS rechazados_mesa,
      count(*) FILTER (WHERE resultado_real = 'cancelado')::bigint AS cancelados,
      count(*) FILTER (WHERE categoria_correccion = 'correccion_requerida')::bigint
        AS correccion_requerida,
      count(*) FILTER (WHERE categoria_correccion = 'correccion_enviada')::bigint
        AS correccion_enviada,
      count(*) FILTER (WHERE pendiente_agendar_biometricos)::bigint AS agendar_biometricos,
      count(*) FILTER (WHERE pendiente_agendar_firma)::bigint AS agendar_firma,
      count(*) FILTER (WHERE pendiente_subir_acuse)::bigint AS subir_acuse
    FROM base
  ),
  programas AS (
    SELECT coalesce(
      jsonb_agg(DISTINCT programa_ui ORDER BY programa_ui),
      '[]'::jsonb
    ) AS arr
    FROM base
    WHERE trim(coalesce(programa_ui, '')) <> ''
  ),
  notif_raw AS (
    -- Espejo buildCandidates(audience=asesor) + pickBest (menor prioridad).
    SELECT
      b.id AS expediente_id,
      b.cliente_nombre,
      cand.kind,
      cand.tipo_label,
      cand.mensaje,
      cand.fecha,
      cand.prioridad,
      '/asesor/expediente/' || b.id::text AS href
    FROM base b
    CROSS JOIN LATERAL (
      SELECT kind, tipo_label, mensaje, fecha, prioridad
      FROM (
        SELECT
          'cancelado'::text AS kind,
          'Expediente cancelado'::text AS tipo_label,
          'Expediente cancelado (terminal) — solo lectura'::text AS mensaje,
          coalesce(b.updated_at, b.fecha_envio_mesa, b.fecha_cita) AS fecha,
          1 AS prioridad
        WHERE b.ciclo_estado = 'cancelado'

        UNION ALL
        SELECT
          'correccion_requerida',
          'Corrección requerida',
          CASE
            WHEN b.cliente_datos_estado = 'rechazado'
                 AND b.categoria_correccion = 'correccion_requerida'
              THEN 'Datos generales y documentos requieren corrección'
            WHEN b.cliente_datos_estado = 'rechazado'
              THEN 'Datos generales requieren corrección'
            ELSE 'Documentos requieren corrección'
          END,
          coalesce(b.updated_at, b.fecha_envio_mesa, b.fecha_cita),
          1
        WHERE b.ciclo_estado IS DISTINCT FROM 'cancelado'
          AND (
            b.cliente_datos_estado = 'rechazado'
            OR b.categoria_correccion = 'correccion_requerida'
          )

        UNION ALL
        SELECT
          'rechazado_mesa',
          'Rechazado por Mesa',
          'Expediente rechazado o bloqueado por Mesa',
          coalesce(b.updated_at, b.fecha_envio_mesa, b.fecha_cita),
          2
        WHERE b.ciclo_estado IS DISTINCT FROM 'cancelado'
          AND coalesce(b.subestado, 'pendiente') = 'rechazado'

        UNION ALL
        SELECT
          'correccion_enviada',
          'Corrección enviada',
          'Corrección enviada — Mesa debe revisar',
          coalesce(b.updated_at, b.fecha_envio_mesa, b.fecha_cita),
          3
        WHERE b.ciclo_estado IS DISTINCT FROM 'cancelado'
          AND b.categoria_correccion = 'correccion_enviada'

        UNION ALL
        SELECT
          'enviado_mesa',
          'En validación Mesa',
          'Expediente enviado a Mesa — en validación',
          coalesce(b.fecha_envio_mesa, b.updated_at, b.fecha_cita),
          5
        WHERE b.ciclo_estado IS DISTINCT FROM 'cancelado'
          AND b.submitted_to_mesa
          AND coalesce(b.subestado, '') = 'en_validacion_mesa'
          AND b.categoria_correccion IS DISTINCT FROM 'correccion_requerida'
          AND b.categoria_correccion IS DISTINCT FROM 'correccion_enviada'
          AND coalesce(b.cliente_datos_estado, '') IS DISTINCT FROM 'rechazado'

        UNION ALL
        SELECT
          'cita_hoy',
          'Cita hoy',
          'Cita programada para hoy',
          coalesce(b.fecha_cita, b.updated_at),
          6
        WHERE b.ciclo_estado IS DISTINCT FROM 'cancelado'
          AND b.fecha_cita IS NOT NULL
          AND to_char((b.fecha_cita AT TIME ZONE 'America/Monterrey'), 'YYYY-MM-DD') = v_today

        UNION ALL
        SELECT
          'cita_cambio',
          'Cambio en cita',
          'Cita cancelada o pendiente de reagendar',
          coalesce(b.updated_at, b.fecha_envio_mesa),
          6
        WHERE b.ciclo_estado IS DISTINCT FROM 'cancelado'
          AND b.submitted_to_mesa
          AND b.etapa_actual IN (4, 5, 9, 10)
          AND b.fecha_cita IS NULL

        UNION ALL
        SELECT
          'cita_programada',
          'Cita agendada',
          'Cita agendada (' || to_char((b.fecha_cita AT TIME ZONE 'America/Monterrey'), 'YYYY-MM-DD') || ')',
          coalesce(b.fecha_cita, b.updated_at),
          7
        WHERE b.ciclo_estado IS DISTINCT FROM 'cancelado'
          AND b.fecha_cita IS NOT NULL
          AND b.etapa_actual IN (4, 5, 9, 10)
          AND to_char((b.fecha_cita AT TIME ZONE 'America/Monterrey'), 'YYYY-MM-DD')
            IS DISTINCT FROM v_today
      ) cands
      ORDER BY prioridad ASC, fecha DESC NULLS LAST
      LIMIT 1
    ) cand
  ),
  notif_page AS (
    SELECT coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', n.expediente_id::text || ':' || n.kind,
          'expediente_id', n.expediente_id,
          'cliente_nombre', coalesce(nullif(trim(n.cliente_nombre), ''), '—'),
          'kind', n.kind,
          'tipo_label', n.tipo_label,
          'mensaje', n.mensaje,
          'fecha', n.fecha,
          'prioridad', n.prioridad,
          'href', n.href
        )
        ORDER BY n.prioridad ASC, n.fecha DESC NULLS LAST
      ),
      '[]'::jsonb
    ) AS arr
    FROM (
      SELECT *
      FROM notif_raw
      ORDER BY prioridad ASC, fecha DESC NULLS LAST
      LIMIT v_limit
    ) n
  )
  SELECT
    jsonb_build_object(
      'total', a.total,
      'aprobados_editor', a.aprobados_editor,
      'no_cumple', a.no_cumple,
      'en_tramite', a.en_tramite,
      'rechazados_mesa', a.rechazados_mesa,
      'cancelados', a.cancelados,
      'correccion_requerida', a.correccion_requerida,
      'correccion_enviada', a.correccion_enviada,
      'agendar_biometricos', a.agendar_biometricos,
      'agendar_firma', a.agendar_firma,
      'subir_acuse', a.subir_acuse
    ),
    p.arr,
    np.arr
  INTO v_counts, v_programas, v_notifs
  FROM agg a, programas p, notif_page np;

  RETURN jsonb_build_object(
    'counts', coalesce(v_counts, '{}'::jsonb),
    'programas_unicos', coalesce(v_programas, '[]'::jsonb),
    'notifications', coalesce(v_notifs, '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.asesor_inbox_summary(INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asesor_inbox_summary(INTEGER) TO authenticated;

COMMENT ON FUNCTION public.asesor_inbox_summary(INTEGER) IS
  'B1.5 P161: KPIs/chips globales + programas_unicos + top notifications asesor. Solo dueño.';
