-- P3K.2 / P044 / P090 / P092: complementarios Mesa opcionales —
-- obligatorios = 4 asesor; mesa_upload = 5 tipos (pagaré + notificación).

DO $$
DECLARE
  v_oblig TEXT[];
  v_mesa TEXT[];
BEGIN
  v_oblig := public.integration_doc_tipos_obligatorios();
  v_mesa := public.integration_doc_tipos_mesa_upload();

  IF cardinality(v_oblig) <> 4 THEN
    RAISE EXCEPTION 'mesa_complementarios_opcionales: se esperaban 4 obligatorios, hay %', cardinality(v_oblig);
  END IF;

  IF NOT (v_oblig @> ARRAY[
    'cliente_ine_frente',
    'cliente_ine_reverso',
    'cliente_comprobante_domicilio',
    'cliente_estado_cuenta'
  ]::TEXT[]) THEN
    RAISE EXCEPTION 'mesa_complementarios_opcionales: obligatorios no coinciden con asesor_envio';
  END IF;

  IF 'nss' = ANY(v_oblig) THEN
    RAISE EXCEPTION 'mesa_complementarios_opcionales: nss no debe ser obligatorio';
  END IF;

  IF 'cliente_semanas_cotizadas' = ANY(v_oblig) THEN
    RAISE EXCEPTION 'mesa_complementarios_opcionales: semanas no debe ser obligatorio';
  END IF;
  IF 'cliente_acta_nacimiento' = ANY(v_oblig) THEN
    RAISE EXCEPTION 'mesa_complementarios_opcionales: acta no debe ser obligatorio';
  END IF;
  IF 'cliente_constancia_sat' = ANY(v_oblig) THEN
    RAISE EXCEPTION 'mesa_complementarios_opcionales: SAT no debe ser obligatorio';
  END IF;

  IF cardinality(v_mesa) <> 6 THEN
    RAISE EXCEPTION 'mesa_complementarios_opcionales: se esperaban 6 mesa_upload, hay %', cardinality(v_mesa);
  END IF;

  IF NOT (v_mesa @> ARRAY[
    'cliente_semanas_cotizadas',
    'cliente_acta_nacimiento',
    'cliente_constancia_sat',
    'cliente_pagare',
    'cliente_notificacion',
    'cliente_solicitud'
  ]::TEXT[]) THEN
    RAISE EXCEPTION 'mesa_complementarios_opcionales: mesa_upload incompleto';
  END IF;

  IF 'cliente_pagare' = ANY(v_oblig) THEN
    RAISE EXCEPTION 'mesa_complementarios_opcionales: pagaré no debe ser obligatorio';
  END IF;

  IF 'cliente_notificacion' = ANY(v_oblig) THEN
    RAISE EXCEPTION 'mesa_complementarios_opcionales: notificación no debe ser obligatorio';
  END IF;

  IF 'cliente_solicitud' = ANY(v_oblig) THEN
    RAISE EXCEPTION 'mesa_complementarios_opcionales: solicitud no debe ser obligatorio';
  END IF;

  IF public.integration_doc_tipos_obligatorios()
    <> public.integration_doc_tipos_asesor_envio() THEN
    RAISE EXCEPTION 'mesa_complementarios_opcionales: obligatorios debe igualar asesor_envio';
  END IF;

  RAISE NOTICE 'mesa_complementarios_opcionales: OK (4 obligatorios, 6 mesa_upload incl. pagaré+notif+solicitud)';
END;
$$;
