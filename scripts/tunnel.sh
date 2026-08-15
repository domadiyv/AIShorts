#!/usr/bin/env bash
# Expose the local API (http://localhost:4000) over HTTPS so a phone/emulator can
# reach your Mac from anywhere. Android release builds block cleartext HTTP, so a
# tunnel (HTTPS) is required for on-device testing in Phase 1.
#
# Two modes:
#   1) QUICK (default): a random *.trycloudflare.com URL, no account, no config.
#        scripts/tunnel.sh
#      Copy the printed https URL into the app's Settings screen (or bake it as
#      EXPO_PUBLIC_API_URL). URL changes every run — fine for a one-off test.
#
#   2) NAMED: a stable hostname you own (needs a Cloudflare account + a one-time
#      `cloudflared tunnel login` and a named tunnel). Pass the tunnel name:
#        scripts/tunnel.sh my-tunnel-name
#
# Install cloudflared:  brew install cloudflared
# Alternative (random URL, different vendor):  ngrok http 4000
set -euo pipefail

PORT="${API_PORT:-4000}"

if ! command -v cloudflared >/dev/null 2>&1; then
  echo "cloudflared not found. Install it with:  brew install cloudflared" >&2
  echo "Or use ngrok instead:  ngrok http ${PORT}" >&2
  exit 1
fi

if [ "${1:-}" = "" ]; then
  echo "Starting QUICK tunnel to http://localhost:${PORT} (random URL)..."
  echo "Copy the https://<...>.trycloudflare.com URL below into the app Settings."
  exec cloudflared tunnel --url "http://localhost:${PORT}"
else
  NAME="$1"
  echo "Starting NAMED tunnel '${NAME}' -> http://localhost:${PORT}"
  echo "(Requires a prior 'cloudflared tunnel login' and DNS route for the hostname.)"
  exec cloudflared tunnel run --url "http://localhost:${PORT}" "${NAME}"
fi
