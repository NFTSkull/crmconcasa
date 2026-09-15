-- Admin: buscar líder → equipo + stage history expand (mig. 226)

CREATE OR REPLACE FUNCTION public.__p226_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P226 BUSCAR/STAGE EXPAND TEST FAIL: %', p_msg;
  END IF;
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000226';
  v_lider UUID := '00000000-0000-4000-8001-000000000226';
  v_miembro UUID := '00000000-0000-4000-8002-000000000226';
  v_ajeno UUID := '00000000-0000-4000-8003-000000000226';
  v_team UUID := '00000000-0000-4000-8010-000000000226';
  v_ids UUID[];
BEGIN
  PERFORM public.__p226_assert(
    to_regprocedure('public.admin_asesor_ids_matching_buscar(text)') IS NOT NULL,
    'admin_asesor_ids_matching_buscar existe'
  );
  PERFORM public.__p226_assert(
    position(
      'admin_asesor_ids_matching_buscar' in
      pg_get_functiondef('public.admin_expedientes_snapshot_etapas(uuid,text,text)'::regprocedure)
    ) > 0,
    'snapshot etapas usa matching_buscar'
  );
  PERFORM public.__p226_assert(
    position(
      'admin_expand_asesor_ids' in
      pg_get_functiondef(
        'public.admin_stage_history_report_summary(uuid[],smallint[],text,date,date,text,text)'::regprocedure
      )
    ) > 0,
    'stage history summary expande p_asesor_ids'
  );

  BEGIN
    INSERT INTO public.profiles (id, organization_id, email, full_name, app_role, active)
    VALUES
      (v_lider, v_org, 'p226.lider@test.local', 'P226 Lider Rollup', 'asesor', true),
      (v_miembro, v_org, 'p226.miembro@test.local', 'P226 Miembro Rollup', 'asesor', true),
      (v_ajeno, v_org, 'p226.ajeno@test.local', 'P226 Ajeno Rollup', 'asesor', true)
    ON CONFLICT (id) DO UPDATE
      SET organization_id = EXCLUDED.organization_id,
          full_name = EXCLUDED.full_name,
          active = true;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'P226 SKIP seed profiles: %', SQLERRM;
    RETURN;
  END;

  BEGIN
    INSERT INTO public.asesor_equipos (id, organization_id, nombre, leader_id, active)
    VALUES (v_team, v_org, 'P226 Equipo Test', v_lider, true)
    ON CONFLICT (id) DO UPDATE SET active = true, leader_id = EXCLUDED.leader_id;

    INSERT INTO public.asesor_equipo_miembros (team_id, asesor_id, active)
    VALUES (v_team, v_miembro, true)
    ON CONFLICT DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'P226 SKIP seed equipo: %', SQLERRM;
    RETURN;
  END;

  v_ids := public.admin_asesor_ids_matching_buscar('P226 Lider');
  PERFORM public.__p226_assert(
    v_lider = ANY (v_ids) AND v_miembro = ANY (v_ids) AND NOT (v_ajeno = ANY (v_ids)),
    'buscar nombre líder incluye miembro, no ajeno'
  );

  v_ids := public.admin_asesor_ids_matching_buscar('P226 Miembro');
  PERFORM public.__p226_assert(
    v_miembro = ANY (v_ids) AND NOT (v_lider = ANY (v_ids)),
    'buscar miembro no abre el equipo del líder'
  );

  RAISE NOTICE 'P226 buscar/stage expand OK';
END;
$$;
