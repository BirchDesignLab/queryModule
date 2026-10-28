---
reviewer: "opus-5.5"
effort: "medium"
reviewedSha: "e85209332997706bfdfbb0e9cb68aaab99b61b49"
verdict: "approve"
---

# Gate review: fix/node-24.22.1 (10-27-26)

## Scope
Branch fix/node-24.22.1, range 641427039a6c12212db151c1142712426f30ebd5..e85209332997706bfdfbb0e9cb68aaab99b61b49, gate slice: package.json, pnpm-workspace.yaml, scripts/ci/node-pins.test.ts, scripts/ci/ci-workflow.test.ts, .github/workflows/ci.yml. The wave bumps Node to 24.22.1 for Node2Shell (CVE-2026-111497) across .nvmrc, engines and both Dockerfile stages with a pin test; ignores GHSA-mrhx-c7xc-m3w5 and GHSA-gcqx-w48m-w2h4 (Expo tooling only, #846); runs dependency review on public repos only while the repo is private, with pnpm audit --prod and the lockfile checks unconditional.

## Findings summary
Critical 0, important 0, minor 0. Round 4 minor (ci.yml comment should name the ignoreGhsas exception) fixed at e852093. Developer decisions 10-27-26 (private repo, the two ignored GHSAs) kept as stand.

## Cross-cutting checks
- Hard-coded Node in workflows: every setup-node in .github/workflows uses node-version-file .nvmrc.
- Pin drift: .nvmrc 24.22.1 and both deploy/Dockerfile FROM lines match the digest the test expects.
- Round 5 scope: e4aa378..e852093 changes only a ci.yml comment and the prior artifact.

## Answers
No controller questions.

## Remaining Minors
None.
