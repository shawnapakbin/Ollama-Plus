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
