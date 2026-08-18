-- ConCasa CRM — hotfix: correcciones enviadas P130 visibles en Mesa/Asesor.
-- Cloud max conocido = 191. 192 reservado para ESTE hotfix (Operación de citas → 193).
-- Solo read-model / helpers. Sin tablas, columnas, backfill ni UPDATE de lotes/expedientes.
-- Predicado canónico HAS_PENDING_ADVISOR_CHANGES:
--   EXISTS expediente_asesor_cambio_lotes
--     WHERE expediente_id = X
--       AND status = 'pendiente_revision'
--       AND submitted_at IS NOT NULL
-- Sin gate de etapa. Sin depender de tipo de documento / resubido / fecha_envio_mesa.

CREATE OR REPLACE FUNCTION public.expediente_tiene_correccion_asesor_pendiente(
  p_expediente_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.expediente_asesor_cambio_lotes l
    WHERE l.expediente_id = p_expediente_id
      AND l.status = 'pendiente_revision'
      AND l.submitted_at IS NOT NULL
  );
$$;

COMMENT ON FUNCTION public.expediente_tiene_correccion_asesor_pendiente(UUID) IS
  'Hotfix 192: lote P130 pendiente_revision con submitted_at. Sin PII. Sin gate de etapa.';

REVOKE ALL ON FUNCTION public.expediente_tiene_correccion_asesor_pendiente(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.expediente_tiene_correccion_asesor_pendiente(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.expediente_tiene_correccion_asesor_pendiente(UUID) TO authenticated;

-- P130 pending precede a correccion_requerida / faltantes / documental.
-- Legacy P102 (docs legado + DG timestamp) se conserva si NO hay lote pendiente.
CREATE OR REPLACE FUNCTION public.mesa_bandeja_categoria_resumen(
  p_expediente_id UUID,
  p_fecha_envio_mesa TIMESTAMPTZ
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_cd_estado TEXT;
  v_cd_updated TIMESTAMPTZ;
  v_cd_validated TIMESTAMPTZ;
  v_ine TEXT;
  v_ec TEXT;
  v_nss TEXT;
  v_dir TEXT;
  v_doc TEXT;
BEGIN
  IF public.expediente_tiene_correccion_asesor_pendiente(p_expediente_id) THEN
    RETURN 'correccion_enviada';
  END IF;

  SELECT cd.estado::text, cd.updated_at, cd.validated_at
  INTO v_cd_estado, v_cd_updated, v_cd_validated
  FROM public.cliente_datos cd
  WHERE cd.expediente_id = p_expediente_id
  LIMIT 1;

  IF v_cd_estado = 'rechazado' THEN
    RETURN 'correccion_requerida';
  END IF;

  v_ine := public.mesa_bandeja_doc_estatus(p_expediente_id, 'ine');
  v_ec := public.mesa_bandeja_doc_estatus(p_expediente_id, 'estado_cuenta');
  v_nss := public.mesa_bandeja_doc_estatus(p_expediente_id, 'nss');
  v_dir := public.mesa_bandeja_doc_estatus(p_expediente_id, 'direccion');

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

  IF v_doc IN ('correccion_requerida', 'correccion_enviada') THEN
    RETURN v_doc;
  END IF;

  IF v_cd_estado = 'completo'
     AND v_cd_validated IS NULL
     AND v_cd_updated IS NOT NULL
     AND p_fecha_envio_mesa IS NOT NULL
     AND v_cd_updated > p_fecha_envio_mesa THEN
    RETURN 'correccion_enviada';
  END IF;

  RETURN v_doc;
END;
$$;

COMMENT ON FUNCTION public.mesa_bandeja_categoria_resumen(UUID, TIMESTAMPTZ) IS
  'P102 + hotfix 192: P130 pendiente_revision precede a legacy documental/DG. Lista/counts heredan.';

-- Con lote P130 pendiente: sort por latest submitted_at.
-- Sin lote pendiente: misma actividad legacy (resubido / DG timestamp) + fallback envío/alta.
CREATE OR REPLACE FUNCTION public.mesa_bandeja_sort_ts(
  p_expediente_id UUID,
  p_fecha_envio_mesa TIMESTAMPTZ,
  p_created_at TIMESTAMPTZ
)
RETURNS TIMESTAMPTZ
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT MAX(l.submitted_at)
      FROM public.expediente_asesor_cambio_lotes l
      WHERE l.expediente_id = p_expediente_id
        AND l.status = 'pendiente_revision'
        AND l.submitted_at IS NOT NULL
    ),
    (
      SELECT CASE
        WHEN v_doc IS NULL AND v_cd IS NULL THEN NULL
        WHEN v_doc IS NULL THEN v_cd
        WHEN v_cd IS NULL THEN v_doc
        ELSE GREATEST(v_doc, v_cd)
      END
      FROM (
        SELECT
          (
            SELECT MAX(d.created_at)
            FROM public.expediente_documentos d
            WHERE d.expediente_id = p_expediente_id
              AND d.deleted_at IS NULL
              AND d.estatus_revision::text = 'resubido'
          ) AS v_doc,
          (
            SELECT cd.updated_at
            FROM public.cliente_datos cd
            WHERE cd.expediente_id = p_expediente_id
              AND cd.estado::text = 'completo'
              AND cd.validated_at IS NULL
              AND p_fecha_envio_mesa IS NOT NULL
              AND cd.updated_at > p_fecha_envio_mesa
            LIMIT 1
          ) AS v_cd
      ) s
    ),
    p_fecha_envio_mesa,
    p_created_at
  );
$$;

COMMENT ON FUNCTION public.mesa_bandeja_sort_ts(UUID, TIMESTAMPTZ, TIMESTAMPTZ) IS
  'P102 + hotfix 192: pending P130 submitted_at; si no, actividad legacy / fecha_envio_mesa.';

REVOKE ALL ON FUNCTION public.mesa_bandeja_categoria_resumen(UUID, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mesa_bandeja_sort_ts(UUID, TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mesa_bandeja_categoria_resumen(UUID, TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mesa_bandeja_sort_ts(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO authenticated;

-- Misma señal P130 al inicio; resto P167 intacto (cliente_* / acuse / pack legado).
CREATE OR REPLACE FUNCTION public.asesor_inbox_categoria_correccion(p_expediente_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_cd_estado TEXT;
  v_retencion_estado TEXT;
  v_ine TEXT;
  v_ec TEXT;
  v_nss TEXT;
  v_dir TEXT;
  v_doc TEXT;
  v_has_rechazado BOOLEAN;
  v_has_resubido BOOLEAN;
BEGIN
  IF public.expediente_tiene_correccion_asesor_pendiente(p_expediente_id) THEN
    RETURN 'correccion_enviada';
  END IF;

  SELECT cd.estado::text INTO v_cd_estado
  FROM public.cliente_datos cd
  WHERE cd.expediente_id = p_expediente_id
  LIMIT 1;

  IF v_cd_estado = 'rechazado' THEN
    RETURN 'correccion_requerida';
  END IF;

  SELECT re.estado::text INTO v_retencion_estado
  FROM public.retencion_envios re
  WHERE re.expediente_id = p_expediente_id
  ORDER BY re.updated_at DESC NULLS LAST
  LIMIT 1;

  IF v_retencion_estado = 'correccion_requerida' THEN
    RETURN 'correccion_requerida';
  END IF;

  SELECT
    EXISTS (
      SELECT 1
      FROM (
        SELECT DISTINCT ON (d.tipo_documento)
          d.estatus_revision::text AS estatus
        FROM public.expediente_documentos d
        WHERE d.expediente_id = p_expediente_id
          AND d.deleted_at IS NULL
          AND d.tipo_documento IN (
            'cliente_ine_frente',
            'cliente_ine_reverso',
            'cliente_comprobante_domicilio',
            'cliente_estado_cuenta',
            'cliente_semanas_cotizadas',
            'cliente_acta_nacimiento',
            'cliente_constancia_sat',
            'retencion_acuse_con_sello',
            'retencion_carta_sin_sello',
            'ine',
            'estado_cuenta',
            'nss',
            'direccion'
          )
        ORDER BY d.tipo_documento, d.created_at DESC NULLS LAST, d.id DESC
      ) latest
      WHERE latest.estatus = 'rechazado'
    ),
    EXISTS (
      SELECT 1
      FROM (
        SELECT DISTINCT ON (d.tipo_documento)
          d.estatus_revision::text AS estatus
        FROM public.expediente_documentos d
        WHERE d.expediente_id = p_expediente_id
          AND d.deleted_at IS NULL
          AND d.tipo_documento IN (
            'cliente_ine_frente',
            'cliente_ine_reverso',
            'cliente_comprobante_domicilio',
            'cliente_estado_cuenta',
            'cliente_semanas_cotizadas',
            'cliente_acta_nacimiento',
            'cliente_constancia_sat',
            'retencion_acuse_con_sello',
            'retencion_carta_sin_sello',
            'ine',
            'estado_cuenta',
            'nss',
            'direccion'
          )
        ORDER BY d.tipo_documento, d.created_at DESC NULLS LAST, d.id DESC
      ) latest
      WHERE latest.estatus = 'resubido'
    )
  INTO v_has_rechazado, v_has_resubido;

  IF v_has_rechazado THEN
    RETURN 'correccion_requerida';
  END IF;

  IF v_has_resubido THEN
    RETURN 'correccion_enviada';
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

  RETURN v_doc;
END;
$$;

COMMENT ON FUNCTION public.asesor_inbox_categoria_correccion(UUID) IS
  'P167 + hotfix 192: P130 pendiente_revision → correccion_enviada antes de heurística documental.';
