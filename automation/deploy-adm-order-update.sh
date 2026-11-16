#!/usr/bin/env bash
# Install the ADM update on the office web service that already has the ADM schema.
set -Eeuo pipefail
umask 077

web=mieszko-weekly-wastage-web.service
worker=mieszko-import-worker.service
app="$(systemctl show "$web" --property=WorkingDirectory --value)"
user="$(systemctl show "$web" --property=User --value)"
[[ -n "$app" && -f "$app/package.json" && -n "$user" ]] || {
  echo "Could not identify the existing Ordering web service and its user." >&2
  exit 1
}
cd "$app"
runtime="$(systemctl show "$worker" --property=WorkingDirectory --value)/.worker-runtime/node/bin"
if [[ -x "$runtime/node" ]]; then
  export PATH="$runtime:$PATH"
fi
sudo -v

tmp="$(mktemp -d)"
trap 'rm -rf -- "$tmp"' EXIT
git fetch --no-tags https://github.com/franklinajithan/mieszko-ordering.git refs/heads/feat/adm-ordering
target="$(git rev-parse FETCH_HEAD)"
git diff --binary afd3a8805769579ea36ccc7d5bfb0e25ecbcee89 "$target" \
  -- src package.json package-lock.json automation/adm-report6-nightly.sh > "$tmp/adm.patch"
test -s "$tmp/adm.patch"

applied=no
if ! git apply --reverse --check "$tmp/adm.patch" 2>/dev/null; then
  git apply --check "$tmp/adm.patch"
  git apply "$tmp/adm.patch"
  applied=yes
fi

backup=".next.before-adm-report6-$(date +%Y%m%d-%H%M%S)-$$"
if [[ -d .next ]]; then
  cp -a .next "$backup"
fi

rollback() {
  if [[ "$applied" == yes ]]; then
    git apply --reverse "$tmp/adm.patch" || true
  fi
  if [[ -d "$backup" ]]; then
    mv .next ".next.failed-adm-report6-$$" 2>/dev/null || true
    mv "$backup" .next
  fi
  sudo systemctl restart "$web"
}

if ! npm ci || ! npm run build || ! sudo systemctl restart "$web"; then
  rollback
  exit 1
fi

ready=no
for attempt in {1..20}; do
  if curl -fsS --max-time 5 http://127.0.0.1:3100/adm-order -o "$tmp/page" 2>/dev/null \
      && grep -q 'ADM Order' "$tmp/page" && ! grep -q 'Import ADM workbook' "$tmp/page"; then
    ready=yes
    break
  fi
  sleep 2
done

if [[ "$ready" != yes ]]; then
  sudo journalctl -u "$web" -n 25 --no-pager
  rollback
  exit 1
fi

cat > "$tmp/mieszko-adm-report6.service" <<UNIT
[Unit]
Description=Queue Report 6 sales for ADM ordering
After=network-online.target $web

[Service]
Type=oneshot
User=$user
WorkingDirectory=$app
ExecStart=/bin/bash "$app/automation/adm-report6-nightly.sh"
UNIT
cat > "$tmp/mieszko-adm-report6.timer" <<'UNIT'
[Unit]
Description=Refresh archived Report 6 sales for ADM ordering

[Timer]
OnCalendar=*-*-* 03:30:00 Europe/London
OnCalendar=*-*-* 06:00:00 Europe/London
Persistent=true

[Install]
WantedBy=timers.target
UNIT

sudo install -m 644 "$tmp/mieszko-adm-report6.service" "$tmp/mieszko-adm-report6.timer" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mieszko-adm-report6.timer
echo "ADM Order is live. Starting the initial Report 6 archive check:"
sudo systemctl start mieszko-adm-report6.service
sudo journalctl -u mieszko-adm-report6.service -n 8 --no-pager
