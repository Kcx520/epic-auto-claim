# Download and silently install Node.js LTS (x64 MSI) if it is missing.
# ASCII only: this file is executed by powershell.exe from a .bat and must not rely on a BOM.

$ErrorActionPreference = 'Stop'

function Find-Node {
  $candidates = @(
    (Join-Path $env:ProgramFiles 'nodejs\node.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe')
  )
  foreach ($p in $candidates) {
    if ($p -and (Test-Path -LiteralPath $p)) { return $p }
  }
  return $null
}

$existing = Find-Node
if ($existing) {
  Write-Host "Node.js is already installed: $existing"
  exit 0
}

Write-Host 'Fetching Node.js LTS release index ...'
$page = Invoke-WebRequest -UseBasicParsing 'https://nodejs.org/dist/latest-lts/'
$msi = ($page.Links | Where-Object { $_.href -like '*-x64.msi' } | Select-Object -First 1).href
if (-not $msi) {
  Write-Host 'ERROR: could not find an x64 MSI in the Node.js LTS index.'
  exit 1
}

$url = 'https://nodejs.org/dist/latest-lts/' + $msi
$out = Join-Path $env:TEMP $msi
Write-Host "Downloading $url"
Invoke-WebRequest -UseBasicParsing $url -OutFile $out

Write-Host 'Installing Node.js silently. This can take a minute ...'
$proc = Start-Process msiexec.exe -ArgumentList @('/i', $out, '/qn', '/norestart') -Wait -PassThru
if ($proc.ExitCode -ne 0) {
  Write-Host "ERROR: msiexec exited with code $($proc.ExitCode)"
  exit 1
}

$node = Find-Node
if ($node) {
  Write-Host "Node.js installed: $node"
  exit 0
}

Write-Host 'ERROR: Node.js still not found after installation.'
exit 1
