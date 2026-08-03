-- ConCasa CRM — tests hotfix 145 repair_retencion_enviada_a_etapa_9
-- Uso: PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/rpc_repair_retencion_enviada_etapa_9.sql

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__repair145_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN RAISE EXCEPTION 'REPAIR145 TEST FAIL: %', p_msg; END IF;
END; $$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000145';
  v_asesor UUID := '00000000-0000-4000-8001-000000000145';
  v_exp UUID := '00000000-0000-4000-8002-000000000145';
  v_exp2 UUID := '00000000-0000-4000-8002-000000000146';
  v_doc UUID;
  v_moved jsonb;
  v_etapa SMALLINT;
BEGIN
  INSERT INTO public.organizations (id, name)
  VALUES (v_org, 'Org Repair145')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.profiles (id, organization_id, app_role, full_name, active)
  VALUES (v_asesor, v_org, 'asesor', 'Asesor Repair145', true)
  ON CONFLICT (id) DO UPDATE SET active = true, organization_id = EXCLUDED.organization_id;

  -- Caso Cardenas: etapa 8 + Acuse enviado, sin booking activo firmas
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '43038128773', 'Fixture Repair145 A',
    '5511111145', 'interno', true, NOW(), 8, 'en_proceso', 'activo'
  )
  ON CONFLICT (id) DO UPDATE SET
    etapa_actual = 8, subestado = 'en_proceso', ciclo_estado = 'activo', deleted_at = NULL;

  INSERT INTO public.retencion_opciones (expediente_id, organization_id, retencion_opcion, updated_by)
  VALUES (v_exp, v_org, 'con_sello', v_asesor)
  ON CONFLICT (expediente_id) DO UPDATE SET retencion_opcion = 'con_sello';

  INSERT INTO public.retencion_envios (
    expediente_id, organization_id, enviado, fecha_envio_mesa, opcion, estado
  ) VALUES (v_exp, v_org, true, NOW(), 'con_sello', 'enviado')
  ON CONFLICT (expediente_id) DO UPDATE SET enviado = true, estado = 'enviado', opcion = 'con_sello';

  INSERT INTO public.expediente_documentos (
    organization_id, expediente_id, tipo_documento, storage_path, nombre_original,
    mime_type, size_bytes, version, estatus_revision, uploaded_by, uploaded_by_role
  ) VALUES (
    v_org, v_exp, 'retencion_acuse_con_sello',
    v_org::text || '/' || v_exp::text || '/retencion_acuse_con_sello/a.pdf',
    'acuse.pdf', 'application/pdf', 1000, 1, 'subido', v_asesor, 'asesor'
  )
  RETURNING id INTO v_doc;

  SELECT public.repair_retencion_enviada_a_etapa_9(v_exp) INTO v_moved;
  PERFORM public.__repair145_assert((v_moved->>'moved')::int = 1, 'debe mover 1');

  SELECT etapa_actual INTO v_etapa FROM public.expedientes WHERE id = v_exp;
  PERFORM public.__repair145_assert(v_etapa = 9, 'Cardenas-like → etapa 9');

  -- Idempotente
  SELECT public.repair_retencion_enviada_a_etapa_9(v_exp) INTO v_moved;
  PERFORM public.__repair145_assert((v_moved->>'moved')::int = 0, 'segunda pasada 0');

  -- Caso con booking firmas activo también repara (Norma-like)
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_exp2, v_org, v_asesor, 'mejoravit', '43038128774', 'Fixture Repair145 B',
    '5511111146', 'interno', true, NOW(), 8, 'en_proceso', 'activo'
  )
  ON CONFLICT (id) DO UPDATE SET
    etapa_actual = 8, subestado = 'en_proceso', ciclo_estado = 'activo', deleted_at = NULL;

  INSERT INTO public.retencion_opciones (expediente_id, organization_id, retencion_opcion, updated_by)
  VALUES (v_exp2, v_org, 'con_sello', v_asesor)
  ON CONFLICT (expediente_id) DO UPDATE SET retencion_opcion = 'con_sello';

  INSERT INTO public.retencion_envios (
    expediente_id, organization_id, enviado, fecha_envio_mesa, opcion, estado
  ) VALUES (v_exp2, v_org, true, NOW(), 'con_sello', 'enviado')
  ON CONFLICT (expediente_id) DO UPDATE SET enviado = true, estado = 'enviado', opcion = 'con_sello';

  INSERT INTO public.expediente_documentos (
    organization_id, expediente_id, tipo_documento, storage_path, nombre_original,
    mime_type, size_bytes, version, estatus_revision, uploaded_by, uploaded_by_role
  ) VALUES (
    v_org, v_exp2, 'retencion_acuse_con_sello',
    v_org::text || '/' || v_exp2::text || '/retencion_acuse_con_sello/b.pdf',
    'acuse2.pdf', 'application/pdf', 1000, 1, 'subido', v_asesor, 'asesor'
  );

  INSERT INTO public.agenda_bookings (
    id, organization_id, expediente_id, kind, status, location_id,
    booking_date, booking_time, created_by
  ) VALUES (
    '00000000-0000-4000-8003-000000000145', v_org, v_exp2, 'firmas', 'booked',
    'monterrey', CURRENT_DATE + 3, '09:00', v_asesor
  )
  ON CONFLICT (id) DO UPDATE SET status = 'booked', cancelled_at = NULL;

  SELECT public.repair_retencion_enviada_a_etapa_9(v_exp2) INTO v_moved;
  PERFORM public.__repair145_assert((v_moved->>'moved')::int = 1, 'con booking firmas también repara');
  SELECT etapa_actual INTO v_etapa FROM public.expedientes WHERE id = v_exp2;
  PERFORM public.__repair145_assert(v_etapa = 9, 'Norma-like → etapa 9');

  -- Trigger: forzar a 8 debe restaurar 9
  UPDATE public.expedientes SET etapa_actual = 8 WHERE id = v_exp;
  SELECT etapa_actual INTO v_etapa FROM public.expedientes WHERE id = v_exp;
  PERFORM public.__repair145_assert(v_etapa = 9, 'trigger restaura 9 al intentar dejar en 8');

  -- Etapa 8 sin Acuse enviado no se mueve
  UPDATE public.retencion_envios SET enviado = false, estado = 'borrador' WHERE expediente_id = v_exp;
  -- Desactivar elegibilidad: quitar envío válido; forzar etapa 8 sin trigger restore
  -- (sin envío válido el trigger no restaura)
  UPDATE public.expedientes SET etapa_actual = 8 WHERE id = v_exp;
  SELECT etapa_actual INTO v_etapa FROM public.expedientes WHERE id = v_exp;
  PERFORM public.__repair145_assert(v_etapa = 8, 'sin envío válido permanece en 8');

  RAISE NOTICE 'REPAIR145 OK';
END;
$$;

DROP FUNCTION public.__repair145_assert(BOOLEAN, TEXT);
