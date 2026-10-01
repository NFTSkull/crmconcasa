BEGIN;

-- Mantiene el Acuse disponible dentro del expediente desde que existe una cita
-- biométrica activa, pero NO convierte esos expedientes tempranos en una tarea
-- "Subir Acuse" del dashboard. El pendiente operativo vuelve a iniciar en etapa 8.
CREATE OR REPLACE FUNCTION public.asesor_inbox_pendiente_subir_acuse(
  p_submitted_to_mesa BOOLEAN,
  p_etapa_actual SMALLINT,
  p_expediente_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  SELECT CASE
    WHEN NOT coalesce(p_submitted_to_mesa, false) THEN false
    WHEN NOT public.asesor_inbox_es_accionable(p_expediente_id) THEN false
    WHEN p_etapa_actual IS NULL OR p_etapa_actual < 8 THEN false
    WHEN EXISTS (
      SELECT 1
      FROM public.expediente_documentos d
      WHERE d.expediente_id = p_expediente_id
        AND d.deleted_at IS NULL
        AND d.tipo_documento IN (
          'retencion_acuse_con_sello',
          'retencion_carta_sin_sello'
        )
        AND d.estatus_revision::text IN ('subido', 'resubido', 'validado')
    ) THEN false
    ELSE true
  END;
$function$;

COMMENT ON FUNCTION public.asesor_inbox_pendiente_subir_acuse(BOOLEAN, SMALLINT, UUID) IS
  'Pendiente dashboard Subir Acuse: etapa >=8 sin Acuse/Carta principal listo. La carga anticipada desde cita biométrica se controla aparte en expediente_acuse_habilitado_desde_biometricos.';

COMMIT;
