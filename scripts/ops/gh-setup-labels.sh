#!/usr/bin/env bash
# gh-setup-labels.sh: create the GitHub labels and milestones the implementation
# master plan uses (docs/superpowers/plans/2026-09-25-implementation-master-plan.md 5.2).
#
# Purpose
#   The backlog is GitHub Issues. Every issue carries one track label, one phase
#   label and one milestone; STATUS.md cells link to issue filters built from them.
#   This script makes those labels and milestones exist, with fixed colours and
#   descriptions, on a repository.
#
# Idempotent
#   Labels: `gh label create --force` creates or updates (colour, description).
#   Milestones: created only if no milestone (open or closed) has that title.
#   Safe to run again after editing this file.
#
# Usage (bash on Linux, Git Bash on Windows)
#   bash scripts/ops/gh-setup-labels.sh                 # repo of the current directory
#   bash scripts/ops/gh-setup-labels.sh OWNER/REPO      # explicit repo
#
# Requires
#   gh CLI, authenticated (`gh auth login`) with rights to manage issues on the repo.
#   No secrets are read or written by this script.

set -euo pipefail

if [ "$#" -gt 1 ]; then
  echo "usage: $0 [OWNER/REPO]" >&2
  exit 2
fi
if [ "$#" -eq 1 ]; then
  export GH_REPO="$1"
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "error: gh CLI not found on PATH" >&2
  exit 1
fi
if ! gh auth status >/dev/null 2>&1; then
  echo "error: gh is not authenticated; run 'gh auth login'" >&2
  exit 1
fi

repo="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
echo "repo: $repo"

# name|colour (hex, no #)|description (max 100 chars)
labels=(
  "track-a|1f6feb|Track A platform (Linux): packages/api, deploy, .github, scripts/ops, mock data"
  "track-b|8250df|Track B web (Windows): apps/web, host-simulator, web-ui, tokens, client, e2e"
  "core|0e8a16|Core: packages/core, config sites and locales, contract files; either track"
  "mobile|bf3989|Track D mobile (from M4): apps/mobile (Expo), packages/rn-ui, Maestro"
  "p0|c5def5|Phase P0 contracts"
  "p1|9ec5f0|Phase P1"
  "p2|6fa8e6|Phase P2"
  "p3|3f8bd9|Phase P3"
  "sensitive|b60205|Touches a CLAUDE.md sensitive path; PR needs the sensitive-review artifact"
  "contract|fbca04|Contract-first PR: core schema, OpenAPI, WS or config schema only"
  "api-breaking|d93f0b|Breaking OpenAPI change; lets oasdiff pass; listed in release notes"
)

for entry in "${labels[@]}"; do
  IFS='|' read -r name colour description <<<"$entry"
  gh label create "$name" --color "$colour" --description "$description" --force >/dev/null
  echo "label: $name"
done

# title|description
milestones=(
  "M0 Skeleton|Grid 12.2 P0 and P1. Exit: login live; heartbeat socket alive 10 min through the tunnel (spec 12.7)."
  "M1 Forms and terminal|Grid 12.2 P2 and P3. Exit: A1 to A5 green; keyboard-only Playwright; live smoke (spec 12.7)."
  "M2 Results and audit|Grid 12.3. Exit: A6 to A9 green; security tests; NVDA + Chrome (spec 12.7)."
  "M3 Workflow and compliance|Grid 12.4. Exit: B1 to B5, B7 green; flags on; NVDA + Chrome (spec 12.7)."
  "M4 Mobile and host integration|Grid 12.5. Exit: C1, C2 green; VoiceOver + TalkBack; daylight check (spec 12.7)."
)

existing="$(gh api -X GET 'repos/{owner}/{repo}/milestones' -f state=all --paginate --jq '.[].title' | tr -d '\r')"

for entry in "${milestones[@]}"; do
  IFS='|' read -r title description <<<"$entry"
  if printf '%s\n' "$existing" | grep -Fxq -- "$title"; then
    echo "milestone: $title (exists, skipped)"
  else
    gh api -X POST 'repos/{owner}/{repo}/milestones' \
      -f title="$title" -f description="$description" -f state=open >/dev/null
    echo "milestone: $title (created)"
  fi
done

echo "done"
