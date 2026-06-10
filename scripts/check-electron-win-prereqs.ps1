$ErrorActionPreference = 'Stop'

function Write-Info([string]$message) {
  Write-Host "[preflight] $message"
}

function Fail([string]$message) {
  Write-Host "[preflight] ERROR: $message" -ForegroundColor Red
  exit 1
}

if ($env:OS -ne 'Windows_NT') {
  Write-Info 'Non-Windows host detected; Windows native packaging checks skipped.'
  exit 0
}

$vswherePath = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path $vswherePath)) {
  Fail "vswhere.exe not found at '$vswherePath'. Install Visual Studio Build Tools or Visual Studio Community with C++ tools."
}

$instancesJson = & $vswherePath -latest -products * -format json
if (-not $instancesJson) {
  Fail 'No Visual Studio instances detected. Install Visual Studio with Desktop development with C++ workload.'
}

$instances = $instancesJson | ConvertFrom-Json
if ($instances -isnot [System.Array]) {
  $instances = @($instances)
}

$instance = $instances | Select-Object -First 1
$installPath = $instance.installationPath
$instanceId = $instance.instanceId

if (-not $installPath -or -not (Test-Path $installPath)) {
  Fail 'Visual Studio installation path is missing or inaccessible.'
}

Write-Info "Visual Studio instance: $($instance.displayName)"
Write-Info "Install path: $installPath"

$msbuildPath = Join-Path $installPath 'MSBuild\Current\Bin\MSBuild.exe'
if (-not (Test-Path $msbuildPath)) {
  Fail "MSBuild not found at '$msbuildPath'. Install C++ build tools in Visual Studio Installer."
}

$msvcRoot = Join-Path $installPath 'VC\Tools\MSVC'
if (-not (Test-Path $msvcRoot)) {
  Fail "MSVC toolset folder not found at '$msvcRoot'. Install 'MSVC v143 - VS 2022 C++ x64/x86 build tools'."
}

$toolsetDirs = Get-ChildItem $msvcRoot -Directory | Sort-Object Name -Descending
if (-not $toolsetDirs -or $toolsetDirs.Count -eq 0) {
  Fail "No MSVC toolset versions found in '$msvcRoot'."
}

$toolsetVersion = $toolsetDirs[0].Name
$parts = $toolsetVersion.Split('.')
if ($parts.Length -lt 2) {
  Fail "Unable to parse MSVC toolset version '$toolsetVersion'."
}

$toolsetMajorMinor = "$($parts[0]).$($parts[1])"
$expectedSpectreComponent = "Microsoft.VisualStudio.Component.VC.$toolsetMajorMinor.x86.x64.Spectre"
$fallbackSpectreComponent = 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64.Spectre'

Write-Info "Detected MSVC toolset: $toolsetVersion"
Write-Info "Required Spectre component: $expectedSpectreComponent"

$statePath = "C:\ProgramData\Microsoft\VisualStudio\Packages\_Instances\$instanceId\state.json"
if (-not (Test-Path $statePath)) {
  Fail "Visual Studio state file not found at '$statePath'."
}

$stateText = Get-Content $statePath -Raw
$hasExpected = $stateText -match [regex]::Escape($expectedSpectreComponent)
$hasFallback = $stateText -match [regex]::Escape($fallbackSpectreComponent)

if ($hasExpected -or $hasFallback) {
  Write-Info 'Spectre-mitigated C++ libraries are installed.'
  Write-Info 'Preflight passed. Safe to run electron packaging.'
  exit 0
}

$setupPath = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\setup.exe'

Write-Host ''
Write-Host '[preflight] Missing Spectre-mitigated C++ libraries required by node-pty native rebuild.' -ForegroundColor Yellow
Write-Host '[preflight] Remediation (run in elevated PowerShell):' -ForegroundColor Yellow
Write-Host "  & '$setupPath' modify --installPath '$installPath' --add $expectedSpectreComponent --passive --norestart --wait"
Write-Host '[preflight] If the exact version component is unavailable, try this fallback:' -ForegroundColor Yellow
Write-Host "  & '$setupPath' modify --installPath '$installPath' --add $fallbackSpectreComponent --passive --norestart --wait"
Write-Host "[preflight] Then rerun: npm run preflight:electron:win && npm run electron:build"

exit 1
