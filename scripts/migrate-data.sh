#!/usr/bin/env bash
# One-shot data migration: dump the SOURCE database and restore into TARGET.
# Moves everything (already-ingested + AI-summarized cards, users, sources,
# events, subscribers). Use it to seed the docker `postgres` volume from your
# existing local/Neon DB, and later to promote local -> cloud.
#
# Usage:
#   SOURCE_URL=postgres://old  TARGET_URL=postgres://new  scripts/migrate-data.sh
#
# Examples:
#   # local Homebrew Postgres (5432) -> docker container (mapped to host 5433)
#   SOURCE_URL=postgresql://hjyani@localhost:5432/aishorts \
#   TARGET_URL=postgresql://aishorts:aishorts@localhost:5433/aishorts \
#   scripts/migrate-data.sh
set -euo pipefail

cd "$(dirname "$0")/.."

SRC="${SOURCE_URL:-}"
DST="${TARGET_URL:-}"

if [ -z "$SRC" ] || [ -z "$DST" ]; then
  echo "Usage: SOURCE_URL=postgres://... TARGET_URL=postgres://... scripts/migrate-data.sh" >&2
  exit 1
fi

TMP="migrate-$(date +%Y%m%d-%H%M%S).dump"

echo "1/3  Dumping source ..."
pg_dump "$SRC" -Fc --no-owner --no-privileges -f "$TMP"

echo "2/3  Ensuring target schema (prisma migrate deploy) ..."
DATABASE_URL="$DST" npx prisma migrate deploy --schema packages/shared/prisma/schema.prisma

echo "3/3  Restoring into target ..."
pg_restore --clean --if-exists --no-owner --no-privileges -d "$DST" "$TMP"

echo "Done. Migrated $SRC -> $DST"
echo "Dump kept at: $TMP"
