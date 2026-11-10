# Register the daily auto-claim task for the current user.
# ASCII only. Does not need administrator rights.

param(
  [string]$Time = '23:30',
  [string]$TaskName = 'EpicAutoClaim'
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$runner = Join-Path $root 'tools\run-claim.ps1'
if (-not (Test-Path -LiteralPath $runner)) {
  Write-Host "ERROR: runner not found: $runner"
  exit 1
}

$psExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
if (-not (Test-Path -LiteralPath $psExe)) { $psExe = 'powershell.exe' }

$argument = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $runner + '"'

try {
  $action = New-ScheduledTaskAction -Execute $psExe -Argument $argument
  $trigger = New-ScheduledTaskTrigger -Daily -At $Time
  $settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Hours 2)
  $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
}
catch {
  Write-Host ''
  Write-Host 'ERROR: could not register the scheduled task.'
  Write-Host $_.Exception.Message
  exit 1
}

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) {
  Write-Host 'ERROR: task registration reported success but the task is missing.'
  exit 1
}

Write-Host ''
Write-Host '============================================================'
Write-Host "  Scheduled task is ready: $($task.TaskName)   state=$($task.State)"
Write-Host "  It will run every day at $Time"
Write-Host '============================================================'
exit 0
