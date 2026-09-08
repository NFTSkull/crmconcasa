-- Preserva referencias históricas al guardar Datos Generales y recupera únicamente
-- las que tienen evidencia exacta en expediente_asesor_cambios.
--
-- Contexto:
-- - El flujo simplificado externo puede enviar p_referencias = [].
-- - Algunos expedientes ya enviados sí tenían referencias históricas.
-- - Un guardado posterior podía sobrescribirlas a [].
--
-- Regla:
-- - Si una fila YA tenía referencias y un UPDATE intenta dejarlas vacías,
--   conservar las existentes.
-- - Expedientes nuevos que nacen sin referencias no se alteran.
-- - No inventar apellidos: referencias recuperadas se marcan grandfathered.

CREATE OR REPLACE FUNCTION public.cliente_datos_preserve_existing_referencias()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_old_refs jsonb := COALESCE(OLD.referencias, '[]'::jsonb);
  v_new_refs jsonb := COALESCE(NEW.referencias, '[]'::jsonb);
  v_old_struct jsonb;
  v_new_struct jsonb;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF jsonb_typeof(v_old_refs) = 'array'
     AND jsonb_array_length(v_old_refs) > 0
     AND jsonb_typeof(v_new_refs) = 'array'
     AND jsonb_array_length(v_new_refs) = 0 THEN
    NEW.referencias := v_old_refs;
    NEW.datos := jsonb_set(
      COALESCE(NEW.datos, '{}'::jsonb),
      '{referencias}',
      v_old_refs,
      true
    );

    v_old_struct := OLD.datos->'referenciasEstructuradas';
    v_new_struct := NEW.datos->'referenciasEstructuradas';

    IF jsonb_typeof(v_old_struct) = 'array'
       AND jsonb_array_length(v_old_struct) > 0
       AND (
         v_new_struct IS NULL
         OR jsonb_typeof(v_new_struct) <> 'array'
         OR jsonb_array_length(v_new_struct) = 0
       ) THEN
      NEW.datos := jsonb_set(
        COALESCE(NEW.datos, '{}'::jsonb),
        '{referenciasEstructuradas}',
        v_old_struct,
        true
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cliente_datos_preserve_existing_referencias_bu
  ON public.cliente_datos;

CREATE TRIGGER cliente_datos_preserve_existing_referencias_bu
BEFORE UPDATE OF referencias, datos ON public.cliente_datos
FOR EACH ROW
EXECUTE FUNCTION public.cliente_datos_preserve_existing_referencias();

COMMENT ON FUNCTION public.cliente_datos_preserve_existing_referencias() IS
  'Evita pérdida accidental de referencias históricas cuando un guardado posterior manda referencias vacías.';

-- Recuperación exacta, sin PII hardcodeada: toma la última referencia previa
-- registrada por el sistema justo antes de un cambio a []. Solo toca expedientes
-- enviados cuyo valor actual está vacío.
WITH candidates AS (
  SELECT
    cd.expediente_id,
    h.valor_anterior AS refs
  FROM public.cliente_datos cd
  JOIN public.expedientes e
    ON e.id = cd.expediente_id
  CROSS JOIN LATERAL (
    SELECT c.valor_anterior
    FROM public.expediente_asesor_cambio_lotes l
    JOIN public.expediente_asesor_cambios c
      ON c.lote_id = l.id
    WHERE l.expediente_id = cd.expediente_id
      AND c.entidad = 'cliente_datos'
      AND c.campo = 'referencias'
      AND jsonb_typeof(c.valor_anterior) = 'array'
      AND jsonb_array_length(c.valor_anterior) >= 2
      AND COALESCE(c.valor_nuevo, '[]'::jsonb) = '[]'::jsonb
    ORDER BY c.created_at DESC
    LIMIT 1
  ) h
  WHERE e.submitted_to_mesa = true
    AND e.deleted_at IS NULL
    AND jsonb_typeof(COALESCE(cd.referencias, '[]'::jsonb)) = 'array'
    AND jsonb_array_length(COALESCE(cd.referencias, '[]'::jsonb)) = 0
), prepared AS (
  SELECT
    expediente_id,
    refs,
    (
      SELECT jsonb_agg(
        jsonb_build_object(
          'nombre', COALESCE(r.ref->>'nombre', ''),
          'nombres', '',
          'apellidoPaterno', '',
          'apellidoMaterno', '',
          'celular', COALESCE(r.ref->>'celular', r.ref->>'telefono', ''),
          'legacyGrandfathered', true
        )
        ORDER BY r.ord
      )
      FROM jsonb_array_elements(refs) WITH ORDINALITY AS r(ref, ord)
      WHERE r.ord <= 2
    ) AS refs_struct
  FROM candidates
)
UPDATE public.cliente_datos cd
SET
  referencias = p.refs,
  datos = jsonb_set(
    jsonb_set(
      COALESCE(cd.datos, '{}'::jsonb),
      '{referencias}',
      p.refs,
      true
    ),
    '{referenciasEstructuradas}',
    p.refs_struct,
    true
  )
FROM prepared p
WHERE cd.expediente_id = p.expediente_id;
