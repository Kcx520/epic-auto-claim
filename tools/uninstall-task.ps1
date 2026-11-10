# Remove the daily auto-claim task. ASCII only.

param(
  [string]$TaskName = 'EpicAutoClaim'
)

$ErrorActionPreference = 'Continue'

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) {
  Write-Host "Task '$TaskName' was not found. Nothing to remove."
  exit 0
}

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Write-Host 'ERROR: failed to remove the scheduled task.'
  exit 1
}

Write-Host "Task '$TaskName' has been removed."
exit 0
