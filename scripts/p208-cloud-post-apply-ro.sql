-- P208 post-apply read-only verification (NO smoke / NO writes).

-- Resolve Adriana/Hector + outsider same-org by email pattern (RO only).
WITH actors AS (
  SELECT id, email, full_name
  FROM public.profiles
  WHERE active = true
    AND app_role = 'asesor'
    AND (
      lower(email) LIKE '%adriana%reyes%'
      OR lower(email) LIKE '%hector%nunez%'
      OR lower(full_name) ILIKE '%adriana%reyes%'
      OR lower(full_name) ILIKE '%hector%nuñez%'
      OR lower(full_name) ILIKE '%hector%nunez%'
    )
),
silvia_leader AS (
  SELECT t.leader_id, t.id AS team_id, t.nombre
  FROM public.asesor_equipos t
  WHERE t.active = true
    AND (
      lower(t.nombre) LIKE '%silvia%'
      OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = t.leader_id
          AND (lower(p.full_name) LIKE '%silvia%reyes%' OR lower(p.email) LIKE '%silvia%')
      )
    )
  ORDER BY t.created_at DESC NULLS LAST
  LIMIT 1
),
team_member AS (
  SELECT m.asesor_id
  FROM public.asesor_equipo_miembros m
  JOIN silvia_leader sl ON sl.team_id = m.team_id
  WHERE m.active = true
    AND m.asesor_id <> sl.leader_id
  LIMIT 1
),
outsider AS (
  SELECT p.id
  FROM public.profiles p
  JOIN silvia_leader sl ON sl.leader_id IS NOT NULL
  JOIN public.asesor_equipos t ON t.id = sl.team_id
  WHERE p.active = true
    AND p.app_role = 'asesor'
    AND p.organization_id = t.organization_id
    AND NOT public.asesor_comparten_equipo_activo(p.id, sl.leader_id)
  LIMIT 1
)
SELECT jsonb_build_object(
  'migration_applied',
  EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20260901192000'),
  'adriana_hector_found', (SELECT count(*) FROM actors),
  'silvia_leader_id', (SELECT leader_id FROM silvia_leader),
  'team_member_sample', (SELECT asesor_id FROM team_member),
  'outsider_sample', (SELECT id FROM outsider)
) AS p208_post_meta;

-- Delegated scope matrix (helpers only).
DO $$
DECLARE
  v_adriana uuid;
  v_hector uuid;
  v_leader uuid;
  v_member uuid;
  v_outsider uuid;
  v_normal uuid;
BEGIN
  SELECT id INTO v_adriana FROM public.profiles
  WHERE active AND app_role = 'asesor'
    AND (lower(email) LIKE '%adriana%reyes%' OR lower(full_name) ILIKE '%adriana%reyes%')
  ORDER BY created_at LIMIT 1;

  SELECT id INTO v_hector FROM public.profiles
  WHERE active AND app_role = 'asesor'
    AND (lower(email) LIKE '%hector%nunez%' OR lower(full_name) ILIKE '%hector%')
  ORDER BY created_at LIMIT 1;

  SELECT t.leader_id INTO v_leader
  FROM public.asesor_equipos t
  WHERE t.active
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = t.leader_id AND lower(p.full_name) LIKE '%silvia%')
  LIMIT 1;

  SELECT m.asesor_id INTO v_member
  FROM public.asesor_equipo_miembros m
  JOIN public.asesor_equipos t ON t.id = m.team_id AND t.leader_id = v_leader
  WHERE m.active AND m.asesor_id <> v_leader
  LIMIT 1;

  SELECT p.id INTO v_outsider
  FROM public.profiles p
  JOIN public.asesor_equipos t ON t.leader_id = v_leader
  WHERE p.active AND p.app_role = 'asesor'
    AND p.organization_id = t.organization_id
    AND NOT public.asesor_comparten_equipo_activo(p.id, v_leader)
  LIMIT 1;

  SELECT m.asesor_id INTO v_normal
  FROM public.asesor_equipo_miembros m
  JOIN public.asesor_equipos t ON t.id = m.team_id AND t.leader_id = v_leader
  WHERE m.active
    AND m.asesor_id NOT IN (v_adriana, v_hector)
    AND NOT public.profile_has_capability(m.asesor_id, 'integrate_for_any_advisor')
  LIMIT 1;

  RAISE NOTICE 'P208 POST: adriana→leader=% member=% outsider=%',
    public.asesor_comparten_equipo_activo(v_adriana, v_leader),
    public.asesor_comparten_equipo_activo(v_adriana, v_member),
    public.asesor_comparten_equipo_activo(v_adriana, v_outsider);

  RAISE NOTICE 'P208 POST: hector→leader=% member=% outsider=%',
    public.asesor_comparten_equipo_activo(v_hector, v_leader),
    public.asesor_comparten_equipo_activo(v_hector, v_member),
    public.asesor_comparten_equipo_activo(v_hector, v_outsider);

  RAISE NOTICE 'P208 POST: normal delegate=% outsider=%',
    public.asesor_comparten_equipo_activo(v_normal, v_member),
    public.asesor_comparten_equipo_activo(v_normal, v_outsider);
END;
$$;
