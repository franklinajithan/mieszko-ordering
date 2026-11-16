# Run explicitly on the office PC after one-store verification and approval.
param([Parameter(Mandatory=$true)][string]$Config,[string]$At='02:00',[string]$TaskName='Mieszko Movement Imports')
$ErrorActionPreference='Stop'
$configPath=(Resolve-Path $Config).Path
$scriptPath=Join-Path $PSScriptRoot 'run-worker.ps1'
$arguments="-NoProfile -File `"$scriptPath`" -Config `"$configPath`" -EnqueueYesterday -Once"
$action=New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arguments -WorkingDirectory (Split-Path $PSScriptRoot)
$trigger=New-ScheduledTaskTrigger -Daily -At $At
$settings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 12)
# Uses the current signed-in user; no passwords are persisted in task arguments.
$principal=New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Description 'Normal Sales, RTC Sales and Wastage only; Book Stock remains manual.'
