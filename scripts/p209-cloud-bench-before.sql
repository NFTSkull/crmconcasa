-- P209 BEFORE baseline (Cloud 208). Returns metrics row; no PII.

CREATE TEMP TABLE IF NOT EXISTS __p209_bench (
  phase text,
  iter int,
  ms double precision,
  row_count int
) ON COMMIT DROP;

TRUNCATE __p209_bench;

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

DO $$
DECLARE
  v_asesor uuid := 'd3de310d-6833-4f75-bfcc-3d2bd9e8ff41';
  i int;
  v_t0 timestamptz;
  v_payload jsonb;
  v_ms double precision;
  v_rows int := 0;
BEGIN
  FOR i IN 1..8 LOOP
    PERFORM public.__p209_set_auth(v_asesor);
    v_t0 := clock_timestamp();
    v_payload := public.asesor_list_expedientes_page(
      1, 25, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'correccion_requerida'
    );
    PERFORM public.__p209_reset_auth();
    v_ms := extract(epoch from (clock_timestamp() - v_t0)) * 1000.0;
    IF i = 1 THEN
      v_rows := jsonb_array_length(coalesce(v_payload->'items', '[]'::jsonb));
    END IF;
    INSERT INTO __p209_bench(phase, iter, ms, row_count)
    VALUES ('BEFORE', i, v_ms, CASE WHEN i = 1 THEN v_rows ELSE NULL END);
  END LOOP;
END $$;

SELECT
  'BEFORE' AS phase,
  max(row_count) AS rows_returned,
  round(min(ms) FILTER (WHERE iter = 1)::numeric, 2) AS warmup_ms,
  round((percentile_cont(0.5) WITHIN GROUP (ORDER BY ms) FILTER (WHERE iter > 1))::numeric, 2) AS p50_ms,
  round((percentile_cont(0.95) WITHIN GROUP (ORDER BY ms) FILTER (WHERE iter > 1))::numeric, 2) AS p95_ms,
  jsonb_agg(jsonb_build_object('iter', iter, 'ms', round(ms::numeric, 2)) ORDER BY iter) AS samples
FROM __p209_bench
WHERE phase = 'BEFORE';

DROP FUNCTION IF EXISTS public.__p209_set_auth(uuid);
DROP FUNCTION IF EXISTS public.__p209_reset_auth();
