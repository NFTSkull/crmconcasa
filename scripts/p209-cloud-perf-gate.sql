-- P209 performance gate (single session). No PII in output.
-- Usage: npx supabase db query --linked -f scripts/p209-cloud-perf-gate.sql
\set ON_ERROR_STOP on

-- Representative asesor: most correction_required rows in Cloud RO (2026-08-25).
\set v_asesor 'd3de310d-6833-4f75-bfcc-3d2bd9e8ff41'

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

CREATE OR REPLACE FUNCTION public.__p209_bench_once()
RETURNS TABLE(ms double precision, row_count int)
LANGUAGE plpgsql AS $$
DECLARE
  v_t0 timestamptz := clock_timestamp();
  v_payload jsonb;
  v_rows int;
BEGIN
  PERFORM public.__p209_set_auth(:'v_asesor'::uuid);
  v_payload := public.asesor_list_expedientes_page(1, 25, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'correccion_requerida');
  PERFORM public.__p209_reset_auth();
  v_rows := jsonb_array_length(coalesce(v_payload->'items', '[]'::jsonb));
  ms := extract(epoch from (clock_timestamp() - v_t0)) * 1000.0;
  row_count := v_rows;
  RETURN NEXT;
END; $$;

CREATE OR REPLACE FUNCTION public.__p209_run_bench(p_label text, p_iters int DEFAULT 8)
RETURNS TABLE(label text, iter int, ms double precision, row_count int)
LANGUAGE plpgsql AS $$
DECLARE
  i int;
  r record;
BEGIN
  FOR i IN 1..p_iters LOOP
    SELECT * INTO r FROM public.__p209_bench_once();
    label := p_label;
    iter := i;
    ms := r.ms;
    row_count := r.row_count;
    RETURN NEXT;
  END LOOP;
END; $$;

CREATE OR REPLACE FUNCTION public.__p209_percentile(p_vals double precision[], p_p numeric)
RETURNS double precision LANGUAGE sql IMMUTABLE AS $$
  SELECT percentile_cont(p_p) WITHIN GROUP (ORDER BY v)
  FROM unnest(p_vals) AS u(v);
$$;

-- BEFORE baseline (Cloud 208)
SELECT 'BEFORE' AS phase, b.*
FROM (
  SELECT
    public.__p209_percentile(array_agg(ms ORDER BY iter) FILTER (WHERE iter > 1), 0.5) AS p50_ms,
    public.__p209_percentile(array_agg(ms ORDER BY iter) FILTER (WHERE iter > 1), 0.95) AS p95_ms,
    min(ms) FILTER (WHERE iter = 1) AS warmup_ms,
    max(row_count) AS rows_returned
  FROM public.__p209_run_bench('before', 8)
) b;

-- EXPLAIN BEFORE (no item payload)
DO $$
DECLARE
  v_plan text;
BEGIN
  PERFORM public.__p209_set_auth('d3de310d-6833-4f75-bfcc-3d2bd9e8ff41'::uuid);
  EXECUTE $q$
    EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
    SELECT public.asesor_list_expedientes_page(1, 25, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'correccion_requerida')
  $q$;
  PERFORM public.__p209_reset_auth();
  RAISE NOTICE 'BEFORE EXPLAIN emitted above';
END $$;

BEGIN;

\echo 'Applying P209 DDL in transaction (no schema_migrations)...'
\ir ../supabase/migrations/209_asesor_inbox_correccion_explicacion.sql

-- TX invariants (aggregate only)
WITH correction AS (
  SELECT e.id
  FROM public.expedientes e
  WHERE e.deleted_at IS NULL
    AND public.asesor_inbox_estado_efectivo(e.id) = 'correccion_requerida'
),
expl AS (
  SELECT
    c.id,
    public.asesor_inbox_correccion_explicacion(c.id) AS explanation
  FROM correction c
)
SELECT
  (SELECT count(*) FROM correction) AS total_correction_required,
  (SELECT count(*) FROM expl WHERE explanation IS NOT NULL) AS explanation_non_null,
  (SELECT count(*) FROM expl WHERE btrim(coalesce(explanation, '')) <> '') AS explanation_non_empty,
  (SELECT count(*) FROM expl WHERE explanation LIKE '%Abre el expediente para revisar el detalle%') AS fallback_count;

-- AFTER benchmark inside TX
SELECT 'AFTER_TX' AS phase, a.*
FROM (
  SELECT
    public.__p209_percentile(array_agg(ms ORDER BY iter) FILTER (WHERE iter > 1), 0.5) AS p50_ms,
    public.__p209_percentile(array_agg(ms ORDER BY iter) FILTER (WHERE iter > 1), 0.95) AS p95_ms,
    min(ms) FILTER (WHERE iter = 1) AS warmup_ms,
    max(row_count) AS rows_returned
  FROM public.__p209_run_bench('after_tx', 8)
) a;

DO $$
BEGIN
  PERFORM public.__p209_set_auth('d3de310d-6833-4f75-bfcc-3d2bd9e8ff41'::uuid);
  EXECUTE $q$
    EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
    SELECT public.asesor_list_expedientes_page(1, 25, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'correccion_requerida')
  $q$;
  PERFORM public.__p209_reset_auth();
  RAISE NOTICE 'AFTER_TX EXPLAIN emitted above';
END $$;

ROLLBACK;

-- Post-rollback leak check
SELECT
  EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'asesor_inbox_correccion_labels_vigentes'
  ) AS p209_labels_persisted,
  EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '209'
  ) AS mig_209_registered;

DROP FUNCTION IF EXISTS public.__p209_run_bench(text, int);
DROP FUNCTION IF EXISTS public.__p209_bench_once();
DROP FUNCTION IF EXISTS public.__p209_percentile(double precision[], numeric);
DROP FUNCTION IF EXISTS public.__p209_set_auth(uuid);
DROP FUNCTION IF EXISTS public.__p209_reset_auth();
