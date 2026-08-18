-- ConCasa CRM — P191: excluir expedientes terminales de tareas accionables del asesor.
-- Cloud max conocido = 190. 191 estaba libre (repo + Cloud).
-- Lista (`asesor_list_expedientes_page`) y contadores (`asesor_inbox_summary`)
-- heredan la misma semántica: ambos llaman a pendiente_agendar_* / pendiente_subir_acuse.
-- Firmas públicas de esos helpers: intactas (BOOLEAN, SMALLINT, UUID).
-- Sin UI, sin Cloud apply, sin reingreso, sin agenda/Sheets.

-- Guard canónico: no accionable si resultado_real ∈ {cancelado, rechazado_mesa}.
-- Reutiliza asesor_inbox_resultado_real (autoridad existente).
-- categoria_correccion NO entra aquí (corrección documental ≠ terminal).

CREATE OR REPLACE FUNCTION public.asesor_inbox_es_accionable(
  p_submitted_to_mesa BOOLEAN,
  p_subestado TEXT,
  p_ciclo_estado TEXT,
  p_decision TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT public.asesor_inbox_resultado_real(
    p_submitted_to_mesa,
    p_subestado,
    p_ciclo_estado,
    p_decision
  ) NOT IN ('cancelado', 'rechazado_mesa');
$$;

COMMENT ON FUNCTION public.asesor_inbox_es_accionable(BOOLEAN, TEXT, TEXT, TEXT) IS
  'P191: tarea accionable = resultado_real distinto de cancelado y rechazado_mesa.';

CREATE OR REPLACE FUNCTION public.asesor_inbox_es_accionable(p_expediente_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT coalesce((
    SELECT public.asesor_inbox_es_accionable(
      e.submitted_to_mesa,
      e.subestado::text,
      e.ciclo_estado::text,
      ed.decision::text
    )
    FROM public.expedientes e
    LEFT JOIN public.editor_decisions ed ON ed.expediente_id = e.id
    WHERE e.id = p_expediente_id
  ), false);
$$;

COMMENT ON FUNCTION public.asesor_inbox_es_accionable(UUID) IS
  'P191: lookup de accionable por expediente_id (estado ACTUAL; sin IDs hardcode).';

REVOKE ALL ON FUNCTION public.asesor_inbox_es_accionable(BOOLEAN, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asesor_inbox_es_accionable(BOOLEAN, TEXT, TEXT, TEXT)
  TO authenticated;

REVOKE ALL ON FUNCTION public.asesor_inbox_es_accionable(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asesor_inbox_es_accionable(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.asesor_inbox_pendiente_agendar_biometricos(
  p_submitted_to_mesa BOOLEAN,
  p_etapa_actual SMALLINT,
  p_expediente_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  -- P167 + P191: terminal (cancelado / rechazado_mesa) jamás es tarea de agenda.
  SELECT CASE
    WHEN NOT coalesce(p_submitted_to_mesa, false) THEN false
    WHEN NOT public.asesor_inbox_es_accionable(p_expediente_id) THEN false
    WHEN public.asesor_inbox_latest_booking_status(p_expediente_id, 'notificacion') = 'booked'
      THEN false
    WHEN public.asesor_inbox_latest_booking_status(p_expediente_id, 'biometricos') = 'booked'
      THEN false
    WHEN p_etapa_actual = 3 THEN true
    WHEN p_etapa_actual IN (4, 5) THEN
      public.asesor_inbox_latest_booking_status(p_expediente_id, 'biometricos') = 'cancelled'
    ELSE false
  END;
$$;

COMMENT ON FUNCTION public.asesor_inbox_pendiente_agendar_biometricos(BOOLEAN, SMALLINT, UUID) IS
  'P167/P191: etapa 3 sin booked vigente; 4/5 si último bio cancelled; excluye terminales.';

CREATE OR REPLACE FUNCTION public.asesor_inbox_pendiente_agendar_firma(
  p_submitted_to_mesa BOOLEAN,
  p_etapa_actual SMALLINT,
  p_expediente_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN NOT coalesce(p_submitted_to_mesa, false) THEN false
    WHEN NOT public.asesor_inbox_es_accionable(p_expediente_id) THEN false
    WHEN p_etapa_actual = 9 THEN
      public.asesor_inbox_latest_booking_status(p_expediente_id, 'firmas') IS DISTINCT FROM 'booked'
    WHEN p_etapa_actual = 10 THEN
      public.asesor_inbox_latest_booking_status(p_expediente_id, 'firmas') = 'cancelled'
    ELSE false
  END;
$$;

COMMENT ON FUNCTION public.asesor_inbox_pendiente_agendar_firma(BOOLEAN, SMALLINT, UUID) IS
  'P167/P191: etapa 9 sin firmas booked; etapa 10 si último cancelled; excluye terminales.';

CREATE OR REPLACE FUNCTION public.asesor_inbox_pendiente_subir_acuse(
  p_submitted_to_mesa BOOLEAN,
  p_etapa_actual SMALLINT,
  p_expediente_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SET search_path = public
AS $$
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
$$;

COMMENT ON FUNCTION public.asesor_inbox_pendiente_subir_acuse(BOOLEAN, SMALLINT, UUID) IS
  'P161/P191: etapa ≥8 sin acuse principal válido; excluye terminales.';
