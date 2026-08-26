CREATE OR REPLACE FUNCTION public.repair_retencion_enviada_a_etapa_9(p_expediente_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_moved int := 0;
  r RECORD;
BEGIN
  FOR r IN
    SELECT e.id, e.organization_id
    FROM public.expedientes e
    WHERE e.deleted_at IS NULL
      AND e.etapa_actual = 8
      AND (p_expediente_id IS NULL OR e.id = p_expediente_id)
      AND public.expediente_has_retencion_enviada_valida(e.id)
    FOR UPDATE OF e
  LOOP
    UPDATE public.expedientes
    SET
      etapa_actual = 9,
      subestado = 'en_proceso',
      updated_at = NOW()
    WHERE id = r.id
      AND etapa_actual = 8;

    IF FOUND THEN
      v_moved := v_moved + 1;
      PERFORM public.log_action(
        r.organization_id,
        NULL,
        NULL,
        'expediente.retencion_repair_etapa_9',
        'expediente',
        r.id,
        jsonb_build_object(
          'etapa_anterior', 8,
          'etapa_nueva', 9,
          'razon_tecnica', 'acuse_enviado_etapa_8_inconsistente',
          'version', '145'
        )
      );
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'moved', v_moved);
END;
$function$

