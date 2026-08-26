#!/usr/bin/env bash
# P210 FASE 9 — concurrencia real (dos conexiones psql).
set -euo pipefail

DB_HOST="${SUPABASE_DB_HOST:-127.0.0.1}"
DB_PORT="${SUPABASE_DB_PORT:-54322}"
DB_USER="${SUPABASE_DB_USER:-postgres}"
DB_PASSWORD="${SUPABASE_DB_PASSWORD:-postgres}"
DB_NAME="${SUPABASE_DB_NAME:-postgres}"

PSQL=(psql -v ON_ERROR_STOP=1 -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME")
export PGPASSWORD="$DB_PASSWORD"

TMPDIR="${TMPDIR:-/tmp}"
REPO="/tmp/crmconcasa-p209-correction-explanation"
SETUP="$TMPDIR/p210-concurrency-setup.sql"
CALL="$TMPDIR/p210-concurrency-call.sql"

cat > "$SETUP" <<'EOSQL'
\set ON_ERROR_STOP on

DO $$
DECLARE
  v_org UUID := '00000000-0000-4000-8070-000000000001';
  v_asesor UUID := '00000000-0000-4000-8071-000000000001';
  v_mesa UUID := '00000000-0000-4000-8074-000000000001';
  v_envio TIMESTAMPTZ := '2026-08-01 10:00:00+00';
  v_request TIMESTAMPTZ := '2026-08-24 13:45:46+00';
  v_save TIMESTAMPTZ := '2026-08-24 17:55:00+00';
  v_exp UUID := '00000000-0000-4000-8070-000000000099';
  v_lote UUID := gen_random_uuid();
BEGIN
  DELETE FROM public.expediente_paso_visual_transiciones WHERE expediente_id = v_exp;
  DELETE FROM public.expediente_asesor_cambios WHERE lote_id IN (
    SELECT id FROM public.expediente_asesor_cambio_lotes WHERE expediente_id = v_exp
  );
  DELETE FROM public.expediente_asesor_cambio_lotes WHERE expediente_id = v_exp;
  DELETE FROM public.action_log WHERE entity_id = v_exp;
  DELETE FROM public.cliente_datos WHERE expediente_id = v_exp;
  DELETE FROM public.expedientes WHERE id = v_exp;

  INSERT INTO public.organizations (id, slug, name) VALUES (v_org, 'p210-conc', 'P210 conc') ON CONFLICT DO NOTHING;
  INSERT INTO public.profiles (id, organization_id, app_role, active, email, tipo_mesa)
  VALUES (v_asesor, v_org, 'asesor', true, 'p210-conc@test', NULL), (v_mesa, v_org, 'mesa_interno', true, 'p210-mesa-conc@test', 'interno')
  ON CONFLICT DO NOTHING;
  INSERT INTO public.expedientes (
    id, organization_id, asesor_id, programa, nss, cliente_nombre,
    telefono_cliente, origen_mesa, submitted_to_mesa, fecha_envio_mesa, etapa_actual, subestado, ciclo_estado
  ) VALUES (v_exp, v_org, v_asesor, 'mejoravit', '91234567807', 'F9 conc', '5512100007', 'interno', true, v_envio, 1, 'en_proceso', 'activo');
  INSERT INTO public.cliente_datos (expediente_id, organization_id, datos, estado) VALUES (v_exp, v_org, '{}'::jsonb, 'completo');
  INSERT INTO public.action_log (organization_id, actor_id, actor_role, action, entity_type, entity_id, payload, created_at)
  VALUES (v_org, v_mesa, 'mesa_interno', 'cliente_datos.revision.update', 'cliente_datos', v_exp,
    jsonb_build_object('estado_nuevo', 'rechazado', 'comentario_rechazo', 'RFC'), v_request);
  INSERT INTO public.expediente_asesor_cambio_lotes (id, organization_id, expediente_id, asesor_id, status, submitted_at, created_at)
  VALUES (v_lote, v_org, v_exp, v_asesor, 'pendiente_revision', v_envio, v_envio);
  INSERT INTO public.expediente_asesor_cambios (
    lote_id, change_key, tipo, entidad, campo, label, valor_anterior, valor_nuevo, created_at
  ) VALUES (v_lote, 'campo:rfc', 'campo_actualizado', 'cliente_datos', 'rfc', 'RFC actualizado',
    '"A"'::jsonb, '"B"'::jsonb, v_save);
END;
$$;
EOSQL

cat > "$CALL" <<'EOSQL'
\set ON_ERROR_STOP off
DO $$
DECLARE
  v_res JSONB;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-4000-8071-000000000001', true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  v_res := public.asesor_reenviar_correccion_a_mesa('00000000-0000-4000-8070-000000000099'::uuid);
  RAISE NOTICE 'P210 CONC RESULT: %', v_res;
END;
$$;
EOSQL

cd "$REPO"
"${PSQL[@]}" -f supabase/migrations/210_asesor_correccion_accionable_reenvio.sql > /dev/null
"${PSQL[@]}" -f "$SETUP" > /dev/null

OUT_A="$TMPDIR/p210-conc-a.out"
OUT_B="$TMPDIR/p210-conc-b.out"
("${PSQL[@]}" -f "$CALL" > "$OUT_A" 2>&1) &
PID_A=$!
("${PSQL[@]}" -f "$CALL" > "$OUT_B" 2>&1) &
PID_B=$!
wait "$PID_A" || true
wait "$PID_B" || true

echo "=== Connection A ==="
cat "$OUT_A"
echo "=== Connection B ==="
cat "$OUT_B"

"${PSQL[@]}" -Atc "
SELECT count(*) FROM public.expediente_asesor_cambio_lotes
WHERE expediente_id = '00000000-0000-4000-8070-000000000099'
  AND submitted_at > timestamptz '2026-08-24 13:45:46+00';
"

"${PSQL[@]}" -Atc "
SELECT estado FROM public.mesa_cambio_revision_estado_efectivo('00000000-0000-4000-8070-000000000099');
"
