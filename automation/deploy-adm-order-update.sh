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
applied=no
matched=no
for base in "${ADM_BASE_COMMIT:-25adf1ebd280e37c7db1cd3050ba6bd81e3bfb10}" 2e8d905b17fe168f0e22c4a8e8e7bb9aa5d9a9bb 042f1e83b6299431c7c1e8c7bf37068e3468ee9d; do
  git diff --binary "$base" "$target" \
    -- src package.json package-lock.json automation/adm-report6-nightly.sh > "$tmp/adm.patch"
  [[ -s "$tmp/adm.patch" ]] || continue
  if git apply --reverse --check "$tmp/adm.patch" 2>/dev/null; then
    matched=yes
    break
  fi
  if git apply --check "$tmp/adm.patch" 2>/dev/null; then
    git apply "$tmp/adm.patch"
    applied=yes
    matched=yes
    break
  fi
done
if [[ "$matched" != yes ]]; then
  echo "The ADM update did not match this web checkout. No source files were changed." >&2
  exit 1
fi

backup=".next.before-adm-daily-sales-$(date +%Y%m%d-%H%M%S)-$$"
if [[ -d .next ]]; then
  cp -a .next "$backup"
fi

rollback() {
  if [[ "$applied" == yes ]]; then
    git apply --reverse "$tmp/adm.patch" || true
  fi
  if [[ -d "$backup" ]]; then
    mv .next ".next.failed-adm-daily-sales-$$" 2>/dev/null || true
    mv "$backup" .next
  fi
  sudo systemctl restart "$web"
}

if { [[ ! -x node_modules/.bin/next ]] && ! npm ci; } || ! npm run build || ! sudo systemctl restart "$web"; then
  rollback
  exit 1
fi

ready=no
for attempt in {1..20}; do
  if curl -fsS --max-time 5 http://127.0.0.1:3100/adm-order -o "$tmp/page" 2>/dev/null \
      && grep -q 'ADM Order' "$tmp/page" && grep -q 'Import shop lists from Excel' "$tmp/page"; then
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

# ADM uses the existing Nightly Normal Sales imports.
if systemctl cat mieszko-adm-report6.timer >/dev/null 2>&1; then
  sudo systemctl disable --now mieszko-adm-report6.timer
fi
echo "ADM Order is live and reads from Daily Sales."
