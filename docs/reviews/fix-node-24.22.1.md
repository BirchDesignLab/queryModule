---
reviewer: "opus-5.5"
effort: "medium"
reviewedSha: "1530dfc91418d1093416348dc2ea4ce7ab4abb07"
verdict: "approve"
---

# Gate review: fix/node-24.22.1 (10-27-26)

## Scope
Branch fix/node-24.22.1, range 641427039a6c12212db151c1142712426f30ebd5..1530dfc91418d1093416348dc2ea4ce7ab4abb07, gate slice. The wave bumps Node to 24.22.1 for Node2Shell (CVE-2026-111497): .nvmrc, engines floor `>=24.22.1 <25`, both Dockerfile stages by digest, kept in step by scripts/ci/node-pins.test.ts. It ignores GHSA-mrhx-c7xc-m3w5 (zod 3 under Expo CLI) and GHSA-gcqx-w48m-w2h4 (deepmerge under Expo config), tracked on #846, and runs the CI dependency review step only on public repos (developer decision 10-27-26, ADR-0007 amendment), pinned by scripts/ci/ci-workflow.test.ts.

## Findings summary
Critical 0, important 0, minor 1. No ledger or controller rulings contested.

## Cross-cutting checks
- Node pins in step: .nvmrc, deploy/Dockerfile FROM lines and engines all name 24.22.1; same digest in both stages.
- ADR coverage: ADR-0001 and ADR-0007 carry 10-27-26 amendments for the pin and the private-repo condition.
- Workflow Node source: every workflow setup uses node-version-file .nvmrc.

## Answers to the controller's questions
None asked.

## Remaining Minors
- M1 .github/workflows/ci.yml:107-108 and the ADR-0007 amendment say `pnpm audit --prod` fails on any advisory and is stricter than dependency review; `--prod` skips devDependencies, so dev-only advisories go unchecked while the repo is private. Reword, or add a dev-dependency audit.
