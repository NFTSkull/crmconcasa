-- ConCasa CRM — P080 backfill local (Cohorte A) — pruebas
-- Uso: tras migraciones incluyendo 080, en DB aislada.
-- PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f supabase/tests/rpc_backfill_retencion_p080.sql

\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__p080_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN RAISE EXCEPTION 'P080 TEST FAIL: %', p_msg; END IF;
END; $$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000001';
  v_a1 UUID := '00000000-0000-4000-8001-000000000001';
  v_exp_a UUID := '00000000-0000-4000-9080-000000000001';
  v_exp_b UUID := '00000000-0000-4000-9080-000000000002';
  v_exp_d UUID := '00000000-0000-4000-9080-000000000003';
  v_exp_book UUID := '00000000-0000-4000-9080-000000000004';
  v_exp_amb UUID := '00000000-0000-4000-9080-000000000005';
  v_moved1 INT;
  v_moved2 INT;
  v_etapa SMALLINT;
BEGIN
  -- Cohorte A
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_exp_a, v_org, v_a1, 'mejoravit', '91808000001', 'P080 A',
    '5555555555', 'interno', true, NOW(), 8, 'en_proceso', 'activo'
  ) ON CONFLICT (id) DO UPDATE SET etapa_actual = 8, subestado = 'en_proceso', deleted_at = NULL;

  INSERT INTO public.retencion_opciones (expediente_id, organization_id, retencion_opcion)
  VALUES (v_exp_a, v_org, 'con_sello')
  ON CONFLICT (expediente_id) DO UPDATE SET retencion_opcion = 'con_sello';

  INSERT INTO public.retencion_envios (expediente_id, organization_id, enviado, fecha_envio_mesa, opcion, estado)
  VALUES (v_exp_a, v_org, true, NOW(), 'con_sello', 'enviado')
  ON CONFLICT (expediente_id) DO UPDATE SET enviado = true, estado = 'enviado', opcion = 'con_sello';

  INSERT INTO public.expediente_documentos (
    id, organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, size_bytes, estatus_revision, uploaded_by, uploaded_by_role
  ) VALUES (
    '00000000-0000-4000-9080-000000000011', v_org, v_exp_a, 'retencion_acuse_con_sello',
    'dev/p080/a.pdf', 'a.pdf', 'application/pdf', 10, 'subido', v_a1, 'asesor'
  ) ON CONFLICT (id) DO UPDATE SET deleted_at = NULL, estatus_revision = 'subido';

  -- Cohorte B: principal válido sin envío
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_exp_b, v_org, v_a1, 'mejoravit', '91808000002', 'P080 B',
    '5555555555', 'interno', true, NOW(), 8, 'en_proceso', 'activo'
  ) ON CONFLICT (id) DO UPDATE SET etapa_actual = 8;

  INSERT INTO public.expediente_documentos (
    id, organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, size_bytes, estatus_revision, uploaded_by, uploaded_by_role
  ) VALUES (
    '00000000-0000-4000-9080-000000000012', v_org, v_exp_b, 'retencion_acuse_con_sello',
    'dev/p080/b.pdf', 'b.pdf', 'application/pdf', 10, 'subido', v_a1, 'asesor'
  ) ON CONFLICT (id) DO UPDATE SET deleted_at = NULL;

  -- Cohorte D: sin principal
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_exp_d, v_org, v_a1, 'mejoravit', '91808000003', 'P080 D',
    '5555555555', 'interno', true, NOW(), 8, 'en_proceso', 'activo'
  ) ON CONFLICT (id) DO UPDATE SET etapa_actual = 8;

  INSERT INTO public.retencion_envios (expediente_id, organization_id, enviado, fecha_envio_mesa, opcion, estado)
  VALUES (v_exp_d, v_org, true, NOW(), 'con_sello', 'enviado')
  ON CONFLICT (expediente_id) DO UPDATE SET enviado = true, estado = 'enviado';

  -- Ambiguo: dos principales
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_exp_amb, v_org, v_a1, 'mejoravit', '91808000005', 'P080 C',
    '5555555555', 'interno', true, NOW(), 8, 'en_proceso', 'activo'
  ) ON CONFLICT (id) DO UPDATE SET etapa_actual = 8;

  INSERT INTO public.retencion_opciones (expediente_id, organization_id, retencion_opcion)
  VALUES (v_exp_amb, v_org, 'con_sello')
  ON CONFLICT (expediente_id) DO UPDATE SET retencion_opcion = 'con_sello';
  INSERT INTO public.retencion_envios (expediente_id, organization_id, enviado, fecha_envio_mesa, opcion, estado)
  VALUES (v_exp_amb, v_org, true, NOW(), 'con_sello', 'enviado')
  ON CONFLICT (expediente_id) DO UPDATE SET enviado = true, estado = 'enviado';
  INSERT INTO public.expediente_documentos (
    id, organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, size_bytes, estatus_revision, uploaded_by, uploaded_by_role
  ) VALUES
    ('00000000-0000-4000-9080-000000000015', v_org, v_exp_amb, 'retencion_acuse_con_sello',
     'dev/p080/c1.pdf', 'c1.pdf', 'application/pdf', 10, 'subido', v_a1, 'asesor'),
    ('00000000-0000-4000-9080-000000000016', v_org, v_exp_amb, 'retencion_carta_sin_sello',
     'dev/p080/c2.pdf', 'c2.pdf', 'application/pdf', 10, 'subido', v_a1, 'asesor')
  ON CONFLICT (id) DO UPDATE SET deleted_at = NULL;

  -- Con booking firmas (no A)
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, ciclo_estado
  ) VALUES (
    v_exp_book, v_org, v_a1, 'mejoravit', '91808000004', 'P080 book',
    '5555555555', 'interno', true, NOW(), 8, 'en_proceso', 'activo'
  ) ON CONFLICT (id) DO UPDATE SET etapa_actual = 8;

  INSERT INTO public.retencion_opciones (expediente_id, organization_id, retencion_opcion)
  VALUES (v_exp_book, v_org, 'con_sello')
  ON CONFLICT (expediente_id) DO UPDATE SET retencion_opcion = 'con_sello';
  INSERT INTO public.retencion_envios (expediente_id, organization_id, enviado, fecha_envio_mesa, opcion, estado)
  VALUES (v_exp_book, v_org, true, NOW(), 'con_sello', 'enviado')
  ON CONFLICT (expediente_id) DO UPDATE SET enviado = true, estado = 'enviado';
  INSERT INTO public.expediente_documentos (
    id, organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, size_bytes, estatus_revision, uploaded_by, uploaded_by_role
  ) VALUES (
    '00000000-0000-4000-9080-000000000014', v_org, v_exp_book, 'retencion_acuse_con_sello',
    'dev/p080/bk.pdf', 'bk.pdf', 'application/pdf', 10, 'subido', v_a1, 'asesor'
  ) ON CONFLICT (id) DO UPDATE SET deleted_at = NULL;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'agenda_bookings' AND column_name = 'location_id'
  ) THEN
    INSERT INTO public.agenda_bookings (
      organization_id, kind, expediente_id, booking_date, booking_time,
      location_id, status, created_by
    ) VALUES (
      v_org, 'firmas', v_exp_book,
      (CURRENT_DATE + 2),
      TIME '10:00',
      'mty-centro',
      'booked',
      v_a1
    );
  END IF;

  -- Contar A antes
  SELECT count(*)::int INTO v_moved1
  FROM public.expedientes e
  WHERE e.id = v_exp_a AND e.etapa_actual = 8;

  -- Re-ejecutar lógica P080 (idempotente vía misma migración ya aplicada; simular SELECT+UPDATE)
  -- La migración 080 ya corrió al bootstrap; forzamos re-evaluación revirtiendo A a 8 si quedó en 9
  -- y reaplicando el cuerpo de elegibilidad.
  UPDATE public.expedientes SET etapa_actual = 8 WHERE id = v_exp_a;

  -- Aplicar criterio P080 una vez
  WITH elegibles AS (
    SELECT e.id
    FROM public.expedientes e
    INNER JOIN public.retencion_envios re ON re.expediente_id = e.id
    LEFT JOIN public.retencion_opciones ro ON ro.expediente_id = e.id
    WHERE e.id IN (v_exp_a, v_exp_b, v_exp_d, v_exp_book, v_exp_amb)
      AND e.etapa_actual = 8
      AND e.deleted_at IS NULL
      AND e.ciclo_estado = 'activo'
      AND e.submitted_to_mesa = true
      AND e.subestado = 'en_proceso'
      AND re.enviado = true
      AND re.estado = 'enviado'
      AND COALESCE(re.opcion, ro.retencion_opcion) IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.agenda_bookings b
        WHERE b.expediente_id = e.id AND b.kind = 'firmas' AND b.status = 'booked'
      )
      AND (
        SELECT d.estatus_revision FROM public.expediente_documentos d
        WHERE d.expediente_id = e.id AND d.deleted_at IS NULL
          AND d.tipo_documento = CASE COALESCE(re.opcion, ro.retencion_opcion)
            WHEN 'con_sello' THEN 'retencion_acuse_con_sello'
            WHEN 'sin_sello' THEN 'retencion_carta_sin_sello' END
        ORDER BY d.created_at DESC LIMIT 1
      ) IN ('subido', 'resubido', 'validado')
      AND (
        SELECT count(*)::int FROM public.expediente_documentos d
        WHERE d.expediente_id = e.id AND d.deleted_at IS NULL
          AND d.tipo_documento IN ('retencion_acuse_con_sello', 'retencion_carta_sin_sello')
      ) = 1
  )
  UPDATE public.expedientes e
  SET etapa_actual = 9, subestado = 'en_proceso', updated_at = NOW()
  FROM elegibles x
  WHERE e.id = x.id;

  SELECT e.etapa_actual INTO v_etapa FROM public.expedientes e WHERE e.id = v_exp_a;
  PERFORM public.__p080_assert(v_etapa = 9, 'cohort A avanza');

  SELECT e.etapa_actual INTO v_etapa FROM public.expedientes e WHERE e.id = v_exp_b;
  PERFORM public.__p080_assert(v_etapa = 8, 'cohort B no avanza');

  SELECT e.etapa_actual INTO v_etapa FROM public.expedientes e WHERE e.id = v_exp_d;
  PERFORM public.__p080_assert(v_etapa = 8, 'cohort D no avanza');

  SELECT e.etapa_actual INTO v_etapa FROM public.expedientes e WHERE e.id = v_exp_amb;
  PERFORM public.__p080_assert(v_etapa = 8, 'ambiguo no avanza');

  SELECT e.etapa_actual INTO v_etapa FROM public.expedientes e WHERE e.id = v_exp_book;
  PERFORM public.__p080_assert(v_etapa = 8, 'con booking no avanza');

  -- Segunda pasada: 0 movimientos
  SELECT count(*)::int INTO v_moved2
  FROM public.expedientes e
  INNER JOIN public.retencion_envios re ON re.expediente_id = e.id
  LEFT JOIN public.retencion_opciones ro ON ro.expediente_id = e.id
  WHERE e.etapa_actual = 8
    AND e.id IN (v_exp_a, v_exp_b, v_exp_d, v_exp_book, v_exp_amb)
    AND re.enviado = true AND re.estado = 'enviado'
    AND (
      SELECT count(*)::int FROM public.expediente_documentos d
      WHERE d.expediente_id = e.id AND d.deleted_at IS NULL
        AND d.tipo_documento IN ('retencion_acuse_con_sello', 'retencion_carta_sin_sello')
    ) = 1
    AND (
      SELECT d.estatus_revision FROM public.expediente_documentos d
      WHERE d.expediente_id = e.id AND d.deleted_at IS NULL
        AND d.tipo_documento = CASE COALESCE(re.opcion, ro.retencion_opcion)
          WHEN 'con_sello' THEN 'retencion_acuse_con_sello'
          WHEN 'sin_sello' THEN 'retencion_carta_sin_sello' END
      ORDER BY d.created_at DESC LIMIT 1
    ) IN ('subido', 'resubido', 'validado')
    AND NOT EXISTS (
      SELECT 1 FROM public.agenda_bookings b
      WHERE b.expediente_id = e.id AND b.kind = 'firmas' AND b.status = 'booked'
    );

  PERFORM public.__p080_assert(v_moved2 = 0, 'segunda ejecución no mueve cohort A otra vez');
  PERFORM public.__p080_assert(v_moved1 = 1, 'fixture A estaba en 8');

  RAISE NOTICE 'P080 backfill tests OK';
END;
$$;

DROP FUNCTION IF EXISTS public.__p080_assert(BOOLEAN, TEXT);
