<#
  (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
  v5.0.2
#>
$ErrorActionPreference = 'Stop'

# Accumulate all validation failures and report them together at the end.
$script:Failures = @()

function Write-Info([string]$message) {
  Write-Host "[preflight] $message"
}

function Add-Failure([string]$message) {
  Write-Host "[preflight] FAIL: $message" -ForegroundColor Red
  $script:Failures += $message
}

if ($env:OS -ne 'Windows_NT') {
  Write-Info 'Non-Windows host detected; Windows native packaging checks skipped.'
  exit 0
}

# ---------------------------------------------------------------------------
# Build Resources Validation
# ---------------------------------------------------------------------------

Write-Info 'Checking build resources...'

# Check build/icon.ico exists and is valid ICO format
$iconPath = Join-Path $PSScriptRoot '..\build\icon.ico'
if (-not (Test-Path $iconPath)) {
  Add-Failure "build/icon.ico not found. The application icon is required for the installer."
} else {
  # Validate ICO file header: first 4 bytes must be 00 00 01 00 (little-endian)
  try {
    $bytes = [System.IO.File]::ReadAllBytes((Resolve-Path $iconPath).Path)
    if ($bytes.Length -lt 4) {
      Add-Failure "build/icon.ico is too small to be a valid ICO file."
    } elseif ($bytes[0] -ne 0x00 -or $bytes[1] -ne 0x00 -or $bytes[2] -ne 0x01 -or $bytes[3] -ne 0x00) {
      Add-Failure "build/icon.ico has invalid ICO header bytes. Expected 00 00 01 00."
    } else {
      Write-Info 'build/icon.ico is present and has valid ICO header.'
    }
  } catch {
    Add-Failure "build/icon.ico could not be read: $($_.Exception.Message)"
  }
}

# Check build/license.txt exists
$licensePath = Join-Path $PSScriptRoot '..\build\license.txt'
if (-not (Test-Path $licensePath)) {
  Add-Failure "build/license.txt not found. The license file is required for the installer."
} else {
  Write-Info 'build/license.txt is present.'
}

# Check build/installer.nsh exists
$installerNshPath = Join-Path $PSScriptRoot '..\build\installer.nsh'
if (-not (Test-Path $installerNshPath)) {
  Add-Failure "build/installer.nsh not found. The custom NSIS script is required for the installer."
} else {
  Write-Info 'build/installer.nsh is present.'
}

# ---------------------------------------------------------------------------
# electron-builder Availability
# ---------------------------------------------------------------------------

Write-Info 'Checking electron-builder availability...'

try {
  $ebVersion = & npx electron-builder --version 2>&1
  if ($LASTEXITCODE -ne 0) {
    Add-Failure "electron-builder is not available or failed to run. Ensure it is installed (npm install)."
  } else {
    Write-Info "electron-builder version: $ebVersion"
  }
} catch {
  Add-Failure "electron-builder check failed: $($_.Exception.Message)"
}

# ---------------------------------------------------------------------------
# Code Signing Configuration Validation
# ---------------------------------------------------------------------------

Write-Info 'Checking code signing configuration...'

if ($env:WIN_CSC_LINK) {
  if (-not $env:WIN_CSC_KEY_PASSWORD) {
    Add-Failure "WIN_CSC_LINK is set but WIN_CSC_KEY_PASSWORD is not. Both are required for code signing."
  } else {
    Write-Info 'Code signing environment variables are configured.'
  }
} else {
  Write-Info 'No code signing configuration detected (WIN_CSC_LINK not set). Skipping signing validation.'
}

# ---------------------------------------------------------------------------
# Visual Studio / Spectre Library Checks
# ---------------------------------------------------------------------------

Write-Info 'Checking Visual Studio C++ build tools...'

$vswherePath = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path $vswherePath)) {
  Add-Failure "vswhere.exe not found at '$vswherePath'. Install Visual Studio Build Tools or Visual Studio Community with C++ tools."
} else {
  $instancesJson = & $vswherePath -latest -products * -format json
  if (-not $instancesJson) {
    Add-Failure 'No Visual Studio instances detected. Install Visual Studio with Desktop development with C++ workload.'
  } else {
    $instances = $instancesJson | ConvertFrom-Json
    if ($instances -isnot [System.Array]) {
      $instances = @($instances)
    }

    $instance = $instances | Select-Object -First 1
    $installPath = $instance.installationPath
    $instanceId = $instance.instanceId

    if (-not $installPath -or -not (Test-Path $installPath)) {
      Add-Failure 'Visual Studio installation path is missing or inaccessible.'
    } else {
      Write-Info "Visual Studio instance: $($instance.displayName)"
      Write-Info "Install path: $installPath"

      $msbuildPath = Join-Path $installPath 'MSBuild\Current\Bin\MSBuild.exe'
      if (-not (Test-Path $msbuildPath)) {
        Add-Failure "MSBuild not found at '$msbuildPath'. Install C++ build tools in Visual Studio Installer."
      }

      $msvcRoot = Join-Path $installPath 'VC\Tools\MSVC'
      if (-not (Test-Path $msvcRoot)) {
        Add-Failure "MSVC toolset folder not found at '$msvcRoot'. Install 'MSVC v143 - VS 2022 C++ x64/x86 build tools'."
      } else {
        $toolsetDirs = Get-ChildItem $msvcRoot -Directory | Sort-Object Name -Descending
        if (-not $toolsetDirs -or $toolsetDirs.Count -eq 0) {
          Add-Failure "No MSVC toolset versions found in '$msvcRoot'."
        } else {
          $toolsetVersion = $toolsetDirs[0].Name
          $parts = $toolsetVersion.Split('.')
          if ($parts.Length -lt 2) {
            Add-Failure "Unable to parse MSVC toolset version '$toolsetVersion'."
          } else {
            $toolsetMajorMinor = "$($parts[0]).$($parts[1])"
            $expectedSpectreComponent = "Microsoft.VisualStudio.Component.VC.$toolsetMajorMinor.x86.x64.Spectre"
            $fallbackSpectreComponent = 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64.Spectre'

            Write-Info "Detected MSVC toolset: $toolsetVersion"
            Write-Info "Required Spectre component: $expectedSpectreComponent"

            function Test-ComponentInstalled([string]$componentId) {
              $result = & $vswherePath -latest -products * -requires $componentId -format json
              if (-not $result) {
                return $false
              }
              $parsed = $result | ConvertFrom-Json
              if ($parsed -is [System.Array]) {
                return $parsed.Count -gt 0
              }
              return $null -ne $parsed
            }

            $hasExpected = Test-ComponentInstalled $expectedSpectreComponent
            $hasFallback = Test-ComponentInstalled $fallbackSpectreComponent

            if (-not ($hasExpected -or $hasFallback)) {
              $setupPath = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\setup.exe'
              Add-Failure "Missing Spectre-mitigated C++ libraries required by node-pty native rebuild."
              Write-Host '[preflight] Remediation (run in an elevated PowerShell window):' -ForegroundColor Yellow
              Write-Host "  & '$setupPath' modify --installPath '$installPath' --add $expectedSpectreComponent --passive --norestart"
              Write-Host '[preflight] If the exact version component is unavailable, try this fallback:' -ForegroundColor Yellow
              Write-Host "  & '$setupPath' modify --installPath '$installPath' --add $fallbackSpectreComponent --passive --norestart"
            } else {
              Write-Info 'Spectre-mitigated C++ libraries are installed.'
            }
          }
        }
      }
    }
  }
}

# ---------------------------------------------------------------------------
# Final Result
# ---------------------------------------------------------------------------

if ($script:Failures.Count -gt 0) {
  Write-Host ''
  Write-Host "[preflight] $($script:Failures.Count) validation error(s) detected:" -ForegroundColor Red
  foreach ($failure in $script:Failures) {
    Write-Host "  - $failure" -ForegroundColor Red
  }
  Write-Host ''
  Write-Host '[preflight] Fix the above issues and rerun: npm run preflight:electron:win' -ForegroundColor Yellow
  exit 1
}

Write-Info 'All preflight checks passed. Safe to run electron packaging.'
exit 0
