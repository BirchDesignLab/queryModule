---
reviewer: "opus-5.5"
effort: "medium"
reviewedSha: "535efedb943a4071be0d41cdae9c83899da3a2b5"
verdict: "approve"
---

# Gate review: fix/node-24.22.1

Date: 10-27-26

## Scope

Branch fix/node-24.22.1, range 641427039a6c12212db151c1142712426f30ebd5..535efedb943a4071be0d41cdae9c83899da3a2b5, gate slice (package.json, pnpm-workspace.yaml, scripts/ci/node-pins.test.ts, scripts/ci/ci-workflow.test.ts, .github/workflows/ci.yml). The wave bumps Node to 24.22.1 for Node2Shell (CVE-2026-111497) across .nvmrc, engines and both Dockerfile stages with a pin test; ignores two Expo dev-tooling advisories (GHSA-mrhx-c7xc-m3w5, GHSA-gcqx-w48m-w2h4, tracked on #846); runs dependency review only on public repos while pnpm audit --prod stays unconditional; and raises the test job timeout from 20 to 35 minutes while the repo is private.

## Findings summary

Critical 0, important 0, minor 2. No ruling contested. Developer decisions 10-27-26 (private repo, dependency review skip, ignore entries, timeout 35 rather than sharding) kept as stands.

## Cross-cutting checks

1. Node pins outside the diff (.nvmrc, deploy/Dockerfile): all name 24.22.1, both stages pinned by the same digest.
2. Job caps in ci.yml against the cap test: consistent; test is pinned at exactly 35.
3. ADR-0008 timeout rule: every job still sets timeout-minutes; the 10-minute PR target is a target, not a cap (see minor G-m2).

## Answers

No controller questions.

## Remaining Minors

- G-m1: the 35-minute test cap is called temporary, but no issue tracks restoring 20 when the repo goes public.
- G-m2: ADR-0008 could note private-runner timing next to its 10-minute PR target.
