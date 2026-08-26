-- P210 Cloud BEFORE benchmark (P209 production). Single result row.
CREATE OR REPLACE FUNCTION public.__p210_bench_once()
RETURNS TABLE(ms double precision, row_count int)
LANGUAGE plpgsql AS $$
DECLARE
  v_t0 timestamptz := clock_timestamp();
  v_payload jsonb;
  v_rows int;
  v_asesor uuid := 'd3de310d-6833-4f75-bfcc-3d2bd9e8ff41';
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_asesor::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  v_payload := public.asesor_list_expedientes_page(
    1, 25, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'correccion_requerida'
  );
  PERFORM set_config('role', 'postgres', true);
  v_rows := jsonb_array_length(coalesce(v_payload->'items', '[]'::jsonb));
  ms := extract(epoch from (clock_timestamp() - v_t0)) * 1000.0;
  row_count := v_rows;
  RETURN NEXT;
END; $$;

SELECT jsonb_build_object(
  'phase', 'BEFORE',
  'p50_ms', percentile_cont(0.5) WITHIN GROUP (ORDER BY ms) FILTER (WHERE iter > 1),
  'p95_ms', percentile_cont(0.95) WITHIN GROUP (ORDER BY ms) FILTER (WHERE iter > 1),
  'warmup_ms', min(ms) FILTER (WHERE iter = 1),
  'rows_returned', max(row_count),
  'cloud_max', (SELECT max(version) FROM supabase_migrations.schema_migrations)
) AS before_bench
FROM (
  SELECT row_number() OVER () AS iter, b.ms, b.row_count
  FROM generate_series(1, 8) g(n)
  CROSS JOIN LATERAL public.__p210_bench_once() b
) s;

DROP FUNCTION public.__p210_bench_once();
