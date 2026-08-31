#!/usr/bin/env bash
# Provision Team Silvia users + memberships + capabilities (Cloud).
# NO commit passwords. Pass a private JSON file via TEAM_SILVIA_USERS_FILE.
#
# Expected JSON shape (private, outside repo):
# [
#   {"email":"julieta.gonzalez@concasa.mx","full_name":"Julieta Gonzalez","password":"..."},
#   ...
# ]
#
# Usage:
#   TEAM_SILVIA_USERS_FILE=/path/private/users.json \
#   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
#   node scripts/provision-equipo-silvia.mjs
#
# Dry-run (no writes):
#   TEAM_SILVIA_DRY_RUN=1 ... node scripts/provision-equipo-silvia.mjs
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec node "$ROOT/scripts/provision-equipo-silvia.mjs" "$@"
