-- ConCasa CRM P104 — Documento opcional asesor: Notificación solo Apodaca
-- Tipo técnico: cliente_notificacion_apodaca
-- Distinto de cliente_notificacion (P092, Mesa etapa ≥7) y de agenda_bookings.kind='notificacion'.
-- No altera gate obligatorio (4/4), complementarios Mesa, Pagaré, Solicitud ni citas.
-- No aplica a Cloud en este bloque (solo migración local).

CREATE OR REPLACE FUNCTION public.integration_doc_tipos_asesor_opcionales()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT ARRAY[
    'cliente_semanas_cotizadas',
    'cliente_carta_empresa',
    'cliente_acta_nacimiento_digital',
    'cliente_notificacion_apodaca'
  ]::TEXT[];
$$;

COMMENT ON FUNCTION public.integration_doc_tipos_asesor_opcionales() IS
  'P104: opcionales upload asesor (no bloquean enviar_a_mesa). Incluye semanas, carta, acta digital y notificación solo Apodaca.';

COMMENT ON FUNCTION public.integration_doc_tipos_asesor_upload() IS
  'P104: tipos permitidos upload/register asesor (4 oblig + 4 opcionales = 8). Excluye acta/constancia SAT y docs Mesa (pagaré/notif/solicitud).';

-- Herencia reingreso alineada con otros opcionales asesor (carta / acta digital).
CREATE OR REPLACE FUNCTION public.reingreso_documentos_reutilizables()
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT ARRAY[
    'cliente_ine_frente',
    'cliente_ine_reverso',
    'cliente_acta_nacimiento',
    'cliente_constancia_sat',
    'cliente_semanas_cotizadas',
    'cliente_carta_empresa',
    'cliente_acta_nacimiento_digital',
    'cliente_notificacion_apodaca'
  ]::TEXT[];
$$;

COMMENT ON FUNCTION public.reingreso_documentos_reutilizables() IS
  'P104: allowlist reutilizable en reingreso post-biométricos; incluye cliente_notificacion_apodaca (opcional asesor). Excluye domicilio, estado cuenta, pagaré, notificación Mesa y solicitud.';

REVOKE ALL ON FUNCTION public.reingreso_documentos_reutilizables()
  FROM PUBLIC, anon, authenticated, service_role;
-- MIME/tamaño: hereda PDF + 15 MiB vía expediente_documento_mime_permitido / max_size (sin límites nuevos).
