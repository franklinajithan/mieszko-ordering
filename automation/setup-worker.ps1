$ErrorActionPreference = 'Stop'
py -3 -m venv "$PSScriptRoot/.venv"
if ($LASTEXITCODE -ne 0) { throw 'Python 3.11+ is required' }
& "$PSScriptRoot/.venv/Scripts/python.exe" -m pip install -r "$PSScriptRoot/requirements.txt"
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed' }
& "$PSScriptRoot/.venv/Scripts/python.exe" -m playwright install chromium
if ($LASTEXITCODE -ne 0) { throw 'Browser installation failed' }
Write-Host 'Dependencies ready. No task installed, worker started, or database migration applied.'
