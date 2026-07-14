[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$SourceDirectory,
  [string]$RemoteTarget = 'root@121.41.229.127',
  [string]$RemoteDirectory = '/opt/apps/gz/backend/data/ads',
  [string]$IdentityFile = "$env:USERPROFILE\.ssh\etsy_ads_sync"
)

$ErrorActionPreference = 'Stop'
$runtimeDirectory = Join-Path $env:LOCALAPPDATA 'EtsyDashboard'
$stateFile = Join-Path $runtimeDirectory 'ads-sync-state.json'
$logFile = Join-Path $runtimeDirectory 'ads-sync.log'

New-Item -ItemType Directory -Force -Path $runtimeDirectory | Out-Null

function Write-Log([string]$Message) {
  $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
  Add-Content -LiteralPath $logFile -Value $line -Encoding UTF8
  Write-Host $line
}

try {
  if (-not (Test-Path -LiteralPath $SourceDirectory -PathType Container)) {
    throw "Ads directory not found: $SourceDirectory"
  }

  if (-not (Test-Path -LiteralPath $IdentityFile -PathType Leaf)) {
    throw "SSH private key not found: $IdentityFile"
  }

  $latestFile = Get-ChildItem -LiteralPath $SourceDirectory -File -Filter '*.csv' |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 1

  if (-not $latestFile) {
    throw "No CSV file found in: $SourceDirectory"
  }

  $signature = '{0}|{1}|{2}' -f $latestFile.FullName, $latestFile.Length, $latestFile.LastWriteTimeUtc.Ticks
  $previousSignature = ''

  if (Test-Path -LiteralPath $stateFile -PathType Leaf) {
    try {
      $previousSignature = (Get-Content -Raw -LiteralPath $stateFile | ConvertFrom-Json).signature
    } catch {
      Write-Log 'Previous sync state is invalid; the latest report will be uploaded again.'
    }
  }

  if ($previousSignature -eq $signature) {
    Write-Log "Latest report is unchanged; skipped: $($latestFile.Name)"
    exit 0
  }

  & ssh -i $IdentityFile -o BatchMode=yes -o ConnectTimeout=20 $RemoteTarget "mkdir -p '$RemoteDirectory'"
  if ($LASTEXITCODE -ne 0) {
    throw "Could not create remote ads directory; ssh exit code: $LASTEXITCODE"
  }

  & scp -p -i $IdentityFile -o BatchMode=yes -o ConnectTimeout=20 -- $latestFile.FullName "${RemoteTarget}:${RemoteDirectory}/"
  if ($LASTEXITCODE -ne 0) {
    throw "Could not upload ads report; scp exit code: $LASTEXITCODE"
  }

  @{
    signature = $signature
    fileName = $latestFile.Name
    syncedAt = (Get-Date).ToString('o')
  } | ConvertTo-Json | Set-Content -LiteralPath $stateFile -Encoding UTF8

  Write-Log "Uploaded latest ads report: $($latestFile.Name)"
} catch {
  Write-Log "Sync failed: $($_.Exception.Message)"
  exit 1
}
