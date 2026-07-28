# Branch Protection Runbook

This repository uses two long-lived branches:

- `development` (integration)
- `main` (release-only)

Both branches should require the same minimum controls.

## Required Controls

- Pull request required before merge
- At least 1 approving review
- Dismiss stale approvals on new commits
- Require conversation resolution before merge
- Enforce protections for administrators
- Require status check: `release-readiness`
- No force pushes
- No branch deletion

## Apply With Script

From repository root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/set-branch-protection.ps1
```

Dry-run is default and does not modify GitHub.

To apply changes:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/set-branch-protection.ps1 -Apply
```

Optional explicit repository target:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/set-branch-protection.ps1 -Owner <owner> -Repo <repo> -Apply
```

## Preconditions

- `gh` CLI installed and authenticated (`gh auth status`)
- User has admin rights for repository settings
- Workflow `Quality Gates` is present and successful on target branches

## Validation

- Open repository settings -> Branches
- Confirm rules exist for `development` and `main`
- Open a PR and verify merge is blocked until `release-readiness` passes
