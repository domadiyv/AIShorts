#!/usr/bin/env bash
# Dump a Postgres database to a compressed custom-format file (-Fc).
# Works against local Homebrew Postgres, the docker `postgres` container
# (localhost:5432), or a managed cloud DB (Neon).
#
# Usage:
#   DATABASE_URL=postgres://user:pass@host:5432/db scripts/db-dump.sh [out.dump]
set -euo pipefail

URL="${DATABASE_URL:-}"
OUT="${1:-aishorts-$(date +%Y%m%d-%H%M%S).dump}"

if [ -z "$URL" ]; then
  echo "ERROR: set DATABASE_URL to the source database." >&2
  exit 1
fi

echo "Dumping -> $OUT"
pg_dump "$URL" -Fc --no-owner --no-privileges -f "$OUT"
echo "Done: $OUT ($(du -h "$OUT" | cut -f1))"
