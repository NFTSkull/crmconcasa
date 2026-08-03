-- ConCasa CRM — Hotfix: restaurar etapa 9 cuando Acuse ya está enviado
-- pero mesa.mover_etapa dejó el expediente en etapa 8 (tarjeta firmas invisible).
--
-- Cohorte Cloud (2026-08-03 RO): 2 expedientes activos.
-- Idempotente. No toca documentos, bookings, Sheets ni biométricos.
-- Incluye casos CON booking firmas activo (deben estar en ≥9).

CREATE OR REPLACE FUNCTION public.expediente_has_retencion_enviada_valida(
  p_expediente_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.expedientes e
    INNER JOIN public.retencion_envios re ON re.expediente_id = e.id
    LEFT JOIN public.retencion_opciones ro ON ro.expediente_id = e.id
    WHERE e.id = p_expediente_id
      AND e.deleted_at IS NULL
      AND e.ciclo_estado = 'activo'
      AND e.submitted_to_mesa = true
      AND e.subestado = 'en_proceso'
      AND re.enviado = true
      AND re.estado = 'enviado'
      AND COALESCE(re.opcion, ro.retencion_opcion) IS NOT NULL
      AND (
        SELECT d.estatus_revision
        FROM public.expediente_documentos d
        WHERE d.expediente_id = e.id
          AND d.deleted_at IS NULL
          AND d.tipo_documento = CASE COALESCE(re.opcion, ro.retencion_opcion)
            WHEN 'con_sello' THEN 'retencion_acuse_con_sello'
            WHEN 'sin_sello' THEN 'retencion_carta_sin_sello'
          END
        ORDER BY d.created_at DESC
        LIMIT 1
      ) IN ('subido', 'resubido', 'validado')
  );
$$;

COMMENT ON FUNCTION public.expediente_has_retencion_enviada_valida(uuid) IS
  'True si expediente activo con Acuse/retención enviada y principal válido (sin filtrar etapa).';

REVOKE ALL ON FUNCTION public.expediente_has_retencion_enviada_valida(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.expediente_has_retencion_enviada_valida(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.expediente_has_retencion_enviada_valida(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.repair_retencion_enviada_a_etapa_9(
  p_expediente_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
$$;

COMMENT ON FUNCTION public.repair_retencion_enviada_a_etapa_9(uuid) IS
  'Repara expedientes etapa 8 con Acuse enviado → etapa 9. Idempotente. p_expediente_id NULL = todos.';

REVOKE ALL ON FUNCTION public.repair_retencion_enviada_a_etapa_9(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.repair_retencion_enviada_a_etapa_9(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.repair_retencion_enviada_a_etapa_9(uuid) TO authenticated;

-- Trigger: si un UPDATE deja etapa_actual=8 y Acuse ya está enviado, forzar 9.
CREATE OR REPLACE FUNCTION public.trg_expedientes_restore_etapa9_si_acuse_enviado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF NEW.etapa_actual IS DISTINCT FROM 8 THEN
    RETURN NEW;
  END IF;

  IF public.expediente_has_retencion_enviada_valida(NEW.id) THEN
    NEW.etapa_actual := 9;
    NEW.subestado := 'en_proceso';
    NEW.updated_at := NOW();
    PERFORM public.log_action(
      NEW.organization_id,
      NULL,
      NULL,
      'expediente.retencion_repair_etapa_9',
      'expediente',
      NEW.id,
      jsonb_build_object(
        'etapa_anterior', 8,
        'etapa_nueva', 9,
        'razon_tecnica', 'trigger_post_mover_con_acuse_enviado',
        'etapa_origen_mover', OLD.etapa_actual,
        'version', '145'
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_expedientes_restore_etapa9_si_acuse_enviado
  ON public.expedientes;

CREATE TRIGGER trg_expedientes_restore_etapa9_si_acuse_enviado
  BEFORE UPDATE OF etapa_actual ON public.expedientes
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_expedientes_restore_etapa9_si_acuse_enviado();

-- Backfill cohorte actual (idempotente).
SELECT public.repair_retencion_enviada_a_etapa_9(NULL);
