#!/usr/bin/env bash
# gh-setup-repo.sh: ruleset on main and security settings for the repository
# (spec 9.1 ruleset, 9.4 security updates, ADR-0008; Task 28, #29, SEC-020).
#
# What it sets
#   Ruleset "main" on the default branch: pull request required (squash merge
#   only), required status checks `ci` (the ADR-0008 aggregate) and
#   `sensitive-review`, linear history, no force push, no deletion, and an empty
#   bypass list. Vulnerability alerts and Dependabot security updates on.
#   Break glass (ADR-0008): only the repository admin switches the ruleset off,
#   for one fix PR, after opening a `break-glass` issue; same day back on.
#
# Idempotent
#   Updates the ruleset named "main" when it exists, creates it otherwise.
#   Enabling alerts and security updates is a no-op when already on.
#
# Usage (bash on Linux, Git Bash on Windows)
#   bash scripts/ops/gh-setup-repo.sh [OWNER/REPO]            # dry run: reads only, prints the plan
#   bash scripts/ops/gh-setup-repo.sh --apply [OWNER/REPO]    # writes
#   bash scripts/ops/gh-setup-repo.sh --as <login> ...        # gh account (default BirchDesignLab)
#   Without OWNER/REPO: the repo of the current directory.
#
# Requires
#   gh CLI with the acting account in its keyring (`gh auth status` lists it)
#   and admin rights on the repo. The account's token goes to each gh call
#   through GH_TOKEN; the script never switches the active gh account and never
#   prints a token.

set -euo pipefail

usage() {
  echo "usage: $0 [--apply] [--as <login>] [OWNER/REPO]" >&2
  exit 2
}

apply=0
login="BirchDesignLab"
repo=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --apply) apply=1 ;;
    --as)
      [ "$#" -ge 2 ] || usage
      login="$2"
      shift
      ;;
    -*) usage ;;
    *)
      [ -z "$repo" ] || usage
      [[ "$1" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || usage
      repo="$1"
      ;;
  esac
  shift
done

if ! command -v gh >/dev/null 2>&1; then
  echo "error: gh CLI not found on PATH" >&2
  exit 1
fi

token="$(gh auth token -u "$login")" || {
  echo "error: no gh token for $login; run 'gh auth login' for that account" >&2
  exit 1
}
export GH_TOKEN="$token"
actual="$(gh api user --jq .login)"
if [ "$actual" != "$login" ]; then
  echo "error: the token acts as $actual, not $login; refusing to continue" >&2
  exit 1
fi

if [ -z "$repo" ]; then
  repo="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
fi
echo "repo: $repo (as $login)"
[ "$apply" -eq 1 ] || echo "dry run: reads only; pass --apply to write"

ruleset="$(cat <<'JSON'
{
  "name": "main",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "bypass_actors": [],
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "required_linear_history" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false,
        "allowed_merge_methods": ["squash"]
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": false,
        "required_status_checks": [{ "context": "ci" }, { "context": "sensitive-review" }]
      }
    }
  ]
}
JSON
)"

existing="$(gh api "repos/$repo/rulesets" --jq '.[] | select(.name == "main") | .id')"
if [ "$apply" -eq 0 ]; then
  if [ -n "$existing" ]; then
    echo "would update ruleset main (id $existing) to:"
  else
    echo "would create ruleset main:"
  fi
  printf '%s\n' "$ruleset"
  echo "would enable vulnerability alerts"
  echo "would enable Dependabot security updates"
  exit 0
fi

if [ -n "$existing" ]; then
  printf '%s' "$ruleset" | gh api -X PUT "repos/$repo/rulesets/$existing" --input - >/dev/null
  echo "ruleset: main (updated, id $existing)"
else
  printf '%s' "$ruleset" | gh api -X POST "repos/$repo/rulesets" --input - >/dev/null
  echo "ruleset: main (created)"
fi
gh api -X PUT "repos/$repo/vulnerability-alerts" >/dev/null
echo "vulnerability alerts: on"
gh api -X PUT "repos/$repo/automated-security-fixes" >/dev/null
echo "security updates: on"
echo "done"
