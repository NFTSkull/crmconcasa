-- Apodaca operativa suspendida desde 21/10/2026, hasta nuevo aviso.
-- La tabla agenda_sede_suspensiones (migración previa) es el candado transaccional.
-- Esto únicamente alinea la presentación de agenda y el historial de excepciones.
UPDATE public.agenda_config
SET config=jsonb_set(config,'{locations,apodaca,enabled}','false'::jsonb,true)
WHERE kind IN ('biometricos','firmas') AND config->'locations' ? 'apodaca';
UPDATE public.app_settings
SET value='[]'::jsonb,updated_at=now()
WHERE key='inscripcion_apodaca_expedientes'
  AND jsonb_typeof(value)='array';
UPDATE public.agenda_sheet_slot_inventory
SET status='disabled',last_error='SEDE_APODACA_SUSPENDIDA'
WHERE organization_id IN (
  SELECT organization_id FROM public.agenda_sede_suspensiones
  WHERE location_id='apodaca' AND active=true
)
AND location_id='apodaca' AND booking_date>='2026-10-21'
AND booking_id IS NULL AND status IN ('available','occupied_external');
