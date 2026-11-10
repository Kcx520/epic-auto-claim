# Runs one claim pass. Used by the Windows scheduled task.
# ASCII only. Kept separate from the .bat files so Task Scheduler does not flash a console window.

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$logDir = Join-Path $root 'logs'
if (-not (Test-Path -LiteralPath $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
$taskLog = Join-Path $logDir 'task.log'

function Write-TaskLog([string]$Message) {
  $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message"
  Add-Content -LiteralPath $taskLog -Value $line -Encoding UTF8
}

Set-Location -LiteralPath $root

$node = $null
$cmd = Get-Command node.exe -ErrorAction SilentlyContinue
if ($cmd) { $node = $cmd.Source }
if (-not $node) {
  $candidates = @(
    (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe')
  )
  foreach ($p in $candidates) {
    if ($p -and (Test-Path -LiteralPath $p)) { $node = $p; break }
  }
}

if (-not $node) {
  Write-TaskLog 'ERROR: node.exe not found. Re-run the installer (file name starts with "1-").'
  exit 1
}

Write-TaskLog "Starting claim run with $node"
& $node (Join-Path $root 'claim.js')
$code = $LASTEXITCODE
Write-TaskLog "Finished with exit code $code"
exit $code
