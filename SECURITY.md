# Security Policy

## Supported versions

Security fixes are prioritized for the latest development branch and latest published release.

## Reporting a vulnerability

Please do not report vulnerabilities in public GitHub issues.

Preferred path:

1. Open a private GitHub Security Advisory draft for this repository.
2. Include affected version or commit, impact, and reproduction details.
3. Include whether exploitation requires local user interaction.

If private advisories are unavailable, contact the maintainers through repository owner channels and reference this policy.

## Response targets

- Initial acknowledgement: within 5 business days
- Triage and severity assessment: within 10 business days
- Mitigation plan or fix timeline: communicated after triage

## Disclosure

Please allow time for investigation and patching before public disclosure.

When a fix is released, a summary will be included in release notes.

## Scope notes

This desktop app can execute guarded tool actions and optional local MCP servers.

When reporting, specify whether the issue affects:

- policy-gated tool execution
- MCP server boundaries
- renderer and main process IPC boundaries
- local filesystem handling
