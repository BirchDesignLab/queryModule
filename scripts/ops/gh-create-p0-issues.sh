#!/usr/bin/env bash
# gh-create-p0-issues.sh: create one GitHub issue per task of the M0 P0 contracts plan
# (docs/superpowers/plans/2026-09-25-p0-contracts.md, "Before Task 1" Step 2;
# master plan 5.2 items 4 to 6).
#
# Purpose
#   The backlog is GitHub Issues, one per task. Every issue gets label p0, milestone
#   "M0 Skeleton", its track or core label, and contract / sensitive where the plan's
#   table says so. The body carries the plan reference, the task's requirement and
#   story IDs verbatim, the tests to write first, and whether the task is sensitive.
#
# Idempotent
#   An issue is created only if no issue (open or closed) already has that exact
#   title. Safe to run again; existing issues are reported as skipped, never edited.
#
# Usage (bash on Linux, Git Bash on Windows; on Windows `bash` in PowerShell may be WSL)
#   bash scripts/ops/gh-create-p0-issues.sh                 # repo of the current directory
#   bash scripts/ops/gh-create-p0-issues.sh OWNER/REPO      # explicit repo
#
# Requires
#   gh CLI, authenticated, with rights to create issues on the repo, and the labels and
#   milestones from scripts/ops/gh-setup-labels.sh. No secrets are read or written.

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

plan="docs/superpowers/plans/2026-09-25-p0-contracts.md"
milestone="M0 Skeleton"

# task|title|labels (comma separated, p0 added below)|IDs (plan task **IDs:** line)|tests first
tasks=(
  "1|Workspace root skeleton (none)|track-a|none (scaffolding)|none (scaffolding); verified by pnpm install, pnpm lint, pnpm typecheck"
  "2|Core package and version constants (spec 4.7)|core,contract|none (scaffolding)|packages/core/src/contracts/version.test.ts"
  "3|ValidationError and ApiError contracts (NFR-001)|core,contract|NFR-001, FR-055|packages/core/src/contracts/errors.test.ts"
  "4|Source status and query audit catalogue (SEC-010, SEC-011, SEC-012, SEC-013)|core,contract,sensitive|SEC-010, SEC-011, SEC-012, SEC-013, FR-042, FR-043, NFR-004; story A9 (schema only; the A9 test is M2)|packages/core/src/contracts/audit.test.ts"
  "5|WebSocket message schemas (FR-043, SEC-014, NFR-003)|core,contract,sensitive|FR-043, FR-065, NFR-003, NFR-004, SEC-014|packages/core/src/contracts/ws.test.ts"
  "6|Feature and shortcut catalogues (FR-006, FR-007, FR-053)|core,contract|FR-006, FR-007, FR-053, FR-056, BR-001|packages/core/src/config/shortcuts.test.ts"
  "7|SiteConfig schema v1: fields, conditions, query types (BR-001, FR-032)|core,contract|BR-001, FR-002, FR-003, FR-004, FR-008, FR-011, FR-032; stories A1, A2, B7|packages/core/src/config/schema-fields.test.ts"
  "8|SiteConfig schema v1: site level (BR-001, FR-051, UX-011)|core,contract|BR-001, FR-007, FR-031, FR-051, FR-052, FR-060, NFR-001, UX-011, SEC-005 (auth block shape), SEC-004 (delegation block shape)|packages/core/src/config/schema.test.ts"
  "9|ClientSiteConfig allowlist (BR-001)|core,contract|BR-001, SEC-006|packages/core/src/config/client-config.test.ts"
  "10|Overlay merge (BR-001, FR-008, FR-031)|core,contract|BR-001, FR-008, FR-031|packages/core/src/config/merge.test.ts"
  "11|migrateConfig (BR-001, BR-004)|core,contract|BR-001, BR-004|packages/core/src/config/migrate.test.ts"
  "12|validateSiteConfig: keys, references, labels (BR-001, NFR-001)|core,contract|BR-001, FR-004, FR-007, FR-012, NFR-001, UX-011|packages/core/src/config/validate.test.ts"
  "13|validateSiteConfig: fields, commands, terminal, shortcuts, limits (FR-051, FR-052)|core,contract|BR-001, FR-012, FR-031, FR-032, FR-042, FR-051, FR-052, FR-053, FR-055, UX-011|packages/core/src/config/validate.test.ts (append)"
  "14|Mock file schema (FR-044, SEC-002)|core,contract|FR-043, FR-044, SEC-002; stories B1, B2 (scenario shape)|packages/core/src/contracts/mock-file.test.ts"
  "15|Route contracts skeleton (BR-007)|core,contract|BR-007, NFR-001|packages/core/src/contracts/routes.test.ts"
  "16|Shipped default and example-ok sites, locales, mocks (FR-008, FR-020, FR-030)|core|BR-001, FR-004, FR-008, FR-010, FR-020, FR-030, FR-031, FR-051, NFR-001; stories A1, A2, A4, B1, B2, B7 (config and scenarios)|packages/config/src/shipped.test.ts"
  "17|Contract generators and drift check (BR-007)|track-a,sensitive|BR-007|scripts/ci/openapi.test.ts, packages/api/test/openapi.test.ts"
  "18|config:validate and config:migrate (BR-001, BR-004)|track-a,sensitive|BR-001, BR-004, FR-044|scripts/ci/config-files.test.ts"
  "19|Licence check (BR-006)|track-a,sensitive|BR-006|scripts/ci/licences.test.ts"
  "20|Story-tag gate and stories.json (A1 to A5)|track-a,sensitive|stories A1, A2, A3, A4, A5 (rows only; tests land in M1)|scripts/ci/story-tags.test.ts"
  "21|Sensitive paths and sensitive-review check (SEC-020)|track-a,sensitive|SEC-020 (configuration management control area)|scripts/ci/sensitive-review.test.ts"
  "22|ci.yml and Dependabot (BR-006, BR-007)|track-a,sensitive|BR-006, BR-007, SEC-020|scripts/ci/changed-paths.test.ts"
  "23|Tokens skeleton (UX-002, UX-011)|track-b,sensitive|UX-002, UX-011, BR-001|packages/tokens/src/tokens.test.ts"
  "24|Client platform and web-ui skeleton (FR-005)|track-b|FR-005 (required indicator primitive), NFR-003, SEC-006|packages/client/src/testing/fake-platform.test.ts, packages/web-ui/src/visually-hidden.test.tsx"
  "25|Web shell scaffold (UX-001)|track-b|UX-001, UX-002, UX-011, NFR-001|apps/web/src/shell.test.tsx"
  "26|Mobile placeholder and CI steps 8 and 9 (none)|track-a,sensitive|none (scaffolding)|none (scaffolding); verified by expo export and the CI steps"
  "27|Node 24 compatibility check (ADR-0001)|track-a|none (scaffolding); ADR-0001|packages/api/test/runtime/libsql-node24.test.ts"
  "28|Ruleset on main and security updates (SEC-020)|track-a,sensitive|SEC-020|none; verified by gh api reads of the ruleset and security settings"
)

existing="$(gh issue list --state all --limit 1000 --json title --jq '.[].title' | tr -d '\r')"

for entry in "${tasks[@]}"; do
  IFS='|' read -r task title labels ids tests <<<"$entry"
  if printf '%s\n' "$existing" | grep -Fxq -- "$title"; then
    echo "task $task: exists, skipped"
    continue
  fi
  sensitive="no"
  case ",$labels," in *",sensitive,"*) sensitive="yes" ;; esac
  body="$(printf 'Plan: %s Task %s.\nIDs: %s\nTests first: %s\nBlocked by: none (P0 is one session, tasks run in order).\nSensitive: %s' \
    "$plan" "$task" "$ids" "$tests" "$sensitive")"
  label_args=(--label p0)
  IFS=',' read -r -a label_list <<<"$labels"
  for l in "${label_list[@]}"; do
    label_args+=(--label "$l")
  done
  url="$(gh issue create --title "$title" --milestone "$milestone" "${label_args[@]}" --body "$body")"
  echo "task $task: $url"
done

echo "done"
