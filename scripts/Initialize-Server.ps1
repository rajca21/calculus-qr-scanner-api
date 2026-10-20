#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Jednokratna priprema IIS servera za Calculus QR Scanner API (net.calculus.rs).

.DESCRIPTION
  Kreira strukturu foldera, dedicated application pool i IIS sajt sa HTTP binding-om.
  Postojeće stavke se ne menjaju (skripta je idempotentna). HTTPS binding i sertifikat
  dodaje win-acme (vidi README). Node.js mora biti instaliran pre pokretanja.

.EXAMPLE
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\Initialize-Server.ps1
#>
[CmdletBinding(SupportsShouldProcess)]
param(
  [string]$AppRoot = 'C:\Apps\CalculusQrScanner.Api',
  [string]$SiteName = 'CalculusQrScanner.Api',
  [string]$HostName = 'net.calculus.rs',
  [string]$RepoUrl = 'https://github.com/rajca21/calculus-qr-scanner-api.git'
)

$ErrorActionPreference = 'Stop'
Import-Module WebAdministration

$nodeExe = 'C:\Program Files\nodejs\node.exe'
if (-not (Test-Path $nodeExe)) {
  throw "Node.js nije pronađen na $nodeExe. Instalirajte Node.js LTS (x64 MSI) pa pokrenite ponovo."
}
if (-not (Get-WebGlobalModule -Name AspNetCoreModuleV2 -ErrorAction SilentlyContinue)) {
  throw 'AspNetCoreModuleV2 nije instaliran (ASP.NET Core Hosting Bundle).'
}

$poolIdentity = "IIS AppPool\$SiteName"
$dirs = 'releases', 'shared', 'shared\uploads', 'logs' | ForEach-Object { Join-Path $AppRoot $_ }

foreach ($dir in @($AppRoot) + $dirs) {
  if (-not (Test-Path $dir) -and $PSCmdlet.ShouldProcess($dir, 'Create directory')) {
    New-Item -ItemType Directory -Path $dir | Out-Null
  }
}

$src = Join-Path $AppRoot 'src'
if (-not (Test-Path $src) -and $PSCmdlet.ShouldProcess($src, "git clone $RepoUrl")) {
  & git clone $RepoUrl $src
  if ($LASTEXITCODE -ne 0) { throw 'git clone nije uspeo.' }
}

# Application pool: bez .NET runtime-a, uvek pokrenut, bez idle gašenja (nema cold start-a)
if (-not (Test-Path "IIS:\AppPools\$SiteName") -and $PSCmdlet.ShouldProcess($SiteName, 'Create application pool')) {
  New-WebAppPool -Name $SiteName | Out-Null
}
if ($PSCmdlet.ShouldProcess($SiteName, 'Configure application pool')) {
  $poolPath = "IIS:\AppPools\$SiteName"
  Set-ItemProperty $poolPath -Name managedRuntimeVersion -Value ''
  Set-ItemProperty $poolPath -Name startMode -Value 'AlwaysRunning'
  Set-ItemProperty $poolPath -Name processModel.identityType -Value 'ApplicationPoolIdentity'
  Set-ItemProperty $poolPath -Name processModel.idleTimeout -Value ([TimeSpan]::Zero)
}

# Sajt: na početku pokazuje na prazan releases folder; Deploy-Server.ps1 prebacuje putanju
if (-not (Get-Website -Name $SiteName) -and $PSCmdlet.ShouldProcess($SiteName, "Create site http://${HostName}")) {
  New-Website -Name $SiteName -PhysicalPath (Join-Path $AppRoot 'releases') `
    -ApplicationPool $SiteName -HostHeader $HostName -Port 80 | Out-Null
}

# ACL: tajne i podaci dostupni samo SYSTEM, Administrators i app pool-u
if ($PSCmdlet.ShouldProcess($AppRoot, 'Set ACLs')) {
  $shared = Join-Path $AppRoot 'shared'
  & icacls $shared /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' 'Administrators:(OI)(CI)F' "${poolIdentity}:(OI)(CI)RX" | Out-Null
  & icacls (Join-Path $AppRoot 'shared\uploads') /grant "${poolIdentity}:(OI)(CI)M" | Out-Null
  & icacls (Join-Path $AppRoot 'logs') /grant "${poolIdentity}:(OI)(CI)M" | Out-Null
  & icacls (Join-Path $AppRoot 'releases') /grant "${poolIdentity}:(OI)(CI)RX" | Out-Null
}

$envFile = Join-Path $AppRoot 'shared\.env'
$site = Get-Website -Name $SiteName
Write-Host ''
Write-Host "Sajt '$SiteName' (id $($site.id)) je spreman." -ForegroundColor Green
if (-not (Test-Path $envFile)) {
  Write-Host "SLEDEĆE: kreirajte $envFile (vrednosti sa Render-a, vidi .env.example)." -ForegroundColor Yellow
}
Write-Host "SLEDEĆE: C:\win-acme\wacs.exe --source iis --siteid $($site.id) --host $HostName --installation iis"
Write-Host "SLEDEĆE: .\scripts\Deploy-Server.ps1"
