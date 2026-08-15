#!/usr/bin/env bash
# Run the backend the "classic" local way (no Docker): API + admin from source.
# Assumes DATABASE_URL in .env points at a reachable Postgres (local Homebrew or
# Neon) and that the schema is migrated. For the fully self-contained path, use
# scripts/docker-up.sh instead.
#
#   scripts/dev-local.sh            # migrate (if needed) + start api + admin
#
# Stop with Ctrl-C (both children are killed).
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "No .env found. Copy .env.example -> .env and fill in values first." >&2
  exit 1
fi

echo "Ensuring shared package is built and Prisma client is generated..."
npm run -w @aishorts/shared db:generate >/dev/null
npm run -w @aishorts/shared build >/dev/null

echo "Applying migrations (safe if already up to date)..."
npm run -w @aishorts/shared db:deploy

echo "Starting API (:4000) and admin (:4001). Ctrl-C to stop both."
npm run -w @aishorts/api start &
API_PID=$!
npm run -w @aishorts/admin dev &
ADMIN_PID=$!

# Kill both children when this script is interrupted.
trap 'kill $API_PID $ADMIN_PID 2>/dev/null || true' INT TERM
wait
