#!/usr/bin/env bash
# P189 B4 LOCAL: mig 185 + SQL worker + E2E Storage/PDF + Deno check.
# NO Cloud / NO --linked / NO deploy / NO cron / NO smoke / NO commit.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DB_HOST="${SUPABASE_DB_HOST:-127.0.0.1}"
DB_PORT="${SUPABASE_DB_PORT:-54322}"
DB_USER="${SUPABASE_DB_USER:-postgres}"
DB_PASSWORD="${SUPABASE_DB_PASSWORD:-postgres}"
DB_NAME="${SUPABASE_DB_NAME:-postgres}"
DENO_BIN="${DENO_BIN:-$HOME/.deno/bin/deno}"
WORKER_PORT="${INFONAVIT_PDF_WORKER_PORT:-8789}"

if ! pg_isready -h "$DB_HOST" -p "$DB_PORT" >/dev/null 2>&1; then
  echo "LOCAL_ENV_FAILURE: Postgres no responde en ${DB_HOST}:${DB_PORT}"
  exit 2
fi

psql_local() {
  PGPASSWORD="$DB_PASSWORD" psql -v ON_ERROR_STOP=1 \
    -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" "$@"
}

echo "==> Apply mig 183/184/185 LOCAL"
psql_local -f supabase/migrations/183_cliente_datos_telefonos_unicos.sql
psql_local -f supabase/migrations/184_infonavit_submission_snapshot_outbox.sql
psql_local -f supabase/migrations/185_infonavit_pdf_worker_contract.sql

echo "==> Register schema_migrations 183/184/185 if missing"
psql_local -c "INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('183', 'cliente_datos_telefonos_unicos') ON CONFLICT (version) DO NOTHING;"
psql_local -c "INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('184', 'infonavit_submission_snapshot_outbox') ON CONFLICT (version) DO NOTHING;"
psql_local -c "INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('185', 'infonavit_pdf_worker_contract') ON CONFLICT (version) DO NOTHING;"

echo "==> SHA 183/184 AFTER (must match BEFORE)"
shasum -a 256 \
  supabase/migrations/183_cliente_datos_telefonos_unicos.sql \
  supabase/migrations/184_infonavit_submission_snapshot_outbox.sql

echo "==> Suite SQL B4"
psql_local -f supabase/tests/rpc_infonavit_pdf_worker_p189_b4.sql

echo "==> SKIP LOCKED concurrent (two psql sessions)"
OID="$(psql_local -t -A -c "SELECT id::text FROM public.infonavit_pdf_outbox WHERE id = '00000000-0000-4000-9185-00000000aa01'::uuid;")"
if [ -n "$OID" ]; then
  psql_local -c "
    UPDATE public.infonavit_pdf_outbox
    SET status='pending', attempts=0, available_at=NOW(),
        processing_started_at=NULL, processed_at=NULL, documento_id=NULL
    WHERE id='00000000-0000-4000-9185-00000000aa01'::uuid;
    DELETE FROM public.expediente_documentos
    WHERE id IN (
      SELECT documento_id FROM public.infonavit_pdf_outbox
      WHERE id='00000000-0000-4000-9185-00000000aa01'::uuid AND documento_id IS NOT NULL
    );
  " >/dev/null
fi
SESSION1_SQL="BEGIN; SELECT public.infonavit_pdf_claim_outbox('00000000-0000-4000-9185-00000000aa01'::uuid, 1); SELECT pg_sleep(3); COMMIT;"
SESSION2_SQL="SELECT public.infonavit_pdf_claim_outbox('00000000-0000-4000-9185-00000000aa01'::uuid, 1) AS claim2;"
PGPASSWORD="$DB_PASSWORD" psql -v ON_ERROR_STOP=1 -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "$SESSION1_SQL" >/tmp/p189-b4-claim1.txt &
PID1=$!
sleep 0.4
PGPASSWORD="$DB_PASSWORD" psql -v ON_ERROR_STOP=1 -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "$SESSION2_SQL" >/tmp/p189-b4-claim2.txt
wait "$PID1"
if grep -q '"outbox_id"' /tmp/p189-b4-claim2.txt && grep -q '00000000-0000-4000-9185-00000000aa01' /tmp/p189-b4-claim2.txt; then
  if grep -q '"claimed": \[\]' /tmp/p189-b4-claim2.txt || grep -q '"claimed":[]' /tmp/p189-b4-claim2.txt; then
    echo "SKIP LOCKED: segunda sesión 0 rows"
  else
    echo "P189 B4 FAIL: segunda sesión obtuvo claim"
    cat /tmp/p189-b4-claim2.txt
    exit 1
  fi
else
  echo "SKIP LOCKED: segunda sesión sin outbox (ok)"
fi

echo "==> npm unit B4"
npm run test:p189-b4

echo "==> E2E local Storage/PDF"
npx tsx supabase/functions/_shared/infonavit-pdf/e2e-local.ts

if [ ! -x "$DENO_BIN" ]; then
  echo "LOCAL_ENV_FAILURE: deno no encontrado en $DENO_BIN"
  exit 2
fi

echo "==> deno check worker"
(
  cd supabase/functions/infonavit-pdf-worker
  "$DENO_BIN" check --config deno.json index.ts
)

echo "==> bundled template SHA from worker filesystem"
(
  cd supabase/functions/infonavit-pdf-worker
  "$DENO_BIN" run --allow-read --config deno.json certify-templates.ts
)

echo "==> worker HTTP auth (deno serve local, 0 Cloud)"
WORKER_SECRET="$(openssl rand -hex 16)"
export INFONAVIT_PDF_WORKER_SECRET="$WORKER_SECRET"
export INFONAVIT_PDF_WORKER_PORT="$WORKER_PORT"
export SUPABASE_URL="${SUPABASE_URL:-http://127.0.0.1:54321}"
export SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU}"
(
  cd supabase/functions/infonavit-pdf-worker
  "$DENO_BIN" run --allow-net --allow-env --allow-read --config deno.json index.ts
) >/tmp/p189-b4-worker-serve.log 2>&1 &
WORKER_PID=$!
cleanup_worker() { kill "$WORKER_PID" 2>/dev/null || true; }
trap cleanup_worker EXIT
for _ in $(seq 1 50); do
  if curl -sS -o /dev/null -w "%{http_code}" -X POST "http://127.0.0.1:${WORKER_PORT}/" | grep -qE '401|405|200'; then
    break
  fi
  sleep 0.1
done
CODE_NO="$(curl -sS -o /tmp/p189-b4-auth-no.json -w "%{http_code}" -X POST "http://127.0.0.1:${WORKER_PORT}/" -H 'Content-Type: application/json' -d '{}')"
CODE_BAD="$(curl -sS -o /tmp/p189-b4-auth-bad.json -w "%{http_code}" -X POST "http://127.0.0.1:${WORKER_PORT}/" -H 'Content-Type: application/json' -H 'x-concasa-worker-secret: wrong' -d '{}')"
CODE_OK="$(curl -sS -o /tmp/p189-b4-auth-ok.json -w "%{http_code}" -X POST "http://127.0.0.1:${WORKER_PORT}/" -H 'Content-Type: application/json' -H "x-concasa-worker-secret: ${WORKER_SECRET}" -d '{}')"
if [ "$CODE_NO" != "401" ] || [ "$CODE_BAD" != "401" ]; then
  echo "P189 B4 FAIL: auth HTTP esperado 401 (got no=$CODE_NO bad=$CODE_BAD)"
  exit 1
fi
if [ "$CODE_OK" = "401" ]; then
  echo "P189 B4 FAIL: secret correcto no debe ser 401"
  exit 1
fi
echo "worker HTTP auth: PASS (no=$CODE_NO bad=$CODE_BAD ok=$CODE_OK)"

echo "P189 B4 LOCAL: PASSED"
