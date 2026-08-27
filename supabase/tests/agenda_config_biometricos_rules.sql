-- ConCasa CRM — pruebas P2C-11 agenda_config biométricos
-- Uso: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/agenda_config_biometricos_rules.sql

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__agenda_cfg_test_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'AGENDA CFG TEST FAIL: %', p_msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__agenda_cfg_test_set_auth(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__agenda_cfg_test_reset_auth()
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__agenda_cfg_test_slot_ts(
  p_iso_dow INTEGER,
  p_slot TEXT,
  p_min_days INTEGER DEFAULT 3,
  p_tz TEXT DEFAULT 'America/Monterrey'
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_date DATE;
  v_hour INTEGER;
  v_minute INTEGER;
  v_parts TEXT[];
BEGIN
  v_date := ((NOW() AT TIME ZONE p_tz)::DATE + p_min_days);
  WHILE EXTRACT(ISODOW FROM v_date)::INTEGER <> p_iso_dow LOOP
    v_date := v_date + 1;
  END LOOP;

  v_parts := regexp_split_to_array(p_slot, ':');
  v_hour := v_parts[1]::INTEGER;
  v_minute := v_parts[2]::INTEGER;

  RETURN (v_date + make_time(v_hour, v_minute, 0)) AT TIME ZONE p_tz;
END;
$$;

CREATE OR REPLACE FUNCTION public.__agenda_cfg_test_standard_config()
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

CREATE OR REPLACE FUNCTION public.__agenda_cfg_test_upsert_org(
  p_org_id UUID,
  p_slug TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.organizations (id, slug, name, active)
  VALUES (p_org_id, p_slug, 'Fixture Agenda Config', true)
  ON CONFLICT (id) DO UPDATE SET active = true, updated_at = NOW();
END;
$$;

CREATE OR REPLACE FUNCTION public.__agenda_cfg_test_upsert_asesor(
  p_profile_id UUID,
  p_org_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.profiles (
    id, organization_id, email, full_name, app_role, tipo_asesor_origen, active
  ) VALUES (
    p_profile_id, p_org_id,
    'fixture.agenda.' || p_profile_id::text || '@concasa.local',
    'Fixture Agenda Asesor', 'asesor', 'interno', true
  )
  ON CONFLICT (id) DO UPDATE SET
    organization_id = EXCLUDED.organization_id,
    app_role = 'asesor',
    active = true,
    updated_at = NOW();
END;
$$;

CREATE OR REPLACE FUNCTION public.__agenda_cfg_test_upsert_config(
  p_org_id UUID,
  p_config JSONB
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.agenda_config (organization_id, kind, config)
  VALUES (p_org_id, 'biometricos', p_config)
  ON CONFLICT (organization_id, kind) DO UPDATE SET
    config = EXCLUDED.config,
    updated_at = NOW();
END;
$$;

CREATE OR REPLACE FUNCTION public.__agenda_cfg_test_insert_expediente(
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
    'Fixture Agenda Config', '5590000000', 'interno',
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

CREATE OR REPLACE FUNCTION public.__agenda_cfg_test_call_book(
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
  PERFORM public.__agenda_cfg_test_set_auth(p_user_id);
  SELECT public.book_biometricos(p_expediente_id, p_scheduled_at, p_location_id) INTO v_result;
  PERFORM public.__agenda_cfg_test_reset_auth();
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.__agenda_cfg_test_expect_book_fail(
  p_user_id UUID,
  p_expediente_id UUID,
  p_scheduled_at TIMESTAMPTZ,
  p_location_id TEXT DEFAULT 'mty-centro',
  p_msg_contains TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_err TEXT;
BEGIN
  PERFORM public.__agenda_cfg_test_set_auth(p_user_id);
  BEGIN
    PERFORM public.book_biometricos(p_expediente_id, p_scheduled_at, p_location_id);
    PERFORM public.__agenda_cfg_test_reset_auth();
    RETURN false;
  EXCEPTION
    WHEN OTHERS THEN
      v_err := SQLERRM;
      PERFORM public.__agenda_cfg_test_reset_auth();
      IF p_msg_contains IS NOT NULL AND position(p_msg_contains IN v_err) = 0 THEN
        RAISE EXCEPTION 'AGENDA CFG TEST FAIL: esperaba "%", obtuvo: %', p_msg_contains, v_err;
      END IF;
      RETURN true;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.__agenda_cfg_test_call_reagendar(
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
  PERFORM public.__agenda_cfg_test_set_auth(p_user_id);
  SELECT public.reagendar_biometricos(p_expediente_id, p_scheduled_at, p_location_id) INTO v_result;
  PERFORM public.__agenda_cfg_test_reset_auth();
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.__agenda_cfg_test_expect_reagendar_fail(
  p_user_id UUID,
  p_expediente_id UUID,
  p_scheduled_at TIMESTAMPTZ,
  p_location_id TEXT DEFAULT 'mty-centro',
  p_msg_contains TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_err TEXT;
BEGIN
  PERFORM public.__agenda_cfg_test_set_auth(p_user_id);
  BEGIN
    PERFORM public.reagendar_biometricos(p_expediente_id, p_scheduled_at, p_location_id);
    PERFORM public.__agenda_cfg_test_reset_auth();
    RETURN false;
  EXCEPTION
    WHEN OTHERS THEN
      v_err := SQLERRM;
      PERFORM public.__agenda_cfg_test_reset_auth();
      IF p_msg_contains IS NOT NULL AND position(p_msg_contains IN v_err) = 0 THEN
        RAISE EXCEPTION 'AGENDA CFG TEST FAIL: esperaba "%", obtuvo: %', p_msg_contains, v_err;
      END IF;
      RETURN true;
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.__agenda_cfg_test_insert_booking(
  p_expediente_id UUID,
  p_org_id UUID,
  p_asesor_id UUID,
  p_date DATE,
  p_time TIME,
  p_location_id TEXT,
  p_status public.booking_status DEFAULT 'booked'
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.agenda_bookings (
    organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, created_by, cancelled_at
  ) VALUES (
    p_org_id, 'biometricos', p_expediente_id, p_date, p_time,
    p_location_id, p_status, p_asesor_id,
    CASE WHEN p_status = 'cancelled' THEN NOW() ELSE NULL END
  );
END;
$$;

DO $$
DECLARE
  v_org_strict UUID := '00000000-0000-4000-8013-000000000001';
  v_org_no_cfg UUID := '00000000-0000-4000-8013-000000000002';
  v_asesor UUID := '00000000-0000-4000-8013-000000000101';
  v_asesor_no_cfg UUID := '00000000-0000-4000-8013-000000000102';

  v_exp_base UUID := '00000000-0000-4000-9013-000000000010';
  v_exp_cfg UUID := '00000000-0000-4000-9013-000000000020';
  v_exp_lead UUID := '00000000-0000-4000-9013-000000000030';
  v_exp_dow UUID := '00000000-0000-4000-9013-000000000040';
  v_exp_slot UUID := '00000000-0000-4000-9013-000000000050';
  v_exp_loc UUID := '00000000-0000-4000-9013-000000000060';
  v_exp_cap1 UUID := '00000000-0000-4000-9013-000000000071';
  v_exp_cap2 UUID := '00000000-0000-4000-9013-000000000072';
  v_exp_cap3 UUID := '00000000-0000-4000-9013-000000000073';
  v_exp_cap4 UUID := '00000000-0000-4000-9013-000000000074';
  v_exp_cancel UUID := '00000000-0000-4000-9013-000000000080';
  v_exp_loc_ind UUID := '00000000-0000-4000-9013-000000000090';
  v_exp_hour UUID := '00000000-0000-4000-9013-000000000100';
  v_exp_date UUID := '00000000-0000-4000-9013-000000000110';
  v_exp_book UUID := '00000000-0000-4000-9013-000000000120';
  v_exp_dup UUID := '00000000-0000-4000-9013-000000000130';
  v_exp_reag UUID := '00000000-0000-4000-9013-000000000140';
  v_exp_reag_full UUID := '00000000-0000-4000-9013-000000000150';
  v_exp_reag_move UUID := '00000000-0000-4000-9013-000000000160';
  v_exp_reag_free UUID := '00000000-0000-4000-9013-000000000170';
  v_exp_reag_etapa UUID := '00000000-0000-4000-9013-000000000180';
  v_exp_legacy UUID := '00000000-0000-4000-9013-000000000190';

  v_org_legacy UUID := '00000000-0000-4000-8000-000000000001';
  v_asesor_legacy UUID := '00000000-0000-4000-8001-000000000001';

  v_slot_mon10 TIMESTAMPTZ;
  v_slot_sat10 TIMESTAMPTZ;
  v_slot_mon11 TIMESTAMPTZ;
  v_slot_mon16 TIMESTAMPTZ;
  v_slot_tue10 TIMESTAMPTZ;
  v_slot_full TIMESTAMPTZ;
  v_slot_other TIMESTAMPTZ;
  v_slot_move TIMESTAMPTZ;
  v_seed_config JSONB;
  v_booking_date DATE;
  v_booking_time TIME;
  v_result JSONB;
  v_roles_revisor INTEGER;
  i INTEGER;
BEGIN
  PERFORM public.__agenda_cfg_test_upsert_org(v_org_strict, 'fixture-agenda-strict');
  PERFORM public.__agenda_cfg_test_upsert_org(v_org_no_cfg, 'fixture-agenda-no-cfg');
  PERFORM public.__agenda_cfg_test_upsert_asesor(v_asesor, v_org_strict);
  PERFORM public.__agenda_cfg_test_upsert_asesor(v_asesor_no_cfg, v_org_no_cfg);
  PERFORM public.__agenda_cfg_test_upsert_config(
    v_org_strict, public.__agenda_cfg_test_standard_config()
  );

  DELETE FROM public.agenda_config WHERE organization_id = v_org_no_cfg AND kind = 'biometricos';

  v_slot_mon10 := public.__agenda_cfg_test_slot_ts(1, '10:00', 3);
  v_slot_sat10 := public.__agenda_cfg_test_slot_ts(6, '10:00', 3);
  v_slot_mon11 := public.__agenda_cfg_test_slot_ts(1, '11:00', 3);
  v_slot_mon16 := public.__agenda_cfg_test_slot_ts(1, '16:00', 3);
  v_slot_tue10 := public.__agenda_cfg_test_slot_ts(2, '10:00', 4);

  PERFORM public.__agenda_cfg_test_insert_expediente(v_exp_base, v_org_strict, v_asesor, '91301000001');

  -- 0a. Seed legacy normalizado (trigger + sin minLeadDays en config persistida)
  SELECT ac.config
  INTO v_seed_config
  FROM public.agenda_config ac
  WHERE ac.organization_id = v_org_legacy
    AND ac.kind = 'biometricos';

  PERFORM public.__agenda_cfg_test_assert(v_seed_config IS NOT NULL, 'test 0a exists');
  PERFORM public.__agenda_cfg_test_assert(
    (v_seed_config->>'min_lead_hours')::INTEGER = 48,
    'test 0a min_lead_hours'
  );
  PERFORM public.__agenda_cfg_test_assert(
    NOT (v_seed_config ? 'minLeadDays'),
    'test 0a sin minLeadDays'
  );
  PERFORM public.__agenda_cfg_test_assert(
    v_seed_config->'locations' ? 'sede-centro',
    'test 0a sede-centro'
  );
  PERFORM public.__agenda_cfg_test_assert(
    jsonb_array_length(v_seed_config->'slots') >= 4,
    'test 0a slots'
  );

  -- 0b. minLeadDays:2 → min_lead_hours:48 (cubierto en 0a)

  -- 0c. locations vacío falla
  PERFORM public.__agenda_cfg_test_upsert_config(
    v_org_strict,
    public.__agenda_cfg_test_standard_config() || jsonb_build_object('locations', '{}'::JSONB)
  );
  PERFORM public.__agenda_cfg_test_assert(
    public.__agenda_cfg_test_expect_book_fail(
      v_asesor, v_exp_base, v_slot_mon10, 'mty-centro',
      'agenda_config: sedes no configuradas'
    ),
    'test 0c'
  );

  -- 0d. slots vacío falla
  PERFORM public.__agenda_cfg_test_upsert_config(
    v_org_strict,
    public.__agenda_cfg_test_standard_config() || jsonb_build_object('slots', '[]'::JSONB)
  );
  PERFORM public.__agenda_cfg_test_assert(
    public.__agenda_cfg_test_expect_book_fail(
      v_asesor, v_exp_base, v_slot_mon10, 'mty-centro',
      'agenda_config: horario'
    ),
    'test 0d'
  );

  -- 0e. allowed_weekdays vacío falla
  PERFORM public.__agenda_cfg_test_upsert_config(
    v_org_strict,
    public.__agenda_cfg_test_standard_config() || jsonb_build_object('allowed_weekdays', '[]'::JSONB)
  );
  PERFORM public.__agenda_cfg_test_assert(
    public.__agenda_cfg_test_expect_book_fail(
      v_asesor, v_exp_base, v_slot_mon10, 'mty-centro',
      'agenda_config: días no configurados'
    ),
    'test 0e'
  );
  PERFORM public.__agenda_cfg_test_upsert_config(
    v_org_strict, public.__agenda_cfg_test_standard_config()
  );

  -- 0f. sede arbitraria bloqueada tras normalización seed
  PERFORM public.__agenda_cfg_test_assert(
    public.__agenda_cfg_test_expect_book_fail(
      v_asesor, v_exp_base, v_slot_mon10, 'sede-arbitraria',
      'agenda_config: sede no permitida'
    ),
    'test 0f'
  );

  -- 0g. hora arbitraria bloqueada
  PERFORM public.__agenda_cfg_test_assert(
    public.__agenda_cfg_test_expect_book_fail(
      v_asesor, v_exp_base, v_slot_mon10 + INTERVAL '30 minutes', 'mty-centro',
      'agenda_config: horario no permitido'
    ),
    'test 0g'
  );

  PERFORM public.__agenda_cfg_test_insert_expediente(v_exp_cfg, v_org_no_cfg, v_asesor_no_cfg, '91302000002');
  PERFORM public.__agenda_cfg_test_insert_expediente(v_exp_lead, v_org_strict, v_asesor, '91303000003');
  PERFORM public.__agenda_cfg_test_insert_expediente(v_exp_dow, v_org_strict, v_asesor, '91304000004');
  PERFORM public.__agenda_cfg_test_insert_expediente(v_exp_slot, v_org_strict, v_asesor, '91305000005');
  PERFORM public.__agenda_cfg_test_insert_expediente(v_exp_loc, v_org_strict, v_asesor, '91306000006');
  PERFORM public.__agenda_cfg_test_insert_expediente(v_exp_cap1, v_org_strict, v_asesor, '91307000007');
  PERFORM public.__agenda_cfg_test_insert_expediente(v_exp_cap2, v_org_strict, v_asesor, '91307000008');
  PERFORM public.__agenda_cfg_test_insert_expediente(v_exp_cap3, v_org_strict, v_asesor, '91307000009');
  PERFORM public.__agenda_cfg_test_insert_expediente(v_exp_cap4, v_org_strict, v_asesor, '91307000010');
  PERFORM public.__agenda_cfg_test_insert_expediente(v_exp_cancel, v_org_strict, v_asesor, '91308000011');
  PERFORM public.__agenda_cfg_test_insert_expediente(v_exp_loc_ind, v_org_strict, v_asesor, '91309000012');
  PERFORM public.__agenda_cfg_test_insert_expediente(v_exp_hour, v_org_strict, v_asesor, '91310000013');
  PERFORM public.__agenda_cfg_test_insert_expediente(v_exp_date, v_org_strict, v_asesor, '91311000014');
  PERFORM public.__agenda_cfg_test_insert_expediente(v_exp_book, v_org_strict, v_asesor, '91312000015');
  PERFORM public.__agenda_cfg_test_insert_expediente(v_exp_dup, v_org_strict, v_asesor, '91313000016');
  PERFORM public.__agenda_cfg_test_insert_expediente(v_exp_reag, v_org_strict, v_asesor, '91314000017');
  PERFORM public.__agenda_cfg_test_insert_expediente(v_exp_reag_full, v_org_strict, v_asesor, '91315000018');
  PERFORM public.__agenda_cfg_test_insert_expediente(v_exp_reag_move, v_org_strict, v_asesor, '91316000019');
  PERFORM public.__agenda_cfg_test_insert_expediente(v_exp_reag_free, v_org_strict, v_asesor, '91317000020');
  PERFORM public.__agenda_cfg_test_insert_expediente(v_exp_reag_etapa, v_org_strict, v_asesor, '91318000021');
  PERFORM public.__agenda_cfg_test_insert_expediente(v_exp_legacy, v_org_legacy, v_asesor_legacy, '91319000022');

  -- 1. Sin agenda_config
  PERFORM public.__agenda_cfg_test_assert(
    public.__agenda_cfg_test_expect_book_fail(
      v_asesor_no_cfg, v_exp_cfg, v_slot_mon10, 'mty-centro',
      'agenda_config: configuración biométricos no encontrada'
    ),
    'test 1'
  );

  -- 2. enabled = false
  PERFORM public.__agenda_cfg_test_upsert_config(
    v_org_strict, public.__agenda_cfg_test_standard_config() || jsonb_build_object('enabled', false)
  );
  PERFORM public.__agenda_cfg_test_assert(
    public.__agenda_cfg_test_expect_book_fail(
      v_asesor, v_exp_base, v_slot_mon10, 'mty-centro',
      'agenda_config: agenda biométricos deshabilitada'
    ),
    'test 2'
  );
  PERFORM public.__agenda_cfg_test_upsert_config(
    v_org_strict, public.__agenda_cfg_test_standard_config()
  );

  -- 3. Timezone America/Monterrey
  v_result := public.__agenda_cfg_test_call_book(v_asesor, v_exp_book, v_slot_mon10, 'mty-centro');
  v_booking_date := (v_result->>'booking_date')::DATE;
  v_booking_time := (v_result->>'booking_time')::TIME;
  PERFORM public.__agenda_cfg_test_assert(
    v_booking_date = (v_slot_mon10 AT TIME ZONE 'America/Monterrey')::DATE,
    'test 3 date'
  );
  PERFORM public.__agenda_cfg_test_assert(
    to_char(v_booking_time, 'HH24:MI') = '10:00',
    'test 3 time'
  );

  -- 4-5. Anticipación mínima
  PERFORM public.__agenda_cfg_test_assert(
    public.__agenda_cfg_test_expect_book_fail(
      v_asesor, v_exp_lead, NOW() + INTERVAL '12 hours', 'mty-centro',
      'agenda_config: fecha no cumple anticipación mínima'
    ),
    'test 4'
  );
  v_result := public.__agenda_cfg_test_call_book(v_asesor, v_exp_lead, v_slot_mon11, 'mty-centro');
  PERFORM public.__agenda_cfg_test_assert((v_result->>'ok')::BOOLEAN, 'test 5');

  -- 6-7. Días permitidos
  PERFORM public.__agenda_cfg_test_assert(
    public.__agenda_cfg_test_expect_book_fail(
      v_asesor, v_exp_dow, v_slot_sat10, 'mty-centro',
      'agenda_config: día no permitido'
    ),
    'test 6'
  );
  v_result := public.__agenda_cfg_test_call_book(v_asesor, v_exp_dow, v_slot_mon16, 'mty-centro');
  PERFORM public.__agenda_cfg_test_assert((v_result->>'ok')::BOOLEAN, 'test 7');

  -- 8-9. Slots
  PERFORM public.__agenda_cfg_test_assert(
    public.__agenda_cfg_test_expect_book_fail(
      v_asesor, v_exp_slot, v_slot_mon10 + INTERVAL '30 minutes', 'mty-centro',
      'agenda_config: horario no permitido'
    ),
    'test 8'
  );
  v_result := public.__agenda_cfg_test_call_book(v_asesor, v_exp_slot, v_slot_mon10, 'mty-centro');
  PERFORM public.__agenda_cfg_test_assert((v_result->>'ok')::BOOLEAN, 'test 9');

  -- 10-12. Sedes
  PERFORM public.__agenda_cfg_test_assert(
    public.__agenda_cfg_test_expect_book_fail(
      v_asesor, v_exp_loc, v_slot_tue10, 'sede-inexistente',
      'agenda_config: sede no permitida'
    ),
    'test 10'
  );
  PERFORM public.__agenda_cfg_test_upsert_config(
    v_org_strict,
    jsonb_set(
      public.__agenda_cfg_test_standard_config(),
      '{locations,mty-centro,enabled}',
      'false'::JSONB
    )
  );
  PERFORM public.__agenda_cfg_test_assert(
    public.__agenda_cfg_test_expect_book_fail(
      v_asesor, v_exp_loc, v_slot_tue10, 'mty-centro',
      'agenda_config: sede deshabilitada'
    ),
    'test 11'
  );
  PERFORM public.__agenda_cfg_test_upsert_config(
    v_org_strict, public.__agenda_cfg_test_standard_config()
  );
  v_result := public.__agenda_cfg_test_call_book(v_asesor, v_exp_loc, v_slot_tue10, 'san-nicolas');
  PERFORM public.__agenda_cfg_test_assert((v_result->>'ok')::BOOLEAN, 'test 12');

  -- 13-14. Cupo máximo
  v_slot_mon10 := public.__agenda_cfg_test_slot_ts(1, '09:00', 5);
  PERFORM public.__agenda_cfg_test_call_book(v_asesor, v_exp_cap1, v_slot_mon10, 'mty-centro');
  PERFORM public.__agenda_cfg_test_call_book(v_asesor, v_exp_cap2, v_slot_mon10, 'mty-centro');
  PERFORM public.__agenda_cfg_test_call_book(v_asesor, v_exp_cap3, v_slot_mon10, 'mty-centro');
  PERFORM public.__agenda_cfg_test_assert(
    public.__agenda_cfg_test_expect_book_fail(
      v_asesor, v_exp_cap4, v_slot_mon10, 'mty-centro',
      'agenda_config: cupo agotado'
    ),
    'test 14'
  );
  PERFORM public.__agenda_cfg_test_assert(
    public.agenda_biometricos_count_slot_booked(
      v_org_strict,
      (v_slot_mon10 AT TIME ZONE 'America/Monterrey')::DATE,
      '09:00:00'::TIME,
      'mty-centro'
    ) = 3,
    'test 13'
  );

  -- 15-16. Solo booked cuenta; cancelled no
  PERFORM public.__agenda_cfg_test_insert_booking(
    v_exp_cancel, v_org_strict, v_asesor,
    (v_slot_mon10 AT TIME ZONE 'America/Monterrey')::DATE,
    '09:00:00'::TIME,
    'mty-centro',
    'cancelled'
  );
  PERFORM public.__agenda_cfg_test_assert(
    public.agenda_biometricos_count_slot_booked(
      v_org_strict,
      (v_slot_mon10 AT TIME ZONE 'America/Monterrey')::DATE,
      '09:00:00'::TIME,
      'mty-centro'
    ) = 3,
    'test 15-16'
  );

  -- 17. Cupo independiente por sede
  v_result := public.__agenda_cfg_test_call_book(v_asesor, v_exp_loc_ind, v_slot_mon10, 'san-nicolas');
  PERFORM public.__agenda_cfg_test_assert((v_result->>'ok')::BOOLEAN, 'test 17');

  -- 18. Cupo independiente por hora
  v_result := public.__agenda_cfg_test_call_book(
    v_asesor, v_exp_hour, public.__agenda_cfg_test_slot_ts(1, '12:00', 5), 'mty-centro'
  );
  PERFORM public.__agenda_cfg_test_assert((v_result->>'ok')::BOOLEAN, 'test 18');

  -- 19. Cupo independiente por fecha
  v_result := public.__agenda_cfg_test_call_book(
    v_asesor, v_exp_date, public.__agenda_cfg_test_slot_ts(3, '09:00', 6), 'mty-centro'
  );
  PERFORM public.__agenda_cfg_test_assert((v_result->>'ok')::BOOLEAN, 'test 19');

  -- 20. book_biometricos válido con config
  PERFORM public.__agenda_cfg_test_assert(
    EXISTS (
      SELECT 1 FROM public.agenda_bookings b
      WHERE b.expediente_id = v_exp_book AND b.status = 'booked'
    ),
    'test 20'
  );

  -- 21. Índice anti-duplicado por expediente
  v_result := public.__agenda_cfg_test_call_book(v_asesor, v_exp_dup, v_slot_tue10, 'mty-centro');
  PERFORM public.__agenda_cfg_test_assert((v_result->>'ok')::BOOLEAN, 'test 21a');
  PERFORM public.__agenda_cfg_test_assert(
    public.__agenda_cfg_test_expect_book_fail(v_asesor, v_exp_dup, v_slot_mon11, 'mty-centro'),
    'test 21b'
  );

  -- 22-26. Reagendar
  PERFORM public.__agenda_cfg_test_call_book(
    v_asesor, v_exp_reag, public.__agenda_cfg_test_slot_ts(4, '10:00', 5), 'mty-centro'
  );
  v_result := public.__agenda_cfg_test_call_reagendar(
    v_asesor, v_exp_reag, public.__agenda_cfg_test_slot_ts(4, '11:00', 5), 'mty-centro'
  );
  PERFORM public.__agenda_cfg_test_assert((v_result->>'ok')::BOOLEAN, 'test 22');

  v_slot_mon10 := public.__agenda_cfg_test_slot_ts(5, '16:00', 7);
  FOR i IN 1..3 LOOP
    PERFORM public.__agenda_cfg_test_insert_expediente(
      ('00000000-0000-4000-9013-00000000' || LPAD((200 + i)::TEXT, 4, '0'))::UUID,
      v_org_strict, v_asesor, ('91320' || LPAD(i::TEXT, 6, '0'))::CHAR(11)
    );
    PERFORM public.__agenda_cfg_test_call_book(
      v_asesor,
      ('00000000-0000-4000-9013-00000000' || LPAD((200 + i)::TEXT, 4, '0'))::UUID,
      v_slot_mon10,
      'mty-centro'
    );
  END LOOP;
  v_slot_other := public.__agenda_cfg_test_slot_ts(5, '09:00', 7);
  PERFORM public.__agenda_cfg_test_call_book(v_asesor, v_exp_reag_full, v_slot_other, 'mty-centro');
  v_slot_full := v_slot_mon10;
  PERFORM public.__agenda_cfg_test_assert(
    public.__agenda_cfg_test_expect_reagendar_fail(
      v_asesor, v_exp_reag_full, v_slot_full, 'mty-centro',
      'agenda_config: cupo agotado'
    ),
    'test 23'
  );

  v_result := public.__agenda_cfg_test_call_reagendar(
    v_asesor, v_exp_reag_full,
    public.__agenda_cfg_test_slot_ts(5, '09:00', 8),
    'san-nicolas'
  );
  PERFORM public.__agenda_cfg_test_assert((v_result->>'ok')::BOOLEAN, 'test 24');

  v_slot_move := public.__agenda_cfg_test_slot_ts(3, '16:00', 8);
  FOR i IN 1..2 LOOP
    PERFORM public.__agenda_cfg_test_insert_expediente(
      ('00000000-0000-4000-9013-00000000' || LPAD((210 + i)::TEXT, 4, '0'))::UUID,
      v_org_strict, v_asesor, ('91321' || LPAD(i::TEXT, 6, '0'))::CHAR(11)
    );
    PERFORM public.__agenda_cfg_test_call_book(
      v_asesor,
      ('00000000-0000-4000-9013-00000000' || LPAD((210 + i)::TEXT, 4, '0'))::UUID,
      v_slot_move,
      'mty-centro'
    );
  END LOOP;
  PERFORM public.__agenda_cfg_test_call_book(v_asesor, v_exp_reag_move, v_slot_move, 'mty-centro');
  PERFORM public.__agenda_cfg_test_call_reagendar(
    v_asesor, v_exp_reag_move,
    public.__agenda_cfg_test_slot_ts(3, '09:00', 9),
    'san-nicolas'
  );
  v_result := public.__agenda_cfg_test_call_book(v_asesor, v_exp_reag_free, v_slot_move, 'mty-centro');
  PERFORM public.__agenda_cfg_test_assert((v_result->>'ok')::BOOLEAN, 'test 25');

  PERFORM public.__agenda_cfg_test_call_book(
    v_asesor, v_exp_reag_etapa, public.__agenda_cfg_test_slot_ts(2, '10:00', 8), 'mty-centro'
  );
  v_result := public.__agenda_cfg_test_call_reagendar(
    v_asesor, v_exp_reag_etapa,
    public.__agenda_cfg_test_slot_ts(2, '11:00', 8),
    'mty-centro'
  );
  PERFORM public.__agenda_cfg_test_assert((v_result->>'etapa_actual')::INT = 4, 'test 26');

  -- 27. Regresión seed legacy normalizado (org dev; slot distinto a rpc_book P2C-6)
  v_result := public.__agenda_cfg_test_call_book(
    v_asesor_legacy, v_exp_legacy,
    public.agenda_biometricos_slot_ts(2, '12:00', 10),
    'sede-centro'
  );
  PERFORM public.__agenda_cfg_test_assert((v_result->>'ok')::BOOLEAN, 'test 27 legacy book');

  -- 28. Regresión: cancel/reagendar path sigue disponible (smoke)
  PERFORM public.__agenda_cfg_test_assert(
    EXISTS (
      SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname IN ('cancel_biometricos', 'reagendar_biometricos')
    ),
    'test 28 rpcs exist'
  );

  -- 29. No existe revisor
  SELECT COUNT(*) INTO v_roles_revisor
  FROM pg_enum e
  JOIN pg_type t ON t.oid = e.enumtypid
  WHERE t.typname = 'app_role' AND e.enumlabel = 'revisor';
  PERFORM public.__agenda_cfg_test_assert(v_roles_revisor = 0, 'test 29 no revisor');

  RAISE NOTICE 'agenda_config biometricos rules: 36 pruebas OK';
END;
$$;

DROP FUNCTION IF EXISTS public.__agenda_cfg_test_assert(BOOLEAN, TEXT);
DROP FUNCTION IF EXISTS public.__agenda_cfg_test_set_auth(UUID);
DROP FUNCTION IF EXISTS public.__agenda_cfg_test_reset_auth();
DROP FUNCTION IF EXISTS public.__agenda_cfg_test_slot_ts(INTEGER, TEXT, INTEGER, TEXT);
DROP FUNCTION IF EXISTS public.__agenda_cfg_test_standard_config();
DROP FUNCTION IF EXISTS public.__agenda_cfg_test_upsert_org(UUID, TEXT);
DROP FUNCTION IF EXISTS public.__agenda_cfg_test_upsert_asesor(UUID, UUID);
DROP FUNCTION IF EXISTS public.__agenda_cfg_test_upsert_config(UUID, JSONB);
DROP FUNCTION IF EXISTS public.__agenda_cfg_test_insert_expediente(UUID, UUID, UUID, CHAR(11));
DROP FUNCTION IF EXISTS public.__agenda_cfg_test_call_book(UUID, UUID, TIMESTAMPTZ, TEXT);
DROP FUNCTION IF EXISTS public.__agenda_cfg_test_expect_book_fail(UUID, UUID, TIMESTAMPTZ, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.__agenda_cfg_test_call_reagendar(UUID, UUID, TIMESTAMPTZ, TEXT);
DROP FUNCTION IF EXISTS public.__agenda_cfg_test_expect_reagendar_fail(UUID, UUID, TIMESTAMPTZ, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.__agenda_cfg_test_insert_booking(UUID, UUID, UUID, DATE, TIME, TEXT, public.booking_status);
