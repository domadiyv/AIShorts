#!/usr/bin/env bash
# Restore a .dump (from db-dump.sh) into a target Postgres database.
# Drops and recreates matching objects (--clean --if-exists).
#
# Usage:
#   TARGET_URL=postgres://user:pass@host:5432/db scripts/db-restore.sh <in.dump>
set -euo pipefail

URL="${TARGET_URL:-${DATABASE_URL:-}}"
IN="${1:-}"

if [ -z "$URL" ] || [ -z "$IN" ]; then
  echo "Usage: TARGET_URL=postgres://... scripts/db-restore.sh <file.dump>" >&2
  exit 1
fi
if [ ! -f "$IN" ]; then
  echo "ERROR: dump file not found: $IN" >&2
  exit 1
fi

echo "Restoring $IN -> target DB"
pg_restore --clean --if-exists --no-owner --no-privileges -d "$URL" "$IN"
echo "Done."
