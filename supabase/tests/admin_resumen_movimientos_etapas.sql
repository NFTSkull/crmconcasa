-- Contrato estático/DDL del resumen Admin de movimientos por etapa.
-- No crea datos de negocio ni toca agenda/citas.

DO $$
DECLARE
  v_proc REGPROCEDURE;
  v_volatility "char";
  v_security_definer BOOLEAN;
BEGIN
  v_proc := to_regprocedure(
    'public.admin_resumen_movimientos_etapas(timestamptz,timestamptz,uuid,text,text)'
  );

  IF v_proc IS NULL THEN
    RAISE EXCEPTION 'admin_resumen_movimientos_etapas no existe';
  END IF;

  SELECT p.provolatile, p.prosecdef
    INTO v_volatility, v_security_definer
  FROM pg_proc p
  WHERE p.oid = v_proc;

  IF v_volatility <> 's' THEN
    RAISE EXCEPTION 'admin_resumen_movimientos_etapas debe ser STABLE';
  END IF;

  IF NOT v_security_definer THEN
    RAISE EXCEPTION 'admin_resumen_movimientos_etapas debe ser SECURITY DEFINER';
  END IF;

  IF has_function_privilege(
    'anon',
    'public.admin_resumen_movimientos_etapas(timestamptz,timestamptz,uuid,text,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'anon no debe ejecutar admin_resumen_movimientos_etapas';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    'public.admin_resumen_movimientos_etapas(timestamptz,timestamptz,uuid,text,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'authenticated debe poder invocar la RPC; el gate interno exige super_admin';
  END IF;
END;
$$;
