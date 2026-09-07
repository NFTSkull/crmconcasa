-- P220: externos upload = envio(8) + acta + constancia situacion fiscal.
-- 0 writers de negocio. No toca envio_para.
\set ON_ERROR_STOP on
\ir ../migrations/220_externos_constancia_sat_upload_opcional.sql

CREATE OR REPLACE FUNCTION public.__p220_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P220 FAIL: %', p_msg;
  END IF;
END;
$$;

DO $$
DECLARE
  v_src TEXT;
  v_silvia UUID;
  v_interno UUID;
  v_envio TEXT[];
  v_upload TEXT[];
  v_upload_int TEXT[];
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'integration_doc_tipos_asesor_upload_para';
  PERFORM public.__p220_assert(v_src IS NOT NULL, 'upload_para existe');
  PERFORM public.__p220_assert(
    position('cliente_constancia_situacion_fiscal' in v_src) > 0,
    'upload_para menciona constancia situacion fiscal'
  );
  PERFORM public.__p220_assert(
    position('''cliente_constancia_sat''' in v_src) = 0,
    'upload_para NO abre cliente_constancia_sat Mesa'
  );
  PERFORM public.__p220_assert(position('UPDATE ' in lower(v_src)) = 0, 'sin UPDATE');

  -- Silvia (externo) si existe en seed/Cloud
  SELECT id INTO v_silvia
  FROM public.profiles
  WHERE lower(email) = 'silvia.reyes@concasa.mx'
  LIMIT 1;

  IF v_silvia IS NOT NULL AND public.asesor_paquete_documental_externos(v_silvia) THEN
    v_envio := public.integration_doc_tipos_asesor_envio_para(v_silvia);
    v_upload := public.integration_doc_tipos_asesor_upload_para(v_silvia);

    PERFORM public.__p220_assert(cardinality(v_envio) = 8, 'envio externos = 8');
    PERFORM public.__p220_assert(
      NOT ('cliente_constancia_situacion_fiscal' = ANY (v_envio)),
      'envio sin constancia situacion fiscal'
    );
    PERFORM public.__p220_assert(
      NOT ('cliente_constancia_sat' = ANY (v_envio)),
      'envio sin constancia_sat Mesa'
    );

    PERFORM public.__p220_assert(cardinality(v_upload) = 10, 'upload externos = 10');
    PERFORM public.__p220_assert(
      'cliente_acta_nacimiento_digital' = ANY (v_upload),
      'upload tiene acta digital'
    );
    PERFORM public.__p220_assert(
      'cliente_constancia_situacion_fiscal' = ANY (v_upload),
      'upload tiene constancia situacion fiscal'
    );
    PERFORM public.__p220_assert(
      NOT ('cliente_constancia_sat' = ANY (v_upload)),
      'upload sin constancia_sat Mesa'
    );
    -- Los 8 de envío están en upload
    PERFORM public.__p220_assert(
      v_envio <@ v_upload,
      'upload contiene envio'
    );
  ELSE
    RAISE NOTICE 'P220: Silvia no disponible en este entorno; contrato estático OK';
  END IF;

  -- Interno: upload_para = upload() global
  SELECT id INTO v_interno
  FROM public.profiles p
  WHERE NOT public.asesor_paquete_documental_externos(p.id)
  ORDER BY p.created_at NULLS LAST, p.id
  LIMIT 1;

  IF v_interno IS NOT NULL THEN
    v_upload_int := public.integration_doc_tipos_asesor_upload_para(v_interno);
    PERFORM public.__p220_assert(
      v_upload_int = public.integration_doc_tipos_asesor_upload(),
      'interno upload_para = upload() global'
    );
  END IF;

  RAISE NOTICE 'P220 OK';
END;
$$;

DROP FUNCTION IF EXISTS public.__p220_assert(BOOLEAN, TEXT);
