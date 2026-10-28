---
reviewer: "opus-5.5"
effort: "medium"
reviewedSha: "e4aa37814260df1236c0878d274ca856ae41bd01"
verdict: "approve"
---

# Gate review: fix/node-24.22.1 (10-27-26)

## Scope
Branch fix/node-24.22.1, range 641427039a6c12212db151c1142712426f30ebd5..e4aa37814260df1236c0878d274ca856ae41bd01, gate slice: package.json, pnpm-workspace.yaml, scripts/ci/node-pins.test.ts, scripts/ci/ci-workflow.test.ts, .github/workflows/ci.yml. The wave bumps Node to 24.22.1 for Node2Shell (CVE-2026-111497) across .nvmrc, engines and both Dockerfile stages with a pin test; ignores GHSA-mrhx-c7xc-m3w5 and GHSA-gcqx-w48m-w2h4 (Expo tooling only, #846); runs dependency review on public repos only while the repo is private, with pnpm audit --prod and the lockfile checks unconditional.

## Findings summary
Critical 0, important 0, minor 1. Round 3 G-M1 (ci.yml comment and ADR-0007 on the dev-dependency gap) is fixed at e4aa378. Developer decisions 10-27-26 (private repo, the two ignored GHSAs) kept as stand.

## Cross-cutting checks
- Pin drift: .nvmrc 24.22.1 and both deploy/Dockerfile FROM lines match the digest the test expects.
- Hard-coded Node in workflows: every setup-node in .github/workflows uses node-version-file .nvmrc.

## Answers
No controller questions.

## Remaining Minors
- .github/workflows/ci.yml:106: comment says the audit fails on any runtime-dependency advisory; strictly any advisory not in auditConfig.ignoreGhsas.
