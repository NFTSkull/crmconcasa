-- ConCasa CRM — P194: detalle robusto de cambios del asesor (read-model).
-- Cloud max conocido = 193. 194 = este bloque. Operación de citas → 195.
-- Solo CREATE/REPLACE de funciones de lectura + GRANT/COMMENT.
-- 0 tablas, 0 columnas, 0 backfill, 0 UPDATE/DELETE de datos, 0 writers.

CREATE OR REPLACE FUNCTION public.mesa_asesor_cambio_doc_es_femenino(p_kind TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT lower(btrim(COALESCE(p_kind, ''))) IN (
    'cliente_ine_frente',
    'cliente_ine_reverso',
    'cliente_notificacion',
    'cliente_notificacion_apodaca',
    'cliente_carta_empresa',
    'asesor_evidencia'
  );
$$;

COMMENT ON FUNCTION public.mesa_asesor_cambio_doc_es_femenino(TEXT) IS
  'P194: kinds documentales con copy femenino (reemplazada).';

REVOKE ALL ON FUNCTION public.mesa_asesor_cambio_doc_es_femenino(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mesa_asesor_cambio_doc_es_femenino(TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.mesa_asesor_cambio_payload_es_reemplazo(p_payload JSONB)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (p_payload->>'reemplazo')::boolean,
    (p_payload->>'reemplazo') IN ('true', 't', '1'),
    false
  );
$$;

COMMENT ON FUNCTION public.mesa_asesor_cambio_payload_es_reemplazo(JSONB) IS
  'P194: payload action_log indica reemplazo documental.';

REVOKE ALL ON FUNCTION public.mesa_asesor_cambio_payload_es_reemplazo(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mesa_asesor_cambio_payload_es_reemplazo(JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.mesa_asesor_cambio_doc_kind_label(
  p_kind TEXT,
  p_tipo TEXT DEFAULT 'documento_reemplazado'
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kind TEXT := lower(btrim(COALESCE(p_kind, '')));
  v_base TEXT;
  v_tipo TEXT := lower(btrim(COALESCE(p_tipo, 'documento_reemplazado')));
BEGIN
  IF v_kind = 'asesor_evidencia' THEN
    RETURN 'Evidencia del asesor reemplazada';
  END IF;

  v_base := public.asesor_cambio_doc_label(v_kind);

  IF v_tipo IN ('documento_reemplazado', 'documento_agregado', 'documento_eliminado')
     OR v_tipo LIKE 'documento_%' THEN
    IF public.mesa_asesor_cambio_doc_es_femenino(v_kind) THEN
      RETURN v_base || ' reemplazada';
    END IF;
    RETURN v_base || ' reemplazado';
  END IF;

  RETURN v_base;
END;
$$;

COMMENT ON FUNCTION public.mesa_asesor_cambio_doc_kind_label(TEXT, TEXT) IS
  'P194: label humano documental con género; asesor_evidencia canónico.';

REVOKE ALL ON FUNCTION public.mesa_asesor_cambio_doc_kind_label(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mesa_asesor_cambio_doc_kind_label(TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.mesa_asesor_cambio_normalize_label(
  p_label TEXT,
  p_tipo TEXT,
  p_campo TEXT,
  p_document_kind TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_label TEXT := btrim(COALESCE(p_label, ''));
  v_kind TEXT := lower(btrim(COALESCE(p_document_kind, '')));
  v_tipo TEXT := lower(btrim(COALESCE(p_tipo, '')));
BEGIN
  IF v_kind = 'asesor_evidencia'
     OR v_label ILIKE '%asesor_evidencia%' THEN
    RETURN 'Evidencia del asesor reemplazada';
  END IF;

  IF v_kind <> '' AND v_tipo LIKE 'documento_%' THEN
    RETURN public.mesa_asesor_cambio_doc_kind_label(v_kind, v_tipo);
  END IF;

  IF v_kind <> '' THEN
    IF public.mesa_asesor_cambio_doc_es_femenino(v_kind)
       AND (v_label ILIKE '% reemplazado' OR v_label ILIKE '% reemplazado.') THEN
      RETURN regexp_replace(v_label, ' reemplazado\.?$', ' reemplazada', 'i');
    END IF;
  END IF;

  IF v_label ILIKE 'notificación reemplazado%'
     OR v_label ILIKE 'notificación apodaca reemplazado%'
     OR v_label ILIKE 'carta de la empresa reemplazado%'
     OR v_label ILIKE 'ine frente reemplazado%'
     OR v_label ILIKE 'ine reverso reemplazado%' THEN
    RETURN regexp_replace(v_label, ' reemplazado', ' reemplazada', 'i');
  END IF;

  IF v_label <> '' THEN
    RETURN v_label;
  END IF;

  IF v_kind <> '' THEN
    RETURN public.mesa_asesor_cambio_doc_kind_label(v_kind, v_tipo);
  END IF;

  RETURN COALESCE(NULLIF(v_label, ''), NULLIF(btrim(COALESCE(p_campo, '')), ''), 'Cambio');
END;
$$;

COMMENT ON FUNCTION public.mesa_asesor_cambio_normalize_label(TEXT, TEXT, TEXT, TEXT) IS
  'P194: normalización read-time de labels (género / asesor_evidencia).';

REVOKE ALL ON FUNCTION public.mesa_asesor_cambio_normalize_label(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mesa_asesor_cambio_normalize_label(TEXT, TEXT, TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.mesa_asesor_cambio_preview_item(
  p_tipo TEXT,
  p_campo TEXT,
  p_document_kind TEXT,
  p_label TEXT,
  p_has_old BOOLEAN,
  p_has_new BOOLEAN,
  p_source TEXT
)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'tipo', COALESCE(NULLIF(btrim(p_tipo), ''), 'campo_actualizado'),
    'campo', NULLIF(btrim(p_campo), ''),
    'document_kind', NULLIF(btrim(p_document_kind), ''),
    'label', public.mesa_asesor_cambio_normalize_label(
      p_label, p_tipo, p_campo, p_document_kind
    ),
    'has_old', COALESCE(p_has_old, false),
    'has_new', COALESCE(p_has_new, false),
    'source', COALESCE(NULLIF(btrim(p_source), ''), 'P130')
  );
$$;

COMMENT ON FUNCTION public.mesa_asesor_cambio_preview_item(TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT) IS
  'P194: elemento seguro de preview_changes (sin valores).';

REVOKE ALL ON FUNCTION public.mesa_asesor_cambio_preview_item(TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mesa_asesor_cambio_preview_item(TEXT, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.mesa_asesor_cambio_payload_sin_diff(
  p_payload JSONB,
  p_prior JSONB
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(p_payload->>'rfc_anterior', '') IS NOT DISTINCT FROM COALESCE(p_payload->>'rfc_nuevo', '')
    AND COALESCE(p_payload->>'telefono_anterior', '') IS NOT DISTINCT FROM COALESCE(p_payload->>'telefono_nuevo', '')
    AND COALESCE(p_payload->>'cliente_nombre_anterior', '') IS NOT DISTINCT FROM COALESCE(p_payload->>'cliente_nombre_nuevo', '')
    AND COALESCE(p_payload->>'estado_anterior', '') IS NOT DISTINCT FROM COALESCE(p_payload->>'estado_nuevo', '')
    AND COALESCE(p_payload->>'direccion_opcional', '') IS NOT DISTINCT FROM COALESCE(p_prior->>'direccion_opcional', p_payload->>'direccion_opcional', '')
    AND COALESCE((p_payload->>'referencias_count')::int, 0) IS NOT DISTINCT FROM COALESCE((p_prior->>'referencias_count')::int, (p_payload->>'referencias_count')::int, 0)
    AND COALESCE((p_payload->>'imagenes_count')::int, 0) IS NOT DISTINCT FROM COALESCE((p_prior->>'imagenes_count')::int, (p_payload->>'imagenes_count')::int, 0);
$$;

COMMENT ON FUNCTION public.mesa_asesor_cambio_payload_sin_diff(JSONB, JSONB) IS
  'P194: comparación conservadora de campos registrados en action_log cliente_datos.';

REVOKE ALL ON FUNCTION public.mesa_asesor_cambio_payload_sin_diff(JSONB, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mesa_asesor_cambio_payload_sin_diff(JSONB, JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.mesa_asesor_cambio_recover_empty_lote(
  p_expediente_id UUID,
  p_asesor_id UUID,
  p_submitted_at TIMESTAMPTZ,
  p_organization_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_win_start TIMESTAMPTZ;
  v_win_end TIMESTAMPTZ;
  v_doc RECORD;
  v_save RECORD;
  v_prior JSONB;
  v_label TEXT;
  v_preview JSONB;
  v_recovered JSONB;
BEGIN
  IF p_expediente_id IS NULL OR p_asesor_id IS NULL OR p_submitted_at IS NULL THEN
    RETURN NULL;
  END IF;

  v_win_start := p_submitted_at - interval '60 seconds';
  v_win_end := p_submitted_at + interval '10 seconds';

  SELECT
    al.id AS action_id,
    al.created_at AS action_at,
    al.entity_id AS documento_nuevo_id,
    d_new.tipo_documento AS document_kind,
    d_new.version AS version_nueva,
    d_old.id AS documento_anterior_id
  INTO v_doc
  FROM public.action_log al
  INNER JOIN public.expediente_documentos d_new ON d_new.id = al.entity_id
  INNER JOIN public.expediente_documentos d_old
    ON d_old.expediente_id = p_expediente_id
   AND d_old.tipo_documento = d_new.tipo_documento
   AND d_old.deleted_at IS NOT NULL
   AND d_old.version = d_new.version - 1
  WHERE al.organization_id IS NOT DISTINCT FROM p_organization_id
    AND al.action = 'expediente.documento.register'
    AND al.actor_id = p_asesor_id
    AND al.created_at >= v_win_start
    AND al.created_at <= v_win_end
    AND COALESCE(al.payload->>'expediente_id', '')::uuid = p_expediente_id
    AND public.mesa_asesor_cambio_payload_es_reemplazo(al.payload)
    AND d_new.expediente_id = p_expediente_id
    AND d_new.deleted_at IS NULL
  ORDER BY abs(extract(epoch FROM (al.created_at - p_submitted_at))) ASC, al.created_at DESC
  LIMIT 1;

  IF FOUND THEN
    v_label := public.mesa_asesor_cambio_doc_kind_label(v_doc.document_kind, 'documento_reemplazado');
    v_preview := jsonb_build_array(
      public.mesa_asesor_cambio_preview_item(
        'documento_reemplazado',
        NULL,
        v_doc.document_kind,
        v_label,
        true,
        true,
        'HISTORY_RECOVERED'
      )
    );
    v_recovered := jsonb_build_array(
      jsonb_build_object(
        'id', v_doc.documento_nuevo_id,
        'change_key', 'history:doc:' || v_doc.document_kind,
        'tipo', 'documento_reemplazado',
        'entidad', 'documento',
        'campo', NULL,
        'document_kind', v_doc.document_kind,
        'label', v_label,
        'valor_anterior', NULL,
        'valor_nuevo', NULL,
        'documento_anterior_id', v_doc.documento_anterior_id,
        'documento_nuevo_id', v_doc.documento_nuevo_id,
        'created_at', v_doc.action_at,
        'source', 'HISTORY_RECOVERED'
      )
    );
    RETURN jsonb_build_object(
      'history_confidence', 'EXACT',
      'history_source', 'HISTORY_RECOVERED',
      'history_note', 'Detalle recuperado del historial',
      'preview_changes', v_preview,
      'recovered_changes', v_recovered
    );
  END IF;

  SELECT al.created_at, al.payload
  INTO v_save
  FROM public.action_log al
  WHERE al.entity_id = p_expediente_id
    AND al.actor_id = p_asesor_id
    AND al.action IN ('cliente_datos.actualizado_post_mesa', 'cliente_datos.correccion_post_mesa')
    AND al.created_at >= v_win_start
    AND al.created_at <= v_win_end
  ORDER BY abs(extract(epoch FROM (al.created_at - p_submitted_at))) ASC, al.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT al.payload
  INTO v_prior
  FROM public.action_log al
  WHERE al.entity_id = p_expediente_id
    AND al.action IN (
      'cliente_datos.save',
      'cliente_datos.actualizado_post_mesa',
      'cliente_datos.correccion_post_mesa'
    )
    AND al.created_at < v_save.created_at
    AND al.created_at >= v_save.created_at - interval '2 hours'
  ORDER BY al.created_at DESC
  LIMIT 1;

  IF public.mesa_asesor_cambio_payload_sin_diff(v_save.payload, v_prior) THEN
    RETURN jsonb_build_object(
      'history_confidence', 'NO_DIFF',
      'history_source', 'HISTORY_NO_DIFF',
      'history_note', 'Guardado del asesor sin cambio verificable',
      'preview_changes', '[]'::jsonb,
      'recovered_changes', '[]'::jsonb
    );
  END IF;

  v_preview := jsonb_build_array(
    public.mesa_asesor_cambio_preview_item(
      'campo_actualizado',
      NULL,
      NULL,
      'Revisión histórica de Datos Generales',
      false,
      false,
      'HISTORY_PARTIAL'
    )
  );

  RETURN jsonb_build_object(
    'history_confidence', 'PARTIAL',
    'history_source', 'HISTORY_PARTIAL',
    'history_note', 'Se registró un guardado de Datos Generales del asesor. El seguimiento histórico de esa fecha no conserva el campo exacto modificado.',
    'preview_changes', v_preview,
    'recovered_changes', '[]'::jsonb
  );
END;
$$;

COMMENT ON FUNCTION public.mesa_asesor_cambio_recover_empty_lote(UUID, UUID, TIMESTAMPTZ, UUID) IS
  'P194: reconstrucción read-time para lotes vacíos (ventana -60s/+10s).';

REVOKE ALL ON FUNCTION public.mesa_asesor_cambio_recover_empty_lote(UUID, UUID, TIMESTAMPTZ, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mesa_asesor_cambio_recover_empty_lote(UUID, UUID, TIMESTAMPTZ, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.mesa_list_asesor_cambios_summary(
  p_expediente_ids UUID[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID;
  v_role public.app_role;
  v_items JSONB := '[]'::JSONB;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'mesa_list_asesor_cambios_summary: no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role INTO v_role
  FROM public.profiles p
  WHERE p.id = v_actor_id AND p.active = true;

  IF v_role IS NULL OR v_role NOT IN (
    'mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin'
  ) THEN
    RAISE EXCEPTION 'mesa_list_asesor_cambios_summary: rol no autorizado'
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_ids IS NULL OR cardinality(p_expediente_ids) = 0 THEN
    RETURN jsonb_build_object('ok', true, 'items', '[]'::JSONB);
  END IF;

  WITH wanted AS (
    SELECT DISTINCT x AS expediente_id
    FROM unnest(p_expediente_ids) AS x
    WHERE x IS NOT NULL
      AND public.can_see_expediente(x)
  ),
  ranked AS (
    SELECT
      l.id AS batch_id,
      l.expediente_id,
      l.asesor_id,
      l.organization_id,
      l.status,
      l.submitted_at,
      ROW_NUMBER() OVER (
        PARTITION BY l.expediente_id
        ORDER BY
          CASE WHEN l.status = 'pendiente_revision' THEN 0 ELSE 1 END,
          l.submitted_at DESC NULLS LAST,
          l.created_at DESC
      ) AS rn
    FROM public.expediente_asesor_cambio_lotes l
    INNER JOIN wanted w ON w.expediente_id = l.expediente_id
    WHERE l.status IN ('pendiente_revision', 'revisado')
  ),
  picked AS (
    SELECT * FROM ranked WHERE rn = 1
  ),
  counts AS (
    SELECT c.lote_id, COUNT(*)::INTEGER AS changes_count
    FROM public.expediente_asesor_cambios c
    INNER JOIN picked p ON p.batch_id = c.lote_id
    GROUP BY c.lote_id
  ),
  previews AS (
    SELECT
      p.batch_id,
      COALESCE(
        (
          SELECT jsonb_agg(
            public.mesa_asesor_cambio_preview_item(
              c.tipo::TEXT,
              c.campo,
              c.document_kind,
              c.label,
              c.valor_anterior IS NOT NULL,
              c.valor_nuevo IS NOT NULL,
              'P130'
            )
            ORDER BY c.created_at ASC, c.id ASC
          )
          FROM (
            SELECT c.*
            FROM public.expediente_asesor_cambios c
            WHERE c.lote_id = p.batch_id
            ORDER BY c.created_at ASC, c.id ASC
            LIMIT 3
          ) c
        ),
        '[]'::JSONB
      ) AS preview_changes
    FROM picked p
    INNER JOIN counts ct ON ct.lote_id = p.batch_id
    WHERE ct.changes_count > 0
  ),
  summaries AS (
    SELECT
      p.batch_id,
      COALESCE(pr.preview_changes, '[]'::JSONB) AS preview_changes,
      COALESCE(
        (
          SELECT jsonb_agg(t.label ORDER BY t.ord)
          FROM (
            SELECT
              elem->>'label' AS label,
              row_number() OVER () AS ord
            FROM jsonb_array_elements(COALESCE(pr.preview_changes, '[]'::jsonb)) elem
            LIMIT 3
          ) t
          WHERE t.label IS NOT NULL AND btrim(t.label) <> ''
        ),
        '[]'::JSONB
      ) AS summary
    FROM picked p
    LEFT JOIN previews pr ON pr.batch_id = p.batch_id
  ),
  recovered AS (
    SELECT
      p.batch_id,
      rec.payload->>'history_confidence' AS history_confidence,
      rec.payload->>'history_source' AS history_source,
      rec.payload->>'history_note' AS history_note,
      rec.payload->'preview_changes' AS preview_changes
    FROM picked p
    LEFT JOIN counts ct ON ct.lote_id = p.batch_id
    CROSS JOIN LATERAL (
      SELECT public.mesa_asesor_cambio_recover_empty_lote(
        p.expediente_id,
        p.asesor_id,
        p.submitted_at,
        p.organization_id
      ) AS payload
      WHERE COALESCE(ct.changes_count, 0) = 0
    ) rec
    WHERE COALESCE(ct.changes_count, 0) = 0
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'expediente_id', p.expediente_id,
        'batch_id', p.batch_id,
        'status', p.status::TEXT,
        'submitted_at', p.submitted_at,
        'changes_count', COALESCE(ct.changes_count, 0),
        'summary', CASE
          WHEN COALESCE(ct.changes_count, 0) > 0 THEN COALESCE(s.summary, '[]'::JSONB)
          WHEN rec.history_confidence = 'EXACT' THEN COALESCE(
            (
              SELECT jsonb_agg(elem->>'label')
              FROM jsonb_array_elements(COALESCE(rec.preview_changes, '[]'::jsonb)) elem
            ),
            '[]'::JSONB
          )
          ELSE '[]'::JSONB
        END,
        'preview_changes', CASE
          WHEN COALESCE(ct.changes_count, 0) > 0 THEN COALESCE(s.preview_changes, '[]'::JSONB)
          ELSE COALESCE(rec.preview_changes, '[]'::JSONB)
        END,
        'history_confidence', rec.history_confidence,
        'history_source', rec.history_source,
        'history_note', rec.history_note
      )
      ORDER BY p.expediente_id
    ),
    '[]'::JSONB
  )
  INTO v_items
  FROM picked p
  LEFT JOIN counts ct ON ct.lote_id = p.batch_id
  LEFT JOIN summaries s ON s.batch_id = p.batch_id
  LEFT JOIN recovered rec ON rec.batch_id = p.batch_id;

  RETURN jsonb_build_object('ok', true, 'items', COALESCE(v_items, '[]'::JSONB));
END;
$$;

COMMENT ON FUNCTION public.mesa_list_asesor_cambios_summary(UUID[]) IS
  'P194: resumen batch con preview_changes (máx 3, sin valores) y recover read-time si count=0.';

REVOKE ALL ON FUNCTION public.mesa_list_asesor_cambios_summary(UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mesa_list_asesor_cambios_summary(UUID[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.mesa_get_asesor_cambio_lote(
  p_expediente_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID;
  v_role public.app_role;
  v_lote public.expediente_asesor_cambio_lotes%ROWTYPE;
  v_asesor_nombre TEXT;
  v_changes JSONB;
  v_count INTEGER;
  v_recovered JSONB := '[]'::JSONB;
  v_recovery JSONB;
BEGIN
  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'mesa_get_asesor_cambio_lote: no autenticado'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.app_role INTO v_role
  FROM public.profiles p
  WHERE p.id = v_actor_id AND p.active = true;

  IF v_role IS NULL OR v_role NOT IN (
    'mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin'
  ) THEN
    RAISE EXCEPTION 'mesa_get_asesor_cambio_lote: rol no autorizado'
      USING ERRCODE = '42501';
  END IF;

  IF p_expediente_id IS NULL THEN
    RAISE EXCEPTION 'mesa_get_asesor_cambio_lote: expediente_id obligatorio'
      USING ERRCODE = '22023';
  END IF;

  IF NOT public.can_see_expediente(p_expediente_id) THEN
    RAISE EXCEPTION 'mesa_get_asesor_cambio_lote: no autorizado'
      USING ERRCODE = '42501';
  END IF;

  SELECT l.*
  INTO v_lote
  FROM public.expediente_asesor_cambio_lotes l
  WHERE l.expediente_id = p_expediente_id
    AND l.status = 'pendiente_revision'
  ORDER BY l.submitted_at DESC NULLS LAST, l.created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    SELECT l.*
    INTO v_lote
    FROM public.expediente_asesor_cambio_lotes l
    WHERE l.expediente_id = p_expediente_id
      AND l.status = 'revisado'
    ORDER BY l.reviewed_at DESC NULLS LAST, l.submitted_at DESC NULLS LAST, l.created_at DESC
    LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', true,
      'lote', NULL,
      'changes', '[]'::JSONB,
      'recovered_changes', '[]'::JSONB,
      'history_confidence', NULL,
      'history_source', NULL,
      'history_note', NULL
    );
  END IF;

  SELECT NULLIF(btrim(pr.full_name), '')
  INTO v_asesor_nombre
  FROM public.profiles pr
  WHERE pr.id = v_lote.asesor_id;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'change_key', c.change_key,
        'tipo', c.tipo::TEXT,
        'entidad', c.entidad,
        'campo', c.campo,
        'document_kind', c.document_kind,
        'label', public.mesa_asesor_cambio_normalize_label(
          c.label, c.tipo::TEXT, c.campo, c.document_kind
        ),
        'valor_anterior', c.valor_anterior,
        'valor_nuevo', c.valor_nuevo,
        'documento_anterior_id', c.documento_anterior_id,
        'documento_nuevo_id', c.documento_nuevo_id,
        'created_at', c.created_at,
        'source', 'P130'
      )
      ORDER BY c.created_at ASC, c.id ASC
    ),
    '[]'::JSONB
  ),
  COUNT(*)::INTEGER
  INTO v_changes, v_count
  FROM public.expediente_asesor_cambios c
  WHERE c.lote_id = v_lote.id;

  v_recovery := NULL;
  IF COALESCE(v_count, 0) = 0 THEN
    v_recovery := public.mesa_asesor_cambio_recover_empty_lote(
      v_lote.expediente_id,
      v_lote.asesor_id,
      v_lote.submitted_at,
      v_lote.organization_id
    );
    IF v_recovery IS NOT NULL THEN
      v_recovered := COALESCE(v_recovery->'recovered_changes', '[]'::JSONB);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'lote', jsonb_build_object(
      'id', v_lote.id,
      'status', v_lote.status::TEXT,
      'submitted_at', v_lote.submitted_at,
      'reviewed_at', v_lote.reviewed_at,
      'asesor_nombre', v_asesor_nombre,
      'changes_count', COALESCE(v_count, 0)
    ),
    'changes', COALESCE(v_changes, '[]'::JSONB),
    'recovered_changes', COALESCE(v_recovered, '[]'::JSONB),
    'history_confidence', v_recovery->>'history_confidence',
    'history_source', v_recovery->>'history_source',
    'history_note', v_recovery->>'history_note'
  );
END;
$$;

COMMENT ON FUNCTION public.mesa_get_asesor_cambio_lote(UUID) IS
  'P194: detalle lote P130 + recovered_changes read-time + metadata histórica.';

REVOKE ALL ON FUNCTION public.mesa_get_asesor_cambio_lote(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mesa_get_asesor_cambio_lote(UUID) TO authenticated;
