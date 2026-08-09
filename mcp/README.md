# MCP Servers: Central Gateway + Browser + Terminal + Python Sandbox

This folder contains three local MCP servers plus in-process OpenSCAD and Blender Plate MCP capabilities:

- `mcp/folder-server.mjs`: workspace-rooted folder operations with path guards.
- `mcp/terminal-server.mjs`: persistent punchout terminal sessions (Windows/Linux), with command risk checks.
- `mcp/python-sandbox-server.mjs`: Docker-isolated Python executor for 3D scripts and rendering pipelines.
- `mcp/lib/openscad.mjs`: guarded OpenSCAD compile runtime used by the Electron MCP gateway (`server=openscad`).
- `mcp/lib/blenderPlate.mjs`: guarded Blender Plate runtime used by the Electron MCP gateway (`server=blender_plate`).

The Electron app now routes all in-app MCP operations through a central gateway (`mcp-gateway-call`) in the main process. Terminal, Python, Folder, Browser, OpenSCAD, and Blender Plate operations share one dispatch contract and one status endpoint (`mcp-gateway-status`).

## Blender Plate MCP Runtime

The Blender Plate runtime is exposed through gateway routes:

- `server=blender_plate, action=health`: probe Blender CLI availability/version.
- `server=blender_plate, action=build`: execute Blender Python script and export artifact (`stl`, `obj`, `gltf`, `glb`).

Build input modes:

- Inline Python source (`source`)
- Rooted script path (`sourcePath`) under the selected Folder MCP root (`.py` only)

Safety controls in the current implementation:

- Exactly one input mode required (`source` xor `sourcePath`)
- Root/path guard inherited from Folder MCP root resolver for `sourcePath`
- Basic blocked-pattern validation for unsafe Python modules/functions
- Build timeout + process kill
- Source and artifact byte limits
- Structured error categories (`VALIDATION_ERROR`, `EXEC_NOT_FOUND`, `EXEC_TIMEOUT`, `COMPILE_ERROR`, `ARTIFACT_EMPTY`, `ARTIFACT_TOO_LARGE`)

### Blender Requirement

Blender must be installed on the host machine and callable from PATH (or via `MCP_BLENDER_BIN`).

Set `MCP_BLENDER_PLATE_ENABLED=0` to disable Blender Plate routing at runtime (kill switch).

Examples:

```bash
blender --version
```

Windows PowerShell:

```powershell
$env:MCP_BLENDER_BIN = "C:\Program Files\Blender Foundation\Blender 4.2\blender.exe"
```

### Blender Plate Small-LLM Contract

For reliable tool use with smaller models, keep calls minimal and explicit:

- Prefer `blender_plate_scene` for live workspace operations.
- Use one action per call.
- Use required fields only; avoid optional payload bloat.
- For generation, use `action="build"` with exactly one source mode (`source` xor `sourcePath`).

Canonical examples:

```json
{"tool":"blender_plate_scene","parameters":{"action":"add","kind":"box","size":1}}
```

```json
{"tool":"blender_plate_scene","parameters":{"action":"transform","id":"box-1","position":{"x":1,"y":0,"z":0}}}
```

```json
{"tool":"blender_plate_scene","parameters":{"action":"build","sourcePath":"models/chair.py","format":"glb"}}
```

```json
{"tool":"blender_plate_scene","parameters":{"action":"import_model","sourcePath":"assets/part.glb"}}
```

```json
{"tool":"blender_plate_scene","parameters":{"action":"list"}}
```

Fallback notes:

- If Blender Plate cannot fulfill SCAD-compatible requests, the tool may fall back to OpenSCAD (unless `fallbackToOpenScad=false`).
- Fallback events are surfaced in the app MCP status summary.

## OpenSCAD MCP Runtime

The OpenSCAD runtime is exposed through gateway routes:

- `server=openscad, action=health`: probe OpenSCAD CLI availability/version.
- `server=openscad, action=compile`: compile SCAD source to STL and return structured results.

Compile input modes:

- Inline source text (`source`)
- Rooted file path (`sourcePath`) under the selected Folder MCP root

Folder model discovery now includes `.scad` entries so agents can find OpenSCAD source files.
Direct model import remains mesh-only (`.stl`, `.obj`, `.gltf`, `.glb`); `.scad` must go through `openscad` compile first.

Safety controls in the current implementation:

- Exactly one input mode required (`source` xor `sourcePath`)
- Root/path guard inherited from Folder MCP root resolver for `sourcePath`
- Parameter allowlist (`-Dname=value`) with safe key/value validation
- Compile timeout + process kill
- Source and artifact byte limits
- Structured error categories (`VALIDATION_ERROR`, `EXEC_NOT_FOUND`, `EXEC_TIMEOUT`, `COMPILE_ERROR`, `ARTIFACT_EMPTY`, `ARTIFACT_TOO_LARGE`)

### OpenSCAD Requirement

OpenSCAD must be installed on the host machine and callable from PATH (or via `MCP_OPENSCAD_BIN`).

Set `MCP_OPENSCAD_ENABLED=0` to disable OpenSCAD compile routing at runtime (kill switch).

Examples:

```bash
openscad --version
```

Windows PowerShell:

```powershell
$env:MCP_OPENSCAD_BIN = "C:\Program Files\OpenSCAD\openscad.com"
```

## In-App Browser MCP Runtime

The browser runtime is managed by `mcp/lib/playwrightSessions.mjs` and supports:

- Multi-session browser lifecycle (`create_session`, `list_sessions`, `close_session`)
- Multi-page/tab lifecycle (`create_page`, `list_pages`, `activate_page`, `close_page`)
- Page actions (`goto`, `click`, `type`, `press`, `scroll`, `wait`, `back`, `forward`, `reload`)
- Data actions (`content`, `extract-text`, `evaluate`, `screenshot`)
- Context actions (`set-headers`, `get-cookies`, `set-cookies`)

Policy gates in Electron main process still require explicit user approval for risky browser actions such as external navigation and script evaluation.

## Why Two Servers

- Terminal access and Python execution have different threat models.
- Separation allows stricter controls for Python sandboxing without restricting shell usability.

## Safeguards Included

### Terminal Server

- Session-based terminal access using pseudo terminals (`node-pty`), not one-shot shell commands only.
- Root path guard for requested startup CWD via `MCP_TERMINAL_ROOT`.
- Risky-command pattern blocking by default (`rm -rf`, destructive disk ops, command piping downloaders, etc.).
- Risk override requires explicit flag (`approveRisky=true`) or environment override (`MCP_ALLOW_RISKY_COMMANDS=1`).
- Output and input size limits.
- Idle session eviction (`MCP_TERMINAL_IDLE_TIMEOUT_MS`, default 30 minutes).

### Folder Server

- Rooted file access only; all paths are resolved under `MCP_FILE_ROOT`.
- Supports list/read/write/create/delete/rename without shell execution.
- Rejects path traversal attempts outside the configured root.

### Python Sandbox Server

- Docker isolation with no network.
- CPU/memory/pid limits.
- `--cap-drop ALL`, `no-new-privileges`, read-only root FS, tmpfs for `/tmp`.
- Timeout kill.
- Basic blocked-pattern pre-check for obvious escape primitives (`subprocess`, sockets, ctypes, etc.).
- Artifact capture per run in `.sandbox/python-runs` (configurable by `MCP_PY_SANDBOX_ROOT`).

## Install

```bash
npm install
```

## Run Servers

```bash
npm run mcp:folder
npm run mcp:terminal
npm run mcp:python
```

## Recommended MCP Client Configuration (Example)

Create a local MCP config in your client:

```json
{
  "mcpServers": {
    "folder-rooted": {
      "command": "node",
      "args": ["mcp/folder-server.mjs"],
      "env": {
        "MCP_FILE_ROOT": "."
      }
    },
    "terminal-guarded": {
      "command": "node",
      "args": ["mcp/terminal-server.mjs"],
      "env": {
        "MCP_TERMINAL_ROOT": "."
      }
    },
    "python-sandbox": {
      "command": "node",
      "args": ["mcp/python-sandbox-server.mjs"],
      "env": {
        "MCP_PY_SANDBOX_ROOT": ".sandbox/python-runs",
        "MCP_PY_IMAGE": "python:3.11-slim"
      }
    },
    "playwright-browser": {
      "command": "node",
      "args": ["node_modules/@playwright/mcp/cli.js", "--headless", "--isolated"]
    }
  }
}
```

## Docker Requirement

Python sandbox tools require Docker Desktop (Windows) or Docker Engine (Linux) to be installed and running.

### Build Optional 3D Sandbox Image

```bash
docker build -f mcp/docker/python-3d.Dockerfile -t ollama-plus/python-3d:latest mcp/docker
```

Then run the Python MCP server with:

```bash
set MCP_PY_IMAGE=ollama-plus/python-3d:latest
npm run mcp:python
```

On Linux/macOS shell:

```bash
export MCP_PY_IMAGE=ollama-plus/python-3d:latest
npm run mcp:python
```

For stronger production isolation, see [PRODUCTION_HARDENING.md](docker/PRODUCTION_HARDENING.md).

## 3D Script Notes

The Python sandbox is generic and can run scripts that generate 3D assets (for example `trimesh`, `numpy`, `pillow`) if your selected image includes those packages.
For stronger reproducibility, use a prebuilt image with pinned package versions.
