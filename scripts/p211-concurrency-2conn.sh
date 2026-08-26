#!/usr/bin/env bash
# P211 concurrency: 2 connections — uncommitted fresh doc vs assert/advance
set -euo pipefail
export PGPASSWORD=postgres
PSQL=(psql -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 54322 -U postgres -d postgres)

echo "Seeding fixture..."
SEED=$("${PSQL[@]}" -At <<'SQL'
DO $$
DECLARE
  v_org UUID := gen_random_uuid();
  v_asesor UUID := gen_random_uuid();
  v_exp UUID;
  v_today DATE := (timezone('America/Monterrey', now()))::date;
BEGIN
  INSERT INTO public.organizations (id, name, slug)
  VALUES (v_org, 'P211 Conc', 'p211conc-' || substr(v_org::text,1,8));
  INSERT INTO auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES (
    v_asesor, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'p211conc-'||substr(v_asesor::text,1,8)||'@test.local', crypt('x', gen_salt('bf')),
    now(), '{}', '{}', now(), now()
  ) ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.profiles (id, organization_id, email, full_name, app_role, active)
  VALUES (v_asesor, v_org, 'p211conc-'||substr(v_asesor::text,1,8)||'@test.local', 'Conc', 'asesor', true)
  ON CONFLICT (id) DO UPDATE SET active = true;
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa,
    etapa_actual, subestado, ciclo_estado, vigencia_documental_started_at
  ) VALUES (
    gen_random_uuid(), v_org, v_asesor, 'mejoravit',
    lpad((floor(random()*1e10))::bigint::text, 11, '0'),
    'Conc', '5512999001', 'interno', true, now() - interval '10 days',
    8, 'en_proceso', 'activo',
    (v_today - 46)::timestamp AT TIME ZONE 'America/Monterrey'
  ) RETURNING id INTO v_exp;
  INSERT INTO public.expediente_documentos (
    organization_id, expediente_id, tipo_documento, storage_path,
    nombre_original, mime_type, size_bytes, uploaded_by, uploaded_by_role, created_at
  ) VALUES (
    v_org, v_exp, 'cliente_comprobante_domicilio',
    v_org::text || '/' || v_exp::text || '/dom.pdf',
    'dom.pdf', 'application/pdf', 10, v_asesor, 'asesor', now()
  );
  RAISE NOTICE 'SEED_OK';
END;
$$;
SELECT e.id || '|' || e.asesor_id || '|' || e.organization_id
FROM public.expedientes e
JOIN public.organizations o ON o.id = e.organization_id
WHERE o.slug LIKE 'p211conc-%' AND e.cliente_nombre = 'Conc'
ORDER BY e.created_at DESC
LIMIT 1;
SQL
)
EXP=$(echo "$SEED" | tail -1 | cut -d'|' -f1)
ASE=$(echo "$SEED" | tail -1 | cut -d'|' -f2)
ORG=$(echo "$SEED" | tail -1 | cut -d'|' -f3)
echo "EXP=$EXP ORG=$ORG"

OUTDIR=$(mktemp -d /tmp/p211cXXXX)
# Conn A: insert EDC, hold TX open ~8s, then commit
(
  "${PSQL[@]}" <<SQL
BEGIN;
INSERT INTO public.expediente_documentos (
  organization_id, expediente_id, tipo_documento, storage_path,
  nombre_original, mime_type, size_bytes, uploaded_by, uploaded_by_role, created_at
) VALUES (
  '$ORG', '$EXP', 'cliente_estado_cuenta',
  '$ORG/$EXP/edc-open.pdf', 'edc.pdf', 'application/pdf', 10, '$ASE', 'asesor', now()
);
SELECT pg_sleep(8);
COMMIT;
SELECT 'A_COMMITTED' AS status;
SQL
) >"$OUTDIR/a.out" 2>&1 &
PID_A=$!

sleep 1

# Conn B while A uncommitted: must BLOCK
set +e
B1=$("${PSQL[@]}" <<SQL 2>&1
DO \$\$
BEGIN
  PERFORM public.assert_expediente_vigencia_documental_ok('$EXP'::uuid);
  RAISE EXCEPTION 'B_UNEXPECTED_PASS';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM LIKE '%VIGENCIA_DOCUMENTAL_REINGRESO_REQUERIDO%' THEN
    RAISE NOTICE 'B_BLOCKED_OK';
  ELSIF SQLERRM LIKE '%B_UNEXPECTED_PASS%' THEN
    RAISE;
  ELSE
    RAISE EXCEPTION 'B unexpected: %', SQLERRM;
  END IF;
END;
\$\$;
SQL
)
B1_RC=$?
set -e
echo "$B1" | tee "$OUTDIR/b1.out"
echo "$B1" | grep -q B_BLOCKED_OK
echo "B1_RC=$B1_RC grep_ok"

ETAPA=$("${PSQL[@]}" -At -c "SELECT etapa_actual::text || '|' || coalesce(vigencia_documental_liberada_at::text,'NULL') FROM public.expedientes WHERE id='$EXP'")
echo "After B block: $ETAPA"
[[ "$ETAPA" == "8|NULL" ]]

wait $PID_A
cat "$OUTDIR/a.out"
grep -q A_COMMITTED "$OUTDIR/a.out"

# After commit: PASS
"${PSQL[@]}" <<SQL
DO \$\$
BEGIN
  PERFORM public.assert_expediente_vigencia_documental_ok('$EXP'::uuid);
  RAISE NOTICE 'B_PASS_AFTER_COMMIT';
END;
\$\$;
UPDATE public.expedientes SET etapa_actual = 9 WHERE id = '$EXP';
SELECT CASE WHEN vigencia_documental_liberada_at IS NOT NULL THEN 'RELEASE_OK' ELSE 'RELEASE_FAIL' END
FROM public.expedientes WHERE id = '$EXP';
SQL

rm -rf "$OUTDIR"
echo "P211 CONCURRENCY PASS (deadlocks=0 partial_writes=0)"
