#!/usr/bin/env bash
# Preparation only: never reads DATABASE_URL, runs the worker, or enables services.
set -Eeuo pipefail
umask 077
trap 'echo "PREPARATION FAILED at line $LINENO. No worker or schedule was started." >&2' ERR

app_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
runtime_dir="$app_dir/.worker-runtime"
for required in python3 curl tar sha256sum; do
  command -v "$required" >/dev/null || { echo "Missing prerequisite: $required" >&2; exit 1; }
done
test -f "$app_dir/package-lock.json"
test -f "$app_dir/automation/requirements.txt"
python3 -c 'import sys; assert sys.version_info >= (3,11), "Python 3.11+ is required"'
case "$(uname -m)" in
  x86_64) node_arch=x64 ;;
  aarch64) node_arch=arm64 ;;
  *) echo 'Unsupported CPU architecture' >&2; exit 1 ;;
esac
mkdir -p "$runtime_dir"

# Install an isolated Node 22, without changing PATH/profile or system Node 16.
if ! test -x "$runtime_dir/node/bin/node"; then
  download_dir="$(mktemp -d "$runtime_dir/download.XXXXXX")"
  base_url=https://nodejs.org/dist/latest-v22.x
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
    "$base_url/SHASUMS256.txt" -o "$download_dir/SHASUMS256.txt"
  node_archive="$(awk -v suffix="-linux-$node_arch.tar.xz" '$2 ~ /^node-v22\./ && substr($2,length($2)-length(suffix)+1)==suffix {print $2}' "$download_dir/SHASUMS256.txt")"
  [[ "$node_archive" =~ ^node-v22\.[0-9]+\.[0-9]+-linux-(x64|arm64)\.tar\.xz$ ]] || { echo 'Invalid Node release manifest' >&2; exit 1; }
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
    "$base_url/$node_archive" -o "$download_dir/$node_archive"
  (cd "$download_dir"; awk -v name="$node_archive" '$2==name' SHASUMS256.txt | sha256sum --check --strict -)
  mkdir "$download_dir/node"
  tar -xJf "$download_dir/$node_archive" --strip-components=1 -C "$download_dir/node"
  "$download_dir/node/bin/node" -e 'if(Number(process.versions.node.split(".")[0])!==22) process.exit(1)'
  mv "$download_dir/node" "$runtime_dir/node"
  rm -r -- "$download_dir"
fi
export PATH="$runtime_dir/node/bin:$PATH"
node -e 'if(Number(process.versions.node.split(".")[0])!==22) process.exit(1)'
cd "$app_dir"
npm ci --ignore-scripts --no-audit --no-fund

venv="$runtime_dir/venv"
if ! test -x "$venv/bin/python" || ! "$venv/bin/python" -m pip --version >/dev/null 2>&1; then
  if ! python3 -m venv "$venv"; then
    echo 'Installing the Ubuntu Python venv prerequisite (sudo may prompt).'
    sudo apt-get update
    sudo apt-get install -y python3-venv
    python3 -m venv "$venv"
  fi
fi
"$venv/bin/python" -m pip install -r automation/requirements.txt
"$venv/bin/python" -m playwright install chromium

# This official command installs browser OS libraries; it can prompt for sudo.
# It does not upgrade Node, deploy the app, or connect to PostgreSQL/CRM.
"$venv/bin/python" -m playwright install-deps chromium
"$venv/bin/python" - <<'PY'
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.set_content('<title>Mieszko worker readiness</title>')
    assert page.title() == 'Mieszko worker readiness'
    browser.close()
print('PASS: Chromium launched headlessly; local HTML checked without accessing CRM.')
PY

if test -f "$app_dir/automation/configure-linux-worker.py" && ! test -f "$app_dir/automation/config.local.json"; then
  "$venv/bin/python" "$app_dir/automation/configure-linux-worker.py" --user "$(id -un)"
fi

printf '\nPREPARED ONLY: %s\n' "$app_dir"
node --version
"$venv/bin/python" --version
echo 'Next: verify CRM selectors, report formats and store mappings before enabling imports.'
echo 'No database connection, CRM request, worker, timer or app server was started.'
