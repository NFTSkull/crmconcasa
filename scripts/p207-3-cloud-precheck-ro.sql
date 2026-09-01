-- P207.3 Cloud pre-apply read-only checks.

SELECT jsonb_build_object(
  'p207_1_applied', EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260901164142'),
  'p207_2_applied', EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260901171420'),
  'p208_applied', EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260901192000'),
  'p207_3_applied', EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260901194500'),
  'list_has_etapa_lt_11_cambios', position('etapa_actual < 11' in pg_get_functiondef(p.oid)) > 0
) AS precheck
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'mesa_list_bandeja_page'
ORDER BY p.oid DESC
LIMIT 1;
