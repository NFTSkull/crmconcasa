-- ConCasa CRM — pruebas P3M.1A RPC upsert_agenda_config_biometricos
-- Uso: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/rpc_upsert_agenda_config_biometricos.sql

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__rpc_uacb_test_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'RPC UACB TEST FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_uacb_test_set_auth(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_uacb_test_reset_auth()
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_uacb_test_standard_config()
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'enabled', true,
    'timezone', 'America/Monterrey',
    'min_lead_hours', 24,
    'allowed_weekdays', jsonb_build_array(1, 2, 3, 4, 5),
    'locations', jsonb_build_object(
      'mty-centro', jsonb_build_object(
        'enabled', true,
        'capacity_per_slot', 3,
        'label', 'Centro',
        'capacity_by_time', jsonb_build_object(
          '09:00', 3, '10:00', 3, '11:00', 3, '12:00', 3, '16:00', 3
        )
      ),
      'san-nicolas', jsonb_build_object(
        'enabled', true,
        'capacity_per_slot', 2,
        'capacity_by_time', jsonb_build_object(
          '09:00', 2, '10:00', 2, '11:00', 2, '12:00', 2, '16:00', 2
        )
      )
    ),
    'slots', jsonb_build_array('09:00', '10:00', '11:00', '12:00', '16:00')
  );
$$;

CREATE OR REPLACE FUNCTION public.__rpc_uacb_test_call_as(
  p_user_id UUID,
  p_config JSONB,
  p_organization_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_result JSONB;
BEGIN
  PERFORM public.__rpc_uacb_test_set_auth(p_user_id);
  SELECT public.upsert_agenda_config_biometricos(p_config, p_organization_id) INTO v_result;
  PERFORM public.__rpc_uacb_test_reset_auth();
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_uacb_test_expect_fail(
  p_user_id UUID,
  p_config JSONB,
  p_organization_id UUID DEFAULT NULL,
  p_msg_contains TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_err TEXT;
BEGIN
  PERFORM public.__rpc_uacb_test_set_auth(p_user_id);
  BEGIN
    PERFORM public.upsert_agenda_config_biometricos(p_config, p_organization_id);
    PERFORM public.__rpc_uacb_test_reset_auth();
    RETURN false;
  EXCEPTION
    WHEN OTHERS THEN
      v_err := SQLERRM;
      PERFORM public.__rpc_uacb_test_reset_auth();
      IF p_msg_contains IS NOT NULL AND position(p_msg_contains IN v_err) = 0 THEN
        RAISE EXCEPTION 'RPC UACB TEST FAIL: esperaba "%", obtuvo: %', p_msg_contains, v_err;
      END IF;
      RETURN true;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_uacb_test_book_as(
  p_user_id UUID,
  p_expediente_id UUID,
  p_scheduled_at TIMESTAMPTZ,
  p_location_id TEXT DEFAULT 'mty-centro'
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_result JSONB;
BEGIN
  PERFORM public.__rpc_uacb_test_set_auth(p_user_id);
  SELECT public.book_biometricos(
    p_expediente_id,
    p_scheduled_at,
    p_location_id,
    NULL
  ) INTO v_result;
  PERFORM public.__rpc_uacb_test_reset_auth();
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.__rpc_uacb_test_insert_expediente(
  p_id UUID,
  p_org_id UUID,
  p_asesor_id UUID,
  p_nss CHAR(11)
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, ciclo_estado
  ) VALUES (
    p_id, p_org_id, p_asesor_id, 'mejoravit', p_nss,
    'Fixture UACB', '5590000099', 'interno',
    true, NOW(), 4, 'en_proceso', 'activo'
  )
  ON CONFLICT (id) DO UPDATE SET
    organization_id = EXCLUDED.organization_id,
    asesor_id = EXCLUDED.asesor_id,
    submitted_to_mesa = true,
    etapa_actual = 4,
    ciclo_estado = 'activo',
    deleted_at = NULL,
    fecha_cita = NULL,
    updated_at = NOW();

  DELETE FROM public.agenda_bookings WHERE expediente_id = p_id;
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000001';
  v_org_b UUID := '00000000-0000-4000-8000-000000000099';
  v_mesa_admin UUID := '00000000-0000-4000-8003-000000000001';
  v_super_admin UUID := '00000000-0000-4000-8006-000000000001';
  v_asesor UUID := '00000000-0000-4000-8001-000000000001';
  v_mesa_interno UUID := '00000000-0000-4000-8004-000000000001';
  v_mesa_externo UUID := '00000000-0000-4000-8005-000000000001';
  v_exp UUID := '00000000-0000-4000-9100-000000000001';
  v_config JSONB;
  v_result JSONB;
  v_slot TIMESTAMPTZ;
  v_book JSONB;
BEGIN
  INSERT INTO public.organizations (id, slug, name, active)
  VALUES (v_org_b, 'fixture-uacb-b', 'Fixture UACB B', true)
  ON CONFLICT (id) DO UPDATE SET active = true, updated_at = NOW();

  DELETE FROM public.agenda_config
  WHERE organization_id IN (v_org, v_org_b) AND kind = 'biometricos';

  -- 1. mesa_admin upsert OK
  v_config := public.__rpc_uacb_test_standard_config();
  v_result := public.__rpc_uacb_test_call_as(v_mesa_admin, v_config);
  PERFORM public.__rpc_uacb_test_assert(
    (v_result->>'ok')::BOOLEAN = true
    AND (v_result->>'created')::BOOLEAN = true
    AND v_result->>'organization_id' = v_org::TEXT,
    'test 1: mesa_admin upsert OK'
  );

  -- 2. super_admin upsert OK (org propia)
  DELETE FROM public.agenda_config WHERE organization_id = v_org AND kind = 'biometricos';
  v_result := public.__rpc_uacb_test_call_as(v_super_admin, v_config);
  PERFORM public.__rpc_uacb_test_assert(
    (v_result->>'ok')::BOOLEAN = true AND (v_result->>'created')::BOOLEAN = true,
    'test 2: super_admin upsert OK'
  );

  -- 3. super_admin cross-org
  v_result := public.__rpc_uacb_test_call_as(v_super_admin, v_config, v_org_b);
  PERFORM public.__rpc_uacb_test_assert(
    (v_result->>'ok')::BOOLEAN = true
    AND v_result->>'organization_id' = v_org_b::TEXT,
    'test 3: super_admin cross-org'
  );

  -- 4. asesor bloqueado
  PERFORM public.__rpc_uacb_test_assert(
    public.__rpc_uacb_test_expect_fail(v_asesor, v_config, NULL, 'rol no autorizado'),
    'test 4: asesor bloqueado'
  );

  -- 5. mesa_interno bloqueado
  PERFORM public.__rpc_uacb_test_assert(
    public.__rpc_uacb_test_expect_fail(v_mesa_interno, v_config, NULL, 'rol no autorizado'),
    'test 5: mesa_interno bloqueado'
  );

  -- 6. mesa_externo bloqueado
  PERFORM public.__rpc_uacb_test_assert(
    public.__rpc_uacb_test_expect_fail(v_mesa_externo, v_config, NULL, 'rol no autorizado'),
    'test 6: mesa_externo bloqueado'
  );

  -- 7. JSON no objeto
  PERFORM public.__rpc_uacb_test_assert(
    public.__rpc_uacb_test_expect_fail(v_mesa_admin, '[]'::JSONB, NULL, 'debe ser un objeto'),
    'test 7: JSON no objeto'
  );

  -- 8. timezone inválido
  PERFORM public.__rpc_uacb_test_assert(
    public.__rpc_uacb_test_expect_fail(
      v_mesa_admin,
      v_config || jsonb_build_object('timezone', 'Not/A/Timezone'),
      NULL,
      'timezone inválido'
    ),
    'test 8: timezone inválido'
  );

  -- 9. weekdays inválidos
  PERFORM public.__rpc_uacb_test_assert(
    public.__rpc_uacb_test_expect_fail(
      v_mesa_admin,
      v_config || jsonb_build_object('allowed_weekdays', jsonb_build_array(0)),
      NULL,
      'allowed_weekdays fuera de rango'
    ),
    'test 9: weekdays inválidos'
  );

  -- 10. slots duplicados
  PERFORM public.__rpc_uacb_test_assert(
    public.__rpc_uacb_test_expect_fail(
      v_mesa_admin,
      v_config || jsonb_build_object('slots', jsonb_build_array('09:00', '09:00')),
      NULL,
      'slots con duplicados'
    ),
    'test 10: slots duplicados'
  );

  -- 11. slot inválido
  PERFORM public.__rpc_uacb_test_assert(
    public.__rpc_uacb_test_expect_fail(
      v_mesa_admin,
      v_config || jsonb_build_object('slots', jsonb_build_array('25:99')),
      NULL,
      'slot inválido'
    ),
    'test 11: slot inválido'
  );

  -- 12. locations vacío con enabled=true
  PERFORM public.__rpc_uacb_test_assert(
    public.__rpc_uacb_test_expect_fail(
      v_mesa_admin,
      v_config || jsonb_build_object('locations', '{}'::JSONB),
      NULL,
      'locations no puede estar vacío'
    ),
    'test 12: locations vacío enabled=true'
  );

  -- 13. capacity_per_slot < 1
  PERFORM public.__rpc_uacb_test_assert(
    public.__rpc_uacb_test_expect_fail(
      v_mesa_admin,
      jsonb_set(
        v_config,
        '{locations,mty-centro,capacity_per_slot}',
        '0'::JSONB
      ),
      NULL,
      'capacity_per_slot'
    ),
    'test 13: capacity < 1'
  );

  -- 14. segundo upsert created=false
  v_result := public.__rpc_uacb_test_call_as(v_mesa_admin, v_config);
  PERFORM public.__rpc_uacb_test_assert(
    (v_result->>'ok')::BOOLEAN = true AND (v_result->>'created')::BOOLEAN = false,
    'test 14: segundo upsert actualiza'
  );

  -- 15. config normalizada (min_lead_hours presente en retorno)
  PERFORM public.__rpc_uacb_test_assert(
    (v_result->'config'->>'min_lead_hours') IS NOT NULL
    AND jsonb_typeof(v_result->'config'->'slots') = 'array',
    'test 15: config normalizada'
  );

  -- 16. warnings sin bloquear (reduce slots con booking futuro)
  PERFORM public.__rpc_uacb_test_insert_expediente(
    v_exp, v_org, v_asesor, '94003400001'
  );
  v_slot := public.agenda_biometricos_slot_ts(1, '16:00', 7);
  v_book := public.__rpc_uacb_test_book_as(v_asesor, v_exp, v_slot, 'mty-centro');
  PERFORM public.__rpc_uacb_test_assert((v_book->>'ok')::BOOLEAN = true, 'test 16a: book previo OK');

  v_result := public.__rpc_uacb_test_call_as(
    v_mesa_admin,
    v_config || jsonb_build_object('slots', jsonb_build_array('09:00', '10:00'))
  );
  PERFORM public.__rpc_uacb_test_assert(
    (v_result->>'ok')::BOOLEAN = true
    AND jsonb_array_length(COALESCE(v_result->'warnings', '[]'::JSONB)) >= 1,
    'test 16b: warnings sin bloquear'
  );

  -- 17. book_biometricos usa config tras upsert
  DELETE FROM public.agenda_bookings WHERE expediente_id = v_exp;
  UPDATE public.expedientes SET fecha_cita = NULL WHERE id = v_exp;
  v_slot := public.agenda_biometricos_slot_ts(2, '10:00', 8);
  v_book := public.__rpc_uacb_test_book_as(v_asesor, v_exp, v_slot, 'mty-centro');
  PERFORM public.__rpc_uacb_test_assert(
    (v_book->>'ok')::BOOLEAN = true AND (v_book->>'kind') = 'biometricos',
    'test 17: book_biometricos post-upsert'
  );

  -- 18. mesa_admin cross-org bloqueado
  PERFORM public.__rpc_uacb_test_assert(
    public.__rpc_uacb_test_expect_fail(
      v_mesa_admin,
      v_config,
      v_org_b,
      'no puede configurar otra organización'
    ),
    'test 18: mesa_admin cross-org bloqueado'
  );

  -- Teardown: restaurar seed y limpiar fixtures para suites posteriores
  DELETE FROM public.agenda_bookings WHERE expediente_id = v_exp;
  DELETE FROM public.expediente_paso_visual_transiciones WHERE expediente_id = v_exp;
  DELETE FROM public.expedientes WHERE id = v_exp;

  UPDATE public.agenda_config
  SET config = '{"minLeadDays":2,"slotsPerDay":4}'::jsonb,
      updated_by = NULL,
      updated_at = NOW()
  WHERE organization_id = v_org
    AND kind = 'biometricos';

  -- Re-expand P124 capacity_by_time tras restaurar seed legacy (suites posteriores usan sede-centro).
  UPDATE public.agenda_config ac
  SET config = jsonb_set(
        ac.config,
        '{locations}',
        COALESCE((
          SELECT jsonb_object_agg(
            loc_id,
            CASE
              WHEN COALESCE((loc_cfg->>'enabled')::boolean, false) IS NOT TRUE THEN loc_cfg
              ELSE loc_cfg || jsonb_build_object(
                'capacity_by_time',
                (
                  SELECT COALESCE(jsonb_object_agg(slot, GREATEST(1, COALESCE((loc_cfg->>'capacity_per_slot')::int, 1))), '{}'::jsonb)
                  FROM jsonb_array_elements_text(COALESCE(ac.config->'slots', '[]'::jsonb)) AS slot
                )
              )
            END
          )
          FROM jsonb_each(COALESCE(ac.config->'locations', '{}'::jsonb)) AS x(loc_id, loc_cfg)
        ), '{}'::jsonb),
        true
      ),
      updated_at = NOW()
  WHERE ac.organization_id = v_org
    AND ac.kind = 'biometricos';

  DELETE FROM public.agenda_config
  WHERE organization_id = v_org_b
    AND kind = 'biometricos';

  RAISE NOTICE 'RPC upsert_agenda_config_biometricos: 18 pruebas OK';
END;
$$;

DROP FUNCTION IF EXISTS public.__rpc_uacb_test_insert_expediente(UUID, UUID, UUID, CHAR);
DROP FUNCTION IF EXISTS public.__rpc_uacb_test_book_as(UUID, UUID, TIMESTAMPTZ, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_uacb_test_expect_fail(UUID, JSONB, UUID, TEXT);
DROP FUNCTION IF EXISTS public.__rpc_uacb_test_call_as(UUID, JSONB, UUID);
DROP FUNCTION IF EXISTS public.__rpc_uacb_test_standard_config();
DROP FUNCTION IF EXISTS public.__rpc_uacb_test_reset_auth();
DROP FUNCTION IF EXISTS public.__rpc_uacb_test_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__rpc_uacb_test_assert(BOOLEAN, TEXT);
