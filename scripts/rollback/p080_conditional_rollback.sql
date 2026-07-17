-- Rollback condicional P080 (NO ejecutar automáticamente).
-- Solo revierte filas movidas por P080 que siguen en etapa 9 sin booking firmas
-- y sin avance operativo posterior (etapa sigue 9).
-- No toca documentos, opción ni bookings.

DO $$
DECLARE
  v_reverted INT := 0;
  r RECORD;
BEGIN
  FOR r IN
    SELECT al.entity_id AS expediente_id, al.organization_id
    FROM public.action_log al
    INNER JOIN public.expedientes e ON e.id = al.entity_id
    WHERE al.action = 'expediente.retencion_backfill_auto_firma'
      AND al.entity_type = 'expediente'
      AND e.etapa_actual = 9
      AND e.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.agenda_bookings b
        WHERE b.expediente_id = e.id
          AND b.kind = 'firmas'
          AND b.status = 'booked'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM public.action_log al2
        WHERE al2.entity_id = al.entity_id
          AND al2.entity_type = 'expediente'
          AND al2.created_at > al.created_at
          AND (
            al2.action LIKE 'expediente.avanzar%'
            OR al2.action LIKE '%firmas%'
            OR al2.action = 'expediente.mesa_mover_etapa_operativa'
          )
      )
    FOR UPDATE OF e
  LOOP
    UPDATE public.expedientes
    SET
      etapa_actual = 8,
      subestado = 'en_proceso',
      updated_at = NOW()
    WHERE id = r.expediente_id
      AND etapa_actual = 9;

    IF FOUND THEN
      v_reverted := v_reverted + 1;
      PERFORM public.log_action(
        r.organization_id,
        NULL,
        NULL,
        'expediente.retencion_backfill_auto_firma_rollback',
        'expediente',
        r.expediente_id,
        jsonb_build_object(
          'etapa_anterior', 9,
          'etapa_nueva', 8,
          'razon_tecnica', 'P080_conditional_rollback',
          'version', 'P080'
        )
      );
    END IF;
  END LOOP;

  RAISE NOTICE 'P080 conditional rollback: filas revertidas=%', v_reverted;
END;
$$;
