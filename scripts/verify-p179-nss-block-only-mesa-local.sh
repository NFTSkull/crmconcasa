#!/usr/bin/env bash
# P179 — apply mig 176 local + SQL suite (no Cloud).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export PGPASSWORD="${PGPASSWORD:-postgres}"
PSQL=(psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -v ON_ERROR_STOP=1)

echo "==> Apply migration 176 (local)"
"${PSQL[@]}" -f supabase/migrations/176_nss_block_only_after_mesa.sql >/tmp/p179-mig176-apply.log
echo "==> Suite rpc_nss_block_only_after_mesa_p179.sql"
"${PSQL[@]}" -f supabase/tests/rpc_nss_block_only_after_mesa_p179.sql
echo "P179 SQL: PASSED"
