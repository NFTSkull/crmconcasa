-- P224: externos upload = envio(8) + acta + SAT + semanas + vigencia.
-- 0 writers de negocio. No toca envio_para.
\set ON_ERROR_STOP on
\ir ../migrations/224_externos_semanas_vigencia_upload_opcional.sql

CREATE OR REPLACE FUNCTION public.__p224_assert(p_ok BOOLEAN, p_msg TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF NOT p_ok THEN
    RAISE EXCEPTION 'P224 FAIL: %', p_msg;
  END IF;
END;
$$;

DO $$
DECLARE
  v_src TEXT;
  v_silvia UUID;
  v_adriana UUID;
  v_interno UUID;
  v_envio TEXT[];
  v_upload TEXT[];
  v_upload_int TEXT[];
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'integration_doc_tipos_asesor_upload_para';
  PERFORM public.__p224_assert(v_src IS NOT NULL, 'upload_para existe');
  PERFORM public.__p224_assert(
    position('cliente_semanas_cotizadas' in v_src) > 0,
    'upload_para menciona semanas cotizadas'
  );
  PERFORM public.__p224_assert(
    position('cliente_vigencia_derechos' in v_src) > 0,
    'upload_para menciona vigencia derechos'
  );
  PERFORM public.__p224_assert(position('UPDATE ' in lower(v_src)) = 0, 'sin UPDATE');
  PERFORM public.__p224_assert(position('DELETE ' in upper(v_src)) = 0, 'sin DELETE');

  SELECT id INTO v_silvia
  FROM public.profiles
  WHERE lower(email) = 'silvia.reyes@concasa.mx'
  LIMIT 1;

  SELECT id INTO v_adriana
  FROM public.profiles
  WHERE lower(email) = 'adriana.reyes@concasa.mx'
  LIMIT 1;

  IF v_silvia IS NOT NULL AND public.asesor_paquete_documental_externos(v_silvia) THEN
    v_envio := public.integration_doc_tipos_asesor_envio_para(v_silvia);
    v_upload := public.integration_doc_tipos_asesor_upload_para(v_silvia);

    PERFORM public.__p224_assert(cardinality(v_envio) = 8, 'envio externos = 8');
    PERFORM public.__p224_assert(
      NOT ('cliente_semanas_cotizadas' = ANY (v_envio)),
      'envio sin semanas'
    );
    PERFORM public.__p224_assert(
      NOT ('cliente_vigencia_derechos' = ANY (v_envio)),
      'envio sin vigencia'
    );
    PERFORM public.__p224_assert(
      NOT ('cliente_constancia_situacion_fiscal' = ANY (v_envio)),
      'envio sin constancia situacion fiscal'
    );

    PERFORM public.__p224_assert(cardinality(v_upload) = 12, 'upload externos = 12');
    PERFORM public.__p224_assert(v_envio <@ v_upload, 'upload contiene envio');
    PERFORM public.__p224_assert(
      'cliente_acta_nacimiento_digital' = ANY (v_upload),
      'upload tiene acta'
    );
    PERFORM public.__p224_assert(
      'cliente_constancia_situacion_fiscal' = ANY (v_upload),
      'upload tiene SAT asesor'
    );
    PERFORM public.__p224_assert(
      'cliente_semanas_cotizadas' = ANY (v_upload),
      'upload tiene semanas'
    );
    PERFORM public.__p224_assert(
      'cliente_vigencia_derechos' = ANY (v_upload),
      'upload tiene vigencia'
    );
    PERFORM public.__p224_assert(
      NOT ('asesor_evidencia' = ANY (v_upload)),
      'upload externos SIN evidencia'
    );
  ELSE
    RAISE NOTICE 'P224: Silvia no disponible; contrato estático OK';
  END IF;

  IF v_adriana IS NOT NULL AND public.asesor_paquete_documental_externos(v_adriana) THEN
    v_upload := public.integration_doc_tipos_asesor_upload_para(v_adriana);
    PERFORM public.__p224_assert(
      'cliente_semanas_cotizadas' = ANY (v_upload)
        AND 'cliente_vigencia_derechos' = ANY (v_upload),
      'Adriana (equipo) tiene semanas+vigencia en upload'
    );
    PERFORM public.__p224_assert(
      cardinality(public.integration_doc_tipos_asesor_envio_para(v_adriana)) = 8,
      'Adriana envio = 8'
    );
  END IF;

  SELECT id INTO v_interno
  FROM public.profiles p
  WHERE NOT public.asesor_paquete_documental_externos(p.id)
  ORDER BY p.created_at NULLS LAST, p.id
  LIMIT 1;

  IF v_interno IS NOT NULL THEN
    v_upload_int := public.integration_doc_tipos_asesor_upload_para(v_interno);
    PERFORM public.__p224_assert(
      v_upload_int = public.integration_doc_tipos_asesor_upload(),
      'interno upload_para = upload() global'
    );
  END IF;

  RAISE NOTICE 'P224 OK';
END;
$$;

DROP FUNCTION IF EXISTS public.__p224_assert(BOOLEAN, TEXT);
