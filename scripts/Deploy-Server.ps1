#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Deploy nove verzije Calculus QR Scanner API-ja na IIS (net.calculus.rs).

.DESCRIPTION
  1. git pull u izvornom folderu (osim uz -NoPull)
  2. kopira kod u novi releases\<timestamp> folder (bez .git, node_modules, .env, uploads)
  3. npm ci --omit=dev
  4. prebacuje physical path sajta na novi release i reciklira njegov pool
  5. proverava /health (lokalno, preko 127.0.0.1 uz zadržan SNI i proveru sertifikata)
  6. u slučaju greške vraća prethodni release
  7. briše stare release-ove (zadržava aktivni + $Keep prethodnih)

.EXAMPLE
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\Apps\CalculusQrScanner.Api\src\scripts\Deploy-Server.ps1
#>
[CmdletBinding(SupportsShouldProcess)]
param(
  [string]$AppRoot = 'C:\Apps\CalculusQrScanner.Api',
  [string]$SiteName = 'CalculusQrScanner.Api',
  [string]$HostName = 'net.calculus.rs',
  [string]$SourcePath,
  [switch]$NoPull,
  [int]$Keep = 2,
  [int]$HealthTimeoutSeconds = 45
)

$ErrorActionPreference = 'Stop'
Import-Module WebAdministration

if (-not $SourcePath) { $SourcePath = Join-Path $AppRoot 'src' }
$releasesDir = Join-Path $AppRoot 'releases'
$poolIdentity = "IIS AppPool\$SiteName"
$healthUri = "https://$HostName/health"

function Test-Health {
  param([int]$TimeoutSeconds)
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $code = & curl.exe -s -o NUL -w '%{http_code}' --max-time 10 `
      --resolve "${HostName}:443:127.0.0.1" $healthUri
    if ($code -eq '200') { return $true }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)
  Write-Warning "Health check $healthUri vratio je '$code'."
  return $false
}

function Switch-Release {
  param([string]$Path)
  Set-ItemProperty "IIS:\Sites\$SiteName" -Name physicalPath -Value $Path
  Restart-WebAppPool -Name $SiteName
}

if (-not (Get-Website -Name $SiteName)) { throw "Sajt '$SiteName' ne postoji. Pokrenite Initialize-Server.ps1." }
if (-not (Test-Path (Join-Path $AppRoot 'shared\.env'))) { throw "Nedostaje $AppRoot\shared\.env." }

$previousPath = (Get-Website -Name $SiteName).physicalPath
$hasPrevious = (Split-Path $previousPath -Parent) -eq $releasesDir

# 1. Izvorni kod
if (-not $NoPull -and $PSCmdlet.ShouldProcess($SourcePath, 'git pull')) {
  & git -C $SourcePath pull --ff-only
  if ($LASTEXITCODE -ne 0) { throw 'git pull nije uspeo.' }
}
$commit = (& git -C $SourcePath rev-parse --short HEAD 2>$null)

# 2. Novi release
$releaseId = Get-Date -Format 'yyyyMMdd-HHmmss'
$releasePath = Join-Path $releasesDir $releaseId
if (Test-Path $releasePath) { throw "Release $releasePath već postoji." }
if (-not $PSCmdlet.ShouldProcess($releasePath, "Deploy commit $commit")) { return }

& robocopy $SourcePath $releasePath /E /NFL /NDL /NJH /NJS /NP /XD .git node_modules uploads /XF .env | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy nije uspeo (kod $LASTEXITCODE)." }

# 3. Zavisnosti
Push-Location $releasePath
try {
  & 'C:\Program Files\nodejs\npm.cmd' ci --omit=dev --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'npm ci nije uspeo.' }
} finally { Pop-Location }

& icacls $releasePath /grant "${poolIdentity}:(OI)(CI)RX" | Out-Null

# 4-6. Prebacivanje, provera, rollback
Write-Host "Prebacujem $SiteName na $releaseId ($commit)..."
Switch-Release -Path $releasePath
if (Test-Health -TimeoutSeconds $HealthTimeoutSeconds) {
  Write-Host "Release $releaseId je aktivan." -ForegroundColor Green
} else {
  if ($hasPrevious) {
    Write-Warning "Novi release nije zdrav, vraćam $previousPath."
    Switch-Release -Path $previousPath
    if (Test-Health -TimeoutSeconds $HealthTimeoutSeconds) {
      Write-Warning 'Prethodni release je ponovo aktivan.'
    } else {
      Write-Error 'I prethodni release nije zdrav - proverite logs\stdout_*.log i Event Viewer.'
    }
  }
  throw "Deploy $releaseId nije uspeo. Logovi: $AppRoot\logs"
}

# 7. Čišćenje starih release-ova
Get-ChildItem $releasesDir -Directory |
  Where-Object { $_.FullName -ne $releasePath } |
  Sort-Object Name -Descending |
  Select-Object -Skip $Keep |
  ForEach-Object {
    Write-Host "Brišem stari release $($_.Name)"
    Remove-Item $_.FullName -Recurse -Force
  }
