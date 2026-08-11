-- P167: categoría corrección + booking vigente + aislamiento
\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION public.__p167_assert(cond boolean, msg text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT cond THEN
    RAISE EXCEPTION 'P167 assert failed: %', msg;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.__p167_set_auth(p_user_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', p_user_id::text, true);
END;
$$;

CREATE OR REPLACE FUNCTION public.__p167_reset_auth()
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);
END;
$$;

-- Contrato helpers
DO $$
DECLARE
  v_src TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'asesor_inbox_categoria_correccion'
  LIMIT 1;
  PERFORM public.__p167_assert(v_src IS NOT NULL, 'categoria existe');
  PERFORM public.__p167_assert(position('cliente_ine_frente' in v_src) > 0, 'incluye cliente_*');
  PERFORM public.__p167_assert(position('retencion_envios' in v_src) > 0, 'incluye retencion');

  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'asesor_inbox_latest_booking_status'
  LIMIT 1;
  PERFORM public.__p167_assert(v_src IS NOT NULL, 'latest booking existe');
  PERFORM public.__p167_assert(position('ORDER BY b.created_at DESC' in v_src) > 0, 'orden vigente');

  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'asesor_inbox_pendiente_agendar_biometricos'
  LIMIT 1;
  PERFORM public.__p167_assert(
    position('asesor_inbox_latest_booking_status' in v_src) > 0,
    'bio usa latest'
  );

  RAISE NOTICE 'P167 contrato OK';
END;
$$;

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8000-000000000001';
  v_asesor UUID := '00000000-0000-4000-8001-000000000001';
  v_asesor2 UUID := '00000000-0000-4000-8001-000000000002';
  v_editor UUID := '00000000-0000-4000-8002-000000000001';
  v_exp UUID;
  v_exp2 UUID;
  v_cat TEXT;
  v_bio BOOLEAN;
  v_firma BOOLEAN;
  v_page JSONB;
  v_fail BOOLEAN;
  v_count INT;
BEGIN
  -- Perfiles seed (org 0001) ya existen; no recrear.

  -- A. datos generales rechazados
  v_exp := gen_random_uuid();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99167110001',
    'PISO Datos Rech', '5516700001', '', 'interno', 'activo',
    true, now(), 2, 'en_proceso', now()
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado)
  VALUES (v_exp, v_org, '{}'::jsonb, 'rechazado')
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'rechazado';
  PERFORM public.__p167_assert(
    public.asesor_inbox_categoria_correccion(v_exp) = 'correccion_requerida',
    'A datos rechazados'
  );

  -- B. solo cliente_* rechazado (datos OK)
  v_exp := gen_random_uuid();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99167110002',
    'PISO Doc Cliente', '5516700002', '', 'interno', 'activo',
    true, now(), 2, 'en_proceso', now()
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado)
  VALUES (v_exp, v_org, '{}'::jsonb, 'completo')
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'completo';
  INSERT INTO public.expediente_documentos (
    organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, size_bytes, version, estatus_revision,
    uploaded_by, uploaded_by_role
  ) VALUES (
    v_org, v_exp, 'cliente_ine_frente',
    v_org::text || '/' || v_exp::text || '/cliente_ine_frente/p167.pdf',
    'ine.pdf', 'application/pdf', 100, 1, 'rechazado',
    v_asesor, 'asesor'
  );
  PERFORM public.__p167_assert(
    public.asesor_inbox_categoria_correccion(v_exp) = 'correccion_requerida',
    'B cliente_* rechazado'
  );

  -- C. Acuse correccion_requerida
  v_exp := gen_random_uuid();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99167110003',
    'PISO Acuse Corr', '5516700003', '', 'interno', 'activo',
    true, now(), 8, 'en_proceso', now()
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado)
  VALUES (v_exp, v_org, '{}'::jsonb, 'completo')
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'completo';
  INSERT INTO public.retencion_envios (
    expediente_id, organization_id, enviado, opcion, estado, fecha_envio_mesa
  ) VALUES (
    v_exp, v_org, true, 'con_sello', 'correccion_requerida', now()
  )
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'correccion_requerida';
  PERFORM public.__p167_assert(
    public.asesor_inbox_categoria_correccion(v_exp) = 'correccion_requerida',
    'C acuse correccion_requerida'
  );

  -- D. doc resubido → correccion_enviada (deja de estar abierto como requerida)
  v_exp := gen_random_uuid();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99167110004',
    'PISO Doc Resubido', '5516700004', '', 'interno', 'activo',
    true, now(), 2, 'en_proceso', now()
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado)
  VALUES (v_exp, v_org, '{}'::jsonb, 'completo')
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'completo';
  INSERT INTO public.expediente_documentos (
    organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, size_bytes, version, estatus_revision,
    uploaded_by, uploaded_by_role
  ) VALUES (
    v_org, v_exp, 'cliente_estado_cuenta',
    v_org::text || '/' || v_exp::text || '/cliente_estado_cuenta/p167.pdf',
    'ec.pdf', 'application/pdf', 100, 1, 'resubido',
    v_asesor, 'asesor'
  );
  PERFORM public.__p167_assert(
    public.asesor_inbox_categoria_correccion(v_exp) = 'correccion_enviada',
    'D resubido → enviada'
  );

  -- E. varias correcciones mismo expediente → 1 en summary filter
  v_exp := gen_random_uuid();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99167110005',
    'PISO Multi Corr', '5516700005', '', 'interno', 'activo',
    true, now(), 2, 'en_proceso', now() + interval '1 hour'
  );
  INSERT INTO public.editor_decisions (expediente_id, organization_id, decision)
  VALUES (v_exp, v_org, 'aprobado');
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado)
  VALUES (v_exp, v_org, '{}'::jsonb, 'rechazado')
  ON CONFLICT (expediente_id) DO UPDATE SET estado = 'rechazado';
  INSERT INTO public.expediente_documentos (
    organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, size_bytes, version, estatus_revision,
    uploaded_by, uploaded_by_role
  ) VALUES
    (v_org, v_exp, 'cliente_ine_frente',
     v_org::text || '/' || v_exp::text || '/cliente_ine_frente/a.pdf',
     'a.pdf', 'application/pdf', 100, 1, 'rechazado', v_asesor, 'asesor'),
    (v_org, v_exp, 'cliente_estado_cuenta',
     v_org::text || '/' || v_exp::text || '/cliente_estado_cuenta/b.pdf',
     'b.pdf', 'application/pdf', 100, 1, 'rechazado', v_asesor, 'asesor');

  PERFORM public.__p167_set_auth(v_asesor);
  v_page := public.asesor_list_expedientes_page(
    1, 100, 'PISO Multi Corr', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'correccion_requerida'
  );
  SELECT count(*)::int INTO v_count
  FROM jsonb_array_elements(coalesce(v_page->'items', '[]'::jsonb)) x
  WHERE x->>'cliente_nombre' = 'PISO Multi Corr';
  PERFORM public.__p167_assert(v_count = 1, 'E expediente único en listado');
  PERFORM public.__p167_assert(
    public.asesor_inbox_categoria_correccion(v_exp) = 'correccion_requerida',
    'E sigue abierta'
  );
  -- Contador de categoría es por expediente (1 fila base), no por N docs rechazados.
  PERFORM public.__p167_assert(
    (SELECT count(*)::int
     FROM public.expedientes e
     WHERE e.id = v_exp
       AND public.asesor_inbox_categoria_correccion(e.id) = 'correccion_requerida') = 1,
    'E count expediente=1'
  );
  PERFORM public.__p167_reset_auth();

  -- Booking history bio
  -- 1. cancelled viejo sin booked → Reagendar (etapa 4)
  v_exp := gen_random_uuid();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99167110006',
    'PISO Bio Cancel', '5516700006', '', 'interno', 'activo',
    true, now(), 4, 'en_proceso', now()
  );
  INSERT INTO public.agenda_bookings (
    organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, created_by, created_at
  ) VALUES (
    v_org, 'biometricos', v_exp, current_date - 2, '10:00:00',
    'sede-centro', 'cancelled', v_asesor, now() - interval '2 days'
  );
  v_bio := public.asesor_inbox_pendiente_agendar_biometricos(true, 4::smallint, v_exp);
  PERFORM public.__p167_assert(v_bio, 'bio1 cancelled → reagendar');

  -- 2+3. cancelled viejo + booked nuevo / varios cancelled + último booked → NO
  INSERT INTO public.agenda_bookings (
    organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, created_by, created_at
  ) VALUES
    (v_org, 'biometricos', v_exp, current_date - 1, '11:00:00',
     'sede-centro', 'cancelled', v_asesor, now() - interval '1 day'),
    (v_org, 'biometricos', v_exp, current_date, '12:00:00',
     'sede-centro', 'booked', v_asesor, now());
  PERFORM public.__p167_assert(
    public.asesor_inbox_latest_booking_status(v_exp, 'biometricos') = 'booked',
    'latest booked'
  );
  v_bio := public.asesor_inbox_pendiente_agendar_biometricos(true, 4::smallint, v_exp);
  PERFORM public.__p167_assert(NOT v_bio, 'bio2/3 booked vigente → no pendiente');

  -- 4. booked activo etapa 3 → no pendiente
  v_exp2 := gen_random_uuid();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp2, v_org, v_asesor, 'mejoravit', '99167110007',
    'PISO Bio Booked', '5516700007', '', 'interno', 'activo',
    true, now(), 3, 'en_proceso', now()
  );
  INSERT INTO public.agenda_bookings (
    organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, created_by
  ) VALUES (
    v_org, 'biometricos', v_exp2, current_date, '09:00:00',
    'sede-centro', 'booked', v_asesor
  );
  PERFORM public.__p167_assert(
    NOT public.asesor_inbox_pendiente_agendar_biometricos(true, 3::smallint, v_exp2),
    'bio4 booked activo'
  );

  -- 5. booking cancelado más reciente + elegible → Reagendar
  INSERT INTO public.agenda_bookings (
    organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, created_by, created_at
  ) VALUES (
    v_org, 'biometricos', v_exp2, current_date, '13:00:00',
    'sede-centro', 'cancelled', v_asesor, now() + interval '1 minute'
  );
  -- Still etapa 3: pending true (agendar/reagendar chip); latest cancelled
  UPDATE public.expedientes SET etapa_actual = 4 WHERE id = v_exp2;
  PERFORM public.__p167_assert(
    public.asesor_inbox_latest_booking_status(v_exp2, 'biometricos') = 'cancelled',
    'bio5 latest cancelled'
  );
  PERFORM public.__p167_assert(
    public.asesor_inbox_pendiente_agendar_biometricos(true, 4::smallint, v_exp2),
    'bio5 reagendar'
  );

  -- 6. superó etapa → no pendiente aunque cancel histórico
  UPDATE public.expedientes SET etapa_actual = 6 WHERE id = v_exp2;
  PERFORM public.__p167_assert(
    NOT public.asesor_inbox_pendiente_agendar_biometricos(true, 6::smallint, v_exp2),
    'bio6 etapa superada'
  );

  -- Firma: cancelled + booked nuevo → no; latest cancelled etapa 10 → sí
  v_exp := gen_random_uuid();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99167110008',
    'PISO Firma Hist', '5516700008', '', 'interno', 'activo',
    true, now(), 10, 'en_proceso', now()
  );
  INSERT INTO public.agenda_bookings (
    organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, created_by, created_at
  ) VALUES
    (v_org, 'firmas', v_exp, current_date - 1, '10:00:00',
     'mty-centro', 'cancelled', v_asesor, now() - interval '1 day'),
    (v_org, 'firmas', v_exp, current_date, '11:00:00',
     'mty-centro', 'booked', v_asesor, now());
  v_firma := public.asesor_inbox_pendiente_agendar_firma(true, 10::smallint, v_exp);
  PERFORM public.__p167_assert(NOT v_firma, 'firma booked vigente no pendiente');

  INSERT INTO public.agenda_bookings (
    organization_id, kind, expediente_id, booking_date, booking_time,
    location_id, status, created_by, created_at
  ) VALUES (
    v_org, 'firmas', v_exp, current_date, '12:00:00',
    'mty-centro', 'cancelled', v_asesor, now() + interval '1 minute'
  );
  PERFORM public.__p167_assert(
    public.asesor_inbox_pendiente_agendar_firma(true, 10::smallint, v_exp),
    'firma latest cancelled → reagendar'
  );

  -- F/G aislamiento
  v_exp := gen_random_uuid();
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, direccion_opcional, origen_mesa, ciclo_estado,
    submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, created_at
  ) VALUES (
    v_exp, v_org, v_asesor, 'mejoravit', '99167110009',
    'PISO SoloA', '5516700009', '', 'interno', 'activo',
    true, now(), 2, 'en_proceso', now()
  );
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado)
  VALUES (v_exp, v_org, '{}'::jsonb, 'rechazado');

  PERFORM public.__p167_set_auth(v_asesor);
  v_page := public.asesor_list_expedientes_page(
    1, 25, 'PISO SoloA', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'todos'
  );
  SELECT count(*)::int INTO v_count
  FROM jsonb_array_elements(coalesce(v_page->'items', '[]'::jsonb)) x
  WHERE x->>'cliente_nombre' = 'PISO SoloA';
  PERFORM public.__p167_assert(v_count = 1, 'F propio visible');

  PERFORM public.__p167_set_auth(v_asesor2);
  v_page := public.asesor_list_expedientes_page(
    1, 25, 'PISO SoloA', NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'todos'
  );
  SELECT count(*)::int INTO v_count
  FROM jsonb_array_elements(coalesce(v_page->'items', '[]'::jsonb)) x
  WHERE x->>'cliente_nombre' = 'PISO SoloA';
  PERFORM public.__p167_assert(v_count = 0, 'G ajeno no visible');

  -- H. no autorizado
  PERFORM public.__p167_set_auth(v_editor);
  BEGIN
    PERFORM public.asesor_list_expedientes_page(1, 25);
    v_fail := false;
  EXCEPTION WHEN others THEN
    v_fail := true;
  END;
  PERFORM public.__p167_assert(v_fail, 'H editor bloqueado');

  PERFORM public.__p167_reset_auth();
  RAISE NOTICE 'P167 OK';
END;
$$;

DROP FUNCTION IF EXISTS public.__p167_assert(boolean, text);
DROP FUNCTION IF EXISTS public.__p167_set_auth(uuid);
DROP FUNCTION IF EXISTS public.__p167_reset_auth();
