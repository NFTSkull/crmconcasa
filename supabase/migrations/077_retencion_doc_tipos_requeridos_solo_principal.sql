-- ConCasa CRM — P077: retención requiere únicamente el documento principal por opción
-- Opción A (con_sello): retencion_acuse_con_sello
-- Opción B (sin_sello): retencion_carta_sin_sello
-- No borra ni backfill de aviso/INE históricos; upload de esos tipos sigue permitido.

CREATE OR REPLACE FUNCTION public.retencion_doc_tipos_requeridos(p_opcion public.retencion_opcion)
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE p_opcion
    WHEN 'con_sello' THEN ARRAY[
      'retencion_acuse_con_sello'
    ]::TEXT[]
    WHEN 'sin_sello' THEN ARRAY[
      'retencion_carta_sin_sello'
    ]::TEXT[]
  END;
$$;

COMMENT ON FUNCTION public.retencion_doc_tipos_requeridos(public.retencion_opcion) IS
  'P077: tipos documentales obligatorios de retención por opción A/B (solo documento principal).';

REVOKE ALL ON FUNCTION public.retencion_doc_tipos_requeridos(public.retencion_opcion) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.retencion_doc_tipos_requeridos(public.retencion_opcion) FROM anon;
