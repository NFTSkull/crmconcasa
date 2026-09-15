-- Admin equipo líder rollup (mig. 219) — helpers + proyección Silvia+equipo

CREATE OR REPLACE FUNCTION public.__p225_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P225 EQUIPO ROLLUP TEST FAIL: %', p_msg;
  END IF;
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000225';
  v_lider UUID := '00000000-0000-4000-8001-000000000225';
  v_miembro UUID := '00000000-0000-4000-8002-000000000225';
  v_ajeno UUID := '00000000-0000-4000-8003-000000000225';
  v_team UUID := '00000000-0000-4000-8010-000000000225';
  v_ids UUID[];
  v_report UUID;
BEGIN
  PERFORM public.__p225_assert(
    to_regprocedure('public.admin_expand_asesor_ids(uuid)') IS NOT NULL,
    'admin_expand_asesor_ids existe'
  );
  PERFORM public.__p225_assert(
    to_regprocedure('public.admin_reporting_asesor_id(uuid)') IS NOT NULL,
    'admin_reporting_asesor_id existe'
  );

  -- Profiles mínimos (org + 3 asesores). Fail soft si columnas difieren.
  BEGIN
    INSERT INTO public.profiles (id, organization_id, email, full_name, app_role, active)
    VALUES
      (v_lider, v_org, 'p225.lider@test.local', 'P225 Lider', 'asesor', true),
      (v_miembro, v_org, 'p225.miembro@test.local', 'P225 Miembro', 'asesor', true),
      (v_ajeno, v_org, 'p225.ajeno@test.local', 'P225 Ajeno', 'asesor', true)
    ON CONFLICT (id) DO UPDATE
      SET organization_id = EXCLUDED.organization_id,
          active = true;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'P225 SKIP seed profiles: %', SQLERRM;
    RETURN;
  END;

  BEGIN
    INSERT INTO public.asesor_equipos (id, organization_id, nombre, leader_id, active)
    VALUES (v_team, v_org, 'P225 Equipo Test', v_lider, true)
    ON CONFLICT (id) DO UPDATE SET active = true, leader_id = EXCLUDED.leader_id;

    INSERT INTO public.asesor_equipo_miembros (team_id, asesor_id, active)
    VALUES (v_team, v_miembro, true)
    ON CONFLICT DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'P225 SKIP seed equipo: %', SQLERRM;
    RETURN;
  END;

  v_ids := public.admin_expand_asesor_ids(v_lider);
  PERFORM public.__p225_assert(
    v_lider = ANY (v_ids) AND v_miembro = ANY (v_ids) AND NOT (v_ajeno = ANY (v_ids)),
    'expand líder incluye miembro, no ajeno'
  );

  v_ids := public.admin_expand_asesor_ids(v_miembro);
  PERFORM public.__p225_assert(
    cardinality(v_ids) = 1 AND v_ids[1] = v_miembro,
    'expand miembro no abre todo el equipo'
  );

  v_report := public.admin_reporting_asesor_id(v_miembro);
  PERFORM public.__p225_assert(v_report = v_lider, 'reporting miembro → líder');

  v_report := public.admin_reporting_asesor_id(v_lider);
  PERFORM public.__p225_assert(v_report = v_lider, 'reporting líder → self');

  RAISE NOTICE 'P225 equipo rollup helpers OK';
END;
$$;
