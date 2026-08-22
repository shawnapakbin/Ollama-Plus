# Contributing to Ollama +

Thanks for helping improve Ollama +.

## License and contribution terms

This project is licensed under PolyForm Noncommercial 1.0.0. By submitting contributions, you agree that your changes are provided under the same license terms.

## Development setup

Prerequisites:

- Node.js 18+
- npm
- Ollama (optional for local model chat)
- Windows build tooling for `node-pty` when packaging Electron builds

Install and run:

```bash
npm install
npm run electron:dev
```

Quality checks:

```bash
npm run lint
npm test
npm run release:check -- --run
```

## Reporting bugs

Use the GitHub Bug report issue form:

- Include exact steps to reproduce.
- Include your OS, Node.js version, Ollama version, and app version or commit.
- Include relevant logs from the app, terminal, or Electron debug output.
- Select the affected subsystem so maintainers can route quickly.

Issue automation:

- New issues are auto-labeled by subsystem, platform, and MCP server hints when present.
- Short bug reports may be marked `needs-info` automatically.
- Label taxonomy is defined in `.github/labels.yml`.

## Security issues

Do not file public issues for vulnerabilities.

Follow the private disclosure process documented in `SECURITY.md`.

## Pull request expectations

- Link a related issue when available.
- Keep changes focused and scoped.
- Add or update tests for behavior changes.
- Update documentation when behavior or workflows change.
- Confirm lint and tests pass locally before requesting review.

## Branch strategy

The repository follows a two-branch baseline:

- `main`: release-only branch.
- `development`: active integration branch.

Expected flow:

1. Create feature branches from `development`.
2. Open PRs into `development` for normal work.
3. Promote tested release candidates from `development` into `main`.
4. For urgent production fixes, patch `main` and back-merge into `development`.

Do not push directly to `main` outside emergency hotfix workflows.

Branch protection setup:

- Apply the standard protection baseline using `scripts/set-branch-protection.ps1`.
- See `docs/branch-protection.md` for dry-run/apply commands and validation steps.

Pull request template:

- Use `.github/PULL_REQUEST_TEMPLATE.md` to provide summary, scope, and validation context.

Issue lifecycle:

- Inactive issues may be auto-marked stale after 30 days and auto-closed 7 days later.
- Priority and active-work labels are exempt from stale auto-close.

## Auto-Session-Naming

The auto-session-naming feature automatically generates descriptive titles for chat sessions using the configured Ollama model. It is opt-in by default (enabled on fresh installs) and controlled via a toggle in the Settings page.

### Configuration

The `autoRenameEnabled` boolean field lives in `chatConfig` within `state.json`:

```json
{
  "chatConfig": {
    "endpoint": "http://127.0.0.1:11434",
    "model": "llama3.2",
    "autoRenameEnabled": true
  }
}
```

- Defaults to `true` when the field is missing, `null`, or a non-boolean value.
- Normalized by `normalizeChatConfig` in `electron/runtime/stateSchema.js`.
- Persisted through the existing `saveChatConfig` IPC bridge method.

### Trigger Flow

The auto-rename runs after a successful chat stream completes:

1. `sendPromptWithStreaming` resolves → fires `autoRenameAfterCompletion(sessionId)` as fire-and-forget (`void`).
2. `autoRenameAfterCompletion` calls `evaluateRenameGuard` to check preconditions.
3. Guard conditions (all must pass):
   - `autoRenameEnabled` is `true` in chat config
   - Session title equals the default (`'Untitled runtime session'`)
   - Messages contain at least one user message and one assistant message
   - Session ID is not already in the in-progress tracking set
4. If all conditions pass: session ID is added to the in-progress set → `renameSessionWithAi` is called → session list and config are updated → lock is released in `finally`.
5. Errors are caught silently and logged via `console.warn`. No retry is attempted.

### Key Files

| File | Responsibility |
|------|----------------|
| `src/services/renameGuard.ts` | `evaluateRenameGuard` function and `DEFAULT_SESSION_TITLE` constant |
| `src/App.tsx` | `autoRenameAfterCompletion`, in-progress ref, settings toggle integration |
| `electron/runtime/stateSchema.js` | `normalizeChatConfig` with `autoRenameEnabled` field handling |

### Working with Auto-Rename

- To disable auto-rename during development, set `autoRenameEnabled: false` in `state.json` or use the Settings toggle.
- The in-progress tracking uses a `useRef<Set<string>>` (not state) to avoid unnecessary re-renders.
- Manual renames change the session title away from the default, which prevents future auto-renames via the guard.

## Blender Plate Contribution Notes

When contributing to 3D workspace behavior:

- Treat `blender_plate_scene` as the primary 3D tool contract.
- Keep tool actions narrow and deterministic (one action per call, no action arrays).
- Preserve fallback compatibility with `openscad_generate` for SCAD-oriented flows.
- Keep scene object provenance (`engineKind`) intact when adding or mutating objects.

Minimum validation for Blender Plate changes:

```bash
npm run test -- tests/blenderPlate.test.ts tests/blenderPlateTool.test.ts tests/blenderPlateSceneTool.test.ts tests/openscadTool.test.ts
npm run build
npm run lint
```
