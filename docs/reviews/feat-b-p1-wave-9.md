---
reviewer: "opus-5.5"
effort: "medium"
reviewedSha: "2b56aa3bc0ef2ec7e030847a3652422a0c898932"
verdict: "approve"
---

# Review: feat/b-p1-wave-9 (gate tier)

Date: 09-28-26

## Scope

Branch feat/b-p1-wave-9, range 72d07b53a8dd5d1abdb82b84a824df1f2824024a..2b56aa3bc0ef2ec7e030847a3652422a0c898932. Gate files: .github/workflows/ci.yml (image job step 12), scripts/ci/ci-workflow.test.ts, scripts/ops/smoke.test.ts. The wave delivers Track B Task 27 (#167): the M0 Playwright suite (harness, login, keyboard, themes, heartbeat; axe, CSP) run in CI step 12 as the seeded smoke user against the boot-smoke container, plus smoke.sh argv-hygiene and deploy-host exec-path tests (B8 carry-forward Minors).

## Findings summary

Critical 0, Important 0, Minor 3. Rulings kept as stands: checker ruling 09-28-26 (Track B edits ci.yml step 12; derive, mask before export, no argv, no echo, full suite); controller ruling (E2E_BASE_URL is PUBLIC_ORIGIN http://localhost:3000, boot-smoke.sh unchanged); CI seed secret mode 644 by design.

## Cross-cutting checks

1. Derivation parity (spec 8.5): packages/api/src/seed/password.ts and secrets.ts trim the secret and lowercase the trimmed email; step 12 matches.
2. Password persistence outside the masked log: apps/web/playwright.config.ts has no webServer; traces and the html report stay on the runner and ci.yml uploads no Playwright artifact.
3. Base URL: every boot-smoke.sh run sets PUBLIC_ORIGIN=http://localhost:3000, and the test reads it from boot-smoke.sh.

## Answers to the controller's questions

1. The password is never on argv, in GITHUB_ENV, the step summary or an echoed failure; the mask is registered before first use; the derivation equals derivePassword.
2. The step 12 tests fail on an echoed password, mask after export, a spec filter and a non-PUBLIC_ORIGIN base URL; the bash execution is portable (Linux, Git Bash).
3. The argv wrapper sees every node and curl smoke.sh starts; the fake docker fails on any change to the exec shape or secret path.

## Remaining Minors

- scripts/ci/ci-workflow.test.ts:323 and scripts/ops/smoke.test.ts:108 compare to a hand-copied HMAC; import derivePassword instead.
- scripts/ci/ci-workflow.test.ts:292-303 no-echo guard misses printf, set -x or a printf to GITHUB_ENV.
- scripts/ops/smoke.test.ts:156 split on spaces breaks under a spaced repo path.
