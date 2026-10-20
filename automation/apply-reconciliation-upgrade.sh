#!/usr/bin/env bash
# Explicit operator action only. No worker, timer or CRM session is started.
set -Eeuo pipefail
umask 077
trap 'echo "Reconciliation upgrade FAILED. Review the error; no imports were started." >&2' ERR
app_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
migration="$app_dir/migrations/manual/2026-10-20-unmatched-products.sql"
test -s "$migration"
backup_dir="${MIESZKO_DB_BACKUP_DIRECTORY:-$HOME/mieszko-db-backups}"
mkdir -p "$backup_dir"
backup_file="$backup_dir/mieszko-order-before-reconciliation-$(date +%Y%m%d-%H%M%S)-$$.dump"
sudo -u postgres pg_dump --format=custom --dbname=mieszko-order > "$backup_file"
test -s "$backup_file"
pg_restore --list "$backup_file" > /dev/null
echo "Backup created and archive directory checked: $backup_file"
sudo -u postgres psql -X --dbname=mieszko-order --set=ON_ERROR_STOP=1 --file=- < "$migration"
echo 'Reconciliation table upgrade complete. No imports, CRM session or schedule started.'
