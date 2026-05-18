# Ollama +

Ollama + is a native desktop workspace for local LLM workflows with agent tooling, structured task tracking, and an evolving 3D workflow foundation.

Built with Electron, React, Vite, and TypeScript.

## What It Does

- Runs local model chat through Ollama.
- Provides a customizable workspace shell with primary and secondary panels.
- Tracks model-driven work as runtime tasks in a live Task Board.
- Supports built-in tools (shell, browser automation, wiki, search, time, engineering calculator).
- Enforces policy checks for risky tool actions.
- Uses in-app markdown forms for user interactions that require decisions or guided input.

## Workspace Panels

- Chat
- Terminals
- Knowledge Wiki
- Task Board
- 3D Workspace (foundation panel for upcoming real-time viewer and modifier pipeline)

Users can save and switch workspace presets with panel layouts.

## Interaction Model

Ollama + uses two reusable in-app form patterns:

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
- Chat orchestration and tool loop: `src/components/Chat.tsx`
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
npm run preview
npm run electron:dev
npm run electron:build
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

You may see a Vite warning for large JS chunk size in production builds. This is currently non-blocking and expected at this stage.

## Current Status

Implemented:

- Workspace shell with saved layout presets.
- IPC service abstraction in renderer.
- Runtime task tracking and Task Board updates.
- In-app markdown decision and input forms.
- Policy gating with decision-token propagation for core risky actions.

In progress:

- Expanded 3D preview/modifier pipeline.
- Deeper agent runtime capabilities and additional guarded tool adapters.
