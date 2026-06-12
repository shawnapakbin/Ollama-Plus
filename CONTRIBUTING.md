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

Pull request template:

- Use `.github/PULL_REQUEST_TEMPLATE.md` to provide summary, scope, and validation context.

Issue lifecycle:

- Inactive issues may be auto-marked stale after 30 days and auto-closed 7 days later.
- Priority and active-work labels are exempt from stale auto-close.

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
