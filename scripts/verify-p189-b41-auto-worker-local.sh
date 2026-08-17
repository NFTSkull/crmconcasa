#!/usr/bin/env bash
# P189 B4.1 LOCAL: cron + pg_net + Vault → worker automático.
# NO Cloud / NO --linked WRITE / NO deploy / NO smoke / NO commit.
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
NETWORK="${P189_DOCKER_NETWORK:-supabase_network_Copia_de_concasa_crm}"
DB_CONTAINER="${P189_DB_CONTAINER:-supabase_db_Copia_de_concasa_crm}"

ORG='00000000-0000-4000-9186-000000000100'
ASESOR='00000000-0000-4000-9186-000000000111'
EXP_T2='00000000-0000-4000-9186-000000000010'
EXP_T4='00000000-0000-4000-9186-000000000020'
EXP_T6='00000000-0000-4000-9186-000000000030'
EXP_T7='00000000-0000-4000-9186-000000000040'

if ! pg_isready -h "$DB_HOST" -p "$DB_PORT" >/dev/null 2>&1; then
  echo "LOCAL_ENV_FAILURE: Postgres no responde en ${DB_HOST}:${DB_PORT}"
  exit 2
fi

if [ ! -x "$DENO_BIN" ]; then
  echo "LOCAL_ENV_FAILURE: deno no encontrado en $DENO_BIN"
  exit 2
fi

psql_local() {
  PGPASSWORD="$DB_PASSWORD" psql -v ON_ERROR_STOP=1 \
    -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" "$@"
}

psql_scalar() {
  psql_local -t -A -c "$1"
}

echo "==> SHA 183/184/185 BEFORE (B4.1 must not change)"
shasum -a 256 \
  supabase/migrations/183_cliente_datos_telefonos_unicos.sql \
  supabase/migrations/184_infonavit_submission_snapshot_outbox.sql \
  supabase/migrations/185_infonavit_pdf_worker_contract.sql

echo "==> Cron BEFORE"
psql_local -c "SELECT jobid, jobname, schedule, command, active FROM cron.job ORDER BY jobid;" \
  | tee /tmp/p189-b41-cron-before.txt

echo "==> Apply mig 186 LOCAL"
psql_local -f supabase/migrations/186_infonavit_pdf_worker_schedule.sql
psql_local -c "INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('186', 'infonavit_pdf_worker_schedule') ON CONFLICT (version) DO NOTHING;"

echo "==> SHA 183/184/185 AFTER"
shasum -a 256 \
  supabase/migrations/183_cliente_datos_telefonos_unicos.sql \
  supabase/migrations/184_infonavit_submission_snapshot_outbox.sql \
  supabase/migrations/185_infonavit_pdf_worker_contract.sql

echo "==> Suite SQL B4.1"
psql_local -f supabase/tests/rpc_infonavit_pdf_dispatch_p189_b41.sql

echo "==> Cron AFTER"
psql_local -c "SELECT jobid, jobname, schedule, command, active FROM cron.job ORDER BY jobid;" \
  | tee /tmp/p189-b41-cron-after.txt

P189_JOBS="$(psql_scalar "SELECT count(*) FROM cron.job WHERE jobname='infonavit-pdf-worker-dispatch';")"
if [ "$P189_JOBS" != "1" ]; then
  echo "P189 B4.1 FAIL: expected 1 P189 job, got ${P189_JOBS}"
  exit 1
fi

echo "==> npm unit B4.1"
npm run test:p189-b41

WORKER_PID=""
cleanup() {
  if [ -n "${WORKER_PID}" ]; then
    kill "$WORKER_PID" 2>/dev/null || true
  fi
  docker rm -f p189-b41-rest p189-b41-storage p189-b41-kong >/dev/null 2>&1 || true
  psql_local -c "DELETE FROM vault.secrets WHERE name IN ('infonavit_pdf_worker_url','infonavit_pdf_worker_secret');" \
    >/dev/null 2>&1 || true
  rm -f /tmp/p189-b41-kong.yml /tmp/p189-b41-secret.env
}
trap cleanup EXIT

echo "==> Freeze foreign outbox + start local Edge stack (no reset)"
psql_local -c "SELECT public.__p189_b41_freeze_foreign(); SELECT public.__p189_b41_purge();" >/dev/null

docker rm -f p189-b41-rest p189-b41-storage p189-b41-kong >/dev/null 2>&1 || true

docker run -d --name p189-b41-rest \
  --network "$NETWORK" \
  -e PGRST_DB_URI="postgres://authenticator:postgres@${DB_CONTAINER}:5432/postgres" \
  -e PGRST_DB_SCHEMAS='public,graphql_public,storage' \
  -e PGRST_DB_ANON_ROLE='anon' \
  -e PGRST_JWT_SECRET='super-secret-jwt-token-with-at-least-32-characters-long' \
  -e PGRST_DB_EXTRA_SEARCH_PATH='public,extensions' \
  -e PGRST_DB_MAX_ROWS='1000' \
  public.ecr.aws/supabase/postgrest:v14.5 >/dev/null

docker run -d --name p189-b41-storage \
  --network "$NETWORK" \
  -e ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0' \
  -e SERVICE_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU' \
  -e AUTH_JWT_SECRET='super-secret-jwt-token-with-at-least-32-characters-long' \
  -e PGRST_JWT_SECRET='super-secret-jwt-token-with-at-least-32-characters-long' \
  -e DATABASE_URL="postgres://supabase_storage_admin:postgres@${DB_CONTAINER}:5432/postgres" \
  -e FILE_SIZE_LIMIT=52428800 \
  -e STORAGE_BACKEND=file \
  -e FILE_STORAGE_BACKEND_PATH=/var/lib/storage \
  -e TENANT_ID=stub \
  -e REGION=stub \
  -e GLOBAL_S3_BUCKET=stub \
  -e REQUEST_ALLOW_X_FORWARDED_PATH=true \
  public.ecr.aws/supabase/storage-api:v1.61.4 >/dev/null

cat > /tmp/p189-b41-kong.yml << EOF
_format_version: "2.1"
_transform: true
services:
  - name: rest-v1
    url: http://p189-b41-rest:3000/
    routes:
      - name: rest-v1-all
        strip_path: true
        paths:
          - /rest/v1/
    plugins:
      - name: cors
  - name: storage-v1
    url: http://p189-b41-storage:5000/
    routes:
      - name: storage-v1-all
        strip_path: true
        paths:
          - /storage/v1/
    plugins:
      - name: cors
  - name: functions-v1
    url: http://host.docker.internal:8789/
    routes:
      - name: functions-v1-all
        strip_path: true
        paths:
          - /functions/v1/
    plugins:
      - name: cors
EOF

docker run -d --name p189-b41-kong \
  --network "$NETWORK" \
  --add-host=host.docker.internal:host-gateway \
  -p 127.0.0.1:54321:8000 \
  -e KONG_DATABASE=off \
  -e KONG_DECLARATIVE_CONFIG=/home/kong/kong.yml \
  -e KONG_DNS_ORDER=LAST,A,CNAME \
  -e KONG_PLUGINS=request-transformer,cors,key-auth,acl,basic-auth \
  -v /tmp/p189-b41-kong.yml:/home/kong/kong.yml:ro \
  public.ecr.aws/supabase/kong:2.8.1 >/dev/null

WORKER_SECRET="$(openssl rand -hex 24)"
export INFONAVIT_PDF_WORKER_SECRET="$WORKER_SECRET"
export INFONAVIT_PDF_WORKER_PORT="$WORKER_PORT"
export SUPABASE_URL="${SUPABASE_URL:-http://127.0.0.1:54321}"
export SUPABASE_SERVICE_ROLE_KEY="${SUPABASE_SERVICE_ROLE_KEY:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU}"

(
  cd supabase/functions/infonavit-pdf-worker
  "$DENO_BIN" run --allow-net --allow-env --allow-read --config deno.json index.ts
) >/tmp/p189-b41-worker.log 2>&1 &
WORKER_PID=$!

for _ in $(seq 1 80); do
  code="$(curl -sS -o /dev/null -m 1 -w "%{http_code}" -X POST "http://127.0.0.1:${WORKER_PORT}/" || true)"
  if echo "$code" | grep -qE '401|405|200'; then
    echo "worker up http=${code}"
    break
  fi
  sleep 0.25
done
code="$(curl -sS -o /dev/null -m 2 -w "%{http_code}" -X POST "http://127.0.0.1:${WORKER_PORT}/" || true)"
if ! echo "$code" | grep -qE '401|405|200'; then
  echo "LOCAL_ENV_FAILURE: worker no escucha en :${WORKER_PORT} (http=${code})"
  tail -40 /tmp/p189-b41-worker.log || true
  exit 2
fi

for _ in $(seq 1 30); do
  kcode="$(curl -sS -o /dev/null -m 2 -w "%{http_code}" -X POST "http://127.0.0.1:54321/functions/v1/infonavit-pdf-worker" || true)"
  if echo "$kcode" | grep -qE '401|405|200'; then
    echo "kong→worker up http=${kcode}"
    break
  fi
  sleep 0.5
done
if ! echo "${kcode:-}" | grep -qE '401|405|200'; then
  echo "LOCAL_ENV_FAILURE: Kong :54321 no llega al worker (http=${kcode:-})"
  docker logs p189-b41-kong 2>&1 | tail -20 || true
  exit 2
fi

sleep 2

VAULT_URL='http://p189-b41-kong:8000/functions/v1/infonavit-pdf-worker'

vault_set() {
  local url="$1"
  local secret="$2"
  psql_local -c "SELECT public.__p189_b41_set_vault(\$u\$${url}\$u\$, \$s\$${secret}\$s\$);" >/dev/null
}

vault_clear() {
  psql_local -c "SELECT public.__p189_b41_clear_vault();" >/dev/null
}

wait_cron_since() {
  local since="$1"
  local min_runs="${2:-1}"
  local max_wait="${3:-90}"
  local start
  start="$(date +%s)"
  while true; do
    local n
    n="$(psql_scalar "SELECT count(*)::int FROM cron.job_run_details d JOIN cron.job j ON j.jobid=d.jobid WHERE j.jobname='infonavit-pdf-worker-dispatch' AND d.status='succeeded' AND d.start_time >= '${since}'::timestamptz;")"
    if [ "${n:-0}" -ge "$min_runs" ]; then
      echo "$n"
      return 0
    fi
    if [ $(($(date +%s) - start)) -ge "$max_wait" ]; then
      echo "P189 B4.1 FAIL: timeout esperando cron natural (${n:-0} runs, since=${since})" >&2
      psql_local -c "SELECT start_time, status, left(return_message, 80) FROM cron.job_run_details d JOIN cron.job j ON j.jobid=d.jobid WHERE j.jobname='infonavit-pdf-worker-dispatch' ORDER BY start_time DESC LIMIT 5;" >&2 || true
      return 1
    fi
    sleep 3
  done
}

helper_status() {
  psql_scalar "SELECT public.infonavit_pdf_dispatch_worker()->>'status';"
}

last_cron_sql_status() {
  psql_scalar "SELECT COALESCE(d.status,'') FROM cron.job_run_details d JOIN cron.job j ON j.jobid=d.jobid WHERE j.jobname='infonavit-pdf-worker-dispatch' ORDER BY d.start_time DESC LIMIT 1;"
}

http_max() {
  psql_scalar "SELECT GREATEST(COALESCE((SELECT max(id) FROM net.http_request_queue),0), COALESCE((SELECT max(id) FROM net._http_response),0));"
}

wait_http_since() {
  local min_id="$1"
  local want_code="$2"
  local max_wait="${3:-30}"
  local start
  start="$(date +%s)"
  while true; do
    local got
    got="$(psql_scalar "SELECT COALESCE((SELECT status_code::text FROM net._http_response WHERE id > ${min_id} AND status_code = ${want_code} ORDER BY id DESC LIMIT 1),'');")"
    if [ "$got" = "$want_code" ]; then
      echo "$got"
      return 0
    fi
    if [ $(($(date +%s) - start)) -ge "$max_wait" ]; then
      echo "P189 B4.1 FAIL: timeout pg_net status want=${want_code} got=${got:-none} min_id=${min_id}" >&2
      psql_local -c "SELECT id, status_code, timed_out FROM net._http_response WHERE id > ${min_id} ORDER BY id DESC LIMIT 8;" >&2 || true
      return 1
    fi
    sleep 1
  done
}

wait_outbox() {
  local exp="$1"
  local want_status="$2"
  local want_n="$3"
  local max_wait="${4:-90}"
  local start
  start="$(date +%s)"
  while true; do
    local n
    n="$(psql_scalar "SELECT count(*) FROM public.infonavit_pdf_outbox WHERE expediente_id='${exp}'::uuid AND status='${want_status}';")"
    if [ "${n:-0}" -eq "$want_n" ]; then
      echo "$n"
      return 0
    fi
    if [ $(($(date +%s) - start)) -ge "$max_wait" ]; then
      echo "P189 B4.1 FAIL: timeout outbox ${exp} status=${want_status} want=${want_n} got=${n:-0}" >&2
      psql_local -c "SELECT id, status, attempts, last_error_code FROM public.infonavit_pdf_outbox WHERE expediente_id='${exp}'::uuid;" >&2 || true
      return 1
    fi
    sleep 2
  done
}

echo "==> TEST 1 no-work (cron natural)"
vault_set "$VAULT_URL" "$WORKER_SECRET"
psql_local -c "SELECT public.__p189_b41_freeze_foreign(); SELECT public.__p189_b41_purge();" >/dev/null
T1_SINCE="$(psql_scalar "SELECT NOW()::text;")"
wait_cron_since "$T1_SINCE" 1 90 >/dev/null
T1_SQL="$(last_cron_sql_status)"
T1_STATUS="$(helper_status)"
if [ "$T1_SQL" != "succeeded" ] || [ "$T1_STATUS" != "no_work" ]; then
  echo "P189 B4.1 FAIL TEST1: sql=${T1_SQL} helper=${T1_STATUS}"
  exit 1
fi
echo "TEST1 PASS helper=no_work cron_sql=succeeded"

echo "==> TEST 2 missing Vault (cron natural)"
psql_local -c "
  SELECT public.__p189_b41_seed_ready('${EXP_T2}'::uuid, '${ORG}'::uuid, '${ASESOR}'::uuid, '18601000002');
" >/dev/null
psql_local -c "
  SELECT public.__p189_b41_put_pending('00000000-0000-4000-9186-00000000aa01'::uuid, '${ORG}'::uuid, '${EXP_T2}'::uuid, 'infonavit_carta_bajo_protesta', 0);
  SELECT public.__p189_b41_put_pending('00000000-0000-4000-9186-00000000aa02'::uuid, '${ORG}'::uuid, '${EXP_T2}'::uuid, 'infonavit_presupuesto_mejoramiento', 0);
  SELECT public.__p189_b41_put_pending('00000000-0000-4000-9186-00000000aa03'::uuid, '${ORG}'::uuid, '${EXP_T2}'::uuid, 'infonavit_solicitud_inscripcion', 0);
" >/dev/null
vault_clear
T2_SINCE="$(psql_scalar "SELECT NOW()::text;")"
wait_cron_since "$T2_SINCE" 1 90 >/dev/null
T2_STATUS="$(helper_status)"
T2_PENDING="$(psql_scalar "SELECT count(*) FROM public.infonavit_pdf_outbox WHERE expediente_id='${EXP_T2}'::uuid AND status='pending' AND attempts=0;")"
if [ "$T2_STATUS" != "missing_configuration" ] || [ "$T2_PENDING" != "3" ]; then
  echo "P189 B4.1 FAIL TEST2: helper=${T2_STATUS} pending=${T2_PENDING}"
  exit 1
fi
echo "TEST2 PASS helper=missing_configuration pending=3"

echo "==> TEST 3 bad secret (cron natural, expect HTTP 401, 0 claim)"
vault_set "$VAULT_URL" "incorrect-p189-b41-secret"
T3_HTTP_BEFORE="$(http_max)"
T3_SINCE="$(psql_scalar "SELECT NOW()::text;")"
wait_cron_since "$T3_SINCE" 1 90 >/dev/null
wait_http_since "$T3_HTTP_BEFORE" "401" 30 >/dev/null
T3_PENDING="$(psql_scalar "SELECT count(*) FROM public.infonavit_pdf_outbox WHERE expediente_id='${EXP_T2}'::uuid AND status='pending' AND attempts=0;")"
if [ "$T3_PENDING" != "3" ]; then
  echo "P189 B4.1 FAIL TEST3: pending=${T3_PENDING} (claim no debía ocurrir)"
  exit 1
fi
echo "TEST3 PASS http=401 pending=3 attempts=0"

echo "==> TEST 4 natural happy path (enviar_a_mesa real, NO curl worker)"
psql_local -c "
  SELECT public.__p189_purge_submission('${EXP_T2}'::uuid);
  DELETE FROM public.expediente_documentos WHERE expediente_id='${EXP_T2}'::uuid AND tipo_documento LIKE 'infonavit_%';
  SELECT public.__p189_b41_freeze_foreign();
" >/dev/null
vault_set "$VAULT_URL" "$WORKER_SECRET"
psql_local -c "
  SELECT public.__p189_b41_seed_ready('${EXP_T4}'::uuid, '${ORG}'::uuid, '${ASESOR}'::uuid, '18601000004');
" >/dev/null
ENVIAR_JSON="$(psql_scalar "SELECT public.__p189_b41_enviar('${EXP_T4}'::uuid)::text;")"
T4_PENDING="$(psql_scalar "SELECT count(*) FROM public.infonavit_pdf_outbox WHERE expediente_id='${EXP_T4}'::uuid AND status='pending';")"
T4_SNAP="$(psql_scalar "SELECT count(*) FROM public.expediente_infonavit_submission_snapshots WHERE expediente_id='${EXP_T4}'::uuid;")"
if [ "$T4_PENDING" != "3" ] || [ "$T4_SNAP" != "1" ]; then
  echo "P189 B4.1 FAIL TEST4 setup: pending=${T4_PENDING} snapshots=${T4_SNAP} enviar=${ENVIAR_JSON}"
  exit 1
fi
T4_CREATED="$(psql_scalar "SELECT min(created_at)::text FROM public.infonavit_pdf_outbox WHERE expediente_id='${EXP_T4}'::uuid;")"
T4_SINCE="$(psql_scalar "SELECT NOW()::text;")"
wait_cron_since "$T4_SINCE" 1 90 >/dev/null
wait_outbox "$EXP_T4" "done" 3 90 >/dev/null
T4_DOCS="$(psql_scalar "SELECT count(*) FROM public.expediente_documentos WHERE expediente_id='${EXP_T4}'::uuid AND tipo_documento LIKE 'infonavit_%' AND deleted_at IS NULL;")"
T4_OBJS="$(psql_scalar "SELECT count(*) FROM storage.objects WHERE bucket_id='expediente-documentos' AND name LIKE '%${EXP_T4}%';")"
if [ "$T4_DOCS" != "3" ] || [ "$T4_OBJS" != "3" ]; then
  echo "P189 B4.1 FAIL TEST4: docs=${T4_DOCS} objects=${T4_OBJS}"
  exit 1
fi
LATENCY="$(psql_scalar "SELECT ROUND(EXTRACT(EPOCH FROM (max(processed_at) - min(created_at)))::numeric, 1) FROM public.infonavit_pdf_outbox WHERE expediente_id='${EXP_T4}'::uuid;")"
echo "TEST4 PASS done=3 docs=3 objects=3 AUTO_GENERATION_LATENCY_SECONDS=${LATENCY}"

echo "==> TEST 5 second natural cron idempotent"
T5_DOCS_BEFORE="$T4_DOCS"
T5_OBJS_BEFORE="$T4_OBJS"
T5_SINCE="$(psql_scalar "SELECT NOW()::text;")"
wait_cron_since "$T5_SINCE" 1 90 >/dev/null
sleep 5
T5_STATUS="$(helper_status)"
T5_DOCS="$(psql_scalar "SELECT count(*) FROM public.expediente_documentos WHERE expediente_id='${EXP_T4}'::uuid AND tipo_documento LIKE 'infonavit_%';")"
T5_ACTIVE="$(psql_scalar "SELECT count(*) FROM public.expediente_documentos WHERE expediente_id='${EXP_T4}'::uuid AND tipo_documento LIKE 'infonavit_%' AND deleted_at IS NULL;")"
T5_OBJS="$(psql_scalar "SELECT count(*) FROM storage.objects WHERE bucket_id='expediente-documentos' AND name LIKE '%${EXP_T4}%';")"
T5_DONE="$(psql_scalar "SELECT count(*) FROM public.infonavit_pdf_outbox WHERE expediente_id='${EXP_T4}'::uuid AND status='done';")"
if [ "$T5_STATUS" != "no_work" ] || [ "$T5_ACTIVE" != "3" ] || [ "$T5_OBJS" != "$T5_OBJS_BEFORE" ] || [ "$T5_DONE" != "3" ]; then
  echo "P189 B4.1 FAIL TEST5: helper=${T5_STATUS} docs=${T5_DOCS} active=${T5_ACTIVE} objs=${T5_OBJS} done=${T5_DONE}"
  exit 1
fi
echo "TEST5 PASS second cron no_work idempotent docs=${T5_DOCS_BEFORE}"

echo "==> TEST 6 available_at respected"
psql_local -c "
  SELECT public.__p189_b41_seed_ready('${EXP_T6}'::uuid, '${ORG}'::uuid, '${ASESOR}'::uuid, '18601000006');
" >/dev/null
psql_local -c "SELECT public.__p189_b41_enviar('${EXP_T6}'::uuid)::text;" >/dev/null
psql_local -c "
  UPDATE public.infonavit_pdf_outbox
    SET available_at = NOW() + INTERVAL '75 seconds',
        status='pending',
        attempts=0,
        processing_started_at=NULL,
        processed_at=NULL,
        documento_id=NULL
    WHERE expediente_id='${EXP_T6}'::uuid;
  SELECT public.__p189_b41_freeze_foreign();
" >/dev/null
T6_SINCE="$(psql_scalar "SELECT NOW()::text;")"
wait_cron_since "$T6_SINCE" 1 90 >/dev/null
T6_BEFORE="$(psql_scalar "SELECT count(*) FROM public.infonavit_pdf_outbox WHERE expediente_id='${EXP_T6}'::uuid AND status='pending' AND attempts=0;")"
if [ "$T6_BEFORE" != "3" ]; then
  echo "P189 B4.1 FAIL TEST6: processed before available_at pending=${T6_BEFORE}"
  exit 1
fi
while [ "$(psql_scalar "SELECT (max(available_at) <= NOW())::int FROM public.infonavit_pdf_outbox WHERE expediente_id='${EXP_T6}'::uuid;")" != "1" ]; do
  sleep 3
done
T6B_SINCE="$(psql_scalar "SELECT NOW()::text;")"
wait_cron_since "$T6B_SINCE" 1 90 >/dev/null
wait_outbox "$EXP_T6" "done" 3 90 >/dev/null
echo "TEST6 PASS before=3 pending after=3 done"

echo "==> TEST 7 stale lease recovery"
psql_local -c "
  SELECT public.__p189_purge_submission('${EXP_T6}'::uuid);
  SELECT public.__p189_b41_seed_ready('${EXP_T7}'::uuid, '${ORG}'::uuid, '${ASESOR}'::uuid, '18601000007');
" >/dev/null
psql_local -c "SELECT public.__p189_b41_enviar('${EXP_T7}'::uuid)::text;" >/dev/null
psql_local -c "
  UPDATE public.infonavit_pdf_outbox
    SET status='processing',
        processing_started_at = NOW() - INTERVAL '11 minutes',
        attempts = 1,
        available_at = NOW() - INTERVAL '1 hour'
    WHERE expediente_id='${EXP_T7}'::uuid;
  SELECT public.__p189_b41_freeze_foreign();
" >/dev/null
T7_SINCE="$(psql_scalar "SELECT NOW()::text;")"
wait_cron_since "$T7_SINCE" 1 90 >/dev/null
wait_outbox "$EXP_T7" "done" 3 90 >/dev/null
T7_ATTEMPTS="$(psql_scalar "SELECT min(attempts) FROM public.infonavit_pdf_outbox WHERE expediente_id='${EXP_T7}'::uuid;")"
if [ "${T7_ATTEMPTS}" -lt 2 ]; then
  echo "P189 B4.1 FAIL TEST7: attempts min=${T7_ATTEMPTS} expected >=2"
  exit 1
fi
echo "TEST7 PASS stale recovered done=3 min_attempts=${T7_ATTEMPTS}"

echo "==> pg_net status codes (no bodies/headers)"
psql_local -c "SELECT id, status_code, timed_out FROM net._http_response WHERE created > NOW() - INTERVAL '30 minutes' ORDER BY id;"

echo "==> cron.job_run_details P189 (status SQL, sin PII)"
psql_local -c "SELECT d.status, count(*) FROM cron.job_run_details d JOIN cron.job j ON j.jobid=d.jobid WHERE j.jobname='infonavit-pdf-worker-dispatch' GROUP BY d.status;"

echo "P189 B4.1 INTEGRATION PASS latency=${LATENCY}"
echo "AUTO_GENERATION_LATENCY_SECONDS=${LATENCY}"
