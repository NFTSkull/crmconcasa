#!/usr/bin/env bash
# P176 — apply mig 174 local + SQL suite (no Cloud).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export PGPASSWORD="${PGPASSWORD:-postgres}"
PSQL=(psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1)

echo "==> Apply migration 174 (local)"
"${PSQL[@]}" -f supabase/migrations/174_fix_agenda_inventory_availability_contract.sql >/tmp/p176-mig-apply.log
echo "==> Suite rpc_agenda_inventory_availability_p176.sql"
"${PSQL[@]}" -f supabase/tests/rpc_agenda_inventory_availability_p176.sql
echo "P176 SQL: PASSED"
