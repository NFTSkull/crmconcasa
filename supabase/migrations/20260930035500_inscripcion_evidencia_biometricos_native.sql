-- ConCasa CRM — permitir que una evidencia biométrica capturada nativamente en CRM
-- cuente para habilitar la agenda de inscripción.
--
-- Contexto:
-- agenda_operational_results_native guarda resultados operativos manuales/CRM,
-- pero agenda_inscripcion_tiene_biometricos_previos solo reconocía bookings
-- o resultados proyectados desde Google Sheets. Eso dejaba bloqueados casos
-- donde biométricos ya se realizaron y se documentaron manualmente en CRM.

CREATE OR REPLACE FUNCTION public.agenda_inscripcion_tiene_biometricos_previos(
  p_expediente_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT p_expediente_id IS NOT NULL AND (
    EXISTS (
      SELECT 1
      FROM public.agenda_bookings b
      WHERE b.expediente_id = p_expediente_id
        AND b.kind = 'biometricos'::public.booking_kind
    )
    OR EXISTS (
      SELECT 1
      FROM public.agenda_sheet_operational_results o
      WHERE o.expediente_id = p_expediente_id
        AND o.kind = 'biometricos'
        AND o.biometric_result_class = 'COMPLETED'
    )
    OR EXISTS (
      SELECT 1
      FROM public.agenda_operational_results_native n
      WHERE n.expediente_id = p_expediente_id
        AND n.kind = 'biometricos'
        AND n.biometric_result_class = 'COMPLETED'
        AND COALESCE(n.operational_red_veto, false) = false
    )
  );
$function$;

COMMENT ON FUNCTION public.agenda_inscripcion_tiene_biometricos_previos(UUID)
IS 'P178+: evidencia biometrica previa para inscripcion: booking historico, resultado COMPLETED de Sheet o resultado nativo CRM COMPLETED sin veto rojo.';