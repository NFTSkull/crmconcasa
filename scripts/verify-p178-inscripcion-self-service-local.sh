#!/usr/bin/env bash
# P178 — apply mig 175 local + SQL suite (no Cloud).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export PGPASSWORD="${PGPASSWORD:-postgres}"
PSQL=(psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1)

echo "==> Ensure mig 173+174 (deps) then 175"
"${PSQL[@]}" -f supabase/migrations/173_agenda_inscripcion_extraordinaria.sql >/tmp/p178-mig173-apply.log
"${PSQL[@]}" -f supabase/migrations/174_fix_agenda_inventory_availability_contract.sql >/tmp/p178-mig174-apply.log
"${PSQL[@]}" -f supabase/migrations/175_asesor_inscripcion_self_service.sql >/tmp/p178-mig175-apply.log
echo "==> Suite rpc_asesor_inscripcion_self_service_p178.sql"
"${PSQL[@]}" -f supabase/tests/rpc_asesor_inscripcion_self_service_p178.sql
echo "P178 SQL: PASSED"
