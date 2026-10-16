# Run from Windows PowerShell. Transfers committed source only; never transfers .env.
param(
    [string]$Server = '192.168.128.139',
    [string]$ServerUser = 'backend',
    [switch]$ApplyCrmSettingsMigration,
    [switch]$ActivateWastage,
    [switch]$EnableNightly
)
$ErrorActionPreference = 'Stop'
if ($EnableNightly -and -not $ActivateWastage) { throw '-EnableNightly requires -ActivateWastage.' }
if ($Server -notmatch '^[A-Za-z0-9][A-Za-z0-9.-]*$' -or $ServerUser -notmatch '^[a-z_][a-z0-9_-]*$') {
    throw 'Invalid SSH host or Linux username.'
}
foreach ($command in @('git', 'ssh', 'scp')) {
    Get-Command $command -ErrorAction Stop | Out-Null
}
$project = Split-Path $PSScriptRoot -Parent
Push-Location $project
$bundle = $null
try {
    $sha = (& git rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'Cannot identify the project commit.' }
    & git cat-file -e 'HEAD:automation/setup-linux-worker.sh'
    if ($LASTEXITCODE -ne 0) { throw 'Pull the latest main before running this script.' }
    $release = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + $sha.Substring(0, 8) + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
    $bundle = Join-Path ([IO.Path]::GetTempPath()) "mieszko-worker-$release.tar"
    # Allowlist worker/parser sources: excludes .env, local CRM settings, downloads and database backups.
    & git archive --format=tar "--output=$bundle" HEAD automation src package.json package-lock.json tsconfig.json migrations/manual/2026-10-16-crm-store-settings.sql
    if ($LASTEXITCODE -ne 0) { throw 'Source packaging failed.' }
    $target = "$ServerUser@$Server"
    & ssh $target 'umask 077; mkdir -p "$HOME/mieszko-worker/uploads" "$HOME/mieszko-worker/releases"'
    if ($LASTEXITCODE -ne 0) { throw 'Server directory preparation failed.' }
    & scp $bundle "${target}:mieszko-worker/uploads/$release.tar"
    if ($LASTEXITCODE -ne 0) { throw 'Source transfer failed.' }
    # Normalize again on Ubuntu, including archives created with older Git attributes.
    $remote = 'set -e; umask 077; dest="$HOME/mieszko-worker/releases/{0}"; mkdir "$dest"; tar -xf "$HOME/mieszko-worker/uploads/{0}.tar" -C "$dest"; sed -i ''s/\r$//'' "$dest/automation/setup-linux-worker.sh"; bash "$dest/automation/setup-linux-worker.sh"' -f $release
    if ($ApplyCrmSettingsMigration) {
        $remote += '; sed -i ''s/\r$//'' "$dest/automation/apply-crm-settings-upgrade.sh"; bash "$dest/automation/apply-crm-settings-upgrade.sh"'
    }
    & ssh -t $target $remote
    if ($LASTEXITCODE -ne 0) { throw 'Server preparation failed. Review the output; no imports or schedule were started.' }
    if ($ActivateWastage) {
        # Capture the existing connection locally; never print or package credentials.
        $databaseJson = @'
const fs = require('fs'), dotenv = require('dotenv');
let config = {};
for (const path of ['.env', '.env.local']) {
    if (fs.existsSync(path)) Object.assign(config, dotenv.parse(fs.readFileSync(path)));
}
if (!config.DATABASE_URL) {
    process.stderr.write('DATABASE_URL is missing from the local environment files.');
    process.exit(1);
}
process.stdout.write(JSON.stringify({DATABASE_URL: config.DATABASE_URL}));
'@ | & node
        if ($LASTEXITCODE -ne 0) { throw 'Cannot load the existing office database configuration.' }
        $receiver = @'
import json, os, sys, tempfile
from pathlib import Path
path = Path(sys.argv[1])
value = json.load(sys.stdin)
if set(value) != {'DATABASE_URL'} or not isinstance(value['DATABASE_URL'], str) or not value['DATABASE_URL'].strip():
    raise SystemExit('Invalid database configuration payload')
descriptor, temporary = tempfile.mkstemp(dir=path.parent, prefix='.worker-env-')
with os.fdopen(descriptor, 'w') as handle:
    json.dump(value, handle)
os.chmod(temporary, 0o600)
os.replace(temporary, path)
print('Existing database configuration transferred to the protected worker environment.')
'@
        $encodedReceiver = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($receiver))
        $remoteReceiver = 'python3 -c "import base64;exec(base64.b64decode(''{0}''))" "$HOME/mieszko-worker/releases/{1}/automation/env.local.json"' -f $encodedReceiver, $release
        ($databaseJson -join "`n") | & ssh $target $remoteReceiver
        $databaseJson = $null
        if ($LASTEXITCODE -ne 0) { throw 'Protected configuration transfer failed; activation stopped.' }
        $activate = '"$HOME/mieszko-worker/releases/{0}/.worker-runtime/venv/bin/python" "$HOME/mieszko-worker/releases/{0}/automation/activate-linux-worker.py" --feeds wastage --start-worker' -f $release
        if ($EnableNightly) { $activate += ' --enable-nightly' }
        & ssh -t $target $activate
        if ($LASTEXITCODE -ne 0) { throw 'Worker activation did not finish. Review the output and service status before retrying.' }
        Write-Host "Wastage worker activated from $sha. Existing Wastage jobs can now be downloaded and imported."
    } else {
        Write-Host "Worker dependencies prepared from commit $sha. CRM configuration and controlled verification remain."
    }
} finally {
    Pop-Location
    if ($bundle -and (Test-Path -LiteralPath $bundle)) { Remove-Item -LiteralPath $bundle }
}
