#!/usr/bin/env bash
set -euo pipefail

app_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
worker_user="$(id -un)"
python_bin="$app_dir/.worker-runtime/venv/bin/python"
unit_dir="$(mktemp -d)"
trap 'rm -rf -- "$unit_dir"' EXIT

test "$worker_user" != root
test -x "$python_bin"
command -v libreoffice >/dev/null
"$python_bin" -m pip install -r "$app_dir/automation/weekly_wastage/requirements.txt"

cat > "$unit_dir/mieszko-weekly-wastage.service" <<EOF
[Unit]
Description=Mieszko weekly wastage workbooks
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=$worker_user
WorkingDirectory="$app_dir"
ExecStart="$python_bin" -u "$app_dir/automation/weekly_wastage_job.py"
TimeoutStartSec=18h
UMask=0077
EOF

cat > "$unit_dir/mieszko-weekly-wastage.timer" <<'EOF'
[Unit]
Description=Generate Mieszko weekly wastage every Monday

[Timer]
OnCalendar=Mon *-*-* 08:00:00 Europe/London
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemd-analyze verify "$unit_dir/mieszko-weekly-wastage.service" "$unit_dir/mieszko-weekly-wastage.timer"
sudo install -m 644 "$unit_dir"/mieszko-weekly-wastage.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now mieszko-weekly-wastage.timer
systemctl list-timers --all mieszko-weekly-wastage.timer
