-- P209 TX fixture + AFTER benchmark + ROLLBACK (single session)

CREATE OR REPLACE FUNCTION public.__p209_set_auth(p_user UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
END; $$;

CREATE OR REPLACE FUNCTION public.__p209_reset_auth()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END; $$;

BEGIN;

-- Invariants aggregate
WITH correction AS (
  SELECT e.id
  FROM public.expedientes e
  WHERE e.deleted_at IS NULL
    AND public.asesor_inbox_estado_efectivo(e.id) = 'correccion_requerida'
),
expl AS (
  SELECT
    c.id,
    public.asesor_inbox_correccion_explicacion(c.id) AS explanation,
    public.asesor_inbox_correccion_labels_vigentes(c.id) AS labels
  FROM correction c
),
p198 AS (
  SELECT
    c.id,
    s.estado AS p198_estado,
    s.request_type AS p198_request_type
  FROM correction c
  LEFT JOIN LATERAL (
    SELECT t.estado, t.request_type
    FROM public.mesa_cambio_revision_estado_efectivo(c.id) t
    LIMIT 1
  ) s ON TRUE
)
SELECT
  (SELECT count(*) FROM correction) AS total_correction_required,
  (SELECT count(*) FROM expl WHERE explanation IS NOT NULL) AS explanation_non_null,
  (SELECT count(*) FROM expl WHERE btrim(coalesce(explanation, '')) <> '') AS explanation_non_empty,
  (SELECT count(*) FROM expl WHERE explanation LIKE '%Abre el expediente para revisar el detalle%') AS fallback_count,
  (SELECT count(*) FROM p198 WHERE p198_estado = 'WAITING_ADVISOR' AND p198_request_type = 'SOLICITUD_DATOS_GENERALES') AS bucket_dg,
  (SELECT count(*) FROM p198 WHERE p198_estado = 'WAITING_ADVISOR' AND p198_request_type = 'SOLICITUD_DOCUMENTAL') AS bucket_documental,
  (SELECT count(*) FROM correction c WHERE public.asesor_inbox_retencion_correccion_abierta(c.id)) AS bucket_retencion,
  (SELECT count(*) FROM p198 WHERE p198_estado = 'WAITING_ADVISOR' AND p198_request_type = 'RECHAZO_OPERATIVO_CON_CORRECCION') AS bucket_op_inconsistent,
  (SELECT count(*) FROM p198 WHERE p198_estado = 'CORRECTION_PENDING_REVIEW' AND public.asesor_inbox_correccion_explicacion(p198.id) IS NOT NULL) AS pending_review_with_expl,
  (SELECT count(*) FROM correction c JOIN public.expedientes e ON e.id = c.id WHERE e.subestado::text = 'rechazado' AND public.asesor_inbox_correccion_explicacion(c.id) IS NOT NULL) AS rechazado_mesa_with_expl;

DO $$
DECLARE
  v_asesor uuid := 'd3de310d-6833-4f75-bfcc-3d2bd9e8ff41';
  i int;
  v_t0 timestamptz;
  v_payload jsonb;
  v_ms double precision;
  v_times double precision[] := ARRAY[]::double precision[];
  v_rows int := 0;
  v_corr int := 0;
  v_empty int := 0;
BEGIN
  FOR i IN 1..8 LOOP
    PERFORM public.__p209_set_auth(v_asesor);
    v_t0 := clock_timestamp();
    v_payload := public.asesor_list_expedientes_page(
      1, 25, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'correccion_requerida'
    );
    PERFORM public.__p209_reset_auth();
    v_ms := extract(epoch from (clock_timestamp() - v_t0)) * 1000.0;
    v_times := array_append(v_times, v_ms);
    IF i = 1 THEN
      v_rows := jsonb_array_length(coalesce(v_payload->'items', '[]'::jsonb));
      SELECT count(*), count(*) FILTER (WHERE btrim(coalesce(it->>'correccion_explicacion','')) = '')
      INTO v_corr, v_empty
      FROM jsonb_array_elements(coalesce(v_payload->'items','[]'::jsonb)) it
      WHERE coalesce(it->>'estado_efectivo','') = 'correccion_requerida';
    END IF;
    RAISE NOTICE 'AFTER_TX iter=% ms=%', i, round(v_ms::numeric, 2);
  END LOOP;

  RAISE NOTICE 'AFTER_TX p50=% p95=% warmup=% rows=% corr_items=% empty_expl=%',
    round((SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY t) FROM unnest(v_times[2:8]) u(t))::numeric, 2),
    round((SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY t) FROM unnest(v_times[2:8]) u(t))::numeric, 2),
    round(v_times[1]::numeric, 2),
    v_rows, v_corr, v_empty;
END $$;

DO $$
BEGIN
  PERFORM public.__p209_set_auth('d3de310d-6833-4f75-bfcc-3d2bd9e8ff41'::uuid);
  RAISE NOTICE 'AFTER_TX EXPLAIN start';
END $$;

EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT public.asesor_list_expedientes_page(
  1, 25, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'correccion_requerida'
);

ROLLBACK;

SELECT
  EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'asesor_inbox_correccion_labels_vigentes'
  ) AS p209_labels_persisted,
  EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '209'
  ) AS mig_209_registered,
  (SELECT version FROM supabase_migrations.schema_migrations ORDER BY version::bigint DESC LIMIT 1) AS cloud_max;

DROP FUNCTION IF EXISTS public.__p209_set_auth(uuid);
DROP FUNCTION IF EXISTS public.__p209_reset_auth();
