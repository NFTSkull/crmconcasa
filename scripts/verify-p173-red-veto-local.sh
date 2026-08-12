#!/usr/bin/env bash
# P173 — apply mig 172 local + SQL suite (no Cloud).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export PGPASSWORD="${PGPASSWORD:-postgres}"
PSQL=(psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1)

echo "==> Apply migration 172 (local)"
"${PSQL[@]}" -f supabase/migrations/172_agenda_sheet_red_color_veto.sql >/tmp/p173-mig-apply.log
echo "==> Suite rpc_agenda_sheet_red_color_veto_p173.sql"
"${PSQL[@]}" -f supabase/tests/rpc_agenda_sheet_red_color_veto_p173.sql
echo "P173 SQL: PASSED"
