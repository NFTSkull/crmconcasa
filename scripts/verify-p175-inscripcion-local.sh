#!/usr/bin/env bash
# P175 — apply mig 173 local + SQL suite (no Cloud).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export PGPASSWORD="${PGPASSWORD:-postgres}"
PSQL=(psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1)

echo "==> Apply migration 173 (local)"
"${PSQL[@]}" -f supabase/migrations/173_agenda_inscripcion_extraordinaria.sql >/tmp/p175-mig-apply.log
echo "==> Suite rpc_agenda_inscripcion_p175.sql"
"${PSQL[@]}" -f supabase/tests/rpc_agenda_inscripcion_p175.sql
echo "P175 SQL: PASSED"
