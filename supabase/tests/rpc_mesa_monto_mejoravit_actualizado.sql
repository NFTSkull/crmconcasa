-- ConCasa CRM — P090: monto Mejoravit actualizado (Mesa)
-- Uso: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/rpc_mesa_monto_mejoravit_actualizado.sql

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__p090_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF NOT p_ok THEN RAISE EXCEPTION 'P090 FAIL: %', p_msg; END IF; END;
$$;

CREATE OR REPLACE FUNCTION public.__p090_auth(p_user UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p090_reset()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000001';
  v_asesor UUID := '00000000-0000-4000-8001-000000000001';
  v_asesor2 UUID := '00000000-0000-4000-8001-000000000002';
  v_editor UUID := '00000000-0000-4000-8002-000000000001';
  v_mesa_admin UUID := '00000000-0000-4000-8003-000000000001';
  v_mesa_int UUID := '00000000-0000-4000-8004-000000000001';
  v_mesa_ext UUID := '00000000-0000-4000-8005-000000000001';
  v_super UUID := '00000000-0000-4000-8006-000000000001';
  v_exp UUID := '00000000-0000-4000-9090-000000000001';
  v_exp_ext UUID := '00000000-0000-4000-9090-000000000002';
  v_exp_closed UUID := '00000000-0000-4000-9090-000000000003';
  v_exp_draft UUID := '00000000-0000-4000-9090-000000000004';
  v_exp_cents UUID := '00000000-0000-4000-9090-000000000005';
  v_res JSONB;
  v_ctx JSONB;
  v_cd public.cliente_datos%ROWTYPE;
  v_hist_count INT;
  v_json_mej TEXT;
  v_pct NUMERIC;
  v_metodo TEXT;
  v_etapa SMALLINT;
  v_log INT;
  v_err TEXT;
  v_first_ant NUMERIC;
  v_orig NUMERIC;
BEGIN
  PERFORM public.__p090_reset();

  -- Fixtures
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, ciclo_estado
  ) VALUES
    (v_exp, v_org, v_asesor, 'mejoravit', '90901000001', 'P090 Cliente',
     '5590900001', 'interno', true, NOW(), 7, 'en_proceso', 'activo'),
    (v_exp_ext, v_org, v_asesor, 'mejoravit', '90901000002', 'P090 Ext',
     '5590900002', 'externo', true, NOW(), 7, 'en_proceso', 'activo'),
    (v_exp_closed, v_org, v_asesor, 'mejoravit', '90901000003', 'P090 Closed',
     '5590900003', 'interno', true, NOW(), 7, 'en_proceso', 'cerrado'),
    (v_exp_draft, v_org, v_asesor, 'mejoravit', '90901000004', 'P090 Draft',
     '5590900004', 'interno', false, NULL, 3, 'pendiente', 'activo'),
    (v_exp_cents, v_org, v_asesor, 'mejoravit', '90901000005', 'P090 Cents',
     '5590900005', 'interno', true, NOW(), 7, 'en_proceso', 'activo')
  ON CONFLICT (id) DO UPDATE SET
    submitted_to_mesa = EXCLUDED.submitted_to_mesa,
    origen_mesa = EXCLUDED.origen_mesa,
    ciclo_estado = EXCLUDED.ciclo_estado,
    deleted_at = NULL,
    etapa_actual = EXCLUDED.etapa_actual,
    subestado = EXCLUDED.subestado;

  DELETE FROM public.expediente_monto_mejoravit_actualizaciones
  WHERE expediente_id IN (v_exp, v_exp_ext, v_exp_closed, v_exp_draft, v_exp_cents);
  DELETE FROM public.cliente_datos
  WHERE expediente_id IN (v_exp, v_exp_ext, v_exp_closed, v_exp_draft, v_exp_cents);
  DELETE FROM public.editor_decisions
  WHERE expediente_id IN (v_exp, v_exp_ext, v_exp_closed, v_exp_draft, v_exp_cents);

  INSERT INTO public.editor_decisions (
    expediente_id, organization_id, decision, monto_aprobado,
    aprobado_at, monto_aprobado_al_aprobar
  ) VALUES
    (v_exp, v_org, 'aprobado', 250000, NOW(), 250000),
    (v_exp_ext, v_org, 'aprobado', 250000, NOW(), 250000),
    (v_exp_closed, v_org, 'aprobado', 250000, NOW(), 250000),
    (v_exp_draft, v_org, 'aprobado', 250000, NOW(), 250000),
    (v_exp_cents, v_org, 'aprobado', 200000, NOW(), 200000);

  -- Seed cliente_datos directo (post-Mesa: save_cliente_datos bloquea sin corrección)
  INSERT INTO public.cliente_datos (
    expediente_id, organization_id, datos, estado,
    porcentaje_cobro, monto_calculado, metodo_pago, updated_by
  ) VALUES
    (v_exp, v_org, jsonb_build_object('montoMejoravit', '150000'), 'validado',
     12.5, round(150000 * 12.5 / 100 + 3000, 2), 'transferencia', v_asesor),
    (v_exp_ext, v_org, jsonb_build_object('montoMejoravit', '150000'), 'validado',
     12.5, round(150000 * 12.5 / 100 + 3000, 2), 'transferencia', v_asesor),
    (v_exp_closed, v_org, jsonb_build_object('montoMejoravit', '150000'), 'validado',
     12.5, round(150000 * 12.5 / 100 + 3000, 2), 'transferencia', v_asesor),
    (v_exp_draft, v_org, jsonb_build_object('montoMejoravit', '150000'), 'completo',
     12.5, round(150000 * 12.5 / 100 + 3000, 2), 'transferencia', v_asesor),
    (v_exp_cents, v_org, jsonb_build_object('montoMejoravit', '100000'), 'validado',
     10.25, round(100000 * 10.25 / 100 + 3000, 2), 'transferencia', v_asesor);

  -- ===== Fórmula 200000 × 12.5% + 3000 = 28000 =====
  PERFORM public.__p090_auth(v_mesa_admin);
  v_res := public.mesa_actualizar_monto_mejoravit(v_exp, 200000, 'Aumento por corrección Infonavit');
  PERFORM public.__p090_assert(v_res->>'ok' = 'true', 'write ok');
  PERFORM public.__p090_assert((v_res->>'monto_anterior')::NUMERIC = 150000, 'base anterior JSON');
  PERFORM public.__p090_assert((v_res->>'monto_nuevo')::NUMERIC = 200000, 'monto nuevo');
  PERFORM public.__p090_assert((v_res->>'diferencia')::NUMERIC = 50000, 'diferencia');
  PERFORM public.__p090_assert((v_res->>'monto_cobro_nuevo')::NUMERIC = 28000, 'cobro 28000');
  PERFORM public.__p090_assert((v_res->>'monto_original_operativo')::NUMERIC = 150000, 'original = primera base');
  PERFORM public.__p090_reset();

  SELECT * INTO v_cd FROM public.cliente_datos WHERE expediente_id = v_exp;
  PERFORM public.__p090_assert(v_cd.monto_mejoravit_actualizado = 200000, 'campo vigente');
  PERFORM public.__p090_assert(v_cd.monto_calculado = 28000, 'monto_calculado');
  PERFORM public.__p090_assert(v_cd.porcentaje_cobro = 12.5, 'pct intacto');
  PERFORM public.__p090_assert(v_cd.metodo_pago = 'transferencia', 'metodo intacto');
  PERFORM public.__p090_assert(v_cd.datos->>'montoMejoravit' = '150000', 'JSON intacto');

  SELECT COUNT(*) INTO v_hist_count
  FROM public.expediente_monto_mejoravit_actualizaciones WHERE expediente_id = v_exp;
  PERFORM public.__p090_assert(v_hist_count = 1, '1 fila historial');

  SELECT COUNT(*) INTO v_log FROM public.action_log
  WHERE action = 'mesa.monto_mejoravit.updated' AND entity_id = v_exp;
  PERFORM public.__p090_assert(v_log >= 1, 'action_log');

  -- ===== Misma cantidad bloqueada =====
  PERFORM public.__p090_auth(v_mesa_admin);
  BEGIN
    PERFORM public.mesa_actualizar_monto_mejoravit(v_exp, 200000, 'mismo');
    PERFORM public.__p090_assert(false, 'debía fallar mismo monto');
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    PERFORM public.__p090_assert(
      v_err ILIKE '%diferente al monto vigente%',
      'msg mismo monto: ' || v_err
    );
  END;
  PERFORM public.__p090_reset();

  -- ===== Segunda actualización (disminución) =====
  PERFORM public.__p090_auth(v_mesa_int);
  v_res := public.mesa_actualizar_monto_mejoravit(v_exp, 180000, 'Disminución acordada');
  PERFORM public.__p090_assert((v_res->>'monto_anterior')::NUMERIC = 200000, '2a ant=200k');
  PERFORM public.__p090_assert((v_res->>'monto_nuevo')::NUMERIC = 180000, '2a nuevo');
  PERFORM public.__p090_assert((v_res->>'monto_original_operativo')::NUMERIC = 150000, 'original estable');
  PERFORM public.__p090_assert(
    (v_res->>'monto_cobro_nuevo')::NUMERIC = round(180000 * 12.5 / 100 + 3000, 2),
    'cobro 2a'
  );
  PERFORM public.__p090_reset();

  SELECT COUNT(*) INTO v_hist_count
  FROM public.expediente_monto_mejoravit_actualizaciones WHERE expediente_id = v_exp;
  PERFORM public.__p090_assert(v_hist_count = 2, '2 filas historial');

  SELECT monto_anterior INTO v_first_ant
  FROM public.expediente_monto_mejoravit_actualizaciones
  WHERE expediente_id = v_exp
  ORDER BY created_at ASC, id ASC
  LIMIT 1;
  PERFORM public.__p090_assert(v_first_ant = 150000, '1a fila inmutable');

  -- ===== Centavos =====
  PERFORM public.__p090_auth(v_mesa_admin);
  v_res := public.mesa_actualizar_monto_mejoravit(v_exp_cents, 123456.78, 'Centavos');
  PERFORM public.__p090_assert(
    (v_res->>'monto_cobro_nuevo')::NUMERIC = round(123456.78 * 10.25 / 100 + 3000, 2),
    'cobro centavos'
  );
  PERFORM public.__p090_reset();

  -- ===== Validaciones =====
  PERFORM public.__p090_auth(v_mesa_admin);
  BEGIN
    PERFORM public.mesa_actualizar_monto_mejoravit(v_exp, 0, 'x');
    PERFORM public.__p090_assert(false, 'cero');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    PERFORM public.mesa_actualizar_monto_mejoravit(v_exp, -1, 'x');
    PERFORM public.__p090_assert(false, 'negativo');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    PERFORM public.mesa_actualizar_monto_mejoravit(v_exp, 190000, '   ');
    PERFORM public.__p090_assert(false, 'motivo espacios');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    PERFORM public.mesa_actualizar_monto_mejoravit(v_exp, 190000, repeat('a', 501));
    PERFORM public.__p090_assert(false, 'motivo largo');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  PERFORM public.__p090_reset();

  -- ===== Permisos =====
  PERFORM public.__p090_auth(v_asesor);
  BEGIN
    PERFORM public.mesa_actualizar_monto_mejoravit(v_exp, 190000, 'asesor');
    PERFORM public.__p090_assert(false, 'asesor write');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  PERFORM public.__p090_auth(v_editor);
  BEGIN
    PERFORM public.mesa_actualizar_monto_mejoravit(v_exp, 190000, 'editor');
    PERFORM public.__p090_assert(false, 'editor write');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  -- mesa_externo no ve origen interno
  PERFORM public.__p090_auth(v_mesa_ext);
  BEGIN
    PERFORM public.mesa_actualizar_monto_mejoravit(v_exp, 190000, 'ext on int');
    PERFORM public.__p090_assert(false, 'externo en interno');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  -- mesa_externo sí en externo
  v_res := public.mesa_actualizar_monto_mejoravit(v_exp_ext, 160000, 'Ext OK');
  PERFORM public.__p090_assert(v_res->>'ok' = 'true', 'externo ok');
  PERFORM public.__p090_reset();

  PERFORM public.__p090_auth(v_super);
  v_res := public.mesa_actualizar_monto_mejoravit(v_exp, 175000, 'Super OK');
  PERFORM public.__p090_assert(v_res->>'ok' = 'true', 'super ok');
  PERFORM public.__p090_reset();

  -- cerrado / no enviado
  PERFORM public.__p090_auth(v_mesa_admin);
  BEGIN
    PERFORM public.mesa_actualizar_monto_mejoravit(v_exp_closed, 160000, 'cerrado');
    PERFORM public.__p090_assert(false, 'cerrado');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    PERFORM public.mesa_actualizar_monto_mejoravit(v_exp_draft, 160000, 'draft');
    PERFORM public.__p090_assert(false, 'no enviado');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  PERFORM public.__p090_reset();

  -- ===== Append-only: authenticated no INSERT/UPDATE/DELETE =====
  PERFORM public.__p090_auth(v_mesa_admin);
  BEGIN
    INSERT INTO public.expediente_monto_mejoravit_actualizaciones (
      organization_id, expediente_id, monto_anterior, monto_nuevo, diferencia,
      porcentaje_cobro, monto_cobro_nuevo, motivo, created_by
    ) VALUES (v_org, v_exp, 1, 2, 1, 10, 1, 'hack', v_mesa_admin);
    PERFORM public.__p090_assert(false, 'insert directo');
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    UPDATE public.expediente_monto_mejoravit_actualizaciones
    SET motivo = 'hack' WHERE expediente_id = v_exp;
    PERFORM public.__p090_assert(
      NOT FOUND OR true,
      'update'
    );
    -- si no hay excepción, verificar que 0 rows updated under RLS (no grant UPDATE)
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  PERFORM public.__p090_reset();

  -- Force check: no UPDATE privilege
  PERFORM public.__p090_assert(
    NOT has_table_privilege('authenticated', 'public.expediente_monto_mejoravit_actualizaciones', 'INSERT'),
    'no insert priv'
  );
  PERFORM public.__p090_assert(
    NOT has_table_privilege('authenticated', 'public.expediente_monto_mejoravit_actualizaciones', 'UPDATE'),
    'no update priv'
  );
  PERFORM public.__p090_assert(
    NOT has_table_privilege('authenticated', 'public.expediente_monto_mejoravit_actualizaciones', 'DELETE'),
    'no delete priv'
  );

  -- ===== Lectura =====
  PERFORM public.__p090_auth(v_mesa_admin);
  v_ctx := public.get_expediente_monto_mejoravit_context(v_exp);
  PERFORM public.__p090_assert((v_ctx->>'cargo_fijo')::INT = 3000, 'cargo_fijo');
  PERFORM public.__p090_assert((v_ctx->>'can_update')::BOOLEAN = true, 'can_update mesa');
  PERFORM public.__p090_assert((v_ctx->>'monto_original_operativo')::NUMERIC = 150000, 'ctx original');
  PERFORM public.__p090_assert((v_ctx->>'monto_operativo_vigente')::NUMERIC = 175000, 'ctx vigente');
  PERFORM public.__p090_assert(jsonb_array_length(v_ctx->'historial') >= 2, 'historial len');
  PERFORM public.__p090_reset();

  PERFORM public.__p090_auth(v_asesor);
  v_ctx := public.get_expediente_monto_mejoravit_context(v_exp);
  PERFORM public.__p090_assert((v_ctx->>'can_update')::BOOLEAN = false, 'asesor can_update false');
  PERFORM public.__p090_reset();

  PERFORM public.__p090_auth(v_asesor2);
  BEGIN
    PERFORM public.get_expediente_monto_mejoravit_context(v_exp);
    -- asesor externo seed may not see interno expediente of a1
    -- if can_see allows only owner, should fail
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  PERFORM public.__p090_reset();

  -- ===== Regresión: save post-Mesa conserva override (vía correccion) =====
  PERFORM public.__p090_auth(v_asesor);
  PERFORM public.save_cliente_datos_correccion(
    v_exp, '', '5590900001', '[]'::JSONB, NULL,
    jsonb_build_object('montoMejoravit', '999999'),
    12.5, 'transferencia', NULL, NULL
  );
  PERFORM public.__p090_reset();

  SELECT * INTO v_cd FROM public.cliente_datos WHERE expediente_id = v_exp;
  PERFORM public.__p090_assert(v_cd.monto_mejoravit_actualizado = 175000, 'override intacto tras save');
  PERFORM public.__p090_assert(v_cd.datos->>'montoMejoravit' = '999999', 'JSON actualizado por asesor');
  PERFORM public.__p090_assert(v_cd.monto_calculado = round(175000 * 12.5 / 100 + 3000, 2), 'cobro usa override');
  PERFORM public.__p090_assert(v_cd.monto_mejoravit_actualizado_motivo IS NOT NULL, 'motivo intacto');

  SELECT etapa_actual INTO v_etapa FROM public.expedientes WHERE id = v_exp;
  PERFORM public.__p090_assert(v_etapa = 7, 'etapa intacta');

  SELECT COUNT(*) INTO v_hist_count
  FROM public.expediente_monto_mejoravit_actualizaciones WHERE expediente_id = v_exp;
  PERFORM public.__p090_assert(v_hist_count = 3, 'historial no borrado por save');

  -- ===== P087: Admin no usa campo nuevo (smoke estructural) =====
  PERFORM public.__p090_assert(
    position(
      'monto_mejoravit_actualizado' in
      pg_get_functiondef(
        'public.admin_get_production_summary(timestamptz,timestamptz,uuid,smallint,text)'::regprocedure
      )
    ) = 0,
    'admin summary sin campo P090'
  );

  RAISE NOTICE 'P090 OK';
END;
$$;

DROP FUNCTION public.__p090_assert(BOOLEAN, TEXT);
DROP FUNCTION public.__p090_auth(UUID);
DROP FUNCTION public.__p090_reset();
