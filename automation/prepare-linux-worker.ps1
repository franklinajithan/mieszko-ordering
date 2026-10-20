# Run from Windows PowerShell. Transfers committed source only; never transfers .env.
param(
    [string]$Server = '192.168.128.139',
    [string]$ServerUser = 'backend',
    [switch]$ApplyCrmSettingsMigration,
    [switch]$ApplyReconciliationMigration,
    [switch]$ActivateMovementFeeds,
    [switch]$ActivateWastage,
    [switch]$EnableNightly,
    [string]$ResumeRelease
)
$ErrorActionPreference = 'Stop'
if ($EnableNightly -and -not ($ActivateWastage -or $ActivateMovementFeeds)) { throw '-EnableNightly requires -ActivateWastage or -ActivateMovementFeeds.' }
if ($ResumeRelease -and ($ResumeRelease -notmatch '^\d{8}-\d{6}-[0-9a-f]{8}-[0-9a-f]{8}$' -or -not ($ActivateWastage -or $ActivateMovementFeeds) -or $ApplyCrmSettingsMigration -or $ApplyReconciliationMigration)) {
    throw 'ResumeRelease requires a valid prepared release name and -ActivateWastage, without migrations.'
}
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
    $target = "$ServerUser@$Server"
    if ($ResumeRelease) {
        $release = $ResumeRelease
        $check = 'test -x $HOME/mieszko-worker/releases/{0}/.worker-runtime/venv/bin/python && test -f $HOME/mieszko-worker/releases/{0}/automation/activate-linux-worker.py && if systemctl is-active --quiet mieszko-import-worker.service; then echo Worker_already_active_resume_cancelled; exit 1; fi' -f $release
        & ssh $target $check
        if ($LASTEXITCODE -ne 0) { throw 'Prepared release not found or worker already active. Resume stopped.' }
        & scp (Join-Path $PSScriptRoot 'store-worker-environment.py') (Join-Path $PSScriptRoot 'configure-linux-worker.py') (Join-Path $PSScriptRoot 'activate-linux-worker.py') "${target}:mieszko-worker/releases/$release/automation/"
        if ($LASTEXITCODE -ne 0) { throw 'Activation repair transfer failed.' }
        Write-Host "Resuming prepared release $release; dependency installation skipped."
    } else {
        $release = (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + $sha.Substring(0, 8) + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
        $bundle = Join-Path ([IO.Path]::GetTempPath()) "mieszko-worker-$release.tar"
        # Allowlist worker/parser sources: excludes .env, local CRM settings, downloads and database backups.
        & git archive --format=tar "--output=$bundle" HEAD automation src package.json package-lock.json tsconfig.json migrations/manual/2026-10-16-crm-store-settings.sql migrations/manual/2026-10-20-unmatched-products.sql
        if ($LASTEXITCODE -ne 0) { throw 'Source packaging failed.' }
        & ssh $target 'umask 077; mkdir -p "$HOME/mieszko-worker/uploads" "$HOME/mieszko-worker/releases"'
        if ($LASTEXITCODE -ne 0) { throw 'Server directory preparation failed.' }
        & scp $bundle "${target}:mieszko-worker/uploads/$release.tar"
        if ($LASTEXITCODE -ne 0) { throw 'Source transfer failed.' }
        # Normalize again on Ubuntu, including archives created with older Git attributes.
        $remote = 'set -e; umask 077; dest="$HOME/mieszko-worker/releases/{0}"; mkdir "$dest"; tar -xf "$HOME/mieszko-worker/uploads/{0}.tar" -C "$dest"; sed -i ''s/\r$//'' "$dest/automation/setup-linux-worker.sh"; bash "$dest/automation/setup-linux-worker.sh"' -f $release
        if ($ApplyCrmSettingsMigration) {
            $remote += '; sed -i ''s/\r$//'' "$dest/automation/apply-crm-settings-upgrade.sh"; bash "$dest/automation/apply-crm-settings-upgrade.sh"'
        }
        if ($ApplyReconciliationMigration) {
            $remote += '; sed -i ''s/\r$//'' "$dest/automation/apply-reconciliation-upgrade.sh"; bash "$dest/automation/apply-reconciliation-upgrade.sh"'
        }
        & ssh -t $target $remote
        if ($LASTEXITCODE -ne 0) { throw 'Server preparation failed. Review the output; no imports or schedule were started.' }
    }
    if ($ActivateWastage -or $ActivateMovementFeeds) {
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
        # A script filename needs no nested shell quotes (Windows PowerShell 5.1 strips them).
        $remoteReceiver = '$HOME/mieszko-worker/releases/{0}/.worker-runtime/venv/bin/python $HOME/mieszko-worker/releases/{0}/automation/store-worker-environment.py' -f $release
        ($databaseJson -join "`n") | & ssh $target $remoteReceiver
        $databaseJson = $null
        if ($LASTEXITCODE -ne 0) { throw 'Protected configuration transfer failed; activation stopped.' }
        $activate = '$HOME/mieszko-worker/releases/{0}/.worker-runtime/venv/bin/python $HOME/mieszko-worker/releases/{0}/automation/activate-linux-worker.py --feeds wastage --start-worker' -f $release
        if ($ActivateMovementFeeds) { $activate = $activate.Replace('--feeds wastage', '--feeds normal_sales rtc wastage') }
        if ($EnableNightly) { $activate += ' --enable-nightly' }
        & ssh -t $target $activate
        if ($LASTEXITCODE -ne 0) { throw 'Worker activation did not finish. Review the output and service status before retrying.' }
        Write-Host "Selected movement feeds activated in release $release. Check the Download Queue for actual results."
    } else {
        Write-Host "Worker dependencies prepared from commit $sha. CRM configuration and controlled verification remain."
    }
} finally {
    Pop-Location
    if ($bundle -and (Test-Path -LiteralPath $bundle)) { Remove-Item -LiteralPath $bundle }
}
