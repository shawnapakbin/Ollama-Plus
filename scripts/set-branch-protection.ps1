<#
  (Developed by Shawna Pakbin | revDigit Studio | revDigit.link)
  v5.0.2
#>
param(
  [Parameter(Mandatory = $false)]
  [string]$Owner,

  [Parameter(Mandatory = $false)]
  [string]$Repo,

  [Parameter(Mandatory = $false)]
  [switch]$Apply
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Require-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command '$Name' is not available in PATH."
  }
}

function Get-RepoFromGitRemote {
  $url = git remote get-url origin
  if (-not $url) {
    throw 'Unable to resolve origin remote URL.'
  }

  # Supports HTTPS and SSH remotes.
  if ($url -match 'github.com[:/](?<owner>[^/]+)/(?<repo>[^/.]+)(?:\.git)?$') {
    return @{ Owner = $Matches.owner; Repo = $Matches.repo }
  }

  throw "Unsupported remote URL format: $url"
}

function Build-ProtectionPayload {
  param([string]$Branch)

  $requiredContexts = @('release-readiness')

  return @{
    required_status_checks = @{
      strict = $true
      contexts = $requiredContexts
    }
    enforce_admins = $true
    required_pull_request_reviews = @{
      dismiss_stale_reviews = $true
      require_code_owner_reviews = $false
      required_approving_review_count = 1
    }
    restrictions = $null
    required_linear_history = $false
    allow_force_pushes = $false
    allow_deletions = $false
    required_conversation_resolution = $true
    lock_branch = $false
  }
}

function Get-GitHubToken {
  $token = gh auth token
  if (-not $token) {
    throw 'Unable to read GitHub token from gh auth token.'
  }
  return $token.Trim()
}

Require-Command 'git'
Require-Command 'gh'

if (-not $Owner -or -not $Repo) {
  $resolved = Get-RepoFromGitRemote
  if (-not $Owner) { $Owner = $resolved.Owner }
  if (-not $Repo) { $Repo = $resolved.Repo }
}

$repoSlug = "$Owner/$Repo"
$branches = @('development', 'main')
$mode = if ($Apply.IsPresent) { 'APPLY' } else { 'DRY-RUN' }
$apiBase = 'https://api.github.com'

Write-Host "Target repository: $repoSlug"
Write-Host "Mode: $mode"

$token = $null
if ($Apply.IsPresent) {
  $token = Get-GitHubToken
}

foreach ($branch in $branches) {
  $payload = Build-ProtectionPayload -Branch $branch | ConvertTo-Json -Depth 8
  Write-Host "`nBranch: $branch"
  Write-Host 'Required checks: release-readiness'
  Write-Host 'PR reviews: 1 approval, dismiss stale, resolve conversations'
  Write-Host 'Admins enforced: true'

  if ($Apply.IsPresent) {
    $headers = @{
      Authorization = "Bearer $token"
      Accept = 'application/vnd.github+json'
      'X-GitHub-Api-Version' = '2022-11-28'
      'User-Agent' = 'ollama-plus-branch-protection-script'
    }
    $uri = "$apiBase/repos/$repoSlug/branches/$branch/protection"
    Invoke-RestMethod -Method Put -Uri $uri -Headers $headers -Body $payload -ContentType 'application/json' | Out-Null
    Write-Host "Applied protection to $branch"
  }
}

if (-not $Apply.IsPresent) {
  Write-Host "`nDry-run complete. Re-run with -Apply to execute changes."
}
