#!/usr/bin/env bash
# Build and start the full backend stack (postgres + migrate/seed + api + admin).
# Any extra args pass through to `docker compose up`.
#
#   scripts/docker-up.sh            # foreground
#   scripts/docker-up.sh -d         # detached
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "No .env found. Copy .env.example -> .env and fill in values first." >&2
  exit 1
fi

exec docker compose up --build "$@"
