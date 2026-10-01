-- Alinea Storage RLS con la regla de UI/RPC para Acuse anticipado desde cita biométrica.

CREATE OR REPLACE FUNCTION public.expediente_documento_storage_asesor_retencion_upload_allowed(
  p_object_name TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_parsed RECORD;
  v_actor_id UUID;
  v_actor_role public.app_role;
  v_actor_org UUID;
  v_exp RECORD;
  v_principal BOOLEAN;
BEGIN
  SELECT *
  INTO v_parsed
  FROM public.parse_expediente_documento_storage_path(p_object_name);

  IF v_parsed.organization_id IS NULL
     OR v_parsed.expediente_id IS NULL
     OR v_parsed.tipo_documento IS NULL THEN
    RETURN false;
  END IF;

  IF NOT (v_parsed.tipo_documento = ANY(public.retencion_doc_tipos_asesor_upload())) THEN
    RETURN false;
  END IF;

  v_actor_id := public.current_profile_id();
  IF v_actor_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT p.app_role, p.organization_id
  INTO v_actor_role, v_actor_org
  FROM public.profiles p
  WHERE p.id = v_actor_id
    AND p.active = true;

  IF NOT FOUND OR v_actor_role <> 'asesor' THEN
    RETURN false;
  END IF;

  IF v_actor_org IS DISTINCT FROM v_parsed.organization_id THEN
    RETURN false;
  END IF;

  SELECT
    e.id,
    e.organization_id,
    e.asesor_id,
    e.ciclo_estado,
    e.submitted_to_mesa,
    e.etapa_actual,
    e.subestado,
    e.deleted_at
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = v_parsed.expediente_id
    AND e.organization_id = v_parsed.organization_id;

  IF NOT FOUND OR v_exp.deleted_at IS NOT NULL THEN
    RETURN false;
  END IF;

  IF NOT public.asesor_can_operate_expediente_as(v_actor_id, v_exp.id) THEN
    RETURN false;
  END IF;

  IF v_exp.ciclo_estado <> 'activo' THEN
    RETURN false;
  END IF;

  IF v_exp.submitted_to_mesa IS NOT TRUE THEN
    RETURN false;
  END IF;

  IF v_exp.subestado <> 'en_proceso' THEN
    RETURN false;
  END IF;

  v_principal := v_parsed.tipo_documento IN (
    'retencion_acuse_con_sello',
    'retencion_carta_sin_sello'
  );

  IF v_principal THEN
    RETURN public.expediente_acuse_habilitado_desde_biometricos(
      v_exp.id,
      v_exp.etapa_actual
    );
  END IF;

  RETURN v_exp.etapa_actual = 8;
END;
$function$;

COMMENT ON FUNCTION public.expediente_documento_storage_asesor_retencion_upload_allowed(TEXT) IS
  'Storage RLS retención asesor: principal Acuse/Carta usa la misma habilitación desde cita biométrica que UI/RPC; secundarios solo etapa 8.';
