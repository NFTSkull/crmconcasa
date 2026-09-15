-- ConCasa CRM — Equipo Silvia: Estado de cuenta + CLABE obligatorios.
-- Alcance: líder Silvia Reyes + miembros activos del equipo, solo con rollout nuevo ON.
-- Sin backfill / UPDATE / DELETE de expedientes ni cliente_datos.

-- 1) Estado de cuenta pasa a formar parte del set documental de envío.
CREATE OR REPLACE FUNCTION public.integration_doc_tipos_asesor_envio_para(p_asesor_id uuid)
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

  IF public.asesor_es_equipo_silvia(p_asesor_id)
     AND public.asesor_equipo_silvia_paquete_nuevo_habilitado() THEN
    RETURN ARRAY[
      'cliente_ine_frente',
      'cliente_ine_reverso',
      'cliente_comprobante_domicilio',
      'cliente_estado_cuenta',
      'cliente_acta_nacimiento_digital',
      'cliente_semanas_o_vigencia_derechos'
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

REVOKE ALL ON FUNCTION public.integration_doc_tipos_asesor_envio_para(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.integration_doc_tipos_asesor_envio_para(uuid) TO authenticated;

COMMENT ON FUNCTION public.integration_doc_tipos_asesor_envio_para(uuid) IS
  'Docs obligatorios por dueño. Equipo Silvia con rollout ON exige 6: INE frente/reverso, domicilio, estado de cuenta, acta y semanas-o-vigencia.';

-- 2) Helper único de CLABE: solo aplica a Silvia + equipo activo con rollout ON.
CREATE OR REPLACE FUNCTION public.asesor_equipo_silvia_clabe_valida_para_expediente(
  p_expediente_id uuid,
  p_datos jsonb DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
  v_datos jsonb;
  v_clabe text;
BEGIN
  IF p_expediente_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT e.asesor_id
  INTO v_owner
  FROM public.expedientes e
  WHERE e.id = p_expediente_id
    AND e.deleted_at IS NULL;

  IF v_owner IS NULL THEN
    RETURN false;
  END IF;

  IF NOT (
    public.asesor_es_equipo_silvia(v_owner)
    AND public.asesor_equipo_silvia_paquete_nuevo_habilitado()
  ) THEN
    RETURN true;
  END IF;

  IF p_datos IS NOT NULL THEN
    v_datos := p_datos;
  ELSE
    SELECT cd.datos INTO v_datos
    FROM public.cliente_datos cd
    WHERE cd.expediente_id = p_expediente_id;
  END IF;

  v_clabe := regexp_replace(coalesce(v_datos->>'clabe', ''), '[^0-9]', '', 'g');
  RETURN v_clabe ~ '^[0-9]{18}$';
END;
$$;

REVOKE ALL ON FUNCTION public.asesor_equipo_silvia_clabe_valida_para_expediente(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asesor_equipo_silvia_clabe_valida_para_expediente(uuid, jsonb) TO authenticated;

COMMENT ON FUNCTION public.asesor_equipo_silvia_clabe_valida_para_expediente(uuid, jsonb) IS
  'True si CLABE no aplica o si Equipo Silvia rollout ON tiene CLABE de exactamente 18 dígitos.';

-- 3) Un registro pre-Mesa de Silvia/equipo no puede quedar marcado completo sin CLABE.
CREATE OR REPLACE FUNCTION public.trg_cliente_datos_silvia_clabe_obligatoria()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_submitted boolean;
BEGIN
  IF NEW.estado IS DISTINCT FROM 'completo'::public.cliente_datos_estado THEN
    RETURN NEW;
  END IF;

  SELECT coalesce(e.submitted_to_mesa, false)
  INTO v_submitted
  FROM public.expedientes e
  WHERE e.id = NEW.expediente_id;

  -- No altera correcciones/validaciones post-Mesa históricas.
  IF coalesce(v_submitted, false) THEN
    RETURN NEW;
  END IF;

  IF NOT public.asesor_equipo_silvia_clabe_valida_para_expediente(
    NEW.expediente_id,
    NEW.datos
  ) THEN
    RAISE EXCEPTION 'CLABE_OBLIGATORIA: La CLABE bancaria de 18 dígitos es obligatoria para Silvia Reyes y su equipo.'
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cliente_datos_silvia_clabe_obligatoria ON public.cliente_datos;
CREATE TRIGGER trg_cliente_datos_silvia_clabe_obligatoria
BEFORE INSERT OR UPDATE OF datos, estado
ON public.cliente_datos
FOR EACH ROW
EXECUTE FUNCTION public.trg_cliente_datos_silvia_clabe_obligatoria();

-- 4) Defensa final: ningún camino puede cambiar submitted_to_mesa false→true sin CLABE.
CREATE OR REPLACE FUNCTION public.trg_expediente_silvia_clabe_antes_envio_mesa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.submitted_to_mesa IS TRUE
     AND coalesce(OLD.submitted_to_mesa, false) IS FALSE
     AND public.asesor_es_equipo_silvia(NEW.asesor_id)
     AND public.asesor_equipo_silvia_paquete_nuevo_habilitado()
     AND NOT public.asesor_equipo_silvia_clabe_valida_para_expediente(NEW.id, NULL) THEN
    RAISE EXCEPTION 'CLABE_OBLIGATORIA: Captura una CLABE bancaria válida de 18 dígitos antes de enviar a Mesa.'
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_expediente_silvia_clabe_antes_envio_mesa ON public.expedientes;
CREATE TRIGGER trg_expediente_silvia_clabe_antes_envio_mesa
BEFORE UPDATE OF submitted_to_mesa
ON public.expedientes
FOR EACH ROW
EXECUTE FUNCTION public.trg_expediente_silvia_clabe_antes_envio_mesa();

COMMENT ON FUNCTION public.trg_cliente_datos_silvia_clabe_obligatoria() IS
  'Equipo Silvia rollout ON: pre-Mesa estado completo exige CLABE 18 dígitos; no backfill.';
COMMENT ON FUNCTION public.trg_expediente_silvia_clabe_antes_envio_mesa() IS
  'Defensa final: Silvia/equipo no puede enviar a Mesa sin CLABE 18 dígitos.';
