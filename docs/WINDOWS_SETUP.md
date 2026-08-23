# Windows Installer Guide

Ollama+ ships as a full NSIS-based Windows installer (`.exe`) that handles prerequisite detection, guided installation, Windows integration, code signing, and automatic updates.

This document covers everything from end-user installation to developer build workflows.

## Overview

The installer replaces the older portable executable approach with a proper Windows installation experience:

- Detects and installs missing prerequisites (Ollama Runtime, VC++ Redistributable)
- Presents a multi-page installation wizard with license agreement, folder selection, and options
- Registers the application with Windows (Start Menu, Apps & Features, desktop shortcut)
- Supports per-user and machine-wide installation modes
- Includes an auto-updater that checks for new versions on startup
- Optionally signs the installer and all executables with an Authenticode certificate

## System Requirements

| Requirement | Details |
|-------------|---------|
| OS | Windows 10 or later (x64) |
| Ollama Runtime | Local LLM inference server — detected automatically by the installer |
| VC++ Redistributable | Microsoft Visual C++ 2015-2022 Redistributable (x64) |
| Disk space | ~200 MB for the installer; ~400 MB installed |
| Internet | Required only for prerequisite downloads; core installation is offline |

The installer checks for both prerequisites at launch and offers to download any that are missing.

## How the Installer Works

Installation proceeds through four phases:

### Phase 1: Prerequisite Detection

When the installer starts, it checks:

1. **Ollama Runtime** — Searches the system PATH and `%LOCALAPPDATA%\Programs\Ollama` for `ollama.exe`. Validates the file is a valid executable.
2. **Visual C++ Redistributable** — Queries the registry key `HKLM\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\X64` for the `Installed` value.

Detection completes within 30 seconds. If a check fails due to permissions, the installer shows a notification that the dependency could not be verified.

### Phase 2: Prerequisite Resolution

If prerequisites are missing, the installer displays a notification page listing each missing dependency with a download action. Users can:

- Accept the download — the installer fetches and silently installs each prerequisite
- Decline — the installer blocks forward progress and allows a re-check or exit
- Skip (after failed download) — proceed at your own risk

Downloads use a 120-second inactivity timeout with up to 3 retries. If all retries fail, a manual download URL is shown.

### Phase 3: Installation Wizard

The wizard presents these pages in order:

1. **Welcome** — Application name, version, and description
2. **License Agreement** — Must click "I Agree" before proceeding
3. **Destination Folder** — Default path with browse option
4. **Options** — Desktop shortcut checkbox (checked by default)
5. **Progress** — File extraction progress bar
6. **Completion** — "Launch Ollama+" checkbox and Finish button

Cancellation at any point before extraction exits cleanly. Cancellation during extraction rolls back partial changes.

### Phase 4: Windows Registration

After extraction, the installer:

- Creates a Start Menu shortcut under `Ollama+/`
- Optionally creates a Desktop shortcut
- Registers in Apps & Features with name, version, publisher, icon, and estimated size
- Registers an uninstaller for clean removal

## Installation Modes

| Mode | Default Path | Privileges | Registry |
|------|-------------|------------|----------|
| Per-user (default) | `%LOCALAPPDATA%\Programs\Ollama+\` | None required | HKCU |
| All-users | `%PROGRAMFILES%\Ollama+\` | Administrator (UAC prompt) | HKLM |

The installer defaults to per-user mode. Selecting all-users mode triggers a UAC elevation prompt if the installer was not run as administrator.

## What Gets Installed

### Files

- Application executable and Electron runtime
- Renderer bundle (`dist/`)
- MCP server libraries (`mcp/lib/`)
- Uninstaller executable

### Shortcuts

- Start Menu: `Ollama+/Ollama+.lnk`
- Desktop: `Ollama+.lnk` (optional, user-selectable)

### Registry Entries

- `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\{GUID}` (per-user)
- `HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall\{GUID}` (all-users)
- Values: DisplayName, DisplayVersion, Publisher, UninstallString, EstimatedSize, DisplayIcon

### Runtime Data

- `%LOCALAPPDATA%\Ollama+\` — User settings, update cache, `app-update.yml`

## Auto-Update Mechanism

The application includes `electron-updater` for seamless updates after installation.

### How It Works

1. On each application start, the updater checks the configured update server for a new version.
2. If an update is available, an in-app notification offers to download it.
3. During download, a progress indicator shows percentage and size.
4. Once downloaded, the updater verifies integrity (checksum/signature).
5. The user is prompted to install and restart. Updates are never applied silently.
6. If the user defers, the downloaded update is retained and re-offered on next start.

### Failure Handling

- **Network failure on check** — Logged silently, retries on next start.
- **Download failure** — Partial data discarded, user notified, retry on next start.
- **Integrity failure** — Update discarded, user informed, fresh download on next start.

### IPC Channels

The renderer communicates with the updater via these channels:

| Direction | Channel | Purpose |
|-----------|---------|---------|
| Main → Renderer | `updater:update-available` | Notify about available update |
| Main → Renderer | `updater:download-progress` | Download progress data |
| Main → Renderer | `updater:update-downloaded` | Prompt to install |
| Main → Renderer | `updater:error` | Report failure |
| Renderer → Main | `updater:download-update` | User accepted download |
| Renderer → Main | `updater:install-update` | User confirmed install |
| Renderer → Main | `updater:dismiss` | User declined/deferred |

## Code Signing

### For Users

A signed installer displays the publisher name in the UAC prompt and avoids Windows SmartScreen warnings. If you see a SmartScreen warning, the installer was built without a code signing certificate — this is normal for development builds.

### For Developers

Code signing is controlled entirely through environment variables:

| Variable | Purpose |
|----------|---------|
| `WIN_CSC_LINK` | Path to PFX certificate file |
| `WIN_CSC_KEY_PASSWORD` | Certificate private key password |

Alternative: use `WIN_CSC_STORE_NAME` for Windows Certificate Store-based signing.

When signing is configured:

- All `.exe` and `.dll` files in the package are signed with SHA-256
- An RFC 3161 timestamp is applied from a public timestamping authority
- The build verifies the final installer carries a valid Authenticode signature

When signing is not configured:

- The build produces an unsigned installer and logs a warning
- Users will see SmartScreen warnings on first run

## Uninstallation

### How to Remove

1. Open Windows Settings → Apps → Apps & Features
2. Search for "Ollama +"
3. Click Uninstall

Or run the uninstaller directly from the installation directory.

### What Gets Cleaned Up

- All files placed by the installer
- Start Menu and Desktop shortcuts
- Registry entries (uninstall registration)
- The installation directory (only if it contains no user-added files)

### What Is Preserved

- User data in `%LOCALAPPDATA%\Ollama+\` (settings, chat history) is NOT deleted by default
- The `deleteAppDataOnUninstall` option is set to `false`

The uninstaller prompts for confirmation before removing anything. If the confirmation prompt cannot be displayed, the uninstall aborts safely.

## Building the Installer

### Developer Prerequisites

- **Node.js** — LTS version (18+)
- **Visual Studio C++ Build Tools** — Required for native module compilation
  - Must include Spectre-mitigated libraries for the active MSVC toolset
- **electron-builder** — Installed as a devDependency
- **NSIS** — Bundled by electron-builder (no separate install needed)

### Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `WIN_CSC_LINK` | For signing | Path to PFX certificate file |
| `WIN_CSC_KEY_PASSWORD` | For signing | Certificate private key password |
| `UPDATE_SERVER_URL` | For auto-update | Base URL for update metadata and artifacts |

### Build Commands

```bash
# Run preflight checks only
npm run preflight:electron:win

# Build the NSIS installer (includes Vite build)
npm run electron:build

# Run preflight checks then build (recommended)
npm run electron:build:checked
```

### What `electron:build` Does

1. Runs `vite build` to produce the renderer bundle in `dist/`
2. Invokes `electron-builder` which:
   - Packages the Electron app with all source files
   - Processes the custom NSIS script (`build/installer.nsh`)
   - Signs executables if signing is configured
   - Produces the final installer with LZMA compression
3. Outputs the installer to `dist-electron/`

### Output

```
dist-electron/
├── Ollama + Setup {version}.exe    # NSIS installer
├── latest.yml                       # Update metadata (version, checksum, URL)
├── builder-debug.yml                # Build debug info
└── win-unpacked/                    # Unpacked application (for testing)
```

### Preflight Checks

The `preflight:electron:win` script validates before building:

1. `build/icon.ico` exists and is valid ICO format
2. `build/license.txt` exists
3. `build/installer.nsh` exists
4. `electron-builder` is available (`npx electron-builder --version`)
5. Visual Studio C++ build tools with Spectre-mitigated libraries are present
6. If signing config is present, `WIN_CSC_KEY_PASSWORD` is also set

The script exits with code 0 on success or code 1 with a descriptive message identifying what is missing.

## Troubleshooting

### SmartScreen Warning on Unsigned Builds

**Symptom:** Windows shows "Windows protected your PC" when running the installer.

**Cause:** The installer was built without a code signing certificate.

**Fix:** This is expected for development builds. For production, configure the `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` environment variables with a valid code signing certificate before building.

### MSB8040 / Spectre Library Missing

**Symptom:** Build fails with error MSB8040 referencing Spectre-mitigated libraries.

**Cause:** The Visual Studio C++ build tools are installed but the Spectre-mitigated libraries component is missing.

**Fix:** Open Visual Studio Installer → Modify → Individual Components → search for "Spectre" → install the Spectre-mitigated libraries matching your MSVC toolset version (e.g., "MSVC v143 - VS 2022 C++ x64/x86 Spectre-mitigated libs").

### Prerequisite Detection Failures

**Symptom:** The installer reports it cannot verify prerequisites even though they are installed.

**Possible causes:**

- Insufficient permissions to read registry or scan PATH
- Ollama installed to a non-standard directory not on PATH
- Detection timed out (>30 seconds)

**Fix:** Run the installer as administrator, or install prerequisites manually before running the Ollama+ installer. The installer allows proceeding even when detection fails.

### Update Check Failures

**Symptom:** The application never shows update notifications.

**Possible causes:**

- `UPDATE_SERVER_URL` was not configured at build time (check `app-update.yml` in the install directory)
- Network connectivity issues to the update server
- The update server is not hosting `latest.yml` with current version metadata

**Fix:** Verify the update server URL in the installed `resources/app-update.yml` file. Check that the server hosts a valid `latest.yml` file with version, path, and sha512 fields.

### Build Fails with "Cannot find electron-builder"

**Symptom:** `npm run electron:build` fails immediately.

**Fix:** Run `npm install` to ensure all devDependencies are installed. The preflight script (`npm run preflight:electron:win`) checks for this specifically.

### PowerShell Execution Policy Blocks Scripts

**Symptom:** `npm run preflight:electron:win` fails with a policy error.

**Fix:** Run via `cmd` instead, or temporarily adjust the execution policy:

```powershell
Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process
```
