param([Parameter(Mandatory=$true)][string]$Config, [switch]$Once, [switch]$EnqueueYesterday)
$ErrorActionPreference = 'Stop'
if (-not $env:DATABASE_URL) { throw 'Set DATABASE_URL for the local office PostgreSQL database.' }
$workerArgs = @("$PSScriptRoot/worker.py", '--config', (Resolve-Path $Config).Path)
if ($Once) { $workerArgs += '--once' }
if ($EnqueueYesterday) { $workerArgs += '--enqueue-yesterday' }
& "$PSScriptRoot/.venv/Scripts/python.exe" @workerArgs
exit $LASTEXITCODE
