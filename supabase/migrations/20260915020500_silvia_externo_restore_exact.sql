-- ConCasa CRM — Equipo Silvia: restauración exacta del contrato externo previo.
--
-- La política genérica `asesor_paquete_documental_externos` ya no clasifica por sí
-- sola a todos los miembros de Silvia en el estado actual. Por eso este parche
-- hace explícito el scope de Equipo Silvia antes del fallback genérico.
--
-- Rollout OFF (estado inicial):
--   obligatorios = INE frente + comprobante + estado cuenta + CURP +
--                  solicitud crédito + lista nominal + bajo protesta + presupuesto.
--   upload extra opcional = acta digital + constancia SAT + semanas + vigencia.
-- Rollout ON: conserva el paquete nuevo preparado en PR #305.
--
-- No modifica reasignación, agenda, cupos, expedientes, documentos ni históricos.

CREATE OR REPLACE FUNCTION public.integration_doc_tipos_asesor_envio_para(
  p_asesor_id uuid
)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.asesor_es_anette_externa(p_asesor_id) THEN
    RETURN ARRAY[
      'cliente_ine_frente',
      'cliente_comprobante_domicilio',
      'cliente_estado_cuenta',
      'cliente_constancia_curp',
      'cliente_solicitud_credito',
      'cliente_lista_nominal',
      'cliente_bajo_protesta'
    ]::text[];
  END IF;

  IF public.asesor_es_equipo_silvia(p_asesor_id) THEN
    IF public.asesor_equipo_silvia_paquete_nuevo_habilitado() THEN
      RETURN ARRAY[
        'cliente_ine_frente',
        'cliente_ine_reverso',
        'cliente_comprobante_domicilio',
        'cliente_acta_nacimiento_digital',
        'cliente_semanas_cotizadas'
      ]::text[];
    END IF;

    RETURN ARRAY[
      'cliente_ine_frente',
      'cliente_comprobante_domicilio',
      'cliente_estado_cuenta',
      'cliente_constancia_curp',
      'cliente_solicitud_credito',
      'cliente_lista_nominal',
      'cliente_bajo_protesta',
      'cliente_presupuesto'
    ]::text[];
  END IF;

  IF public.asesor_paquete_documental_externos(p_asesor_id) THEN
    RETURN ARRAY[
      'cliente_ine_frente',
      'cliente_comprobante_domicilio',
      'cliente_estado_cuenta',
      'cliente_constancia_curp',
      'cliente_solicitud_credito',
      'cliente_lista_nominal',
      'cliente_bajo_protesta',
      'cliente_presupuesto'
    ]::text[];
  END IF;

  RETURN public.integration_doc_tipos_asesor_envio();
END;
$$;

COMMENT ON FUNCTION public.integration_doc_tipos_asesor_envio_para(uuid) IS
  'Anette=7; Equipo Silvia rollout OFF=8 externos históricos; rollout ON=paquete nuevo; otros conservan su clasificación previa.';

CREATE OR REPLACE FUNCTION public.integration_doc_tipos_asesor_upload_para(
  p_asesor_id uuid
)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_envio text[];
BEGIN
  IF public.asesor_es_anette_externa(p_asesor_id) THEN
    v_envio := public.integration_doc_tipos_asesor_envio_para(p_asesor_id);
    RETURN v_envio || ARRAY[
      'cliente_presupuesto',
      'cliente_acta_nacimiento_digital',
      'cliente_constancia_situacion_fiscal',
      'cliente_semanas_cotizadas',
      'cliente_vigencia_derechos'
    ]::text[];
  END IF;

  IF public.asesor_es_equipo_silvia(p_asesor_id) THEN
    IF public.asesor_equipo_silvia_paquete_nuevo_habilitado() THEN
      RETURN ARRAY[
        'cliente_ine_frente',
        'cliente_ine_reverso',
        'cliente_comprobante_domicilio',
        'cliente_acta_nacimiento_digital',
        'cliente_semanas_cotizadas',
        'cliente_vigencia_derechos',
        'cliente_estado_cuenta',
        'cliente_constancia_curp',
        'cliente_constancia_situacion_fiscal'
      ]::text[];
    END IF;

    RETURN ARRAY[
      'cliente_ine_frente',
      'cliente_comprobante_domicilio',
      'cliente_estado_cuenta',
      'cliente_constancia_curp',
      'cliente_solicitud_credito',
      'cliente_lista_nominal',
      'cliente_bajo_protesta',
      'cliente_presupuesto',
      'cliente_acta_nacimiento_digital',
      'cliente_constancia_situacion_fiscal',
      'cliente_semanas_cotizadas',
      'cliente_vigencia_derechos'
    ]::text[];
  END IF;

  IF public.asesor_paquete_documental_externos(p_asesor_id) THEN
    v_envio := public.integration_doc_tipos_asesor_envio_para(p_asesor_id);
    RETURN v_envio || ARRAY[
      'cliente_acta_nacimiento_digital',
      'cliente_constancia_situacion_fiscal',
      'cliente_semanas_cotizadas',
      'cliente_vigencia_derechos'
    ]::text[];
  END IF;

  RETURN public.integration_doc_tipos_asesor_upload();
END;
$$;

COMMENT ON FUNCTION public.integration_doc_tipos_asesor_upload_para(uuid) IS
  'Equipo Silvia rollout OFF recupera allowlist externa histórica exacta; rollout ON conserva paquete nuevo preparado.';

REVOKE ALL ON FUNCTION public.integration_doc_tipos_asesor_envio_para(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.integration_doc_tipos_asesor_upload_para(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.integration_doc_tipos_asesor_envio_para(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.integration_doc_tipos_asesor_upload_para(uuid) TO authenticated, service_role;
