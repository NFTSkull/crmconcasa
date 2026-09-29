-- ConCasa CRM — Vigencia de Notificación (30 días)
-- Regla:
--   * El reloj inicia al subir/reemplazar Notificación desde Mesa.
--   * Se libera al llegar a firma (etapa >= 9), tener cita de firmas activa
--     o registrar Pago ConCasa.
--   * Al vencer, vuelve al asesor como "Notificación vencida".
--   * Para reactivar ese rechazo se exige un Estado de Cuenta nuevo,
--     cargado después del rechazo.
-- Importante: NO se hace backfill automático de Notificaciones históricas.
-- Solo documentos nuevos a partir de esta migración quedan rastreados;
-- excepciones legacy deben sembrarse de forma explícita y auditada.

-- =============================================================================
-- 1) Ciclo explícito por versión/documento de Notificación
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.expediente_notificacion_vigencias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  expediente_id UUID NOT NULL REFERENCES public.expedientes(id) ON DELETE CASCADE,
  documento_id UUID NOT NULL REFERENCES public.expediente_documentos(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  closed_at TIMESTAMPTZ NULL,
  closed_reason TEXT NULL,
  rechazo_id UUID NULL REFERENCES public.expediente_rechazos_operativos(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT expediente_notificacion_vigencias_documento_uk UNIQUE (documento_id),
  CONSTRAINT expediente_notificacion_vigencias_expiry_chk CHECK (expires_at > started_at),
  CONSTRAINT expediente_notificacion_vigencias_close_chk CHECK (
    (closed_at IS NULL AND closed_reason IS NULL)
    OR
    (closed_at IS NOT NULL AND closed_reason IS NOT NULL AND btrim(closed_reason) <> '')
  )
);

CREATE INDEX IF NOT EXISTS expediente_notificacion_vigencias_open_idx
  ON public.expediente_notificacion_vigencias (expires_at, expediente_id)
  WHERE closed_at IS NULL;

CREATE INDEX IF NOT EXISTS expediente_notificacion_vigencias_exp_idx
  ON public.expediente_notificacion_vigencias (expediente_id, started_at DESC);

ALTER TABLE public.expediente_notificacion_vigencias ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.expediente_notificacion_vigencias
  FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.expediente_notificacion_vigencias IS
  'P486: reloj explícito de 30 días por versión de Notificación cargada por Mesa. Sin backfill automático legacy.';
COMMENT ON COLUMN public.expediente_notificacion_vigencias.started_at IS
  'Fecha/hora real de creación del documento que inició el reloj.';
COMMENT ON COLUMN public.expediente_notificacion_vigencias.expires_at IS
  'started_at + 30 días exactos.';
COMMENT ON COLUMN public.expediente_notificacion_vigencias.closed_reason IS
  'firma_agendada | stage_gte_9 | pago_concasa | replaced_or_deleted | expediente_inactivo | notificacion_vencida.';

-- =============================================================================
-- 2) decision_source=system para rechazos automáticos auditables
--    Se preservan exactamente las reglas preexistentes human/google_sheet.
-- =============================================================================
ALTER TABLE public.expediente_rechazos_operativos
  DROP CONSTRAINT IF EXISTS expediente_rechazos_operativos_decision_source_chk;

ALTER TABLE public.expediente_rechazos_operativos
  ADD CONSTRAINT expediente_rechazos_operativos_decision_source_chk CHECK (
    (
      decision_source = 'human'
      AND decidido_por IS NOT NULL
      AND decidido_por_rol IS NOT NULL
      AND source_spreadsheet_id IS NULL
      AND source_sheet_id IS NULL
      AND source_sheet_row IS NULL
    )
    OR
    (
      decision_source = 'google_sheet'
      AND decidido_por IS NULL
      AND decidido_por_rol IS NULL
      AND source_spreadsheet_id IS NOT NULL
      AND btrim(source_spreadsheet_id) <> ''
      AND source_sheet_id IS NOT NULL
      AND source_sheet_row IS NOT NULL
      AND source_sheet_row > 0
    )
    OR
    (
      decision_source = 'system'
      AND decidido_por IS NULL
      AND decidido_por_rol IS NULL
      AND source_spreadsheet_id IS NULL
      AND source_sheet_id IS NULL
      AND source_sheet_row IS NULL
    )
  );

COMMENT ON COLUMN public.expediente_rechazos_operativos.decision_source IS
  'human (Mesa) | google_sheet (CITAS 2026) | system (automatizaciones internas auditables).';

-- =============================================================================
-- 3) Inicio automático del reloj solo para uploads NUEVOS de Mesa
-- =============================================================================
CREATE OR REPLACE FUNCTION public.track_mesa_notificacion_vigencia_30d()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NEW.tipo_documento NOT IN ('cliente_notificacion', 'cliente_notificacion_apodaca') THEN
    RETURN NEW;
  END IF;

  IF lower(btrim(COALESCE(NEW.uploaded_by_role, ''))) NOT IN (
    'mesa_admin', 'mesa_interno', 'mesa_externo', 'super_admin', 'mesa_control'
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.expediente_notificacion_vigencias (
    organization_id,
    expediente_id,
    documento_id,
    started_at,
    expires_at
  ) VALUES (
    NEW.organization_id,
    NEW.expediente_id,
    NEW.id,
    NEW.created_at,
    NEW.created_at + INTERVAL '30 days'
  )
  ON CONFLICT (documento_id) DO NOTHING;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS expediente_documentos_track_notificacion_vigencia_30d
  ON public.expediente_documentos;

CREATE TRIGGER expediente_documentos_track_notificacion_vigencia_30d
AFTER INSERT ON public.expediente_documentos
FOR EACH ROW
EXECUTE FUNCTION public.track_mesa_notificacion_vigencia_30d();

REVOKE ALL ON FUNCTION public.track_mesa_notificacion_vigencia_30d()
  FROM PUBLIC, anon, authenticated;

-- =============================================================================
-- 4) Estado RO para UI. La última Notificación activa es autoridad.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.expediente_notificacion_vigencia_estado(
  p_expediente_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_exp RECORD;
  v_doc RECORD;
  v_cycle RECORD;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_firma_agendada BOOLEAN := FALSE;
  v_tiene_pago BOOLEAN := FALSE;
  v_dias_restantes INTEGER := NULL;
  v_dias_transcurridos INTEGER := NULL;
  v_vencido BOOLEAN := FALSE;
  v_release_reason TEXT := NULL;
BEGIN
  IF p_expediente_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT
    e.id,
    e.etapa_actual,
    e.subestado::text AS subestado,
    e.ciclo_estado::text AS ciclo_estado,
    e.submitted_to_mesa,
    e.deleted_at,
    e.pago_concasa_resultado
  INTO v_exp
  FROM public.expedientes e
  WHERE e.id = p_expediente_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT d.id, d.tipo_documento, d.created_at
  INTO v_doc
  FROM public.expediente_documentos d
  WHERE d.expediente_id = p_expediente_id
    AND d.deleted_at IS NULL
    AND d.tipo_documento IN ('cliente_notificacion', 'cliente_notificacion_apodaca')
  ORDER BY d.created_at DESC, d.id DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'applicable', false,
      'reason', 'no_active_notification',
      'limite_dias', 30,
      'vencido', false
    );
  END IF;

  SELECT v.*
  INTO v_cycle
  FROM public.expediente_notificacion_vigencias v
  WHERE v.documento_id = v_doc.id
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'applicable', false,
      'reason', 'legacy_untracked',
      'documento_id', v_doc.id,
      'tipo_documento', v_doc.tipo_documento,
      'limite_dias', 30,
      'vencido', false
    );
  END IF;

  IF v_cycle.closed_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'applicable', false,
      'reason', v_cycle.closed_reason,
      'documento_id', v_doc.id,
      'tipo_documento', v_doc.tipo_documento,
      'started_at', v_cycle.started_at,
      'expires_at', v_cycle.expires_at,
      'closed_at', v_cycle.closed_at,
      'limite_dias', 30,
      'vencido', v_cycle.closed_reason = 'notificacion_vencida'
    );
  END IF;

  IF v_exp.deleted_at IS NOT NULL
     OR v_exp.ciclo_estado IS DISTINCT FROM 'activo'
     OR v_exp.submitted_to_mesa IS DISTINCT FROM TRUE THEN
    RETURN jsonb_build_object(
      'applicable', false,
      'reason', 'expediente_inactivo',
      'documento_id', v_doc.id,
      'tipo_documento', v_doc.tipo_documento,
      'limite_dias', 30,
      'vencido', false
    );
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.agenda_bookings b
    WHERE b.expediente_id = p_expediente_id
      AND b.kind::text = 'firmas'
      AND b.status::text = 'booked'
  ) INTO v_firma_agendada;

  SELECT (
    v_exp.pago_concasa_resultado IS NOT NULL
    OR EXISTS (
      SELECT 1
      FROM public.expediente_pagos_concasa pc
      WHERE pc.expediente_id = p_expediente_id
    )
  ) INTO v_tiene_pago;

  IF v_tiene_pago THEN
    v_release_reason := 'pago_concasa';
  ELSIF v_exp.etapa_actual >= 9 THEN
    v_release_reason := 'stage_gte_9';
  ELSIF v_firma_agendada THEN
    v_release_reason := 'firma_agendada';
  END IF;

  IF v_release_reason IS NOT NULL THEN
    RETURN jsonb_build_object(
      'applicable', false,
      'reason', v_release_reason,
      'documento_id', v_doc.id,
      'tipo_documento', v_doc.tipo_documento,
      'started_at', v_cycle.started_at,
      'expires_at', v_cycle.expires_at,
      'limite_dias', 30,
      'vencido', false
    );
  END IF;

  v_vencido := v_now >= v_cycle.expires_at;
  v_dias_transcurridos := GREATEST(
    0,
    FLOOR(EXTRACT(EPOCH FROM (v_now - v_cycle.started_at)) / 86400.0)::INTEGER
  );
  v_dias_restantes := GREATEST(
    0,
    CEIL(EXTRACT(EPOCH FROM (v_cycle.expires_at - v_now)) / 86400.0)::INTEGER
  );

  RETURN jsonb_build_object(
    'applicable', true,
    'reason', CASE WHEN v_vencido THEN 'expired_pending_worker' ELSE NULL END,
    'documento_id', v_doc.id,
    'tipo_documento', v_doc.tipo_documento,
    'started_at', v_cycle.started_at,
    'expires_at', v_cycle.expires_at,
    'limite_dias', 30,
    'dias_transcurridos', v_dias_transcurridos,
    'dias_restantes', v_dias_restantes,
    'vencido', v_vencido,
    'should_reject', v_vencido
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.expediente_notificacion_vigencia_estado(UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.expediente_notificacion_vigencia_estado(UUID)
  TO authenticated;

-- =============================================================================
-- 5) Rechazo automático idempotente + liberación de ciclos usados
-- =============================================================================
CREATE OR REPLACE FUNCTION public.procesar_notificaciones_vencidas(
  p_limit INTEGER DEFAULT 100
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_row RECORD;
  v_latest_doc_id UUID;
  v_rechazo_id UUID;
  v_processed INTEGER := 0;
  v_released INTEGER := 0;
  v_skipped INTEGER := 0;
  v_limit INTEGER := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 500);
  v_comment TEXT :=
    'La Notificación superó 30 días sin cita de firma, firma o Pago ConCasa. '
    || 'El asesor debe cargar un Estado de Cuenta actualizado y reenviar el expediente a Mesa.';
BEGIN
  FOR v_row IN
    SELECT
      v.id AS cycle_id,
      v.organization_id,
      v.expediente_id,
      v.documento_id,
      v.started_at,
      v.expires_at,
      e.etapa_actual,
      e.subestado,
      e.ciclo_estado,
      e.submitted_to_mesa,
      e.deleted_at AS expediente_deleted_at,
      e.pago_concasa_resultado,
      d.deleted_at AS documento_deleted_at
    FROM public.expediente_notificacion_vigencias v
    JOIN public.expedientes e ON e.id = v.expediente_id
    JOIN public.expediente_documentos d ON d.id = v.documento_id
    WHERE v.closed_at IS NULL
    ORDER BY v.expires_at ASC, v.id ASC
    LIMIT v_limit
    FOR UPDATE OF v SKIP LOCKED
  LOOP
    v_latest_doc_id := NULL;

    SELECT d.id
    INTO v_latest_doc_id
    FROM public.expediente_documentos d
    WHERE d.expediente_id = v_row.expediente_id
      AND d.deleted_at IS NULL
      AND d.tipo_documento IN ('cliente_notificacion', 'cliente_notificacion_apodaca')
    ORDER BY d.created_at DESC, d.id DESC
    LIMIT 1;

    IF v_row.documento_deleted_at IS NOT NULL
       OR v_latest_doc_id IS NULL
       OR v_latest_doc_id IS DISTINCT FROM v_row.documento_id THEN
      UPDATE public.expediente_notificacion_vigencias
      SET closed_at = NOW(), closed_reason = 'replaced_or_deleted'
      WHERE id = v_row.cycle_id AND closed_at IS NULL;
      v_released := v_released + 1;
      CONTINUE;
    END IF;

    IF v_row.expediente_deleted_at IS NOT NULL
       OR v_row.ciclo_estado::text IS DISTINCT FROM 'activo'
       OR v_row.submitted_to_mesa IS DISTINCT FROM TRUE THEN
      UPDATE public.expediente_notificacion_vigencias
      SET closed_at = NOW(), closed_reason = 'expediente_inactivo'
      WHERE id = v_row.cycle_id AND closed_at IS NULL;
      v_released := v_released + 1;
      CONTINUE;
    END IF;

    IF v_row.pago_concasa_resultado IS NOT NULL
       OR EXISTS (
         SELECT 1
         FROM public.expediente_pagos_concasa pc
         WHERE pc.expediente_id = v_row.expediente_id
       ) THEN
      UPDATE public.expediente_notificacion_vigencias
      SET closed_at = NOW(), closed_reason = 'pago_concasa'
      WHERE id = v_row.cycle_id AND closed_at IS NULL;
      v_released := v_released + 1;
      CONTINUE;
    END IF;

    IF v_row.etapa_actual >= 9 THEN
      UPDATE public.expediente_notificacion_vigencias
      SET closed_at = NOW(), closed_reason = 'stage_gte_9'
      WHERE id = v_row.cycle_id AND closed_at IS NULL;
      v_released := v_released + 1;
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.agenda_bookings b
      WHERE b.expediente_id = v_row.expediente_id
        AND b.kind::text = 'firmas'
        AND b.status::text = 'booked'
    ) THEN
      UPDATE public.expediente_notificacion_vigencias
      SET closed_at = NOW(), closed_reason = 'firma_agendada'
      WHERE id = v_row.cycle_id AND closed_at IS NULL;
      v_released := v_released + 1;
      CONTINUE;
    END IF;

    IF clock_timestamp() < v_row.expires_at THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    -- No pisa un rechazo operativo existente por otra causa.
    -- El ciclo queda abierto y se reevaluará si el expediente se reactiva.
    IF v_row.subestado::text = 'rechazado' THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;

    INSERT INTO public.expediente_rechazos_operativos (
      organization_id,
      expediente_id,
      etapa,
      subestado_anterior,
      motivo,
      comentario,
      biometricos_condicion,
      biometricos_razon,
      biometricos_booking_id,
      decidido_por,
      decidido_por_rol,
      decision_source,
      source_spreadsheet_id,
      source_sheet_id,
      source_sheet_row,
      source_booking_id
    ) VALUES (
      v_row.organization_id,
      v_row.expediente_id,
      v_row.etapa_actual,
      v_row.subestado,
      'Notificación vencida',
      v_comment,
      'desconocida',
      NULL,
      NULL,
      NULL,
      NULL,
      'system',
      NULL,
      NULL,
      NULL,
      NULL
    )
    RETURNING id INTO v_rechazo_id;

    UPDATE public.expedientes
    SET
      subestado = 'rechazado',
      motivo_rechazo = 'Notificación vencida',
      comentario_rechazo = v_comment,
      updated_at = NOW()
    WHERE id = v_row.expediente_id;

    UPDATE public.expediente_notificacion_vigencias
    SET
      closed_at = NOW(),
      closed_reason = 'notificacion_vencida',
      rechazo_id = v_rechazo_id
    WHERE id = v_row.cycle_id
      AND closed_at IS NULL;

    PERFORM public.log_action(
      v_row.organization_id,
      NULL,
      NULL,
      'expediente.notificacion_vencida',
      'expediente',
      v_row.expediente_id,
      jsonb_build_object(
        'rechazo_id', v_rechazo_id,
        'documento_id', v_row.documento_id,
        'started_at', v_row.started_at,
        'expires_at', v_row.expires_at,
        'limite_dias', 30,
        'motivo', 'Notificación vencida',
        'decision_source', 'system'
      )
    );

    v_processed := v_processed + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'rejected', v_processed,
    'released', v_released,
    'skipped', v_skipped,
    'limit', v_limit
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.procesar_notificaciones_vencidas(INTEGER)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.procesar_notificaciones_vencidas(INTEGER)
  TO postgres, service_role;

-- =============================================================================
-- 6) Reingreso: Notificación vencida exige Estado de Cuenta posterior al rechazo
-- =============================================================================
CREATE OR REPLACE FUNCTION public.guard_notificacion_vencida_reactivacion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_rechazo RECORD;
BEGIN
  SELECT r.expediente_id, r.motivo, r.created_at
  INTO v_rechazo
  FROM public.expediente_rechazos_operativos r
  WHERE r.id = NEW.rechazo_id;

  IF NOT FOUND
     OR lower(btrim(COALESCE(v_rechazo.motivo, ''))) <> lower('Notificación vencida') THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.expediente_documentos d
    WHERE d.expediente_id = v_rechazo.expediente_id
      AND d.tipo_documento = 'cliente_estado_cuenta'
      AND d.deleted_at IS NULL
      AND d.created_at > v_rechazo.created_at
  ) THEN
    RAISE EXCEPTION
      'NOTIFICACION_VENCIDA_ESTADO_CUENTA_REQUERIDO: carga un Estado de Cuenta actualizado posterior al rechazo antes de reenviar a Mesa'
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS expediente_reactivacion_guard_notificacion_vencida
  ON public.expediente_rechazo_reactivaciones;

CREATE TRIGGER expediente_reactivacion_guard_notificacion_vencida
BEFORE INSERT ON public.expediente_rechazo_reactivaciones
FOR EACH ROW
EXECUTE FUNCTION public.guard_notificacion_vencida_reactivacion();

REVOKE ALL ON FUNCTION public.guard_notificacion_vencida_reactivacion()
  FROM PUBLIC, anon, authenticated;

-- =============================================================================
-- 7) Scheduler interno (DB-only; sin egress): máximo ~1 hora después de vencer
-- =============================================================================
DO $p486$
DECLARE
  r RECORD;
  v_jobid BIGINT;
BEGIN
  IF current_database() IS DISTINCT FROM 'postgres' THEN
    RAISE NOTICE 'notificacion_vigencia_30d: skip cron (database=%)', current_database();
    RETURN;
  END IF;

  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
  EXCEPTION
    WHEN OTHERS THEN
      RAISE NOTICE 'notificacion_vigencia_30d: pg_cron ya existe / skip recreate (%): %',
        SQLSTATE, SQLERRM;
  END;

  GRANT USAGE ON SCHEMA cron TO postgres;
  GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres;

  FOR r IN
    SELECT jobid
    FROM cron.job
    WHERE jobname = 'notificacion-vencida-hourly'
  LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;

  SELECT cron.schedule(
    'notificacion-vencida-hourly',
    '17 * * * *',
    $cron$SELECT public.procesar_notificaciones_vencidas(100);$cron$
  )
  INTO v_jobid;

  RAISE NOTICE 'notificacion_vigencia_30d: scheduled jobid=%', v_jobid;
END
$p486$;
