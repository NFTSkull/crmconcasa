-- ConCasa CRM — P080: backfill Cohorte A (retención ya enviada → etapa 9)
-- NO APLICAR en esta fase sin autorización expresa.
-- Solo mueve expedientes etapa 8 con envío persistido + principal válido + sin booking firmas.
-- Idempotente: segunda ejecución actualiza 0 filas.
-- No altera documentos, opción, bookings ni estados documentales.

DO $$
DECLARE
  v_moved INT := 0;
  r RECORD;
BEGIN
  FOR r IN
    SELECT e.id, e.organization_id, e.etapa_actual
    FROM public.expedientes e
    INNER JOIN public.retencion_envios re ON re.expediente_id = e.id
    LEFT JOIN public.retencion_opciones ro ON ro.expediente_id = e.id
    WHERE e.etapa_actual = 8
      AND e.deleted_at IS NULL
      AND e.ciclo_estado = 'activo'
      AND e.submitted_to_mesa = true
      AND e.subestado = 'en_proceso'
      AND re.enviado = true
      AND re.estado = 'enviado'
      AND COALESCE(re.opcion, ro.retencion_opcion) IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.agenda_bookings b
        WHERE b.expediente_id = e.id
          AND b.kind = 'firmas'
          AND b.status = 'booked'
      )
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
      AND (
        SELECT count(*)::int
        FROM public.expediente_documentos d
        WHERE d.expediente_id = e.id
          AND d.deleted_at IS NULL
          AND d.tipo_documento IN (
            'retencion_acuse_con_sello',
            'retencion_carta_sin_sello'
          )
      ) = 1
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
        'expediente.retencion_backfill_auto_firma',
        'expediente',
        r.id,
        jsonb_build_object(
          'etapa_anterior', 8,
          'etapa_nueva', 9,
          'razon_tecnica', 'P080 cohort_a_retencion_enviada_principal_valido',
          'version', 'P080'
        )
      );
    END IF;
  END LOOP;

  RAISE NOTICE 'P080 backfill retencion→etapa9: filas movidas=%', v_moved;
END;
$$;
