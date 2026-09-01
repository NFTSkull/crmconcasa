-- P208 Cloud pre-apply read-only checks (no writes).

SELECT jsonb_build_object(
  'cloud_max_migration',
  (SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 1),
  'p208_already_applied',
  EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version = '20260901192000'
  ),
  'asesor_comparten_equipo_activo_exists',
  EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'asesor_comparten_equipo_activo'
  ),
  'asesor_can_operate_expediente_as_exists',
  EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'asesor_can_operate_expediente_as'
  )
) AS p208_precheck;

-- Caps: solo Adriana/Hector deben tener create+integrate activas (Cloud confirmado).
SELECT p.email, pc.capability, pc.active
FROM public.profile_capabilities pc
JOIN public.profiles p ON p.id = pc.profile_id
WHERE pc.capability IN ('create_for_any_advisor', 'integrate_for_any_advisor')
  AND pc.active = true
ORDER BY p.email, pc.capability;
