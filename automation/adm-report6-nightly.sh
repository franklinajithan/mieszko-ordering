#!/usr/bin/env bash
set -euo pipefail

app_url="${ADM_ORDER_APP_URL:-http://127.0.0.1:3100}"
start="$(TZ=Europe/London date --date='10 days ago' +%F)"
end="$(TZ=Europe/London date --date='yesterday' +%F)"
response="$(mktemp)"
trap 'rm -f -- "$response"' EXIT

status="$(curl --silent --show-error --max-time 25 --output "$response" --write-out '%{http_code}' \
  --header 'Content-Type: application/json' \
  --data "{\"action\":\"start\",\"start\":\"$start\",\"end\":\"$end\",\"stores\":[\"HNS\",\"STR\",\"GRV\",\"WTF\",\"EAS\",\"HYS\",\"PVL\"]}" \
  "${app_url%/}/api/reports/item-sales-enquiry")"

case "$status" in
  202) cat "$response"; echo ;;
  409) echo "A Report 6 job is already running. The next timer run will check again." ;;
  *) cat "$response" >&2; echo >&2; exit 1 ;;
esac
