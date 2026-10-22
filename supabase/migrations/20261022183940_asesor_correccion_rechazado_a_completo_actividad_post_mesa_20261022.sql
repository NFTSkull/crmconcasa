-- Migración aplicada en producción (20261022183940).
-- Una corrección guardada tras rechazo DG debe habilitar reenvío explícito
-- sin auto-validar, auto-enviar ni cambiar la etapa del expediente.
-- Preserva seguridad y regla canónica P210 (solo asesora propietaria reenvía).
CREATE OR REPLACE FUNCTION public.asesor_correccion_has_dg_activity_after(p_expediente_id uuid, p_request_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((
    SELECT TRUE
    FROM public.expediente_asesor_cambios c
    INNER JOIN public.expediente_asesor_cambio_lotes l ON l.id = c.lote_id
    WHERE l.expediente_id = p_expediente_id
      AND c.created_at > p_request_at
      AND (
        c.entidad IN ('cliente_datos', 'expediente')
        OR c.tipo IN (
          'documento_reemplazado'::public.asesor_cambio_tipo,
          'documento_agregado'::public.asesor_cambio_tipo
        )
      )
    LIMIT 1
  ), FALSE)
  OR COALESCE((
    SELECT TRUE
    FROM public.expediente_documentos d
    WHERE d.expediente_id = p_expediente_id
      AND d.deleted_at IS NULL
      AND d.created_at > p_request_at
    LIMIT 1
  ), FALSE)
  -- Cuando la asesora atiende una solicitud y guarda DG desde «rechazado»
  -- a «completo», esa confirmación SÍ es actividad posterior a Mesa,
  -- aunque ningún campo incluido en el diff P130 haya variado.
  -- El reenvío continúa exigiendo confirmación explícita del asesor.
  OR EXISTS (
    SELECT 1 FROM public.action_log a
    WHERE a.entity_id = p_expediente_id
      AND a.entity_type = 'cliente_datos'
      AND a.action = 'cliente_datos.correccion_post_mesa'
      AND a.created_at > p_request_at
      AND a.payload->>'estado_anterior' = 'rechazado'
      AND a.payload->>'estado_nuevo' = 'completo'
  );
$function$;

