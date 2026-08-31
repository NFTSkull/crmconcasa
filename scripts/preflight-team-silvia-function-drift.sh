#!/usr/bin/env bash
# Preflight Team Silvia — function drift gate (RO).
# Compara SHA256 de definiciones Cloud actuales vs baseline pre-Team-Silvia
# (capturado antes del apply de 20260831205958).
#
# Uso:
#   export SUPABASE_DB_PASSWORD=...
#   ./scripts/preflight-team-silvia-function-drift.sh
#
# Exit 0 = OK para aplicar migration.
# Exit 3 = STOP_FUNCTION_DRIFT
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASELINE="$ROOT/scripts/fixtures/team-silvia-function-baselines.json"

if [[ ! -f "$BASELINE" ]]; then
  echo "STOP: missing baseline $BASELINE" >&2
  exit 1
fi

if [[ -z "${SUPABASE_DB_PASSWORD:-}" ]]; then
  echo "STOP: SUPABASE_DB_PASSWORD required" >&2
  exit 1
fi

cd "$ROOT"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

npx supabase db query --linked "
SELECT p.proname AS name,
  encode(digest(pg_get_functiondef(p.oid), 'sha256'), 'hex') AS sha256
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname='public'
  AND p.proname IN (
    'save_cliente_datos',
    'enviar_a_mesa',
    'register_expediente_documento',
    'register_expediente_documento_pre_reingreso'
  )
ORDER BY 1;
" > "$TMP"

python3 - <<PY
import json, sys
from pathlib import Path
raw = Path("$TMP").read_text()
# supabase CLI wraps rows
try:
  data = json.loads(raw)
  rows = data.get("rows") or data
except Exception:
  print("STOP: cannot parse supabase query output", file=sys.stderr)
  sys.exit(1)
current = {r["name"]: r["sha256"] for r in rows}
expected = json.loads(Path("$BASELINE").read_text())["functions"]
drift = []
for name, sha in expected.items():
  got = current.get(name)
  if got != sha:
    drift.append({"name": name, "expected": sha, "got": got})
missing = [n for n in expected if n not in current]
extra_msg = {
  "ok": len(drift) == 0 and len(missing) == 0,
  "drift": drift,
  "missing": missing,
  "cloud_functions": current,
}
print(json.dumps(extra_msg, indent=2))
if drift or missing:
  print("STOP_FUNCTION_DRIFT", file=sys.stderr)
  sys.exit(3)
print("PREFLIGHT_OK: Cloud mutators match Team Silvia baselines")
PY
