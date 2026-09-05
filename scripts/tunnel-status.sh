#!/usr/bin/env bash
# Report the current public tunnel URLs and whether they're reachable.
#
# The always-on tunnels run as macOS LaunchAgents (see DEPLOY.md §2) and write
# their logs to ~/.aishorts-tunnels/*.log. Quick (*.trycloudflare.com) tunnels
# get a NEW random URL every time cloudflared restarts (e.g. after a reboot), so
# this script reads the latest URL from each log rather than assuming a fixed one.
#
# Usage:  scripts/tunnel-status.sh
set -euo pipefail

LOG_DIR="${AISHORTS_TUNNEL_LOG_DIR:-$HOME/.aishorts-tunnels}"

latest_url() {
  local log="$1"
  [ -f "$log" ] || { echo ""; return; }
  grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "$log" | tail -1
}

probe() {
  local url="$1" path="$2"
  [ -n "$url" ] || { echo "n/a"; return; }
  curl -s -m 12 -o /dev/null -w '%{http_code}' "${url}${path}" 2>/dev/null || echo "ERR"
}

API_URL="$(latest_url "$LOG_DIR/api.log")"
ADMIN_URL="$(latest_url "$LOG_DIR/admin.log")"

echo "AIShorts tunnels"
echo "  API   : ${API_URL:-<not found>}   [/v1/health -> $(probe "$API_URL" /v1/health)]"
echo "  Admin : ${ADMIN_URL:-<not found>}   [/login -> $(probe "$ADMIN_URL" /login)]"
echo
echo "LaunchAgent status:"
launchctl list 2>/dev/null | grep -i aishorts || echo "  (no aishorts LaunchAgents loaded)"
