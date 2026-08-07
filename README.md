# Ollama +

Ollama + is a native desktop workspace for local LLM workflows with agent tooling, structured task tracking, and an evolving 3D workflow foundation.

Built with Electron, React, Vite, and TypeScript.

## Community and Support

- Report bugs with the GitHub Bug report issue form.
- Request features with the GitHub Feature request issue form.
- Read contribution workflow in `CONTRIBUTING.md`.
- Report vulnerabilities privately using `SECURITY.md`.
- Pull requests use `.github/PULL_REQUEST_TEMPLATE.md` for consistency.
- Inactive issues are automatically marked stale and later closed unless updated.

Maintainers can sync repository labels from `.github/labels.yml` using GitHub CLI and `yq`:

```bash
yq -r '.[] | [.name, .color, .description] | @tsv' .github/labels.yml | while IFS=$'\t' read -r name color description; do
	gh label create "$name" --color "$color" --description "$description" --force
done
```

## What It Does

- Runs local model chat through Ollama.
- Provides a customizable workspace shell with primary and secondary panels.
- Tracks model-driven work as runtime tasks in a live Task Board.
- Supports built-in tools (shell, browser automation, wiki, search, time, engineering calculator).
- Enforces policy checks for risky tool actions.
- Uses in-app markdown forms for user interactions that require decisions or guided input.
- Includes optional local MCP servers for guarded terminal sessions and Docker-isolated Python execution.

## MCP Servers (Local)

The repository now includes two MCP servers under `mcp/`:

- `mcp/terminal-server.mjs` for persistent terminal (punchout) sessions with guardrails.
- `mcp/python-sandbox-server.mjs` for isolated Python execution suitable for 3D scripting pipelines.

See `mcp/README.md` for setup and environment controls.

## Workspace Panels

- Chat
- Terminals
- Knowledge Wiki
- Task Board
- 3D Workspace (foundation panel for upcoming real-time viewer and modifier pipeline)

Users can save and switch workspace presets with panel layouts.

## Interaction Model

Ollama + uses two reusable in-app form patterns:

The migrated chat shell is the default and only chat experience for this workspace, wired to the existing Ollama backend.

- Markdown Decision Form: clickable multi-option decisions (Allow/Deny, Confirm/Cancel).
- Markdown Input Form: guided text input flows (for example naming presets or files).

Native prompt/confirm dialogs are intentionally avoided in the active interaction paths.

## Permission and Policy Flow

Risky actions are gated with explicit user decisions rendered in clickable markdown forms.

Current guarded paths include:

- Risky shell command execution.
- External browser navigation.
- Browser script evaluation (`evaluate`).

Additional protections include:

- Input validation.
- URL safety checks.
- Path sandboxing for wiki files.
- Rate limiting on key IPC actions.
- Sanitized error messaging.

## Decision Tokens and LLM Context

For policy-gated tool calls, the system emits a decision token and selected option.

That metadata is propagated back into tool results so the model can reason over:

- what permission step occurred,
- what the user selected,
- and the resulting execution state.

This improves reliability for smaller routing/execution models that need explicit state continuity.

## Task Runtime

The Task Board is backed by a shared runtime store with persisted task entries and logs.

Task states:

- queued
- running
- blocked
- done
- failed

Chat-driven generation and tool execution update task state and logs in real time.

## Tech Stack

- Electron
- React 19
- Vite
- TypeScript
- Playwright Core
- xterm
- react-markdown + remark-gfm
- mathjs

## Architecture Overview

```text
Renderer (React/Vite)
	|
	|  src/services/ipcService.ts
	v
Preload Bridge (contextIsolation)
	|
	|  electron/preload.cjs
	v
Main Process (policy + tool execution)
	|
	|  electron/main.js
	v
External Systems
	- Ollama HTTP API
	- Local shell / Python REPL
	- Playwright browser automation
	- Local filesystem (wiki/chats)
```

Core renderer modules:

- Workspace shell and overlays: `src/App.tsx`
- Chat shell (layout, input, steer queue): `src/components/Chat.tsx`
- Chat pipeline (recursive tool loop, streaming, router): `src/components/Chat/hooks/useChatPipeline.ts`
- Chat hooks (session, stream, processor status, steer queue): `src/components/Chat/hooks/`
- Pure pipeline helpers (payload builder, tool-call extraction, think-block parser, metrics): `src/components/Chat/pipeline/`
- Tool registry (schemas + dispatch): `src/components/Chat/tools/registry.ts`
- Message rendering (memoized rows + markdown): `src/components/Chat/MessageList.tsx`, `MessageRow.tsx`, `MessageRenderer.tsx`
- Task runtime store: `src/services/taskRuntime.ts`
- Task Board UI: `src/components/TaskBoard.tsx`
- Decision/Input markdown forms: `src/components/MarkdownDecisionForm.tsx`, `src/components/MarkdownInputForm.tsx`

## Permission Decision Flow

```text
Tool request from model
	-> main process policy check
	-> decision request emitted to renderer
	-> clickable markdown decision form shown to user
	-> selected option sent back to main process
	-> action allowed/denied
	-> decision token + selection propagated to tool result
	-> model receives result with explicit approval context
```

## Scripts

```bash
npm run dev
npm run build
npm run lint
npm test
npm run preview
npm run electron:dev
npm run electron:debug
npm run electron:build
npm run mcp:terminal
npm run mcp:python
```

## Debugging Inside VS Code (Edge Tools)

Use the `electron:debug` script to launch the app with Chromium's remote
debugging port exposed so the **Microsoft Edge Tools for VS Code** extension can
attach and show the running renderer (Elements, Console, Network, screencast)
as a docked tab inside VS Code.

1. Install the *Microsoft Edge Tools for VS Code* extension.
2. From the repo root run:
   ```bash
   npm run electron:debug
   ```
   This starts Vite on port 5173 and launches Electron with
   `--remote-debugging-port=9222`. You should see
   `DevTools listening on ws://127.0.0.1:9222/...` in the terminal.
3. Open the **Edge Tools** view in the VS Code activity bar and click
   **Attach to a target...** (or the plug icon). Pick the entry for
   `http://localhost:5173/` — the Ollama + renderer.
4. The DevTools panel and a live screencast of the app dock inside VS Code.
   The actual Electron OS window still floats separately (VS Code cannot host
   another Electron process as a panel); interact with the app through either
   window.

If the target picker is empty, open the Edge Tools settings gear and confirm
the host is `localhost` and the port is `9222`.

## Testing

Unit tests run under Vitest and cover the pure modules behind the chat pipeline:
`buildPayload`, `extractToolCalls`, `thinkBlockParser`, `formatMetrics`, `markdownSafety`,
and the main-process `validation` helpers.

```bash
npm test
```

## Development

Install dependencies:

```bash
npm install
```

Run desktop app in development:

```bash
npm run electron:dev
```

### Release Profile Flags

The production-focused chat profile can be controlled with Vite env vars:

- `VITE_RELEASE_CORE_CHAT=true|false`
	- Default behavior: `true` in production builds, `false` in dev builds.
	- When `true`, advanced tool execution is disabled and chat runs in core mode.
- `VITE_IMAGE_ATTACHMENT_MODE=both|base64|path`
	- `both` (default): include both base64 payloads and local file path references for image attachments.
	- `base64`: send only base64 image payloads.
	- `path`: send only local file path references (when available from Electron drag-drop).

Image transport runtime behavior:

- The app probes `/api/show` per host/model (cached) to infer vision capability.
- For vision-capable models, transport selection prefers base64 payloads unless `path` is explicitly preferred and available.
- For non-vision models, the app falls back to path references when present; otherwise image payloads are omitted.
- Chat task logs include the chosen image transport mode and probe source for easier troubleshooting.

## Build

Build renderer bundle:

```bash
npm run build
```

Build portable Windows app:

```bash
npm run electron:build
```

## Windows Notes

If PowerShell execution policy blocks npm scripts, run via `cmd` or use a policy-compatible shell session.

Electron packaging (`npm run electron:build`) requires native rebuild of `node-pty`. Ensure Visual Studio C++ build tools include Spectre-mitigated libraries for the active MSVC toolset, otherwise packaging can fail with `MSB8040`.

You may see a Vite warning for large JS chunk size in production builds. This is currently non-blocking and expected at this stage.

## Current Status

Implemented:

- Workspace shell with saved layout presets.
- IPC service abstraction in renderer.
- Runtime task tracking and Task Board updates.
- In-app markdown decision and input forms.
- Policy gating with decision-token propagation for core risky actions.
- Modular chat surface: thin shell + dedicated hooks for session, streaming, processor status, steer queue, and the recursive tool pipeline; pure pipeline helpers and a tool registry covered by Vitest unit tests.

In progress:

- Expanded 3D preview/modifier pipeline.
- Deeper agent runtime capabilities and additional guarded tool adapters.
